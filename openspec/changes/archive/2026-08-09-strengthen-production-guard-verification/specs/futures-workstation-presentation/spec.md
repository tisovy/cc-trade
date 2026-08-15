## Purpose

Turns MARK removal from a reviewed property into a machine-checked one.

## MODIFIED Requirements

### Requirement: The chart does not draw a MARK overlay
The Futures chart SHALL NOT render a historical MARK candle series, a horizontal MARK price line, a MARK label, MARK accessibility text, or any MARK contribution to autoscaling. The current mark price SHALL remain available to the header, position rows, and risk calculations. The INDEX reference is removed separately by "The chart shows only decision-relevant overlays", and no accessibility text SHALL describe an overlay the chart no longer draws.

This requirement SHALL be covered by automated chart tests that fail if any MARK presentation returns, if an INDEX presentation returns, or if current mark price stops reaching the header and position rows. Removal verified only by inspection SHALL NOT be considered covered.

#### Scenario: Mark-price data is available
- **WHEN** the workstation receives valid mark-price history and a current mark price
- **THEN** no MARK series or MARK horizontal line is drawn on the chart

#### Scenario: Risk state uses mark price
- **WHEN** a position or liquidation-distance calculation requires mark price
- **THEN** removing the chart overlay does not remove or substitute the underlying mark-price input

#### Scenario: Payload carries mark data
- **WHEN** the chart receives a payload containing mark values
- **THEN** no MARK series, price line, label, or accessibility text is created, and autoscaling is unaffected by mark values

#### Scenario: MARK presentation is reintroduced
- **WHEN** any MARK series, line, label, or accessibility text is added back to the chart
- **THEN** at least one chart test fails

#### Scenario: INDEX presentation is reintroduced
- **WHEN** an INDEX series, line, label, or accessibility mention is added back to the chart
- **THEN** at least one chart test fails

#### Scenario: Mark price still reaches non-chart surfaces
- **WHEN** the workstation renders header and position rows for a symbol with a current mark price
- **THEN** that mark price is displayed, distinguishing overlay removal from loss of mark data
