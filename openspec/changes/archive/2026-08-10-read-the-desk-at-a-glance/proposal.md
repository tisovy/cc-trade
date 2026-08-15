## Why

Six readings on the Futures desk cost the operator a decode, and one of them was
a lie.

- **24h volume** printed `49567852`. Nobody compares the last three digits of a
  daily volume; they read its magnitude, and ten digits in a header strip are
  read as a number that has to be counted.
- **The last price** printed `2.6010000`. Binance pads a kline close to a fixed
  width, and the padding was rendered as though it were precision — in the
  largest number in the order book, between the two sides it separates.
- **uPnL (ROE)** printed `+221.20 +5.52` with the percent sign sliced off. The
  cell clips its overflow and the column was 104px against 118px of content, so
  the reading was not shortened, it was cut mid-glyph. The operator read that as
  a rounding problem, which is the only thing it was not.
- **Order history** printed `0.000` in the price column for every market order and
  in the average column for every unfilled one. The exchange reports 0 for a price
  an order does not have, and `0.000` in a column of prices reads as a level.
- **Its time column** printed `10.08 11:21:…`, ellipsized where it mattered: both
  halves of the stamp in a cell that fits one.
- **Trades (PnL)** listed executions. One market close of one position arrives as
  five fills in the same second, each with its own sixth of the realized PnL, and
  a session of that is a wall of rows none of which is the number the session is
  reviewed with.

And two things the operator reached for and did not find: the contracts they had
been working with were sorted to the front of the rail but marked `PERPETUAL` like
the four hundred behind them, and the pair could only be changed by going to the
rail's search box and clicking a row — while Spot has had type-to-search all along.

## What Changes

- Large amounts are **abbreviated with their magnitude** — `49.6M`, `1.1B` — and
  the exact figure stays in the title. The compact formatter gains the B tier it
  never had, where an M suffix had stopped abbreviating anything.
- The last price is shown **without the stream's padding**, at every precision the
  contract actually trades at, and centred between the two book sides.
- A reading that cannot fit its cell **keeps the reading**: the uPnL column holds
  both figures, the percentage is never the part that gives way, and the cell's
  title carries both exactly.
- **A price of zero is not a price.** Market orders and unfilled orders report no
  price, and that is shown as absent.
- A history row is stamped for **when it happened**: today's rows carry the time of
  day, older rows the date, and the whole stamp is in the title.
- The trades tab becomes **Positions (PnL)**: fills are folded back into the round
  trips they formed — entry, exit, size, fees and the realized PnL of the position.
- The instrument rail **marks the contracts recently worked with**, whether they
  came from the catalogue or from storage, so the block at the top reads as the
  operator's own.
- **Typing opens the picker**, as on Spot: a letter offers pairs, a digit offers
  intervals, recency first.

## Decisions

**A round trip is reconstructed from exposure, not from order ids.** A position
opens when exposure is taken and closes when it returns to flat, so the walk needs
only the fills' sides and sizes — no assumption about how the exchange grouped
them. Sizes are held as integers: `0.1 + 0.2 − 0.3` is 5.5e-17 in floating point,
and a position that never reaches flat swallows every fill after it into one
endless round.

**The window's edge is stated, not papered over.** The exchange returns a bounded
window of fills, so its oldest rows can be the closing fills of a position opened
before it. Binance marks a reducing fill by reporting realized PnL on it, so a
round that opens with one is reported as what it is — a position closed here and
opened outside the window, with no entry price — rather than being read backwards
into a short that never existed.

**Abbreviating is dropping digits, so the digits stay reachable.** Every
abbreviated or shortened reading on this desk carries its exact value in a title:
volume, uPnL, the round's net of fees, the history stamp.

**Trailing zeros are dropped, nothing is rounded.** The last price is trimmed of
the stream's padding rather than re-quantized to the tick, so a coin quoted at
0.00123 keeps every digit it trades at while `2.6010000` reads as `2.601`.

**Recency ranks above the alphabet in the picker**, and a symbol the query *starts*
ranks above one it merely contains: typing `BT` must not offer WBTCUSDT before
BTCUSDT.

**Typing is typing.** The picker opens on a bare letter or digit only — never with
a modifier held, never while a field has focus, and only for the market that is
active, because the workstation's own shortcuts are mouse gestures and modifier
keys and nothing may be taken from them.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: magnitude-abbreviated amounts, prices shown
  at their own precision, readings that never lose a digit to their column, a rail
  that marks what the operator works with, and type-to-search over contracts and
  intervals.
- `futures-order-visibility`: history rows stamped for when they happened, prices
  the order does not have shown as absent, and executions reported as the positions
  they formed.

## Impact

- `src/utils/futuresTradeRounds.js` (new): folds fills into round trips on integer
  sizes.
- `src/utils/futuresPriceFormat.js`: B tier and a caller-chosen digit count for the
  compact formatter; `formatPriceOrAbsent`.
- `src/utils/futuresSymbolHistory.js`: `searchFuturesSymbols`.
- `src/components/features/futures/FuturesHistoryPanel.jsx`,
  `FuturesPortfolioDock.jsx`, `FuturesWorkstationView.jsx`,
  `FuturesProductionWorkstation.jsx`, `FuturesWorkstation.css`.
- `src/components/features/tools/QuickSwitchModal.jsx` is reused as it stands, so
  the two desks share one gesture and one picker rather than two of each.
- No new exchange call and no new command: every reading is derived from data the
  desk already holds.
