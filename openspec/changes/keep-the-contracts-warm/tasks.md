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

- [x] 1.1 Hold sessions in a map keyed by contract, with the shown contract named separately from the set held. *(`this.sessions`, keyed by symbol, and `this.shown`. `this.current` is gone. The bound arrives as a constructor option defaulting to **one**, so this lands as a pool that releases exactly what the single-session service released and changes nothing the operator can see; §3.2 makes it a setting and raises it to eight.)*

- [x] 1.2 Replace `isCurrent(session)` with ownership by that session's own identity, so a callback of one session cannot be silenced by another being shown. This is the single assumption the whole change turns on: `isCurrent` is asked in 14 places and today it answers two different questions at once — "is this session alive?" and "is this session on screen?". They stop being the same question. *(Split into `isHeld` — the service is still running this session — and `isShown` — the operator is looking at it. There turned out to be 26 guard sites, not 14; each was classified one at a time rather than replaced wholesale, and every one of them gates **work**, so every one takes `isHeld`. `isShown` is asked in exactly one place: `emitResource`, the single point at which a session reaches the renderer. That is what makes a held session current and silent without a second code path anywhere — and it is why `startFreshnessMonitor` keeps running for a contract nobody is watching, which is what §4.3 needs.)*

- [x] 1.3 Route every timer, abort controller and pending queue through the session that owns it. *(Timers, abort controllers and both pending queues were already per-session. What was not was the depth reading and the page bought to cover it: `this.depthRange` and `this.depthPage` sat on the service, where a reconnect kept them by not touching them and another contract lost them by an explicit reset. Both now live on the session, and both cases are carried across on purpose — a reconnect reads them from the session it replaces, another contract takes the reading from its own request and opens on the cheapest page.)*

- [x] 1.4 Prove by test that two sessions run at once, and that stopping one leaves the other delivering. *(Three tests, and what each is worth is stated rather than assumed.)*

  | test | against the pre-change desk | against the mistake it guards |
  |---|---|---|
  | two contracts at once, and a failed release of one leaves the other delivering | **bites** — one socket and one freshness monitor where the test wants two, on the transport's own count, naming no new API | **bites** — a `stream.close()` that throws outside `release(step)` leaves the freshness monitor armed |
  | a reconnect keeps the page and the reading | guard — the pre-change desk keeps them too, by leaving service-level fields alone | **bites** — resetting `depthPage` on every generation |
  | another contract opens on the cheapest page and no reading | guard — the pre-change desk resets them too | **bites** — inheriting the page and the reading from the contract shown before |

  The two guards are guards, not findings: they cover behaviour this task **moved** from the service onto the session, where a reconnect and a switch stop being distinguished by which fields happen to be untouched. Both were written because the audit found nothing covering the move, and both were checked against the specific wrong version they exist to stop.

- [x] 1.5 Editing `futures-production-workstation-composition.js` alone does nothing. `vite.config.js` rewrites that import to `futures-production-workstation-verification-composition.js` for every build and every test, so the two files have to be changed in step — the second one is what the suite actually loads. Cost a debugging round on a bound that silently stayed at one, with no error anywhere: the option was accepted, ignored, and defaulted. Recorded here because the next person to add a constructor option loses the same round.

## 2. Selecting Is Not Subscribing

- [x] 2.1 Deliver the held state of a selected contract immediately: candles, header, book and tape as they stand, with no `loading` status, no bootstrap read and no stream work at all. Per §0.3 selection opens nothing and closes nothing — it changes which session is allowed to emit. *(`selectHeldContract` + `deliverHeldState`. Both `subscribe` and `select-symbol` land there when the contract is held: the renderer sends the first for the first contract of a connection and the second afterwards, and a desk whose socket dropped and came back sends the first again for a contract that never stopped running. The catalog goes first, because a renderer that has just reconnected has no contract list of its own.)*

- [x] 2.2 Keep a session that is not shown fully current and fully silent: it parses, it updates its book, tape and candles, and it emits nothing to the renderer. The renderer never learns a contract it did not ask for exists. *(Falls out of §1.2 with no code of its own: `emitResource` is the single point of delivery and the only place that asks `isShown`.)*

- [x] 2.3 Shed rather than queue under load on the shown contract: coalesce depth deliveries to at most one book per frame and drop the tape's overflow, so a burst costs the book's freshness and never the price. Per §0.4 these are two mechanisms for two different bursts, and neither substitutes for the other: depth is fixed at 10 fps and swells in frame size (2 638 B average, 21 067 B peak), the tape is a fixed 205 B and swells in rate (4 → 115 fps). **Already true; nothing built.** Checked in the code rather than assumed: the tape buffer drops its overflow at the tail (`appendFuturesWorkstationTrade` → `slice(0, TRADES)`, 512) and delivers at most `RENDERER_TRADES` = 32 rows behind the panel's own throttle window, so a burst of 115 prints a second costs the prints nobody can read and never the price. Depth is one book per frame by construction — the book is delivered from inside the diff handler and the subscription is rate-capped at 10 fps (§0.1: p50 = p95 = max = 10). What made a burst expensive was rebuilding the desk over a refused frame, and that is `hold-the-book-through-a-spike`, already landed.

