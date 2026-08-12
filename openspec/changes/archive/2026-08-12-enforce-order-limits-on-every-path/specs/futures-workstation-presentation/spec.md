## Purpose

Narrows the filter promise made by the instrument rail to what the desk
actually enforces locally, so the specification does not claim enforcement the
operator has chosen to delegate to the exchange.

## MODIFIED Requirements

### Requirement: The instrument rail carries no exchange-filter reference panel
The instrument rail SHALL NOT present a contract-filter reference panel. The price tick, the quantity step, the contract's quantity range and its minimum notional SHALL remain enforced on every order draft and SHALL be reported only when they block a specific action. Every other exchange filter SHALL be left to the exchange, and its refusal SHALL be reported to the operator with the exchange's own code and message.

#### Scenario: A contract is selected
- **WHEN** the operator selects a contract
- **THEN** no tick-size, step-size, percent-price, max-orders, or minimum-notional reference panel is rendered

#### Scenario: A draft violates a filter
- **WHEN** a draft order violates the price tick, the quantity step, the quantity range, or the minimum notional
- **THEN** the ticket states the violated constraint for that draft

#### Scenario: A draft violates a filter only the exchange enforces
- **WHEN** a draft order violates a filter the desk no longer evaluates locally
- **THEN** the submission reaches the exchange and its refusal is presented with the exchange's code and message
