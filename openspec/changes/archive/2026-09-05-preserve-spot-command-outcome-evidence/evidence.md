# F02 implementation evidence — 2026-09-04

Later ordinary-use operator acceptance is recorded in [tasks](tasks.md).
Pending-live wording below describes the implementation checkpoint; no
unobserved edge case becomes live-confirmed through archival.

## Delivered

- The shared Spot REST client is protected before adapter or public-data use. SDK signing, stable client id, proxy/agent configuration, rate-limit metadata and bigint parsing are retained.
- HTTP errors bypass the SDK's lossy exception mapping and become `SpotRestError` with status, numeric exchange code, transport classification and certainty. Unknown details are stated as unavailable, never reconstructed from a message.
- No SDK retries or HTTP redirects. POST, DELETE and GET each have one physical attempt per invocation; existing read owners retain their own budgets.
- HTTP 5xx, exchange -1000/-1006/-1007, 409 partial success, unusable JSON and contradictory/missing status/code remain unknown. A determinate -2013 lookup alone establishes absence; a 503/-2013 does not.
- Network/parse errors expose no original Axios config, signed URL, headers, raw body or cause. Exchange reasons are bounded to 500 characters with line controls removed; existing credential log masking remains in place.

## Verification

- Full `npm run test:all`: **137 files / 3,211 tests passed**, including lint, production build and all architecture gates.
- New SDK boundary suite: **38 tests**, using the installed `@binance/spot` 24.0.0 / `@binance/common` 2.0.1, not mocked SDK exception classes. An actual loopback HTTP server drops the POST connection after observing the request; the next request is GET, never a second POST.
- Four additional main-service tests run the installed SDK with a local Axios transport fixture: immediate presence, eventual presence on the third lookup, three explicit -2013 answers, and three failed lookups. Each emits unresolved first, performs one mutation, and reaches only its supported outcome.
- Existing service HTTP fixtures now carry the real SDK's status field. Tests retain raw mock references while the service receives its protected facade; the assertions are not bypassing the boundary. Renewal checks compare status/body, not response-wrapper object identity.
- `check:electron-build-artifacts`: 2 files; circular imports: 306 source files; runtime mocks: 156 modules; Futures boundary: 24 implementation files; command path: 126 renderer modules, one builder.
- Build: renderer 558 modules, main 315 modules (1,406.10 kB), preload 5 modules (1.50 kB). No runtime session or packaged window was launched.
- Existing non-fatal diagnostics persist: baseline-browser-mapping age, large-file Babel notice, ChartWrapper act/timeout warnings and Futures burst teardown diagnostics. No coverage percentage is claimed.

## Graph review and limitations

Bound repository: `trade_ui_latest`, primary checkout `/home/me/work/trade_ui_latest`, `main` baseline `01fac99`. The checked-in `cc-trade` index name and newer CLI switches do not match the installed GitNexus 1.5.3; explicit actual repository name was used.

Before edits, impact on SpotTradingAdapter showed its direct importer binance-connection (1.0 confidence) and main transitively; setupBinanceConnection showed main (0.9). Both were LOW. Empty LOW results for findOrder / classifier were treated as unresolved and supplemented with their actual handler calls. The new response checker later showed one direct facade caller (0.95, LOW).

Real MCP `detect_changes(scope: all)` and `compare/main` were run. They reported **CRITICAL**, which was disclosed to the operator. This version lists up to 20 nodes per changed-file name match: its initial 78 nodes / 46 flows were neither complete nor a line-precise blast radius, despite absent partial/truncated flags. The output was re-run without console truncation and supplemented by uncapped exact-path Cypher.

Exact source counts: binance-connection 217 graph nodes, Spot adapter 26, new boundary 7, boundary tests 3. All processes touching those production files total 118; limiting to actually edited function owners yields eight setupBinanceConnection flows (admission and existing mark-value paths). The orchestrator production diff is exactly an import and installation call; no RateLimiter or Futures logic changed. Adapter diff is an import and the explicit indeterminate guard in findOrder. Source inspection, the installed-SDK tests and full suite cover dynamic facade calls the graph cannot resolve.

The 512 KiB index file cap omits the large binance-connection test file entirely; its changed hunks were read directly and all 272 tests in it execute. This is a documented graph blind spot, not evidence of no test impact. Unindexed YAML/evidence text is reviewed directly. No clean whole-program graph claim is made.

## Decisions and remaining gates

Chose an instance-local SDK facade over dependency patching or global Axios interceptors: it preserves existing signing/transport and confines error semantics to Spot. A DNS/refused connection that the SDK erases is conservatively unknown too; a harmless extra lookup is preferable to inventing evidence that a request did not execute. Hidden read retries are disabled as well so the owner can bound attempts.

Live operator acceptance is pending; task 3.3 remains open and the change is not archived. No real credentials were read, exchange orders sent, services restarted or trade session launched. This change does not fix F01 stream migration, F06 action-specific cancel/modify postconditions, F08 physical-weight accounting, or F10 alias serialization. It is not a release-safety attestation.

Protocol checked on 2026-09-04: [Binance REST general and HTTP error behavior](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md), [numeric error definitions](https://github.com/binance/binance-spot-api-docs/blob/master/errors.md).
