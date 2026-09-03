# Design — score the reconfirmation against the stream

## Code map

- Execution reports reach the main process at `binance-connection.js:4596–4612`
  (`actualFill` → `noteFuturesHistoryActivity(symbol, tradeId)`). The report is
  the adapter's normalized shape (`futures-trading-adapter.js:456–494`:
  `lastFilledPrice`/`L`, `lastFilledQty`/`l`, commission `n`/`N`, `rp`, `T`,
  `tradeId`) — the same fields the renderer's `tradeRowFromReport`
  (`futuresHeldHistory.js`) projects into the held review.
- Stream proof: `futuresHistoryStreamConnected` (set true `:4260`),
  `futuresHistoryStreamEpoch` (`invalidateFuturesHistoryStream` `:2247`),
  `captureFuturesHistoryProof` `:2270`, `futuresHistoryHighestFillIdBySymbol`.
- `handleFuturesHistory` `:6240`: per contract `acceptedTradeReading` is final
  at `:6943` (`trades.push`, `tradeCoverage[historySymbol]`);
  `readFrom[historySymbol].tradeCursor` `:6949` is the identity the read
  started from; the answer is emitted `:7081`. The continuation walker
  (`scheduleFuturesHistoryTradeReacquisition` `:7144`) re-enters the same
  handler with `continuationSymbols`.
- Settled: `readFuturesSettledMoney` `:3423` (`verifyFullWindow = reason ===
  'verification'`), `walkFuturesSettledIncomeLanes` `:3567` answers
  `walked.resource.lanes[type]` with `coveredFrom`/`coveredTo` per lane;
  `recordSettled` `:3462` writes `missing: 0, differing: 0`;
  `compareFuturesSettledReadings` (`futures-settled-income-store.js:341`,
  Map-keyed, bounded by `coveredFrom`) has had no caller since `ac1800e`.
- Record: `desk-diagnostic-record.js:192` `RECORDED_FIELDS` (the `settled`
  kind `:427`, `READ_REASON` `:119` with `unstated`); one line per kind,
  counts only, a malformed field refuses the line.
- Summary: `scripts/read-desk-record.mjs` (`request` by route `:227`,
  `formatDeskDiagnosticSummary` `:453`, `Requests by route` block `:571`).

## Decisions

### D1. The score is kept in the main process, from its own shadow of the stream

Main keeps, per contract, a bounded map of the fills the private stream
reported: trade identity → the six fields the renderer's fold projects
(`price`, `quantity`, `commission`, `commissionAsset`, `realizedPnl`, `time`),
as the exact strings the report carried. Fed at the execution-report site,
bounded to `FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT` newest identities per
contract and to the review window, cleared with the rest of the per-activation
history state. One test asserts the shadow's projection equals the renderer's
`tradeRowFromReport` on the same report, field for field, so the two cannot
drift apart unnoticed.

Rejected: *scoring in the renderer at `mergeRows`*, where the fold lives — it
would add a fourth renderer → main reporter beside `report_frame_marks`,
`report_display_event` and `report_withheld_command`, and the renderer doubles
under StrictMode (812 doubled lines on 2026-08-28); a score written by
whichever renderer is mounted is not one score. *Comparing against the
checkpoint rows in `futuresHistorySession`* — those are REST rows; the
question is what the stream reported.

### D2. Only rows inside the stream's own span are judged

A returned row is judged only if its time is at or after the moment the current
stream epoch connected (recorded beside `futuresHistoryStreamConnected = true`).
Older rows count as `restated`: the stream was not there to report them, and
calling them unreported would report the socket's downtime as the socket's
failure — the same bound `compareFuturesSettledReadings` applies through
`coveredFrom`. `vouched` is 1 when the epoch captured at the start of the pass
is still the epoch at acceptance for every covered contract; a pass whose
stream dropped mid-way writes 0, and its `unreported` is not evidence.

### D3. What differs is six fields, compared as exact decimals

Per field, with no tolerance: the four amounts as exact decimals where trailing
zeros are not a difference (`/userTrades` keeps the endpoint's text verbatim
and the stream does not promise the same scale — `0.00402000` against
`0.00402` is the same fee), the fee asset as text, the time as a number. A row
whose identity the shadow holds but whose fields differ counts once in
`differing`, however many fields moved.

Residual: if the first live lines show `differing` driven by `time` alone (the
report's `T` against `/userTrades` `time`), split time out into its own counter
rather than loosen the comparison. Re-run the case; do not read it.

### D4. The read names its reason

`createFuturesAccountHistoryCommand` carries `reason` from a closed set:
`fill` (the burst timer), `open` (the review opened a view), `refresh`
(operator ↻), `full` (operator ↻ while discovery is incomplete), `stream` (the
authenticated stream reopened and its gap is read back), `bootstrap` (the
positions were first read under this activation). Main's continuation walker
names `continuation`. A command that does not say is `unstated`, as account
reads are — and the command boundary drops any other word, so a caller cannot
invent one. One command, six callers: the cause is named by the caller, never
inferred from the command's shape.

Implemented 2026-09-03: the closed set is `FUTURES_HISTORY_READ_REASONS` in
`tradingCommands.js`; the record's `HISTORY_REASON` is that set plus the two
words of main's own.

### D5. The settled score compares lane by lane

On a pass with `verifyFullWindow`, the rows held before the walk are compared
with each successfully answered lane's rows inside the span that lane walked,
`[windowFrom, now]` clipped to the lane's own coverage, keyed as the store keys
them and judged one lane at a time — a funding row is not missing from a page
of rebates; `missing` / `differing` are the sums, `verified` the count of
lanes compared. A
pass without a full-window walk writes `verified: 0, missing: 0, differing: 0`,
and the field comment says that a zero beside `verified: 0` is silence, not
agreement. The reader reports passes compared separately from passes run.

Rejected: *comparing on every pass* — an extension pass asks only for the newest
end, and a held row older than what was asked about is not missing.

### D6. The summary carries both scores

`read-desk-record.mjs` adds a `Reconfirmation against the stream` block:
settled passes run / compared / `missing` / `differing`; history reads run /
vouched / requests / `returned` / `restated` / `held` / `unreported` /
`differing`, with `unreported` and `differing` stated a second time over the
vouched passes alone, and one row per stated reason beneath. Present whenever
either read ran, zeros included. Thirty daily summaries are the operator's
evidence.

Implemented 2026-09-03. The score lives in `futures-history-reconfirmation.js`
(shadow, projection, per-contract score) with its own unit test; the wiring is
in `binance-connection.js`, where every history-endpoint request of a pass
goes through one `executeHistoryRead` so the line can state `reads`. The
settled comparison is bounded to the span walked, `[windowFrom, now]`, rather
than to the lane's `coveredFrom`: the commit prunes held rows that fell out of
the window, and a pruned row is not the exchange withdrawing it.

## Residual

- Ending the gap read, or narrowing the income confirm, is not here. The gate:
  thirty consecutive daily summaries with `unreported: 0`, `differing: 0` on
  vouched history reads and `missing: 0`, `differing: 0` on compared settled
  passes → a change that ends the read; one non-zero → the read stays and the
  line names why.
- The continuation walker's own cadence (residual of
  `confirm-a-fill-burst-once`) is untouched; its rounds get `history` lines of
  their own under `continuation`.
