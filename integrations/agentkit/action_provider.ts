/**
 * WhiteMagic Action Provider for Coinbase AgentKit (TypeScript)
 *
 * Exposes WhiteMagic autonomous capabilities to Coinbase AgentKit agents:
 * 1. Semantic Memory Recall — persistent cross-session memory retrieval with x402 / auto-advance.
 * 2. Uncollateralized Nano-Credit Advance — zero-friction instant compute leases.
 * 3. EIP-3009 Gasless Settlement — on-chain Base USDC debt resolution using AgentKit EVM wallet.
 * 4. Cho-Han Mutex Arbitration — zero-deadlock provably fair multi-agent lock contention.
 */

import { z } from "zod";
import { X402Client, Tier } from "../../ts/dist/index.js";

// Action Schemas
export const RecallMemorySchema = z.object({
  query: z.string().describe("The search query to recall cross-session memories or knowledge context"),
  limit: z.number().optional().default(5).describe("Maximum number of context results to return"),
  tier: z.enum(["call", "task", "swarm"]).optional().default("call").describe("Lease tier: call ($0.001), task ($0.01), swarm ($0.05)"),
});

export const AcquireAdvanceSchema = z.object({
  amount: z.number().optional().default(0.05).describe("Requested uncollateralized compute advance in USD ($0.05 - $5.00)"),
});

export const SettleAdvanceSchema = z.object({
  amount: z.number().optional().default(0.05).describe("Settlement amount in USD to repay"),
});

export const ArbitrateMutexSchema = z.object({
  resource: z.string().describe("The unique resource ID or lock path contested by swarms (e.g. 'lock:shared_graph')"),
  contenders: z.array(z.string()).describe("List of competing agent identifiers"),
  stakeUsd: z.number().optional().default(0.01).describe("Stake per contender in USD (default $0.01)"),
});

export interface EvmWalletProviderLike {
  getAddress(): Promise<string> | string;
  signTypedData(typedData: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<string>;
  getNetwork(): { chainId: number; protocolFamily?: string };
}

export class WhiteMagicActionProvider {
  public readonly name = "whitemagic";
  private baseUrl: string;
  private client: X402Client;

  constructor(options: { baseUrl?: string; autoAdvance?: boolean } = {}) {
    this.baseUrl = (options.baseUrl ?? "https://mcp.whitemagic.dev").replace(/\/$/, "");
    this.client = new X402Client({
      autoAdvance: options.autoAdvance !== false,
      preferredTier: "call",
    });
  }

  public supportsNetwork(network: { chainId: number }): boolean {
    // Supports Base (8453), Arbitrum One (42161), Polygon (137)
    return [8453, 42161, 137].includes(network.chainId);
  }

  /**
   * Action 1: Recall Memory over WhiteMagic hosted corpus
   */
  public async recallMemory(
    wallet: EvmWalletProviderLike,
    args: z.infer<typeof RecallMemorySchema>
  ): Promise<string> {
    const address = await wallet.getAddress();
    const payload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "memory.search",
        arguments: {
          query: args.query,
          limit: args.limit,
        },
      },
    };

    const res = await this.client.request(
      "POST",
      `${this.baseUrl}/mcp`,
      payload,
      {
        "X-Agent-ID": address,
        "X-Lease-Tier": args.tier ?? "call",
      }
    );

    if (res.status === 200) {
      const data = res.data as { result?: { content?: Array<{ text?: string }> } };
      const text = data.result?.content?.[0]?.text;
      return text || JSON.stringify(res.data);
    }

    if (res.status === 402) {
      return `[WhiteMagic] Payment Required (402). Wallet ${address} can settle via EIP-3009 or request an advance with acquire_advance.`;
    }

    return `[WhiteMagic] Memory recall error (${res.status}): ${JSON.stringify(res.data)}`;
  }

  /**
   * Action 2: Acquire uncollateralized compute nano-advance
   */
  public async acquireAdvance(
    wallet: EvmWalletProviderLike,
    args: z.infer<typeof AcquireAdvanceSchema>
  ): Promise<string> {
    const address = await wallet.getAddress();
    const url = `${this.baseUrl}/lease/advance`;
    const body = {
      agent_id: address,
      amount: args.amount ?? 0.05,
      request_key: true,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json() as Record<string, unknown>;
    if (res.ok && data.status === "granted") {
      return `[WhiteMagic] Advance granted: $${data.amount} USD. Lease pass issued: ${data.session_pass} (Expires in ${data.expires_in}s). Credit limit: $${data.credit_limit}.`;
    }

    return `[WhiteMagic] Advance request declined or failed: ${JSON.stringify(data)}`;
  }

  /**
   * Action 3: Settle advance via EIP-3009 permit on Base USDC
   */
  public async settleAdvance(
    wallet: EvmWalletProviderLike,
    args: z.infer<typeof SettleAdvanceSchema>
  ): Promise<string> {
    const address = await wallet.getAddress();
    const amountUsd = args.amount ?? 0.05;
    const valueAtomic = Math.round(amountUsd * 1_000_000);
    const now = Math.floor(Date.now() / 1000);

    // EIP-3009 TransferWithAuthorization for Base USDC
    const domain = {
      name: "USD Coin",
      version: "2",
      chainId: 8453,
      verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    };

    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };

    const bytes = new Uint8Array(32);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    const nonce = "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    const message = {
      from: address,
      to: "0x213b6bB4fB073E86167c58DA6Cb6E9477557DaA8",
      value: BigInt(valueAtomic).toString(),
      validAfter: String(now - 60),
      validBefore: String(now + 3600),
      nonce,
    };

    const signature = await wallet.signTypedData({
      domain,
      types,
      primaryType: "TransferWithAuthorization",
      message,
    });

    const res = await fetch(`${this.baseUrl}/lease/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: address,
        method: "eip3009",
        amount: amountUsd,
        paymentPayload: {
          signature,
          authorization: message,
        },
      }),
    });

    const data = await res.json() as Record<string, unknown>;
    if (res.ok && data.status === "settled") {
      return `[WhiteMagic] Advance successfully settled: $${amountUsd} USD. New trust score: ${data.trust_score}, new credit ceiling: $${data.new_credit_ceiling}.`;
    }

    return `[WhiteMagic] Settlement response: ${JSON.stringify(data)}`;
  }

  /**
   * Action 4: Provably fair Cho-Han lock arbitration for multi-agent swarms
   */
  public async arbitrateMutex(
    wallet: EvmWalletProviderLike,
    args: z.infer<typeof ArbitrateMutexSchema>
  ): Promise<string> {
    const callerId = await wallet.getAddress();
    const contenders = args.contenders.includes(callerId)
      ? args.contenders
      : [callerId, ...args.contenders];

    const payload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "economy_chohan_arbitrate",
        arguments: {
          resource_id: args.resource,
          contenders,
          stake: args.stakeUsd ?? 0.01,
        },
      },
    };

    const res = await this.client.request("POST", `${this.baseUrl}/mcp`, payload);
    if (res.status === 200) {
      const data = res.data as { result?: { content?: Array<{ text?: string }> } };
      return data.result?.content?.[0]?.text || JSON.stringify(res.data);
    }

    return `[WhiteMagic] Lock arbitration failed (${res.status}): ${JSON.stringify(res.data)}`;
  }
}
