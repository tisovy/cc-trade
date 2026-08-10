## 1. A Completion Mark States Only What Was Done

- [ ] 1.1 Identify every archived change whose operator-confirmation item is checked while its own text records that no live check happened.
- [ ] 1.2 Record them in one live-verification ledger under `openspec/`, naming the change, the behaviour still unverified, and why it could not be verified.
- [ ] 1.3 Correct the marks in those archived `tasks.md` files to unchecked, with a dated note pointing at the ledger — the archive keeps the history, not a false claim.
- [ ] 1.4 Do not re-archive or re-open the changes themselves: the code shipped; only the verification claim was wrong.

## 2. A Passing Suite Is Reproducible

*Carried by `stabilize-vitest-web-storage`, which owns the Vitest storage contract. This change only adds the version declaration.*

- [ ] 2.1 Declare the supported Node range in `package.json` `engines` and pin it in `.nvmrc`, once `stabilize-vitest-web-storage` has established which versions pass.

## 3. The Guards Run With The Tests

- [ ] 3.1 Add a single verification script that runs lint, the suite and the three guard checks, and document it as the command to run before committing.
- [ ] 3.2 Extend `scripts/check-runtime-mock-layer.mjs` to cover `electron/preload.cjs`.
- [ ] 3.3 Prove by test or by a deliberate violation that the extended guard fails when the preload bridge imports the mock layer.

## 4. The Specs Say What They Are For

- [ ] 4.1 Write the `spot-chart-history` purpose.
- [ ] 4.2 Write the `futures-contract-leverage` purpose.

## 5. Verification

- [ ] 5.1 Run the new verification command from a clean tree on the pinned Node version.
