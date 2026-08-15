## ADDED Requirements

### Requirement: How a contract's book is read is remembered per contract
The side mode and the grouping step SHALL be stored against the contract they
were chosen for and restored when that contract is selected again, including
after a restart. They SHALL NOT be stored as one setting shared by every
contract: the step is a multiple of the contract's own tick, so the same
multiplier is a different share of price on a different contract and would
carry a book-collapsing step from one to the next. A contract with nothing
stored SHALL open at both sides and 1×.

Stored values SHALL be validated on read exactly as fresh operator input is: a
side mode that is not one of the three, or a step that is not one of the
contract's multipliers, SHALL fall back to the default rather than be applied.
The store SHALL be bounded, so a desk that has watched many contracts cannot
grow it without limit.

#### Scenario: Operator returns to a contract
- **WHEN** the operator selects a contract for which a side mode and step were previously chosen
- **THEN** the book opens with that side mode and that step, without being re-dialled

#### Scenario: Operator returns after a restart
- **WHEN** the application is restarted and that contract is selected again
- **THEN** the same side mode and step are restored

#### Scenario: Contract has nothing stored
- **WHEN** a contract is selected for the first time
- **THEN** the book opens at both sides and 1×, and the choice made for another contract does not carry over

#### Scenario: Stored entry is unusable
- **WHEN** the stored value is malformed, or names a step multiplier the contract does not offer
- **THEN** the default is used and the unusable entry changes nothing on screen

#### Scenario: Store reaches its bound
- **WHEN** more contracts have been configured than the store holds
- **THEN** the least recently written entries are dropped rather than the store growing without limit

## MODIFIED Requirements

### Requirement: The order book can be read one side at a time
The book SHALL offer a three-way side control — both sides, buy side only, sell
side only — beside the price-step control. A single side SHALL be given the
whole book area, and the number of levels shown SHALL be remeasured for it, so
the operator can reach farther into the book without coarsening the step. The
last-print row SHALL remain visible in every mode.

#### Scenario: Operator shows one side
- **WHEN** the operator selects buy side only
- **THEN** the sell side is not rendered, and the buy side shows the levels that now fit the whole area — roughly twice as many — at the unchanged step

#### Scenario: Operator returns to both sides
- **WHEN** the operator selects both sides
- **THEN** the two sides are shown again, each remeasured to half the area

#### Scenario: Selected mode outlives a contract change
- **WHEN** the operator selects another contract and comes back
- **THEN** the side mode chosen for the first contract is what it is shown with again, rather than being reset or replaced by the mode chosen for the second
