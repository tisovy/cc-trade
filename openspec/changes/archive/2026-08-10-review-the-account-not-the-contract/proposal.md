## Why

Three readings on the Futures dock were wrong about their own scope, and one was
wrong about its units.

- **The history tabs answered for one contract.** `Order history` and
  `Positions (PnL)` read the selected contract and discarded themselves when the
  contract changed. A session is not one contract: the operator asked why the tab
  did not show the positions they remembered taking, and the answer was that it
  had never been asked about those pairs. The exchange's own app lists the account.
- **The closed-position log listed things that were not closed positions.** A round
  still running appeared with no exit, and a round whose opening fills were older
  than the window appeared with no entry. Half-empty rows among finished ones read
  as noise — the operator called it garbage and restated the requirement: a
  position was entered, it was exited, and this is the log of that.
- **Realized PnL was the column that fell off the right edge.** Eight columns in
  the dock's width clipped the one reading the panel exists for, while the fee sat
  beside it taking room. The same clipping had already eaten the `+177.…` in the
  uPnL cell: 104px of track against 118px of content, in a cell that hides its
  overflow.
- **24h volume printed the base leg through a USDT formatter.** BMT showed `19.9B`
  where the exchange's app shows `641.13M`: 19.9 billion is the count of BMT
  traded, and 571M is what it was worth. A quantity of contracts labelled as money
  is not a formatting problem, it is a false statement about the market.

## What Changes

- History **spans the account**. Every USDⓈ-M history endpoint requires a symbol,
  so the backend first asks `/fapi/v1/income` which contracts were traded in the
  last seven days — the only read that answers without being told one — and fans
  out over at most eight: the contract on screen, then those holding positions or
  working orders, then the rest by recency. Both tables lead with the contract and
  price each row at that contract's own tick, and clicking a contract switches to
  it.
- The tab becomes `Closed positions` and reports **closed positions only**. A round still running is
  excluded — it has no result, and the live positions table above is where it
  belongs. A round opened before the window keeps its entry price: the exchange's
  realized PnL states it exactly, so it is recovered rather than shown as a dash,
  and the row says which of the two it is.
- The table loses the fee column to its own title and gains room where it matters:
  seven columns, with a floor under `Realized PnL`. The dock's money tracks are
  cut for five figures and two decimals, so `+10000.00` and its ROE both fit.
- The volume cell reports **`quoteVolume`, labelled USDT**, with both legs in its
  title.

## Decisions

**One contract failing does not blank the review.** The fan-out is per contract, so
a symbol Binance refuses removes only its own rows; the payload states which
contracts it covers, and only a total failure is reported as an error. The bound of
eight is logged when it drops anything — a silent cap reads as "this is everything".

**Exposure is folded per contract.** A BTC sell does not reduce an ETH long, so
each contract's fills are walked on their own running exposure. Folding them
together would close rounds that never closed and report open ones as flat.

**The entry price of a window-edge round is arithmetic, not a guess.** A long
realized `(exit − entry) × size` and a short `(entry − exit) × size`, before
commission, so inverting the exchange's own realized PnL recovers the average entry
exactly. It is labelled in the row's title as recovered, because a number's
provenance is part of the number.

**A closed position is filed under when it closed.** The column that used to carry
the open time carries the close time; the whole span stays in the title. A log of
finished positions is read newest-finished first, across contracts.

**Volume is the quote leg because that is what "volume" means at a desk.** The base
count is kept, not dropped: it is the same day measured in contracts and it sits in
the title with its unit named, where it cannot be mistaken for money.
