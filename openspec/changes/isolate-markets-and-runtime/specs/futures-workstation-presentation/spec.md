## Purpose

Extends market laziness from the renderer to the backend boundary: the market
that is not activated performs no work there either, activation is
generation-isolated against child effects, and a connect that outlives its
cleanup cannot revive a channel.

## MODIFIED Requirements

### Requirement: The inactive market is lazy and quiescent
At startup the application SHALL load and initialize only the persisted active market's React workspace and market-specific data path. The other workspace SHALL be lazy-loaded only after explicit selection and SHALL issue no market-specific public requests, signed account requests, analytics polling, or stream subscriptions while inactive. A shared local diagnostic/control transport MAY remain available if it performs no inactive-market work.

The backend SHALL enforce this independently of the renderer. A market-scoped
trading command, subscription or refresh SHALL be accepted only while that
market is the activated one; one arriving before activation, or after the
operator has switched away, SHALL be rejected with a stable bounded reason and
SHALL start no subscription, refresh, timer or stream. Every market-scoped
request SHALL carry the activation generation it was issued under, and a
request from a superseded generation SHALL be discarded rather than applied.

#### Scenario: Startup restores Futures
- **WHEN** Futures is the persisted active workspace
- **THEN** Futures code/data initialization begins and Spot components, subscriptions, account refreshes, and analytics polling remain inactive

#### Scenario: Inactive workspace is selected for the first time
- **WHEN** the operator explicitly selects a workspace that has not been loaded in the current application session
- **THEN** that workspace is loaded on demand and its market-specific initialization begins only then

#### Scenario: Operator switches markets
- **WHEN** the operator switches from the active market to the other market
- **THEN** the previous market's subscriptions and pending market-specific work are cleaned up before or generation-isolated from the newly selected market

#### Scenario: Previously loaded workspace becomes inactive
- **WHEN** a workspace module was loaded earlier but is no longer selected
- **THEN** its cached code MAY remain in memory but its market-specific network activity and timers remain stopped

#### Scenario: Command arrives before activation
- **WHEN** a market-scoped command or subscription reaches the backend before that market has been activated
- **THEN** it is rejected with a stated reason and no work starts for that market

#### Scenario: Command arrives after switching away
- **WHEN** a market-scoped command reaches the backend after the operator switched to the other market
- **THEN** it is rejected as belonging to a market that is no longer active

#### Scenario: Child effects run ahead of activation on a warm switch
- **WHEN** a previously loaded workspace is selected again and its child effects schedule refresh or subscribe work
- **THEN** none of that work reaches the backend before the parent activation has been accepted

#### Scenario: A superseded generation returns late
- **WHEN** a market-scoped request issued under an earlier activation returns after the operator has switched
- **THEN** its result is discarded and does not alter the current market's state

## ADDED Requirements

### Requirement: A connect that outlives its cleanup does not revive a channel
A channel connection attempt that resolves after its channel was cleaned up
SHALL be discarded and closed. Cleanup SHALL leave no live socket, no
reconnect timer, and no handler that can deliver into torn-down state.

#### Scenario: Cleanup happens during an in-flight connect
- **WHEN** a Spot channel is cleaned up while its connect is still pending and the connect then succeeds
- **THEN** the resulting socket is closed and discarded rather than adopted

#### Scenario: Market is switched during a connect
- **WHEN** the operator switches markets while a channel connect is pending
- **THEN** the pending connect cannot deliver data or restart itself for the market that is no longer active
