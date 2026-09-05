## ADDED Requirements

### Requirement: Unhandled main faults are terminal
The main process SHALL stop after an uncaught exception or unhandled rejection, including network-looking failures, rather than resume normal application work. Termination SHALL use nonzero exit status and SHALL NOT wait for asynchronous quit handlers.

#### Scenario: Failure escapes its request owner
- **WHEN** a failure reaches a global uncaught-exception or unhandled-rejection event
- **THEN** the handler latches terminal state, attempts bounded synchronous diagnostics and immediately exits with status 1

#### Scenario: Network failure is locally handled
- **WHEN** a request owner catches or rejects an expected network failure through its normal handled path
- **THEN** global termination is not triggered and the existing local recovery behavior remains available

### Requirement: Safe fatal diagnostics and ownership
Fatal handlers SHALL be installed once before runtime initialization, SHALL NOT serialize or inspect arbitrary thrown data, and SHALL still terminate if diagnostic reporting fails. Repeat or reentrant events SHALL NOT schedule further recovery or duplicate exits.

#### Scenario: Hostile or sensitive rejection value
- **WHEN** the thrown value contains secrets, malicious getters or throwing string conversion
- **THEN** only a fixed phase/code and recovery guidance are reported, and exit still occurs

#### Scenario: Diagnostic sink throws
- **WHEN** synchronous diagnostics fail
- **THEN** the fatal exit still occurs without returning to normal runtime work

#### Scenario: Repeated installation
- **WHEN** handler installation is invoked again for the same process
- **THEN** it retains one owner/listener per fatal event

### Requirement: No trading side effects during fatal recovery
Fatal recovery SHALL NOT cancel exchange orders, replay mutations or automatically relaunch. Diagnostics SHALL warn that orders may remain active and require exchange verification before resubmission.

#### Scenario: Mutation may already have reached the exchange
- **WHEN** main exits while a trading command is in flight
- **THEN** shutdown makes no claim that the order was absent or cancelled, and sends no compensating or replayed mutation
