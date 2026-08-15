## Why

Order sizing currently repeats a small USDT value beside the Futures ticket slider while the editable value itself is visually weak, resizing a working order requires typing the full amount, and the confirmation opened by a trading shortcut cannot be resized in place. The operator needs one clear amount readout plus fast, fine-grained sizing through the full order-entry path.

## What Changes

- Add a compact percentage slider to the floating working-order editor and keep it synchronized with `Amount, USDT`.
- Base an edited entry order on the same available-USDT sizing capacity as the ticket and an edited exit order on the matching open position, while preserving manual entry when that reference is unavailable.
- Add a separate compact percentage slider to the shortcut confirmation popup so the staged order can be resized before `Send`, emphasize its displayed USDT amount in bold, and keep the working-order editor slider in place.
- Base a confirmed entry on the current available-USDT capacity and a confirmed exit on the matching open position, and update the staged quantity and position projection without submitting from the slider itself.
- Use `0.5` percentage-point increments for the order-sizing sliders changed by this work and keep their calculated amounts quantized to whole USDT.
- Remove the duplicate USDT amount from the ticket slider header, move the highlighted percentage immediately after `Notional, USDT`, and make the editable notional value larger and bold.
- Preserve existing exchange-filter validation, local risk limits, atomic amendment semantics, the explicit confirmation/send boundary, and actionable failure reporting.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: the shared working-order editor gains synchronized, direction-aware percentage sizing.
- `futures-workstation-presentation`: the execution ticket gains a single emphasized notional readout and half-percentage sizing increments, and its shortcut confirmation gains staged percentage sizing.

## Impact

- React surfaces: `FuturesOrderEditor`, `FuturesTradingTicket`, `FuturesOrderConfirmation`, and the workstation data passed into the editor.
- Exact Futures sizing helpers used to translate percentages into whole-USDT notionals.
- Shared Futures execution-ticket/editor CSS and the associated component and utility tests.
- No renderer/main-process command contract, exchange adapter, persistence format, or dependency changes are expected.
