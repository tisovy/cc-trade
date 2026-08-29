## ADDED Requirements

### Requirement: The desk trades every contract it catalogues

A contract the catalogue admits — its symbol spelled in the exchange's
identity alphabet — that is `TRADING` and `PERPETUAL` SHALL be tradable from
the desk: the order ticket's readiness SHALL treat it exactly as any ASCII
major, with no separate execution alphabet. The desk maintains one spelling of
what a contract is; a second, narrower spelling held the operator's own
listing dark on 2026-08-28 while the account already carried 23 working
orders and two positions beside it.

The LISTING readiness gate remains defined for a contract delivered
catalogued, trading and perpetual yet not tradable — after this change a
divergence guard that is expected never to fire, and owed its honest reason
if it ever does.

#### Scenario: The operator opens a unicode perpetual

- **WHEN** the catalogue delivers a CJK-ticker contract as `TRADING` and `PERPETUAL`
- **THEN** the contract is tradable, the ticket shows no LISTING gate, and order entry follows the same readiness ladder as any contract

#### Scenario: A delivery-dated or non-trading contract

- **WHEN** the catalogue delivers a contract that is not `TRADING` or not `PERPETUAL`
- **THEN** it is not tradable, exactly as before this change

#### Scenario: Client order ids stay in the exchange's id charset

- **WHEN** an order on a unicode listing is placed, modified, or cancelled
- **THEN** every client order id the desk sends satisfies the exchange's ASCII id rule, because ids are never derived from the symbol
