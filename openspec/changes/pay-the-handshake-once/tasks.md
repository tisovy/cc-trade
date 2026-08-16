## 0. Measured First

Taken 2026-08-16 07:26–07:34 UTC from this machine, through the desk's own proxy
(`127.0.0.1:1080`), while the desk was running. Nothing here is from
documentation.

- **A request that opens its own connection costs 630 ms; the same request on a
  connection already open costs 325 ms.** `curl` against
  `https://fapi.binance.com/fapi/v1/ping`, five cold runs 627 / 631 / 644 / 630 /
  680 ms, and five on one reused connection 632 (the first, which opened it) /
  324 / 326 / 326 / 324 ms. The warm figure has 2 ms of spread across four
  samples, so the ~305 ms difference is the handshake and nothing else.
- **The proxy is not the cost.** The same measurement with no proxy: 443 ms cold,
  292 ms warm. The proxy adds 33 ms per round trip; the other 292 ms is distance
  to the exchange and is not addressable here.
- **The desk pays the cold price on every command.** Record for 2026-08-16,
  session 07:19:46, four commands the operator issued by hand on ACEUSDT:
  `trade.replaceOrder` 729 ms, `trade.placeOrder` 739 ms, `trade.placeOrder`
  729 ms, `trade.cancelOrder` 719 ms. 630 for the connection and the round trip,
  ~100 for the exchange placing the order.
- **Confirmed on the wire, not only in the source.** Sampling `ss -tnp` for the
  desk's pid twice a second for 30 s: a steady 20 connections to the proxy — the
  streams — rising to 21 then 24 on the thirty-second account beat and back to 20
  within 1.5 s. Four resources read, four connections opened and discarded.
- **Cause.** `resolveProxyAgent` (`binance-connection.js:571`) constructs
  `new SocksProxyAgent(proxyUrl)` with no options; `http.Agent` defaults
  `keepAlive: false`. Every futures REST caller inherits it, because
  `FuturesTradingAdapter` funnels all of them through one `#request`
  (`futures-trading-adapter.js:804`) into one `httpsJsonRequest` (`:90`).
- **Precedent in this repository.**
  `futures-production-workstation-transport.js:196` already builds the same agent
  from the same library version (socks-proxy-agent 8.0.5) with `keepAlive: true`,
  `maxSockets: 8`, `maxFreeSockets: 2`.
- **The argument on the other side belongs to a different mechanism.**
  `binance-connection.js:909` carries `keepAlive: false, // Disable keepAlive to
  avoid axios agent issues`. That is the Spot SDK's own flag over axios. This
  change does not touch the spot path.

## 1. Reuse

- [x] 1.1 Give `futures-trading-adapter.js` one exported pool definition
  (`keepAlive`, `maxSockets`, `maxFreeSockets`) with the measurement above beside
  it, so the numbers that justify it live where it is defined.
- [x] 1.2 Teach `resolveProxyAgent` to build a pooling agent on request, leaving
  its current no-argument behaviour exactly as it is for the WebSocket and spot
  callers.
- [x] 1.3 Construct two agents where the futures adapter is built: the pooling
  one it issues requests on, and the non-pooling one the fallback uses. Pass both
  to `FuturesTradingAdapter`.
- [x] 1.4 With no proxy configured, use the adapter's own pooled and non-pooled
  agents rather than Node's global agent, so the fallback exists on that route
  too and the behaviour is the same one the tests describe.
- [x] 1.5 **Proved on the wire, through the desk's own proxy, at 2026-08-16
  07:55 UTC.** `prove-connection-reuse.mjs` in the session scratchpad builds the
  agent exactly as `resolveProxyAgent(FUTURES_REST_CONNECTION_POOL)` does and
  issues four requests on it and two on an agent built the old way:

  | request | `reusedSocket` | answered in |
  |---|---|---|
  | pooled #1 | false | 785.6 ms |
  | pooled #2 | **true** | 379.3 ms |
  | pooled #3 | **true** | 374.7 ms |
  | pooled #4 | **true** | 374.8 ms |
  | no-reuse #1 | false | 762.7 ms |
  | no-reuse #2 | false | 757.4 ms |

  Node reports the reuse itself, so this is the pool working and not an
  inference from a faster answer. The agent built the old way never reused
  anything, which is the behaviour being replaced. The absolute numbers are
  higher than §0's `curl` figures — 763 against 630, 375 against 325 — because
  the route was slower at that hour and Node's SOCKS path adds its own tens of
  milliseconds; the saving is the same ~390 ms either way.

## 2. Fallback

