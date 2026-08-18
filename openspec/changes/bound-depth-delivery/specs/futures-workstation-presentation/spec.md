## ADDED Requirements

### Requirement: Routine depth delivery is bounded and latest-wins
Consecutive routine order-book deliveries for the shown contract SHALL be separated by at least 200 milliseconds. The first eligible update MAY be delivered immediately; updates arriving before the next eligible instant SHALL occupy one replaceable pending slot, and the newest complete book SHALL be delivered at that trailing instant. The pending queue SHALL therefore remain bounded to one book and SHALL NOT lose the last state received during the spacing period.

Depth state transitions that tell the operator the book is stale, unavailable or resynchronizing, and the first live depth after recovery, SHALL bypass the routine delay. Releasing, replacing or hiding the owning session SHALL cancel its pending timer and payload so no late book can be delivered under another owner.

#### Scenario: Several diffs arrive in one delivery window
- **WHEN** multiple valid depth diffs update the shown book within 200 milliseconds
- **THEN** an eligible leading book may be delivered immediately, exactly one newest book remains pending for the earliest instant at least 200 milliseconds later, no intermediate book is queued, and that trailing book contains the latest state

#### Scenario: A book failure occurs while a routine update is pending
- **WHEN** the book becomes stale or unavailable before a pending routine delivery fires
- **THEN** the non-live state is delivered immediately and is not delayed behind the routine book

#### Scenario: Book recovery completes while routine delivery is bounded
- **WHEN** a recovery rebuilds a live book
- **THEN** the recovered live state is delivered immediately rather than waiting for the ordinary depth window

#### Scenario: The depth owner is released
- **WHEN** a contract session with a pending depth delivery is released or replaced
- **THEN** its pending timer and book are discarded and nothing from that session is emitted later
