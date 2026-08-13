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

- [x] 0.3 Decide what a held session that is not shown subscribes to. **Everything. A held session is a full session; "shown" decides only which one the renderer is given.** It keeps all four streams, keeps parsing them, and keeps its book, its tape and its candles current. The only thing it does not do is emit to the renderer.

  This reverses the shape the proposal assumed and the shape recorded here on the first pass, and it is the operator's call after seeing the numbers. The rejected shapes and what they were bought with:

  | held-but-not-shown shape | KiB/s | ms/s parse | to a usable book when selected |
  |---|---|---|---|
  | A. no depth at all, open the socket when selected | 1.12 | 0.29 | socket open 1 266 ms + snapshot 968 ms ≈ **2.23 s** |
  | B. hold a socket on a cheap stream, `SUBSCRIBE` depth when selected | 1.28 | 0.33 | subscribe 459 ms + snapshot 968 ms ≈ **1.43 s** |
  | C. hold the depth socket, discard its frames | 25.77 | 0.29 | snapshot 968 ms ≈ **0.97 s** |
  | **D. hold everything, parse everything** | **28.42** | **3.35** | **0 s** |

  A, B and C all trade seconds of the operator's time for bytes and CPU that this desk does not have to save — see 0.8. D costs nothing the machine notices and removes the wait entirely, so it is what ships.

  What the operator gets on switching back to a held contract: everything, at once. Chart, last price, mark, ticker, tape, **and the book** — none of it was ever dropped, so there is nothing to rebuild and nothing to wait for. Today the same switch puts the whole workspace through `loading` and six REST reads.

  **What is still not instant:** a contract that is not held. It bootstraps exactly as today. The pool makes returning free; it does not make arriving faster.

- [x] 0.8 State the constraint that actually bounds the pool, because the first pass bounded it by the wrong one. *(The first pass sized the pool by bandwidth and parse cost and landed on two. Both are noise on this desk: six held contracts is 170 KiB/s — **1.4 Mbit/s against the operator's 600 Mbit link, 0.23% of it** — and 20 ms of parse per second, 2% of one core. Sizing a pool by 0.23% of a link is not caution, it is arithmetic nobody checked against the machine it runs on. What actually costs something is **sockets**: three per session, each on Binance's 24-hour rotation, and every rotation is a resync. That is the number to watch, and §4.1 is what makes each one harmless.)*

- [x] 0.2 Decide the first shipped bound and state why. **Eight, as a setting.** Per-contract cost is linear and known: +28.42 KiB/s, +3.35 ms/s of parse, +3 sockets.

  | bound | Mbit/s | share of a 600 Mbit link | ms/s parse | share of one core | sockets |
  |---|---|---|---|---|---|
  | 1 (today) | 0.23 | 0.04% | 3.35 | 0.3% | 3 |
  | 4 | 0.93 | 0.16% | 13.4 | 1.3% | 12 |
  | **8** | **1.86** | **0.31%** | **26.8** | **2.7%** | **24** |
  | 16 | 3.73 | 0.62% | 53.6 | 5.4% | 48 |

  Eight covers a working day's rotation of contracts with room spare, and the honest reason it is not larger is sockets: 24 connections against three today, each rotating once a day. That is roughly one rotation an hour across the pool, each scoped to its own session and invisible unless it lands on the shown contract. At 16 it is one every half hour, which is still fine and can be had by changing the setting — §3.2 makes it a setting precisely so this is a number the operator moves, not a rebuild.

  All figures are BTCUSDT-class, the heaviest contract measured. A pool of mixed contracts costs less: SOLUSDT's depth peaks at 9.83 KiB/s against BTCUSDT's 82.17.

