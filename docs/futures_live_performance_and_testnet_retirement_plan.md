# Futures Live Performance and Futures Testnet Retirement Plan

Date: 2026-07-16

Status: implemented and verified

## Decision

`Futures Testnet` is retired. It must no longer be selectable in the renderer, composed in the Electron main process, reachable through the local WebSocket protocol, included in the active test matrix, or documented as an operator workflow.

The retired implementation is preserved through an archive manifest under `archive/futures-testnet/`. The manifest records the last source revision and exact historical paths, so a future investigation can recover any file with `git show` without keeping dead trading code inside active source directories.

`Futures Live` remains an independently named production subsystem. This work may optimize only public market-data loading. It must not weaken or reuse any production execution authorization, account identity, rate, risk, intent, recovery, durable ledger, kill-switch, or network-origin boundary.

## Pre-change latency chain

The current workstation reaches its global `LIVE` state only after this serial critical path:

1. open the renderer-to-Electron WebSocket;
2. fetch and normalize the full USDⓈ-M `exchangeInfo` catalog;
3. open both Binance market streams and wait for both handshakes;
4. execute depth, contract-candle, mark-candle, index-candle, premium-index, and ticker REST bootstrap requests through a single-concurrency read budget;
5. publish the aggregate `LIVE` state to React.

Unlike Spot, which performs independent bootstrap reads concurrently, Futures therefore accumulates most network latencies. Re-entering the tab and changing an interval also rebuild more of the workstation than the changed resource requires. Small catalog frames cause repeated React reductions and sorts while the screen is still blocked by aggregate readiness.

## Implementation plan

### 1. Retire and archive Futures Testnet

- Remove the `futures-testnet` market mode, selector option, renderer hooks, components, and renderer protocol.
- Remove Testnet workstation and Testnet execution composition from Electron startup and local WebSocket routing.
- Remove Testnet-only source and tests from active `src/` and `electron/` trees.
- Move Testnet design/operator documentation out of the active runbooks.
- Add an archive manifest containing the baseline Git SHA, retired path inventory, recovery commands, reason, and explicit rule that archived code must not be imported or packaged.
- Update production docs so the supported workspaces are only `Spot` and `Futures Live`.

### 2. Shorten the Futures Live critical path

- Add a bounded main-process cache for public workstation `exchangeInfo` data. The cache is market-data-only, has a short TTL, deduplicates concurrent loads, and is not available to production execution/risk decisions.
- Preserve the requirement that both market-stream handshakes complete before REST bootstrap, then run independent bootstrap reads with bounded concurrency instead of deliberate single-flight execution.
- Keep depth snapshot sequencing and buffered-diff synchronization unchanged.
- Treat interval changes as candle-resource changes where the current protocol permits it; do not refetch the catalog or unrelated ticker/depth state solely because the interval changed.
- Do not keep a production execution capability armed or alive as a loading optimization. Any short-lived reuse is limited to public market-data resources and must preserve teardown ownership.

### 3. Make readiness progressive

- Track readiness per catalog, depth, candle family, premium index, and ticker resource.
- Render each usable panel as soon as its own initial data is valid instead of blocking the entire workstation on aggregate `LIVE`.
- Keep degraded/error state visible per resource and retain the aggregate state for diagnostics.
- Coalesce catalog chunks and high-frequency renderer reductions so the initial symbol list does not trigger a render/sort for every small frame.

### 4. Add latency evidence

- Record bounded, redacted durations for local connection, catalog load/cache hit, upstream stream readiness, each bootstrap resource, and aggregate readiness.
- Never log request URLs containing secrets, headers, signed parameters, credentials, account data, or raw exchange responses.
- Cover cold load, cache hit, reconnect, symbol change, interval change, and partial-resource failure in deterministic tests.

## Safety and compatibility invariants

