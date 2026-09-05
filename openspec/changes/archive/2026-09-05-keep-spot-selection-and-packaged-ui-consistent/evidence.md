# Local verification — 2026-09-04

Later operator acceptance is recorded in [tasks](tasks.md) and the
[acceptance record](../../../audit-live-acceptance-2026-09-05.md).
The pending-acceptance wording and package versions below describe the original
local checkpoint, not the current archive status or the operator's package identity.

Scope: audit F03/F04 only, starting from `aae31e6` on `main`. No trading
transport, dependency version, credentials, external service, or existing
candle-store change was modified. Production code preceded regression tests.

## Implementation

- Spot openings carry a monotonically unique request and an owned cache effect.
  Selection invalidates old work synchronously, clears rows/history/queued
  candles, and suppresses the previous subscription while cache loading.
- The effect discards obsolete/disabled/unmounted completions, preserves newer
  panel settings, and requests live data on cache miss or rejection.
- Detail channel and legacy chart/trade/depth paths reject abandoned selection
  data; global account messages remain independently consumable.
- Installer output is `release/`, with only renderer output, production
  main/preload and normal production dependencies packaged. Environment files
  and source maps are excluded. Build output is ignored by lint/test discovery.
- `afterPack` inspects the actual ASAR, verifies production bundle markers and
  dependencies, rejects unexpected first-party/environment files, and compares
  all renderer files including lazy chunks with the archive.

## Automated evidence

- First full `npm run test:all`: 136 files / 3,167 tests passed, lint passed,
  normal build passed, circular check passed (304 source files), runtime mock
  boundary passed (155 modules), Futures boundary passed (24 implementation
  files), command-path check passed (126 renderer modules, one builder).
- This includes 13 new Spot selection cases in StrictMode and 41 packaging
  cases using the installed `app-builder-lib` matcher and a real temporary ASAR.
- Final follow-up adds explicit legacy/global-account isolation and a missing
  production dependency case: **136 files / 3,169 tests passed in 24.53 s**,
  followed by successful lint, normal build and all four static gates. The new
  cases total **56** (14 Spot / 42 packaging). Local full-run log:
  `/tmp/cc-trade-audit-fixes-verification.log` (temporary, not committed).
- OpenSpec strict validation of this change passed; global validation passed
  all **24** items (14 changes / 10 specs), with no failures.
- Existing non-fatal warnings: ChartWrapper `act(...)`, `TimeoutNaNWarning`,
  stale baseline-browser data and Babel's existing large-file notice. The burst
  teardown also logged socket-not-connected warnings; test cadence was held and
  the timing assertions passed. No warning is presented as a newly resolved defect.

## Real local package

`electron-builder --linux --dir --publish never` succeeded on Linux x64 with
the installed Electron 39.2.2. It rebuilt native optional dependencies and
downloaded the matching Electron binary. No package was published or launched.

The real `afterPack` check passed: **2,231 files / 10 renderer build files**.
The archive contains `dist/index.html`, all current JS/CSS workspace and shared
chunks, `dist/vite.svg`, `dist-electron/main.js`, `dist-electron/preload.cjs`,
and all 11 manifest production dependencies. No first-party source, OpenSpec,
scripts, or archived implementation entered the archive. Standalone archive
inspection also passed.

Initial local packaging could not rebuild native dependencies inside the sandbox;
the approved unrestricted local packaging run resolved that environment issue.
The first archive-fixture run exposed leading-slash paths in ASAR listings;
the gate now normalizes them before querying entries, and both fixture and real
packaging pass. These failed intermediate checks are not hidden as final success.

## Graph review

Bound repository: GitNexus `trade_ui_latest`, primary checkout
`/home/me/work/trade_ui_latest`. Index was refreshed at `aae31e6` before edits.
`loadCachedFirst` impact: LOW, one direct caller `DataProvider`; its context
contains the cache read. React property callbacks and configuration files are
not fully represented by this installed graph version, so their zero/missing
results were treated as unresolved and supplemented with source call sites
and real configuration-consumer tests.

The installed CLI has no `detect-changes` command. Its real MCP server provides
`detect_changes`; sandboxed child `git` was blocked by EPERM, so the approved
read-only MCP call was used. The preliminary tracked-file check reported
17 symbols / 4 processes / MEDIUM, not zero impact.

After forcing a working-tree index refresh (12,445 nodes / 19,831 edges), both
final `detect_changes(scope: all)` and `scope: compare, base_ref: main` included
all 19 staged files and reported 120 nodes / 4 processes / **MEDIUM**, with no
partial/truncated flags or query errors. The tool is file-coarse and uses
substring path matching plus a 20-node-per-file cap in this installed version.
Therefore its 120 is not a count of actually edited functions or a complete
node inventory. Exact-path, uncapped graph queries additionally inspected every
indexed changed file: 138 nodes in 16 files; all executable files have fewer
than 20 nodes and are fully represented. The extra three files are `.gitignore`,
change YAML and this subsequently added evidence document, reviewed as text.
The uncapped process query independently returned the same four flows:
DataProvider → RequireArguments / NormalizeStorageKey / HasBrowserStorage /
NormalizeSymbolKey. Full ordered graph steps were inspected with Cypher because
the installed process resource did not resolve process IDs. Callback edges and
the new packaging hook remain bounded by the explicit consumer checks above,
not by an assertion that zero graph processes means no risk.

## Outstanding acceptance

See task 3.3 and `openspec/live-verification-ledger.md`. The operator has not
confirmed rapid switching on live public data or launched the packaged window.
No service was restarted; no live order, credential operation or account query
was sent. The change remains active, not archived.

F01/F02/F05, P2 findings and architectural risks are not closed by this batch.
The package still uses the previously audited dependency versions; successful
packaging does not establish security release readiness.
