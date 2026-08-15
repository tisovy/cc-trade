## Why

Opening the account review is a read of the whole account, and the desk performs
it again every time the operator touches a tab.

- **Selecting a tab re-reads Binance.** `openHistory`
  (`src/components/features/futures/FuturesPortfolioDock.jsx:87`) calls
  `onLoadHistory` on every click of `ORDER HISTORY` and of `CLOSED POSITIONS`,
  including a click on the tab that is already open. There is no check for what
  is already held.
- **And blanks what was on screen.** `loadHistory`
  (`src/hooks/useFuturesTrading.js:604`) sets `status: 'loading'` with empty
  `orders` and `trades`, so the panel drops to `Loading account history…` and the
  operator waits again for rows they were already reading.
- **The read behind it is the account-wide fan-out.** Measured in
  `keep-the-history-read-out-of-the-way`: 25–28 REST requests through one
  admission queue that spaces each request 150 ms — about four seconds of that
  queue per click, on the same queue the account refresh after an order uses.
  Comparing the two tabs twice costs four fan-outs and roughly sixteen seconds of
  queue that the desk's own reads are then behind.
- **Nothing keeps it current between reads.** The desk already receives every
  order transition and every fill on the Futures user-data stream and applies
  them to the live orders and positions (`src/hooks/useFuturesTrading.js`,
  `futures_execution_update`). The history panel is the one consumer that
  discards that information and asks the exchange again instead.

Nothing here is wrong on screen. What is wrong is that a review of the past is
priced like a read of the present, over and over, and that the past does not
change — the only thing that changes is that new entries are added to its end,
and those arrive on a socket the desk is already listening to.

## What Changes

- The account history is read **once** when the Futures workspace opens, and
  after that only when the operator asks for it with the refresh control.
  Selecting a tab renders what is held.
- What was read is kept for the session: switching tabs, changing contract, and
  returning to the workspace all render from the held reading.
- Terminal order transitions and fills arriving on the user-data stream are
  folded into the held history, so a filled or cancelled order appears in the
  review without a read.
- A refresh replaces the held rows rather than emptying them: the previous
  reading stays on screen, marked as being refreshed, and is replaced when the
  answer arrives — or kept, with the failure stated, when it does not.
- The panel says how old the reading is, so "held" is never mistaken for "just
  read".

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: the account review is a held reading maintained by
  the stream, not a read performed on every glance.

## Impact

- `src/components/features/futures/FuturesPortfolioDock.jsx` (tab selection stops
  triggering a read), `src/hooks/useFuturesTrading.js` (the held history, its
  stream maintenance and its refresh semantics),
  `src/components/features/futures/FuturesHistoryPanel.jsx` (age and refreshing
  state).
- Composes with `keep-the-history-read-out-of-the-way`, which narrows what one
  read costs and lets an urgent read overtake it. This change removes the reads
  that should never have been issued; that one bounds the cost of the reads that
  remain. Neither replaces the other, and they touch different code.
- No trading decision changes. What changes is how often the desk pays Binance
  for something it already knows.
