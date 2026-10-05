# whitemagic-pay (TypeScript)

Autonomous machine payment client, session lease caching, and cryptographic
Proof-of-Context notarization for AI agents. A drop-in `fetch` wrapper that
negotiates HTTP 402 challenges, signs EIP-3009 gasless permits on Base, caches
session leases, and retries — no API key, no account.

- Zero mandatory dependencies (global `fetch`); optional [`viem`](https://viem.sh) enables the paid signing path.
- Session pass caching: one payment covers every call until the lease expires.
- Faucet support: ephemeral agents can claim a free 10-minute pass with no wallet.
- Works in Node.js 18+, Bun, Deno, and browsers (paid signing requires a key-capable runtime).

## Install

```bash
npm install whitemagic-pay
# optional, for the paid path:
npm install viem
```

## Quickstart

### 1. Free onboarding (no wallet, no API key)

```ts
import { X402Client } from "whitemagic-pay";

const client = new X402Client();
const faucet = await client.claimFaucet("https://mcp.whitemagic.dev");
console.log("session pass acquired:", client.pass.tier);

const { status, data } = await client.request(
  "POST",
  "https://mcp.whitemagic.dev/mcp",
  {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "memory.search", arguments: { query: "context continuity" } },
  },
);
console.log(status, data);
```

### 2. Autonomous multi-tier micro-leases (x402 on Base)

```ts
import { X402Client } from "whitemagic-pay";

const client = new X402Client({
  privateKey: process.env.AGENT_WALLET_KEY as `0x${string}`,
  preferredTier: "task",
});

// Negotiates the 402 challenge, signs EIP-3009, settles on Base, caches the
// lease, and retries the call in one step.
const { status, data } = await client.request("POST", "https://mcp.whitemagic.dev/mcp", { /* ... */ });
```

Or wrap `fetch` directly:

```ts
const res = await client.fetch("https://mcp.whitemagic.dev/mcp", {
  method: "POST",
  body: JSON.stringify({ /* ... */ }),
});
```

### Tier menu

| Tier | Price (USDC) | Atomic units | Duration | Best for |
| :--- | :--- | :--- | :--- | :--- |
| `call` | $0.002 | 2,000 | 60 s | Single tool call, health probe |
| `task` | $0.010 | 10,000 | 300 s | Standard multi-step task |
| `swarm` | $0.050 | 50,000 | 900 s | Multi-agent coordination |
| `day` | $0.500 | 500,000 | 86,400 s | Continuous production worker |

### 3. Proof-of-Context notarization

```ts
const receipt = await client.notarizeContext({
  contextDigest: "sha256:b10b001a...",
  action: "agent.decision",
  model: "gemini-2.5-flash",
  metadata: { epoch: 1 },
});
```

## API

- `new X402Client({ privateKey?, preferredTier?, autoLease? })`
- `client.claimFaucet(baseUrl?)` — claim a free 10-minute trial pass.
- `client.request(method, url, data?, headers?, timeoutMs?)` — full negotiation + pass reuse.
- `client.fetch(input, init?)` — `fetch`-compatible wrapper.
- `client.notarizeContext(input, baseUrl?)` — signed Proof-of-Context notarization.
- `client.isPassActive()` / `client.pass` — lease state.
- `client.address()` — payer address (async; resolves after signer load).

## Links

- Hosted lanes and x402 quickstart: https://www.whitemagic.dev/hosted
- Receipt spec and verifiers: https://www.whitemagic.dev/receipts
- Python package: https://pypi.org/project/whitemagic-pay/

MIT — WhiteMagic Labs.
