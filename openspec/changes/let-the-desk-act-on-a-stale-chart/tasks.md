## 1. The Gates Come Off

- [ ] 1.1 Hand the chart its price pick, its gestures and its drag regardless of `candlesState`, refusing only where no candle has ever arrived.
- [ ] 1.2 Enable the order book's levels regardless of `depthState`, refusing only an empty book.
- [ ] 1.3 Prove by test that a resynchronizing workspace still emits a gesture, a price pick and a book click.

## 2. Age Travels With The Price

- [ ] 2.1 Carry the observed time of the reading a price was taken from.
- [ ] 2.2 State it on the ticket's price field when the reading is not live.
- [ ] 2.3 State it on the confirmation panel, beside what the order does to the position.
- [ ] 2.4 Prove by test that a price taken from a stale reading reaches the confirmation with its age.

## 3. Verification

- [ ] 3.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 3.2 Operator confirms on live data that a resync no longer takes the chart and book controls away, and that a price taken during one is confirmed with its age shown.
