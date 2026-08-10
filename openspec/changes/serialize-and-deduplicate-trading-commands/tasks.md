## 1. Duplicate Protection

- [ ] 1.1 Add a bounded main-process command registry keyed by command identity, recording in-flight and completed outcomes with an eviction bound on size and age.
- [ ] 1.2 Answer a redelivered or duplicated command from the recorded outcome instead of submitting it again, for both markets.
- [ ] 1.3 Prove by test that two identical frames delivered concurrently produce exactly one exchange submission and that both receive the same outcome.

## 2. Ordering Protection

- [ ] 2.1 Serialize mutating commands that target the same order identity, and the same symbol, so an amend and a cancel cannot execute out of order.
- [ ] 2.2 Keep commands on different symbols concurrent.
- [ ] 2.3 Prove by test that an amend followed by a cancel reaches the exchange in the submitted order.

## 3. Verification

- [ ] 3.1 Run unit and integration suites and the production-guard checks.
