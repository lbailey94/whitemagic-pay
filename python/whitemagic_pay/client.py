"""whitemagic_pay.client — autonomous x402 payment client & middleware.

Enables AI agents to automatically negotiate HTTP 402 Payment Required challenges,
sign EIP-3009 gasless transfer authorizations, cache session pass leases, and extract receipts.
"""

from __future__ import annotations

import base64
import json
import secrets
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, Tuple, Union

try:
    from eth_account import Account
    from eth_account.messages import encode_typed_data
    ETH_ACCOUNT_AVAILABLE = True
except ImportError:
    ETH_ACCOUNT_AVAILABLE = False


CHAIN_MAP = {
    "eip155:8453": 8453,        # Base Mainnet
    "eip155:84532": 84532,      # Base Sepolia Testnet
    "eip155:1": 1,              # Ethereum Mainnet
}

EIP3009_TYPES = {
    "TransferWithAuthorization": [
        {"name": "from", "type": "address"},
        {"name": "to", "type": "address"},
        {"name": "value", "type": "uint256"},
        {"name": "validAfter", "type": "uint256"},
        {"name": "validBefore", "type": "uint256"},
        {"name": "nonce", "type": "bytes32"},
    ]
}


class X402Client:
    """Autonomous x402 payment client with session lease caching."""

    def __init__(
        self,
        private_key: Optional[str] = None,
        preferred_tier: str = "task",  # "call" ($0.002), "task" ($0.01), "swarm" ($0.05), "day" ($0.50)
        auto_lease: bool = True,
    ):
        self.account = None
        if private_key:
            if not ETH_ACCOUNT_AVAILABLE:
                raise ImportError(
                    "eth_account is required for x402 signing. Install via: pip install eth-account"
                )
            self.account = Account.from_key(private_key)
        self.preferred_tier = preferred_tier
        self.auto_lease = auto_lease
        self.cached_pass: Optional[str] = None
        self.pass_expires_at: float = 0.0
        self.pass_tier: str = ""

    @property
    def address(self) -> Optional[str]:
        return self.account.address if self.account else None

    def is_pass_active(self) -> bool:
        return bool(self.cached_pass and time.time() < (self.pass_expires_at - 5))

    def create_payment_payload(
        self,
        challenge: Dict[str, Any],
        tier: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], str]:
        """Generate a signed EIP-3009 payment payload based on an x402 challenge."""
        if not self.account:
            raise ValueError("No private key provided to X402Client to sign payment challenge.")

        accepts = challenge.get("accepts", [])
        if not accepts:
            raise ValueError("Challenge contains no 'accepts' requirements.")

        chosen_tier = tier or self.preferred_tier
        # Tier pricing mapping in atomic units (USDC has 6 decimals)
        tier_price_map = {
            "call": 2000,       # $0.002
            "task": 10000,      # $0.010
            "swarm": 50000,     # $0.050
            "day": 500000,      # $0.500
        }
        target_amount = tier_price_map.get(chosen_tier)

        req = None
        if target_amount is not None:
            for cand in accepts:
                if int(cand.get("amount", 0)) == target_amount:
                    req = cand
                    break

        if req is None:
            # Fallback to lowest acceptable amount
            req = min(accepts, key=lambda a: int(a.get("amount", 999999999)))

        network = req.get("network", "eip155:8453")
        chain_id = CHAIN_MAP.get(network)
        if chain_id is None:
            raise ValueError(f"Unsupported network rail: {network}")

        extra = req.get("extra") or {}
        now = int(time.time())
        auth = {
            "from": self.account.address,
            "to": req["payTo"],
            "value": int(req["amount"]),
            "validAfter": now - 60,
            "validBefore": now + 600,
            "nonce": "0x" + secrets.token_hex(32),
        }
        domain = {
            "name": extra.get("name") or "USD Coin",
            "version": str(extra.get("version") or "2"),
            "chainId": chain_id,
            "verifyingContract": req["asset"],
        }
        msg = encode_typed_data(
            full_message={
                "types": EIP3009_TYPES,
                "primaryType": "TransferWithAuthorization",
                "domain": domain,
                "message": auth,
            }
        )
        sig = self.account.sign_message(msg).signature.hex()
        if not sig.startswith("0x"):
            sig = "0x" + sig

        payload_auth = {
            k: (str(v) if k in ("value", "validAfter", "validBefore") else v)
            for k, v in auth.items()
        }
        payment = {
            "x402Version": challenge.get("x402Version", 2),
            "resource": challenge.get("resource"),
            "accepted": req,
            "payload": {
                "signature": sig,
                "authorization": payload_auth,
            },
            "extensions": challenge.get("extensions") or {},
        }
        header_val = base64.b64encode(json.dumps(payment).encode()).decode()
        return payment, header_val

    def request(
        self,
        method: str,
        url: str,
        data: Optional[Union[bytes, str, Dict[str, Any]]] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: float = 30.0,
    ) -> Tuple[int, Dict[str, Any], Dict[str, str]]:
        """Execute request with automatic 402 challenge handling and session pass reuse."""
        req_headers = dict(headers or {})
        if "Content-Type" not in req_headers:
            req_headers["Content-Type"] = "application/json"

        # Attach active cached session pass if available
        if self.is_pass_active():
            req_headers["Authorization"] = f"Bearer {self.cached_pass}"
            req_headers["X-Session-Pass"] = self.cached_pass

        body_bytes = None
        if data is not None:
            if isinstance(data, (dict, list)):
                body_bytes = json.dumps(data).encode("utf-8")
            elif isinstance(data, str):
                body_bytes = data.encode("utf-8")
            else:
                body_bytes = data

        req = urllib.request.Request(url, data=body_bytes, headers=req_headers, method=method)

        status = 0
        resp_data = {}
        resp_headers = {}

        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                status = r.status
                raw = r.read()
                resp_headers = {k: v for k, v in r.headers.items()}
                try:
                    resp_data = json.loads(raw)
                except Exception:
                    resp_data = {"raw": raw.decode(errors="replace")}
        except urllib.error.HTTPError as e:
            status = e.code
            raw = e.read()
            resp_headers = {k: v for k, v in e.headers.items()}
            try:
                resp_data = json.loads(raw)
            except Exception:
                resp_data = {"raw": raw.decode(errors="replace")}

        # Check if 402 challenge occurred and we have signing capability
        if status == 402 and self.account is not None:
            challenge = resp_data
            # Look for base64 PAYMENT-REQUIRED header if body didn't parse as challenge
            if "accepts" not in challenge and "PAYMENT-REQUIRED" in resp_headers:
                try:
                    challenge = json.loads(base64.b64decode(resp_headers["PAYMENT-REQUIRED"]))
                except Exception:
                    pass

            if "accepts" in challenge:
                _, sig_header = self.create_payment_payload(challenge)
                retry_headers = dict(req_headers)
                retry_headers["PAYMENT-SIGNATURE"] = sig_header
                retry_headers["X-Lease-Tier"] = self.preferred_tier

                retry_req = urllib.request.Request(url, data=body_bytes, headers=retry_headers, method=method)
                try:
                    with urllib.request.urlopen(retry_req, timeout=timeout) as r:
                        status = r.status
                        raw = r.read()
                        resp_headers = {k: v for k, v in r.headers.items()}
                        try:
                            resp_data = json.loads(raw)
                        except Exception:
                            resp_data = {"raw": raw.decode(errors="replace")}
                except urllib.error.HTTPError as e:
                    status = e.code
                    raw = e.read()
                    resp_headers = {k: v for k, v in e.headers.items()}
                    try:
                        resp_data = json.loads(raw)
                    except Exception:
                        resp_data = {"raw": raw.decode(errors="replace")}

        # Extract and cache session pass if returned
        session_pass = resp_headers.get("X-Session-Pass")
        expires_in = resp_headers.get("X-Session-Expires-In")
        tier = resp_headers.get("X-Session-Tier")
        if session_pass and expires_in:
            try:
                exp_secs = int(expires_in)
                self.cached_pass = session_pass
                self.pass_expires_at = time.time() + exp_secs
                self.pass_tier = tier or self.preferred_tier
            except (ValueError, TypeError):
                pass

        return status, resp_data, resp_headers

    def claim_faucet(self, base_url: str = "https://mcp.whitemagic.dev") -> Dict[str, Any]:
        """Claim a 10-minute trial session pass from the faucet."""
        url = base_url.rstrip("/") + "/faucet"
        body = json.dumps({"payer": self.address or "agent"}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": "whitemagic_pay/0.1"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
            pass_token = data.get("session_pass")
            expires_in = data.get("expires_in", 600)
            if pass_token:
                self.cached_pass = pass_token
                self.pass_expires_at = time.time() + int(expires_in)
                self.pass_tier = "faucet"
            return data

    def notarize_context(
        self,
        base_url: str = "https://api.whitemagic.dev",
        context_digest: Optional[str] = None,
        prompt_hash: Optional[str] = None,
        action: Optional[str] = None,
        model: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Request cryptographic Proof-of-Context notarization from WhiteMagic."""
        payload: Dict[str, Any] = {}
        if context_digest:
            payload["context_digest"] = context_digest
        if prompt_hash:
            payload["prompt_hash"] = prompt_hash
        if action:
            payload["action"] = action
        if model:
            payload["model"] = model
        if metadata:
            payload["metadata"] = metadata
        if self.address:
            payload["agent_id"] = self.address

        url = base_url.rstrip("/") + "/notarize"
        status, data, _ = self.request("POST", url, data=payload)
        if status != 200:
            raise RuntimeError(f"Notarization failed with status {status}: {data}")
        return data


def wrap_session(session: Any, private_key: Optional[str] = None, tier: str = "task"):
    """Wrap a requests or httpx Session with automatic x402 payment hooks."""
    client = X402Client(private_key=private_key, preferred_tier=tier)

    def hook(response, *args, **kwargs):
        if response.status_code == 402 and client.account:
            try:
                challenge = response.json()
            except Exception:
                hdr = response.headers.get("PAYMENT-REQUIRED")
                if hdr:
                    challenge = json.loads(base64.b64decode(hdr))
                else:
                    return response

            if "accepts" in challenge:
                _, sig_header = client.create_payment_payload(challenge)
                req = response.request.copy()
                req.headers["PAYMENT-SIGNATURE"] = sig_header
                req.headers["X-Lease-Tier"] = client.preferred_tier
                retry_resp = session.send(req)
                return retry_resp
        return response

    if hasattr(session, "hooks"):
        session.hooks.setdefault("response", []).append(hook)
    return session
