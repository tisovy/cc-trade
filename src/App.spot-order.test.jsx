import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachMockLocalStorage } from '@/test/mocks'
import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_SPOT_ORDER_TYPE,
  DEFAULT_SPOT_TIME_IN_FORCE,
  SPOT_MARKET_TYPE,
  TRADE_COMMAND_VERSION,
  TRADING_COMMAND_ACTIONS,
} from './utils/tradingCommands'
import {
  MARKET_WORKSPACES,
  MARKET_WORKSPACE_STORAGE_KEY,
} from './utils/marketWorkspaceStorage'
import App from './App'

const mocks = vi.hoisted(() => ({
  order: null,
  cancelOrder: null,
  send: vi.fn(),
  sendMessage: vi.fn(),
  handlePanelUpdate: vi.fn(),
  checkPriceAlerts: vi.fn(),
  futuresProductionEnabled: [],
  futuresProductionState: null,
}))

vi.mock('./context/DataContext', () => ({
  DataProvider: ({ children }) => children,
  useDataContext: () => ({
    panel: { selected: 'BTCUSDT', interval: '1h' },
    ticker: [],
    tradePairs: ['BTCUSDT'],
    handlePanelUpdate: mocks.handlePanelUpdate,
    wsConnection: { readyState: 1, send: mocks.send },
    filters: {
      BTCUSDT: {
        tickSize: '0.01',
        stepSize: '0.001',
        minQty: '0.001',
        minNotional: '10',
        status: 'TRADING',
      },
    },
    isOffline: false,
    sendMessage: mocks.sendMessage,
    startupStatus: {
      version: 1,
      type: 'startup_status',
      state: 'READY',
      code: 'READY',
      ready: true,
      missingFields: [],
      retiredFields: [],
    },
  }),
}))

vi.mock('./context/GatewayContext.jsx', () => ({
  GatewayProvider: ({ activeMarketMode, children }) => {
    // The backend acknowledges the market before its workspace may mount, so
    // the double stands in for that acknowledgement.
    mocks.activatedMode = activeMarketMode
    return children
  },
  useGatewayContext: () => ({
    marketActivation: { marketMode: mocks.activatedMode, generation: 1 },
    notifyError: vi.fn(),
    sendMessage: mocks.sendMessage,
    startupStatus: {
      version: 1,
      type: 'startup_status',
      state: 'READY',
      code: 'READY',
      ready: true,
      missingFields: [],
      retiredFields: [],
    },
    wsConnection: { readyState: 1, send: mocks.send },
  }),
}))

vi.mock('./hooks/useAlertContext', () => ({
  useAlertContext: () => ({
    alerts: [],
    triggeredAlerts: [],
    checkPriceAlerts: mocks.checkPriceAlerts,
  }),
}))

vi.mock('./hooks/useFuturesTrading', () => ({
  default: ({ enabled }) => {
    mocks.futuresProductionEnabled.push(enabled)
    return {
      connected: false,
      balances: null,
      openOrders: [],
      positions: [],
      lastExecution: null,
      lastError: null,
      placeOrder: vi.fn(() => false),
      cancelOrder: vi.fn(() => false),
      cancelAll: vi.fn(() => false),
      closePosition: vi.fn(() => false),
      refresh: vi.fn(() => false),
      ...(mocks.futuresProductionState ?? {}),
    }
  },
}))

vi.mock('./context/NotificationProvider', () => ({
  NotificationProvider: ({ children }) => children,
}))

vi.mock('./context/DrawingProvider', () => ({
  DrawingProvider: ({ children }) => children,
}))

vi.mock('./context/AlertProvider', () => ({
  AlertProvider: ({ children }) => children,
}))

vi.mock('./components/features/charts/ChartWrapper', () => ({
  ChartWrapper: ({ onOrderPlace, onOrderCancel }) => (
    <div>
      <button type="button" data-testid="place-spot-order" onClick={() => onOrderPlace(mocks.order)}>
        Place
      </button>
      <button type="button" data-testid="cancel-spot-order" onClick={() => onOrderCancel(mocks.cancelOrder)}>
        Cancel
      </button>
    </div>
  ),
}))

vi.mock('./components/features/trading/OrderFormModal', () => ({
  default: () => null,
}))

vi.mock('./components/features/trading/OrderBook', () => ({
  default: () => null,
}))

vi.mock('./components/features/trading/TradesPanel', () => ({
  default: () => null,
}))

