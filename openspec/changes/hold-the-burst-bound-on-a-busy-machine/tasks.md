## 1. Decide Which Shape

- [ ] 1.1 Choose between calibrating under load and refusing to enforce on a run that could not hold its cadence. The second is the better shape — it separates "the desk is slow" from "the machine is busy", which is the distinction the bound exists to make — and the first is cheaper.
- [ ] 1.2 Whichever is chosen, do not simply raise the number. A bound loosened until it stops failing measures nothing, and the case was written precisely so that a regression could not hide behind a busy afternoon.

## 2. Build It

- [ ] 2.1 If refusing: use the cadence the harness already measures. It reports `cadenceMinMs` and `cadenceMaxMs` beside the result, so a run that missed its own 100 ms schedule can be told from one that held it.
- [ ] 2.2 If calibrating: re-measure with the full suite running around it, n≥20, and record the distribution the way the original calibration was recorded — min, p50, p90, p99, max — rather than a single number.
- [ ] 2.3 Say in the case which of the two it does and why, next to the number.

## 3. Verification

- [ ] 3.1 `npm run lint`, `npm test`, and the burst case on its own.
- [ ] 3.2 Run the full suite at least five times on a machine that is doing something else — the operator's desk running from the same tree is the condition that produced this. No failure, and no pass that was really an inconclusive run in disguise.

### The observation this starts from

2026-08-16. Two timing tests failed in one full run and passed in the next and in
isolation: the burst case's 400 ms execution bound, and
`holds a live session through a burst of full-width diffs and a heavy tape`. The
operator's desk was running from the same working tree at the time.

The calibration behind the bound — n=20, max 345.878 ms, bound 400 — was taken
with the case run alone. 54 ms of headroom is comfortable on an idle machine and
is not on a loaded one.
