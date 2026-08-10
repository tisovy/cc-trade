## 1. Valuing an Order at the Price It Rests At

- [x] 1.1 Carry `triggerPrice` on a normalized regular order from the exchange's `stopPrice`, so a market-triggered stop is no longer read as resting at `0`. Absent where the exchange reports no trigger; algo orders keep stating their own through the overrides.
- [x] 1.2 Refuse to value an order with no usable price or no usable size instead of returning the `0` that `Number(null)` produces. A close-position stop has no quantity of its own and now reads as absent rather than as an order worth nothing.
- [x] 1.3 Put the unrounded valuation behind the one helper every surface already prices orders through, so the row, the editor, the chart label and the new total cannot disagree.

## 2. The Ticket States What Is Resting

- [x] 2.1 State `On order` under `Available` as the sum of the working orders, over the same arithmetic as the column the operator reads it against. The exact sum and the order count stay on the cell's title.
- [x] 2.2 Absent until the orders have synchronized once; an empty list is zero, because nothing resting is a reading.
- [x] 2.3 Leave rows that cannot be valued out of the total rather than adding zero, matching what the list itself shows for them.
- [x] 2.4 State both funds figures in whole USDT, rounded rather than truncated, and reverse the cents requirement in the spec rather than dropping it.

## 3. Undoing the First Attempt

- [x] 3.1 Return the balance read to `/fapi/v3/balance`: the account route was taken only for `openOrderInitialMargin`, which reported the margin the orders cost to hold — `58.9k` against a list worth over `100k` — and is not the number the operator checks.
- [x] 3.2 Drop `openOrderMargin` from the normalized balance and the dual-shape wallet total with it, so no field survives that nothing reads.

## 4. Verification

- [x] 4.1 `npx vitest run` — 88 files, 1,136 passed, with cases for the summed total, a triggered order, an empty list, an unsynchronized list, a row that cannot be valued, and the trigger carried from both the REST and the stream shape.
- [x] 4.2 `eslint` clean on every file this change touches.
- [x] 4.3 `npm run check:futures-production` passes.
- [x] 4.4 Operator confirms on the live account that `On order` matches the total of their working-orders list, and that both figures read in whole USDT. — closed by the operator on 2026-08-10 rather than reported checked.

## 5. Stated Limits, Not Fixed Here

- [ ] 5.1 The total is order value, not margin: at leverage the wallet holds a fraction of it, and it is not the amount `Available` is reduced by. It is stated to be checked against the orders list, which is where the operator reads it.
- [ ] 5.2 Account-wide, like the available balance beside it — not the orders on the selected contract.
- [ ] 5.3 A stop-limit order is valued at its trigger rather than its limit price, as algo orders already were. The two differ by the distance between trigger and limit.
- [ ] 5.4 The chart's order lines and the order editor still position a regular order by its `price`. A market-triggered stop is therefore still not drawn on the chart; only the surfaces that value an order changed.
- [ ] 5.5 Only the ticket's funds are rounded. The margin editor states amounts the operator types to the cent and is left alone.
