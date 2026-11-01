# whitemagic-pay

Autonomous x402 payment client, session lease caching, and cryptographic
Proof-of-Context notarization for AI agents. No API key, no account: a client
that negotiates HTTP 402 challenges, signs EIP-3009 gasless permits on Base,
caches session leases, and retries.

WhiteMagic's hosted lanes meter with x402 (USDC on Base). This repository
holds the two client packages agents use to pay and to notarize context:

| Package | Registry | Source |
| :--- | :--- | :--- |
| `whitemagic-pay` (Python) | [PyPI](https://pypi.org/project/whitemagic-pay/) | [`python/`](python/) |
| `whitemagic-pay` (TypeScript) | [npm](https://www.npmjs.com/package/whitemagic-pay) | [`typescript/`](typescript/) |

## Tiers (Base, Arbitrum One & Polygon PoS)

| Tier | Price (USDC) | Atomic units | Duration | Best for |
| :--- | :--- | :--- | :--- | :--- |
| `call` | $0.001 | 1,000 | 60 s | Single tool call, health probe, micro-tolling |
| `task` | $0.010 | 10,000 | 300 s | Standard multi-step task |
| `swarm` | $0.050 | 50,000 | 900 s | Multi-agent coordination |
| `day` | $0.500 | 500,000 | 86,400 s | Continuous production worker |

Supported x402 settlement networks: **Base (`eip155:8453`)**, **Arbitrum One (`eip155:42161`)**, and **Polygon PoS (`eip155:137`)**. Cold-start agents without a wallet can also pass `auto_advance=True` (`X-WM-Auto-Advance: 1`) for an instant $0.05 compute advance or claim a 10-minute trial pass from `/faucet`.

## Quickstarts

Python:

```bash
pip install whitemagic-pay
```

```python
from whitemagic_pay import X402Client

client = X402Client(private_key="0x...", preferred_tier="task")
status, data, headers = client.request("POST", "https://mcp.whitemagic.dev/mcp", data={...})
```

TypeScript:

```bash
npm install whitemagic-pay
```

```ts
import { X402Client } from "whitemagic-pay";

const client = new X402Client({ privateKey: process.env.AGENT_WALLET_KEY as `0x${string}` });
const { status, data } = await client.request("POST", "https://mcp.whitemagic.dev/mcp", { ... });
```

Both clients also support `notarize_context` / `notarizeContext` for
Proof-of-Context receipts (timestamped, signed attestations binding an agent's
prompt digest, recalled context, model, and action).

## Framework Integrations

Native plug-and-play packages for leading autonomous agent frameworks with zero-friction uncollateralized compute advances (`X-WM-Auto-Advance: 1`) and EIP-3009 gasless settlement:

| Integration | Framework | Features | Location |
| :--- | :--- | :--- | :--- |
| **`@whitemagic/agentkit-action-whitemagic`** | [Coinbase AgentKit](https://github.com/coinbase/agentkit) | TypeScript & Python action providers for `recall_memory`, `acquire_advance`, and `arbitrate_mutex` | [`integrations/agentkit/`](integrations/agentkit/) |
| **`@whitemagic/plugin-whitemagic`** | [ElizaOS (ai16z)](https://github.com/elizaos/eliza) | Automatic cross-session context memory provider & Cho-Han swarm locking | [`integrations/elizaos/`](integrations/elizaos/) |

### Coinbase AgentKit Example
```typescript
import { AgentKit, ViemWalletProvider } from "@coinbase/agentkit";
import { WhiteMagicActionProvider } from "@whitemagic/agentkit-action-whitemagic";

const whitemagic = new WhiteMagicActionProvider({ autoAdvance: true });
const agentKit = await AgentKit.from({
  walletProvider: wallet,
  actionProviders: [whitemagic],
});
```

### Proof-of-Context Notarization (Agent Audit Trail)
Certify what your agent knew and evaluated before executing high-stakes actions:
```python
attestation = client.notarize_context(
    prompt_digest="sha256:...",
    memory_digest="sha256:...",
    model="gpt-4o",
    action_digest="sha256:...",
)
# Returns an RFC 8785 Ed25519 canonical receipt verifiable at api.whitemagic.dev/verify
```

## Links

- Hosted lanes and x402 quickstart: https://www.whitemagic.dev/hosted
- Receipt spec and verifiers: https://www.whitemagic.dev/receipts
- WhiteMagic core: https://github.com/lbailey94/whitemagic

MIT — WhiteMagic Labs.
