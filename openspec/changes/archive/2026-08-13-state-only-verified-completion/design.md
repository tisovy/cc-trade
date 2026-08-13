## Context

See `proposal.md` for motivation and
`specs/project-verification/spec.md` for the requirements. The repository is a
shared checkout, so historical corrections and verification must be isolated
from unrelated working-tree changes. Earlier commit `ef05d9e` already supplied
the supported Node range, the documented `test:all` command, and the three guard
invocations. This change must preserve that provenance rather than relabel the
existing code as new work.

The preparatory archive scan found ten contradictory checked tasks in eight
archived changes. Two supported Node versions are installed locally:
`v24.11.0` and `v26.4.0`. The exact `.nvmrc` value is intentionally not selected
until current verification succeeds on the installed versions.

## Goals / Non-Goals

**Goals:**

- Make every outstanding live check discoverable and its later disposition
  auditable without changing archived implementation history.
- Select an exact Node runtime from measured successful runs while retaining the
  already-declared compatibility range.
- Make `electron/preload.cjs` an explicit runtime-mock production boundary and
  retain a regression that fails on the pre-fix source.
- Give the two affected capability specs meaningful Purpose sections.

**Non-Goals:**

- Reopen, move, or re-archive completed implementation changes.
- Claim ownership of `package.json.engines`, `test:all`, or the Vitest storage
  harness delivered by earlier commits.
- Narrow the supported Node range without a measured incompatibility.
- Change application runtime behaviour or add browser-driven verification.

## Decisions

### 1. Keep one append-only live-verification ledger under `openspec/`

Each row records change, behaviour, reason, recorded date, and current status.
The historical task gets a dated reference to that row and becomes unchecked;
the archive directory itself remains in place. A later live confirmation updates
the ledger status and date, providing one operational queue without erasing the
original record.

Reopening each change was rejected because its code is already shipped and the
defect is in the verification claim, not implementation state. Leaving only
notes inside eight archives was rejected because there would still be no single
queue.

### 2. Correct only explicit contradictions

The correction set is limited to checked operator-confirmation tasks whose own
archive says that check was left for the operator. Confirmations with an
explicit operator/date record and automated tasks that merely mention live data
remain untouched. This yields ten task corrections in eight changes, including
three separate checks in `adjust-isolated-position-margin`.

### 3. Preserve the support range and choose the pin from current evidence

Run the aggregate verification with both installed, supported executables
(`v24.11.0` and `v26.4.0`). Write `.nvmrc` only after a successful run, choosing
an exact passing release inside the unchanged `package.json.engines` range and
recording both outcomes in `tasks.md`. The final acceptance run uses that exact
binary against an archive of the staged tree.

Pinning before measurement was rejected because it would turn an assumption
into repository policy. Narrowing `engines` was rejected unless one installed
supported line demonstrably fails for a runtime-specific reason.

### 4. Treat preload as an independent production entry point

Add `electron/preload.cjs` to the runtime-mock guard's entry-point set. The
preload is built and loaded independently from Electron main and the renderer,
so relying on reachability from either graph root leaves a structural blind
spot. A focused regression will construct a bounded source graph with a preload
violation and assert that the ordinary guard check rejects it.

Scanning the preload as a special string outside the graph walker was rejected
because it would create a second rule path and omit dependencies reached from
the bridge.

### 5. Describe capability boundaries in their owning specs

The Spot history Purpose will name persisted and paged candle depth across
selection and restart boundaries. The Futures leverage Purpose will name reading,
presenting, and changing exchange-owned per-contract leverage and margin mode.
Requirements and scenarios remain unchanged.

## Risks / Trade-offs

- **A historical task later gains real confirmation** → Update the single ledger
  with confirmation date/status; do not silently re-check an archive without a
  matching record.
- **A supported future Node release regresses after `.nvmrc` is pinned** → The
  exact pin keeps the ordinary workflow reproducible while `engines` continues
  to express the broader supported contract; investigate before narrowing it.
- **Adding preload increases the walked-module count or reveals an existing
  violation** → Treat the result as a real production-boundary finding rather
  than lowering the module floor or allowlisting it without review.
- **Concurrent working-tree changes contaminate evidence** → Stage only this
  change, materialize it with `git write-tree` and `git archive`, and run final
  verification in that isolated copy with a symlink to the existing
  `node_modules`.

## Migration Plan

1. Create the ledger and correct the ten historical checkmarks in place.
2. Extend the production guard, then add and baseline its focused regression.
3. Replace the two Purpose placeholders.
4. Verify both installed supported Node versions and add `.nvmrc` from the
   successful evidence.
5. Stage only owned hunks and run the aggregate command from an archived staged
   tree on the pinned version.

Rollback removes `.nvmrc` and the guard/test changes and reverts the documentation
updates. Ledger history should be corrected forward rather than deleted once it
has been used to record later operator status.
