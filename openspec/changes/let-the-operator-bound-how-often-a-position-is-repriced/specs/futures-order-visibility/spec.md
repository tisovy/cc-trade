# futures-order-visibility (delta)

## ADDED Requirements

### Requirement: How often a position is repriced is the operator's to bound

The rate at which the desk republishes an open position's traded price SHALL
follow the operator's existing tape control — the throttle and timeout of the
Aggregate trades panel — rather than a second control of its own. When that
throttle is off, the bound SHALL be the feed's own coalescing window.

That window SHALL be the floor: a setting below it SHALL be treated as the
window, because below it there is nothing left to fold together and the
measurement that sized it does not support going lower.

The bound SHALL space out publications rather than discard prices. The first
print after an open gate SHALL publish on the coalescing window, so the start of
a move is seen at once; prints arriving while the gate is shut SHALL supersede
one another and the newest SHALL publish when it opens. Shortening the bound
SHALL release a price already waiting rather than hold it for a window the
operator has stopped asking for.

Marks SHALL NOT be bounded by that setting. A mark arrives once a second, which
is slower than any value the control accepts, and it is the reading funding,
margin and liquidation are decided on; a publication caused by a mark SHALL go
out on the coalescing window and SHALL carry whatever the contract has printed
since.

The tape control's minimum trade size SHALL NOT reach position valuation. It
selects which prints are worth drawing in a list; a position is worth what the
contract traded at, whatever the size of that trade.

#### Scenario: The contract prints faster than the operator asked to see

- **WHEN** trades arrive for a tracked contract more often than the tape timeout allows
- **THEN** the first publishes on the coalescing window, the rest are superseded while the gate is shut, and the newest publishes when it opens

#### Scenario: A mark arrives while the gate is shut

- **WHEN** a new mark arrives inside the operator's window
- **THEN** it is published on the coalescing window and carries the newest print with it

#### Scenario: The operator shortens the bound

- **WHEN** the tape timeout is lowered while a price is waiting out the previous window
- **THEN** that price is published on the coalescing window instead of serving out the window it no longer belongs to

#### Scenario: The operator sets a value under the coalescing window

- **WHEN** the tape timeout is set below the feed's coalescing window, or the throttle is switched off
- **THEN** the bound is that window, and no publication is spaced more tightly than the measurement that sized it
