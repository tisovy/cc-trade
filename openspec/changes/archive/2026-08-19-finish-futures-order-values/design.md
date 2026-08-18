## Context

The production workstation already derives a symbol-to-tick map from the catalog, and the dock consumes it, but the compact trading ticket receives only the selected contract. Shared order valuation currently prefers `triggerPrice` unconditionally, while the chart uses `order.price` unconditionally. The dock's filled cell bypasses both shared value derivation and USDT formatting.

## Goals / Non-Goals

**Goals:**

- Use one explicit usable-order-price rule across value and chart placement.
- Give every account-wide working-order row its own contract tick.
- State executed working-order value in USDT with exact contracts retained.

**Non-Goals:**

- Alter normalized exchange quantities or command payloads.
- Change stop triggering, amendment, drag or cancellation behavior.
- Convert the separate history table as part of the working-orders task.

## Decisions

Add a shared order-price selector that returns a positive ordinary/limit price first and falls back to a positive trigger only when the ordinary price is absent or zero. `orderNotionalValue`, the chart's resting-order coordinate, and the working filled-value helper will use it. Trigger display remains separate, so selecting the limit for valuation does not hide activation information.

Add a shared executed-notional presentation helper that reads stream `z` or snapshot `executedQty`, multiplies the non-negative executed quantity by the shared selected price, and returns a formatted USDT value. Zero execution is a real zero. The dock will change the header to `Filled (USDT)`, render that value, and put the exact executed contract count in the cell title.

Pass the already-derived `tickSizes` map from `FuturesProductionWorkstation` into `FuturesTradingTicket`. Its `tickOf(symbol)` will consult that map, with the selected contract tick as a compatibility fallback for the selected symbol. No catalog parsing will be duplicated in the ticket.

The chart will call the shared price selector only when adding a resting order line and calculating the corresponding DOM handle coordinate. This keeps a stop-market line and label at one trigger coordinate while the original order object, action eligibility, cancellation identity and every command payload remain unchanged; the derived display price is never written back into the order or handed to execution code.

## Risks / Trade-offs

- [A zero ordinary price could be mistaken for an intentional limit] → Treat only finite positive values as usable; zero falls through to the trigger.
- [Filled USDT is an estimate when only order price is known] → Use the same stated order price as size, retain exact executed contracts, and do not claim an exchange average fill price.
- [A caller omits the tick map] → Preserve the selected-contract fallback and float-noise formatting for genuinely unknown contracts.
- [A trigger-only display coordinate could leak into an order action] → Keep display-price derivation at the line/coordinate boundary and assert that cancel/edit/drag handlers still receive the original order unchanged.
