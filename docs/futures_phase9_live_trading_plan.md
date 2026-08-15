# Futures Phase 9 — Live trading workstation plan

## Outcome

Turn the existing read-only Futures workstation and its separate production safety drawer into one operator workspace while preserving the Phase 7 fail-closed execution boundary.

The visible product name is `Futures`. Production trading is allowed only when the account and selected symbol satisfy the compiled profile:

- Binance USDⓈ-M production;
- Hedge Mode enabled at account level;
- isolated margin on the selected symbol;
- initial leverage exactly `2x`;
- the existing production notional and daily caps remain enforced until a separate risk review changes them.

No UI gesture may send an exchange write directly. A gesture creates a draft or a one-use intent; the existing server-side preflight, durable journal, exact typed confirmation, zero-POST-retry policy, reconciliation, kill switch, and UNKNOWN-result blocking remain authoritative.

## Current baseline and required migration

Phase 7 deliberately compiled the execution service for isolated `1x`, One-way Mode (`positionSide=BOTH`), and `reduceOnly` exits. That contract cannot be patched only in React:

- Hedge Mode requires an explicit `LONG` or `SHORT` position side;
- Binance does not accept `reduceOnly` in Hedge Mode;
- an exit therefore has to be proven by the backend against the fresh quantity of the selected leg, so that an oversized exit cannot become new exposure;
- account position mode is global and cannot be changed safely while positions or open orders exist;
- isolated margin and leverage are symbol settings and must be verified before every destructive intent.

Phase 9 is therefore a protocol, risk, service, recovery, and UI migration. The workstation stays fail-closed until all layers agree on the new profile.

## Operator layout

Use a three-column desktop workspace with a compact fallback for narrow windows:

1. **Market rail** — symbol search and compact watch list. Remove the verbose filter/debug inspector from the primary surface.
2. **Chart and depth** — chart, interval controls, order book, open-order overlays, and direct price selection.
3. **Trading rail** — always-visible order ticket, size slider, position/order tabs, account-profile gate, and compact safety controls.

The existing `Safety Drawer` is not deleted. It contains the real production interlocks, recovery state, kill switch, and destructive bulk actions. It is redesigned as:

- a compact readiness header in the trading rail;
- blocking failures shown next to the control they disable;
- an `Advanced safety` disclosure for identity details, recovery diagnostics, caps, cancel-all, close-all, and kill-switch controls;
- no permanently open wall of status data below the workstation.

## Price selection and order ticket

- A normal chart click selects the nearest valid limit price and shows a crosshair/price marker.
- A normal order-book row click selects that exact book price.
- Price is normalized with exact decimal arithmetic to Binance tick size. No execution value is derived through JavaScript floating-point arithmetic.
- The ticket shows symbol, intent, side, position side, limit price, quantity, notional in USDT, estimated isolated margin at `2x`, percentage, and applicable caps.
- A selected price is only a draft until an intent is prepared and confirmed.

### Shift price measurement

Restore the Spot-style price measurement interaction in the Futures chart:

- holding `Shift` and moving the pointer starts and updates a chart measurement;
- the overlay shows signed price delta, signed percentage delta, and time delta when horizontal movement is meaningful;
- releasing `Shift`, pressing `Escape`, leaving the chart, or opening another modal clears the measurement;
- measurement is display-only and never selects an order price;
- `Shift` is reserved for measurement, so `Shift+Alt` and `Shift+Ctrl` can never activate a trading shortcut.

### Size model

The trading rail contains a USDT amount field and a synchronized percentage slider with `0 / 25 / 50 / 75 / 100` anchors.

- For entry intents, percentage is based on the backend-provided safe notional budget: the minimum of available isolated buying power and the remaining compiled order/daily limits.
- For exit intents, percentage is based only on the fresh quantity of the selected `LONG` or `SHORT` leg.
- The displayed USDT value is order notional; estimated margin is displayed separately as notional divided by `2`, before fees.
- Quantity is conservatively derived from limit/mark price, normalized down to step size, then checked against min quantity, min notional, max quantity, and the compiled caps.
- `100%` never rounds upward and never exceeds the selected position leg or safe entry budget.

## Keyboard and mouse intents

Shortcuts mirror the useful Spot gestures but create Futures intents rather than submitting an order:

