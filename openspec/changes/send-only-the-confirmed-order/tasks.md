## 1. The Confirmed Order Is The Sent Order

- [x] 1.1 Carry the whole staged draft (price, quantity, notional, side, reduceOnly) on the pending order in `FuturesTradingTicket.jsx`, not just the price.
- [x] 1.2 Make `confirmPendingOrder` submit those staged numbers verbatim, with no re-derivation from the current balance, percent or custom notional.
- [x] 1.3 Re-check readiness and the budget against the present state at confirmation, and refuse with a stated reason — never re-size — when the staged order no longer passes.
- [x] 1.4 State the refusal in terms the operator can act on: what was staged, and which bound it now breaks.
- [x] 1.5 Prove by test that a balance that grows between staging and confirming sends the staged quantity, and that a balance that shrinks below the staged notional refuses the send.
- [x] 1.6 Prove by test that moving the size slider while the confirmation is open does not change what confirmation sends.

## 2. A Panel Closes Only When Its Command Left The Desk

- [x] 2.1 Return the send result from the trading callbacks the panels use (`modifyOrder`, `cancelOrder`, `closePosition`, `adjustPositionMargin`, `setLeverage`) so a caller can tell delivered from undelivered.
- [x] 2.2 Keep `FuturesOrderEditor` open and state "NOT sent" when the command could not be sent.
- [x] 2.3 Apply the same to `FuturesPositionCloser` and `FuturesPositionMarginEditor`; keep the existing `unsent` treatment in `FuturesLeverageEditor` consistent with it.
- [x] 2.4 Prove by test that each panel stays open, states the failure, and sends nothing further when the socket is closed.

## 3. An Editor Belongs To The Object It Was Opened For

- [x] 3.1 Key each floating editor in `FuturesProductionWorkstation.jsx` by the identity it edits (order id / position symbol and side).
- [x] 3.2 Prove by test that re-targeting an open editor at a different order or position discards the previous draft rather than submitting it against the new identity.

## 4. Leverage Is Bounded By The Ceiling That Arrives

- [x] 4.1 Clamp the picked leverage to the current ceiling in `FuturesLeverageEditor.jsx`, both for display and for submission.
- [x] 4.2 Prove by test that a pick made under a placeholder ceiling is lowered when the contract's real maximum arrives, and that the lowered value is what Apply would send.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`, `npm run check:command-path`, `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data that a confirmation sends the size shown and that a panel that fails to send stays open.
