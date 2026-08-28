## MODIFIED Requirements

### Requirement: The instrument rail reflects what is actually traded
The workstation SHALL persist recently selected contracts, favourites, and the
last selected contract. It SHALL restore the last selected contract on startup
and SHALL order the contract catalogue by recency, then favourites, then
alphabetically.

The history SHALL read the same identity alphabet the workstation protocol
selects by — uppercase, titlecase and caseless letters and numbers, with the
dated delivery-contract form — so any contract the operator can stand on is a
contract the history can hold. A history narrower than the protocol reopened
the previous ASCII pair on every remount while the operator worked a CJK
listing (龙虾USDT, 2026-08-28).

#### Scenario: Operator reopens the workstation
- **WHEN** the operator restarts the application after trading a contract
- **THEN** that contract is selected again instead of a hard-coded default

#### Scenario: Catalogue is displayed
- **WHEN** the contract list is rendered
- **THEN** recently traded contracts appear first in the single contract list, without a second strip repeating the same entries

#### Scenario: The operator was standing on a CJK listing
- **WHEN** the workspace remounts — a restart, an activation flap, a reconnect — while a CJK-ticker contract is selected
- **THEN** the workstation reopens that contract, not the previously selected ASCII pair

## ADDED Requirements

### Requirement: A live listing outside the execution path names itself
When the selected contract is catalogued, trading and perpetual, and the desk
still will not trade it — the execution path's alphabet excludes its ticker —
the order ticket SHALL state that as its own readiness gate, distinct from the
gate that means no active contract is selected. The refusal is deliberate and
SHALL read as one: the operator standing on a live chart is owed the reason the
ticket is dark, not an instruction to select what is already selected.

#### Scenario: The operator opens a CJK-ticker perpetual
- **WHEN** the catalogue delivers the contract as trading, perpetual and not tradable
- **THEN** the ticket's readiness gate reads LISTING with a reason naming the execution path, and order entry stays disabled

#### Scenario: No contract is selected at all
- **WHEN** the selected symbol has no catalogued contract behind it
- **THEN** the CONTRACT gate reads exactly as before this change
