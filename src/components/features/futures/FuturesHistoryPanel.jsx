import { memo } from 'react'
import { formatSignedUsdt } from '../../../utils/futuresOrderPresentation.js'
import { formatExchangePrice, formatUsdtAmount } from '../../../utils/futuresPriceFormat.js'

const EMPTY_ROWS = Object.freeze([])

const formatTime = (timestamp) => {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return '—'
  const date = new Date(timestamp)
  return `${date.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
}

const sideTone = side => (String(side).toUpperCase() === 'SELL' ? 'sell' : 'buy')

// What happened, and what it cost. Realized PnL is the number a trader reviews
// a session with, so it is the one column that never abbreviates its sign.
export const FuturesHistoryPanel = ({ view, symbol, history = null, tickSize = null }) => {
  const owned = history?.symbol === symbol
  const status = owned ? history?.status ?? 'idle' : 'idle'
  const orders = owned && Array.isArray(history?.orders) ? history.orders : EMPTY_ROWS
  const trades = owned && Array.isArray(history?.trades) ? history.trades : EMPTY_ROWS

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
        {status === 'loading' ? `Loading ${symbol} history…` : `Open history to load ${symbol}.`}
      </p>
    )
  }

  if (view === 'tradeHistory') {
    if (trades.length === 0) {
      return <p className="futures-workstation-empty">No trades on {symbol}.</p>
    }
    return (
      <div className="futures-workstation-dock-table" role="table" aria-label="Trade history">
        <div className="futures-workstation-dock-row is-head is-trades" role="row">
          <span role="columnheader">Time</span>
          <span role="columnheader">Side</span>
          <span role="columnheader">Price</span>
          <span role="columnheader">Qty</span>
          <span role="columnheader">Fee</span>
          <span role="columnheader">Realized PnL</span>
        </div>
        {trades.map((trade) => {
          const realized = Number(trade.realizedPnl)
          const tone = !Number.isFinite(realized) || realized === 0
            ? 'flat'
            : realized > 0 ? 'positive' : 'negative'
          return (
            <div className={`futures-workstation-dock-row is-trades is-${sideTone(trade.side)}`} role="row" key={trade.id}>
              <span role="cell">{formatTime(trade.time)}</span>
              <span role="cell" className={`futures-workstation-dock-side is-${sideTone(trade.side)}`}>
                {trade.side}
              </span>
              <span role="cell">{formatExchangePrice(trade.price, tickSize)}</span>
              <span role="cell">{trade.quantity}</span>
              <span role="cell">{formatUsdtAmount(trade.commission, 4)}</span>
              <span role="cell" className={`futures-workstation-dock-pnl is-${tone}`}>
                <strong>{formatSignedUsdt(trade.realizedPnl)}</strong>
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  if (orders.length === 0) {
    return <p className="futures-workstation-empty">No orders on {symbol}.</p>
  }
  return (
    <div className="futures-workstation-dock-table" role="table" aria-label="Order history">
      <div className="futures-workstation-dock-row is-head is-order-history" role="row">
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
          className={`futures-workstation-dock-row is-order-history is-${sideTone(order.side)}`}
          role="row"
          key={`${order.orderId}:${order.time}`}
        >
          <span role="cell">{formatTime(order.time)}</span>
          <span role="cell" className={`futures-workstation-dock-side is-${sideTone(order.side)}`}>
            {order.side}
          </span>
          <span role="cell">{order.type}{order.reduceOnly ? ' · RO' : ''}</span>
          <span role="cell">{formatExchangePrice(order.price, tickSize)}</span>
          <span role="cell">{order.executedQty} / {order.origQty}</span>
          <span role="cell">{formatExchangePrice(order.averagePrice, tickSize)}</span>
          <span role="cell" className="futures-workstation-dock-status">{order.status}</span>
        </div>
      ))}
    </div>
  )
}

export default memo(FuturesHistoryPanel)
