## Why

Live Futures trading exposed defects that make the workstation unsafe and unreadable at the desk:

- Moving an order was implemented as cancel + re-place with no sequencing. A rejected re-place (for example Binance `-2015`) can cancel successfully and then fail, leaving the trader unintentionally flat without any signal.
- Command rejections surfaced the raw exchange message only. `-2015 Invalid API-key, IP, or permissions for action` reads as a transport fault while account reads keep working, hiding that the key lacks Futures **trading** permission or is IP-restricted.
- Order colour was derived from `positionSide`, which Binance reports as `BOTH` for one-way accounts, so every order — including plain buys — rendered red and was labelled `BOTH ENTRY`.
- The type scale ran from 7px to 15px with no scaling control, and the instrument rail sorted alphabetically, burying the contracts actually being traded.
- Positions and working orders were only reachable behind tabs, and their PnL was an unsigned, uncoloured string.
- Chart order lines and the order list carried more decoration than information: full labels, exact prices repeated on the price axis, an unlabelled cancel control, and no way to change price or size without leaving the row.

## What Changes

- **BREAKING**: Futures order moves use the Binance USDⓈ-M native amendment (`PUT /fapi/v1/order`) behind the typed action `trade.replaceOrder` for futures only. Cancel + re-place is removed as a move strategy; a rejected amendment leaves the original order untouched and triggers account resynchronization.
- Command rejections carry the Binance error code and, for known codes, the concrete operator remedy — starting with `-2015` (enable Futures on the key, check the IP allowlist).
- Order and position direction is derived from `side` and `reduceOnly` and rendered by side (BUY green, SELL red) in every surface: chart price lines, chart order handles, order list, and the dock.
- The instrument rail keeps a persisted recency list and favourites, restores the last traded contract at startup, and orders the catalogue recent → favourite → alphabetical.
- The workstation type scale is expressed against a persisted `--fx-ui-scale` with an in-app control, and the Electron window gains browser-style zoom shortcuts persisted across restarts.
- A portfolio dock under the chart shows every position and working order continuously, with signed, coloured PnL and ROE, aggregate unrealized PnL, and one-click close/cancel. The chart marks position entry and liquidation prices.
- Chart order handles reduce to notional in USDT plus a cancel control; exact price stays on the price axis. Chart clutter is removed: no INDEX overlay, no INDEX price line, no INDEX header field, and no yellow draft-price axis label.
- Order notional is quantized to whole USDT so sizing never produces sub-cent noise.
- Each open order can be repriced and resized inline from the order list through the same atomic amendment.
- The default chart interval becomes `15m`.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: atomic amendment as the only move path, side-derived direction and colour, inline reprice/resize, notional-first order presentation, continuous position/order dock.
- `futures-workstation-presentation`: persisted instrument recency and favourites, persisted interface scale plus window zoom, INDEX and draft-marker removal, whole-USDT sizing, `15m` default interval.

## Impact

- Execution path: `electron/services/futures-trading-adapter.js`, `electron/services/binance-connection.js`, `electron/services/trading-command-validation.js`, `src/utils/tradingCommands.js`, `src/hooks/useFuturesTrading.js`.
- Presentation: `FuturesProductionWorkstation`, `FuturesWorkstationView`, `FuturesWorkstationChart`, `FuturesTradingTicket`, new `FuturesPortfolioDock`, futures stylesheets.
- New shared modules: `src/utils/futuresOrderPresentation.js`, `src/utils/futuresSymbolHistory.js`, `src/utils/uiScale.js`, `electron/renderer-zoom.js`.
- Operator documentation: `docs/futures_trading.md`.
- No new runtime dependency. The amendment endpoint is an additional authenticated route on the existing futures adapter, outside the isolated public-read workstation transport.
