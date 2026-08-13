## 0. Decide The Shape Before Moving Code

- [x] 0.1 Record what one held session costs: frames per second per stream on a liquid contract, bytes, and the parse time of each, so the pool bound is chosen from a number. Measured 2026-08-13 on the live public streams through the operator's own proxy, parsed with the desk's own `normalizeFuturesWorkstationStreamFrame`. 60 s, BTCUSDT and ETHUSDT; per-second peaks over a separate 90 s run on BTCUSDT, ETHUSDT and SOLUSDT.

  BTCUSDT, one full session as the service opens it today:

  | stream | fps mean | fps p95 | fps max | KiB/s mean | KiB/s peak sec | avg frame | max frame | parse | ms/s parse |
  |---|---|---|---|---|---|---|---|---|---|
  | `@depth@100ms` | 9.57 | 10 | 10 | 24.65 | 82.17 | 2 638 B | 21 067 B | 270.8 µs | 2.59 |
  | `@aggTrade` | 13.28 | 44 | 115 | 2.65 | 23.02 | 205 B | 207 B | 35.5 µs | 0.47 |
  | `@kline_1m` | 2.23 | — | — | 0.75 | — | 345 B | 346 B | 84.7 µs | 0.19 |
  | `@markPrice@1s` | 0.97 | 2 | 2 | 0.21 | 0.44 | 223 B | 223 B | 62.7 µs | 0.06 |
  | `@ticker` | 0.48 | 1 | 1 | 0.16 | 0.33 | 336 B | 336 B | 78.4 µs | 0.04 |
  | **total** | **26.5** | | | **28.42** | | | | | **3.35** |

  ETHUSDT is within 25% of this on every line; SOLUSDT's depth is 9.83 KiB/s peak against BTCUSDT's 82.17, so BTCUSDT is the right contract to size the pool from.

- [x] 0.4 State which stream is actually the bursty one, because the answer decides what §2.3 sheds and how. *(It is not depth. `@depth@100ms` is rate-capped by its own subscription — p50 = p95 = max = 10 fps, peak/mean 1.04 — and bursts in frame **size**: 24.65 → 82.17 KiB/s, 3.3×, with a single frame reaching 21 067 B against a 2 638 B average. `@aggTrade` is the opposite: frames are a fixed 205 B and the **rate** is unbounded — p50 4, p95 44, max 115 fps, peak/mean 9.9×. So the two need different mechanisms, which is what §2.3 already says: depth is coalesced to one book per frame, the tape is dropped on overflow. Sizing either by its mean would have been wrong in a different direction.)*

- [x] 0.2 Decide the first shipped bound and state why. **Two.** Cost of the pool at the background shape chosen in 0.3 and 0.7, over today's single session:

  | bound | KiB/s | vs today | ms/s parse | vs today | sockets |
  |---|---|---|---|---|---|
  | 1 (today) | 28.42 | — | 3.35 | — | 3 |
  | 2 | 29.54 | +3.9% | 3.64 | +8.7% | 6 |
  | 4 | 31.78 | +11.8% | 4.22 | +26.0% | 10 |
  | 6 | 34.02 | +19.7% | 4.80 | +43.3% | 14 |

  Neither bytes nor parse is what stops this: at six held contracts the desk is still under 35 KiB/s and 5 ms of parse per second. What stops it is **sockets** — fourteen at bound 6 against three today, each on Binance's 24-hour rotation, and every rotation is a `CONNECTION_ROTATED` resync. More held contracts would buy warmth by manufacturing more of the interruptions this change exists to remove. Two covers the switch the operator makes most (back to the contract just left), the machinery is identical at any bound, and §3.2 makes the bound a setting — so raising it later is a config change with a known cost per step of about +1.12 KiB/s, +0.29 ms/s and 2 sockets.

  Counts assume the shown session at four sockets (depth, tape, mark-and-ticker, candles — the tape split off per 0.6) and each background session at two.

