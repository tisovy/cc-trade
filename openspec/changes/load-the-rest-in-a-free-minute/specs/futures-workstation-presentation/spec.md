## ADDED Requirements

### Requirement: A background contract loads in a free minute
A held session that is not being shown SHALL NOT open a socket or issue a
REST read on its own account. When it loses its stream, fails its freshness
rule, or needs its book rebuilt, it SHALL be parked: its sockets closed,
its timers cleared, its last state kept with the reason, and no reconnect
scheduled. A parked session SHALL be rebuilt at once when the operator
selects it, taking the screen. Otherwise it SHALL be rebuilt only by the
desk's warmer, one parked session at a time, most recently shown first, and
only while the shown session is bootstrapped and live, the public read
budget has a stated amount of room, and a stated floor has passed since
the last such rebuild. A wake that fails SHALL park the session again and
hold it for the floor doubled per failed wake, to a stated ceiling, behind
every parked session not yet tried; a wake that brings the contract up with
a bridged book SHALL clear the count. A contract that leaves the screen on
its ladder, on its candle ladder or inside a recovery round SHALL be parked
under the reason it was stating. The operator's ruling, 2026-09-03: the
shown contract is always current; the rest load in a free minute; a
background contract never reconnects on its own.

#### Scenario: A proxy storm with eight contracts held
- **WHEN** the streams of every held contract close within a few seconds
- **THEN** the shown contract reconnects on its ladder, every other held contract is parked with the close's reason, and no read or socket is issued for them until the shown contract is live again

#### Scenario: A free minute after the storm
- **WHEN** the shown session is live, the public budget has room, and the floor has passed
- **THEN** one parked contract is rebuilt, and the next one no sooner than the floor after it

#### Scenario: The operator selects a parked contract
- **WHEN** a parked contract is selected
- **THEN** it is rebuilt at once, takes the screen, and states its reason and `loading` meanwhile

#### Scenario: A background book gaps
- **WHEN** a held session that is not shown proves a sequence gap or a crossed book
- **THEN** the session is parked and no depth page is read for it

#### Scenario: The shown contract is reconnecting
- **WHEN** the shown session is on its reconnect ladder, on its candle ladder, bootstrapping an interval or recovering its book
- **THEN** no parked contract is rebuilt, whatever room the budget has

#### Scenario: The shown contract leaves the screen mid-recovery
- **WHEN** the operator selects another contract while the shown one is on its ladder, on its candle ladder or inside a recovery round
- **THEN** the contract that left the screen is parked under the reason it was stating, its rung never fires, and no page and no bootstrap is read for it

#### Scenario: A wake keeps failing
- **WHEN** a parked contract's wake fails
- **THEN** it is parked again and held twice the floor before its next wake, doubling per failed wake to the ceiling, and every parked contract not yet tried is woken before it

#### Scenario: A woken contract is no longer listed
- **WHEN** the warmer wakes a parked contract the exchange no longer lists
- **THEN** it stands unavailable in the pool, neither parked nor loading, and the next parked contract still gets its minute

### Requirement: A reload rebuilds the shown contract only
Subscribing to a contract the desk already holds SHALL deliver the held
session without a bootstrap, or rebuild it at once if it is parked, and
SHALL touch no other held session. Starting the desk SHALL open the shown
contract only.

#### Scenario: The window is reloaded during an outage
- **WHEN** the renderer subscribes again to the contract it was showing while the route is down
- **THEN** that contract alone is rebuilt or resumed, and the other held contracts stay as they were

#### Scenario: The window is reloaded on a live desk
- **WHEN** the renderer subscribes again to a contract whose session is live
- **THEN** its state is delivered from what the session holds, with no read and no socket

### Requirement: The chart draws what it is handed on a selection change
When the chart's series generation changes — a new contract or a new
interval — the chart SHALL clear its series and then draw the rows it is
handed for the new generation in full, whether or not the rows' reference
changed. A held series drawn through an interval switch SHALL reach the
canvas by this rule and not by an intermediate render.

#### Scenario: An interval switch hands the chart the same rows
- **WHEN** the interval changes and the rows handed to the chart are the same array as before
- **THEN** the chart clears and redraws those rows, and the canvas is not empty until the new series lands

#### Scenario: The new series lands
- **WHEN** the new interval's rows replace the held ones
- **THEN** the chart replaces the series in full without refitting the viewport

## MODIFIED Requirements

### Requirement: A market feed keeps trying while its contract is wanted
A Futures workstation session that is being shown SHALL continue attempting
to restore its market data for as long as the contract is selected, and
SHALL NOT reach a state from which only reloading the window or reselecting
the contract can recover it. A held session that is not shown SHALL NOT
attempt on its own: it is parked and rebuilt by selection or by the desk's
warmer.

