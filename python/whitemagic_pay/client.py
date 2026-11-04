"""Origin-scoped x402 requests with caller-owned signing grants.

Automatic negotiation retries only a 402 once. It never retries transport failures,
redirects, or ambiguous paid responses. A signature is an authorization, not settlement.
"""
from __future__ import annotations

import base64
import json
import secrets
import threading
import time
import urllib.error
import urllib.request
from typing import Any

from .policy import SpendGrant, atomic_amount, address, origin_of, resource_url

try:
    from eth_account import Account
    from eth_account.messages import encode_typed_data
    ETH_ACCOUNT_AVAILABLE = True
except ImportError:
    ETH_ACCOUNT_AVAILABLE = False

CHAIN_MAP = {"eip155:8453": 8453, "eip155:42161": 42161, "eip155:137": 137,
             "eip155:84532": 84532, "eip155:1": 1}
TIER_PRICES = {"call": (1000, 2000), "task": (10000,), "swarm": (50000,), "day": (500000,)}
EIP3009_TYPES = {"TransferWithAuthorization": [
    {"name": "from", "type": "address"}, {"name": "to", "type": "address"},
    {"name": "value", "type": "uint256"}, {"name": "validAfter", "type": "uint256"},
    {"name": "validBefore", "type": "uint256"}, {"name": "nonce", "type": "bytes32"},
]}
CREDENTIAL_HEADERS = frozenset(("authorization", "x-session-pass", "payment-signature"))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class X402Client:
    """No signing authority exists until explicit SpendGrants are supplied.

    auto_lease=False disables automatic 402 signing, session caching/reuse and
    auto-advance headers. Explicit create_payment_payload remains grant-governed.
    """

    def __init__(self, private_key=None, preferred_tier="task", preferred_network=None,
                 auto_lease=True, auto_advance=False, spend_grants=()):
        if preferred_tier not in TIER_PRICES:
            raise ValueError("unsupported tier")
        self.account = None
        if private_key:
            if not ETH_ACCOUNT_AVAILABLE:
                raise ImportError("Paid signing requires pip install whitemagic-pay[signing]")
            self.account = Account.from_key(private_key)
        self.preferred_tier = preferred_tier
        self.preferred_network = preferred_network
        self.auto_lease = bool(auto_lease)
        self.auto_advance = bool(auto_advance)
        self._grants = tuple(spend_grants)
        if not all(isinstance(g, SpendGrant) for g in self._grants):
            raise TypeError("spend_grants must contain SpendGrant instances")
        self._spent = [0] * len(self._grants)
        self._sign_lock = threading.Lock()
        self._passes = {}
        self._opener = urllib.request.build_opener(NoRedirect())

    @property
    def address(self):
        return self.account.address if self.account else None

    def is_pass_active(self, url="https://mcp.whitemagic.dev"):
        scope = origin_of(url)
        entry = self._passes.get(scope)
        if entry and time.time() < entry["expires_at"] - 5:
            return True
        self._passes.pop(scope, None)
        return False

    def session_status(self, url="https://mcp.whitemagic.dev"):
        active = self.is_pass_active(url)
        entry = self._passes.get(origin_of(url), {})
        return {"active": active, "origin": origin_of(url), "tier": entry.get("tier"),
                "expires_at": entry.get("expires_at")}

    def adopt_session_pass(self, url, token, expires_in, tier="session"):
        """Associate an explicitly acquired opaque token only with its issuing origin."""
        scope = origin_of(url)
        if not self.auto_lease:
            return
        if not isinstance(token, str) or not token or any(c in token for c in "\r\n"):
            raise ValueError("invalid session token")
        seconds = atomic_amount(expires_in)
        if seconds > 86400:
            raise ValueError("session lifetime exceeds one day")
        self._passes[scope] = {"token": token, "expires_at": time.time() + seconds, "tier": tier}

    def _select_offer(self, challenge, request_url, tier):
        if not isinstance(challenge, dict):
            raise ValueError("challenge must be an object")
        expected = resource_url(request_url)
        resource = challenge.get("resource")
        advertised = resource.get("url") if isinstance(resource, dict) else resource
        if not isinstance(advertised, str) or resource_url(advertised) != expected:
            raise ValueError("challenge resource does not match requested URL")
        if type(challenge.get("x402Version")) is not int or challenge["x402Version"] not in (1, 2):
            raise ValueError("unsupported x402 version")
        offers = challenge.get("accepts")
        if not isinstance(offers, list) or not offers:
            raise ValueError("challenge requires a nonempty accepts list")
        if tier not in TIER_PRICES:
            raise ValueError("unsupported tier")
        eligible = []
        for offer in offers:
            if not isinstance(offer, dict):
                raise ValueError("invalid offer")
            amount = atomic_amount(offer.get("amount"))
            network = offer.get("network")
            if network not in CHAIN_MAP or offer.get("scheme") != "exact":
                continue
            asset, pay_to = address(offer.get("asset")), address(offer.get("payTo"))
            extra = offer.get("extra", {})
            if not isinstance(extra, dict):
                raise ValueError("invalid token domain")
            domain_name = extra.get("name", "USD Coin")
            domain_version = extra.get("version", "2")
            if not isinstance(domain_name, str) or not isinstance(domain_version, str):
                raise ValueError("token domain must use strings")
            if self.preferred_network and network != self.preferred_network:
                continue
            if amount not in TIER_PRICES[tier]:
                continue
            for i, grant in enumerate(self._grants):
                if (grant.origin == origin_of(expected) and grant.network == network
                        and grant.asset == asset and grant.pay_to == pay_to
                        and grant.domain_name == domain_name and grant.domain_version == domain_version
                        and str(amount) in grant.allowed_amounts
                        and self._spent[i] + amount <= int(grant.max_total_amount)):
                    eligible.append((amount, i, offer))
        if not eligible:
            raise ValueError("no offer satisfies explicit spending grant, tier and remaining budget")
        return min(eligible, key=lambda item: (item[0], item[1]))

    def create_payment_payload(self, challenge, tier=None, request_url=None):
        if self.account is None:
            raise ValueError("no signing account configured")
        if request_url is None:
            raise ValueError("request_url is required for resource/origin binding")
        # Reserve before asking the signer. A failing signer may have issued an
        # authorization; its budget stays reserved conservatively.
        with self._sign_lock:
            amount, grant_index, req = self._select_offer(challenge, request_url, tier or self.preferred_tier)
            self._spent[grant_index] += amount
            now = int(time.time())
            auth = {"from": self.account.address, "to": req["payTo"], "value": amount,
                    "validAfter": now - 60, "validBefore": now + 600, "nonce": "0x" + secrets.token_hex(32)}
            extra = req.get("extra", {})
            domain = {"name": extra.get("name", "USD Coin"), "version": extra.get("version", "2"),
                      "chainId": CHAIN_MAP[req["network"]], "verifyingContract": req["asset"]}
            msg = encode_typed_data(full_message={"types": EIP3009_TYPES,
                "primaryType": "TransferWithAuthorization", "domain": domain, "message": auth})
            sig = self.account.sign_message(msg).signature.hex()
            payment = {"x402Version": challenge["x402Version"], "resource": challenge["resource"],
                       "accepted": req, "payload": {"signature": sig if sig.startswith("0x") else "0x" + sig,
                       "authorization": {k: str(v) if k in ("value", "validAfter", "validBefore") else v
                                         for k, v in auth.items()}}, "extensions": challenge.get("extensions", {})}
            return payment, base64.b64encode(json.dumps(payment).encode()).decode()

    def _raw(self, method, url, body=None, headers=None, timeout=30):
        resource_url(url)
        request = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
        try:
            response = self._opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            status = response.status
            raw = response.read()
            response_headers = {k.lower(): v for k, v in response.headers.items()}
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            data = {"raw": raw.decode(errors="replace")}
        return status, data, response_headers

    def request(self, method, url, data=None, headers=None, timeout=30):
        scope = origin_of(url)
        request_headers = {k.lower(): v for k, v in (headers or {}).items()}
        request_headers.setdefault("content-type", "application/json")
        caller_credentials = bool(CREDENTIAL_HEADERS.intersection(request_headers))
        if self.auto_lease and not caller_credentials:
            if self.is_pass_active(url):
                token = self._passes[scope]["token"]
                request_headers.update({"authorization": f"Bearer {token}", "x-session-pass": token})
            elif self.auto_advance:
                request_headers.setdefault("x-wm-auto-advance", "1")
        body = json.dumps(data).encode() if isinstance(data, (dict, list)) else data.encode() if isinstance(data, str) else data
        status, response_data, response_headers = self._raw(method, url, body, request_headers, timeout)
        if status in (401, 402, 403) and not caller_credentials:
            self._passes.pop(scope, None)
        if status == 402 and self.account is not None and self.auto_lease and not caller_credentials:
            challenge = response_data
            if not isinstance(challenge, dict) or "accepts" not in challenge:
                try:
                    challenge = json.loads(base64.b64decode(response_headers.get("payment-required", "")))
                except (ValueError, UnicodeDecodeError):
                    challenge = None
            if isinstance(challenge, dict) and "accepts" in challenge:
                _, sig = self.create_payment_payload(challenge, request_url=url)
                retry_headers = {k: v for k, v in request_headers.items() if k not in CREDENTIAL_HEADERS}
                retry_headers.update({"payment-signature": sig, "x-lease-tier": self.preferred_tier})
                status, response_data, response_headers = self._raw(method, url, body, retry_headers, timeout)
        if self.auto_lease and not caller_credentials and 200 <= status < 300:
            token, seconds = response_headers.get("x-session-pass"), response_headers.get("x-session-expires-in")
            if token and seconds:
                try:
                    self.adopt_session_pass(url, token, seconds, response_headers.get("x-session-tier", self.preferred_tier))
                except ValueError:
                    self._passes.pop(scope, None)
        return status, response_data, response_headers

    def claim_faucet(self, base_url="https://mcp.whitemagic.dev"):
        url = base_url.rstrip("/") + "/faucet"
        status, data, _ = self.request("POST", url, {"payer": self.address or "agent"})
        if status != 200:
            raise RuntimeError(f"faucet failed with HTTP {status}")
        if isinstance(data, dict) and data.get("session_pass"):
            self.adopt_session_pass(url, data["session_pass"], data.get("expires_in", 600), "faucet")
        return data

    def notarize_context(self, base_url="https://api.whitemagic.dev", context_digest=None,
                         prompt_hash=None, action=None, model=None, metadata=None):
        payload = {k: v for k, v in {"context_digest": context_digest, "prompt_hash": prompt_hash,
                   "action": action, "model": model, "metadata": metadata}.items() if v is not None}
        if self.address:
            payload["agent_id"] = self.address
        status, data, _ = self.request("POST", base_url.rstrip("/") + "/notarize", payload)
        if status != 200:
            raise RuntimeError(f"notarization failed with HTTP {status}")
        return data


