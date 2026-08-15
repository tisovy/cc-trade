## ADDED Requirements

### Requirement: A frame redraws the panel it belongs to and no other
The workstation SHALL redraw the order book only for a frame that changes the
book, and the tape only for a frame that changes the tape. What a frame costs to
draw SHALL NOT depend on how much of the panel it did not change: a print SHALL
cost the same whether two levels a side are on screen or twenty-four.

This replaces coalescing depth deliveries to an animation interval, which was
measured and does not pay. The exchange sends depth ten times a second and the
tape is throttled to four; against the sixty an animation interval allows there
is nothing to coalesce, and the one case there was — a burst on a socket that
stopped accepting bytes — is already collapsed in the transport, where the newer
book replaces the undelivered older one. What the burst actually cost was paid in
the panel: every frame of either kind rebuilt both ladders and every tape row.

#### Scenario: A print arrives
- **WHEN** a tape frame arrives and the book has not changed
- **THEN** the tape rows are redrawn and the book rows are not

#### Scenario: A book update arrives
- **WHEN** a depth frame arrives and the tape has not printed
- **THEN** the book rows are redrawn and the tape rows are not

#### Scenario: A frame changes both
- **WHEN** a frame carries both a new book and a new print
- **THEN** both are redrawn, because both are what changed

### Requirement: A price tick does not restart the render
The workstation SHALL derive the last-print direction without updating state
during render. A price tick SHALL cause one render pass of the workstation.

A turn of the market — a price that moves the other way from the one before it —
MAY cost a second pass, because a direction is a comparison with what was on
screen before and nothing the render is given carries that. It SHALL be decided
after the render and before the browser paints, so a turn is drawn on the frame
it happened rather than a frame late.

#### Scenario: A price tick arrives
- **WHEN** a new last price arrives moving the same way as the one before it
- **THEN** the workstation renders once and the direction reads the same as it does today

#### Scenario: The price does not move
- **WHEN** the same last price arrives again
- **THEN** the workstation renders once and keeps the direction it last had

#### Scenario: The market turns
- **WHEN** a last price arrives moving the other way from the one before it
- **THEN** the turn is drawn on that frame rather than the next one

#### Scenario: The first price of a contract
- **WHEN** a contract's first last price is drawn
- **THEN** it reads as neutral, because a first reading is not a move
