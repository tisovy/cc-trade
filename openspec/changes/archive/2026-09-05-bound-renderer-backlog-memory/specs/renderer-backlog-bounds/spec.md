## ADDED Requirements

### Requirement: Renderer retained payload bounds
Each renderer outbox SHALL independently enforce byte and frame-count limits on retained serialized payloads and a maximum single-frame size, including direct delivery. UTF-8 bytes SHALL be charged once and released on every departure.

#### Scenario: Few large protected frames exceed byte capacity
- **WHEN** queued account or nonreplaceable market frames plus the next frame exceed 64 MiB
- **THEN** replaceable market frames may give way, otherwise the renderer connection is closed without sending a silently incomplete account or paged resource

#### Scenario: Replacement changes size
- **WHEN** a queued replaceable snapshot receives a newer version
- **THEN** admission counts the new bytes minus the replaced bytes, preserves unrelated protected frames and never exceeds the configured budget

#### Scenario: A single large direct frame
- **WHEN** a single outbound frame exceeds the byte ceiling even while the socket is writable
- **THEN** it is not sent, and that renderer is closed with a bounded reason

### Requirement: Bounded continuous renderer backlog
A continuously nonempty outbox backlog SHALL expire after 30 seconds without requiring further traffic. New snapshots, supersession and partial drain SHALL NOT renew that deadline. Full drain, disposal or closure SHALL release queue memory and the timer.

#### Scenario: Silent blocked renderer
- **WHEN** the renderer stops draining with queued frames and no further input arrives
- **THEN** the deadline closes that connection once and subsequent sends/drains cannot revive its queue

#### Scenario: A partial drain or newer snapshot
- **WHEN** some frames drain or a newer complete snapshot arrives but the backlog never empties
- **THEN** the original deadline still applies

#### Scenario: Healthy recovery before deadline
- **WHEN** queued traffic fully drains before the deadline
- **THEN** the timer is cancelled and a later independent backlog receives a fresh deadline

### Requirement: Observable fail-closed delivery
Overflow SHALL report only bounded queue metadata and reason, clear retained state and close the affected connection even if diagnostic callbacks fail. Recovery SHALL use the existing reconnect/account-read path and SHALL NOT replay mutations or cancel exchange orders.

#### Scenario: Diagnostic callback fails
- **WHEN** a reporter throws during overflow or disposal
- **THEN** retained frames and timers are still cleared and overflow still closes the renderer
