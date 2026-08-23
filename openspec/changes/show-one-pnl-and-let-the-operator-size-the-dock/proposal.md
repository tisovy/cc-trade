# Show one PnL and let the operator size the dock

## Why

Four operator rulings arrived on 2026-08-23, all about the portfolio dock, and
the desk's own journal surfaced a coverage regression underneath them.

**The rulings.** (1) The dock's fixed height hides the order review — the
operator wants to stretch it, wants the refresh control smaller, the Full
button gone, and less header padding. (2) The "Closed-position scope is
partial" banner is noise: the unresolved scope it narrates is almost always a
position the operator is already looking at in the live table above. (3) The
closed-row money lost its rounding when it became exact (`ac1800e`), and the
NET column beside the PnL is a quantity the operator did not ask to see —
"он не нужен". (4) The one-word Partial badge under an open position's PnL is
the same noise one panel up — the row shows the number and nothing else, and
errors belong to the dock's own alert line, not to the row.

**The regression.** After `ac1800e` re-keyed the persisted history store by
account fingerprint (v2), the coverage that used to name every traded contract
became invisible. A one-contract `basisOnly` read then stamped `readViews.trades`,
the Closed Positions tab believed the view was covered and never issued its
account-wide read, and the incremental refresh could not widen it — discovery
short-circuits as soon as any covered contract exists. The review showed one
contract and called it the account. Beside it, the reconcile gap-read fired
before a contract was chosen and was refused `INVALID_TYPED_HISTORY_SYMBOL`
once per session start (journal: seven refusals on 2026-08-22, every start
since), losing the offline-gap close each time.

## What Changes

- The dock's top edge is a drag handle: one height for both panels, arrow keys
  and double-click reset, persisted as `futuresDockPanelHeight`. The header is
  compacted; the Full button is removed; the refresh control shrinks to a glyph.
- Closed rows carry one money column, named PnL: Binance's own realized PnL at
  cents (rounded losslessly, on the string), with the exact figure and what
  reached the wallet — Wallet Net or the qualified visible net with its
  reasons — named on the element. The NET column, its badges and the
  partial-scope banner are removed; the empty-state still refuses the
  "no closed positions" claim while any scope is unresolved.
- An open position's PnL cell shows amounts only; the Partial badge is gone.
- A `basisOnly` read merges rows and coverage but no longer vouches a view as
  read; the reconcile gap-read names a held position when no contract is
  chosen, or waits; the refresh control escalates to the full discovery read
  while the held reading says discovery did not finish.

This supersedes the Gross-and-NET row presentation scenarios of
`make-futures-wallet-net-additive`: the wallet quantities that change proposed
survive to the last digit, on the element instead of in a second column.

## Impact

- `src/components/features/futures/FuturesHistoryPanel.jsx`, `FuturesPortfolioDock.jsx`,
  `FuturesWorkstation.css` — presentation.
- `src/utils/futuresHeldHistory.js`, `src/hooks/useFuturesTrading.js` — the
  read restoration. All renderer-side; no electron restart on a live desk.
- Landed in `04b1c9c`.
