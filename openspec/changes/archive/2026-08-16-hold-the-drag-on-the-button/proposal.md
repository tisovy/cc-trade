## Why

The gesture is held by the wrong hand. The operator picks an order up with
Ctrl or Alt and the left button, drags it, and lets the key go on the way —
and the desk ends the gesture then and there:

> «когда я отпускаю alt или ctrl — ордер бросается и ставится»

The modifier is how a drag *starts*: it is what separates picking an order up
from every other left-button gesture on this chart. It became what the drag is
*held by* as well, and that is two jobs for one key. There are two ways it
shows:

- Releasing the key mid-drag abandons the gesture outright
  (`FuturesWorkstationChart.jsx`, the `keyup` listener at the drag): the mark
  stops following the pointer and the order goes back to the price it was
  lifted from.
- Releasing the key even a moment before the button throws the move away:
  `finishOrderDrag` reads `restored = canceled || !modifierHeld`, so the drop is
  treated as an abandoned drag and the order is placed back at its origin. The
  operator's fingers came off the key first, which is what fingers do.

Neither is a slip in the code — both were written deliberately, when the
gesture could not begin until the exchange had answered and the modifier was
the only thing that could end it early. What is wrong is the rule: on a desk
traded by mouse, a drag is held by the button that started it and ends when
that button comes up.

## What Changes

- The modifier begins a drag and is asked for nothing after that. Releasing it
  mid-gesture leaves the drag exactly where it is: still following the pointer,
  still the operator's.
- The drop is decided by the pointer alone. Releasing the button places the
  order at the price under the cursor, whatever the keyboard is doing.
- Abandoning a drag stays possible with the mouse alone: dropping the order
  back on the price it was lifted from — the level the chart keeps marked for
  exactly this — is still read as abandoning it, as is a gesture the system
  itself cancels.

## Impact

- `src/components/features/futures/FuturesWorkstationChart.jsx` — the `keyup`
  listener that abandons a live drag, and the modifier test in
  `finishOrderDrag`
- Spec: `futures-order-visibility` — the drag requirements that name the
  modifier as a way to end a gesture
- Runbook step 27, item 5, which today asks the operator to confirm the
  behaviour being removed
