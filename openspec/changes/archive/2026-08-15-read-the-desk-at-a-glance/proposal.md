## Why

Several high-frequency readings on the trading desk currently cost unnecessary time or become unreadable in compact layouts: the operator has no always-visible clock, account-wide order symbols in the trading rail cannot switch the chart, small prices are clipped, one recent-symbol slot is left unused, and order-history fills are shown in contracts rather than their USDT value. These gaps are especially costly while moving quickly between contracts and reviewing executions.

## What Changes

- Add a centered local desktop clock beneath the Spot/Futures switch, using the workstation's restrained dark visual language and updating through seconds.
- Make each symbol in the trading rail's account-wide open-order table an explicit accessible control that selects that contract without opening the order editor.
- Rebalance the compact order-row columns so small decimal prices such as `0.000123` remain fully readable alongside symbol, side, USDT value, and cancel action.
- Retain and render nine recent Futures symbols, filling all three rows of the existing three-column pill grid.
- Present the order-history `Filled` reading as executed USDT notional, preferring the exchange's cumulative quote amount and retaining exact executed/original contract quantities as secondary detail.
- Add focused component and utility coverage after the production implementation is in place.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Add the active-workspace clock and expand the recent-contract capacity to a complete nine-pill grid.
- `futures-order-visibility`: Make compact open-order symbols actionable, preserve small-price readability, and state order-history filled amounts in USDT.

## Impact

- Application shell: `src/App.jsx` and `src/styles/app-layout.css` for the local clock.
- Futures trading rail: `src/components/features/futures/FuturesTradingTicket.jsx`, its parent wiring in `FuturesProductionWorkstation.jsx`, and `FuturesProductionExecutionTicket.css`.
- Futures symbol persistence: `src/utils/futuresSymbolHistory.js`.
- Futures account review: `src/components/features/futures/FuturesHistoryPanel.jsx`, using the normalized `quoteQty` already supplied by the history adapter.
- Tests will cover timer cleanup/formatting, symbol selection without edit propagation, narrow decimal-price layout contracts, nine-symbol persistence, and USDT fill presentation. No exchange API, transport contract, storage key, or dependency changes are required.
