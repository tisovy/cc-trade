## 1. The Handles

- [x] 1.1 Draw the order handle, its value and its cancel control at seven tenths
  of their size: 11.5px → 8px, 12.5px → 8.75px, 15px → 10.5px, with the plate's
  height, padding and gaps taken down with them.
- [x] 1.2 Cover the handle of an exchange-managed order too. It is drawn as a bare
  plate with no grip, so its side label was not reached by the rule that sized the
  others and stayed at the 16px the layer inherits — measured beside its own 9px
  value. Found in audit, after the first pass.

## 2. The Library's Own Labels

- [x] 2.1 Set the chart's label size to 9px, which carries the price line titles
  (`ENTRY`, `LIQ`, `ALERT`) and every plate on the price scale — they are one
  setting, and the price scale is what bounds how far it can go.

## 3. The Volume Badge

- [x] 3.1 Stop the volume series stamping its last value, and its price line, on
  the price scale.

## 4. Verification

- [x] 4.1 `npx vitest run` — 90 files, 1,185 passed, including the chart's label
  size and the volume series' options.
- [x] 4.2 `eslint` clean; `npm run check:futures-production` passes.
- [ ] 4.3 Operator confirms on the live desk that the handles and the entry and
  liquidation plates read as annotations, and that the price scale is still
  comfortable at 9px.

## 5. Stated Limits, Not Fixed Here

- [ ] 5.1 The price scale's tick labels shrink with the price line titles. The
  library draws both from one size and offers no way to set them apart; drawing
  the entry and liquidation labels ourselves, as the order handles already are,
  is what it would take to separate them.
- [ ] 5.2 Every size here still scales with the desk's A−/A+ control, so an
  operator who wants them larger still has that.
