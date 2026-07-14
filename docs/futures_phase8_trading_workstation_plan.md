# Phase 8 Plan: USDⓈ-M Futures Trading Workstation

Date: 2026-07-14

Status: Phase 8.0–8.2 complete; Phase 8.3–8.7 remain planned

Planning base: `dcd2260c5aed73b268a6e1f12cac2c3cb8849873` (`Add guarded UI arming for live Futures`)

## Outcome

Build a complete desktop USDⓈ-M Futures trading workstation with functional parity with the core Binance Futures trading screen: instrument navigation, live market context, chart, order book, trades, order entry, positions, orders, history, account risk, and explicit safety controls.

The current Phase 7 renderer is intentionally only a guarded production execution and recovery ticket. It is not a trading workstation. It has no instrument selector, candles, order book, trade tape, real-time account tables, or full order composer. Phase 8 replaces that operator experience with an integrated workspace while retaining the Phase 7 ticket as the production safety and recovery surface.

“Functional parity” means equivalent core trading workflows and exchange-supported semantics, not copied Binance source code, assets, trade dress, layout pixels, private web endpoints, or undocumented behavior. The application keeps its own visual system, with unmistakable blue Testnet and red Live environments.

The capability baseline is the documented Binance USDⓈ-M API surface reviewed on 2026-07-14. Every implementation slice must recheck the official contract because endpoints, order types, weights, and stream behavior can change.

### Phase 8.0–8.2 implementation record (2026-07-14)

- [x] The separate [Phase 8 workstation ADR](./futures_phase8_workstation_adr.md) and [threat model](./futures_phase8_workstation_threat_model.md) freeze the current official public-read HTTPS/WSS origins, routed stream paths, REST routes and weights, exact schemas, freshness thresholds, generation/revision ownership, bounds and route classification.
- [x] Testnet and Production have separately named containers, hooks, protocols, channels, services, fixtures, transports and backend compositions. The normal operator build is source-pinned to both reviewed public-read transports; safe-dev, smoke, E2E and Vitest builds use separately named deterministic environment-specific compositions.
- [x] Reviewed Node transports honor the operator's backend HTTP(S)/SOCKS proxy with separately resolved environment-owned agents shared only between that transport's exact HTTPS and WSS routes. Renderer/caller proxy options remain ignored, malformed proxy configuration fails closed and agent teardown is bounded.
- [x] The shared React view/chart boundary is presentation-only. It receives immutable normalized resources and cannot choose an environment, host, transport, credential, protocol, capability or storage namespace. Spot `DataContext`, command builders, shortcuts and legacy aliases remain outside the Futures workstation.
- [x] Both workspaces provide the Futures-only selector/search, allowlist/status/filter inspector, last/mark/index/exact basis/24h/funding header, funding countdown, bounded candles and volume, REST-bootstrapped mark/index overlays, drawing/display-alert tools, authoritative snapshot-plus-diff order book and bounded aggregate-trade tape.
- [x] Depth validates the official bootstrap bridge and continuous `pu` chain, rejects gaps/duplicates/reordering/crossed books/overflow, and returns to LIVE only after resnapshot. Symbol/interval changes and reconnects use generation ownership; late owners cannot mutate the selected view.
- [x] Loading, stale, disconnected, resynchronizing and unavailable states remain explicit. Blue/red identity is permanently visible at desktop and narrow widths. Phase 5/6 and Phase 7 tickets remain open safety drawers.
- [x] Chart/order-book clicks create only a component-local display draft. The workstation protocols contain only subscribe/select/unsubscribe/resource actions; no Enter handler or new Live execution action exists.
- [x] Node HTTP(S), fetch and Electron E2E tripwires terminate on a Binance Futures network escape. Expanded static scans pin exact public-read routes/hosts/options and reject credentials, writes, caller network options, renderer network/storage, Spot coupling and environment crossing.
- [x] Final fake-only verification passed `88` Vitest files / `2781` tests with the established `2` skips, ESLint, production and E2E builds, all `15` Electron Playwright scenarios, `228`-file circular-import scan, legacy Phase 7 production scan across `36` files, and Phase 8 scan across `28` files. Four blue/red desktop/narrow screenshots were attached to Playwright evidence; the bounded `npm run e:smoke` path also rendered under strict CSP without the prior React-preamble black screen. Operator follow-up restored `npm run e` as the normal persistent launch and retained persistent fake-only verification as `npm run e:safe`.
- [x] No live credential was loaded and no real Binance Futures request was sent during implementation or automated verification. Both credential-free public-read operator compositions are source-pinned active; no production write/action family was added or enabled.

