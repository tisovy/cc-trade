# spot-private-stream Specification

## Purpose

Own the signed Spot private subscription and expose its confirmed health so trading and account recovery do not mistake public data for private readiness.

## Requirements

### Requirement: Spot private events belong to a confirmed signed subscription

The main process SHALL subscribe through production WebSocket API `userDataStream.subscribe.signature` using its existing Spot HMAC credentials. It SHALL NOT create or renew a Spot REST listenKey. Only a matching successful acknowledgement with a valid subscriptionId SHALL establish readiness. Only events bearing the active connection's confirmed subscriptionId SHALL reach account consumers. Credentials and signed requests SHALL remain in main and SHALL NOT be logged or sent to renderer.

#### Scenario: Subscription zero is confirmed

- **WHEN** the matching acknowledgement reports success and subscriptionId 0
- **THEN** the stream becomes ready and events for subscription 0 are delivered

#### Scenario: The socket is open but the subscription is not confirmed

- **WHEN** transport opens, an unrelated acknowledgement arrives, or private events precede acknowledgement
- **THEN** no readiness is inferred and no unconfirmed event is delivered

#### Scenario: A different subscription or old socket sends an event

- **WHEN** an event belongs to another subscription or a replaced connection
- **THEN** it is ignored and cannot update balances, orders or current connection health

### Requirement: Spot private recovery has one bounded owner

One main-process controller SHALL own the subscription across active Spot renderers. It SHALL bound connection/acknowledgement waits, message size and retry attempts; observe protocol peer liveness without requiring account activity; and re-subscribe after unexpected termination. Authentication or rate-limit refusal SHALL NOT trigger an automatic retry loop. After successful subscription, main SHALL request balances and open orders to catch up on the gap. Recovery SHALL NOT resend trading commands.

#### Scenario: The account is quiet but the peer is alive

- **WHEN** no account event arrives but protocol heartbeat traffic continues
- **THEN** the subscription remains healthy without periodic REST listenKey renewal

#### Scenario: Connection or subscription is lost

- **WHEN** the peer closes, announces shutdown, ends the subscription, or stops all heartbeat traffic
- **THEN** readiness is withdrawn and bounded reconnection establishes a new subscription before delivery resumes

#### Scenario: Ownership ends while work is queued

- **WHEN** the last Spot renderer leaves or main closes while connection/subscription admission or retry is pending
- **THEN** timers and sockets are retired and queued work cannot open or subscribe for the old generation

#### Scenario: A renderer joins an existing subscription

- **WHEN** another Spot renderer activates while the shared subscription is already ready
- **THEN** it receives current health and no duplicate private connection is created

#### Scenario: Authentication or rate limit refuses subscription

- **WHEN** the exchange explicitly refuses credentials or applies rate-limit backpressure
- **THEN** health reports failure and automatic subscription retries stop

#### Scenario: A private event supersedes a pending account snapshot

- **WHEN** a REST account snapshot was started before a new private event or a subscription transition
- **THEN** its old result cannot overwrite current account state and any needed balance fallback is coalesced into a current read

#### Scenario: The last Spot consumer leaves during a balance read

- **WHEN** a shared balance fallback completes after the final Spot consumer has left
- **THEN** its result is not broadcast and it cannot restart private activity

### Requirement: The Spot desk states private-stream health independently of market data

The renderer SHALL show a persistent warning while the private subscription is not confirmed, even if market prices are live. Health SHALL reset across gateway loss or market deactivation and SHALL NOT be inferred from stored credentials, cached account data or public-market events.

#### Scenario: Public prices update while the private stream is unavailable

- **WHEN** market traffic is live but private subscription is connecting, recovering or failed
- **THEN** the warning remains visible and explains the limitation on new placements

#### Scenario: Gateway reconnects

- **WHEN** the renderer's gateway connection is lost and re-established
- **THEN** previous readiness is invalid until the current main session reports a confirmed subscription

#### Scenario: Health arrives before workspace mount

- **WHEN** current-generation health follows activation before the Spot workspace mounts
- **THEN** the gateway retains that health for the workspace without accepting an older connection or activation generation
