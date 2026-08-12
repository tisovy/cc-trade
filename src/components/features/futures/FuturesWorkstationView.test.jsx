import { readFileSync } from 'node:fs'
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FuturesWorkstationView from './FuturesWorkstationView.jsx'
import FuturesProductionWorkstation from './FuturesProductionWorkstation.jsx'
import FuturesTradingTicket from './FuturesTradingTicket.jsx'

const workstationViewMocks = vi.hoisted(() => ({
  chartRender: vi.fn(),
  ticketRender: vi.fn(),
  formatExchangePrice: vi.fn(),
  formatCompactUsdt: vi.fn(),
}))

// The view calls this once per render pass, for the last traded price, and the
// two children that also call it are mocked out here — so counting it counts
// passes over the workstation. A pass React throws away is still a pass.
// And this one is called three times by every book row and twice by every tape
// row, so counting it counts how much of the panel a frame actually rebuilt.
vi.mock('../../../utils/futuresPriceFormat.js', async (importOriginal) => {
  const actual = await importOriginal()
  workstationViewMocks.formatExchangePrice.mockImplementation(actual.formatExchangePrice)
  workstationViewMocks.formatCompactUsdt.mockImplementation(actual.formatCompactUsdt)
  return {
    ...actual,
    formatExchangePrice: workstationViewMocks.formatExchangePrice,
    formatCompactUsdt: workstationViewMocks.formatCompactUsdt,
  }
})