- [x] 2.4 Keep the renderer's ownership checks intact: a frame still names the request and the generation it belongs to. *(A selected session takes the new request's id and keeps its generation — it did not bootstrap, and claiming it did would tell the renderer to discard a book that never stopped being correct. The renderer starts each subscription's generation at 0 and accepts anything above it, so a session on generation 3 delivers cleanly. Asserted frame by frame in the §2.5 test.)*

- [x] 2.5 Prove by test that returning to a held contract issues no bootstrap read, opens no socket and passes through no `loading`, and that its book is the one the session already held rather than a fresh snapshot.

  | test | against the pre-change desk |
  |---|---|
  | returns to a held contract with no read, no socket and no loading | **bites** — the catalog alone is read a third time |
  | delivers a session that failed unwatched in the state it is actually in | **bites** — the rebuilt session says `live`, not `resynchronizing` |
  | gives a re-selected contract the panel it is being shown in | **bites** — the session object is replaced rather than handed over |

  The first test caught a defect in itself before it caught one in the code: an out-of-sequence diff emptied the background book instead of advancing it, and "the view changed" was satisfied by the view becoming `null`. It now asserts the book is not recovering and the view is not null before asserting it moved.

- [x] 2.6 A session shown again delivers through the emitter of the request that selected it, and on the tape settings the panel is set to now. Both are captured when the session is opened: `session.emit` is the closure the first subscription handed over, and `session.tapeSettings` is a copy of the service's at that moment. Found while auditing §1 — harmless while the pool holds one contract, wrong the first time it holds two.

- [x] 2.7 A silent session does no delivery work, not merely no delivery. With `emitResource` refusing at the gate, a held session still rebuilt its renderer tape rows and re-fingerprinted them on every print, and crossed its book into rows on every diff. *(Three sites now stop before the work rather than at the emitter: the tape's row build, the book's `toRendererView`, and the candle series' tail. The shortfall reading is deliberately **not** skipped — it is what decides the page a held book is kept on, and a held book is kept deep enough for its own reading.)*

- [x] 2.8 One expectation was deliberately reversed, not adjusted to fit. `opens a contract on its own reading, not the one stated for the last` asserted that a second subscription for the same contract reset the reading and bought a fresh cheapest page. Its stated rule — a reading is a distance in the contract's own quote currency and belongs to no other contract — is right, but it was being asserted against the same contract, because while the desk held only what it showed, a second subscription was the nearest thing to another contract there was. Under the pool that path is a selection: opening the contract again on the cheapest page would mean discarding a book that was correct a moment ago to buy a shallower one. The test now asserts the selection reads nothing, and the rule it was written for is asserted against another contract in §1.4.

- [ ] 2.9 Decide what the pool does when the panel is not mounted at all. `unsubscribe` releases the shown session, which is right — but it is also what the renderer sends when the operator switches to Spot, and the other held contracts keep streaming with nobody in front of them. Two defensible answers and they are not the same: hold, and coming back from Spot is free the way switching contracts now is; release, and the desk stops paying for 24 sockets nobody is watching. The same action carries both meanings today — `retry()` sends `unsubscribe` too, and releasing the pool there would be plainly wrong — so whichever answer is taken needs the renderer to say which one it means. Found while auditing §2; not decided here because it is the operator's usage that decides it.

## 3. The Pool Is Bounded

- [ ] 3.1 Release the least recently shown session when the bound is reached, in full, through the same total release the switch uses. *(The mechanism landed with §1 — `makeRoomForSession` orders the held sessions by when each was last shown and releases from the front through `releaseSession`. At a bound of one it releases exactly what the single-session service released, which is why it could land there. What is still open is the proof: nothing exercises the ordering until the bound is above one.)*
- [ ] 3.2 Make the bound a stated setting rather than a constant buried in the service, with §0.2's per-contract cost recorded beside it so it is moved from a number.
- [ ] 3.3 Prove by test that the bound holds under a long sequence of selections and that nothing is left running behind it.

## 4. Failure Is Local

- [ ] 4.1 Scope a resync, a refused frame and a lost socket to the session they happened on. This is what makes §0.2's socket count harmless: 24 connections rotate about once an hour between them, and a rotation must cost only its own contract.
- [ ] 4.2 Prove by test that a background session's failure is invisible to the shown contract.
- [x] 4.3 A session that failed while it was not shown says so when it is selected, rather than being delivered as current. A held session is only worth trusting if it can admit it went stale unwatched. *(`emitStatus` records what it stated on the session before it tries to deliver it, so the record survives having no audience; a selection re-states that rather than `live` on the strength of being held. The per-resource states come from `staleResources`, which a background session keeps filling because §1.2 left the freshness monitor on "alive" rather than "shown". Proved by test: a background contract loses its stream, the renderer hears nothing about it, the shown contract carries on, and selecting the broken one delivers `resynchronizing` with the reason the socket gave.)*

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
