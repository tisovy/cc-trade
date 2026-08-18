## Why

Live verification was performed repeatedly, but its evidence was split between
archived `tasks.md` files, this change's runbook and the live-verification
ledger. The original requirement to repeat every check in one uninterrupted
sitting became obsolete as the runbook grew from thirteen to fifty-one steps:
it now asks the operator to re-prove basic behaviour that already has dated
observations while current failures wait elsewhere.

The missing work is reconciliation, not another full desk exam. Existing
operator observations and diagnostic records must become the completion marks
they support, and every genuine evidence gap must remain visible without being
filled by inference.

## What Changes

- Treat a dated operator observation or a diagnostic record that directly
  states the behaviour as live evidence. Do not repeat a supported check merely
  because it was recorded in another sitting or left unchecked in an archive.
- Reconcile the runbook, archived confirmation tasks and
  `openspec/live-verification-ledger.md` into one auditable record. Each entry
  names its evidence, date, Production account and desk revision; legacy
  metadata that was not preserved is written as `NOT RECORDED`, never invented.
- Check archived confirmation items only after a matching ledger row exists.
  Record unstageable guarantees as exactly `COVERED BY TEST ONLY` with the tests
  that hold them, and leave unsupported items open.
- Keep complaint-specific measurements complaint-specific. A reported late
  frame is settled only from the nearest raw `kind: "frame"` event for that
  contract; a live fill is settled only from an order frame that names its four
  legs and whether the screen changed.
- Preserve the runbook as historical evidence and an unresolved queue, not as a
  fifty-one-step ritual that must be replayed from the beginning.

## Capabilities

No capability specification changes. This change reconciles verification of
requirements that already exist; it adds, modifies and removes no runtime
behaviour.

## Impact

- Documentation and historical task metadata only: this change, archived
  confirmation tasks and `openspec/live-verification-ledger.md`.
- No UI launch, exchange command or real order is required to accept evidence
  already recorded. A genuinely missing live condition remains outstanding
  until it occurs naturally or the operator deliberately stages its existing
  runbook step.
- No production code, API, dependency or runtime behaviour changes.
