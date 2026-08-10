## Purpose

Refines workspace startup so a market that cannot authenticate is presented as unavailable rather than mounted or silently substituted.

## MODIFIED Requirements

### Requirement: The last selected market workspace is restored before mount
After credential preflight resolves, the application SHALL read the last explicitly activated market workspace from durable local storage before mounting Spot or Futures. A valid stored Spot or Futures value SHALL become the initial workspace without first mounting, subscribing, or briefly displaying the other market, provided that market's credential pair is complete. When the stored market's credentials are incomplete, the application SHALL show the neutral selector, mount neither market, and retain the stored value so a later start recovers it once the environment is fixed.

#### Scenario: Futures was last active
- **WHEN** the persisted market workspace is Futures at the next successful startup and the Futures pair is complete
- **THEN** Futures is the first market workspace mounted and Spot is not initialized

#### Scenario: Spot was last active
- **WHEN** the persisted market workspace is Spot at the next successful startup and the Spot pair is complete
- **THEN** Spot is the first market workspace mounted and Futures is not initialized

#### Scenario: Operator changes workspace
- **WHEN** the operator successfully switches between Spot and Futures
- **THEN** the newly active workspace is durably stored as the next startup workspace

#### Scenario: Persisted market lost its credentials
- **WHEN** the persisted market workspace names a market whose credential pair is incomplete
- **THEN** the neutral selector is shown, neither workspace mounts, and the persisted value is retained rather than overwritten or cleared

### Requirement: Missing or invalid workspace state has no implicit fallback
The application SHALL NOT default to Spot when the persisted market workspace is absent, unreadable, invalid, or belongs to a market without complete credentials. It SHALL render a neutral Spot/Futures selector, mount neither market workspace, and start no market-specific requests or subscriptions until the operator explicitly selects an available one.

#### Scenario: First run has no stored workspace
- **WHEN** credential preflight resolves but no market workspace has ever been persisted
- **THEN** the neutral selector is shown and neither Spot nor Futures initializes until an explicit selection

#### Scenario: Stored workspace is invalid
- **WHEN** durable storage contains a value other than a supported Spot or Futures workspace
- **THEN** the invalid value is ignored, the neutral selector is shown, and no implicit Spot fallback occurs

#### Scenario: Storage cannot be read
- **WHEN** durable storage is unavailable or throws during startup
- **THEN** the application remains on the neutral selector and allows an explicit session selection without initializing a market automatically

#### Scenario: Only one market is configured
- **WHEN** exactly one market has a complete credential pair and no workspace is persisted
- **THEN** the neutral selector is shown, and the unconfigured market is not selected implicitly in place of the configured one

## ADDED Requirements

### Requirement: Market switching presents unavailable markets explicitly
The market switch SHALL render whenever at least one market is configured. A market without a complete credential pair SHALL be presented as disabled, SHALL expose its missing variable names as its accessible reason, and SHALL NOT be selectable. Selecting an available market SHALL activate it normally. When no market is configured, the blocking configuration screen SHALL replace the selector and switch entirely.

#### Scenario: One market configured
- **WHEN** exactly one market has a complete credential pair
- **THEN** the switch renders with that market selectable and the other market disabled and labeled with its missing variable names

#### Scenario: Attempted selection of an unavailable market
- **WHEN** the operator activates the control for a market without credentials
- **THEN** no workspace mounts, no activation request is sent, and the disabled reason remains visible

#### Scenario: Neither market configured
- **WHEN** no market has a complete credential pair
- **THEN** the blocking configuration screen replaces the selector and switch entirely
