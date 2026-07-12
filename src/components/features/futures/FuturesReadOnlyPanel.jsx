import { useEffect, useState } from 'react'
import './FuturesReadOnlyPanel.css'

const RESOURCE_STATUS_LABELS = Object.freeze({
  loading: 'Loading',
  empty: 'Empty',
  unavailable: 'Unavailable',
  stale: 'Stale',
  disconnected: 'Disconnected',
  error: 'Error',
})

const GLOBAL_STATUS_LABELS = Object.freeze({
  idle: 'Idle',
  loading: 'Loading',
  ready: 'Live',
  partial: 'Partial',
  unavailable: 'Unavailable',
  stale: 'Stale',
  disconnected: 'Disconnected',
  error: 'Error',
})

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const exactValue = (value) => {
  if (value === null || value === undefined) return '—'
  return String(value)
}

const pnlTone = (value) => {
  if (typeof value !== 'string') return 'neutral'
  if (/^[+-]?0+(?:\.0+)?$/.test(value)) return 'neutral'
  if (value.startsWith('-')) return 'negative'
  return 'positive'
}

const formatCountdown = (nextFundingTime, now) => {
  if (!Number.isSafeInteger(nextFundingTime) || nextFundingTime < 0) return '—'

  const remainingSeconds = Math.max(0, Math.floor((nextFundingTime - now) / 1000))
  const hours = Math.floor(remainingSeconds / 3600)
  const minutes = Math.floor((remainingSeconds % 3600) / 60)
  const seconds = remainingSeconds % 60

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

const StatusNote = ({ status, errorCode, label }) => (
  <div className={`futures-readonly-resource-state is-${status || 'unavailable'}`} role="status">
    <span>{label || RESOURCE_STATUS_LABELS[status] || 'Unavailable'}</span>
    {typeof errorCode === 'string' && errorCode.length > 0 ? <code>{errorCode}</code> : null}
  </div>
)

const ResourceFrame = ({ resource, emptyLabel, children }) => {
  const status = resource?.status || 'unavailable'
  const hasData = resource?.data !== null && resource?.data !== undefined

  if (status === 'empty') {
    return <StatusNote status="empty" label={emptyLabel} />
  }

  if (!hasData) {
    return <StatusNote status={status} errorCode={resource?.errorCode} />
  }

  return (
    <>
      {status !== 'ready' ? <StatusNote status={status} errorCode={resource?.errorCode} /> : null}
      {children(resource.data)}
    </>
  )
}

const Metric = ({ label, value, tone }) => (
  <div className="futures-readonly-metric">
    <dt>{label}</dt>
    <dd className={tone ? `is-${tone}` : undefined}>{exactValue(value)}</dd>
  </div>
)

const OrderCount = ({ label, resource }) => {
  const status = resource?.status || 'unavailable'
  const hasRows = Array.isArray(resource?.data)
  const count = hasRows ? String(resource.data.length) : status === 'empty' ? '0' : null

  return (
    <div className="futures-readonly-order-count">
      <span>{label}</span>
      {count === null ? (
        <span className={`is-${status}`}>{RESOURCE_STATUS_LABELS[status] || 'Unavailable'}</span>
      ) : (
        <strong>{count}</strong>
      )}
      {hasRows && status !== 'ready' && status !== 'empty' ? (
        <small>{RESOURCE_STATUS_LABELS[status] || status}</small>
      ) : null}
    </div>
  )
}

const FuturesReadOnlyPanel = ({ state }) => {
  const safeState = isRecord(state) ? state : {}
  const resources = isRecord(safeState.resources) ? safeState.resources : {}
  const marketData = isRecord(resources.market?.data) ? resources.market.data : null
  const fundingState = isRecord(marketData?.fundingState) ? marketData.fundingState : null
  const nextFundingTime = fundingState?.nextFundingTime
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!Number.isSafeInteger(nextFundingTime) || nextFundingTime < 0) return undefined

    const intervalId = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(intervalId)
  }, [nextFundingTime])

  const status = safeState.status || 'loading'
  const environment = safeState.environment === 'testnet' ? 'TESTNET' : safeState.environment === 'mock' ? 'MOCK' : 'PENDING'
  const globalErrorCode = typeof safeState.errorCode === 'string' ? safeState.errorCode : null

  return (
    <aside className={`futures-readonly-panel is-${status}`} aria-label="USDⓈ-M futures read-only risk">
      <header className="futures-readonly-header">
        <div>
          <span className="futures-readonly-market">USDⓈ-M READ ONLY</span>
          <strong>{exactValue(safeState.symbol)}</strong>
        </div>
        <div className="futures-readonly-badges" aria-label="Futures connection status">
          <span className={`futures-readonly-environment is-${environment.toLowerCase()}`}>{environment}</span>
          <span className={`futures-readonly-status is-${status}`} role="status">
            {GLOBAL_STATUS_LABELS[status] || 'Unavailable'}
          </span>
        </div>
      </header>

      {globalErrorCode ? (
        <div className="futures-readonly-global-error" role="alert">
          Futures data unavailable <code>{globalErrorCode}</code>
        </div>
      ) : null}

      <section className="futures-readonly-section" aria-labelledby="futures-market-heading">
        <h3 id="futures-market-heading">Market &amp; funding</h3>
        <ResourceFrame resource={resources.market}>
          {(data) => {
            const markPrice = isRecord(data) && isRecord(data.markPrice) ? data.markPrice : {}
            const funding = isRecord(data) && isRecord(data.fundingState) ? data.fundingState : {}

            return (
              <dl className="futures-readonly-metrics">
                <Metric label="Mark" value={markPrice.markPrice} />
                <Metric label="Index" value={markPrice.indexPrice} />
                <Metric label="Funding" value={funding.lastFundingRate} tone={pnlTone(funding.lastFundingRate)} />
                <Metric label="Next funding" value={formatCountdown(funding.nextFundingTime, now)} />
              </dl>
            )
          }}
        </ResourceFrame>
      </section>

      <section className="futures-readonly-section" aria-labelledby="futures-filters-heading">
        <h3 id="futures-filters-heading">Exchange filters</h3>
        <ResourceFrame resource={resources.exchangeInfo}>
          {(data) => {
            const filters = isRecord(data) && isRecord(data.filters) ? data.filters : {}
            const price = isRecord(filters.price) ? filters.price : {}
            const quantity = isRecord(filters.quantity) ? filters.quantity : {}
            const marketQuantity = isRecord(filters.marketQuantity) ? filters.marketQuantity : {}

            return (
              <dl className="futures-readonly-metrics">
                <Metric label="Tick" value={price.tickSize} />
                <Metric label="Qty step" value={quantity.stepSize} />
                <Metric label="Market step" value={marketQuantity.stepSize} />
                <Metric label="Min notional" value={filters.minimumNotional} />
              </dl>
            )
          }}
        </ResourceFrame>
      </section>

      <section className="futures-readonly-section" aria-labelledby="futures-positions-heading">
        <h3 id="futures-positions-heading">Positions &amp; risk</h3>
        <ResourceFrame resource={resources.positions} emptyLabel="No positions">
          {(data) =>
            Array.isArray(data) && data.length > 0 && data.every(isRecord) ? (
              <div className="futures-readonly-positions">
                {data.map((position) => (
                  <article
                    className="futures-readonly-position"
                    key={`${position.symbol}:${position.positionSide}`}
                    data-position-side={position.positionSide}
                  >
                    <div className="futures-readonly-position-heading">
                      <strong>{exactValue(position.positionSide)}</strong>
                      <span>{exactValue(position.positionAmt)}</span>
                    </div>
                    <dl className="futures-readonly-metrics">
                      <Metric label="Entry" value={position.entryPrice} />
                      <Metric label="Mark" value={position.markPrice} />
                      <Metric
                        label="Unrealized PnL"
                        value={position.unRealizedProfit}
                        tone={pnlTone(position.unRealizedProfit)}
                      />
                      <Metric label="Liquidation" value={position.liquidationPrice} />
                    </dl>
                  </article>
                ))}
              </div>
            ) : (
              <StatusNote
                status={Array.isArray(data) && data.length === 0 ? 'empty' : 'error'}
                label={Array.isArray(data) && data.length === 0 ? 'No positions' : 'Positions unavailable'}
              />
            )
          }
        </ResourceFrame>
      </section>

      <section className="futures-readonly-section" aria-labelledby="futures-margin-heading">
        <h3 id="futures-margin-heading">Margin balance</h3>
        <ResourceFrame resource={resources.marginBalance}>
          {(data) => (
            <dl className="futures-readonly-metrics">
              <Metric label="Asset" value={data.asset} />
              <Metric label="Balance" value={data.balance} />
              <Metric label="Available" value={data.availableBalance} />
              <Metric label="Cross PnL" value={data.crossUnPnl} tone={pnlTone(data.crossUnPnl)} />
            </dl>
          )}
        </ResourceFrame>
      </section>

      <section className="futures-readonly-section" aria-labelledby="futures-orders-heading">
        <h3 id="futures-orders-heading">Open orders</h3>
        <div className="futures-readonly-order-counts">
          <OrderCount label="Regular" resource={resources.openOrders} />
          <OrderCount label="Algo" resource={resources.algoOpenOrders} />
        </div>
      </section>
    </aside>
  )
}

export default FuturesReadOnlyPanel
export { FuturesReadOnlyPanel }
