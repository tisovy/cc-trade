# trading-command-integrity (delta)

## ADDED Requirements

### Requirement: A displayed position closes on the first command

The desk SHALL confirm a reduce-only order against the newest successful
positions reading, and SHALL NOT void that evidence because the reading is
being re-confirmed — an in-flight account refresh or a re-activation of the
contract's market data is not a reason to refuse. When no successful reading
exists at all, the command SHALL wait, bounded, for the in-flight pass rather
than refuse on sight, and SHALL be refused only when the reading disagrees
with the requested reduction or the bound expires without a reading.

#### Scenario: Closing while the account reading is re-stamped

- **WHEN** the desk displays an open leg from its last successful positions reading, a book recovery or refresh pass is re-stamping that reading, and the operator sends a matching reduce-only close
- **THEN** the order is confirmed against the displayed reading and sent on the first command

#### Scenario: A wrong reduction is still refused

- **WHEN** a reduce-only order names a leg, side, or quantity the newest successful positions reading disagrees with
- **THEN** the order is refused and not sent

### Requirement: A reduction refusal names its cause

A `FUTURES_REDUCTION_NOT_CONFIRMED` refusal SHALL name which condition failed
— no successful reading, reading stale beyond the allowed bound, quantity
exceeding the open leg, leg mismatch, or side mismatch — in both the
operator-facing rejection detail and the journal's `outcome` line.

#### Scenario: Diagnosing a refusal from its own line

- **WHEN** a reduce-only order is refused for any cause
- **THEN** the journal `outcome` line and the popup carry the named condition, and no journal archaeology is needed to tell a transient reading gap from a wrong order
