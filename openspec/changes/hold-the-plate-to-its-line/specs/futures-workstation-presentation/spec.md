## ADDED Requirements

### Requirement: A handle rests on the line it prices

An order handle SHALL be drawn with its vertical centre on the y-coordinate of
the line it prices, at every count and density of working orders; a handle
SHALL NOT be displaced vertically to clear another handle. Only the plot's own
edges MAY displace a handle, and only by up to the half-plate that keeps the
whole handle on the pane and reachable.

Handles whose lines sit closer than one plate's height SHALL resolve the
collision sideways: the later handle steps into the next free column, cleared
past the widest plate of every column between it and the gutter by the desk's
column gap, with widths measured from the drawn plates rather than assumed. A
handle clear of any collision SHALL rest in the first column at the gutter.

A drag begun on a handle SHALL read the pointer's travel, not its position: at
the grab the pending price SHALL equal the order's resting price exactly,
wherever on the plate the pointer landed, and every move SHALL displace the
aimed price by the pointer's displacement since the grab. A drag begun where
no line coordinate is known MAY fall back to reading the pointer's position.

#### Scenario: A dense stack of orders

- **WHEN** several working orders rest within a few plate-heights of one another
- **THEN** every handle is drawn centred on its own order's line, and no handle
  is displaced vertically by a neighbour

#### Scenario: Two orders at one price

- **WHEN** two working orders rest at prices whose lines sit within one plate
  height of each other
- **THEN** both handles are drawn at their lines, the later one stepped
  sideways past the widest plate of the column before it, and both stay
  readable, draggable and cancellable

#### Scenario: The grab lands off the plate's centre

- **WHEN** the operator grabs a handle a few pixels off its centre and moves
  the pointer
- **THEN** the pending price starts at the order's resting price and moves by
  exactly the pointer's travel — the order does not jump by the landing offset

#### Scenario: An order's line reaches the pane's edge

- **WHEN** an order's line sits within half a plate of the plot's top or
  bottom edge
- **THEN** the handle is clamped only far enough to stay whole and reachable,
  and this is the one vertical displacement the chart may draw
