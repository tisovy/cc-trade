## ADDED Requirements

### Requirement: Depth delivery is coalesced, not dropped in part
The workstation SHALL deliver at most one order book per animation interval. A
frame arriving while a delivery is pending SHALL replace it. A delivered book
SHALL be complete for the depth in force; coalescing SHALL drop intermediate
frames, never levels within a frame.

#### Scenario: A burst of depth frames
- **WHEN** several depth frames arrive within one animation interval
- **THEN** one book is delivered, and it is built from the newest frame

#### Scenario: Quiet book
- **WHEN** frames arrive slower than the interval
- **THEN** each frame is delivered as it arrives

### Requirement: A price tick does not restart the render
The workstation SHALL derive the last-print direction without updating state
during render. A price tick SHALL cause at most one render pass of the
workstation.

#### Scenario: A price tick arrives
- **WHEN** a new last price arrives
- **THEN** the workstation renders once and the direction reads the same as it does today
