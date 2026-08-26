# Tasks

## 1. Spec

- [x] 1.1 Delta under `futures-workstation-presentation`: the position on the
      contract on screen states what it is worth at the price the chart shows,
      as a separately named secondary reading, withdrawn when the contract is
      left.
- [x] 1.2 Delta under `futures-order-visibility`: the mark feed's coalescing
      window is set from a measurement of arrival spread and states that basis
      where it is set.

## 2. Code

- [x] 2.1 Give the position mark store a tape entry point that merges a last
      traded price onto a symbol's reading without touching its mark fields,
      and notifies only the channels a tape may change — never the valuation or
      value channels that primary arithmetic subscribes to.
- [x] 2.2 Feed it from the workstation's own header for the contract on screen,
      coalesced to a bounded rate, and withdraw the reading when the contract
      is left or its tape stops being carried.
- [x] 2.3 State the tape-priced figure on the ticket's position card under its
      own name, beside the mark.
- [x] 2.4 Cut `FUTURES_MARK_PRICE_BATCH_MS` to the measured basis and state the
      measurement where the constant is set.

## 3. Proof

- [x] 3.1 Tests that bite: a tape note leaves uPnL, ROE, notional and the
      aggregate unmoved; it does not notify the valuation or value channels; a
      withdrawal removes the reading and leaves the mark; a contract that is
      not on screen gets no tape.
- [x] 3.2 Test that the coalescing bound holds under a burst of prints.
- [x] 3.3 Measured on the live exchange through the operator's proxy, and the
      numbers recorded in the proposal: mark cadence (239 frames/240s, p50
      1000ms), mark-vs-print deviation (p50 0.5-1.16 bps, worst 5.8), spread
      across four contracts (p50 2ms, worst 6ms), transit (p50 220ms).
- [x] 3.4 Full suite 2935/2935 across 129 files, eslint clean on the ten
      touched files, and all four guards pass. Every new test verified failing
      against the pre-change file it covers. The secondary line measured in
      Chromium: 11px neutral grey under the 17px position-toned headline, card
      width unchanged.

## 4. Operator gate

- [ ] 4.1 Operator watches a contract carrying a position through a fast move:
      the tape-priced reading tracks what the chart shows, the mark-based uPnL
      stays the headline and stays the number the exchange agrees with, and
      switching contracts leaves no stale price behind. Record in
      `openspec/live-verification-ledger.md`.