Residual boundary: real public-read acceptance remains an operator-run manual checkpoint because automated verification is fail-fast fake-only. Contract candles stream continuously; historical mark/index overlays use the reviewed REST kline routes and current mark/index price lines use `markPrice@1s`, because the reviewed USDⓈ-M stream catalog does not define separate mark/index kline streams for this milestone.

The public-read activation checkpoint passed `92/92` Vitest files with `2818` passed tests and the same `2` established skips, ESLint, both production and E2E builds, all `16/16` Electron Playwright scenarios, the `239`-source circular scan, production/workstation boundary scans over `43` and `33` isolated files, and the bounded `SAFE_SMOKE_READY` launch. Bundle inspection proved that the normal Electron main contains both reviewed public-read compositions and no deterministic workstation mode, while the E2E Electron main contains deterministic workstation modes and no reviewed workstation mode. No real Futures request or credential was used.

The backend-proxy correction passed `92/92` Vitest files with `2824` passed tests and the same `2` established skips, ESLint, both builds, all `16/16` Electron Playwright scenarios, the unchanged `239`-source circular scan, both boundary scans and `SAFE_SMOKE_READY`. The operator view now renders the normalized unavailable reason code. Automated verification remained fake-only and made no Binance Futures request.

## Scope boundary

Phase 8 covers the core USDⓈ-M trading terminal:

- perpetual contract discovery and symbol search;
- market header, funding and contract metadata;
- candlestick chart and overlays;
- local order book and recent trades;
- futures wallet, margin and risk state;
- positions, regular orders, algo/conditional orders, fills and income history;
- basic and advanced order composition;
- explicit per-order cancellation, amendment where officially supported, and position-reduction controls;
- account trading configuration only through separately reviewed actions;
- alerts, calculators, layout preferences, recovery state and audit visibility.

The following are not part of core workstation parity and require later product decisions: COIN-M Futures, Options, Portfolio Margin, Portfolio Margin Pro, copy trading, strategy/grid bots, leaderboards, social feeds, promotions, deposits, withdrawals, transfers, loans, referral surfaces, and undocumented Binance web APIs.

## Non-negotiable inherited boundaries

1. Phase 5 remains a frozen read-only subsystem. Phase 8 does not turn it into a live/testnet mode or add execution to it.
2. Phase 6 remains a frozen reduce-only Testnet execution subsystem and regression oracle. Expanded Testnet trading receives separately named Phase 8 composition, credentials, protocol/actions, channels, storage, locks, audit and recovery. It does not add an enum or order types to Phase 6.
3. Phase 7 remains the production authorization, exact-risk, intent, durable dispatch, audit, quota, kill-switch and recovery kernel. New production capabilities cannot bypass its gates or create a second weaker production write path.
4. Spot remains unchanged and retains priority. Futures code stays outside Spot `DataContext`, Spot command builders, legacy aliases and global shortcuts.
5. Testnet and Live never select a host, credential set, protocol, service, ledger or recovery namespace through a shared environment parameter. Their backend compositions remain structurally separate.
6. Only pure presentational components, exact immutable view-model schemas, and non-authoritative formatting primitives may be shared across the two Futures workspaces.
7. Credentials, signatures, signed URLs/bodies, request headers and raw private responses never reach renderer state, browser storage, logs, analytics, telemetry, clipboard or crash reporting.
8. Automated development and verification use deterministic backend fakes and production-network escape guards. The normal operator build may perform the activated credential-free public reads; any private request or write action still requires a separate explicit authorization and the inherited safety gates.
9. Exact decimals remain canonical strings or backend fixed-point `BigInt` values. Exchange int64 identities remain lossless strings. No risk, quantity, price, notional, PnL or margin decision uses binary floating-point arithmetic.
10. Every write uses an action-specific backend one-use intent, current revision, mutex/idempotency protection, durable dispatch state and explicit reconciliation. An order POST is never retried.

