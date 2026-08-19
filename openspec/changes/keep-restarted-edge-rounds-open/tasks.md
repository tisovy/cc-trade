## 1. Reproduce Before Touching

- [x] 1.1 Drive `buildFuturesTradeRounds` with the two scenarios against the
  current code and record what it publishes: the still-held add, and the new
  short after a full re-close.

  Driver at `scratchpad/driver/edge-open-driver.mjs` (session b6581c77),
  2026-08-19, against the unfixed tree:

  - Still-held add (SELL 4 @100 pnl 0, BUY 6 @110 pnl 0, window ends):
    one round, `open: false` — a closed LONG, quantity 4, PnL 0, in the
    closed-position review while the operator holds twelve.
  - Full re-close then a new short: the closed long reported quantity **25**
    where 20 were ever closed — the new short's five opening contracts folded
    in as exits — and the short round carried 1 fill instead of 2.

## 2. Fix

- [x] 2.1 Publish a restarted round holding any of its added size as open —
  at the end of the fills, and when an increasing fill follows a partial
  re-close. `heldAtoms` is exactly that size: only entries raise it, and only
  the restart path leaves `partial` set with entries behind it.
- [x] 2.2 End the round when a reducing fill arrives after everything added
  was re-closed, and let that fill open a new round on its own evidence. The
  driver's short now carries both its fills, entry 121 stated rather than
  implied, and the long closes at quantity 16 — the true aggregate entry
  103.75 = (4×100 + 6×100 + 6×110) / 16 recovered exactly.

## 3. Guard

- [x] 3.1 Two cases in `futuresTradeRounds.test.js`, one per scenario, proven
  to bite: with the fix stashed both must fail; record the failing output.

  With `futuresTradeRounds.js` stashed: `2 failed | 157 passed` —
  `keeps a restarted edge round open while its add is still held` on
  `expected { key: 'BICOUSDT:1:1000', … } to match object { positionSide:
  'LONG', … }` (the open flag), and
  `does not absorb a new position into a fully reclosed edge round` on
  `… to match object { quantity: '16', … }`. Restored: 159/159.

  While here, the two flagship break-even cases were fed exchange-consistent
  PnL: the stories arithmetically settle to 180, not the 190 the tests
  asserted, and with the honest figure the implied entry the assertions check
  becomes the true aggregate entry of everything exited
  (1180/12 and 1220/12) instead of an echo of the formula over an impossible
  input. Both pass against the unfixed code too — the data repair is
  independent of this fix.

## 4. Verification

- [x] 4.1 The whole rounds suite green, including every archived break-even
  scenario; lint on touched files. `npx vitest run
  src/utils/futuresTradeRounds.test.js` glob: 159 tests in 7 files, green;
  eslint clean. Full suite recorded in the batch verification at the end of
  the audit-fix series.
