# Phase 8.0–8.2 post-implementation safety audit

Date: 2026-07-14

Audit base: `32c3a28a68c097f05571e4aebee6afba2a44597c`

Planning checkpoint: `b597f67fd61f3b4bb8e4ccd6bf4d2cd8e6e19fc5`

Scope: the complete Phase 8.0–8.2 read-only workstation, its Production/Testnet isolation, and non-regression gates around Spot and the frozen Phase 5/6/7 systems. This is not a re-certification or redesign of the already frozen Phase 5/6/7 execution kernels.

## Method

The audit was conducted in five evidence gates:

1. authority and isolation: channel/composition closure, renderer network ownership, route/write/credential/storage scans;
2. market-data core: current official Binance schemas, exact decimals/uint64, order-book sequencing, bounds and malformed input;
3. lifecycle and recovery: generation ownership, reconnect terminal states, timers, sockets and fake clocks;
4. renderer behavior: environment identity, non-live states, symbol ownership and display-only gestures;
5. adversarial verification: focused reproductions, full regression, Electron E2E and GitNexus blast/change analysis.

Official Futures contract checks used only current Binance developer documentation, including the USDⓈ-M common definitions, routed WebSocket connection contract and local order-book procedure. Those checks made no Binance API request. The separate dev-smoke incident described below contacted the existing production Spot endpoint, not a Futures endpoint.

## Findings and disposition

| ID | Severity | Finding | Disposition and regression evidence |
|---|---|---|---|
| A-01 | P1 | Buffered depth replay searched forward for any bridge. A future/reordered delta before a later bridge could be discarded while the book was reported `live`. | The first retained delta must itself bridge the snapshot. Fully duplicate buffered deltas are ignored before `pu` validation. Reorder, duplicate and gap regressions cover the exact sequences. |
| A-02 | P1 | A 40-contract catalog page could exceed the immutable 15 KiB renderer frame, making a realistic catalog bootstrap terminal. | Pages are bounded to eight contracts. Representative and maximum-schema Production envelopes are asserted at or below 15 KiB. |
| A-03 | P1 | A new generation or resync status could retain prior resources labelled `live`, so old symbol/book/chart data could look authoritative. | A generation change clears every resource. Disconnect/resynchronizing/unavailable status transitions all cached resources out of `live`; aggregate renderer state also overrides cached widget state. |
| A-04 | P1 | Bootstrap failure after socket creation and exhausted reconnects emitted `unavailable` without terminally closing stream/timer/session ownership. Successful rebuilds retained the old reconnect count. | Both environment-specific services now halt terminal sessions symmetrically, clear timers/queues, close streams and abort ownership. A successful authoritative rebuild resets the reconnect counter. |
| A-05 | P1 architecture | Phase 8 containers received their socket and sender from Spot `DataContext`, violating Phase 8 transport ownership. | AppShell no longer supplies those props. Separately named Production/Testnet hooks own one bounded environment-neutral loopback connector; it accepts no URL/network option, has a 10 s handshake deadline and bounded reconnects. Static scans enforce the exact exception and forbid Binance authority. |
| A-06 | P2 | Several fields frozen in the Binance REST/stream schemas were accepted without type/range validation. Three current filters were silently discarded and unknown filters were accepted. | Every frozen field is validated, trade-ID ranges are ordered, all seven current USDⓈ-M filters are exact and visible, unknown/missing/duplicate filters fail closed, and documented disabled `PRICE_FILTER` zeros are accepted. Protocol version advanced to `2`. |
| A-07 | P2 | Identity readers accepted arbitrary-length unsigned integers although the ADR required lossless int64. | Backend JSON, order-book and renderer protocol now share canonical unsigned-int64 maximum `18446744073709551615`, while values above `2^53` remain strings. Boundary and overflow tests cover all three layers. |
| A-08 | P2 | Paused tape, drafts, drawings and alerts could survive a symbol/interval owner change; chart/book gestures remained active over non-live data. | The pure view is keyed by symbol/interval ownership. Aggregate recovery state disables market price picking, and depth rows are disabled unless authoritative depth is `live`. |
| A-09 | P2 | Reviewed backend transports silently ignored binary WebSocket frames. | A binary public-read frame now terminates that stream immediately with `BINARY_FRAME_REJECTED` and close code 1003; both transports have deterministic tests. |
| A-10 | P3 | The market header hard-coded `PERPETUAL` even though the catalog protocol carries contract type. | The header renders the selected contract's normalized `contractType`. |
| A-11 | P1 verification process | `npm run e` selected `electron/main.js` and inherited ambient `BK/BS`. During the audit smoke run it entered existing Spot live mode and opened `stream.binance.com` before termination. This violated the intended fake-only verification envelope, although no `fapi`/`fstream` request escaped. | `npm run e` is now source-pinned to a dedicated `main.smoke.js`, which imports the credential-clearing production/Futures escape guards before the normal production UI main. The production boundary scan fails if the script loses that ordering or pin. |
| A-12 | P1 build/smoke | The flat Electron plugin configuration merged its default ESM library format with an added CJS format. Dev watch raced two outputs into `preload.cjs`; the surviving file contained ESM, Electron did not load the preload, and every local socket used an empty fallback token. | Preload is now one explicit Rollup input with one CJS output and no library-format merge. Static checks freeze its format. The bounded safe smoke fails unless an authenticated runtime reaches the renderer and the React root renders; the final run accepted both local sessions and emitted `SAFE_SMOKE_READY`. |
| A-13 | P2 verification determinism | On the shared Wayland desktop, physical letters entered focused Playwright windows and opened the legacy Spot Quick Switch during unrelated scenarios. Hiding the window prevented compositor-backed screenshots. | Only `main.e2e.js` now creates a visible but non-focusable window. Playwright/CDP keyboard interactions and all four workstation screenshots remain active, while host-desktop keystrokes cannot enter the test renderer. The final uninterrupted run passed all 15 scenarios. |

