## 1. Re-verify the audited defect

- [x] 1.1 Read the gate in current `main` (a859766). It stands as audited:
  `setPositionAnnotationCoordinates` compares only `key`, `price` and `y`, and
  `futuresPositionIdentity` builds the key from the raw `positionSide`, which a
  one-way account reports as `BOTH` in both directions
  (`normalizePositionSide` maps `BOTH` to null and the presentation derives the
  side from the quantity's sign — the identity does not).

- [x] 1.2 Reproduce it. Rendered the chart with a one-way short
  (`positionSide: 'BOTH'`, `quantity: '-0.5'`, entry 59900, no liquidation
  figure), then re-rendered with `quantity: '0.5'` — same entry, same viewport.
  Pre-fix the DOM keeps `aria-label="ENTRY SHORT at 59900"` with class
  `is-sell` on what is now a long; the entry price line is redrawn from the
  position, the plate is not.

## 2. Fix

- [x] 2.1 Compare everything the annotation renders in the equality gate:
  `kind`, `label` and `tone` join `key`, `price` and `y`. A pass that truly
  changed nothing still returns the previous array, so the gate keeps doing the
  job it was built for.

## 3. Proof

- [x] 3.1 The regression bites. With the fix stashed and the test kept
  (`git stash push -- src/components/features/futures/FuturesWorkstationChart.jsx`),
  `npx vitest run src/components/features/futures/FuturesWorkstationChart.test.jsx
  -t 'renames the entry annotation'` fails: 1 failed | 53 skipped. The failing
  assertion is `await screen.findByRole('note', { name: 'ENTRY LONG at 59900' })`
  at FuturesWorkstationChart.test.jsx (TestingLibraryElementError: the printed
  DOM still holds the `ENTRY SHORT at 59900` span with class `is-sell`).
  `git stash pop` restored the fix.

- [x] 3.2 `npx vitest run src/components/features/futures/FuturesWorkstationChart.test.jsx`
  with the fix in place: 54 passed (54).

- [x] 3.3 `npx eslint` on the two touched files: clean.

## 4. Handoff

- [x] 4.1 Exported the change as a staged patch
  (`scratchpad/fixes/refresh-entry-annotations-on-a-flip.patch`) from the
  isolated worktree. Nothing committed — the operator applies and commits from
  the live tree.

## 5. Self-Audit Corrections (2026-08-20)

- [x] 5.1 The sibling `orderCoordinates` gate in the same function had
  exactly the staleness this change fixed for annotations, and worse: it
  compared only identity, displayPrice and geometry, and returned the
  previous array — the one holding the OLD order objects the handles render
  from and the drag reads from. Runtime-proven on the pre-fix tree: a
  partial fill left the plate stating the full notional (29950 for a
  0.3-remaining order) until the scale moved, an ALGO firing without a
  stated actualPrice never said "triggered", and a drag begun after a
  partial fill computed its replacement from the stale quantity — re-adding
  exposure. The gate now applies this change's own rule ("everything the
  render consumes takes part in the comparison") via a field-by-field
  record comparison (`sameOrderRecord`), which closes the whole class
  rather than today's fields: the store replaces a row wholesale on any
  exchange update, so field equality is exactly "nothing changed".
  Bites, recorded pre-fix: *redraws an order plate when its fill state
  changes under a still viewport* — plate held `29950 USDT` where
  `17970 USDT` was asserted; *says an algo order triggered even before its
  fill price is stated* — no `triggered at 59750` note appeared.
- [x] 5.2 `npx vitest run src/components/features/futures/FuturesWorkstationChart.test.jsx`
  — 64 passed (64) on the merged tree.
