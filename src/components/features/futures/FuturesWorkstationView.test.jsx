import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FuturesWorkstationView from './FuturesWorkstationView.jsx'
import FuturesProductionWorkstation from './FuturesProductionWorkstation.jsx'
import FuturesTradingTicket from './FuturesTradingTicket.jsx'

const workstationViewMocks = vi.hoisted(() => ({
  chartRender: vi.fn(),
  ticketRender: vi.fn(),
}))

vi.mock('./FuturesWorkstationChart.jsx', async () => {
  const { memo } = await import('react')
  const MockFuturesWorkstationChart = (
    { onPricePick, onTradingGesture, priceTickSize, draftPrice, drawings, alerts },
  ) => {
    workstationViewMocks.chartRender()
    return (
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
    )
  }
  return { default: memo(MockFuturesWorkstationChart) }
})

vi.mock('./FuturesTradingTicket.jsx', async () => {
  const { memo } = await import('react')
  const MockFuturesTradingTicket = () => {
    workstationViewMocks.ticketRender()
    return (
      <aside aria-label="Futures trading ticket">
        <span>SYNC</span>
      </aside>
    )
  }
  return { default: memo(MockFuturesTradingTicket) }
})

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

const contract = (symbol, baseAsset, tradable) => Object.freeze({
  symbol,
  pair: symbol,
  contractType: 'PERPETUAL',
  status: 'TRADING',
  baseAsset,
  quoteAsset: 'USDT',
  marginAsset: 'USDT',
  tradable,
  filters,
})

const candle = (close, openTime = 1_784_000_000_000) => Object.freeze({
  openTime,
  closeTime: openTime + 59_999,
  open: close,
  high: close,
  low: close,
  close,
  closed: false,
})

// A book side deep enough that the panel, not the feed, decides how much shows.
const bookLevels = (best, direction, count) => Object.freeze(
  Array.from({ length: count }, (unused, index) => Object.freeze({
    price: (best + (direction * index * 0.1)).toFixed(2),
    quantity: '1',
    total: String(index + 1),
  })),
)

// jsdom lays nothing out, so the panel measurement has to be told what the
// operator's panel is worth. The sides are `flex: 1 1 0` in one column, so the
// area they share is split between however many of them are rendered — which
// is what makes a single side twice as deep.
const bookPanelRestores = []
const stubBookSideHeight = (sidesArea) => {
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      if (!this.classList.contains('futures-workstation-book-side')) return 0
      const rendered = this.parentElement?.querySelectorAll('.futures-workstation-book-side').length
      return Math.floor(sidesArea / Math.max(rendered ?? 1, 1))
    },
  })
  bookPanelRestores.push(() => {
    if (previous) Object.defineProperty(HTMLElement.prototype, 'clientHeight', previous)
    else delete HTMLElement.prototype.clientHeight
  })
}

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
  while (bookPanelRestores.length > 0) bookPanelRestores.pop()()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  // Tape settings now outlive a session, so one test's applied configuration
  // must not seed the next one's panel.
  localStorage.clear()
})

