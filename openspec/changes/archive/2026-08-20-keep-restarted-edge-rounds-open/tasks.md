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

  **Correction 2026-08-20:** the last sentence cited a record that never
  existed — the series ended at e6718d0 with no batch-verification record.
  The focused-run half of this box is evidenced above; the full-suite claim
  was testimony. The record now exists: on 2026-08-20, with every self-audit
  fix landed, `npx vitest run` — 116 files, 2215 passed (2215); `npx eslint .`
  exit 0; `check:circular`, `check:runtime-mock`, `check:futures-production`,
  `check:command-path` all pass. Independently reproduced the same day by
  the parallel session from a clean `git archive` of HEAD: 2215/2215.

## 5. Self-Audit Corrections (2026-08-20)

A same-day adversarial audit (exchange-honest fuzzer, 3000 truncated
windows against a reference simulator) found the fix's own gates leaking:
34/3000 windows destroyed realized PnL only after this change, and in every
one the closed review came out empty. Each repair was bitten first — the
new test ran against the pre-fix fold and its failure was recorded.

- [x] 5.1 An increasing fill carrying realized PnL was absorbed as pure
  entry while `heldAtoms > 0n`, its PnL dropped (only reductions count it),
  and the state self-perpetuated until the window ended in one open round
  the review filters out. Only a reduction realizes anything, so such a fill
  now ends the round and is re-read on its own evidence — in both edge
  phases. Bite: *ends a round whose add realizes profit instead of
  absorbing it* — `expected [ …(1) ] to have a length of 2 but got 1`
  pre-fix; the 66 PnL vanished.
- [x] 5.2 The drained-reclosing split fired on every reducing fill, filing
  one staged close as two closed trades. A new position's opener realizes
  nothing, so the split now fires only when the fill realizes 0; a fill
  that goes on realizing stays in the round. Bite: *keeps a staged close in
  one round while its fills go on realizing* — `expected [ …(2) ] to have a
  length of 1 but got 2` pre-fix; the one-round aggregate (qty 13, PnL 93,
  entry 1345/13) matches exchange arithmetic.
- [x] 5.3 An open restarted round published the wrong numbers: quantity
  from `entryAtoms` (counting adds already re-closed) and an entry implied
  from the *exited pre-window units*. It now publishes what it holds —
  `heldAtoms` at `heldEntry`, `entryImplied: false`. Bites: the existing
  open-round test extended (`expected 100 to be 110` pre-fix) and *values
  an open restarted round at what it still holds* (quantity '4', entry 110,
  notional 440).
- [x] 5.4 The known cost is stated in the code instead of denied: a
  continuation close at exactly break-even after the drain still reads as a
  new position opening — undecidable from the data; the old comment claimed
  plain indistinguishability for all reducing fills, which 5.2 disproves.
- [x] 5.5 Post-fix fuzzer: 0/3000 windows leak that did not leak before the
  original commit; worst after-only leak 0 (was 107 units). 54 windows leak
  under both the pre- and post-commit fold — the pre-existing edge-flip
  class, out of this change's scope and recorded in the audit remainder.
  `npx vitest run src/utils/futuresTradeRounds.test.js` — 30 passed (30).
- [x] 5.6 Interaction noted for the settled-PnL work (other session):
  entryImplied on open restarted rounds flips true→false with 5.3; the
  honest "position may predate this window" flag is `partial`, not
  `entryImplied`, and `openTime` of such a round is the edge close, not the
  position's opening.
