## Context

The prior changes improved ambiguous failures but still trusted successful REST bodies. Both cancellation adapters override any returned status to CANCELED. Lookups trust the requested endpoint instead of the returned order identity. Futures findOrder accepts code -2013 even with HTTP 5xx. Private-warning matching tolerates a missing symbol. Spot invalidation drops a read without requesting a fresh account baseline.

## Decisions

1. A shared, transport-independent identity predicate requires the requested symbol and a safe exchange order identity. An explicitly requested exchange ID must match; a client-only target must match the current or original client ID. Contradictory IDs do not answer a held warning.
2. Main-side successful-response validation uses the existing action postconditions and throws a bounded indeterminate error when evidence is insufficient. No body/config/cause is attached. Existing command owners reconcile with GET only; successful-response validation never retries a mutation. Lookup identity is checked even when status is absent, which remains UNKNOWN.
3. Futures -2013 is absence only when the transport classification is determinate. Private reports need an explicit matching symbol before withdrawing a warning.
4. A stale Spot read requests a coalesced current account pass only while its renderer still owns Spot. The existing limiter charges the replacement. Retiring the renderer/market prevents stale completions from resurrecting work. The replacement does not resend a trade.
5. DevTools automatic opening depends solely on a recognized true ELECTRON_OPEN_DEVTOOLS flag. VITE_DEV_SERVER_URL alone no longer opens it. Manual Inspect Element remains.
6. An installed-SDK probe found large integer IDs are native BigInt, not strings. The prior test only used String(id), missing that JSON.stringify on a renderer frame throws. The REST boundary converts BigInt leaves to decimal strings in its owned parsed data, with a nesting bound; no Number conversion or whole-body reserialization is used. This supplements both safe identity validation and existing history/persistence paths.

## Risk and verification

GitNexus binds trade_ui_latest at the primary main checkout, b5003fc. emitSpotRefreshOperation has HIGH impact (8 upstream symbols, 3 process groups), including subscribeChannel, account refresh and typed commands. The warning was reported before code. Common adapter method names and JSX calls have unresolved graph walks; class/exact-file source and graph inspection supplement them, not a zero-risk assertion. Tests follow production implementation and cover valid answers, malformed/contradictory answers, no mutation replay, stale initial snapshots, retired consumers and launch policy. Full tests/lint/build/architecture gates and a fresh non-launched Linux package follow.

## Scope and acceptance

Review all 12 prior audit-remediation commits across transport, private lifecycle, action outcomes, alias lanes, account persistence, chart/store integrity, outbox, render recovery, fatal runtime, dependencies and packaging. This is a second self-review, not independent sign-off. Live acceptance and npm dependency-metadata consent remain separate from local evidence. Synchronization does not assert live acceptance; no archive task is checked on the strength of unit tests.
