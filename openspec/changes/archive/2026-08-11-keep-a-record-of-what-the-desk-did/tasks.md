## 0. Counted Before Changing

- [x] 0.1 List what the desk already reports and would therefore land in the record: `onTiming` phases, `onInternalError` phases and codes, the history read's own lines, and the status reason codes the workspace emits. State the rate each of them reaches in normal running and during a resync, so the bounds below are sized against something measured.
  - Measured 2026-08-11 by driving the real production runtime against the live exchange (BTCUSDT, 63 s, then a switch to ETHUSDT), counting every reporter.
  - **Steady running: nothing at all.** After the bootstrap the desk emits no timing and no fault line; the 19 frames/s it delivers to the renderer are market data, not diagnostics. This holds only because the reads the desk asks for on its own beat are excluded from the record — see 6.9.
  - **Opening a contract: 10 lines, ~1 KB** — 8 timing phases (`exchange-info`, `contract-klines`, `index-klines`, `premium-index`, `ticker`, `upstream-streams`, `depth`, `aggregate-ready`) and 2 status lines (`loading`, `live`). A contract switch costs the same again, and a resync pays the same bootstrap.
  - **A desk that cannot reach the exchange:** 13 reconnect cycles in 80 s — 13 timing + 13 fault + 26 status = ~39 lines/min, ~2.1 KB/min, **~3 MB/day**. This is the realistic ceiling.
  - **The pathological case:** a contract whose every depth frame is refused emits one `oversized-frame:<bytes>` timing line per frame. At the measured 10 diffs/s that is ~600 lines/min, **~79 MB/day** — the case the byte bound, not the day bound, has to stop.
  - Fault phases that exist: `bootstrap`, `interval-bootstrap`, `stream`, `stream-frame`, `book-recovery`, `freshness`, `candle-history`, `release`. Status reason codes: 28 named constants in the service.
- [x] 0.2 Confirm there is no file sink anywhere today — `app.getPath('userData')` is used for the settings directory only — so nothing is being replaced. The single file the application writes is `window-zoom.json` (`electron/renderer-zoom.js`), whose injectable `fileSystem` and try/catch-to-a-boolean idiom this record follows.

## 1. The File

- [x] 1.1 A record under the application's own data directory, one file a day, appended to, one event per line as JSON. `<userData>/diagnostics/desk-<YYYY-MM-DD>-<NNN>.jsonl`.
- [x] 1.2 Each line carries the time it happened, the kind of event, and the phase and code or outcome the event already states.
- [x] 1.3 The path is stated once at startup, so the operator can find the record without being told where it is (`electron/main.js`, `[Electron] Desk record:`).
- [x] 1.4 Writes are appended and never awaited by a market or trading path — a buffered append stream, `write()` only, never a promise a caller holds.

## 2. What Is Recorded, And What Is Refused

- [x] 2.1 The desk's structured diagnostics only: the timing and fault reporters, and the workspace's own status reason codes. Free-form console output is not captured. A trading command and its outcome are recorded too, by the fields in 2.3.
- [x] 2.2 An event that does not state a recognized kind, phase and code is refused rather than written in whatever shape it arrived in.
- [x] 2.3 A trading command is recorded by contract, side, type, identity and outcome — never by price, quantity, notional, balance or PnL.
- [x] 2.4 No credential, signature, or authenticated request or response body can reach the record. Proved the way the workstation proves it of its own events: each kind declares its exact field list, and nothing outside it is copied.

## 3. Bounds

- [x] 3.1 Kept for a stated number of days and under a stated number of bytes, whichever binds first, oldest dropped. 14 days, 32 MB, in segments of 4 MB so the byte bound can bind inside a single day.
- [x] 3.2 The bounds live beside the code that enforces them and say what they are for — including the measurements in 0.1 they were sized against.
- [x] 3.3 A rotation that fails leaves the record usable rather than growing past its bound unnoticed.

## 4. It Never Costs The Desk

- [x] 4.1 Nothing the record does raises into a caller: an unopenable, unwritable or unrotatable record loses the line and nothing else.
- [x] 4.2 A record that is failing says so once — through the console the desk already has — rather than on every line, and does not retry the open more than once a minute.

## 5. Reading It Back

- [x] 5.1 `scripts/read-desk-record.mjs`: a summary over a day — counts by code, the cause every resynchronization stated, the slowest phases observed.
- [x] 5.2 The summary reads the file alone, with the application not running. Run against a real record produced by the live desk on 2026-08-11.

## 6. Proof

- [x] 6.1 Test: a fault and a timing event each land as one readable line carrying their time, phase and code.
- [x] 6.2 Test: an unstructured or unrecognized event is refused.
- [x] 6.3 Test: a credential, a signature and a money value offered to the record never reach the file.
- [x] 6.4 Test: past either bound, the oldest material is dropped and the record stays within both.
- [x] 6.5 Test: a sink that throws on open, on write and on rotate leaves the caller unaffected.
- [x] 6.6 Test: the summary reports counts, resynchronization causes and slowest phases from a fixture day.
- [x] 6.7 Test: the seams are live — a command, its outcome and a workspace status line reach the record through the connection itself, not only through the module under test. Proved load-bearing by removing each seam.
- [x] 6.8 Test: every shape the live desk was seen to state is accepted. Added after a live run found `cache: 'hit' | 'miss'` being refused as a non-boolean, which silently dropped every `exchange-info` reading.
- [x] 6.9 Test: the reads the desk asks for on its own beat are not recorded as commands. Found by audit: while any order rests, `account.refresh` is sent every 30 s (`ACCOUNT_RECONCILE_INTERVAL_MS`), and `account.symbolConfig` on every contract switch — ~2 900 lines a day saying only that the desk was running, which also falsified the "steady running writes nothing" measurement in 0.1.
- [x] 6.10 Test: past the stream's own buffer the record stops handing lines over and resumes on `drain`. Found by audit: `write()` was called without reading its answer, so a stalled disk would have grown the main process's memory instead of losing a line — the one thing 4.1 says it may do.
- [x] 6.11 Test: the summary reports a day whose lines are missing fields rather than failing on them. Found by audit: the record is a file on the operator's disk and can be edited or truncated; one such line used to throw the whole reading away.

## 7. Verification

- [x] 7.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `check:circular`, `check:runtime-mock`, `check:command-path`.
- [x] 7.2 Add the operator's own confirmation to `verify-the-desk-in-one-sitting/runbook.md`, in Russian, as a step of the next pass: run the desk for a session, open the record, and confirm it names what happened and contains no credential and no money.
- [ ] 7.3 Operator confirms on live data: the record exists where the desk said it does, a day of it reads back through the summary, and nothing in it is a secret or an amount. — *`verify-the-desk-in-one-sitting/runbook.md`, «Дописано 2026-08-11, четвёртый заход: запись деска», пункт 1*

## 8. Stated Limits, Not Fixed Here

- [x] 8.1 The renderer's own faults are not carried into the record; they reach devtools and stop there. Carrying them across the local connection is a separate change.
- [x] 8.2 A trade journal — prices, sizes, realized PnL, on disk — is a separate decision and a separate change. This record deliberately states what the desk did, not what it was worth.
