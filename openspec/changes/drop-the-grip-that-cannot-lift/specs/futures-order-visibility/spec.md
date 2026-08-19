## MODIFIED Requirements

### Requirement: Chart interactions respect order source semantics
The chart SHALL distinguish regular and algorithmic orders visually and accessibly. An order SHALL be draggable or cancellable only when the corresponding authenticated exchange operation and identity mapping are supported; otherwise it SHALL remain visible with an explicit display-only indication.

A drag grip SHALL be offered only on an order resting at a positive price — one the lift path could place back where it rests. A regular order resting at no price — a stop-market order rests with `price: '0'` while its trigger lives in `stopPrice` — SHALL be offered no drag grip: where the pane shows it, it SHALL be drawn without the drag affordance, SHALL state accessibly that it cannot be moved by dragging, and SHALL keep its cancel control. No drag SHALL begin on such an order and no pending drag mark SHALL be drawn for it — not at the y-coordinate of price zero, not anywhere. The lift path's own refusal SHALL remain, unchanged, for lifts that are genuinely broken in other ways.

#### Scenario: Supported regular limit order is amended
- **WHEN** the operator drags an amendable regular limit order to a valid exchange-filtered price and confirms the action
- **THEN** the system sends the source-appropriate operation and reconciles the exchange response

#### Scenario: Algorithmic order amendment is not supported
- **WHEN** an algorithmic order is displayed but source-aware amendment is unavailable
- **THEN** the chart does not offer drag amendment and identifies the order as display-only

#### Scenario: An order resting at no price offers no drag
- **WHEN** a stop-market order rests with no positive resting price
- **THEN** no drag grip is offered and no pending mark is drawn for it, and where the pane shows the order it stays visible and cancellable
