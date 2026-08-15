## 1. Confirm the Path Is Unreachable

- [x] 1.1 Confirm that no module imports `buysell`, `cancel`, `cancelAll`, `serverDialog` or `balanceUpdate` from `src/utils/operations.js`, and that no test exercises them.
- [x] 1.2 Confirm that the only names taken from the module elsewhere are `formatVolumeShort`, `calculatePrecision` and `precisionTruncate`.

## 2. Delete It

- [x] 2.1 Remove `buysell`, `cancel`, `cancelAll`, `serverDialog` and `balanceUpdate` from `src/utils/operations.js`, together with any import the module then no longer needs.
- [x] 2.2 Leave `formatVolumeShort` and the `calculatePrecision`/`precisionTruncate` re-export exactly as they are, so every current importer keeps working.

## 3. Keep It Gone

- [x] 3.1 Prove by test or repository check that no renderer module sends a trading frame outside the typed command builders in `src/utils/tradingCommands.js`.
- [x] 3.2 Run unit and integration suites, lint, and the production-guard checks.
