## ADDED Requirements

### Requirement: A configuration change made elsewhere reaches the desk on the stream
When the exchange reports on the authenticated stream that a contract's leverage
or margin mode has changed, the desk SHALL apply what the frame states to the
held configuration for that contract, without reading the account back to learn
what it has just been told.

The change SHALL reach every surface that states leverage or margin mode, and
SHALL NOT pass through an unknown or default value on its way there.

A frame naming a contract the desk holds no configuration for SHALL be applied
when that contract is next held, or discarded, but SHALL NOT invent a
configuration the desk was not told about.

#### Scenario: Leverage is changed away from this desk
- **WHEN** the operator changes a contract's leverage in the Binance app and the stream reports it
- **THEN** the desk states the new leverage, without an account read and without showing a default in between

#### Scenario: Margin mode is changed away from this desk
- **WHEN** the stream reports a contract's margin mode changed
- **THEN** the desk states the new mode wherever margin mode is shown

#### Scenario: The frame names a contract the desk does not hold
- **WHEN** a configuration change arrives for a contract the desk holds no configuration for
- **THEN** nothing is invented for it, and the desk's own reads remain the source when that contract is next held
