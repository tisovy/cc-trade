## Why

An order placed as the price breaks a level sometimes stays in the working-orders
list after it has filled, and stays there until the application is reloaded. The
operator reported it as intermittent; it is not, it is a race with one reliable
trigger.

A limit order placed at a level that is breaking fills instantly, and Binance
delivers the fill on the user-data stream *before* the reply to the placement
itself comes back over REST. The desk applies them in the order they arrive:
`FILLED` for an order it does not yet hold, which removes nothing, and then the
placement's own reply describing the order as it left the exchange — `NEW` —
which puts it into the list. Nothing takes it out again, because nothing re-reads
the account unless the desk sends something. Ctrl+R re-reads on mount, which is
why a reload "fixed" it.

The account snapshot has the same shape of fault. It is read from a different
Binance service than the stream, and the two are eventually consistent: a read
issued around the fill still lists the order as `NEW`, and arriving after the
fill it puts the order back. The desk already refuses a snapshot that describes
an order it holds with an older update time — but an order the desk has *removed*
is not in that comparison, so nothing refused it.

And underneath both: the desk learns that an order is gone from a message. If no
message arrives — a socket that stopped delivering without closing, an event the
exchange never sent — nothing re-reads at all. The spec has required "periodic or
operator-requested REST reconciliation" since the order-visibility capability was
written, and only the operator-requested half existed.

## What Changes

- The desk remembers the orders the exchange has reported settled, and refuses to
  list one again — from a report that left before the settlement, or from a
  snapshot read before it. An exchange order id is never reused, so a settled
  identity can be refused outright rather than compared by time.
- The memory is bounded to the last 256 settlements: it guards against messages
  in flight, not history.
- A settlement report with no order id settles nothing. Its identity would be the
  prefix every unidentified order on that contract shares.
- While orders are working, the account is re-read on a thirty-second beat, so a
  settlement nobody told the desk about is half a minute of staleness rather than
  a permanent one. With nothing resting the beat stops: there is nothing to go
  stale that way, and an account read costs ninety of the exchange's 2 400 weight
  a minute.

## Impact

- Affected specs: `futures-order-visibility`
- Affected code: `src/hooks/useFuturesTrading.js`
- No change to what the desk sends the exchange. The new read is the same account
  refresh the operator's ↻ control already sends.
