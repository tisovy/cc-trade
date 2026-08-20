## 1. Establish the ground truth

- [ ] 1.1 Confirm the income walk currently discards amounts:
  `getTradedSymbolPage` asks `incomeType: 'REALIZED_PNL'` and returns only
  `{symbols, full, lastTime}` (`electron/services/futures-trading-adapter.js`),
  and `readFuturesTradedSymbols` reads nothing but `symbol` and `time`.
- [ ] 1.2 Confirm on the wire what `/fapi/v1/income` returns for
  `FUNDING_FEE`, `COMMISSION` and `INSURANCE_CLEAR` — field names, sign
  convention, whether `symbol` is populated on each, and whether omitting
  `incomeType` is cheaper than four calls. Assert the address on the wire, not
  only the behaviour behind it. Binance docs are a SPA: use `llms-full.txt` or
  headless Chromium through the proxy.
- [ ] 1.3 Confirm `ACCOUNT_UPDATE` really does not attribute a funding charge to
  a contract, so the read is necessary rather than a convenience.
- [ ] 1.4 Confirm `futuresTradeRounds` exposes an open round's start time and
  whether it is reachable from the dock's data, and confirm what it reports when
  the opening fills are outside the window (`fromFlat`, `entryImplied`).
- [ ] 1.5 Blast radius by grep for `getTradedSymbolPage`,
  `readFuturesTradedSymbols` and the income walk in `binance-connection.js`.

## 2. Spec

- [ ] 2.1 Write the two ADDED requirements and the MODIFIED
  "Values no stream carries are read, not computed", carrying across every
  scenario the live spec still has.
- [ ] 2.2 `OPENSPEC_TELEMETRY=0 openspec validate state-what-an-open-position-has-already-paid --strict`.

## 3. Code — read the amounts

- [ ] 3.1 Widen the income read to the four types and return the rows'
  `symbol`, `incomeType`, `income`, `asset`, `time` and `tranId`. Keep the page
  bounding and the fixed time window exactly as they are — moving `startTime`
  past the last timestamp still skips rows sharing a millisecond.
- [ ] 3.2 Keep symbol discovery working off the same rows, so the traded-symbol
  fan-out is unchanged by the widening.
- [ ] 3.3 Deduplicate by `tranId` across pages: a page boundary inside one
  millisecond can hand back a row twice, and a double-counted funding charge is
  money.

## 4. Code — fold and present

- [ ] 4.1 Fold income rows to per-contract, per-leg settled totals bounded by the
  open round's start, keeping the four types apart and summing per asset.
- [ ] 4.2 Carry whether the position's start is inside the window; where it is
  not, the fold reports the reading as window-bounded.
- [ ] 4.3 Broadcast the folded totals from the income walk in
  `binance-connection.js`, on a realizing fill or a funding cause — not on a
  timer.
- [ ] 4.4 Add the `PnL` column to the Positions panel beside `uPnL`, with the
  breakdown on the element and the window qualification stated where it applies.
  Follow the desk's number rules: magnitudes, no stream padding, exact value in
  the title.

## 5. Proof

- [ ] 5.1 Each new test bites: run it against the pre-change code in a copy of the
  tree and record the failure before keeping it.
- [ ] 5.2 The adapter test asserts the request actually sent — path and query,
  including the income types — not only the shape of the reply.
- [ ] 5.3 Fold tests: a scaled-out position, a funding boundary, a BNB
  commission, a position opened before the window, a `tranId` repeated across
  pages.
- [ ] 5.4 Dock test: the column renders, the breakdown is on the element, and the
  window qualification appears only when the start is unknown.
- [ ] 5.5 Column widths verified in headless Chromium against a scratchpad
  fixture — the Positions grid is already under the clock, and this adds a column
  to it.
- [ ] 5.6 `npx vitest run` on every touched test file; `npx eslint` on the touched
  sources.
- [ ] 5.7 Operator checks one open position's settled money against the Binance
  app's own figures for the same contract. Record in
  `openspec/live-verification-ledger.md`.
