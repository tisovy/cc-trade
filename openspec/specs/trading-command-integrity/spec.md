# trading-command-integrity Specification

## Purpose
States the absence of a parallel legacy submission path as a property of the
system, so the local band check found in `src/utils/operations.js` cannot
return and no unreachable order-entry code is left reading as available.

## Requirements

### Requirement: The renderer has one reachable trading-submission path
Every trading submission the renderer can make SHALL be built by the typed
command builders and SHALL carry the validation, the command identity and the
risk ceiling those builders and the main process apply. The renderer SHALL NOT
retain an unreachable order-entry or cancellation path alongside them, and
SHALL NOT evaluate an exchange filter that the desk has delegated to the
exchange.

#### Scenario: A legacy submission helper has no caller
- **WHEN** a renderer function that sends a trading frame has no caller
- **THEN** it is deleted rather than kept, so no path exists that bypasses typed validation, command identity and the risk ceiling

#### Scenario: A submission frame is built
- **WHEN** the renderer sends any trading command
- **THEN** the frame comes from the typed command builders and no other module composes one

#### Scenario: A delegated filter is evaluated locally
- **WHEN** renderer code evaluates the price minimum or maximum, the percent-price band, or the maximum open order count
- **THEN** that evaluation is removed, whether or not the code holding it is reachable

### Requirement: An indeterminate execution outcome is not reported as a rejection
The system SHALL distinguish a determinate outcome, where the exchange answered
with an acceptance or a business rejection, from an indeterminate outcome,
where the request may or may not have executed. A request timeout, a socket
error, an aborted response, and an exchange-side 5xx response on a mutating
request SHALL each produce an explicit unresolved outcome carrying the
command's client identity. An indeterminate outcome SHALL NOT be presented to
the operator as a rejection, and SHALL NOT be presented as a success.

#### Scenario: Order placement times out
- **WHEN** a submitted order request exceeds the transport timeout
- **THEN** the command reports an unresolved outcome carrying its client identity, and neither a rejection nor an execution acknowledgement is emitted

#### Scenario: Exchange returns an unknown-error response
- **WHEN** the exchange answers a mutating request with a 5xx response
- **THEN** the command reports an unresolved outcome, because the execution may already have occurred

#### Scenario: Exchange rejects the order on its merits
- **WHEN** the exchange answers with a business rejection such as a filter or margin failure
- **THEN** the command reports a determinate rejection with the exchange-reported reason

#### Scenario: Both markets classify alike
- **WHEN** an indeterminate transport failure occurs on a Spot command
- **THEN** it is classified exactly as the equivalent Futures failure is

### Requirement: An unresolved outcome is reconciled before any resubmission
The system SHALL reconcile an unresolved order mutation using bounded read-only
queries under its requested identity. Confirmation SHALL require the requested
action's postcondition: placement acceptance, cancelled status, or exact requested
amendment terms. Repeated explicit absence may settle placement only; it SHALL
NOT prove cancellation or amendment. Any permitted resubmission SHALL reuse the
original intent identity. Inconclusive reconciliation SHALL remain unresolved
and SHALL NOT offer a retry control.

#### Scenario: The ambiguous order actually executed
- **WHEN** reconciliation finds the requested order and proves the requested action's postcondition
- **THEN** that evidence becomes the outcome of the command and no second mutation is submitted

#### Scenario: The ambiguous order never reached the exchange
- **WHEN** all bounded reconciliation observations explicitly confirm that no order exists under an ambiguous placement's client identity
- **THEN** the intent may be resubmitted, and it is resubmitted under the same client identity

#### Scenario: Reconciliation itself keeps failing
- **WHEN** the bounded reconciliation attempts are exhausted without an answer
- **THEN** the command remains reported as unresolved, the operator is told the exchange state is unconfirmed, and no retry control is offered

### Requirement: A command identity is stable across retries
The system SHALL mint one client identity per operator intent and SHALL preserve
it across every rebuild, retry, and redelivery of that intent on both markets.
The identity SHALL be sent to the exchange as the order's client order id on
Spot and on Futures. A retry SHALL NOT mint a new identity.

