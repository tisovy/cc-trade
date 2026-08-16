## 0. Measured Before Starting

Driven against `src/utils/futuresTradeRounds.js` as it stands at `a70a28f`, from
a scratch harness rather than read off the code. A long of ten held at 100 before
the read's window; inside it, four sold at 100 and then six sold at 120.

- [x] 0.1 The walk opens a **short** of four at 100, folds the six sold at 120
  into it as an increase, and leaves it open: `positionSide: 'SHORT'`,
  `quantity: '10'`, `entryPrice: 112`, `open: true`.
- [x] 0.2 An increasing fill carries no realized PnL, so the 120 is dropped:
  the round reports `realizedPnl: 0`.
- [x] 0.3 The closed-position tab keeps `!open && exitPrice !== null`
  (`FuturesHistoryPanel.jsx:239`), so the review shows **0 rows and 0 realized**
  against a real closed long of ten and 120 of profit.
- [x] 0.4 The mirror on a short does the same: a LONG of ten at 88, open, 0
  realized.
- [x] 0.5 One cent off break-even, the same session reads correctly — one closed
  row, entry recovered at 100, 120.04 realized — so this is a knife edge and not
  a slope.

## 1. Let The Following Fills Settle It

- [x] 1.1 A round about to open on a fill that realizes nothing, on a contract
  the walk has not yet seen flat, reads the run of fills that follows it on the
  same side. Any of them realizing anything means the run is reducing, so the
  round opens as a close of a position older than the window.
- [x] 1.2 The run ends at the first fill on the other side, or on another
  position leg. Reading across a leg would be a guess in a hedge account, where
  two sells in a row can be one position opening and another closing.
- [x] 1.3 Where the run settles nothing, nothing changes: no evidence is not
  evidence for the other reading.

## 2. Verification

- [x] 2.1 A test for the break-even close followed by a real one: one closed
  long of ten, entry recovered at 100, exit 112, 120 realized, nothing open.
  Run against the tree before the change: it fails there.
- [x] 2.2 The mirror on a short, asserted apart — the two sides invert different
  terms of the recovered entry, and a fix that read one side only would pass 2.1.
- [x] 2.3 A position genuinely opened inside the window, built by two fills on
  the same side that realize nothing and closed later: it must still be read as
  the position it opened. Run against the tree before the change: it passes
  there, so it is a guard rather than a finding, and it is the one that catches
  the new rule firing where it should not.
- [x] 2.4 Two sells in a row on different position legs, the second realizing
  what the first did not: the first must not be re-read on the strength of the
  second. Also a guard, and it passes before the change for the same reason 2.3
  does — what it holds is the leg boundary the new rule reads.
- [x] 2.5 The flat-start sweep re-run, 4 000 sessions on each of two seeds,
  before and after: **0 false pre-window remainders, 0 rounds left open, 0
  sessions whose realized PnL does not add up**, identical on both sides of the
  change. The new rule fires nowhere in 8 000 sessions that start flat, which is
  what it should do — every round there has its own size in hand.
- [x] 2.5a That sweep proved to bite before it was believed: run against
  `a4a3086`, the module `tell-a-reversal-from-a-window-edge` was written against,
  it reports **109 and 124** sessions per 4 000 with a round filed as a pre-window
  remainder — the same order as the 137 that change's §0 recorded, from an
  independently written harness. A sweep that returns zero from a module known to
  be broken measures nothing.
- [x] 2.6 `npx vitest run` on the committed tree, extracted with `git archive`,
  with `eslint`, `check:circular`, `check:runtime-mock`,
  `check:futures-production` and `check:command-path` beside it.

## 3. Stated Limits, Not Fixed Here

*Driven, not read: every case below was run against the module this change
leaves behind, and the ones that claim to be older than the change were run
against `a70a28f` beside it.*

- [x] 3.1 A break-even close with no fill after it on the same side is still read
  as opening the opposite position. Driven — four sold at 100 out of a pre-window
  long of ten at 100, and nothing else — comes back a `SHORT` of four, open, and
  the review shows nothing. The data states nothing either way here, and reading
  it as a close would invent a closed row of zero PnL just as readily as the
  present reading invents an open position.
- [x] 3.2 The run stops at the first fill on the other side, so a break-even
  close the operator then *adds* to is still lost. Driven: four sold at 100 out
  of a pre-window long of ten, two bought at 90, eight sold at 120 realizing 190
  — the review shows **0 rows and 0 realized** against 190 the exchange paid,
  exactly as before this change. The same shape with the whole position scratched
  at cost first loses 25 the same way.

  The evidence exists and this change does not reach it: under the invented
  reading the buy at 90 reduces a short held at 100 and should have realized 20,
  and it reports 0. Acting on that means re-deciding the side of a round the walk
  has already folded fills into — restarting the round rather than reading ahead
  of it — which is a mechanism this change does not have and should not grow to
  hold one case. It is the next change on this walk, not a line in this one.

- [x] 3.3 A run of closing fills still folds into one row, and a position opened
  on the same side after that run folds into it too. Driven: the break-even case
  with a fresh short of five at 130 after it comes back as one closed row of
  fifteen at 110 → 118 instead of ten at 100 → 112, with the realized PnL right
  and the size and both prices wrong. Older than this change, and reached by a
  new path rather than made worse — the identical sequence with an ordinary
  close in place of the break-even one gives the same shape of row, to the digit,
  before the change and after it.
- [x] 3.4 A hedge account's review is wrong before this change and after it: the
  walk folds a contract's fills without reading which leg they belong to, so the
  two legs run down each other's exposure. The new rule reads the leg so that it
  cannot fire across two of them, which is the smallest thing that keeps this
  change honest — it is not hedge-mode support.