| Gesture | Side | Position side | Meaning |
|---|---|---|---|
| `Alt` + double left click | `BUY` | `LONG` | enter/increase long |
| `Alt` + double right click | `SELL` | `LONG` | exit/reduce long |
| `Ctrl` + double right click | `SELL` | `SHORT` | enter/increase short |
| `Ctrl` + double left click | `BUY` | `SHORT` | exit/reduce short |

The chart price under the pointer or the clicked order-book row becomes the draft price. The amount comes from the persistent slider/ticket. A gesture opens/focuses the confirmation state with an unambiguous human-readable summary. It never bypasses typed confirmation.

Input safety rules:

- gestures are ignored while focus is in an input, select, textarea, modal, or content-editable element;
- only the exact modifier is accepted; ambiguous modifier combinations are rejected;
- browser context menu suppression is scoped to the recognized right-double-click gesture;
- stale market data, missing price, zero amount, profile mismatch, active UNKNOWN operation, kill switch, or failed preflight makes the gesture non-destructive and explains why;
- a new draft invalidates any previously prepared one-use intent.

## Moving open orders

`Ctrl` or `Alt` plus drag on an owned, confirmed, still-open LIMIT order moves its price marker. The modifier selects the corresponding position leg; it does not change the order's side, `positionSide`, quantity, or intent.

The implementation must use Binance's atomic order-modification endpoint (`PUT /fapi/v1/order`) rather than Spot's cancel-then-recreate pattern. The backend must:

1. query and reconcile the order immediately before modification;
2. require the order to be an app-owned LIMIT order in a modifiable state;
3. preserve symbol, side, position side, time-in-force, and client ownership identity;
4. normalize the new price to tick size and re-run price-band/risk checks;
5. ensure remaining/new quantity is greater than executed quantity, because an invalid amendment can cancel a partially filled order;
6. issue one durable, one-use amend intent with no automatic PUT retry;
7. query the order after a response or ambiguous transport result and block further writes while outcome is UNKNOWN.

Dragging only renders a preview. Releasing prepares the amendment and presents exact confirmation; it does not modify the order directly.

## Positions and isolated margin

Add a `Positions` tab in the trading rail. Each non-zero hedge leg is a separate row keyed by `symbol + positionSide` and shows:

- quantity, entry and mark price;
- notional and unrealized PnL;
- isolated wallet/margin, liquidation price, leverage, and margin mode;
- `Add margin` and `Reduce margin` actions.

The margin dialog accepts an exact USDT amount and shows the projected isolated margin. It uses a separate durable intent and typed confirmation.

- Binance `type=1` adds isolated margin and `type=2` reduces it.
- `positionSide=LONG|SHORT` is mandatory in Hedge Mode.
- Only isolated positions are eligible.
- The service fetches fresh position risk and account configuration before the write.
- Reduction is bounded conservatively and exchange rejection is treated as safe failure.
- POST is never retried automatically. The service reconciles position risk and isolated-margin history after success or ambiguity; UNKNOWN blocks subsequent writes.

## Account-profile gate

Readiness is computed server-side, not inferred from React state.

- `Hedge Mode`, isolated margin, and exactly `2x` are hard requirements for placing, amending, or adjusting margin.
- A mismatch blocks trading and names the exact mismatch.
- Profile setup is an explicit advanced action with its own typed confirmation; it is never run on page load or symbol selection.
- Enabling Hedge Mode is offered only when the entire Futures account is flat and has no open standard or algo orders.
- Setting isolated margin or `2x` leverage is offered per symbol only after fresh checks; a response is reconciled before the symbol becomes ready.
- Existing positions/orders created under an incompatible profile remain visible, but normal shortcut execution stays blocked and only separately reviewed recovery actions are allowed.

## Backend and protocol work

1. Bump the renderer/main protocol version and add exact enums for `positionSide`, order intent (`ENTRY|EXIT`), amend, margin adjustment, and profile setup.
2. Extend strict parsers on both sides; reject extra fields, aliases, missing hedge-leg identity, non-canonical decimals, and oversized frames.
3. Extend the facade with the minimum signed REST endpoints: position mode, margin type, leverage, order modification, isolated-margin modification/history, and any required fresh account/position queries.
4. Extend coordinator endpoint IDs, weights, deadlines, serialization, and zero-retry write semantics.
5. Replace signed One-way exposure classification with explicit `LONG`/`SHORT` leg accounting. EXIT quantity must be less than or equal to the fresh selected leg; ENTRY consumes caps.
6. Extend durable operation records and startup recovery for order amend, margin adjustment, and profile setup. Local state is never treated as exchange authority.
7. Expose a minimal renderer status model: readiness, safe budgets, positions, owned open orders, active/unknown operation, and compact safety reasons.
8. Keep legacy protocol frames fail-closed after the version bump; do not silently reinterpret One-way drafts as Hedge intents.

