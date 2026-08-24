# Say the announced charge is still posting

## Why

On 2026-08-24 at 18:11:03 UTC (21:11:03 operator time) the desk raised the
popup "Wallet-adjustment refresh failed. Closed-position PnL keeps the
confirmed reading from 21:10:11. Press ↻ to retry." The operator had closed a
position 72 seconds earlier and had never seen the popup before.

Nothing failed. The journal's `settled` line at 18:11:03.264 shows the refresh
pass read six pages across six lanes, every HTTP request `ok, 200`, 77 rows
kept, `missing: 0, differing: 0` — and `outcome: "partial"`. The resource was
branded incomplete by design: the 18:09:51 close announced its charges on the
private socket, the desk recorded a confirmation debt
(`withFuturesSettledConfirmationDebt` pushes the lane's `targetTo` to the
event's durable bucket and marks it `stale` until the confirming pass at
+`FUTURES_SETTLED_CONFIRM_MS` = 2 minutes proves the income row exists), and
until that debt clears every pass is `partial` — which is the correct
accounting under *an announcement is not the record*: the exchange writes the
income row after the socket announces the charge.

The surface, added by `show-one-pnl-and-let-the-operator-size-the-dock` 1.7,
translates every non-`complete` refresh into "refresh failed … press ↻ to
retry". So the desk tells the operator a *failure* happened and asks them to
*retry*, when the truth is "the exchange has not yet written the charge it
announced; the confirming pass runs in under two minutes" — a wait that
retrying cannot shorten and that resolves itself. Every close and every
funding settlement will reproduce this popup, so left as is it trains the
operator to ignore the popup channel — the channel that also carries real
failures.

Two related journal facts pinned while diagnosing, recorded so the next reader
does not re-derive them: `verified` in the `settled` line is 1 only on hourly
`verification` passes by construction (`binance-connection.js:3310`), so
`verified: 0` on a refresh is not evidence of a broken verification leg; and
the 2026-08-23 chronic-partial ledger entry should be re-read in this light —
its passes may have been holding a genuine stuck debt, which is a different
fault from this change's mislabeling and stays with its owner.

## What Changes

- A settled pass whose requests all answered and whose only incompleteness is
  an outstanding confirmation debt is announced as what it is: the popup (or
  the surface's one line) states that a charge the exchange announced is
  being confirmed and when the confirming pass runs — it does not say
  "failed" and does not ask for ↻.
- "Failed" is reserved for a pass with `outcome: "failed"` or an unanswered
  request; the kept-reading stamp ("keeps the confirmed reading from …")
  appears only then.
- The `settled` journal line says which of the two states a `partial` was:
  outstanding-debt-only, or genuinely short of its target, so the ledger's
  chronic-partial question becomes answerable from one line.

## Non-goals

The confirmation-debt accounting itself — the two-minute horizon, the durable
bucket, branding the resource incomplete while a debt stands — is correct and
untouched. Whether a debt can get *stuck* (the 2026-08-23 all-day partials) is
the settled-income owner's open question, not this change's.
