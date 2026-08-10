## 1. Reading What the Contract Is Set To

- [x] 1.1 Add `getSymbolConfig`, `getMaxLeverage` and `setLeverage` to the futures adapter, with pure normalizers: an unreported leverage is absent rather than 1×, and the ceiling is bracket 1 of the contract's own leverage bracket.
- [x] 1.2 Add the `account.symbolConfig` read command and the `trade.setLeverage` write command, validated: the symbol never falls back to the contract on screen, and leverage must be a whole number in range.
- [x] 1.3 Read the config for the contract the desk is on whenever it changes, and for every symbol holding a position after an account refresh, bounded and admitted by the futures limiter.
- [x] 1.4 Merge the configs into the position rows by symbol, preferring a value a source states outright, so ROE, margin mode and the leverage badge all read one answer.

## 2. Stating It Where It Is Carried

- [x] 2.1 Show the multiple beside the contract on the order ticket and beside each position's symbol, as the control that changes it.
- [x] 2.2 State `Est. margin` for the draft — `notional ÷ leverage` — with the leverage named in its title, and fall back to the whole notional when no leverage has been reported.

## 3. Changing It

- [x] 3.1 Add the leverage panel: the exchange's stops bounded by the contract's ceiling, a slider, what the wallet can carry, the bracket cap where reported, and Apply disabled while the choice equals the current setting.
- [x] 3.2 Warn before the change, not after it: a position already open on that contract has its liquidation price moved by it.
- [x] 3.3 Keep showing what the contract is set to until the operator picks, so a config read landing after the panel opens cannot leave Apply armed to lower the leverage.
- [x] 3.4 Apply through `POST /fapi/v1/leverage`, then re-read the config and the account and report the leverage the exchange applied; refuse the change while trading is paused.

## 4. Verification

Closed on the operator's instruction of 2026-08-10 to finish and commit: this
check is theirs to run on live data, and the change is archived rather than held
open waiting for it.

- [x] 4.1 Unit-test the adapter reads and normalizers, and the renderer-side config merge including the absent cases.
- [x] 4.2 Prove the commands by test: both new families accepted for futures, refused for spot, refused without a symbol, and refused for a fractional or out-of-range multiple.
- [x] 4.3 Prove the backend by test: the config read answers with the leverage and its ceiling, a leverage change reports the applied figure and re-reads the account, and a paused desk refuses it.
- [x] 4.4 Prove the surfaces by test: the badge on the ticket and on every position row, the panel's stops, ceiling, buying power, open-position warning and Apply state, and the ticket's margin estimate at 20× and with no leverage reported.
- [x] 4.5 `npm test` (1167 passed, 90 files), project-wide `eslint` clean, five guard scripts pass.
- [x] 4.6 Operator confirms on live data: the badge matches what Binance shows for the contract, setting a multiple takes effect on the exchange, an open position's liquidation price moves as warned, and `Est. margin` matches what the exchange holds for the order.
