## Why

Dragging an order can destroy it, and the desk already holds everything it
needed to refuse the drag instead.

Observed on the live desk on 2026-08-15 while checking runbook step 24. The
operator placed a 5 USDT limit order on BTWUSDT and dragged it down. The desk
carries an amendment as a cancel and a fresh placement, and the record shows
both halves:

| time (UTC) | command | outcome |
|---|---|---|
| 18:12:27.032 | `trade.cancelOrder` `1313499621` | ok |
| 18:12:28.573 | `trade.placeOrder` | rejected, `exchangeCode: "-4164"` |

The operator saw it as two errors at once:

> «Order cancelled and NOT replaced. BTWUSDT BUY 23 @ 0.2029 was cancelled and
> could not be placed again. Order's notional must be no smaller than 5.»

A drag lowers the price and leaves the quantity where it was, so it lowers the
notional: 23 × 0.2029 is 4.67 USDT, under the exchange's 5 USDT floor. The
order was live, the operator's gesture was ordinary, and the order is gone.

The desk is not missing the knowledge. Minutes earlier, on the same contract,
the ticket refused a placement of its own accord with `Size is below the
Binance minimum notional` — the bound is held in the renderer and enforced on
the path that places an order. It is simply not consulted on the path that
amends one, and that path cancels first.

`futures-order-entry-fidelity` already says a staged order that no longer passes
is refused rather than re-sized. The same principle is unstated for an order
that already exists: a replacement that would be refused must be refused
*before* the thing it would replace is given up.

## What Changes

- An amendment checks its replacement against the bounds the desk already
  enforces on placement, before issuing the cancel.
- A replacement that would not pass leaves the existing order where it is, and
  says why — the operator keeps the order and learns the bound.
- The existing "cancelled and not replaced" message stays for what it is
  genuinely for: a replacement that the exchange refused for a reason the desk
  could not have known in advance.

## Impact

- The futures order drag and amend path in the renderer
- Spec: `futures-order-entry-fidelity`, one new requirement beside the staged-order one it generalizes
- Not the exchange filters themselves: the operator has already decided those
  are not checked locally beyond what the desk holds today
