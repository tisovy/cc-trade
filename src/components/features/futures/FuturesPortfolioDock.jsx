import { memo, useMemo, useState } from 'react'
import {
  describeFuturesOrderIntent,
  describeFuturesPosition,
  describeFuturesPositionMargin,
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
  orderNotionalUsdt,
} from '../../../utils/futuresOrderPresentation.js'
import { formatExchangePrice } from '../../../utils/futuresPriceFormat.js'
import FuturesHistoryPanel from './FuturesHistoryPanel.jsx'

const EMPTY_ROWS = Object.freeze([])
const EMPTY_TICKS = Object.freeze({})

const exactText = value => (
  typeof value === 'string' && value.length > 0 ? value : (value ?? '—')
)

// Positions and working orders live under the chart because they are what a
// trader watches continuously — a tab you have to open is a tab you forget.
export const FuturesPortfolioDock = ({
  selectedSymbol,
  positions = EMPTY_ROWS,
  openOrders = EMPTY_ROWS,
  tickSizes = EMPTY_TICKS,
  history = null,
  onClosePosition,
  onCancelOrder,
  onOrderEdit,
  onMarginEdit,
  onSymbolChange,
  onSizePick,
  onLoadHistory,
}) => {
  const [ordersTab, setOrdersTab] = useState('working')
  const describedPositions = useMemo(() => positions.map(position => ({
    position,
    presentation: describeFuturesPosition(position),
    margin: describeFuturesPositionMargin(position),
  })), [positions])
  const totalUnrealizedPnl = useMemo(() => describedPositions.reduce((total, entry) => (
    entry.presentation.unrealizedPnl === null ? total : total + entry.presentation.unrealizedPnl
  ), 0), [describedPositions])
  const totalTone = totalUnrealizedPnl > 0
    ? 'positive'
    : totalUnrealizedPnl < 0 ? 'negative' : 'flat'
  const priceOf = (symbol, value) => formatExchangePrice(value, tickSizes[symbol] ?? null)

  const openHistory = (tab) => {
    setOrdersTab(tab)
    onLoadHistory?.(selectedSymbol)
  }

  return (
    <section className="futures-workstation-dock" aria-label="Futures positions and working orders">
      <div className="futures-workstation-dock-panel">
        <header>
          <div>
            <span>Positions</span>
            <strong>{positions.length} open</strong>
          </div>
          <div className={`futures-workstation-dock-total is-${totalTone}`}>
            <span>Total uPnL</span>
            <strong>{formatSignedUsdt(totalUnrealizedPnl)} USDT</strong>
          </div>
        </header>
        {describedPositions.length === 0 ? (
          <p className="futures-workstation-empty">No open positions.</p>
        ) : (
          <div className="futures-workstation-dock-table" role="table" aria-label="Open positions">
            <div className="futures-workstation-dock-row is-head" role="row">
              <span role="columnheader">Symbol</span>
              <span role="columnheader">Side</span>
              <span role="columnheader">Size (USDT)</span>
              <span role="columnheader">Entry</span>
              <span role="columnheader">Mark</span>
              <span role="columnheader">Liq.</span>
              <span role="columnheader">Margin</span>
              <span role="columnheader">uPnL (ROE)</span>
              <span role="columnheader" />
            </div>
            {describedPositions.map(({ position, presentation, margin }) => (
              <div
                className={`futures-workstation-dock-row is-${presentation.tone}${position.symbol === selectedSymbol ? ' is-current-symbol' : ''}`}
                role="row"
                key={`${position.symbol}:${position.positionSide}`}
              >
                <span role="cell">
                  <button
                    type="button"
                    className="futures-workstation-dock-symbol"
                    aria-label={`Show ${position.symbol}`}
                    onClick={() => onSymbolChange?.(position.symbol)}
                  >
                    {position.symbol}
                  </button>
                </span>
                <span role="cell" className={`futures-workstation-dock-side is-${presentation.tone}`}>
                  {presentation.positionSide}
                </span>
                <span role="cell">
                  {position.symbol === selectedSymbol
                    && presentation.absoluteQuantity !== null
                    && typeof onSizePick === 'function' ? (
                      <button
                        type="button"
                        className="futures-workstation-dock-size"
                        aria-label={`Size the ticket for the whole ${position.symbol} position`}
                        title={`${exactText(position.quantity)} contracts — size the ticket for the whole position`}
                        onClick={() => onSizePick(presentation.absoluteQuantity)}
                      >
                        {formatUsdt(presentation.markNotional)}
                      </button>
                    ) : (
                      <span title={`${exactText(position.quantity)} contracts`}>
                        {formatUsdt(presentation.markNotional)}
                      </span>
                    )}
                </span>
                <span role="cell">{priceOf(position.symbol, position.entryPrice)}</span>
                <span role="cell">{priceOf(position.symbol, position.markPrice)}</span>
                <span role="cell" className="futures-workstation-dock-liquidation">
                  {priceOf(position.symbol, position.liquidationPrice)}
                </span>
                {/* The denominator of the ROE beside it, and the only property
                    of a live position the operator can change without trading.
                    Cross rows open the panel too — it is where the reason they
                    cannot be adjusted is stated. */}
                <span role="cell">
                  {margin.margin !== null && typeof onMarginEdit === 'function' ? (
                    <button
                      type="button"
                      className={`futures-workstation-dock-margin is-${margin.marginMode === 'CROSS' ? 'cross' : 'isolated'}`}
                      aria-label={`Adjust margin on the ${position.symbol} ${presentation.positionSide} position`}
                      title={margin.marginMode === 'CROSS'
                        ? 'Cross margin — backed by the whole account'
                        : 'Isolated margin — click to add or remove'}
                      onClick={event => onMarginEdit(position, {
                        x: event.clientX,
                        y: event.clientY,
                      })}
                    >
                      {formatUsdt(margin.margin)}
                    </button>
                  ) : (
                    <span>{margin.margin === null ? '—' : formatUsdt(margin.margin)}</span>
                  )}
                </span>
                <span role="cell" className={`futures-workstation-dock-pnl is-${presentation.pnlTone}`}>
                  <strong>{formatSignedUsdt(presentation.unrealizedPnl)}</strong>
                  <em>{formatSignedPercent(presentation.roePercent)}</em>
                </span>
                <span role="cell">
                  <button
                    type="button"
                    className="futures-workstation-dock-close"
                    aria-label={`Close ${position.symbol} position`}
                    disabled={typeof onClosePosition !== 'function'}
                    onClick={event => onClosePosition?.(position, {
                      x: event.clientX,
                      y: event.clientY,
                    })}
                  >
                    Close
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="futures-workstation-dock-panel">
        <header>
          <div className="futures-workstation-dock-tabs" role="tablist" aria-label="Order views">
            <button
              type="button"
              role="tab"
              aria-selected={ordersTab === 'working'}
              onClick={() => setOrdersTab('working')}
            >
              Working <strong>{openOrders.length}</strong>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ordersTab === 'orderHistory'}
              onClick={() => openHistory('orderHistory')}
            >
              Order history
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ordersTab === 'tradeHistory'}
              onClick={() => openHistory('tradeHistory')}
            >
              Trades (PnL)
            </button>
          </div>
          {ordersTab === 'working' ? null : (
            <button
              type="button"
              className="futures-workstation-dock-close"
              aria-label="Reload history"
              onClick={() => onLoadHistory?.(selectedSymbol)}
            >
              ↻
            </button>
          )}
        </header>

        {ordersTab !== 'working' ? (
          <FuturesHistoryPanel
            view={ordersTab}
            symbol={selectedSymbol}
            history={history}
            tickSize={tickSizes[selectedSymbol] ?? null}
          />
        ) : openOrders.length === 0 ? (
          <p className="futures-workstation-empty">No working orders.</p>
        ) : (
          <div className="futures-workstation-dock-table" role="table" aria-label="Working orders">
            <div className="futures-workstation-dock-row is-head is-orders" role="row">
              <span role="columnheader">Symbol</span>
              <span role="columnheader">Side</span>
              <span role="columnheader">Intent</span>
              <span role="columnheader">Price</span>
              <span role="columnheader">Size (USDT)</span>
              <span role="columnheader">Filled</span>
              <span role="columnheader" />
            </div>
            {openOrders.map((order) => {
              const intent = describeFuturesOrderIntent(order)
              const editable = order.orderKind !== 'ALGO' && typeof onOrderEdit === 'function'
              return (
                <div
                  className={`futures-workstation-dock-row is-orders is-${intent.tone}${order.symbol === selectedSymbol ? ' is-current-symbol' : ''}${editable ? ' is-editable' : ''}`}
                  role="row"
                  key={`${order.orderKind ?? 'REGULAR'}:${order.symbol}:${order.orderId}`}
                  // Every order surface opens the same editor; the row's own
                  // controls stop the event so Cancel never opens a panel.
                  onClick={editable
                    ? event => onOrderEdit(order, { x: event.clientX, y: event.clientY })
                    : undefined}
                >
                  <span role="cell">
                    <button
                      type="button"
                      className="futures-workstation-dock-symbol"
                      aria-label={`Show ${order.symbol}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSymbolChange?.(order.symbol)
                      }}
                    >
                      {order.symbol}
                    </button>
                  </span>
                  <span role="cell" className={`futures-workstation-dock-side is-${intent.tone}`}>
                    {intent.side}
                  </span>
                  <span role="cell">
                    {order.orderKind === 'ALGO' ? 'ALGO · ' : ''}{intent.label}
                  </span>
                  <span role="cell">{exactText(order.triggerPrice ?? order.price)}</span>
                  {/* Sized the way the ticket, the editor and the chart label
                      size it, so one order reads as one number everywhere. The
                      contract count is what the exchange works in, so it stays
                      exact on hover rather than disappearing. */}
                  <span role="cell" title={`${exactText(order.origQty)} contracts`}>
                    {orderNotionalUsdt(order) ?? '—'}
                  </span>
                  <span role="cell">{exactText(order.z ?? '0')}</span>
                  <span role="cell">
                    {order.orderKind === 'ALGO' ? (
                      <em className="futures-workstation-dock-managed">on Binance</em>
                    ) : (
                      <button
                        type="button"
                        className="futures-workstation-dock-cancel"
                        aria-label={`Cancel ${order.symbol} ${intent.side} order at ${order.price}`}
                        disabled={typeof onCancelOrder !== 'function'}
                        onClick={(event) => {
                          event.stopPropagation()
                          onCancelOrder?.({ symbol: order.symbol, orderId: order.orderId })
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

export default memo(FuturesPortfolioDock)
