## ADDED Requirements

### Requirement: Chart annotations are drawn under the weight of the candles
Labels the chart puts on its own plotting area — the order handles and what they
are worth, the titles of the entry, liquidation, alert and drawing lines, and the
plates those lines put on the price scale — SHALL be drawn smaller than the desk's
body text, so that a contract carrying a position and several working orders is
still read as price action rather than as a stack of labels.

#### Scenario: A position and its working orders are on screen
- **WHEN** the chart draws the order handles and the entry and liquidation lines of an open position
- **THEN** their text is drawn at a reduced size rather than at the size the surrounding desk is set in

## MODIFIED Requirements

### Requirement: The chart shows only decision-relevant overlays
The chart SHALL render the contract candles, the operator's drawings and alerts, the operator's orders, and the open position's entry and liquidation prices. The chart SHALL NOT render an index-price overlay, an index price line, or a price-axis marker for the working price draft, and the market header SHALL NOT present an index price field.

The price scale SHALL carry prices. The volume series SHALL NOT stamp its newest
bar onto it: volume is stated by the bars themselves, against their own baseline,
and a quantity in the plate the desk reads levels from is read as a level.

#### Scenario: Chart is rendered for a live contract
- **WHEN** the workstation is live on a contract
- **THEN** no index series, no index price line, and no index header field are present

#### Scenario: Operator picks a price on the chart
- **WHEN** the operator clicks a price to seed the order draft
- **THEN** the draft is reflected in the ticket without adding a coloured label to the price axis

#### Scenario: The newest candle has volume
- **WHEN** the chart draws the volume histogram for the contract on screen
- **THEN** the last bar's volume is not labelled on the price scale
