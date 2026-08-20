# Read the settled money from the newest end

## Why

The operator's PnL column was empty and four closed rounds each disagreed with
the Binance app by exactly their funding. Two commits fixed real defects on that
path and the symptom did not move. The third attempt instrumented the read
instead of reasoning about it, and the first line it wrote named the cause:

```
"kind":"settled","reason":"refresh","pages":4,"rows":4000,"kept":4000,
"contracts":5,"recipients":1,"outcome":"partial"
```

Every pass walks four pages of a thousand rows, keeps all four thousand, and
finds five contracts. `/fapi/v1/income` is ordered oldest-first and `page` indexes
that order, so the read spends its whole budget on the **oldest** end of a
seven-day window. On an account this active, four thousand rows is the first day
or so. Everything on the operator's screen — a position opened today, rounds
closed on the 18th and 19th — sits behind page four and is never read.

The lesson is already written down twenty lines away, in the contract-discovery
walk that shares this endpoint: *"A page budget spent on the far end of the window
is how a review of this session came back covering none of it."* The settled read
did not learn it.

There is a second defect underneath. The read broadcasts `from` as the window it
*asked* for, not the span it actually covered. Downstream, `from <= openTime` is
what decides whether a round's funding is fully accounted for — so a read that
reached none of a round's life still reported that round as completely covered.
That is why nothing on screen was ever marked as qualified: the desk believed
its own truncated reading.

## What Changes

- The settled-money read walks **backwards from now**, in time slices sized to
  what the account actually produces, instead of forwards from the window's far
  edge. The rows on screen are the newest rows, so those are the ones read first.
- A slice that comes back full is not accepted — a full page means the newest
  part of that slice is missing. The slice is narrowed and re-read, so what is
  kept is always a contiguous span ending at a known instant.
- Rows are **accumulated across passes** rather than re-read every time. The
  steady state becomes one request for the tail since the last read; the budget
  is spent extending coverage backwards instead of re-reading what is held.
- `from` states the oldest instant actually covered, never the window that was
  asked for. `complete` follows it.
- The fold uses that coverage: a contract whose position began before the read
  reaches is reported as partially covered, and says so, instead of presenting
  the window's total as the position's.

## Impact

- `electron/services/binance-connection.js` — the read and its record.
- `src/utils/futuresSettledMoney.js` — the fold's completeness test.
- `src/hooks/useFuturesTrading.js` — passes the read's coverage into the fold.
- Affected specs: `futures-order-visibility`.
