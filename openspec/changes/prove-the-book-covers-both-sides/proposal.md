## Why

The screenshot the operator brought back shows an order book with a full ask
ladder and seven bid rows under it, badged `LIVE`. That is not a layout defect.
It is the book stating, correctly, that it cannot prove the bid side — and the
badge stating, incorrectly, that everything is fine.

Four mechanisms combine into it.

**The shortfall is measured on the wrong axis.** `coversRange` asks the question
per side: does the band still reach `range` below the best bid *and* `range`
above the best ask (`electron/services/futures-workstation-order-book.js:268`).
`rangeShortfall` answers it on the total span: `(ask − bid + 2·range)` divided by
`(ceiling − floor)` (`:292`). A wide side therefore pays for a short one. With
bids from 10 down to 9.9, asks from 10.1 up to 12, and a range of 1: `coversRange`
is false — the bid side is short by 0.9 — while the shortfall computes to exactly
1, because the span of 2.1 happens to equal the need of 2.1. `ensureDepthCovers`
only buys a deeper page above 1
(`electron/services/futures-production-workstation-service.js:336`), so it
re-reads the same page, gets the same asymmetry, and the bid side stays short.

**The band drops levels silently.** `applyLevels` discards any new non-zero level
outside the band the snapshot proved (`:174`). That rule is right — a row drawn
across levels nobody read understates the market. But nothing tells the operator
it is happening, and the side thins out row by row while the badge stays green.

**`LIVE` is stated before coverage is checked.** In `handleStreamFrame` the order
is: apply the diff, deliver the book as `LIVE`, *then* ask whether the band still
covers the rows (`:936-950`). The frame the operator reads has already been sent
by the time the desk decides it was short.

**Recovering takes ten to fifteen seconds by construction.** A contract opens at
page 0 of the ladder — fifty levels per side, the cheapest read
(`electron/services/futures-production-workstation-transport.js:44`) — because
`depthRange` is cleared for a fresh contract (`:537-539`) and the panel only
states its range after the subscription exists
(`src/hooks/useFuturesProductionWorkstation.js:413-416`). Climbing from there is
gated by two five-second cooldowns that stack: `depthDeepenedAt` (`:320-322`) and
`bookRecoveredAt`, which `recoverBook` re-stamps when it *finishes* (`:1052`). Two
rungs of the ladder is ten seconds and more, and the operator reads a lopsided
book badged `LIVE` for all of it — during the move they opened the contract for.

## What Changes

- The shortfall is measured per side, and the page bought answers the worse side.
  A side that does not reach the rows on screen buys depth even when the other
  side is over-deep.
- Coverage is judged before the book is delivered, not after. A book that does
  not cover the stated range on both sides is delivered `stale`, so the badge
  says what the rows show. It is still delivered — a short book is worth reading,
  a short book called live is not.
- The range the panel reads travels with the request that selects the contract,
  so the first snapshot is bought at the page that covers the rows rather than
  always at the cheapest and then climbing to it.
- Deepening the page is not held behind the recovery backoff. The ladder has four
  rungs and only ratchets upward, so it cannot loop; the backoff stays where it
  belongs, on a recovery that failed.

## Non-goals

- The band rule itself is unchanged. Levels outside what a snapshot proved are
  still dropped rather than drawn.
- Re-reading the same page when the band is wide enough and the market has simply
  walked out of it is unchanged: that is a re-centring, not a shortfall, and it
  stays cheap.

## Impact

- `electron/services/futures-workstation-order-book.js`,
  `electron/services/futures-production-workstation-service.js`,
  `src/utils/futuresWorkstationProtocolShared.js`,
  `src/hooks/useFuturesProductionWorkstation.js`.
- The operator sees `STALE` on the book where they saw a green badge over missing
  rows. Nothing that was drawn correctly changes.
- Modifies two requirements in `futures-workstation-presentation`.
- Independent of `send-only-the-book-on-screen`, but reads better after it: the
  range gains a second job there and a third here.
