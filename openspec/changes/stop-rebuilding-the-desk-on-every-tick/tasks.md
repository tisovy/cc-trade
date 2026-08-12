## 1. The Trade Stream Does Not Cancel History

- [ ] 1.1 Narrow the Spot chart history effect's dependencies to the selection and the series bounds it reads, so a trade does not recreate it.
- [ ] 1.2 Keep the debounce, and prove by test that a continuous trade stream still lets a history request be issued.

## 2. A Live Trade Costs One Candle

- [ ] 2.1 Update the last candle in place on the chart's series instead of re-running `setData`, the volume series and the SMA pass on every trade.
- [ ] 2.2 Avoid copying the whole candle array in `applyTradeToChart` when only the last candle changes.
- [ ] 2.3 Prove by test that a trade that only moves the last candle produces no full-series work.

## 3. A Frame Redraws Only Its Own Panel

- [x] 3.1 ~~Coalesce futures depth deliveries to at most one book per animation interval, with the newest frame replacing a pending one.~~ Measured before building: the exchange sends `@depth@100ms` ten times a second, the tape is throttled to four, the klines about four and the mark once — around twenty renderer events a second against the sixty an animation interval allows. There is nothing to coalesce at the exchange's cadence, and the burst case the section was written for is already collapsed in the transport by `carry-execution-ahead-of-market-data`, where an undelivered book is replaced by the newer one. Building it would have bought nothing and made every hook test asynchronous.
- [x] 3.2 ~~Keep the delivered book complete — coalescing drops intermediate frames, never levels.~~ Nothing is coalesced, so nothing is dropped.
- [x] 3.3 Redraw the book only for a frame that changed the book, and the tape only for a frame that changed the tape. *(Discovered by measuring where the burst actually cost anything. The chart, the ticket, the history panel and the portfolio dock are memoized; the two panels the operator reads fastest are not — the ladders and the tape rows are built in the view's own body, so every frame of either kind rebuilt both. On a twenty-four-level book, 152 of the 175 number formats one print cost belonged to a book that had not moved, and 78 of the 251 a book update cost belonged to a tape that had not printed.)*
- [x] 3.4 Hold the two panels by element identity rather than splitting them into components. *(Discovered: React skips a subtree whose element is the one it already has, so a `useMemo` per panel buys the same saving as a memoized child without plumbing twenty props through a new boundary — and leaves the markup where a reader of this file already expects it. It needs the handlers and the depth scale to be stable, which cost one `useCallback`.)*
- [x] 3.5 Prove by test that a print costs the same whatever the book on screen is worth, and a book update the same whatever the tape holds — measured through the formatter every row calls, at two panel sizes, so what did not change contributes nothing to the difference. Proven against the pre-change view in a scratch checkout: it fails there at 175 against 23, and 251 against 173.

## 4. No State Updates During Render

- [x] 4.1 Derive the last-tick direction without calling `setLastTick` in the render body of `FuturesWorkstationView`.
- [x] 4.2 Prove by test that a price tick renders the workstation once — and state what still costs two. A tick that keeps going the same way, and a price that did not move, each cost one pass; a **turn** costs two, because a direction is a comparison with what was on screen before and nothing in the props carries that. It used to be two on every tick. Counted through the one helper the view calls once per render pass.
- [x] 4.3 Keep the direction on the frame the turn happened. *(Discovered: deciding it after the commit is what removes the second pass, but an ordinary effect runs after the browser paints, so a turn would have been drawn a frame late — a red price shown green for one frame, on the surface the operator reads fastest. It is decided in a layout effect, before the paint.)*
- [x] 4.4 Do not read what was on screen before during the render. *(Discovered: holding the previous price in a ref and reading it in the render body is the obvious shape and the lint rule refuses it, correctly — a render that reads mutable state outside React is not a pure render. The previous price is written after the commit and read only there.)*

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data that the desk stays responsive on a liquid contract with deep history loaded.
