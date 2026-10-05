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

## Tiers

| Tier | Price (USDC) | Atomic units | Duration | Best for |
| :--- | :--- | :--- | :--- | :--- |
| `call` | $0.002 | 2,000 | 60 s | Single tool call, health probe |
| `task` | $0.010 | 10,000 | 300 s | Standard multi-step task |
| `swarm` | $0.050 | 50,000 | 900 s | Multi-agent coordination |
| `day` | $0.500 | 500,000 | 86,400 s | Continuous production worker |

A free 10-minute trial pass is available from the faucet with no wallet; the
libraries claim it with one call and reuse the returned session pass.

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

## Links

- Hosted lanes and x402 quickstart: https://www.whitemagic.dev/hosted
- Receipt spec and verifiers: https://www.whitemagic.dev/receipts
- WhiteMagic core: https://github.com/lbailey94/whitemagic

MIT — WhiteMagic Labs.
