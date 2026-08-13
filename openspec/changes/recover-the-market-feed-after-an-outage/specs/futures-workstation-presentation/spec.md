## ADDED Requirements

### Requirement: A market feed keeps trying while its contract is wanted
A Futures workstation session SHALL continue attempting to restore its market
data for as long as the contract is selected, and SHALL NOT reach a state from
which only reloading the window or reselecting the contract can recover it.

Exhausting the fast reconnect ladder SHALL end the hurry, not the recovery: the
session SHALL fall back to a slow steady interval and keep attempting on it. The
slow interval SHALL be long enough that a route which is gone for hours costs
negligible traffic, and short enough that a route which returns is picked up
without the operator acting.

The session SHALL stop only when the contract it serves is no longer wanted or
the service itself is stopped. The number of attempts already made SHALL NOT be
a reason to stop.

While the session is attempting recovery, the resources it can no longer feed
SHALL be presented as not carrying rather than as current, and the session SHALL
retain nothing that would let a stale reading be read as a live one.

#### Scenario: The route is gone for longer than the fast ladder
- **WHEN** market data cannot be restored for longer than the fast reconnect ladder allows
- **THEN** the session keeps attempting on the slow interval, and restores the chart, order book and tape on its own when the route returns, without the operator reloading the window or reselecting the contract

#### Scenario: The route returns during the slow interval
- **WHEN** the route becomes reachable again while the session is attempting on the slow interval
- **THEN** the next attempt succeeds, the fast ladder is available again for any later interruption, and the workspace returns to live

#### Scenario: The contract is no longer wanted
- **WHEN** the operator selects another contract or the workspace is released while a session is attempting on the slow interval
- **THEN** the attempts stop with the session, and no timer of the released session performs work

### Requirement: A feed that has stopped carrying says so where it stopped
When a Futures workstation session is not carrying market data, the workspace
SHALL state it on the surfaces that lost it — the chart, the order book and the
aggregate-trade tape — rather than only in the contract list. The statement
SHALL name that recovery is still being attempted.

A manual retry SHALL be reachable from that statement. The retry offered in the
contract list SHALL NOT be the only way to ask for recovery, and SHALL NOT
describe the loss of the market feed as a loss of the contract list.

#### Scenario: Market data stops while a contract is selected
- **WHEN** the session stops carrying market data for the selected contract
- **THEN** the chart, order book and tape each state that they are not carrying, and the workspace states that recovery is being attempted

#### Scenario: The operator asks for recovery from the statement
- **WHEN** the operator uses the retry offered beside the stopped surfaces
- **THEN** an attempt is made at once without waiting for the slow interval, and without the operator reselecting the contract
