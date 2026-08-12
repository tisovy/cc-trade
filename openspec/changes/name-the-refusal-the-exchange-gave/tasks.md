## 0. Counted Before Changing

- [x] 0.1 List every shape `binanceCode` actually arrives in, across both markets and both failure classes. Read from `electron/services/futures-trading-adapter.js` and the Spot rejection paths:
  - **Binance's own numbered error** — `parsed?.code` off the JSON body, a small negative integer: `-2019`, `-2011`, `-1013`, `-4164`, `-2015`, `-1021`, `-1111`, `-4400` are the ones the desk already has hints for. Always a number, never a string.
  - **The desk's own timeout** — the literal `'ETIMEDOUT'`, set when the request is destroyed on `REQUEST_TIMEOUT_MS`.
  - **Node's transport codes** — `error?.code` off a socket failure: `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EPIPE`, `UND_ERR_SOCKET`, `ERR_SOCKET_CONNECTION_TIMEOUT`, `CERT_HAS_EXPIRED`, `DEPTH_ZERO_SELF_SIGNED_CERT`. Uppercase, underscores, occasionally digits.
  - **Nothing at all** — `?? null` when the body was not JSON or the error carried no code.
  - **Spot, one level deeper** — `spotBinanceCode` reads `error?.code ?? error?.response?.data?.code`, and has already flattened it by the time the envelope is built. Same integers.
  - Hence two patterns and no third: a signed integer of bounded width, or a bounded uppercase identifier. Neither contains a decimal point.
- [x] 0.2 Confirm the field reaches the record's seam already. Of the 24 `createCommandRejection` sites in `binance-connection.js`, three carry `binanceCode` — the Spot placement path, `emitFuturesApiRejection` (which every Futures command failure routes through), and the Futures cancel-all — as do the four `createCommandUnresolved` sites. The remaining 21 are the desk's *own* refusals: an order over the cap, an unconfigured market, a superseded activation, a malformed command. Those asked the exchange nothing, so there is no code to carry, and the field is absent rather than empty. No gap to close in the connection.
- [x] 0.3 The operator's record for 2026-08-11 holds two refusals, both `trade.placeOrder` on CYSUSDT, six seconds apart, both `FUTURES_API_ERROR`. How many distinct causes they were **cannot be answered from the record** — which is the whole of this change. Read back after the change, they report as `(the exchange stated none)`, because they were written before the field existed.

## 1. The Field

- [x] 1.1 The `outcome` kind gains one optional field carrying the exchange's own code for the refusal.
- [x] 1.2 It accepts a bounded signed integer or a bounded uppercase identifier, and nothing else. A value shaped like a decimal is refused.
- [x] 1.3 A refused code costs the field, not the line: the refusal is still recorded without it. This is the one field in the record with that rule, and it says so where it is defined.
- [x] 1.4 The exchange's own message is not recorded, in any form.

## 2. Reading It Back

- [x] 2.1 The summary reports refusals grouped by exchange code, with how many commands each accounts for. A command the exchange resolved is a warning being withdrawn and is not counted as a refusal.
- [x] 2.2 A day with no refusals reports nothing extra rather than an empty section.

## 3. Proof

- [x] 3.1 Test: a Futures rejection carrying `-2019` lands with that code beside it, and with no message and no amount.
- [x] 3.2 Test: a Spot rejection carrying the code the Spot client nests under `response.data.code` lands the same way — proved through the connection itself, not only through the module.
- [x] 3.3 Test: a transport failure carrying `ECONNRESET` or `ETIMEDOUT` lands as that identifier.
- [x] 3.4 Test: a code offered as `'20.5'`, as a sentence, as an object, as an out-of-range integer or in lower case is refused, and the refusal is still recorded without it.
- [x] 3.5 Test: the summary groups a fixture day's refusals by code and counts them, and stays silent on a day that had none.
- [x] 3.6 Test: the seam is live — a refusal emitted through the connection reaches the record with its code, for both markets. Proved load-bearing: replacing the extraction with `null` fails both.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `check:circular`, `check:runtime-mock`, `check:command-path`.
- [x] 4.2 Re-read the operator's existing record with the new summary. 2026-08-11 (644 events, written before this change) reads unchanged and reports its two refusals as `(the exchange stated none)`; 2026-08-12 has no refusals and carries no section for them.
- [x] 4.3 Add the operator's confirmation to `verify-the-desk-in-one-sitting/runbook.md`, in Russian.
- [ ] 4.4 Operator confirms on live data: a deliberately refused order names the exchange's code in the record, and the exchange's message is not in it. — *`verify-the-desk-in-one-sitting/runbook.md`, «Дописано 2026-08-12: отказ называет код биржи», пункт 1*

## 5. Stated Limits, Not Fixed Here

- [x] 5.1 The code is not translated. `-2019` stays `-2019`; a table of Binance's codes is documentation, not a record, and it goes stale on the exchange's schedule rather than the desk's. The desk already keeps such a table for the message on screen (`FUTURES_API_ERROR_HINTS`), which is where it belongs.
- [x] 5.2 An accepted command still writes no outcome line — only refusals and unresolved outcomes produce one. Recording acceptances is a trade journal by another name, which `keep-a-record-of-what-the-desk-did` deliberately left out.
