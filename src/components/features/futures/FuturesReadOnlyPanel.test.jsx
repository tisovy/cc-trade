import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FuturesReadOnlyPanel from './FuturesReadOnlyPanel'

const updatedAt = 1783857600000

const resource = (status, data, errorCode = null) => ({
  status,
  data,
  lastUpdatedAt: updatedAt,
  errorCode,
})

const exchangeInfo = {
  marketType: 'futures',
  symbol: 'BTCUSDT',
  pair: 'BTCUSDT',
  contractType: 'PERPETUAL',
  status: 'TRADING',
  assets: { base: 'BTC', quote: 'USDT', margin: 'USDT' },
  filters: {
    price: { min: '0.10', max: '4529764', tickSize: '0.10' },
    quantity: { min: '0.001', max: '1000', stepSize: '0.001' },
    marketQuantity: { min: '0.000', max: '1000', stepSize: '0.000' },
    minimumNotional: '5.00000000',
  },
  supportedOrderTypes: ['LIMIT'],
  supportedTimeInForce: ['GTC'],
}

const market = {
  markPrice: {
    marketType: 'futures',
    symbol: 'BTCUSDT',
    markPrice: '60000.12000000',
    indexPrice: '59998.34000000',
    estimatedSettlePrice: '0.00000000',
    time: updatedAt,
  },
  fundingState: {
    marketType: 'futures',
    symbol: 'BTCUSDT',
    lastFundingRate: '0.00010000',
    interestRate: '0.00000000',
    nextFundingTime: updatedAt + 3723000,
    time: updatedAt,
  },
}

const oneWayPosition = {
  marketType: 'futures',
  symbol: 'BTCUSDT',
  positionSide: 'BOTH',
  positionAmt: '0.010',
  entryPrice: '59000.00000000',
  breakEvenPrice: '59005.00000000',
  markPrice: '60000.12000000',
  unRealizedProfit: '10.00120000',
  liquidationPrice: '0.00000000',
  isolatedMargin: '0.00000000',
  notional: '600.00120000',
  marginAsset: 'USDT',
  isolatedWallet: '0.00000000',
  initialMargin: '30.00006000',
  maintMargin: '3.00000600',
  positionInitialMargin: '30.00006000',
  openOrderInitialMargin: '0.00000000',
  adl: 0,
  updateTime: 0,
}

const longPosition = {
  ...oneWayPosition,
  positionSide: 'LONG',
  positionAmt: '0.020',
  unRealizedProfit: '25.50000000',
  liquidationPrice: '41000.00000000',
}

const shortPosition = {
  ...oneWayPosition,
  positionSide: 'SHORT',
  positionAmt: '-0.015',
  unRealizedProfit: '-7.25000000',
  liquidationPrice: '81000.00000000',
}

const marginBalance = {
  marketType: 'futures',
  accountAlias: 'test',
  asset: 'USDT',
  balance: '1000.00000000',
  crossWalletBalance: '990.00000000',
  crossUnPnl: '-7.25000000',
  availableBalance: '940.00000000',
  maxWithdrawAmount: '940.00000000',
  marginAvailable: false,
  updateTime: 0,
}

const regularOrder = {
  marketType: 'futures',
  orderId: 0,
  clientOrderId: 'regular-0',
  symbol: 'BTCUSDT',
}

const algoOrder = {
  marketType: 'futures',
  algoId: 0,
  clientAlgoId: 'algo-0',
  actualOrderId: '',
  symbol: 'BTCUSDT',
}

const createState = (overrides = {}) => ({
  status: 'ready',
  connected: true,
  symbol: 'BTCUSDT',
  environment: 'mock',
  requestId: 'opaque-request',
  errorCode: null,
  resources: {
    exchangeInfo: resource('ready', exchangeInfo),
    market: resource('ready', market),
    positions: resource('ready', [oneWayPosition]),
    marginBalance: resource('ready', marginBalance),
    openOrders: resource('ready', [regularOrder]),
    algoOpenOrders: resource('ready', [algoOrder]),
  },
  ...overrides,
})

