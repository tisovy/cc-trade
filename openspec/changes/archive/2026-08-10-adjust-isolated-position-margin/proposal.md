## Why

The positions dock reports what a position is worth, where it entered, where it
is marked and where it liquidates — but not the margin standing behind it. That
is the one number the liquidation price is a function of, and it is also the
only number the operator can change without touching the position itself.

Two consequences today:

- **ROE has no visible denominator.** `describeFuturesPosition` already divides
  unrealized PnL by the reported margin to produce the ROE the dock shows, so
  the desk holds the figure and does not display it. A −4.05% next to a −107.25
  USDT loss is unreadable without it.
- **The only defence against liquidation is closing.** When price runs against
  an isolated position the operator's choices are to exit or to top the margin
  up, and only one of those exists in this desk. Topping up is the *cheaper*
  action and the one that has to be reachable in seconds, from the row that is
  already showing the liquidation price.

`/fapi/v3/positionRisk` reports `isolatedWallet` and `initialMargin` on every
position, so the figure needs no new account read and no new rate-limit weight.

## What Changes

- The positions dock gains a **Margin** column, between the liquidation price
  and uPnL (ROE), so the ROE percentage sits next to the amount it is measured
  against.
- The cell is a control. Clicking it opens a floating panel at the cursor — the
  same panel shape as the order editor and the position closer — that adds
  margin to, or removes margin from, that one position.
- A new trading command `trade.adjustPositionMargin` carries the request through
  the same path as every other submission: typed builder, main-process
  validation, market-activation gate, `POST /fapi/v1/positionMargin`.
- Cross-margin positions display their margin and refuse the adjustment with the
  reason, rather than offering a control the exchange would reject.
- The panel draws the **liquidation floor**: the maintenance requirement, the
  margin standing above it, and where the amount being typed would leave that
  margin. The number that matters while adjusting margin is not the balance in
  the wallet — it is how much of this position's margin is still spare.
- The **margin mode is named in words** on every surface that shows a margin
  figure, because the two modes are not two styles of the same thing: only one
  of them can be adjusted at all.

## Decisions

**Margin mode is read, not guessed.** `/fapi/v3/positionRisk` stopped reporting
`marginType`, but it reports `isolatedWallet`: an isolated position holds
isolated wallet funds and a cross position holds none, so a positive
`isolatedWallet` *is* the isolated mode rather than an inference about it. When
a source still supplies `marginType`, that is used first.

**The order ceiling does not apply.** `FUTURES_MAX_ORDER_USDT` bounds the
notional an order puts at risk. A margin transfer changes no notional: adding
margin *lowers* the risk on an open position, and capping it could block the
top-up that would have prevented a liquidation. The local refusals are the two
bounds that are facts rather than policy — you cannot add more than the
available USDT balance, and you cannot remove more than the position holds — and
Binance remains the authority on the exact removable amount, which is smaller
than the isolated wallet by the maintenance margin.

**The floor is drawn, the ceiling is not claimed.** The point at which the
margin balance reaches the maintenance requirement is arithmetic: below it the
position is liquidated, and the read carries every term. Binance's own removable
limit is *stricter* than that — its leverage brackets hold back more — and it is
not reproducible from this read, since `/fapi/v3/positionRisk` reports no
leverage. So the meter draws the floor as the point where liquidation is
certain, refuses anything past it, and lets the exchange refuse the rest in its
own words. Unrealized profit is excluded from the buffer (it is not in the
wallet) and unrealized loss is subtracted from it (it has already been taken).

**Pausing trading blocks removal, not addition.** The pause switch exists so the
operator can stop taking risk. Removing margin takes risk and is refused while
paused; adding margin reduces it and stays available, as cancelling does.

**Success is the number moving.** No new confirmation envelope: the handler
re-reads the account and the margin cell shows the exchange's own figure. A
refusal travels the existing `command_rejected` path with Binance's code and
text, which `report-execution-state-truthfully` is already improving.

## Capabilities

### New Capabilities

- `futures-position-margin`: the margin committed to each open position is
  visible on the position row, and an isolated position's margin can be
  increased or decreased from it.

### Modified Capabilities

- `futures-workstation-presentation`: a panel anchored at the cursor is placed
  by its measured height, so it cannot open partly off-screen; dock tables size
  no column by its content, so headings stay above their values. Both defects
  are older than this change — the ninth column is what made them visible.

## Impact

- `src/utils/tradingCommands.js`: new `trade.adjustPositionMargin` action and
  `createFuturesAdjustPositionMarginCommand`. The renderer command-path guard
  keeps the frame in this module.
- `electron/services/trading-command-validation.js`: validation for the new
  action — futures only, symbol, position side, direction, positive amount.
- `electron/services/binance-connection.js`: `handleFuturesAdjustPositionMargin`,
  routed inside the existing futures switch and therefore already behind the
  market-activation gate.
- `electron/services/futures-trading-adapter.js`: `adjustPositionMargin` calling
  `POST /fapi/v1/positionMargin`; `normalizeFuturesPositions` additionally
  carries `isolatedWallet`.
- `src/utils/futuresOrderPresentation.js`: `describeFuturesPositionMargin`.
- `src/components/features/futures/FuturesPositionMarginEditor.jsx` (new),
  `FuturesPortfolioDock.jsx`, `FuturesProductionWorkstation.jsx`,
  `FuturesWorkstation.css`, `src/hooks/useFuturesTrading.js`.
- Adds a submission path while `report-execution-state-truthfully` is still
  open. That is deliberate: landing it now means item 4 covers its reporting
  along with every other command, instead of leaving one path behind.
- Live confirmation required before archiving: a real isolated position, margin
  added and removed, both figures matching Binance's own.
