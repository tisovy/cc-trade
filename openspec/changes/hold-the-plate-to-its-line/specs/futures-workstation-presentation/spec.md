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

### Requirement: The plate's face spends one letter on the leg and no unit on the value

An order handle's face SHALL name the position leg by a single letter — `L`
for LONG, `S` for SHORT — and SHALL state the order's notional as a bare
number with no unit word, because every character of plate is a candle
covered and colliding plates pay for their widest column in full. The full
leg word and the unit-qualified value SHALL stay readable under the cursor on
the elements' titles, and the accessible names SHALL keep their full wording.
The `ALGO` marker, the `exit` badge and the transient states (`lifting…`,
`triggered`, `placing…`) keep their words. The dragged mark SHALL wear the
same face as the resting plate it lifts.

#### Scenario: A resting order's plate

- **WHEN** the chart draws a working SELL SHORT order worth 22967 USDT
- **THEN** the plate reads `S` and `22967`, its titles carry `SHORT` and
  `22967 USDT`, and the accessible name still says the full
  `SELL SHORT … order at …`

#### Scenario: The unit survives where it is asked for

- **WHEN** the operator hovers a plate's value
- **THEN** the title states the exact notional with its unit

### Requirement: The plate's digits burn in the side's bright pair

The value on an order handle — and the price and value on the dragged mark —
SHALL be coloured by the order's side in the desk's bright digit pair: the
bright green the book's bids and the tape's buys write their numbers in for
BUY, the bright red of the asks and sells for SELL — lightened one step
toward white for the plate's small face, the step the operator asked for
after reading the pair at the plate's own size. The lightening SHALL be
declared as a mix over the book's own colour, taken from those rules rather
than restated, so the base cannot drift apart. The plate's frame,
leg letter and cancel control SHALL keep the plate's own dimmer side colour,
and the `exit` badge its quiet grey, so the digits outshine everything else
on the plate.

The digits SHALL carry enough stroke for the pair to reach full strength on
the screen: at a hairline size the antialiasing caps every pixel short of the
declared colour and the brightness never arrives — the operator's screenshot
sampled grey where the rule said bright red. Bold, at a size near the book's
own rows, is the floor.

#### Scenario: A wall of plates at a glance

- **WHEN** several buy and sell orders rest on the chart
- **THEN** each plate's value reads as a bright green or bright red number
  against its dimmer frame, a step lighter than the colours the book and the
  tape give those sides' numbers and unmistakably of the same tone

#### Scenario: The book's digit pair is retuned

- **WHEN** the desk changes the colour the book writes bid or ask numbers in
- **THEN** the plates' digits follow, because they are declared as that pair,
  not as a copy of it

#### Scenario: The declared colour reaches the screen

- **WHEN** a plate's digits are rendered at the plate's own size
- **THEN** the brightest pixels of the digits carry the pair's full colour,
  not an antialiased fraction of it — judged on the rendered frame, because
  the computed style states the declaration either way
