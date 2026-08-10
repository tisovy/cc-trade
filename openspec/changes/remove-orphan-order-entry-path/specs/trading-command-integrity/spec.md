## Purpose

States the absence of a parallel legacy submission path as a property of the
system, so the local band check found in `src/utils/operations.js` cannot
return and no unreachable order-entry code is left reading as available.

## ADDED Requirements

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
