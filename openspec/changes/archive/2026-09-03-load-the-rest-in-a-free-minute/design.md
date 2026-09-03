# Design — load the rest in a free minute

## Code map

- Pool: `futures-production-workstation-service.js` `sessions`/`shown`
  (`:296`), `isHeld`/`isShown` (`:740–748`), `showSession` (`:753`),
  `makeRoomForSession` (`:770`), `selectHeldContract` (`:860`) →
  `deliverHeldState`; `handleRequest` routes SUBSCRIBE/SELECT_SYMBOL of a
  held symbol to `selectHeldContract` (`:459`), otherwise `startGeneration`
  (`:971`): exchange-info (cached), `transport.connect` (three sockets),
  `bootstrapIndependent` (klines ×2, premium, ticker), depth page at
  `depthPageLimit()` (1000, weight 20), bridge, `emitStatus(LIVE)`.
- Recovery: `handleDisconnect` (`:1757`) → `scheduleResync` (`:1786`) →
  ladder `RECONNECT_BASE_MS` 500 × 2ⁿ to `RECONNECT_MAX_MS` 30 000, eight
  fast attempts then the slow rung, each attempt `startGeneration` with
  `takesTheScreen = previous === null || shown === previous`;
  `startFreshnessMonitor` (`:1735`) marks resources stale and resyncs on
  an error; `recoverBook` (`:1549`) reads one page per round with a widening
  cooldown; `handleCandleDisconnect` → `scheduleIntervalResync`.
- Budget: `futures-workstation-read-budget.js` `usedWeight()`, `snapshot()`;
  `PUBLIC_READ_BUDGET` is module-private to the transport (`transport.js:124`),
  600 a minute.
- Record: `onInternalError` → `fault` (+ `evidence` when any field is
  non-null), `onTiming` → `timing` (`binance-connection.js:5239`);
  `PHASE` is open (`^[a-z][a-z0-9-]{0,32}`), so `park` and `lazy-bootstrap`
  need no vocabulary change; the summary tool groups by phase.
- Chart: `FuturesWorkstationChart.jsx` `measurementGeneration =
  Symbol(symbol:interval)` (`:302`); layout effect clears both series on
  it (`:392–399`); the data effect redraws on `[candles]` only (`:797–856`)
  with `planSeriesDraw` against `rowStateRef`.
- Evidence: `futures-workstation-order-book.js` `applyDelta` (`:634`)
  assigns `this.lastUpdateId = delta.finalUpdateIdBigInt` before the
  crossing check; `handleStreamFrame` raises the `stream` evidence and
  passes it to `recoverBook`, which raises it again under `book-recovery`
  (`:1580`); `read-desk-record.mjs` counts every `evidence` line whose code
  is `CROSSED_ORDER_BOOK` (`:209`).

## Decisions

### D1. A background session parks; only the shown one recovers

`handleDisconnect`, the freshness monitor's error path, `handleCandleDisconnect`
and `recoverBook` ask `isShown(session)` first. For the shown session
nothing changes. For a held session that is not shown they call
`parkSession(session, code)`: close the stream, stop the book, clear every
timer, keep `session.status` as `resynchronizing` with the code (what
`deliverHeldState` states to whoever selects it), record `fault { phase:
'park', code, symbol }`, and set `session.parked = { at, code }`. No
reconnect timer is armed. A parked session keeps its place in the pool and
its `shownOrder`.

The screen moving is a park too. `showSession` looks at the session it
replaces: on its ladder (`reconnectTimer`), on its candle ladder
(`intervalReconnectTimer`) or inside a recovery round (`bookRecovering`), it
parks under the reason it was already stating — a round's own reason is
kept on `bookRecoveryReason` while it runs, because the status line may be
holding an older code. Without this the rung fired for a contract nobody
was looking at and ran the whole bootstrap, the round read its remaining
pages, and the candle rung rebuilt the generation through `selectInterval`'s
fallback (self-audit, 2026-09-03). A session the operator moved off
*mid-bootstrap* is left to finish: its reads were the operator's, and the
warmer counts it as the one wake in flight.

A background book that gaps or crosses is parked too — the whole session,
not the book alone. Rejected: *keep the streams and owe only the book* —
a book in `RESYNC_REQUIRED` refuses every diff and asks for a recovery on
each, and the candles and tape a background session keeps meanwhile are
worth less than the socket they hold through a storm. Parking is one rule.

### D2. Selecting a parked contract rebuilds it at once

`handleRequest` for SUBSCRIBE/SELECT_SYMBOL of a held symbol: if the
session is parked, `startGeneration(request, emit, 0)` — the operator asked
for it, it takes the screen, and the ladder is its own from then on.
Otherwise `selectHeldContract` as today. A renderer reload is this same
path: the shown contract is delivered from what it holds, or rebuilt if it
was parked, and no other session is touched.

### D3. The warmer: one parked session per free minute

