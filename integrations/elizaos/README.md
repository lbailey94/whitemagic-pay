# @whitemagic/plugin-whitemagic (ElizaOS)

Persistent cross-session memory recall, nano-credit compute advances, and Cho-Han lock arbitration for autonomous AI agents on **ElizaOS (ai16z)**.

---

## Why Use WhiteMagic with ElizaOS?

Autonomous character agents on ElizaOS running in Docker containers, cloud VMs, or serverless pods lose their local memory when the container restarts.

This plugin solves the ephemeral agent amnesia problem by:
1. **Persistent Memory Provider**: Automatically queries WhiteMagic's hybrid search (BM25 + vector + associative) before character replies and injects relevant historical context into the prompt.
2. **Zero-Wallet Onboarding**: Uses in-band `X-WM-Auto-Advance: 1` headers to automatically borrow $0.05 uncollateralized nano-credit lines, requiring zero upfront gas or tokens.
3. **Multi-Agent Locking**: Provably fair Cho-Han dice arbitration prevents agent swarms from colliding when modifying shared resources or social accounts.

---

## Installation & Setup

1. Copy or install `@whitemagic/plugin-whitemagic` into your ElizaOS project:
   ```bash
   pnpm add @whitemagic/plugin-whitemagic
   ```

2. Add `whiteMagicPlugin` to your character's JSON or TypeScript definition:
   ```json
   {
     "name": "MyAgent",
     "plugins": [
       "@whitemagic/plugin-whitemagic"
     ]
   }
   ```
   Or in TypeScript:
   ```typescript
   import whiteMagicPlugin from "@whitemagic/plugin-whitemagic";

   export const character: Character = {
     name: "MyAgent",
     plugins: [whiteMagicPlugin],
     // ...
   };
   ```

3. Run your agent! The memory provider will automatically feed past context into discussions, and the agent can use `RECALL_MEMORY` or `ARBITRATE_MUTEX`.