describe('pure Futures workstation presentation', () => {
  it('renders identity, exact market context, filters, book and bounded tape', () => {
    renderView()
    const identity = screen.getByTestId('futures-workstation-identity')
    expect(identity).toHaveTextContent('USDⓈ-M PRODUCTION · REAL MONEY')
    expect(identity).toHaveTextContent('LIVE')
    expect(identity).not.toHaveTextContent(/gen |rev /)
    expect(screen.getByLabelText('Futures market header')).toHaveTextContent('58420.25')
    // Mark, basis and index all left the header: the chart and the position
    // rows already carry them, and the header is scanned, not studied.
    expect(screen.getByLabelText('Futures market header')).not.toHaveTextContent('58419.99')
    expect(screen.getByLabelText('Futures market header')).not.toHaveTextContent('1.24')
    expect(screen.getByLabelText('Futures market header')).not.toHaveTextContent('58418.75')
    expect(screen.queryByLabelText('Exact contract filters')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('price tick 0.1')
    expect(screen.queryByText(/^u /)).not.toBeInTheDocument()
    expect(screen.queryByText('Spread')).not.toBeInTheDocument()
    // The tape is denominated in USDT like its own filter: 0.25 × 58420.25.
    expect(screen.getByTitle('0.25 base')).toHaveTextContent('14.6k')
  })

  it('shows the nearest exact depth levels as complete USDT rows', () => {
    const state = createState()
    const asks = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze({
      price: `0.0095${String(11 + index).padStart(2, '0')}`,
      quantity: String(100_000 + index),
      total: String((index + 1) * 100_000),
    })))
    const bids = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze({
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
    expect(askRows).toHaveLength(14)
    expect(bidRows).toHaveLength(14)
    expect(askRows.map(row => row.children[0].textContent).slice(0, 5)).toEqual([
      '0.009524', '0.009523', '0.009522', '0.009521', '0.009520',
    ])
    expect(bidRows.map(row => row.children[0].textContent).slice(0, 5)).toEqual([
      '0.009499', '0.009498', '0.009497', '0.009496', '0.009495',
    ])
    expect(askRows.every(row => row.children.length === 3)).toBe(true)
    expect(bidRows.every(row => row.children.length === 3)).toBe(true)
    // Size and cumulative size are USDT: 100000 × 0.009511 is 951 USDT, not
    // the base quantity the exchange sent.
    expect(askRows.at(-1).children[1].textContent).toBe('951')
    expect(askRows.at(-1).children[2].textContent).toBe('951')
    expect(container).not.toHaveTextContent('0.009525')
    expect(container).not.toHaveTextContent('0.009484')
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

    expect(screen.queryByLabelText('Exact contract filters')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^BTCUSDT/ })).toBeInTheDocument()
  })

  it('searches every USDⓈ-M contract without a stale per-symbol allowlist badge', () => {
    const { onSymbolChange, onIntervalChange } = renderView()
    const search = screen.getByLabelText('Search Futures contracts')
    fireEvent.change(search, { target: { value: 'eth' } })
    expect(screen.queryByRole('button', { name: /BTCUSDT/ })).not.toBeInTheDocument()
    const eth = screen.getByRole('button', { name: /^ETHUSDT/ })
    expect(eth).not.toHaveTextContent(/ALLOWLISTED|OBSERVE ONLY/)
    expect(screen.queryByText(/NOT ALLOWLISTED/)).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Add display alert' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    expect(screen.getByRole('button', { name: 'Add display alert' })).toBeEnabled()
    expect(screen.queryByLabelText('Futures limit price draft')).not.toBeInTheDocument()
    expect(screen.queryByText('DRAFT · VERIFIED SHORTCUT EXECUTION')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal drawing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('drawings 1')
    fireEvent.click(screen.getByRole('button', { name: 'Add display alert' }))
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('alerts 1')
    fireEvent.click(screen.getByRole('button', { name: /^58420\.50/ }))
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
      // The confirmation panel opens where the operator clicked.
      anchor: { x: 0, y: 0 },
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
    // Pause freezes the tape only. The book's last-print row keeps tracking
    // the market, which is the point of watching a paused tape at all.
    const tape = screen.getByText('Aggregate trades').closest('aside')
    expect(within(tape).queryByText('60000.00')).not.toBeInTheDocument()
    expect(within(tape).getByText('58420.25')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(within(tape).getByText('60000.00')).toBeInTheDocument()
  })

  it('validates and explains effective upstream tape controls', () => {
    const onTapeConfigurationChange = vi.fn(() => true)
    renderView({ onTapeConfigurationChange })

    expect(screen.getByText(/Effective: throttled · 250 ms · ≥ 0 USDT/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Tape timeout in ms'), {
      target: { value: '15' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert')).toHaveTextContent('16 to 5000 ms')
    expect(onTapeConfigurationChange).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Tape timeout in ms'), {
      target: { value: '400' },
    })
    fireEvent.change(screen.getByLabelText('Minimum displayed trade in USDT'), {
      target: { value: '1000.5000' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Throttle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onTapeConfigurationChange).toHaveBeenCalledWith({
      throttleEnabled: false,
      timeoutMs: 400,
      minNotionalUsdt: '1000.5',
    })
    expect(screen.getByText(/Effective: unthrottled · 400 ms · ≥ 1000.5 USDT/))
      .toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps effective tape settings across symbol ownership changes', () => {
    const onTapeConfigurationChange = vi.fn(() => true)
    const properties = {
      identity: 'USDⓈ-M PRODUCTION · REAL MONEY',
      state: createState(),
      selectedInterval: '1m',
      onTapeConfigurationChange,
      onSymbolChange: () => {},
      onIntervalChange: () => {},
    }
    const { rerender } = render(
      <FuturesWorkstationView {...properties} selectedSymbol="BTCUSDT" />,
    )
    fireEvent.change(screen.getByLabelText('Tape timeout in ms'), {
      target: { value: '500' },
    })
    fireEvent.change(screen.getByLabelText('Minimum displayed trade in USDT'), {
      target: { value: '250' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    rerender(
      <FuturesWorkstationView
        {...properties}
        state={createState({ symbol: 'ETHUSDT' })}
        selectedSymbol="ETHUSDT"
      />,
    )
    expect(screen.getByText(/Effective: throttled · 500 ms · ≥ 250 USDT/))
      .toBeInTheDocument()
  })

  it('marks the book levels where the operator has working orders', () => {
    renderView({
      ownedOrders: [
        { symbol: 'BTCUSDT', orderId: 1, side: 'BUY', price: '58420.00', status: 'NEW' },
        { symbol: 'BTCUSDT', orderId: 2, side: 'SELL', price: '58420.50', status: 'NEW' },
      ],
    })
    expect(screen.getByTitle('1 working buy order here')).toBeInTheDocument()
    expect(screen.getByTitle('1 working sell order here')).toBeInTheDocument()
  })

  // A step means nothing until it is read against the price it groups. On a
  // low-priced contract a coarse step swallows the whole book into two rows,
  // which reads as a broken book rather than a coarse setting — so the share of
  // price is stated where the choice is made.
  it('states what each order book step is worth as a share of price', () => {
    renderView()
    const step = screen.getByLabelText('Order book price step')
    const labels = [...step.options].map(option => option.textContent)
    expect(labels[0]).toBe('0.1 · <0.01%')
    // 50 on a 58420.25 contract is 0.09% of price per row.
    expect(labels.at(-1)).toBe('50 · 0.09%')
  })

  // The pressure split is measured over exactly the rows on screen. Two books
  // reading "B 53%" mean opposite things if one covers 0.3% of price and the
  // other covers 10%, so the range travels with the number.
  it('states how far from the last trade the pressure reading reaches', () => {
    const state = createState()
    renderView({
      state: createState({
        resources: Object.freeze({
          ...state.resources,
          depth: Object.freeze({
            ...state.resources.depth,
            bids: Object.freeze([
              Object.freeze({ price: '58420.00', quantity: '2', total: '2' }),
              Object.freeze({ price: '57000.00', quantity: '2', total: '4' }),
            ]),
            asks: Object.freeze([
              Object.freeze({ price: '58420.50', quantity: '3', total: '3' }),
              Object.freeze({ price: '59000.00', quantity: '3', total: '6' }),
            ]),
          }),
        }),
      }),
    })
    // 57000 is 2.43% below the 58420.25 last trade — the farther of the two edges.
    expect(screen.getByTitle('Price range the split is measured over'))
      .toHaveTextContent('±2.43%')
  })

  it('marks a grouped row that holds an order resting inside it', () => {
    const state = createState()
    renderView({
      state: createState({
        resources: Object.freeze({
          ...state.resources,
          depth: Object.freeze({
            ...state.resources.depth,
            bids: Object.freeze([
              Object.freeze({ price: '58420.07', quantity: '2', total: '2' }),
            ]),
          }),
        }),
      }),
      ownedOrders: [
        { symbol: 'BTCUSDT', orderId: 3, side: 'BUY', price: '58420.03', status: 'NEW' },
      ],
    })
    fireEvent.change(screen.getByLabelText('Order book price step'), { target: { value: '5' } })
    expect(screen.getByTitle('1 working buy order here')).toBeInTheDocument()
  })

  it('marks no level when the working orders belong to another contract', () => {
    renderView({
      ownedOrders: [
        { symbol: 'ETHUSDT', orderId: 4, side: 'BUY', price: '58420.00', status: 'NEW' },
      ],
    })
    expect(screen.queryByTitle('1 working buy order here')).not.toBeInTheDocument()
  })

  it('restores applied tape settings in a later session', () => {
    const onTapeConfigurationChange = vi.fn(() => true)
    const properties = {
      identity: 'USDⓈ-M PRODUCTION · REAL MONEY',
      state: createState(),
      selectedInterval: '1m',
      selectedSymbol: 'BTCUSDT',
      onTapeConfigurationChange,
      onSymbolChange: () => {},
      onIntervalChange: () => {},
    }
    const first = render(<FuturesWorkstationView {...properties} />)
    fireEvent.change(screen.getByLabelText('Tape timeout in ms'), { target: { value: '750' } })
    fireEvent.change(screen.getByLabelText('Minimum displayed trade in USDT'), {
      target: { value: '300' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    first.unmount()

    render(<FuturesWorkstationView {...properties} />)
    expect(screen.getByLabelText('Tape timeout in ms')).toHaveValue('750')
    expect(screen.getByLabelText('Minimum displayed trade in USDT')).toHaveValue('300')
    expect(screen.getByText(/Effective: throttled · 750 ms · ≥ 300 USDT/))
      .toBeInTheDocument()
  })

  it('does not remember a configuration the workstation rejected', () => {
    const properties = {
      identity: 'USDⓈ-M PRODUCTION · REAL MONEY',
      state: createState(),
      selectedInterval: '1m',
      selectedSymbol: 'BTCUSDT',
      onTapeConfigurationChange: vi.fn(() => false),
      onSymbolChange: () => {},
      onIntervalChange: () => {},
    }
    const first = render(<FuturesWorkstationView {...properties} />)
    fireEvent.change(screen.getByLabelText('Tape timeout in ms'), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    first.unmount()

    render(<FuturesWorkstationView {...properties} />)
    expect(screen.getByLabelText('Tape timeout in ms')).toHaveValue('250')
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

  it('keeps Contracts and offers a compact Retry after reconnect exhaustion', () => {
    const onRetry = vi.fn()
    renderView({
      state: createState({
        status: 'unavailable',
        reasonCode: 'RECONNECT_EXHAUSTED',
      }),
      onRetry,
    })

    expect(screen.getByRole('button', { name: /^BTCUSDT/ })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Contracts stream stopped after repeated reconnect failures.',
    )
    expect(screen.queryByText('No matching USDⓈ-M contract.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('keeps independently live widgets usable while aggregate recovery remains visible', () => {
    const state = createState({ status: 'resynchronizing' })
    renderView({ state })
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    expect(screen.getByRole('button', { name: 'Add display alert' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^58420\.50/ })).toBeEnabled()
    expect(screen.queryByText('RESYNCHRONIZING', { selector: '.futures-workstation-overlay strong' }))
      .not.toBeInTheDocument()
    expect(screen.getByTestId('futures-workstation-identity')).toHaveTextContent('RESYNCHRONIZING')
  })

  it('preserves Contracts but gates stale symbol-owned market data and gestures', () => {
    const onTradingGesture = vi.fn()
    renderView({
      state: createState({ symbol: 'BTCUSDT', reasonCode: 'OLD_SYMBOL_REASON' }),
      selectedSymbol: 'ETHUSDT',
      onTradingGesture,
    })

    expect(screen.getAllByRole('button', { name: /BTCUSDT|ETHUSDT/ })).not.toHaveLength(0)
    expect(screen.getByLabelText('Futures market header')).toHaveTextContent('ETHUSDT')
    expect(screen.getByLabelText('Futures market header')).not.toHaveTextContent('58420.25')
    expect(screen.queryByRole('button', { name: /^58420\.(?:00|50)/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('futures-workstation-identity')).toHaveTextContent('LOADING')
    expect(screen.queryByLabelText('Futures workstation reason')).not.toBeInTheDocument()
    expect(screen.getByText('LOADING', { selector: '.futures-workstation-overlay strong' }))
      .toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Chart LONG shortcut' }))
    expect(onTradingGesture).not.toHaveBeenCalled()
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
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('draft none')
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

describe('instrument recency and interface scale', () => {
  it('orders the single contract list by recency without a duplicate strip', () => {
    renderView({
      selectedSymbol: 'BTCUSDT',
      symbolHistory: { recent: ['ETHUSDT', 'BTCUSDT'], favorites: [] },
    })
    expect(screen.queryByLabelText('Recently traded contracts')).not.toBeInTheDocument()
    const listed = screen.getAllByRole('button', { name: /^(?:BTC|ETH)USDT/ })
    expect(listed[0]).toHaveTextContent('ETHUSDT')
    expect(listed[1]).toHaveTextContent('BTCUSDT')
  })

  it('lists persisted recent contracts before the catalogue arrives', () => {
    const state = createState()
    renderView({
      selectedSymbol: 'BLUAIUSDT',
      symbolHistory: { recent: ['BLUAIUSDT', 'BICOUSDT'], favorites: [] },
      state: createState({
        resources: Object.freeze({
          ...state.resources,
          catalog: Object.freeze({ ...state.resources.catalog, contracts: Object.freeze([]) }),
        }),
      }),
    })

    const listed = screen.getAllByRole('button', { name: /^(?:BLUAI|BICO)USDT/ })
    expect(listed[0]).toHaveTextContent('BLUAIUSDT')
    expect(listed[1]).toHaveTextContent('BICOUSDT')
    expect(screen.getByText('Loading contracts…')).toBeInTheDocument()
  })

  it('replaces a pending recent entry with its catalogue row once it arrives', () => {
    renderView({
      selectedSymbol: 'BTCUSDT',
      symbolHistory: { recent: ['BTCUSDT'], favorites: [] },
    })
    const listed = screen.getAllByRole('button', { name: /^BTCUSDT/ })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toHaveTextContent('PERPETUAL')
    expect(screen.queryByText('Loading contracts…')).not.toBeInTheDocument()
  })

  it('groups the order book by a chosen price step', () => {
    const state = createState()
    const { container } = renderView({
      state: createState({
        resources: Object.freeze({
          ...state.resources,
          depth: Object.freeze({
            ...state.resources.depth,
            bids: Object.freeze([
              Object.freeze({ price: '58419.90', quantity: '2', total: '2' }),
              Object.freeze({ price: '58419.60', quantity: '2', total: '4' }),
            ]),
            asks: Object.freeze([
              Object.freeze({ price: '58420.10', quantity: '3', total: '3' }),
              Object.freeze({ price: '58420.60', quantity: '1', total: '4' }),
            ]),
          }),
        }),
      }),
    })

    const bidPrices = () => [...container.querySelectorAll('.futures-workstation-book-side.is-bid button')]
      .map(row => row.children[0].textContent)
    expect(bidPrices()).toEqual(['58419.90', '58419.60'])

    fireEvent.change(screen.getByLabelText('Order book price step'), { target: { value: '10' } })
    expect(bidPrices()).toEqual(['58419'])
    const asks = [...container.querySelectorAll('.futures-workstation-book-side.is-ask button')]
    // Asks round their group up to the boundary they would fill through.
    expect(asks.map(row => row.children[0].textContent)).toEqual(['58421'])
    // 58420.10 × 3 plus 58420.60 × 1, summed exactly before display.
    expect(asks[0].children[1].textContent).toBe('233.7k')
  })

  it('thickens the size of the heaviest levels and leaves the rest of the row alone', () => {
    const state = createState()
    const { container } = renderView({
      state: createState({
        resources: Object.freeze({
          ...state.resources,
          depth: Object.freeze({
            ...state.resources.depth,
            bids: Object.freeze([
              Object.freeze({ price: '100.7', quantity: '10', total: '10' }),
              Object.freeze({ price: '100.6', quantity: '1', total: '11' }),
              Object.freeze({ price: '100.5', quantity: '9', total: '20' }),
              Object.freeze({ price: '100.4', quantity: '1', total: '21' }),
              Object.freeze({ price: '100.3', quantity: '8', total: '29' }),
              Object.freeze({ price: '100.2', quantity: '7', total: '36' }),
              Object.freeze({ price: '100.1', quantity: '6', total: '42' }),
            ]),
          }),
        }),
      }),
    })

    const bids = [...container.querySelectorAll('.futures-workstation-book-side.is-bid button')]
    expect(bids.map(row => row.children[1].className))
      .toEqual(['is-wall', '', 'is-wall', '', 'is-wall', 'is-wall', 'is-wall'])
    // Only the size carries the mark: the price and the running total beside it
    // read the same on a wall as on any other level.
    expect(bids[0].children[0].className).toBe('')
    expect(bids[0].children[2].className).toBe('')
    // One ask is not five walls: a side with no more levels than walls has none.
    expect([...container.querySelectorAll('.futures-workstation-book-side.is-ask button')]
      .every(row => row.children[1].className === '')).toBe(true)
  })

  it('splits the visible book into buy and sell pressure by resting USDT', () => {
    const state = createState()
    const { container } = renderView({
      state: createState({
        resources: Object.freeze({
          ...state.resources,
          depth: Object.freeze({
            ...state.resources.depth,
            // 300 USDT resting on the bid against 100 on the ask.
            bids: Object.freeze([Object.freeze({ price: '100', quantity: '3', total: '3' })]),
            asks: Object.freeze([Object.freeze({ price: '100', quantity: '1', total: '1' })]),
          }),
        }),
      }),
    })

    const pressure = screen.getByLabelText('Order book buy and sell pressure')
    expect(pressure).toHaveTextContent('B 75.00%')
    expect(pressure).toHaveTextContent('25.00% S')
    const [buy, sell] = pressure.querySelectorAll('.futures-workstation-book-pressure-bar > span')
    expect(buy).toHaveStyle({ width: '75.00%' })
    expect(sell).toHaveStyle({ width: '25.00%' })
    expect(container.querySelector('.futures-workstation-book-pressure')).toHaveAttribute(
      'title',
      '300 USDT bid · 100 USDT ask',
    )
  })

  // The tape is a filtered, throttled display of prints: with a minimum notional
  // set, the service emits no tape frame for as long as nothing large trades.
  // Reading the last price off it froze the number between the two book sides
  // while depth and the chart ran on.
  it('reads the last price from a source the tape filter cannot freeze', () => {
    const base = createState()
    const withCandle = close => createState({
      resources: Object.freeze({
        ...base.resources,
        candles: Object.freeze({ ...base.resources.candles, contract: Object.freeze([candle(close)]) }),
      }),
    })
    const { container, rerender } = renderView({ state: withCandle('58500.00') })
    const bookLast = () => container.querySelector('.futures-workstation-book-last')

    expect(bookLast()).toHaveTextContent('58500.00')
    // One price on screen: the header is not separately sourced from the ticker.
    expect(within(screen.getByLabelText('Futures market header')).getByText('58500.00'))
      .toBeInTheDocument()
    // The tape itself still shows exactly the prints it was asked to show.
    const tape = screen.getByText('Aggregate trades').closest('aside')
    expect(within(tape).getByText('58420.25')).toBeInTheDocument()

    rerender(
      <FuturesWorkstationView
        identity="USDⓈ-M PRODUCTION · REAL MONEY"
        state={withCandle('58600.00')}
        selectedSymbol="BTCUSDT"
        selectedInterval="1m"
        onSymbolChange={() => {}}
        onIntervalChange={() => {}}
      />,
    )
    // The tape delivered nothing new; the price moved anyway.
    expect(within(tape).getByText('58420.25')).toBeInTheDocument()
    expect(bookLast()).toHaveTextContent('58600')
    expect(bookLast()).toHaveClass('is-up')
  })

  it('states the last move as a direction rather than as a maker side', () => {
    const base = createState()
    const withCandle = (close, symbol = 'BTCUSDT') => createState({
      symbol,
      resources: Object.freeze({
        ...base.resources,
        candles: Object.freeze({ ...base.resources.candles, contract: Object.freeze([candle(close)]) }),
      }),
    })
    const { container, rerender } = renderView({ state: withCandle('58500.00') })
    const bookLast = () => container.querySelector('.futures-workstation-book-last')
    const show = (close, symbol = 'BTCUSDT') => rerender(
      <FuturesWorkstationView
        identity="USDⓈ-M PRODUCTION · REAL MONEY"
        state={withCandle(close, symbol)}
        selectedSymbol={symbol}
        selectedInterval="1m"
        onSymbolChange={() => {}}
        onIntervalChange={() => {}}
      />,
    )

    // A first reading is not a move.
    expect(bookLast()).toHaveClass('is-flat')
    expect(bookLast()).not.toHaveTextContent('↑')

    show('58600.00')
    expect(bookLast()).toHaveClass('is-up')
    expect(bookLast()).toHaveTextContent('↑')

    show('58400.00')
    expect(bookLast()).toHaveClass('is-down')
    expect(bookLast()).toHaveTextContent('↓')

    // An unchanged price is not a reversal: the row keeps the way it was going.
    show('58400.00')
    expect(bookLast()).toHaveClass('is-down')

    // A direction belongs to one book.
    show('2000.00', 'ETHUSDT')
    expect(bookLast()).toHaveClass('is-flat')
  })

  // Sizing the sides by content let flex shrink take the panel's shortfall out
  // of the rows: fourteen were rendered into room for eight and a half, and on
  // the ask side — drawn farthest-first — the five hidden were the best asks.
  it('renders only the whole rows the panel can hold, nearest the traded price', () => {
    stubBookSideHeight(180)
    const base = createState()
    const { container } = renderView({
      state: createState({
        resources: Object.freeze({
          ...base.resources,
          depth: Object.freeze({
            ...base.resources.depth,
            bids: bookLevels(58420, -1, 20),
            asks: bookLevels(58420.5, 1, 20),
          }),
        }),
      }),
    })
    const prices = side => [...container.querySelectorAll(`.futures-workstation-book-side.is-${side} button`)]
      .map(row => row.children[0].textContent)

    // 180 px of side area, halved between the two sides, over a 14 px row.
    expect(prices('ask')).toHaveLength(6)
    expect(prices('bid')).toHaveLength(6)
    // The rows the ask side drops are its farthest, and the best ask is the row
    // that sits against the last-print row.
    expect(prices('ask').at(-1)).toBe('58420.50')
    expect(prices('ask')[0]).toBe('58421.00')
    expect(prices('bid')[0]).toBe('58420.00')
  })

  it('leaves the default row count in place where there is nothing to measure', () => {
    const base = createState()
    const { container } = renderView({
      state: createState({
        resources: Object.freeze({
          ...base.resources,
          depth: Object.freeze({
            ...base.resources.depth,
            bids: bookLevels(58420, -1, 20),
            asks: bookLevels(58420.5, 1, 20),
          }),
        }),
      }),
    })
    expect(container.querySelectorAll('.futures-workstation-book-side.is-bid button')).toHaveLength(14)
  })

  // Reaching deeper used to cost resolution: the only control was the step.
  it('gives one side the whole book area when the operator asks for it', () => {
    stubBookSideHeight(180)
    const base = createState()
    const { container } = renderView({
      state: createState({
        resources: Object.freeze({
          ...base.resources,
          depth: Object.freeze({
            ...base.resources.depth,
            bids: bookLevels(58420, -1, 20),
            asks: bookLevels(58420.5, 1, 20),
          }),
        }),
      }),
    })
    const rows = side => container.querySelectorAll(`.futures-workstation-book-side.is-${side} button`)
    const sides = screen.getByRole('group', { name: 'Order book sides' })

    expect(within(sides).getByRole('button', { name: 'Show both book sides' }))
      .toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(sides).getByRole('button', { name: 'Show buy side only' }))
    expect(rows('ask')).toHaveLength(0)
    // The same 180 px, undivided, at the same step.
    expect(rows('bid')).toHaveLength(12)
    expect(container.querySelector('.futures-workstation-book-last')).toBeInTheDocument()
    // The split still has two sides to measure, now over the deeper window.
    expect(screen.getByLabelText('Order book buy and sell pressure')).toBeInTheDocument()

    fireEvent.click(within(sides).getByRole('button', { name: 'Show sell side only' }))
    expect(rows('bid')).toHaveLength(0)
    expect(rows('ask')).toHaveLength(12)
    expect([...rows('ask')].at(-1).children[0]).toHaveTextContent('58420.50')

    fireEvent.click(within(sides).getByRole('button', { name: 'Show both book sides' }))
    expect(rows('ask')).toHaveLength(6)
    expect(rows('bid')).toHaveLength(6)
  })

  // How a book is read belongs to the contract it was read on: the step is a
  // multiple of that contract's own tick, so one global setting would carry a
  // step that is a sane zoom-out on one contract and collapses the next.
  it('opens each contract the way that contract was last read', () => {
    const showContract = symbol => (
      <FuturesWorkstationView
        identity="USDⓈ-M PRODUCTION · REAL MONEY"
        state={createState({ symbol })}
        selectedSymbol={symbol}
        selectedInterval="1m"
        onSymbolChange={() => {}}
        onIntervalChange={() => {}}
      />
    )
    const { rerender, container } = renderView()
    const sideMode = name => screen.getByRole('button', { name }).getAttribute('aria-pressed')

    fireEvent.click(screen.getByRole('button', { name: 'Show sell side only' }))
    fireEvent.change(screen.getByLabelText('Order book price step'), { target: { value: '10' } })

    // A contract never configured opens at both sides and 1×, not at what the
    // previous contract happened to be set to.
    rerender(showContract('ETHUSDT'))
    expect(container.querySelector('.futures-workstation-book-side.is-bid')).not.toBeNull()
    expect(sideMode('Show both book sides')).toBe('true')
    expect(screen.getByLabelText('Order book price step')).toHaveValue('1')

    rerender(showContract('BTCUSDT'))
    expect(container.querySelector('.futures-workstation-book-side.is-bid')).toBeNull()
    expect(sideMode('Show sell side only')).toBe('true')
    expect(screen.getByLabelText('Order book price step')).toHaveValue('10')
  })

  it('restores what a contract was left with after a restart', () => {
    const { unmount } = renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Show buy side only' }))
    fireEvent.change(screen.getByLabelText('Order book price step'), { target: { value: '25' } })
    unmount()

    // A fresh mount reads the store, exactly as a relaunch would.
    const { container } = renderView()
    expect(container.querySelector('.futures-workstation-book-side.is-ask')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show buy side only' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Order book price step')).toHaveValue('25')
  })

  it('hides book pressure rather than claiming a split with no book', () => {
    const state = createState()
    renderView({
      state: createState({
        resources: Object.freeze({
          ...state.resources,
          depth: Object.freeze({
            ...state.resources.depth,
            bids: Object.freeze([]),
            asks: Object.freeze([]),
          }),
        }),
      }),
    })
    expect(screen.queryByLabelText('Order book buy and sell pressure')).not.toBeInTheDocument()
  })

  it('exposes a persisted interface scale control instead of a fixed 7px type ramp', () => {
    const onUiScaleChange = vi.fn()
    renderView({ uiScale: 1.2, onUiScaleChange })
    const scale = screen.getByRole('group', { name: 'Interface scale' })
    expect(scale).toHaveTextContent('120%')

    fireEvent.click(within(scale).getByRole('button', { name: 'Increase interface scale' }))
    expect(onUiScaleChange).toHaveBeenLastCalledWith(1.25)
    fireEvent.click(within(scale).getByRole('button', { name: 'Decrease interface scale' }))
    expect(onUiScaleChange).toHaveBeenLastCalledWith(1.15)
    fireEvent.click(within(scale).getByRole('button', { name: 'Reset interface scale' }))
    expect(onUiScaleChange).toHaveBeenLastCalledWith(1)
  })
})

describe('production workstation container', () => {
  it('adds no chart or execution-ticket render for a depth-only workstation commit', () => {
    const initialState = createState()
    const stableProperties = {
      identity: 'USDⓈ-M PRODUCTION · REAL MONEY',
      selectedSymbol: 'BTCUSDT',
      selectedInterval: '1m',
      onDraftPriceChange: vi.fn(),
      onTradingGesture: vi.fn(),
      onOrderDrag: vi.fn(),
      onSymbolChange: vi.fn(),
      onIntervalChange: vi.fn(),
    }
    const workstation = currentState => (
      <FuturesWorkstationView
        {...stableProperties}
        state={currentState}
        tradingRail={(
          <FuturesTradingTicket
            state={productionExecutionState}
            selectedSymbol="BTCUSDT"
          />
        )}
      />
    )
    const { rerender } = render(workstation(initialState))
    const initialChartRenders = workstationViewMocks.chartRender.mock.calls.length
    const initialTicketRenders = workstationViewMocks.ticketRender.mock.calls.length
    const nextState = createState({
      revision: initialState.revision + 1,
      resources: Object.freeze({
        ...initialState.resources,
        depth: Object.freeze({
          ...initialState.resources.depth,
          bids: Object.freeze([
            Object.freeze({ price: '58419.50', quantity: '4', total: '4' }),
          ]),
        }),
      }),
    })

    rerender(workstation(nextState))

    expect(screen.getByRole('button', { name: /^58419\.50/ })).toBeInTheDocument()
    expect(workstationViewMocks.chartRender).toHaveBeenCalledTimes(initialChartRenders)
    expect(workstationViewMocks.ticketRender).toHaveBeenCalledTimes(initialTicketRenders)
  })

  it('does not rerender the chart for an equivalent parent render', () => {
    const properties = {
      enabled: false,
      wsConnection: null,
      sendMessage: () => false,
      executionState: productionExecutionState,
    }
    const { rerender } = render(<FuturesProductionWorkstation {...properties} />)
    const initialChartRenders = workstationViewMocks.chartRender.mock.calls.length

    rerender(<FuturesProductionWorkstation {...properties} />)

    expect(workstationViewMocks.chartRender).toHaveBeenCalledTimes(initialChartRenders)
  })

  it('places the compact trading ticket in the market rail and removes the old drawer', () => {
    render(
      <FuturesProductionWorkstation
        enabled={false}
        wsConnection={null}
        sendMessage={() => false}
        executionState={productionExecutionState}
      />,
    )
    expect(screen.queryByText('Phase 7 production safety drawer')).not.toBeInTheDocument()
    expect(screen.queryByText('Advanced safety')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Futures trading ticket')).toBeInTheDocument()
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
