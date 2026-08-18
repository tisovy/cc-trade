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
so a day reads as one story rather than as two files to be joined by hand.

It SHALL further state what became of the frame on the screen, in three readings
that SHALL be kept apart: that the screen now shows what the frame said and
drawing it moved something; that the screen already showed it; and that the
screen does not show it at all. The last is the fault, and it is what an operator
reporting "the order did not update" is describing. The middle is not a fault and
SHALL NOT be recorded as one: one settlement produces more than one frame
carrying the same fact, so the second of them changes nothing by arriving after a
sibling that was already applied. A record that judged a frame by whether the
screen moved would call that second frame undelivered on every ordinary fill.

None of the three SHALL be inferred from the absence of a line. A frame that
arrived is recorded whatever it did.

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

#### Scenario: The second frame of one settlement arrives
- **WHEN** a frame states what the screen already shows, because a sibling frame of the same settlement was applied first
- **THEN** the record states it as already drawn, and does not present it as a frame the screen never showed

#### Scenario: A report arrives and the screen does not show it
- **WHEN** the exchange reports on an order and the desk's surfaces do not end up showing what it said
- **THEN** the record states that frame as not drawn, rather than not stating it

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