#### Scenario: A retried intent keeps its identity
- **WHEN** an intent is submitted again after an unresolved or transient failure
- **THEN** the exchange receives the client identity of the first attempt

#### Scenario: Spot placement carries the identity
- **WHEN** a validated Spot placement command carrying a client identity is submitted
- **THEN** the exchange request carries that identity as the new client order id

#### Scenario: Operator-supplied identity is honoured
- **WHEN** the command payload already carries a client identity
- **THEN** that identity is used unchanged rather than replaced by a generated one

### Requirement: Reconciliation after a mutating command cannot be lost
A reconciliation requested after a placement, amendment or cancellation SHALL
be performed even when another reconciliation is already running: it SHALL be
queued rather than discarded. Each account snapshot SHALL carry the mutation
epoch it was started under, and a snapshot whose epoch precedes the most recent
confirmed mutating command SHALL NOT replace state produced by that command.

#### Scenario: A refresh is already running
- **WHEN** a mutating command completes while an account refresh is in flight
- **THEN** a further refresh runs after the current one instead of being dropped

#### Scenario: An older snapshot lands late
- **WHEN** a snapshot started before a confirmed amendment returns after it
- **THEN** the snapshot does not restore the pre-amendment order state

#### Scenario: A newer snapshot lands
- **WHEN** a snapshot started after the last confirmed mutating command returns
- **THEN** it replaces the local state as the current account truth

### Requirement: Every trading command failure reaches the operator
A determinate Spot or Futures command failure SHALL produce a market-scoped
`command_rejected` carrying a stable local code and sanitized explanation. An
indeterminate failure SHALL instead produce `command_unresolved`; a failed
request alone SHALL NOT prove that a mutation was rejected. Neither outcome
SHALL be reported only to the application log.

#### Scenario: Spot placement fails
- **WHEN** a Spot order placement fails at the exchange or in transport
- **THEN** the operator receives a market-scoped rejection for a determinate refusal or an unresolved warning for insufficient execution evidence

#### Scenario: Spot cancellation fails
- **WHEN** a Spot cancellation fails
- **THEN** a market-scoped rejection or unresolved warning is emitted according to the evidence, rather than a log-only entry

#### Scenario: An unresolved outcome is not a rejection
- **WHEN** a command ends unresolved rather than failed
- **THEN** it is reported as unresolved and is not emitted as a rejection

### Requirement: Trading commands are ordered no more coarsely than the order they name
The main process SHALL order a mutating command against its proven order aliases
and SHALL NOT hold it behind a command about a proven distinct order. A command that
speaks for a whole contract rather than for one order on it — cancelling every
order, setting leverage, setting margin type, adjusting position margin — SHALL
run alone on that contract: every command about an order on it that was accepted
earlier SHALL complete first, and every command accepted after it SHALL wait for
it. A command whose target aliases are unknown or contradictory SHALL be ordered
against its whole contract rather than assumed independent.

This is the granularity of the ordering guarantee, not a relaxation of it: two
commands about one order stay serialized exactly as before.

#### Scenario: Two orders on one contract are worked at once
- **WHEN** a placement for one order is in flight and a cancellation for a proven distinct order on the same contract is accepted
- **THEN** the cancellation reaches the exchange without waiting for the placement to be answered

#### Scenario: A contract-wide command is accepted while an order command is running
- **WHEN** a cancel-all, leverage, margin-type or position-margin command is accepted on a contract that already has an order command in flight
- **THEN** it runs only after that command has completed, so no order placed before it was accepted can survive it

#### Scenario: An order command is accepted while a contract-wide command is running
- **WHEN** a command about a single order is accepted on a contract whose cancel-all, leverage, margin-type or position-margin command is still running
- **THEN** it waits for that command to complete

#### Scenario: A command names no order the desk can identify
- **WHEN** a mutating command about an order carries no usable target identity or its target aliases are unproved or contradictory
- **THEN** it is ordered against every other command on its contract

