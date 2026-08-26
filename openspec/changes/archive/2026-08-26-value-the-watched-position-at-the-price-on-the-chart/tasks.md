# Tasks

Superseded in part on 2026-08-26 — see the proposal. The presentation work
below shipped in `fbf954a` and was replaced the same day by
`price-every-open-position-at-the-last-print`; those tasks are struck, and the
code they describe was removed rather than left standing beside its successor.

## 1. Spec

- [x] ~~1.1 Delta under `futures-workstation-presentation`~~ — superseded; the
      delta was removed from this change rather than allowed to reach canon.
- [x] 1.2 Delta under `futures-order-visibility`: the mark feed's coalescing
      window is set from a measurement of arrival spread and states that basis
      where it is set. **Stands.**

## 2. Code

- [x] ~~2.1 Tape entry point on the position mark store~~ — superseded. The feed
      now carries every open contract's print in the same publication as its
      mark, so there is no second way into the store.
- [x] ~~2.2 Feed it from the workstation's own header for the contract on
      screen~~ — superseded. The renderer knows which contract is being looked
      at, not which ones are open; the subscription belongs to the feed.
- [x] ~~2.3 State the tape-priced figure on the ticket's position card under its
      own name, beside the mark~~ — superseded, and inverted: the card is read
      at the printed price and the mark is what stands beside it.
- [x] 2.4 Cut `FUTURES_MARK_PRICE_BATCH_MS` to the measured basis and state the
      measurement where the constant is set. **Stands**, and now also bounds how
      often prints republish.

## 3. Proof

- [x] ~~3.1 Tests that bite: a tape note leaves uPnL, ROE, notional and the
      aggregate unmoved~~ — superseded; the successor asserts the opposite, and
      each of its tests was verified failing against this change's code.
- [x] 3.2 Test that the coalescing bound holds under a burst of prints.
      **Stands.**
- [x] 3.3 Measured on the live exchange through the operator's proxy, and the
      numbers recorded in the proposal: mark cadence (239 frames/240s, p50
      1000ms), mark-vs-print deviation (p50 0.5-1.16 bps, worst 5.8), spread
      across four contracts (p50 2ms, worst 6ms), transit (p50 220ms).
      **Stands** — none of it depended on where the price was displayed.
- [x] 3.4 Full suite 2935/2935 across 129 files, eslint clean on the ten
      touched files, and all four guards pass. Every new test verified failing
      against the pre-change file it covers. The secondary line measured in
      Chromium: 11px neutral grey under the 17px position-toned headline, card
      width unchanged.

## 4. Operator gate

- [x] ~~4.1 Operator watches a contract carrying a position through a fast
      move~~ — **retired unlooked-at.** The operator answered the shipped
      behaviour in words before ever running this check, and the check no longer
      describes the desk. Its replacement is task 4.1 of
      `price-every-open-position-at-the-last-print`. Recorded in
      `openspec/live-verification-ledger.md`.
