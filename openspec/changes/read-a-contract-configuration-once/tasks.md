## 0. Counted Before Changing

- [x] 0.1 `refreshFuturesPositionConfigs` maps every open position's contract to `readFuturesSymbolConfig`, which always issues the read: the `futuresSymbolConfigs` map is written but never consulted first. Eight positions at weight 5 is 40 added to every pass, against an 800-a-minute bucket.
- [x] 0.2 Nothing on the user-data stream reports leverage: `ACCOUNT_UPDATE` carries balances and positions only. The read is not keeping up with a stream — it repeats a question whose answer changes a few times a day.

## 1. What Is Held Is Reused

- [x] 1.1 A held configuration is served without a read while it is younger than the hold; `futuresSymbolConfigReadAt` records when each was read.
- [x] 1.2 `refreshFuturesPositionConfigs` asks only for the contracts nothing is held for; the broadcast still carries every position's configuration, held ones included.
- [x] 1.3 The bound of eight contracts applies to what is actually read, so reusing what is held cannot silently widen it.
- [x] 1.4 Each contract is asked once whether anything is held for it. The hold is measured against the clock, and asking twice — once to collect the held, once to collect the unread — could put the same contract in both lists on the millisecond it expires. (Audit, 2026-08-11.)

## 2. What Could Have Changed Is Re-read

- [x] 2.1 Selecting a contract reads it fresh, as now — `handleFuturesSymbolConfig` is untouched.
- [x] 2.2 The desk's own leverage and margin-mode changes read it back fresh, as now.
- [x] 2.3 A configuration older than the hold (10 minutes) is read again on the next refresh that needs it — the path that picks up a change made in Binance's own app without the operator asking. The renderer's 30-second beat and the operator's refresh are the same command, so a held-time bound is what separates "read again" from "read every time".
- [x] 2.4 An automatic refresh within that bound — the beat, a fill, an `ACCOUNT_UPDATE` — reads none of them.
- [x] 2.5 `stopSharedFuturesConnections` drops every held configuration, so none can outlive the account it belongs to. Nothing cleared that map before.

## 3. Proof

- [x] 3.1 Test: two refreshes reporting the same position read its configuration once, and both broadcasts state the multiple. Proved discriminating — with the hold at zero the same test reads three times.
- [x] 3.2 Test: a position appearing on a contract nothing is held for is read, while its neighbour is not, and both are still stated.
- [x] 3.3 Test: a refresh after the hold has passed re-reads the contract.
- [x] 3.4 Covered by the existing leverage and margin-mode tests: both read back fresh after the change.
- [x] 3.5 Deactivation clearing the held map is covered by the activation tests that follow a switch with a fresh read.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test` (1337 tests, 97 files), `npm run check:futures-production`.
- [ ] 4.2 Operator confirms on live data (gathered as item 4 of the third pass in `verify-the-desk-in-one-sitting/runbook.md`): the multiples beside positions stay correct across refreshes, a leverage changed from the desk is reflected at once, and one changed in Binance's app appears within ten minutes or as soon as that contract is selected.
