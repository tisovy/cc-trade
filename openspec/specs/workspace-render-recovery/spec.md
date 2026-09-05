# workspace-render-recovery Specification

## Purpose

Contain workspace rendering failures and provide truthful manual recovery while preserving the account and trading state owners.

## Requirements

### Requirement: Scoped rendering failure isolation
React descendant render failures SHALL be contained within the affected view. The outer workspace boundary SHALL leave gateway/market selection mounted, and optional Spot chart/analytics boundaries SHALL leave sibling trading controls and account ownership mounted.

#### Scenario: Chart or analytics throws
- **WHEN** an optional Spot chart or analytics component fails during rendering
- **THEN** only that panel shows unavailable state while order controls and command warnings remain mounted

#### Scenario: Workspace provider or lazy module fails
- **WHEN** the workspace cannot render at its outer boundary
- **THEN** the shell retains market selection and shows an explicit unavailable screen rather than blanking the application

### Requirement: Truthful manual UI recovery
Recovery UI SHALL distinguish local connection/activation from account/order certainty, warn that orders may remain active, and SHALL NOT display exception contents or treat unavailable data as zero positions/orders. Recovery SHALL be manual and SHALL NOT replay mutations or clear user storage.

#### Scenario: Retry a content view
- **WHEN** the operator retries a failed content view
- **THEN** presentation remounts while its Spot DataProvider or Futures trading owner remains mounted, preserving held outcomes

#### Scenario: Recover an outer workspace failure
- **WHEN** the outer boundary cannot preserve workspace ownership
- **THEN** it offers an explicit interface reload with a warning to verify exchange state before repeating commands, and does not reload automatically

#### Scenario: Sensitive exception text
- **WHEN** an exception contains arbitrary payload or credential-like text
- **THEN** fallback UI contains only fixed recovery guidance and does not display that exception text
