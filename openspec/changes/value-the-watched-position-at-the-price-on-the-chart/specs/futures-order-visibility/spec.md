# futures-order-visibility (delta)

## ADDED Requirements

### Requirement: The desk does not hold a mark longer than folding it together earns

The mark feed coalesces marks that arrive together for several contracts into
one publication. The length of that window SHALL be set from a measurement of
how far apart those arrivals actually are, and SHALL NOT exceed what folding
them together earns.

The reason is that the window is added to the age of every mark, on a value
that is already the oldest thing the desk displays: the exchange publishes it
once a second, and it reaches the desk a further fifth of a second later. A
window sized by estimate rather than by measurement spends the operator's
freshness on a saving that was never that large.

The measured basis SHALL be stated where the window is set, so a later reader
can tell a number that was measured from one that was guessed.

#### Scenario: Marks for several contracts arrive together

- **WHEN** the exchange delivers a mark for every tracked contract at the same second boundary
- **THEN** they are published as one frame, and the window that folded them together is no longer than the measured spread of those arrivals with headroom

#### Scenario: A single contract is tracked

- **WHEN** only one contract has an open position, so there is nothing to fold together
- **THEN** its mark is published without waiting longer than that same window
