## MODIFIED Requirements

### Requirement: Real-money readiness is derived from disclosed gates
The system SHALL enable real-money order controls only after startup credential preflight succeeds, transport is connected, the operator pause is clear, the selected contract is currently tradable, exact exchange quantity and price filters are available, the required account state is usable, and the draft can be sized from a confirmed available USDT balance. Every unmet condition SHALL have an operator-visible reason.

A balance the desk has already read SHALL remain confirmed while it is being read
again. A refresh in flight is not an absence of a reading: the last values are
held throughout, and the read is what is about to make them fresher. A reading
that has never answered SHALL still block, as SHALL one that is stale or whose
last attempt failed — those state that the desk does not have a balance it may
act on, which a refresh does not.

The configured per-order USDT ceiling SHALL apply to every submission that can
increase exposure, including an amendment of a working order and a close that
is not reduce-only, and SHALL be evaluated against the notional the submission
would result in rather than the notional it replaces. A reduce-only exit SHALL
remain exempt so an open position can always be closed.

#### Scenario: TUTUSDT is tradable and account state is ready
- **WHEN** Binance reports `TUTUSDT` as trading with valid filters and all live account gates are satisfied
- **THEN** the order controls are enabled subject to draft validation and configured risk limits

#### Scenario: Account state is unavailable
- **WHEN** balances have not produced a confirmed snapshot
- **THEN** percentage sizing and submission remain disabled and the ticket identifies account synchronization as the blocking gate

#### Scenario: A held balance is being read again
- **WHEN** the desk re-reads the account and the balance resource is loading over a reading that has already answered
- **THEN** sizing and submission stay available against the held balance, and the ticket does not present the desk as synchronizing

#### Scenario: Balance snapshot becomes stale
- **WHEN** the last confirmed balance exists but its resource state becomes stale or its refresh fails
- **THEN** the value may remain visible with its age, but percentage sizing and exposure-increasing submission remain disabled until balances are ready again

#### Scenario: Account has no available USDT
- **WHEN** balances are ready and available USDT is zero
- **THEN** percentage sizing and exposure-increasing submission remain disabled with an insufficient-funds reason

#### Scenario: Operator pause is active
- **WHEN** the local futures pause is active
- **THEN** exposure-changing submission remains disabled and the ticket identifies the operator pause as the gate

#### Scenario: Draft exceeds the local notional ceiling
- **WHEN** an exposure-increasing order draft exceeds the configured per-order USDT ceiling
- **THEN** submission is rejected with the configured ceiling shown and no exchange order is sent

#### Scenario: Amendment would exceed the ceiling
- **WHEN** an amendment of a working order would raise its notional above the configured per-order USDT ceiling
- **THEN** the amendment is refused with the ceiling shown, on every surface that can produce it, and no exchange request is made

#### Scenario: Reduce-only exit under an active ceiling
- **WHEN** a reduce-only exit is submitted for a position larger than the configured ceiling
- **THEN** the ceiling does not block it and the exit proceeds
