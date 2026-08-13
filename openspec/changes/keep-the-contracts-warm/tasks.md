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

- [x] 0.2 Decide the first shipped bound and state why. **Two.** Cost of the pool at shape B below, over today's single session:

  | bound | KiB/s | vs today | ms/s parse | vs today | sockets |
  |---|---|---|---|---|---|
  | 1 (today) | 28.42 | — | 3.35 | — | 3 |
  | 2 | 29.70 | +4.5% | 3.68 | +9.9% | 7 |
  | 4 | 32.26 | +13.5% | 4.34 | +29.6% | 13 |
  | 6 | 34.82 | +22.5% | 5.00 | +49.3% | 19 |

  Neither bytes nor parse is what stops this: at six held contracts the desk is still under 35 KiB/s and 5 ms of parse per second. What stops it is **sockets** — nineteen at bound 6, each on Binance's 24-hour rotation, and every rotation is a `CONNECTION_ROTATED` resync. More held contracts would buy warmth by manufacturing more of the interruptions this change exists to remove. Two covers the switch the operator makes most (back to the contract just left), the machinery is identical at any bound, and §3.2 makes the bound a setting — so raising it later is a config change with a known cost per step of about +1.28 KiB/s, +0.33 ms/s and 3 sockets.

- [x] 0.3 Decide what a background session subscribes to, and state what it costs to promote it to shown. **A background session holds `@markPrice@1s`, `@ticker` and `@kline_<interval>`, and holds its `/public/stream` socket open on a cheap stream so the depth diff can be added to it by `SUBSCRIBE` rather than by opening a connection.** That is shape B:

  | background shape | KiB/s | ms/s parse | sockets | to a covered book on promotion |
  |---|---|---|---|---|
  | A. drop depth entirely, open the socket on promotion | 1.12 | 0.29 | 2 | socket open 1 266 ms + snapshot 968 ms ≈ **2.23 s** |
  | **B. hold the depth socket on a cheap stream, `SUBSCRIBE` on promotion** | **1.28** | **0.33** | **3** | subscribe 459 ms + snapshot 968 ms ≈ **1.43 s** |
  | C. hold depth subscribed, do not parse it | 25.77 | 0.29 | 3 | snapshot 968 ms ≈ **0.97 s** |
  | D. hold depth and maintain the book | 25.77 | 2.88 | 3 | **0 s** |

  D is 91% of a shown session and defeats the premise. C pays 23× B's bytes to save 0.46 s. B costs 4.5% of a shown session's bytes and 9.9% of its parse.

  The two latencies are measured through the operator's own proxy, not a stand: a `/fapi/v1/depth?limit=1000` snapshot is 41.1 KiB and **968 ms median** (872–987, n=5), and opening a WebSocket is **1 266 ms median** (1 231–1 311, n=4). The socket open is the dominant term, which is why B exists at all.

  **The snapshot cannot be started in parallel with the subscription.** It is serial by construction, not by oversight: the book bridges the snapshot's `lastUpdateId` to the diff stream by exact sequence number, so diffs must already be buffering before the snapshot is taken. `futures-production-workstation-service.js:823` already says so. A future reader looking to shave the 1.43 s must not shave it there.

  What the operator gets on switching back, stated plainly rather than as "immediate": chart, last price, mark, ticker and the position's PnL are on screen at once, because they were never dropped; the book arrives about 1.4 s later carrying its own state, which is the per-panel state `hold-the-book-through-a-spike` already introduced. Today the same switch puts the whole workspace through `loading` for the full bootstrap.

- [x] 0.5 Measure whether a stream can be added to a live socket at all, before designing promotion around it. **It can — but not on every route, and the failure is silent.** Measured through the proxy, `SUBSCRIBE` sent on an already-open connection:

  | route | stream added | ack | first frame |
  |---|---|---|---|
  | `/market/stream` | `@aggTrade` | 371 ms | 378 ms |
  | `/public/stream` | `@depth@100ms` | 370 ms | 459 ms |
  | `/stream` (Binance's own) | `@depth@100ms` | 362 ms | 427 ms |
  | `/market/stream` | `@depth@100ms` | 383 ms / 430 ms | **never — 10 s, twice** |

  `SUBSCRIBE` for the depth diff on the `/market/stream` route is acknowledged and then never delivered. Nothing errors, the ack says yes, and the book would stay empty for the life of the session. This is the same failure class the session on `prove-the-private-stream-is-carrying` measured on a retired route — a route that answers and goes silent — and it is why promotion is built on `/public/stream`, which is where the service already puts depth (`futures-production-workstation-transport.js:698`). The existing route split turns out to be load-bearing rather than cosmetic, so §1–§4 must not consolidate the sockets by route.

- [x] 0.6 Decide whether the tape stays on the shared market socket. **It moves off it.** Today `@aggTrade`, `@markPrice@1s` and `@ticker` share one connection (`transport.js:699`), so the tape cannot be dropped for a background contract without dropping the mark price and the ticker with it — which is precisely what a held session is for. Splitting `@aggTrade` onto its own socket costs one connection on the shown session. The steady-state saving is small and should not be claimed as the reason: 2.65 KiB/s. The reason is 0.4 — the tape is the one stream whose rate is unbounded, and a background contract would otherwise pay up to 115 frames a second for a tape nobody is reading.

## 1. A Session Stops Being The Service

- [ ] 1.1 Hold sessions in a map keyed by contract, with the shown contract named separately from the set held.
- [ ] 1.2 Replace `isCurrent(session)` with ownership by that session's own identity, so a callback of one session cannot be silenced by another being shown.
- [ ] 1.3 Route every timer, abort controller and pending queue through the session that owns it.
- [ ] 1.4 Prove by test that two sessions run at once, and that stopping one leaves the other delivering.

## 2. Selecting Is Not Subscribing

- [ ] 2.1 Deliver the held state of a selected contract immediately, without a `loading` status and without re-reading what it already holds. Per §0.3 this covers the chart, the last price, the mark, the ticker and the position's PnL — everything a background session never dropped. The book is the one panel that is not instant, and it says so in its own state rather than holding the workspace in `loading`.
- [ ] 2.2 On promotion, add `@depth@100ms` to the session's already-open `/public/stream` socket with `SUBSCRIBE` — not by opening a connection — and open the `@aggTrade` socket; reverse both on demotion. Per §0.5 the depth diff must be added on `/public/stream`: on `/market/stream` the same `SUBSCRIBE` is acknowledged and then never delivered, which would leave a promoted contract with a permanently empty book and no error anywhere. Per §0.3 the depth snapshot follows the subscription rather than running beside it, because the book bridges it by exact sequence number.
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
- [ ] 6.3 The route split is load-bearing and is not consolidated here. Depth lives on `/public/stream` and everything else on `/market/stream`, and §0.5 measured that this is not a naming convention: a depth subscription added to a live `/market/stream` socket is acknowledged and silently never delivered. Any later tidying that merges the two routes has to re-measure that first.
- [ ] 6.2 Whether the renderer keeps up when a held contract is promoted during a burst belongs to `stop-rebuilding-the-desk-on-every-tick`.
