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
| A-11 | P1 verification process | `npm run e` selected `electron/main.js` and inherited ambient `BK/BS`. During the audit smoke run it entered existing Spot live mode and opened `stream.binance.com` before termination. This violated the intended fake-only verification envelope, although no `fapi`/`fstream` request escaped. | Automated bounded smoke is source-pinned to a dedicated pre-main entry which first clears credentials/network overrides and installs the fake-only guards. Persistent fake-only manual verification is separately available as `npm run e:safe`; the normal operator launch is not an automated verification command. |
| A-12 | P1 build/smoke | The flat Electron plugin configuration merged its default ESM library format with an added CJS format. Dev watch raced two outputs into `preload.cjs`; the surviving file contained ESM, Electron did not load the preload, and every local socket used an empty fallback token. | Preload is now one explicit Rollup input with one CJS output and no library-format merge. Static checks freeze its format. The bounded safe smoke fails unless an authenticated runtime reaches the renderer and the React root renders; the final run accepted both local sessions and emitted `SAFE_SMOKE_READY`. |
| A-13 | P2 verification determinism | On the shared Wayland desktop, physical letters entered focused Playwright windows and opened the legacy Spot Quick Switch during unrelated scenarios. Hiding the window prevented compositor-backed screenshots. | Only `main.e2e.js` now creates a visible but non-focusable window. Playwright/CDP keyboard interactions and all four workstation screenshots remain active, while host-desktop keystrokes cannot enter the test renderer. The final uninterrupted run passed all 15 scenarios. |
| A-14 | P1 manual acceptance regression | The A-11 remediation made `npm run e` select the bounded smoke harness. A successful readiness probe therefore called `app.quit()`, closed the operator's Electron window and made the documented manual launch unusable. | Persistent and bounded verification now have separate entries: `npm run e:safe` uses `main.safe-dev.js` and remains open, while `npm run e:smoke` alone uses `main.smoke.js` and exits after readiness. |
| A-15 | P1 Spot data regression | The A-14 follow-up kept `npm run e` persistent but routed it through `main.safe-dev.js`. Its pre-main setup clears `BK/BS`; the legacy Spot service therefore selected `USE_MOCK=true`, replacing the operator's Spot chart and trades with synthetic payloads. | `npm run e` again selects the normal persistent `main.js` entry and preserves the historical operator configuration. Fake-only persistent and bounded runs remain explicit as `npm run e:safe` and `npm run e:smoke`. The boundary scan freezes all three launch contracts and prevents the interactive command from silently selecting a build mode. |
| A-16 | P1 operator data authority | Both normal Phase 8 workstation compositions remained source-pinned to deterministic fixtures, so Testnet and Live displayed synthetic, nearly identical prices despite presenting themselves as public market workstations. | The normal operator compositions now instantiate their separately reviewed credential-free public-read transports. Safe-dev, smoke, E2E and Vitest source-select separate deterministic verification compositions at build time; no renderer/runtime environment or host option was introduced. Static and unit gates freeze both sides. |
| A-17 | P2 chart interaction | `FuturesWorkstationChart` called `fitContent()` after every candle, mark or index update. Streaming data therefore repeatedly overrode operator pan/zoom and snapped the viewport back. Its raw histogram path also bypassed the bounded Spot volume presentation helper. | The first non-empty authoritative candle set fits exactly once per symbol/interval owner. Later updates preserve the user viewport. Futures volume now uses the shared pure bounded presentation helper; direct chart regressions cover both viewport retention and oversized volume. |

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

- Production and Testnet reviewed transports are active only in the normal operator composition. Automated verification source-selects deterministic compositions, so exact construction is tested but real exchange availability and payload compatibility still require the operator-run manual acceptance checkpoint.
- Continuity proves protocol ordering, not economic correctness or Byzantine agreement. Cross-venue validation remains outside Phase 8.
- `lightweight-charts` receives presentation-only numeric coordinates. Canonical decimal strings remain the read-model source and never become an execution input.
- Drawings and alerts are bounded local display aids, not durable records or executable alerting.
- The frozen Phase 5/6/7 drawers retain their pre-existing local connection plumbing. Phase 8 market data no longer consumes the Spot `DataContext` transport; migrating the frozen execution/read-only hooks would require a separate phase-specific impact audit.

## Verification-network incident

The first `npm run e` audit smoke inherited ambient Spot credentials before A-11 was fixed. Logs show a production Spot mini-ticker connection and an attempted user-data setup; the process was stopped immediately. No credential value appeared in output, no Futures Production/Testnet endpoint was contacted, both Phase 8 reviewed transports remained source-pinned off, and no Live Futures action was enabled. Consequently, the final report must not claim that zero production network activity occurred during the entire audit session; it can and does confirm zero real Futures network activity.

## Verification record

The original post-audit pre-commit evidence was `89/89` Vitest files, `2803` passed tests and only the two established skips; clean ESLint; successful production and E2E builds; syntactically valid CJS preload; the bounded fake-only renderer smoke; all `15/15` Electron Playwright scenarios; a `233`-source circular-import scan; and production/workstation boundary scans over `38` and `31` isolated implementation files.

A-14 follow-up verification repeated `89/89` Vitest files / `2803` passed / the same `2` skips, clean ESLint, both builds, all `15/15` Electron Playwright scenarios, the `234`-source circular scan, both boundary scans (`38` production and `31` workstation implementation files), and `git diff --check`. `npm run e:smoke` reached authenticated loopback plus a rendered React root in fake mode and exited after `SAFE_SMOKE_READY`; separately, the then-current `npm run e` remained alive beyond a five-second post-load observation until the verifier explicitly sent Ctrl-C. That observation exposed no lifecycle failure but missed the A-15 Spot data-source regression. All automated market-data verification continues to use deterministic fakes and the production network escape guard; the normal operator command is not invoked by automated verification.

A-15 follow-up verification passed `90/90` Vitest files / `2806` passed / the same `2` skips, ESLint, both production and E2E builds, all `15/15` Electron Playwright scenarios, the `234`-source circular scan, both boundary scans (`38` production and `31` workstation implementation files), and `git diff --check`. The new three-test launch contract and static scan require the normal default entry plus separately named persistent/bounded fakes. `npm run e:smoke` completed in mock mode at `SAFE_SMOKE_READY`; `npm run e:safe` remained alive in mock mode until the verifier explicitly stopped it. The normal `npm run e` was not executed because the verifier environment contains configured Spot credentials and that would authorize real Spot network activity outside automated verification.

A-16/A-17 public-read activation verification passed `92/92` Vitest files / `2818` passed / the same `2` established skips, ESLint, production and E2E builds, all `16/16` Electron Playwright scenarios, the `239`-source circular scan, production/workstation boundary scans over `43` and `33` isolated files, `git diff --check`, and the bounded fake-only `SAFE_SMOKE_READY` launch. The normal Electron bundle contains the two reviewed public-read modes and no deterministic workstation mode; the E2E bundle contains deterministic workstation modes and no reviewed workstation mode. A direct constructor-only probe reported `reviewed-testnet-public-read` and `reviewed-production-public-read` without invoking either service. The test network guard blocked all attempted requests during a transient pre-alias test run; after the correction, the full suite recorded no Futures network attempt. No real Binance Futures request, credential, private response or write action was used.

The final commit report records the GitNexus comparison results and commit identity.