## Target desktop layout

```text
┌─ SPOT ─┬─ FUTURES TESTNET (blue) ─┬─ FUTURES LIVE (red) ─────────────┐
│ symbol/search │ last · mark · index · 24h · funding · countdown       │
├───────────────┬───────────────────────────────────┬────────────────────┤
│ watchlist     │ chart + drawings + order/position│ order book         │
│ and contracts │ overlays                         ├────────────────────┤
│               │                                  │ recent trades      │
├───────────────┴───────────────────────────────────┼────────────────────┤
│ positions │ open orders │ conditional │ history │ order composer     │
│ fills │ income │ wallet/risk                     │ safety + submit    │
└───────────────────────────────────────────────────┴────────────────────┘
```

The mode labels remain centered tabs that visually project from the top edge. Testnet uses a blue shell and always says `SIMULATED FUNDS · TESTNET`; Live uses a red shell and always says `REAL MONEY · PRODUCTION`. Environment identity remains visible even in dialogs, confirmations and narrow layouts.

The production safety rail always exposes backend-owned account alias/fingerprint, configured caps, daily usage, kill-switch state, recovery state, pending/unknown state and the ARM/LOCK control. It may collapse visually, but it may not be removed or replaced with renderer assumptions.

## Functional parity matrix

| Surface | Required capability | Delivery slice |
|---|---|---|
| Workspace shell | Resizable desktop grid, persistent non-secret layout, blue/red environment chrome, loading/stale/offline states | 8.1 |
| Instruments | Futures-only symbol search, favorites, contract status, quote/base/margin assets, allowlist and tradability indicators | 8.1 |
| Market header | Last, mark, index, 24h change/high/low/volume, funding rate/countdown, basis and contract status | 8.1 |
| Chart | Candles, volume, current/mark/index price, intervals, drawings, indicators, alerts, order and position overlays | 8.2 |
| Order book | Snapshot plus diff-stream continuity, grouping, cumulative depth, spread, precision controls and click-to-fill | 8.2 |
| Trade tape | Bounded aggregate trades, maker/taker direction, exact price/quantity/time and pause/resume | 8.2 |
| Account strip | Wallet balance, available balance, margin balance, unrealized PnL, margin ratio and explicit stale time | 8.3 |
| Positions | Side/mode, size, entry, break-even, mark, liquidation, leverage, margin, PnL/ROE and isolated/cross state | 8.3 |
| Open orders | Regular and algo inventories with exact status/type/TIF/trigger/reduce-only fields and per-row cancel capability | 8.3, 8.5 |
| History | Order history, fills/trades, realized PnL, commissions, funding and income with bounded pagination | 8.3, 8.7 |
| Basic order entry | LIMIT and MARKET, exact quantity/notional, percentage control, reduce-only, TIF where applicable, fee/risk preview | 8.4 |
| Conditional orders | STOP, STOP_MARKET, TAKE_PROFIT, TAKE_PROFIT_MARKET and TRAILING_STOP_MARKET through the currently documented regular/algo contracts | 8.5 |
| Trigger controls | Mark/contract working price, price protection, stop/activation/callback inputs, close-position semantics | 8.5 |
| Order management | Cancel one, cancel selected, separate regular/algo cancel-all, and true amend only where the official API proves atomic semantics | 8.5 |
| Position controls | Partial reduce, market/limit close, TP/SL, reverse preview, separate close-all and exact partial/unknown outcomes | 8.6 |
| Account settings | Read and deliberately change leverage, isolated/cross margin and one-way/hedge mode only in separately authorized slices | 8.6 |
| Tools | PnL, target-price, liquidation and max-position calculators using the same exact backend risk model | 8.7 |
| Operations | Kill switch, recovery, reconciliation, stream health, quota pauses and bounded redacted audit timeline | every slice |

Feature presence in the renderer never implies backend capability. Unsupported, blocked, stale or unauthorized controls remain visibly unavailable with a backend-owned reason code.

## Architecture

### Separate containers, shared presentation

`FuturesTestnetWorkstation` and `FuturesProductionWorkstation` are different top-level containers with different hooks and channels. They may render pure components such as `FuturesChartView`, `FuturesOrderBookView`, `FuturesPositionsTable` and `FuturesOrderComposer`, but each component receives immutable normalized props and emits local UI drafts only.

