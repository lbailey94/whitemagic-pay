# whitemagic-pay

Python and TypeScript x402 transport clients with caller-owned signing authority and
origin-scoped opaque session leases. **0.2.0 is published on PyPI and npm**; earlier
registry versions do not contain these spending-policy and credential-scope fixes.

A 402 offer does not authorize a spend. No offer is signed without an explicit
origin/rail/asset/payee/domain grant, exact allowed amount and remaining authorization
budget. Preferred tier/network select among authorized offers; they never widen a grant.

## Policy-governed requests

Install `whitemagic-pay==0.2.0` from PyPI or `whitemagic-pay@0.2.0` from npm in an isolated environment. Paid
Python signing additionally needs `eth-account`; TypeScript uses optional `viem`.
Use your own independently confirmed origin, token contract and recipient below.
The example addresses are placeholders; they are not WhiteMagic payment instructions.

```python
import os
from whitemagic_pay import SpendGrant, X402Client

grant = SpendGrant(
    origin="https://issuer.example", network="eip155:8453",
    asset="0x1111111111111111111111111111111111111111",
    pay_to="0x2222222222222222222222222222222222222222",
    allowed_amounts=("10000",), max_total_amount="20000",
)
client = X402Client(private_key=os.environ["AGENT_WALLET_KEY"],
                    preferred_tier="task", preferred_network="eip155:8453",
                    spend_grants=[grant])
# Explicit action, potentially authorizing funds; run only against your chosen service.
# status, data, headers = client.request("POST", "https://issuer.example/mcp", data=payload)
```

```typescript
import { X402Client } from "whitemagic-pay";
const client = new X402Client({
  privateKey: process.env.AGENT_WALLET_KEY,
  preferredTier: "task", preferredNetwork: "eip155:8453",
  spendGrants: [{
    origin: "https://issuer.example", network: "eip155:8453",
    asset: "0x1111111111111111111111111111111111111111",
    payTo: "0x2222222222222222222222222222222222222222",
    allowedAmounts: ["10000"], maxTotalAmount: "20000",
  }],
});
// await client.request("POST", "https://issuer.example/mcp", payload);
```

Atomic values must be positive uint256 integers. Decimal strings preserve exact values;
TypeScript rejects unsafe numeric inputs and signs bigint fields. The selected tier
must match a known atomic amount (`call`: 1000 or legacy 2000, `task`: 10000,
`swarm`: 50000, `day`: 500000). Prices/durations at a particular service must be
confirmed separately; these constants are selectors, not a live rate-card guarantee.

`max_total_amount` / `maxTotalAmount` counts authorizations reserved in this client
instance, including ambiguous signer failures. It is **not a persistent wallet,
settlement, per-day, or multi-process budget**. An operator that needs those limits
must enforce them in wallet custody/persistent storage. Recreating a client resets it.
There is no generic cheapest-offer fallback and no implicit network/recipient trust.

## Lease, redirect and retry contract

- Tokens are kept in memory by exact issuing origin (scheme, host and port), with
  the supplied positive expiry capped at one day. A token for MCP is not forwarded
  to an API host or another agent's client. No cross-origin audience is inferred.
- Caller authorization/payment headers take precedence and suppress SDK paid retry.
- Redirects are returned without following them, including after payment signing.
  Explicitly choose a new destination and grant rather than forwarding secrets.
- At most one automatic retry follows a valid 402; the request body is preserved.
  No retry occurs after transport failure, 5xx or an ambiguous paid response. Host
  applications need their own operation idempotency contract; HTTP 200 alone does
  not establish RPC success or payment settlement.
- `auto_lease=False` / `autoLease:false` disables automatic 402 signing, pass
  caching/reuse and auto-advance headers. Explicit signing remains policy-governed.
- `auto_advance=True` / `autoAdvance:true` is an explicit opt-in to a service's advance
  mechanism. It is false by default; availability and borrowing terms are not
  established by this library. Faucet/advance calls change service state.
- HTTPS is required except for explicit localhost/loopback test URLs. Challenge
  resource URL, including path/query, must equal the requested URL.

`session_status(url)` / `sessionStatus(url)` returns metadata, never the bearer.
An explicitly acquired token can be adopted with `adopt_session_pass` /
`adoptSessionPass`, its issuing URL and actual expiry. Do not print tokens into an
agent/tool transcript. The CLI reads keys/tokens from named environment variables
and redacts credential fields. `wrap_session` is a limited requests-style hook;
it is not an httpx adapter and does not cache leases.

## Notarization

```python
# attestation = client.notarize_context(
#     base_url="https://api.whitemagic.dev",
#     context_digest="sha256:...", prompt_hash="sha256:...",
#     action="agent.action", model="chosen-model", metadata={"run": "example"},
# )
```

TypeScript uses `notarizeContext({contextDigest, promptHash, action, model, metadata})`.
A signed attestation binds the stated bytes; it does not certify the model's actual
knowledge, the truth of the source or execution of an action.

## Framework examples

`integrations/agentkit` and `integrations/elizaos` are **framework-neutral/structural
examples**, not qualified plug-and-play integrations. They reuse the client, keep
sessions per wallet/runtime, redact acquired tokens and recognize RPC/tool errors.
Direct wallet settlement is disabled and arbitration is zero-stake only.

A real Coinbase adapter needs the framework's `ActionProvider` and action registration
API; an Eliza adapter must implement a pinned `@elizaos/core` contract. Neither full
framework registration nor a hosted journey is claimed by these example tests.
See [AgentKit's official provider guide](https://github.com/coinbase/agentkit/blob/main/typescript/agentkit/README.md)
and [Eliza's plugin guide](https://eliza.how/core-concepts/plugins) before implementing
that separate compatibility gate. No wallet key or paid flow is needed to run tests.

## Offline verification

```bash
PYTHONPATH=python python3 -m unittest discover -s python/tests -v
npm ci --ignore-scripts --prefix typescript
npm test --prefix typescript
```

Tests use fake signers/transports, cover denied grants, concurrency/budgets, caller
headers, two origins, expiry, redirect policy, exact body replay and RPC errors.
They establish those local contracts, not real settlement or framework deployment.

MIT — WhiteMagic Labs.