vi.mock('./FuturesWorkstationChart.jsx', async () => {
  const { memo } = await import('react')
  const MockFuturesWorkstationChart = (
    { onPricePick, onTradingGesture, onOrderLift, priceTickSize, draftPrice, drawings, alerts },
  ) => {
    workstationViewMocks.chartRender()
    return (
      <div data-testid="mock-futures-chart">
        <button type="button" onClick={() => onPricePick('58420.25')}>Pick chart price</button>
        <button type="button" onClick={() => onTradingGesture?.({
          side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', price: '58420.25', source: 'chart',
        })}>Chart LONG shortcut</button>
        <button
          type="button"
          disabled={typeof onOrderLift !== 'function'}
          onClick={() => onOrderLift?.({ orderId: '77' })}
        >
          Lift chart order
        </button>
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
      volume: '49567852.5',
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
    // A candle on it, at the header's own last price so nothing that reads the
    // last price reads differently for it. A chart with no candle at all is a
    // chart with no price to pick, which is its own case and has its own tests.
    candles: Object.freeze({
      interval: '1m',
      contract: Object.freeze([candle('58420.25')]),
      mark: Object.freeze([]),
      index: Object.freeze([]),
      state: 'live',
      observedAt: 1_784_000_000_000,
      liveObservedAt: 1_784_000_000_000,
    }),
    depth: Object.freeze({
      lastUpdateId: '90071992547409931234',
      bids: Object.freeze([Object.freeze({ price: '58420.00', quantity: '2' })]),
      asks: Object.freeze([Object.freeze({ price: '58420.50', quantity: '3' })]),
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
      symbolHistory={{ recent: ['BTCUSDT'], favorites: [] }}
      onSymbolChange={onSymbolChange}
      onIntervalChange={onIntervalChange}
      {...properties}
    />,
  )
  return { ...result, onSymbolChange, onIntervalChange }
}

const getTapeDisclosure = () => screen.getByText('Aggregate trades').closest('details')
const openTapeSettings = () => {
  const disclosure = getTapeDisclosure()
  if (!disclosure.open) fireEvent.click(disclosure.querySelector('summary'))
  return disclosure
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
    // A day's volume is read for its magnitude, not for its last three digits.
    // The exact figure stays reachable: abbreviating is dropping digits.
    //
    // And it is the quote leg — the figure the exchange's own app shows. The base
    // count is the same day measured in contracts, so a USDT abbreviation over it
    // overstates the market by whatever the contract is priced at; both legs are in
    // the title, each with its unit named.
    const volume = within(screen.getByLabelText('Futures market header')).getByText('58.0M')
    expect(volume).toHaveAttribute('title', '58000000 USDT · 49567852.5 BTC')
    expect(screen.getByLabelText('Futures market header')).toHaveTextContent('24h volume, USDT')
    expect(screen.queryByLabelText('Exact contract filters')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('price tick 0.1')
    expect(screen.queryByText(/^u /)).not.toBeInTheDocument()
    expect(screen.queryByText('Spread')).not.toBeInTheDocument()
    // The tape is denominated in USDT like its own filter: 0.25 × 58420.25.
    expect(screen.getByTitle('0.25 base')).toHaveTextContent('14.6k')
  })

  it('shows account synchronization only in place of a routine live identity state', () => {
    const { rerender } = renderView({ accountSynchronizing: true })
    const identity = screen.getByTestId('futures-workstation-identity')
    expect(identity).toHaveTextContent('SYNC')
    expect(identity).not.toHaveTextContent('LIVE')
    expect(within(screen.getByLabelText('USDⓈ-M contract selector')).queryByRole('status'))
      .not.toBeInTheDocument()

    const staleState = createState({ status: 'stale', reasonCode: 'MARKET_STALE' })
    rerender(
      <FuturesWorkstationView
        identity="USDⓈ-M PRODUCTION · REAL MONEY"
        state={staleState}
        selectedSymbol="BTCUSDT"
        selectedInterval="1m"
        accountSynchronizing
        onSymbolChange={vi.fn()}
        onIntervalChange={vi.fn()}
      />,
    )
    expect(identity).toHaveTextContent('STALE')
    expect(identity).not.toHaveTextContent('SYNC')
    expect(identity).toHaveTextContent('reason MARKET_STALE')
  })

  it('shows the nearest exact depth levels as complete USDT rows', () => {
    const state = createState()
    const asks = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze({
      price: `0.0095${String(11 + index).padStart(2, '0')}`,
      quantity: String(100_000 + index),
    })))
    const bids = Object.freeze(Array.from({ length: 16 }, (_, index) => Object.freeze({
      price: `0.0094${String(99 - index).padStart(2, '0')}`,
      quantity: String(200_000 + index),
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

  it('keeps compact market rows named while tape settings toggle without remounting data', () => {
    const { container } = renderView()
    const depth = container.querySelector('.futures-workstation-depth')
    const tape = container.querySelector('.futures-workstation-trades')
    const disclosure = getTapeDisclosure()
    const rows = tape.querySelector('.futures-workstation-trade-rows')
    const firstTrade = rows.firstElementChild

    expect(disclosure.open).toBe(false)
    expect(depth.querySelector('.futures-workstation-book-head')).toBeNull()
    expect(tape.querySelector('.futures-workstation-trade-head')).toBeNull()
    expect(screen.getByRole('button', {
      name: 'Ask book level: price 58420.50; level 175.3k USDT; cumulative 175.3k USDT',
    })).toBeInTheDocument()
    expect(screen.getByRole('group', {
      name: /Aggregate trade: price 58420\.25; notional 14\.6k USDT; time /,
    })).toBe(firstTrade)

    rows.scrollTop = 37
    fireEvent.click(disclosure.querySelector('summary'))
    expect(disclosure.open).toBe(true)
    fireEvent.change(screen.getByLabelText('Tape timeout in ms'), { target: { value: '375' } })
    fireEvent.click(disclosure.querySelector('summary'))
    expect(disclosure.open).toBe(false)
    expect(tape.querySelector('.futures-workstation-trade-rows')).toBe(rows)
    expect(rows.firstElementChild).toBe(firstTrade)
    expect(rows.scrollTop).toBe(37)
    expect(rows).toHaveTextContent('58420.25')

    fireEvent.click(disclosure.querySelector('summary'))
    expect(disclosure.open).toBe(true)
    expect(screen.getByLabelText('Tape timeout in ms')).toHaveValue('375')
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
    fireEvent.click(screen.getByRole('button', { name: /^Ask book level: price 58420\.50/ }))
    expect(onSymbolChange).not.toHaveBeenCalled()
    expect(onIntervalChange).not.toHaveBeenCalled()
  })

  it('maps exact order-book double-click gestures without bypassing the parent intent handler', () => {
    const onTradingGesture = vi.fn()
    renderView({ onTradingGesture })
    const ask = screen.getByRole('button', { name: /^Ask book level: price 58420\.50/ })
    const bid = screen.getByRole('button', { name: /^Bid book level: price 58420\.00/ })

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
      // The level was picked off a live book, so the confirmation states no age:
      // the reading travels with the price either way.
      reading: {
        surface: 'order-book',
        surfaceLabel: 'order book',
        state: 'live',
        live: true,
        observedAt: 1_784_000_000_000,
      },
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
    openTapeSettings()
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
    openTapeSettings()

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
    openTapeSettings()
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
              Object.freeze({ price: '58420.00', quantity: '2' }),
              Object.freeze({ price: '57000.00', quantity: '2' }),
            ]),
            asks: Object.freeze([
              Object.freeze({ price: '58420.50', quantity: '3' }),
              Object.freeze({ price: '59000.00', quantity: '3' }),
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
              Object.freeze({ price: '58420.07', quantity: '2' }),
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
    openTapeSettings()
    fireEvent.change(screen.getByLabelText('Tape timeout in ms'), { target: { value: '750' } })
    fireEvent.change(screen.getByLabelText('Minimum displayed trade in USDT'), {
      target: { value: '300' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    first.unmount()

    render(<FuturesWorkstationView {...properties} />)
    openTapeSettings()
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
    openTapeSettings()
    fireEvent.change(screen.getByLabelText('Tape timeout in ms'), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    first.unmount()

    render(<FuturesWorkstationView {...properties} />)
    openTapeSettings()
    expect(screen.getByLabelText('Tape timeout in ms')).toHaveValue('250')
  })

  // The chart's own state, with `connected` telling the desk whether the silence
  // belongs to the market or to the transport.
  const chartInState = (status, { connected = true, agedMs = 3_000, rows } = {}) => createState({
    status,
    resources: Object.freeze({
      ...createState().resources,
      status: Object.freeze({
        ...createState().resources.status,
        connected,
        state: connected ? 'live' : status,
      }),
      candles: Object.freeze({
        ...createState().resources.candles,
        ...(rows === undefined ? {} : { contract: rows }),
        state: status,
        liveObservedAt: Date.now() - agedMs,
      }),
    }),
  })

  const readingNotice = () => document.querySelector('.futures-workstation-reading-notice')

  it.each(['loading', 'resynchronizing', 'unavailable'])(
    'states the %s chart reading beside the candles instead of over them',
    (status) => {
      renderView({ state: chartInState(status) })
      expect(readingNotice()).toHaveTextContent(
        new RegExp(`^${status.toUpperCase()} chart · \\d+s old$`),
      )
      expect(document.querySelector('.futures-workstation-overlay')).toBeNull()
    },
  )

  it('calls a silent stream on a live connection quiet, not stale', () => {
    renderView({ state: chartInState('stale', { connected: true }) })
    expect(readingNotice()).toHaveTextContent(/^QUIET chart · \d+s old$/)
    expect(readingNotice()).toHaveClass('is-quiet')
  })

  it('leaves a stale reading stale when the transport cannot vouch for it', () => {
    renderView({ state: chartInState('stale', { connected: false }) })
    expect(readingNotice()).toHaveTextContent(/^STALE chart · \d+s old$/)
    expect(readingNotice()).toHaveClass('is-stale')
  })

  it('dates a reading from when it was last live, not from when it was marked', () => {
    renderView({ state: chartInState('stale', { agedMs: 125_000 }) })
    expect(readingNotice()).toHaveTextContent(/^QUIET chart · 2m \d+s old$/)
  })

  it('covers only a chart that carries no candle at all', () => {
    renderView({ state: chartInState('loading', { rows: Object.freeze([]) }) })
    expect(document.querySelector('.futures-workstation-overlay strong'))
      .toHaveTextContent('LOADING')
    expect(screen.getByText('No candle has arrived for this contract yet.')).toBeInTheDocument()
    expect(readingNotice()).toBeNull()
  })

  it('keeps the chart and the book armed while the data is not live', () => {
    const onTradingGesture = vi.fn()
    renderView({ state: chartInState('stale'), onTradingGesture })
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    expect(screen.getByRole('button', { name: 'Add display alert' })).toBeEnabled()
    // The chart's own shortcut, on a chart the desk cannot vouch for: it opens
    // the confirmation and carries the reading it was taken off.
    fireEvent.click(screen.getByRole('button', { name: 'Chart LONG shortcut' }))
    expect(onTradingGesture).toHaveBeenLastCalledWith(expect.objectContaining({
      source: 'chart',
      price: '58420.25',
      reading: expect.objectContaining({ surface: 'chart', state: 'quiet', live: false }),
    }))
    onTradingGesture.mockClear()
    const bid = screen.getByRole('button', { name: /^Bid book level: price 58420\.00/ })
    expect(bid).toBeEnabled()
    fireEvent.click(bid, { ctrlKey: true, button: 0 })
    fireEvent.click(bid, { ctrlKey: true, button: 0 })
    expect(onTradingGesture).toHaveBeenCalledOnce()
    // The gesture carries what the price is worth knowing about: where it came
    // from and when that surface was last live.
    expect(onTradingGesture.mock.calls[0][0].reading).toMatchObject({
      surface: 'order-book',
      live: true,
    })
  })

  // The book's own case: a level on screen is a level the exchange published,
  // and the state of the resource that delivered it does not unpublish it.
  it('keeps book levels pickable while the depth resource is not live', () => {
    const bookInState = (status, levels) => createState({
      resources: Object.freeze({
        ...createState().resources,
        depth: Object.freeze({
          ...createState().resources.depth,
          ...(levels === undefined ? {} : levels),
          state: status,
        }),
      }),
    })
    const { unmount } = renderView({ state: bookInState('disconnected') })
    expect(screen.getByRole('button', { name: /^Bid book level: price 58420\.00/ })).toBeEnabled()
    unmount()

    renderView({
      state: bookInState('live', {
        bids: Object.freeze([]),
        asks: Object.freeze([]),
      }),
    })
    expect(screen.queryByRole('button', { name: /book level/ })).not.toBeInTheDocument()
  })

  it('refuses a price pick only where the chart has no price on it', () => {
    const onDraftPriceChange = vi.fn()
    renderView({ state: chartInState('live', { rows: Object.freeze([]) }), onDraftPriceChange })
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    expect(onDraftPriceChange).not.toHaveBeenCalled()
  })

  // The order being lifted is the desk's own, working on the exchange's book. It
  // has nothing to do with the market-data path, and an empty chart is no reason
  // to strand a drag the operator has already started.
  it('lets an order be lifted off the chart whatever the market data is doing', () => {
    const onOrderLift = vi.fn()
    const { unmount } = renderView({ state: chartInState('disconnected'), onOrderLift })
    fireEvent.click(screen.getByRole('button', { name: 'Lift chart order' }))
    expect(onOrderLift).toHaveBeenCalledWith({ orderId: '77' })
    unmount()

    renderView({ state: chartInState('loading', { rows: Object.freeze([]) }), onOrderLift })
    fireEvent.click(screen.getByRole('button', { name: 'Lift chart order' }))
    expect(onOrderLift).toHaveBeenCalledTimes(2)
  })

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
    expect(screen.getByRole('button', { name: /^Ask book level: price 58420\.50/ })).toBeEnabled()
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
    expect(screen.queryByRole('button', { name: /book level: price 58420\.(?:00|50)/ }))
      .not.toBeInTheDocument()
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
    openTapeSettings()
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
    openTapeSettings()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  // The request that opens a contract carries the reading its rows need, and the
  // panel states that reading as the contract opens. Restored from an effect
  // instead, the step arrives one commit later — after the subscription has gone
  // out — so the first snapshot is bought for a step this contract is not being
  // read at, and the book opens short and climbs to itself.
  it('states the reading of the contract being opened, not of the one being left', () => {
    localStorage.setItem('futures.bookView', JSON.stringify({
      ETHUSDT: { sideMode: 'both', stepMultiplier: 50 },
    }))
    const onDepthRangeChange = vi.fn()
    const properties = {
      identity: 'USDⓈ-M PRODUCTION · REAL MONEY',
      state: createState(),
      selectedInterval: '1m',
      onDepthRangeChange,
      onSymbolChange: () => {},
      onIntervalChange: () => {},
    }
    const { rerender } = render(
      <FuturesWorkstationView {...properties} selectedSymbol="BTCUSDT" />,
    )
    // Fourteen rows at this contract's tick, which is what BTCUSDT is read at.
    expect(onDepthRangeChange).toHaveBeenLastCalledWith('1.4')
    onDepthRangeChange.mockClear()

    rerender(
      <FuturesWorkstationView
        {...properties}
        state={createState({ symbol: 'ETHUSDT' })}
        selectedSymbol="ETHUSDT"
      />,
    )
    // Fourteen rows at fifty ticks — stated once, and never at the step the
    // contract being left was read at.
    expect(onDepthRangeChange.mock.calls).toEqual([['70']])
  })

  // A book delivered short is a book of exact, current levels — fewer of them.
  // Gated on a live badge alone, every level went dead the moment the badge did;
  // on a contract the exchange does not publish deep enough for the step it is
  // read at, permanently.
  it('keeps the levels of a book it could not prove pickable', () => {
    const state = createState()
    renderView({
      state: createState({
        resources: Object.freeze({
          ...state.resources,
          depth: Object.freeze({ ...state.resources.depth, state: 'stale' }),
        }),
      }),
    })
    expect(screen.getByRole('button', { name: /^Ask book level: price 58420\.50/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Bid book level: price 58420\.00/ })).toBeEnabled()
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
    fireEvent.click(screen.getByRole('button', { name: /^Bid book level: price 58420\.00/ }), { altKey: true })
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Ask book level: price 58420\.50/ }), { altKey: true })

    rerender(
      <FuturesWorkstationView
        {...properties}
        state={createState({ symbol: 'ETHUSDT' })}
        selectedSymbol="ETHUSDT"
      />,
    )
    const bid = screen.getByRole('button', { name: /^Bid book level: price 58420\.00/ })
    const ask = screen.getByRole('button', { name: /^Ask book level: price 58420\.50/ })
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
  it('renders recent contracts as a distinct wrapping pill group', () => {
    const { container } = renderView({
      selectedSymbol: 'BTCUSDT',
      symbolHistory: { recent: ['ETHUSDT', 'BTCUSDT'], favorites: [] },
    })
    const recent = screen.getByRole('list', { name: 'Recent contracts' })
    expect(recent).toHaveClass('futures-workstation-recent-contracts')
    expect(within(recent).getAllByRole('listitem')).toHaveLength(2)
    expect(within(recent).getAllByRole('button', { name: /^(?:BTC|ETH)USDT/ })
      .map(button => button.textContent)).toEqual(['ETHUSDT', 'BTCUSDT'])
    expect(container.querySelector('.futures-workstation-contract-list')).toBeNull()
  })

  it('lets recent pills use free rail height before enabling vertical overflow', () => {
    const stylesheet = readFileSync(
      'src/components/features/futures/FuturesWorkstation.css',
      'utf8',
    )
    const recentRule = stylesheet.match(
      /\.futures-workstation-recent-contracts\s*\{(?<declarations>[^}]*)\}/,
    )?.groups?.declarations

    expect(recentRule).toContain('flex: 0 1 auto;')
    expect(recentRule).toContain('min-height: 0;')
    expect(recentRule).toContain('overflow-y: auto;')
    expect(recentRule).not.toMatch(/max-height\s*:/)
  })

  it('reserves the desktop market rail at 65/35 without changing the mobile stack', () => {
    const stylesheet = readFileSync(
      'src/components/features/futures/FuturesWorkstation.css',
      'utf8',
    )
    const desktopRule = stylesheet.match(
      /@media \(min-width: 761px\) \{[\s\S]*?\.futures-workstation\s*\{(?<declarations>[^}]*)\}/,
    )?.groups?.declarations
    const mobileRule = stylesheet.match(
      /@media \(max-width: 760px\) \{[\s\S]*?\.futures-workstation\s*\{(?<declarations>[^}]*)\}/,
    )?.groups?.declarations

    expect(desktopRule).toContain(
      'grid-template-rows: auto auto minmax(0, 65fr) minmax(0, 35fr) auto;',
    )
    expect(mobileRule).toContain(
      'grid-template-rows: auto auto auto minmax(390px, 56vh) auto auto;',
    )
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

    const recent = screen.getByRole('list', { name: 'Recent contracts' })
    const listed = within(recent).getAllByRole('button', { name: /^(?:BLUAI|BICO)USDT/ })
    expect(listed[0]).toHaveTextContent('BLUAIUSDT')
    expect(listed[1]).toHaveTextContent('BICOUSDT')
    expect(listed[0].closest('[role="listitem"]')).toHaveAttribute('data-pending', 'true')
    expect(screen.getByText('Loading contracts…')).toBeInTheDocument()
  })

  // Deciding the price direction during the render made React throw that render
  // away and run the whole workstation again — on every tick of a liquid
  // contract, which is ten times a second before the tape is counted. It is
  // decided after the render now, so a tick costs one pass and only a turn of
  // the market costs a second.
  describe('what a price tick costs', () => {
    const properties = {
      identity: 'USDⓈ-M PRODUCTION · REAL MONEY',
      selectedSymbol: 'BTCUSDT',
      selectedInterval: '1m',
      symbolHistory: { recent: ['BTCUSDT'], favorites: [] },
      onSymbolChange: vi.fn(),
      onIntervalChange: vi.fn(),
    }
    const atPrice = (price) => {
      const base = createState()
      return Object.freeze({
        ...base,
        resources: Object.freeze({
          ...base.resources,
          header: Object.freeze({ ...base.resources.header, lastPrice: price }),
          candles: Object.freeze({
            ...base.resources.candles,
            contract: Object.freeze([candle(price)]),
          }),
        }),
      })
    }
    const passes = () => workstationViewMocks.formatExchangePrice.mock.calls.length

    it('renders once for a tick that keeps going the same way', () => {
      const { rerender } = render(
        <FuturesWorkstationView {...properties} state={atPrice('58420.25')} />,
      )
      rerender(<FuturesWorkstationView {...properties} state={atPrice('58421.00')} />)

      workstationViewMocks.formatExchangePrice.mockClear()
      rerender(<FuturesWorkstationView {...properties} state={atPrice('58422.00')} />)

      expect(passes()).toBe(1)
      expect(screen.getByLabelText(/Last traded price .*, moving up/)).toBeInTheDocument()
    })

    it('renders once for a price that did not move', () => {
      const { rerender } = render(
        <FuturesWorkstationView {...properties} state={atPrice('58420.25')} />,
      )
      rerender(<FuturesWorkstationView {...properties} state={atPrice('58421.00')} />)

      workstationViewMocks.formatExchangePrice.mockClear()
      rerender(<FuturesWorkstationView {...properties} state={atPrice('58421.00')} />)

      // An unchanged price keeps the direction it last had rather than going
      // neutral, and costs nothing to keep it.
      expect(passes()).toBe(1)
      expect(screen.getByLabelText(/Last traded price .*, moving up/)).toBeInTheDocument()
    })

    it('states the turn on the frame it happened, at the cost of one more pass', () => {
      const { rerender } = render(
        <FuturesWorkstationView {...properties} state={atPrice('58420.25')} />,
      )
      rerender(<FuturesWorkstationView {...properties} state={atPrice('58421.00')} />)

      workstationViewMocks.formatExchangePrice.mockClear()
      rerender(<FuturesWorkstationView {...properties} state={atPrice('58419.00')} />)

      expect(passes()).toBe(2)
      expect(screen.getByLabelText(/Last traded price .*, moving down/)).toBeInTheDocument()
    })

    it('reads the first price of a contract rather than calling it a move', () => {
      render(<FuturesWorkstationView {...properties} state={atPrice('58420.25')} />)

      expect(screen.getByLabelText(/Last traded price .*, neutral/)).toBeInTheDocument()
    })
  })

  // The book and the tape arrive on different frames, roughly ten and four a
  // second, and each used to redraw the other. Measured by what a frame costs at
  // two panel sizes: if the part that did not change contributes nothing to the
  // difference, it was not redrawn.
  describe('what one frame redraws', () => {
    const properties = {
      identity: 'USDⓈ-M PRODUCTION · REAL MONEY',
      selectedSymbol: 'BTCUSDT',
      selectedInterval: '1m',
      symbolHistory: { recent: ['BTCUSDT'], favorites: [] },
      onSymbolChange: vi.fn(),
      onIntervalChange: vi.fn(),
    }
    // A frame replaces one resource and leaves the others exactly as they were,
    // which is what the workstation hook does — and the whole reason a frame can
    // be told from the panel it does not belong to.
    const panelOf = ({ levelsPerSide, tradeRows }) => {
      const base = createState()
      return createState({
        resources: Object.freeze({
          ...base.resources,
          depth: Object.freeze({
            ...base.resources.depth,
            bids: bookLevels(58420, -1, levelsPerSide),
            asks: bookLevels(58420.5, 1, levelsPerSide),
          }),
          trades: Object.freeze({
            ...base.resources.trades,
            rows: Object.freeze(
              Array.from({ length: tradeRows }, (unused, index) => trade(String(900000 + index))),
            ),
          }),
        }),
      })
    }
    const printArrivesOn = (state, tradeRows) => Object.freeze({
      ...state,
      revision: state.revision + 1,
      resources: Object.freeze({
        ...state.resources,
        trades: Object.freeze({
          ...state.resources.trades,
          rows: Object.freeze(
            Array.from({ length: tradeRows }, (unused, index) => trade(String(910000 + index))),
          ),
        }),
      }),
    })
    const bookMovesOn = state => Object.freeze({
      ...state,
      revision: state.revision + 1,
      resources: Object.freeze({
        ...state.resources,
        depth: Object.freeze({
          ...state.resources.depth,
          lastUpdateId: '90071992547409931299',
          bids: bookLevels(58421, -1, state.resources.depth.bids.length),
          asks: bookLevels(58421.5, 1, state.resources.depth.asks.length),
        }),
      }),
    })
    const formats = () => workstationViewMocks.formatCompactUsdt.mock.calls.length
    // What one frame costs, with the panel sized as given and the other half of
    // the panel left exactly as it was.
    const costOf = (before, after) => {
      stubBookSideHeight(600)
      const { rerender, unmount } = render(
        <FuturesWorkstationView {...properties} state={before} />,
      )
      workstationViewMocks.formatCompactUsdt.mockClear()
      rerender(<FuturesWorkstationView {...properties} state={after} />)
      const cost = formats()
      unmount()
      return cost
    }

    it('does not redraw the book for a print, however deep the book is', () => {
      const printArrives = (levelsPerSide) => {
        const panel = panelOf({ levelsPerSide, tradeRows: 1 })
        return costOf(panel, printArrivesOn(panel, 2))
      }

      // A print costs the same whether two levels a side are on screen or
      // twenty-four. It used to cost 152 number formats more.
      expect(printArrives(24)).toBe(printArrives(2))
    })

    it('does not redraw the tape for a book update, however long the tape is', () => {
      const bookMoves = (tradeRows) => {
        const panel = panelOf({ levelsPerSide: 24, tradeRows })
        return costOf(panel, bookMovesOn(panel))
      }

      expect(bookMoves(40)).toBe(bookMoves(1))
    })

    // The rows still have to arrive when they are the ones that changed.
    it('redraws the side the frame belongs to', () => {
      stubBookSideHeight(600)
      const panel = panelOf({ levelsPerSide: 4, tradeRows: 1 })
      const { container, rerender } = render(
        <FuturesWorkstationView {...properties} state={panel} />,
      )
      rerender(
        <FuturesWorkstationView
          {...properties}
          state={bookMovesOn(printArrivesOn(panel, 3))}
        />,
      )

      expect(container.querySelectorAll('.futures-workstation-trade-rows > [role="group"]'))
        .toHaveLength(3)
      expect(
        container.querySelector('.futures-workstation-book-side.is-bid button')?.textContent,
      ).toContain('58421')
    })
  })

  it('reconciles a pending recent pill with catalogue metadata without duplication', () => {
    const state = createState()
    const properties = {
      identity: 'USDⓈ-M PRODUCTION · REAL MONEY',
      selectedSymbol: 'BTCUSDT',
      selectedInterval: '1m',
      symbolHistory: { recent: ['BTCUSDT'], favorites: [] },
      onSymbolChange: vi.fn(),
      onIntervalChange: vi.fn(),
    }
    const pendingState = createState({
      resources: Object.freeze({
        ...state.resources,
        catalog: Object.freeze({ ...state.resources.catalog, contracts: Object.freeze([]) }),
      }),
    })
    const { rerender, container } = render(
      <FuturesWorkstationView {...properties} state={pendingState} />,
    )
    expect(screen.getByRole('listitem')).toHaveAttribute('data-pending', 'true')

    rerender(<FuturesWorkstationView {...properties} state={state} />)
    const recent = screen.getByRole('list', { name: 'Recent contracts' })
    expect(within(recent).getAllByRole('button', { name: /^BTCUSDT/ })).toHaveLength(1)
    expect(screen.getByRole('listitem')).not.toHaveAttribute('data-pending')
    expect(container.querySelector('.futures-workstation-contract-list')).toBeNull()
    expect(screen.queryByText('Loading contracts…')).not.toBeInTheDocument()
  })

  it('keeps recent selection and favorite as isolated accessible controls', () => {
    const onToggleFavorite = vi.fn()
    const { onSymbolChange } = renderView({
      symbolHistory: { recent: ['ETHUSDT', 'BTCUSDT'], favorites: ['BTCUSDT'] },
      onToggleFavorite,
    })
    const recent = screen.getByRole('list', { name: 'Recent contracts' })
    const eth = within(recent).getByRole('button', { name: 'ETHUSDT' })
    const btc = within(recent).getByRole('button', { name: 'BTCUSDT' })
    expect(eth).toHaveAttribute('aria-pressed', 'false')
    expect(btc).toHaveAttribute('aria-pressed', 'true')
    expect(within(recent).getByRole('button', { name: 'Remove BTCUSDT favorite' }))
      .toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(recent).getByRole('button', { name: 'Add ETHUSDT favorite' }))
    expect(onToggleFavorite).toHaveBeenCalledExactlyOnceWith('ETHUSDT')
    expect(onSymbolChange).not.toHaveBeenCalled()

    fireEvent.click(eth)
    expect(onSymbolChange).toHaveBeenCalledExactlyOnceWith('ETHUSDT')
  })

  it('yields recent pills to one deduplicated list while search is active', () => {
    const { container, onSymbolChange } = renderView({
      symbolHistory: { recent: ['BTCUSDT'], favorites: [] },
    })
    expect(screen.getByRole('list', { name: 'Recent contracts' })).toBeInTheDocument()
    expect(container.querySelector('.futures-workstation-contract-list')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search Futures contracts'), {
      target: { value: 'USDT' },
    })

    expect(screen.queryByRole('list', { name: 'Recent contracts' })).not.toBeInTheDocument()
    const results = container.querySelector('.futures-workstation-contract-list')
    expect(within(results).getAllByRole('button', { name: /^BTCUSDT/ })).toHaveLength(1)
    const eth = within(results).getByRole('button', { name: /^ETHUSDT/ })
    expect(eth).toHaveTextContent('PERPETUAL')
    fireEvent.click(eth)
    expect(onSymbolChange).toHaveBeenCalledExactlyOnceWith('ETHUSDT')

    fireEvent.change(screen.getByLabelText('Search Futures contracts'), {
      target: { value: '' },
    })
    expect(screen.getByRole('list', { name: 'Recent contracts' })).toBeInTheDocument()
    expect(container.querySelector('.futures-workstation-contract-list')).toBeNull()
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
              Object.freeze({ price: '58419.90', quantity: '2' }),
              Object.freeze({ price: '58419.60', quantity: '2' }),
            ]),
            asks: Object.freeze([
              Object.freeze({ price: '58420.10', quantity: '3' }),
              Object.freeze({ price: '58420.60', quantity: '1' }),
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
              Object.freeze({ price: '100.7', quantity: '10' }),
              Object.freeze({ price: '100.6', quantity: '1' }),
              Object.freeze({ price: '100.5', quantity: '9' }),
              Object.freeze({ price: '100.4', quantity: '1' }),
              Object.freeze({ price: '100.3', quantity: '8' }),
              Object.freeze({ price: '100.2', quantity: '7' }),
              Object.freeze({ price: '100.1', quantity: '6' }),
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
            bids: Object.freeze([Object.freeze({ price: '100', quantity: '3' })]),
            asks: Object.freeze([Object.freeze({ price: '100', quantity: '1' })]),
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
    const withCandle = price => createState({
      resources: Object.freeze({
        ...base.resources,
        header: Object.freeze({ ...base.resources.header, lastPrice: price }),
        candles: Object.freeze({ ...base.resources.candles, contract: Object.freeze([candle(price)]) }),
      }),
    })
    const { container, rerender } = renderView({ state: withCandle('58500.00') })
    const bookLast = () => container.querySelector('.futures-workstation-book-last')

    // The stream pads its closes to a fixed width; the padding is not precision.
    expect(bookLast()).toHaveTextContent('58500')
    // One price on screen: the header is not separately sourced from the ticker.
    expect(within(screen.getByLabelText('Futures market header')).getByText('58500'))
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

  // The header's last price is every print the contract makes, taken before the
  // tape's filter and stated ahead of the ticker that reports the same number.
  // The candle close is the same figure at the kline stream's cadence.
  it('reads the print ahead of the candle close, and the close when there is no print', () => {
    const base = createState()
    const stateWith = (lastPrice, close) => createState({
      resources: Object.freeze({
        ...base.resources,
        header: Object.freeze({ ...base.resources.header, lastPrice }),
        candles: Object.freeze({
          ...base.resources.candles,
          contract: Object.freeze([candle(close)]),
        }),
      }),
    })
    const { container, rerender } = renderView({ state: stateWith('58610.00', '58500.00') })
    const bookLast = () => container.querySelector('.futures-workstation-book-last')
    expect(bookLast()).toHaveTextContent('58610')

    rerender(
      <FuturesWorkstationView
        identity="USDⓈ-M PRODUCTION · REAL MONEY"
        state={stateWith(null, '58500.00')}
        selectedSymbol="BTCUSDT"
        selectedInterval="1m"
        onSymbolChange={() => {}}
        onIntervalChange={() => {}}
      />,
    )
    expect(bookLast()).toHaveTextContent('58500')
  })

  // Binance pads a kline close to a fixed width: BLUAIUSDT trades at 2.601 and
  // arrives as `2.6010000`, which read as a price with four digits of noise on it.
  it('drops the stream’s padding from the last price without rounding it', () => {
    const base = createState()
    const withCandle = price => createState({
      resources: Object.freeze({
        ...base.resources,
        header: Object.freeze({ ...base.resources.header, lastPrice: price }),
        candles: Object.freeze({ ...base.resources.candles, contract: Object.freeze([candle(price)]) }),
      }),
    })
    const { container, rerender } = renderView({ state: withCandle('2.6010000') })
    const bookLast = () => container.querySelector('.futures-workstation-book-last')
    expect(bookLast()).toHaveTextContent('2.601')
    expect(bookLast()).not.toHaveTextContent('2.6010')

    // A coin quoted in fractions of a cent keeps every digit it trades at: the
    // padding is dropped, the precision is not.
    rerender(
      <FuturesWorkstationView
        identity="USDⓈ-M PRODUCTION · REAL MONEY"
        state={withCandle('0.00123000')}
        selectedSymbol="BTCUSDT"
        selectedInterval="1m"
        onSymbolChange={() => {}}
        onIntervalChange={() => {}}
      />,
    )
    expect(bookLast()).toHaveTextContent('0.00123')
  })

  it('states the last move as a direction rather than as a maker side', () => {
    const base = createState()
    const withCandle = (price, symbol = 'BTCUSDT') => createState({
      symbol,
      resources: Object.freeze({
        ...base.resources,
        header: Object.freeze({ ...base.resources.header, lastPrice: price }),
        candles: Object.freeze({ ...base.resources.candles, contract: Object.freeze([candle(price)]) }),
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
    expect(bookLast()).toHaveAttribute('aria-label', 'Last traded price 58500, neutral')
    expect(bookLast()).toHaveTextContent('58500')
    expect(bookLast()).not.toHaveTextContent(/↑|↓|last/i)
    expect(bookLast().children).toHaveLength(1)

    show('58600.00')
    expect(bookLast()).toHaveClass('is-up')
    expect(bookLast()).toHaveAttribute('aria-label', 'Last traded price 58600, moving up')
    expect(bookLast()).not.toHaveTextContent(/↑|↓|last/i)

    show('58400.00')
    expect(bookLast()).toHaveClass('is-down')
    expect(bookLast()).toHaveAttribute('aria-label', 'Last traded price 58400, moving down')
    expect(bookLast()).not.toHaveTextContent(/↑|↓|last/i)

    // An unchanged price is not a reversal: the row keeps the way it was going.
    show('58400.00')
    expect(bookLast()).toHaveClass('is-down')

    // A direction belongs to one book.
    show('2000.00', 'ETHUSDT')
    expect(bookLast()).toHaveClass('is-flat')
    expect(bookLast()).toHaveAttribute('aria-label', 'Last traded price 2000, neutral')
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
      onOrderLift: vi.fn(),
      onOrderDrop: vi.fn(),
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
            Object.freeze({ price: '58419.50', quantity: '4' }),
          ]),
        }),
      }),
    })

    rerender(workstation(nextState))

    expect(screen.getByRole('button', { name: /^Bid book level: price 58419\.50/ }))
      .toBeInTheDocument()
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

  // The rail's own storage round trip, which no test covered: the container reads
  // the recency list on mount, floats the contract that is picked to its front, and
  // writes it through, so a restart opens on the contracts the operator works with
  // even before the catalogue arrives.
  it('carries the recent contracts across a restart', () => {
    localStorage.setItem('cc-trade:futures-symbols:v1', JSON.stringify({
      recent: ['BICOUSDT', 'BEATUSDT'],
      favorites: [],
      lastSymbol: 'BICOUSDT',
    }))
    const workstation = () => (
      <FuturesProductionWorkstation
        enabled={false}
        wsConnection={null}
        sendMessage={() => false}
        executionState={productionExecutionState}
      />
    )
    const first = render(workstation())
    const listed = () => screen.getAllByRole('button', { name: /^(?:BICO|BEAT)USDT/ })
    expect(listed().map(button => button.textContent))
      .toEqual(['BICOUSDT', 'BEATUSDT'])

    fireEvent.click(listed()[1])
    expect(JSON.parse(localStorage.getItem('cc-trade:futures-symbols:v1')))
      .toMatchObject({ recent: ['BEATUSDT', 'BICOUSDT'], lastSymbol: 'BEATUSDT' })

    first.unmount()
    render(workstation())
    expect(listed().map(button => button.textContent))
      .toEqual(['BEATUSDT', 'BICOUSDT'])
  })

  // Spot parity: the pair changes more often than anything else on the desk, and
  // reaching for it cost a trip to the rail's search box and a click on a row.
  it('opens the pair list on a typed letter and switches to what is picked', () => {
    vi.stubGlobal('WebSocket', undefined)
    localStorage.setItem('cc-trade:futures-symbols:v1', JSON.stringify({
      recent: ['BICOUSDT', 'BEATUSDT'],
      favorites: [],
      lastSymbol: 'BICOUSDT',
    }))
    render(
      <FuturesProductionWorkstation
        enabled
        wsConnection={null}
        sendMessage={() => false}
        executionState={productionExecutionState}
      />,
    )
    fireEvent.keyDown(document, { key: 'b' })
    const popup = screen.getByPlaceholderText('Type pair (e.g. BTCUSDT)')
    expect(popup).toHaveValue('B')
    const offered = () => Array.from(
      document.querySelectorAll('.quick-switch-item'),
    ).map(item => item.textContent)
    // Recency ranks above the alphabet: BEAT sorts first alphabetically and is
    // offered second, because BICO is where the operator just was.
    expect(offered()).toEqual(['BICOUSDT', 'BEATUSDT'])
    fireEvent.keyDown(popup, { key: 'ArrowDown' })
    fireEvent.keyDown(popup, { key: 'Enter' })
    expect(screen.queryByPlaceholderText('Type pair (e.g. BTCUSDT)')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('cc-trade:futures-symbols:v1')))
      .toMatchObject({ recent: ['BEATUSDT', 'BICOUSDT'], lastSymbol: 'BEATUSDT' })
  })

  it('opens the interval list on a typed digit', () => {
    vi.stubGlobal('WebSocket', undefined)
    render(
      <FuturesProductionWorkstation
        enabled
        wsConnection={null}
        sendMessage={() => false}
        executionState={productionExecutionState}
      />,
    )
    // The workstation's own shortcuts are mouse gestures and modifier keys, so a
    // bare digit is free to mean an interval.
    fireEvent.keyDown(document, { key: '5' })
    const popup = screen.getByPlaceholderText('Type interval (e.g. 15m)')
    expect(popup).toHaveValue('5')
    expect(Array.from(document.querySelectorAll('.quick-switch-item')).map(i => i.textContent))
      .toEqual(['5m', '15m'])
    fireEvent.keyDown(popup, { key: 'Enter' })
    expect(screen.getByRole('button', { name: '5m' })).toHaveAttribute('aria-pressed', 'true')
  })

  // Typing into a field is typing, and a modifier is a gesture, not a search.
  it('leaves typing in a field and modified keys alone', () => {
    vi.stubGlobal('WebSocket', undefined)
    render(
      <FuturesProductionWorkstation
        enabled
        wsConnection={null}
        sendMessage={() => false}
        executionState={productionExecutionState}
      />,
    )
    fireEvent.keyDown(screen.getByLabelText('Search Futures contracts'), { key: 'b' })
    expect(screen.queryByPlaceholderText('Type pair (e.g. BTCUSDT)')).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'b', ctrlKey: true })
    expect(screen.queryByPlaceholderText('Type pair (e.g. BTCUSDT)')).not.toBeInTheDocument()
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
