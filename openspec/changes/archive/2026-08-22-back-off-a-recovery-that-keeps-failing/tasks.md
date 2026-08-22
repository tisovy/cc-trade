## 1. Widen the pause while rounds fail

- [x] 1.1 Add the ceiling to `FUTURES_PRODUCTION_WORKSTATION_BOOK_RECOVERY`
  beside the floor it bounds.
- [x] 1.2 Count consecutive failed rounds on the session. A round that bridges
  returns the count to zero; a round abandoned mid-flight — contract released,
  session resynchronizing — leaves it where it stood.
- [x] 1.3 Gate a new round on floor × 2^failures, bounded by the ceiling. The
  `immediate` exemption for buying a page rung stays as it is.

## 2. Prove it bites

- [x] 2.1 Walk the ladder: after each failed round, a diff arriving one
  millisecond before the widened pause starts nothing, and at the pause starts
  a round — 10s, 20s, 40s, then held at the 60s ceiling. Fails against the code
  before this change, which starts a round at five seconds every time.
- [x] 2.2 A bridged snapshot returns the pause to the floor: after a success,
  the next break is answered five seconds later. A guard, not a biter — the
  flat cooldown passes it too — named as one in the file.
- [x] 2.3 The service suite passes unchanged around it.

## 3. Operator verification

- [ ] 3.1 At the next degradation window, count `book-recovery` round starts
  per contract per minute in the day's journal: they should thin toward one a
  minute while the exchange is down, and the book should still come back within
  about a minute of the exchange recovering.
