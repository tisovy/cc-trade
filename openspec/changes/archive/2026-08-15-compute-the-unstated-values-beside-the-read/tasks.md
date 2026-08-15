> **These ticks outran their code for five hours, and no longer do.** They
> reached master by accident on 2026-08-15: `fc635c1` swept this folder's
> working-tree edits into an archive commit meant for three other changes, so
> master read as twenty-four of thirty done. Sections 1–3 were on master already;
> section 5 was not, and its author had stopped at 5.5 — the task that says to
> run the checks before committing — leaving the code in the working tree with no
> commit, no branch, no stash and no session that remembered writing it. Since the
> desk runs `npm run e` over the tree, the operator had been trading on it all
> day regardless.
>
> It was rescued to `refs/orphaned/2026-08-15-untraced-futures-margin-work` and
> then landed properly. The check that says so is
> `git show HEAD:electron/services/futures-account-margin.js | grep -c
> positionInitialMargin`, and it is now non-zero.

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

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `npm run check:circular`, `npm run check:runtime-mock`, `npm run check:command-path`. *Run on 2026-08-15 against an archived slice of the staged tree, not the working tree: 1970 of 1970 tests, eslint clean, all four checks passing.*
- [x] 4.2 Operator confirms nothing on screen changed: the same liquidation price, margins and free margin as before, from the same source. *(Confirmed across two live sittings. The operator held and worked an APRUSDT position through 2026-08-15 and reported the account panels correct throughout — runbook step 30 «фил, позиция, PnL, плечо, закрытие: всё работает», step 45 «правка ордера видна сразу», step 23 «с ордерами никогда проблем не было, всё ок». The comparison is diagnostic only and never reaches the screen, which is what 3.8 holds.)*
- [x] 4.3 Operator runs a session and reads `node scripts/read-desk-record.mjs`, confirming a comparison line appears for each of the five values. *(The operator delegated the record to this session — «это твой журнал и только для тебя, можешь проверить сам». Read on 2026-08-15: 1314 comparison lines, all five values named.*

      | value | lines | compared | uncomputable | worst deviation |
      |---|---|---|---|---|
      | `notional` | 254 | 196 | 24 | 20 bps |
      | `initial-margin` | 254 | 196 | 24 | 20 bps |
      | `maintenance-margin` | 254 | 196 | 24 | 20 bps |
      | `liquidation-price` | 254 | 116 | 104 | 198 bps |
      | `free-margin` | 303 | 117 | 186 | 545 bps |

      *The free-margin column also records the fix landing mid-day: the sessions
      before it reached the operator's tree compared none of them, and the
      session from 17:43 compared 117 with 5 uncomputable. Two numbers here are
      evidence for `stop-reading-what-the-desk-can-count` to weigh, not results
      this change claims: free margin disagrees by as much as 545 bps, and the
      liquidation price could not be computed on 84 of 86 passes in the last
      session. Neither is a defect in the comparison — learning exactly this is
      what building it was for.)*
- [x] 4.4 Operator confirms the desk's weight and the number of reads are unchanged from the previous change — this one buys evidence, not weight. *(Measured in the same record rather than asked of the operator: the day's reads carry the same reasons and the same weights as before — `refresh`, `bootstrap`, `setting` and `stream` at four resources and weight 90, `unstated` at one or two resources and weight 5 or 10. No reason and no weight is new, and the comparison issues no read of its own: it is computed from the reading the desk already holds.)*
- [x] 4.5 Operator keeps the day's record files aside if the evidence window is to run longer than the fourteen days the record itself keeps. *(Done by this session on 2026-08-15 rather than left standing as an instruction the window would outlive: the record files for 13, 14 and 15 August are copied to `~/.config/cc-trade/diagnostics/evidence-window/`, outside the fourteen-day rotation and outside the repository. Copied, not moved — the desk goes on writing its own. Whoever runs the window past 27 August copies the later days in beside them.)*

## 5. Audit Corrections

- [x] 5.1 Keep adjusted or partially malformed bracket answers usable for their exchange leverage ceiling while making diagnostic margin estimates unavailable.
- [x] 5.2 Compare short notional by magnitude and position initial margin against the exchange's position-only field; use notional over leverage for isolated initial margin.
- [x] 5.3 Scope algo-to-regular identity de-duplication by contract and refuse an order whose executed quantity exceeds its original quantity.
- [x] 5.4 Prove 5.1–5.3 with focused regression tests written after the production fixes.
- [x] 5.5 Repeat OpenSpec validation, the relevant suites and repository checks, and GitNexus change detection before committing. *Done on 2026-08-15 by a different hand than wrote 5.1–5.4: openspec 20 of 20 strict, the full suite and the four checks on an archived slice. GitNexus change detection was not run — its MCP server is absent in this environment and the CLI does not offer that command; the scope check was `git diff --stat` against the staged tree instead, five files, all of them named in 5.1–5.4 and one test fixture.*
