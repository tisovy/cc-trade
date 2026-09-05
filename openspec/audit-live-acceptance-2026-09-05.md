# Audit live acceptance — 2026-09-05

## Observation and scope

Operator message: “проверил - вроде всё ок”. It followed the requested check of
ordinary application use: default-closed DevTools and normal balances, history
and chart loading. Record this as **ordinary-use acceptance with no reported
problem**, not an independent or exhaustive correctness sign-off.

Account, exact running revision, launch command and package identity were not
provided. The checkout at hand-off was `84cd908`; that is not proof of the
operator's running revision. No failure injection, test trading, credential
rotation, disconnect, quota exhaustion or packaged-build launch is inferred.
The 3,528-test/package checkpoint remains local evidence, not live observations.

The standing request authorizes archiving accepted changes after confirmation.
The already-synced archive route is selected; no main spec is rewritten. All
39 delta requirement blocks for the 13 reviewed changes match main specs.
Planning artifacts are complete; selected generic live-confirmation tasks now
cite this observation. There are no omitted pending tasks in the selected set.

## Archived changes

All use the spec-driven schema and the `2026-09-05-` archive prefix:

- [preserve-spot-command-outcome-evidence](changes/archive/2026-09-05-preserve-spot-command-outcome-evidence/tasks.md)
- [own-the-spot-private-subscription](changes/archive/2026-09-05-own-the-spot-private-subscription/tasks.md)
- [count-each-spot-request-attempt](changes/archive/2026-09-05-count-each-spot-request-attempt/tasks.md)
- [prove-each-order-mutation-outcome](changes/archive/2026-09-05-prove-each-order-mutation-outcome/tasks.md)
- [verify-the-candle-store-answer](changes/archive/2026-09-05-verify-the-candle-store-answer/tasks.md)
- [unify-order-command-alias-lanes](changes/archive/2026-09-05-unify-order-command-alias-lanes/tasks.md)
- [isolate-spot-account-history-and-pnl](changes/archive/2026-09-05-isolate-spot-account-history-and-pnl/tasks.md)
- [bound-renderer-backlog-memory](changes/archive/2026-09-05-bound-renderer-backlog-memory/tasks.md)
- [isolate-workspace-render-failures](changes/archive/2026-09-05-isolate-workspace-render-failures/tasks.md)
- [stop-after-unhandled-runtime-faults](changes/archive/2026-09-05-stop-after-unhandled-runtime-faults/tasks.md)
- [close-audit-evidence-gaps](changes/archive/2026-09-05-close-audit-evidence-gaps/tasks.md)

Their generic operator-confirmation gates are satisfied for the requested
ordinary-use acceptance. Safety/error/recovery cases remain covered only by the
named deterministic tests unless separate live evidence already exists; archive
does not relabel them as observed in production.

## Kept active

- [keep-spot-selection-and-packaged-ui-consistent](changes/keep-spot-selection-and-packaged-ui-consistent/tasks.md): task 3.3 explicitly requires rapid selection and a packaged window. This report does not establish those additional checks.
- [refresh-the-desktop-security-baseline](changes/refresh-the-desktop-security-baseline/tasks.md): the explicit packaged-window acceptance and separate permission-gated registry audit remain outstanding. No dependency-metadata disclosure is authorized by the live report.

Nothing is silently carried away or dropped: those changes and their unchecked
tasks stay active. Git push is also not authorized by this observation and is
not performed. Other active proposals, historical live-ledger findings and
untracked user files remain out of scope.

## Verification and preservation

Before edits, GitNexus was bound to `trade_ui_latest` at the primary checkout,
indexed commit `84cd908`. The archive section's upstream/context walk returned
empty LOW results (no reported callers/processes). This is unresolved dependency
evidence, supplemented with a text-reference scan; not a runtime safety claim.
Only OpenSpec documentation/tasks/paths change. Relevant links are relocated,
main specs are preserved, and strict validation plus all/compare-main graph
review precede the documentation commit. Source tests are not re-run for an
archive-only change; the earlier local results are retained with their dates.

Archive execution completed for all 11 selections using the checked
already-synced route (`openspec archive --yes --skip-specs`, validation enabled).
All 72 files, including every `.openspec.yaml`, match their pre-move SHA-256
inventory byte for byte after the explicit acceptance/link edits. All 42
relocated/report links resolve. Strict validation passed for every selected
change immediately before moving and for all 23 main specs afterward. The two
retained changes still have their original one and two unchecked tasks.

Precommit GitNexus all and compare/main both returned 456 nodes / 83 changed
diff entries, LOW, zero reported affected processes, no partial/truncated flag.
All 66 files represented by graph symbols are OpenSpec documents; YAML and
rename/deletion entries are additionally covered by the complete 72-file
inventory and staged-path review. Graph coverage is not treated as exhaustive.
Both retained changes also passed strict validation. No production/spec file
changed and the staged diff passed the whitespace check.
