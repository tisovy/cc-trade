# Audit live acceptance — 2026-09-05

## Observation and scope

This section records the initial ordinary-use checkpoint. The later
[packaged-use follow-up](#packaged-use-follow-up--2026-09-05) below updates the
remaining acceptance gates without changing the scope of the initial observation.

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

## Kept active after the initial observation

- [keep-spot-selection-and-packaged-ui-consistent](changes/archive/2026-09-05-keep-spot-selection-and-packaged-ui-consistent/tasks.md): task 3.3 explicitly requires rapid selection and a packaged window. The initial report did not establish those additional checks; the later follow-up below closes this gate.
- [refresh-the-desktop-security-baseline](changes/archive/2026-09-05-refresh-the-desktop-security-baseline/tasks.md): the explicit packaged-window acceptance and separate permission-gated registry audit remained outstanding at this initial checkpoint. No dependency-metadata disclosure was authorized by the live report.

Nothing was silently carried away or dropped: those changes and their unchecked
tasks stayed active at this checkpoint. Git push is also not authorized by this observation and is
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

## Packaged-use follow-up — 2026-09-05

Later operator message: “все работает как надо”. The immediately preceding
checklist explicitly requested the built application rather than dev mode:
the window opens, DevTools remain closed by default, and rapid Spot pair/interval
switching works correctly. No trades were required. This reply is accepted as
operator sign-off to that checklist, including the outstanding live acceptance,
not an independent observation or an exhaustive correctness claim.

Running revision, package identity, launch command and account were not supplied.
The checkout was `8711a73`, which is not proof of the running application's
revision. No failure injection, adversarial race or security-audit result is
inferred, and the earlier local test/package evidence is not relabeled as live.

- Task 3.3 of [keep-spot-selection-and-packaged-ui-consistent](changes/archive/2026-09-05-keep-spot-selection-and-packaged-ui-consistent/tasks.md) is satisfied; the spec-driven change is archived under the `2026-09-05-` prefix with all tasks complete.
- Task 2.5 of [refresh-the-desktop-security-baseline](changes/archive/2026-09-05-refresh-the-desktop-security-baseline/tasks.md) is satisfied. At this checkpoint the change remained active only for task 2.4: separate registry-audit disclosure permission and the audit result.

The reply reports application behavior, not consent to the separate `npm audit`
question. No registry audit or push is performed. This brings the selected audit
batch to 12 archived changes and one retained change, without dropping work.

### Follow-up verification

Before edits, GitNexus was bound to the primary `trade_ui_latest` checkout and
refreshed at `8711a73`. The `Outstanding acceptance` section resolved to this
change's evidence document. Its upstream/context walk reported no callers or
processes (the installed tool labels this LOW); the empty result was treated as
unresolved and supplemented with a reference scan, not as a runtime safety claim.

Both delta requirements exactly match their main-spec blocks; no sync write was
needed. All planning artifacts and selected tasks are complete. Both selected
and retained changes passed strict validation before the move. The validated
`openspec archive --yes --skip-specs` operation preserved all seven files,
including `.openspec.yaml`, byte for byte against a pre-move SHA-256 inventory
after the explicit acceptance/link edits. All 42 relative links across the
11 archive/report files resolve; all 23 main specs pass strict validation.
Code, dependencies and main specs are unchanged. Source tests were not rerun for
this documentation-only follow-up; the earlier 3,528-test checkpoint remains
historical local evidence. The retained change has exactly one unchecked task,
2.4, and the documentation diff passes the whitespace check.

## Registry audit and final batch closure — 2026-09-05

After a separate explanation that `npm audit` sends dependency names and versions
to npm registry, the operator instructed “работай дальше”. The assistant stated
that this would be treated as permission specifically for that check, and the
execution approval layer allowed the scoped command. The earlier behavior-only
messages are not retroactively treated as disclosure consent.

The fresh scan exited 0 and reported zero known vulnerabilities; the local
seven-copy dependency baseline also passed. The command, tool versions, manifest
and lockfile hashes, complete JSON and coverage limitations are preserved in the
[registry evidence](changes/archive/2026-09-05-refresh-the-desktop-security-baseline/registry-audit-evidence.md).
No dependency, production or main-spec change was necessary. The previous
packaged-use acceptance still applies; the scan is not a new live observation.

Task 2.4 is complete. The spec-driven security-baseline change is archived with
all ten tasks complete and both delta requirements already matching main specs.
This completes archival of all 13 changes in the selected audit batch, not every
proposal in this repository or every architectural follow-up. No Git push,
trading session, deployment or credential operation is authorized or performed.

Strict validation passed before archive and for all 23 main specs afterward.
All eight security-change files (including the added raw report/evidence and
`.openspec.yaml`) match their post-edit, pre-move SHA-256 inventory. All 49
relative links across nine archive/report Markdown files resolve. The saved
JSON matches the captured audit stdout; manifest/lockfile hashes still match
the recorded checkpoint. All 13 selected archive directories exist, their old
active paths are absent and their tasks contain no unchecked item. Production,
dependency and main-spec diffs are empty; the documentation whitespace check
passes. Source tests were not rerun for this evidence-only closure.
