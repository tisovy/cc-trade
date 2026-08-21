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
Futures renderer disconnects.

On disconnect the system SHALL clear the marks it has broadcast, so a consumer
falls back to the account snapshot instead of holding a mark that has stopped
updating. Reconciling the symbol set is not such a disconnect: it is a rebuild
the system chose, in the same moment, for a reason unrelated to the contracts
that stayed. Their marks SHALL be retained across it, and only the marks of
symbols that left the set SHALL be dropped — otherwise opening or closing one
position blanks the live value of every other one, and each of those rows falls
back to an account snapshot from an earlier read until the new socket delivers.

Retained marks SHALL remain subject to the same stall window as any other, so a
rebuilt subscription that never delivers clears them exactly as a dead socket
does.

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

#### Scenario: A second contract is opened while the first is held
- **WHEN** a `BMTUSDT` position is open and marked, and a `BEATUSDT` position is then opened
- **THEN** the subscription is rebuilt for both and the broadcast marks still carry `BMTUSDT`, so its row is never valued from the account snapshot on account of another contract's position opening

#### Scenario: A contract leaves the tracked set
- **WHEN** the `BEATUSDT` position is closed while `BMTUSDT` stays open
- **THEN** `BEATUSDT` is dropped from the broadcast marks and `BMTUSDT` keeps its own

#### Scenario: A rebuilt subscription never delivers
- **WHEN** the socket is rebuilt for a changed symbol set and no mark arrives for longer than the stall window
- **THEN** the retained marks are cleared and the rows fall back to the account snapshot

### Requirement: An account reading states whether it is still confirmed
A held account snapshot SHALL carry whether it is confirmed by the current
transport connection. Losing the transport SHALL mark the held resources
unconfirmed while retaining their last values for reference. A resource SHALL
become confirmed again only when a read answers on the current connection, not
when a read is requested. Order sizing SHALL require a confirmed balance and
SHALL state the unconfirmed balance as the reason when it refuses.

#### Scenario: Transport reconnects
- **WHEN** the local transport drops and reconnects and the account refresh has been sent but not answered
- **THEN** the balance is presented as unconfirmed, order sizing is refused with that reason, and the last known values remain readable

#### Scenario: Refresh answers after reconnect
- **WHEN** the account read answers on the new connection
- **THEN** the balance is confirmed again and order sizing is available

### Requirement: A stalled market reading is not presented as current
When a streamed market reading — mark price above all — stops arriving for
longer than its stall window, the system SHALL present it as stale rather than
as the current value, and SHALL attempt to restore the stream. Numbers derived
from a stale reading SHALL be presented as derived from a stale reading.

#### Scenario: Mark price stream goes quiet
- **WHEN** no mark price arrives for longer than the stall window
- **THEN** the mark and every number derived from it are presented as stale, and the feed attempts to restore the stream

#### Scenario: Stream resumes
- **WHEN** mark prices arrive again
- **THEN** the readings are presented as current and the staleness is withdrawn

### Requirement: An unknown account reading is not presented as an empty one
Position and order surfaces SHALL distinguish "not yet read", "read failed" and
"none open". A surface with no rows and no successful read SHALL NOT state a
count of zero or describe the account as flat.

#### Scenario: Before the first successful account read
- **WHEN** the workspace opens and no account read has answered
- **THEN** the dock states that positions and orders are not yet known, and shows no count

#### Scenario: Account read failed
- **WHEN** the positions read fails
- **THEN** the dock states that the reading failed rather than reporting no open positions

### Requirement: A command outcome is not displaced by a background failure
The outcome of the operator's own last command SHALL remain visible while a
background account synchronization failure is being reported. An unresolved
outcome SHALL continue to rank above both. A rejection SHALL carry the
exchange-reported code when the exchange supplied one.

#### Scenario: Rejection during an account synchronization failure
- **WHEN** an order is rejected while an account resource is failing to refresh
- **THEN** both are readable, and the rejection names the exchange's own code

#### Scenario: Unresolved outcome outranks both
- **WHEN** a command outcome is unresolved
- **THEN** it is presented above the rejection and the synchronization failure, and offers no retry control

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

### Requirement: The renderer runtime is issued before any window can request it
The main process SHALL register the local runtime endpoint and its
authentication token for a renderer before creating the window that will
request them. A request from an unregistered sender SHALL yield no runtime.
There SHALL be no default endpoint and no empty-token path: a renderer without
an issued runtime SHALL fail closed and state why, and SHALL make no connection
attempt.

