## 1. History That Covers the Account

- [x] 1.1 Add `getTradedSymbols` to the futures adapter: `/fapi/v1/income` bounded by time, reduced to the contracts traded, newest first — every other USDⓈ-M history endpoint requires a symbol, so a review of the account has to start by asking which ones.
- [x] 1.2 Fan the history command out over the contract on screen, the symbols holding positions and working orders, and the traded symbols, capped at eight, each read admitted by the futures limiter and logged when the cap drops anything.
- [x] 1.3 Report per-contract failure honestly: one refusal removes its own rows, the payload states which contracts it covers, and only a total failure is an error.
- [x] 1.4 Carry the contract on every row: both tables lead with Symbol, priced at that contract's tick, with the selected contract tinted rather than being all that is shown, and the contract clickable to switch to it.

## 2. A Log of Closed Positions

- [x] 2.1 Fold each contract's fills on its own exposure — one contract's sells do not reduce another's long — and key each round by contract, since trade ids are numbered per contract.
- [x] 2.2 Exclude a round that is still running from the closed-position log; the live positions table is where an open position belongs.
- [x] 2.3 Recover the entry price of a round opened before the window from its realized PnL, and state in the row that it was recovered rather than read.
- [x] 2.4 File a closed position under when it closed, with the whole span in the title, and sort newest-closed first across contracts.

## 3. Readings That Fit

- [x] 3.1 Drop the fee column into the PnL cell's title and give Realized PnL a floor of its own — the column the panel exists for was the one clipped.
- [x] 3.2 Cut every money track in the dock for five figures and two decimals, so `+10000.00` and its ROE both read whole.

## 4. Volume in the Unit It Claims

- [x] 4.1 Report `quoteVolume` in the volume cell, label it USDT, and keep the base leg in the title with its own unit named.

## 5. Verification

Closed on the operator's instruction of 2026-08-10 to finish and commit: this
check is theirs to run on live data, and the change is archived rather than held
open waiting for it.

- [x] 5.1 Unit-test the new adapter reads and the per-contract fold: traded-symbol discovery, the implied entry, and a contract's exposure not being reduced by another's fills.
- [x] 5.2 Prove the surfaces by test: the fan-out order and its partial failure, both history tables' Symbol column and per-contract ticks, closed-only rows, the empty state naming how many contracts were read, and the volume cell's value, label and title.
- [x] 5.3 `npm test` (1167 passed, 90 files), project-wide `eslint` clean, five guard scripts pass.
- [x] 5.4 Operator confirms on live data: the tabs list the positions they remember closing on every pair they traded, each row shows an entry and an exit, Realized PnL is never clipped, and the 24h volume matches the Binance app.
