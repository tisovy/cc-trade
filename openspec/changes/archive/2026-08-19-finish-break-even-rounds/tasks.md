## 0. Pre-implementation gate

- [x] 0.1 Run strict OpenSpec validation for `finish-break-even-rounds` before changing production code. Passed on 2026-08-18 with no production edit present.

## 1. Production implementation

- [x] 1.1 Run upstream GitNexus impact analysis for every existing trade-round symbol that will be edited and report direct callers, affected processes and risk before changing code.
- [x] 1.2 Mark only unresolved zero-PnL window-edge openings as ambiguous, compare the first reducing fill's reported PnL with the tentative held-position prediction, and clear the marker on consistent evidence or a real boundary.
- [x] 1.3 On disproval, reclassify the tentative entries in place as exits, apply the opposite fill as an addition on the real side, and track deterministic add/reclose phases without replaying fills or fees.
- [x] 1.4 Finish the reconstructed round with aggregate entry recovered from total exits and reported PnL, preserving complete closed size, fill count, fees and PnL.

## 2. Proof after implementation

- [x] 2.1 Add the exact long regression (`SELL 4 @ 100 / 0`, `BUY 2 @ 90 / 0`, `SELL 8 @ 120 / 190`) and its short mirror, asserting one real closed round, complete size/fees/PnL and no invented opposite round.
- [x] 2.2 Add guards for a genuine in-window open, a PnL-consistent reversal, position-leg boundaries and the pre-existing same-side break-even close.
- [x] 2.3 Run the focused trade-round/history tests, `npm run lint` and `npm run check:futures-production`.

Out-of-scope observation: the existing history-panel day-label test assumes a
`dd.mm` host locale, while this environment renders the same label as `07/14`.
The assertion is unrelated to round folding and was not changed here.

## 3. Change completion

- [x] 3.1 Run `git diff --check` and strict OpenSpec validation for `finish-break-even-rounds` after implementation.
- [x] 3.2 Stage only this change's files and implementation, then run GitNexus `detect_changes` on staged scope and confirm the affected symbols/flows are expected.
- [x] 3.3 Commit the completed change directly to `main` without archiving it.
