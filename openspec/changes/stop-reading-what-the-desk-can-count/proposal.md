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
