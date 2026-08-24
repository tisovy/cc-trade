# Close the position the desk is showing

## Why

On 2026-08-24 at 18:09:41.958Z the operator pressed the market-close button on
their open VELVETUSDT long and the desk refused it in 1 ms:
`FUTURES_REDUCTION_NOT_CONFIRMED`, "The requested reduce-only order does not
match a current position leg and was not sent." The second press, ten seconds
later, sent and closed the position in 349 ms. The position itself was live,
unchanged, and on the operator's screen the whole time.

The journal names the cause. The guard `isConfirmedFuturesReduction`
(`electron/services/binance-connection.js:5525`) proves a reduce-only claim
against the positions resource and requires the resource to be *current*:
`status === 'ready'`, a successful read, and
`futuresPositionsActivationGeneration === futuresActivationGeneration`. At
18:09:37 the contract's book broke and recovered (`DEPTH_BAND_WALKED`, status
`loading` → `live` at 18:09:38.897); at 18:09:41.481 — 477 ms before the click
— a four-resource account refresh began re-stamping the readings. The click
landed inside that window: the positions reading was mid-re-stamp, the guard
called it "not current", and the refusal fired. The positions answer committed
at 18:09:42.117, 159 ms after the refusal.

Two defects, one episode:

1. **The desk refused to close a position it was itself displaying.** The
   operator's evidence was on screen from the desk's own reading; the guard
   discarded that same reading because it was seconds old and being
   re-confirmed. A reading old enough to draw the row is proof enough to close
   the leg it draws — and if the guard insists on a current reading, the
   command should wait the sub-second for the in-flight pass rather than
   refuse.
2. **The refusal names none of its five causes.** `isConfirmedFuturesReduction`
   returns one `false` for: no current reading, activation-generation
   mismatch, requested quantity exceeding the leg, leg mismatch, and side
   mismatch. The popup and the journal `outcome` line carry only the one code,
   so a transient re-stamp is indistinguishable from a genuinely wrong order
   — this diagnosis had to be assembled from surrounding journal lines.

**Operator ruling, 2026-08-24**: "даже если у нас идет пропуск книги — то нам
обязательно надо закрыть позицию — значит при первом появлении книги она
должна закрывать." Closing is never blocked by market-data state. A close
ordered while the desk's evidence is mid-re-stamp is held and fires at the
first proof, not bounced back to the operator for a retry; only a reading
that *disagrees* with the requested reduction — or a bounded wait that ends
with no reading at all — refuses, and then by name.

## What Changes

- A reduce-only order is confirmed against the newest *successful* positions
  reading even while that reading is being re-confirmed: an in-flight refresh
  or a bumped activation generation no longer voids the evidence. If no
  successful reading exists at all, the command waits (bounded, sub-second)
  for the in-flight pass instead of refusing, and only refuses when the
  reading itself disagrees with the requested reduction — or when the wait
  ends without any reading.
- The refusal names its cause: the rejection detail and the journal `outcome`
  line carry which condition failed (`NO_READING`, `STALE_READING`,
  `QUANTITY_EXCEEDS_LEG`, `LEG_MISMATCH`, `SIDE_MISMATCH`), so the next
  episode is diagnosable from its own line.

## Non-goals

The exposure-cap guard and the hedge-mode trust boundary the guard exists for
(a renderer `reduceOnly` flag is not proof) stay exactly as they are; what
changes is only which account evidence counts as proof and what the refusal
says.