### Requirement: An unresolved outcome is cleared only by an answer to that command
An unresolved command SHALL be held together with the identity of the command
it belongs to — the symbol and the order identifiers the command was issued
with. The system SHALL clear it only on a matching action-specific rejection or
reconciliation result, or on a report carrying an explicit matching symbol and
order identity that proves the held action's postcondition or terminal outcome. Traffic belonging to any other
order or symbol SHALL leave the unresolved state exactly as it was.

#### Scenario: Unrelated order updates while an outcome is unknown
- **WHEN** a placement on one contract has an unresolved outcome and an execution update for a different contract arrives
- **THEN** the unresolved outcome remains on screen and no retry is offered

#### Scenario: The command's own answer arrives
- **WHEN** an execution report proves the held action's postcondition or terminal outcome, or a rejection names that same action and identity
- **THEN** the unresolved outcome is cleared and replaced by that answer

#### Scenario: Both markets hold it the same way
- **WHEN** a Spot command's outcome is unknown and a different Spot order is refused afterwards
- **THEN** the unknown outcome is still shown, beside the refusal rather than replaced by it

#### Scenario: The command could not be identified
- **WHEN** an ambiguous failure occurred on a command whose identity the system could not determine
- **THEN** the unresolved outcome is cleared only by the reconciliation result for that command, never by unrelated traffic

### Requirement: An order the exchange does not report is asked for again before it is called absent
When reconciling an ambiguous placement, the system SHALL treat a lookup that
reports no such order as provisional. It SHALL repeat the lookup up to the
bounded attempt count, spaced in time, and SHALL conclude absence only when
every configured observation explicitly reports absence. Failed or HTTP-indeterminate
reads SHALL NOT count as absence. For cancellation or amendment, absence SHALL
remain inconclusive. The total number of exchange reads SHALL remain bounded.

#### Scenario: Order appears on a later lookup
- **WHEN** the first placement reconciliation lookup reports no such order and a later attempt finds it
- **THEN** the command resolves as executed, its execution report is emitted, and no rejection is produced

#### Scenario: Order absent on every attempt
- **WHEN** every configured placement lookup explicitly reports no such order
- **THEN** the command resolves as not executed and the market's absent-outcome handling applies

#### Scenario: Both markets reconcile alike
- **WHEN** a Spot command reconciles an ambiguous outcome
- **THEN** it retries a "no such order" answer exactly as the Futures path does

### Requirement: Cancel all cancels every order it presented
A cancel-all SHALL cancel every open order in the scope the operator was shown,
including orders of a kind that the exchange keeps in a separate book, using the
cancellation route each kind requires. When one kind cannot be cancelled the
system SHALL report which orders may still be live rather than reporting an
unqualified success.

#### Scenario: Conditional orders are open alongside regular ones
- **WHEN** the operator cancels all with both regular and conditional (ALGO) orders open
- **THEN** both books are cancelled and the resulting account read shows neither

#### Scenario: One book fails to cancel
- **WHEN** the regular cancellation succeeds and the conditional one fails
- **THEN** the operator is told that conditional orders may still be live, and the failure names the reason

#### Scenario: A single conditional order is cancelled
- **WHEN** the operator cancels one conditional order from any surface that lists it
- **THEN** the cancellation is sent on the route that accepts that order's identifier

### Requirement: Duplicated commands cannot reach the exchange twice
The main process SHALL maintain a bounded registry of in-flight and recently
completed trading commands, keyed by command identity. A command whose identity
is already in flight or already completed SHALL be answered from the registry
instead of being submitted to the exchange. The registry SHALL be bounded in
size and age so it cannot grow without limit.

#### Scenario: The same frame is delivered twice
- **WHEN** two identical trading command frames arrive concurrently
- **THEN** exactly one exchange submission occurs and both frames receive the same outcome

#### Scenario: A completed command is redelivered
- **WHEN** a command identity that already completed is delivered again
- **THEN** the recorded outcome is returned and no new submission occurs

#### Scenario: The registry stays bounded
- **WHEN** commands accumulate over a long session
- **THEN** the registry evicts by age and size and never grows without limit

