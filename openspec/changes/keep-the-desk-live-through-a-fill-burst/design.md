# Design — keep the desk live through a fill burst

Everything below was mapped and measured on 2026-08-30 before any decision
was taken. Line numbers are as of `1b0a626`.

## The mechanism, as found

### Frames: one fill → 2–3 frames → 2–3 renders

- Single origin: the private user-data socket handler,
  `binance-connection.js:4373`. The `executionReport` branch broadcasts an
  orders frame (`:4405`) *and* a folded account frame (`:4403`); the
  `accountUpdate` branch broadcasts another account frame (`:4449`).
- The renderer outbox (`renderer-outbox.js:201`) writes account-lane frames
  straight to the socket — no timer, no window, and supersession is
  explicitly off for this lane (`frame.replaceable` never set), as the canon
  requires ("Account traffic is carried ahead of market data": a frame that
  may not be dropped SHALL NOT be superseded either).
- The renderer consumes them in `useFuturesTrading.handleMessage`
  (`useFuturesTrading.js:1066`): one `setState` per frame, synchronously in
  the WebSocket `message` macrotask. React 18 batches *within* a task, not
  across tasks — N frames = N renders. No `startTransition`,
  `useDeferredValue` or rAF anywhere on this path.

### Why one commit costs ~400 ms

Per execution frame, synchronously:
`foldExecutionIntoFuturesHistory` (full filter+sort of the held trade
array, cap 8 000/contract, `futuresHeldHistory.js:551`) → `tradeGeneration`
bump invalidates the memo chain: `roundTradeHistory` (`:2003`) →
`baseTradeRoundIndex` → `buildFuturesTradeRoundIndex`
(`futuresTradeRounds.js:1517`, canonical entries for every retained fill,
BigInt `foldContractFills` up to twice per position, `qualifyRound` per
round) → `tradeRoundIndex` → `reconcileFuturesWalletLedger`
(`futuresWalletLedger.js:812`) → `settledMoney`. The hook returns a new
object identity every frame (`:2191`), so `memo(FuturesProductionWorkstation)`
never hits and the dock, rail and chart all re-render;
`FuturesWorkstationChart.jsx:913–991` then removes and recreates *every*
price line and runs a forced `getBoundingClientRect` per handle
(`:1094–1129`). The desk the operator runs is `npm run e` — the dev build,
where StrictMode doubles every render and memo factory — and the fix must
hold there, because that desk is the live one.

Measured: burst commits p50 400 ms / p90 462 / max 505 (n=623); quiet p50
17 ms. Arrival 32–46 orders+account frames/s at peaks; queue `totalMs` to
6 428 ms.

### Why a command waits 4–33 s

`RateLimiter` (`binance-connection.js:423`) tracks a ledger of
`{timestamp, weight}` against `maxWeight 800 / windowMs 60s`.
`reservationWait()` (`:579`) knows only `weight` — **there is no
reservation, headroom or per-standing capacity**. `urgent` affects only
queue order (`nextAdmission()`, `:622`); at `spent: 800` an urgent weight-1
command re-queues to the head of a queue that is not moving and sleeps to
the minute boundary. Commands are weight 1, `urgent: true`, admitted per
physical attempt.

The window was spent by ordinary work: the 30 s reconcile beat
(`useFuturesTrading.js:1803`, `ACCOUNT_RECONCILE_INTERVAL_MS = 30_000`,
runs while any order is `NEW`/`PARTIALLY_FILLED` — i.e. for the whole
burst) whose handler (`:7562`) always runs the full 4-resource 90-weight
pass — the comment at `:7573` claims a narrowing that is not implemented —
plus ordinary credit-confirm income pages (30 each, worst 4 lanes × 4
pages) and the post-restart bootstrap. Nothing on the beat path consults
stream recency; `futuresUserDataLastHeardAt` exists (`:4001`) but feeds
only the 420 s liveness watchdog and `futuresStreamCarriesOrders()`
(`:4017`), which the *post-command* reconcile already trusts
(`reconcileAfterFuturesCommand` is a no-op while the stream carries).

## Decisions

### D1. A command reserve in the limiter, not a faster queue

`reservationWait()` and the booking path take the request's standing:
ordinary capacity is checked against `maxWeight − FUTURES_COMMAND_WEIGHT_RESERVE`,
urgent against `maxWeight`. Reserve **40** — measured basis: the 18:47Z
episode's urgent traffic (1 place + 1 replace + 6 cancels at weight 1, a
handful of weight-5 `unstated` reads, one memoized weight-30 position-mode
warm) fits inside 40, which is 5 % of the window. The constant states this
basis where it is set, as the mark window does.

