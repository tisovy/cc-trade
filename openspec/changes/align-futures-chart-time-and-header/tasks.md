## 1. Safety and production implementation

- [x] 1.1 Run upstream GitNexus impact analysis for every existing React symbol that will be edited, report direct callers, affected processes, and risk, and stop for operator review if any result is HIGH or CRITICAL.
- [x] 1.2 Add host-local axis-tick and crosshair-time formatters to the production Futures chart configuration without altering candle timestamps or series coordinates.
- [x] 1.3 Update the production instrument-rail CSS so up to three complete recent-contract rows use available height before internal scrolling, and replace inactive amber pill chrome with neutral styling while preserving selected and destructive states.
- [x] 1.4 Update the production market-header layout so its seven readings form the specified two-row pairs beside the selected symbol at supported desktop widths and retain a non-scrolling responsive fallback.

## 2. Tests written after production code

- [x] 2.1 Add focused chart tests for non-UTC local tick/crosshair formatting and unchanged Unix-second candle/volume coordinates.
- [x] 2.2 Update focused workstation view and CSS-contract tests for three complete recent rows without premature scroll allocation, neutral inactive pills, blue selection, and the paired two-row header layout.

## 3. Verification and handoff

- [x] 3.1 Run the focused Futures chart and workstation view test suites, then run the repository lint/verification commands appropriate to the changed renderer scope.
- [x] 3.2 Run `OPENSPEC_TELEMETRY=0 openspec validate align-futures-chart-time-and-header` and GitNexus change detection; confirm that only the expected chart-label and workstation-presentation symbols and flows are affected before any commit.
- [ ] 3.3 Present the renderer for operator confirmation on live data, including current local chart time, all nine recent contracts, neutral inactive-pill styling, and the compact header at the reported window size; leave archival pending until that confirmation.
