## Why

The chart library uses one layout font size for both price-scale ticks and the `ENTRY`/`LIQ` price-line titles. The annotations therefore cannot be resized independently without also shrinking the scale operators use to read every price.

## What Changes

- Stop using standard price-line titles for `ENTRY` and `LIQ` text.
- Draw dedicated chart annotations at the entry and liquidation coordinates while keeping their price lines and scale prices.
- Give the custom annotations their own size so the price-scale font can remain independently readable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Render entry and liquidation labels independently from the chart library's global price-scale typography.

## Impact

- `src/components/features/futures/FuturesWorkstationChart.jsx`
- Futures chart annotation styles and component tests
- No market-data, position or order behavior changes
