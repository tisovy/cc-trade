## Why

The desk states its faults and its timings, and then throws them away. `logger`
is `console` (`binance-connection.js:80`): started from a launcher the lines go
nowhere, started from a terminal they live until it is closed. Nothing survives a
restart.

So a question the operator actually asks — *how often did the book rebuild
yesterday*, *which reason took the workspace to `RESYNCHRONIZING` at 14:20*, *is
the history read getting slower* — cannot be answered at all. What gets reported
is whatever happened to be on screen at the moment it went wrong, which is how a
defect that had been running for days was first noticed by its symptom rather
than its cause.

The instrumentation is already there and already structured:
`[futures-production-workstation:timing]` carries phase, duration and outcome,
`[futures-production-workstation:fault]` carries phase and code, and the fault
line is pinned by `check:futures-production`. What is missing is a file for them
to land in.

## What Changes

- **The desk keeps its own record.** One file per day under the application's
  own data directory, one event per line, machine-readable, each line stamped
  with when it happened.
- **Only what is already structured is recorded.** The record takes the desk's
  own diagnostic events, not arbitrary console output. That is what makes it
  readable a week later, and what makes the rule below provable rather than
  hoped for.
- **The record carries no credential and no money.** No key, no signature, no
  price, quantity, balance or PnL. What a command *was* and how it *ended* is
  behaviour; what it was worth is not the record's business.
- **It is bounded.** Kept for a stated number of days and under a stated number
  of bytes, oldest dropped first. A log that grows forever fills the disk of a
  trading desk.
- **It never costs the desk.** A file that cannot be written loses a line, not a
  session; nothing on a market or trading path waits for it.
- **Something reads it back.** A command that summarises a day — counts by code,
  what each resynchronization was for, the slowest phases — because a thousand
  lines read by eye is not how an anomaly gets noticed.

## Trade-offs this accepts

- **Money values stay out, by assumption.** The operator asked for a record of
  the application's behaviour, not a trade journal. A command is recorded as its
  contract, side, type, identity and outcome — enough to trace what the desk did
  and when — but a trade journal with prices and sizes is a separate decision,
  and the operator can widen this one by making it.
- **The renderer's own faults are not in it.** A React error or a refused frame
  in the renderer reaches devtools and nothing else. Carrying those across the
  local connection is a second step, and this change does not take it.
- **A record is written on the main process's own thread.** It is bounded by the
  rate the diagnostics already have — a handful of lines a minute in normal
  running, a burst during a resync — and appended, never re-read.

## Capabilities

### Added Capabilities

- `desk-diagnostic-record`: the desk keeps a bounded, sanitized local record of
  what it did, and it can be read back.

## Impact

- `electron/services/desk-diagnostic-record.js` (new) — the sink: the field list
  each kind may carry, the format, the rotation, the bounds, and the degradation
  when the disk says no.
- `electron/services/binance-connection.js` — four seams. The existing `onTiming`
  and `onInternalError` reporters gain the file beside the console; the
  workstation's own emitter, which is the only place a resynchronization names
  its cause; the renderer emitter, which is where a command's outcome is stated;
  and `handleTypedTradingCommand`, which is the only place a command's side and
  type exist. Absent a record, the connection behaves exactly as before.
- `electron/main.js` — the record's directory, taken from the app's own data
  path, stated once at startup so the operator can find it, and a line for the
  start and the end of each run.
- `scripts/read-desk-record.mjs` (new) — the summary over a day.
- `openspec/changes/verify-the-desk-in-one-sitting/runbook.md` — where the
  operator's own confirmation is gathered.