#### Scenario: Window is created after registration
- **WHEN** a renderer window is created
- **THEN** its runtime endpoint and token are already registered and its synchronous preload request is answered with them

#### Scenario: Preload asks from an unregistered sender
- **WHEN** a preload requests the runtime from a sender that has no registration
- **THEN** no runtime is returned, no default endpoint is substituted, and the renderer presents a stated startup failure

#### Scenario: No fallback endpoint exists
- **WHEN** the application source is inspected for a default local endpoint or an empty-token connection path
- **THEN** none exists in the production graph

### Requirement: Authentication failure on the renderer transport is terminal
The renderer SHALL treat a rejected authentication token as a terminal
condition for its transport: it SHALL stop reconnecting, surface the failure
with a stated reason, and resume only on an explicit operator action or a newly
issued runtime. Transport losses that are not authentication failures SHALL
continue to reconnect.

#### Scenario: Token is rejected
- **WHEN** the local runtime rejects the renderer's token
- **THEN** the retry loop stops, one stated failure is surfaced, and no further connection attempt is made automatically

#### Scenario: Ordinary connection loss
- **WHEN** the transport closes without an authentication failure
- **THEN** reconnection continues as before

#### Scenario: A new runtime is issued
- **WHEN** a new runtime endpoint and token become available after a terminal authentication failure
- **THEN** the renderer may connect again

### Requirement: A runtime is addressable only by its own renderer
Each independently constructed renderer runtime SHALL receive its own endpoint
and token. A connection presenting a token that the receiving runtime did not
issue SHALL be refused.

#### Scenario: Independent runtimes exist concurrently
- **WHEN** two renderer runtimes are constructed with independently issued endpoint and token pairs
- **THEN** neither renderer can connect to the other's runtime

#### Scenario: A foreign token is presented
- **WHEN** a connection presents a token issued by a different runtime instance
- **THEN** the connection is refused and no market or account work is performed for it

### Requirement: The account moves with the stream that reports it
The authenticated user-data stream SHALL be the desk's first source for the
wallet and the open positions. An `ACCOUNT_UPDATE` SHALL be folded into the held
balances and positions as it arrives — the wallet balance it states, and per
position its size, entry price, margin mode and isolated wallet — without
waiting for a REST read of the same facts. A position the frame reports at zero
size SHALL leave the held set; a position the frame does not mention SHALL be
carried unchanged. A resource that has never been read successfully SHALL NOT be
folded into, so a frame describing part of the account is never presented as the
whole of it. The folded position set SHALL drive the mark price subscription and
the per-contract leverage read on the same terms an account read does.

An execution report reporting a fill SHALL NOT issue an account read of its own:
the `ACCOUNT_UPDATE` the exchange sends for the same fill is what carries the
wallet and the position it moved.

#### Scenario: A fill moves a position
- **WHEN** an `ACCOUNT_UPDATE` reports the position size and entry price after a fill
- **THEN** the held position carries the frame's size and entry price without waiting for a read, and the accompanying execution report issues no read of its own

#### Scenario: A position is closed on the stream
- **WHEN** an `ACCOUNT_UPDATE` reports a position at zero size
- **THEN** it leaves the held positions at once, and positions on other contracts are left as they were

#### Scenario: A wallet-only frame arrives
- **WHEN** an `ACCOUNT_UPDATE` reports a changed wallet balance and no position
- **THEN** the held wallet balance is updated and the held positions are left exactly as they were

#### Scenario: Nothing has been read yet
- **WHEN** an `ACCOUNT_UPDATE` arrives before any successful balance or position read
- **THEN** nothing is folded, and the resources stay as they were

#### Scenario: A position opens on a contract the desk holds nothing on
- **WHEN** an `ACCOUNT_UPDATE` reports a position on a contract with no held row
- **THEN** the row is created from what the frame states, the mark price stream is subscribed for that contract, and the contract's leverage is read

### Requirement: Values no stream carries are read, not computed
The liquidation price, the margin a position commits and the free margin an
order may be sized against are not carried by any authenticated stream. The
system SHALL show, and SHALL size an order against, only what the exchange
answered — never a value it derived itself. It SHALL read them from the
exchange, and SHALL do so only when a fold moved something they depend on: a
position whose size, entry, margin mode or isolated wallet changed, or a wallet
balance that moved. Such a read SHALL name only the resources whose unstated
values moved, and SHALL issue nothing when none did.

The system MAY compute the same values for comparison, and SHALL keep any value
so computed out of everything the operator sees or trades against. A computed
value SHALL reach the desk's record and nothing else.

