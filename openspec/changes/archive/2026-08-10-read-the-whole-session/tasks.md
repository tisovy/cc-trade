## 1. Reading Deep Enough To Fold

- [x] 1.1 Read fills at the endpoint's ceiling of a thousand per contract, apart
  from the order log's hundred: the fills are folded into positions, and a fold
  that starts mid-position reports a round it cannot state the entry of while
  everything older is simply absent.

## 2. Reading The Right Contracts

- [x] 2.1 Walk the traded-contract read forward from the oldest end of the window
  until a page comes back short, bounded to four pages, and read the pages back to
  front so the most recently traded contract leads.
- [x] 2.2 Return a page — its symbols, whether it was full, where it ended —
  rather than a bare list, so the caller can tell a complete answer from a
  truncated one.
- [x] 2.3 Widen the history fan-out from eight contracts to twelve, and give the
  per-position leverage read its own bound so widening one does not widen the other.

## 3. Saying What Was Not Read

- [x] 3.1 State on the payload how many contracts the account traded against how
  many were read.
- [x] 3.2 Carry `symbols` and the traded count through the renderer's history
  state — both were on the payload and neither reached the surface, so the review
  said "in this window" where it meant "across the eight contracts read".
- [x] 3.3 State the reach under the rows: contracts read of those found, and the
  oldest fill the read reached.
- [x] 3.4 Catch a failed page where it happens rather than around the walk, so a
  refusal on the third read does not discard the two already paid for.
- [x] 3.5 Say when the count of contracts is not known to be complete — the
  discovery failed, or the walk ran out of pages with a full page in hand.

## 3a. Folding Once Per Read

- [x] 3a.1 Fold the fills into rounds in a memo rather than in the render body:
  the read is now a thousand fills per contract across twelve contracts, and this
  panel re-renders whenever a contract configuration arrives.

## 4. Sizing A Closed Position In Money

- [x] 4.1 Value each round in USDT at its entry price, including a round whose
  entry was recovered from the realized PnL rather than read from fills.
- [x] 4.2 Show it in the size column and keep the contract count on the row.

## 5. Verification

- [x] 5.1 `npx vitest run` on the committed tree, extracted with `git archive`
  — 90 files, 1,187 passed, including the income walk to the recent end, the
  walk keeping the pages it read when a later one fails, the fan-out reporting
  what it dropped, the fill read's depth, the round's USDT value on both the read
  and the recovered entry, and the reach line with and without a complete count.
- [x] 5.2 `eslint` clean on every file this change touches.
- [x] 5.3 `npm run check:futures-production` passes.
- [x] 5.4 Operator confirms on the live account that the closed positions of the
  last few days are all there, that the sizes read as money, and that where the
  list is bounded it says so. — closed by the operator on 2026-08-10 rather than reported checked.

## 6. Stated Limits, Not Fixed Here

- [ ] 6.1 Twelve contracts and a thousand fills each are still bounds. They are
  now stated on the surface rather than only in the log, which is the part that
  was wrong.
- [ ] 6.2 The window is seven days, which is what the exchange's own default
  covers for these endpoints.
- [ ] 6.3 A history read is now 30–120 weight of discovery plus 120 for the
  fan-out, against a limiter budget of 800 a minute. It is operator-triggered and
  runs on the same limiter as everything else, so a slow one delays account reads
  rather than exceeding anything.
- [ ] 6.4 Twelve contracts of a thousand fills is a larger payload to the renderer
  than eight of a hundred. Folding is per contract and linear; if it ever needs to
  shrink, the fold belongs in the main process rather than the read getting
  shallower again.
