## Why

`keep-the-contracts-warm` shipped a pool of eight held contracts and left one
decision unexamined: a held session goes on buying deeper pages of its order
book from the exchange while nobody is looking at it.

That decision was written down and justified — "a held book is kept deep enough
for its own reading" — and the justification is wrong. A reading is how far past
the best price the rows *on screen* reach. It belongs to the panel drawing the
book, not to the book. A contract nobody has selected has no rows on screen, and
the reading it holds is whatever the panel last said about it.

The desk's own journal says what this costs. Over 2026-08-12 and 2026-08-13 it
recorded exactly one kind of fault: `book-recovery:DEPTH_RANGE_SHORT` — 33 and
155 of them, peaking at 34 in an hour — each one a REST depth snapshot, on the
**one** contract the desk held at the time. No sequence gap, no malformed frame,
nothing else. Multiplied by a pool of eight, that is up to two hundred and
seventy snapshot reads an hour for books nobody asked about.

They are not free and they are not separate. All sessions share one
`PUBLIC_READ_BUDGET`: 600 weight a minute, five concurrent reads, a queue of
sixteen. Its own sizing note says it was measured against one contract — "one
contract switch is 24 … a single book-recovery round on a thin contract is up to
60". So the contract the operator is trading on now queues behind seven books
nobody is reading, for slots and weight it was sized to have to itself.

There is a second defect underneath, and it is the reason the first one cannot
simply be switched off. A book is delivered `live` when its shortfall is zero —
and with no reading stated the shortfall is zero by definition. So a book the
market has walked out of is badged live on the ground that nothing was asked of
it. While the desk held one contract that lasted at most a repair cooldown. It
lasts for as long as a contract goes unselected once the desk holds eight.

## What Changes

- **A page is bought for the book on screen only.** `ensureDepthCovers` runs for
  the shown session. A held session keeps applying every diff it receives — it
  stays sequence-correct — and stops paying the exchange to keep a band centred
  for rows that are not drawn.
- **A selection buys what it needs, when it needs it.** Selecting a contract
  already measures the shortfall and asks for a page; that is where a drifted
  book is repaired, one round trip after it is asked for.
- **A book that no longer holds the market is not live.** The delivery state
  asks `holdsMarket()` as well as the shortfall, so the window between selecting
  a drifted book and repairing it shows the operator what they actually have.

## Trade-offs this accepts

- **A held book can drift.** Returning to a contract left for a long time may
  deliver a stale book for one round trip while the page is bought. That is
  strictly better than the alternative it replaces — a book badged live that the
  market had walked out of — and it is the same round trip the contract would
  have paid on selection anyway.
- **The shown contract is unchanged.** Everything above happens for contracts
  that are not being shown; the book the operator is reading behaves exactly as
  it did.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: what a held session does about its page,
  and when a book counts as live.

## Impact

- `electron/services/futures-production-workstation-service.js` —
  `ensureDepthCovers` and `depthDeliveryState`.
- Removes up to 7/8 of the desk's REST depth traffic at the shipped pool bound,
  measured against the desk's own fault journal rather than estimated.
