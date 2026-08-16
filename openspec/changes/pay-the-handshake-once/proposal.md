## Why

**Three quarters of what an order costs is not the order.** The operator asked
why a futures command takes 700 ms. Measured on 2026-08-16 through the desk's
own proxy, against `https://fapi.binance.com/fapi/v1/ping`:

| what was measured | n | result |
|---|---|---|
| request that opens its own connection | 5 | 627, 631, 644, 630, 680 ms — median **630** |
| request on a connection already open | 4 | 324, 326, 326, 324 ms — spread **2 ms** |
| the same, with no proxy at all | — | 443 cold, **292** warm |

So a round trip to Binance is ~325 ms and the handshake in front of it is
~305 ms. The proxy accounts for 33 ms of the round trip; the remaining 292 ms is
distance and no change to this codebase touches it.

The desk's own record for the same day, session 07:19:46, four futures commands
the operator issued by hand: `trade.replaceOrder` 729 ms, `trade.placeOrder`
739 ms, `trade.placeOrder` 729 ms, `trade.cancelOrder` 719 ms. That is one cold
request (630) plus the exchange doing the work (~100). Every one of those
commands paid for a connection, used it once and threw it away.

**Why it happens.** `resolveProxyAgent` (`binance-connection.js:571`) builds
`new SocksProxyAgent(proxyUrl)` with no options, and `http.Agent` defaults
`keepAlive` to false, so the agent opens a connection per request and destroys
it on response. Confirmed on the wire rather than from the source: sampling the
desk's connections to `127.0.0.1:1080` twice a second for 30 s shows a steady 20
— those are the streams — rising briefly to 24 on the thirty-second account beat
and falling back. Four reads, four connections, all gone inside 1.5 s.

Every futures REST caller pays this: each of the four resources on every
thirty-second beat, every history page, every leverage read, and every command.

**This repository already does it the other way.**
`futures-production-workstation-transport.js:196` builds the same agent from the
same library version (socks-proxy-agent 8.0.5) with `keepAlive: true`,
`maxSockets: 8`, `maxFreeSockets: 2`. The one place that argues against reuse is
`binance-connection.js:909` — `keepAlive: false, // Disable keepAlive to avoid
axios agent issues` — and that is the **Spot** SDK's own flag on a different
mechanism. This change does not touch it.

**What reuse costs, and why the fallback is the point.** A pooled connection can
be closed by the far side while it sits idle, and the next request can be handed
it in the instant between the close and Node noticing. That is the one failure
mode reuse introduces, and Node names it exactly: `request.reusedSocket` is true
and the request fails with a connection reset before any response byte. The far
side's TCP stack refused the bytes, so the exchange did not see the request —
which is what makes retrying it on a new connection safe, and what makes it
unsafe to widen that rule by an inch. Any other failure is a failure the desk
already had before reuse, and must behave exactly as it did.

The desk is also not allowed to become quietly slow again. If the pool stops
being used — a config change, a library change, an origin the pool never keeps —
nothing today would say so, and the desk would return to 700 ms commands with no
line in the record. So a request that has to open its own connection says so and
says what it cost.

## What Changes

- Futures REST requests are issued on a bounded pool of connections that outlive
  the request, instead of one connection per request.
- A request that fails on a connection it took from the pool, before any byte of
  a response, is retried once on a connection opened for it — the behaviour the
  pool replaced. Its answer is the retry's answer.
- That fallback is bounded to the failure reuse introduces. Not after a response
  has begun, not on a connection the request opened itself, not on a timeout,
  not on any HTTP status: a request that may have reached the exchange stays an
  indeterminate outcome, which this desk already has a path for.
- The record states when a request had to open a connection and what the opening
  cost, and states a fallback and a failed fallback as distinct causes. A
  request served from the pool records nothing, so a working pool cannot flood
  the record.

## Non-goals

- The spot path is untouched, including the axios `keepAlive: false` at
  `binance-connection.js:909` and the warning attached to it. Futures is where
  the measurement was taken and where the commands are.
- WebSocket connections keep the non-pooling agent. An upgraded socket leaves
  the pool by definition, so reuse would change nothing there.
- Not the order-entry WebSocket API. Once a connection is reused, a REST order
  and a socket order are both one round trip; it would buy latency this change
  has already taken.
- Not the 292 ms of distance to the exchange. That is bought with a host nearer
  to it, not with code.
- No new diagnostic event kind. `timing` and `fault` carry all of this.

## Impact

- `electron/services/futures-trading-adapter.js` — the single request funnel
  (`#request` → `httpsJsonRequest`), the agents it is given, and what it records.
- `electron/services/binance-connection.js` — `resolveProxyAgent` (`:571`) and
  the futures adapter's construction (`:896`). Not the admission queue, not the
  history fan-out.
- Every futures REST caller gets ~305 ms faster, including the history fan-out
  that `keep-the-history-read-out-of-the-way` is working on in the same file.
  Coordinated with the operator before the edit.
- Adds two requirements to `futures-live-readiness` and one to
  `trading-command-integrity`.
- Operator-visible: commands answer in ~425 ms instead of ~730, and the
  thirty-second account beat finishes about a second sooner, so the panels spend
  less time in `loading`.
