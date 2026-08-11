## 0. Counted Before Changing

- [ ] 0.1 List what the desk already reports and would therefore land in the record: `onTiming` phases, `onInternalError` phases and codes, the history read's own lines, and the status reason codes the workspace emits. State the rate each of them reaches in normal running and during a resync, so the bounds below are sized against something measured.
- [ ] 0.2 Confirm there is no file sink anywhere today — `app.getPath('userData')` is used for the settings directory only — so nothing is being replaced.

## 1. The File

- [ ] 1.1 A record under the application's own data directory, one file a day, appended to, one event per line as JSON.
- [ ] 1.2 Each line carries the time it happened, the kind of event, and the phase and code or outcome the event already states.
- [ ] 1.3 The path is stated once at startup, so the operator can find the record without being told where it is.
- [ ] 1.4 Writes are appended and never awaited by a market or trading path.

## 2. What Is Recorded, And What Is Refused

- [ ] 2.1 The desk's structured diagnostics only: the timing and fault reporters, and the workspace's own status reason codes. Free-form console output is not captured.
- [ ] 2.2 An event that does not state a recognized kind, phase and code is refused rather than written in whatever shape it arrived in.
- [ ] 2.3 A trading command is recorded by contract, side, type, identity and outcome — never by price, quantity, notional, balance or PnL.
- [ ] 2.4 No credential, signature, or authenticated request or response body can reach the record. Prove it the way the workstation already proves it of its own events.

## 3. Bounds

- [ ] 3.1 Kept for a stated number of days and under a stated number of bytes, whichever binds first, oldest dropped.
- [ ] 3.2 The bounds live beside the code that enforces them and say what they are for.
- [ ] 3.3 A rotation that fails leaves the record usable rather than growing past its bound unnoticed.

## 4. It Never Costs The Desk

- [ ] 4.1 Nothing the record does raises into a caller: an unopenable, unwritable or unrotatable record loses the line and nothing else.
- [ ] 4.2 A record that is failing says so once — through the console the desk already has — rather than on every line.

## 5. Reading It Back

- [ ] 5.1 `scripts/read-desk-record.mjs`: a summary over a day — counts by code, the cause every resynchronization stated, the slowest phases observed.
- [ ] 5.2 The summary reads the file alone, with the application not running.

## 6. Proof

- [ ] 6.1 Test: a fault and a timing event each land as one readable line carrying their time, phase and code.
- [ ] 6.2 Test: an unstructured or unrecognized event is refused.
- [ ] 6.3 Test: a credential, a signature and a money value offered to the record never reach the file.
- [ ] 6.4 Test: past either bound, the oldest material is dropped and the record stays within both.
- [ ] 6.5 Test: a sink that throws on open, on write and on rotate leaves the caller unaffected.
- [ ] 6.6 Test: the summary reports counts, resynchronization causes and slowest phases from a fixture day.

## 7. Verification

- [ ] 7.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `check:circular`, `check:runtime-mock`, `check:command-path`.
- [ ] 7.2 Add the operator's own confirmation to `verify-the-desk-in-one-sitting/runbook.md`, in Russian, as a step of the next pass: run the desk for a session, open the record, and confirm it names what happened and contains no credential and no money.
- [ ] 7.3 Operator confirms on live data: the record exists where the desk said it does, a day of it reads back through the summary, and nothing in it is a secret or an amount.

## 8. Stated Limits, Not Fixed Here

- [ ] 8.1 The renderer's own faults are not carried into the record; they reach devtools and stop there. Carrying them across the local connection is a separate change.
- [ ] 8.2 A trade journal — prices, sizes, realized PnL, on disk — is a separate decision and a separate change. This record deliberately states what the desk did, not what it was worth.
