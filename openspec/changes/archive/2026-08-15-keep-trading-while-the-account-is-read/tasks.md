## 1. What A Command Owes The Account

- [x] 1.1 Read nothing back after a placement, cancellation or amendment while the authenticated stream is up.
- [x] 1.2 Keep the whole read when no stream is up, because nothing else can report what the command did.
- [x] 1.3 Read the algorithmic orders back after a cancel-all, and only those.
- [x] 1.4 Prove 1.1 and 1.2 by test.

## 2. A Reading Being Refreshed Is Still A Reading

- [x] 2.1 Derive "confirmed balance" from whether it has answered, not from whether a read is idle, and share it between the readiness gate and the ticket's sizing.
- [x] 2.2 Keep `stale` and `error` blocking exactly as they were.
- [x] 2.3 Prove by test that readiness and sizing survive a refresh, that a first read still blocks, and that stale and error still do.

## 3. Measuring The Desk Instead Of Describing It

- [x] 3.1 Record when a command was answered and how long it took, tied to its own line by the order identity.
- [x] 3.2 Keep no answer for the reads the record does not keep.
- [x] 3.3 Report answer times per command in the day's summary.
- [x] 3.4 Prove all three by test.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `npm run check:command-path`.
- [x] 4.2 Operator confirms on live data that placing and dragging orders no longer refuses the next one with `Loading Futures account state`, that the sizing panel and the `SYNC` badge stop flashing, and that the desk stays tradable through a fast run of orders — step 26, «Быстрая серия ордеров не выключает торговлю», in `verify-the-desk-in-one-sitting/runbook.md`.
- [ ] 4.3 Operator reads `node scripts/read-desk-record.mjs` after such a run and confirms the answer times it reports match what the desk felt like — step 34 п.1, «Сколько на самом деле занимает ордер». Read at the end of the sitting rather than after step 26, so the record has the whole pass in it. Verified against the script: the section is titled `How long commands took to answer` (`scripts/read-desk-record.mjs:285`).
