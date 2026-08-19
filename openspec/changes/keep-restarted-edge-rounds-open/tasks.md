## 1. Reproduce Before Touching

- [ ] 1.1 Drive `buildFuturesTradeRounds` with the two scenarios against the
  current code and record what it publishes: the still-held add, and the new
  short after a full re-close.

## 2. Fix

- [ ] 2.1 Publish a restarted round holding any of its added size as open —
  at the end of the fills, and when an increasing fill follows a partial
  re-close.
- [ ] 2.2 End the round when a reducing fill arrives after everything added
  was re-closed, and let that fill open a new round on its own evidence.

## 3. Guard

- [ ] 3.1 Two cases in `futuresTradeRounds.test.js`, one per scenario, proven
  to bite: with the fix stashed both must fail; record the failing output.

## 4. Verification

- [ ] 4.1 The whole rounds suite green, including every archived break-even
  scenario; lint on touched files.
