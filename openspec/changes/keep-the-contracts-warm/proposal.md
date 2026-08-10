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
  the bound is a setting, and the first shipped value is small on purpose.
  Beyond it, the least recently used session is released.
- **A background session is cheap, and the operator said how cheap.** The
  spiky streams — the depth diff and the trade tape — are not held at all for a
  contract that is not shown: they are opened on the way to showing it. A held
  contract keeps only what is small and steady, its candles and its ticker, so
  the price and the position's PnL are warm the moment it is selected. On the
  shown contract the same two streams may be throttled or skipped under load,
  because "в момент спайка я вообще не смотрю на него" — the book is the first
  thing to shed and the last thing to wait for.
- **A failure is local to its session.** A resync, a refused frame or a lost
  socket affects the contract it belongs to and nothing else.
- **The renderer selects rather than resubscribes.** The protocol already names
  every frame with its request and its generation; selecting a held contract
  delivers that session's current state immediately instead of a `loading`
  status followed by a bootstrap.

## Trade-offs this accepts

- **More upstream traffic and more parsing.** Held sessions cost frames the
  operator is not looking at. This is why a background session drops the depth
  diff — the one stream whose volume is unbounded in a burst — and why the pool
  is small by default. The bound is stated in the settings rather than implied.
- **More memory.** Each book is a thousand levels per side; several are still
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
