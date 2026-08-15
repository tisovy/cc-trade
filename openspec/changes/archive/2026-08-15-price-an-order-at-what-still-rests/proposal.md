## Why

The operator, trading a fast contract: "когда наш ордер частично исполняется —
то у нас нет горячего обновления ордеров". The first reading was that the desk
was not hearing the fill. It is: a fully filled order leaves the chart on its
own, so the stream is carrying. What does not change is the **number**.

Every surface that prices an order goes through one derivation, and that
derivation reads the size the order was placed at:

```js
const orderNotionalValue = (order) => {
  const price = Number(order?.triggerPrice ?? order?.price)
  const quantity = Number(order?.origQty)   // ← what it was placed at
```
(`src/utils/futuresOrderPresentation.js:101`)

A working order that is half filled rests at half its size. The filled half is
a position — reported as one, margined as one, and shown in the positions list
as one. Valuing the order at `origQty` counts it a second time, so the chart
label, the rail row, the editor and the ticket's total all overstate what the
operator still has working, by exactly the part that already traded.

Measured before this change, on an order of `10` at `100` with `5` filled: the
desk states `1000` where `500` rests.

The drag has always known better. `describeFuturesDragReplacement` sizes a
replacement from `origQty` minus the filled part, so picking up a half-filled
order and dropping it places the remainder — the right amount, and not the
amount the desk had just been showing for it. The two readings disagreed, and
the operator's own screen is the one that was wrong.

## What Changes

- An order is valued at what is still working: the size it was placed at less
  the part that has traded. One derivation, so the chart label, the list, the
  editor and the ticket's total move together, and they now agree with the size
  the drag would actually replace.
- The filled quantity is read as the stream names it (`z`) or as a snapshot
  names it (`executedQty`), the same reading the drag already performs.
- The exact contract count on hover states what is working, so it agrees with
  the value beside it rather than with the order's history.
- The filled column in the dock is unchanged: it states what has traded, which
  is a different question and already has its own answer.

## Impact

- `src/utils/futuresOrderPresentation.js`,
  `src/components/features/futures/FuturesTradingTicket.jsx`,
  `src/components/features/futures/FuturesPortfolioDock.jsx`.
- Modifies one requirement in `futures-order-visibility`.
- The operator reads their working exposure as the exchange holds it, rather
  than as it was when they placed it.
