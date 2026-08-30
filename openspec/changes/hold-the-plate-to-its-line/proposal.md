# Hold the plate to its line

## Why

The operator, 2026-08-30, with a screenshot of five SHORT plates stepping away
from their lines: «если я начинаю их двигать по плашкам — то линии начинают
смещаться и ордер вылетает со своей обычной цены… чем больше ордеров я ставлю,
тем больше происходит смещение и становится тяжело перемещать ордера».

Measured before writing, two defects compounding each other:

- `layoutOrderCoordinates` spread handles apart vertically with a 24px minimum
  gap and clamped the stack into the pane. Every plate after the first in a
  dense stack was drawn below its own line, and the displacement accumulated
  down the stack — exactly the screenshot, where lines are ~25px apart and the
  chain never recovers after the top clamp.
- `moveOrderDrag` read the pointer's absolute position: `price =
  coordinateToPrice(clientY - rect.top)`. A drag begun on a displaced plate put
  the order at the plate's position, not the order's — the "вылетает со своей
  обычной цены". Even on an undisplaced plate the first move jumped the price
  by up to the half-plate the pointer happened to land off centre.

## What Changes

- A handle is drawn with its centre on the line it prices, always. The old
  vertical anti-overlap is removed; only the plot's own edges may still
  displace a plate, by the half-plate that keeps it reachable.
- Handles whose lines sit closer than one plate height resolve the collision
  sideways: the later plate steps into the next free column, cleared past the
  widest plate of the column before it by the desk's column gap. Column widths
  are measured from the drawn plates before paint (ceiled from the fractional
  box — `offsetWidth` rounds a 129.3px plate down and quietly spends a third of
  the gap; measured in Chromium against the desk's own stylesheet). A plate
  clear of any collision rests at the gutter as before.
- A drag reads travel, not position: the grab records where the pointer landed,
  the pending price starts exactly at the order's resting price, and every move
  displaces it by how far the pointer has moved since. The absolute read
  remains only for a drag begun with no line coordinate to measure from.
- The CSS gutter rule carries the per-handle offset:
  `left: calc(8px + var(--handle-column-offset, 0px))`, shortened by the same
  amount, and the viewport suite's canon of that rule is restated to match.
- Follow-up, operator 2026-08-30 after seeing the columns live («убрать
  LONG/SHORT — оставить L/S и убрать слово USDT»): the plate's face shrinks
  to a one-letter leg and a bare notional, so a column of plates spends half
  the width it did (~129px → ~77–88px in the Chromium fixture). The full
  words stay on the titles and in the accessible names; `ALGO`, `exit` and
  the transient states keep theirs.

## Impact

- `src/components/features/futures/FuturesWorkstationChart.jsx` — layout,
  drag geometry, handle refs, one pre-paint measurement pass.
- `src/components/features/futures/FuturesWorkstation.css` — the owned-order
  `left`/`max-width` rule.
- `src/components/features/futures/FuturesWorkstationChart.test.jsx` — drag
  gestures now state where the grab landed; the same-price test asserts the
  shared line instead of the old spread; two new tests bite on the old code.
- No main-process code, no wire traffic, no order semantics: what is sent to
  the exchange is unchanged — only where plates are drawn and how the pointer
  is read.