vi.mock('./components/layout/UpperPanel', () => ({
  default: () => null,
}))

vi.mock('./components/layout/InfoPanel', () => ({
  default: () => null,
}))

vi.mock('./components/layout/AnalyticsPanel', () => ({
  default: () => null,
}))

vi.mock('./components/layout/MainView', () => ({
  default: () => null,
}))

vi.mock('./components/features/tools/QuickSwitchModal', () => ({
  default: ({ visible }) => (
    visible ? <div data-testid="quick-switch-modal">Quick switch</div> : null
  ),
}))

vi.mock('./components/features/tools/DrawingToolbar', () => ({
  default: () => null,
}))

vi.mock('./components/features/tools/AlertPanel', () => ({
  default: () => null,
}))

vi.mock('./components/features/futures/FuturesWorkstationChart', () => ({
  default: () => <div data-testid="futures-workstation-chart" />,
}))

vi.mock('./components/common/NotificationToast', () => ({
  default: () => null,
}))

const localStorageMock = attachMockLocalStorage()

// A workspace is code-split, so its first paint waits on a dynamic import. The
// 1s default is enough when this file runs alone and not always enough under
// full-suite load, which made these tests fail for a reason none of them is
// about.
const WORKSPACE_MOUNT = { timeout: 5_000 }

