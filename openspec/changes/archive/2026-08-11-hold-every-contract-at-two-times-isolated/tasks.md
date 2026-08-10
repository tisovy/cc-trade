## 1. The Desk Can Set A Margin Mode

- [x] 1.1 Add `trade.setMarginType` to `TRADING_COMMAND_ACTIONS` with a creator that names its contract explicitly (`src/utils/tradingCommands.js:16`), alongside the leverage command it mirrors.
- [x] 1.2 Validate it before any signed request: symbol required with no fallback to the contract on screen, mode restricted to ISOLATED or CROSSED (`electron/services/trading-command-validation.js:576`).
- [x] 1.3 Send it from the adapter (`POST /fapi/v1/marginType`) and re-read the contract's configuration afterwards (`electron/services/futures-trading-adapter.js:744`).
- [x] 1.4 Handle it in the connection beside `handleFuturesSetLeverage` (`electron/services/binance-connection.js:2157`): refuse it while trading is paused, re-read the configuration and the account after it, and treat Binance's -4046 ("no need to change margin type") as the contract already being in that mode.
- [x] 1.5 Expose `setMarginType` from `useFuturesTrading` (`src/hooks/useFuturesTrading.js:788`).
- [x] 1.6 Prove by test: a command without a symbol or with an unknown mode is refused; a paused desk sends nothing; -4046 is not reported as a failure.

## 2. The Default Is 2× Isolated

- [x] 2.1 Add a pure policy module that decides, from a contract's configuration, the positions and what the desk has already applied, whether to send a leverage change, a margin-mode change, or nothing.
- [x] 2.2 Only ever lower: a multiple at or below 2 is left alone, a multiple above 2 becomes 2, bounded by the contract's own ceiling.
- [x] 2.3 Never touch a contract with an open position, and never act on a position reading that is absent or no longer current.
- [x] 2.4 Apply it at most once per contract per session, and only mark it applied when the command actually left the desk — a refused send must be retried, not recorded as done.
- [x] 2.5 Drive it from the workstation where the configuration is already requested per contract (`FuturesProductionWorkstation.jsx:225`).
- [x] 2.6 Prove by test: 20× flat becomes 2×; CROSSED flat becomes ISOLATED; 1× is untouched; a contract with a position is untouched; an operator-set 10× survives leaving the contract and coming back; nothing is sent before positions are read.

## 3. The Confirmation States The Terms

- [x] 3.1 Carry the multiple into the confirmation description (`src/utils/futuresOrderConfirmation.js:53`) and pass it from the ticket, which already holds it (`FuturesTradingTicket.jsx:445`).
- [x] 3.2 State it in the panel large and in the liquidation yellow (`FuturesOrderConfirmation.jsx`, `FuturesProductionExecutionTicket.css:1498`).
- [x] 3.3 State an unreported leverage as unknown, never as a default multiple.
- [x] 3.4 Prove by test that the panel states the multiple, and states it as unknown where the exchange reported none.

## 4. What The Audit Of This Work Found

- [x] 4.1 The margin-mode default fired on a flat contract with a working order, which Binance refuses — an unrequested red card on the surface that reports real refusals. The mode is now left alone while an order rests; the multiple still moves, and the mode follows once the order is gone.
- [x] 4.2 The default fired on a paused desk, where both changes are refused by design, turning a pause into a pair of refusals nobody asked for. Nothing is sent while paused; the default applies on resume.
- [x] 4.3 The position gate accepted a snapshot held from before a dropped connection, so a contract that went into a position while the desk was disconnected read as flat. The gate is now the resource being `ready`, not having succeeded once.
- [x] 4.4 Prove each by test.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `npm run check:command-path`.
- [x] 5.2 Record the default in `docs/futures_trading.md`: what it sets, when it declines to, and that the operator's own choice stands.
- [ ] 5.3 Operator confirms on live data: opening a contract the account holds at a high multiple leaves it at 2× ISO in the ticket and on Binance's own screen; a contract with an open position is untouched; a hand-set multiple survives a contract switch; and the confirmation panel states the multiple before an order is sent.
