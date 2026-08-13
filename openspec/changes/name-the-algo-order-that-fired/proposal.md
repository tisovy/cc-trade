## Why

The operator watched a stop sit on the chart for ten to fifteen seconds after
the price had gone through it. Nothing was broken. The desk had no way to know.

The desk does not learn about algorithmic orders from the authenticated stream.
It reads them from `/fapi/v1/openAlgoOrders` on the reconciliation beat, once
every thirty seconds (`src/hooks/useFuturesTrading.js:47`).

That is a fact about this desk, and it was written here as a fact about the
exchange — "algorithmic orders are not reported by the authenticated stream" —
which is not established. Binance's USDⓈ-M user-data-stream page lists
`ALGO_UPDATE` among its events, and its payload carries `o.ai`, the identity of
the spawned regular order this change goes to REST for, and `o.rm`, a rejection
reason the desk has no way to read at all. Read from the source page rather than
from a search summary, 2026-08-13.

What is still not established is **delivery to this account**. The page proves
the event exists for the product; it says nothing about what arrives on this
desk's own stream. This desk has already been shown three ways for that
distinction to matter: a retired route that answers the handshake and carries
nothing, an open socket that delivers nothing, and a subscription the exchange
acknowledges and then never feeds.

So the wording moves in two steps, and this is the first. The stream declares
such an event; delivery on this account is unconfirmed; `actualOrderId` on the
reconciliation beat therefore stays the primary path and nothing here depends on
the frame. `hear-the-exchange-out` has since landed the fold — an `ALGO_UPDATE`
that does arrive is parsed and applied, and one naming an algo the desk has not
listed is ignored — so the machinery is a backstop that costs nothing if the
frame never comes. The thirty-second beat and `streamCannotReport: ['algoOrders']`
are deliberately untouched. Runbook **step 36** measures whether the frame
arrives; the second step, in whichever direction that answers, changes the
premise here and the requirement in `futures-order-visibility` together. When an algo fires, the exchange
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
