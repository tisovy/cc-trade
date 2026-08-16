## 1. Two Lanes Out Of The Main Process

- [x] 1.1 Classify every outbound renderer frame as account traffic or market data at the point it is sent, rather than at the point it is read.
- [x] 1.2 Deliver account traffic — account state, execution reports, symbol configs, command outcomes — without loss and ahead of queued market data.
- [x] 1.3 Make market data latest-wins per resource and per contract: a depth frame waiting behind an unaccepted send is replaced by the newer one rather than both being queued.
- [x] 1.4 Account for what the socket has not accepted, and supersede rather than stack when the queue is behind.
- [x] 1.5 Count superseded and dropped market-data frames per resource, and expose the counts to the diagnostic record rather than dropping silently.
- [x] 1.6 Prove by test that an execution report queued behind a backlog of depth frames is delivered ahead of them.
- [x] 1.7 Prove by test that a burst of depth frames on a stalled socket delivers the newest book and counts the rest as superseded, and that no account frame is ever superseded.
- [x] 1.8 State which resources may be superseded and which may not, rather than superseding all market data. *(Discovered: "latest-wins per resource" is only true of a resource that repeats everything the last frame said. A book, a header, a tape window and a candle series do. A catalog arrives in pages the renderer assembles by offset — drop one and it discards the whole catalog; a history page is the answer to one request; and a status line names a cause the next line does not repeat. Those three are market data that queues, and is never replaced.)*
- [x] 1.9 Supersede the two candle series of a contract independently. *(Discovered: the contract's series and the index series are one resource on one contract, so keying by resource and contract alone made the index series stand in for the chart's own candles. The key carries the series; the record does not, because two series are worth one line between them.)*
- [x] 1.10 Close a renderer that stops draining its account traffic rather than dropping a frame of it. *(Discovered: "without loss" needs a stated end. A renderer that has taken none of thousands of queued account frames is not reading, and the only alternatives are an unbounded queue or a silent hole in its account state. It is closed, and reads the account again on reconnect.)*
- [x] 1.11 Write the record's line when the backlog clears, one per resource, not one per superseded frame. *(Discovered: the case worth recording is a socket blocked for a minute at ten books a second, which is exactly the case where a line per frame would make the record the problem — the record's own byte bound already names this shape as the pathological one.)*
- [x] 1.12 Drop only a frame a newer one could have replaced, never one the renderer is assembling. *(Discovered on the operator's running desk, and the reason it broke: the queue's length bound dropped the oldest market frame whatever it was. The desk sends a catalog as pages of eight contracts — up to a hundred and twenty-eight of them, back to back, and the socket stops accepting bytes a few pages in — and the renderer assembles them by offset, discarding the whole catalog when one is missing. The contract list went empty. Past the bound it is now a replaceable frame that gives way, and if there is none the queue grows to its own stated end. §1.8 named which resources may be superseded; it did not follow that only those may be dropped, and that gap is what reached the desk.)*