## Rendering and data-path performance

Phase 8 already reduced Futures public REST pressure with exchange-info caching, in-flight deduplication, bounded bootstrap concurrency, progressive readiness, keep-alive reuse, and a smaller candle request. The next gains are distinct:

- split interval-only candle loading from full symbol generation so interval changes do not refresh depth, ticker, and unrelated resources;
- remove the one-second clock state from the full workstation tree; isolate funding countdown into a memoized leaf or derive it from a lightweight external clock;
- memoize normalized depth rows and stable callback/prop boundaries;
- update only the last chart bar with `series.update` when a stream advances, and reserve `setData` for bootstrap/history replacement;
- keep chart creation and subscriptions stable while ticket/status/clock state changes;
- coalesce high-frequency depth/ticker updates to at most one React commit per animation frame and skip semantically unchanged snapshots;
- virtualize the watch list only if profiling shows the compact list remains a measurable cost;
- measure bootstrap request count, interval-change request count, React commits, chart updates, and p50/p95 time-to-interactive before and after.

Hunter-bot's REST reductions help shared proxy/origin contention, but they do not directly remove React renders. Phase 9 therefore validates both the network path and renderer path separately.

## Regression guardrails from `~/work/algo`

The recent `algo` history includes a broad July 8 baseline rollback followed by selective restorations of transaction time, live symbol resolution, current-day gap handling, funding range, and candle fallbacks. This project must prevent the same failure class:

- no mass baseline restore/reset as a feature implementation technique;
- small vertical commits with an explicit scope manifest and deterministic tests;
- GitNexus impact before every existing symbol edit and detect-changes before any commit;
- refresh the graph after commits and compare the actual affected flows with the planned list;
- preserve exchange transaction time separately from local receive/envelope time;
- resolve mutable exchange symbol/order/position authority from the current source, never from a startup snapshot;
- never treat a forming candle as a closed candle;
- never treat local optimistic order/position state as exchange authority;
- never cancel an order before a replacement/amendment is durably resolved;
- no broad rollback is accepted without a file-by-file recovery manifest and tests proving that later safety fixes remain present.

## Delivery sequence and acceptance gates

### Slice A — UI shell and non-destructive drafts

- Rename visible workspace to `Futures`.
- Move ticket/sizing/readiness into the right rail and collapse advanced safety.
- Wire chart/order-book price selection and modifier gestures to drafts only.
- Restore Shift price/% measurement with deterministic start, update, and cleanup behavior.
- Add deterministic gesture, exact-decimal sizing, accessibility, and responsive-layout tests.

Gate: no renderer path can emit a write without a prepared server intent and exact confirmation;
measurement never mutates the order draft and augmented modifier combinations stay inert.

### Slice B — Hedge Mode and isolated `2x` execution

- Migrate protocol, facade, coordinator, risk engine, service, ledger, and recovery.
- Add server-side profile readiness and explicit setup intents.
- Exercise LONG/SHORT entry/exit matrices, cap boundaries, partial fills, stale positions, timeout, restart, and UNKNOWN recovery.

Gate: all eight side/leg/exposure combinations are deterministic and oversized exits fail closed.

### Slice C — Positions and margin adjustment

- Add position rows and exact margin dialog.
- Add durable add/reduce margin intents and reconciliation.

Gate: no cross-leg ambiguity, no retryable POST, and restart recovery has a proven terminal state or remains blocked UNKNOWN.

### Slice D — Atomic order movement

- Render owned-order handles and drag preview.
- Add durable PUT-amend flow and partial-fill protections.

Gate: cancel-before-replace is impossible; ambiguous PUT results block and reconcile.

### Slice E — performance and rollout

- Separate interval-only loading, isolate the clock, stabilize chart series, and coalesce streams.
- Run Vitest unit/protocol/integration coverage, Electron owner/peer isolation tests, lint, the normal build, bounded smoke, and retained static safety/boundary checks.
- Run GitNexus detect-changes and inspect all direct dependants.
- Use production read-only smoke tests first. Any live write smoke requires explicit operator authorization and the smallest compiled cap.

Gate: no request-count regression, measurable renderer improvement, clean recovery after restart, and no unresolved HIGH/CRITICAL dependency left untested.