No shared component may:

- choose Testnet versus Live;
- own a host, credential, transport, storage path or exchange action;
- send a WebSocket/IPC command directly;
- read Spot `DataContext` or browser storage for financial state;
- decide capability, exposure class, margin, leverage, notional, liquidation risk or success;
- map a generic submit event to an execution action.

The environment-specific container converts drafts into its exact, separately named backend protocol. This keeps visual parity without turning backend safety boundaries into a mode switch.

### Read models

Each backend composition produces revisioned snapshots and bounded events for:

- instrument catalog and exact filters;
- ticker/header state;
- candles and selected chart overlays;
- depth snapshot/deltas and continuity status;
- aggregate trades;
- account/wallet risk;
- positions;
- regular orders and algo orders;
- fills, order history and income;
- execution capabilities, intents, attempts, reconciliation and recovery.

Every snapshot includes environment identity, account binding where private, observation time, freshness state and monotonically comparable revision. Renderer reducers reject duplicate, stale, wrong-symbol, wrong-environment and wrong-account events.

Public high-frequency ticks are not copied into the durable production execution journal. Their connection, resync, overflow and corruption transitions use bounded operational records. Every private command, capability decision, account mutation, execution request/response classification, user-data reconciliation and recovery action remains durably audited under the applicable execution boundary.

### Market data

The market-data implementation is backend-owned. The renderer never opens a Binance socket.

- Candles use reviewed Futures REST bootstrap plus the exact Futures kline stream.
- The local order book follows the official snapshot-plus-diff sequence contract, validates update IDs, detects gaps and resynchronizes instead of displaying uncertain depth.
- Aggregate trades, mark/index/funding and ticker streams are bounded by item count, message bytes, event age and update rate.
- Symbol switches use generation ownership. Late events from an old symbol cannot mutate the new symbol.
- Reconnect starts stale, rebuilds authoritative snapshots, then becomes live; cached values never appear as current without a stale marker.
- Testnet and production public transports use separately reviewed exact HTTPS/WSS hosts and path allowlists with redirect rejection and no caller network options.

### Private account stream

Phase 8 requires a separately reviewed backend-only private account stream for timely order, fill, balance, margin and position updates. The design checkpoint must select only the currently documented Binance mechanism and exact production/testnet endpoints.

- Listen-key/session material never enters renderer state or logs.
- Initial REST snapshots and stream events reduce into one revisioned account model.
- Sequence gap, expiry, disconnect, overflow, unknown event or schema drift makes affected state stale and starts bounded snapshot reconciliation.
- Stream events can confirm an order only after exact account, symbol, client ID/order ID and state validation.
- Stream disconnect never means cancel, reject, fill or close.
- Phase 7 Query Order and durable unknown-outcome recovery remain authoritative for ambiguous production writes.

### Execution expansion

Every new order family or account mutation is an explicit action family with its own schema, intent kind, confirmation challenge, risk evaluator, durable dispatch transition, reconciliation contract, audit events and adversarial tests. Generic typed Futures commands and legacy aliases remain forbidden.

Phase 8 initially consumes the existing Phase 7 production `LIMIT/GTC` path. MARKET opening, conditional/algo orders, individual cancel, amendment, leverage, margin type and position-mode changes are separate production write checkpoints. None becomes Live-capable merely because its Testnet UI exists.

For an ambiguous write:

1. persist dispatch intent and exact client identity;
2. invoke the write once;
3. never retry it;
4. mark the result unknown when acceptance is not proven;
5. reconcile through the exact official query/user-data contract;
6. retain the durable block when the outcome cannot be proven.

Cancel, amend, close, TP/SL, reverse, leverage and margin actions never infer success from an HTTP acknowledgement or a sibling action.

## Delivery slices

Each slice is code-complete vertically: backend fake, exact protocol, renderer, deterministic tests, visual evidence, isolation scans and regression suite land together. Testnet manual review precedes the corresponding Live capability.

### 8.0 Contract freeze and safety design

- Create the Phase 8 ADR and threat model.
- Freeze the official feature/endpoint/stream inventory and mark every capability as public read, private read, order write, safety write or account-configuration write.
- Define separately named Testnet and production read-model protocols, channel budgets and fake clocks/transports.
- Define the pure shared component boundary and prove it contains no environment selection or network authority.
- Record exact performance budgets, stale thresholds, queue limits, audit limits and recovery ownership.

