/** x402 requests with explicit signing authority and origin-scoped opaque leases. */
export type Tier = "call" | "task" | "swarm" | "day";
export type AtomicAmount = string | number | bigint;
export interface SpendGrant {
  origin: string;
  network: string;
  asset: string;
  payTo: string;
  allowedAmounts: readonly AtomicAmount[];
  maxTotalAmount: AtomicAmount;
  domainName?: string;
  domainVersion?: string;
}
export interface X402Accept {
  scheme: string;
  network: string;
  asset: string;
  amount: string | number;
  payTo: string;
  extra?: { name?: string; version?: string };
}
export interface X402Challenge {
  x402Version: number;
  resource: string | { url: string };
  accepts: X402Accept[];
  extensions?: Record<string, unknown>;
}
export interface X402ClientOptions {
  privateKey?: string;
  preferredTier?: Tier;
  preferredNetwork?: string;
  autoLease?: boolean;
  autoAdvance?: boolean;
  spendGrants?: readonly SpendGrant[];
}
export interface X402Response {
  status: number;
  data: Record<string, unknown>;
  headers: Record<string, string>;
}
export interface NotarizeInput {
  contextDigest?: string; promptHash?: string; action?: string;
  model?: string; metadata?: Record<string, unknown>;
}
const CHAIN_MAP: Record<string, number> = {
  "eip155:8453": 8453, "eip155:42161": 42161, "eip155:137": 137,
  "eip155:84532": 84532, "eip155:1": 1,
};
export const TIER_PRICES: Record<Tier, number> = { call: 1000, task: 10000, swarm: 50000, day: 500000 };
const CREDENTIALS = ["authorization", "x-session-pass", "payment-signature"];
const EIP3009_TYPES = { TransferWithAuthorization: [
  {name:"from", type:"address"}, {name:"to", type:"address"}, {name:"value", type:"uint256"},
  {name:"validAfter", type:"uint256"}, {name:"validBefore", type:"uint256"}, {name:"nonce", type:"bytes32"},
]} as const;

export function atomicAmount(value: unknown): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("amount number must be a positive safe integer; use a decimal string");
  }
  if (!(["string", "number", "bigint"].includes(typeof value)) || !/^[1-9][0-9]*$/.test(String(value))) {
    throw new Error("amount must be a positive decimal integer");
  }
  const amount = BigInt(value as string | number | bigint);
  if (amount >= 1n << 256n) throw new Error("amount exceeds uint256");
  return amount;
}
function resourceUrl(input: string): URL {
  const url = new URL(input);
  if (url.username || url.password || url.hash) throw new Error("URL credentials/fragments are forbidden");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname))) {
    throw new Error("HTTPS is required except explicit loopback URLs");
  }
  return url;
}
function address(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("explicit EVM address required");
  return value.toLowerCase();
}
function b64encode(text: string): string { return btoa(text); }
function b64decode(text: string): string { return atob(text); }
function randomNonce(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error("secure randomness is required for payment authorizations");
  return "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,"0")).join("");
}
interface Signer { address: string; signTypedData(args: Record<string, unknown>): Promise<string>; }
interface Grant {
  origin: string; network: string; asset: string; payTo: string; allowed: readonly bigint[];
  max: bigint; name: string; version: string;
}
interface Lease { token: string; tier: string; expiresAt: number; }
async function loadSigner(key: string): Promise<Signer> {
  const accounts = await import("viem/accounts");
  return accounts.privateKeyToAccount(key as `0x${string}`) as unknown as Signer;
}

export class X402Client {
  private signerPromise: Promise<Signer> | null = null;
  private readonly preferredTier: Tier;
  private readonly preferredNetwork?: string;
  private readonly autoLease: boolean;
  private readonly autoAdvance: boolean;
  private readonly grants: readonly Grant[];
  private readonly spent: bigint[];
  private readonly passes = new Map<string, Lease>();

  constructor(options: X402ClientOptions = {}) {
    this.preferredTier = options.preferredTier ?? "task";
    if (!(this.preferredTier in TIER_PRICES)) throw new Error("unsupported tier");
    this.preferredNetwork = options.preferredNetwork;
    this.autoLease = options.autoLease !== false;
    this.autoAdvance = options.autoAdvance === true;
    this.grants = (options.spendGrants ?? []).map(g => {
      const url = resourceUrl(g.origin);
      if (url.pathname !== "/" || url.search) throw new Error("grant origin cannot contain path/query");
      const name = g.domainName ?? "USD Coin", version = g.domainVersion ?? "2";
      if (!g.allowedAmounts.length || !name || !version) throw new Error("grant requires amounts and token domain");
      return Object.freeze({origin:url.origin,network:g.network,asset:address(g.asset),payTo:address(g.payTo),
        allowed:Object.freeze(g.allowedAmounts.map(atomicAmount)),max:atomicAmount(g.maxTotalAmount),name,version});
    });
    this.spent = this.grants.map(()=>0n);
    if (options.privateKey) this.signerPromise = loadSigner(options.privateKey);
  }

