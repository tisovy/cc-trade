import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import {
  FUTURES_APP_STRESS_BYTES_PER_CYCLE,
  FUTURES_APP_STRESS_CYCLE_MS,
  FUTURES_APP_STRESS_CYCLES,
  FuturesAppStressSocket,
  createFuturesAppStressCycle,
} from './test/futuresAppStressHarness.js'
import { attachMockLocalStorage } from './test/mocks/index.js'
import { createFuturesProductionWorkstationEvent } from './utils/futuresProductionWorkstationProtocol.js'
import {
  MARKET_WORKSPACES,
  MARKET_WORKSPACE_STORAGE_KEY,
} from './utils/marketWorkspaceStorage.js'

// The chart has its own renderer tests and needs browser canvas primitives that
// JSDOM does not provide. Everything carrying the burst into App and the real
// order-book view remains mounted here.
vi.mock('./components/features/futures/FuturesWorkstationChart.jsx', () => ({
  default: () => <div data-testid="stress-chart-surface" />,
}))

const OBSERVED_AT = 1_784_000_000_000

const contractFilters = Object.freeze({
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

const resourceEvent = (requestId, revision, resource, payload) => (
  createFuturesProductionWorkstationEvent({
    requestId,
    symbol: 'BTCUSDT',
    generation: 1,
    revision,
    resource,
    state: 'live',
    observedAt: OBSERVED_AT,
    payload,
  })
)

describe('App dense Futures ingress', () => {
  let localStorageMock

  beforeEach(() => {
    localStorageMock = attachMockLocalStorage()
    localStorageMock.setItem(MARKET_WORKSPACE_STORAGE_KEY, MARKET_WORKSPACES.FUTURES_LIVE)
    FuturesAppStressSocket.reset()
    vi.stubGlobal('WebSocket', FuturesAppStressSocket)
    vi.stubGlobal('ccTradeRuntime', {
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 14_477,
        token: 'stress-session',
        tokenParam: 'token',
      },
    })
  })

  afterEach(() => {
    cleanup()
    FuturesAppStressSocket.reset()
    localStorageMock.clear()
    vi.unstubAllGlobals()
  })

  it('renders the newest book and stays interactive at 2 MiB per 100 ms cycle', async () => {
    const { container } = render(<App />)
    const socket = FuturesAppStressSocket.instances[0]

    act(() => socket.open())
    expect(socket.sent).toContainEqual({ action: 'get_startup_status' })

    act(() => socket.emitMessage({
      type: 'startup_status',
      version: 2,
      state: 'READY',
      code: 'READY',
      ready: true,
      missingFields: [],
      retiredFields: [],
    }))
    await waitFor(() => expect(socket.sent).toContainEqual({
      action: 'activate_market',
      marketMode: MARKET_WORKSPACES.FUTURES_LIVE,
    }))

    act(() => socket.emitMessage({
      type: 'market_activation',
      version: 1,
      marketMode: MARKET_WORKSPACES.FUTURES_LIVE,
      generation: 1,
    }))
    expect(await screen.findByTestId('futures-production-workstation')).toBeInTheDocument()

    const subscription = await waitFor(() => {
      const request = socket.sent.find(message => (
        message.action === 'futures.production.workstation.subscribe'
      ))
      expect(request).toBeDefined()
      return request
    })

    act(() => {
      socket.emitMessage(resourceEvent(subscription.requestId, 1, 'status', {
        connected: true,
        reasonCode: null,
      }))
      socket.emitMessage(resourceEvent(subscription.requestId, 2, 'catalog', {
        offset: 0,
        total: 1,
        complete: true,
        contracts: [{
          symbol: 'BTCUSDT',
          pair: 'BTCUSDT',
          contractType: 'PERPETUAL',
          status: 'TRADING',
          baseAsset: 'BTC',
          quoteAsset: 'USDT',
          marginAsset: 'USDT',
          tradable: true,
          filters: contractFilters,
        }],
      }))
      socket.emitMessage(resourceEvent(subscription.requestId, 3, 'header', {
        lastPrice: '65000',
        markPrice: '65000',
        indexPrice: '65000',
        basis: '0',
        priceChange: '0',
        priceChangePercent: '0',
        highPrice: '66000',
        lowPrice: '64000',
        volume: '1000',
        quoteVolume: '65000000',
        lastQuantity: '1',
        fundingRate: '0',
        fundingRatePercent: '0',
        nextFundingTime: OBSERVED_AT + 3_600_000,
        eventTime: OBSERVED_AT,
        contractStatus: 'TRADING',
      }))
    })

    const cycles = []
    let nextRevision = 4
    for (let index = 0; index < FUTURES_APP_STRESS_CYCLES; index += 1) {
      const cycle = createFuturesAppStressCycle({
        requestId: subscription.requestId,
        generation: 1,
        firstRevision: nextRevision,
        observedAt: OBSERVED_AT + ((index + 1) * FUTURES_APP_STRESS_CYCLE_MS),
      })
      cycles.push(cycle)
      nextRevision = cycle.lastRevision + 1

      await act(async () => {
        cycle.frames.forEach(frame => socket.emitMessage(frame))
      })

      expect(cycle.bytes).toBeGreaterThanOrEqual(FUTURES_APP_STRESS_BYTES_PER_CYCLE)
      expect(container.querySelector('.futures-workstation-depth')).toHaveAttribute(
        'data-state',
        'live',
      )
      expect(screen.getByRole('button', {
        name: new RegExp(`^Bid book level: price ${cycle.newestBid}`),
      })).toBeInTheDocument()

      const bidsOnly = screen.getByRole('button', { name: 'Show buy side only' })
      fireEvent.click(bidsOnly)
      expect(bidsOnly).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'Show both book sides' }))
    }

    expect(cycles).toHaveLength(FUTURES_APP_STRESS_CYCLES)
    expect(cycles.reduce((total, cycle) => total + cycle.bytes, 0))
      .toBeGreaterThanOrEqual(FUTURES_APP_STRESS_BYTES_PER_CYCLE * FUTURES_APP_STRESS_CYCLES)

    fireEvent.click(screen.getByTestId('market-mode-spot'))
    expect(screen.queryByTestId('futures-production-workstation')).not.toBeInTheDocument()
    await waitFor(() => expect(socket.sent).toContainEqual({
      action: 'activate_market',
      marketMode: MARKET_WORKSPACES.SPOT,
    }))
  }, 20_000)
})
