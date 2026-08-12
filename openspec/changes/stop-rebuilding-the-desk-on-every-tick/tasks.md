## 1. The Trade Stream Does Not Cancel History

- [ ] 1.1 Narrow the Spot chart history effect's dependencies to the selection and the series bounds it reads, so a trade does not recreate it.
- [ ] 1.2 Keep the debounce, and prove by test that a continuous trade stream still lets a history request be issued.

## 2. A Live Trade Costs One Candle

- [ ] 2.1 Update the last candle in place on the chart's series instead of re-running `setData`, the volume series and the SMA pass on every trade.
- [ ] 2.2 Avoid copying the whole candle array in `applyTradeToChart` when only the last candle changes.
- [ ] 2.3 Prove by test that a trade that only moves the last candle produces no full-series work.

## 3. Depth Frames Are Coalesced

- [ ] 3.1 Coalesce futures depth deliveries to at most one book per animation interval, with the newest frame replacing a pending one.
- [ ] 3.2 Keep the delivered book complete — coalescing drops intermediate frames, never levels.
- [ ] 3.3 Prove by test that a burst of depth frames delivers one book and that the delivered book is the newest.

## 4. No State Updates During Render

- [x] 4.1 Derive the last-tick direction without calling `setLastTick` in the render body of `FuturesWorkstationView`.
- [x] 4.2 Prove by test that a price tick renders the workstation once — and state what still costs two. A tick that keeps going the same way, and a price that did not move, each cost one pass; a **turn** costs two, because a direction is a comparison with what was on screen before and nothing in the props carries that. It used to be two on every tick. Counted through the one helper the view calls once per render pass.
- [x] 4.3 Keep the direction on the frame the turn happened. *(Discovered: deciding it after the commit is what removes the second pass, but an ordinary effect runs after the browser paints, so a turn would have been drawn a frame late — a red price shown green for one frame, on the surface the operator reads fastest. It is decided in a layout effect, before the paint.)*
- [x] 4.4 Do not read what was on screen before during the render. *(Discovered: holding the previous price in a ref and reading it in the render body is the obvious shape and the lint rule refuses it, correctly — a render that reads mutable state outside React is not a pure render. The previous price is written after the commit and read only there.)*

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data that the desk stays responsive on a liquid contract with deep history loaded.
