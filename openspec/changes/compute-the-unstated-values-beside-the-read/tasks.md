## 1. Holding What The Arithmetic Needs

- [x] 1.1 Read the whole leverage bracket table out of the `/fapi/v1/leverageBracket` answer the desk already makes, instead of discarding everything but the highest multiple.
- [x] 1.2 Hold the table per contract beside the symbol config, on the same clock, and forget it wherever the configs are forgotten.
- [x] 1.3 Read the brackets for a contract the account holds a position on and has no table for, under the same bound as the leverage read — an account in nine positions reads eight and states nothing for the ninth.
- [x] 1.4 Prove 1.1–1.3 by test, including that a bracket read that fails does not un-know a table already held.

## 2. Computing What No Stream States

- [x] 2.1 Write the arithmetic as pure functions over one reading — positions, wallet, resting orders, marks, brackets, leverage — in a module of its own, so it can be tested against numbers taken off the live account.
- [x] 2.2 Notional and maintenance margin: `|size| × mark`, and `notional × mmr − cum` from the bracket the notional falls in.
- [x] 2.3 Initial margin: the notional over the contract's leverage, and for an isolated position the isolated wallet the frame states.
- [x] 2.4 Free margin: cross wallet plus cross unrealized, less every cross position's initial margin and every resting order's — a reduce-only order committing nothing, and per contract only the heavier of the two sides counting.
- [x] 2.5 Liquidation price by Binance's published formula, with cross taking the wallet, the other positions' maintenance margin and their unrealized into account, and isolated taking the isolated wallet with neither.
- [x] 2.6 Compute nothing at all — not a fallback, not a zero — where the bracket, the mark, the leverage or the margin mode is missing.
- [x] 2.7 Prove 2.2–2.6 by test, including a position past the first bracket, both margin modes, a hedge-mode pair on one contract, and a reduce-only order.
- [x] 2.8 Preserve the exchange-stated cross wallet through REST normalization and stream reconciliation so free-margin and cross-liquidation estimates never derive it from another balance.

## 3. Standing The Two Answers Side By Side

- [x] 3.1 On every read that answers positions or balances, compare the desk's own answer for the same reading against the exchange's, value by value.
- [x] 3.2 Keep the exchange's answer as the only thing shown and the only thing an order is sized against; the computed answer SHALL reach nothing but the record.
- [x] 3.3 Record one line per value per pass: how many rows were compared, the worst disagreement in basis points of the exchange's own answer, and the contract it was on.
- [x] 3.4 Record that the desk could not compute a value, distinctly from computing one that disagreed.
- [x] 3.5 Keep amounts out: the deviation is a bounded whole number of basis points, and a comparison that would state a price or a size loses its line.
- [x] 3.6 Report it in the day's summary — per value, how many passes were compared, the worst disagreement and where, and how many passes could not be computed.
- [x] 3.7 Prove 3.1–3.6 by test, including that a pass the desk could not compute is recorded and does not read as agreement.
- [x] 3.8 Keep diagnostic calculation and record failures from changing the success or delivery of an accepted exchange account read.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `npm run check:circular`, `npm run check:runtime-mock`, `npm run check:command-path`.
- [ ] 4.2 Operator confirms nothing on screen changed: the same liquidation price, margins and free margin as before, from the same source.
- [ ] 4.3 Operator runs a session and reads `node scripts/read-desk-record.mjs`, confirming a comparison line appears for each of the five values.
- [ ] 4.4 Operator confirms the desk's weight and the number of reads are unchanged from the previous change — this one buys evidence, not weight.
- [ ] 4.5 Operator keeps the day's record files aside if the evidence window is to run longer than the fourteen days the record itself keeps.
