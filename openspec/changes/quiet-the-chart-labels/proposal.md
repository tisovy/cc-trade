## Why

The chart's own annotations are drawn at the weight of the thing they annotate.
The order handles (`LONG · 11 924 USDT`), the entry band's plate (`ENTRY LONG`)
and the liquidation line's (`LIQ`) sit on the candles at the desk's body size, and
on a contract carrying a position and three working orders the price action is
read between them. The operator asked for thirty per cent off.

And the price scale carries one plate that is not a price: the newest bar's
volume, stamped on the axis in the same shape the desk reads levels from. The
histogram already states volume, bar by bar, against its own baseline. The badge
adds nothing and takes a slot on the scale the operator reads prices on.

## What Changes

- The order handles — the plaque, its value, its cancel control — are drawn at
  seven tenths of their previous size.
- Every label the charting library draws for us is reduced with them: the price
  line titles (`ENTRY`, `LIQ`, `ALERT`) and the plates they put on the scale come
  from one chart-wide size, so they move together. Twelve becomes nine, which is
  where the price scale stops being comfortably readable — the reduction on those
  is a quarter rather than a third.
- The volume series stops stamping its last value on the price scale.

## Impact

- Affected specs: `futures-workstation-presentation`
- Affected code: `src/components/features/futures/FuturesWorkstationChart.jsx`,
  `src/components/features/futures/FuturesWorkstation.css`
- The price scale's own tick labels shrink with the rest: the library draws them
  from the same size, and it offers no way to set the price-line labels apart.
