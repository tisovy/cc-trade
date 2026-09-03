# Tasks

## 0. Measured first (see proposal.md)

## 1. Renderer

- [x] 1.1 `scheduleHistoryGapRead`: one trailing timer of 10 s, restarted by
      every fill, a set of touched contracts; on expiry one `basisOnly`
      trades read per contract. `HISTORY_GAP_READ_DELAY_MS` 10 000 with the
      operator's rule stated at the constant.

## 2. Tests that bite

- [x] 2.1 Fills at 5 s spacing for 25 s: no read until 10 s after the last
      (pre-change tree: reads at 1.2 s and every window after); two
      contracts in one burst: one read each, together.
      **Done 2026-09-03**: the burst test fails on a `git archive` copy of
      the pre-change tree (a read went out inside the first five-second
      gap there); the older 1.2-second expectations moved to ten seconds.
- [x] 2.2 Full suite, eslint. **2026-09-03**: 3 004 tests green, `eslint .` clean.

## 3. Operator verification (live)

- [ ] 3.1 A scalp with fills: `account.history` reads counted in the journal
      by route (`history-trades`) — one burst, one read per contract
      touched, ten seconds after the last fill.
