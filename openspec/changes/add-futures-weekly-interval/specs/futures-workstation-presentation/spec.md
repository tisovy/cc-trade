## ADDED Requirements

### Requirement: The Futures chart offers a complete weekly interval
The Futures interval choices SHALL include `1w` immediately after `1d` in the chart toolbar and in the keyboard interval picker. Selecting `1w` SHALL replace the current interval through the same typed workstation path as every existing choice and SHALL deliver Binance weekly live candles and older weekly history as one isolated series. Weekly history SHALL remain keyed separately by contract and interval and SHALL treat consecutive weekly candles as seven days apart for continuity and local cache reuse.

The `15m` default, the behavior and order of all existing Futures intervals, unsupported-interval rejection, and Spot interval behavior SHALL remain unchanged. At supported workstation widths the added control SHALL remain visible and operable without introducing a toolbar scrollbar or hiding another interval.

#### Scenario: Weekly interval is visible
- **WHEN** the Futures chart toolbar is rendered
- **THEN** it shows a `1w` interval control immediately after `1d` and identifies it as an unselected or selected chart interval like the existing controls

#### Scenario: Weekly interval is selected from the toolbar
- **WHEN** the operator activates `1w`
- **THEN** the workstation accepts `1w`, replaces the previous interval subscription, and draws weekly live candles and weekly history without rows from the previous interval

#### Scenario: Weekly interval is selected from the keyboard picker
- **WHEN** the interval picker is opened with a query that matches `1w` and the operator selects it
- **THEN** the picker closes and the chart changes to the same `1w` reading as the toolbar control

#### Scenario: Weekly history is reused
- **WHEN** closed `1w` candles have been cached for a contract and the same contract and interval are reopened
- **THEN** contiguous weekly rows seven days apart are reused under the `1w` cache key and no daily or other interval row is mixed into them

#### Scenario: A previous interval answers late
- **WHEN** the operator switches to `1w` and a candle or history answer from the abandoned interval arrives afterwards
- **THEN** the late answer is ignored and the weekly series remains owned by the `1w` selection

#### Scenario: Existing defaults and validation remain in force
- **WHEN** the workstation opens without an explicit interval selection or receives an unsupported interval
- **THEN** it still opens at `15m`, rejects the unsupported value, and does not treat adding `1w` as permission for any other interval

#### Scenario: The toolbar is width constrained
- **WHEN** the Futures chart renders at a supported narrow workstation width
- **THEN** `1w` and every existing interval remain visible and operable without a horizontal toolbar scrollbar
