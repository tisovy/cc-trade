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

- **Settled money gets its own read of `/fapi/v1/income`, carrying the amounts.**
  Binance's own OpenAPI settles the shape (see `tasks.md` 1.2): `incomeType` is a
  single enum value and *"if `incomeType` is not sent, all kinds of flow will be
  returned"*, so this is **one account-wide read at weight 30** covering realized
  PnL, funding, commission, insurance clearance and the rebates that offset
  commission — not one read per type and not one per contract.

  It is deliberately **not** the existing `collectFuturesHistorySymbols` walk.
  That walk answers "which contracts has this account traded this week", which
  moves slowly, and it is built for that: cached behind a discovery hold,
  persisted through the renderer's coverage store, bounded by a page budget.
  Settled money moves on every fill and every funding boundary, and hanging it
  off a cache tuned for a weekly answer would have shown the operator a figure
  that was right the first time and stale after. The two share the row
  normalizer and nothing else.
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
- **The components are summed, not subtracted.** An income row's `income` is
  signed — positive is an inflow — so funding paid, commission and insurance
  clearance all arrive negative and the settled figure is their sum. Commission
  read off a *fill* is the opposite: a positive magnitude that has to be
  subtracted. Both records are in play on this desk, and the rule is written down
  because mixing them silently double-counts every fee.
- **A leg is only claimed where the exchange states one.** An income row carries
  no `positionSide`; only rows with a `tradeId` can be joined to the fill that
  has the leg. Funding is not a trade and carries no `tradeId`, so on a hedge
  account holding both legs of one contract the funding is stated on the
  contract rather than split between the legs by a rule the exchange never
  applied.
- **ADDS** to `futures-order-visibility`: "An open position states the money it
  has already settled" and "A settled-money reading names its own window".
- **MODIFIES** `futures-live-readiness` → "Values no stream carries are read, not
  computed", which currently enumerates the unstated values as the liquidation
  price, the position margin and the free margin. Settled income is a fourth: no
  authenticated stream carries the history of what a position has already paid,
  and `ACCOUNT_UPDATE` reports a funding charge as a wallet movement without
  attributing it to a contract.

## Impact

- `electron/services/futures-trading-adapter.js` — a `getIncomeRows` read that
  sends no `incomeType` and normalizes `symbol`, `incomeType`, `income`, `asset`,
  `time`, `tranId` and `tradeId`. `getTradedSymbolPage` and
  `readFuturesTradedSymbols` are left exactly as they are, so contract discovery
  is untouched.
- `electron/services/binance-connection.js` — issues that read and broadcasts the
  folded per-contract settled totals, on a realizing fill or a funding cause, not
  on a timer.
- `src/utils/` — a new fold from income rows to per-contract, per-leg settled
  totals, bounded by the open round's start.
- `src/components/features/futures/FuturesPortfolioDock.jsx` — one column, and
  the header and column template beside it.
- `src/utils/futuresOrderPresentation.js` — the row presentation gains the
  settled figures; `describeFuturesPosition`'s existing fields are untouched.
- Tests: the adapter read, the fold, and the dock column.

## Bounds worth stating

Binance keeps income history for the last three months. Any window this reads is
floored by that, whatever the desk's own history window is, and a position older
than three months can never have a complete settled figure from this source.

## Non-goals

- The closed-position tab's own arithmetic. It has the same gap and it is
  `close-a-round-at-what-reached-the-wallet`, which builds on the income rows
  this change makes available and lands after it.
- Any change to unrealized PnL, which is `hold-the-position-value-to-one-price`.
