## ADDED Requirements

### Requirement: Depth delivery is coalesced, not dropped in part
The workstation SHALL deliver at most one order book per animation interval. A
frame arriving while a delivery is pending SHALL replace it. A delivered book
SHALL be complete for the depth in force; coalescing SHALL drop intermediate
frames, never levels within a frame.

#### Scenario: A burst of depth frames
- **WHEN** several depth frames arrive within one animation interval
- **THEN** one book is delivered, and it is built from the newest frame

#### Scenario: Quiet book
- **WHEN** frames arrive slower than the interval
- **THEN** each frame is delivered as it arrives

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
