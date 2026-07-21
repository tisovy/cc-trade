import { memo, useEffect, useRef, useState } from 'react'
import {
  calculateFuturesNotionalForPercent,
  calculateFuturesNotionalPercent,
  deriveFuturesLimitOrderDraft,
  isFuturesDraftAmountWithinBudget,
  normalizeFuturesDraftPrice,
} from '../../../utils/futuresOrderDraft.js'
import './FuturesProductionExecutionTicket.css'

const SIZE_ANCHORS = Object.freeze([0, 25, 50, 75, 100])
const EXACT_POSITIVE_DECIMAL = /^(?:[1-9][0-9]*|0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*\.[0-9]+)$/

const ORDER_ACTIONS = Object.freeze([
  Object.freeze({
    key: 'LONG_ENTRY', side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', label: 'LONG entry',
  }),
  Object.freeze({
    key: 'LONG_EXIT', side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT', label: 'LONG exit',
  }),
  Object.freeze({
    key: 'SHORT_ENTRY', side: 'SELL', positionSide: 'SHORT', positionEffect: 'ENTRY', label: 'SHORT entry',
  }),
  Object.freeze({
    key: 'SHORT_EXIT', side: 'BUY', positionSide: 'SHORT', positionEffect: 'EXIT', label: 'SHORT exit',
  }),
])

const DRAFT_REASON_MESSAGES = Object.freeze({
  INVALID_DRAFT_INPUT: 'Price or Binance symbol filters are unavailable',
  BELOW_MINIMUM_QUANTITY: 'Size is below the Binance minimum quantity',
  ABOVE_MAXIMUM_QUANTITY: 'Size is above the Binance maximum quantity',
  BELOW_MINIMUM_NOTIONAL: 'Size is below the Binance minimum notional',
})

const isExactPositiveDecimal = value => (
  typeof value === 'string' && value.length <= 42 && EXACT_POSITIVE_DECIMAL.test(value)
)
const exactText = value => (typeof value === 'string' && value.length > 0 ? value : '—')

const deriveReadiness = ({ connected, selectedContractTradable, balances, hasFilters, tradingPaused }) => {
  if (!connected) {
    return { tone: 'attention', label: 'OFFLINE', reason: 'Local backend connection unavailable — reconnect.' }
  }
  if (tradingPaused) {
    return { tone: 'attention', label: 'PAUSED', reason: 'Trading is paused — new orders are blocked until you resume.' }
  }
  if (!selectedContractTradable) {
    return { tone: 'attention', label: 'CONTRACT', reason: 'Select an active USDⓈ-M contract.' }
  }
  if (!hasFilters) {
    return { tone: 'loading', label: 'METADATA', reason: 'Loading Binance symbol filters…' }
  }
  if (balances === null) {
    return { tone: 'loading', label: 'SYNC', reason: 'Loading Futures account state…' }
  }
  return { tone: 'live', label: 'READY', reason: 'Futures trading ready — orders submit immediately.' }
}