- [x] 0.3 Decide what a background session subscribes to, and state what it costs to promote it to shown. **A background session holds `@markPrice@1s`, `@ticker` and `@kline_<interval>` and nothing else. On promotion it opens the `/public/stream` depth socket and the `@aggTrade` socket, then bootstraps the book.** That is shape A — see 0.7 for why not B, which is faster and was the first choice.

  | background shape | KiB/s | ms/s parse | sockets | to a covered book on promotion |
  |---|---|---|---|---|
  | background shape | KiB/s | ms/s parse | sockets | to a covered book on promotion | new machinery |
  |---|---|---|---|---|---|
  | **A. drop depth entirely, open the socket on promotion** | **1.12** | **0.29** | **2** | socket open 1 266 ms + snapshot 968 ms ≈ **2.23 s** | **none** |
  | B. hold a `/public/stream` socket on a cheap stream, `SUBSCRIBE` depth on promotion | 1.28 | 0.33 | 3 | subscribe 459 ms + snapshot 968 ms ≈ **1.43 s** | first exchange-facing control frame |
  | C. hold depth subscribed, do not parse it | 25.77 | 0.29 | 3 | snapshot 968 ms ≈ **0.97 s** | none |
  | D. hold depth and maintain the book | 25.77 | 2.88 | 3 | **0 s** | none |

  D is 91% of a shown session and defeats the premise. C pays 23× A's bytes to save 1.26 s and would have a background contract carrying the one stream whose volume is unbounded. A and B are the real candidates, and A ships — see 0.7.

  The two latencies are measured through the operator's own proxy, not a stand: a `/fapi/v1/depth?limit=1000` snapshot is 41.1 KiB and **968 ms median** (872–987, n=5), and opening a WebSocket is **1 266 ms median** (1 231–1 311, n=4). The socket open is the dominant term — which is what makes B tempting.

  **The snapshot cannot be started in parallel with opening the stream.** It is serial by construction, not by oversight: the book bridges the snapshot's `lastUpdateId` to the diff stream by exact sequence number, so diffs must already be buffering before the snapshot is taken. `futures-production-workstation-service.js:823` already says so. A future reader looking to shave the 2.23 s must not shave it there.

  What the operator gets on switching back, stated plainly rather than as "immediate": chart, last price, mark, ticker and the position's PnL are on screen at once, because they were never dropped; the book arrives about 2.2 s later carrying its own state, which is the per-panel state `hold-the-book-through-a-spike` already introduced. Today the same switch puts the whole workspace through `loading` for the full bootstrap and every REST read in it.

- [x] 0.7 Choose between A and B, and record why the faster one is not the one shipping. **A ships; B is measured, correct and available.** B is 0.80 s faster to a covered book. What it costs is not the third socket — it is that **the desk sends no control frame to Binance anywhere today**. Checked rather than assumed: every `SUBSCRIBE`/`UNSUBSCRIBE` in the tree is the desk's own renderer↔service protocol action (`futuresProductionWorkstationProtocol.js:20,26`), the workstation opens three sockets with their streams in the query (`transport.js:698,699,733`), and the mark-price feed changes its symbol set by **recreating the socket** on a new URL (`futures-mark-price-feed.js:213`) rather than by subscribing. So B does not reuse an existing mechanism; it introduces the first one of its kind, on the exact route pair whose neighbour is measured in 0.5 to acknowledge and silently deliver nothing.

  That is the wrong thing to introduce in the same change that first makes sessions plural. A needs no new transport behaviour at all: it opens a socket the service already knows how to open. B becomes worth revisiting when the operator says 2.2 s to the book is too slow — at that point the pool itself does not change, only the transport, and the guard it needs is already written down in 0.5 and 6.3.

