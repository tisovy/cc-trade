## Purpose

Defines a production-only and testable readiness contract for Binance trading, including fail-fast credential configuration, observable Futures account synchronization, risk gates, and operator-visible failures.

## ADDED Requirements

### Requirement: Startup credential preflight fails closed
Before initializing either Spot or Futures market/account functionality, the system SHALL validate the presence of the complete supported API key and secret pair. A complete pair SHALL permit production initialization. A missing pair, partial pair, or retired-only credential configuration SHALL produce `CONFIG_ERROR`, emit a sliding error alert, render a blocking configuration-error screen, and stop all Binance market/account initialization. The application shell and local diagnostic path MAY remain available solely to present and recover from the error.

#### Scenario: Complete supported credentials select live mode
- **WHEN** both supported futures credential values are present
- **THEN** credential preflight succeeds and the application may initialize the persisted production market workspace

#### Scenario: No credentials stop startup
- **WHEN** neither supported futures credential value is present
- **THEN** the system shows a sliding missing-credentials alert and blocking configuration-error screen and starts no Spot or Futures market/account connection, subscription, refresh, or trading command path

#### Scenario: Partial credentials fail closed
- **WHEN** exactly one supported credential value is present
- **THEN** the system shows a sliding incomplete-credentials alert and blocking configuration-error screen, starts no Binance market/account path, and identifies the missing configuration field without exposing any secret value

#### Scenario: Retired credentials are diagnosed
- **WHEN** retired futures credential names are present but the supported pair is absent
- **THEN** the system stops initialization and presents a migration diagnostic naming the supported configuration fields without logging credential contents

### Requirement: Runtime mock behavior does not exist
Production application code SHALL NOT generate or substitute synthetic exchange filters, balances, orders, executions, tickers, candles, positions, or successful trading acknowledgements. A trading command SHALL succeed only from an authenticated exchange operation. Mocks and fixtures MAY exist only in test-only files or test-injected dependencies that are unreachable from a production application build.

#### Scenario: Credentials are unavailable
- **WHEN** startup credential preflight fails
- **THEN** the application exposes the configuration error and does not generate fallback market or account data

#### Scenario: Trading adapter is unavailable
- **WHEN** a validated trading command reaches a runtime without an authenticated adapter
- **THEN** the command is explicitly rejected and no synthetic execution update is emitted

#### Scenario: Production application is built
- **WHEN** the production Electron/renderer artifacts are inspected or executed
- **THEN** no runtime branch, timer, seed state, or imported helper can activate simulated exchange behavior

### Requirement: Account synchronization is observable per resource
The system SHALL expose synchronization state independently for balances, positions, regular open orders, algorithmic open orders, and the futures user-data stream. Each resource state SHALL distinguish at least loading, ready, stale, and error, include the time of the last successful update when available, and retain the last confirmed data during a retry failure rather than replacing it with an empty snapshot.

#### Scenario: Initial account synchronization succeeds
- **WHEN** all required signed account resources return valid responses
- **THEN** each resource becomes ready and exposes its successful update time

#### Scenario: Initial balance synchronization fails
- **WHEN** the signed balance request fails before any balance snapshot exists
- **THEN** balances enter error state, available USDT remains unavailable rather than zero, and the ticket displays a sanitized actionable reason

#### Scenario: Refresh fails after a successful snapshot
- **WHEN** a resource refresh fails after that resource previously became ready
- **THEN** the system retains the last confirmed snapshot, marks it stale, and exposes the refresh failure and last-success time

#### Scenario: Zero balance is valid data
- **WHEN** a successful balance response reports zero available USDT
- **THEN** the system reports a ready balance resource with zero funds and does not misclassify it as a synchronization failure

### Requirement: Synchronization failures are safe and actionable
The system SHALL propagate sanitized Binance and transport failures to the renderer with a stable local error code, a user-facing explanation, and retryability. Diagnostics SHALL distinguish common configuration, permission, timestamp/clock, network/proxy, rate-limit, and exchange-response failures while excluding API keys, secrets, signatures, and raw signed query strings.

#### Scenario: Futures permission is missing
- **WHEN** Binance rejects a signed futures request because the key lacks required futures permission
- **THEN** the renderer identifies the permission problem and offers refresh/retry guidance without revealing credentials

#### Scenario: Clock or receive-window validation fails
- **WHEN** Binance rejects a signed request because its timestamp is outside the accepted window
- **THEN** the renderer identifies local clock synchronization as the likely corrective action

#### Scenario: Retry is requested
- **WHEN** the operator invokes account refresh after a retryable failure
- **THEN** all required account resources are requested and their loading, success, or failure states are updated independently

### Requirement: New operational failures produce a sliding alert
Each transition into a new configuration, account-resource, user-data-stream, or trading-command error SHALL create one sliding error notification using the application's shared notification surface. The notification SHALL identify the affected market/resource and sanitized corrective action. The detailed error and retry control SHALL remain visible in the relevant blocking screen or trading panel after the transient notification is dismissed.

#### Scenario: Account resource enters error
- **WHEN** a Futures account resource transitions from loading or ready into error or stale because its refresh failed
- **THEN** one sliding error alert appears with the resource and sanitized failure reason while the panel retains detailed status

#### Scenario: Identical failure repeats during retry
- **WHEN** the same resource and stable error code repeat without an intervening recovery
- **THEN** the active notification is not duplicated or continuously re-created

#### Scenario: Failure recurs after recovery
- **WHEN** a resource becomes ready and later enters the same error again
- **THEN** the recurrence is treated as a new transition and produces a new sliding alert

#### Scenario: Trading command is rejected
- **WHEN** Binance or the local backend rejects a Spot or Futures trading command
- **THEN** a sliding error alert appears and the command remains visibly rejected rather than silently ignored

### Requirement: Real-money readiness is derived from disclosed gates
The system SHALL enable real-money order controls only after startup credential preflight succeeds, transport is connected, the operator pause is clear, the selected contract is currently tradable, exact exchange quantity and price filters are available, the required account state is usable, and the draft can be sized from a confirmed available USDT balance. Every unmet condition SHALL have an operator-visible reason.

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

### Requirement: Readiness cannot be inferred from decorative labels
The system SHALL derive control availability and status labels from the same structured credential, synchronization, contract, and risk state. A production-styled heading SHALL NOT be sufficient to claim that real-money execution is ready.

#### Scenario: Credentials are absent
- **WHEN** application startup has no supported credential pair
- **THEN** neither production workspace is initialized and the blocking configuration state cannot be mistaken for a ready trading screen
