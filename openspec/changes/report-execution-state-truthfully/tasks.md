## 0. What Already Landed

Audited against the tree on 2026-08-15, item by item, before doing any of it
again. The operator saw Binance's own text — "Order's notional must be no
smaller than 5" — on screen on 15 August, with `exchangeCode "-4164"` beside
`FUTURES_API_ERROR` in the record, which is section 1 working on live data.

Nine of the twenty-one were already done, five were partly done, and seven were
untouched. Each is marked below with where it is, so nothing was rebuilt.

This session then closed eight of the remaining twelve. What is left is 3.1 (the
chart, in another session's file), 4.1 (a design question for the operator), and
the two verification items.

## 1. Exchange-Reported Failure Identity

- [x] 1.1 Landed. `FuturesTradingTicket.jsx:937` renders `· Binance <code>` beside the local code from `lastError.details.binanceCode`.
- [x] 1.2 Verified. The renderer keeps the whole rejection envelope — `useFuturesTrading.js:671` stores `payload.command_rejected` unaltered — and the backend puts `binanceCode` on it at every futures emit site (`binance-connection.js:2529`, `:2579`, `:2632`, `:3342`). Nothing is dropped between the emit and the surface.
- [x] 1.3 Landed. `FuturesTradingTicket.test.jsx` asserts `Binance -2019` on the rejection panel.

## 2. Rejections Are Not Masked

- [x] 2.1 Landed. The command rejection and the account-resource failure are two sections of the ticket, the rejection first (`FuturesTradingTicket.jsx:928–953`).
- [x] 2.2 **Landed by this change.** The ticket holds the rejection it was handed rather than reading `lastError` live, so an execution report about another order can no longer wipe it off the screen. It is let go of on Dismiss, or when the operator sends another order.
- [x] 2.3 Landed. Same test as 1.3: the rejection stays readable while a balance resource is in error.

## 3. Order Surfaces Disclose Synchronization

- [ ] 3.1 The dock half is done. The chart is still given `ownedOrders` and nothing about their state (`FuturesWorkstationView.jsx:1130`). **That file belongs to another session — it needs the operator to hand it over or to route the change through them.**
- [x] 3.2 **Landed by this change for the dock.** It now separates not read yet, reading, ready, stale and failed, and "No working orders" is shown only when a read actually reported none. The chart still says nothing — see 3.1.
- [x] 3.3 **Landed by this change for the dock.** The exchange's sanitized reason and a Retry are stated in the panel whose rows they are about, wired to the same `refresh` the ticket uses. The chart still offers neither — see 3.1.
- [x] 3.4 **Landed by this change for the dock.** `FuturesPortfolioDock.test.jsx` proves that a failed order resource never renders as an empty book, that a stale one keeps its rows and says what they are, and that Retry reaches the account refresh. The chart is untested because it is untouched — see 3.1.

## 4. Intent Is Presented

- [ ] 4.1 Not done, and deliberately so: `futuresOrderPresentation.js:29` reasons that "the leg plus the side colour already says everything" and returns the position side as the label. That reasoning is sound for a reduce-only order, whose leg *is* its intent — and it is what the change disputes. Left for the operator to settle rather than reversed silently.
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

- [ ] 7.1 Run unit and integration suites and the production-guard checks.
- [ ] 7.2 Walk the desk once with the account intentionally failing and record that no surface claims a state the account is not in.
