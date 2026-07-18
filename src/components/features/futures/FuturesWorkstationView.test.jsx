import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FuturesWorkstationView from './FuturesWorkstationView.jsx'
import FuturesProductionWorkstation from './FuturesProductionWorkstation.jsx'

vi.mock('./FuturesWorkstationChart.jsx', () => ({
  default: ({ onPricePick, onTradingGesture, priceTickSize, draftPrice, drawings, alerts }) => (
    <div data-testid="mock-futures-chart">
      <button type="button" onClick={() => onPricePick('58420.25')}>Pick chart price</button>
      <button type="button" onClick={() => onTradingGesture?.({
        side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58420.25', source: 'chart',
      })}>Chart LONG shortcut</button>
      <span>price tick {priceTickSize ?? 'unavailable'}</span>
      <span>draft {draftPrice ?? 'none'}</span>
      <span>drawings {drawings.length}</span>
      <span>alerts {alerts.length}</span>
    </div>
  ),
}))

const filters = Object.freeze({
  price: Object.freeze({ min: '0.1', max: '1000000', tickSize: '0.1' }),
  quantity: Object.freeze({ min: '0.001', max: '1000', stepSize: '0.001' }),
  marketQuantity: Object.freeze({ min: '0.001', max: '100', stepSize: '0.001' }),
  percentPrice: Object.freeze({
    multiplierUp: '1.1500',
    multiplierDown: '0.8500',
    multiplierDecimal: 4,
  }),
  maximumOrders: 200,
  maximumAlgoOrders: 100,
  minimumNotional: '5',
})

const contract = (symbol, baseAsset, allowlisted) => Object.freeze({
  symbol,
  pair: symbol,
  contractType: 'PERPETUAL',
  status: 'TRADING',
  baseAsset,
  quoteAsset: 'USDT',
  marginAsset: 'USDT',
  allowlisted,
  filters,
})

const trade = (id, price = '58420.25') => Object.freeze({
  aggregateTradeId: id,
  price,
  quantity: '0.25',
  normalQuantity: '0.25',
  firstTradeId: id,
  lastTradeId: id,
  tradeTime: 1_784_000_000_000,
  buyerMaker: false,
})

const createState = (overrides = {}) => Object.freeze({
  status: 'live',
  environment: 'PRODUCTION',
  symbol: 'BTCUSDT',
  interval: '1m',
  requestId: 'ui-request',
  generation: 7,
  revision: 42,
  observedAt: 1_784_000_000_000,
  reasonCode: null,
  resources: Object.freeze({
    status: Object.freeze({ connected: true, reasonCode: null, state: 'live', observedAt: 1_784_000_000_000 }),
    catalog: Object.freeze({
      offset: 0,
      total: 2,
      complete: true,
      contracts: Object.freeze([
        contract('BTCUSDT', 'BTC', true),
        contract('ETHUSDT', 'ETH', false),
      ]),
      state: 'live',
      observedAt: 1_784_000_000_000,
    }),
    header: Object.freeze({
      lastPrice: '58420.25',
      markPrice: '58419.99',
      indexPrice: '58418.75',
      basis: '1.24',
      priceChange: '420.25',
      priceChangePercent: '0.72',
      highPrice: '59000',
      lowPrice: '57000',
      volume: '1000.5',
      quoteVolume: '58000000',
      lastQuantity: '0.25',
      fundingRate: '-0.0001',
      fundingRatePercent: '-0.01',
      nextFundingTime: Date.now() + 3_600_000,
      eventTime: 1_784_000_000_000,
      contractStatus: 'TRADING',
      state: 'live',
      observedAt: 1_784_000_000_000,
    }),
    candles: Object.freeze({
      interval: '1m',
      contract: Object.freeze([]),
      mark: Object.freeze([]),
      index: Object.freeze([]),
      state: 'live',
      observedAt: 1_784_000_000_000,
    }),
    depth: Object.freeze({
      lastUpdateId: '90071992547409931234',
      bids: Object.freeze([Object.freeze({ price: '58420.00', quantity: '2', total: '2' })]),
      asks: Object.freeze([Object.freeze({ price: '58420.50', quantity: '3', total: '3' })]),
      spread: '0.5',
      state: 'live',
      observedAt: 1_784_000_000_000,
    }),
    trades: Object.freeze({
      rows: Object.freeze([trade('90071992547409931235')]),
      state: 'live',
      observedAt: 1_784_000_000_000,
    }),
  }),
  ...overrides,
})