Rejected: *preempting sleepers* — sleepers already release the admission
slot (2026-08-22 fix); the window itself is spent, there is nothing to
preempt. *Raising the ceiling* — the ceiling is the exchange's. *Making
background reads urgent-aware case by case* — the 2026-08-23 residual
(dedup inherits ordinary standing) shows how that leaks; capacity reserve
covers every current and future urgent caller at one seam.

Backpressure from the exchange (`429`/`Retry-After`) stays authoritative
and is not subject to the reserve — the reserve governs only the desk's own
capacity arithmetic.

### D2. The beat is held while the stream speaks, with a quiet ceiling

In the `account.refresh` handler, `periodic: true` (the flag already
distinguishes the two callers — the cause is named by the caller) is held
when (a) the private stream delivered a frame within the beat interval and
(b) the last completed pass is younger than
`FUTURES_RECONCILE_MAX_QUIET_MS = 300_000`. Held beats are counted; the
count travels on the next pass's `read` line as a declared field
(`heldBeats`), so the journal states that the check ran (a check that
starts from nothing writes down that it happened).

Why not skip outright: the canon's own scenario — "No message reports a
settlement" — makes the beat the net for what no stream reports; a stream
frame proves transport liveness, not completeness. The 5-minute ceiling
keeps a bounded staleness guarantee; reconnect (its own stated reason) and
the 420 s watchdog are untouched. Why main-side and not the renderer timer:
the renderer cannot see stream recency, and the handler is the one place
both callers already pass through. The lying narrowing comment at `:7573`
is corrected, and the old claim is grepped for wherever else it is stated.

### D3. One commit per cluster; every report folded

`handleMessage` queues account-lane frames in a ref and drains them in one
state update: the first frame after a quiet moment applies immediately (the
start of a move is seen at once — same shape as the print gate), frames
arriving within `FUTURES_EXECUTION_COMMIT_WINDOW_MS = 100` of the last
commit fold into one trailing drain, in arrival order, none dropped.
Measured basis for 100 ms: clusters arrive as 5–7 frames every ~200 ms;
100 ms folds a cluster's remainder into one trailing commit while adding
zero latency to the first report.

The drain folds all queued execution reports into held history in one pass:
`futuresHeldHistory` gains a batch fold (N rows, one filter+sort+bound)
with result identical to N sequential upserts.

Rejected: *outbox-side coalescing* — the account lane's lossless,
unsuperseded delivery is canonical and right (every report carries a fill
the history fold must see); the renderer folding a cluster into one commit
drops nothing. *`useDeferredValue`* — unbounded starvation under a
sustained burst and no deterministic bound to test.

### D4. The review trails the fill

The heavy chain (`roundTradeHistory` → round index → wallet ledger →
settled money) follows a `reviewGeneration` that trails `tradeGeneration`:
during a burst it advances at most once per
`FUTURES_REVIEW_FOLD_TRAIL_MS = 1000`; when the burst ends the trailing
timer fires and the review catches up; outside a burst the first bump folds
immediately. Working orders, positions, plates and last-execution state
stay on the immediate path. This is the existing rule "a review never
delays the desk learning what its order did" applied to the desk's own
compute, not just to its request queue.

### D5. Price lines are diffed

`FuturesWorkstationChart` keeps its price lines keyed by order identity and
touches only lines whose price/status/size changed, instead of removing and
recreating all of them on any change. The rAF coordinate pass and the
gutter layout stay as they are.

### D6. The instrument gets a fourth reading, judged at its own commit

Today `readingOf` judges every drained entry against the screen as of the
*latest* commit (`drawnOrdersRef.current`), so in a drained cluster every
older report of a filling order reads `NOT_DRAWN` — the fault code — while
the screen truthfully shows the newest state. The drain judges each entry
at its own commit: an entry behind a newer report of the same order in the
same drain is `SUPERSEDED` (a new code, declared in the record and in the
canon's readings-kept-apart list); `NOT_DRAWN` remains "the newest state of
this order is not on the screen", which is what an operator reporting "the
order did not update" means. Part of today's 286 `NOT_DRAWN` lines are this
misjudgment; the operator-verification step separates what remains.

### Not taken, recorded

- Splitting the hook's returned object so `memo(FuturesProductionWorkstation)`
  can hit — a large refactor; D3+D4 reduce renders to cluster cadence
  first. If the burst suite's bound still fails on the dev build, that
  refactor is the named next step, its own change.
- Promoting an in-flight ordinary read joined by an urgent caller (the
  2026-08-23 dedup residual) — still unowned; D1 makes it mostly moot for
  capacity, the queue-order half stands as recorded.
- Any change to `serialize`/per-contract command lanes — measured clean in
  this episode (the lanes held only because the limiter did).
