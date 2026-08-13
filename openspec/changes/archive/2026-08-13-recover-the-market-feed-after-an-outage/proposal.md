## Why

The market data gives up permanently after about a minute and a half without a
route, and never tries again. The desk stays open, stays tradeable, and stops
showing the market.

Measured live on 2026-08-13 by the operator, during
`verify-the-desk-in-one-sitting`, by stopping the SOCKS proxy the desk reaches
Binance through:

| outage | account leg | chart, book, tape |
|---|---|---|
| 1–2 minutes | back in ~8 s | back in ~40 s |
| longer than that | back in ~8 s | **never** |

In the second case the operator waited, then reloaded the window with Ctrl+R,
and everything returned at once. Nothing was wrong with the desk or with the
exchange by then — only with what the desk had decided in the meantime.

**Where the minute and a half comes from.** `scheduleResync` backs off as
`min(RECONNECT_MAX_MS, RECONNECT_BASE_MS × 2^attempt)` with `RECONNECT_BASE_MS:
500`, `RECONNECT_MAX_MS: 30_000` and `RECONNECT_ATTEMPTS: 8`
(`electron/services/futures-production-workstation-service.js:38-52`,
`:1397-1445`). The eight waits are 0.5, 1, 2, 4, 8, 16, 30 and 30 seconds —
91.5 seconds of waiting, plus whatever each failed attempt spends before it
fails. On the ninth, `scheduleResync` emits `RECONNECT_EXHAUSTED` and calls
`haltSession`, which sets `this.current = null` and clears every timer
(`:1447-1470`). There is no path in the service that can revive it. A proxy
restart, a VPN renegotiation, a laptop resuming from sleep and a lunch break are
all longer than 91.5 seconds.

**The ceiling is not wrong; halting at it is.** A ceiling on the *fast* ladder
is right — hammering a dead route twice a second helps nobody. But the ladder
running out is not evidence that the route is gone for good. It is evidence
that it has been gone for ninety seconds, which is the ordinary length of a
network interruption, not an unusual one.

**The account leg does not do this.** Its close handler reschedules on a flat
five-second timer with no attempt ceiling at all
(`electron/services/binance-connection.js:1723-1739`). That asymmetry is exactly
what the operator measured: after the long outage the account came back on its
own and the market did not, so the desk ended up holding a live position, a live
wallet and a live uPnL against a chart, a book and a tape that had stopped.
Everything on screen that could reassure the operator the desk was working was
working.

**And the way back is not where the loss is.** The only Retry in the workspace
sits in the contract sidebar, keyed on `state.status === 'unavailable'`
(`src/components/features/futures/FuturesWorkstationView.jsx:255`, `:936-941`),
and reads "Contracts stream stopped after repeated reconnect failures."
(`:297-298`). What the operator is looking at is a dead chart, a dead book and a
dead tape; what the desk offers is a sentence about contracts, in another panel.
The operator did not press it. They reloaded the application instead, which is
the one action that cannot be wrong and also throws away every other session on
the desk.

The candle leg already behaves better and shows the shape of the answer: when
its own ladder runs out it emits `INTERVAL_RECONNECT_EXHAUSTED` and leaves the
session live (`:1365-1374`) rather than halting it.

## What Changes

- The market session keeps trying after the fast ladder is spent, on a slow
  steady beat, for as long as the contract is wanted. Running out of fast
  attempts stops the hurry, not the recovery.
- While the feed is not carrying, the workspace says so where the loss is — on
  the chart, book and tape that stopped — and says when it will try again.
- The manual retry is reachable from that statement, so the operator is not
  asked to find it in the contract list or to reload the window.

## Non-goals

- Not the private account stream. `prove-the-private-stream-is-carrying` owns
  that leg, including its start paths in `binance-connection.js`. This change
  does not touch that file.
- Not the quiet-market bootstrap. `bootstrap-the-book-on-a-quiet-market` owns
  the path by which a thin contract reaches `RECONNECT_EXHAUSTED` with the
  network perfectly healthy. That change removes a *cause*; this one changes
  what happens once any cause has exhausted the ladder. They meet at
  `scheduleResync` and should land in either order without conflict.
- Not the trading gate. The desk let the operator send an order while the chart
  was dead, and the ticket said `UNAVAILABLE chart — age unknown` when it did.
  That is `say-which-readings-are-stale` (archived) and
  `let-the-desk-act-on-a-stale-chart` working as designed, not a fault to fix
  here.
- No change to what the ladder does before it is exhausted, and no change to
  the four freshness bounds.
- **Not a taxonomy of hopeless causes.** It would be better to stop retrying a
  cause that another attempt cannot change, but this service has no such
  taxonomy: every reason code reaching `scheduleResync` is either a transport
  fault or `safeCode(error)`, a free-form passthrough of whatever the error
  carried (`:106-110`). Inventing a list of terminal codes to satisfy that
  intention would be a guess, and the guess fails in the dangerous direction —
  a mislabelled code stops the desk forever again. Retrying a genuinely
  hopeless route costs one attempt every thirty seconds.

## Impact

- `electron/services/futures-production-workstation-service.js` —
  `scheduleResync`, `haltSession`, and one added constant. Hot file, shared
  with `bootstrap-the-book-on-a-quiet-market`, `send-only-the-book-on-screen`
  and `prove-the-book-covers-both-sides`.
- `src/components/features/futures/FuturesWorkstationView.jsx` — where the
  stopped feed is stated and where its retry lives.
- `src/hooks/useFuturesProductionWorkstation.js` — the existing `retry` becomes
  reachable from the second place.
- Adds two requirements to `futures-workstation-presentation`.
- Operator-visible: an outage longer than ninety seconds no longer costs a
  window reload.
