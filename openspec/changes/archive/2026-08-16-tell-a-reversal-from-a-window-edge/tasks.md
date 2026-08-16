## 0. Measured Before Starting

Measured on 2026-08-16 against `a4a3086`, by simulating the exchange rather than
reading the code: an account that starts flat, takes random fills, and is
flattened at the end, with realized PnL computed the way Binance computes it —
per fill, against the position's own average entry, before commission. Every
round in such a session is honestly inside the window, so any round the review
calls a pre-window remainder is a false one.

- [x] 0.1 137 of 4 000 sessions (3.4%) contain at least one real position filed
  as the tail of a position older than the window.
- [x] 0.2 4 of 4 000 leave a round open that the tab then drops entirely — the
  panel shows only `!open && exitPrice !== null`.
- [x] 0.3 1 of 4 000 has realized PnL that does not add up to what the exchange
  reported, off by 50 on a session totalling 43.
- [x] 0.4 The mechanism, on the smallest case that shows it: buy 10 at 100, sell
  9 at 100, buy 9 at 200, sell 12 at 200. At the fourth fill the exchange holds
  ten at 190; the round's cumulative average is 147.37. The check reads the
  reversal's realized PnL of 100 against a predicted 526 and declares it
  inconsistent, so the reversal becomes a remainder. Reproduced independently
  against `f891860^` by the neighbouring session, to the digit: twenty-one units
  at 152.38, where nineteen were traded at 147.37.

## 1. Compare Against What The Exchange Settled Against

- [x] 1.1 Track the round's held average entry the exchange's way: an entry moves
  it against the size already held, a close leaves it alone. Kept beside the
  cumulative entry rather than replacing it.
- [x] 1.2 `flipIsConsistent` reads that average. Nothing else does.
- [x] 1.3 The reported entry of a round is unchanged — the average over
  everything it entered, which is what makes the row's own arithmetic close.

## 2. Verification

- [x] 2.1 A test in `futuresTradeRounds.test.js` for the smallest case: two
  closed positions, neither with a recovered entry, sizes 19 and 2, and the two
  realized PnLs adding to what the exchange reported. Run against the tree before
  the change: it fails there, with the long reported as one 21-unit position.
  A finding, not a guard.
- [x] 2.2 The four-thousand-session sweep re-run after the change: 0, 0 and 0
  against the 137, 4 and 1 above. Run from a scratch harness rather than added to
  the suite — it simulates an exchange, which is a thing to measure with, not a
  thing to keep.
- [x] 2.4 The same sequence stopped one fill earlier — the operator still
  holding the short the reversal opened — asserted apart, because the symptom is
  a different and worse one: the old walk produced a single *closed* long of
  twenty-one units while the account stood in the opposite position, and the
  short did not exist in the walk at all. Written by the neighbouring session
  after it reproduced both halves against `f891860^`; it fails there on the
  short being absent. Confirmed here at `cc509cc`: four fills now give an open
  short of two, correctly outside a tab of closed positions, and a closed long
  of nineteen at 147.37 → 152.63.
- [x] 2.3 `npx vitest run` on the committed tree, extracted with `git archive`,
  with `eslint`, `check:futures-production` and `check:command-path` beside it.

## 3. Stated Limits, Not Fixed Here

*Settled 2026-08-16 by driving the module rather than by reading the notes that
state these limits. All three were inherited from the audit that wrote §0, and a
limit believed on its author's word is a limit nobody has checked twice — this
change has already had one claim in its own proposal come back wrong that way.
The module was unchanged from `cc509cc` at the time, in a tree at `fe6bb00`; the
harness is a scratch one, seeded so the numbers below can be reproduced from it,
and kept out of the suite for the reason §2.2 gave.*

- [x] 3.1 A partial close of a position genuinely older than the window is still
  reported as a closed position of the part that closed. That is what realized
  PnL was paid on, and the row says its entry was recovered, so it is not a
  false claim — but it is not a whole position either.

  Driven: ten held at 100 before the window, four sold at 110 inside it, gives
  one row — `quantity: '4'`, `entryPrice: 100`, `entryImplied: true`,
  `partial: true`, `open: false` — and a short of ten at 100 with four bought
  back at 90 gives the mirror of it. So the row is right about the part and
  silent about the whole: nothing on it says six units are still held. Two
  things the limit does not say, both measured on the way:

  - a run of closing fills folds into **one** row, not one row per fill: four
    at 110 and then six at 120 comes back as a single closed position of ten,
    entered at 100 and exited at 116;
  - an entry between them ends that row and opens another, and the second row
    recovers the **blended** entry rather than either half of it — six left at
    100 plus three bought at 105 is nine held at 101.6667, and the row states
    101.66666666666667.

