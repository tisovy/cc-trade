## Why

An order flashes on and off the chart several times in the seconds after it is
placed. Nothing is wrong with the order — what blinks is the desk's picture of
it.

The desk learns an order exists twice over. The user-data stream says so within
milliseconds, and `foldFuturesWorkingOrder` puts it straight into the held
working set. The account read says so too, and `markFuturesResourceReady`
replaces the held set with whatever the read returned. Binance's REST services
are eventually consistent with its streams: an `/fapi/v1/openOrders` read issued
right after a placement can answer without the order that has already been
reported on the stream. That read then removes it. The next read has caught up
and puts it back. Every stream event that follows a placement — the order update,
the account update — queues another read, so the order appears and disappears
once per read that had not caught up.

The desk already knows this failure in the other direction. A read that left
before the stream reported an order *settled* must not list it as working again,
and `FuturesSettledOrderMemory` is what refuses it, on exactly the reasoning that
"the read describes a world the stream has already moved past". The same
sentence is true of an order the stream reported *born*, and nothing implements
it.

## What Changes

- The desk remembers, on its own clock, when the stream last reported each order
  as working, in a bounded memory alongside the one that remembers settlements.
- An account read of the working orders may not remove an order the stream
  reported working **after that read was issued**. The read could not have seen
  it; it is not evidence that it is gone.
- Everything else about a read is unchanged: an order the read omits that the
  stream has said nothing new about is gone, and the read is what says so.

## Trade-offs this accepts

- An order cancelled somewhere else — the Binance app, another desk — during the
  window of a read that was already in flight survives until the next read. That
  next read is already queued in every path that produces this case, so the extra
  life is one refresh cycle. The alternative is the blink, which costs the
  operator the ability to trust what is on the chart at all.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: a read that predates a confirmed order does not
  remove it, symmetrically with a read that predates a settlement.

## Impact

- `electron/services/futures-account-state.js` — the memory and the reconciliation
  the read passes through.
- `electron/services/binance-connection.js` — the read records when it was issued
  and reconciles against that memory, as it already does for settlements.
