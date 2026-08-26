# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: A control that reaches past its own panel says so

When an operator control governs anything outside the panel it sits in, that
panel SHALL state what else it governs, in the panel, beside the control — not
only in a specification or a commit message. It SHALL also state what it does
not govern where a reader could reasonably assume otherwise.

The reason is that the effect is invisible at the point of use. An operator
turning a dial down to make one panel quieter, months later and for an unrelated
reason, has no way to know what else they slowed unless the dial tells them.

That statement SHALL be drawn quieter than the control's own reading: it is
standing text that does not change when a value is applied, and the value is
what the operator opened the panel to see.

#### Scenario: The tape throttle also bounds position repricing

- **WHEN** the operator opens the Aggregate trades settings
- **THEN** the panel states that its throttle and timeout also bound how often open positions are repriced, and that marks keep their own once-a-second cadence
