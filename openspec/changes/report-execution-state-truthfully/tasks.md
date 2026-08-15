## 0. What Already Landed

Audited against the tree on 2026-08-15, item by item, before doing any of it
again. The operator saw Binance's own text — "Order's notional must be no
smaller than 5" — on screen on 15 August, with `exchangeCode "-4164"` beside
`FUTURES_API_ERROR` in the record, which is section 1 working on live data.

Nine of the twenty-one were already done, five were partly done, and seven were
untouched. Each is marked below with where it is, so nothing was rebuilt.

This session then closed eleven of the remaining twelve. Only 7.2 is left, and it
is the operator's own walk — written up as step 48 of the runbook.

## 1. Exchange-Reported Failure Identity

- [x] 1.1 Landed. `FuturesTradingTicket.jsx:937` renders `· Binance <code>` beside the local code from `lastError.details.binanceCode`.
- [x] 1.2 Verified. The renderer keeps the whole rejection envelope — `useFuturesTrading.js:671` stores `payload.command_rejected` unaltered — and the backend puts `binanceCode` on it at every futures emit site (`binance-connection.js:2529`, `:2579`, `:2632`, `:3342`). Nothing is dropped between the emit and the surface.
- [x] 1.3 Landed. `FuturesTradingTicket.test.jsx` asserts `Binance -2019` on the rejection panel.

## 2. Rejections Are Not Masked

- [x] 2.1 Landed. The command rejection and the account-resource failure are two sections of the ticket, the rejection first (`FuturesTradingTicket.jsx:928–953`).
- [x] 2.2 **Landed by this change.** The ticket holds the rejection it was handed rather than reading `lastError` live, so an execution report about another order can no longer wipe it off the screen. It is let go of on Dismiss, or when the operator sends another order.
- [x] 2.3 Landed. Same test as 1.3: the rejection stays readable while a balance resource is in error.

## 3. Order Surfaces Disclose Synchronization

- [x] 3.1 **Landed.** The operator handed the file over on 2026-08-15. Order resource status is derived once in `FuturesProductionWorkstation` and given to both the dock and the chart, so the two cannot disagree about whether the account has been read.
- [x] 3.2 **Landed.** Not read yet, reading, ready, stale and failed are separated by one helper, `describeFuturesResourceAvailability`, which the dock and the chart both read. "No working orders" is shown only when a read actually reported none.
- [x] 3.3 **Landed.** The exchange's sanitized reason and a Retry are stated on both surfaces, wired to the same `refresh` the ticket uses. The chart notice sits bottom-left above the older-candles line; measured in Chromium at five widths, no pair of chart notices overlaps and it stays clear of the price scale.
- [x] 3.4 **Landed.** `FuturesPortfolioDock.test.jsx` proves a failed resource never renders as an empty book and that a stale one keeps its rows; `FuturesWorkstationView.test.jsx` proves the same for the chart, including that a read which succeeded says nothing at all.

## 4. Intent Is Presented

- [x] 4.1 **Landed**, settled by the operator on 2026-08-15: keep the leg and add the word rather than replace one with the other. Every working-order surface — the dock, the rail and the chart — now carries an `exit` badge beside `LONG`/`SHORT` when the intent is EXIT, with the reason on the element: reduce-only orders say they can only close, hedge-leg closes say they close rather than open. Direction and its colour are untouched, so the badge adds information instead of standing in for it. The chart's accessible names are deliberately left alone — they are the handles that file's drag tests address orders by.
- [x] 4.2 **Landed by this change.** A close-position order is now classified as an exit regardless of its side.
- [x] 4.3 Landed. The tone always follows the side (`futuresOrderPresentation.js:6`), so intent never replaces direction.

## 5. Submission Surfaces Report Truthfully

- [x] 5.1 Landed. `FuturesOrderEditor.jsx:110` keeps the editor open on `sent === false` and states which of the two things did not happen.
- [x] 5.2 **Landed by this change.** The position closer, the leverage panel and the margin panel already followed the rule. The order confirmation now sends first and closes second: a send that did not leave the renderer keeps the panel open with the numbers the operator approved, and states the reason on the panel rather than only on the rail behind it.
- [x] 5.3 Landed. `FuturesOrderEditor.test.jsx:217` proves both the amendment and the cancellation.

## 6. Balance Freshness After Reconnect

- [x] 6.1 Landed. `markAccountResourcesUnconfirmed` (`useFuturesTrading.js:85`) turns every ready resource stale on a transport loss, and `deriveFuturesReadiness` blocks on stale.
- [x] 6.2 **Landed by this change.** The age of a balance nothing has confirmed on this connection is stated beside `Available`, ticked by a leaf of its own so the ticket does not re-render on a clock, and shown only while it is unconfirmed.
- [x] 6.3 **Landed by this change**, at the seam rather than on either side of it: `FuturesTradingTicket.test.jsx` now proves that a balance stale since the reconnect states its age on the ticket and that the percentage slider and the notional field are both refused against it.

## 7. Verification

- [x] 7.1 `npm run lint`, `npm test` and `npm run check:futures-production`, all clean.
- [ ] 7.2 Walk the desk once with the account intentionally failing and record that no surface claims a state the account is not in. Written up for the operator as step 48 of `verify-the-desk-in-one-sitting/runbook.md`.