- [x] 0.5 Measure whether a stream can be added to a live socket at all, before designing promotion around it. **It can — but not on every route, and the failure is silent.** Measured through the proxy, `SUBSCRIBE` sent on an already-open connection:

  | route | stream added | ack | first frame |
  |---|---|---|---|
  | `/market/stream` | `@aggTrade` | 371 ms | 378 ms |
  | `/public/stream` | `@depth@100ms` | 370 ms | 459 ms |
  | `/stream` (Binance's own) | `@depth@100ms` | 362 ms | 427 ms |
  | `/market/stream` | `@depth@100ms` | 383 ms / 430 ms | **never — 10 s, twice** |

  `SUBSCRIBE` for the depth diff on the `/market/stream` route is acknowledged and then never delivered — while the ticker on that same socket keeps arriving, so the connection is plainly alive and it is the added stream that is dropped. Nothing errors and the ack says yes, so the book would stay empty for the life of the session.

  **This is not reachable today, and that is the point.** Per 0.7 the desk sends no control frame to Binance at all, so the pair cannot occur under the current transport. The measurement is a guard against the future, and specifically against the one optimization anybody would reach for here — "hold fewer sockets, subscribe on the one that is open". It is the third form of the same lie the session on `prove-the-private-stream-is-carrying` has been cataloguing: a retired route that answers the handshake (§1, closed), an open socket that carries nothing (§2), and now an acknowledged subscription that delivers nothing. In all three the healthy-looking signal is the wrong one to trust, and the only sound signal is a frame the exchange sent on its own.

- [x] 0.6 Decide whether the tape stays on the shared market socket. **It moves off it.** Today `@aggTrade`, `@markPrice@1s` and `@ticker` share one connection (`transport.js:699`), so the tape cannot be dropped for a background contract without dropping the mark price and the ticker with it — which is precisely what a held session is for. Splitting `@aggTrade` onto its own socket costs one connection on the shown session. The steady-state saving is small and should not be claimed as the reason: 2.65 KiB/s. The reason is 0.4 — the tape is the one stream whose rate is unbounded, and a background contract would otherwise pay up to 115 frames a second for a tape nobody is reading.

## 1. A Session Stops Being The Service

- [ ] 1.1 Hold sessions in a map keyed by contract, with the shown contract named separately from the set held.
- [ ] 1.2 Replace `isCurrent(session)` with ownership by that session's own identity, so a callback of one session cannot be silenced by another being shown.
- [ ] 1.3 Route every timer, abort controller and pending queue through the session that owns it.
- [ ] 1.4 Prove by test that two sessions run at once, and that stopping one leaves the other delivering.

## 2. Selecting Is Not Subscribing

- [ ] 2.1 Deliver the held state of a selected contract immediately, without a `loading` status and without re-reading what it already holds. Per §0.3 this covers the chart, the last price, the mark, the ticker and the position's PnL — everything a background session never dropped. The book is the one panel that is not instant, and it says so in its own state rather than holding the workspace in `loading`.
- [ ] 2.2 On promotion, open the `/public/stream` depth socket and the `@aggTrade` socket, then bootstrap the book; close both on demotion. Per §0.7 promotion opens a connection rather than subscribing on a held one: the desk sends no control frame to Binance today, and introducing the first one belongs in its own change rather than in the one that first makes sessions plural. Per §0.3 the snapshot follows the socket rather than running beside it, because the book bridges it by exact sequence number — that ordering is correctness, not latency, and must survive any later optimization.
- [ ] 2.3 Shed rather than queue under load on the shown contract: coalesce depth deliveries to at most one book per frame and drop the tape's overflow, so a burst costs the book's freshness and never the price. Per §0.4 these are two mechanisms for two different bursts, and neither substitutes for the other: depth is fixed at 10 fps and swells in frame size (2 638 B average, 21 067 B peak), the tape is a fixed 205 B and swells in rate (4 → 115 fps).
- [ ] 2.4 Keep the renderer's ownership checks intact: a frame still names the request and the generation it belongs to.
- [ ] 2.5 Prove by test that returning to a held contract issues no bootstrap read and passes through no `loading`, and that the book's own state — not the workspace's — is what carries the promotion.
- [ ] 2.6 Split `@aggTrade` off the shared market socket, per §0.6, so a background session can keep the mark price and the ticker without the tape.

## 3. The Pool Is Bounded

- [ ] 3.1 Release the least recently shown session when the bound is reached, in full, through the same total release the switch uses.
- [ ] 3.2 Make the bound a stated setting rather than a constant buried in the service.
- [ ] 3.3 Prove by test that the bound holds under a long sequence of selections and that nothing is left running behind it.

## 4. Failure Is Local

- [ ] 4.1 Scope a resync, a refused frame and a lost socket to the session they happened on.
- [ ] 4.2 Prove by test that a background session's failure is invisible to the shown contract.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `check:circular`, `check:runtime-mock`.
- [ ] 5.2 Measure the switch: time from selection to a live desk, held versus unheld, and record both.
- [ ] 5.3 Operator confirms on live data: switching back to the contract just left is immediate, switching to a new one is no worse than today, and neither flickers between contracts.

## 6. Stated Limits, Not Fixed Here

- [ ] 6.1 The trading path is untouched: it never depended on which contract is shown, and account state is account-wide already.
- [ ] 6.3 The route split is load-bearing and is not consolidated here. State it as the prohibition rather than as the arrangement, because only the prohibition survives a refactor: **depth is carried by its own `/public/stream` socket, and a depth subscription added to a live `/market/stream` socket is acknowledged and then silently never delivered** (§0.5, measured twice). Saying only "depth lives on `/public/stream`" reads as a placement someone is free to tidy up. Any later change that merges the routes, or that adds a stream to a socket instead of opening one, has to re-measure delivery — not the acknowledgement — first.
- [ ] 6.2 Whether the renderer keeps up when a held contract is promoted during a burst belongs to `stop-rebuilding-the-desk-on-every-tick`.
