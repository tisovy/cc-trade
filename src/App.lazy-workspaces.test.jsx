import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachMockLocalStorage } from '@/test/mocks'
import {
  MARKET_WORKSPACES,
  MARKET_WORKSPACE_STORAGE_KEY,
} from './utils/marketWorkspaceStorage.js'
import App from './App.jsx'

const mocks = vi.hoisted(() => ({
  spotModuleLoads: 0,
  futuresModuleLoads: 0,
  spotRenders: 0,
  futuresRenders: 0,
  providerModes: [],
  startupStatus: null,
}))

vi.mock('./workspaces/SpotWorkspace.jsx', () => {
  mocks.spotModuleLoads += 1
  return {
    default: () => {
      mocks.spotRenders += 1
      return <main data-testid="lazy-spot-workspace">Spot workspace</main>
    },
  }
})

vi.mock('./workspaces/FuturesWorkspace.jsx', () => {
  mocks.futuresModuleLoads += 1
  return {
    default: () => {
      mocks.futuresRenders += 1
      return <main data-testid="lazy-futures-workspace">Futures workspace</main>
    },
  }
})

vi.mock('./context/GatewayContext.jsx', () => ({
  GatewayProvider: ({ activeMarketMode, children }) => {
    mocks.providerModes.push(activeMarketMode)
    // The backend acknowledges the market before its workspace may mount, so
    // the double stands in for that acknowledgement.
    mocks.activatedMode = activeMarketMode
    return children
  },
  useGatewayContext: () => ({
    marketActivation: { marketMode: mocks.activatedMode, generation: 1 },
    startupStatus: mocks.startupStatus ?? Object.freeze({
      version: 1,
      type: 'startup_status',
      state: 'READY',
      code: 'READY',
      ready: true,
      missingFields: [],
      retiredFields: [],
    }),
  }),
}))

vi.mock('./context/NotificationProvider.jsx', () => ({
  NotificationProvider: ({ children }) => children,
}))

vi.mock('./components/common/NotificationToast.jsx', () => ({
  default: () => null,
}))

const localStorageMock = attachMockLocalStorage()

