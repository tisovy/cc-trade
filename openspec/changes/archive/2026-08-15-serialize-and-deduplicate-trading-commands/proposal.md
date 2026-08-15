## Why

Carried over from `harden-trading-command-integrity`, where the operator chose
on 2026-08-09 to close the ambiguous-response hole first and defer this. It is
recorded as its own change so the deferral is not lost when that one archives.

Two gaps remain after `harden-trading-command-integrity` lands:

- The main process has no replay or in-flight registry. Two identical WebSocket
  frames delivered concurrently can each be submitted, producing two real
  orders. Stable command identity makes the duplicate detectable by the
  exchange for placement, but nothing prevents the second submission locally,
  and identity does not deduplicate a cancellation or an amendment.
- Mutating commands on one order are not serialized. An amendment and a
  cancellation accepted in that order can reach the exchange in the other
  order, so an order can be amended after it was meant to be cancelled.

## What Changes

- A bounded main-process registry keyed by command identity records in-flight
  and recently completed outcomes, and answers a redelivered or duplicated
  command from the record instead of submitting it again.
- Mutating commands targeting the same order identity, and the same symbol, are
  executed in the order they were accepted.

## Capabilities

### Modified Capabilities

- `trading-command-integrity`: a duplicated command cannot reach the exchange
  twice, and mutating commands on one order cannot execute out of order.

## Impact

- New main-process module for the command registry, used by
  `electron/services/binance-connection.js` on both markets.
- Depends on `harden-trading-command-integrity`: the registry is keyed by the
  stable command identity that change introduces.
- Does not block live Futures on its own.
