## Withdrawn on 2026-08-16, on the record's own numbers

The bar below was set before the evidence existed, so that this moment could not
be argued. The evidence is in, and **it does not clear the bar. This change is
withdrawn under its own task 2.2. The `unstated` read stays.**

Read with `node scripts/read-desk-record.mjs` over the only two days that can
count — 2026-08-15 and 2026-08-16. Every earlier day is disqualified by the note
in `tasks.md` §1: free margin was unavailable by construction, so nothing before
2026-08-15 measures anything.

| value | compared passes | agreed exactly | passes over bar | median | worst | bar |
| --- | --- | --- | --- | --- | --- | --- |
| notional | 875 | 858 | 5 | 0 bps | 24 bps | 5 bps |
| initial margin | 875 | 858 | 5 | 0 bps | 24 bps | 5 bps |
| maintenance margin | 875 | 857 | 6 | 0 bps | 25 bps | 5 bps |
| **liquidation price** | **489** | **139** | **336** | **167 bps** | **198 bps** | **10 bps** |
| free margin | 1195 | 1171 | 24 | 0 bps | 545 bps | 10 bps |

All five miss. Four of them miss narrowly and in the tail; the liquidation price
misses in the middle of its own distribution.

**The liquidation price is the one that ends it.** 336 of its 489 compared
passes — 69% — are over the bar, and the *median* pass is 167 bps against a bar
of 10. This is not a tail to be gathered away. Its deviations are discrete and
they hold: 0, 35, 37, 64, 79, 167, 174, 198 bps, each value sitting still for the
whole life of a position and taking a new one on the next. A mark drifting
between reads would spread continuously; a step that holds is a wrong input.

**Why waiting out the remaining eight days cannot rescue it, and why 2.3 does not
apply.** 2.3 says to keep gathering when the coverage is short rather than the
agreement. The coverage *is* short — two days of the ten, and the four coverage
cases below were never confirmed. But the agreement is what missed, and it missed
on 489 compared liquidation passes against a coverage bar of 200: there is
already more than enough compared evidence to judge this value. And the bar reads
"worst disagreement ≤ 10 bp, **and no pass at all above it**". Worst is monotonic
in the window — eight more days can only add passes, never withdraw the 336
already recorded above the bar. The bar is unclearable from here, so gathering
longer would buy nothing but two more weeks.

**Free margin, in fairness, arrived.** The structural fault the §1 notes chased is
gone: on 2026-08-16 it computed on 743 of 743 compared passes and agreed on every
one of them, worst 0 bps. Its 545 bps worst is a single four-minute episode on
2026-08-15 between 17:45 and 17:49. It still fails "zero passes the desk could
not compute" — 244 wholly-uncomputed passes across the two days — but it is the
one value whose arithmetic is not in question.

**Likely cause, bounded by what was actually measured rather than guessed.** The
formula at `electron/services/futures-account-margin.js:158` matches Binance's
documented cross-margin liquidation formula term for term, so the fault is in an
input, not in the shape. Two candidate causes were tested against the record and
**refuted**:

- *coupling between several cross positions* — it disagrees just as readily with a
  single position held (243 of 381 single-position passes disagree);
- *an artefact of comparing against a cheap partial read* — 320 of the 325
  disagreements follow a full four-resource, weight-90 `refresh`, not a weight-10
  `unstated`.

What remains, untested here: the leverage bracket's rate or maintenance amount,
the cross wallet figure, or the margin mode read for the contract. Diagnosing
which belongs to `compute-the-unstated-values-beside-the-read`, which owns the
arithmetic — not to this change, which only ever existed to decide whether to
trust it.

**What this leaves standing.** The `unstated` read stays, and so does the
comparison that produced these numbers: the arithmetic is still worth recording
beside the exchange, because the day it agrees is the day this decision is worth
retaking. The spec delta under `specs/futures-live-readiness/` does not land.

*Not decided by the operator. The reading above was done by the session on the
operator's journal; §1.3's own confirmation, and the coverage cases in §1.4, are
still the operator's to state.*

## Why

This change is a decision, and it is deliberately written before the evidence
exists so that the bar is set before anyone is invested in clearing it.

