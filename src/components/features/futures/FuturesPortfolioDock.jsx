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
import { exactFuturesDeskTime, formatFuturesDeskTime } from '../../../utils/futuresDeskTime.js'
import FuturesHistoryPanel from './FuturesHistoryPanel.jsx'

const EMPTY_ROWS = Object.freeze([])
const EMPTY_TICKS = Object.freeze({})

const exactText = value => (
  typeof value === 'string' && value.length > 0 ? value : (value ?? '—')
)

// Short enough for a table cell, and never guessed: a read that established no
// mode says nothing rather than defaulting to one of the two.
const marginModeLabel = mode => (
  mode === 'ISOLATED' ? 'ISO' : mode === 'CROSS' ? 'CROSS' : ''
)

// Positions and working orders live under the chart because they are what a
// trader watches continuously — a tab you have to open is a tab you forget.
// What a list of no rows means: nothing open, or nothing read yet. The dock used
// to say "0 open" and "No open positions." before the first account read had
// even answered, which is the one reading an operator must never be given
// falsely — a flat account and an unknown account call for opposite actions.
//
// No resource at all is the same unknown: a dock wired to a workstation with no
// execution state behind it knows nothing about the account, and the honest
// reading of nothing is "not read", not "nothing there".
const EMPTY_RESOURCES = Object.freeze({})
const describeRowsAvailability = (resources) => {
  const everRead = resources.length > 0
    && resources.every(resource => resource?.lastSuccessfulAt != null)
  if (everRead) return { known: true, label: null }
  const failed = resources.some(resource => resource?.status === 'error')
  return {
    known: false,
    label: failed ? 'Not read — the account read failed.' : 'Not read yet.',
  }
}