### Requirement: Mutating commands on the same order are serialized
The system SHALL execute mutating commands that target the same order identity,
and the same symbol, in the order they were accepted. An amendment and a
cancellation of one order SHALL NOT be in flight against the exchange
simultaneously.

#### Scenario: Amend and cancel arrive together
- **WHEN** an amendment and a cancellation for one order are accepted in that order
- **THEN** the exchange receives the amendment first and the cancellation only after the amendment has resolved

#### Scenario: Commands on different symbols
- **WHEN** mutating commands target different symbols
- **THEN** they may proceed concurrently

### Requirement: A transport retry cannot become a second order
A retry issued by the transport, rather than by a caller that knows what it
sent, SHALL be confined to failures that prove the exchange did not receive the
request. Reusing connections makes one such failure possible — a connection the
far side closed while idle, whose reset is delivered in place of the request —
and the retry exists for that failure and no other.

The transport SHALL retry only when all of the following hold: the connection
was taken from the pool rather than opened for this request, no byte of a
response has arrived, and the failure is a connection-level reset or broken
pipe. It SHALL NOT retry a timeout, SHALL NOT retry any HTTP status including
5xx, and SHALL NOT retry once a response has begun — each of those may have been
received and acted on, which is an indeterminate outcome and is already carried
as one.

A transport retry SHALL reuse the request exactly as first composed, including
the identity the command was given, so that a duplicate arising from any cause
outside this rule is refused by the exchange rather than filled.

#### Scenario: A mutating command meets a closed pooled connection
- **WHEN** an order placement sent on a pooled connection fails with a connection reset before any response byte
- **THEN** it is sent once more on a new connection with the same command identity, and exactly one order can reach the exchange

#### Scenario: A mutating command times out
- **WHEN** an order placement exceeds the request timeout
- **THEN** the transport does not retry it, and the outcome stays indeterminate for the reconciliation path to resolve

#### Scenario: The exchange answers with a server error
- **WHEN** an order placement receives a 5xx response
- **THEN** the transport does not retry it, and the existing indeterminate handling applies unchanged

#### Scenario: The connection fails after the answer has begun
- **WHEN** a response has started arriving and the connection then fails
- **THEN** the transport does not retry, because the exchange has already acted on the request

### Requirement: A spot request does not buy a connection the desk already has
The spot REST leg SHALL issue its requests on a bounded connection pool, so a
request that can be served on an open connection does not pay for a new one. A
request that opens a connection SHALL say so in the record; one served from the
pool SHALL say nothing, so the working case cannot bury its own evidence.

Each leg SHALL hold its own agent. The spot REST pool, the futures REST pool and
the agent the WebSocket callers use are three, so none can exhaust another's
sockets, and the stream agent SHALL NOT pool — a stream opens one connection and
holds it.

Reuse introduces exactly one new failure: the far side closes a connection while
it sits idle, and the next request on it fails before any byte of a response.
This SHALL be carried as the indeterminate outcome it already is — the command
reconciled against the exchange before any resubmission — and SHALL NOT be
retried blindly.

#### Scenario: A run of spot requests
- **WHEN** the desk issues several spot REST requests in succession
- **THEN** they are served on connections already open, and only the first opens one

#### Scenario: A connection is opened
- **WHEN** a spot request has no free connection and opens one
- **THEN** the record says a connection was opened, and a request served from the pool records nothing

#### Scenario: An idle connection was closed by the exchange
- **WHEN** a spot command fails on a pooled connection the far side had already closed
- **THEN** it is reported as an outcome the desk does not know and reconciled against the exchange, not reported as a refusal and not resubmitted

#### Scenario: The stream agent
- **WHEN** the spot client opens its WebSocket streams
- **THEN** it uses an agent that does not pool, and that agent is not the one the REST leg uses

### Requirement: A command does not wait on a read the operator is not waiting for
A mutating spot command SHALL be complete when the exchange has answered it and
that answer has been emitted. An account read issued because the command changed
something SHALL NOT be awaited inside the command, so the operator's next action
does not queue behind a refresh they were not waiting for.

