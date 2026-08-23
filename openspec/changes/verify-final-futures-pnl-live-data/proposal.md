## Why

The final Futures PnL audit is deterministic and fully tested, but its last fixes have not yet been observed against the operator's live Binance account. Archiving the implementation changes must not erase those operator-only checks or turn USDC/BNB cases the account does not use into fictional evidence.

## What Changes

- Carry the outstanding live USDT Closed Positions, restart, hedge-leg, reversal, confirmation-timing, resource-restart, and request-accounting checks out of the five implementation changes being archived.
- Treat USDC settlement and Futures BNB commission as not applicable to this operator, while retaining their deterministic regression coverage.
- Measure the realistic and admitted-ceiling cost of durable confirmation-debt persistence; open a separate format/sidecar implementation change only if the measurement shows material event-loop or write amplification.
- Record results in the shared live-verification ledger. No order placement, cancellation, position close, transfer, or margin mutation is authorized by this verification change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change verifies existing requirements and measures a bounded implementation cost; it changes no product behavior.

## Impact

- Read-only observation of the Production Futures workspace and Binance application's corresponding Closed Positions/income evidence.
- Local diagnostic and persistence measurements using sanitized counts, durations, and byte sizes only; no raw income rows, identities, credentials, or signed monetary material are written to diagnostics.
- The change remains active until the operator supplies the live observations or explicitly marks a case not applicable.