describe('App spot order payloads', () => {
  let originalWebSocket

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket
    globalThis.WebSocket = { OPEN: 1 }
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    localStorageMock.clear()
    localStorageMock.setItem(MARKET_WORKSPACE_STORAGE_KEY, MARKET_WORKSPACES.SPOT)
    mocks.order = null
    mocks.cancelOrder = null
    mocks.send.mockClear()
    mocks.sendMessage.mockClear()
    mocks.handlePanelUpdate.mockClear()
    mocks.checkPriceAlerts.mockClear()
    mocks.futuresProductionEnabled.length = 0
    mocks.futuresProductionState = null
  })

  afterEach(() => {
    cleanup()
    globalThis.WebSocket = originalWebSocket
    vi.unstubAllGlobals()
    localStorageMock.clear()
  })

  it('sends typed buy place-order commands with the 0.999 quantity reduction', async () => {
    mocks.order = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      price: '12346.00',
      amount: '100',
    }

    render(<App />)
    fireEvent.click(await screen.findByTestId('place-spot-order', {}, WORKSPACE_MOUNT))

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(mocks.send.mock.calls[0][0])).toEqual({
      action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
      version: TRADE_COMMAND_VERSION,
      marketType: SPOT_MARKET_TYPE,
      accountId: DEFAULT_ACCOUNT_ID,
      clientOrderId: expect.any(String),
      symbol: 'BTCUSDT',
      side: 'BUY',
      orderType: DEFAULT_SPOT_ORDER_TYPE,
      timeInForce: DEFAULT_SPOT_TIME_IN_FORCE,
      price: '12346',
      quantity: '99.9',
    })
  })

  it('sends typed sell place-order commands with the same 0.999 reduction path', async () => {
    mocks.order = {
      symbol: 'BTCUSDT',
      side: 'SELL',
      price: '12345.50',
      quantity: '1.234567',
    }

    render(<App />)
    fireEvent.click(await screen.findByTestId('place-spot-order', {}, WORKSPACE_MOUNT))

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(mocks.send.mock.calls[0][0])).toEqual({
      action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
      version: TRADE_COMMAND_VERSION,
      marketType: SPOT_MARKET_TYPE,
      accountId: DEFAULT_ACCOUNT_ID,
      clientOrderId: expect.any(String),
      symbol: 'BTCUSDT',
      side: 'SELL',
      orderType: DEFAULT_SPOT_ORDER_TYPE,
      timeInForce: DEFAULT_SPOT_TIME_IN_FORCE,
      price: '12345.5',
      quantity: '1.233',
    })
  })

  it('sends typed cancel-order commands from the spot cancel path', async () => {
    mocks.cancelOrder = {
      symbol: 'BTCUSDT',
      id: 12345,
    }

    render(<App />)
    fireEvent.click(await screen.findByTestId('cancel-spot-order', {}, WORKSPACE_MOUNT))

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(mocks.send.mock.calls[0][0])).toEqual({
      action: TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
      version: TRADE_COMMAND_VERSION,
      marketType: SPOT_MARKET_TYPE,
      accountId: DEFAULT_ACCOUNT_ID,
      clientOrderId: expect.any(String),
      symbol: 'BTCUSDT',
      orderId: 12345,
    })
  })

  it('exposes only Futures, unmounts spot execution there, and restores spot unchanged', async () => {
    mocks.order = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      price: '12346.00',
      amount: '100',
    }
    mocks.cancelOrder = {
      symbol: 'BTCUSDT',
      id: 12345,
    }

    render(<App />)

    expect(await screen.findByTestId('place-spot-order', {}, WORKSPACE_MOUNT)).toBeInTheDocument()
    expect(screen.getByTestId('cancel-spot-order')).toBeInTheDocument()
    expect(screen.queryByTestId('market-mode-futures-testnet')).not.toBeInTheDocument()
    expect(screen.getByTestId('market-mode-futures-live')).toHaveTextContent('Futures')
    expect(mocks.futuresProductionEnabled).toEqual([])
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenLastCalledWith({
        action: 'enable_depth_view',
        symbol: 'BTCUSDT',
      }))

    fireEvent.click(screen.getByTestId('market-mode-futures-live'))

    expect(await screen.findByTestId('futures-live-view', {}, WORKSPACE_MOUNT)).toBeInTheDocument()
    expect(screen.getByTestId('futures-workstation-identity'))
      .toHaveTextContent('USDⓈ-M FUTURES')
    expect(screen.getByLabelText('Futures trading ticket')).toBeInTheDocument()
    expect(screen.queryByTestId('place-spot-order')).not.toBeInTheDocument()
    expect(mocks.futuresProductionEnabled.at(-1)).toBe(true)
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith({ action: 'disable_depth_view' }))

    fireEvent.keyDown(document, { key: 'B' })
    expect(screen.queryByTestId('quick-switch-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('market-mode-spot'))

    expect(screen.queryByTestId('futures-live-view')).not.toBeInTheDocument()
    expect(await screen.findByTestId('place-spot-order', {}, WORKSPACE_MOUNT)).toBeInTheDocument()
    expect(screen.getByTestId('cancel-spot-order')).toBeInTheDocument()
    expect(mocks.futuresProductionEnabled).toEqual([true])
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenLastCalledWith({
        action: 'enable_depth_view',
        symbol: 'BTCUSDT',
      }))

    fireEvent.keyDown(document, { key: 'B' })
    expect(screen.getByTestId('quick-switch-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('place-spot-order'))
    fireEvent.click(screen.getByTestId('cancel-spot-order'))

    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls.map(([payload]) => JSON.parse(payload))).toEqual([
      {
        action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
        version: TRADE_COMMAND_VERSION,
        marketType: SPOT_MARKET_TYPE,
        accountId: DEFAULT_ACCOUNT_ID,
        clientOrderId: expect.any(String),
        symbol: 'BTCUSDT',
        side: 'BUY',
        orderType: DEFAULT_SPOT_ORDER_TYPE,
        timeInForce: DEFAULT_SPOT_TIME_IN_FORCE,
        price: '12346',
        quantity: '99.9',
      },
      {
        action: TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
        version: TRADE_COMMAND_VERSION,
        marketType: SPOT_MARKET_TYPE,
        accountId: DEFAULT_ACCOUNT_ID,
        clientOrderId: expect.any(String),
        symbol: 'BTCUSDT',
        orderId: 12345,
      },
    ])
  })

  it('renders the Futures shell after its on-demand chunk loads while private execution remains pending', async () => {
    mocks.futuresProductionState = {
      connected: true,
      subscribed: false,
    }

    render(<App />)
    fireEvent.click(screen.getByTestId('market-mode-futures-live'))

    expect(await screen.findByTestId('futures-workstation-identity', {}, WORKSPACE_MOUNT))
      .toHaveTextContent('USDⓈ-M FUTURES')
    expect(screen.getByTestId('futures-production-workstation')).toBeInTheDocument()
    expect(screen.getByTestId('futures-workstation-chart')).toBeInTheDocument()
    expect(screen.getByText('Contracts', { selector: '.futures-workstation-section-heading span' }))
      .toBeInTheDocument()
    expect(screen.getByLabelText('Futures trading ticket'))
      .toHaveTextContent('CONTRACTSelect an active USDⓈ-M contract.')
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toBeDisabled()
    expect(screen.getByLabelText('Futures order size and shortcuts'))
      .toHaveTextContent('0%— USDT')
    expect(screen.queryByText('BLOCKED', { exact: true })).not.toBeInTheDocument()
  })
})
