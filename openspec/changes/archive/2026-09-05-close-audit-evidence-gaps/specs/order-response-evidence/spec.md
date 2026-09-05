## Purpose

Ensure successful HTTP responses and late private events prove the regular order and action they claim to answer.

## ADDED Requirements

### Requirement: Successful regular-order responses prove identity and action

Before publishing a successful placement, cancellation or amendment, the desk SHALL verify the returned symbol, safe exchange order identity and requested action postcondition. An explicit target exchange ID SHALL match; a client-only target SHALL match a returned current or original client ID. Missing or contradictory evidence SHALL remain indeterminate and use the existing bounded read-only reconciliation. The desk SHALL NOT manufacture cancelled status or repeat a mutation to repair its answer.

#### Scenario: A successful cancellation returns a working or empty body

- **WHEN** HTTP success contains NEW, FILLED, missing status, or no usable order identity
- **THEN** it is not emitted as a confirmed cancellation and no replacement or second DELETE is sent

#### Scenario: An amendment returns old terms

- **WHEN** a successful amendment response has the right identity but different requested price or original quantity
- **THEN** the amendment remains indeterminate and only read-only reconciliation may follow

#### Scenario: Valid order evidence is returned

- **WHEN** the requested identity and action-specific postcondition are present, including an exact large integer ID represented as text
- **THEN** the existing execution-report shape is emitted without weakening its status or precision

#### Scenario: The installed Spot SDK parses a large integer as native BigInt

- **WHEN** an order, history or other REST payload includes such a value
- **THEN** the boundary converts it to exact decimal text before renderer JSON serialization without rounding or retaining an unserializable BigInt

### Requirement: Queries and private reports cannot answer another order

Order lookups SHALL reject missing or mismatching returned identity rather than emit it as the requested order. Private evidence SHALL require the held command's explicit matching symbol and SHALL NOT use a matching client ID to override a contradictory exchange ID. HTTP-indeterminate lookup errors SHALL NOT count as explicit absence even if their body contains -2013.

#### Scenario: A query returns a different symbol or order ID

- **WHEN** the successful body does not identify the requested order
- **THEN** the observation fails and cannot clear uncertainty or teach a false alias

#### Scenario: A server failure carries an absent-order code

- **WHEN** a Futures lookup returns HTTP 5xx with code -2013
- **THEN** the observation is failed, not explicit absence

#### Scenario: A private report lacks its symbol or contradicts the held order ID

- **WHEN** such a report otherwise resembles a terminal answer to a held warning
- **THEN** the warning remains until sufficient matching evidence arrives
