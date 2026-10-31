# WhiteMagic Action Provider for Coinbase AgentKit

Zero-friction persistent memory recall, nano-credit compute advances, and Cho-Han lock arbitration for autonomous AI agents built on **Coinbase AgentKit**.

---

## Capabilities

1. **Persistent Memory Recall (`recall_memory`)**:
   - Gives your AgentKit agent cross-session memory recall over `https://mcp.whitemagic.dev`.
   - Supports in-band `X-WM-Auto-Advance: 1` so agents without initial funds can immediately recall knowledge.
2. **Uncollateralized Nano-Credit (`acquire_advance`)**:
   - Zero-friction compute advances ($0.05–$5.00) issued in-band without credit card or human KYC.
3. **EIP-3009 Gasless Settlement (`settle_advance`)**:
   - Repay advances seamlessly using the agent's native EVM wallet on Base USDC (`0x8335...2913`).
4. **Cho-Han Mutex Arbitration (`arbitrate_mutex`)**:
   - Multi-agent swarm lock contention arbitration with SHA-256 provable fairness and zero deadlocks.

---

## Quickstart (TypeScript)

```typescript
import { AgentKit, ViemWalletProvider } from "@coinbase/agentkit";
import { WhiteMagicActionProvider } from "./action_provider.js";

// 1. Initialize Wallet Provider (Base Mainnet)
const wallet = new ViemWalletProvider(...);

// 2. Initialize WhiteMagic Action Provider
const whitemagic = new WhiteMagicActionProvider({
  baseUrl: "https://mcp.whitemagic.dev",
  autoAdvance: true, // Auto-grants uncollateralized compute advance if unkeyed
});

// 3. Register Action Provider with AgentKit
const agentKit = await AgentKit.from({
  walletProvider: wallet,
  actionProviders: [whitemagic],
});

// 4. Run your Agent
// Agent can now autonomously invoke `recall_memory`, `acquire_advance`, or `arbitrate_mutex`!
```

---

## Quickstart (Python)

```python
from coinbase_agentkit import AgentKit
from whitemagic_pay.integrations.agentkit.action_provider import WhiteMagicActionProvider

# 1. Initialize Action Provider
whitemagic = WhiteMagicActionProvider(auto_advance=True)

# 2. Register with AgentKit
agent_kit = AgentKit(action_providers=[whitemagic])
```
