# futures-live-readiness

## Purpose

Defines the production-only trading contract for Binance Spot and USDⓈ-M Futures: per-market credential preflight, fail-closed startup, observable account synchronization, sanitized operator-visible failures, and the disclosed gates behind real-money order entry.
## Requirements
### Requirement: Startup credential preflight fails closed
Before initializing market or account functionality for a market, the system SHALL validate the complete credential pair belonging to that market: `BK` and `BS` for Spot, `BFK` and `BFS` for USDⓈ-M Futures. A complete pair SHALL permit production initialization of that market only. A missing or partial pair SHALL produce a market-scoped `CONFIG_ERROR`, emit a sliding error alert naming the market and its missing variable names, and stop all Binance market/account initialization for that market. Credentials belonging to one market SHALL NOT be substituted for the other. When neither market is configured, the system SHALL additionally render a blocking configuration-error screen and start no exchange path at all. The application shell and local diagnostic path MAY remain available solely to present and recover from the error. No credential value SHALL appear in any envelope, alert, or log.

#### Scenario: Both pairs complete
- **WHEN** `BK`, `BS`, `BFK`, and `BFS` are all present
- **THEN** credential preflight reports both markets ready and the application may initialize the persisted production market workspace

#### Scenario: Spot pair only
- **WHEN** `BK` and `BS` are present and the Futures pair is absent
- **THEN** Spot initializes normally, Futures reports a configuration error naming `BFK` and `BFS`, no Futures adapter, user-data stream, or workstation runtime is constructed, and no blocking screen is shown

#### Scenario: Futures pair only
- **WHEN** `BFK` and `BFS` are present and the Spot pair is absent
- **THEN** Futures initializes normally, Spot reports a configuration error naming `BK` and `BS`, no Spot client or Spot trading adapter is constructed, and no blocking screen is shown

#### Scenario: Partial pair fails closed for its market
- **WHEN** exactly one value of a market's pair is present
- **THEN** that market fails closed and identifies its missing configuration field without exposing any secret value, while the other market is unaffected

#### Scenario: Neither pair present
- **WHEN** no complete pair exists for either market
- **THEN** the system shows a sliding missing-credentials alert and a blocking configuration-error screen and starts no Spot or Futures market/account connection, subscription, refresh, or trading command path

#### Scenario: Retired credentials are diagnosed
- **WHEN** retired futures credential names are present but no supported pair is complete
- **THEN** the system stops initialization and presents a migration diagnostic naming the supported configuration fields without logging credential contents

#### Scenario: Credentials are not shared between markets
- **WHEN** only one market's pair is configured
- **THEN** the other market's adapter is never constructed from the configured pair, and no request is signed for the unconfigured market

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

### Requirement: Command rejection is market-scoped
A trading, workstation, or market-activation command addressed to a market without a complete credential pair SHALL be rejected with a stable, bounded reason identifying the market and the missing configuration, and SHALL NOT be served by another market's authenticated adapter. Commands addressed to a configured market SHALL be unaffected by the other market's configuration state.

#### Scenario: Activating an unconfigured market
- **WHEN** the renderer requests activation of a market whose credentials are incomplete
- **THEN** the request is rejected with a named configuration reason and no subscription, refresh, timer, or stream starts for that market

#### Scenario: Trading command for an unconfigured market
- **WHEN** a validated trading command targets a market without an authenticated adapter
- **THEN** the command is explicitly rejected, no synthetic acknowledgement is emitted, and the other market remains able to trade

#### Scenario: Verification launches carry no production capability
- **WHEN** the application starts under the retained safe-development or bounded-smoke verification entry
- **THEN** both credential pairs are cleared before preflight and no production trading capability exists in that process

### Requirement: Open positions are marked to the live market
While at least one Futures renderer is active, the system SHALL subscribe to the
public USDⓈ-M mark price stream for exactly the symbols carrying an open
position and SHALL broadcast the received marks to Futures renderers. The feed
SHALL be unauthenticated, SHALL consume no REST weight, and SHALL NOT alter the
account snapshot resources or their reported synchronization state. The
subscription SHALL be reconciled only when the open-position symbol set
changes, and SHALL be torn down when no position is open or when the last
Futures renderer disconnects. On disconnect the system SHALL clear the marks it
has broadcast, so a consumer falls back to the account snapshot instead of
holding a mark that has stopped updating.

#### Scenario: A position is opened on a new contract
- **WHEN** the account snapshot first reports an open `BMTUSDT` position
- **THEN** the mark price stream is subscribed for `BMTUSDT` and its marks are broadcast to Futures renderers

#### Scenario: The position set is unchanged
- **WHEN** a further account snapshot reports the same open symbols
- **THEN** the existing subscription is kept and no socket is reconnected

#### Scenario: The last position is closed
- **WHEN** the account snapshot reports no open position
- **THEN** the mark price stream is closed and the broadcast marks are cleared

#### Scenario: The mark stream drops
- **WHEN** the mark price socket closes unexpectedly while positions are open
- **THEN** the marks are cleared for consumers, reconnection is attempted, and no account resource is reported as failed on account of the mark feed

#### Scenario: A malformed frame arrives
- **WHEN** the mark price socket delivers a frame that is not a mark price update
- **THEN** it is ignored, and no mark is broadcast for it
