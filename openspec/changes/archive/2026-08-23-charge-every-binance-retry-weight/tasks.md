## 1. CRITICAL impact and production accounting

- [x] 1.1 Re-run GitNexus upstream impact for `RateLimiter.execute`, `RateLimiter.reserve`, transport retry helpers, and internal adapter helpers; warn on the CRITICAL 19-flow/11-family blast radius and enumerate command/account/history/stream callers before editing
- [x] 1.2 Add bounded structured logical-operation/physical-attempt metadata in production code without changing caller payload/error shapes or accepting URL/query/body/header/signature/money fields
- [x] 1.3 Put Futures production reservation and cancellation at the low-level physical HTTP-send boundary, then verify a local instrumented probe charges 30/60/90 for one/two/three weight-30 sends without double charging
- [x] 1.4 Preserve retry eligibility, backoff, priority, and final-error semantics while making retries independently abortable, then verify cancellation before retry sends no second request
- [x] 1.5 Surface recognized used-weight/retry-after observations conservatively and add sanitized attempt diagnostics, then verify missing headers never reduce declared charges and no signed data is recorded
- [x] 1.6 Keep Spot on legacy logical-operation admission while charging Futures pooled/fresh fallback, weight-1 time sync, weight-30 uncached position-mode read, signed send, and `-1021` resync/retry independently under one AbortSignal
- [x] 1.7 Route every direct mutating Futures handler and its ambiguity-reconciliation read through physical-mode admission; preserve urgent command priority and use zero logical retries for non-idempotent mutations so no indeterminate command is replayed, while absolute desired-state setters may retain bounded retries
- [x] 1.8 Recheck listen-key lifecycle ownership after physical admission and source account snapshot `issuedAt` from the latest admitted attempt, preventing stale queued sends and pre-admission snapshot races
- [x] 1.9 Limit pooled-connection fallback to replay-safe GET requests so an indeterminate position-margin/order mutation is never applied twice
- [x] 1.10 Materialize signed timestamp/query/body/signature after every physical admission and immediately before transport creation, including independently admitted replay-safe GET fallback, so queued time cannot consume `recvWindow`
- [x] 1.11 Associate response observations with monotonic physical-admission tokens and preserve every later still-windowed reservation when a header raises the conservative floor
- [x] 1.12 Track still-unanswered physical-admission tokens and preserve unresolved reservations on both sides of a responding token, so a newer response cannot erase an older attempt that Binance may not have counted yet
- [x] 1.13 Recheck lifecycle ownership before reservation and inside the admission slot before booking, while retaining the post-booking transport guard without refunding an already completed reservation
- [x] 1.14 Bound every Futures REST response before buffer concatenation/JSON parsing and preserve charged, non-replayed mutation indeterminacy on overflow
- [x] 1.15 Enforce the admission-pass ceiling for every ordinary request before the selected urgent entry, including a requeued non-head request that already carries the ceiling
- [x] 1.16 Return one drain-owned account-refresh receipt across queued follow-up passes and resolve ambiguous cancel-all or position-margin outcomes only when every required Binance resource actually became ready

## 2. Tests after implementation

- [x] 2.1 Add deterministic limiter tests for first success, timeout-success, three failures, cancellation during backoff/admission, and concurrent priorities; run the focused limiter suite
- [x] 2.2 Add adapter/header tests for higher observed weight, absent headers, `429`, retry guidance, and no downward reconciliation; run focused adapter/main suites
- [x] 2.3 Run all GitNexus-identified user-stream, account refresh, trading command, order/history, income, and cancellation regression suites
- [x] 2.4 Run a stress fixture proving history/income fan-outs remain fair while listen-key and trading-command work retains priority under per-attempt charging
- [x] 2.5 Add transport-seam regressions for pooled `ECONNRESET`/`EPIPE`, initial clock sync, `-1021` resync/retry, in-flight abort, internal endpoint weights, direct mutating command admission without replay, ambiguity reconciliation, and unchanged Spot accounting
- [x] 2.6 Add delayed-admission races proving an invalidated listen-key sends nothing and a snapshot/retry uses the latest physical admission time against newer stream state
- [x] 2.7 Add pooled `ECONNRESET`/`EPIPE` regressions proving replay-safe GETs retry once while position-margin mutations remain one indeterminate attempt
- [x] 2.8 Add deterministic adapter/limiter seam regressions that hold signed admission beyond `recvWindow`, prove the transmitted timestamp is post-admission, and retain exact `-1021`/fallback attempt-weight accounting
- [x] 2.9 Add concurrent and out-of-order response regressions proving an older higher header cannot erase a newer reservation and lower/repeated headers never refund it
- [x] 2.10 Add the reverse response-order regression proving a newer header preserves an older unresolved reservation and cannot admit work against falsely refunded capacity
- [x] 2.11 Add a delayed-admission lifecycle regression proving retirement during capacity/spacing wait creates neither weight reservation nor physical transport
- [x] 2.12 Add declared-length and chunked overflow regressions proving early bounded refusal, no JSON parse, charged accounting, and no mutation replay
- [x] 2.13 Add a limiter regression proving a requeued non-head request at the pass ceiling cannot be overtaken again
- [x] 2.14 Add queued/failed account-reconciliation regressions proving ambiguous mutations remain unresolved until the latest required order or position/balance read succeeds, including a later failed pass replacing an earlier ready outcome

## 3. Verification and operator gate

- [x] 3.1 Run `OPENSPEC_TELEMETRY=0 openspec validate charge-every-binance-retry-weight --strict` and verify it passes
- [x] 3.2 Run GitNexus `detect_changes` against `main`, inspect every affected execution flow, and resolve unexpected behavior before commit
- [ ] 3.3 Observe live charged weight, retry latency, command priority, and `429` rate before/after deployment; keep this unchecked until the operator confirms
- [ ] 3.4 Archive only after operator confirmation and do not bundle income scheduling changes into this change

## Note, 2026-08-23 — where the code landed

The limiter and account-refresh-receipt hunks of this change reached `main`
in `af65905` (subject «close final PnL audit gaps», an archive sweep commit)
after a three-way index race on 2026-08-23. The `nextAdmission`/`reserve`
fairness hunks rode in the same commit without a recorded author. Chain:
`ac3a1a3 → 1b5e6b0 → af65905`; nothing was lost, this line exists so blame
archaeology does not have to rediscover that.
