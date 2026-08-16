## ADDED Requirements

### Requirement: A session is matched by an identity the protocol typed
The workstation protocol SHALL require every identity a frame is matched by to be
a string before testing it against the pattern that spells it, rather than
relying on the coercion a regular expression performs on a value of another type.

`requestId` is the key a session is matched by: ten strict comparisons decide by
it whether a request belongs to the session it names, whether a frame belongs to
the subscription listening for it, and whether an unsubscribe releases the
contract on screen. A frame whose `requestId` is a number, a boolean or an array
SHALL be refused under the protocol's identity code, not accepted under the
string its coercion happens to produce.

This is the rule the rest of the file already keeps — what a frame is permitted
to contain is decided by the validators and not by the transport — stated for the
one field that did not keep it.

#### Scenario: An identity arrives as something other than a string
- **WHEN** a request or an event states a `requestId` that is a number, a boolean or an array
- **THEN** it is refused as an invalid identity, rather than matched against a session under its coerced spelling

#### Scenario: An identity is wider than a number holds
- **WHEN** a frame states a `requestId` of `9007199254740993`
- **THEN** it is refused, rather than accepted under `9007199254740992` — an identity the sender never wrote, and one any other id rounding to the same value would share

#### Scenario: An identity arrives as it always has
- **WHEN** a frame states a `requestId` that is a string matching the identity pattern
- **THEN** it is accepted exactly as before, and every session comparison behaves identically
