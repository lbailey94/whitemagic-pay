"""whitemagic_pay.cli — CLI testing and diagnostic tool for autonomous x402 payments."""

from __future__ import annotations

import argparse
import json
import sys
import time
from .client import X402Client


def main():
    parser = argparse.ArgumentParser(description="x402 payment client probe")
    subparsers = parser.add_subparsers(dest="command")

    probe_p = subparsers.add_parser("probe", help="Probe an x402 endpoint")
    probe_p.add_argument("url", help="Target URL (e.g. https://mcp.whitemagic.dev/mcp)")
    probe_p.add_argument("--key", help="Hex private key (optional; if omitted, test key is generated)")
    probe_p.add_argument("--tier", default="task", choices=["call", "task", "swarm", "day"], help="Payment tier")
    probe_p.add_argument("--query", default="white magic", help="Query string for memory.search")

    faucet_p = subparsers.add_parser("faucet", help="Claim a trial session pass from the faucet")
    faucet_p.add_argument("--url", default="https://mcp.whitemagic.dev", help="Base URL")

    notarize_p = subparsers.add_parser("notarize", help="Notarize context or action")
    notarize_p.add_argument("--digest", required=True, help="Context digest (sha256:<hex> or <hex>)")
    notarize_p.add_argument("--action", default="agent.action", help="Action name")
    notarize_p.add_argument("--url", default="https://api.whitemagic.dev", help="Base URL")
    notarize_p.add_argument("--pass-token", help="Optional session pass token")

    args = parser.parse_args()
    if args.command == "faucet":
        client = X402Client()
        print(f"[*] Claiming trial session pass from {args.url}/faucet...")
        try:
            res = client.claim_faucet(args.url)
            print(f"[+] Faucet Response: {json.dumps(res, indent=2)}")
            if client.is_pass_active():
                print(f"[+] Active Session Pass acquired: {client.cached_pass}")
            return 0
        except Exception as e:
            print(f"[-] Faucet claim failed: {e}")
            return 1

    if args.command == "notarize":
        client = X402Client()
        if args.pass_token:
            client.cached_pass = args.pass_token
            client.pass_expires_at = time.time() + 600
        print(f"[*] Submitting context notarization to {args.url}/notarize...")
        try:
            res = client.notarize_context(args.url, context_digest=args.digest, action=args.action)
            print(f"[+] Notarization Success: {json.dumps(res, indent=2)}")
            return 0
        except Exception as e:
            print(f"[-] Notarization failed: {e}")
            return 1

    if args.command == "probe":
        client = X402Client(private_key=args.key, preferred_tier=args.tier)
        print(f"[*] Probing {args.url} as {client.address or 'unauthenticated client'}...")

        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "memory.search",
                "arguments": {"query": args.query, "limit": 3}
            }
        }
        status, data, headers = client.request("POST", args.url, data=payload)
        print(f"[+] Final Status: {status}")
        if client.is_pass_active():
            print(f"[+] Active Session Pass: {client.cached_pass[:16]}... (Tier: {client.pass_tier})")
        if "PAYMENT-RESPONSE" in headers or "X-Payment-Response" in headers:
            print(f"[+] Payment settled and acknowledged by server!")
        print(f"[+] Body preview: {json.dumps(data)[:400]}")
        return 0 if status == 200 else 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
