## Why

On 2026-08-13 the operator traded AKEUSDT through a run of sharp upward breaks
and reported the book failing to fill: "то одна сторона только видна, потом
только вторая". The desk's own journal records 153 `DEPTH_RANGE_SHORT`
recoveries the same day — 60 of them in the two hours the operator was working
that contract.

A one-sided book is what a band that has stopped moving looks like.

**A diff outside the band is dropped, on purpose.** A snapshot proves a stretch
of price; outside it only the levels some diff happened to touch are known, and a
grouped row drawn across the gaps between them understates the market
(`electron/services/futures-workstation-order-book.js:176`). So when the market
walks past an edge, the side it walked toward stops receiving levels. The book
keeps every level it can still prove and delivers them exactly — there are simply
fewer and fewer of them on that side, until the side is empty and its twin is
full. Nothing about it looks like a failure from inside the desk.

**The answer is the same page read again, centred where the market is now**, and
the spec already requires it: *"the best price leaves a band read at the deepest
page the exchange publishes → that page is read again, centred where the market
is now, rather than the book going on dropping the levels it can no longer
prove."*

**The desk reaches that read down one path only.** `ensureDepthCovers` decides
everything from a single number, the shortfall — how many times deeper the page
would have to be to cover the rows on screen
(`electron/services/futures-production-workstation-service.js:450`). A shortfall
of exactly 1 means every side's page did reach the rows when it was read, so the
market has walked rather than the page being short, and the page is re-read.
Above 1 some side's page never reached the rows, so a deeper page is bought — and
at the deepest page there is none to buy, so the desk returns without reading
anything (`:474`).

That last branch is the defect. It is written as *"there is nothing to buy"*,
which is true, and it acts as *"there is nothing to do"*, which is not. Depth and
centring are two different questions, and only one of them is about the operator's
step. Worse, the branch is not a passing condition: what a page proved is fixed at
the moment it was read, so at the deepest page a shortfall above 1 can never come
back down. On a contract read at a step the exchange does not publish deep enough
for, the desk enters that branch on the first frame and stays in it for the
session — the band never moves again, and every break takes a side of the book
with it.

**AKEUSDT at the step the operator reads it at is exactly that contract.**
Measured through the desk's own proxy on 2026-08-13, the deepest page Binance
publishes — a thousand levels a side — reaches this far past the mid:

| Contract | reach below | reach above | ticks to price |
|---|---|---|---|
| AKEUSDT | 4.10% | 3.90% | 77 240 |
| BTCUSDT | 0.19% | 0.19% | 634 236 |
| ETHUSDT | 0.55% | 0.55% | 188 695 |
| TUTUSDT | 33.22% | 28.35% | 3 865 |

The coarsest grouping step the panel offers is 500 ticks, which over fourteen
rows asks for 9.1% of price on AKEUSDT. Against 4.1% published, the shortfall is
2.2 — permanently. The operator was trading the one state the desk never
re-centres out of.

## What Changes

- Whether the band still covers the rows and whether it still holds the market
  become two questions. The first is the reading's, and a deeper page answers it.
  The second is the market's, and no page depth answers it — only the same page,
  read again, where the market is now.
- The book gains that second question: whether each side still has room left
  between the best price and the edge of the band. It is asked against what that
  side's page proved when it was read, so it means the same thing at every page
  depth and on every contract, and it does not mention the operator's step.
- A band the market has taken three quarters of the room out of is re-read,
  whatever its page depth and whatever its shortfall. Re-reading while a quarter
  of the room is still there is what keeps the side from emptying: the refill is
  bought before the rows run out, not after the operator has watched them go.
- A band that still holds the market is left alone, however far short of the rows
  it falls. A page that cannot cover the reading is not re-read for that reason,
  which is what keeps a contract the exchange publishes no deeper than this from
  reading the same page every five seconds for the session.

## Non-Goals

- The ladder of grouping steps is not touched here. That the coarsest step asks
  for more than the exchange publishes on every contract measured above is a real
  defect, and it is what leaves half the panel blank at that step; it is the
  subject of the change that follows this one. This change makes the book correct
  at whatever step it is read at.
- The delivered state is not touched. A book that cannot prove the rows on screen
  still reads `STALE`, which is what `prove-the-book-covers-both-sides`
  established and what the badge should say while it is true.
- No new depth page is bought and no new field crosses the protocol. The read
  this change adds is a page the desk was already entitled to and already reads —
  it is reached down one more path.

## Notes

This change modifies `The book states the band it can prove`, which
`prove-the-book-covers-both-sides` also modifies and which has not archived: its
operator check is still open. The delta below carries that change's text in full
and adds to it, so the two apply in either order without losing each other.
