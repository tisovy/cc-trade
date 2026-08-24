## Why

The primary Futures unrealized PnL is currently valued at a synthetic price derived by adding tape movement to the last mark, while the row still displays the exchange mark. This can make uPnL, ROE, and the dock total disagree with Binance and also drives the entire portfolio/history subtree from high-frequency aggregate trades.

## What Changes

- Make the exchange mark price the single authority for primary position uPnL, ROE, position notional, and the dock total.
- Use the account snapshot's `unRealizedProfit` only as a qualified fallback when no current mark exists.
- Remove aggregate trades from the authoritative valuation path; any tape what-if is explicitly secondary and non-additive.
- Reject delayed mark frames by exchange event time so neither the displayed valuation nor the feed's funding-settlement baseline can be rewound by stale data, while accepting a fresh earlier funding reschedule.
- Require forward progress from every tracked contract, stop the shared mark/funding lifecycle when its last Futures consumer leaves, and coalesce full mark publications on the Futures market lane.
- Represent aggregate uPnL as unknown or partial when any required position reading is unknown instead of silently summing a subset or showing zero.
- Isolate live mark updates from the held history subtree and bound the number of Closed Positions DOM rows rendered at once.
- Keep presentation valuations out of close/margin command state, verify reduction direction against the live account leg, and fail closed when a financial action's balance, maintenance, or current-position proof is unavailable.
- Keep Ticket counts and empty states unknown until the corresponding account resource has completed a successful read.
- Reconcile the two existing, contradictory requirements that alternately require synthetic tape-carried uPnL and mark-only uPnL.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: define one authoritative, mark-based unrealized PnL and remove synthetic tape movement from that reading.
- `futures-workstation-presentation`: make row/aggregate unknown states truthful and keep mark ticks from repainting the held history review.

## Impact

Affected areas include `futuresPositionMarks`, `futuresOrderConfirmation`, the mark-price feed, the shared Futures connection/outbox lifecycle, `useFuturesTrading`, close/margin commands, `FuturesPortfolioDock`, `FuturesTradingTicket`, `FuturesProductionWorkstation`, `FuturesHistoryPanel`, and their tests. GitNexus reports several leaf utilities as LOW risk, while the mark watchdog, funding schedule, and renderer broadcaster reach CRITICAL execution-flow fan-out; changes to those paths stay narrowly scoped and require connection-level regressions.
