## Why

"The order was filled" is a few hundred bytes. It travels down the same pipe as
the order book, behind it, and pays every cost the order book pays.

**One lane, no priority, no backpressure.** Depth, candles, header, tape, account
state and execution reports all leave the main process through
`broadcastToRenderers` / `sendJSON`, which call `sendUTF` with no notion of which
frame matters and no check on what the socket has already accepted
(`electron/services/binance-connection.js:588`, `:880`). There is no `drain`
handling, no queue accounting, and no dropping of a frame that a newer one has
already superseded. A depth frame the renderer has not drained is a depth frame
an execution report is queued behind.

**The same frame is serialized twice on the way out.** `emitResource` runs
`JSON.stringify(event)` purely to measure the result against the byte ceiling
(`electron/services/futures-production-workstation-service.js:481`), discards the
string, and hands the object to `sendJSON`, which serializes it again
(`:484` → `binance-connection.js:590`). Measured at 0.15 ms each on a real frame,
ten times a second, for a number that the first serialization already knew.

**The same frame is parsed three or four times on the way in.** `useWebSocket`
parses it and normalizes it (`src/hooks/useWebSocket.js:224-225`);
`GatewayContext` parses the same `event.data` again (`src/context/GatewayContext.jsx:142`)
before fanning the untouched event out to its listeners; `useFuturesTrading`
parses it a third time (`src/hooks/useFuturesTrading.js:418`); and
`useFuturesProductionWorkstation` parses and validates it a fourth
(`src/hooks/useFuturesProductionWorkstation.js:303`). Every subscriber receives
the raw frame and does the work again.

**The execution handler pays the order book's bill.** The third of those parses
is the worst. `useFuturesTrading` runs `JSON.parse` over every depth frame the
desk delivers — a hundred and eighteen kilobytes, ten times a second — in order
to read `payload.type`, find it is not an account envelope, and discard the
result. The code whose job is to take a filled order off the screen is spending
its time parsing quotes it will never look at.

**The parse itself is slower than the platform's.** `parseBoundedFuturesWorkstationJson`
(`src/utils/futuresWorkstationProtocolShared.js:225`) is a character-by-character
JSON parser written in JavaScript, preceded by two more full passes over the
string (`utf8Length`, `hasOnlyUnicodeScalars`). It runs on the renderer's depth
path and, through `normalizeFuturesWorkstationStreamFrame`
(`electron/services/futures-workstation-market-contract.js:672`), on every depth
diff Binance sends to the main process. Measured on a real 117.9 KiB frame:

| Path | Cost |
| --- | --- |
| `JSON.parse` | 0.390 ms |
| `parseBoundedFuturesWorkstationJson` | 1.369 ms — 3.5× |
| parse + validate + freeze, the renderer's actual path | 2.658 ms — 6.8× |

The comment above the byte ceiling calls 256 KiB "a bounded, trivially cheap
parse". At ten frames a second through a hand-written tokenizer it is neither.

None of this is visible in a quiet market. All of it compounds in a burst, which
is when an execution report is the one frame the operator is waiting for.

## What Changes

- Market data and account traffic are carried on separate lanes. Account state
  and execution reports are delivered without loss and ahead of market data;
  depth, header, candles and tape are latest-wins and may be dropped when a newer
  frame for the same resource is already waiting.
- A frame that the socket has not accepted is accounted for. When the outbound
  queue is behind, market-data frames are superseded rather than stacked, and
  what was dropped is counted rather than silently lost.
- An event is serialized once. The string measured against the byte ceiling is
  the string that is sent.
- An event is parsed once, at the boundary it arrives on. Subscribers receive the
  parsed, typed event; no subscriber parses a frame to discover it does not want
  it, and the trading hook never sees a depth frame at all.
- The bounded parser is replaced by the platform's, with the byte ceiling still
  enforced before parsing and the structural validators unchanged — they are what
  actually rejects a malformed or hostile payload.

## Non-goals

- Coalescing depth deliveries to one book per animation interval is already
  proposed in `stop-rebuilding-the-desk-on-every-tick` §3 and is not restated
  here. This change makes the transport able to drop a superseded frame; that
  change decides how often the renderer draws one.
- The React state shape is not touched here; that is
  `stop-rebuilding-the-desk-on-every-tick` §4 and §2.

## Impact

- `electron/services/binance-connection.js`,
  `electron/services/futures-production-workstation-service.js`,
  `electron/services/futures-workstation-market-contract.js`,
  `src/utils/futuresWorkstationProtocolShared.js`,
  `src/hooks/useWebSocket.js`, `src/context/GatewayContext.jsx`,
  `src/hooks/useFuturesTrading.js`,
  `src/hooks/useFuturesProductionWorkstation.js`.
- Security-relevant: the parse of local protocol frames changes. §4 below keeps
  the byte ceiling as the bound and requires the change to be reviewed on that
  basis. The upstream parse does *not* change: it answers an exchange identity as
  its exact digits, which is what the order book bridges on, and the platform's
  parser would round it — see §4.8. That section can be dropped without affecting
  the rest of this change.
- Adds requirements to `futures-workstation-presentation` and
  `futures-order-visibility`, and modifies the one that names the parser's node
  budget as a derived bound.
