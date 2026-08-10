## 1. A Store Keyed by the Contract

- [x] 1.1 Add `src/utils/futuresBookView.js` beside `futuresTapeSettings.js`, over the same `readStorage`/`writeStorage` helpers, holding one map of symbol to `{ sideMode, stepMultiplier }`.
- [x] 1.2 Validate a restored entry exactly as fresh input: the side mode must be one of the three, the step must be one of the grouping multipliers, and the symbol must look like a symbol. Anything else falls back to the default instead of being applied.
- [x] 1.3 Bound the map and evict least-recently-written first, so a year of contracts cannot grow the key without limit.
- [x] 1.4 State in the comment why this is per contract and not one global setting: the step is a multiple of the contract's own tick, and the same multiplier is a different share of price elsewhere.

## 2. Restoring Instead of Resetting

- [x] 2.1 Restore both controls on selection, replacing the step's blanket reset to 1× and the side mode's survive-the-switch-but-not-the-restart behaviour.
- [x] 2.2 Write the entry when the operator changes either control — the choice, not every render.
- [x] 2.3 A contract with nothing stored opens at both sides and 1×, unchanged.
- [x] 2.4 A restored step is validated twice: against the grouping multipliers on read, and against the selected contract's own steps by `activeGroupStep`, which renders ungrouped where the contract has no such step rather than selecting one it cannot offer.

## 3. Verification

- [x] 3.1 `npx vitest run` — 88 files, 1,123 passed, with util cases for a malformed entry, an unknown multiplier, a store that is not a map, the eviction bound and rewrite-as-recency, and view cases for restore-on-return, a first-seen contract and a restart.
- [x] 3.2 `eslint` clean on every file this change touches.
- [x] 3.3 `npm run check:futures-production` passes.
- [x] 3.4 Operator confirms that a contract comes back with the step and sides it was left with, across a restart. — closed by the operator on 2026-08-10 rather than reported checked.

## 4. Stated Limits, Not Fixed Here

- [ ] 4.1 On a contract whose filters have not arrived the step control is not drawn and the book renders ungrouped; the remembered step applies when the filters land.
- [ ] 4.2 The store is local to the machine, like the tape settings. Nothing is synchronized between desks.
