# F01 implementation evidence — 2026-09-04

## Delivered and decisions

- Replaced retired Spot REST listenKey creation/renewal and its SDK socket with one signed WebSocket API subscription owner. Public-market SDK and Futures transports are unchanged.
- Chose existing `ws` and main-only HMAC credentials: the installed SDK reconnects internally and strips subscriptionId when delivering events. This controller retains the envelope and owns every retry, pending admission and socket generation without patching dependencies.
- Matching ACK, including subscriptionId zero, establishes readiness. Pre-ACK and wrong/old subscription events are ignored. Handshake/ACK, payload, peer silence and retry delays are bounded. Server ping receives protocol pong even on a quiet account. Terminal authentication/rate refusal requires reactivation, not endless retries.
- Main refuses new placements until private readiness; cancellation and refresh stay available. Recovery never resends a trade. Readiness means a confirmed subscription, not a completed REST snapshot.
- Gateway retains status before workspace mount, keyed by connection and activation generation. A persistent banner resets on disconnect/deactivation.
- Reconnect catches up balances and open orders through the existing epoch-protected read owner. Private events and health changes invalidate old snapshots. A shared balance fallback coalesces a trailing current read and never publishes after the final consumer leaves.

## Verification

- Full `npm run test:all`: **138 files / 3,238 tests passed**, followed by successful lint, build and every architectural gate.
- Controller: **29 tests**, including real loopback WebSocket handshake, signed subscribe/ACK zero, event delivery and server ping/client pong. Fake-timer tests cover bounded retries, authentication/rate refusal, quiet account, peer silence, shutdown/termination, wrong/late frames, oversized/malformed payloads, large integer ids, and stop during admission/retry.
- Main service: **271 tests**, including eight new subscription-ownership regressions. They cover shared consumers, placement gating with cancellation available, reconnect, final-consumer teardown, market reactivation, delayed balances and trailing reads. Installed-SDK F02 outcome tests remain green.
- Replaced nine tests prescribing the retired listenKey lifecycle and removed three obsolete adapter-method tests. Production implementation preceded new tests. Gateway and workspace tests verify pre-mount status retention, connection/generation reset and the visible warning.
- Build: 558 renderer modules, 316 main modules (1,408.57 kB), five preload modules (1.50 kB). Circular check 308 source files; runtime boundary 157 modules; Futures boundary 24 implementation files; command-path gate 126 renderer modules and one builder.
- `openspec validate ... --strict` and `git diff --check` passed. Existing non-fatal large-file/Babel, baseline-browser age and test diagnostic warnings remain; no coverage percentage is claimed.

## Impact and graph limitations

Repository `trade_ui_latest`, primary checkout, `main` baseline `b42675a`. Refreshed GitNexus 1.5.3 index: 1,009 files / 12,562 nodes / 20,032 edges / 300 flows. Before edits, startUserDataStream was HIGH and stopSharedSpotConnections CRITICAL; fetchAndBroadcastBalances and its snapshot emission path were HIGH. Warnings were disclosed. Actual direct owners (initialize/deactivate, setup, connection close, placement and account reads) were reviewed, including their shared Futures neighbors. Empty LOW results for React and plain-object methods were treated as unresolved and checked against source references.

MCP all/compare-main reports CRITICAL. Its changed-file matcher internally caps nodes per file; no absent partial/truncated flag is taken as proof of complete coverage. Supplementary uncapped exact-path queries found 216 orchestrator nodes, 23 adapter nodes, 12 controller nodes, eight gateway nodes, 14 data-provider nodes and 11 workspace nodes, touching 118 file-level processes. The large main test file still exceeds the 512 KiB index cap; it was reviewed and executed directly. Dynamic callbacks are covered by source review and lifecycle tests, not claimed resolved by the graph. The staged graph check is repeated before commit to include newly added files.

The staged repeat includes all 19 changed files and reports 162 changed nodes / 45 processes, CRITICAL, with no partial/truncated flag. The exact-path and source-review limitations above still apply.

## Remaining gate

Operator live confirmation is pending; no archive, real credentials read, exchange mutations, production restarts or session launch. Confirm normal private health, balances/open orders and a naturally occurring reconnect; do not induce a live order/disconnect merely for testing. F05 dependencies, F06 action-specific postconditions, F08 weights and F09/F10 identity concerns remain separate audit work.

Protocol checked against [Binance WebSocket API](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-api.md) and [user-data event format](https://github.com/binance/binance-spot-api-docs/blob/master/user-data-stream.md).
