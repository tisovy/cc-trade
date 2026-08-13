## Why

The operator moved one order, then reached for a second before the first had
landed, and nothing happened. No refusal, no message, no order lifted — the
drag simply did not start.

The cause is one line, and it is deliberate:

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

## Non-goals

- The cancel-then-place window itself is not addressed. Moving an order is two
  round trips because the desk cannot amend across a price it has not confirmed
  is free; that is `carry-execution-ahead-of-market-data`'s ground, not this
  change's.
- No change to how a single drag is drawn on the chart. The chart already holds
  one pointer drag at a time and continues to.
- Serialization on the backend stays exactly as it is: one lane per contract,
  so two moves on the same contract still reach Binance in the order the
  operator made them.

## Impact

- `src/hooks/useFuturesOrderDrag.js`,
  `src/components/features/futures/FuturesOrderDragAlert.jsx`,
  `src/components/features/futures/FuturesProductionWorkstation.jsx`.
- The operator can work a book at the speed they think at, instead of at the
  speed of the proxy.
- Modifies one requirement in `futures-order-visibility`.
