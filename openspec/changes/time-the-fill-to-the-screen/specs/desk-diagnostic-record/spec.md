## MODIFIED Requirements

### Requirement: The record states where a late frame waited
The desk SHALL mark a market-data or account frame with the times it passed: the
exchange's own event time where the payload states one, the time the main process
received it, the time it was queued for the renderer, the time the renderer
received it, and the time the desk committed it to screen. For a frame the
operator reports as late, the record SHALL be able to state which of those steps
it waited in, rather than leaving the delay to be attributed by reasoning.

The account lane SHALL be marked on the same terms as the market lane. What the
exchange states about an order, and the account envelope folded from it, are the
frames an operator reports as late most often, and a record that times only
market data cannot answer them at all.

A frame about an order SHALL name the order, using the same identity the
command and answer lines carry, and SHALL name the state the exchange gave it,
so a day reads as one story rather than as two files to be joined by hand. It
SHALL further state whether the desk's own working orders changed when the frame
was applied: a frame that arrived and left the screen as it was is a distinct
observation from one that was never delivered, and neither may be inferred from
the other's absence.

The record SHALL also state the outbound queue's depth, in bytes and in frames
per resource, and what that queue superseded or dropped. A frame dropped without
a count is indistinguishable from a market that went quiet.

These are diagnostic events under the rules the record already enforces: they
SHALL state a recognized kind, phase and code; they SHALL carry no price,
quantity, notional, balance or profit-and-loss value — including the filled
fraction of an order, which the state the exchange gave it already answers well
enough; and writing them SHALL NOT raise into a caller or delay a delivery.
Market-data marks SHALL be sampled rather than written per frame, because they
arise at the exchange's cadence; account marks SHALL NOT be sampled, because they
arise at the account's, and the event a sample would drop is the one the record
is being asked about. Both rules SHALL be stated in the code that enforces them,
so the record stays inside the bounds it already keeps.

#### Scenario: A frame is delivered and drawn
- **WHEN** a market-data frame passes from the exchange to the screen
- **THEN** the record can state the delay at each step it passed, rather than only the total

#### Scenario: An order the exchange reports on is drawn
- **WHEN** the exchange reports on an order and the desk draws what it said
- **THEN** the record states the same delays for that frame, names the order by the identity its command carries and the state the exchange gave it, and says that the working orders changed

#### Scenario: A report arrives and changes nothing on screen
- **WHEN** a report about an order arrives and the desk's working orders are left exactly as they were
- **THEN** the record states that frame as delivered and unchanged, rather than not stating it

#### Scenario: The transport falls behind
- **WHEN** frames arrive faster than the socket accepts them
- **THEN** the queue's depth and what it superseded are recorded per resource, and both return to zero when it drains

#### Scenario: A timing event carries a value it must not
- **WHEN** a timing event is offered to the record carrying a price, size or profit-and-loss value
- **THEN** it is refused or that value is dropped, exactly as any other event would be

#### Scenario: The market is busy
- **WHEN** frames arrive at the exchange's full cadence for an extended session
- **THEN** the market-data timing events are sampled, the account's are not, and the record stays within the bounds it already enforces

#### Scenario: The record cannot be written
- **WHEN** the record cannot be opened, written or rotated while timing marks are being produced
- **THEN** the line is lost and the desk is left exactly as it would be without a record at all
