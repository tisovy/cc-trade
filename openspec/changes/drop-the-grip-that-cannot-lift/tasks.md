# Tasks

## 1. Re-verify the audit's findings in current code

- [x] 1.1 Re-verify the lift refusal on a resting price of `0`.

  Confirmed, at the audit's own line numbers: `useFuturesOrderDrag.lift`
  (`src/hooks/useFuturesOrderDrag.js:250-267`) evaluates
  `describeFuturesDragReplacement({ order, price: order?.price, … })` before
  cancelling, and `src/utils/futuresOrderDrag.js:81-87` refuses `'0'` as
  `UNUSABLE_PRICE` (`normalizeFuturesDraftPrice` requires a positive price, and
  the fallback `isPositiveDecimal('0')` is false). One wording difference from
  the audit note: the current refusal reads "The price the order was **dropped**
  at cannot be used" — not "RESET" — but it misleads the same way at lift time:
  nothing was dropped.

- [x] 1.2 Re-verify the grip and the pending mark.

  Confirmed, with a nuance the audit note did not carry: the handle pass
  (`FuturesWorkstationChart.jsx`, coordinate effect) filters on the pane's own
  bounds, so a price-`0` order gets its grip only when price 0 is on the pane
  (a scale dragged down to zero) — off-pane it has no chart handle at all.
  When the grip does render it promises "Move … with Ctrl or Alt drag"
  (verified: the pre-fix test run below found exactly that button), and
  `beginOrderDrag` guarded only `orderKind !== 'REGULAR'`, so the gesture began,
  called the lift, and published the pending mark at
  `priceToCoordinate(0)` — a finite y far off the visible pane.

- [x] 1.3 Re-verify the masking mock.

  Confirmed: the chart suite's shared `properties()` mocked
  `onOrderLift: vi.fn(async () => ({ ok: true }))`
  (`FuturesWorkstationChart.test.jsx:97` pre-change) — every lift confirmed,
  whatever the order, so no chart test could witness the real refusal.

## 2. Impact before editing

- [x] 2.1 Blast radius by grep (the GitNexus MCP server is absent in this
  environment and the CLI's `impact` reports 0/LOW even for plain ESM imports,
  so grep is the authoritative instrument here).

  `beginOrderDrag` — one caller, the grip's own `onPointerDown` in the same
  file. The grip markup — addressed only by chart tests via its aria-label.
  `FuturesWorkstationChart` — rendered by `FuturesWorkstationView` only; the
  dock and the ticket render orders on their own surfaces and offer no drag.
  `useFuturesOrderDrag` / `futuresOrderDrag.js` — untouched, so their callers
  are unaffected. Risk: LOW; no d=1 dependents outside the edited file and its
  test.

## 3. The fix

- [x] 3.1 Offer no grip on an order resting at no price.

  `FuturesWorkstationChart.jsx`: the REGULAR handle renders the grip button only
  when `toNumber(order.price) > 0`; otherwise the same content goes on a bare
  `futures-workstation-owned-order-plate` with `role="note"` and the label
  "… order resting at no price; it cannot be moved by dragging". The cancel
  button stays — cancelling a stop-market order is a regular-endpoint operation
  and still works. No CSS touched (the plate class already exists), and both
  hunks sit away from the annotation-gate region another session is editing.

- [x] 3.2 Begin no drag, publish no pending mark.

  `beginOrderDrag` refuses `!(toNumber(order?.price) > 0)` before anything else
  it does, so no drag starts on such an order and no pending mark is ever
  published at the y-coordinate of price 0 — whatever surface calls it.

- [x] 3.3 Leave the refusal path standing.

  `src/hooks/useFuturesOrderDrag.js` and `src/utils/futuresOrderDrag.js` are
  byte-for-byte untouched (`git diff --stat` shows only the chart, its test,
  and this change folder). A genuinely broken lift — a ceiling lowered under a
  resting order — still refuses before cancelling, verified by the new
  real-hook test.

## 4. Tests that bite

- [x] 4.1 `offers no drag grip on an order resting at no price` — stop-market
  fixture (`REGULAR`, `type: STOP_MARKET`, `price: '0'`, `stopPrice: '57000'`),
  scale remocked so price 0 is on the pane. Asserts no button matching
  /with Ctrl or Alt drag/, and the note plus cancel control instead.

  Bite proven: with the code fix stashed and the tests kept
  (`git stash push -- src/components/features/futures/FuturesWorkstationChart.jsx`),
  the run failed on
  `expect(element).not.toBeInTheDocument()` — "expected document not to contain
  element, found `<button aria-label="Move SELL LONG order at 0 with Ctrl or
  Alt drag" class="futures-workstation-owned-order-grip">`".

- [x] 4.2 `begins no drag and draws no pending mark for an order resting at no
  price` — pointer down with the trading modifier on whatever plate the order
  is drawn on. Asserts `onOrderLift` is never called and no
  /heading for|lifted off the book/ status exists.

  Bite proven on the same pre-fix run:
  `AssertionError: expected "vi.fn()" to not be called at all, but actually
  been called 1 times` — called with the `price: '0'` stop-market order.
  `git stash pop` restored the fix afterwards.

- [x] 4.3 `refuses a broken lift through the real hook and leaves the order
  resting` — the un-masking: a harness wires the chart's `onOrderLift`/
  `onOrderDrop` to the **real** `useFuturesOrderDrag` (mocked network functions
  only), with `maxOrderNotionalUsdt: '100'` under a 29 950 USDT order. Asserts
  `cancelOrder` and `placeOrder` are never called, the refusal is stated
  ("Order NOT lifted: The order would be 29950 USDT, above the local 100 USDT
  limit. The order was left where it is."), and the grip survives with its
  notional. Named honestly: this one passes pre-fix too — it is the sentinel
  for the refusal path this change keeps, not a bite on the grip fix; the bites
  are 4.1 and 4.2.

## 5. Verification

- [x] 5.1 `npx vitest run src/components/features/futures/FuturesWorkstationChart.test.jsx`
  — 55/55 passed post-fix (52 pre-existing + 3 new); the same file pre-fix:
  53 passed, 2 failed — exactly the two biting tests, no collateral.
- [x] 5.2 `npx eslint` on `FuturesWorkstationChart.jsx` and
  `FuturesWorkstationChart.test.jsx` — clean.
- [ ] 5.3 Operator: with a stop-market order resting, drag the price scale down
  until 0 is on the pane and confirm the order shows a plate with a cancel
  control and no grip, and that Ctrl/Alt-drag on it starts nothing.

## 5. Applied To The Moved Base

- [x] 5.1 The fix was built against `a859766` and landed on a tree that had
  since taken the display-price change: the grip and cancel labels name
  `displayPrice` (the trigger for a stop-market), and the order's worth is
  valued at the trigger. Three test expectations were aligned at apply time —
  the trigger-drawn stop-market now expects the plate instead of a grip (and
  the stop-limit's surviving grip is asserted beside it), the fixture carries
  `triggerPrice` the way the normalized order does, and the plate's value
  reads 28500 USDT rather than the base's dash. Full chart suite after the
  merge: 380/380, eslint clean.
