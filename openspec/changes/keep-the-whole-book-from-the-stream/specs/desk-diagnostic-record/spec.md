## ADDED Requirements

### Requirement: A stream close and a crossed book leave their evidence
Beside the fault line a stream close raises, the record SHALL carry an
evidence line naming who closed it (the exchange, the desk, or the transport),
the close code the socket carried bounded to the standard range, and the
upstream lag of the last frame delivered before the close. Beside the fault
line a crossed book raises, the record SHALL carry an evidence line with the
book's last update identity, the diff's first, final and previous-final
identities, and the count of retained levels at or beyond the opposite best —
identities and counts, no price and no amount. A fault that leaves no evidence
SHALL produce no evidence line. On 2026-09-02 three closes each followed four
to eight seconds of lag and a hundred crossings were recorded with nothing to
read them by.

#### Scenario: A socket closes after the route stalled
- **WHEN** the market stream's socket closes
- **THEN** the record carries, beside the fault, an evidence line naming who closed it, the code, and the lag of the last frame before it

#### Scenario: A diff crosses the book
- **WHEN** applying a chained diff leaves the best bid at or above the best ask
- **THEN** the record carries, beside the fault, an evidence line with the update identities and the crossed-level count, and no price

#### Scenario: A fault with nothing behind it
- **WHEN** a fault is raised that carries no close code and no crossing identities
- **THEN** only the fault line is written
