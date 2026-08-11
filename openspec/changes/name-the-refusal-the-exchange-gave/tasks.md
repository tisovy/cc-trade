## 0. Counted Before Changing

- [ ] 0.1 List every shape `binanceCode` actually arrives in, across both markets and both failure classes: Binance's own numbered errors, the transport codes a failed request carries (`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`), and whatever the Spot client hands over via `error?.response?.data?.code`. The pattern is sized against that list, not against a guess.
- [ ] 0.2 Confirm the field reaches the record's seam already: every `createCommandRejection` the desk emits for a market failure puts `binanceCode` in `details`, and the record reads `details` today for `marketType`, `symbol` and the identity. Name any rejection path that does *not* carry it, so the gap is stated rather than discovered later.
- [ ] 0.3 Read the operator's own record for 2026-08-11 and state how many refusals it holds and how many distinct codes they would have resolved to. This is the change's own before-and-after.

## 1. The Field

- [ ] 1.1 The `outcome` kind gains one optional field carrying the exchange's own code for the refusal.
- [ ] 1.2 It accepts a bounded signed integer or a bounded uppercase identifier, and nothing else. A value shaped like a decimal is refused.
- [ ] 1.3 A refused code costs the field, not the line: the refusal is still recorded without it.
- [ ] 1.4 The exchange's own message is not recorded, in any form. It is written for a human and can quote a quantity back.

## 2. Reading It Back

- [ ] 2.1 The summary reports refusals grouped by exchange code, with how many commands each accounts for.
- [ ] 2.2 A day with no refusals reports nothing extra rather than an empty section.

## 3. Proof

- [ ] 3.1 Test: a Futures rejection carrying `-2019` lands with that code beside it, and with no message and no amount.
- [ ] 3.2 Test: a Spot rejection carrying the code the Spot client nests under `response.data.code` lands the same way.
- [ ] 3.3 Test: a transport failure carrying `ECONNRESET` lands as that identifier.
- [ ] 3.4 Test: a code offered as `'20.5'`, as a sentence, or as an object is refused, and the refusal is still recorded without it.
- [ ] 3.5 Test: the summary groups a fixture day's refusals by code and counts them.
- [ ] 3.6 Test: the seam is live — a refusal emitted through the connection itself reaches the record with its code. Prove it load-bearing by removing the extraction.

## 4. Verification

- [ ] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `check:circular`, `check:runtime-mock`, `check:command-path`.
- [ ] 4.2 Re-read the operator's existing record with the new summary and confirm it still reads: the field is optional, and every line written before this change lacks it.
- [ ] 4.3 Add the operator's confirmation to `verify-the-desk-in-one-sitting/runbook.md`, in Russian: refuse an order deliberately (a size below the contract's minimum is the cheapest way), then read the day back and confirm the refusal names the exchange's code and still holds no amount.
- [ ] 4.4 Operator confirms on live data.

## 5. Stated Limits, Not Fixed Here

- [ ] 5.1 The code is not translated. `-2019` stays `-2019`; a table of Binance's codes is documentation, not a record, and it goes stale on the exchange's schedule rather than the desk's.
- [ ] 5.2 An accepted command still writes no outcome line — only refusals and unresolved outcomes produce one. Recording acceptances is a trade journal by another name, which `keep-a-record-of-what-the-desk-did` deliberately left out.
