## Why

A Positions row states only what the position is worth if it were closed right
now — its unrealized PnL. It says nothing about the money the position has
already moved: the realized PnL of the parts already closed, the funding paid or
received while it has been held, the commission it has been charged, and the
insurance clearance if it has ever been part-liquidated. On a position that has
been scaled out of several times and held across a funding boundary, those are
the larger number, and they are already settled — they are in the wallet, and the
unrealized figure beside them will not be.

Today the operator has to reconstruct that from the closed-position tab, which
reports only rounds that returned to flat and therefore reports nothing at all
about a position that is still open. The one place the desk already reads
funding-and-fee history — `/fapi/v1/income` — is read for its `symbol` column
only: `getTradedSymbolPage` asks for `incomeType: 'REALIZED_PNL'` and throws the
amounts away (`electron/services/futures-trading-adapter.js:1296-1322`,
`readFuturesTradedSymbols:506`). The comment above it says so outright: "the
amounts on these rows are never read."

## What Changes

- **The income walk carries its amounts and its types.** The existing
  account-wide, page-bounded walk is widened from `REALIZED_PNL` to also cover
  `FUNDING_FEE`, `COMMISSION` and `INSURANCE_CLEAR`, and returns the rows'
  amounts, assets, symbols and times rather than only the set of symbols it
  found. It stays one account-wide read — Binance answers `/fapi/v1/income`
  without a symbol — so it costs the same weight for every open position
  together as it does for one, which is why it is not read per symbol.
- **Each open position states the settled money it has already produced**, as a
  new `PnL` column beside `uPnL` in the Positions panel: realized PnL of the
  parts already closed, plus funding, plus commission, plus insurance clearance
  where there is any. The breakdown is stated on the element, because a single
  net figure the operator cannot decompose is not auditable against the exchange.
- **The reading is bounded by what the desk can actually see, and says so.** A
  position's own start is the open round the fills walk already computes
  (`futuresTradeRounds`, `open: true`); where the position was opened before the
  read's window, that start is unknown, and the row SHALL state the figure as
  covering the window rather than the position. A total silently missing eight
  hours of funding is worse than one that names its own edge.
- **Commission and funding are summed per asset.** Binance charges commission in
  BNB when the account holds it, and a BNB amount added to a USDT total is not a
  total. A non-USDT component is stated in its own asset rather than folded in.
- **ADDS** to `futures-order-visibility`: "An open position states the money it
  has already settled" and "A settled-money reading names its own window".
- **MODIFIES** `futures-live-readiness` → "Values no stream carries are read, not
  computed", which currently enumerates the unstated values as the liquidation
  price, the position margin and the free margin. Settled income is a fourth: no
  authenticated stream carries the history of what a position has already paid,
  and `ACCOUNT_UPDATE` reports a funding charge as a wallet movement without
  attributing it to a contract.

## Impact

- `electron/services/futures-trading-adapter.js` — `getTradedSymbolPage` gains
  the income types and returns rows; `readFuturesTradedSymbols` keeps working off
  the same rows so symbol discovery is unchanged.
- `electron/services/binance-connection.js` — the income walk (`:3393`, `:3495`)
  broadcasts the folded per-contract settled totals alongside the symbols it
  already publishes; re-walked when a fold reports a realizing fill or a
  `FUNDING_FEE` cause, not on a timer.
- `src/utils/` — a new fold from income rows to per-contract, per-leg settled
  totals, bounded by the open round's start.
- `src/components/features/futures/FuturesPortfolioDock.jsx` — one column, and
  the header and column template beside it.
- `src/utils/futuresOrderPresentation.js` — the row presentation gains the
  settled figures; `describeFuturesPosition`'s existing fields are untouched.
- Tests: the adapter read, the fold, and the dock column.

## Non-goals

- The closed-position tab's own arithmetic. It has the same gap and it is
  `close-a-round-at-what-reached-the-wallet`, which builds on the income rows
  this change makes available and lands after it.
- Any change to unrealized PnL, which is `hold-the-position-value-to-one-price`.
