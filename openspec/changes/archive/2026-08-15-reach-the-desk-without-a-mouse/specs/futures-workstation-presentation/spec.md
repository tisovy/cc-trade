## ADDED Requirements

### Requirement: Every window width presents the positions and orders dock
The workstation layout SHALL present the positions and orders dock at every
supported window width. A layout template SHALL be applied only at widths its
columns fit in, so no width falls between a template that is too wide and a
breakpoint that has not yet applied.

#### Scenario: Narrow window
- **WHEN** the window is narrower than the desktop breakpoint
- **THEN** the positions and orders dock is present and readable

#### Scenario: Just above the breakpoint
- **WHEN** the window is at a width where the desktop columns no longer fit
- **THEN** the narrower template is already in force

### Requirement: An action available by pointer is available by keyboard
A row or control that opens an editor SHALL be focusable, SHALL activate with
Enter and Space, and SHALL state its action for assistive technology. A pointer
gesture SHALL NOT be the only way to reach an action that changes an order or a
position.

#### Scenario: Repricing an order without a mouse
- **WHEN** the operator focuses an order row and presses Enter
- **THEN** the order editor opens for that order and can be submitted from the keyboard

#### Scenario: The row states what it does
- **WHEN** assistive technology reads a row that opens an editor
- **THEN** it announces the action the row performs
