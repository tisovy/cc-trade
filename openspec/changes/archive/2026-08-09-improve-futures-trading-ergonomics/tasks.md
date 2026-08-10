## 1. Make Order Moves Atomic

- [x] 1.1 Add a signed `PUT /fapi/v1/order` amendment to the futures adapter that preserves the original quantity and returns a normalized execution report.
- [x] 1.2 Add `createFuturesModifyOrderCommand` and enable `trade.replaceOrder` in typed-command validation for futures only, requiring symbol, side, a positive price and quantity, and `orderId` or `origClientOrderId`.
- [x] 1.3 Route the command in the Electron connection, honour the operator pause, and resynchronize account state after both success and rejection.
- [x] 1.4 Replace the ticket's cancel + re-place drag handler with the single amendment and prove by test that no cancel is emitted.
- [x] 1.5 Map actionable Binance error codes to operator remedies, starting with `-2015`, and cover the mapping with tests.

## 2. Make Direction Unambiguous

- [x] 2.1 Add a shared presentation module deriving side, position leg, entry/exit effect, and colour tone from `side` plus `reduceOnly`, so one-way `BOTH` accounts never render as shorts.
- [x] 2.2 Colour chart price lines, chart order handles, the order list, and the dock by side and label them with the derived intent.
- [x] 2.3 Add signed, coloured PnL and ROE formatting for positions.

## 3. Restore Instrument Recency and Legibility

- [x] 3.1 Persist recent contracts, favourites, and the last traded contract; restore the last contract at startup.
- [x] 3.2 Order the catalogue recent → favourite → alphabetical in a single list, with no duplicate recent strip.
- [x] 3.3 Express every futures type size against a persisted `--fx-ui-scale` with a readable floor, and expose an in-app scale control.
- [x] 3.4 Add persisted browser-style zoom shortcuts to the Electron window for the panels outside the futures scale.

## 4. Surface Positions and Working Orders Continuously

- [x] 4.1 Add a dock below the chart listing positions and working orders with aggregate unrealized PnL and per-row close/cancel.
- [x] 4.2 Draw position entry and liquidation price lines on the chart.

## 5. Reduce Chart and Order-List Noise

- [x] 5.1 Remove the INDEX candle overlay, the INDEX price line, and the INDEX header field. (Index klines are still fetched by the reviewed public-read transport; dropping that route needs its own change to the transport route registry and boundary check.)
- [x] 5.2 Remove the yellow draft-price axis label left over from the MARK removal, keeping the draft line itself unobtrusive.
- [x] 5.3 Reduce chart order handles to notional in USDT plus a cancel control, leaving exact price to the price axis, and drop the price-line title that overlapped the axis.
- [x] 5.4 Quantize order notional to whole USDT in sizing, the notional field, and every derived display.
- [x] 5.5 Rebuild the order list as compact rows with a visible cancel control and inline reprice/resize through the atomic amendment.
- [x] 5.6 Default the chart interval to `15m`.
- [x] 5.7 Remove the contract-filter reference panel from the instrument rail, keeping filter enforcement and per-draft violation reporting.

## 6. Simplify the Chrome and Fix the Tape

- [x] 6.1 Reduce the workstation identity bar to the market and its live state, and remove the duplicate mode banner above it.
- [x] 6.2 Filter the bounded tape on ingestion so a minimum-notional threshold accumulates matching prints instead of letting small ones evict them.
- [x] 6.3 Give the trading rail's cancel and cancel-all controls real styling; they rendered as blank white boxes.
- [x] 6.4 Open a draggable order editor on double-click of a chart handle or an order row, closing on outside click or Escape, with price and USDT amount applied as one amendment.

## 7. Verify

- [x] 7.1 Extend adapter, validation, hook, ticket, chart, view, and dock tests for every behaviour above.
- [x] 7.2 Run the repository test suite, lint, futures workstation boundary check, runtime-mock check, and production build.
- [x] 7.3 Update operator documentation for the amendment path, the `-2015` remedy, and the new presentation defaults.
- [x] 7.4 Confirm with the operator on live Binance data that moving, resizing, and cancelling an order behaves as specified before archiving. Confirmed 2026-08-09 alongside the desk ergonomics run.