const renderView = (properties = {}) => {
  const onSymbolChange = vi.fn()
  const onIntervalChange = vi.fn()
  const result = render(
    <FuturesWorkstationView
      identity="USDⓈ-M PRODUCTION · REAL MONEY"
      state={createState()}
      selectedSymbol="BTCUSDT"
      selectedInterval="1m"
      onSymbolChange={onSymbolChange}
      onIntervalChange={onIntervalChange}
      {...properties}
    />,
  )
  return { ...result, onSymbolChange, onIntervalChange }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('pure Futures workstation presentation', () => {
  it('renders identity, exact market context, filters, book and bounded tape', () => {
    renderView()
    expect(screen.getByTestId('futures-workstation-identity')).toHaveTextContent(
      'USDⓈ-M PRODUCTION · REAL MONEYPUBLIC MARKET DATA · LIVE EXECUTIONLIVEgen 7 · rev 42',
    )
    expect(screen.getByLabelText('Futures market header')).toHaveTextContent('58420.25')
    expect(screen.getByLabelText('Futures market header')).toHaveTextContent('58419.99')
    expect(screen.getByLabelText('Futures market header')).toHaveTextContent('58418.75')
    expect(screen.getByLabelText('Exact contract filters')).toHaveTextContent('tickSize 0.1')
    expect(screen.getByLabelText('Exact contract filters')).toHaveTextContent(
      'Percent price0.8500 → 1.1500 · decimals 4',
    )
    expect(screen.getByLabelText('Exact contract filters')).toHaveTextContent('Max orders200')
    expect(screen.getByLabelText('Exact contract filters')).toHaveTextContent('Max algo orders100')
    expect(screen.getByLabelText('Exact contract filters')).toHaveTextContent('Min notional5 USDT')
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('price tick 0.1')
    expect(screen.getByText('u 90071992547409931234')).toBeInTheDocument()
    expect(screen.getByText('0.25')).toBeInTheDocument()
  })

  it('shows the ten nearest exact depth levels as complete one-line rows', () => {
    const state = createState()
    const asks = Object.freeze(Array.from({ length: 14 }, (_, index) => Object.freeze({
      price: `0.0095${String(11 + index).padStart(2, '0')}`,
      quantity: String(100_000 + index),
      total: String((index + 1) * 100_000),
    })))
    const bids = Object.freeze(Array.from({ length: 14 }, (_, index) => Object.freeze({
      price: `0.0094${String(99 - index).padStart(2, '0')}`,
      quantity: String(200_000 + index),
      total: String((index + 1) * 200_000),
    })))
    const { container } = renderView({
      state: createState({
        resources: Object.freeze({
          ...state.resources,
          depth: Object.freeze({
            ...state.resources.depth,
            asks,
            bids,
            spread: '0.000003',
          }),
        }),
      }),
    })

    const askRows = [...container.querySelectorAll('.futures-workstation-book-side.is-ask button')]
    const bidRows = [...container.querySelectorAll('.futures-workstation-book-side.is-bid button')]
    expect(askRows).toHaveLength(10)
    expect(bidRows).toHaveLength(10)
    expect(askRows.map(row => row.children[0].textContent)).toEqual([
      '0.009520', '0.009519', '0.009518', '0.009517', '0.009516',
      '0.009515', '0.009514', '0.009513', '0.009512', '0.009511',
    ])
    expect(bidRows.map(row => row.children[0].textContent)).toEqual([
      '0.009499', '0.009498', '0.009497', '0.009496', '0.009495',
      '0.009494', '0.009493', '0.009492', '0.009491', '0.009490',
    ])
    expect(askRows.every(row => row.children.length === 3)).toBe(true)
    expect(bidRows.every(row => row.children.length === 3)).toBe(true)
    expect(container).not.toHaveTextContent('0.009521')
    expect(container).not.toHaveTextContent('0.009489')
  })

  it('renders a removed per-symbol algo limit as unavailable', () => {
    const state = createState()
    const unavailableContract = {
      ...state.resources.catalog.contracts[0],
      filters: {
        ...state.resources.catalog.contracts[0].filters,
        maximumAlgoOrders: null,
      },
    }
    renderView({
      state: {
        ...state,
        resources: {
          ...state.resources,
          catalog: {
            ...state.resources.catalog,
            contracts: [unavailableContract],
            total: 1,
          },
        },
      },
    })

    expect(screen.getByLabelText('Exact contract filters')).toHaveTextContent(
      'Max algo ordersUnavailable',
    )
  })

  it('searches USDⓈ-M contracts and exposes allowlist state without selecting on Enter', () => {
    const { onSymbolChange, onIntervalChange } = renderView()
    const search = screen.getByLabelText('Search Futures contracts')
    fireEvent.change(search, { target: { value: 'eth' } })
    expect(screen.queryByRole('button', { name: /BTCUSDT/ })).not.toBeInTheDocument()
    const eth = screen.getByRole('button', { name: /^ETHUSDT/ })
    expect(eth).toHaveTextContent('OBSERVE ONLY')
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onSymbolChange).not.toHaveBeenCalled()
    expect(onIntervalChange).not.toHaveBeenCalled()
    fireEvent.click(eth)
    expect(onSymbolChange).toHaveBeenCalledWith('ETHUSDT')
  })

  it('changes intervals only through an explicit button', () => {
    const { onIntervalChange } = renderView()
    const group = screen.getByRole('group', { name: 'Chart interval' })
    fireEvent.click(within(group).getByRole('button', { name: '5m' }))
    expect(onIntervalChange).toHaveBeenCalledWith('5m')
  })

  it('turns chart and book clicks into a shared limit-price draft', () => {
    const { onSymbolChange, onIntervalChange } = renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    expect(screen.getByLabelText('Futures limit price draft')).toHaveTextContent('58420.25')
    expect(screen.getByLabelText('Futures limit price draft')).toHaveTextContent(
      'DRAFT · VERIFIED SHORTCUT EXECUTION',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal drawing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('drawings 1')
    fireEvent.click(screen.getByRole('button', { name: 'Add display alert' }))
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('alerts 1')
    fireEvent.click(screen.getByRole('button', { name: /^58420\.50/ }))
    expect(screen.getByLabelText('Futures limit price draft')).toHaveTextContent('58420.50')
    expect(onSymbolChange).not.toHaveBeenCalled()
    expect(onIntervalChange).not.toHaveBeenCalled()
  })

  it('maps exact order-book double-click gestures without bypassing the parent intent handler', () => {
    const onTradingGesture = vi.fn()
    renderView({ onTradingGesture })
    const ask = screen.getByRole('button', { name: /^58420\.50/ })
    const bid = screen.getByRole('button', { name: /^58420\.00/ })

    fireEvent.click(bid, { altKey: true, button: 0 })
    fireEvent.click(bid, { ctrlKey: true, button: 0 })
    expect(onTradingGesture).not.toHaveBeenCalled()
    fireEvent.click(bid, { ctrlKey: true, button: 0 })
    expect(onTradingGesture).toHaveBeenLastCalledWith({
      side: 'BUY',
      positionSide: 'SHORT',
      positionEffect: 'EXIT',
      label: 'Exit SHORT',
      price: '58420.00',
      source: 'order-book',
    })

    const callsBeforeRightClick = onTradingGesture.mock.calls.length
    const unsupportedRightClick = createEvent.contextMenu(ask, { button: 2 })
    fireEvent(ask, unsupportedRightClick)
    expect(unsupportedRightClick.defaultPrevented).toBe(false)

    const firstSupportedRightClick = createEvent.contextMenu(ask, { altKey: true, button: 2 })
    fireEvent(ask, firstSupportedRightClick)
    expect(firstSupportedRightClick.defaultPrevented).toBe(true)
    expect(onTradingGesture).toHaveBeenCalledTimes(callsBeforeRightClick)

    const recognizedRightClick = createEvent.contextMenu(ask, { altKey: true, button: 2 })
    fireEvent(ask, recognizedRightClick)
    expect(recognizedRightClick.defaultPrevented).toBe(true)
    expect(onTradingGesture).toHaveBeenLastCalledWith(expect.objectContaining({
      side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT', price: '58420.50',
    }))

    const callsBeforeCtrlRightClick = onTradingGesture.mock.calls.length
    const firstCtrlRightClick = createEvent.contextMenu(bid, { ctrlKey: true, button: 2 })
    fireEvent(bid, firstCtrlRightClick)
    expect(firstCtrlRightClick.defaultPrevented).toBe(true)
    expect(onTradingGesture).toHaveBeenCalledTimes(callsBeforeCtrlRightClick)

    const recognizedCtrlRightClick = createEvent.contextMenu(bid, { ctrlKey: true, button: 2 })
    fireEvent(bid, recognizedCtrlRightClick)
    expect(recognizedCtrlRightClick.defaultPrevented).toBe(true)
    expect(onTradingGesture).toHaveBeenCalledTimes(callsBeforeCtrlRightClick + 1)
    expect(onTradingGesture).toHaveBeenLastCalledWith(expect.objectContaining({
      side: 'SELL', positionSide: 'SHORT', positionEffect: 'ENTRY', price: '58420.00',
    }))
  })

  it('freezes the displayed tape while backend rows continue to change', () => {
    const state = createState()
    const { rerender } = renderView({ state })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const nextState = createState({
      resources: Object.freeze({
        ...state.resources,
        trades: Object.freeze({
          ...state.resources.trades,
          rows: Object.freeze([trade('90071992547409931299', '60000.00')]),
        }),
      }),
    })
    rerender(
      <FuturesWorkstationView
        identity="USDⓈ-M PRODUCTION · REAL MONEY"
        state={nextState}
        selectedSymbol="BTCUSDT"
        selectedInterval="1m"
        onSymbolChange={() => {}}
        onIntervalChange={() => {}}
      />,
    )
    expect(screen.queryByText('60000.00')).not.toBeInTheDocument()
    const tape = screen.getByText('Aggregate trades').closest('aside')
    expect(within(tape).getByText('58420.25')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByText('60000.00')).toBeInTheDocument()
  })

  it.each(['loading', 'stale', 'disconnected', 'resynchronizing', 'unavailable'])(
    'renders the explicit %s chart state',
    (status) => {
      const state = createState({
        status,
        resources: Object.freeze({
          ...createState().resources,
          candles: Object.freeze({
            ...createState().resources.candles,
            state: status,
          }),
        }),
      })
      renderView({ state })
      expect(screen.getByText(status.toUpperCase(), { selector: '.futures-workstation-overlay strong' }))
        .toBeInTheDocument()
    },
  )

  it('shows the normalized backend reason for an unavailable workstation', () => {
    renderView({
      state: createState({
        status: 'unavailable',
        reasonCode: 'INVALID_PROXY_CONFIGURATION',
      }),
    })
    expect(screen.getByLabelText('Futures workstation reason'))
      .toHaveTextContent('reason INVALID_PROXY_CONFIGURATION')
  })

  it('keeps independently live widgets usable while aggregate recovery remains visible', () => {
    const state = createState({ status: 'resynchronizing' })
    renderView({ state })
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    expect(screen.getByLabelText('Futures limit price draft'))
      .toHaveTextContent('58420.25')
    expect(screen.getByRole('button', { name: /^58420\.50/ })).toBeEnabled()
    expect(screen.queryByText('RESYNCHRONIZING', { selector: '.futures-workstation-overlay strong' }))
      .not.toBeInTheDocument()
    expect(screen.getByTestId('futures-workstation-identity')).toHaveTextContent('RESYNCHRONIZING')
  })

  it('resets display-only drafts, drawings, alerts and paused tape on selection ownership change', () => {
    const properties = {
      identity: 'USDⓈ-M PRODUCTION · REAL MONEY',
      state: createState(),
      selectedInterval: '1m',
      onSymbolChange: () => {},
      onIntervalChange: () => {},
    }
    const { rerender } = render(
      <FuturesWorkstationView {...properties} selectedSymbol="BTCUSDT" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal drawing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add display alert' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))

    rerender(
      <FuturesWorkstationView
        {...properties}
        state={createState({ symbol: 'ETHUSDT' })}
        selectedSymbol="ETHUSDT"
      />,
    )
    expect(screen.getByLabelText('Futures limit price draft'))
      .toHaveTextContent('Pick chart or book price')
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('drawings 0')
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('alerts 0')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('never combines order-book click candidates across symbol ownership', () => {
    const onTradingGesture = vi.fn()
    const properties = {
      identity: 'USDⓈ-M PRODUCTION · REAL MONEY',
      state: createState(),
      selectedInterval: '1m',
      onTradingGesture,
      onSymbolChange: () => {},
      onIntervalChange: () => {},
    }
    const { rerender } = render(
      <FuturesWorkstationView {...properties} selectedSymbol="BTCUSDT" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^58420\.00/ }), { altKey: true })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^58420\.50/ }), { altKey: true })

    rerender(
      <FuturesWorkstationView
        {...properties}
        state={createState({ symbol: 'ETHUSDT' })}
        selectedSymbol="ETHUSDT"
      />,
    )
    const bid = screen.getByRole('button', { name: /^58420\.00/ })
    const ask = screen.getByRole('button', { name: /^58420\.50/ })
    fireEvent.click(bid, { altKey: true })
    fireEvent.contextMenu(ask, { altKey: true })
    expect(onTradingGesture).not.toHaveBeenCalled()

    fireEvent.click(bid, { altKey: true })
    fireEvent.contextMenu(ask, { altKey: true })
    expect(onTradingGesture).toHaveBeenNthCalledWith(1, expect.objectContaining({
      positionSide: 'LONG', positionEffect: 'ENTRY', source: 'order-book', price: '58420.00',
    }))
    expect(onTradingGesture).toHaveBeenNthCalledWith(2, expect.objectContaining({
      positionSide: 'LONG', positionEffect: 'EXIT', source: 'order-book', price: '58420.50',
    }))
  })
})

