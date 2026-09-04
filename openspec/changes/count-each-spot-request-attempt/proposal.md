## Why

Audit F08 found obsolete Spot refresh weights (10/3/10 rather than 20/80/20) and one reservation reused across retries. The public detail bootstrap also declares exchangeInfo/trades below their current published weights. These undercount the budget independently of SDK retries, which F02 already disabled.

## What Changes

- Charge account=20, all-symbol openOrders=80 and symbol trades without orderId=20, matching the parameters actually sent.
- Charge public exchangeInfo=20 and recent trades=25; preserve depth limit-100=5 and klines=2.
- Reserve capacity and spacing before every non-physical-mode retry, not once before the loop. Preserve charges for attempted failures and support cancellation while waiting.
- Keep Futures physical accounting and all trade replay policies unchanged.

## Capabilities

### New Capabilities

- `spot-request-accounting`: accurate declared read weights and per-attempt legacy admission.

### Modified Capabilities

None.

## Impact

Spot adapter weight table, shared RateLimiter's legacy branch, public detail weights, production tests and evidence. This is not a claim that every Spot route uses a unified exchange-header-aware limiter. No real requests, quota exhaustion or session restart is required.
