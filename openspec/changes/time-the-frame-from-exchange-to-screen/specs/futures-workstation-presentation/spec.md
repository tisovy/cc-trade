## ADDED Requirements

### Requirement: The desk is exercised at the cadence it fails at
The desk SHALL have an automated case that delivers market data at the exchange's
full cadence — a depth frame at the widest legal payload every hundred
milliseconds, with candles alongside it — and issues a terminal execution report
during that burst. The case SHALL assert a stated bound on how late the execution
may be applied, and that bound SHALL be set from a measured run rather than
estimated.

The case SHALL assert that the book delivered during the burst is the newest one
and that whatever was superseded is counted, so a desk that keeps up by silently
falling behind does not pass. It SHALL run under the project's existing
verification surface, without a browser or Electron automation runner.

A burst is the condition the desk's latency defects appear under and the
condition none of them appear without; a suite that only exercises a quiet market
proves the desk works when nothing is at stake.

#### Scenario: An execution lands during a burst
- **WHEN** a terminal execution report is issued while depth frames arrive at the exchange's full cadence
- **THEN** it is applied within the stated bound, and the case fails if it is not

#### Scenario: The desk falls behind during the burst
- **WHEN** the desk cannot deliver every depth frame of the burst
- **THEN** the book it delivers is the newest, and the frames it superseded are counted rather than silently lost

#### Scenario: The case is run
- **WHEN** a developer invokes the burst case
- **THEN** it runs under the existing test surface, launching no browser and no Electron automation runner
