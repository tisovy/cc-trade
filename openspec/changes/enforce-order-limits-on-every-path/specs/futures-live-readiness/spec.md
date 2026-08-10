## Purpose

Extends the disclosed real-money gates so the configured per-order ceiling is
enforced on every path that can create or change an order, and so the renderer
is never the only gate. Local pre-validation is deliberately confined to what
the desk needs to build a submittable order; every other exchange filter is
left to Binance to refuse.

## MODIFIED Requirements

### Requirement: Real-money readiness is derived from disclosed gates
The system SHALL enable real-money order controls only after startup credential preflight succeeds, transport is connected, the operator pause is clear, the selected contract is currently tradable, exact exchange quantity and price filters are available, the required account state is usable, and the draft can be sized from a confirmed available USDT balance. Every unmet condition SHALL have an operator-visible reason.

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

## ADDED Requirements

### Requirement: Local pre-validation is confined to submittability
The system SHALL locally evaluate only the filters required to build a
submittable order — the price tick, the quantity step, the contract's quantity
range, and its minimum notional — together with the configured per-order USDT
ceiling. It SHALL NOT locally evaluate the price minimum or maximum, the
percent-price band, or the maximum permitted number of open orders; those SHALL
be left to the exchange, whose refusal SHALL be reported to the operator with
the code and message Binance returned.

A single evaluator SHALL decide every submission draft, so that the trading
ticket, the order editor, the chart drag amendment and the position closer
refuse the same draft for the same stated reason.

The operator has accepted that a draft may therefore be reported ready and then
refused by the exchange. That outcome SHALL be presented as an exchange
rejection carrying the exchange's own reason, never as a local defect and never
silently.

#### Scenario: Price outside a band the exchange enforces
- **WHEN** a draft has a valid tick, step and notional but a price the exchange refuses on its price or percent-price filter
- **THEN** the submission is sent, the exchange rejection is presented with its code and message, and no local filter check blocked it beforehand

#### Scenario: Open order count is exhausted
- **WHEN** the account already holds the contract's maximum number of open orders
- **THEN** the submission is sent and the exchange's refusal is presented to the operator

#### Scenario: Tick, step, quantity range or minimum notional is violated
- **WHEN** a draft violates the price tick, the quantity step, the contract's quantity range, or its minimum notional
- **THEN** the draft is refused locally with the violated constraint named and no exchange request is made

#### Scenario: The same draft is typed on a different surface
- **WHEN** a draft that one submission surface refuses is entered on another
- **THEN** it is refused there too, for the same stated reason

### Requirement: Order limits are enforced independently of the renderer
The main process SHALL evaluate the configured per-order ceiling for every
placement, amendment and close it receives, regardless of any validation the
renderer performed. A command failing that evaluation SHALL be rejected with a
stable market-scoped reason and SHALL NOT be forwarded to the exchange.

#### Scenario: A command arrives without renderer validation
- **WHEN** a trading command reaches the main process having bypassed the renderer's draft evaluation
- **THEN** the main process refuses it on the same ceiling rules and no exchange request is made

#### Scenario: Renderer and backend disagree
- **WHEN** a command the renderer accepted fails the main process evaluation
- **THEN** the main process rejection is authoritative and the operator sees the command as rejected
