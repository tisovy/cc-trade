## Purpose

Makes every order surface disclose the synchronization state behind what it
draws, present the entry or exit intent it already computes, and stop a
submission surface from reporting a success it did not achieve.

## ADDED Requirements

### Requirement: Every order surface discloses its synchronization state
The chart, the trading rail and the dock SHALL each present the synchronization
state of the order data they draw, distinguishing at least not yet
synchronized, synchronizing, ready, stale and failed. An empty order display
SHALL state that no working orders exist only when a successful synchronization
reported none. A failed or unsynchronized order resource SHALL offer its
sanitized reason and the retry path.

#### Scenario: Synchronization has not run yet
- **WHEN** the order resource has produced no snapshot
- **THEN** the chart and the dock state that orders are not yet synchronized rather than that there are none

#### Scenario: Synchronization failed
- **WHEN** the order resource is in error
- **THEN** the chart and the dock present the failure and its retry path rather than an empty list

#### Scenario: Synchronization succeeded with no orders
- **WHEN** a successful snapshot reports no working orders
- **THEN** the surfaces state that there are no working orders

#### Scenario: Snapshot is stale
- **WHEN** the last successful snapshot has become stale
- **THEN** the surfaces keep showing its orders and disclose that the data is stale

### Requirement: Order intent is presented, not only direction
The system SHALL present the entry or exit intent it derives for an order or a
position alongside its direction. An order that closes a position SHALL be
classified as an exit regardless of the side it is submitted on.

#### Scenario: Reduce-only order on a long position
- **WHEN** a reduce-only sell reduces an open long
- **THEN** the surface presents it as an exit as well as a sell

#### Scenario: Close-position order
- **WHEN** an order carries close-position intent
- **THEN** it is classified as an exit regardless of its side

#### Scenario: Direction remains readable
- **WHEN** intent is presented
- **THEN** the direction remains visible and distinctly coloured as before

### Requirement: A submission surface does not close on a send it did not achieve
When a submission does not reach the backend — including a transport that is
disconnected — the surface that issued it SHALL remain open, SHALL state the
failure, and SHALL preserve the operator's entered values.

#### Scenario: Editor submits while disconnected
- **WHEN** the order editor submits an amendment and the send is refused because the transport is unavailable
- **THEN** the editor stays open, states the reason, and keeps the entered price and amount

#### Scenario: Send succeeds
- **WHEN** the send reaches the backend
- **THEN** the surface behaves as it does today and the outcome is reported through the command result

#### Scenario: Other submission surfaces
- **WHEN** any other submission surface issues a send that does not reach the backend
- **THEN** it follows the same rule rather than dismissing itself
