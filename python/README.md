# whitemagic-pay

Autonomous machine payment client, session lease caching, and cryptographic Proof-of-Context notarization for AI agents.

Zero mandatory dependencies (uses standard library `urllib`, `json`, `hmac`). Optional `eth-account` dependency enables autonomous EIP-3009 gasless permit signing on Base mainnet.

---

## Quickstart

### 1. Free Onboarding (No Wallet, No API Key)
Ephemeral agents can claim an instant 10-minute trial session pass (`10,000 RPM`) via the faucet:

```python
from whitemagic_pay import X402Client

client = X402Client()
# Dispenses a 10-minute pass (1/day per IP/address)
faucet_data = client.claim_faucet("https://mcp.whitemagic.dev")
print("Session pass acquired:", client.cached_pass)

# Subsequent calls automatically reuse the pass with zero latency
status, data, headers = client.request(
    "POST",
    "https://mcp.whitemagic.dev/mcp",
    data={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "memory.search", "arguments": {"query": "context continuity"}}}
)
```

### 2. Autonomous Multi-Tier Micro-Leases (x402 / Base)
When operating autonomously with a funded wallet, `X402Client` automatically negotiates HTTP 402 challenges, signs EIP-3009 gasless permits on Base, and caches the returned lease:

```python
client = X402Client(
    private_key="0x...",
    preferred_tier="call"  # Options: "call" ($0.002), "task" ($0.01), "swarm" ($0.05), "day" ($0.50)
)

# Negotiates 402, settles on Base, acquires session lease, and executes tool call
status, result, headers = client.request("POST", "https://mcp.whitemagic.dev/mcp", data={...})
```

#### Multi-Tier Pricing Menu
| Tier | Price (USDC) | Atomic Units | Duration | Best For |
| :--- | :--- | :--- | :--- | :--- |
| **`call`** | **$0.002** | 2,000 | 60s (1 min) | Single tool invocation, health probe, sanity check |
| **`task`** | **$0.010** | 10,000 | 300s (5 min) | Standard multi-step reasoning task |
| **`swarm`** | **$0.050** | 50,000 | 900s (15 min) | Multi-agent swarm coordination, deep research |
| **`day`** | **$0.500** | 500,000 | 86,400s (24h) | Continuous production agent worker |

### 3. Cryptographic Proof-of-Context Notarization
Attest to an agent's reasoning trace, prompt, and action at a tamper-proof UTC timestamp signed with Ed25519:

```python
receipt = client.notarize_context(
    base_url="https://api.whitemagic.dev",
    context_digest="sha256:b10b001a2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7",
    action="agent.decision",
    model="gemini-2.5-flash",
    metadata={"epoch": 1, "converged": True}
)

print("Notarized digest:", receipt["digest"])
print("Lookup URL:", receipt["lookup_url"])
```

Anyone can verify the attestation completely offline using the issuer's public key (`did:key:...`).

---

## 🛠️ CLI Usage

```bash
# Claim trial session pass
python -m whitemagic_pay.cli faucet --url https://mcp.whitemagic.dev

# Notarize context
python -m whitemagic_pay.cli notarize --digest 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --action "agent.step"

# Probe live endpoint
python -m whitemagic_pay.cli probe https://mcp.whitemagic.dev/mcp --tier call --query "continuity"
```
