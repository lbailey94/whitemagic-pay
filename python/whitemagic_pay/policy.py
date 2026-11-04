"""Caller-owned authorization policy; offers from a server never grant spending authority."""

from dataclasses import dataclass
import re
from urllib.parse import urlsplit


UINT256_MAX = 2**256 - 1


def atomic_amount(value) -> int:
    """Accept positive uint256 decimal integers without float/bool coercion."""
    if type(value) is int:
        amount = value
    elif isinstance(value, str) and re.fullmatch(r"[1-9][0-9]*", value):
        amount = int(value)
    else:
        raise ValueError("amount must be a positive decimal integer")
    if not 0 < amount <= UINT256_MAX:
        raise ValueError("amount is outside uint256 bounds")
    return amount


def resource_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.fragment or not parsed.hostname:
        raise ValueError("URL must have a host and no credentials or fragment")
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")
    ):
        raise ValueError("HTTPS is required except for explicit loopback URLs")
    # Access port here so malformed ports fail before a credential is attached.
    port = parsed.port
    host = parsed.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    if port is not None and port != (443 if parsed.scheme == "https" else 80):
        host += f":{port}"
    return f"{parsed.scheme}://{host}{parsed.path or '/'}" + (f"?{parsed.query}" if parsed.query else "")


def origin_of(url: str) -> str:
    parsed = urlsplit(resource_url(url))
    return f"{parsed.scheme}://{parsed.netloc}"


def address(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", value):
        raise ValueError("asset and payee must be explicit EVM addresses")
    return value.lower()


@dataclass(frozen=True)
class SpendGrant:
    """One exact origin/rail/asset/payee/domain grant and per-client signing budget.

    Budgets count requested signed authorizations, including ambiguous signer failures,
    not settlement. They are in-memory and must not be represented as durable wallet caps.
    """

    origin: str
    network: str
    asset: str
    pay_to: str
    allowed_amounts: tuple[str, ...]
    max_total_amount: str
    domain_name: str = "USD Coin"
    domain_version: str = "2"

    def __post_init__(self):
        if resource_url(self.origin) != origin_of(self.origin) + "/":
            raise ValueError("grant origin must not contain a path or query")
        object.__setattr__(self, "origin", origin_of(self.origin))
        object.__setattr__(self, "asset", address(self.asset))
        object.__setattr__(self, "pay_to", address(self.pay_to))
        object.__setattr__(self, "allowed_amounts", tuple(str(atomic_amount(v)) for v in self.allowed_amounts))
        object.__setattr__(self, "max_total_amount", str(atomic_amount(self.max_total_amount)))
        if not self.allowed_amounts or not self.domain_name or not self.domain_version:
            raise ValueError("grant requires amounts and an exact token signing domain")