No finding added execution authority. Chart, depth and tape callbacks remain local presentation actions and cannot prepare or submit an intent.

## GitNexus impact gate

GitNexus was run before every modified existing function, class or method. The highest pre-edit results were:

- `CRITICAL`: exact filter/kline/header normalizers, catalog framing and the shared backend identity reader because they feed both Production and Testnet bootstrap/stream flows;
- `HIGH`: the shared workstation view and both environment recovery methods because they feed AppShell or request/freshness/stream processes;
- `LOW`: order-book bootstrap/update-ID validation, AppShell/container wiring, renderer close/error handlers and both reviewed `createSocket` functions.

All HIGH/CRITICAL results were reported before edits. Direct callers were kept intact, both environment implementations were changed symmetrically, and targeted tests were added at each affected flow.

Pre-commit staged change detection reports `38` files / `116` indexed symbols / `18` affected flows and the expected `CRITICAL` aggregate classification because the audit deliberately changes the shared protocol and both environment lifecycle flows. Base comparisons report:

- audit milestone `32c3a28`: `32` indexed files / `116` symbols / `18` affected flows;
- planning checkpoint `b597f67`: `53` / `783` / `51`;
- guarded-UI base `dcd2260`: `53` / `808` / `51`;
- Phase 6 base `36681f0`: `101` / `2271` / `186`;
- `main`: `202` / `4640` / `282`.

The audit-base flow set is confined to the expected generation, validation, resource emission and Production/Testnet resync paths. New unindexed files are additionally covered by Git status, static scans, tests and the post-commit index refresh.

## Residual risk

- The source-pinned Production and Testnet reviewed transports remain disabled during automated verification. Their exact construction is tested, but no real exchange request was authorized or made.
- Continuity proves protocol ordering, not economic correctness or Byzantine agreement. Cross-venue validation remains outside Phase 8.
- `lightweight-charts` receives presentation-only numeric coordinates. Canonical decimal strings remain the read-model source and never become an execution input.
- Drawings and alerts are bounded local display aids, not durable records or executable alerting.
- The frozen Phase 5/6/7 drawers retain their pre-existing local connection plumbing. Phase 8 market data no longer consumes the Spot `DataContext` transport; migrating the frozen execution/read-only hooks would require a separate phase-specific impact audit.

## Verification-network incident

The first `npm run e` audit smoke inherited ambient Spot credentials before A-11 was fixed. Logs show a production Spot mini-ticker connection and an attempted user-data setup; the process was stopped immediately. No credential value appeared in output, no Futures Production/Testnet endpoint was contacted, both Phase 8 reviewed transports remained source-pinned off, and no Live Futures action was enabled. Consequently, the final report must not claim that zero production network activity occurred during the entire audit session; it can and does confirm zero real Futures network activity.

## Verification record

The final pre-commit evidence is `89/89` Vitest files, `2803` passed tests and only the two established skips; clean ESLint; successful production and E2E builds; syntactically valid CJS preload; safe `npm run e` with authenticated loopback plus rendered React root; all `15/15` Electron Playwright scenarios; a `233`-source circular-import scan; and production/workstation boundary scans over `38` and `31` isolated implementation files. `git diff --check` is clean. All automated market-data verification uses deterministic fakes and the production network escape guard.

The final commit report records the GitNexus comparison results and commit identity.