const FuturesTradingTicket = ({
  state,
  selectedSymbol = 'BTCUSDT',
  selectedContract = null,
  draftPrice = null,
  gestureRequest = null,
  orderAmendRequest = null,
  onDraftPriceChange,
}) => {
  const safeState = state ?? {}
  const balances = safeState.balances ?? null
  const openOrders = Array.isArray(safeState.openOrders) ? safeState.openOrders : []
  const positions = Array.isArray(safeState.positions) ? safeState.positions : []
  const [tab, setTab] = useState('trade')
  const [sizePercent, setSizePercent] = useState(25)
  const [customNotionalUsdt, setCustomNotionalUsdt] = useState(null)
  const [localPrice, setLocalPrice] = useState('')
  const handledGestureRef = useRef(null)
  const handledAmendmentRef = useRef(null)

  const price = typeof draftPrice === 'string' ? draftPrice : localPrice
  const updatePrice = (nextPrice) => {
    if (typeof onDraftPriceChange === 'function') onDraftPriceChange(nextPrice)
    else setLocalPrice(nextPrice)
  }

  const selectedContractTradable = selectedContract?.symbol === selectedSymbol
    && selectedContract?.tradable === true
  const tickSize = selectedContract?.filters?.price?.tickSize
  const stepSize = selectedContract?.filters?.quantity?.stepSize
  const minQuantity = selectedContract?.filters?.quantity?.min
  const maxQuantity = selectedContract?.filters?.quantity?.max
  const minNotionalUsdt = selectedContract?.filters?.minimumNotional
  const hasFilters = isExactPositiveDecimal(tickSize)
    && isExactPositiveDecimal(stepSize)
    && isExactPositiveDecimal(minQuantity)
    && isExactPositiveDecimal(maxQuantity)
    && isExactPositiveDecimal(minNotionalUsdt)

  const availableUsdt = typeof balances?.USDT?.available === 'string'
    ? balances.USDT.available
    : null
  const sizingBudget = availableUsdt !== null && isExactPositiveDecimal(availableUsdt)
    ? availableUsdt
    : null
  const sizingReady = sizingBudget !== null && hasFilters
  const notionalUsdt = sizingReady
    ? customNotionalUsdt ?? calculateFuturesNotionalForPercent(sizingBudget, sizePercent) ?? ''
    : ''
  const displayedSizePercent = customNotionalUsdt === null
    ? sizePercent
    : calculateFuturesNotionalPercent(customNotionalUsdt, sizingBudget) ?? 0

  const deriveDraft = candidatePrice => deriveFuturesLimitOrderDraft({
    notionalUsdt,
    price: candidatePrice,
    tickSize,
    stepSize,
    minQuantity,
    maxQuantity,
    minNotionalUsdt,
    leverage: 1,
  })
  const orderDraft = deriveDraft(price)
  const amountWithinBudget = isFuturesDraftAmountWithinBudget(notionalUsdt, sizingBudget)

  const tradingPaused = safeState.tradingPaused === true
  const readiness = deriveReadiness({
    connected: safeState.connected === true,
    selectedContractTradable,
    balances,
    hasFilters,
    tradingPaused,
  })
  const canSubmit = readiness.label === 'READY' && sizingReady && amountWithinBudget

  const submitLimitOrder = (action, candidatePrice) => {
    if (!canSubmit || typeof safeState.placeOrder !== 'function') return false
    const draft = deriveDraft(candidatePrice)
    if (!draft.ok) return false
    return safeState.placeOrder({
      symbol: selectedSymbol,
      side: action.side,
      orderType: 'LIMIT',
      price: draft.price,
      quantity: draft.quantity,
      ...(action.positionEffect === 'EXIT' ? { reduceOnly: true } : {}),
    })
  }

  // Chart/book gestures place immediately, exactly like a spot ticket submit.
  useEffect(() => {
    if (!gestureRequest || handledGestureRef.current === gestureRequest.id) return
    handledGestureRef.current = gestureRequest.id
    const action = ORDER_ACTIONS.find(candidate => (
      candidate.side === gestureRequest.side
      && candidate.positionSide === gestureRequest.positionSide
      && candidate.positionEffect === gestureRequest.positionEffect
    ))
    if (!action) return
    submitLimitOrder(action, normalizeFuturesDraftPrice(gestureRequest.price, tickSize) ?? gestureRequest.price)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureRequest])

  // Ctrl/Alt-dragging an order line moves it: cancel + re-place at the new
  // price. Skipped entirely while paused so a drag cannot cancel an order
  // that the paused backend would then refuse to re-place.
  useEffect(() => {
    if (!orderAmendRequest || handledAmendmentRef.current === orderAmendRequest.id) return
    handledAmendmentRef.current = orderAmendRequest.id
    if (tradingPaused) return
    if (typeof safeState.cancelOrder !== 'function' || typeof safeState.placeOrder !== 'function') return
    const target = openOrders.find(order => (
      order.clientOrderId === orderAmendRequest.clientOrderId
      || String(order.orderId) === String(orderAmendRequest.orderId)
    ))
    if (!target) return
    const nextPrice = normalizeFuturesDraftPrice(orderAmendRequest.price, tickSize)
      ?? orderAmendRequest.price
    const remaining = Number(target.origQty) - Number(target.z ?? target.executedQty ?? 0)
    if (!Number.isFinite(remaining) || remaining <= 0) return
    safeState.cancelOrder({ symbol: target.symbol, orderId: target.orderId })
    safeState.placeOrder({
      symbol: target.symbol,
      side: target.side,
      orderType: 'LIMIT',
      price: nextPrice,
      quantity: remaining,
      ...(target.positionSide && target.positionSide !== 'BOTH'
        ? { positionSide: target.positionSide }
        : {}),
      ...(target.reduceOnly === true ? { reduceOnly: true } : {}),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderAmendRequest])

  const gestureAction = ORDER_ACTIONS.find(candidate => (
    candidate.side === gestureRequest?.side
    && candidate.positionSide === gestureRequest?.positionSide
    && candidate.positionEffect === gestureRequest?.positionEffect
  )) ?? null
  const draftReason = orderDraft.ok
    ? (!amountWithinBudget && sizingReady ? 'Order size exceeds the available balance' : null)
    : (price ? DRAFT_REASON_MESSAGES[orderDraft.reason] ?? null : 'Pick a chart or order-book price')
  const selectedOpenOrders = openOrders.filter(order => order.symbol === selectedSymbol)
  const lastError = safeState.lastError ?? null

  return (
    <aside className="futures-production-execution-ticket" aria-label="Futures trading ticket">
      <header className="futures-production-execution-header">
        <div>
          <span className="futures-production-execution-market">FUTURES · USDⓈ-M</span>
          <strong>{selectedSymbol}</strong>
        </div>
        <div className="futures-production-readiness">
          <span className={`futures-production-live is-${readiness.tone}`}>{readiness.label}</span>
          <small role="status">{readiness.reason}</small>
        </div>
        <button
          type="button"
          className={`futures-production-pause-toggle${tradingPaused ? ' is-paused' : ''}`}
          disabled={safeState.connected !== true || typeof safeState.setTradingPaused !== 'function'}
          onClick={() => safeState.setTradingPaused?.(!tradingPaused)}
        >
          {tradingPaused ? 'Resume trading' : 'Pause trading'}
        </button>
      </header>

      <div className="futures-production-tabs" role="tablist" aria-label="Futures trading rail tabs">
        <button type="button" role="tab" aria-selected={tab === 'trade'} onClick={() => setTab('trade')}>Trade</button>
        <button type="button" role="tab" aria-selected={tab === 'orders'} onClick={() => setTab('orders')}>
          Orders <span>{openOrders.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'positions'} onClick={() => setTab('positions')}>
          Positions <span>{positions.length}</span>
        </button>
      </div>

      <div className="futures-production-execution-body">
        {tab === 'trade' ? (
          <section className="futures-production-action is-order" aria-label="Futures order size and shortcuts">
            <div className="futures-production-ticket-symbol">
              <strong>{selectedSymbol}</strong>
              <code className={gestureAction ? `is-${gestureAction.positionSide.toLowerCase()}` : ''}>
                {gestureAction ? gestureAction.label : 'Awaiting shortcut'}
              </code>
            </div>
            <label className="futures-production-price-field">
              <span>Selected price</span>
              <input
                aria-label="Exact limit price"
                type="text"
                inputMode="decimal"
                placeholder="Click chart or order book"
                value={price}
                onChange={event => updatePrice(event.target.value)}
              />
            </label>
            <label className="futures-production-size-slider">
              <span>
                <span>Size</span>
                <output aria-live="polite">
                  <strong>{`${displayedSizePercent}%`}</strong>
                  <b>{notionalUsdt ? `${notionalUsdt} USDT` : '— USDT'}</b>
                </output>
              </span>
              <input
                aria-label="Order size percent"
                type="range"
                min="0"
                max="100"
                step="1"
                value={displayedSizePercent}
                style={{ '--futures-size-fill': `${displayedSizePercent}%` }}
                onChange={(event) => {
                  setCustomNotionalUsdt(null)
                  setSizePercent(Number(event.target.value))
                }}
              />
            </label>
            <div className="futures-production-size-anchors" aria-label="Order size anchors">
              {SIZE_ANCHORS.map(value => (
                <button
                  type="button"
                  key={value}
                  className={displayedSizePercent === value ? 'is-selected' : ''}
                  onClick={() => {
                    setCustomNotionalUsdt(null)
                    setSizePercent(value)
                  }}
                >
                  {value}%
                </button>
              ))}
            </div>
            <label className="futures-production-notional-field">
              <span>Notional, USDT</span>
              <input
                aria-label="Order notional USDT"
                type="text"
                inputMode="decimal"
                placeholder="—"
                disabled={!sizingReady}
                value={notionalUsdt}
                onChange={event => setCustomNotionalUsdt(event.target.value)}
              />
            </label>
            <dl className="futures-production-order-summary">
              <div><dt>Price</dt><dd>{orderDraft.ok ? orderDraft.price : exactText(price)}</dd></div>
              <div><dt>Quantity</dt><dd>{orderDraft.ok ? orderDraft.quantity : '—'}</dd></div>
              <div><dt>Available</dt><dd>{availableUsdt ? `${availableUsdt} USDT` : '—'}</dd></div>
            </dl>
            {draftReason ? <p className="futures-production-draft-reason" role="status">{draftReason}</p> : null}
            <div className="futures-production-manual-actions" aria-label="Manual Futures orders">
              {ORDER_ACTIONS.map(action => (
                <button
                  type="button"
                  key={action.key}
                  className={`is-${action.positionSide.toLowerCase()} is-${action.positionEffect.toLowerCase()}`}
                  disabled={!canSubmit || !orderDraft.ok}
                  onClick={() => submitLimitOrder(action, price)}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div className="futures-production-shortcuts" aria-label="Futures mouse shortcuts">
              <span><kbd>Alt</kbd><b>×2 left</b><em>LONG entry</em></span>
              <span><kbd>Alt</kbd><b>×2 right</b><em>LONG exit</em></span>
              <span><kbd>Ctrl</kbd><b>×2 right</b><em>SHORT entry</em></span>
              <span><kbd>Ctrl</kbd><b>×2 left</b><em>SHORT exit</em></span>
              <small>Ctrl/Alt + drag an order line to move it</small>
            </div>
          </section>
        ) : tab === 'orders' ? (
          <section className="futures-production-orders" role="tabpanel" aria-label="Current Futures orders">
            <header className="futures-production-portfolio-heading">
              <div>
                <strong>Open orders</strong>
                <span>{openOrders.length} account-wide · {selectedOpenOrders.length} {selectedSymbol}</span>
              </div>
              <button
                type="button"
                aria-label="Refresh positions and orders"
                title="Refresh positions and orders"
                disabled={typeof safeState.refresh !== 'function'}
                onClick={() => safeState.refresh?.(selectedSymbol)}
              >
                ↻
              </button>
            </header>
            {openOrders.length === 0
              ? <p>No active Futures orders.</p>
              : openOrders.map(order => (
                <article
                  className={`${order.symbol === selectedSymbol ? 'is-current-symbol' : ''} is-${(order.positionSide ?? 'both').toLowerCase()}`}
                  key={`${order.symbol}:${order.orderId}`}
                >
                  <header>
                    <div><strong>{order.symbol}</strong><span>{order.side} · {order.positionSide ?? 'BOTH'}</span></div>
                    <code>{order.status}</code>
                  </header>
                  <dl>
                    <div><dt>Type</dt><dd>{order.type}</dd></div>
                    <div><dt>Price</dt><dd>{order.price}</dd></div>
                    <div><dt>Original qty</dt><dd>{order.origQty}</dd></div>
                    <div><dt>Filled qty</dt><dd>{order.z ?? '0'}</dd></div>
                  </dl>
                  <div>
                    <button
                      type="button"
                      onClick={() => safeState.cancelOrder?.({ symbol: order.symbol, orderId: order.orderId })}
                    >
                      Cancel
                    </button>
                  </div>
                </article>
              ))}
            {selectedOpenOrders.length > 0 ? (
              <button
                type="button"
                className="futures-production-cancel-all"
                onClick={() => safeState.cancelAll?.(selectedSymbol)}
              >
                Cancel all {selectedSymbol}
              </button>
            ) : null}
          </section>
        ) : (
          <section className="futures-production-positions" role="tabpanel" aria-label="Open positions">
            <header className="futures-production-portfolio-heading">
              <div><strong>Positions</strong><span>{positions.length} open</span></div>
              <button
                type="button"
                aria-label="Refresh positions and orders"
                title="Refresh positions and orders"
                disabled={typeof safeState.refresh !== 'function'}
                onClick={() => safeState.refresh?.(selectedSymbol)}
              >
                ↻
              </button>
            </header>
            {positions.length === 0
              ? <p>No open positions.</p>
              : positions.map(position => (
                <article
                  className={`is-${(position.positionSide ?? 'both').toLowerCase()}`}
                  key={`${position.symbol}:${position.positionSide}`}
                >
                  <header><strong>{position.symbol}</strong><span>{position.positionSide}</span></header>
                  <dl>
                    <div><dt>Qty</dt><dd>{exactText(position.quantity)}</dd></div>
                    <div><dt>Entry</dt><dd>{exactText(position.entryPrice)}</dd></div>
                    <div><dt>Mark</dt><dd>{exactText(position.markPrice)}</dd></div>
                    <div><dt>Margin</dt><dd>{position.marginType ?? '—'} · {position.leverage ?? '—'}×</dd></div>
                    <div><dt>UPnL</dt><dd>{exactText(position.unrealizedPnl)} USDT</dd></div>
                    <div><dt>Liq.</dt><dd>{exactText(position.liquidationPrice)}</dd></div>
                  </dl>
                  <div>
                    <button
                      type="button"
                      onClick={() => safeState.closePosition?.(position)}
                    >
                      Close (market)
                    </button>
                  </div>
                </article>
              ))}
          </section>
        )}

        {lastError ? (
          <section className="futures-production-backend-card is-rejected" aria-label="Futures command rejection">
            <strong>{lastError.code}</strong>
            <code>{lastError.message}</code>
          </section>
        ) : null}
      </div>
    </aside>
  )
}

export default memo(FuturesTradingTicket)
