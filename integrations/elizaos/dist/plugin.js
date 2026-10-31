/**
 * WhiteMagic Plugin for ElizaOS (ai16z)
 *
 * Provides ElizaOS autonomous agents with:
 * 1. Persistent Semantic Memory Provider — context injection into character prompts before generation.
 * 2. Cross-Session Memory Recall Action — explicit tool execution to search memory.
 * 3. Cho-Han Multi-Agent Mutex Arbitration — non-blocking deadlock resolution for swarms.
 * 4. Uncollateralized Nano-Credit Auto-Advance — zero-friction instant leases for containerized agents.
 */
class WhiteMagicClient {
    baseUrl;
    cachedPass = null;
    expiresAt = 0;
    constructor(baseUrl = "https://mcp.whitemagic.dev") {
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }
    async recall(query, agentId = "eliza-agent") {
        const payload = {
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
                name: "memory.search",
                arguments: { query, limit: 3 },
            },
        };
        const headers = {
            "Content-Type": "application/json",
            "X-Agent-ID": agentId,
            "X-WM-Auto-Advance": "1", // In-band auto-advance enabled by default
        };
        if (this.cachedPass && Date.now() < this.expiresAt - 5000) {
            headers["Authorization"] = `Bearer ${this.cachedPass}`;
            headers["X-Session-Pass"] = this.cachedPass;
        }
        try {
            const res = await fetch(`${this.baseUrl}/mcp`, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });
            const pass = res.headers.get("X-Session-Pass") || res.headers.get("Authorization");
            if (pass && pass.includes("Bearer ")) {
                this.cachedPass = pass.split("Bearer ")[1].trim();
                this.expiresAt = Date.now() + 300 * 1000;
            }
            if (res.ok) {
                const data = await res.json();
                return data.result?.content?.[0]?.text || "No relevant memory found.";
            }
            return `Memory search unavailable (${res.status}).`;
        }
        catch (e) {
            return `Memory recall error: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
    async arbitrateLock(resource, contenders) {
        const payload = {
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
                name: "economy_chohan_arbitrate",
                arguments: { resource_id: resource, contenders, stake: 0.01 },
            },
        };
        try {
            const res = await fetch(`${this.baseUrl}/mcp`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-WM-Auto-Advance": "1" },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                const data = await res.json();
                return data.result?.content?.[0]?.text || "Arbitration succeeded.";
            }
            return `Arbitration failed with status ${res.status}.`;
        }
        catch (e) {
            return `Arbitration error: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
}
const defaultClient = new WhiteMagicClient();
/**
 * ElizaOS Context Provider — automatically feeds relevant memory into character prompt context
 */
export const whitemagicMemoryProvider = {
    async get(runtime, message) {
        if (!message.content.text || message.content.text.length < 5)
            return "";
        const result = await defaultClient.recall(message.content.text, runtime.character.name);
        if (!result || result.startsWith("No relevant") || result.startsWith("Memory recall error")) {
            return "";
        }
        return `\n[WhiteMagic Persistent Memory Context]:\n${result}\n`;
    },
};
/**
 * ElizaOS Action: RECALL_MEMORY
 */
export const recallMemoryAction = {
    name: "RECALL_MEMORY",
    similes: ["RECALL", "REMEMBER", "CHECK_MEMORY", "SEARCH_MEMORY"],
    description: "Search persistent cross-session memory and knowledge packs hosted on WhiteMagic.",
    validate: async (_runtime, message) => {
        const text = message.content.text.toLowerCase();
        return text.includes("recall") || text.includes("remember") || text.includes("memory");
    },
    handler: async (runtime, message, _state, _options, callback) => {
        const text = message.content.text.replace(/recall|remember|memory/gi, "").trim();
        const query = text || message.content.text;
        const memory = await defaultClient.recall(query, runtime.character.name);
        if (callback) {
            callback({ text: `Retrieved from WhiteMagic memory:\n${memory}` });
        }
        return true;
    },
    examples: [
        [
            { user: "{{user1}}", content: { text: "Can you recall what we discussed about WhiteMagic architecture?" } },
            { user: "{{agentName}}", content: { text: "Checking memory... Here is what was recorded previously." } },
        ],
    ],
};
/**
 * ElizaOS Action: ARBITRATE_MUTEX
 */
export const arbitrateMutexAction = {
    name: "ARBITRATE_MUTEX",
    similes: ["LOCK_RESOURCE", "SOLVE_CONTENTION", "ARBITRATE_LOCK"],
    description: "Compete for and acquire an exclusive shared resource lock via Cho-Han provably fair dice arbitration.",
    validate: async (_runtime, message) => {
        const text = message.content.text.toLowerCase();
        return text.includes("lock") || text.includes("mutex") || text.includes("arbitrate");
    },
    handler: async (runtime, message, _state, _options, callback) => {
        const outcome = await defaultClient.arbitrateLock("lock:shared_state", [
            runtime.character.name,
            "peer_agent",
        ]);
        if (callback) {
            callback({ text: `[Cho-Han Arbitration] ${outcome}` });
        }
        return true;
    },
    examples: [
        [
            { user: "{{user1}}", content: { text: "Lock the global knowledge graph before writing." } },
            { user: "{{agentName}}", content: { text: "Arbitrating lock contention via WhiteMagic Cho-Han..." } },
        ],
    ],
};
/**
 * Default Plugin Export
 */
export const whiteMagicPlugin = {
    name: "whitemagic",
    description: "WhiteMagic persistent cross-session memory, nano-credit advances, and Cho-Han swarm locking for ElizaOS.",
    providers: [whitemagicMemoryProvider],
    actions: [recallMemoryAction, arbitrateMutexAction],
    evaluators: [],
};
export default whiteMagicPlugin;
