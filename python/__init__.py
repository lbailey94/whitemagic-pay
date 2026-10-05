"""whitemagic_pay — zero-dependency Python client adapter for x402 autonomous payments.

Handles automatic 402 challenge negotiation, EIP-3009 gasless authorization signing,
session pass caching, and receipt extraction for WhiteMagic and x402-enabled endpoints.
"""

from .client import X402Client, wrap_session

__all__ = ["X402Client", "wrap_session"]
__version__ = "0.1.0"
