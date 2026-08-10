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

## 7. Live Confirmation

- [ ] 7.1 Operator: on a real isolated position, add margin and confirm the row's figure and the liquidation price both move to Binance's own values.
- [ ] 7.2 Operator: remove margin from the same position, and confirm that an amount Binance considers too large is refused with its own message rather than silently swallowed.
