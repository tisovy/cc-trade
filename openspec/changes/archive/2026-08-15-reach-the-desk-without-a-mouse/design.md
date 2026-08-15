## Context

See `proposal.md` for the two reachability defects. The workstation uses
viewport media queries while its usable container is reduced by the
`futures-mode-view` horizontal padding. At the existing boundary, the narrow
template omits `dock`; immediately above it, the desktop tracks can be wider
than the grid content box. The two order lists already share `onOrderEdit`, but
the dock exposes it by click and the ticket by double-click only.

The implementation is limited to the workstation stylesheet, the two existing
order-row components, and their focused presentation tests. Order submission,
cancellation, contract selection, ALGO presentation, and editor internals stay
outside this change.

## Goals / Non-Goals

**Goals:**

- Select a breakpoint from measured Chromium geometry and keep every related
  `min-width`/`max-width` rule complementary.
- Give the narrow grid an explicit, readable `dock` area.
- Give only editable regular-order rows a named keyboard action, a visible
  focus indicator, and Enter/Space activation.
- Open the existing editor once at an anchor derived from the focused row.

**Non-Goals:**

- Changing click or double-click payloads, cancellation, contract switching,
  ALGO/triggered-order behavior, or any trading command.
- Changing the dock's data, editor behavior, chart, order book, account state,
  backend, or supported minimum window width.

## Decisions

### Use 845 px as the first desktop viewport width

The initial measurement correctly found the compact desktop track floor of
200 + 370 + 220 px plus two 1 px gaps, but its fixture did not reproduce the
fixed-height `.App` chain. The full audit materialized the committed change at
`b8abc8e` with `git archive` and loaded the real `html`/`body`/`#root`/`.App`/
`.futures-mode-view` hierarchy in Chromium 150 at device scale 1. At the
measured height the view owns a 15 px vertical scrollbar in addition to its
18 px horizontal padding. At viewport 844 px the grid client width is 791 px
and the desktop tracks scroll to 792 px. At viewport 845 px its client and
scroll widths are both 792 px.

Therefore narrow rules end at `max-width: 844px`, desktop-only rules begin at
`min-width: 845px`, and all rules that control desktop height containment or
narrow stacking move together. This leaves neither an uncovered width nor a
width where the compact desktop minimum tracks overflow. Keeping the initial
829/830 result was rejected because it omitted a real layout constraint;
choosing a round but unmeasured value was rejected because it would not prove
where the tracks fit.

The audit also measured the transition back to the base desktop tracks. Their
minimum is 240 + 420 + 270 px plus two 1 px gaps, or 932 px. The former compact
rule ended at 980 px; with the scrollbar, view padding, and grid border, the
base tracks overflowed from 981 through 984 px and first fit at viewport
985 px. The compact track rule therefore applies from 845 through 984 px, and
the base tracks resume at 985 px. These integer ranges are complementary.

### Make `dock` the seventh narrow grid row

The narrow template remains one column and keeps its current six areas in the
same order, then adds an `auto` row and the `"dock"` area after `"trades"`.
This gives the element whose existing `grid-area` is `dock` an explicit
placement spanning the readable narrow column. Relying on implicit placement
was rejected: at 760 px Chromium formed extra implicit tracks and placed the
dock in a 78.69 px-wide column even though the explicit template named no dock.

### Add keyboard activation without sharing pointer event paths

An order row is keyboard-editable only when it is a regular, non-ALGO order and
`onOrderEdit` is callable. In this model triggered parents are ALGO rows, so
they remain display-only along with every other non-editable row. Eligible rows
keep `role="row"`, receive `tabIndex={0}`, an `aria-label` that starts with the
action to edit and identifies symbol, side, and price, and an `is-editable`
class with a clearly visible `:focus-visible` outline.

Each component adds a row `onKeyDown` path for Enter and Space. It returns when
`event.target !== event.currentTarget`, isolating Cancel, Show-symbol, and any
future nested control whose key event bubbles through the row. Space calls
`preventDefault()` to prevent viewport scrolling. Repeated keydown events are
ignored (while repeated Space is still prevented), so holding either key cannot
open multiple editors. A supported non-repeated key calls `onOrderEdit` exactly
once with the unchanged order object and with an anchor at the center of
`event.currentTarget.getBoundingClientRect()`. The row rectangle, not zeroes or
simulated mouse coordinates, gives the floating editor a stable keyboard
position.

The dock's existing single-click handler and the ticket's existing
double-click handler remain the pointer paths and continue to forward the
event's `clientX`/`clientY` and the original order object. Nested controls keep
their existing actions. Reusing a synthetic click was rejected because it
would give keyboard activation mouse-like zero coordinates and could combine
with bubbling or browser activation into a double open.

### Prove eligibility and preserved guards at component boundaries

After production changes, focused tests cover Enter, Space, unsupported keys,
nested controls, ALGO/triggered rows, accessible names, focusability, and the
existing click/double-click payloads. A stylesheet assertion pins the seventh
narrow row, the `dock` area, complementary breakpoint queries, and the visible
focus selectors. The changed tests are also run against the archived baseline;
only failures caused by the missing dock placement or keyboard activation are
counted as biting tests.

## Risks / Trade-offs

- [More widths use the stacked layout] → The boundary is the first measured
  width where desktop tracks fit; the desktop layout is retained everywhere it
  is geometrically valid.
- [The full desktop tracks need more room than the compact tracks] → Keep the
  compact tracks through 984 px and resume the base tracks at their measured
  985 px fit point.
- [A row-level key handler could react to a nested button] → Require the event
  target to be the row itself and test Cancel and Show-symbol explicitly.
- [Space could scroll as it activates] → Prevent its default only for eligible
  row activation.
- [Holding an activation key could open the editor repeatedly] → Ignore repeat
  keydowns and test both activation keys on both row surfaces.
- [Keyboard anchoring could place the editor off-screen] → Use the real row
  center and retain the editor's existing viewport-clamping behavior.
- [Focus styling could alter pointer presentation] → Scope the outline to
  `.is-editable:focus-visible`; hover and pointer handlers remain unchanged.

## Migration Plan

Ship the CSS and row semantics together. Verification first runs on an isolated
staged tree, then the exact staged CSS is remeasured in Chromium at the baseline
widths. Rollback is the single change commit; there is no data or backend
migration.
