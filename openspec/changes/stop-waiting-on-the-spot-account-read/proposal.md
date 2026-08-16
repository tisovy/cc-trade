## Why

A spot order is not finished when the exchange has accepted it. The desk then
reads the whole account back and **waits for it** before the command is done:

```js
const executionReport = await spotTradingAdapter.placeOrder({ ... });   // ~330 ms
noteSpotMutation();
emit({ execution_update: executionReport });
await refreshAccountState(symbol);                                       // three more reads
```

`refreshAccountState` runs balances, open orders and trade history in sequence.
Measured on live data 2026-08-16, six spot commands: **1696, 1882, 335, 3285,
1696 and 2169 ms**.

The 335 ms is the one that proves it. `refreshAccountState` returns immediately
when a pass is already in flight, so that command skipped the wait — and landed
on the exchange round trip alone, which after `pay-the-spot-handshake-once` is
about 330 ms. One command out of six measured the order; the other five measured
the order plus an account pass.

Futures does not do this. The same read is issued there and deliberately not
waited on — `void refreshFuturesAccountState({ reason: 'unstated' })`,
`binance-connection.js:1889`. Spot kept the `await`.

## What Changes

- Stop awaiting the account read inside a spot command. The order's outcome is
  already emitted before it — `emit({ execution_update: executionReport })` is
  the line above — so the wait adds nothing the operator is shown any sooner.
- Keep the read. It still has to happen; it just does not have to be in front of
  the operator's next click.

## What to be careful about, and why this is not a one-line change

The `await` is load-bearing in one place that is not the happy path. In
`reportSpotCommandFailure`'s reconciliation, the desk resolves an unknown outcome
and then refreshes; there the ordering is what makes the screen agree with the
exchange before the operator can act on it. Dropping the wait everywhere by
find-and-replace would take that with it.

So this change has to say, per call site, which reads the operator waits for and
which they do not — the same distinction futures already draws between
`reason: 'unstated'` (fire and forget) and `reason: 'unresolved'` (awaited,
because the screen is wrong until it answers).

## What it buys

On the numbers above, a spot command stops costing 1.7–3.3 s and starts costing
about 330 ms — the round trip and nothing else. That is the change the operator
was expecting from `pay-the-spot-handshake-once` and did not get, because the
handshake was never the part they were waiting on.

## Impact

- `electron/services/binance-connection.js` — the spot placement, cancel and
  reconciliation paths.
- Adds a requirement to `trading-command-integrity`.
