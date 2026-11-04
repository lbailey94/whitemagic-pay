/** Framework-neutral examples, not a registered Coinbase AgentKit ActionProvider.
 * Hosts must register methods through the pinned framework's actual action API.
 * No wallet signing or settlement is performed by this adapter.
 */
import { z } from "zod";
export declare const RecallMemorySchema: z.ZodObject<{
    query: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
    tier: z.ZodDefault<z.ZodEnum<{
        call: "call";
        task: "task";
        swarm: "swarm";
    }>>;
}, z.core.$strip>;
export declare const AcquireAdvanceSchema: z.ZodObject<{
    amount: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const SettleAdvanceSchema: z.ZodObject<{
    amount: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const ArbitrateMutexSchema: z.ZodObject<{
    resource: z.ZodString;
    contenders: z.ZodArray<z.ZodString>;
    stakeUsd: z.ZodDefault<z.ZodLiteral<0>>;
}, z.core.$strip>;
export interface EvmWalletProviderLike {
    getAddress(): Promise<string> | string;
}
export declare class WhiteMagicActionProvider {
    readonly name = "whitemagic-transport-example";
    private readonly baseUrl;
    private readonly autoAdvance;
    private readonly clients;
    constructor(options?: {
        baseUrl?: string;
        autoAdvance?: boolean;
    });
    private clientFor;
    supportsNetwork(network: {
        chainId: number;
    }): boolean;
    recallMemory(wallet: EvmWalletProviderLike, input: z.input<typeof RecallMemorySchema>): Promise<string>;
    acquireAdvance(wallet: EvmWalletProviderLike, input: z.input<typeof AcquireAdvanceSchema>): Promise<string>;
    settleAdvance(_wallet: EvmWalletProviderLike, _input: z.input<typeof SettleAdvanceSchema>): Promise<string>;
    arbitrateMutex(wallet: EvmWalletProviderLike, input: z.input<typeof ArbitrateMutexSchema>): Promise<string>;
}
