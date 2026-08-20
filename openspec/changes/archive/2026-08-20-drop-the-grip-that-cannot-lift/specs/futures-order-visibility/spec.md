## MODIFIED Requirements

### Requirement: Chart interactions respect order source semantics
The chart SHALL distinguish regular and algorithmic orders visually and accessibly. An order SHALL be draggable or cancellable only when the corresponding authenticated exchange operation and identity mapping are supported; otherwise it SHALL remain visible with an explicit display-only indication.

A price-moving affordance — the chart's drag grip, and the ticket and dock rows' editor doorway alike — SHALL be offered only on an order whose price is the desk's to move: a regular order resting at a positive price and guarding no trigger. A regular order resting at no price — a stop-market order rests with `price: '0'` while its trigger lives in `triggerPrice` — has nothing the desk could re-price; a regular order guarding a trigger — a stop-limit — could only be "moved" by discarding the trigger and leaving a naked limit where a guard stood, and Binance's amend endpoint re-states LIMIT orders only. Where the pane shows such an order, it SHALL be drawn without the drag affordance, SHALL state accessibly — naming its own price — that it cannot be moved, and SHALL keep its cancel control. No drag SHALL begin on such an order and no pending drag mark SHALL be drawn for it — not at the y-coordinate of price zero, not anywhere. An order with no presentable price at all SHALL not be drawn as a handle. The lift path's own refusal SHALL remain, unchanged, for lifts that are genuinely broken in other ways.

What a handle states — its price, its worth, its trigger state — SHALL be what the exchange last said about the order, even while the viewport stands still; a drag begun from a handle SHALL read the order as it is, not as it was drawn.

#### Scenario: Supported regular limit order is amended
- **WHEN** the operator drags an amendable regular limit order to a valid exchange-filtered price and confirms the action
- **THEN** the system sends the source-appropriate operation and reconciles the exchange response

#### Scenario: Algorithmic order amendment is not supported
- **WHEN** an algorithmic order is displayed but source-aware amendment is unavailable
- **THEN** the chart does not offer drag amendment and identifies the order as display-only

#### Scenario: An order resting at no price offers no drag
- **WHEN** a stop-market order rests with no positive resting price
- **THEN** no drag grip is offered and no pending mark is drawn for it, and where the pane shows the order it stays visible and cancellable

#### Scenario: An order guarding a trigger offers no move
- **WHEN** a stop-limit order rests at its own price with a trigger it guards
- **THEN** no drag grip and no editor doorway are offered on it anywhere an order can be edited, its handle names the trigger it guards, and it stays cancellable

#### Scenario: A partial fill redraws the handle under a still viewport
- **WHEN** part of a resting order fills while the price scale and the order's price do not move
- **THEN** the handle restates the order's remaining worth, and a drag begun from it reads the remaining quantity, not the drawn one
