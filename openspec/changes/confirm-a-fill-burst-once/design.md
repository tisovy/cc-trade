# Design — confirm a fill burst once

## Code map

- `useFuturesTrading.js:85` `HISTORY_GAP_READ_DELAY_MS = 1_200`;
  `:1068–1084` `scheduleHistoryGapRead(report)`: per-symbol timer, no
  restart while one is pending; `:1376` called from the execution-update
  path for every report with a positive last-filled quantity.
- Backend: `handleFuturesHistory` (`binance-connection.js:6240`) for a
  `basisOnly` trades read walks every open position's contract not vouched
  by coverage; `scheduleFuturesHistoryTradeReacquisition` (`:7144`)
  continues an incomplete coverage every 5 s, 8 pages a round.
- Income: `armFuturesSettledConfirmation('fill')` (`:3379`) — «a burst is
  one read, two minutes after its newest event», `replace: true`. Already
  the operator's rule; untouched.

## Decisions

### D1. One trailing timer, restarted by every fill

`scheduleHistoryGapRead` keeps one timer and a set of the contracts the
burst touched. A fill adds its contract and restarts the timer at
`HISTORY_GAP_READ_DELAY_MS = 10_000`. On expiry one `account.history`
(`basisOnly`, trades) goes out per touched contract, exactly the command
shape the backend answers today. No restart ceiling — the operator's
ruling («филлы не идут целую минуту»).

Rejected: *a backend-side debounce* — the renderer is the one that sees the
fill first and already owns this timer; moving it would add a path.
*Folding the income confirm into the same timer* — it is already one read
per burst, and its two-minute wait exists because the exchange writes the
credit row late; reading it at ten seconds would miss the row and defer it
to the hourly audit.

## Residual

The continuation walker still runs after a read that found coverage
incomplete — 8 pages a round, a round every 5 s, until the window is
covered. It runs less often with fewer triggers; its own cadence is a
separate question.
