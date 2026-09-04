## Context

See proposal.md for audit findings F03/F04. Work starts at `aae31e6` on `main`.
GitNexus was reindexed to that commit: `loadCachedFirst` has one direct caller
(`DataProvider`, LOW); callback property access and package configuration are
unresolved by the installed graph version and were confirmed by source search.
SpotWorkspace, UpperPanel, InfoPanel, AnalyticsPanel and InputCoin invoke the
panel callback. No production function outside the Spot provider is changed.

## Goals / Non-Goals

Keep selection, cache, live channel and displayed rows consistent; ship the
runtime files at the paths the existing loader expects. Do not redesign the
gateway, change trading outcomes, update dependencies, introduce a browser
runner, or claim live acceptance from local fixtures.

## Decisions

1. Mint a monotonic selection generation synchronously in the selection callback.
   Drive the cache read in a cancellable effect tied to the selected request and
   Spot lifecycle. Check both generation and effect cancellation before any
   asynchronous state commit. Comparing symbol/interval alone would fail A→B→A.
   Restart only the latest pending opening when Spot is re-enabled.
2. Clear chart rows, history request, queued candles and throttle timer on
   selection change. Filter incoming detail data against the requested selection
   as well as the active subscription during cache loading. Retain global account
   facts and mini-chart handling unchanged. Preserve non-selection panel settings
   changed while the cache was pending.
3. Catch cache read failures locally and continue to the current subscription;
   IndexedDB is an optimization, not a prerequisite for market data.
4. Configure electron-builder output under `release/`, with an explicit built
   renderer/main/preload allowlist. Keep the packager's production dependency
   traversal; do not hand-pick a partial dependency list. Explicitly exclude
   environment files and source maps within otherwise allowed output.
5. Use the installed packager's matcher in regression tests and inspect the
   actual `app.asar` in an `afterPack` hook. Check its main/preload, renderer
   entry and built assets, and reject unexpected first-party paths. No GUI
   automation or production trading process is needed for this gate.

## Risks / Trade-offs

- A cache read cannot necessarily be physically cancelled → stale completions
  are discarded; no unbounded retry loop is added.
- Re-enabling Spot can require a fresh cache read → limited to the latest target.
- An allowlist can omit future runtime assets → archive contract and packaging
  documentation require deliberate additions.
- Packaging may need a cached Electron binary/build utilities → report packaging
  limitations explicitly; never equate matcher tests with a launched installer.
- Native dependencies and platform installers remain platform-specific → inspect
  the Linux directory package here, retain operator launch acceptance separately.

## Migration Plan

No persisted data migration. Commit after unit, lint, build, archive/static and
GitNexus change checks. Roll back this commit if required; caches remain usable.
Keep the change unarchived until the operator confirms rapid Spot selection and
the packaged window on live data. No service restart or exchange mutation is
part of implementation verification.
