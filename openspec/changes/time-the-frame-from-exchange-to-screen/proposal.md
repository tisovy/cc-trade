## Why

The audit that produced this batch of changes could prove exactly one of the
operator's two complaints.

The algorithmic-order delay was provable from the architecture alone: the desk
polls, the interval is thirty seconds, the observed ten to fifteen is the
remainder. No measurement was needed and none would have added anything.

The other complaint — the price line crawling on a spike, orders staying on the
chart after the market went through them, the book arriving lopsided — could only
be reasoned about. The desk records that a book recovery happened
(`onInternalError`, phase `book-recovery`) and how long the aggregate bootstrap
took (`emitAggregateTiming`, phase `aggregate-ready`), and nothing else about
time. There is no mark on a frame as it passes through the desk, no count of what
is queued, and no count of what was dropped. So the audit could say the frames
are expensive, and could measure the cost of each stage in isolation on a bench,
but could not say where a particular late frame actually spent its time — in the
Node loop, in the local socket, or in a React commit.

Every other change in this batch claims a latency improvement. None of them can
be shown to have delivered one, and a regression in any of them would look
exactly like a busy market. The operator would be back to describing the symptom
in seconds, and we would be back to reasoning about it.

A stress case is missing for the same reason. The focused suites pass — the audit
ran them — but nothing in them delivers a hundred and eighteen kilobytes of depth
ten times a second alongside candles and a terminal execution, which is the
condition every one of these defects appears under and none of them appear
without.

## What Changes

- A market-data or account frame carries the marks it passes: the exchange's own
  event time, when the main process received it, when it was queued for the
  renderer, when the renderer received it, and when the desk committed it to
  screen. The desk can state, for a frame the operator says was late, which of
  those steps it waited in.
- The outbound queue states its depth and what it superseded, per resource, so a
  backlog is a reading rather than an inference.
- The desk records these as diagnostic events on the record it already keeps,
  under the bounds that record already enforces, and never at the cost of a
  market or trading path.
- A burst case exercises the desk at the exchange's full cadence — a full depth
  frame every hundred milliseconds, candles alongside it, and a terminal
  execution during the burst — and asserts a stated bound on how late the
  execution may be applied.

## Non-goals

- No new browser or Electron automation runner: the burst case runs under the
  existing Vitest surface, in keeping with `project-verification`.
- The marks are for the desk's own record. Nothing about them reaches a trading
  decision, and no price, size or money value is recorded with them.

## Impact

- `electron/services/desk-diagnostic-record.js`,
  `electron/services/binance-connection.js`,
  `electron/services/futures-production-workstation-service.js`,
  `src/hooks/useFuturesProductionWorkstation.js`,
  `src/hooks/useFuturesTrading.js`.
- Adds a requirement to `desk-diagnostic-record` and one to
  `futures-workstation-presentation`.
- Should land alongside or before the other changes in this batch: it is what
  turns their claims into measurements. The stated bound in §4 can only be set
  once one run has been measured, so it is set from that run rather than guessed
  at now.
