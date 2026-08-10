## 1. A Balance Is Confirmed Or It Is Not

- [x] 1.1 Mark held account resources as unconfirmed when the transport drops, keeping the values for reference but not their `ready` status.
- [x] 1.2 Treat the account as confirmed again only when a refresh answers on the new connection, not when the refresh is sent.
- [x] 1.3 Keep the ticket's sizing gate on the confirmed status, and state "balance not confirmed since reconnect" as the reason when it blocks.
- [x] 1.4 Prove by test that sizing is blocked between a reconnect and the first account answer, and released by that answer.

## 2. A Stalled Mark Price Says So

- [x] 2.1 On a mark-price stall, stop presenting the last value as the current mark: mark the reading stale through the existing envelope.
- [x] 2.2 Restart the mark socket on a stall rather than only logging, bounded by the existing reconnect discipline.
- [x] 2.3 Resolved by withdrawal rather than by labelling: a stalled feed's marks are dropped, so every derived number falls back to the account snapshot, which the 15s account read keeps current. Nothing presents a frozen stream value as the market.
- [x] 2.4 Prove by test that a feed that goes quiet past the stall window reports staleness and attempts a restart, and that resumed delivery clears it.
- [x] 2.5 Space the rebuild on the existing reconnect delay rather than reconnecting the instant the stall is seen, so a feed that stays dead does not open a socket every stall window. *(Added 2026-08-10 from a review of the delivery: 2.2 claimed the existing reconnect discipline and the restart bypassed it.)*

## 3. Unknown Is Not Zero

- [x] 3.1 Pass the positions and orders resource status into `FuturesPortfolioDock` alongside the rows.
- [x] 3.2 Render "not yet read" and "read failed" distinctly from "none open", including in the counts in the panel headers.
- [x] 3.3 Prove by test that a dock with no data and no successful read never claims zero open positions.
- [x] 3.4 Read no resource status at all as unknown rather than as read-and-empty, and tolerate a null status from a caller that has none. *(Added 2026-08-10 from a review of the delivery: the dock defaulted to an empty status object, which the availability rule treated as "read, nothing there" — the same false reading one level up.)*
- [x] 3.5 Prove by test that a dock given no account status says it has not read the account.

## 4. The Command's Own Outcome Is Not Displaced

- [x] 4.1 Show the last command rejection together with any account synchronization failure, keeping the unresolved-outcome card ranked above both.
- [x] 4.2 Include the exchange-reported code (`details.binanceCode`) in the rejection reading.
- [x] 4.3 Prove by test that a rejection arriving while an account resource is failing is still visible, with its exchange code.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data: reconnect blocks sizing until the account answers; a stalled mark is visibly stale.
