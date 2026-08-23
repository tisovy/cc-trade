## Why

On 2026-08-23 the operator toggled the margin mode of a flat contract five times
from the ticket. The exchange answered every `POST /fapi/v1/marginType` in about
340 ms. The desk answered the operator in 1 823 ms once and then in 56 752,
52 132, 48 044 and 45 202 ms — three of the five presses happened only because
the chip had not moved, and the last two were refused by the exchange with
`-4046 NO_NEED_TO_CHANGE_MARGIN_TYPE` because by then the account already held
the requested mode. The journal carries the whole chain
(`~/.config/cc-trade/diagnostics/desk-2026-08-23-000.jsonl`, 08:26:56–08:28:00Z).

Three waits stack inside one answer, and only the first belongs there:

1. **The answer contains a consequence read.** `handleFuturesSetMarginType` and
   `handleFuturesSetLeverage` await a full `refreshFuturesAccountState({ reason:
   'setting' })` — four resources, 90 weight — before emitting the command's
   answer. The mode was settled two round trips earlier: the POST, then the
   configuration re-read whose broadcast is what actually moves the chip.
   `trading-command-integrity` already states the rule for spot: *a command does
   not wait on a read the operator is not waiting for*. These two futures
   commands predate that change and were never brought under it.

2. **The registry serializes mutating commands per contract.** That is correct —
   but it means whatever one command's answer waits on, the operator's next
   command on that contract waits on too. Toggles three to five never reached
   the rate limiter for 50 seconds; their POSTs, weight 1 each, would have fit
   the remaining budget the whole time.

3. **The desk's budget remembers what the exchange has forgotten.** Minute
   08:26 carried a ~700-weight book bootstrap. `reconcilePhysicalResponse`
   replaces the local window with one baseline entry stamped `now`, so that
   spend was carried until 08:27:56 — while the exchange's own counter reset at
   the minute boundary (`observedWeight` 704 at 08:26:57.999, **1** at
   08:27:00.532). The account pass's last weight-5 read therefore slept 55 093
   ms (`kind: "deferred"`, `spent: 796, ceiling: 800`) for room the exchange
   had already given back. The 2026-08-22 queue fix held — the sleeper held no
   slot and other limiter work flowed — but the command lane above the limiter
   stood still, waiting for it through the answer of toggle two.

A fourth, smaller cost rides along: the configuration re-read after a mode
change asks for the leverage bracket table again (`withCeiling: true`), one more
serial round trip for a ceiling the margin mode cannot move, and the held entry
already keeps a read ceiling through a bracket-less re-read.

## What Changes

- Emit the answer to `trade.setMarginType` and `trade.setLeverage` when the
  exchange has answered and the configuration re-read has been broadcast — the
  surface the operator is actually watching. Run the account pass behind it
  detached, on the existing pattern (`void refreshFuturesAccountState(...)
  .catch(reportDetachedFuturesAccountRefreshFailure)`) so it still happens, its
  failure is still recorded, and the per-contract command lane is released in
  round-trip time rather than in budget time.
- Stop re-reading the leverage bracket table on a margin-mode change: the
  ceiling is not a function of the mode, and the held configuration already
  carries it forward when a re-read answers without one.
- Expire the exchange-observed weight baseline with the exchange's own minute
  rather than a full rolling window from the moment of observation, so the desk
  does not defer against spend the exchange has already forgotten. The journal
  proves the counter's reset; the change must keep the conservative direction —
  a baseline may only be shortened toward what the exchange itself reports,
  never below locally booked, unanswered work.
- State in the record what the answer now measures — the exchange round trip
  and the configuration re-read, on both configuration commands — so `answer`
  durations stay comparable within one market.

Out of scope, named so it is not lost: an in-flight indication on the mode chip.
With the answer back to round-trip time the stale-chip window shrinks from a
minute to about a second, and the chip's contract — show what the exchange last
reported, never what was asked for — is one this desk has already verified live.
If repeat presses still occur at the shorter window, that is a presentation
change, not a transport one.

## Scope

The margin-mode and leverage command handlers, the `RateLimiter`'s observed
baseline accounting, and the diagnostic record's description of the `answer`
line for these two commands. Order placement, cancellation, amendment and the
unresolved-outcome reconciliations keep their waits: after an unknown outcome is
resolved the screen is wrong until the re-read answers, and that wait is the
stated exception in `trading-command-integrity`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trading-command-integrity`: extend "a command does not wait on a read the
  operator is not waiting for" from spot to the futures configuration commands,
  with the same carve-out for reads the screen is wrong without.
- `futures-live-readiness`: the desk's own read budget may not hold spend the
  exchange has already released; the deferred record stays, and states the
  budget's reading at the moment it held the request.

## Impact

Affected areas: `handleFuturesSetMarginType`, `handleFuturesSetLeverage`,
`readFuturesSymbolConfig` call sites (`withCeiling` on the mode path),
`RateLimiter.reconcilePhysicalResponse` / `reservationWait`, their tests, and
the record's field documentation.

Coordination: `binance-connection.js` is carrying uncommitted, in-flight work
from another session (resource-scoped account refreshes with readiness
receipts, `futuresAccountRefreshIsReady`). This change touches the same file
and should be implemented on top of that work, not beside it — the scoped
refresh is the natural vehicle if a partial await (`positions`, `balances`)
is chosen over a detached pass anywhere.