export const FuturesPortfolioDock = ({
  selectedSymbol,
  positions = EMPTY_ROWS,
  openOrders = EMPTY_ROWS,
  accountResources = EMPTY_RESOURCES,
  tickSizes = EMPTY_TICKS,
  history = null,
  onClosePosition,
  onCancelOrder,
  onOrderEdit,
  onMarginEdit,
  onLeverageEdit,
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
  // A caller that passes the account state through may pass null for it.
  const resources = accountResources ?? EMPTY_RESOURCES
  const positionsAvailability = describeRowsAvailability(
    [resources.positions].filter(Boolean),
  )
  const ordersAvailability = describeRowsAvailability(
    [resources.regularOrders, resources.algoOrders].filter(Boolean),
  )

  // Selecting a view reads nothing. The review is a reading the desk holds —
  // read once when the workspace opens, maintained by the stream, and re-read
  // only by the control beside it. Every click here used to cost an
  // account-wide fan-out of about twenty-five requests.
  const historyStatus = history?.status ?? 'idle'
  const historyReading = historyStatus === 'loading' || historyStatus === 'refreshing'
  const historyReadAt = history?.readAt ?? null

  return (
    <section className="futures-workstation-dock" aria-label="Futures positions and working orders">
      <div className="futures-workstation-dock-panel">
        <header>
          <div>
            <span>Positions</span>
            <strong>{positionsAvailability.known ? `${positions.length} open` : '— open'}</strong>
          </div>
          <div className={`futures-workstation-dock-total is-${totalTone}`}>
            <span>Total uPnL</span>
            <strong>{formatSignedUsdt(totalUnrealizedPnl)} USDT</strong>
          </div>
        </header>
        {describedPositions.length === 0 ? (
          <p className="futures-workstation-empty">
            {positionsAvailability.known ? 'No open positions.' : positionsAvailability.label}
          </p>
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
              {/* The rule, stated once where the number it governs is read. */}
              <span
                role="columnheader"
                title={'Between two marks the uPnL is the desk\u2019s arithmetic on the last '
                  + 'traded price and is underlined; on a mark it is the exchange\u2019s own '
                  + 'figure. Liquidation is always the mark.'}
              >
                uPnL (ROE)
              </span>
              <span role="columnheader" />
            </div>
            {describedPositions.map(({ position, presentation, margin }) => (
              <div
                className={`futures-workstation-dock-row is-${presentation.tone}${position.symbol === selectedSymbol ? ' is-current-symbol' : ''}`}
                role="row"
                key={`${position.symbol}:${position.positionSide}`}
              >
                {/* The contract and the leverage it is carried at, the way the
                    exchange's own position list reads them: the multiple is a
                    property of the instrument, not of the money, and it is the
                    control that sets it. */}
                <span role="cell" className="futures-workstation-dock-instrument">
                  <button
                    type="button"
                    className="futures-workstation-dock-symbol"
                    aria-label={`Show ${position.symbol}`}
                    onClick={() => onSymbolChange?.(position.symbol)}
                  >
                    {position.symbol}
                  </button>
                  {typeof onLeverageEdit === 'function' ? (
                    <button
                      type="button"
                      className="futures-workstation-dock-leverage"
                      aria-label={`Set ${position.symbol} leverage`}
                      title={position.leverage
                        ? `${position.leverage}× leverage — click to change it`
                        : 'Leverage not reported yet — click to set it'}
                      onClick={event => onLeverageEdit(position.symbol, {
                        x: event.clientX,
                        y: event.clientY,
                      })}
                    >
                      {position.leverage ? `${position.leverage}×` : 'Lev'}
                    </button>
                  ) : null}
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
                    cannot be adjusted is stated. The mode is spelled out rather
                    than left to the underline: the two are not two styles of
                    one thing, only one of them can be moved at all. It leads the
                    amount rather than trailing it — after the digits it read as
                    part of the number, like a stray fraction of a cent. */}
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
                      <em>{marginModeLabel(margin.marginMode)}</em>
                      {formatUsdt(margin.margin)}
                    </button>
                  ) : (
                    <span className="futures-workstation-dock-margin is-static">
                      <em>{marginModeLabel(margin.marginMode)}</em>
                      {margin.margin === null ? '—' : formatUsdt(margin.margin)}
                    </span>
                  )}
                </span>
                {/* Both figures in the title as well as on screen: the column is
                    the narrowest thing carrying the widest number, and a uPnL that
                    outgrows it must still be readable exactly. */}
                <span
                  role="cell"
                  className={`futures-workstation-dock-pnl is-${presentation.pnlTone}${presentation.pnlEstimated ? ' is-estimated' : ''}`}
                  title={`${formatSignedUsdt(presentation.unrealizedPnl)} USDT · ${formatSignedPercent(presentation.roePercent)} on margin${presentation.pnlEstimated ? ' · from the last traded price, until the next mark confirms it' : ''}`}
                >
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
              Working <strong>{ordersAvailability.known ? openOrders.length : '—'}</strong>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ordersTab === 'orderHistory'}
              onClick={() => setOrdersTab('orderHistory')}
            >
              Order history
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ordersTab === 'tradeHistory'}
              onClick={() => setOrdersTab('tradeHistory')}
            >
              {/* Named for what it lists, so it cannot be read as a filtered view
                  of the live positions panel above it — which is exactly how it
                  was read when it still showed open rounds. */}
              Closed positions
            </button>
          </div>
          {ordersTab === 'working' ? null : (
            <div className="futures-workstation-dock-history-read">
              {/* How old what is on screen is. Without it a reading held from
                  the start of the session reads exactly like one taken now. */}
              <span
                className="futures-workstation-dock-history-age"
                title={historyReadAt === null
                  ? undefined
                  : `Account history read ${exactFuturesDeskTime(historyReadAt)}`}
              >
                {historyReading
                  ? 'reading…'
                  : historyReadAt === null
                    ? 'not read'
                    : `read ${formatFuturesDeskTime(historyReadAt)}`}
              </span>
              <button
                type="button"
                className="futures-workstation-dock-close"
                aria-label="Re-read account history"
                title="Read only the account history that may have changed"
                disabled={historyReading || typeof onLoadHistory !== 'function'}
                onClick={() => onLoadHistory?.(selectedSymbol)}
              >
                ↻
              </button>
              <button
                type="button"
                className="futures-workstation-dock-close"
                aria-label="Read full account history"
                title="Run discovery and read the full account history window"
                disabled={historyReading || typeof onLoadHistory !== 'function'}
                onClick={() => onLoadHistory?.(selectedSymbol, { full: true })}
              >
                Full
              </button>
            </div>
          )}
        </header>

        {ordersTab !== 'working' ? (
          <FuturesHistoryPanel
            view={ordersTab}
            symbol={selectedSymbol}
            history={history}
            tickSizes={tickSizes}
            onSymbolChange={onSymbolChange}
          />
        ) : openOrders.length === 0 ? (
          <p className="futures-workstation-empty">
            {ordersAvailability.known ? 'No working orders.' : ordersAvailability.label}
          </p>
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
