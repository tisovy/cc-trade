# Self-review and corrective evidence — 2026-09-05

Later hand-off update: the operator reported ordinary live use looked OK on
2026-09-05. The [acceptance record](../../../audit-live-acceptance-2026-09-05.md)
limits that confirmation to the requested normal-use check. Pending-live wording
below records the earlier implementation checkpoint, not the later hand-off.

Scope: the 12 audit-remediation commits `01fac99` through `b5003fc`, plus this corrective change. Review perspectives: architecture/state ownership, exchange/backend correctness, renderer, security/release, QA and specification consistency. This is one implementer's second review, not independent sign-off or live acceptance.

## Findings corrected

| Severity | Finding | Correction and regression evidence |
|---|---|---|
| High | Spot/Futures cancellation normalizers forced CANCELED even when a successful body said FILLED; placement/amendment could accept insufficient success bodies. | Validate raw regular-order identity and action postconditions before normalization. Insufficient evidence remains indeterminate and reaches existing read-only reconciliation. Integration test: one DELETE returning FILLED, one GET proving FILLED, explicit terminal non-cancellation, no second mutation. |
| High | Lookups trusted the requested endpoint instead of the returned identity; Futures HTTP 5xx with code -2013 could prove absence. Private warning matching allowed missing/contradictory identity. | Require matching symbol and safe exchange ID (or matching current/original client ID for a client-only request). A transport-indeterminate -2013 is a failed read, never absence. Regressions cover wrong/missing symbols/IDs and retained warnings. |
| High | A stale Spot initial account snapshot was discarded without replacing its complete balance baseline. | Queue a coalesced current account pass through the existing owner/limiter; do not revive a closed renderer or retired market. Tests cover delta bursts, replacement snapshot, close and market switch. |
| Medium | A generic replacement pass could erase explicit symbol-scoped history demand. | Preserve queued/current explicit symbol; a newer explicit symbol wins. A held BTC pass followed by explicit ETH demand queries only the current ETH history after invalidation. |
| High | The installed SDK emits native BigInt for large JSON integers. The old String(id) assertion concealed failure of renderer-frame JSON serialization. | Convert owned parsed BigInt leaves to exact decimal text, with depth bounded at 64. Real SDK-to-adapter-to-JSON test covers unsafe-number-range order and nested trade IDs; excessive nesting is a bounded indeterminate error. No floating-point conversion. |
| Medium / requested UX | The development-server URL implicitly enabled DevTools. | Default closed in both launch modes; only an explicitly recognized true ELECTRON_OPEN_DEVTOOLS value auto-opens. Manual inspection remains available. Flag/default unit regressions and main call-site review. |
| Low | Current README/workflow still promised implicit mocks, a retired branch policy and public-read-only normal launch. Canonical command wording could equate order existence with cancellation. | Correct current launch/branch documentation; carry five complete MODIFIED command requirements into this change, preserving all existing scenario titles. Historical evidence is not rewritten. |

## Review of the prior implementation

| Area / prior change | Review outcome |
|---|---|
| F01 private Spot owner | Subscription generation/ACK/reconnect and consumer retirement retained; stale account catch-up defect fixed here. |
| F02 SDK evidence | Indeterminate classification retained and actual SDK parsing exercised; raw-success/BigInt gaps fixed here. |
| F03 selection / F04 packaging | Stale chart/cache selection guards reviewed; fresh renderer/main/preload ASAR inventory verified. No additional defect confirmed in scope. |
| F05 dependencies | Installed pinned baseline and package compatibility pass; this does not replace the blocked fresh vulnerability scan. |
| F06 postconditions | Exact action outcome remains authoritative; direct-success and private identity gaps fixed here. |
| F07 candle store | Identity/range/bucket-contiguity validation and exchange fallback retained. No store/database changes; short-page and telemetry proposals remain separate. |
| F08 request accounting | Physical Spot read-attempt accounting retained; catch-up uses that owner. Direct mutations/lookups are not claimed to be globally unified with its budget. |
| F09 account persistence | Versioned configured-key scope, old-socket rejection and conservative baseline retained. No key rotation or migration performed. |
| F10 alias lanes | Proven exchange/client aliases and conservative unknown/conflict barrier retained. No durable replay guarantee added. |
| A02 terminal faults | Fixed bounded diagnostic/exit behavior retained; does not cancel exchange orders or provide durable crash reconciliation. |
| A03 render recovery | Account/trading owners remain outside content recovery; no automatic mutation/reload on render failure. |
| A04 renderer outbox | Byte/frame/count/backlog bounds retained. 64 MiB is serialized payload, not RSS; 30 seconds applies to continuously queued backlog, not every socket stall. |

The new evidence guard covers regular adapter place/cancel/modify/find paths. It does not claim to redesign legacy Futures closePosition, algo/configuration/cancel-all helpers or the pre-existing pooled-socket transport fallback. No replay is added by the new validation branches.

