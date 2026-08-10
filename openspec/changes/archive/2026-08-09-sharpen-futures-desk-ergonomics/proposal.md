## Why

A second live session at the desk found the remaining places where the Futures
workstation still reports the exchange's raw shape instead of a trading
decision:

- The instrument rail is empty on the first frames after a restart, so the
  persisted recency list looks lost even though it is on disk.
- The trading rail repeats the market identity and the symbol already shown in
  the identity bar and the market header.
- Position rows print unrounded exchange floats (`3.344999999…`), a margin cell
  that reads `— · —×` because `/fapi/v3/positionRisk` no longer returns
  `leverage` or `marginType`, and a return-on-equity that cannot be computed
  from those missing fields.
- A position can only be closed at market. There is no way to place the
  reduce-only limit a trader actually wants when exiting into a level.
- After an amendment, the account snapshot that follows can be older than the
  amendment itself, so a resized order shows its previous size until the next
  refresh.
- The order book is denominated in base units and spends a row on `Spread` and
  the raw `lastUpdateId`, while offering no price grouping and only ten levels
  per side.
- Working-order rows in the dock cannot be edited, unlike the same orders on
  the chart and in the Orders tab.
- The market header carries `Mark` and `Basis`, which duplicate information the
  chart and positions already carry, and funding is printed without direction.
- The four order buttons are visually identical, so direction is read from text
  under time pressure.
- There is no order or trade history: realized PnL is invisible in the app.

## What Changes

- The instrument rail lists persisted recent contracts before the catalogue
  arrives and states when the catalogue is still loading.
- The trading rail header collapses to readiness plus the pause control; the
  duplicated market identity and symbol are removed.
- Position rows render prices at the contract's tick precision, drop the margin
  cell, and derive return on margin from the initial margin reported by
  `/fapi/v3/positionRisk`.
- Closing a position opens a draggable panel offering an immediate market close
  or a reduce-only limit close at an operator-chosen price and size.
- Locally confirmed execution reports survive an older account snapshot: order
  rows and chart handles show an amended size immediately.
- The order book is denominated in USDT, groups levels by a selectable price
  step, shows more levels per side, replaces the `Spread`/`lastUpdateId` row
  with the last traded price, and carries a buy/sell pressure bar split by the
  USDT resting on each displayed side.
- Dock working-order rows open the same order editor as the chart handle.
- `Mark` and `Basis` leave the market header; funding is coloured by sign.
- Long and short buttons are coloured by direction; available balance is shown
  to cents instead of raw exchange precision.
- **New capability**: order history and trade history with realized PnL and
  fees for the selected contract, fetched on demand through a typed
  `account.history` command.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: newest-wins order state, reduce-only limit close,
  editing from every order surface, order and trade history with realized PnL.
- `futures-workstation-presentation`: USDT order book with grouping, restart-
  resilient instrument recency, trimmed chrome, tick-precision position
  formatting, direction-coloured controls.

## Impact

- Execution path: `electron/services/futures-trading-adapter.js`,
  `electron/services/binance-connection.js`,
  `electron/services/trading-command-validation.js`,
  `src/utils/tradingCommands.js`, `src/hooks/useFuturesTrading.js`.
- Presentation: `FuturesWorkstationView`, `FuturesTradingTicket`,
  `FuturesPortfolioDock`, `FuturesProductionWorkstation`, new
  `FuturesPositionCloser`, new `FuturesHistoryPanel`, futures stylesheets.
- New shared modules: `src/utils/futuresOrderBook.js`,
  `src/utils/futuresPriceFormat.js`, `src/hooks/useFloatingPanel.js`.
- Market-data contract: renderer depth levels per side rise from 24 to 50 in
  `futures-workstation-order-book.js` and its renderer-side validator.
- Operator documentation: `docs/futures_trading.md`.
- No new runtime dependency. History uses two additional authenticated routes
  on the existing futures adapter (`/fapi/v1/allOrders`, `/fapi/v1/userTrades`),
  outside the isolated public-read workstation transport.
