## ADDED Requirements

### Requirement: A leverage change made elsewhere reaches the desk on the stream
When the exchange reports on the authenticated stream that a contract's leverage
has changed, the desk SHALL apply what the frame states to the held
configuration for that contract, without reading the account back to learn what
it has just been told. The change SHALL reach every surface that states
leverage, and SHALL NOT pass through an unknown or default value on its way
there.

A frame naming a contract the desk holds no configuration for SHALL NOT cause a
configuration to be invented for it; the desk's own read remains the source when
that contract is next held.

Margin mode SHALL NOT be taken from this frame. The exchange's account
configuration event carries a pair's leverage and the account's Multi-Assets
mode, and no per-contract margin mode at all — a mode changed on a contract the
operator holds arrives as part of the position update, and one changed on a
contract the operator is flat in is not announced. Where the desk states a
margin mode it has not been told about since it last read, it SHALL be stating
what it read, not what it inferred from a leverage frame.

#### Scenario: Leverage is changed away from this desk
- **WHEN** the operator changes a contract's leverage in the Binance app and the stream reports it
- **THEN** the desk states the new leverage, without an account read and without showing a default in between

#### Scenario: The frame names a contract the desk does not hold
- **WHEN** a leverage change arrives for a contract the desk holds no configuration for
- **THEN** nothing is invented for it, and the desk's own reads remain the source when that contract is next held

#### Scenario: The margin mode of a flat contract is changed elsewhere
- **WHEN** the operator changes the margin mode of a contract they hold no position in
- **THEN** the desk does not claim to have learned it from the stream, and the mode it states remains the one it last read
