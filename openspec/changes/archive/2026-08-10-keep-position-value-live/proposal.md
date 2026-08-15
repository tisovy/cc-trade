## Why

A live session at the desk found the positions dock reporting three untruths at
once, on the row a trader stares at longest:

- Size reads `−15716.49`. The direction is already stated by the `SHORT` badge
  one column to the left, so the sign only raises the question "minus what?".
  A position is worth an amount of USDT; it is never worth a negative amount.
- The size cell of the selected contract renders as an unstyled browser button —
  a white rectangle with unreadable text — because
  `.futures-workstation-dock-size` has no rule in the stylesheet. Only the
  selected contract's row is affected, so the same datum looks like two
  different things in two adjacent rows.
- Mark, size, uPnL and ROE are frozen. Positions come only from
  `/fapi/v3/positionRisk`, which is re-read on an account event
  (`ACCOUNT_UPDATE`, a fill) and on an explicit refresh. Between those the
  chart ticks and the row does not, so the total uPnL shown at the top of the
  dock is the PnL of some earlier minute presented as the PnL of now — the
  worst class of defect a trading surface can have.

## What Changes

- Position size is stated as an unsigned USDT amount under a `Size (USDT)`
  header; direction stays where it already is, in the side badge and the row
  accent.
- The size control is styled as part of its row: same font, colour and
  alignment as a plain cell, with a hover/focus affordance instead of a
  browser-default button face.
- **New**: the main process subscribes to the public USDⓈ-M mark price stream
  (`<symbol>@markPrice@1s`) for exactly the symbols that currently carry an
  open position, and broadcasts the marks to Futures renderers. The stream
  needs no credentials and costs no REST weight.
- Position rows are re-valued from those marks between account snapshots: mark
  price, USDT size, uPnL and ROE all move with the market.
- When the mark feed is not connected, its marks are dropped rather than aged:
  rows fall back to the account snapshot instead of presenting a stale mark as
  a live one.

## Capabilities

### Modified Capabilities

- `futures-live-readiness`: an unauthenticated mark price feed that follows the
  open-position set and fails closed to the account snapshot.
- `futures-workstation-presentation`: unsigned USDT position size, row-native
  size control, position rows valued at the live mark.

## Impact

- Main process: new `electron/services/futures-mark-price-feed.js`, wired in
  `electron/services/binance-connection.js` alongside the futures user data
  stream (started with the first Futures renderer, stopped with the last).
- Renderer: `src/hooks/useFuturesTrading.js` (new `futures_position_marks`
  message), new `src/utils/futuresPositionMarks.js`,
  `src/utils/futuresOrderPresentation.js`,
  `src/components/features/futures/FuturesPortfolioDock.jsx`,
  `src/components/features/futures/FuturesWorkstation.css`.
- No new runtime dependency, no new authenticated route, no additional REST
  weight. The feed is outside the isolated public-read workstation transport
  and does not touch it.