- [x] 0.5 Measure whether a stream can be added to a live socket at all, before designing selection around it. **It can — but not on every route, and the failure is silent.** Measured through the proxy, `SUBSCRIBE` sent on an already-open connection:

  | route | stream added | ack | first frame |
  |---|---|---|---|
  | `/market/stream` | `@aggTrade` | 371 ms | 378 ms |
  | `/public/stream` | `@depth@100ms` | 370 ms | 459 ms |
  | `/stream` (Binance's own) | `@depth@100ms` | 362 ms | 427 ms |
  | `/market/stream` | `@depth@100ms` | 383 ms / 430 ms | **never — 10 s, twice** |

  `SUBSCRIBE` for the depth diff on the `/market/stream` route is acknowledged and then never delivered — while the ticker on that same socket keeps arriving, so the connection is plainly alive and it is the added stream that is dropped. Nothing errors and the ack says yes, so the book would stay empty for the life of the session.

  **This is not reachable today, and that is the point.** Per 0.7 the desk sends no control frame to Binance at all, so the pair cannot occur under the current transport. The decision in 0.3 means this change will not introduce one either. The measurement is a guard against the future, and specifically against the one optimization anybody would reach for here — "hold fewer sockets, subscribe on the one that is open". It is the third form of the same lie the session on `prove-the-private-stream-is-carrying` has been cataloguing: a retired route that answers the handshake (§1, closed), an open socket that carries nothing (§2), and now an acknowledged subscription that delivers nothing. In all three the healthy-looking signal is the wrong one to trust, and the only sound signal is a frame the exchange sent on its own.

- [x] 0.7 Record why no dynamic subscription is introduced here. *(The desk sends no control frame to Binance anywhere today. Checked rather than assumed: every `SUBSCRIBE`/`UNSUBSCRIBE` in the tree is the desk's own renderer↔service protocol action (`futuresProductionWorkstationProtocol.js:20,26`), the workstation opens its sockets with the streams in the query (`transport.js:698,699,733`), and the mark-price feed changes its symbol set by **recreating the socket** on a new URL (`futures-mark-price-feed.js:213`) rather than by subscribing. Shape B would have introduced the first one of its kind, on the exact route pair measured in 0.5 to acknowledge and silently deliver nothing. Shape D needs no transport change at all: every session opens the sockets the service already knows how to open, with the streams already in the URL.)*

- [x] 0.6 Decide whether the tape stays on the shared market socket. **It stays.** The earlier decision to split `@aggTrade` onto its own connection existed only so a background session could keep the mark price and the ticker without the tape. Under 0.3 a held session keeps the tape too, so the split buys nothing and would cost one connection per session — eight at the shipped bound. The transport's socket layout is unchanged by this change.

## 1. A Session Stops Being The Service

- [ ] 1.1 Hold sessions in a map keyed by contract, with the shown contract named separately from the set held.
- [ ] 1.2 Replace `isCurrent(session)` with ownership by that session's own identity, so a callback of one session cannot be silenced by another being shown. This is the single assumption the whole change turns on: `isCurrent` is asked in 14 places and today it answers two different questions at once — "is this session alive?" and "is this session on screen?". They stop being the same question.
- [ ] 1.3 Route every timer, abort controller and pending queue through the session that owns it.
- [ ] 1.4 Prove by test that two sessions run at once, and that stopping one leaves the other delivering.

## 2. Selecting Is Not Subscribing

- [ ] 2.1 Deliver the held state of a selected contract immediately: candles, header, book and tape as they stand, with no `loading` status, no bootstrap read and no stream work at all. Per §0.3 selection opens nothing and closes nothing — it changes which session is allowed to emit.
- [ ] 2.2 Keep a session that is not shown fully current and fully silent: it parses, it updates its book, tape and candles, and it emits nothing to the renderer. The renderer never learns a contract it did not ask for exists.
- [ ] 2.3 Shed rather than queue under load on the shown contract: coalesce depth deliveries to at most one book per frame and drop the tape's overflow, so a burst costs the book's freshness and never the price. Per §0.4 these are two mechanisms for two different bursts, and neither substitutes for the other: depth is fixed at 10 fps and swells in frame size (2 638 B average, 21 067 B peak), the tape is a fixed 205 B and swells in rate (4 → 115 fps).
- [ ] 2.4 Keep the renderer's ownership checks intact: a frame still names the request and the generation it belongs to.
- [ ] 2.5 Prove by test that returning to a held contract issues no bootstrap read, opens no socket and passes through no `loading`, and that its book is the one the session already held rather than a fresh snapshot.

## 3. The Pool Is Bounded

- [ ] 3.1 Release the least recently shown session when the bound is reached, in full, through the same total release the switch uses.
- [ ] 3.2 Make the bound a stated setting rather than a constant buried in the service, with §0.2's per-contract cost recorded beside it so it is moved from a number.
- [ ] 3.3 Prove by test that the bound holds under a long sequence of selections and that nothing is left running behind it.

## 4. Failure Is Local

- [ ] 4.1 Scope a resync, a refused frame and a lost socket to the session they happened on. This is what makes §0.2's socket count harmless: 24 connections rotate about once an hour between them, and a rotation must cost only its own contract.
- [ ] 4.2 Prove by test that a background session's failure is invisible to the shown contract.
- [ ] 4.3 A session that failed while it was not shown says so when it is selected, rather than being delivered as current. A held session is only worth trusting if it can admit it went stale unwatched.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `check:circular`, `check:runtime-mock`.
- [ ] 5.2 Measure the switch: time from selection to a live desk, held versus unheld, and record both against §0.1's baseline.
- [ ] 5.3 Measure what the pool actually costs at the shipped bound on the operator's own machine — bytes, parse and socket count with eight contracts held — and compare against §0.2's predictions rather than assuming they held.
- [ ] 5.4 Operator confirms on live data: switching back to a contract held in the pool is immediate including the book, switching to one that is not is no worse than today, and neither flickers between contracts.

## 6. Stated Limits, Not Fixed Here

- [ ] 6.1 The trading path is untouched: it never depended on which contract is shown, and account state is account-wide already.
- [ ] 6.3 The route split is load-bearing and is not consolidated here. State it as the prohibition rather than as the arrangement, because only the prohibition survives a refactor: **depth is carried by its own `/public/stream` socket, and a depth subscription added to a live `/market/stream` socket is acknowledged and then silently never delivered** (§0.5, measured twice). Saying only "depth lives on `/public/stream`" reads as a placement someone is free to tidy up. Any later change that merges the routes, or that adds a stream to a socket instead of opening one, has to re-measure delivery — not the acknowledgement — first.
- [ ] 6.2 Whether the renderer keeps up when a held contract is selected during a burst belongs to `stop-rebuilding-the-desk-on-every-tick`.
- [ ] 6.4 The pool is not persisted across a restart. A restart already reads everything once, and warming eight contracts at startup would turn the desk's slowest moment into a slower one.
