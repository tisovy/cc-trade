## Why

The operator moved one order, then reached for a second before the first had
landed, and nothing happened. No refusal, no message, no order lifted — the
drag simply did not start.

There were **four** gates, and each fix reached only the innermost one left.
The operator retested after each and reported the same symptom, which is how the
next one came to light. The fourth is the one that made their own case fail with
the three above it already in, and it is the plainest of them: the chart held
the pointer for the whole cancellation round trip, and the operator lets go long
before that answers.

### The gate in the hook

The first, and it is deliberate:

```js
// While the desk still owes an order, nothing else may be lifted: two
// outstanding obligations cannot be told apart on one alert.
if (liftedRef.current !== null) return { ok: false }
```
(`src/hooks/useFuturesOrderDrag.js:135`)

The reasoning behind it is sound and stays sound: a drag lifts an order by
cancelling it, so from that moment the desk owes the operator an order, and if
two obligations were outstanding at once, the one alert that reports a failure
could only name one of them. Losing an order quietly is the thing the whole
mechanism exists to prevent.

What is not sound is the shape of the answer. Two things are wrong with it:

- **It refuses in silence.** Every other refusal in this hook raises an alert
  the operator cannot scroll past — a paused desk, an order too large to
  replace, a cancellation the exchange would not confirm. This one returns
  `{ ok: false }` and says nothing at all, which on screen is indistinguishable
  from a drag that did not register. The operator is left to wonder whether the
  desk heard them.
- **It bounds the wrong thing.** The obligation is per order; the limit was
  written against the reporting surface. The window it closes is a round trip
  through the operator's proxy — 340–800 ms measured — and during it every
  order on the desk is unmovable, on every contract, including ones the first
  drag has nothing to do with.

### The gate in the chart

`beginOrderDrag` refuses to start while any drag is held:

```js
if (orderDragRef.current !== null || typeof onOrderLiftRef.current !== 'function') return
```
(`src/components/features/futures/FuturesWorkstationChart.jsx:954`)

and `settleOrderDrag` keeps the drag in that slot until the placement is
answered, because what it drew has to stay: "the mark stays on the chart,
dashed, until the placement is answered: the level is uncovered until then, and
drawing a working order there would be a lie". That reasoning is right about the
drawing and wrong about the pointer. Measured against the chart before this
change, the second `pointerdown` never reached the lift at all — `onOrderLift`
called once where it should be twice — so the desk's own hook never got a say.

### The gate in the main process

The one that was actually costing the operator their move, and the one both
earlier fixes were written around rather than at. The command registry holds
mutating commands in lanes, and the lane was the contract:

```js
export const readTradingCommandLane = command => [
    command?.marketType ?? '',
    command?.accountId ?? '',
    ...
```
(`electron/services/trading-command-registry.js:112`)

Moving an order is a cancellation and then a placement. With one lane per
contract, the cancellation that begins the *next* move waits behind the
placement that ends the previous one — a full round trip through the operator's
proxy, 340–800 ms measured, for two orders that have nothing to say to each
other. Three orders side by side cost two such waits, which is exactly what the
operator described: "пока один не закончил ставиться - другой не двигается".

Measured before this change: with a placement held in flight, a cancellation of
a *different* order on the same contract does not execute. `expected
[ 'place:start' ] to deeply equal [ 'place:start', 'lift:another-order' ]`.

The lane was also stricter than the requirement it was built for.
`serialize-and-deduplicate-trading-commands` asks for commands "that target the
same order identity, and the same symbol" to be serialized; the contract lane
serialized every command on a contract whether or not it named the same order.
What the coarse lane did buy, and what a naive narrowing would throw away, is
that a cancel-all cannot run beside a placement it is meant to sweep away — so
that is stated on its own rather than left as a side effect of the lane width.

### The gate in the gesture

A drag ends when the operator lets go. The chart treated it as ending when the
*exchange* answered — and there are two answers, not one. The settling channel
above covers the second, the placement. The first, the cancellation, was left
holding the pointer outright:

```js
if (drag.status === 'lifting') {
  drag.releasedEarly = true
  drag.releasedRestored = restored
  return              // ← orderDragRef.current is still this drag
}
```

Every gate above this one was measured with a test that let the cancellation
answer before the pointer came up. The operator does not work that way: they
flick an order across and let go well inside 340–800 ms, so `status` is still
`lifting` at `pointerup` and the slot stays taken until Binance replies. Their
words, exactly: "не даёт схватить другой пока не закончит предыдущий" — not that
the second order fails to move, that it cannot be *grabbed*.

Measured before this change, at that timing: `onOrderLift` called once where it
should be twice. The second `pointerdown` did nothing at all.

The underlying reason it kept coming back is that the chart's drag lines lived
in two refs owned by the chart, so only one drag could be drawn at a time and
handing one over meant moving its lines out from under the next. The lines now
belong to the drag that drew them, which is what makes any number of them able
to be in the air at once.

## What Changes

- The desk tracks what it owes per order rather than one obligation at a time.
  Lifting a second order while a first replacement is still in flight is
  allowed, and the two are discharged independently.
- Failures are reported per obligation. The alert becomes a list that names
  each order that is gone, with its own reason and its own control to place it
  again, so two outstanding obligations can be told apart — which is what the
  single-obligation limit was standing in for.
- A lift that is genuinely refused says so. No path out of a lift returns
  silently.
- One pointer still drives one drag: the operator can only be dragging a single
  order at any instant. What changes is that the *previous* drag no longer has
  to have landed for the next one to start.
- The chart hands a settled drag to a channel of its own instead of holding it
  in the single drag slot. It keeps drawing exactly what it drew — the dashed
  aim and the faint mark at the level it was lifted from — for as long as the
  placement is travelling, and the pointer is free the instant the gesture ends.
- The main process orders commands by the order they name rather than by the
  contract they sit on. Two orders on one contract are worked at once; two
  commands about one order stay serialized exactly as before.
- A command that speaks for a whole contract — cancel-all, leverage, margin
  type, position margin — runs alone on it. That was previously a side effect of
  the lane being the contract; it is now the rule, so narrowing the lane cannot
  quietly let a placement survive a sweep.
- The pointer is freed when the *gesture* ends, not when either round trip does.
  A drag released while its cancellation is still travelling is handed over the
  same way a settling one is, and discharges itself at the price the gesture
  ended on when the answer arrives.
- A drag owns the price lines it drew. They travel with it off the pointer,
  which is what allows more than one to be drawn at once.

## Non-goals

- The cancel-then-place window itself is not addressed. Moving an order is two
  round trips because the desk cannot amend across a price it has not confirmed
  is free; that is `carry-execution-ahead-of-market-data`'s ground, not this
  change's.
- No change to how a single drag is drawn on the chart. The chart already holds
  one pointer drag at a time and continues to.
- The cancel-then-place pair itself stays serialized against the order it is
  about. A second command on one order still waits, and the 40-second worst case
  the registry documents is unchanged for that case.
- Deduplication is untouched: identity still decides whether a command runs at
  all, and ordering only decides when.

## Impact

- `src/hooks/useFuturesOrderDrag.js`,
  `src/components/features/futures/FuturesWorkstationChart.jsx`,
  `src/components/features/futures/FuturesOrderDragAlert.jsx`,
  `src/components/features/futures/FuturesProductionWorkstation.jsx`,
  `electron/services/trading-command-registry.js`,
  `electron/services/binance-connection.js`.
- The operator can work a book at the speed they think at, instead of at the
  speed of the proxy.
- Modifies one requirement in `futures-order-visibility`; adds one to
  `trading-command-integrity`.
