## ADDED Requirements

### Requirement: The order size is one value across every surface that states it
When the size of a staged order is changed on the confirmation panel, the rail
that staged it SHALL state the same size. The desk SHALL NOT leave two different
sizes on screen at once, one of them the figure the operator set deliberately.

The **amount** SHALL be what is carried between the two surfaces, not the
percentage. The rail's slider is a share of the available balance; an exit's
slider on the confirmation is a share of the position being closed. The two
percentages measure different things, and the amount is the only reading that
means the same on both.

#### Scenario: The size is changed at the cursor
- **WHEN** the operator sets a size on the rail, stages an order by gesture, and then moves the size slider on the confirmation panel
- **THEN** the rail states the new size — both the amount and its share — rather than the size it was left at

#### Scenario: An exit is resized against its own position
- **WHEN** the size of a staged exit is changed on the confirmation, where the slider is a share of the position rather than of the balance
- **THEN** the rail states the resulting amount, and its own share is recomputed against the balance rather than copied from the confirmation
