import { memo, useMemo } from 'react'
import { formatSignedUsdt } from '../../../utils/futuresOrderPresentation.js'
import { buildFuturesTradeRounds } from '../../../utils/futuresTradeRounds.js'
import {
  formatCompactUsdt,
  formatPriceOrAbsent,
  formatUsdtAmount,
} from '../../../utils/futuresPriceFormat.js'

const EMPTY_ROWS = Object.freeze([])
const EMPTY_TICKS = Object.freeze({})

const startOfToday = () => {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  return midnight.getTime()
}

// The column carried the date and the time together, which is fourteen characters
// in a narrow cell: it ellipsized to `10.08 11:21:…`, losing the seconds that
// separate one fill from the next. A row from today is read for its time of day
// and an older one for its day, so each shows the half it is read for. Nothing is
// lost — the whole stamp stays in the cell's title.
const formatTime = (timestamp) => {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return '—'
  const date = new Date(timestamp)
  return date.getTime() >= startOfToday()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : date.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
}

const exactTime = timestamp => (
  Number.isSafeInteger(timestamp) && timestamp > 0
    ? new Date(timestamp).toLocaleString()
    : undefined
)

const sideTone = side => (String(side).toUpperCase() === 'SELL' ? 'sell' : 'buy')

// A round is a span, not a moment: the column shows where it started and the
// title shows how long it ran, including the case where it is still running.
const roundSpan = (round) => {
  const opened = exactTime(round.openTime)
  if (opened === undefined) return undefined
  if (round.open) return `Opened ${opened} · still open`
  const closed = exactTime(round.closeTime)
  return closed === undefined || closed === opened
    ? `Opened and closed ${opened}`
    : `${opened} → ${closed}`
}