  public async address(): Promise<string | null> { return this.signerPromise ? (await this.signerPromise).address : null; }
  public isPassActive(url = "https://mcp.whitemagic.dev"): boolean {
    const origin = resourceUrl(url).origin, pass = this.passes.get(origin);
    if (pass && Date.now() < pass.expiresAt - 5000) return true;
    this.passes.delete(origin);
    return false;
  }
  /** Metadata only: lease secrets must not enter agent/tool transcripts. */
  public sessionStatus(url = "https://mcp.whitemagic.dev") {
    const active = this.isPassActive(url), origin = resourceUrl(url).origin, pass = this.passes.get(origin);
    return {active,origin,tier:pass?.tier,expiresAt:pass?.expiresAt};
  }
  public adoptSessionPass(url: string, token: string, expiresIn: AtomicAmount, tier = "session"): void {
    const origin = resourceUrl(url).origin;
    if (!this.autoLease) return;
    if (typeof token !== "string" || !token || /[\r\n]/.test(token)) throw new Error("invalid session token");
    const seconds = atomicAmount(expiresIn);
    if (seconds > 86400n) throw new Error("session lifetime exceeds one day");
    this.passes.set(origin,{token,tier,expiresAt:Date.now()+Number(seconds)*1000});
  }

  private selectOffer(challenge: X402Challenge, requestUrl: string, tier: Tier) {
    const requested = resourceUrl(requestUrl);
    const resource = typeof challenge.resource === "string" ? challenge.resource : challenge.resource?.url;
    if (typeof resource !== "string" || resourceUrl(resource).href !== requested.href) throw new Error("challenge resource mismatch");
    if (![1,2].includes(challenge.x402Version) || !Number.isInteger(challenge.x402Version)) throw new Error("unsupported x402 version");
    if (!Array.isArray(challenge.accepts) || !challenge.accepts.length) throw new Error("nonempty accepts required");
    if (!(tier in TIER_PRICES)) throw new Error("unsupported tier");
    const eligible: {req: X402Accept; amount: bigint; index: number}[] = [];
    for (const req of challenge.accepts) {
      if (!req || typeof req !== "object") throw new Error("invalid offer");
      const amount = atomicAmount(req.amount);
      if (!Object.hasOwn(CHAIN_MAP, req.network) || req.scheme !== "exact") continue;
      const asset = address(req.asset), payTo = address(req.payTo);
      if (req.extra !== undefined && (req.extra === null || typeof req.extra !== "object" || Array.isArray(req.extra))) {
        throw new Error("invalid token domain");
      }
      const extra = req.extra ?? {};
      const name = extra.name ?? "USD Coin", version = extra.version ?? "2";
      if (typeof name !== "string" || typeof version !== "string") throw new Error("invalid token domain");
      if (this.preferredNetwork && req.network !== this.preferredNetwork) continue;
      if (amount !== BigInt(TIER_PRICES[tier]) && !(tier === "call" && amount === 2000n)) continue;
      this.grants.forEach((g,index)=> {
        if (g.origin === requested.origin && g.network === req.network && g.asset === asset && g.payTo === payTo &&
            g.name === name && g.version === version && g.allowed.includes(amount) && this.spent[index]+amount <= g.max) {
          eligible.push({req,amount,index});
        }
      });
    }
    eligible.sort((a,b)=>a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : a.index-b.index);
    if (!eligible.length) throw new Error("no offer satisfies spending grant, tier and remaining budget");
    return eligible[0];
  }

  public async createPaymentPayload(challenge: X402Challenge, tier?: Tier, requestUrl?: string) {
    if (!this.signerPromise) throw new Error("no signing account configured");
    if (!requestUrl) throw new Error("requestUrl required for origin/resource binding");
    const signer = await this.signerPromise;
    const {req,amount,index} = this.selectOffer(challenge,requestUrl,tier ?? this.preferredTier);
    // Reserve synchronously before signer await, including ambiguous signer failures.
    this.spent[index] += amount;
    const now = Math.floor(Date.now()/1000), extra = req.extra ?? {};
    const authorization = {from:signer.address,to:req.payTo,value:amount,validAfter:BigInt(now-60),validBefore:BigInt(now+600),nonce:randomNonce()};
    const domain = {name:extra.name ?? "USD Coin",version:extra.version ?? "2",chainId:CHAIN_MAP[req.network],verifyingContract:req.asset};
    const signature = await signer.signTypedData({domain,types:EIP3009_TYPES,primaryType:"TransferWithAuthorization",message:authorization});
    const payment = {x402Version:challenge.x402Version,resource:challenge.resource,accepted:req,
      payload:{signature,authorization:{...authorization,value:String(amount),validAfter:String(authorization.validAfter),validBefore:String(authorization.validBefore)}},
      extensions:challenge.extensions ?? {}};
    return {payment,header:b64encode(JSON.stringify(payment))};
  }

