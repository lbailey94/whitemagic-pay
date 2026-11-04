# WhiteMagic transport examples for AgentKit hosts

This 0.2.0 candidate is **not** a registered Coinbase AgentKit `ActionProvider`.
The TypeScript/Python classes expose methods that a host can explicitly register
with its chosen, pinned framework API. Older plug-and-play examples were unsupported.

`recallMemory`/`recall_memory`, explicit `acquireAdvance`/`acquire_advance`, and zero-stake
arbitration use the origin-scoped client. Each wallet address has a separate client;
acquired bearers are cached with actual expiry and never returned in method text.
Advance borrowing is disabled unless the host explicitly selects `autoAdvance:true`
(or Python `auto_advance=True`). Direct wallet settlement is disabled until a separate
custody/authorization design and pinned framework integration are qualified.

The Python file is a standalone example, not an importable `whitemagic_pay.integrations`
package. Import it from the checked-out example directory. No fallback decorators
or SDK-shaped stubs are provided to imply registration succeeded.

[Coinbase's official provider API](https://github.com/coinbase/agentkit/blob/main/typescript/agentkit/README.md)
requires ActionProvider inheritance and registered actions; implement and test that
against an explicitly selected release before using `AgentKit.from` with this adapter.
Offline tests here cover transport/session contracts only. They do not use a wallet,
contact a service, prove a lock or settle funds.