- [x] 3.2 The income fan-out was read in the same audit and is **not** changed.
  It walks income only on the first review of an empty store and on `Full`;
  after that it names contracts from what the store already holds, and reports
  `discoveryComplete: false` so the panel says "more may have been traded". The
  cost of walking it — up to eight pages at weight 30 — is what that trade-off
  buys, and it is disclosed rather than hidden. Worth revisiting only if the
  operator finds contracts traded elsewhere missing from a review.

  Checked against the code the sentence describes, since this one is a claim
  about a file the change never opens. "Up to eight pages at weight 30" is
  `FUTURES_INCOME_MAX_PAGES = 4` (`binance-connection.js:1195`) spent by two
  walks — the recent day, then the rest of the week (`:3374`, `:3381`) — at
  `FUTURES_INCOME_READ_WEIGHT = 30` (`:1203`), and the second walk is skipped
  when the fan-out is already at its ceiling, so eight is a bound rather than a
  cost. The store branch returns `discoveryComplete: false` literally (`:3370`).
  One gate the sentence omits, and it only ever walks less: an in-memory
  discovery younger than `FUTURES_HISTORY_DISCOVERY_HOLD_MS` — ten minutes,
  `:1201` — answers without touching income at all. **Not** changed is now a
  fact of the record rather than an intention: every commit this change made —
  `f891860`, `d912b27`, `cc509cc`, `1874363` — touches `futuresTradeRounds.js`,
  its test and this change's own documents, and nothing else.

- [x] 3.3 The entry recovered from realized PnL at a window edge was checked in
  the same sweep, long and short, and is exact. Nothing to change there.

  Swept again rather than taken over: 4 000 sessions of a position held before
  the window and closed inside it in one to four fills, realized PnL computed
  the way the exchange computes it — per fill, against the position's own
  average entry, before commission. Worst recovered-entry error **3.4e-13
  absolute, 4.0e-12 bps** (seed 20260816); with realized PnL rounded to the
  eight decimals it arrives with, 1.7e-13 and 4.6e-12 bps. Long and short swept
  apart at 4 000 each (seed 947513) come back identical by side, 1.1e-13 and
  4.4e-12 bps. Exact to floating point, and the multi-fill case is exact for a
  reason rather than by luck: the sum of what each fill realized divided out by
  the total size returns the average entry algebraically, whatever prices the
  parts closed at.

- [x] 3.4 A closing fill that realizes **exactly nothing** is read as opening a
  position in the opposite direction, and everything after it folds into the
  one it invented. Found by the sweep above rather than by reading; stated here
  rather than fixed, because fixing it is a change of its own.

  The evidence a fill closed something is that it realized something
  (`futuresTradeRounds.js:59`). A close at exactly the position's average entry
  realizes 0, which is what an opening fill also reports, so at a window edge —
  where the position's own fills are not in hand to size it — the two are the
  same row of data. Driven: four sold at 100 out of ten held at 100 comes back
  `positionSide: 'SHORT'`, `open: true`, `entryImplied: false`; six more sold at
  120 for 120 fold into that short instead of closing anything, so the row stays
  open, and `FuturesHistoryPanel.jsx:239` keeps only `!open && exitPrice !==
  null` — the close and its 120 of realized PnL are dropped from the review
  entirely. One cent off break-even the same session reads correctly, so this is
  a knife edge and not a range.

  Its reach is bounded by three conditions at once: the position is older than
  the read's window, the **first** of its fills inside the window is a close,
  and that close is at the average entry to the last decimal. A scratch out of a
  position carried over from before the read is exactly that shape, so it is
  not unreachable. It is not in §0's sweep because those sessions start flat —
  every contract there opens inside the window, which is the case that has the
  size in hand.

  Not fixed here on purpose. The data alone cannot separate the two readings;
  separating them means looking ahead to the following fills on the contract,
  which is a new rule about how a round opens, and this change's whole argument
  is about a rule for how one closes. Left for the operator to decide whether
  it earns a change.

  It did: fixed by `read-a-break-even-close-as-a-close`, by the look-ahead this
  paragraph names. What survives it is narrower and written down there — a
  break-even close with no fill after it on the same side, and one the operator
  adds to before closing the rest.