- Production execution stays disabled by default and keeps its exact explicit operator gates.
- Market-data caching cannot supply exchange filters to order validation or preflight.
- No network host becomes caller-configurable; production public market data remains pinned to reviewed Binance production origins.
- Spot priority/rate behavior remains unchanged.
- Bootstrap concurrency stays bounded and inside the existing workstation read budget.
- A stale catalog is never extended indefinitely: expiry triggers one deduplicated refresh, and a failed refresh produces an explicit degraded/error state.
- Depth is not declared ready before a valid snapshot and buffered stream-diff reconciliation.
- Mode switches cannot place, cancel, close, arm, or disarm anything implicitly.

## Historical verification gates

The following gates were required when this completed plan was delivered; they
are retained as dated evidence rather than current runnable instructions.

- GitNexus upstream impact is reviewed before every edited symbol; HIGH or CRITICAL impact is reported before editing.
- Focused unit/component tests cover every changed service, hook, reducer, view, and Electron route.
- Testnet mode strings and imports are absent from active runtime code and build inputs.
- Production network escape guards and execution safety tests remain green.
- Lint, unit tests, build, and relevant Playwright flows pass.
- `gitnexus detect-changes --compare main` reports only the expected market-workstation, application-composition, documentation, and retired-Testnet scope.

## Completion record

Completed: 2026-07-16

### Delivered behavior

- The application selector, renderer bridge, Electron startup/composition, local
  WebSocket router, build aliases, active tests, and operator runbook now expose
  only `Spot` and `Futures Live`.
- Every legacy `FUTURES_TESTNET_*` and `FUTURES_READ_*` process value is scrubbed
  before renderer access. Retired `futures.execution.*`, `futures.read.*`,
  `futures.testnet.*`, and `futures-testnet-workstation` frames are rejected
  before generic JSON/Spot routing, including Unicode-escaped action prefixes.
- Testnet-only sources and tests were removed from active application paths.
  [`archive/futures-testnet/MANIFEST.md`](../archive/futures-testnet/MANIFEST.md)
  records the exact Git baseline and recovery inventory without leaving an
  importable copy of unmaintained trading code in the package.
- Production public `exchangeInfo` now has a five-minute main-process cache,
  concurrent-request deduplication, caller-abort isolation, expiry refresh, and
  no stale-on-error fallback. It is not imported by production execution/risk.
- The six independent bootstrap reads now run through the existing weighted
  budget at maximum concurrency `3`. A first failure aborts active work, removes
  queued work before another dispatch, and preserves the originating error.
- Catalog chunks are buffered and reduced into React state once at completion.
  Per-resource state can render a valid panel while aggregate readiness remains
  loading/resynchronizing.
- Interval selection no longer emits an intermediate unsubscribe or remounts the
  workstation. Same-symbol catalog/header/depth/trades remain visible as stale
  while the new candle generation loads; candle data is cleared to avoid showing
  the previous interval as current. The view key is the symbol only, so a symbol
  ownership change still resets local drafts, drawings, alerts, and paused tape.
- Redacted timing records cover `exchange-info` (hit/miss/shared),
  `upstream-streams`, every bootstrap resource, and `aggregate-ready`. Their
  exact fields are only `phase`, `durationMs`, `outcome`, and `cache`.
- Production and E2E builds clean `dist/` and `dist-electron/` before Vite runs.
  The post-build gate permits only the current Electron `main.js` and
  `preload.cjs`, rejects retired implementation signatures, and `npm run dist`
  always performs a fresh production build first.

### Pre-commit audit findings

The final read-only audit found and closed four issues before commit:

1. Removing the former `symbol:interval` React key also preserved display-only
   state across a symbol change. The key is now symbol-only: interval changes do
   not remount, while BTC→ETH ownership changes reset all local display state.
2. A pre-aborted exchange-info caller could start a shared network request, and
   an abort racing a warm-cache hit was reported as `ok`. Pre-aborted calls now
   dispatch nothing, and hit/shared caller cancellation reports `error` without
   invalidating or cancelling the shared catalog value.
3. The active Phase 7 threat model still described Testnet as an operator
   checkpoint and coexisting runtime. It now describes the supported
   Spot→full-stop→Live workflow; historical ADR/roadmap statements remain
   explicitly marked historical.
