import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FuturesWorkstationView from './FuturesWorkstationView.jsx'
import FuturesTestnetWorkstation from './FuturesTestnetWorkstation.jsx'
import FuturesProductionWorkstation from './FuturesProductionWorkstation.jsx'

vi.mock('./FuturesWorkstationChart.jsx', () => ({
  default: ({ onPricePick, drawings, alerts }) => (
    <div data-testid="mock-futures-chart">
      <button type="button" onClick={() => onPricePick('58420.25')}>Pick chart price</button>
      <span>drawings {drawings.length}</span>
      <span>alerts {alerts.length}</span>
    </div>
  ),
}))

const filters = Object.freeze({
  price: Object.freeze({ min: '0.1', max: '1000000', tickSize: '0.1' }),
  quantity: Object.freeze({ min: '0.001', max: '1000', stepSize: '0.001' }),
  marketQuantity: Object.freeze({ min: '0.001', max: '100', stepSize: '0.001' }),
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
  environment: 'TESTNET',
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
      identity="USDⓈ-M TESTNET · SIMULATED FUNDS"
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

afterEach(() => vi.clearAllMocks())

describe('pure Futures workstation presentation', () => {
  it('renders identity, exact market context, filters, book and bounded tape', () => {
    renderView()
    expect(screen.getByTestId('futures-workstation-identity')).toHaveTextContent(
      'USDⓈ-M TESTNET · SIMULATED FUNDSPUBLIC MARKET DATA · READ ONLYLIVEgen 7 · rev 42',
    )
    expect(screen.getByLabelText('Futures market header')).toHaveTextContent('58420.25')
    expect(screen.getByLabelText('Futures market header')).toHaveTextContent('58419.99')
    expect(screen.getByLabelText('Futures market header')).toHaveTextContent('58418.75')
    expect(screen.getByLabelText('Exact contract filters')).toHaveTextContent('tickSize 0.1')
    expect(screen.getByLabelText('Exact contract filters')).toHaveTextContent('Min notional5 USDT')
    expect(screen.getByText('u 90071992547409931234')).toBeInTheDocument()
    expect(screen.getByText('0.25')).toBeInTheDocument()
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

  it('turns chart and book clicks into a local non-executable draft only', () => {
    const { onSymbolChange, onIntervalChange } = renderView()
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    expect(screen.getByLabelText('Local non-executable price draft')).toHaveTextContent('58420.25')
    expect(screen.getByLabelText('Local non-executable price draft')).toHaveTextContent(
      'DISPLAY ONLY · NO INTENT · NO SUBMIT',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal drawing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick chart price' }))
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('drawings 1')
    fireEvent.click(screen.getByRole('button', { name: 'Add display alert' }))
    expect(screen.getByTestId('mock-futures-chart')).toHaveTextContent('alerts 1')
    fireEvent.click(screen.getByRole('button', { name: /^58420\.50/ }))
    expect(screen.getByLabelText('Local non-executable price draft')).toHaveTextContent('58420.50')
    expect(onSymbolChange).not.toHaveBeenCalled()
    expect(onIntervalChange).not.toHaveBeenCalled()
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
        identity="USDⓈ-M TESTNET · SIMULATED FUNDS"
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
})

const testnetExecutionState = Object.freeze({
  connected: false,
  subscribed: false,
  submissionLocked: false,
  revision: null,
  symbol: null,
  capability: null,
  intent: null,
  attempt: null,
  prepareIntent: vi.fn(() => false),
  placeOrder: vi.fn(() => false),
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
  prepareOrderIntent: vi.fn(() => false),
  placeOrder: vi.fn(() => false),
  prepareCancelAllOpenOrdersIntent: vi.fn(() => false),
  cancelAllOpenOrders: vi.fn(() => false),
  prepareClosePositionsIntent: vi.fn(() => false),
  closePositions: vi.fn(() => false),
  prepareEngageKillSwitchIntent: vi.fn(() => false),
  engageKillSwitch: vi.fn(() => false),
  prepareDisengageKillSwitchIntent: vi.fn(() => false),
  disengageKillSwitch: vi.fn(() => false),
})

describe('environment-specific workstation containers', () => {
  it('retains the Phase 5/6 surfaces in an explicit blue safety drawer', () => {
    render(
      <FuturesTestnetWorkstation
        enabled={false}
        wsConnection={null}
        sendMessage={() => false}
        readOnlyState={{ status: 'idle', environment: 'mock', symbol: null, resources: {} }}
        executionState={testnetExecutionState}
      />,
    )
    expect(screen.getByText('Phase 5/6 safety drawer')).toBeInTheDocument()
    expect(screen.getByLabelText('USDⓈ-M futures read-only risk')).toBeInTheDocument()
    expect(screen.getByLabelText('USDⓈ-M testnet reduce-only execution')).toBeInTheDocument()
  })

  it('retains Phase 7 caps and recovery in an explicit red safety drawer', () => {
    render(
      <FuturesProductionWorkstation
        enabled={false}
        wsConnection={null}
        sendMessage={() => false}
        executionState={productionExecutionState}
      />,
    )
    expect(screen.getByText('Phase 7 production safety drawer')).toBeInTheDocument()
    expect(screen.getByText('1x · 10 USDT/order · 50 USDT/day · durable recovery')).toBeInTheDocument()
    expect(screen.getByLabelText('USDⓈ-M production real-order execution')).toBeInTheDocument()
  })
})
