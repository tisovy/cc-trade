## 1. Planning Gate

- [x] 1.1 Validate the complete OpenSpec change before production edits.

## 2. Production Renderer

- [x] 2.1 Pass the selected interval into the Futures chart and make contract plus interval the chart-session reset identity.
- [x] 2.2 Re-evaluate left-edge history loading when the oldest usable candle first appears or changes, preserving viewport anchoring and single-flight ownership.

## 3. Regression Coverage

- [x] 3.1 After production code is in place, prove an empty-at-mount chart requests history when its live candles arrive.
- [x] 3.2 Prove an interval replacement gets a fresh fitted viewport and history request without remounting the chart.
- [x] 3.3 Prove reaching the new edge after a prepend requests a consecutive page using the new oldest candle.

## 4. Verification

- [x] 4.1 Run focused chart/view tests and lint for every touched production and test file.
- [x] 4.2 Revalidate the OpenSpec change and run GitNexus `detect_changes` against `main` to confirm only the expected chart flow changed.
- [x] 4.3 Operator confirms on live 1m BEATUSDT and BTWUSDT that opening and repeated left-edge scrolling continue to load older candles, and that interval switches never flash candles from the selection being replaced.

## 5. Interval Transition Isolation Follow-up

- [x] 5.1 Record the stale-selection paint regression in the OpenSpec artifacts and validate the updated change before production edits.
- [x] 5.2 Gate chart candle rows on exact contract-and-interval ownership while leaving symbol-owned resources available during an interval transition.
- [x] 5.3 Clear the imperative candle and volume series in the layout phase of a chart-session replacement.
- [x] 5.4 After production code is in place, prove both the view ownership gate and the chart's pre-paint series clearing.
- [x] 5.5 Run focused chart/view tests and lint for every touched production and test file.
- [x] 5.6 Revalidate the OpenSpec change and run GitNexus `detect_changes` before committing.
