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

- [ ] 4.1 Derive the last-tick direction without calling `setLastTick` in the render body of `FuturesWorkstationView`.
- [ ] 4.2 Prove by test that a price tick renders the workstation once.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data that the desk stays responsive on a liquid contract with deep history loaded.