  private headersFor(url: string, input?: HeadersInit) {
    const origin = resourceUrl(url).origin, headers = new Headers(input);
    if (!headers.has("content-type")) headers.set("content-type","application/json");
    const callerCredentials = CREDENTIALS.some(h=>headers.has(h));
    if (this.autoLease && !callerCredentials) {
      if (this.isPassActive(url)) {
        const token = this.passes.get(origin)!.token;
        headers.set("authorization",`Bearer ${token}`); headers.set("x-session-pass",token);
      } else if (this.autoAdvance && !headers.has("x-wm-auto-advance")) headers.set("x-wm-auto-advance","1");
    }
    return {headers,callerCredentials};
  }
  private cachePass(url: string, response: Response, callerCredentials: boolean) {
    if (callerCredentials || !this.autoLease) return;
    const origin = resourceUrl(url).origin;
    if ([401,402,403].includes(response.status)) this.passes.delete(origin);
    if (response.ok) {
      const token = response.headers.get("x-session-pass"), expiry = response.headers.get("x-session-expires-in");
      if (token && expiry) {
        try { this.adoptSessionPass(url,token,expiry,response.headers.get("x-session-tier") ?? this.preferredTier); }
        catch { this.passes.delete(origin); }
      }
    }
  }
  private async challenge(response: Response): Promise<X402Challenge | null> {
    try {
      const hdr = response.headers.get("payment-required");
      const body = hdr ? JSON.parse(b64decode(hdr)) : await response.clone().json();
      return body && Array.isArray(body.accepts) ? body as X402Challenge : null;
    } catch { return null; }
  }

  /** At most one 402 retry; redirects are returned without following them. */
  public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const original = new Request(input,init);
    const url = original.url;
    const {headers,callerCredentials} = this.headersFor(url,original.headers);
    let response = await globalThis.fetch(new Request(original.clone(),{headers,redirect:"manual"}));
    this.cachePass(url,response,callerCredentials);
    if (response.status === 402 && this.autoLease && this.signerPromise && !callerCredentials) {
      const challenge = await this.challenge(response);
      if (challenge) {
        const {header} = await this.createPaymentPayload(challenge,undefined,url);
        const retry = new Headers(headers);
        CREDENTIALS.forEach(h=>retry.delete(h));
        retry.set("payment-signature",header); retry.set("x-lease-tier",this.preferredTier);
        response = await globalThis.fetch(new Request(original.clone(),{headers:retry,redirect:"manual"}));
        this.cachePass(url,response,false);
      }
    }
    return response;
  }

  public async request(method: string,url: string,data?: unknown,headers?: Record<string,string>,timeoutMs=30000): Promise<X402Response> {
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response = await this.fetch(url,{method,headers,body:data === undefined ? undefined : typeof data === "string" ? data : JSON.stringify(data),signal:controller.signal});
      const text = await response.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = {raw:text}; }
      const result = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string,unknown> : {value:parsed};
      const responseHeaders: Record<string,string> = {};
      response.headers.forEach((v,k)=>{ responseHeaders[k]=v; });
      return {status:response.status,data:result,headers:responseHeaders};
    } finally { clearTimeout(timer); }
  }

  public async claimFaucet(baseUrl="https://mcp.whitemagic.dev") {
    const url = baseUrl.replace(/\/$/,"")+"/faucet";
    const result = await this.request("POST",url,{payer:await this.address() ?? "agent"});
    if (result.status !== 200) throw new Error(`faucet failed with HTTP ${result.status}`);
    if (typeof result.data.session_pass === "string") this.adoptSessionPass(url,result.data.session_pass,result.data.expires_in as AtomicAmount ?? 600,"faucet");
    return result.data;
  }
  public async notarizeContext(input: NotarizeInput,baseUrl="https://api.whitemagic.dev") {
    const payload: Record<string,unknown> = {};
    for (const [field,key] of Object.entries({contextDigest:"context_digest",promptHash:"prompt_hash",action:"action",model:"model",metadata:"metadata"})) {
      if (input[field as keyof NotarizeInput] !== undefined) payload[key]=input[field as keyof NotarizeInput];
    }
    const addr = await this.address(); if (addr) payload.agent_id=addr;
    const result = await this.request("POST",baseUrl.replace(/\/$/,"")+"/notarize",payload);
    if (result.status !== 200) throw new Error(`notarization failed with HTTP ${result.status}`);
    return result.data;
  }
}
export function createX402Client(options: X402ClientOptions={}) { return new X402Client(options); }