Placing, amending or cancelling an order changes the free margin and is reported
by no stream, so it SHALL cause the balances alone to be read.

These reads SHALL be coalesced, so that a burst of stream frames costs one pass
rather than one per frame, and the held reading SHALL remain usable while such a
read is in flight.

#### Scenario: A position's size changes
- **WHEN** a fold changes a held position's size
- **THEN** the positions and balances are read back for the liquidation price, the margins and the free margin

#### Scenario: Only the wallet moved
- **WHEN** a fold changes the wallet balance and no position
- **THEN** the balances are read back and the positions are not

#### Scenario: Nothing unstated moved
- **WHEN** a fold changes nothing the held account did not already say
- **THEN** no read is issued

#### Scenario: A burst of frames arrives
- **WHEN** several `ACCOUNT_UPDATE` frames are folded within the coalescing window
- **THEN** one read is issued covering everything they moved, not one per frame

#### Scenario: An order is placed
- **WHEN** an order is placed, amended or cancelled
- **THEN** the balances are read back so the free margin reflects the margin it locked or released, and the positions and order lists are not read for it

#### Scenario: A position opens before its liquidation price is known
- **WHEN** a position is folded onto a contract the desk holds no read for
- **THEN** the row is shown without a liquidation price rather than with one the desk computed, and the price appears when the read answers

#### Scenario: The desk's own answer disagrees with the exchange's
- **WHEN** the value the desk computed differs from the one the read answered
- **THEN** the exchange's value is what is shown and what an order is sized against, and the difference is recorded

### Requirement: The desk computes the values no stream carries
The system SHALL compute, from what it already holds, the values no stream
carries: each held position's notional, initial margin, maintenance margin and
liquidation price, and the account's free margin. While a read of the same
values is available, what it computes SHALL be used for comparison only and
SHALL reach the record and nothing else. It SHALL compute them from the
contract's maintenance-margin brackets, the contract's leverage and margin mode,
the mark price, the folded position and wallet, and the resting orders — without
issuing a read of its own for the purpose.

Where a bracket, a mark price, a leverage or a margin mode is missing, the system
SHALL state that it could not compute the value rather than substitute a default,
a zero or a value from a different contract.

The maintenance-margin brackets SHALL be kept from the answer the desk already
reads for a contract's leverage ceiling, held per contract and forgotten on the
same terms as the contract's other settings.

#### Scenario: A position is held with everything the arithmetic needs
- **WHEN** the desk holds a position, the contract's brackets, its leverage and a mark price
- **THEN** it computes that position's notional, initial margin, maintenance margin and liquidation price

#### Scenario: A contract with no brackets held
- **WHEN** a position is held on a contract whose brackets have not been read
- **THEN** the desk states that it could not compute that position's maintenance margin and liquidation price, and computes nothing in their place

#### Scenario: The brackets come from a read already made
- **WHEN** the desk reads a contract's leverage ceiling
- **THEN** the whole bracket table from that answer is kept, and no further read is issued to obtain it

#### Scenario: A resting order commits margin
- **WHEN** the account has resting orders that are not reduce-only
- **THEN** the computed free margin counts the margin they commit, and counts nothing for a reduce-only order

#### Scenario: A bracket answer is not safe to calculate from
- **WHEN** a bracket answer is partial, malformed, or carries a non-default user bracket multiplier whose application is not stated
- **THEN** the exchange-derived leverage ceiling remains usable, but the desk states that it could not compute margin from that table

#### Scenario: A spawned order identity exists on another contract
- **WHEN** an algo names an actual order identity that is also used by a regular order on a different contract
- **THEN** both contracts' orders remain in the free-margin calculation because order identities are contract-scoped

#### Scenario: A resting order has impossible filled quantity
- **WHEN** a resting order states an executed quantity greater than its original quantity
- **THEN** the desk states that it could not compute free margin rather than treating the order as fully filled

#### Scenario: A short position is compared
- **WHEN** the exchange states a signed negative notional for a short position
- **THEN** its magnitude is compared with the desk's positive notional magnitude, and equal values record zero basis points

#### Scenario: Position initial margin is compared
- **WHEN** a position row states both position and open-order initial margin
- **THEN** the position estimate is compared with `positionInitialMargin`, not with the aggregate `initialMargin`

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

### Requirement: A request does not pay again for a connection the desk already has
Futures REST requests SHALL be issued on connections that outlive the request
they were opened for, drawn from a bounded pool, so that a burst of requests to
one origin costs one handshake rather than one each. The pool SHALL bound both
the connections in use and the connections held idle.

