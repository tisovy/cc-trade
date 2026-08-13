## Why

Order sizing currently repeats a small USDT value beside the Futures ticket slider while the editable value itself is visually weak, and resizing a working order requires typing the full amount. The operator needs one clear amount readout plus fast, fine-grained sizing on both surfaces.

## What Changes

- Add a compact percentage slider to the floating working-order editor and keep it synchronized with `Amount, USDT`.
- Base an edited entry order on the same available-USDT sizing capacity as the ticket and an edited exit order on the matching open position, while preserving manual entry when that reference is unavailable.
- Use `0.5` percentage-point increments for the order-sizing sliders changed by this work and keep their calculated amounts quantized to whole USDT.
- Remove the duplicate USDT amount from the ticket slider header, move the highlighted percentage immediately after `Notional, USDT`, and make the editable notional value larger and bold.
- Preserve existing exchange-filter validation, local risk limits, atomic amendment semantics, confirmation behavior, and actionable failure reporting.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: the shared working-order editor gains synchronized, direction-aware percentage sizing.
- `futures-workstation-presentation`: the execution ticket gains a single emphasized notional readout and half-percentage sizing increments.

## Impact

- React surfaces: `FuturesOrderEditor`, `FuturesTradingTicket`, and the workstation data passed into the editor.
- Exact Futures sizing helpers used to translate percentages into whole-USDT notionals.
- Shared Futures execution-ticket/editor CSS and the associated component and utility tests.
- No renderer/main-process command contract, exchange adapter, persistence format, or dependency changes are expected.
