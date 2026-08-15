## Why

An external audit of the 2026-08-10 delivery found that the renderer can send
an order the operator never saw, and can report a command as delivered when it
never left the process.

- **The confirmation confirms one size and sends another.** The staging effect
  in `src/components/features/futures/FuturesTradingTicket.jsx:291` records the
  derived `price`, `quantity` and `notionalUsdt`, but `confirmPendingOrder`
  (`:243`) passes only `pendingOrder.price` to `submitLimitOrder` (`:211`),
  which re-derives the draft from the *current* `notionalUsdt` — a value
  computed from the current available balance and the current percent. A
  balance refresh between staging and confirming silently changes the size:
  the panel says 250 USDT, the exchange receives 500. The confirmation is the
  one place in the desk where what is read and what is sent must be the same
  numbers.
- **Panels close on a send that did not happen.** `sendCommand`
  (`src/hooks/useFuturesTrading.js:405`) returns `false` when the socket is
  closed, but `FuturesOrderEditor.jsx:71`, `FuturesPositionCloser.jsx:103` and
  `FuturesPositionMarginEditor.jsx:170` call `onSubmit?.(...)` and then
  `onClose?.()` unconditionally. A disappearing panel is how this desk says
  "done", so an operator reads a closed panel as a closed position.
- **An open editor can carry one object's draft onto another.** The panels are
  mounted without a `key`
  (`src/components/features/futures/FuturesProductionWorkstation.jsx:371`) and
  seed `price`/`quantity`/`amount` from props once. Re-targeting the editor at
  a different order or position keeps the first draft and submits it against
  the second identity.
- **Leverage is not clamped to a ceiling that arrives late.**
  `FuturesLeverageEditor.jsx:32` computes `picked ?? Math.min(current, ceiling)`
  — once the operator has picked, the ceiling no longer applies. Picking 100×
  under the placeholder 125× and then receiving `maxLeverage: 20` leaves 100×
  on screen and armed to send.

## What Changes

- **New capability** `futures-order-entry-fidelity`: what the operator confirms
  is what the exchange receives, and a control reports its own outcome.
- A staged order carries its full arithmetic. Confirmation sends those exact
  numbers; it re-checks readiness against the present state and *refuses* with
  a stated reason when the staged order no longer passes, but never re-sizes.
- Amend, close, margin and leverage panels stay open and state the failure when
  the command could not be sent.
- Every floating editor is keyed by the identity it edits, so a re-target
  discards the previous draft.
- A leverage pick is bounded by the ceiling at the moment of render and at the
  moment of submission, whenever the ceiling arrives.

## Impact

- Renderer only: `FuturesTradingTicket.jsx`, `FuturesOrderEditor.jsx`,
  `FuturesPositionCloser.jsx`, `FuturesPositionMarginEditor.jsx`,
  `FuturesLeverageEditor.jsx`, `FuturesProductionWorkstation.jsx`.
- Behaviour change visible to the operator: a confirmation whose staged size no
  longer fits the balance is refused rather than quietly resized, and a panel
  that fails to send stays on screen.
- Blocks live Futures: finding 1 is a wrong-size-order defect.
