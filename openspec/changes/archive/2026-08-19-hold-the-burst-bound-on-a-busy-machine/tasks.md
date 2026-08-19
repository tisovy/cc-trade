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
  not what fixed the case.** What fixed the case is §2.2 — in the first six
  loaded runs the condition never fired, the cadence held every time.

  It has since fired, once, and the run is recorded in §3.2: cadence 71.604 to
  135.286 ms, `cadenceHeld: false`. Under the assertion this replaced
  (`expect(|interval − 100 ms|) ≤ 25` on every interval) that run would have
  failed on 135.286. It is now an inconclusive run that says so in its own
  metric line, and the suite stayed green — which is exactly the behaviour the
  requirement asks for, observed rather than argued.

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
- [x] 3.2 Run the full suite at least five times on a machine that is doing something else. No failure, and no pass that was really an inconclusive run in disguise.

  **Five loaded full-suite runs, 114 files and 2076 tests green in all five.**
  Twenty-four busy loops on 32 cores, 2026-08-16. Burst numbers:

  | run | executionApplyMs | cadence min–max | cadenceHeld |
  |---|---|---|---|
  | 1 | 417.343 | 96.768–101.802 | true |
  | 2 | 364.538 | 95.748–104.621 | true |
  | 3 | 532.969 | 96.186–104.898 | true |
  | 4 | 468.845 | 96.985–102.920 | true |
  | 5 | 439.671 | **71.604–135.286** | **false** |

  Four of the five enforced the bound, so they are not inconclusive runs in
  disguise. The fifth is an inconclusive run *and says so* — and it is the
  measured proof that the condition does something: 135.286 ms is outside the
  ±25 ms the old assertion demanded, so that run used to be a red suite. Its
  execution still landed at 439.671 ms against the 600 ms bound, which is the
  point — the machine missed the schedule, the desk did not.

  **Three other files failed under this load and were fixed with the operator's
  agreement**, though this change had named one file:

  | file | fails with | done |
  |---|---|---|
  | `src/App.futures-stress.test.jsx` | `Unable to find [data-testid="futures-production-workstation"]` | the same readiness wait, same 5 s, same reasoning |
  | `electron/services/futures-workstation-service.test.js` | `Test timed out in 5000ms` | given its own 30 s: it is the heaviest case in the file and takes 6–9 s idle, so vitest's default was never chosen for it |
  | `src/App.spot-order.test.jsx` | `expected [true, true] to deeply equal [true]` | the assertion counted React renders; it now states what the case is about |

  The third one was chased before it was changed, not silenced: instrumented
  with a separate mount counter and re-run **eleven times** under a loaded full
  suite, the extra render never returned, so whether it was a re-render or a
  second mounted copy is unknown and is recorded as unknown. What replaced the
  count says the hook ran enabled and never ran disabled; a second mounted copy
  — the hazard actually worth catching — is refused by the `findByTestId` and
  `getByTestId` queries above it either way.

### The observation this starts from

2026-08-16. Two timing tests failed in one full run and passed in the next and in
isolation: the burst case's execution bound, and
`holds a live session through a burst of full-width diffs and a heavy tape`. The
operator's desk was running from the same working tree at the time.

The calibration behind the bound — n=20, max 345.878 ms, bound 600 — was taken
with the case run alone. Re-running it under load (§0.1) found the bound was
never the part that failed.