Exit: reviewed ADR, threat model, endpoint/stream registry, fake fixtures and production-network tripwire; no visible or live behavior change.

### 8.1 Workstation shell and instruments

- Replace the single-column Testnet/Live pages with the target grid shell.
- Add futures-only instrument search, allowlist state, favorites and symbol switching.
- Add the complete market header and contract/filter inspector.
- Keep the existing Phase 6 and Phase 7 tickets mounted as explicit safety drawers while the new order composer is not yet active.
- Add desktop/narrow-window keyboard and focus rules; no generic Enter submits an order.

Exit: both blue and red workspaces are unmistakable, navigable and useful read-only shells against deterministic fakes.

### 8.2 Chart, order book and trade tape

- Add Futures candles, volume, mark/index overlays, intervals, drawings and alerts.
- Add a gap-detecting local Futures order book with bounded depth and resync.
- Add aggregate trades and click-to-fill drafts without submission authority.
- Reuse existing chart/order-book presentation only after extracting Spot assumptions behind pure props; Spot behavior and storage remain unchanged.

Exit: symbol changes, reconnects, out-of-order deltas, gaps, bursts and stale recovery are deterministic; no Futures execution action exists in these widgets.

### 8.3 Account, positions, orders and history

- Add backend-only private account-stream composition and authoritative snapshot recovery.
- Render wallet/risk strip, positions, regular/algo open orders, fills, history and income tabs.
- Overlay positions and confirmed orders on the chart.
- Add bounded pagination and exact UTC timestamps.
- Surface UNKNOWN, reconciliation and recovery states next to affected rows rather than only in the safety ticket.

Exit: disconnect/reconnect, missing events, duplicate events, reordering, credential rotation and snapshot conflicts fail stale/closed and recover deterministically.

### 8.4 Basic trading workflow

- Build the Binance-class order composer UX: side, LIMIT/MARKET tabs, exact quantity/notional, percentage control, price, TIF, reduce-only and fee/risk preview.
- Wire Testnet through the new Phase 8 Testnet execution boundary; keep Phase 6 unchanged.
- Wire Live LIMIT/GTC only through the existing Phase 7 production intent and gate kernel.
- Require deliberate action-specific confirmation, prevent double submit and retain the persistent kill switch.
- Allow order-book/chart clicks to populate drafts only.

Exit: full fake matrix, Testnet manual execution review, then separately authorized minimal Live LIMIT review under the existing compiled caps. MARKET opening stays Live-disabled until its own checkpoint.

### 8.5 Conditional orders and order management

- Add the currently documented STOP, STOP_MARKET, TAKE_PROFIT, TAKE_PROFIT_MARKET and TRAILING_STOP_MARKET contracts.
- Add working price, price protection, activation price, callback rate, close-position and supported TIF controls.
- Add per-order cancel, selected cancel, separate regular/algo cancel-all and officially supported amend.
- Treat regular versus algo storage, identifiers, events, queries and partial outcomes independently.
- Implement and validate on Testnet first. Each Live order/action family requires its own production authorization and rollout evidence.

Exit: every type has exact filter boundaries, trigger semantics, ambiguity/reconciliation tests and zero write retries.

### 8.6 Position and account configuration

- Add partial close, limit/market close, position TP/SL and reverse preview as distinct actions.
- Keep close-all separate from cancel-all and report every child outcome.
- Add leverage, isolated/cross margin and one-way/hedge controls only after dedicated ADR amendments explain their effect on Phase 7 risk classification and hard caps.
- Block mode/margin/leverage changes while incompatible positions, orders, unknown outcomes or recovery state exist.
- Testnet comes first; every production mutation remains disabled until explicitly authorized.

Exit: account-setting and position-action concurrency, partial failure, restart and credential-rotation matrices pass without weakening the kill switch or caps.

### 8.7 Histories, calculators and parity closure

- Complete order/fill/income/funding/commission history and export of redacted non-secret data.
- Add PnL, target-price, liquidation and max-position calculators backed by the exact risk model.
- Add saved non-secret layout, favorites, display precision and alert preferences in an environment-namespaced renderer store.
- Close accessibility, keyboard, responsive layout and sustained-load performance gaps.
- Run the final feature matrix against the reviewed Binance capability baseline and document intentional exclusions.

