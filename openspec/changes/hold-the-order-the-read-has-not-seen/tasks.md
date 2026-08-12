## 1. What The Stream Said, And When

- [x] 1.1 Remember on the desk's own clock when the stream last reported each order working, bounded like the settled memory, and forget an order the stream reports settled.
- [x] 1.2 Prove by test that the memory stays bounded and that a settlement clears the entry.

## 2. What A Read May Remove

- [x] 2.1 Keep a working order the read omitted when the stream reported it after the read was issued.
- [x] 2.2 Keep removing an order the read omitted that the stream has said nothing newer about.
- [x] 2.3 Prove both by test, including the placement-then-read sequence that produced the blink.

## 3. Verification

- [x] 3.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 3.2 Operator confirms on live data that a newly placed order appears once and stays, on the chart and in the working-orders list, and that an order cancelled from the Binance app still disappears.