- [x] 1.13 Decide a queued frame's removal by that frame, not by the one arriving. *(Discovered by audit, and the same gap as 1.12 seen from the other side: the drop path asked whether a frame may be replaced, the supersede path did not — it matched on resource, contract and series alone. Spot sends a `depth` for a contract under the name the futures workstation uses for its own, and a newer workstation book would have stood in for a Spot book that states it may not be replaced. Reachable only while a market switch is in flight, where the frame it swallows is stale anyway — fixed because the rule has to hold in the code and not in an argument about which markets are open at once. Being superseded and being dropped are one removal, and now ask one question.)*
- [x] 1.14 Send the legacy channel fallback as market data. *(Reassessed after the adjacent chart defect was pointed out: the old "costs the operator nothing" conclusion was wrong. `loadChartHistory` retains its channel id across the exchange read, and its failure path calls `emitToChannel`; if the channel has disappeared by then, the failure answer takes this fallback. That is the answer `keep-the-chart-loadable` relies on to release the renderer's in-flight history lock, so changing it from a channel envelope to the legacy global shape can keep it from the handler rather than making it harmlessly stale. This task fixes the lane half without touching the renderer owned by another session: the legacy envelope is preserved but sent with `marketFrame(type)`, so it is never counted as account traffic or carried ahead of a fill. The regression test makes a history read fail after its channel is removed, blocks the socket, and proves the next account frame drains first. Against archived pre-fix production it fails exactly on that ordering, `expected 5 to be less than 4`; against the fix it passes.)*

## 2. An Event Is Serialized Once

- [x] 2.1 Serialize a workstation event once, measure that string against the byte ceiling, and send the string that was measured.
- [x] 2.2 Keep the refusal behaviour for an event over the ceiling exactly as it is today.
- [x] 2.3 Prove by test that delivering an event performs one serialization, and that an oversized event is still refused.

## 3. An Event Is Parsed Once, At The Boundary

- [x] 3.1 Parse and classify each incoming frame once, at the local socket boundary, and hand subscribers the parsed, typed event instead of the raw frame.
- [x] 3.2 Remove the second parse in `GatewayContext.handleSocketUpdate`; route on the already-parsed value.
- [x] 3.3 Deliver to each subscriber only the event kinds it handles, so the trading hook never receives a depth frame and never parses one.
- [x] 3.4 Keep every subscriber's ownership guards — request id, symbol, generation, revision — working on the typed event exactly as they work today.
- [x] 3.5 Prove by test that a depth frame reaches the workstation subscriber and reaches no account subscriber.
- [x] 3.6 Prove by test that one delivered frame is parsed once, whatever the number of subscribers.
- [x] 3.7 Do not lose a frame that merely names the workstation channel. *(Discovered: the cheap text sniff that decides whether to read a frame under the workstation's rules matches any frame containing the channel's name — and a command rejection about the channel carries that name in its `request` field. Reading it strictly and dropping it on failure would have swallowed the one frame that says why the workstation would not open. It falls through and is read as what it is.)*
- [x] 3.8 Stop normalizing every frame for a reader that does not exist. *(Discovered: the socket hook ran `normalizeMessage` over every parsed frame and passed the result to the gateway, which passed it to its listeners, whose only listener ignores it. A pass over every frame, ten times a second, for a value nothing reads.)*
- [x] 3.9 State where a second reading of a frame remains. *(Discovered: the Spot context's legacy branch still calls `parseData(event.data, …)`, which takes the frame's text and answers a shape that context builds from. It is mounted in the Spot workspace only, so it is not on the futures desk's path at all; untangling it is Spot's own change and is named here rather than left for the next reader to find.)*

## 4. The Parse Runs At The Platform's Speed

- [x] 4.1 Replace `parseBoundedFuturesWorkstationJson` with the platform parser at ~~both call sites — the renderer's workstation events and the main process's upstream stream frames~~ the local protocol's two call sites: the renderer's workstation events and the main process's reading of renderer requests. See 4.8 for why the upstream frames keep their own reading.
- [x] 4.2 Keep the byte ceiling enforced before parsing, so an unbounded frame is still refused without being read.
- [x] 4.3 Keep every structural validator unchanged — exact keys, canonical decimals, identities, timestamps, level counts — since that is what rejects a malformed or hostile payload.
- [x] 4.4 Keep lone-surrogate rejection wherever a value survives validation as free text; state where that is, rather than assuming the decimal and identity patterns cover it. It is three fields: a contract's `contractType` and `status`, and a header's `contractStatus` — the exchange's own words, whose only rule is a length. Every other string the rules accept is spelled by a pattern, and no pattern here can spell half a surrogate pair.
- [x] 4.5 Retire the node budget as a derived bound, or state what it still protects against once the byte ceiling and the validators are both in place. Retired for the local protocol: what it protected against was an unbounded parse, and the byte ceiling bounds that before a frame is read. The upstream parser keeps its own, with its own reading.
- [x] 4.6 Run `/security-review` on this section specifically, and record the outcome in this change before it lands. ~~The operator runs it;~~ run by the session on 2026-08-16 at the operator's direction, against 4.8 and 4.9 as the stated list. Outcome recorded below: **no HIGH or MEDIUM finding, and one correction to 4.9's argument that is worth more than the review was expected to produce.**
- [x] 4.7 Prove by test that every payload the bounded parser refused is still refused, using the existing parser rejection cases — except the three in 4.9, which are proven to be *accepted* instead, so the change is weighed rather than discovered.
- [x] 4.8 Keep the upstream parser, and state why it cannot be the platform's. *(Discovered: it does not answer numbers at all. It answers an integer as a token holding its exact digits, and `readFuturesWorkstationIdentity` validates that against the full uint64 range — because Binance's depth sequence numbers are uint64 and the whole bridge from snapshot to diff is an exact comparison of them. `JSON.parse` would round anything past 2^53 to a number that is close, and the book would bridge against an identity the exchange never sent. That is a silent corruption of the one thing the order book is built on, so the upstream reading stays as it is.)*
- [x] 4.9 State every refusal given up, rather than claiming equivalence. *(Discovered while proving 4.7. Three refusals of **notation** are gone: a duplicate key is no longer refused — the last value stands and it is the one validated; an integer written in exponent form is read as the integer it denotes; and an integer past what a JavaScript number holds exactly is rounded rather than refused. None of the three changes what a validated frame *means*, all three are on the loopback socket that carries the desk's own frames between its own two halves behind a session token, and the one place the distinction has teeth — exact wide integers — is on the upstream path, which kept its parser. This is the list `/security-review` should be run against.)*

### The security review of §4, run 2026-08-16

Run against `5881142` alone — the commit that is §4 — rather than against the
working tree, which holds another session's changes. Every claim below was
measured by running the module, and every "before" by running the same probe
against `git archive 5881142^`, not by reading the diff.

**No HIGH or MEDIUM security finding.** The threat model §4 argues from holds:
the local protocol's two call sites sit behind a WebSocket bound to 127.0.0.1
(`local-websocket-access.js:4`), token-gated with a 401 that closes the socket
(`binance-connection.js:2505`), and capped at 16 KiB inbound by the transport
before the protocol's own ceiling is reached (`binance-connection.js:115`).
Three specific attacks were looked for and none of them lands:

- **Prototype pollution / prototype confusion**, the obvious consequence of
  giving up `Object.create(null)` for `JSON.parse`. Refuted by measurement: a
  `"__proto__"` key becomes an *own* data property, `Object.prototype` is
  untouched, and `hasExactFuturesWorkstationKeys` — which runs on `Object.keys`,
  own-enumerable only — then rejects it as an unexpected key. The two places a
  parsed value is used as a computed key (`event.resource` at line 993,
  `event.payload.series` at line 987) are both gated on fixed enums first. The
  old parser's null prototype was never load-bearing: the validators did not
  check the prototype before the change either.
- **A lone surrogate reaching a field that is only length-bounded.** 4.4's claim
  that this is exactly three fields — `contractType`, `status`, `contractStatus`
  — was audited field by field and **confirmed**; there is no fourth. The
  `u`-flag `\p{Lu}\p{Lt}\p{Lo}\p{N}` patterns were run against `\uD800` and
  refuse it (a lone surrogate is category `Cs`), and every other pattern is
  ASCII-only.
- **A number surviving where an integer is meant.** Every one of the twenty
  numeric fields is `Number.isSafeInteger`-guarded, directly or through
  `isSafeTimestamp`/`isPositiveSafeInteger`. A float or a wide integer is refused
  by the validator that owns the field.

**The correction, and it is the review's actual product: 4.9's list is right and
4.9's argument is wrong.** 4.9 says the three given-up refusals "None of the
three changes what a validated frame *means*", because meaning is the
validators' business. That is true of every field the validators type-check —
and `requestId` is not one of them. Both call sites read it as

```js
!REQUEST_ID_PATTERN.test(value.requestId ?? '')     // lines 654 and 788
```

with no `typeof === 'string'` beside it, alone among the eleven `.test(` sites in
the file. `RegExp.prototype.test` coerces, and `??` only intercepts null and
undefined. Measured, the same frame before and after `5881142`:

| `requestId` on the wire | before §4 | after §4 |
| --- | --- | --- |
| `"r1"` | accepted, string | accepted, string |
| `12345` | accepted, **number** | accepted, number |
| `true` | accepted, **boolean** | accepted, boolean |
| `[1]` | accepted, **array** | accepted, array |
| `1e2` | refused `INVALID_JSON_NUMBER` | **accepted as `100`** |
| `100000000000000000000` | refused `UNSAFE_JSON_INTEGER` | **accepted** |
| `9007199254740993` | refused `UNSAFE_JSON_INTEGER` | **accepted, stored as `9007199254740992`** |

Two things separate here, and both matter:

- **The type hole is older than this change.** A `requestId` of `12345`, `true`
  or `[1]` was accepted before §4 and is accepted after. §4 did not open it, and
  a review of §4 does not close it.
- **§4 widened what reaches it, and the last row has teeth.** A request whose id
  is `9007199254740993` used to be refused outright; it is now accepted under an
  id the sender never wrote. `requestId` is the session ownership key — eleven
  strict comparisons of the form `session.requestId !== request.requestId`
  (`futures-production-workstation-service.js:329,364,394,404,460,611,670,1802`
  and `useFuturesProductionWorkstation.js:403,440`) — so any two integers past
  2^53 that round to the same double now share one identity. *That* is a change
  in what a validated frame means, and 4.9 states the row without noticing it.

Not raised to a finding, and the reason stated rather than assumed: the only
party that can send a request is the desk's own renderer, behind the session
token, and it sends string ids (`f-msvhaj6h-fpezm8wh`). Nothing reaches this from
outside the desk. It is a hole the boundary keeps shut, not a hole in the
boundary — worth a `typeof value.requestId === 'string'` on lines 654 and 788,
which costs nothing and is not §4's to spend. **Raised as its own defect rather
than fixed here, because §4 is closed and this predates it.**

**One stale comment §4 left behind.** `utf8Length` (line 268) still says "Lone
surrogates are counted as if paired; hasOnlyUnicodeScalars rejects them on the
same expression, so the value never survives the miscount." §4 removed that
`hasOnlyUnicodeScalars(text)` from the same expression, so the sentence is now
false. Measured, the miscount is a factor of 1.5 — a 2000-unit string of lone
high surrogates counts as 4000 bytes against a 6000-byte truth — which would let
a frame past the ceiling by half again. Unreachable in the deployed shape: a
WebSocket text frame is UTF-8-decoded by the transport, so a lone surrogate
cannot arrive over either socket, and only an in-process caller could produce
one. Recorded because the comment asserts a guard that is gone, and the next
reader will believe it.

## 5. Verification

- [x] 5.1 Re-measure the renderer's per-frame parse-and-validate cost and the main process's per-frame outbound cost, and record before and after. Recorded below.
- [x] 5.2 Measure the delay from an execution report arriving at the main process to the trading hook applying it, with a depth backlog present and without one. Recorded below.
- [x] 5.3 `npm run lint`, `npm test` (1557 passed), `npm run check:futures-production`.
- [x] 5.4 **Confirmed by the operator on live data, 2026-08-16:** "the price crossing on the chart really does remove the orders — it works as it should; I had several orders standing and they all filled at once." On a real move, not a staged one. It agrees with the record from the same run: a BUY LIMIT on HEMIUSDT left at 14:43:17.7 and the position was open by 14:43:19 — the count of compared positions went from one to two and stayed there. Operator confirms on live data that a fill on a liquid contract leaves the working-orders list and the chart promptly during a fast move, not after it — step 31, «Исполнение впереди рыночных данных», in `verify-the-desk-in-one-sitting/runbook.md`, so the operator runs one list. It is the one step whose whole premise is a fast move, so it is the one step the operator may have to wait for rather than stage.

### Measured

One delivered book at the exchange's own precision — a thousand levels a side,
88.3 KiB on the wire. The repository at 799931d, copied out with `git archive`,
against the working tree; each side driven through its own code, on the same
frame, with the same clock. Sections 1 to 3 only; section 4 is not in these
numbers.

| | before | after §1–3 | after §4 |
| --- | --- | --- | --- |
| Renderer, reading one delivered frame | 2.956 ms | 1.920 ms | **0.736 ms** |
| Main process, putting one event on the wire | 0.272 ms | **0.141 ms** | 0.141 ms |

The renderer's before is four readings of the same bytes — the socket hook
parsing and normalizing, the gateway parsing, the trading hook parsing, the
workstation parsing and validating. After section 3 it is one reading, and after
section 4 that one reading is the platform's parser rather than a JSON parser
written out by hand a character at a time. Four times less work per frame than
the desk was doing, on the path the operator reads the market through.

And the delay the change is actually for — a fill issued into a one-second
backlog on a socket that has stopped accepting bytes, at the exchange's measured
ten books a second:

| | before | after |
| --- | --- | --- |
| Books written ahead of the fill | 10 | **0** |
| Bytes written ahead of the fill | 0.86 MiB | **0** |
| Renderer reading spent before the fill is read | 29.6 ms | **0 ms** |

Before, the fill left the desk behind every book produced during the burst and
the renderer read every one of them before reaching it. After, the fill is
written first and the ten books collapse to the one that is still true.
