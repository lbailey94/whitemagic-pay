# WhiteMagic Eliza-style structural example

This 0.2.0 candidate demonstrates a memory provider and actions, but is not qualified
against a pinned `@elizaos/core` runtime. Register it only after adapting and testing
the official framework contract. The exported TypeScript interfaces are structural
example types, not a compatibility certification.

Clients and leases are held per runtime object; changing `WHITEMAGIC_URL` or
`WHITEMAGIC_AUTO_ADVANCE` replaces that runtime's client. Raw session headers are
cached with their supplied expiry through whitemagic-pay 0.2.0. Separate runtimes
never reuse each other's token. No auto-advance is requested unless the runtime
setting `WHITEMAGIC_AUTO_ADVANCE` is exactly `1`. This setting opts into the service's
borrowing mechanism; free grant or favorable terms are not promised.

Tool-level/JSON-RPC errors are treated as errors even with HTTP 200. Retrieved text
is labeled as untrusted context. Arbitration is zero-stake and is a request to an
experimental route, not a guarantee of mutual exclusion or deadlock prevention.

See [Eliza's official plugin guide](https://eliza.how/core-concepts/plugins) for the
separate pinned runtime-registration gate. Local tests use fake transports only.
