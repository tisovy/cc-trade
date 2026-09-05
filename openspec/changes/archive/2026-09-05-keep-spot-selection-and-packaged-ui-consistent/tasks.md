## 1. Implement the bounded fixes

- [x] 1.1 Implement selection generation, lifecycle cancellation, cache-failure fallback and stale-detail/queue isolation in production code; review the diff before adding regression tests.
- [x] 1.2 Configure separate release output, runtime allowlist and a packaged-archive gate in production build tooling; inspect the resulting configuration before adding tests.

## 2. Prove the changes

- [x] 2.1 Add and pass Spot component regressions for inverted cache completions, interval changes, A→B→A, failed/missing cache, old detail data, non-selection settings, disable/re-enable and unmount.
- [x] 2.2 Add and pass real-packager matcher and archive-contract regressions for required runtime assets and excluded checkout/environment files.
- [x] 2.3 Run the full suite, lint, production build and retained architecture guards; record exact results.
- [x] 2.4 Build a local Linux directory package without publishing or launching the app, and inspect the actual ASAR; document any environment limitation honestly.

## 3. Hand off and integrate

- [x] 3.1 Document packaging commands and local verification evidence, and record outstanding operator checks in the live ledger.
- [x] 3.2 Validate OpenSpec, review all own changes, run GitNexus detect_changes without partial/truncated output, and commit only this work directly to main.
- [x] 3.3 Operator confirms rapid Spot pair/interval selection and the packaged application window on live data; only then archive this change.

## Operator observation — 2026-09-05

The operator replied “проверил - вроде всё ок” after the requested ordinary
live check (default DevTools state and normal balances/history/charts).
This records ordinary-use acceptance, not an observed failure, forced trade,
key rotation, quota exhaustion, or packaged-build launch. Account and launched
revision were not supplied. Deterministic edge cases remain test-only evidence.
At that checkpoint the separately named packaged-window check remained outstanding; the ordinary-use report did not close it.
See [acceptance scope](../../../audit-live-acceptance-2026-09-05.md).

## Packaged-use follow-up — 2026-09-05

The later reply “все работает как надо” followed the explicit checklist for the
packaged application window, default-closed DevTools and rapid Spot pair/interval
switching on live data. It is accepted as operator sign-off for task 3.3, not an
independent test or proof of unobserved failure/race scenarios. Running revision,
account and package identity were not supplied. No trade was required or claimed.
Separate registry-audit disclosure and Git push are not authorized by this reply.