Measured on 2026-08-16 against the live exchange on this desk's own route and
proxy: a request that opens its own connection answers in 630 ms, the same
request on a connection already open answers in 325 ms. The bound this justifies
is not a timeout but a cost — ~305 ms paid per request, on every account beat,
every history page and every command.

A request that fails on a connection taken from the pool, before any byte of a
response has arrived, SHALL be retried once on a connection opened for it, and
its answer SHALL be that retry's answer. This is the behaviour the pool
replaced, kept reachable for the one failure the pool introduces: a connection
the far side closed while it was idle, handed out in the instant before that
close was noticed.

The retry SHALL NOT be used to repair failures the desk had before the pool
existed. A request that opened its own connection and failed SHALL fail as it
did before. A retry that fails SHALL be reported as the request's failure, not
swallowed and not reported as the first failure.

#### Scenario: A second request follows the first
- **WHEN** a futures REST request is issued while a usable connection to the same origin is idle in the pool
- **THEN** it is sent on that connection and no new handshake is performed

#### Scenario: The far side closed a pooled connection
- **WHEN** a request sent on a pooled connection fails with a connection-level reset before any byte of a response
- **THEN** it is retried once on a connection opened for it, and the caller receives the retry's answer

#### Scenario: The fallback fails as well
- **WHEN** the retry on a newly opened connection also fails
- **THEN** the caller receives that failure, and it is distinguishable in the record from the reuse failure that caused the retry

#### Scenario: A request that opened its own connection fails
- **WHEN** a request that was not served from the pool fails
- **THEN** it is not retried, and the caller sees exactly the failure it would have seen before the pool existed

#### Scenario: The pool is bounded
- **WHEN** more requests are in flight than the pool's limit
- **THEN** the excess waits for a connection rather than opening connections without limit

### Requirement: The record says when a request paid for a connection
The record SHALL state each time a futures REST request had to open its own
connection, and what that opening cost, so that a pool which has silently
stopped being used is visible rather than merely slow. It SHALL state a fallback
to a fresh connection, and a fallback that itself failed, as distinct causes.

A request served from the pool SHALL record nothing of its own. The absence of
these lines is the evidence that reuse is working, and it is what keeps a
working pool from writing a line per request into a record that a history sweep
already fills.

#### Scenario: A request opens its own connection
- **WHEN** a futures REST request cannot be served from the pool and opens a connection
- **THEN** the record carries the cost of that request, marked as a pool miss

#### Scenario: Requests are served from the pool
- **WHEN** futures REST requests are served from connections already open
- **THEN** the record carries nothing per request for them

#### Scenario: The record is asked why the desk is slow again
- **WHEN** the pool stops serving requests for any reason
- **THEN** the connection-opening lines reappear at the rate requests are made, naming the cost each one paid

### Requirement: Restoring the private stream is not queued behind a review
The request that starts or restores the authenticated user-data stream SHALL be
admitted ahead of reads the operator merely asked to look at. Where both contend
for the same rate-limited admission queue, the desk SHALL NOT stay without its
authenticated stream for the length of a history fan-out.

The overtaking SHALL remain bounded, so a history read already under way still
finishes.

The keep-alive renewal of an existing key is not covered by this requirement: it
runs far enough inside the key's lifetime that queue order cannot expire it.

#### Scenario: The stream drops while the operator is reading their history
- **WHEN** the authenticated stream has to be rebuilt while a history fan-out is queued
- **THEN** the listen-key request is admitted ahead of the fan-out's remaining requests, and the fan-out still completes

### Requirement: Detached Futures account reads settle where they are started
A Futures account refresh that is deliberately started without delaying its caller SHALL settle any rejection at that launch site. Its diagnostic SHALL identify the bounded refresh reason and sanitized failure category, SHALL expose no credential, signature, signed query or raw response body, and SHALL NOT reach the process-wide unhandled-rejection path. Resource-level failure reporting and retained account data SHALL remain unchanged.

#### Scenario: An unstated-value refresh fails
- **WHEN** the coalesced background refresh for unstated account values rejects
- **THEN** the launch site records a sanitized failure naming the `unstated` reason and no process-wide unhandled rejection is produced

#### Scenario: A stream refresh fails
- **WHEN** the refresh started after the private stream connects rejects
- **THEN** the launch site records a sanitized failure naming the `stream` reason and the stream callback remains detached

#### Scenario: A bootstrap refresh fails
- **WHEN** the refresh started during Futures account bootstrap rejects
- **THEN** the launch site records a sanitized failure naming the `bootstrap` reason and the existing per-resource failure states remain the account truth