A futures configuration command — the margin mode, the leverage multiple — SHALL
be complete when the exchange has answered it and the re-read configuration has
been broadcast: the configuration is the surface the operator is watching, and
the account pass behind it prices consequences, not the answer. That pass SHALL
still run, and a pass that fails SHALL still be recorded.

The read SHALL still happen. What changes is only whether the command holds until
it answers.

Where the screen would be wrong until the read answers, the wait SHALL be kept
and the reason stated at that call site. That is the case after an unresolved
outcome has been reconciled: the desk has just learned what became of an order,
and the operator must not act on a screen that predates it.

Because mutating commands are serialized per contract, a wait inside one
command's answer is a wait in front of the operator's next command on that
contract. A command SHALL NOT hold that lane on work the operator did not ask
to wait for.

#### Scenario: An order is accepted
- **WHEN** the exchange accepts a spot order and the desk emits the execution report
- **THEN** the command is done, and the account read it triggers runs without the command waiting on it

#### Scenario: A margin-mode change is accepted
- **WHEN** the exchange accepts a futures margin-mode change and the re-read configuration has been broadcast
- **THEN** the command is done, and the account pass it triggers runs without the command — or the next command on that contract — waiting on it

#### Scenario: The account pass behind a configuration change is deferred by the budget
- **WHEN** the desk's own read budget defers the account pass that follows a configuration change
- **THEN** a second configuration command on the same contract is answered in round-trip time rather than queuing behind the deferred pass

#### Scenario: An unknown outcome has just been resolved
- **WHEN** a spot command's outcome was unknown and reconciliation has just established what happened
- **THEN** the account read is awaited, because the screen is wrong until it answers and the operator may act on it

#### Scenario: The read is the command
- **WHEN** the operator asks the desk to refresh the spot account
- **THEN** the read is awaited, because it is the whole of what was asked for and no outcome was emitted in front of it

### Requirement: A displayed position closes on the first command

The desk SHALL confirm a reduce-only order against the newest successful
positions reading, and SHALL NOT void that evidence because the reading is
being re-confirmed — an in-flight account refresh or a re-activation of the
contract's market data is not a reason to refuse. When no successful reading
exists at all, the command SHALL wait, bounded, for the in-flight pass rather
than refuse on sight, and SHALL be refused only when the reading disagrees
with the requested reduction or the bound expires without a reading.

#### Scenario: Closing while the account reading is re-stamped

- **WHEN** the desk displays an open leg from its last successful positions reading, a book recovery or refresh pass is re-stamping that reading, and the operator sends a matching reduce-only close
- **THEN** the order is confirmed against the displayed reading and sent on the first command

#### Scenario: A wrong reduction is still refused

- **WHEN** a reduce-only order names a leg, side, or quantity the newest successful positions reading disagrees with
- **THEN** the order is refused and not sent

### Requirement: A reduction refusal names its cause

A `FUTURES_REDUCTION_NOT_CONFIRMED` refusal SHALL name which condition failed
— no successful reading, reading stale beyond the allowed bound, quantity
exceeding the open leg, leg mismatch, or side mismatch — in both the
operator-facing rejection detail and the journal's `outcome` line.

#### Scenario: Diagnosing a refusal from its own line

- **WHEN** a reduce-only order is refused for any cause
- **THEN** the journal `outcome` line and the popup carry the named condition, and no journal archaeology is needed to tell a transient reading gap from a wrong order

### Requirement: The Spot SDK boundary preserves outcome evidence

The Spot REST boundary SHALL preserve HTTP status and explicit numeric exchange error codes before the SDK discards them, and SHALL distinguish confirmed business refusal from unknown execution. A network failure whose transport details have been discarded, an unreadable response, HTTP 5xx, or an exchange code declaring unknown execution SHALL NOT become a confirmed rejection. The boundary SHALL NOT infer order absence from human-readable messages. All consumers of the shared REST client, including public reads, SHALL receive failures rather than success-shaped error bodies. Error objects exposed beyond the boundary SHALL NOT include credential-bearing request configuration or raw request URLs.

#### Scenario: The installed SDK loses network details

