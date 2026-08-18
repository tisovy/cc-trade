## 1. Safety and production implementation

- [x] 1.1 Run upstream GitNexus impact analysis for every existing React symbol that will be edited, report direct callers, affected processes, and risk, and stop for operator review if any result is HIGH or CRITICAL.
- [x] 1.2 Add host-local axis-tick and crosshair-time formatters to the production Futures chart configuration without altering candle timestamps or series coordinates.
- [x] 1.3 Update the production instrument-rail CSS so up to three complete recent-contract rows use available height before internal scrolling while preserving the established recent-contract styling and selected/destructive states.
- [x] 1.4 Update the production market-header layout so its seven readings form the specified two-row pairs beside the selected symbol at supported desktop widths and retain a non-scrolling responsive fallback.
- [x] 1.5 Run upstream GitNexus impact analysis for `FuturesTradingTicket`, then keep the ordinary zero-size draft quiet while preserving disabled actions and actionable readiness, validation, gesture, and submission feedback.

## 2. Tests written after production code

- [x] 2.1 Add focused chart tests for non-UTC local tick/crosshair formatting and unchanged Unix-second candle/volume coordinates.
- [x] 2.2 Update focused workstation view and CSS-contract tests for three complete rows without premature scroll allocation, preserved recent-pill styling, selected state, and the paired two-row header layout.
- [x] 2.3 Add focused ticket tests for a quiet zero-size draft, retained action gating, accurate positive-draft validation, and retained operational/gesture feedback.

## 3. Verification and handoff

- [x] 3.1 Run the focused Futures chart and workstation view test suites, then run the repository lint/verification commands appropriate to the changed renderer scope.
- [x] 3.2 Run `OPENSPEC_TELEMETRY=0 openspec validate align-futures-chart-time-and-header` and GitNexus change detection; confirm that only the expected chart-label and workstation-presentation symbols and flows are affected before any commit.
- [x] 3.3 Record the operator's live confirmation of current local chart time, all nine recent contracts, and the compact header; obtain confirmation that the zero-size ticket no longer shows the misleading filter error, then archive.
- [x] 3.4 Audit the complete change against its proposal, delta spec, design, production diff, responsive CSS contracts, and trading-safety behavior; fix every in-scope defect found before handoff.
- [x] 3.5 Re-run focused and full automated verification, OpenSpec validation, GitNexus change detection, and staged-scope review before the final implementation commit.
