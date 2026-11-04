"""Explicit CLI actions; secrets are read from environment and redacted from output."""
import argparse
import json
import os
import sys
from .client import X402Client
from .policy import SpendGrant


def redact(value):
    if isinstance(value, dict):
        return {k: "[redacted]" if any(word in k.lower() for word in ("token","pass","signature","private","authorization","key"))
                else redact(v) for k,v in value.items()}
    if isinstance(value, list): return [redact(v) for v in value]
    return value


def main():
    parser=argparse.ArgumentParser(description="Explicit-policy x402 client probe")
    commands=parser.add_subparsers(dest="command")
    probe=commands.add_parser("probe")
    probe.add_argument("url")
    probe.add_argument("--key-env",default="WHITEMAGIC_PRIVATE_KEY",help="environment variable containing a signing key")
    probe.add_argument("--policy",help="JSON array of explicit SpendGrant objects; no file means no signing authority")
    probe.add_argument("--tier",default="task",choices=["call","task","swarm","day"])
    probe.add_argument("--query",default="white magic")
    faucet=commands.add_parser("faucet",help="explicitly claim a trial pass; output is redacted")
    faucet.add_argument("--url",default="https://mcp.whitemagic.dev")
    notarize=commands.add_parser("notarize")
    notarize.add_argument("--digest",required=True)
    notarize.add_argument("--action",default="agent.action")
    notarize.add_argument("--url",default="https://api.whitemagic.dev")
    notarize.add_argument("--pass-env",help="environment variable containing an origin-scoped session token")
    args=parser.parse_args()
    if not args.command: parser.print_help(); return 1
    try:
        if args.command=="probe":
            grants=[]
            if args.policy:
                with open(args.policy,encoding="utf-8") as source: grants=[SpendGrant(**item) for item in json.load(source)]
            client=X402Client(private_key=os.environ.get(args.key_env),preferred_tier=args.tier,spend_grants=grants)
            status,data,_=client.request("POST",args.url,{"jsonrpc":"2.0","id":1,"method":"tools/call",
                "params":{"name":"memory.search","arguments":{"query":args.query,"limit":3}}})
            print(json.dumps({"http_status":status,"body":redact(data),"session":client.session_status(args.url)}))
            return 0 if status==200 else 1
        client=X402Client()
        if args.command=="faucet":
            data=client.claim_faucet(args.url)
        else:
            if args.pass_env:
                token=os.environ.get(args.pass_env)
                if not token: raise ValueError("selected token environment variable is empty")
                client.adopt_session_pass(args.url,token,600,"explicit-cli")
            data=client.notarize_context(args.url,context_digest=args.digest,action=args.action)
        print(json.dumps(redact(data)))
        return 0
    except Exception as exc:
        print(f"request failed ({type(exc).__name__}); no payment settlement is asserted",file=sys.stderr)
        return 1


if __name__=="__main__": sys.exit(main())
