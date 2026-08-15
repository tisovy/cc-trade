## Context

See `proposal.md` for motivation. The workstation already has a complete compact
Chromium scrollbar rule for the aggregate-trade tape and portfolio tables, while
the recent list, catalogue list, and shrinkable execution-ticket body use either
only the standards fallback or native chrome. The chart toolbar is a flex row
whose four chart actions are rendered as long text labels and whose container
falls back to `overflow-x: auto`.

The chart actions are local display state in `FuturesWorkstationView`; their
accessible names are already used by focused tests and must remain stable.

## Goals / Non-Goals

**Goals:**

- Share one scrollbar owner selector and one six-pixel visual treatment across
  every deliberate workstation scroll surface named by the spec.
- Make the chart tools visually compact without changing their behavior or
  accessible interface.
- Remove the desktop toolbar's horizontal scrollbar rather than merely recolor
  it.

**Non-Goals:**

- Hiding required overflow, replacing native scrolling mechanics, or adding a
  custom JavaScript scrollbar.
- Changing chart drawings, display alerts, intervals, or market-data behavior.
- Restyling arbitrary scroll containers outside the futures workstation.

## Decisions

### Extend the existing native-scrollbar selector

The existing `::-webkit-scrollbar` rules will add the recent-contract group,
searchable contract list, and execution-ticket body to the same `:is(...)`
selector as the tape and dock tables. The gated standards fallback will use the
same owner list. This preserves native wheel, keyboard, touchpad, and drag
behavior while removing bright track and arrow chrome.

A JavaScript scrollbar component was rejected because it adds focus, sizing,
dragging, and accessibility failure modes to controls that Chromium already
implements correctly. A workstation-wide wildcard selector was rejected because
it would silently style accidental overflow instead of making every owner
explicit.

### Use inline SVG chart-tool icons with stable labels

Each chart action will remain a native `button` and receive its current full
action text through both `aria-label` and `title`. Small current-color inline SVGs
will depict horizontal line, clear drawings, add alert, and clear alerts. SVGs
avoid an icon-font dependency and remain crisp at the workstation's 70–160%
interface scale.

Unicode-only symbols were considered but rejected because bell, eraser, and
clear variants differ materially across OS fonts. External icon packages were
rejected for four static shapes.

### Make desktop overflow impossible by sizing the actions

The drawing/alert buttons will become square flex items and the toolbar will use
`overflow: hidden` at desktop widths. The existing mobile stacked layout remains
available below 761px, where the groups can occupy separate rows without a
horizontal scrollbar. This removes a redundant scroll owner instead of styling
it.

## Risks / Trade-offs

- [An unfamiliar icon can slow first use] → Keep complete pointer titles and
  accessible labels, and use conventional line, eraser, bell-plus, and
  bell-clear shapes.
- [A fixed square target can become too small at 70% scale] → Retain a practical
  unscaled minimum hit area while scaling the glyph with the interface.
- [A newly added scroll owner could be missed later] → Keep the owner list
  explicit and verify it in the focused CSS contract test.

## Migration Plan

No data migration is required. Ship the icon markup and CSS together. Rollback
restores text labels and the previous owner selector; no drawings, alerts,
positions, orders, or persisted preferences are changed.
