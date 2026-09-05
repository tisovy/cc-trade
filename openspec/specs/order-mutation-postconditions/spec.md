# order-mutation-postconditions Specification

## Purpose

Confirm an order mutation only with evidence of the requested action, keeping missing evidence distinct from cancellation or amendment.

## Requirements

### Requirement: Mutation confirmation depends on the requested action

The desk SHALL distinguish proof of placement, cancellation and amendment. Order existence alone SHALL NOT confirm cancellation or amendment. Cancellation SHALL require cancelled status. Amendment SHALL require the requested price and original quantity to match under exact decimal comparison. Unknown/missing status or parameters SHALL NOT be interpreted as success.

#### Scenario: Cancellation finds a still-working order

- **WHEN** an ambiguous cancellation is queried and the order is NEW or PARTIALLY_FILLED
- **THEN** the displayed order is updated but cancellation remains unconfirmed and bounded read-only checks continue

#### Scenario: Cancellation is confirmed

- **WHEN** a query or matching private event reports CANCELED
- **THEN** the cancellation warning may be withdrawn as confirmed without issuing another mutation

#### Scenario: The order filled instead of being cancelled

- **WHEN** the order is FILLED, expired or otherwise terminal without cancelled status
- **THEN** the desk states that terminal outcome distinctly and does not claim cancellation or initiate a replacement

#### Scenario: Amendment still shows old terms

- **WHEN** the order exists but requested price or original quantity does not match
- **THEN** the amendment remains unconfirmed rather than being accepted because the order exists

#### Scenario: Amendment terms match exactly

- **WHEN** both terms match, including equivalent decimal formatting, in a recognized working or filled order report
- **THEN** the requested state is confirmed without implying which actor caused it

### Requirement: Missing evidence is not a mutation outcome

Reconciliation SHALL be bounded and read-only. Query absence alone SHALL NOT establish cancellation or amendment. A placement may be concluded absent only after the configured repeated explicit-absence observations; failed reads SHALL NOT count as absence. No reconciliation branch SHALL repeat the mutation.

#### Scenario: Cancellation or amendment remains absent

- **WHEN** every bounded lookup reports no such order after an ambiguous cancel or modify
- **THEN** the requested action remains unconfirmed rather than being labelled executed

#### Scenario: Read failures accompany apparent placement absence

- **WHEN** at least one lookup fails and later lookups report absence
- **THEN** the failed observation is not counted as an explicit absence and uncertainty remains

#### Scenario: The lookup budget is exhausted

- **WHEN** no action-specific evidence is established within the bounded observations
- **THEN** the warning remains and no automatic mutation retry is offered