// What happened, and what it cost. Realized PnL is the number a trader reviews
// a session with, so it is the one column that never abbreviates its sign.
//
// The history spans the account, not the contract on screen: a trader reviews the
// session they had, and half of it was on the pairs they have since switched away
// from. Every row therefore names its contract and is priced at that contract's
// own tick, and the selected one is only tinted rather than being all there is.
export const FuturesHistoryPanel = ({
  view,
  symbol,
  history = null,
  tickSizes = EMPTY_TICKS,
  onSymbolChange,
}) => {
  const status = history?.status ?? 'idle'
  const orders = Array.isArray(history?.orders) ? history.orders : EMPTY_ROWS
  const trades = Array.isArray(history?.trades) ? history.trades : EMPTY_ROWS
  // How wide the read actually was. An empty table means "nothing here" only if
  // the operator knows what was looked at — the backend reads a bounded set of
  // contracts, so the count says which claim is being made.
  // What the operator traded is a position, not an execution: one market close
  // arrives as five fills in the same second, and five rows of a sixth of the
  // PnL each is not the number anybody reviews a session with.
  //
  // And this is the log of positions that are *finished*: entered, exited, and
  // what came of it. A position still running has no exit and no result, so it
  // belongs to the live positions table above, not to a history — listing it
  // here put half-empty rows among the closed ones and read as noise.
  //
  // Folded once per set of fills rather than once per render. The read is now a
  // thousand fills per contract across twelve contracts, and this panel
  // re-renders whenever a contract config arrives.
  const rounds = useMemo(() => (
    view === 'tradeHistory'
      ? buildFuturesTradeRounds(trades).filter(round => !round.open && round.exitPrice !== null)
      : EMPTY_ROWS
  ), [trades, view])
  const read = Array.isArray(history?.symbols) ? history.symbols.length : 0
  const traded = Number.isSafeInteger(history?.discovered) ? history.discovered : 0
  const scope = read > 0
    ? ` across the ${read} contract${read === 1 ? '' : 's'} read`
    : ' in this window'
  // What the list does not cover. A review that is bounded and does not say so is
  // read as complete — the operator looked for two days of losses, found none, and
  // had no way to tell the difference between "there were none" and "they are on
  // the contracts this read dropped, or older than the fills it reached".
  const reach = (rows) => {
    const oldest = rows.reduce((earliest, row) => {
      const time = Number(row?.time)
      return Number.isFinite(time) && time > 0 && (earliest === null || time < earliest)
        ? time
        : earliest
    }, null)
    if (rows.length === 0) return null
    const contracts = traded > read
      ? `${read} of ${traded} contracts read`
      : `${read} contract${read === 1 ? '' : 's'} read`
    return (
      <p className="futures-workstation-history-reach">
        {contracts}
        {oldest === null ? '' : `, back to ${exactTime(oldest)}`}
        {/* The count above is of the contracts the desk found. Where the search
            for them failed or ran out of pages, it is not known to be all of
            them, and a bounded number stated flatly reads as a total. */}
        {history?.discoveryComplete === false ? ' · more may have been traded' : ''}
      </p>
    )
  }
  const tickOf = rowSymbol => tickSizes[rowSymbol] ?? null
  const symbolCell = (rowSymbol) => {
    const name = typeof rowSymbol === 'string' && rowSymbol.length > 0 ? rowSymbol : '—'
    return (
      <span role="cell">
        {typeof onSymbolChange === 'function' && name !== '—' ? (
          <button
            type="button"
            className="futures-workstation-dock-symbol"
            aria-label={`Show ${name}`}
            onClick={() => onSymbolChange(name)}
          >
            {name}
          </button>
        ) : name}
      </span>
    )
  }
  const rowClass = (base, tone, rowSymbol) => (
    `futures-workstation-dock-row ${base} is-${tone}${rowSymbol === symbol ? ' is-current-symbol' : ''}`
  )

  if (status === 'error') {
    return (
      <p className="futures-workstation-empty" role="alert">
        {history?.error?.message ?? `History unavailable (${history?.error?.code ?? 'UNKNOWN'}).`}
      </p>
    )
  }
  if (status !== 'ready') {
    return (
      <p className="futures-workstation-empty" role="status">
        {status === 'loading' ? 'Loading account history…' : 'Open history to load it.'}
      </p>
    )
  }

  if (view === 'tradeHistory') {
    if (rounds.length === 0) {
      return <p className="futures-workstation-empty">No closed positions{scope}.</p>
    }
    return (
      <>
        <div className="futures-workstation-dock-table" role="table" aria-label="Position history">
          {/* Seven columns, not eight: the fee is a component of the result rather
              than a reading of its own, so it moved into the PnL cell's title — the
              column it was crowding is the only one this panel exists for. */}
          <div className="futures-workstation-dock-row is-head is-rounds" role="row">
            <span role="columnheader">Symbol</span>
            <span role="columnheader">Closed</span>
            <span role="columnheader">Side</span>
            <span role="columnheader">Size</span>
            <span role="columnheader">Entry</span>
            <span role="columnheader">Exit</span>
            <span role="columnheader">Realized PnL</span>
          </div>
          {rounds.map((round) => {
            const tone = round.realizedPnl === 0
              ? 'flat'
              : round.realizedPnl > 0 ? 'positive' : 'negative'
            const leg = round.positionSide === 'LONG' ? 'buy' : 'sell'
            return (
              <div className={rowClass('is-rounds', leg, round.symbol)} role="row" key={round.key}>
                {symbolCell(round.symbol)}
                {/* A closed position is filed under when it closed; the whole span,
                    open to close, stays in the title. */}
                <span role="cell" title={roundSpan(round)}>{formatTime(round.closeTime)}</span>
                <span role="cell" className={`futures-workstation-dock-side is-${leg}`}>
                  {round.positionSide}
                </span>
                {/* Sized in USDT, like every other size on this desk. The contract
                    count is what the exchange worked in, so it stays exact on the
                    element rather than taking the column. */}
                <span
                  role="cell"
                  title={`${round.quantity} contracts · ${round.fills} fill${round.fills === 1 ? '' : 's'}`}
                >
                  {formatCompactUsdt(round.notional)}
                </span>
                {/* A position opened before this window of trades still has a knowable
                    entry: the exchange's realized PnL states it exactly. The row says
                    where the number came from rather than showing a dash. */}
                <span
                  role="cell"
                  title={round.entryImplied
                    ? 'Opened before this window of trades — entry recovered from the realized PnL'
                    : undefined}
                >
                  {formatPriceOrAbsent(round.entryPrice, tickOf(round.symbol))}
                </span>
                <span role="cell">{formatPriceOrAbsent(round.exitPrice, tickOf(round.symbol))}</span>
                {/* The exchange's realized PnL is before its own commission, so the
                    fee and the net are both stated in the title. */}
                <span
                  role="cell"
                  className={`futures-workstation-dock-pnl is-${tone}`}
                  title={`${formatSignedUsdt(round.realizedPnl)} realized less ${formatUsdtAmount(round.fee, 4)} in fees is ${formatSignedUsdt(round.netPnl)} net`}
                >
                  <strong>{formatSignedUsdt(round.realizedPnl)}</strong>
                </span>
              </div>
            )
          })}
        </div>
        {reach(trades)}
      </>
    )
  }

  if (orders.length === 0) {
    return <p className="futures-workstation-empty">No orders{scope}.</p>
  }
  return (
    <>
      <div className="futures-workstation-dock-table" role="table" aria-label="Order history">
        <div className="futures-workstation-dock-row is-head is-order-history" role="row">
          <span role="columnheader">Symbol</span>
          <span role="columnheader">Time</span>
          <span role="columnheader">Side</span>
          <span role="columnheader">Type</span>
          <span role="columnheader">Price</span>
          <span role="columnheader">Filled</span>
          <span role="columnheader">Avg</span>
          <span role="columnheader">Status</span>
        </div>
        {orders.map(order => (
          <div
            className={rowClass('is-order-history', sideTone(order.side), order.symbol)}
            role="row"
            key={`${order.symbol}:${order.orderId}:${order.time}`}
          >
            {symbolCell(order.symbol)}
            <span role="cell" title={exactTime(order.time)}>{formatTime(order.time)}</span>
            <span role="cell" className={`futures-workstation-dock-side is-${sideTone(order.side)}`}>
              {order.side}
            </span>
            <span role="cell">{order.type}{order.reduceOnly ? ' · RO' : ''}</span>
            {/* A market order carries no limit price and an unfilled order no
                average: the exchange reports 0 for both, and 0.000 in a price column
                reads as a level rather than as an absence. */}
            <span role="cell">{formatPriceOrAbsent(order.price, tickOf(order.symbol))}</span>
            <span role="cell">{order.executedQty} / {order.origQty}</span>
            <span role="cell">{formatPriceOrAbsent(order.averagePrice, tickOf(order.symbol))}</span>
            <span role="cell" className="futures-workstation-dock-status">{order.status}</span>
          </div>
        ))}
      </div>
      {reach(orders)}
    </>
  )
}

export default memo(FuturesHistoryPanel)