## Verification

- Baseline before corrective work: 146 files / 3,459 tests, full aggregate gates passed.
- Final `npm run test:all`: **147 files / 3,528 tests** (69 additional cases); lint, production build and every retained gate passed.
- Static checks: 324 source files for cycles, 165 runtime modules without mock code, 24 Futures boundary files, 131 command-path modules. Local dependency-baseline guard passed for its seven locked copies; no fresh npm audit was run.
- Targeted intermediate failures exposed outdated fixtures that omitted real order identity/status and the old DevTools expectation; corrected after production changes. Final real-SDK regression additionally verifies JSON serialization, not just String(id).
- Fresh unsigned Linux x64 directory package: `release/self-audit-2026-09-05/linux-unpacked`, Electron 43.6.0 / electron-builder 26.15.3. afterPack checked the real ASAR: **2,062 files, 10 renderer build files**. No application launch or installation.
- `resources/app.asar` SHA-256: `8254cd218d867dde6c254b0d01887820cd7db96d6876733ef2c7a250045ec348`.
- All **3,528 tests passed again after native-dependency rebuild by packaging**.
- Local logs: `/tmp/self-audit-final-gates.log`, `/tmp/self-audit-package.log`, `/tmp/self-audit-post-package.log`; temporary logs are not committed artifacts.
- Known non-fatal warnings remain visible: test-DOM TimeoutNaNWarning (previously traced to dom-helpers/react-bootstrap), Babel large-test-file warning, legacy eslint-env comment warning, missing package description. None was suppressed to make the gate pass.

## Graph and specification checks

Before edits, GitNexus reported HIGH impact for emitSpotRefreshOperation: eight upstream symbols and three process groups (subscription/account refresh/typed commands). The operator was warned. refreshAccountState has seven upstream symbols in two groups. Shared adapter method names and several renderer/helper walks are unresolved: empty LOW results were supplemented by exact-file graph and source review, not treated as absence of callers.

Preliminary all/compare-main detected 120 nodes across 14 tracked files and 46 affected processes, aggregate CRITICAL risk; the warning was reported before the commit review. These counts precede staging the new files. The final staged graph check is recorded with the commit hand-off. GitNexus 1.5.3 internally caps nodes per file at 20; the orchestration file has 216 indexed nodes and some JSX/dynamic edges or large test files are not resolved. No partial/truncated response is accepted, but missing flags do not remove that internal limitation. No PDG/taint scan or whole-program safety proof is claimed.

OpenSpec `close-audit-evidence-gaps` was strictly validated before production changes and after its later additions. The implementation is committed before a separate spec synchronization. Only the 12 reviewed changes and this corrective change are selected for synchronization; unrelated active proposals stay untouched. Live tasks stay open even after main specs reflect the implemented contracts.

Fixes committed as `5d3e46c`. Subsequent [synchronization evidence](sync-evidence.md) records 16 canonical capabilities, 34 added and five modified requirements, strict validation and preservation of all existing scenarios. Archive remains live-gated.

Final staged review after forced reindex: **248 changed nodes / 30 files / 46 affected processes, CRITICAL**, identically in all and compare/main; neither returned partial/truncated. Both new production modules were present in the result. The fresh index contains 13,056 nodes, 20,714 edges, 522 clusters and 300 flows. Source/test review and passing regression gates, not the risk label, support this commit. Git diff whitespace validation and strict OpenSpec validation passed.

All edits/commits use the primary `main` checkout. An already-existing clean `wt-finish` worktree was observed during final checks; `git log main..wt-finish` is empty, so none of its commits is missing from main. It was neither created, edited nor removed by this task. Untracked user GitNexus skills and the original audit remain untouched and excluded from the commit.

## Decisions and remaining gates

- Prefer an explicit unknown result plus a read-only check over invented order state; never use a malformed success body as permission to repeat a mutation.
- Preserve precise IDs as strings so SDK evidence survives transport and persistence without rounding.
- Reuse the existing coalescing refresh owner and limiter rather than add another retry loop.
- Keep DevTools opt-in, including development, because ordinary app opening is the user-facing default.
- Keep `main` as the single integration branch and use OpenSpec apply/sync/archive workflows. The archive workflow stops at the repository's live-acceptance gate; automated checks do not satisfy it.
- **Live acceptance is not supplied.** No live trading, credentials changes, app/service restart, failure injection, cross-OS installer or signed release acceptance was performed. Follow the ledger; do not manufacture failures with real funds.
- **Fresh npm audit remains blocked by the prior auto-review denial**, which requires separate consent to send dependency names/versions to the registry. No bypass was attempted; no zero-vulnerability claim is made.
- A01 broader decomposition, A05 settled-income synchronous I/O, A06 actual external CI enforcement and A07 complete historical-document cleanup remain the explicitly recorded follow-up scope.
