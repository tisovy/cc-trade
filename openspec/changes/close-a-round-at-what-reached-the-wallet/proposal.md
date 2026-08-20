## Why

The operator reports that the figures in the Closed Positions tab do not match
what the Binance app shows for the same closed positions. Two defects in the fold
account for a difference, and both make the desk's number the larger one on a
winning round.

**The headline is realized PnL before anything was taken off it.** The row
renders `round.realizedPnl`
(`src/components/features/futures/FuturesHistoryPanel.jsx:441`), and the fold
builds that by summing the exchange's per-fill `realizedPnl`
(`src/utils/futuresTradeRounds.js:186`). Binance reports per-fill realized PnL
*before* its own commission, which the code says in its own comment, and it does
not include funding at all — funding is charged against the wallet on an income
row, never on a fill. The desk's own `netPnl` subtracts the commission but is not
what the column shows, and nothing anywhere subtracts funding. A position held
across even one funding boundary therefore reports a result the exchange never
credited.

**The fee total adds up different currencies.** `round.fee += toNumber(fill.commission) * share`
(`src/utils/futuresTradeRounds.js:192`) sums `commission` with no regard for
`commissionAsset`, which the normalizer does carry all the way to the renderer
(`electron/services/futures-trading-adapter.js:381`,
`src/utils/futuresHeldHistory.js:320`). An account that pays fees in BNB — the
default whenever BNB is held, because Binance discounts it — has BNB amounts
added into a USDT total. That total then appears in the row's title as
"less N in fees", and it is not a quantity of anything.

## What Changes

- **The closed-round headline becomes what reached the wallet**: realized PnL,
  less commission, plus funding paid or received over the round's life, plus
  insurance clearance where the round was part-liquidated. That is the figure the
  Binance app calls the closed position's PnL, and matching it is the point.
  The exchange's own pre-fee realized PnL stays available on the element, because
  it is the number that reconciles against `/fapi/v1/userTrades` row by row.
- **Funding is attributed to the round it was charged during**, from the income
  rows made available by `state-what-an-open-position-has-already-paid`: rows of
  type `FUNDING_FEE` on the round's contract, timestamped between the round's
  open and its close. Not per leg — an income row states no `positionSide` and
  names no trade for funding, so on a hedge account holding both legs there is
  nothing to divide the charge by, and the round says the funding is the
  contract's rather than claiming a share of it.
- **Each component keeps the sign its own record states it in.** Realized PnL and
  commission come from the trade record, where commission is an unsigned
  magnitude and is subtracted; funding and insurance clearance come from the
  income record, where an outflow is already negative and is added. Subtracting
  an already-negative income row would hand the charge back to the operator as
  profit.
- **Commission is summed per asset.** A fee charged in an asset other than the
  contract's settlement asset is stated in the asset it was charged in and is not
  added into the settlement-asset total. The desk holds no rate to convert it at
  and will not print a guess beside money.
- **A round whose funding the desk cannot see says so**, the same way an entry
  price recovered from realized PnL already says so. A round that opened before
  the income window has funding the read did not reach, and a total quietly
  missing it is worse than one that names its own edge.
- **MODIFIES** `futures-order-visibility` → "Executions are reported as the
  positions they formed", whose "Realized PnL SHALL be reported as the exchange
  reports it, with the fees and the net stated on the element" is the sentence
  that puts the pre-fee figure in the column.

## Impact

- `src/utils/futuresTradeRounds.js` — per-asset fee accumulation, funding and
  insurance attribution, and the round's reported result.
- `src/components/features/futures/FuturesHistoryPanel.jsx` — which figure the
  PnL cell states, and what its title decomposes it into.
- `src/utils/futuresHistoryStore.js` / `futuresHeldHistory.js` — carrying the
  income rows into the fold alongside the fills.
- Tests: the fold (funding inside a round, BNB commission, a round older than the
  income window) and the panel row.

## Depends on

`state-what-an-open-position-has-already-paid`, which is what makes the income
amounts available at all. This change lands after it.

## Open question for the operator

The Binance app presents closed-position results in more than one place —
Position History, Trade History and the wallet's transaction record — and they
do not all net the same components. This change targets Position History, whose
figure is realized PnL net of commission and funding. If the app screen the
operator is comparing against is a different one, the target moves, and that is
worth settling before the arithmetic is fixed to match the wrong one. The live
check in `tasks.md` records which screen was used.