describe('App lazy market workspace ownership', () => {
  beforeEach(() => {
    localStorageMock.clear()
    mocks.spotRenders = 0
    mocks.futuresRenders = 0
    mocks.providerModes.length = 0
    mocks.startupStatus = null
  })

  afterEach(() => {
    cleanup()
    localStorageMock.clear()
  })

  it('starts neutral with no fallback and imports only the explicitly selected workspace', async () => {
    render(<App />)

    expect(screen.getByTestId('market-workspace-selector')).toBeInTheDocument()
    expect(mocks.spotModuleLoads).toBe(0)
    expect(mocks.futuresModuleLoads).toBe(0)
    expect(mocks.spotRenders).toBe(0)
    expect(mocks.futuresRenders).toBe(0)

    fireEvent.click(screen.getByTestId('market-mode-futures-live'))
    expect(await screen.findByTestId('lazy-futures-workspace')).toBeInTheDocument()
    expect(mocks.futuresModuleLoads).toBe(1)
    expect(mocks.spotModuleLoads).toBe(0)
    expect(mocks.spotRenders).toBe(0)
    expect(localStorageMock.getItem(MARKET_WORKSPACE_STORAGE_KEY))
      .toBe(MARKET_WORKSPACES.FUTURES_LIVE)
  })

  it('restores persisted Spot directly without mounting Futures first', async () => {
    localStorageMock.setItem(MARKET_WORKSPACE_STORAGE_KEY, MARKET_WORKSPACES.SPOT)
    render(<App />)

    expect(await screen.findByTestId('lazy-spot-workspace')).toBeInTheDocument()
    expect(screen.queryByTestId('lazy-futures-workspace')).not.toBeInTheDocument()
    expect(mocks.spotRenders).toBeGreaterThan(0)
    expect(mocks.futuresRenders).toBe(0)
    expect(mocks.providerModes[0]).toBe(MARKET_WORKSPACES.SPOT)
  })

  it('mounts neither workspace while credential preflight is blocked', () => {
    localStorageMock.setItem(MARKET_WORKSPACE_STORAGE_KEY, MARKET_WORKSPACES.FUTURES_LIVE)
    mocks.startupStatus = Object.freeze({
      version: 1,
      type: 'startup_status',
      state: 'CONFIG_ERROR',
      code: 'MISSING_CREDENTIALS',
      ready: false,
      missingFields: ['BK', 'BS'],
      retiredFields: [],
    })

    render(<App />)
    expect(screen.getByTestId('startup-config-error'))
      .toHaveTextContent('Set BK and BS for Spot, and BFK and BFS for Futures')
    expect(mocks.spotRenders).toBe(0)
    expect(mocks.futuresRenders).toBe(0)
  })

  const startupStatusWith = markets => Object.freeze({
    version: 2,
    type: 'startup_status',
    state: 'READY',
    code: 'READY',
    ready: true,
    missingFields: [],
    retiredFields: [],
    markets: Object.freeze({
      spot: Object.freeze({
        market: 'spot',
        label: 'Spot',
        ready: markets.spot,
        code: markets.spot ? 'READY' : 'MISSING_CREDENTIALS',
        missingFields: markets.spot ? [] : ['BK', 'BS'],
      }),
      futures: Object.freeze({
        market: 'futures',
        label: 'Futures',
        ready: markets.futures,
        code: markets.futures ? 'READY' : 'MISSING_CREDENTIALS',
        missingFields: markets.futures ? [] : ['BFK', 'BFS'],
      }),
    }),
  })

  it('disables Futures and never mounts it when only Spot credentials exist', () => {
    mocks.startupStatus = startupStatusWith({ spot: true, futures: false })

    render(<App />)

    expect(screen.getByTestId('market-workspace-selector')).toBeInTheDocument()
    expect(screen.getByTestId('market-mode-futures-live')).toBeDisabled()
    expect(screen.getByTestId('market-mode-spot')).toBeEnabled()
    expect(screen.getByTestId('market-unavailable'))
      .toHaveTextContent('Set BFK and BFS and restart to enable Futures.')

    fireEvent.click(screen.getByTestId('market-mode-futures-live'))
    expect(mocks.futuresRenders).toBe(0)
    expect(screen.queryByTestId('lazy-futures-workspace')).not.toBeInTheDocument()
  })

  it('disables Spot and never mounts it when only Futures credentials exist', async () => {
    mocks.startupStatus = startupStatusWith({ spot: false, futures: true })

    render(<App />)

    expect(screen.getByTestId('market-mode-spot')).toBeDisabled()
    expect(screen.getByTestId('market-unavailable'))
      .toHaveTextContent('Set BK and BS and restart to enable Spot.')

    fireEvent.click(screen.getByTestId('market-mode-spot'))
    expect(mocks.spotRenders).toBe(0)

    fireEvent.click(screen.getByTestId('market-mode-futures-live'))
    expect(await screen.findByTestId('lazy-futures-workspace')).toBeInTheDocument()
    expect(mocks.spotRenders).toBe(0)
  })

  it('falls back to the selector when the persisted market lost its credentials', () => {
    localStorageMock.setItem(MARKET_WORKSPACE_STORAGE_KEY, MARKET_WORKSPACES.FUTURES_LIVE)
    mocks.startupStatus = startupStatusWith({ spot: true, futures: false })

    render(<App />)

    expect(screen.getByTestId('market-workspace-selector')).toBeInTheDocument()
    expect(mocks.futuresRenders).toBe(0)
    expect(mocks.spotRenders).toBe(0)
    // The persisted choice survives so fixing the environment restores it.
    expect(localStorageMock.getItem(MARKET_WORKSPACE_STORAGE_KEY))
      .toBe(MARKET_WORKSPACES.FUTURES_LIVE)
  })

  it('mounts both markets normally when both pairs are configured', async () => {
    mocks.startupStatus = startupStatusWith({ spot: true, futures: true })

    render(<App />)

    expect(screen.getByTestId('market-mode-spot')).toBeEnabled()
    expect(screen.getByTestId('market-mode-futures-live')).toBeEnabled()
    expect(screen.queryByTestId('market-unavailable')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('market-mode-spot'))
    expect(await screen.findByTestId('lazy-spot-workspace')).toBeInTheDocument()
    expect(mocks.futuresRenders).toBe(0)
  })
})
