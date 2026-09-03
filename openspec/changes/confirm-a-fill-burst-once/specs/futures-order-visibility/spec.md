## MODIFIED Requirements

### Requirement: Trade-history activity requires fill evidence
The system SHALL mark a symbol's trade history dirty and schedule its bounded repair read only when an execution report contains actual fill evidence. A zero-fill order lifecycle report SHALL remain an order-state event and SHALL NOT invalidate confirmed history coverage.

The repair read SHALL be scheduled once per burst of fills, not once per fill: a fill starts a ten-second timer, every further fill restarts it, and the read goes out only when ten seconds have passed since the newest fill — one read for each contract the burst touched. The timer SHALL NOT be capped: a burst ends when the fills stop. On 2026-09-02 the desk sent a read per 1.2-second window while a scalp was still running, and its own reads outweighed its commands twenty to one.

#### Scenario: An order changes lifecycle without a fill
- **WHEN** the user-data stream reports `NEW`, `CANCELED`, or `EXPIRED` with zero last-filled and cumulative-filled quantities
- **THEN** confirmed trade-history coverage remains valid and no trade-history repair read is scheduled

#### Scenario: An execution contains a fill
- **WHEN** the user-data stream reports a `TRADE` execution or positive fill evidence
- **THEN** that symbol's fill-history activity advances, its prior frozen proof no longer suppresses reconciliation, and one bounded trade repair is scheduled for the fill burst

#### Scenario: Fills keep coming
- **WHEN** fills arrive five seconds apart for half a minute
- **THEN** no repair read is sent while they arrive, and one is sent ten seconds after the last of them

#### Scenario: A burst touches two contracts
- **WHEN** fills on two contracts arrive inside one burst
- **THEN** ten seconds after the newest fill one repair read goes out for each of the two, together
