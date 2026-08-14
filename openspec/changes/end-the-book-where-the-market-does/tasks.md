## 1. The Book States How Far It Reaches

- [x] 1.1 Carry on every delivered book how far the page it was bought at proved past the best price on each side, as exact decimal strings in the contract's own quote currency.
- [x] 1.2 State it only when no deeper page can be bought, and state nothing otherwise: until the ladder of pages is exhausted a wider reading is one read away, and a reach stated from a cheap page would cut the grouping ladder before the operator could ask for the deeper one.
- [x] 1.3 Take it from what the page proved when it was read, not from the distance currently left to the edge — the second shrinks as the market walks, and the ladder would move with it.
- [x] 1.4 Add it to the payload the protocol validates, with the exact-keys rule kept, and raise the protocol version.
- [x] 1.5 Build the view through one place in the service rather than at each of the six calls that deliver a book, so no path can deliver one without the reach.
- [x] 1.6 Prove by test that a book bought at a page short of the deepest states no reach, that one bought at the deepest states what each side proved, and that the reading does not move as the market walks inside the band.

## 2. The Ladder Ends Where The Book Does

- [x] 2.1 Add the rungs that let the cut land near the reach: 200 and 1000 ticks. Move no existing rung, so no stored preference is invalidated by the change.
- [x] 2.2 Offer only the rungs whose rows fit inside the reach, and always offer at least the finest.
- [x] 2.3 Cut against the narrower of the two sides, so neither side of the panel is asked for rows the desk cannot fill.
- [x] 2.4 Offer the whole ladder while no reach is stated, so a contract still climbing the page ladder can be asked for a deeper page.
- [x] 2.5 Draw a stored step the ladder no longer offers at the coarsest step it does offer, and leave the stored preference alone, so a reach that narrows for a moment costs a redraw and not a setting.
- [x] 2.6 Prove by test that the coarsest step offered on a contract fills the panel from the reach rather than overshooting it, and that a stored step past the end of the ladder is drawn at its end. *(Both bite against the tree before this change: `expected '50 · 0.09%' to be '0.5 · <0.01%'` for the step list, and a remembered 500 that was still selectable where it is now drawn at 5.)*
- [x] 2.7 Read the reach off the delivery as two strings rather than the object it arrives in. *(Discovered: the object is rebuilt on every depth frame, ten times a second, so a ladder memoized against it is rebuilt with it — and the ladder feeds the range the panel states, which the backend buys pages against.)*
- [x] 2.8 Add the rungs the ladder now runs out before: 2 000, 5 000, 10 000 and 20 000 ticks. *(This change cut the ladder to the book, and at the time the book was one snapshot page — a thousand ticks was past what any measured contract could fill. `keep-the-book-the-stream-restates` made the book everything the stream restates, and the cut moved: on the operator's own desk on 2026-08-14, AKEUSDT reached 54.96% of price and was read at 1.34% a row, fourteen rows over 19% of a book more than twice that deep, with no coarser step to select. The top rung is set by the contract rather than by the ladder — a row cannot be worth more than about a fourteenth of price, because the bid side ends at zero — and measured across the 570 perpetuals trading that day, that ceiling is under 1 000 ticks on 522 of them, above 20 000 on seven, and above 50 000 on one. So the ladder stops at 20 000 rather than carrying a rung one contract in the catalogue could select. No existing rung moves.)*
- [x] 2.9 Prove by test that a book reaching past the old end of the ladder is offered a step past it, and that a coarsely quoted contract is still cut where its own reach ends. *(The first bites against the tree before this change: `expected { multiplier: 1000 } to deeply equal { multiplier: 2000 }` on the operator's own contract and reach. The second is a guard — the rungs it holds back did not exist to be offered — and it is the case 522 of 570 contracts are in.)*

## 3. The Panel Says How Far The Book Goes

- [x] 3.1 State the reach where the grouping step is chosen, as a share of price, so the operator reads why the ladder ends where it does instead of inferring it from where the rows stop.
- [x] 3.2 State nothing while no reach is stated, rather than a placeholder.
- [x] 3.3 Prove by test that the reading appears with the reach and is absent without it.
- [x] 3.4 State it on the narrower of the two sides, and carry both exactly in the title. *(Discovered: the two sides differ by more than a tenth of the reading on a real contract — AKEUSDT's page held 4.10% below and 3.90% above on 2026-08-13 — and the ladder is cut against the narrower, so naming the wider one would have promised rows the other half of the panel cannot fill.)*

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test` (1902 passed), `npm run check:futures-production`.
- [x] 4.2 Record what the coarsest step covers on each measured contract, before and after. Fourteen rows, prices and reaches read from the exchange on 2026-08-13:

  | Contract | held, narrower side | coarsest step asked for, before | coarsest step covers, after |
  |---|---|---|---|
  | AKEUSDT | 3.90% | 9.06% | 3.63% |
  | BTCUSDT | 0.19% | 1.10% | 0.11% |
  | ETHUSDT | 0.55% | 3.71% | 0.37% |
  | TUTUSDT | 28.35% | 181.1% | 18.1% |

  The span the operator can see is unchanged — it always was whatever the desk
  holds — and the rows drawing it are now full. What is lost is the distance
  between the cut and the reach, which is the ladder's own spacing: at most one
  rung, and never a level the desk had.

- [ ] 4.3 Operator confirms on live data that the coarsest step fills every row of the book, on AKEUSDT and on a contract quoted very differently, and that the stated reach matches where the rows stop — step 43, «Лестница шагов кончается там, где кончается книга у деска», in `verify-the-desk-in-one-sitting/runbook.md`, so the operator runs one list.

- [x] 4.4 Correct what this change first claimed. *(The proposal argued that a
  thousand levels a side is the whole of what Binance publishes, so ±75% of price
  is not a book anyone can draw. The operator asked how the Binance app shows
  more than 100% then, and they were right: a thousand levels is one snapshot
  page, and the diff stream is not bounded by it. Measured on AKEUSDT 2026-08-13,
  `@depth@100ms` carried 8196 levels outside the snapshot band in sixty seconds,
  5645 of them resting, reaching -87.55% and +217.86%. Held for three minutes the
  whole book is 2400-3400 levels a side and reaches past 80% on AKEUSDT and
  BTCUSDT alike, of which the nearest thousand the desk keeps hold 7-18% of the
  resting USDT. The reach this change cuts against is the desk's limit, not the
  exchange's; widening it is `keep-the-book-the-stream-restates`. The mechanism
  here is unchanged and still right — the ladder must end where the book on hand
  ends — but every sentence claiming the exchange stops there is wrong and has
  been rewritten.)*
