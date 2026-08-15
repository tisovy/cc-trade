## ADDED Requirements

### Requirement: An amendment does not cancel what it cannot replace
An amendment carried out as a cancellation and a placement SHALL evaluate the
replacement against every bound the desk enforces on a placement before the
cancellation is issued. Where the replacement would be refused by a bound the
desk already holds, the amendment SHALL be refused whole: no cancellation is
sent, the existing order stays live at the exchange, and the refusal names the
bound in the same words a refused placement would.

Where the replacement is refused for a reason the desk could not have known in
advance, the existing behaviour stands — the operator is told the order was
cancelled and not replaced.

#### Scenario: The replacement falls under a bound the desk enforces
- **WHEN** an amendment would produce an order the placement path would refuse
- **THEN** no cancellation is issued, the existing order remains live, and the refusal names the bound

#### Scenario: A dragged order is returned to where it rests
- **WHEN** an amendment begun by a drag is refused
- **THEN** the order is drawn at the price it still rests at, not at the price the drag dropped it on

#### Scenario: The exchange refuses something the desk could not judge
- **WHEN** a replacement the desk had no bound for is refused by the exchange
- **THEN** the operator is told the order was cancelled and not replaced, as today