- [x] 2.1 In `httpsJsonRequest`, retry once on the non-pooling agent when — and
  only when — the request was served from the pool, no byte of a response has
  arrived, and the failure is a connection-level reset or broken pipe. The three
  conditions are read from `request.reusedSocket`, a flag set the moment the
  response callback runs, and `CONNECTION_LOST_BEFORE_ANSWER`.
- [x] 2.2 Fail with the retry's error when the retry fails, and never with the
  first error, so the record and the operator see the failure that actually ended
  the request.
- [x] 2.3 Do not retry: a timeout, any HTTP status, a failure after a response has
  begun, or a failure on a connection the request opened itself. Each of those
  keeps the behaviour it has today, including the `indeterminate` marking on 5xx.
  The permission is carried on a module-private `Symbol`, so no caller outside
  the transport can grant itself a second attempt.
- [x] 2.4 Compose the retry from the request as first sent, identity included, so
  a duplicate that arises any other way is refused by the exchange rather than
  filled. Asserted as byte equality of the two bodies, which covers the
  signature and the client order id together.

## 3. Record

- [x] 3.1 Record `timing` with a phase naming the connection opening, the cost of
  the request that had to open one, and `cache: 'miss'` — only for requests that
  were not served from the pool. Phase `futures-rest-unpooled`, which the
  existing reader already groups and medians without a change to it.
- [x] 3.2 Record `fault` for the fallback, and a distinct `fault` code for a
  fallback that itself failed: `futures-rest` / `CONNECTION_REUSE_FALLBACK` and
  `CONNECTION_REUSE_FALLBACK_FAILED`.
- [x] 3.3 Record nothing per request for requests served from the pool, so the
  working case cannot fill the record during a history sweep.
- [x] 3.4 Wire the recorder in from `binance-connection.js`, where the adapter is
  constructed, and default it to recording nothing so the adapter stays usable
  without a record.

## 4. Proof

- [x] 4.1 Tests for §2's rule, each one stated as what the exchange can have
  seen: retried on a pooled reset, not retried on a fresh-connection reset, not
  retried after a response byte, not retried on a timeout, not retried on 5xx.
  The mock now answers per attempt, so a first attempt can fail on a pooled
  connection and a second be answered on its own.
- [x] 4.2 A test that the answer of a successful retry is the caller's answer,
  and that a failed retry's error is the one that reaches the caller.
- [x] 4.3 Tests for §3's lines: the miss line and its cost, the two fault codes,
  and nothing at all for a pooled request.
- [x] 4.4 A test that asserts the agent is constructed with reuse on and the
  bounds set — the option object, not the behaviour behind it. In
  `binance-connection.test.js`, on the options the futures adapter is actually
  handed.
- [x] 4.5 **Ten new tests run against the pre-change tree (`git archive HEAD` into
  a copy, never the working tree). Five bit, five are guards, and every guard was
  proved by mutation.**

  Bit immediately — the capability did not exist: the pool bounds, the retry on a
  pooled reset, the retry's failure reaching the caller, the cost of an opening,
  and an opening that failed.

  Guards, and the mutation each one killed:

  | guard | mutation applied to the new code | killed |
  |---|---|---|
  | does not send a timed-out request again | add `ETIMEDOUT` to `CONNECTION_LOST_BEFORE_ANSWER` | yes |
  | does not send again once the answer has begun | drop `&& !answering` | yes |
  | does not send again when the request opened the connection itself | drop `request.reusedSocket &&` | yes |
  | does not send a 5xx again | also retry when `failure.status >= 500` | yes |
  | says nothing for a request served from the pool | record regardless of `reusedSocket` | yes |

  They cannot bite on the pre-change tree because nothing retried anything and
  nothing was recorded — a "must not" cannot fail where the capability is
  absent. Mutations were run in a third copy of the tree, so no mutated code
  was ever on the path the desk runs from.
- [x] 4.6 Full gate, in the working tree after the change was applied to it:
  lint clean, **2030 tests in 111 files passing** (2018 before, plus these 12),
  circular-import, runtime-mock, futures-workstation-boundary and
  trading-command-path checks all passing, `openspec validate --strict` valid.

## 5. Live

- [x] 5.1 Handed to `verify-the-desk-in-one-sitting` as **Шаг 51**, in Russian,
  carrying the four before-numbers to compare against, the two greps that say
  whether the pool is being used and whether the fallback fired, and what each
  answer means. Unchecked there, and not to be marked by the session that wrote
  it.
- [ ] 5.2 Report the before-and-after to the operator from the record rather than
  from a claim: the command durations of the 07:19:46 session against the first
  session running this change. Open until the desk runs it — it was stopped at
  2026-08-16 07:57:43 UTC, before this change reached the tree, so no session
  has run this code yet.
