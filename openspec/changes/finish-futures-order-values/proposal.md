## Why

Four remaining order presentations disagree with the exchange data they describe: another contract uses the selected contract's precision fallback, filled size is still shown in contracts, stop-limit value prefers the trigger over its limit, and a stop-market with `price: 0` is absent from the chart. These inconsistencies make one account order read differently across the ticket, dock and chart.

## What Changes

- Format each working-order price with that order's contract tick size.
- Show the filled portion of a working order in USDT while keeping exact executed contracts in secondary detail.
- Value a stop-limit at its own positive limit price and use trigger price only when no usable limit price exists.
- Draw a market-triggered stop at its trigger price when its ordinary price is zero, without changing execution, editing or cancellation semantics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: Make working-order precision, filled value, stop valuation and chart placement use the order's own contract and price semantics consistently.

## Impact

- Futures trading ticket, portfolio dock, workstation chart and shared order-presentation utilities
- Contract metadata passed to the ticket and focused component/utility tests
- No trading command, execution or cancellation behavior changes