- **WHEN** a Spot mutation's transport fails without a usable response and the installed SDK provides only its NetworkError
- **THEN** the boundary explicitly marks the outcome unknown and the command enters bounded reconciliation without resending the mutation

#### Scenario: The exchange explicitly reports no such order

- **WHEN** a lookup receives a determinate HTTP 400 with numeric exchange code -2013
- **THEN** the adapter reports exists false for the existing bounded absence reconciliation

#### Scenario: A message resembles absence without evidence

- **WHEN** a lookup fails with an absence-like message but no determinate numeric -2013 evidence
- **THEN** it fails as a read and does not establish absence

#### Scenario: A business rejection survives the installed SDK

- **WHEN** Binance returns a well-formed 4xx business refusal
- **THEN** its HTTP status, numeric code, and reason remain available and it is not confused with a transport timeout

#### Scenario: The API cannot confirm execution

- **WHEN** a mutation receives a 5xx response, an unreadable response, or Binance code -1000, -1006, or -1007
- **THEN** the outcome is unknown regardless of a lower HTTP status and no success or confirmed refusal is fabricated

#### Scenario: A public read receives an error

- **WHEN** a shared-client market-data request receives an error response
- **THEN** its caller receives a failure and cannot use the error body as a market snapshot

### Requirement: Spot SDK retries do not bypass the request owner

The shared Spot REST client SHALL make at most one physical attempt per SDK method invocation. Mutation uncertainty SHALL be handled by the command owner's read-only reconciliation. Read retries SHALL belong to the existing bounded read owners rather than an additional hidden SDK retry loop.

#### Scenario: A cancellation loses its response

- **WHEN** a DELETE request loses its response after being sent
- **THEN** the SDK sends no second DELETE and exposes an unknown outcome to the command owner

#### Scenario: A lookup or placement fails

- **WHEN** a GET or POST encounters a server error or a network failure
- **THEN** that SDK invocation makes only one physical request and any further read is explicitly owned by the calling workflow

### Requirement: A new Spot order requires a confirmed private subscription

Main SHALL refuse a new Spot placement while its private subscription is unconfirmed and SHALL state a dedicated market-scoped reason. Cancellation and read-only refresh SHALL remain available. Private-stream recovery SHALL NOT replay a refused placement or any previous mutation.

#### Scenario: Place while private updates are unavailable

- **WHEN** a new Spot order arrives before subscription acknowledgement or during private-stream recovery
- **THEN** main emits SPOT_PRIVATE_STREAM_UNAVAILABLE and sends no placement to Binance

#### Scenario: Cancel while private updates are unavailable

- **WHEN** a Spot cancellation or read-only refresh arrives while private subscription is unavailable
- **THEN** the normal command path remains available, including its existing outcome reconciliation

#### Scenario: Private subscription becomes ready

- **WHEN** the subscription is confirmed after a placement was refused
- **THEN** only a subsequent operator command may place an order and no refused command is replayed

### Requirement: An execution report withdraws only the action it proves

Renderer warning state SHALL require matching order identity and the held command's action-specific postcondition before treating execution traffic as an answer. Expected amendment terms SHALL accompany the unresolved command. Named outcome envelopes SHALL NOT settle another action on the same order. Terminal non-cancellation outcomes SHALL remain explicitly explained.

#### Scenario: A matching working report arrives during cancellation uncertainty

- **WHEN** the renderer receives NEW for the same order whose cancellation is unconfirmed
- **THEN** its order state updates but its cancellation warning is retained

#### Scenario: A delayed private event proves cancellation

- **WHEN** matching CANCELED arrives after bounded reads remained inconclusive
- **THEN** only that cancellation's warning is cleared and no command is replayed

#### Scenario: Another action on the same order answers

- **WHEN** a named placement resolution arrives while cancellation of the same order is unresolved
- **THEN** the cancellation warning is not cleared by that envelope

#### Scenario: Same-batch Spot uncertainty and answer

- **WHEN** an unresolved Spot command and its confirming private event arrive before a React render
- **THEN** the combined outcome state applies both in order without retaining a stale warning or losing a terminal explanation
