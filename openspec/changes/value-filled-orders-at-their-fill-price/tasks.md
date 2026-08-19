## 1. Re-verify the defect

- [x] 1.1 Confirm the column's price source in current code. At `a859766`,
  `orderFilledNotionalUsdt` (`src/utils/futuresOrderPresentation.js:182-189`)
  priced the executed quantity at `orderPresentationPrice(order)` — resting
  limit, else trigger — and never read `avgPrice`.
- [x] 1.2 Confirm `avgPrice` is on the payload the dock actually receives.
  `normalizeFuturesExecutionReport` reads `order.avgPrice ?? order.ap`
  (`electron/services/futures-trading-adapter.js:262`) and spreads it into
  every report (`:306`); both open-order snapshot paths (`:1021`, `:1027`) and
  the stream (`:822`) go through it, and the renderer's `normalizeOrderSource`
  (`src/hooks/useFuturesTrading.js:216`) spreads the report wholesale, so the
  field reaches the row.
- [x] 1.3 Blast radius by grep (GitNexus MCP is absent in this environment):
  one production caller — `FuturesPortfolioDock.jsx:609`, render-only — plus
  the util's own test file. No signature change, so no d=1 updates beyond the
  dock's expected value.

## 2. Spec

- [x] 2.1 Write the MODIFIED requirement "A working order's filled portion is
  stated in USDT" with full updated text and the gap-fill / nothing-filled
  scenarios, replacing the resting-price sentence written by
  `finish-futures-order-values` (self-confirming: authored by the change whose
  code it was then checked against). Verified by grep that the requirement name
  matches `openspec/specs/futures-order-visibility/spec.md:1323` exactly.
  (The `openspec` CLI is not installed in this tree, so strict validation could
  not be run; the delta follows the archived change's `## MODIFIED
  Requirements` format.)

## 3. Code

- [x] 3.1 Value the executed quantity at `usableOrderPrice(order.avgPrice)`
  when positive, falling back to `orderPresentationPrice(order)` otherwise;
  formatting (`formatOrderNotionalUsdt`), the zero-fill reading and the
  absent-executed reading unchanged.

## 4. Proof

- [x] 4.1 The test bites. With the fix stashed and the tests kept,
  `npx vitest run` on both test files failed pre-fix:
  `AssertionError: expected '5800' to be '5812'` at
  `src/utils/futuresOrderPresentation.test.js:59`, and the dock cell
  `Expected element to have text content: 5812 / Received: 5800` at
  `src/components/features/futures/FuturesPortfolioDock.test.jsx:335`.
  `git stash pop` restored the fix.
- [x] 4.2 With the fix in place, `npx vitest run
  src/utils/futuresOrderPresentation.test.js
  src/components/features/futures/FuturesPortfolioDock.test.jsx` — 89/89
  passed (the only files that render or compute the column; grep for
  `Filled (USDT)` and `orderFilledNotionalUsdt` finds no others).
- [x] 4.3 `npx eslint` on the three touched source/test files — clean.
- [ ] 4.4 Operator reads the Filled column against a real gapped fill on the
  live desk (not performable from this worktree).
