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

### Use 830 px as the first desktop viewport width

The baseline tree at
`9075216707e0468a18e511e6b5b5067732e17fb1` was materialized with
`git archive` and loaded in Chromium 150 at device scale 1. With the real
18 px horizontal workspace padding, the `max-width: 980px` desktop tracks have
minimum widths of 200 + 370 + 220 px plus two 1 px gaps. At viewport 829 px the
container is 793 px, the grid client width is 791 px, and its scroll width is
792 px. At viewport 830 px the container is 794 px and the grid client and
scroll widths are both 792 px.

Therefore narrow rules end at `max-width: 829px`, desktop-only rules begin at
`min-width: 830px`, and all existing rules tied to the former 760/761 boundary
move together. This leaves neither an uncovered width nor a width where the
desktop minimum tracks overflow. Keeping 760/761 was rejected because Chromium
measured a 69 px grid overflow at 761 px; choosing a round but unmeasured value
was rejected because it would not prove where the tracks fit.

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
`preventDefault()` to prevent viewport scrolling. A supported key calls
`onOrderEdit` exactly once with the unchanged order object and with an anchor at
the center of `event.currentTarget.getBoundingClientRect()`. The row rectangle,
not zeroes or simulated mouse coordinates, gives the floating editor a stable
keyboard position.

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
- [A row-level key handler could react to a nested button] → Require the event
  target to be the row itself and test Cancel and Show-symbol explicitly.
- [Space could scroll as it activates] → Prevent its default only for eligible
  row activation.
- [Keyboard anchoring could place the editor off-screen] → Use the real row
  center and retain the editor's existing viewport-clamping behavior.
- [Focus styling could alter pointer presentation] → Scope the outline to
  `.is-editable:focus-visible`; hover and pointer handlers remain unchanged.

## Migration Plan

Ship the CSS and row semantics together. Verification first runs on an isolated
staged tree, then the exact staged CSS is remeasured in Chromium at the baseline
widths. Rollback is the single change commit; there is no data or backend
migration.
