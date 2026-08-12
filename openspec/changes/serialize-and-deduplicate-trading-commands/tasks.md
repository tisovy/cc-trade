## 1. Duplicate Protection

- [x] 1.1 Add a bounded main-process command registry keyed by command identity, recording in-flight and completed outcomes with an eviction bound on size and age.
- [x] 1.2 Answer a redelivered or duplicated command from the recorded outcome instead of submitting it again, for both markets.
- [x] 1.3 Prove by test that two identical frames delivered concurrently produce exactly one exchange submission and that both receive the same outcome.

## 2. Ordering Protection

- [x] 2.1 Serialize mutating commands that target the same order identity, and the same symbol, so an amend and a cancel cannot execute out of order.
- [x] 2.2 Keep commands on different symbols concurrent.
- [x] 2.3 Prove by test that an amend followed by a cancel reaches the exchange in the submitted order.

## 3. Verification

- [x] 3.1 Run unit and integration suites and the production-guard checks.
- [ ] 3.2 Operator confirms on live data that ordinary placement, amendment and cancellation are unchanged, that a cancellation sent straight after an amendment of the same order still cancels it, and that two contracts do not wait on each other.
