## ADDED Requirements

### Requirement: Bounded order-book delivery orders only the levels it can send
When a valid stated range bounds delivery to fewer levels than the retained
side, the workstation SHALL select the exact nearest levels required by the
range, the delivery floor, and the protocol limit before fully ordering the
selected result. It SHALL NOT fully order the unread retained tail.

The delivered bids and asks, their nearest-first order, the inclusive range
edge, the minimum-level floor, the maximum-level limit, and the reported spread
SHALL remain exactly equivalent to a full exact-decimal ordering of the retained
book. Price selection and ordering SHALL preserve decimal strings of different
scales and magnitudes beyond safe binary-number precision without lossy numeric
coercion. No level SHALL be synthesized.

An absent, invalid, non-positive, or effectively unbounded range SHALL continue
to deliver up to the protocol ceiling. Selection for delivery SHALL NOT weaken
the exact nearest-level ordering used to trim retained state.

#### Scenario: A realistic range reads a fraction of the retained book
- **WHEN** a valid range reaches roughly two hundred and twenty of one thousand retained levels on each side
- **THEN** only the bounded nearest subset is fully ordered, and the delivered bytes match the full exact-decimal reference for both bids and asks

#### Scenario: A narrow range falls below the delivery floor
- **WHEN** fewer levels lie inside the valid range than the minimum delivered level count
- **THEN** the nearest levels needed to reach the floor are selected and ordered exactly, without ordering the remaining retained tail

#### Scenario: Exact decimal prices have mixed scales and wide magnitudes
- **WHEN** retained prices use different decimal scales, include values wider than safe binary-number precision, and arrive in different insertion orders
- **THEN** bounded selection returns the same price strings, quantities, side order, and spread as the full exact-decimal reference

#### Scenario: The stated range covers the retained side
- **WHEN** a valid range reaches every retained level on a side
- **THEN** every level up to the protocol limit is delivered in exact nearest-first order and none is invented

#### Scenario: The range does not provide a usable bound
- **WHEN** the range is absent, invalid, non-positive, or wide enough that the protocol ceiling is the effective bound
- **THEN** delivery keeps the existing ceiling behavior and exact nearest-first output

#### Scenario: Retained state exceeds its side limit
- **WHEN** depth updates require the retained book to discard levels beyond its retention ceiling
- **THEN** retention keeps the exact nearest levels on each side independently of the bounded delivery selection