const productionExecutionState = Object.freeze({
  connected: false,
  subscribed: false,
  submissionLocked: false,
  revision: null,
  mode: null,
  liveAuthorized: false,
  configured: false,
  account: null,
  caps: null,
  killSwitch: null,
  capabilities: null,
  intent: null,
  attempt: null,
  reconciliation: null,
  recovery: null,
  portfolio: null,
  refreshPortfolio: vi.fn(() => false),
  prepareOrderIntent: vi.fn(() => false),
  placeOrder: vi.fn(() => false),
  prepareMarginAdjustment: vi.fn(() => false),
  adjustMargin: vi.fn(() => false),
  prepareOrderAmendment: vi.fn(() => false),
  amendOrder: vi.fn(() => false),
  prepareCancelAllOpenOrdersIntent: vi.fn(() => false),
  cancelAllOpenOrders: vi.fn(() => false),
  prepareClosePositionsIntent: vi.fn(() => false),
  closePositions: vi.fn(() => false),
  prepareEngageKillSwitchIntent: vi.fn(() => false),
  engageKillSwitch: vi.fn(() => false),
  prepareDisengageKillSwitchIntent: vi.fn(() => false),
  disengageKillSwitch: vi.fn(() => false),
})

describe('production workstation container', () => {
  it('places the symbol-config-aware Hedge ticket in the market rail and removes the old drawer', () => {
    render(
      <FuturesProductionWorkstation
        enabled={false}
        wsConnection={null}
        sendMessage={() => false}
        executionState={productionExecutionState}
      />,
    )
    expect(screen.queryByText('Phase 7 production safety drawer')).not.toBeInTheDocument()
    expect(screen.getByText('CONFIG SYNC · HEDGE')).toBeInTheDocument()
    expect(screen.getByText('Advanced safety')).toBeInTheDocument()
    expect(screen.getByLabelText('USDⓈ-M production real-order execution')).toBeInTheDocument()
  })

  it('does not duplicate the backend authoritative portfolio bootstrap in the renderer', () => {
    vi.stubGlobal('WebSocket', undefined)
    const refreshPortfolio = vi.fn(() => true)
    render(
      <FuturesProductionWorkstation
        enabled
        executionState={{
          ...productionExecutionState,
          connected: true,
          subscribed: true,
          revision: '1',
          account: { fingerprint: 'a'.repeat(64) },
          portfolio: { state: 'unavailable', positions: [], openOrders: [] },
          refreshPortfolio,
        }}
      />,
    )
    expect(refreshPortfolio).not.toHaveBeenCalled()
  })

  it('does not duplicate authoritative stream reconciliation after a confirmed mutation', () => {
    vi.stubGlobal('WebSocket', undefined)
    const refreshPortfolio = vi.fn(() => true)
    const baseExecutionState = {
      ...productionExecutionState,
      connected: true,
      subscribed: true,
      revision: '1',
      account: { fingerprint: 'a'.repeat(64) },
      portfolio: { state: 'live', positions: [], openOrders: [] },
      refreshPortfolio,
    }
    const { rerender } = render(
      <FuturesProductionWorkstation enabled executionState={baseExecutionState} />,
    )
    expect(refreshPortfolio).not.toHaveBeenCalled()

    const confirmed = {
      ...baseExecutionState,
      attempt: { requestId: '0123456789abcdef0123456789abcdef', state: 'confirmed_open' },
    }
    rerender(<FuturesProductionWorkstation enabled executionState={confirmed} />)
    expect(refreshPortfolio).not.toHaveBeenCalled()
    rerender(<FuturesProductionWorkstation enabled executionState={confirmed} />)
    expect(refreshPortfolio).not.toHaveBeenCalled()
  })
})
