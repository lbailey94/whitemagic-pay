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
export declare const RecallMemorySchema: z.ZodObject<{
    query: z.ZodString;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    tier: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        call: "call";
        task: "task";
        swarm: "swarm";
    }>>>;
}, z.core.$strip>;
export declare const AcquireAdvanceSchema: z.ZodObject<{
    amount: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export declare const SettleAdvanceSchema: z.ZodObject<{
    amount: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export declare const ArbitrateMutexSchema: z.ZodObject<{
    resource: z.ZodString;
    contenders: z.ZodArray<z.ZodString>;
    stakeUsd: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export interface EvmWalletProviderLike {
    getAddress(): Promise<string> | string;
    signTypedData(typedData: {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
    }): Promise<string>;
    getNetwork(): {
        chainId: number;
        protocolFamily?: string;
    };
}
export declare class WhiteMagicActionProvider {
    readonly name = "whitemagic";
    private baseUrl;
    private client;
    constructor(options?: {
        baseUrl?: string;
        autoAdvance?: boolean;
    });
    supportsNetwork(network: {
        chainId: number;
    }): boolean;
    /**
     * Action 1: Recall Memory over WhiteMagic hosted corpus
     */
    recallMemory(wallet: EvmWalletProviderLike, args: z.infer<typeof RecallMemorySchema>): Promise<string>;
    /**
     * Action 2: Acquire uncollateralized compute nano-advance
     */
    acquireAdvance(wallet: EvmWalletProviderLike, args: z.infer<typeof AcquireAdvanceSchema>): Promise<string>;
    /**
     * Action 3: Settle advance via EIP-3009 permit on Base USDC
     */
    settleAdvance(wallet: EvmWalletProviderLike, args: z.infer<typeof SettleAdvanceSchema>): Promise<string>;
    /**
     * Action 4: Provably fair Cho-Han lock arbitration for multi-agent swarms
     */
    arbitrateMutex(wallet: EvmWalletProviderLike, args: z.infer<typeof ArbitrateMutexSchema>): Promise<string>;
}
