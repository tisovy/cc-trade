## Why

Two faults in the instrument column, both reported by the operator, both measured
in a real layout engine rather than reasoned about.

**The contract list renders as a stack of hairlines.** The list is a grid inside a
flex column, so its height is decided from outside; its rows each clip their own
overflow, which makes their minimum size zero. Chromium then fits four hundred
auto tracks into 180 pixels by squeezing every row down to its two border pixels.
The rail keeps its scrollbar and loses its text. The operator has reported it, ten
launches running, as "the RECENT list is empty again" — and read it correctly:
nothing in that panel is legible. Measured: `rowH: 2` against a content height of
30.

Underneath it, a second squeeze. The list is the only shrinkable item in a column
whose other occupant — the execution ticket — never shrinks. A ticket tall enough
(a few working orders is enough) drives the list to zero height outright.
Measured: `listH: 0` with a 700px ticket.

**The working-order rows do not fit the column.** At 260px the price cell is cut
for anything past five significant digits and the USDT cell for anything past
four: the operator's own screenshot shows `0.03…` and `50…`, and the fixture
reproduces exactly those four cells. The ticket has already given up everything it
can — the quote asset is off the symbol, the unit is in the column head, the
contract count is in a title. What is left is the column.

## What Changes

- The contract list sizes its rows from their content, so a rail holding the whole
  catalogue scrolls instead of flattening, and keeps a floor of three rows beside a
  ticket of any height.
- The instrument column widens from 260px to 300px (240px at its narrowest, and
  240px in the narrow-window layout). The chart column absorbs it.

## Impact

- Affected specs: `futures-workstation-presentation`
- Affected code: `src/components/features/futures/FuturesWorkstation.css`
- No behaviour changes outside layout: nothing is read, sent or computed
  differently.
