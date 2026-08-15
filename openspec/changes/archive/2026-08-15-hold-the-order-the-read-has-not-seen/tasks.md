## 1. What The Stream Said, And When

- [x] 1.1 Remember on the desk's own clock when the stream last reported each order working, bounded like the settled memory, and forget an order the stream reports settled.
- [x] 1.2 Prove by test that the memory stays bounded and that a settlement clears the entry.

## 2. What A Read May Remove

- [x] 2.1 Keep a working order the read omitted when the stream reported it after the read was issued.
- [x] 2.2 Keep removing an order the read omitted that the stream has said nothing newer about.
- [x] 2.3 Prove both by test, including the placement-then-read sequence that produced the blink.

## 2a. The Half The First Pass Missed

The operator still saw the blink: a read issued *after* the stream's report, on
an exchange whose REST view had not caught up, was believed and took the order
off the screen. Comparing against when the read was issued only covers the reads
that left first.

- [x] 2a.1 Allow for the window the exchange's own answer may trail its stream by, measured from the stream's report.
- [x] 2a.2 Prove by test that a read issued just after the report keeps the order, that a read past the window removes it, and that the window is measured from the report rather than from the read.

## 3. Verification

- [x] 3.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 3.2 Operator confirms on live data that a newly placed order appears once and stays, on the chart and in the working-orders list, and that an order cancelled from the Binance app still disappears — step 25, «Ордер появляется один раз и остаётся», in `verify-the-desk-in-one-sitting/runbook.md`. Both halves are in the one step on purpose: the holding is only sound if the outside cancellation still lands, and a step that checked only the first half would pass on a desk that had simply stopped listening.