Exhausting the fast reconnect ladder SHALL end the hurry, not the recovery: the
shown session SHALL fall back to a slow steady interval and keep attempting on
it. The slow interval SHALL be long enough that a route which is gone for hours
costs negligible traffic, and short enough that a route which returns is picked
up without the operator acting.

The session SHALL stop only when the contract it serves is no longer wanted or
the service itself is stopped. The number of attempts already made SHALL NOT be
a reason to stop.

While the session is attempting recovery, the resources it can no longer feed
SHALL be presented as not carrying rather than as current, and the session SHALL
retain nothing that would let a stale reading be read as a live one.

#### Scenario: The route is gone for longer than the fast ladder
- **WHEN** market data cannot be restored for longer than the fast reconnect ladder allows
- **THEN** the shown session keeps attempting on the slow interval, and restores the chart, order book and tape on its own when the route returns, without the operator reloading the window or reselecting the contract

#### Scenario: The route returns during the slow interval
- **WHEN** the route becomes reachable again while the shown session is attempting on the slow interval
- **THEN** the next attempt succeeds, the fast ladder is available again for any later interruption, and the workspace returns to live

#### Scenario: The contract is no longer wanted
- **WHEN** the operator selects another contract or the workspace is released while a session is attempting on the slow interval
- **THEN** the attempts stop with the session, and no timer of the released session performs work

#### Scenario: A background contract loses its route
- **WHEN** the route drops for a held session that is not shown
- **THEN** it is parked with the reason and attempts nothing until selected or woken in a free minute

### Requirement: A held session is a whole session, shown or not
A held session SHALL carry every stream it would carry while shown, including
the depth diff, and SHALL keep its order book, tape and candles current from
those streams whether or not it is the one being shown. Being shown SHALL
decide whether the session delivers to the renderer, and whether the session
recovers on its own: a session that is not shown SHALL NOT open a socket or
issue a REST read on its own account, and SHALL be parked instead when its
streams stop carrying or its book needs rebuilding.

A session that is not shown draws no rows and SHALL NOT issue a depth read
for any reading; the reading is answered from the book in hand when the
contract is selected.

#### Scenario: A held contract is selected
- **WHEN** the operator selects a contract whose session is held, live and not shown
- **THEN** its book, tape and candles are delivered as the session already holds them, with no snapshot read and no stream opened

#### Scenario: A held contract is not shown
- **WHEN** a held session is live and not the one being shown
- **THEN** it keeps parsing its streams and updating its state, and delivers nothing to the renderer

#### Scenario: The band of a held contract stops covering its reading
- **WHEN** a session that is not being shown holds a book whose page no longer reaches the reading last stated for that contract, or the market has walked out of it
- **THEN** no depth read is issued for it; the reading is answered from the book in hand when the contract is selected

#### Scenario: The shown contract's band stops covering its reading
- **WHEN** the page the shown contract's book was bootstrapped from stops reaching the rows on screen
- **THEN** the rows beyond the page are drawn from the stream and marked as such, and no page is bought for it

#### Scenario: A held contract's stream stops
- **WHEN** a held session that is not shown loses a stream or proves a gap
- **THEN** it is parked, and no read or socket is spent on it until it is selected or woken in a free minute

### Requirement: A failure belongs to its own session
A resynchronization, a refused frame or a lost socket SHALL affect only the
session it occurred on. Other held sessions, and the delivery of the shown
session when it is not the failing one, SHALL continue. A held session that
is not shown SHALL NOT rebuild itself over a failure: it is parked, and
rebuilt by selection or by the desk's warmer.

#### Scenario: A background session loses its connection
- **WHEN** a held session that is not being shown loses its stream
- **THEN** the shown contract's data continues uninterrupted

#### Scenario: A session that failed unwatched is selected
- **WHEN** a held session lost its stream or fell out of sync while it was not being shown, and the operator selects it
- **THEN** it is rebuilt at once and takes the screen, stating under `loading` the reason it stopped, rather than being delivered as current

#### Scenario: A background session is parked
- **WHEN** a held session that is not being shown loses its stream
- **THEN** the contract being shown does not change, the session keeps the place in the pool it already had, and no rebuild is attempted until it is selected or woken in a free minute

#### Scenario: A background session reconnects
- **WHEN** a parked session is rebuilt by the desk's warmer in a free minute
- **THEN** the contract being shown does not change, and the rebuilt session keeps the place in the pool it already had
