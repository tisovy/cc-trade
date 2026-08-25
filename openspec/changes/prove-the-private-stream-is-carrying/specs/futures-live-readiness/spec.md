## ADDED Requirements

### Requirement: The authenticated stream connects on the route the exchange serves
The futures user-data stream SHALL be opened on the routed path the exchange
currently serves, and that path SHALL be registered in the same place the market
routes are, so a decommissioning notice cannot apply to it silently. The
migration and its date SHALL be stated where the URL is built.

An unrouted path SHALL NOT be reachable by accident, for the reason the market
routes already record: an unrouted path completes its handshake and holds the
socket open while delivering nothing, so it fails as silence rather than as an
error.

The route each attempt is made on SHALL be recorded when the socket is opened,
because a record that says a stream opened without saying where is what let one
prefix stay wrong for four months. The listen key SHALL NOT appear in that
record: it is a bearer credential for the account's own event stream, and the
record exists to be read and passed on.

#### Scenario: The desk opens the authenticated stream
- **WHEN** the futures user-data stream is started
- **THEN** it connects on the routed private path, not on the legacy unrouted one

#### Scenario: The registry is asked where the authenticated stream lives
- **WHEN** the recorded WebSocket routes are read
- **THEN** the user-data endpoint is among them, with the same prefix rule the market routes carry

#### Scenario: An event type the desk folds is not subscribed
- **WHEN** the connection form in use takes an explicit list of event types
- **THEN** every event the desk folds is named in it, so a missing type cannot become a new silence

#### Scenario: The route an attempt was made on is asked for afterwards
- **WHEN** a futures user-data connection is attempted, whether or not it completes
- **THEN** the record names the route it was attempted on, with the listen key removed

### Requirement: A private stream that is not carrying is not presented as ready
The authenticated futures user-data stream SHALL be presented as carrying only
while the exchange is demonstrably still talking on the socket. An open socket
SHALL NOT by itself be sufficient, because a route that no longer carries
completes the handshake and stays open.

Liveness SHALL be judged on traffic the exchange sends regardless of account
activity, not on account events, because an account with nothing happening on it
is correctly silent. The bound SHALL come from a measured run against the live
exchange rather than from an estimate, and SHALL be stated where it is enforced.

A stream that has been silent past that bound SHALL be presented as not
carrying, SHALL be restored, and SHALL NOT be counted as reporting orders while
it is not carrying — so that reads skipped on the grounds that the stream would
report them are taken again.

#### Scenario: The socket opens on a route that carries nothing
- **WHEN** the private socket completes its handshake and the exchange then sends nothing at all for longer than the bound
- **THEN** the stream is presented as not carrying, its restoration is attempted, and account resources the stream would have reported are read on their own beat again

#### Scenario: The account is quiet but the route is live
- **WHEN** no account event arrives for longer than the bound while the exchange's own keep-alive traffic continues
- **THEN** the stream stays presented as carrying and no restoration is attempted

#### Scenario: A command is issued while the stream is not carrying
- **WHEN** the operator places or cancels an order and the private stream is not carrying
- **THEN** the account read that a carrying stream would have made unnecessary is issued

### Requirement: A private stream that will not start states why
Every path that abandons an attempt to start the authenticated futures user-data
stream SHALL state a cause and SHALL either schedule another attempt or record
that it has given up. No path SHALL leave the stream resource loading with
nothing scheduled and nothing stated.

A listen key that was not obtained SHALL be distinguished from one whose request
was never made — a deliberate abandonment, such as the market having been left
or the renderer having gone, is not a failure and SHALL NOT be reported as one,
but SHALL still leave the resource in a state that names it.

#### Scenario: The exchange answers without a listen key
- **WHEN** the listen key request answers with no key in it
- **THEN** the stream resource is marked failed with a stated cause and another attempt is scheduled

#### Scenario: The attempt is abandoned because nobody is watching
- **WHEN** the attempt is abandoned because the futures market was left or the last renderer disconnected
- **THEN** the stream resource is left idle rather than loading, and no failure is reported to the operator

#### Scenario: The key is rejected for permission
- **WHEN** the exchange rejects the listen key request because the credential lacks futures permission
- **THEN** the stream resource is marked failed and non-retryable, the operator remedy is named, and no further attempt is scheduled

## MODIFIED Requirements

### Requirement: Account synchronization is observable per resource
The system SHALL expose synchronization state independently for balances, positions, regular open orders, algorithmic open orders, and the futures user-data stream. Each resource state SHALL distinguish at least loading, ready, stale, and error, include the time of the last successful update when available, and retain the last confirmed data during a retry failure rather than replacing it with an empty snapshot.

The user-data stream resource SHALL be ready only while it is carrying, as
defined above, and SHALL NOT remain in loading once an attempt to start it has
ended for any reason.

Each transition of the user-data stream — opened, silent past its bound,
abandoned, refused — SHALL be written to the desk's record with the cause that
produced it, so that a desk which spent a session without the stream can be
asked why after the fact. This SHALL use the record's existing event kinds and
SHALL NOT require a new one.

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

#### Scenario: Initial settled-income synchronization fails
- **WHEN** the first settled-income request fails before any confirmed reading exists
- **THEN** settled income enters error state and is not represented as a ready empty ledger

#### Scenario: Settled-income verification fails
- **WHEN** settled income was previously ready and a verification attempt fails
- **THEN** its last confirmed rows and successful time remain visible, the resource becomes stale, and the failure is independently retryable

#### Scenario: A session passes without the private stream
- **WHEN** the operator asks afterwards why a session reconciled on its beat all day
- **THEN** the record names which attempts were made and what ended each of them
