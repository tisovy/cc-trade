## Context

See `proposal.md` for motivation and the two delta specs for observable behavior. The ticket already derives a whole-USDT notional from an available-balance percentage, the shortcut confirmation holds a validated staged order, and the working-order editor owns a string notional draft and sends one exchange-filtered atomic amendment. Shared CSS already gives floating editors the same compact range-control treatment used by the ticket.

The percentage helpers originally accepted only integer percentages, and the editor was not given either the available USDT balance or the matching position. The change therefore crosses the sizing utility, the workstation-to-editor data boundary, three React surfaces, and shared presentation styles, but does not need a new process-level command or persisted state.

## Goals / Non-Goals

**Goals:**

- Keep the notional draft as the value that validation and submission consume.
- Make half-percentage sizing exact and deterministic before whole-USDT quantization.
- Reuse the existing Futures slider visual language and accessible control labels.
- Keep live account updates from silently overwriting an amount already chosen in the editor.
- Let the operator resize the staged shortcut order without weakening the explicit `Send` boundary.

**Non-Goals:**

- Change leverage, margin, exchange-filter, local-cap, or confirmation semantics.
- Add percentage stops to unrelated position-close, margin, or leverage controls.
- Redesign the ticket outside the sizing block or alter renderer/main-process messages.

## Decisions

### 1. Represent order-sizing percentages as exact half-step units

The paired notional/percentage helpers will validate an integer count of half-steps (`percent × 2`, from `0` through `200`) and perform the conversion against decimal atoms. Slider values such as `8.5` are exactly representable, while the resulting notional continues to be floored to whole USDT. The inverse conversion will choose the nearest bounded half-step so a manually typed amount can position the slider without rewriting the input.

This extends the existing exact-decimal path instead of multiplying balances with ordinary floating-point arithmetic. Introducing a second, UI-only calculation was rejected because the ticket and editor could then disagree at the same percentage.

### 2. Derive the editor's reference capacity from order intent

The workstation will provide the editor with the current available USDT balance and the matching normalized open position, without copying either into new application state. The editor will use its existing order-intent description to choose the reference:

- an entry uses the ticket's available-USDT basis;
- an exit values the reducible matching position at the current normalized draft price.

If the required account reference is absent, the slider is disabled while the text field and current validation path remain available. Passing one generic balance for both cases was rejected because the `SELL LONG` / `BUY SHORT` exit shown by the editor is limited by position size, not wallet balance.

### 3. Keep the editor notional as the single mutable draft

The slider percentage is derived from `notional` and the current reference capacity. Moving the slider writes a whole-USDT string into `notional`; typing writes the operator's string directly and only repositions the slider. A later balance or position update can change the displayed percentage but will not rewrite the chosen notional until the operator moves the slider again.

This preserves the editor's current submission pipeline and prevents background account synchronization from silently resizing a working order.

### 4. Move, rather than duplicate, the ticket readouts

The ticket slider row will retain only the `Size` label and range control. The existing highlighted percentage moves into the `Notional, USDT` label row, and the notional input receives a field-specific larger, bold style. Existing generic text-input rules remain unchanged so the selected-price field does not become visually over-emphasized.

The amount is not mirrored in a non-editable element; the input remains the only live USDT sizing value and therefore the clear source of truth.

### 5. Keep confirmation sizing inside the staged-order boundary

The confirmation receives a percentage value and change callback from the
ticket, while the ticket remains the owner of `pendingOrder`. A slider move
derives a new whole-USDT notional and exact draft at the already staged price,
then replaces only the staged size fields. It does not update the underlying
ticket amount and does not call the command path.

Entry confirmation sizing uses the same confirmed available-USDT reference as
the ticket. Exit confirmation sizing finds the live matching LONG or SHORT
position and values its absolute quantity at the staged price. When no required
reference exists, the slider is disabled without discarding the valid staged
order. An invalid low stop remains visible with its existing draft reason and a
disabled `Send` control, so the UI never displays one size while retaining a
different send payload.

### 6. Preserve the command and safety boundary

No slider submits directly. They only update drafts that continue through existing quantization, exchange-filter validation, local risk limits, confirmation, and atomic-amendment delivery. Production code will be changed before tests, in accordance with the repository workflow, and GitNexus impact analysis will precede every symbol edit.

## Risks / Trade-offs

- [A half-step percentage can map to the same whole-USDT amount as its neighbour on a small balance] → Keep the requested percentage visible while preserving the existing whole-USDT floor; validation still determines whether the resulting amount is actionable.
- [The matching exit position can disappear or change while the editor is open] → Recompute only the slider reference, preserve the notional draft, and rely on the existing current-state submission checks to refuse an invalid amendment.
- [An existing or typed amount can exceed the current reference capacity] → Preserve the explicit amount, clamp only the slider's visual position to `100%`, and leave the existing limit/refusal path authoritative.
- [A confirmation slider stop can fall below an exchange minimum] → Keep the selected staged amount visible, disable `Send`, and show the existing draft refusal until another stop is chosen.
- [The live exit position or entry balance can change while confirmation is open] → Recompute only the reference percentage; never rewrite the staged amount until the operator moves the confirmation slider.
- [Changing shared percentage helpers could affect current integer sizing] → Run GitNexus impact analysis before the utility edit and prove both legacy integer cases and new half-step cases with focused tests after production code lands.
- [Larger typography can crowd narrow or scaled tickets] → Scope styling to the notional field and verify the supported workstation scale range without changing the panel width.

## Migration Plan

No data or protocol migration is required. Land the sizing math and React/CSS changes together, run focused utility/component tests plus the repository UI checks, and leave archiving pending operator confirmation on live data. Rollback consists of reverting the renderer and sizing-helper changes; no stored state needs conversion.
