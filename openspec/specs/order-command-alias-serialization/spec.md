# order-command-alias-serialization Specification

## Purpose

Serialize commands across proven exchange and client order aliases without discarding active dependencies or assuming unknown identities are independent.

## Requirements

### Requirement: Commands about one order share observed alias dependencies

The registry SHALL scope typed exchange/client identities by account, market and symbol, learn associations only from main-owned exchange evidence, and wait for every known alias tail before starting a mutation. Commands naming an unknown or contradictory target SHALL use the contract barrier rather than assume disjoint identity.

#### Scenario: Modify and cancel name different aliases

- **WHEN** a modification uses exchange ID and a cancellation uses its original client ID
- **THEN** they run in accepted order, using either their proven common dependencies or the conservative contract barrier

#### Scenario: Exchange ID arrives during placement

- **WHEN** an exchange response/private report associates the pending placement's client ID with an exchange ID
- **THEN** a later command naming that exchange ID waits for the placement tail

#### Scenario: Known unrelated orders

- **WHEN** two commands target proven unrelated order identities on one contract
- **THEN** their order lanes may run concurrently while preserving contract-wide barriers

#### Scenario: Conflicting alias or unproved command pair

- **WHEN** evidence conflicts or a command merely claims two identifiers without exchange proof
- **THEN** no guessed mapping permits concurrent mutation of a potentially shared order

### Requirement: Alias memory cannot erase active ordering

Alias retention SHALL be bounded and scope-isolated. Expiry/eviction SHALL preserve active tail dependencies or fall back to contract serialization. Observing private/account identity SHALL NOT record that traffic as a running command's replayable outcome or send an exchange request.

#### Scenario: Alias retention expires during an active command

- **WHEN** an alias group reaches its retention boundary while its command is still running
- **THEN** another alias cannot bypass the active dependency

#### Scenario: Private event teaches identity

- **WHEN** a private event associates an order's names during another command
- **THEN** identity may be learned but that event is not added to the unrelated command's replay record

#### Scenario: Restart or memory expiry

- **WHEN** no retained exchange evidence remains
- **THEN** target identity is treated as unproved, not as a durable exactly-once guarantee
