## ADDED Requirements

### Requirement: Position labels are independent from price-scale typography
The `ENTRY` and `LIQ` annotations SHALL be drawn independently from the chart library's standard price-line titles and price-scale tick typography. Changing either annotation's font size SHALL NOT require reducing the price-scale font size. Their entry and liquidation lines and numeric scale prices SHALL remain visible, and each custom label SHALL stay aligned with the line it names as the chart resizes, scrolls or changes price range.

#### Scenario: Annotation text is made smaller
- **WHEN** the entry and liquidation annotation font is configured below the price-scale font
- **THEN** `ENTRY` and `LIQ` use the annotation size while ordinary scale ticks retain the independently configured scale size

#### Scenario: The chart range changes
- **WHEN** candles, positions or viewport movement change the price-to-coordinate mapping
- **THEN** each custom position label moves to the current coordinate of its own line

#### Scenario: A position lacks a usable liquidation price
- **WHEN** an open position has an entry price but no positive liquidation price
- **THEN** the entry annotation is drawn and no liquidation label or invented liquidation price is shown
