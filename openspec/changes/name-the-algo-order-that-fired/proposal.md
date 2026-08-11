## Why

The operator watched a stop sit on the chart for ten to fifteen seconds after
the price had gone through it. Nothing was broken. The desk had no way to know.

Algorithmic orders are not reported by the authenticated stream. The desk reads
them from `/fapi/v1/openAlgoOrders` on the reconciliation beat, once every thirty
seconds (`src/hooks/useFuturesTrading.js:47`). When an algo fires, the exchange
knows immediately, the spawned regular order appears on the stream immediately —
and the parent goes on being drawn at its trigger price until the next poll. The
ten to fifteen seconds the operator measured is the remainder of that interval.
Zero to thirty is the range; there is nothing to explain beyond it.

What makes it unnecessary is that the desk is already told which regular order an
algo spawned, and throws the information away. Binance returns `actualOrderId` on
every open algo order — this repository's own reference documents it, including
that an algo which has not fired reports it as an empty string
(`docs/futures_hardening_roadmap.md:449`, `:479`). `normalizeFuturesAlgoOrder`
maps `algoId`, `clientAlgoId`, `triggerPrice`, `workingType`, `priceProtect` and
`algoType` into the normalized order, and does not carry `actualOrderId` or
`actualPrice` (`electron/services/futures-trading-adapter.js:293-318`).

Without that identity the desk cannot connect the two facts it already has: an
execution report for order `X`, and a listed algo parent whose `X` it is. So it
draws the parent as an ordinary working order, at a price the market has already
left, on the chart the operator is trading from. The marker is not merely late —
it is wrong in a way the operator can act on, because a working marker at a price
means an order the operator could still move or cancel.

## What Changes

- A normalized algorithmic order carries the identity of the regular order it
  spawned, and the price that order was placed at, when the exchange reports
  them.
- An algorithmic order that has fired is not drawn as resting. It reads as
  triggered and awaiting confirmation until the reconciliation that removes it,
  and it offers no control that only applies to a working order.
- An execution report whose order identity is one a listed algorithmic parent
  spawned resolves that parent, rather than leaving it on screen until the beat
  comes round. That single, targeted read is the only exception to reading algos
  on their own beat; a fill unrelated to any listed algo still reads nothing.

## Non-goals

- The thirty-second reconciliation beat stays as the backstop. This change makes
  it stop being the only way an operator learns that their stop fired.
- Placing algorithmic orders is out of scope; the desk lists and cancels them.

## Impact

- `electron/services/futures-trading-adapter.js`,
  `src/hooks/useFuturesTrading.js`,
  `src/components/features/futures/FuturesProductionWorkstation.jsx`,
  `src/components/features/futures/FuturesPortfolioDock.jsx`,
  `src/utils/futuresOrderPresentation.js`.
- The operator sees a fired stop stated as fired within the stream's own latency,
  instead of a working marker at a price the market has left.
- Modifies two requirements in `futures-order-visibility` and adds one.
- Independent of the transport and order-book changes from this audit.
