## 1. The Gates Come Off

- [x] 1.1 Hand the chart its price pick, its gestures and its drag regardless of `candlesState`, refusing only where no candle has ever arrived.
- [x] 1.2 Enable the order book's levels regardless of `depthState`, refusing only an empty book.
- [x] 1.3 Prove by test that a resynchronizing workspace still emits a gesture, a price pick and a book click.

## 2. Age Travels With The Price

- [x] 2.1 Carry the observed time of the reading a price was taken from.
- [x] 2.2 State it on the ticket's price field when the reading is not live.
- [x] 2.3 State it on the confirmation panel, beside what the order does to the position.
- [x] 2.4 Prove by test that a price taken from a stale reading reaches the confirmation with its age.

## 3. Silence Is Named For What It Is

- [x] 3.1 Call a stream quiet, not stale, when the transport is still proven live.
- [x] 3.2 Stop covering a chart that has candles on it; state the reading and its age beside it instead.
- [x] 3.3 Prove by test that a quiet contract on a live connection reads quiet, that a disconnected one does not, and that only an empty chart is covered.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Operator confirms on live data that a quiet or resynchronizing contract no longer takes the chart and book controls away, and that a price taken during one is confirmed with its age shown — step 11, «Тихий график: надпись, а не запрет», in `verify-the-desk-in-one-sitting/runbook.md`, plus step 9 п.3 for the book's levels and step 19 for the half that needs a real break (`STALE`/`DISCONNECTED` in red, never `QUIET`), which lives in the one outage the pass takes.
- [x] 4.3 Keep the two refused sub-steps in the list rather than dropping them. *(2026-08-12 the operator confirmed the `QUIET` plaque and declined the price-picking and age-on-confirmation sub-steps, saying they would not trade off a quiet chart. Both are kept because neither places an order: the confirmation panel is opened and dismissed with Esc, and nothing reaches the exchange. Without them the arming and the age are held by tests and mutations alone, which is what the 2026-08-12 note already said.)*
