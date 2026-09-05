## ADDED Requirements

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
