## Why

The burst case added by `time-the-frame-from-exchange-to-screen` asserts that a
terminal execution is applied within **400 ms**, a bound set from a measured run:
n=20, min 329.271 ms, p50 334.338, p90 338.717, p99 345.136, max 345.878.

That calibration was taken with the case run on its own. In the full suite, on
2026-08-16, it failed — together with
`holds a live session through a burst of full-width diffs and a heavy tape` —
and both passed on the very next full run and in isolation. The machine was busy:
the operator's desk was running from the same working tree at the time.

So the bound is sound and the calibration is honest; what is missing is that
neither was taken under the condition the suite actually runs it in. 54 ms of
headroom over a measured maximum is comfortable on an idle machine and is not on
a loaded one — and a test that fails when the machine is busy will be re-run
until it passes, which is the habit that makes a real regression invisible.

## What Changes

Nothing about the desk. One of:

- **Calibrate under load.** Re-measure with the full suite running around it and
  set the bound from that distribution instead, so the number matches the
  condition it is enforced in.
- **Or state the condition.** Keep the bound and have the case refuse to enforce
  it when the machine cannot hold the cadence it needs — the harness already
  measures its own cadence (`cadenceMinMs`, `cadenceMaxMs`) and can tell a slow
  run from a slow desk. A run that could not keep its own 100 ms cadence is not
  evidence about the desk either way, and should say so rather than fail.

The second is the better shape and the first is the cheaper one. Either ends the
re-run habit; doing nothing does not.

## What this is not

Not a claim that the desk is slower than measured. Both failures were of timing
tests on a loaded machine, and the numbers on an unloaded one are unchanged.

## Impact

- `src/App.futures-burst.test.jsx` — the bound, or the condition it is enforced
  under.
- Adds a requirement to `project-verification`.
- Raised by the session that built §1 and §3 of the same change, from two
  observed failures rather than from review.
