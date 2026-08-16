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
  inconsistent, so the reversal becomes a remainder.

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
- [x] 2.3 `npx vitest run` on the committed tree, extracted with `git archive`,
  with `eslint`, `check:futures-production` and `check:command-path` beside it.

## 3. Stated Limits, Not Fixed Here

- [ ] 3.1 A partial close of a position genuinely older than the window is still
  reported as a closed position of the part that closed. That is what realized
  PnL was paid on, and the row says its entry was recovered, so it is not a
  false claim — but it is not a whole position either.
- [ ] 3.2 The income fan-out was read in the same audit and is **not** changed.
  It walks income only on the first review of an empty store and on `Full`;
  after that it names contracts from what the store already holds, and reports
  `discoveryComplete: false` so the panel says "more may have been traded". The
  cost of walking it — up to eight pages at weight 30 — is what that trade-off
  buys, and it is disclosed rather than hidden. Worth revisiting only if the
  operator finds contracts traded elsewhere missing from a review.
- [ ] 3.3 The entry recovered from realized PnL at a window edge was checked in
  the same sweep, long and short, and is exact. Nothing to change there.
