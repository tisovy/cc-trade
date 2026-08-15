# Live Verification Ledger

This is the single record of shipped behaviour whose operator verification on
live data is still outstanding. An archived implementation change stays in
place; its operator-confirmation task remains unchecked until an observation is
recorded here.

When verification happens, update **Subsequent status** with `CONFIRMED` or
`FAILED`, the observation date, and the evidence or follow-up change. Do not
replace the recorded date or erase the original reason.

## Outstanding Verifications

| Change | Task | Unverified behaviour | Reason | Recorded date | Subsequent status |
|---|---:|---|---|---|---|
| `adjust-isolated-position-margin` | 11.1 | On a real isolated position, adding margin moves the row's margin and liquidation price to Binance's values. | The archive says this live check was left for the operator, but the task was checked. | 2026-08-13 | `OUTSTANDING` — no later full live confirmation is recorded as of 2026-08-13. |
| `adjust-isolated-position-margin` | 11.2 | Removing margin updates the position, while an excessive removal is refused with Binance's message. | The archive says this live check was left for the operator, but the task was checked. | 2026-08-13 | `OUTSTANDING` — no later full live confirmation is recorded as of 2026-08-13. |
| `adjust-isolated-position-margin` | 11.3 | The buffer and liquidation-risk readings agree with Binance; the slider moves the projection; the panel remains fully usable at the screen edge. | The archive says this live check was left for the operator, but the task was checked. | 2026-08-13 | `OUTSTANDING` — no later full live confirmation is recorded as of 2026-08-13. |
| `deepen-futures-chart-history` | 6.4 | A Futures contract opens with deep history, scrolling left loads more without a jump, and a restart reuses the same depth without another request. | The archive says this live check was left for the operator, but the task was checked. The separately recorded live defect in task 6.3 does not prove this whole behaviour. | 2026-08-13 | `OUTSTANDING` — no later full live confirmation is recorded as of 2026-08-13. |
| `deepen-spot-chart-history` | 5.4 | A Spot pair opens beyond the bootstrap window, scrolling left keeps loading without a jump, and a restart reuses the same depth without another request. | The archive says this live check was left for the operator, but the task was checked. | 2026-08-13 | `OUTSTANDING` — no later full live confirmation is recorded as of 2026-08-13. |
| `keep-position-value-live` | 5.6 | Position uPnL ticks with the chart and the size column reads as plain USDT. | The archive says this live check was left for the operator, but the task was checked. The live transport observation in task 5.4 does not prove both UI readings. | 2026-08-13 | `OUTSTANDING` — no later full live confirmation is recorded as of 2026-08-13. |
| `price-the-exit-and-the-liquidation` | 5.5 | Margin dragging moves liquidation price, a top-up above committed margin is accepted, and the close slider/PnL agree with Binance. | The archive says this live check was left for the operator, but the task was checked. | 2026-08-13 | `OUTSTANDING` — no later full live confirmation is recorded as of 2026-08-13. |
| `read-the-desk-at-a-glance` | 9.4 | Scaled market readings, history timestamps/prices, closed-position rounds, and type-to-search all read correctly on the live desk. | The archive says this live check was left for the operator, but the task was checked. | 2026-08-13 | `OUTSTANDING` — no later full live confirmation is recorded as of 2026-08-13. |
| `review-the-account-not-the-contract` | 5.4 | Account-wide closed positions show remembered symbols, entry/exit, unclipped realized PnL, and the correct 24h Binance volume. | The archive says this live check was left for the operator, but the task was checked. | 2026-08-13 | `OUTSTANDING` — no later full live confirmation is recorded as of 2026-08-13. |
| `state-and-set-the-leverage` | 4.6 | The badge matches Binance, setting leverage takes effect, liquidation moves as warned, and estimated margin matches the exchange. | The archive says this live check was left for the operator, but the task was checked. | 2026-08-13 | `OUTSTANDING` — no later full live confirmation is recorded as of 2026-08-13. |
