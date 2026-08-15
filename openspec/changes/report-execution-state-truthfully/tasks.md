## 1. Exchange-Reported Failure Identity

- [ ] 1.1 Present the sanitized exchange-reported code and message alongside the local code wherever a rejection is shown, starting with `FuturesTradingTicket`.
- [ ] 1.2 Verify no rejection detail carrying the exchange code is dropped between the backend emit and the renderer surface.
- [ ] 1.3 Prove by test that a rejection carrying an exchange code shows that code and not only `FUTURES_API_ERROR`.

## 2. Rejections Are Not Masked

- [ ] 2.1 Present a command rejection and an account-resource failure as separate facts, so neither replaces the other.
- [ ] 2.2 Keep a rejection readable until the operator acknowledges it or issues another command.
- [ ] 2.3 Prove by test that a rejection arriving during an account failure remains visible.

## 3. Order Surfaces Disclose Synchronization

- [ ] 3.1 Carry order resource status into the chart and the dock instead of discarding it.
- [ ] 3.2 Show "no working orders" only when a successful synchronization reported none, and distinguish not-yet-synchronized, synchronizing, stale and failed.
- [ ] 3.3 Offer the failure reason and the retry path from those surfaces, consistent with the ticket.
- [ ] 3.4 Prove by test that an unsynchronized and a failed order resource never render as an empty order book of working orders.

## 4. Intent Is Presented

- [ ] 4.1 Present the computed entry or exit intent on order and position surfaces alongside direction.
- [ ] 4.2 Classify a close-position order as an exit regardless of its side, and prove the classification by test.
- [ ] 4.3 Keep direction colouring intact so intent adds information rather than replacing it.

## 5. Submission Surfaces Report Truthfully

- [ ] 5.1 Keep the order editor open and state the failure when the send returns false because the transport is unavailable.
- [ ] 5.2 Apply the same rule to every other submission surface that can be dismissed on send.
- [ ] 5.3 Prove by test that a send refused by a disconnected transport leaves the editor open with a stated reason.

## 6. Balance Freshness After Reconnect

- [ ] 6.1 Mark a previously confirmed balance stale on reconnect until a new confirmation arrives, instead of treating it as ready.
- [ ] 6.2 Show the age of a stale balance wherever it is used for sizing or exposure decisions.
- [ ] 6.3 Prove by test that percentage sizing is unavailable against a balance whose confirmation predates the reconnect.

## 7. Verification

- [ ] 7.1 Run unit and integration suites and the production-guard checks.
- [ ] 7.2 Walk the desk once with the account intentionally failing and record that no surface claims a state the account is not in.
