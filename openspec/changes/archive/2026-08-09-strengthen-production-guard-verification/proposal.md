## Why

An audit of `restore-futures-trading-and-tune-tape` (2026-08-09) confirmed its behavioral claims but found that two of its guarantees rest on verification that does not actually verify, and one sanitized error is classified in a way that produces useless retries.

- The MARK overlay was removed from `FuturesWorkstationChart.jsx`, but `FuturesWorkstationChart.test.jsx` contains no `mark`, `MARK`, or `INDEX` assertion. Nineteen tests cover rulers, gestures, and order handles; none would fail if a MARK series, price line, or label returned, or if the INDEX reference disappeared.
- `scripts/check-runtime-mock-layer.mjs` walks only **relative** import specifiers and matches six literal symbol names. A mock reintroduced under a different name passes. A production module reached through a bare or aliased specifier is never walked, and its whole subtree silently leaves the graph — the script still prints success with a smaller module count that nothing compares against a floor.
- `sanitizeFuturesAccountError` returns `retryable: true` for every unclassified failure, including 4xx responses such as 404, where retrying cannot succeed.

None of this is a live-trading defect. All three weaken the guarantees the previous change was built to provide, so a later regression would land silently.

## What Changes

- Assert MARK absence and INDEX presence directly in the chart test suite, so re-adding a MARK series, horizontal line, label, or autoscale contribution fails a test rather than passing review.
- Harden the runtime-MOCK graph check: resolve aliased and bare specifiers that point at first-party modules, fail when the reachable module count drops below a recorded floor, and detect generic synthetic-data shapes rather than only six historical names.
- Classify non-retryable HTTP client errors as non-retryable in `sanitizeFuturesAccountError`, keeping the existing exchange-code classifications unchanged.
- Rename the runtime-MOCK check's reporting so it states that it inspects the production **source graph**, distinct from `check-electron-build-artifacts.mjs`, which inspects built artifacts.

## Capabilities

### Modified Capabilities

- `futures-live-readiness`: the "runtime mock behavior does not exist" guarantee gains a verification requirement strong enough to survive renaming and graph gaps; account-error retryability becomes accurate.
- `futures-workstation-presentation`: MARK removal becomes a machine-checked property instead of a reviewed one.

## Impact

- `src/components/features/futures/FuturesWorkstationChart.test.jsx` — added assertions only; no component change expected.
- `scripts/check-runtime-mock-layer.mjs` — resolution logic, floor check, reporting text.
- `electron/services/futures-account-state.js` and its test — one classification branch.
- Reopens task 7.4 of `restore-futures-trading-and-tune-tape`, which was marked complete without the assertions it describes.
- Risk is low and contained to verification code. The one behavioral change is retryability, which affects whether a failed resource offers Retry — no order path, signing, or transport is touched.
