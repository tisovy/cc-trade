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
  default: () => null,
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
    localStorageMock.clear()
    mocks.order = null
    mocks.cancelOrder = null
    mocks.send.mockClear()
    mocks.sendMessage.mockClear()
    mocks.handlePanelUpdate.mockClear()
    mocks.checkPriceAlerts.mockClear()
  })

  afterEach(() => {
    cleanup()
    globalThis.WebSocket = originalWebSocket
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
})