A service-level interval (`WARM_CHECK_MS` 5 000) asks, in order: is any
session parked; is the shown session bootstrapped and live (not
`loading`, not `resynchronizing`, no `reconnectTimer`, no `bookRecovering`);
does the public budget have room — `transport.readBudgetRoom()` returns
`{ usedWeight, maximumWeight }` from `PUBLIC_READ_BUDGET.snapshot()`, and
room means `maximumWeight − usedWeight ≥ WARM_ROOM_WEIGHT` (120: one
bootstrap at 24 plus a recovery round for the shown contract at 60 plus
margin); has `WARM_FLOOR_MS` (15 000) passed since the last wake. If all
four, it wakes one parked session: fewest failed wakes first, then most
recently shown, and never one inside its hold. `lazyWakes` counts the wakes
in a row that did not bring the contract up with a bridged book (cleared
when one does), and a session parked with `lazyWakes` n is held
`FLOOR_MS × 2ⁿ` from its park, to `HOLD_CEILING_MS` (600 000). The shown
session's candle ladder and interval bootstrap hold the tick as its socket
ladder does. A session that stands `unavailable` — delisted between park
and wake — is neither parked nor loading and holds nothing (self-audit,
2026-09-03: read as «not bootstrapped», it held the warmer for good).
The wake is `startGeneration(session.request, session.emit, 0, { lazy:
true })` with `takesTheScreen` false (the shown session is not it), and
records `timing { phase: 'lazy-bootstrap', outcome, symbol }` through the
existing aggregate timing. One wake per tick; a wake that fails parks the
session again.

Rejected: *wake on a budget threshold alone* — a quiet minute while the
shown contract is reconnecting is not free. *Wake all parked at once* —
that is the storm this change removes.

### D4. The chart redraws on a generation change

The data effect depends on `[candles, measurementGeneration]`. After the
layout effect clears the series for a new generation, the effect runs with
`rowStateRef` empty and `planSeriesDraw` returns `full`, so whatever the
view handed the chart is drawn — the held series through a switch, the new
series when it lands. The intermediate render stops being load-bearing.
`hasFittedContentRef` is reset by the generation effect as today, so the
first draw of a generation fits; the replacement series does not refit.

### D5. One evidence line per crossing, the identity before the diff

`applyDelta` captures `const before = this.lastUpdateId` and puts it on the
evidence as `lastUpdateId`; `finalUpdateId` stays the diff's. `recoverBook`
no longer spreads the caller's evidence into its opening fault — the
caller already raised it under `stream` — while a crossing found inside a
recovery round (the catch at `:1628`) still raises its own. The summary
then counts every crossing evidence line once, correctly, and its fixture
gains the real shape: a `stream` evidence line and a bare `book-recovery`
fault for one crossing.

### D6. The summary lists the exchange's refusals

`request` lines carry `status` and `rateLimitResponses`. The summary adds
`Exchange refusals (n)` — count of attempts answered `429` or `418`, by
route — so the skew headroom question of the audit is answered by the
record rather than by a guess. Nothing is retuned on the strength of it in
this change.

## Residuals

- A parked contract's candles and tape are stale when it is selected; the
  rebuild takes the same 1–2 s a first open does. That is the price the
  operator chose over a storm.
- A background bootstrap whose book cannot be bridged parks at once under
  `DEPTH_BOOTSTRAP_*` — `recoverBook` is the park rule for a session that
  is not shown — and the warmer wakes it again after its hold: 30 s, then
  60, 120, … to ten minutes, the count cleared only by a wake that comes
  up with a bridged book. On a contract the exchange keeps serving a stale
  page for, that is a bootstrap every ten minutes for as long as it lasts,
  visible in the record as `lazy-bootstrap`/`park` pairs. A contract whose
  book crosses every two minutes (the SKRUSDT loop) parks and is rebuilt
  on the floor each time, about what its recovery rounds cost before.
- A woken contract the exchange no longer lists stands `unavailable` in
  the pool, un-parked, until it is selected — as a shown contract that was
  delisted does — and no wake, read or fault is spent on it again.
- A parked session is stopped through its abort controller, so `isHeld` is
  false for it while it stays in the pool: every in-flight callback of the
  old generation fails the same guard a released session's does. The pool
  map and `parked` are what distinguish the two.
- A renderer reload closes the whole runtime (the renderer's socket close
  in `binance-connection.js`), so after a reload the pool holds only the
  contract the renderer subscribes to; the parked path on a resubscribe is
  what a renderer socket that drops and returns without a reload exercises.
- The account side's fill-driven history fan-out is per open position, not
  per held contract, and is a different change.
- The decimal ordering of a book side finds a level by value; two string
  forms of one price would confuse removal. Binance formats one way per
  contract; noted in the audit, not owned.

## Self-audit, 2026-09-03

Read after the deployment, against the rule as the operator stated it.
Three defects, all in the pool half, all fixed the same evening with tests
that fail on the deployed tree:

1. A shown session that left the screen mid-recovery finished the recovery
   in the background — the rung's bootstrap, the round's pages, the candle
   rung. `showSession` parks it (D1).
2. The one-wake-at-a-time check held the warmer for good behind a session
   that stood `unavailable` after its wake (D3).
3. A wake that kept failing was tried every floor, ahead of every other
   parked contract: the SKRUSDT loop transplanted into the warmer. Ordering
   by failed wakes and a doubling hold (D3).

Read and left as they are: the chart's redraw on the generation cannot
draw a previous contract's rows under the new label, because the view hands
the chart no rows while `state.symbol` differs from the selection; a
`select-interval` for a held contract that is not shown falls to
`startGeneration` without the screen as before this change, unreachable
from the renderer's ordering of its messages.
