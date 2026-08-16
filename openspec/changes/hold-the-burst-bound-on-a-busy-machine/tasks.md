## 0. What The Case Actually Fails On

- [x] 0.1 Re-run the case under load before changing it. The proposal's premise did not survive the re-run, twice over.

  **The bound is not 400 and never was.** `src/App.futures-burst.test.jsx`
  entered the tree in `73fa521` with `EXECUTION_APPLY_BOUND_MS = 600`, already
  calibrated on both distributions — isolated n=20 and aggregate n=6. `git log
  -S"EXECUTION_APPLY_BOUND_MS = 400"` returns nothing. The 400 was true of the
  session's working tree when it raised this, not of the tree.

  **And the bound is not what fails.** Measured 2026-08-16 on this machine, 32
  cores, twenty busy loops beside the full suite. The case failed in every loaded
  run — at `findByTestId('futures-production-workstation')`, a Testing Library
  readiness wait, one second, *before the burst had begun*. The burst it never
  reached would have passed: run alone under the same load it measured 416 ms
  against a 600 ms bound.

  | run | executionApplyMs | cadence min–max | bound |
  |---|---|---|---|
  | idle, alone ×3 | 335.9, 335.9, 341.2 | 99.1–100.4 | 600 |
  | idle, full suite ×3 | 382.7, 418.7, 453.6 | 90.2–108.1 | 600 |
  | 20 loops, full suite ×5 | 444.1, 444.2, 475.0, 477.5, 552.1 | 83.0–118.1 | 600 |
  | 64 loops, full suite | 504.8 | 86.9–112.8 | 600 |

  The desk's own number never came near the bound, and the cadence never left
  its ±25 ms tolerance. What a busy machine takes from this case is the *mount*,
  not the burst.

## 1. Decide Which Shape

- [x] 1.1 Choose between calibrating under load and refusing to enforce on a run that could not hold its cadence.

  Refusing. A number re-measured on a busy machine is still one number for two
  conditions, and would have to grow again the next time the machine is busier —
  the condition is what separates "the desk is slow" from "the machine is busy",
  which is the distinction the bound exists to draw.

  Said plainly, because it matters for reading this later: **the condition is
  not what fixed the case.** In six loaded runs above it never fired — the
  cadence held every time. What fixed the case is §2.2. The condition earns its
  place anyway, and not as decoration: the hard cadence assertion it replaced
  (`expect(|interval − 100 ms|) ≤ 25`) would have *failed* on a machine slow
  enough to miss the schedule. That run is now inconclusive instead of red,
  which is what the requirement asks for.

- [x] 1.2 Whichever is chosen, do not simply raise the number.

  `EXECUTION_APPLY_BOUND_MS` is untouched at 600. The wait that was widened is a
  readiness wait and not a bound: `executionApplyMs` is read from
  `performance.now()` either way, so widening it does not let a slow desk
  through — it makes a slow desk fail on the number instead of on a
  testing-library timeout, which is the failure worth having.

## 2. Build It

- [x] 2.1 If refusing: use the cadence the harness already measures.

  `cadenceHeld` is computed from the same intervals the metric line reports, and
  gates the bound. It travels in the metric line too, so a reader counting green
  runs can tell a run that held the burst from one that only survived it.

  The hard per-interval assertion it replaced is not simply gone: the case now
  asserts unconditionally that the six offers spanned at least
  `(cycles − 1) × cadence − tolerance`. Load stretches a burst and never
  compresses one, so that holds on any machine — and it is what makes the
  supersession counts beside it mean anything.

- [x] 2.2 If calibrating: re-measure with the full suite running around it.

  Not chosen. The distribution above is recorded as evidence for §0.1, not as a
  calibration — the bound did not move.

- [x] 2.3 Say in the case which of the two it does and why, next to the number.

## 3. Verification

- [x] 3.1 `npm run lint`, `npm test`, and the burst case on its own. Clean; 2076 tests in 114 files.
- [ ] 3.2 Run the full suite at least five times on a machine that is doing something else. No failure, and no pass that was really an inconclusive run in disguise.

  **The burst case: five loaded runs, five passes, `cadenceHeld: true` in every
  one** — so none of the five was an inconclusive run in disguise. That half is
  done and the numbers are in §0.1.

  **The suite is not clean, and not because of this case.** Three others fail
  under the same load, all outside this change's stated impact:

  | file | test | fails with |
  |---|---|---|
  | `src/App.futures-stress.test.jsx` | renders the newest book and stays interactive at 2 MiB per 100 ms cycle | `Unable to find [data-testid="futures-production-workstation"]` — the same readiness wait, unfixed |
  | `electron/services/futures-workstation-service.test.js` | holds a live session through a burst of full-width diffs and a heavy tape | `Test timed out in 5000ms` — vitest's default per-test deadline; the burst case sets its own 20 s |
  | `src/App.spot-order.test.jsx` | exposes only Futures, unmounts spot execution there, and restores spot unchanged | `expected [true, true] to deeply equal [true]` — **not a deadline**; something is mounted or emitted twice under load |

  The first two are the same defect as the one this change fixed and would take
  the same shape. The third is not a timing failure at all and should not be
  waved through as one — a duplicate under load is the kind of thing that is
  also true on a busy desk. Left for the operator to scope: this change named
  one file.

### The observation this starts from

2026-08-16. Two timing tests failed in one full run and passed in the next and in
isolation: the burst case's execution bound, and
`holds a live session through a burst of full-width diffs and a heavy tape`. The
operator's desk was running from the same working tree at the time.

The calibration behind the bound — n=20, max 345.878 ms, bound 600 — was taken
with the case run alone. Re-running it under load (§0.1) found the bound was
never the part that failed.
