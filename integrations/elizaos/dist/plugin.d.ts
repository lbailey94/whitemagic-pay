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
    validate(runtime: ElizaRuntime, message: ElizaMessage): Promise<boolean>;
    handler(runtime: ElizaRuntime, message: ElizaMessage, state?: unknown, options?: unknown, callback?: (response: {
        text: string;
    }) => void): Promise<boolean>;
    examples: Array<Array<{
        user: string;
        content: {
            text: string;
        };
    }>>;
}
export declare const whitemagicMemoryProvider: ElizaMemoryProvider;
export declare const recallMemoryAction: ElizaAction;
export declare const arbitrateMutexAction: ElizaAction;
export declare const whiteMagicPlugin: {
    name: string;
    description: string;
    providers: ElizaMemoryProvider[];
    actions: ElizaAction[];
    evaluators: never[];
};
export default whiteMagicPlugin;
