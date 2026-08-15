## Purpose

Strengthens the verification behind the production-only guarantee and corrects retryability reported for account-resource failures.

## MODIFIED Requirements

### Requirement: Runtime mock behavior does not exist
Production application code SHALL NOT generate or substitute synthetic exchange filters, balances, orders, executions, tickers, candles, positions, or successful trading acknowledgements. A trading command SHALL succeed only from an authenticated exchange operation. Mocks and fixtures MAY exist only in test-only files or test-injected dependencies that are unreachable from a production application build.

This guarantee SHALL be enforced by an automated check over the production source graph that does not depend on the historical names of removed symbols. The check SHALL resolve every first-party import it encounters, including aliased and bare specifiers, so that no reachable production module is skipped. The check SHALL fail when its reachable module count falls below a recorded floor, so a graph that silently stops being walked cannot report success. The check SHALL identify itself as covering the production source graph, distinct from the separate check covering built artifacts.

#### Scenario: Credentials are unavailable
- **WHEN** startup credential preflight fails
- **THEN** the application exposes the configuration error and does not generate fallback market or account data

#### Scenario: Trading adapter is unavailable
- **WHEN** a validated trading command reaches a runtime without an authenticated adapter
- **THEN** the command is explicitly rejected and no synthetic execution update is emitted

#### Scenario: Production application is built
- **WHEN** the production Electron/renderer artifacts are inspected or executed
- **THEN** no runtime branch, timer, seed state, or imported helper can activate simulated exchange behavior

#### Scenario: A mock returns under a new name
- **WHEN** synthetic market or account data is reintroduced into the production graph under a symbol name that was never previously used
- **THEN** the automated check fails and names the offending module

#### Scenario: A production module becomes unreachable to the check
- **WHEN** a production module is imported through an aliased or bare specifier, or the reachable module count drops below the recorded floor
- **THEN** the automated check fails rather than reporting success over a reduced graph

### Requirement: Synchronization failures are safe and actionable
Account-resource failures SHALL be reported to the renderer as bounded, sanitized categories that expose no credential value, signature, signed query, or raw response body. Each reported failure SHALL state whether retrying can plausibly succeed. A failure that cannot succeed on retry — including a client error such as a malformed or unsupported request — SHALL be reported as non-retryable, so the ticket does not offer an action that is guaranteed to fail. Diagnostics SHALL distinguish common configuration, permission, timestamp/clock, network/proxy, rate-limit, and exchange-response failures.

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
