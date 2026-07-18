import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FUTURES_WORKSTATION_INTERVALS } from '../../../utils/futuresWorkstationProtocolShared.js'
import { resolveFuturesTradingGesture } from '../../../utils/futuresTradingGestures.js'
import FuturesWorkstationChart from './FuturesWorkstationChart.jsx'
import './FuturesWorkstation.css'

const EMPTY_ROWS = Object.freeze([])
const IGNORE_PRICE_PICK = () => {}
const VISIBLE_DEPTH_LEVELS_PER_SIDE = 10

const formatTime = (timestamp) => {
  if (!Number.isSafeInteger(timestamp)) return '—'
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const formatCountdown = (target, now) => {
  if (!Number.isSafeInteger(target) || target <= now) return '00:00:00'
  const totalSeconds = Math.floor((target - now) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

const displayPercent = value => value ? `${value}%` : '—'

const FundingCountdown = ({ target }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return <dd>{formatCountdown(target, now)}</dd>
}

const StateBadge = ({ state }) => (
  <span className={`futures-workstation-state is-${state ?? 'loading'}`} role="status">
    {(state ?? 'loading').toUpperCase()}
  </span>
)

const FilterRow = ({ name, filter, stepLabel }) => (
  <div className="futures-workstation-filter-row">
    <strong>{name}</strong>
    {filter ? (
      <code>{filter.min} → {filter.max} · {stepLabel} {filter[stepLabel]}</code>
    ) : <span>Unavailable</span>}
  </div>
)

export const FuturesWorkstationView = ({
  identity,
  state,
  selectedSymbol,
  selectedInterval,
  draftPrice,
  ownedOrders = EMPTY_ROWS,
  tradingRail,
  onDraftPriceChange,
  onTradingGesture,
  onOrderDrag,
  onSymbolChange,
  onIntervalChange,
}) => {
  const [search, setSearch] = useState('')
  const [favorites, setFavorites] = useState(() => new Set(['BTCUSDT']))
  const [localDraftPrice, setLocalDraftPrice] = useState(null)
  const [drawingMode, setDrawingMode] = useState(false)
  const [drawings, setDrawings] = useState(EMPTY_ROWS)
  const [alerts, setAlerts] = useState(EMPTY_ROWS)
  const [tapePaused, setTapePaused] = useState(false)
  const [pausedTrades, setPausedTrades] = useState(EMPTY_ROWS)
  const lastBookLeftClickRef = useRef({ at: 0, price: null, modifier: null, symbol: null })
  const lastBookRightClickRef = useRef({ at: 0, price: null, modifier: null, symbol: null })
  const selectedDraftPrice = draftPrice === undefined ? localDraftPrice : draftPrice

  useEffect(() => {
    lastBookLeftClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
    lastBookRightClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
    // These controls are display-only and belong to one selected-symbol owner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalDraftPrice(null)
    setDrawingMode(false)
    setDrawings(EMPTY_ROWS)
    setAlerts(EMPTY_ROWS)
    setTapePaused(false)
    setPausedTrades(EMPTY_ROWS)
  }, [selectedSymbol])

  const resources = state.resources
  const contracts = resources.catalog?.contracts ?? EMPTY_ROWS
  const header = resources.header
  const candles = resources.candles
  const depth = resources.depth
  const liveTrades = resources.trades?.rows ?? EMPTY_ROWS
  const selectedContract = contracts.find(contract => contract.symbol === selectedSymbol) ?? null
  const aggregateState = state.status === 'idle' ? 'loading' : state.status
  const resourceState = resource => resource?.state ?? aggregateState
  const catalogState = resourceState(resources.catalog)
  const candlesState = resourceState(candles)
  const depthState = resourceState(depth)
  const tradesState = resourceState(resources.trades)

  const visibleContracts = useMemo(() => {
    const query = search.trim().toUpperCase()
    return contracts
      .filter(contract => !query || contract.symbol.includes(query) || contract.baseAsset.includes(query))
      .sort((left, right) => {
        const favoriteDifference = Number(favorites.has(right.symbol)) - Number(favorites.has(left.symbol))
        return favoriteDifference || left.symbol.localeCompare(right.symbol)
      })
      .slice(0, 128)
  }, [contracts, favorites, search])

  const pickPrice = useCallback((price) => {
    if (typeof onDraftPriceChange === 'function') onDraftPriceChange(price)
    else setLocalDraftPrice(price)
    if (drawingMode) {
      setDrawings(previous => Object.freeze([
        ...previous.slice(-15),
        Object.freeze({ id: `drawing-${previous.length + 1}`, price }),
      ]))
    }
  }, [drawingMode, onDraftPriceChange])

  const emitBookGesture = useCallback((event, button, price) => {
    const gesture = resolveFuturesTradingGesture({
      button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
    if (!gesture) return false
    event.preventDefault()
    event.stopPropagation()
    onTradingGesture?.({ ...gesture, price, source: 'order-book' })
    return true
  }, [onTradingGesture])

  const handleBookContextMenu = useCallback((event, price) => {
    const gesture = resolveFuturesTradingGesture({
      button: 'right',
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
    if (!gesture) {
      lastBookRightClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
      return
    }
    event.preventDefault()
    const modifier = event.altKey ? 'alt' : 'ctrl'
    const current = { at: Date.now(), price, modifier, symbol: selectedSymbol }
    const previous = lastBookRightClickRef.current
    lastBookRightClickRef.current = current
    if (current.at - previous.at > 350
      || previous.price !== price
      || previous.modifier !== modifier
      || previous.symbol !== selectedSymbol) return
    lastBookRightClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
    emitBookGesture(event, 'right', price)
  }, [emitBookGesture, selectedSymbol])

  const handleBookClick = useCallback((event, price) => {
    pickPrice(price)
    const gesture = resolveFuturesTradingGesture({
      button: 'left',
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
    if (!gesture) {
      lastBookLeftClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
      return
    }
    const modifier = event.altKey ? 'alt' : 'ctrl'
    const current = { at: Date.now(), price, modifier, symbol: selectedSymbol }
    const previous = lastBookLeftClickRef.current
    lastBookLeftClickRef.current = current
    if (current.at - previous.at > 350
      || previous.price !== price
      || previous.modifier !== modifier
      || previous.symbol !== selectedSymbol) return
    lastBookLeftClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
    emitBookGesture(event, 'left', price)
  }, [emitBookGesture, pickPrice, selectedSymbol])

  const toggleFavorite = useCallback((symbol) => {
    setFavorites((previous) => {
      const next = new Set(previous)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }, [])

  const addDisplayAlert = useCallback(() => {
    if (!selectedDraftPrice) return
    setAlerts(previous => Object.freeze([
      ...previous.slice(-15),
      Object.freeze({ id: `alert-${previous.length + 1}`, price: selectedDraftPrice }),
    ]))
  }, [selectedDraftPrice])

  const toggleTape = useCallback(() => {
    if (!tapePaused) setPausedTrades(liveTrades)
    setTapePaused(previous => !previous)
  }, [liveTrades, tapePaused])

  const displayedTrades = tapePaused ? pausedTrades : liveTrades
  const visibleAsks = [...(depth?.asks ?? EMPTY_ROWS)]
    .slice(0, VISIBLE_DEPTH_LEVELS_PER_SIDE)
    .reverse()
  const visibleBids = (depth?.bids ?? EMPTY_ROWS)
    .slice(0, VISIBLE_DEPTH_LEVELS_PER_SIDE)

  return (
    <section className="futures-workstation" aria-label={`${identity} live trading workstation`}>
      <div className="futures-workstation-identity" data-testid="futures-workstation-identity">
        <strong>{identity}</strong>
        <span>PUBLIC MARKET DATA · LIVE EXECUTION</span>
        <StateBadge state={aggregateState} />
        <code>gen {state.generation || '—'} · rev {state.revision || '—'}</code>
        {state.reasonCode ? (
          <code className="futures-workstation-reason" aria-label="Futures workstation reason">
            reason {state.reasonCode}
          </code>
        ) : null}
      </div>

      <aside className="futures-workstation-instruments" aria-label="USDⓈ-M contract selector">
        <div className="futures-workstation-section-heading">
          <div>
            <span>Contracts</span>
            <strong>USDⓈ-M only</strong>
          </div>
          <StateBadge state={catalogState} />
        </div>
        <label className="futures-workstation-search">
          <span>Search symbol</span>
          <input
            aria-label="Search Futures contracts"
            value={search}
            onChange={event => setSearch(event.target.value.toUpperCase())}
            placeholder="BTC, ETH, SOL…"
            maxLength={20}
          />
        </label>
        <div className="futures-workstation-contract-list">
          {visibleContracts.map(contract => (
            <div
              className={`futures-workstation-contract${contract.symbol === selectedSymbol ? ' is-selected' : ''}`}
              key={contract.symbol}
            >
              <button
                type="button"
                className="futures-workstation-favorite"
                aria-label={`${favorites.has(contract.symbol) ? 'Remove' : 'Add'} ${contract.symbol} favorite`}
                aria-pressed={favorites.has(contract.symbol)}
                onClick={() => toggleFavorite(contract.symbol)}
              >
                {favorites.has(contract.symbol) ? '★' : '☆'}
              </button>
              <button
                type="button"
                className="futures-workstation-contract-select"
                onClick={() => onSymbolChange(contract.symbol)}
                aria-pressed={contract.symbol === selectedSymbol}
              >
                <strong>{contract.symbol}</strong>
                <span>{contract.contractType}</span>
                <small className={contract.allowlisted ? 'is-allowed' : 'is-observe-only'}>
                  {contract.allowlisted ? 'ALLOWLISTED' : 'OBSERVE ONLY'}
                </small>
              </button>
            </div>
          ))}
          {visibleContracts.length === 0 ? (
            <p className="futures-workstation-empty">No matching USDⓈ-M contract.</p>
          ) : null}
        </div>
        {tradingRail}
        {selectedContract ? (
          <details className="futures-workstation-contract-inspector" aria-label="Exact contract filters">
            <summary>Contract filters</summary>
            <div className="futures-workstation-contract-status">
              <span>Status</span>
              <strong>{selectedContract.status}</strong>
              <span className={selectedContract.allowlisted ? 'is-allowed' : 'is-observe-only'}>
                {selectedContract.allowlisted ? 'ALLOWLISTED' : 'NOT ALLOWLISTED'}
              </span>
            </div>
            <p>{selectedContract.baseAsset} / {selectedContract.quoteAsset} · margin {selectedContract.marginAsset}</p>
            <FilterRow name="Price" filter={selectedContract.filters.price} stepLabel="tickSize" />
            <FilterRow name="Quantity" filter={selectedContract.filters.quantity} stepLabel="stepSize" />
            <FilterRow name="Market qty" filter={selectedContract.filters.marketQuantity} stepLabel="stepSize" />
            <div className="futures-workstation-filter-row">
              <strong>Percent price</strong>
              <code>
                {selectedContract.filters.percentPrice.multiplierDown}
                {' → '}
                {selectedContract.filters.percentPrice.multiplierUp}
                {' · decimals '}
                {selectedContract.filters.percentPrice.multiplierDecimal}
              </code>
            </div>
            <div className="futures-workstation-filter-row">
              <strong>Max orders</strong>
              <code>{selectedContract.filters.maximumOrders}</code>
            </div>
            <div className="futures-workstation-filter-row">
              <strong>Max algo orders</strong>
              <code>{selectedContract.filters.maximumAlgoOrders ?? 'Unavailable'}</code>
            </div>
            <div className="futures-workstation-filter-row">
              <strong>Min notional</strong>
              <code>{selectedContract.filters.minimumNotional ?? 'Unavailable'} USDT</code>
            </div>
          </details>
        ) : null}
      </aside>

      <header className="futures-workstation-market-header" aria-label="Futures market header">
        <div className="futures-workstation-symbol-title">
          <span>{selectedContract?.contractType ?? 'CONTRACT'}</span>
          <strong>{selectedSymbol}</strong>
          <small>{selectedContract?.status ?? 'LOADING'}</small>
        </div>
        <dl>
          <div className="is-primary"><dt>Last</dt><dd>{header?.lastPrice ?? '—'}</dd></div>
          <div><dt>Mark</dt><dd>{header?.markPrice ?? '—'}</dd></div>
          <div><dt>Index</dt><dd>{header?.indexPrice ?? '—'}</dd></div>
          <div><dt>Basis</dt><dd>{header?.basis ?? '—'}</dd></div>
          <div><dt>24h change</dt><dd>{displayPercent(header?.priceChangePercent)}</dd></div>
          <div><dt>24h high</dt><dd>{header?.highPrice ?? '—'}</dd></div>
          <div><dt>24h low</dt><dd>{header?.lowPrice ?? '—'}</dd></div>
          <div><dt>24h volume</dt><dd>{header?.volume ?? '—'}</dd></div>
          <div><dt>Funding</dt><dd>{displayPercent(header?.fundingRatePercent)}</dd></div>
          <div><dt>Next funding</dt><FundingCountdown target={header?.nextFundingTime} /></div>
        </dl>
      </header>

      <main className="futures-workstation-chart" data-state={candlesState}>
        <div className="futures-workstation-chart-toolbar">
          <div className="futures-workstation-intervals" role="group" aria-label="Chart interval">
            {FUTURES_WORKSTATION_INTERVALS.map(interval => (
              <button
                type="button"
                key={interval}
                className={interval === selectedInterval ? 'is-selected' : ''}
                aria-pressed={interval === selectedInterval}
                onClick={() => onIntervalChange(interval)}
              >
                {interval}
              </button>
            ))}
          </div>
          <div className="futures-workstation-drawing-tools" role="group" aria-label="Display-only chart tools">
            <button
              type="button"
              className={drawingMode ? 'is-selected' : ''}
              aria-pressed={drawingMode}
              disabled={candlesState !== 'live'}
              onClick={() => setDrawingMode(previous => !previous)}
            >
              Horizontal drawing
            </button>
            <button type="button" onClick={() => setDrawings(EMPTY_ROWS)} disabled={drawings.length === 0}>
              Clear drawings
            </button>
            <button type="button" onClick={addDisplayAlert} disabled={!selectedDraftPrice || candlesState !== 'live'}>
              Add display alert
            </button>
            <button type="button" onClick={() => setAlerts(EMPTY_ROWS)} disabled={alerts.length === 0}>
              Clear alerts
            </button>
          </div>
        </div>
        <div className="futures-workstation-chart-frame">
          <FuturesWorkstationChart
            symbol={selectedSymbol}
            candles={candles?.contract ?? EMPTY_ROWS}
            markCandles={candles?.mark ?? EMPTY_ROWS}
            indexCandles={candles?.index ?? EMPTY_ROWS}
            markPrice={header?.markPrice ?? null}
            indexPrice={header?.indexPrice ?? null}
            priceTickSize={selectedContract?.filters.price?.tickSize ?? null}
            draftPrice={selectedDraftPrice}
            drawings={drawings}
            alerts={alerts}
            ownedOrders={ownedOrders}
            onPricePick={candlesState === 'live' ? pickPrice : IGNORE_PRICE_PICK}
            onTradingGesture={candlesState === 'live' ? onTradingGesture : undefined}
            onOrderDrag={candlesState === 'live' ? onOrderDrag : undefined}
          />
          {candlesState !== 'live' ? (
            <div className={`futures-workstation-overlay is-${candlesState}`}>
              <strong>{candlesState.toUpperCase()}</strong>
              <span>Chart remains read-only until authoritative data is live.</span>
            </div>
          ) : null}
        </div>
        <div className="futures-workstation-local-draft" aria-label="Futures limit price draft">
          <div>
            <span>Limit price</span>
            <strong>{selectedDraftPrice ?? 'Pick chart or book price'}</strong>
          </div>
          <code>DRAFT · VERIFIED SHORTCUT EXECUTION</code>
        </div>
      </main>

      <aside className="futures-workstation-depth" data-state={depthState}>
        <div className="futures-workstation-section-heading">
          <div><span>Order book</span><strong>Snapshot + diff</strong></div>
          <StateBadge state={depthState} />
        </div>
        <div className="futures-workstation-book-head"><span>Price</span><span>Qty</span><span>Total</span></div>
        <div className="futures-workstation-book-side is-ask">
          {visibleAsks.map(level => (
            <button
              type="button"
              key={`ask-${level.price}`}
              disabled={depthState !== 'live'}
              onClick={event => handleBookClick(event, level.price)}
              onContextMenu={event => handleBookContextMenu(event, level.price)}
            >
              <span>{level.price}</span><span>{level.quantity}</span><span>{level.total}</span>
            </button>
          ))}
        </div>
        <div className="futures-workstation-spread">
          <span>Spread</span><strong>{depth?.spread ?? '—'}</strong><code>u {depth?.lastUpdateId ?? '—'}</code>
        </div>
        <div className="futures-workstation-book-side is-bid">
          {visibleBids.map(level => (
            <button
              type="button"
              key={`bid-${level.price}`}
              disabled={depthState !== 'live'}
              onClick={event => handleBookClick(event, level.price)}
              onContextMenu={event => handleBookContextMenu(event, level.price)}
            >
              <span>{level.price}</span><span>{level.quantity}</span><span>{level.total}</span>
            </button>
          ))}
        </div>
      </aside>

      <aside className="futures-workstation-trades" data-state={tradesState}>
        <div className="futures-workstation-section-heading">
          <div><span>Aggregate trades</span><strong>Bounded tape</strong></div>
          <button type="button" onClick={toggleTape}>
            {tapePaused ? 'Resume' : 'Pause'}
          </button>
        </div>
        <div className="futures-workstation-trade-head"><span>Price</span><span>Qty</span><span>Time</span></div>
        <div className="futures-workstation-trade-rows">
          {displayedTrades.map(trade => (
            <div className={trade.buyerMaker ? 'is-sell' : 'is-buy'} key={trade.aggregateTradeId}>
              <span>{trade.price}</span><span>{trade.quantity}</span><span>{formatTime(trade.tradeTime)}</span>
            </div>
          ))}
          {displayedTrades.length === 0 ? <p className="futures-workstation-empty">Waiting for aggregate trades…</p> : null}
        </div>
      </aside>
    </section>
  )
}

export default FuturesWorkstationView
