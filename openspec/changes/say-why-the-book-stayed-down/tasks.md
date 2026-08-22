## 1. Name the rebuild's cause where the frame lands

- [ ] 1.1 Map the order book's three `resync` reasons to three codes in the
  depth branch of `handleStreamFrame`: `gap` → `DEPTH_SEQUENCE_GAP`,
  `resync-required` → `DEPTH_BOOK_DOWN`, `overflow` → `DEPTH_BUFFER_OVERFLOW`.
  An unknown reason falls back to `DEPTH_SEQUENCE_GAP`, which is what every
  reason was called before.

## 2. Say why an attempt could not bridge

- [ ] 2.1 In `recoverBook`, keep the bootstrap result and write its reason
  through the existing `depthBootstrapCode` mapping —
  `DEPTH_BOOTSTRAP_NOT_BRIDGED` or `DEPTH_BOOTSTRAP_BUFFER_GAP`, one line per
  failed attempt — before moving to the next attempt.

## 3. Prove it bites

- [ ] 3.1 One journal, one story: a live chain broken once, then a rebuild that
  keeps failing against snapshots served behind the stream. The recorded faults
  read `DEPTH_SEQUENCE_GAP`, three bridging reasons, `DEPTH_BOOK_DOWN`, three
  bridging reasons — and the test fails against the code before this change,
  which records `DEPTH_SEQUENCE_GAP` twice and nothing else. The `overflow`
  row of the mapping rides the same lookup this test proves; it has no test of
  its own because filling a 2 048-event buffer buys no further assertion.
- [ ] 3.2 The service suite passes unchanged around it.

## 4. Operator verification

- [ ] 4.1 At the next degradation window, census the day's journal over
  `phase: "book-recovery"`: bridging reasons should stand beside every failed
  round, and `DEPTH_SEQUENCE_GAP` should count the breaks, not the minutes.
