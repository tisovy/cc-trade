## ADDED Requirements

### Requirement: The record states where a late frame waited
The desk SHALL mark a market-data or account frame with the times it passed: the
exchange's own event time where the payload states one, the time the main process
received it, the time it was queued for the renderer, the time the renderer
received it, and the time the desk committed it to screen. For a frame the
operator reports as late, the record SHALL be able to state which of those steps
it waited in, rather than leaving the delay to be attributed by reasoning.

The record SHALL also state the outbound queue's depth, in bytes and in frames
per resource, and what that queue superseded or dropped. A frame dropped without
a count is indistinguishable from a market that went quiet.

These are diagnostic events under the rules the record already enforces: they
SHALL state a recognized kind, phase and code; they SHALL carry no price,
quantity, notional, balance or profit-and-loss value; and writing them SHALL NOT
raise into a caller or delay a delivery. Because they arise at the exchange's
cadence, they SHALL be sampled rather than written per frame, and the sampling
rule SHALL be stated in the code that enforces it, so the record stays inside the
bounds it already keeps.

#### Scenario: A frame is delivered and drawn
- **WHEN** a market-data frame passes from the exchange to the screen
- **THEN** the record can state the delay at each step it passed, rather than only the total

#### Scenario: The transport falls behind
- **WHEN** frames arrive faster than the socket accepts them
- **THEN** the queue's depth and what it superseded are recorded per resource, and both return to zero when it drains

#### Scenario: A timing event carries a value it must not
- **WHEN** a timing event is offered to the record carrying a price, size or profit-and-loss value
- **THEN** it is refused or that value is dropped, exactly as any other event would be

#### Scenario: The market is busy
- **WHEN** frames arrive at the exchange's full cadence for an extended session
- **THEN** the timing events are sampled, and the record stays within the bounds it already enforces

#### Scenario: The record cannot be written
- **WHEN** the record cannot be opened, written or rotated while timing marks are being produced
- **THEN** the line is lost and the desk is left exactly as it would be without a record at all
