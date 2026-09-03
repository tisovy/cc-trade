## MODIFIED Requirements

### Requirement: Position-reducing actions are proved against the current account leg
A close action SHALL derive its order side from the explicit position leg before falling back to signed one-way quantity. Presentation-only valuation fields SHALL NOT be accepted as an account snapshot or command target. Before a renderer-declared reduce-only order bypasses exposure controls, the main process SHALL verify that its side, leg, and size reduce a currently confirmed position; an unproved or contradictory reduction SHALL be rejected without an exchange request. The newest successful positions reading is that proof whether or not a pass is re-confirming it; only a reading from a retired Futures activation, or none at all, is no proof.

#### Scenario: A hedge short has a positive internal quantity
- **WHEN** Market Close is requested for an explicit SHORT leg whose internal quantity is positive
- **THEN** the command buys that SHORT leg, never sells into it, and the main process proves the requested size does not exceed the current leg before treating it as reduction

#### Scenario: Ticket submits entry intent in either position mode
- **WHEN** the operator submits a LONG or SHORT Ticket entry while the account may be one-way or hedge mode
- **THEN** the renderer does not forge a raw account leg, and the adapter resolves the order's position side from the actual account mode

#### Scenario: Ticket exits a signed one-way position
- **WHEN** the operator submits a Ticket exit for a positive or negative position whose current raw account leg is `BOTH`
- **THEN** the renderer preserves `BOTH` on the reduce-only command while deriving SELL for the positive position and BUY for the negative position

#### Scenario: Ticket exit has no current raw account leg
- **WHEN** the visible semantic exit cannot be resolved to a current confirmed raw position row
- **THEN** the Ticket does not send the order, and the backend remains independently fail-closed

#### Scenario: Balanced hedge legs are not an empty exit target
- **WHEN** equal LONG and SHORT hedge legs make net exposure zero and the operator stages an exit for one named leg
- **THEN** confirmation shows the selected leg being reduced, projects the resulting net exposure, and does not claim that there is nothing to close

#### Scenario: Selected contract changes under a staged order
- **WHEN** an order is staged for one contract and the Ticket receives another selected contract before confirmation
- **THEN** confirmation synchronously withdraws the staged order, sends nothing, and cannot substitute the new contract into the old price, quantity, or position proof

#### Scenario: A forged or stale reduce-only command arrives
- **WHEN** a reduce-only command names the wrong side, a missing leg, or more quantity than the currently confirmed position
- **THEN** it is rejected locally and cannot bypass the exposure cap or reach Binance as an exposure-increasing order

#### Scenario: Position proof is loading or belongs to a retired activation
- **WHEN** a reduce-only command arrives while the positions resource's last successful snapshot was admitted under an earlier Futures activation, or no successful snapshot exists and the bounded wait for one expires
- **THEN** that snapshot is not reduction authority and the command is rejected without an exchange request; a snapshot of this activation that is merely being re-read is not this case

#### Scenario: Position proof is being re-read
- **WHEN** a reduce-only command arrives while the positions resource reads `loading` over a successful snapshot of this activation
- **THEN** that snapshot is the reduction authority and the command is proved against it