describe('FuturesReadOnlyPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(updatedAt)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the compact mock one-way risk snapshot with exact decimal strings', () => {
    render(<FuturesReadOnlyPanel state={createState()} />)

    expect(screen.getByText('USDⓈ-M READ ONLY')).toBeInTheDocument()
    expect(screen.getByText('MOCK')).toBeInTheDocument()
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument()
    const marketSection = screen.getByRole('heading', { name: 'Market & funding' }).closest('section')
    expect(within(marketSection).getByText('60000.12000000')).toBeInTheDocument()
    expect(screen.getByText('59998.34000000')).toBeInTheDocument()
    expect(screen.getByText('0.00010000')).toBeInTheDocument()
    expect(screen.getByText('01:02:03')).toBeInTheDocument()
    expect(screen.getByText('0.10')).toBeInTheDocument()
    expect(screen.getByText('0.001')).toBeInTheDocument()
    expect(screen.getByText('0.000')).toBeInTheDocument()
    expect(screen.getByText('5.00000000')).toBeInTheDocument()
    expect(screen.getByText('BOTH')).toBeInTheDocument()
    expect(screen.getByText('10.00120000')).toHaveClass('is-positive')
    expect(screen.getByText('0.00000000')).toBeInTheDocument()
    expect(screen.getByText('1000.00000000')).toBeInTheDocument()

    const orders = screen.getByRole('heading', { name: 'Open orders' }).closest('section')
    expect(within(orders).getByText('Regular').nextElementSibling).toHaveTextContent('1')
    expect(within(orders).getByText('Algo').nextElementSibling).toHaveTextContent('1')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('renders separate hedge sides and preserves positive and negative PnL on testnet', () => {
    const state = createState({
      environment: 'testnet',
      resources: {
        ...createState().resources,
        positions: resource('ready', [longPosition, shortPosition]),
      },
    })

    render(<FuturesReadOnlyPanel state={state} />)

    expect(screen.getByText('TESTNET')).toBeInTheDocument()
    expect(screen.getByText('LONG')).toBeInTheDocument()
    expect(screen.getByText('SHORT')).toBeInTheDocument()
    expect(screen.getByText('25.50000000')).toHaveClass('is-positive')
    const shortPositionCard = screen.getByText('SHORT').closest('article')
    expect(within(shortPositionCard).getByText('-7.25000000')).toHaveClass('is-negative')
    expect(screen.getByText('-0.015')).toBeInTheDocument()
  })

  it('renders signed negative zero PnL as neutral', () => {
    const zeroPosition = {
      ...oneWayPosition,
      unRealizedProfit: '-0.00000000',
    }
    const state = createState({
      resources: {
        ...createState().resources,
        positions: resource('ready', [zeroPosition]),
        marginBalance: resource('ready', {
          ...marginBalance,
          crossUnPnl: '+0.00000000',
        }),
      },
    })

    render(<FuturesReadOnlyPanel state={state} />)

    expect(screen.getByText('-0.00000000')).toHaveClass('is-neutral')
    expect(screen.getByText('+0.00000000')).toHaveClass('is-neutral')
  })

  it('shows documented empty arrays and zero counts without inventing account data', () => {
    const state = createState({
      status: 'partial',
      resources: {
        ...createState().resources,
        positions: resource('empty', []),
        marginBalance: resource('unavailable', null, 'FUTURES_BALANCE_UNAVAILABLE'),
        openOrders: resource('empty', []),
        algoOpenOrders: resource('empty', []),
      },
    })

    render(<FuturesReadOnlyPanel state={state} />)

    expect(screen.getByText('No positions')).toBeInTheDocument()
    expect(screen.getByText('FUTURES_BALANCE_UNAVAILABLE')).toBeInTheDocument()
    expect(screen.queryByText('USDT')).not.toBeInTheDocument()

    const orders = screen.getByRole('heading', { name: 'Open orders' }).closest('section')
    expect(within(orders).getByText('Regular').nextElementSibling).toHaveTextContent('0')
    expect(within(orders).getByText('Algo').nextElementSibling).toHaveTextContent('0')
  })

  it.each([
    ['loading', 'Loading'],
    ['unavailable', 'Unavailable'],
    ['disconnected', 'Disconnected'],
    ['error', 'Error'],
  ])('renders the %s lifecycle state without synthetic values', (status, label) => {
    render(
      <FuturesReadOnlyPanel
        state={{
          status,
          connected: false,
          symbol: 'BTCUSDT',
          environment: 'mock',
          resources: null,
          errorCode: status === 'error' ? 'FUTURES_READ_REJECTED' : null,
        }}
      />
    )

    expect(screen.getByLabelText('Futures connection status')).toHaveTextContent(label)
    expect(screen.queryByText('0.00000000')).not.toBeInTheDocument()
    if (status === 'error') {
      expect(screen.getByRole('alert')).toHaveTextContent('FUTURES_READ_REJECTED')
    }
  })

  it('keeps stale resource data visibly marked instead of replacing it', () => {
    const state = createState({
      status: 'stale',
      resources: {
        ...createState().resources,
        market: resource('stale', market, 'FUTURES_MARKET_STALE'),
      },
    })

    render(<FuturesReadOnlyPanel state={state} />)

    expect(screen.getAllByText('Stale').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('FUTURES_MARKET_STALE')).toBeInTheDocument()
    const marketSection = screen.getByRole('heading', { name: 'Market & funding' }).closest('section')
    expect(within(marketSection).getByText('60000.12000000')).toBeInTheDocument()
  })

  it('updates the funding countdown and clears its timer on teardown', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = render(<FuturesReadOnlyPanel state={createState()} />)

    expect(screen.getByText('01:02:03')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(screen.getByText('01:02:00')).toBeInTheDocument()
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
    clearIntervalSpy.mockRestore()
  })
})
