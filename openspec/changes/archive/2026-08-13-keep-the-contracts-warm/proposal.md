## Why

The desk holds one contract at a time, and the operator pays for that on every
switch.

`FuturesProductionWorkstationService` is written around a single session —
`this.current` — and selecting another contract is `stopCurrent()` followed by a
whole new generation: exchange info, contract and index klines, ticker, premium
index, a depth snapshot, and three fresh WebSocket connections. Everything about
the previous contract is thrown away, including a book that was correct a
moment ago and will be needed again the moment the operator switches back.

Three costs follow from that one decision:

- **The switch is slow and visibly incomplete.** The workspace goes to
  `loading`, then to `live` only after the whole bootstrap lands — the operator
  reported the chart flickering between contracts during it.
- **The switch is a race.** Teardown and startup are the same code path, so a
  failure in the release stops the start. That is exactly the crash fixed in
  `switch-contracts-without-tearing-the-desk`: one throw during a handshake left
  the previous contract's sockets delivering into a desk that had moved on.
- **A resync is total.** With one session there is no smaller thing to rebuild,
  so any market-data failure rebuilds everything — which is what makes a single
  refused frame cost the whole desk (`hold-the-book-through-a-spike`).

The operator's own framing is the right one: the connection and the display are
different things. The desk can hold several contracts live and show one.

## What Changes

- **Sessions become a pool.** The service holds several contracts' sessions,
  keyed by contract, each owning its own streams, order book, timers and state.
  Selecting a contract selects which session the renderer is shown, and starts
  one only if it is not already held.
- **The pool is bounded and warm.** The most recently used contracts are kept —
  the bound is a setting, and the first shipped value is eight. Beyond it, the
  least recently used session is released.
- **A held session is a whole session.** It keeps every stream, keeps parsing
  them and keeps its book, tape and candles current; being shown decides only
  which session the renderer is given. Measured before deciding: a full session
  on the heaviest contract is 28.4 KiB/s and 3.35 ms of parse per second, so
  eight of them are 1.9 Mbit/s — 0.3% of the operator's link — and 2.7% of one
  core. Holding less would have bought nothing the machine notices and cost the
  operator one to two seconds of waiting on every switch back. §0 records the
  three thinner shapes that were measured and rejected.
- **Under load the shown contract still sheds.** "В момент спайка я вообще не
  смотрю на него" — the book is coalesced to the latest and the tape's overflow
  is dropped, so a burst costs the book's freshness and never the price.
- **A failure is local to its session.** A resync, a refused frame or a lost
  socket affects the contract it belongs to and nothing else.
- **The renderer selects rather than resubscribes.** The protocol already names
  every frame with its request and its generation; selecting a held contract
  delivers that session's current state immediately instead of a `loading`
  status followed by a bootstrap.

## Trade-offs this accepts

- **More upstream traffic and more parsing.** Held sessions cost frames the
  operator is not looking at: at the shipped bound of eight, 1.9 Mbit/s and
  27 ms of parse per second. Both were measured rather than estimated, and both
  are accepted deliberately — see §0.8 for why bandwidth is not the constraint
  it was first taken for. The bound is stated in the settings rather than
  implied.
- **More sockets.** Three per session, twenty-four at the shipped bound against
  three today, each on Binance's 24-hour rotation. This is the real ceiling on
  the bound, and it is only tolerable because a rotation is scoped to the
  session it happens on.
- **More memory.** Each book is a thousand levels per side; eight are still
  small beside the candle history the desk already holds.
- **A larger service.** Every method that reads `this.current` becomes a method
  about a named session. This is the real cost of the change, and it is worth
  paying once: the single-session assumption is behind the switch crash, the
  resync blast radius and the flicker.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: the desk holds several contracts and shows
  one, rather than holding exactly the one it shows.

## Impact

- `electron/services/futures-production-workstation-service.js` — the session
  becomes one of several; `current` becomes a selection.
- `src/hooks/useFuturesProductionWorkstation.js` — selecting a held contract
  renders its state rather than driving a fresh subscription.
- `src/utils/futuresProductionWorkstationProtocol.js` — a select that does not
  imply a bootstrap.
- Composes with `switch-contracts-without-tearing-the-desk` (which makes release
  total) and `hold-the-book-through-a-spike` (which makes a refused frame cost
  the book). Both are worth having on their own, and both get smaller once a
  failure is local to one session.