4. Nine ignored stale Electron JavaScript artifacts from older builds still
   contained the retired Testnet implementation. The new clean/post-build gate
   reproduced the failure, removed those generated artifacts, and verified a
   two-file Electron output. This prevents dead Testnet code from entering a
   later `electron-builder` package through a dirty build directory.

### Deterministic performance evidence

No real Binance Futures network benchmark was run in this implementation
session. The verified structural improvement for the six-request REST segment is:

- before: concurrency `1`, therefore six equal-latency reads require roughly
  `6 × L` after stream readiness;
- after: concurrency `3`, therefore the same reads require roughly two waves,
  `2 × L` (up to about a 67% reduction for this segment; real improvement
  depends on route latency, proxy, rate admission, and exchange response time);
- warm catalog: zero exchange-info network dispatches inside the five-minute TTL;
- concurrent cold catalog consumers: one shared network dispatch;
- large catalog: `N` backend frames but one renderer state reduction at completion.

The application now emits the safe timing phases needed to measure actual cold
and warm operator runs without logging URLs, headers, credentials, account data,
or response bodies.

### Verification record

- `npm test`: `68/68` files, `821` passed, `2` established skips (`823` total).
- `npm run lint`: passed (only the dependency's existing
  `baseline-browser-mapping` age notice).
- `npm audit --omit=dev --offline`: `0` vulnerabilities.
- `npm run check:circular`: passed across `181` source files.
- `npm run check:futures-production`: both production and workstation boundary
  scans passed; the workstation scan covers `23` active isolated files.
- `npm run build`: production renderer, Electron main, and preload passed. Vite
  retained its existing chunk-size advisory; the artifact boundary passed with
  exactly `2` Electron files.
- `npm run test:e2e`: E2E build plus all `14/14` Electron Playwright tests passed,
  including absence of the Testnet selector and a Live interval generation
  switch plus BTC→ETH local-state ownership reset. The production build was
  restored after E2E. No real Binance Futures request or order was used.
- `git diff --check`: passed.

### GitNexus final scope

The historical audit used `detect_changes(scope="compare", base_ref="main")`
before this repository adopted its `master`-only policy. It reported `162`
files, `1191` indexed symbols, `163` processes, `CRITICAL` because the legacy
`main` ref predated the complete Futures work; it was not an isolated estimate
of this phase. All current and future comparisons must use `base_ref="master"`
as required by [Repository workflow](repository_workflow.md).

The final pre-commit `detect_changes(scope="staged")` comparison against `HEAD`
reports `116` indexed files, `394` indexed symbols, `30` processes, `CRITICAL`.
The threshold is driven by the intentional removal of a complete environment
and by GitNexus mapping every symbol in a changed file, not only changed lines.
The 30 processes classify as:

- `17` expected Production workstation bootstrap/stream/transport flows;
- `3` renderer-runtime normalization flows from removal of the Testnet field;
- `7` conservative Electron setup/Spot-stream/subscription flows because
  `binance-connection.js` changed;
- `2` conservative `DataProvider` flows because its retired-channel branch was
  removed;
- `1` false-positive `CancelAllOpenOrders → Update` attribution to the unchanged
  `DepthCache.update` method in `binance-connection.js`.

Production execution/risk symbols were not edited. Their boundary, service,
protocol, activation, facade, coordinator, ledger, and E2E regressions all pass.

### Remaining risks and follow-up

- Actual cold/warm wall-clock numbers require a separately authorized operator
  run against the reviewed public production endpoints; deterministic tests do
  not claim real Internet latency.
- An interval change still starts a safe full backend generation because the
  current transport owns depth and interval market streams as one connection.
  The UI no longer blanks and the reads are parallel, but a future reviewed
  split-stream design could avoid unrelated depth/ticker bootstrap work.
- The cache is deliberately process-memory-only. Restarting Electron performs a
  cold catalog read, and failed refreshes remain explicit rather than serving an
  indefinitely stale catalog.

The historical, now-obsolete role-based handoff is retained in
[`docs/next_session_prompt_futures_live.md`](./next_session_prompt_futures_live.md).
