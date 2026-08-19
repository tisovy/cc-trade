## ADDED Requirements

### Requirement: A timing assertion holds under the condition it is run in
A test that enforces a measured latency bound SHALL either take its calibration
under the condition the suite runs it in, or refuse to enforce the bound on a run
that could not sustain the conditions the measurement assumed.

A run that failed to hold its own input cadence is not evidence about the desk in
either direction, and SHALL be reported as an inconclusive run rather than as a
failure. A timing test that fails when the machine is busy is re-run until it
passes, and that habit is what makes a real regression invisible.

#### Scenario: The suite runs on a loaded machine
- **WHEN** a burst case cannot deliver its frames at the cadence its bound was measured against
- **THEN** it says the run was inconclusive rather than failing on a bound that was never measured under that load

#### Scenario: The desk genuinely slows down
- **WHEN** the cadence was held and the execution still lands outside the bound
- **THEN** the case fails, because that is the regression it exists to catch

#### Scenario: A wait that is not the measurement
- **WHEN** a case waits for the desk to become ready before the part it measures begins
- **THEN** the wait allows for a busy machine, so that a desk which is genuinely slow fails on the measured number and not on a readiness wait that gave up first
