/**
 * whitemagic-pay (TypeScript) — autonomous x402 payment client, session lease
 * caching, and Proof-of-Context notarization for AI agents.
 *
 * Mirrors the Python client's semantics: HTTP 402 challenge negotiation,
 * EIP-3009 TransferWithAuthorization signing (via the optional `viem`
 * dependency), session pass reuse, faucet claims, and context notarization.
 */

export type Tier = "call" | "task" | "swarm" | "day";

export interface X402Accept {
  network: string;
  asset: string;
  amount: string | number;
  payTo: string;
  extra?: { name?: string; version?: string };
}

export interface X402Challenge {
  x402Version?: number;
  resource?: string;
  accepts: X402Accept[];
  extensions?: Record<string, unknown>;
}

export interface X402ClientOptions {
  privateKey?: string;
  preferredTier?: Tier;
  autoLease?: boolean;
}

export interface X402Response {
  status: number;
  data: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface NotarizeInput {
  contextDigest?: string;
  promptHash?: string;
  action?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

const CHAIN_MAP: Record<string, number> = {
  "eip155:8453": 8453,
  "eip155:84532": 84532,
  "eip155:1": 1,
};

export const TIER_PRICES: Record<Tier, number> = {
  call: 2000,
  task: 10000,
  swarm: 50000,
  day: 500000,
};

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function b64encode(text: string): string {
  const g = globalThis as unknown as {
    btoa?: (s: string) => string;
    Buffer?: { from: (s: string, e?: string) => { toString: (e: string) => string } };
  };
  if (typeof g.btoa === "function") return g.btoa(text);
  if (g.Buffer) return g.Buffer.from(text, "utf8").toString("base64");
  throw new Error("No base64 encoder available in this runtime.");
}

function b64decode(text: string): string {
  const g = globalThis as unknown as {
    atob?: (s: string) => string;
    Buffer?: { from: (s: string, e?: string) => { toString: (e: string) => string } };
  };
  if (typeof g.atob === "function") return g.atob(text);
  if (g.Buffer) return g.Buffer.from(text, "base64").toString("utf8");
  throw new Error("No base64 decoder available in this runtime.");
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  const cryptoObj = globalThis.crypto as { getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface Signer {
  address: string;
  signTypedData(args: Record<string, unknown>): Promise<string>;
}

async function loadSigner(privateKey: string): Promise<Signer> {
  let accounts: { privateKeyToAccount: (key: string) => Signer };
  try {
    accounts = (await import("viem/accounts")) as unknown as {
      privateKeyToAccount: (key: string) => Signer;
    };
  } catch {
    throw new Error(
      "The paid path requires the optional `viem` dependency. Install it with: npm install viem",
    );
  }
  return accounts.privateKeyToAccount(privateKey);
}

export class X402Client {
  private signerPromise: Promise<Signer> | null = null;
  private preferredTier: Tier;
  private autoLease: boolean;
  private cachedPass: string | null = null;
  private passExpiresAt = 0;
  private passTier = "";

  constructor(options: X402ClientOptions = {}) {
    this.preferredTier = options.preferredTier ?? "task";
    this.autoLease = options.autoLease !== false;
    if (options.privateKey) {
      this.signerPromise = loadSigner(options.privateKey);
    }
  }

  /** The payer address, when a private key was provided. */
  public async address(): Promise<string | null> {
    if (!this.signerPromise) return null;
    return (await this.signerPromise).address;
  }

  public isPassActive(): boolean {
    return Boolean(this.cachedPass && Date.now() < this.passExpiresAt - 5000);
  }

  public get pass(): { token: string | null; tier: string; expiresAt: number } {
    return { token: this.cachedPass, tier: this.passTier, expiresAt: this.passExpiresAt };
  }

  /** Claim a 10-minute trial session pass from the hosted faucet (no wallet). */
  public async claimFaucet(baseUrl = "https://mcp.whitemagic.dev"): Promise<Record<string, unknown>> {
    const address = await this.address();
    const res = await this.raw("POST", `${baseUrl.replace(/\/$/, "")}/faucet`, {
      payer: address ?? "agent",
    });
    const data = res.data as { session_pass?: string; expires_in?: number };
    if (data.session_pass) {
      this.cachedPass = data.session_pass;
      this.passExpiresAt = Date.now() + Number(data.expires_in ?? 600) * 1000;
      this.passTier = "faucet";
    }
    return res.data;
  }

  /** Request a Proof-of-Context notarization from the hosted API lane. */
  public async notarizeContext(
    input: NotarizeInput,
    baseUrl = "https://api.whitemagic.dev",
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {};
    if (input.contextDigest) payload.context_digest = input.contextDigest;
    if (input.promptHash) payload.prompt_hash = input.promptHash;
    if (input.action) payload.action = input.action;
    if (input.model) payload.model = input.model;
    if (input.metadata) payload.metadata = input.metadata;
    const address = await this.address();
    if (address) payload.agent_id = address;

    const res = await this.request("POST", `${baseUrl.replace(/\/$/, "")}/notarize`, payload);
    if (res.status !== 200) {
      throw new Error(`Notarization failed with status ${res.status}: ${JSON.stringify(res.data)}`);
    }
    return res.data;
  }

  /** Build a signed EIP-3009 payment payload from an x402 challenge. */
  public async createPaymentPayload(
    challenge: X402Challenge,
    tier?: Tier,
  ): Promise<{ payment: Record<string, unknown>; header: string }> {
    if (!this.signerPromise) {
      throw new Error("No private key provided to X402Client to sign the payment challenge.");
    }
    const signer = await this.signerPromise;
    const accepts = challenge.accepts ?? [];
    if (accepts.length === 0) {
      throw new Error("Challenge contains no 'accepts' requirements.");
    }

    const chosenTier = tier ?? this.preferredTier;
    const targetAmount = TIER_PRICES[chosenTier];
    let req = accepts.find((c) => Number(c.amount) === targetAmount);
    if (!req) {
      req = accepts.reduce((min, c) => (Number(c.amount) < Number(min.amount) ? c : min));
    }

    const network = req.network ?? "eip155:8453";
    const chainId = CHAIN_MAP[network];
    if (chainId === undefined) {
      throw new Error(`Unsupported network rail: ${network}`);
    }

    const extra = req.extra ?? {};
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: signer.address,
      to: req.payTo,
      value: Number(req.amount),
      validAfter: now - 60,
      validBefore: now + 600,
      nonce: randomNonce(),
    };
    const domain = {
      name: extra.name ?? "USD Coin",
      version: String(extra.version ?? "2"),
      chainId,
      verifyingContract: req.asset,
    };
    const signature = await signer.signTypedData({
      domain,
      types: EIP3009_TYPES,
      primaryType: "TransferWithAuthorization",
      message: authorization,
    });

    const payloadAuthorization: Record<string, string> = {
      from: authorization.from,
      to: authorization.to,
      value: String(authorization.value),
      validAfter: String(authorization.validAfter),
      validBefore: String(authorization.validBefore),
      nonce: authorization.nonce,
    };
    const payment = {
      x402Version: challenge.x402Version ?? 2,
      resource: challenge.resource,
      accepted: req,
      payload: { signature, authorization: payloadAuthorization },
      extensions: challenge.extensions ?? {},
    };
    return { payment, header: b64encode(JSON.stringify(payment)) };
  }

  /** Execute a request with automatic 402 negotiation and session pass reuse. */
  public async request(
    method: string,
    url: string,
    data?: unknown,
    headers?: Record<string, string>,
    timeoutMs = 30000,
  ): Promise<X402Response> {
    const reqHeaders: Record<string, string> = { "Content-Type": "application/json", ...(headers ?? {}) };
    if (this.isPassActive() && this.cachedPass) {
      reqHeaders["Authorization"] = `Bearer ${this.cachedPass}`;
      reqHeaders["X-Session-Pass"] = this.cachedPass;
    }

    const body =
      data === undefined
        ? undefined
        : typeof data === "string"
          ? data
          : JSON.stringify(data);

    let res = await this.raw(method, url, body, reqHeaders, timeoutMs);

    if (res.status === 402 && this.signerPromise) {
      const challenge = await this.extractChallenge(res);
      if (challenge && Array.isArray(challenge.accepts) && challenge.accepts.length > 0) {
        const { header } = await this.createPaymentPayload(challenge);
        const retryHeaders = {
          ...reqHeaders,
          "PAYMENT-SIGNATURE": header,
          "X-Lease-Tier": this.preferredTier,
        };
        res = await this.raw(method, url, body, retryHeaders, timeoutMs);
      }
    }

    this.cachePassFromHeaders(res.headers);
    return res;
  }

  /**
   * fetch()-style wrapper: same negotiation semantics for callers that want
   * a drop-in replacement for global fetch.
   */
  public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers ?? {});
    if (this.isPassActive() && this.cachedPass) {
      headers.set("Authorization", `Bearer ${this.cachedPass}`);
      headers.set("X-Session-Pass", this.cachedPass);
    }

    let response = await globalThis.fetch(input, { ...init, headers });

    if (response.status === 402 && this.signerPromise) {
      const challenge = await this.extractChallengeFromResponse(response);
      if (challenge && Array.isArray(challenge.accepts) && challenge.accepts.length > 0) {
        const { header } = await this.createPaymentPayload(challenge);
        const retryHeaders = new Headers(headers);
        retryHeaders.set("PAYMENT-SIGNATURE", header);
        retryHeaders.set("X-Lease-Tier", this.preferredTier);
        response = await globalThis.fetch(input, { ...init, headers: retryHeaders });
      }
    }

    const headerRecord: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headerRecord[key] = value;
    });
    this.cachePassFromHeaders(headerRecord);
    return response;
  }

  private async raw(
    method: string,
    url: string,
    body?: string | Record<string, unknown>,
    headers?: Record<string, string>,
    timeoutMs = 30000,
  ): Promise<X402Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    try {
      const response = await globalThis.fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: payload,
        signal: controller.signal,
      });
      const headerRecord: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headerRecord[key] = value;
      });
      const text = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        data = { raw: text };
      }
      return { status: response.status, data, headers: headerRecord };
    } finally {
      clearTimeout(timer);
    }
  }

  private async extractChallenge(res: X402Response): Promise<X402Challenge | null> {
    const body = res.data as unknown as X402Challenge;
    if (body && Array.isArray(body.accepts)) return body;
    const header = res.headers["payment-required"] ?? res.headers["PAYMENT-REQUIRED"];
    if (header) {
      try {
        return JSON.parse(b64decode(header)) as X402Challenge;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async extractChallengeFromResponse(response: Response): Promise<X402Challenge | null> {
    const header = response.headers.get("PAYMENT-REQUIRED");
    if (header) {
      try {
        return JSON.parse(b64decode(header)) as X402Challenge;
      } catch {
        // fall through to the body
      }
    }
    try {
      const clone = response.clone();
      const body = (await clone.json()) as X402Challenge;
      if (body && Array.isArray(body.accepts)) return body;
    } catch {
      // not JSON
    }
    return null;
  }

  private cachePassFromHeaders(headers: Record<string, string>): void {
    const sessionPass = headers["x-session-pass"];
    const expiresIn = headers["x-session-expires-in"];
    const tier = headers["x-session-tier"];
    if (sessionPass && expiresIn) {
      const secs = Number(expiresIn);
      if (!Number.isNaN(secs)) {
        this.cachedPass = sessionPass;
        this.passExpiresAt = Date.now() + secs * 1000;
        this.passTier = tier ?? this.preferredTier;
      }
    }
  }
}

/** Convenience helper mirroring the Python package's `wrap_session`. */
export function createX402Client(options: X402ClientOptions = {}): X402Client {
  return new X402Client(options);
}