def wrap_session(session: Any, private_key=None, tier="task", spend_grants=()):
    """requests-style hook, limited to one policy-governed retry without redirects.

    This is not an httpx compatibility claim. Native X402Client is the maintained
    origin-scoped lease implementation; this adapter does not cache session tokens.
    """
    if not isinstance(getattr(session, "hooks", None), dict):
        raise TypeError("wrap_session requires a requests-style hooks dictionary")
    client = X402Client(private_key=private_key, preferred_tier=tier, spend_grants=spend_grants)

    def hook(response, *args, **kwargs):
        if response.status_code != 402 or client.account is None:
            return response
        original = response.request
        if any(k.lower() in CREDENTIAL_HEADERS for k in original.headers):
            return response
        if original.body is not None and not isinstance(original.body, (str, bytes)):
            raise ValueError("automatic retry requires a replayable bytes/string body")
        try:
            challenge = response.json()
        except ValueError:
            challenge = json.loads(base64.b64decode(response.headers.get("payment-required", "")))
        _, sig = client.create_payment_payload(challenge, request_url=original.url)
        retry = original.copy()
        retry.headers["PAYMENT-SIGNATURE"] = sig
        retry.headers["X-Lease-Tier"] = tier
        retry.hooks = {k: [] for k in getattr(retry, "hooks", {})}
        return session.send(retry, allow_redirects=False, timeout=kwargs.get("timeout", 30))

    session.hooks.setdefault("response", []).append(hook)
    return session
