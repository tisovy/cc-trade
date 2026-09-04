## ADDED Requirements

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
