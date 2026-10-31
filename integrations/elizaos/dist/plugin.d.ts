/**
 * WhiteMagic Plugin for ElizaOS (ai16z)
 *
 * Provides ElizaOS autonomous agents with:
 * 1. Persistent Semantic Memory Provider — context injection into character prompts before generation.
 * 2. Cross-Session Memory Recall Action — explicit tool execution to search memory.
 * 3. Cho-Han Multi-Agent Mutex Arbitration — non-blocking deadlock resolution for swarms.
 * 4. Uncollateralized Nano-Credit Auto-Advance — zero-friction instant leases for containerized agents.
 */
export interface ElizaMessage {
    userId: string;
    roomId: string;
    content: {
        text: string;
    };
}
export interface ElizaRuntime {
    character: {
        name: string;
    };
    getSetting(key: string): string | undefined;
}
export interface ElizaMemoryProvider {
    get(runtime: ElizaRuntime, message: ElizaMessage): Promise<string>;
}
export interface ElizaAction {
    name: string;
    similes: string[];
    description: string;
    validate: (runtime: ElizaRuntime, message: ElizaMessage) => Promise<boolean>;
    handler: (runtime: ElizaRuntime, message: ElizaMessage, state?: unknown, options?: unknown, callback?: (response: {
        text: string;
    }) => void) => Promise<boolean>;
    examples: Array<Array<{
        user: string;
        content: {
            text: string;
        };
    }>>;
}
/**
 * ElizaOS Context Provider — automatically feeds relevant memory into character prompt context
 */
export declare const whitemagicMemoryProvider: ElizaMemoryProvider;
/**
 * ElizaOS Action: RECALL_MEMORY
 */
export declare const recallMemoryAction: ElizaAction;
/**
 * ElizaOS Action: ARBITRATE_MUTEX
 */
export declare const arbitrateMutexAction: ElizaAction;
/**
 * Default Plugin Export
 */
export declare const whiteMagicPlugin: {
    name: string;
    description: string;
    providers: ElizaMemoryProvider[];
    actions: ElizaAction[];
    evaluators: never[];
};
export default whiteMagicPlugin;
