## MODIFIED Requirements

### Requirement: The execution ticket keeps decision controls and actionable failures
The default Futures execution ticket SHALL present the tabs, selected contract
and leverage, selected price, percentage slider, editable USDT notional,
decision-relevant account summary, and manual order actions without a separate
readiness/pause header. The sizing block SHALL show its highlighted percentage
immediately after the `Notional, USDT` label, SHALL use the editable notional
field as its only live USDT amount readout, and SHALL render that input value in
larger bold type. It SHALL NOT repeat the notional beside the size slider.

The percentage slider SHALL cover zero through one hundred percent in `0.5`
percentage-point increments. Integer stops SHALL be displayed without a trailing
decimal and half stops SHALL be displayed with `.5`; every selected percentage
SHALL continue to produce a whole-USDT notional.

The ticket SHALL NOT present a `READY` label or routine readiness reason, an
operator `Pause trading` or `Resume trading` control, a passive shortcut/action
label, percentage anchor buttons, a derived `Quantity` summary row, the
mouse-shortcut legend, successful submission or cancellation acknowledgements,
or a passive last-execution card.

Removing or rearranging that chrome SHALL NOT change sizing, exchange-filter
quantization, confirmation, pause enforcement, or command handling. The exact
derived quantity SHALL remain visible in the confirmation that precedes a send.
When an action is blocked, not sent, rejected, or has an unresolved outcome, the
ticket SHALL still present the contextual reason; account synchronization
failures SHALL remain visible with their valid retry path. Passive success
removal SHALL NOT remove any of those safety-critical messages.

#### Scenario: Operator opens a ready ticket
- **WHEN** the live account and selected contract satisfy the order-entry gates
- **THEN** the ticket shows the slider and order controls without `READY`, a pause control, percentage anchors, `Quantity`, shortcut help, passive status cards, or a duplicate USDT readout beside the slider

#### Scenario: Operator sizes with the slider
- **WHEN** the operator changes the percentage slider from `8%` to `8.5%`
- **THEN** the highlighted readout after `Notional, USDT` shows `8.5%`, the bold input shows the corresponding whole-USDT amount, and the order draft uses that amount

#### Scenario: Operator types a notional
- **WHEN** the operator edits the USDT notional directly
- **THEN** that larger bold input remains the single visible sizing amount and the highlighted percentage beside its label updates without adding another amount above the slider

#### Scenario: Order reaches confirmation
- **WHEN** an order action stages a valid draft
- **THEN** the confirmation states the exact exchange-quantized quantity even though the ticket summary omits its `Quantity` row

#### Scenario: Order is accepted
- **WHEN** a confirmed order is accepted for submission
- **THEN** no successful-submission banner or passive last-execution card is added to the ticket

#### Scenario: Pending confirmation is cancelled
- **WHEN** the operator cancels a staged confirmation without sending it
- **THEN** the confirmation closes without adding a cancellation-status banner

#### Scenario: Action cannot be sent
- **WHEN** a gate blocks an action or the local transport cannot send it
- **THEN** the ticket keeps the actionable blocking or not-sent reason visible without restoring routine readiness chrome

#### Scenario: Command outcome requires attention
- **WHEN** the exchange rejects a command, a command outcome is unresolved, or an account resource fails synchronization
- **THEN** the ticket retains the corresponding actionable message and valid retry path while passive acknowledgement cards remain absent
