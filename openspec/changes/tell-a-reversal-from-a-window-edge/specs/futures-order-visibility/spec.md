## MODIFIED Requirements

### Requirement: A closed position is what was actually closed
Fills SHALL be folded into positions without inventing one. Where a fill reduces
more than the fills in hand show is held, and what the exchange reports it
realized does not account for a reversal, the fill SHALL be read as closing a
position opened before this window of fills rather than as opening one in the
opposite direction. The entry price of such a position SHALL be the one the
exchange's realized PnL states.

That test SHALL be made against the average entry of the size still held —
unmoved by a close, moved only by a further entry — because that is the average
the exchange settles a fill's realized PnL against. It SHALL NOT be made against
the average of everything the round has entered: the two part company as soon as
a position is scaled out of and back into at a different price, and a real
reversal then reads as a remainder.

#### Scenario: The window of fills opens while a position is already held
- **WHEN** the operator adds to a position opened before the read's window and then closes all of it
- **THEN** the review shows one closed position of the whole size, and no position in the opposite direction

#### Scenario: The position really did reverse
- **WHEN** a fill reduces past flat and its realized PnL accounts for closing exactly what was held
- **THEN** the review shows the position closed and the opposite one opened

#### Scenario: The position was scaled out of and back into before it reversed
- **WHEN** a position is partly closed, added to again at a different price, and then reduced past flat
- **THEN** the review still shows a closed position and the opposite one opened, each with the entry its own fills state, and neither presented as recovered from a position older than the window
