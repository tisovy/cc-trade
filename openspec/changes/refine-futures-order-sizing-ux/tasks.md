## 1. Pre-edit safety

- [x] 1.1 Run upstream GitNexus impact analysis for every production symbol to be changed (`calculateFuturesNotionalForPercent`, `calculateFuturesNotionalPercent`, `FuturesProductionWorkstation`, `FuturesOrderEditor`, and `FuturesTradingTicket`), report direct callers/processes and risk, and pause for an explicit warning before edits if any result is HIGH or CRITICAL.
- [x] 1.2 Run upstream GitNexus impact analysis for `FuturesOrderConfirmation` and the newly changed `FuturesTradingTicket` staging path, report direct callers/processes and risk, and pause for an explicit warning before edits if either result is HIGH or CRITICAL.
- [x] 1.3 Run upstream GitNexus impact analysis for `FuturesOrderConfirmation` before adding the dedicated USDT emphasis hook, and report its direct caller/process risk.

## 2. Production implementation

- [x] 2.1 Extend the exact Futures order-sizing helpers to accept and derive bounded `0.5%` stops while continuing to floor calculated notionals to whole USDT.
- [x] 2.2 Resolve the working order's current entry balance or matching exit position in the workstation and pass only the sizing references needed by the floating editor.
- [x] 2.3 Add the compact synchronized `0–100%` order-size slider to the working-order editor, preserve direct amount entry, disable only the slider when its reference is unavailable, and keep submission on the existing validated atomic-amendment path.
- [x] 2.4 Restructure the execution ticket sizing markup so the slider has no duplicate amount, the highlighted percentage follows `Notional, USDT`, the range step is `0.5`, and the notional input alone receives larger bold styling.
- [x] 2.5 Add a separate compact `0–100%` confirmation slider with a `0.5` step, keep the working-order editor slider, re-derive only the staged draft from the direction-aware live reference, and preserve the explicit `Send` boundary.
- [x] 2.6 Add a confirmation-specific hook and bold styling to the displayed USDT size without changing the `Price` or `Position` typography.

## 3. Tests after production code

- [x] 3.1 Add utility tests for legacy integer percentages, exact half-percentage conversion, nearest bounded inverse conversion, and whole-USDT quantization.
- [x] 3.2 Add working-order editor tests for entry and exit references, slider-to-input updates, manual-input synchronization, unavailable-reference fallback, and unchanged validation/atomic submission.
- [x] 3.3 Add execution-ticket tests for the `0.5` range step, `8.5%` sizing, percentage placement, absence of the duplicate slider amount, emphasized notional field hook, and unchanged confirmation payload.
- [x] 3.4 Update the lazy Futures-shell regression assertion to expect the percentage beside the notional label and no duplicate slider amount while private execution is pending.
- [x] 3.5 Add shortcut-confirmation tests for initial synchronization, entry and exit resizing, exact updated send payload, unavailable-reference fallback, invalid-stop refusal, and unchanged editor-slider presence.
- [x] 3.6 Add a confirmation regression assertion for the dedicated bold-USDT presentation hook.

## 4. Verification and handoff

- [x] 4.1 Run the focused Vitest files for the sizing utility, working-order editor, and execution ticket; fix all regressions.
- [x] 4.2 Run lint, the production build, and the Futures workstation boundary check.
- [x] 4.3 Re-run `OPENSPEC_TELEMETRY=0 openspec validate refine-futures-order-sizing-ux` and `gitnexus detect-changes` to verify the implementation affects only the expected symbols and flows.
- [ ] 4.4 Have the operator confirm the ticket, working-order editor, and shortcut-confirmation sizing surfaces against live account/position data at normal and enlarged UI scales; do not archive the change before that confirmation.
- [x] 4.5 Re-run the focused sizing/editor/ticket tests plus lint, production build, and the Futures workstation boundary check after the confirmation correction.
- [x] 4.6 Re-run OpenSpec validation and staged GitNexus change detection for the corrected implementation before committing.
- [x] 4.7 Run the focused confirmation test, lint, OpenSpec validation, and staged GitNexus change detection for the bold-USDT refinement.
