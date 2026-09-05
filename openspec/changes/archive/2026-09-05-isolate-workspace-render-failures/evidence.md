# A03 evidence — 2026-09-05

Later ordinary-use operator acceptance is recorded in [tasks](tasks.md).
Pending-live wording below describes the implementation checkpoint; no
unobserved edge case becomes live-confirmed through archival.

## Decisions and implementation

- The outer boundary is below GatewayProvider/market controls and above Suspense/workspace providers. An outer failure offers explicit interface reload, never automatic reload/retry.
- Spot DataProvider/alert/drawing owners and the Futures trading hook stay above content boundaries. Manual content retry remounts presentation, not account/trading state. Smaller Spot chart/analytics boundaries preserve sibling order controls and private-state warnings.
- Recovery distinguishes local socket/activation facts from unverified account/order visibility, warns that exchange orders may still be active, and does not display exception contents. Recovery code sends no trading command and clears no user storage.
- Healthy children receive no new wrapper DOM. Styles provide a readable, keyboard-focusable fallback.

## Verification

Production preceded tests. Added eight injected-failure cases across boundary units, App lazy shell, Spot controls and Futures ownership. Targeted six-file run passed 28 tests. Cases cover sibling survival, manual-only retry, persistent failure, no raw exception text, market switching after outer failure, Spot owner survival through a failed initializer, Futures owner/unresolved-outcome retention, and no trade sends during recovery.

Full `npm run test:all`: **145 files / 3440 tests passed**, lint, renderer/main/preload build and every architecture gate. Gates: 319 cycle-free source files, 162 MOCK-free runtime modules, 24 Futures implementation files, 130 command-path modules. Strict OpenSpec validation and whitespace checks passed. Log: `/tmp/render-recovery-verified.log` (ephemeral).

One full run emitted `TimeoutNaNWarning`. A repeat with `NODE_OPTIONS=--trace-warnings npm run test` also passed all 3440 tests and traced it to `dom-helpers` → `react-bootstrap` transition-end emulation in the test DOM, not the new outbox deadline or boundary implementation. It is recorded, not concealed with a warning suppression. Existing Babel/ESLint environment warnings remain non-failing.

## Graph/source audit

Named React impact walks report LOW/empty; exact-file imports and JSX were inspected rather than treating zero callers as unused. `renderDepthView` reaches SpotWorkspaceContent. Refreshed index: 12903 nodes / 20517 edges. MCP all and compare/main each report 15 changed files / 64 nodes / one process, medium, no partial/truncated flags. Exact production counts (App 9, Spot 11, Futures 2, boundary 6, recovery 2) are below the internal 20-node/file cap. JSX/lazy rendering still has graph gaps, covered by source and runtime tests; no whole-program safety claim.

## Remaining acceptance and limitations

No error was injected into a live trading desk and no packaged UI was launched for this change. Operator live confirmation remains pending; no archive. Error boundaries do not catch arbitrary async/event-handler/main-process failures or failure of the gateway itself. An outer reload can lose in-memory outcomes, so recovery warns against resubmission and does not claim that orders were cancelled or absent. A persistent cause may fail again until fixed.
