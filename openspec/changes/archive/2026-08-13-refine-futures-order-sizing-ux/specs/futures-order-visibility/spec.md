## ADDED Requirements

### Requirement: The working-order editor offers direction-aware percentage sizing
The working-order editor SHALL present a compact percentage slider synchronized
with its editable `Amount, USDT` field. The slider SHALL cover zero through one
hundred percent in `0.5` percentage-point increments and SHALL translate every
slider selection into a whole-USDT amount before the existing exchange-filter,
local-limit, and atomic-amendment checks run.

For an entry order, one hundred percent SHALL represent the same currently
available USDT sizing capacity used by the execution ticket. For an exit order,
one hundred percent SHALL represent the matching open position available to be
reduced, valued at the editor's current draft price. Typing an amount directly
SHALL remain supported and SHALL update the slider to the nearest representable,
bounded half-percentage without rewriting the typed amount.

#### Scenario: Operator resizes an entry with the slider
- **WHEN** the operator moves an entry order's editor slider to `37.5%`
- **THEN** the amount field shows the whole-USDT notional for `37.5%` of the current available sizing capacity and Apply uses the quantity derived from that amount

#### Scenario: Operator resizes an exit with the slider
- **WHEN** the operator moves an exit order's editor slider to `50%` while the matching position is available
- **THEN** the amount field represents half of that position at the current draft price and Apply remains a single atomic amendment

#### Scenario: Operator types an amount directly
- **WHEN** the operator types a whole-USDT amount that does not land exactly on a half-percentage stop
- **THEN** the typed amount is preserved and the slider reflects its nearest bounded `0.5%` position

#### Scenario: Sizing reference is unavailable
- **WHEN** the current available entry capacity or matching exit position cannot be established
- **THEN** the percentage slider is disabled, the existing amount field remains editable, and all existing validation and refusal messages continue to apply

#### Scenario: Slider selection violates an existing bound
- **WHEN** a slider-derived amount violates an exchange filter or local order limit
- **THEN** Apply remains disabled with the existing contextual reason and no amendment command is emitted
