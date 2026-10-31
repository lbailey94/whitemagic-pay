"""WhiteMagic Action Provider for Coinbase AgentKit (Python).

Exposes WhiteMagic autonomous capabilities to Python AgentKit agents:
1. recall_memory — persistent semantic search over curated agent memory.
2. acquire_advance — instant uncollateralized $0.05 compute advance with Bayesian credit scaling.
3. settle_advance — on-chain Base USDC EIP-3009 gasless settlement.
4. arbitrate_mutex — provably fair Cho-Han lock arbitration for multi-agent swarm contention.
"""

from typing import Any, Dict, List, Optional
import json
import urllib.request
import urllib.error

try:
    from pydantic import BaseModel, Field
    from coinbase_agentkit import ActionProvider, WalletProvider, create_action
    AGENTKIT_INSTALLED = True
except ImportError:
    AGENTKIT_INSTALLED = False
    # Fallback base class if running without full agentkit runtime
    class ActionProvider:
        def __init__(self, name: str):
            self.name = name

    class WalletProvider:
        pass

    def create_action(name: str, description: str, schema: Any = None):
        def decorator(func):
            func._action_name = name
            func._action_description = description
            func._action_schema = schema
            return func
        return decorator


class WhiteMagicActionProvider(ActionProvider):
    """Coinbase AgentKit Action Provider for WhiteMagic Memory & Autonomous Rails."""

    def __init__(self, base_url: str = "https://mcp.whitemagic.dev", auto_advance: bool = True):
        super().__init__("whitemagic")
        self.base_url = base_url.rstrip("/")
        self.auto_advance = auto_advance
        self._cached_pass: Optional[str] = None

    def supports_network(self, network: Any) -> bool:
        # Base Mainnet (8453), Arbitrum One (42161), Polygon (137)
        chain_id = getattr(network, "chain_id", getattr(network, "chainId", None))
        return chain_id in (8453, 42161, 137)

    @create_action(
        name="recall_memory",
        description="Search WhiteMagic hosted memory for cross-session continuity and persistent knowledge.",
    )
    def recall_memory(self, wallet_provider: Any, arguments: Dict[str, Any]) -> str:
        query = arguments.get("query", "")
        limit = arguments.get("limit", 5)
        address = getattr(wallet_provider, "get_address", lambda: "agent")()

        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "memory.search",
                "arguments": {"query": query, "limit": limit},
            },
        }

        headers = {
            "Content-Type": "application/json",
            "X-Agent-ID": address,
            "X-Lease-Tier": arguments.get("tier", "call"),
        }
        if self.auto_advance:
            headers["X-WM-Auto-Advance"] = "1"
        if self._cached_pass:
            headers["Authorization"] = f"Bearer {self._cached_pass}"

        req = urllib.request.Request(
            f"{self.base_url}/mcp",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                res = json.loads(r.read())
                # Cache session pass if returned in headers
                auth_pass = r.headers.get("X-Session-Pass") or r.headers.get("Authorization")
                if auth_pass and "Bearer " in auth_pass:
                    self._cached_pass = auth_pass.split("Bearer ")[-1].strip()
                content = res.get("result", {}).get("content", [{}])[0].get("text", "")
                return content or json.dumps(res)
        except urllib.error.HTTPError as e:
            if e.code == 402:
                return f"[WhiteMagic] 402 Payment Required: Wallet {address} requires an x402 lease or nano-advance."
            return f"[WhiteMagic] Memory recall error {e.code}: {e.read().decode(errors='replace')}"
        except Exception as e:
            return f"[WhiteMagic] Memory recall error: {str(e)}"

    @create_action(
        name="acquire_advance",
        description="Acquire an uncollateralized compute nano-advance ($0.05 - $5.00) from WhiteMagic bank.",
    )
    def acquire_advance(self, wallet_provider: Any, arguments: Dict[str, Any]) -> str:
        amount = arguments.get("amount", 0.05)
        address = getattr(wallet_provider, "get_address", lambda: "agent")()

        body = {
            "agent_id": address,
            "amount": amount,
            "request_key": True,
        }
        req = urllib.request.Request(
            f"{self.base_url}/lease/advance",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read())
                if data.get("status") == "granted":
                    self._cached_pass = data.get("session_pass")
                    return (
                        f"[WhiteMagic] Advance granted: ${data.get('amount')} USD. "
                        f"Lease pass: {self._cached_pass} (Expires in {data.get('expires_in')}s). "
                        f"Credit limit: ${data.get('credit_limit')}."
                    )
                return f"[WhiteMagic] Advance response: {json.dumps(data)}"
        except Exception as e:
            return f"[WhiteMagic] Failed to acquire advance: {str(e)}"

    @create_action(
        name="arbitrate_mutex",
        description="Resolve multi-agent lock contention fairly via Cho-Han provable dice arbitration.",
    )
    def arbitrate_mutex(self, wallet_provider: Any, arguments: Dict[str, Any]) -> str:
        resource_id = arguments.get("resource", "lock:default")
        caller = getattr(wallet_provider, "get_address", lambda: "agent")()
        contenders = arguments.get("contenders", [caller])
        if caller not in contenders:
            contenders.insert(0, caller)

        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "economy_chohan_arbitrate",
                "arguments": {
                    "resource_id": resource_id,
                    "contenders": contenders,
                    "stake": arguments.get("stake", 0.01),
                },
            },
        }

        headers = {"Content-Type": "application/json"}
        if self._cached_pass:
            headers["Authorization"] = f"Bearer {self._cached_pass}"

        req = urllib.request.Request(
            f"{self.base_url}/mcp",
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                res = json.loads(r.read())
                return res.get("result", {}).get("content", [{}])[0].get("text", "") or json.dumps(res)
        except Exception as e:
            return f"[WhiteMagic] Mutex arbitration failed: {str(e)}"
