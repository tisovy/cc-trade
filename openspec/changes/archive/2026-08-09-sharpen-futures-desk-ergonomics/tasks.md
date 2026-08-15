## 1. Instrument Rail and Rail Chrome

- [x] 1.1 List persisted recent contracts before the catalogue arrives, replacing each entry in place once the catalogue loads, and state when the catalogue is still loading.
- [x] 1.2 Seed the recency list with the restored contract at startup so the rail is never empty after a restart.
- [x] 1.3 Collapse the trading rail header to readiness plus the pause control and remove the duplicated market identity and symbol.

## 2. Positions

- [x] 2.1 Format position entry, mark and liquidation prices at the contract's tick precision.
- [x] 2.2 Carry `initialMargin`, `isolatedMargin` and `notional` through position normalization and derive return on margin from them; report it as unavailable when no margin figure exists.
- [x] 2.3 Remove the margin/leverage cell that `/fapi/v3/positionRisk` cannot populate.
- [x] 2.4 Add a draggable close panel offering an immediate market close or a reduce-only limit close, with a size that cannot exceed the open position.

## 3. Order State Freshness

- [x] 3.1 Keep the newer of a confirmed execution report and an account snapshot per order identity, comparing exchange update times.
- [x] 3.2 Prove by test that a snapshot older than a confirmed amendment does not restore the previous size.

## 4. Order Book

- [x] 4.1 Denominate level size and cumulative size in USDT.
- [x] 4.2 Group levels by a selectable price step derived from the contract tick size, aggregating exactly and falling back to ungrouped when filters are missing.
- [x] 4.3 Replace the `Spread` and update-id row with the last traded price and raise the delivered depth to 50 levels per side.
- [x] 4.4 Add a buy/sell pressure bar under the book, split by resting USDT across the displayed levels and hidden when there is no book.

## 5. Editing Surfaces

- [x] 5.1 Open the order editor from dock working-order rows, leaving exchange-managed rows display-only.

## 6. Header, Controls and Balance

- [x] 6.1 Remove `Mark` and `Basis` from the market header and colour funding by sign.
- [x] 6.2 Colour the long and short controls by direction.
- [x] 6.3 Show available balance to cents.

## 7. History

- [x] 7.1 Add `getOrderHistory` and `getTradeHistory` to the futures adapter over `/fapi/v1/allOrders` and `/fapi/v1/userTrades`, returning bounded normalized rows.
- [x] 7.2 Add the typed `account.history` command with validation, route it in the Electron connection, and emit a bounded `futures_history` payload including failures.
- [x] 7.3 Consume history in the futures trading hook, discarding it on contract change.
- [x] 7.4 Present order history and trade history with signed realized PnL and fees in the dock.

## 8. Verify

- [x] 8.1 Extend adapter, validation, hook, ticket, view, dock, order-book and history tests for every behaviour above.
- [x] 8.2 Run the repository test suite, lint, futures workstation boundary check, runtime-mock check, and production build.
- [x] 8.3 Update operator documentation.
- [x] 8.4 Confirm with the operator on live Binance data before archiving. Confirmed 2026-08-09: the order book renders, positions open and close, and balances are present and correct.
