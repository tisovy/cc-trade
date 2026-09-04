# F08 implementation evidence — 2026-09-04

- Account refresh now declares 20/80/20 for balances, all-symbol open orders and symbol trades without orderId (120 total; 100 without trades). Scope and payloads are unchanged. Public detail exchangeInfo/trades now declare 20/25; depth(100)/klines remain 5/2.
- Legacy limiter admission moved inside its existing retry loop. Every attempt reserves capacity/spacing, failed attempts remain charged, and an aborted retry cannot be invoked or charged. Futures physical context remains byte-for-byte unchanged. The 800-weight budget, spacing, retry reasons/counts and no-mutation-replay policy were not relaxed.
- Five new tests use the actual exported production RateLimiter: exhausted attempts, window-capacity wait, aborted retry, timestamp retry spacing and mutation maxRetries=0. The existing legacy retry expectation is now 60 for two weight-30 attempts. All physical-mode regressions remain intact. The separate copied legacy test implementation was not used as evidence of this fix.
- A new main-service detail-bootstrap test observes the production limiter and proves the seven declared weights (20/20/80/20/25/5/2), plus exact API query parameters. Its public-trades fixture carries real SDK status/data shape. Adapter tests check actual parameter scope alongside weights.
- Final full check: **139 files / 3,268 tests passed**, with lint, production build and all architecture gates. Existing 100ms capacity-window margin is preserved and tested; an initial boundary test was corrected to account for it, not by changing production timing.

## Graph review and limits

Repository trade_ui_latest, primary main checkout, baseline 0fdbae7. Refreshed graph: 12,636 nodes / 20,109 edges / 300 flows. Name-based impact resolves RateLimiter/execute to the copied test class in GitNexus 1.5.3; this was explicitly treated as unresolved. File impact finds main at 1.0 confidence. Uncapped exact-path caller query locates the actual production method; 15 process-participating direct callers touch 92 flows across Spot/Futures. HIGH risk was disclosed before editing. subscribeChannel directly reaches setup (0.95), then main (0.9). Adapter impact reaches setup/import/main. The constant itself and the large main test file are unindexed; source references and full tests supplement, not replace, graph analysis.

The production diff is a moved legacy reservation, five weight corrections and comments; no physical transport, mutation handler or Futures code was rewritten. Staged all/compare-main analysis is repeated before commit and exact paths reviewed to account for the tool's 20-node-per-file cap. No whole-program safety claim follows from its zeroes or absent truncation flags.

Staged MCP all/compare-main both report 12 files / 93 changed nodes / 40 processes, CRITICAL, no partial/truncated flag. The warning was disclosed; uncapped exact paths contain 216 orchestrator nodes, 23 adapter nodes, five production-limiter-test nodes and three adapter-test nodes. The main integration test remains beyond the index file-size cap and was executed/reviewed directly.

## Decisions and outstanding verification

Chose honest cost accounting over narrowing all-symbol orders or raising the limiter ceiling to hide waits. Direct Spot mutations and reconciliation reads are separate from these declared read-operation paths; this change does not claim a unified exchange-header-aware meter for every Spot request. It does not resolve F06 action postconditions or account/alias identity findings.

Operator live acceptance is pending; no archive, real request/quota exhaustion, credentials or production restart. Confirm normal read responsiveness and any naturally observed limiter waits. Published weights verified against [Binance REST API](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md).
