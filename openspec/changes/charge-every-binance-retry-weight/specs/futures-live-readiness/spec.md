## ADDED Requirements

### Requirement: Every physical Binance attempt is admitted and charged
Before each physical Binance REST attempt, including every retry after a timeout, reset, or retryable exchange response, the system SHALL reserve that endpoint's declared request weight through the shared admission policy. A logical operation SHALL expose its attempt count and total charged weight to diagnostics without exposing credentials, signatures, or signed parameters. Cancellation before a retry SHALL prevent both the reservation and the physical request for that retry.

When Binance response-weight headers are available, the limiter SHALL reconcile conservative local accounting with those observations and SHALL treat `429`/ban guidance as authoritative backpressure. Missing headers SHALL NOT reduce the locally charged declared weight.

#### Scenario: A request succeeds first try
- **WHEN** a weight-30 operation succeeds on its first physical attempt
- **THEN** the limiter charges 30 and records one attempt

#### Scenario: Two retries follow transient failures
- **WHEN** a weight-30 operation performs three physical attempts before succeeding or failing
- **THEN** the limiter charges 90 and each attempt waits for admission as if it were an independent request

#### Scenario: Retry is aborted before admission
- **WHEN** cancellation occurs after one failed attempt and before its retry is admitted
- **THEN** only the first attempt is charged and no retry request is sent

#### Scenario: Exchange reports a higher used weight
- **WHEN** a response header shows the exchange has counted more weight than the local window expected
- **THEN** subsequent admission honors the observed higher usage and does not continue from the lower estimate

#### Scenario: Response headers are absent
- **WHEN** a physical attempt returns without usable weight headers
- **THEN** its declared local weight remains charged

#### Scenario: Binance rate-limits an attempt
- **WHEN** Binance returns `429` with retry guidance
- **THEN** the limiter applies that backpressure before admitting another physical attempt
