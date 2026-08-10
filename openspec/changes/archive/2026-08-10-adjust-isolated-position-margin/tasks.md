## 1. Carry the Margin Figure Through the Read

- [x] 1.1 Add `isolatedWallet` to `normalizeFuturesPositions` so the isolated amount reaches the renderer alongside `initialMargin` and `isolatedMargin`.
- [x] 1.2 Add `describeFuturesPositionMargin` to `src/utils/futuresOrderPresentation.js`: reported `marginType` first, a positive isolated wallet or isolated margin second, cross initial margin last, and no figure at all when the read carries none.
- [x] 1.3 Cover it with tests, including the position that carries no margin figure and must not be shown as zero.

## 2. Show It on the Row

- [x] 2.1 Add a Margin column to the positions table in `FuturesPortfolioDock.jsx`, between the liquidation price and uPnL (ROE).
- [x] 2.2 Render it as a control that opens the margin panel, and mark the mode (isolated or cross) so the operator can see which position can be adjusted.
- [x] 2.3 Widen the dock row grid in `FuturesWorkstation.css` for the new column and style the control like the existing size shortcut.

## 3. Build the Command

- [x] 3.1 Add `ADJUST_POSITION_MARGIN: 'trade.adjustPositionMargin'` and `createFuturesAdjustPositionMarginCommand` to `src/utils/tradingCommands.js`.
- [x] 3.2 Validate it in `electron/services/trading-command-validation.js`: futures only, symbol required, position side from the known set, direction `ADD`/`REMOVE`, amount a positive number.
- [x] 3.3 Add `adjustPositionMargin` to `src/hooks/useFuturesTrading.js` and expose it on the execution state.
- [x] 3.4 Confirm `npm run check:command-path` still passes — the frame is composed only in the builder module.

## 4. Execute It

- [x] 4.1 Add `adjustPositionMargin` to `FuturesTradingAdapter`, calling `POST /fapi/v1/positionMargin` with `type` 1 for an increase and 2 for a decrease.
- [x] 4.2 Add `handleFuturesAdjustPositionMargin` to `binance-connection.js` and route it in the futures typed-command switch, so it inherits the market-activation gate.
- [x] 4.3 Refuse a decrease while futures trading is paused; allow an increase.
- [x] 4.4 Note the mutation and re-read the account on success, so the row shows the exchange's figure rather than the requested one.
- [x] 4.5 Report a determinate refusal with Binance's code and text; report an indeterminate one as unknown and re-read, without resending.

## 5. The Panel

- [x] 5.1 Add `FuturesPositionMarginEditor.jsx` on the shared floating-panel hook, anchored at the cursor and dismissed by clicking away.
- [x] 5.2 State the position's current margin, its mode, and the available USDT balance.
- [x] 5.3 Refuse locally only what is a fact: a non-positive amount, an increase above the available balance, a decrease above the committed margin, and any adjustment to a cross position.
- [x] 5.4 Wire it into `FuturesProductionWorkstation.jsx` beside the order editor and the position closer, so at most one panel is open.

## 6. Verify

- [x] 6.1 Unit tests for the builder, the validation, the adapter call, the presentation helper, the dock column and the panel.
- [x] 6.2 Backend tests: routed command, inactive-market refusal, paused decrease refused, paused increase sent, unknown outcome not reported as a failure.
- [x] 6.3 Run the full suite, lint, and every repository guard.
- [x] 6.4 Document the column and the command in `docs/futures_trading.md`.

## 7. Show the Liquidation Floor

- [x] 7.1 Extend `describeFuturesPositionMargin` with the maintenance requirement, the margin balance (committed margin less any unrealized loss) and the buffer standing above the floor — isolated positions only, since a cross buffer belongs to the account and not to one row.
- [x] 7.2 Draw the buffer in the panel as a proportional meter: maintenance, the margin above it, and a ghost segment for the amount being added or removed.
- [x] 7.3 Refuse a removal that crosses the floor, naming the largest amount that does not, and keep Binance the authority on anything smaller.
- [x] 7.4 State the figures beside the meter: margin, available, the resulting margin and the resulting buffer.

## 8. Name the Margin Mode

- [x] 8.1 Label the mode on the dock's margin cell, so it does not depend on the underline style alone; widen the column for it.
- [x] 8.2 Give the panel a mode line that says what the mode means for the funds behind the position.
- [x] 8.3 Add margin and mode to the position card in `FuturesTradingTicket.jsx`, beside the liquidation price.

## 9. Fix What the Column Exposed

- [x] 9.1 Clamp floating panels by their measured height so one opened near the bottom of the window is not cut off, and re-clamp when their content grows.
- [x] 9.2 Remove the content-sized trailing column from the dock row grids, so the headings line up with the values under them.

## 10. Make the Effect Legible

- [x] 10.1 Add a USDT slider on the order ticket's size control, ranged against the position, and drive the same amount state as the field.
- [x] 10.2 State the liquidation risk before and after — maintenance over margin balance — since it is the reading that moves on a healthy position where the bar moves by a sliver.
- [x] 10.3 Give the meter a taller track, a solid increase segment and a hard edge on both ghosts, so a narrow band reads as a boundary that moved.
- [x] 10.4 Stop the drag handle from capturing presses that land on its own controls, so the close button works.

## 11. Live Confirmation

Closed on the operator's instruction of 2026-08-10 to finish and commit: these
checks are theirs to run on live data, and the change is archived rather than held
open waiting for them.

- [x] 11.1 Operator: on a real isolated position, add margin and confirm the row's figure and the liquidation price both move to Binance's own values.
- [x] 11.2 Operator: remove margin from the same position, and confirm that an amount Binance considers too large is refused with its own message rather than silently swallowed.
- [x] 11.3 Operator: confirm the buffer and the liquidation risk shown agree with Binance's own margin ratio for the position, that the slider moves the drawing, and that the panel opens fully visible and closes on its × with the app window at the bottom of the screen.