Exit: every in-scope matrix row is demonstrated in deterministic E2E and manual Testnet evidence; separately authorized Live rows are demonstrated one at a time.

## Test and audit matrix

Every slice adds deterministic adversarial coverage for its own surface and reruns inherited regression:

- all gate/cap/kill/recovery combinations and accidental activation;
- exact decimal, tick, step, notional, leverage, margin and int64 boundaries;
- rapid symbol switching, stale generations and late events;
- depth bootstrap race, gap, duplicate, reorder, overflow and resync;
- candle/trade burst limits, malformed frames and clock regression;
- private-stream expiry, duplicate/out-of-order events, snapshot conflict and credential rotation;
- order-type field matrix, TIF/trigger/working-price/price-protection compatibility;
- click, keyboard, focus, double-submit and stale-revision attacks;
- crash before/after durable intent, dispatch, acknowledgement and reconciliation;
- ambiguous writes with exactly zero POST retries;
- regular/algo and parent/child partial outcomes;
- renderer/storage/shortcut/analytics/telemetry/clipboard/crash-log credential isolation;
- Testnet/production host, protocol, channel, credentials, storage and recovery isolation;
- Spot priority and full Spot/Phase 5/Phase 6/Phase 7 regression;
- a fail-fast guard if any automated production request escapes the fake layer.

Required completion commands remain:

- full Vitest suite with only established reviewed skips;
- `npm run lint`;
- `npm run build` and `npm run build:e2e`;
- Electron Playwright, including blue/red screenshot and interaction coverage;
- `npm run check:circular`;
- `npm run check:futures-production` plus expanded route/host/credential/write/storage/isolation scans;
- GitNexus upstream impact before every existing-symbol edit;
- GitNexus `detect_changes` for the slice base, Phase 6 base `36681f0`, and `main` before commit.

No automated test may use a live credential or perform a real production read, order, cancellation, amendment, account mutation or position close.

## Review and rollout protocol

1. Land the fake-backed vertical slice with all automated evidence.
2. Review desktop screenshots and exact backend capability/status output.
3. Manually verify Spot first.
4. Manually verify the corresponding blue Testnet workflow.
5. Stop the app and inspect the red Live identity, caps, kill switch, recovery and audit state.
6. Obtain explicit authorization for the exact new Live read/write action family.
7. Run the smallest bounded Live scenario; never batch-enable unrelated actions.
8. Re-engage the kill switch and record the result and residual risk.

Authorization for one Live feature does not authorize the next feature, higher leverage, larger caps, another symbol, another account mode, or a broader host/transport surface.

## Definition of done

Phase 8 is complete when:

- every in-scope functional parity row is implemented or explicitly documented as an intentional API/product exclusion;
- Testnet and Live provide the same coherent workstation UX while retaining separately composed backend authority;
- Spot, Phase 5, Phase 6 and the Phase 7 safety kernel retain their documented behavior and regression evidence;
- every production action remains backend-gated, exact, durable, idempotent, reconciled and audit-redacted;
- unknown, partial, stale, disconnected and recovery states are visible and never styled as success;
- sustained market/account streams remain bounded and recover exactly after gaps, reconnect, restart and teardown;
- automated verification proves zero escaped production network requests;
- the worktree is clean and each reviewed slice has a traceable commit, test record, GitNexus impact report and residual-risk note.

## Start here next

Begin with slice 8.0, then deliver 8.1 and 8.2 as the first visible milestone. That milestone gives both Testnet and Live the missing symbol selector, market header, chart, order book and trade tape while remaining read-only. Do not expand production writes until this market-context layer and the private account read model are stable.

## Official reference set

- [USDⓈ-M Futures product documentation](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/Introduction)
- [USDⓈ-M General Info](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info)
- [USDⓈ-M User Data Streams](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/user-data-streams)
- [Binance API Reference catalog](https://developers.binance.com/en/docs/catalog)
- [Official Binance Connector JS: USDⓈ-M Futures](https://binance.github.io/binance-connector-js/modules/_binance_derivatives-trading-usds-futures.html)
