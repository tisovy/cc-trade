## 1. The Delivered Book Is the Whole Book

- [x] 1.1 Raise `RETAINED_LEVELS_PER_SIDE` to the snapshot's own 1,000: the read was already paid for at weight 20 and half of it was being thrown away.
- [x] 1.2 Express the delivered level count as one shared constant and source both the order book's `RENDERER_LEVELS_PER_SIDE` and the payload validator's bound from it, so a book that is legal to build can never be illegal to deliver.
- [x] 1.3 State in the limits themselves why 1,000 is a ceiling and not a setting: past it there is no snapshot to bridge, and a book stitched from diffs alone under-reports resting liquidity.

## 2. The Bounds That Would Have Killed It Silently

- [x] 2.1 Raise `FUTURES_WORKSTATION_EVENT_MAX_BYTES` to 256 KiB and say in the comment what the bound is for — refusing an unbounded parse, not keeping frames small.
- [x] 2.2 Derive the renderer parser's node budget from the delivered level count. A full book is 8,020 nodes against a default of 8,192; the margin was 172 nodes on every frame, and exceeding it stops depth rather than degrading it.
- [x] 2.3 Prove the byte bound with the widest book the protocol calls legal — longest decimals, longest identities — not with the tidy one this contract happens to quote: 216 KB against 256 KiB.
- [x] 2.4 Assert the order book's own full delivered view against the same ceiling, in the order-book suite, so the producer and the transport bound move as a pair.

## 3. Paying for the Depth

- [x] 3.1 Sort each side on a price parsed once per level instead of re-parsing both operands of every comparison — a thousand-level side was parsed some twenty times over per pass.
- [x] 3.2 Read best bid and best ask by scan. Taking a minimum by sorting the whole book cost two full sorts per diff for two values.
- [x] 3.3 Count a string's UTF-8 length instead of encoding it: the renderer's parser built a throwaway `TextEncoder` and a throwaway buffer for each of the ~6,000 strings in a full frame, purely to measure them.
- [x] 3.4 Take an unescaped string span verbatim instead of re-running `JSON.parse` on it, once the scan has already proved it well-formed.
- [x] 3.5 Stop grouping when the next display row opens. Levels are monotonic in price, so the row before it can no longer change; without this the whole delivered book is walked to fill fourteen rows.
- [x] 3.6 Hold both parser shortcuts against what they replaced — `JSON.parse` and `TextEncoder` — across multibyte text, surrogate pairs and every escape form, and keep the lone-surrogate rejection.

## 4. The Book Says What It Is Showing

- [x] 4.1 State the price range the visible rows cover (`±X%`) beside the buy/sell split, which is measured over exactly those rows.
- [x] 4.2 Prove by test that the reading is taken from the farther of the two visible edges against the last trade.

## 5. A Working Order Is Sized in USDT

- [x] 5.1 Head the working-orders column `Size (USDT)` and value it with the same `orderNotionalUsdt` the ticket, the order editor and the chart label already use, so one order reads as one number everywhere.
- [x] 5.2 Keep the exact contract count on the cell rather than deleting it, as the positions table does.
- [x] 5.3 Size an algo order from its trigger price: `price` is `0` on a stop-market, so sizing from it would print every algo order as worthless.

## 6. Verification

- [x] 6.1 `npx vitest run` — 83 files, 995 passed, 2 skipped.
- [x] 6.2 `npm run check:futures-production` passes (23 isolated implementation files; exact public-read routes only).
- [x] 6.3 `eslint` clean on every file this change touches.
- [x] 6.4 Cost measured rather than assumed, at 1,000 levels per side and 10 updates a second: main 2.50 ms/frame with no trim and 2.82 ms/frame when every diff forces one; renderer 3.03 ms to parse and validate plus 0.60 ms to group both sides.
- [ ] 6.5 Operator confirms on live data that the book reaches the distances actually traded, and that the `±X%` reading matches what the chart ruler measures.

## 7. Stated Limits, Not Fixed Here

- [ ] 7.1 On a fine-tick contract the 100× and 500× grouping steps still cannot fill fourteen rows: 1,400 and 7,000 levels are more than the exchange publishes. The book ends where Binance ends, and the `±X%` reading is what says so.
- [ ] 7.2 Depth is emitted on every diff with no throttle. That was true before and is unchanged, but each frame is now far larger; the measured cost above is the whole of it.
- [ ] 7.3 The `Filled` column of the working-orders table is still in contracts, beside a size now stated in USDT.
- [ ] 7.4 `FuturesHistoryPanel` still heads its quantity column `Qty` in contracts; only the working-orders table was converted.
