import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  }),
}))

vi.mock('./hooks/useAlertContext', () => ({
  useAlertContext: () => ({
    alerts: [],
    triggeredAlerts: [],
    checkPriceAlerts: mocks.checkPriceAlerts,
  }),
}))

vi.mock('./hooks/useFuturesProductionExecution', () => ({
  default: ({ enabled }) => {
    mocks.futuresProductionEnabled.push(enabled)
    return {
      connected: false,
      subscribed: false,
      submissionLocked: false,
      revision: null,
      mode: null,
      liveAuthorized: null,
      configured: null,
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

vi.mock('./components/common/NotificationToast', () => ({
  default: () => null,
}))

const localStorageMock = attachMockLocalStorage()

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

  it('sends typed buy place-order commands with the 0.999 quantity reduction', () => {
    mocks.order = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      price: '12346.00',
      amount: '100',
    }

    render(<App />)
    fireEvent.click(screen.getByTestId('place-spot-order'))

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

  it('sends typed sell place-order commands with the same 0.999 reduction path', () => {
    mocks.order = {
      symbol: 'BTCUSDT',
      side: 'SELL',
      price: '12345.50',
      quantity: '1.234567',
    }

    render(<App />)
    fireEvent.click(screen.getByTestId('place-spot-order'))

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

  it('sends typed cancel-order commands from the spot cancel path', () => {
    mocks.cancelOrder = {
      symbol: 'BTCUSDT',
      id: 12345,
    }

    render(<App />)
    fireEvent.click(screen.getByTestId('cancel-spot-order'))

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

  it('exposes only Futures, unmounts spot execution there, and restores spot unchanged', () => {
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

    expect(screen.getByTestId('place-spot-order')).toBeInTheDocument()
    expect(screen.getByTestId('cancel-spot-order')).toBeInTheDocument()
    expect(screen.queryByTestId('market-mode-futures-testnet')).not.toBeInTheDocument()
    expect(screen.getByTestId('market-mode-futures-live')).toHaveTextContent('Futures')
    expect(mocks.futuresProductionEnabled.at(-1)).toBe(false)
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      action: 'enable_depth_view',
      symbol: 'BTCUSDT',
    })

    fireEvent.click(screen.getByTestId('market-mode-futures-live'))

    expect(screen.getByTestId('futures-live-view')).toBeInTheDocument()
    expect(screen.getByTestId('futures-live-banner')).toHaveTextContent(
      'USDⓈ-M FUTURESREAL MONEY · PRODUCTION',
    )
    expect(screen.getByLabelText('USDⓈ-M production real-order execution')).toBeInTheDocument()
    expect(screen.queryByTestId('place-spot-order')).not.toBeInTheDocument()
    expect(mocks.futuresProductionEnabled.at(-1)).toBe(true)
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({ action: 'disable_depth_view' })

    fireEvent.keyDown(document, { key: 'B' })
    expect(screen.queryByTestId('quick-switch-modal')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('market-mode-spot'))

    expect(screen.queryByTestId('futures-live-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('place-spot-order')).toBeInTheDocument()
    expect(screen.getByTestId('cancel-spot-order')).toBeInTheDocument()
    expect(mocks.futuresProductionEnabled.at(-1)).toBe(false)
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      action: 'enable_depth_view',
      symbol: 'BTCUSDT',
    })

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

  it('renders the Futures shell immediately while private execution remains pending', () => {
    mocks.futuresProductionState = {
      connected: true,
      subscribed: false,
    }

    render(<App />)
    fireEvent.click(screen.getByTestId('market-mode-futures-live'))

    expect(screen.getByTestId('futures-live-banner')).toHaveTextContent('USDⓈ-M FUTURES')
    expect(screen.getByTestId('futures-production-workstation')).toBeInTheDocument()
    expect(screen.getByTestId('futures-workstation-chart')).toBeInTheDocument()
    expect(screen.getByText('Contracts', { selector: '.futures-workstation-section-heading span' }))
      .toBeInTheDocument()
    expect(screen.getByLabelText('USDⓈ-M production real-order execution'))
      .toHaveTextContent('SYNCLoading private Futures account state')
    expect(screen.getByRole('slider', { name: 'Order size percent' })).toBeDisabled()
    expect(screen.queryByText('BLOCKED', { exact: true })).not.toBeInTheDocument()
  })
})
