## Why

The working-orders `Filled (USDT)` column, added by `finish-futures-order-values`
(commit 32b9da8), values the executed quantity at `orderPresentationPrice` — the
order's resting limit price, or its trigger when no limit exists. But the
exchange states the actual average fill price on the very same payload:
`normalizeFuturesExecutionReport` carries `avgPrice` from the REST open-orders
read and `ap` from the stream's `ORDER_TRADE_UPDATE`, and the renderer stores
that report wholesale, so the number is already on every order the dock prices.
For a stop-limit that fills through a gap, the column therefore states what the
order asked for, not what the account actually paid or received.

The spec sentence that blesses this — "using the same order-price selection
rules as the order's stated size" — was written by the same change that wrote
the code, as the requirement its own tests were then checked against. It
confirmed the implementation rather than constraining it: nothing outside that
change ever asked whether the resting price is the right price for a column
whose job is to say what *filled*. The order-history `Filled` column beside it
already answers the same question with the fill price (`quoteQty`, else
`executedQty × averagePrice`), so the desk currently gives two valuations of
the same fill depending on which tab it is read in.

The 2026-08-19 audit named this; the operator approved fixing it the same day.

## What Changes

- `orderFilledNotionalUsdt` values the executed quantity at the exchange's
  `avgPrice` when the payload states a positive one, and falls back to the
  resting-price rule only when it does not. Binance states "nothing filled yet"
  as `avgPrice: "0"`, which is no price — so a zero fill still reads as zero
  USDT rather than as absent, exactly as before.
- **MODIFIES** the `futures-order-visibility` requirement "A working order's
  filled portion is stated in USDT" introduced by `finish-futures-order-values`,
  replacing the self-confirming resting-price sentence with fill-price
  valuation and the stated fallback.
- Formatting is untouched: same rounding, same `Filled (USDT)` header, same
  exact executed contract count as the cell's secondary detail.

## Impact

- `src/utils/futuresOrderPresentation.js` — price selection inside
  `orderFilledNotionalUsdt` only; its one production caller,
  `FuturesPortfolioDock.jsx`, renders the returned value unchanged.
- `src/utils/futuresOrderPresentation.test.js` and
  `src/components/features/futures/FuturesPortfolioDock.test.jsx` — a biting
  regression each: fill through a gap uses `avgPrice`, `avgPrice: "0"` falls
  back.
- `openspec/specs/futures-order-visibility/spec.md` — one MODIFIED requirement.
- No submission, execution, editing, dragging or cancellation semantics change,
  and the working-order *size* valuation (the resting remainder) is untouched.
