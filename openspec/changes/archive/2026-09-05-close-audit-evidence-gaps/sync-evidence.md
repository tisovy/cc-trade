# Specification synchronization — 2026-09-05

Later hand-off update: ordinary-use live confirmation was received after this
sync checkpoint. See the [acceptance record](../../../audit-live-acceptance-2026-09-05.md)
for archive selection and exclusions; the earlier pending gate below is historical.

Implementation commit: `5d3e46c` on `main`. This subsequent documentation-only commit synchronizes the reviewed contracts; it does not assert live acceptance or archive any change.

## Selection

Using openspec-sync-specs for the following changes, inferred from the requested audit of the preceding work. Each selection was resolved through its current OpenSpec status. Only `artifactPaths.specs.existingOutputPaths` supplied the delta paths; all roots resolved to this checkout. Current specs instructions returned valid JSON and no additional artifact rules for every selection.

| Change | Capabilities synchronized |
|---|---|
| keep-spot-selection-and-packaged-ui-consistent | project-verification; spot-chart-history |
| preserve-spot-command-outcome-evidence | trading-command-integrity |
| own-the-spot-private-subscription | spot-private-stream; trading-command-integrity |
| refresh-the-desktop-security-baseline | desktop-dependency-baseline |
| count-each-spot-request-attempt | spot-request-accounting |
| prove-each-order-mutation-outcome | order-mutation-postconditions; trading-command-integrity |
| verify-the-candle-store-answer | candle-store-answer-integrity |
| unify-order-command-alias-lanes | order-command-alias-serialization |
| isolate-spot-account-history-and-pnl | spot-account-persistence |
| bound-renderer-backlog-memory | renderer-backlog-bounds |
| isolate-workspace-render-failures | workspace-render-recovery |
| stop-after-unhandled-runtime-faults | terminal-runtime-faults |
| close-audit-evidence-gaps | desktop-devtools-policy; order-response-evidence; spot-catchup-continuity; trading-command-integrity |

## Merge and verification

- 16 capability specs affected: three existing, 13 new. Added 34 requirements / 111 scenarios; modified five complete command-integrity requirements. Removed/renamed no requirement or capability.
- All 107 prior scenarios in the three existing specs retained their titles. Unmentioned requirement blocks and authoritative existing Purpose sections were preserved exactly.
- Every one of the 39 selected delta requirement blocks matches its canonical block. Reapplying the same semantic merge produces byte-identical main specs.
- New specs use the main-spec format, with a single Requirements section and no delta operation headers. Supplied Purpose text was retained; other new capabilities received explicit descriptions immediately, as required by the existing project-verification contract. No TBD Purpose remains.
- `OPENSPEC_TELEMETRY=0 openspec validate --specs --strict`: **23 passed / 0 failed**. Strict validation of each of the **13 selected changes passed** after synchronization.
- The existing command-integrity requirement's graph impact returned an empty LOW walk. This is a documentation graph result, not proof of implementation independence; full block/scenario comparison and reviewed source contracts provide the merge evidence.
- No production code, test or dependency changed after the 3,528-test/package implementation checkpoint. The synchronization is checked by strict spec validation, exact merge/idempotence checks, diff review and precommit GitNexus all/compare-main.
- Final staged all and compare/main both returned 249 documentation nodes / 20 files / zero reported affected processes, LOW, without partial/truncated. Every returned changed file is an OpenSpec document; the zero is not a claim about whole-program safety. The same internal graph limitations recorded in the implementation review remain.

## Archive gate

The openspec-archive-change workflow is paused at the repository's explicit operator live-confirmation requirement. A request to archive, passing local tests or completed planning artifacts is not that confirmation. All 13 changes remain active; no live checkbox was checked and no unfinished task was dropped. The dependency change additionally retains its separately permission-gated registry audit task. Unrelated active and archived changes are untouched.

See [self-review evidence](evidence.md) and the [live ledger](../../../live-verification-ledger.md). Confirm only naturally observed behavior during intended use; do not manufacture trading failures with real funds for acceptance.
