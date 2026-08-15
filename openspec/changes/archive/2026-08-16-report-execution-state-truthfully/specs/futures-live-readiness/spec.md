## Purpose

Preserves the exchange's own failure identity all the way to the operator,
keeps a command rejection readable when an account resource fails at the same
time, and stops a reconnected balance from being treated as freshly confirmed.

## MODIFIED Requirements

### Requirement: Synchronization failures are safe and actionable
Account-resource failures SHALL be reported to the renderer as bounded, sanitized categories that expose no credential value, signature, signed query, or raw response body. Each reported failure SHALL state whether retrying can plausibly succeed. A failure that cannot succeed on retry — including a client error such as a malformed or unsupported request — SHALL be reported as non-retryable, so the ticket does not offer an action that is guaranteed to fail. Diagnostics SHALL distinguish common configuration, permission, timestamp/clock, network/proxy, rate-limit, and exchange-response failures.

Where the exchange itself identified the failure, the operator-visible surface
SHALL present that sanitized exchange-reported code and message alongside the
local code, so a refusal by the exchange is distinguishable from a generic
local failure category.

#### Scenario: Futures permission is missing
- **WHEN** Binance rejects a signed futures request because the key lacks required futures permission
- **THEN** the renderer identifies the permission problem and offers refresh/retry guidance without revealing credentials

#### Scenario: Clock or receive-window validation fails
- **WHEN** Binance rejects a signed request because its timestamp is outside the accepted window
- **THEN** the renderer identifies local clock synchronization as the likely corrective action

#### Scenario: Retry is requested
- **WHEN** the operator invokes account refresh after a retryable failure
- **THEN** all required account resources are requested and their loading, success, or failure states are updated independently

#### Scenario: Permission failure
- **WHEN** Binance rejects an account read with an invalid-key, IP, or permission error
- **THEN** the resource reports a permission category, names the operator remedy, and is marked non-retryable

#### Scenario: Transient failure
- **WHEN** an account read fails from a network error, rate limit, clock skew, or exchange-side 5xx
- **THEN** the resource is marked retryable and Retry remains available

#### Scenario: Client error that retry cannot fix
- **WHEN** an account read fails with a 4xx response that is neither a permission nor a rate-limit failure
- **THEN** the resource is marked non-retryable and the ticket does not present retrying as a remedy

#### Scenario: The exchange named the refusal
- **WHEN** a rejection carries an exchange-reported code and message
- **THEN** the operator surface presents them alongside the local code rather than the local code alone

### Requirement: New operational failures produce a sliding alert
Each transition into a new configuration, account-resource, user-data-stream, or trading-command error SHALL create one sliding error notification using the application's shared notification surface. The notification SHALL identify the affected market/resource and sanitized corrective action. The detailed error and retry control SHALL remain visible in the relevant blocking screen or trading panel after the transient notification is dismissed.

A command rejection and an account-resource failure SHALL be presented as
separate facts. Neither SHALL displace or suppress the other, and a rejection
SHALL remain readable until the operator acknowledges it or issues another
command.

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

#### Scenario: A rejection and a resource failure occur together
- **WHEN** an account resource fails while a command rejection is being presented
- **THEN** both remain readable and the rejection is not replaced by the resource failure

## ADDED Requirements

### Requirement: A reconnected balance is stale until reconfirmed
After a transport or user-data reconnection, a previously confirmed balance
SHALL be treated as stale until a new confirmation arrives. Wherever a balance
is used for sizing or an exposure decision, its age SHALL be disclosed while it
is stale.

#### Scenario: Transport reconnects
- **WHEN** the renderer transport or the authenticated stream reconnects
- **THEN** the last confirmed balance becomes stale and does not report ready on the strength of its earlier confirmation

#### Scenario: Sizing against a stale balance
- **WHEN** a stale balance is presented while sizing controls are shown
- **THEN** its age is disclosed and percentage sizing remains unavailable until it is confirmed again

#### Scenario: Balance is reconfirmed
- **WHEN** a new balance snapshot succeeds after the reconnection
- **THEN** the balance becomes ready and its age is no longer flagged
