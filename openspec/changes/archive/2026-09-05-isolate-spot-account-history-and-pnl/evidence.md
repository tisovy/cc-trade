# F09 implementation evidence — 2026-09-05

Later ordinary-use operator acceptance is recorded in [tasks](tasks.md).
Pending-live wording below describes the implementation checkpoint; no
unobserved edge case becomes live-confirmed through archival.

## Decisions and boundaries

- A domain-separated SHA-256 fingerprint of the configured Spot API key is computed only in main. It is a namespace, not an exchange UID or authorization token; it does not contain the API key/secret. Key rotation deliberately starts fresh rather than guessing account equivalence.
- Spot REST balances/orders/history and private order/balance events carry this identity. Public and Futures frames retain their previous schema. No new exchange requests are introduced by production code.
- Version/market/account/kind must agree in storage. Legacy `orders_history` and `pnl_snapshots` remain untouched and unused, so no unverified migration or deletion occurs.
- DataContext swaps private refs before applying new-account data and fences frames by current open socket. New connections wait for a full balance snapshot. Same-account unresolved warnings are retained; switching a known account clears its old warnings.
- InfoPanel checks the held result's account and period before rendering. Existing portfolio price readiness/calendar rollover logic is preserved. This is balance-snapshot change tracking, not a deposit/withdrawal-adjusted performance metric.

## Tests and checks

- Production was changed before tests. New tests cover fingerprint generation/stamping, invalid identity, malformed/mismatched storage, A/B baseline and trade-count isolation, legacy preservation, full-balance readiness, old socket rejection, same-tick history ownership, same-key reconnect, UI ownership and real main orchestration using mocked exchange I/O.
- Targeted initial integration run: 8 files / 371 tests passed. Adding a REST history assertion exposed a test-only fake-clock wait; the fixture now advances the limiter's virtual clock while awaiting the request. Its isolated repeat passed; no production workaround was added.
- Final `npm run test:all`: **144 files / 3,411 tests passed**, lint, renderer/main/preload build, dependency baseline and all architecture gates passed. Full log: `/tmp/account-scope-verified.log` (ephemeral).
- Gates: 316 source files cycle-free; 160 runtime modules MOCK-free; 24 isolated Futures implementation files; 128 command-path modules. Existing Babel large-test-file and ESLint environment warnings remain non-failing.
- Strict OpenSpec validation and `git diff --check` passed.

## Graph/source review

Before code: `broadcastToRenderers` impact **CRITICAL**, eight direct callers / 15 processes; warning disclosed before proceeding. `setupBinanceConnection` has main.js as caller. React/PnL arrow callbacks often return empty walks or are absent; these are unresolved index coverage, not unused-code evidence. Exact-file graph imports and source callers were inspected.

Refreshed index: 12,813 nodes / 20,387 edges. MCP `detect_changes` for all and compare/main: 19 changed files / 139 nodes / 44 affected processes, **critical**, no partial/truncated flags. The tool's internal 20-node/file cap still applies: exact-path counts show main 216, DataContext 14, PnL 17, InfoPanel 9, scope helper 6 and main identity helper 3. Exact-path CALLS/IMPORTS review plus source and integration tests supplements that cap. Main's >512KB test file is omitted from indexing, not from execution. No whole-program safety claim is made.

## Remaining acceptance

Operator live confirmation is pending and no archive was performed. Do not create trades to test this change. Verify normal history/PnL with the current account and, only when legitimately rotating configuration, a fresh namespace with no inherited history/baseline. The old namespace remains retained. Production services, real credentials and real orders were not accessed or altered.