`compute-the-unstated-values-beside-the-read` puts the desk's own arithmetic for
the liquidation price, the position margins and the free margin on trial beside
the exchange's answer, and records the distance between them. When the window
below has run, one of two things happens:

- the desk's answers held — and this change lands: the computed values become
  what the desk shows, and the account is read only for the reasons the operator
  named at the start, *a break, a failure, or something the desk did not expect*
- they did not hold — and this change is withdrawn, with the record's own numbers
  written into it as the reason, so the next person to have the idea starts from
  the measurement rather than from the hope

Concretely, this is the change that deletes the read reason `unstated`. After it
the desk reads the signed account on `bootstrap`, on `stream` (a socket opened or
reopened), on `unresolved` (a command whose outcome the desk does not know), on
`command` (an exchange refusal it did not expect), on `setting` (leverage or
margin mode changed under it), on `refresh` (the operator asked) — and on a slow
beat that catches a frame that never arrived. Nothing else.

## The bar

Read from `node scripts/read-desk-record.mjs` over the window. All of it, not
most of it:

**Coverage** — the window SHALL contain, for each of the five values:

- at least **10 trading days** with the desk running, and at least **200
  compared passes**
- at least one position in **cross** margin and one in **isolated**
- at least one position whose notional is **past the first bracket**
- at least one **hedge-mode pair** on one contract, if the account trades that way
- at least one **funding payment**, one **partial fill**, one **leverage change**
  and one **manual margin adjustment**

**Agreement** — over that window:

- **liquidation price**: worst disagreement ≤ **10 bp**, and no pass at all above
  it. This is the value a wrong answer costs the most, and the median is not what
  gets anyone liquidated
- **maintenance margin, initial margin, notional**: worst ≤ **5 bp**
- **free margin**: worst ≤ **10 bp** of the wallet
- **zero passes the desk could not compute**, other than those in the first
  seconds after a contract is first held

The record keeps fourteen days. A window longer than that needs the day's files
copied aside first — task 1.2.

## What lands if the bar is cleared

- **The computed values are what the desk shows.** The liquidation line, the
  margins and the free margin come from the desk's own arithmetic, updated with
  the mark price rather than with a read — so they move continuously instead of
  in steps at whatever moment a read answered.
- **The `unstated` read is gone.** A fold no longer schedules anything. Placing,
  amending or cancelling an order no longer reads the balances: the margin it
  locks is computed from the order itself.
- **A slow beat replaces it.** While the account holds a position or a working
  order the desk reads once every few minutes, not to draw the screen but to
  catch what it may have missed — a frame lost to a socket that never reported
  it broken, a fee the desk does not model. The beat keeps recording the
  comparison, so the arithmetic stays on trial for as long as it is used.
- **A disagreement on the beat is stated, not swallowed.** If a beat's read
  disagrees with the desk's own answer by more than the bar allows, the read
  wins the screen and the desk says so — that is precisely the operator's
  "something we did not expect".

## What this buys

Per fill, in steady running: one coalesced pass of two signed requests
(weight 10) and, per order placed or cancelled, one more (weight 5) — gone. The
screen stops waiting on a 340–800 ms round trip for numbers it can have at the
speed of the mark feed. On a contract busy enough to fill an order every few
seconds, the desk stops queueing reads behind reads.

## What it costs, honestly

- The desk becomes responsible for arithmetic Binance may change without telling
  anyone. The slow beat and the recorded comparison are what make that
  survivable rather than silent — but the day Binance changes a formula, the
  desk is wrong until a beat catches it.
- A liquidation line that moves continuously reads as more precise than it is. It
  is an estimate between beats, and the screen has to say so.

## Capabilities

### Modified Capabilities

- `futures-live-readiness`: what the desk computes is what it shows, and the
  account is read only when the stream cannot be trusted.

## Impact

- `electron/services/binance-connection.js` — the `unstated` read and its
  coalescing removed, the slow beat added, the computed values published.
- `electron/services/futures-account-state.js` — the read reason vocabulary
  loses `unstated`.
- `src/hooks/useFuturesTrading.js` — the reconciliation beat's interval and the
  condition it fires under.
- `src/utils/futuresOrderPresentation.js` and the position views — the values now
  arriving continuously, and how the screen says they are the desk's own.
