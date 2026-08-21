## 1. CRITICAL impact and production accounting

- [ ] 1.1 Re-run GitNexus upstream impact for `RateLimiter.execute` and all retry helpers, warn on the CRITICAL 17-flow blast radius, and enumerate command/account/history/stream callers before editing
- [ ] 1.2 Add structured logical-operation/physical-attempt metadata in production code without moving reservation yet, then verify existing callers receive unchanged payload/error shapes
- [ ] 1.3 Move production reservation and cancellation checks inside the physical-attempt loop, then verify a local instrumented probe charges 30/60/90 for one/two/three weight-30 attempts
- [ ] 1.4 Preserve retry eligibility, backoff, priority, and final-error semantics while making retries independently abortable, then verify cancellation before retry sends no second request
- [ ] 1.5 Surface recognized used-weight/retry-after observations conservatively and add sanitized attempt diagnostics, then verify missing headers never reduce declared charges and no signed data is recorded

## 2. Tests after implementation

- [ ] 2.1 Add deterministic limiter tests for first success, timeout-success, three failures, cancellation during backoff/admission, and concurrent priorities; run the focused limiter suite
- [ ] 2.2 Add adapter/header tests for higher observed weight, absent headers, `429`, retry guidance, and no downward reconciliation; run focused adapter/main suites
- [ ] 2.3 Run all GitNexus-identified user-stream, account refresh, trading command, order/history, income, and cancellation regression suites
- [ ] 2.4 Run a stress fixture proving history/income fan-outs remain fair while listen-key and trading-command work retains priority under per-attempt charging

## 3. Verification and operator gate

- [ ] 3.1 Run `OPENSPEC_TELEMETRY=0 openspec validate charge-every-binance-retry-weight --strict` and verify it passes
- [ ] 3.2 Run GitNexus `detect_changes` against `main`, inspect every affected execution flow, and resolve unexpected behavior before commit
- [ ] 3.3 Observe live charged weight, retry latency, command priority, and `429` rate before/after deployment; keep this unchecked until the operator confirms
- [ ] 3.4 Archive only after operator confirmation and do not bundle income scheduling changes into this change
