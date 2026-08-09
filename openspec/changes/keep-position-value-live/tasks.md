## 1. Position Size Reads as an Amount

- [x] 1.1 Derive an unsigned mark notional in `describeFuturesPosition` and add an unsigned USDT formatter beside the signed one.
- [x] 1.2 Render the size cell unsigned under a `Size (USDT)` header, keeping the exact contract count in the cell title.
- [x] 1.3 Update the dock and presentation tests to the unsigned reading.
- [x] 1.4 Report an absent number as absent: `Number(null)` is 0, so a missing PnL or margin was rendering as a confident `0.00` instead of `—`.

## 2. The Size Control Belongs to Its Row

- [x] 2.1 Style `.futures-workstation-dock-size` as row-native text with hover and focus-visible affordances, so the selected row is not a white rectangle.
- [x] 2.2 Prove by test that the size control is reachable and labelled on the selected contract's row and absent on others.
- [x] 2.3 Guard the whole class of defect: assert every class the dock renders has a rule in the stylesheet, because an unstyled control fails silently.

## 3. Live Mark Price Feed

- [x] 3.1 Add `electron/services/futures-mark-price-feed.js`: symbol set from open positions, combined `<symbol>@markPrice@1s` stream URL, event normalization, batched broadcast, cache cleared on disconnect.
- [x] 3.2 Reconcile the subscription set only when the open-position symbol set actually changes, and tear the socket down when no position is open.
- [x] 3.3 Wire the feed into `binance-connection.js`: start with the first Futures renderer, stop with the last, follow every positions snapshot, never touch REST weight or credentials.
- [x] 3.4 Unit-test the feed against an injected socket factory and clock: subscription set, resubscription on change, batching, disconnect clearing, malformed frames.

## 4. Rows Valued at the Live Mark

- [x] 4.1 Add `src/utils/futuresPositionMarks.js` merging marks into positions: mark price replaced and uPnL recomputed as `(mark − entry) × quantity`, position untouched when any input is unusable.
- [x] 4.2 Consume `futures_position_marks` in `useFuturesTrading` and expose merged positions without mutating the account snapshot.
- [x] 4.3 Prove by test that uPnL, ROE, USDT size and total uPnL move with an incoming mark, and that clearing the feed restores the snapshot values.
- [x] 4.4 Document the feed and the unsigned size in `docs/futures_trading.md`.

## 5. Verification

- [x] 5.1 `npm test` (850 passed), futures boundary check and circular-import check pass; `eslint` clean on every touched file (two pre-existing errors in `src/utils/tradingCommands.js` belong to in-flight work outside this change).
- [ ] 5.2 Operator confirms on live data that uPnL ticks with the chart and the size column reads as plain USDT.
