import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useFuturesTrading from './useFuturesTrading.js'

const createSocket = () => {
  const listeners = new Map()
  return {
    readyState: 1,
    sent: [],
    send(payload) {
      this.sent.push(JSON.parse(payload))
    },
    addEventListener(event, handler) {
      listeners.set(event, handler)
    },
    removeEventListener(event, handler) {
      if (listeners.get(event) === handler) listeners.delete(event)
    },
    receive(payload) {
      listeners.get('message')?.({ data: JSON.stringify(payload) })
    },
    dropConnection() {
      listeners.get('close')?.()
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useFuturesTrading', () => {
  it('subscribes with an account refresh and ingests pushed futures state', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    expect(socket.sent).toHaveLength(1)
    expect(socket.sent[0]).toMatchObject({
      action: 'account.refresh',
      marketType: 'futures',
      symbol: 'BTCUSDT',
    })

    act(() => {
      socket.receive({ futures_balances: { USDT: { available: '90', total: '100' } } })
      socket.receive({
        futures_orders: [
          { symbol: 'BTCUSDT', orderId: 1, status: 'NEW', side: 'BUY' },
          { symbol: 'BTCUSDT', orderId: 2, status: 'FILLED', side: 'BUY' },
        ],
      })
      socket.receive({ futures_positions: [{ symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.01' }] })
    })

    expect(result.current.balances.USDT.available).toBe('90')
    expect(result.current.openOrders).toHaveLength(1)
    expect(result.current.positions).toHaveLength(1)
  })

  it('merges execution updates into open orders and clears them on terminal states', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      socket.receive({
        futures_execution_update: { symbol: 'BTCUSDT', orderId: 5, status: 'NEW', side: 'BUY' },
      })
    })
    expect(result.current.openOrders).toHaveLength(1)

    act(() => {
      socket.receive({
        futures_execution_update: { symbol: 'BTCUSDT', orderId: 5, status: 'CANCELED', side: 'BUY' },
      })
    })
    expect(result.current.openOrders).toHaveLength(0)
    expect(result.current.lastExecution.status).toBe('CANCELED')
  })

  it('surfaces futures command rejections and sends typed commands', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      socket.receive({
        command_rejected: {
          request: 'trade.placeOrder',
          code: 'FUTURES_API_ERROR',
          message: 'Margin is insufficient.',
          details: { marketType: 'futures' },
        },
      })
    })
    expect(result.current.lastError.message).toBe('Margin is insufficient.')

    act(() => {
      result.current.placeOrder({
        side: 'BUY', orderType: 'LIMIT', price: '50000', quantity: '0.01',
      })
      result.current.cancelOrder({ orderId: 5 })
      result.current.cancelAll()
      result.current.closePosition({ symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.01' })
    })

    const [, placed, canceled, cancelAll, closed] = socket.sent
    expect(placed).toMatchObject({
      action: 'trade.placeOrder',
      marketType: 'futures',
      symbol: 'BTCUSDT',
      side: 'BUY',
      orderType: 'LIMIT',
      price: '50000',
      quantity: '0.01',
    })
    expect(canceled).toMatchObject({
      action: 'trade.cancelOrder',
      marketType: 'futures',
      symbol: 'BTCUSDT',
      orderId: 5,
    })
    expect(cancelAll).toMatchObject({ action: 'trade.cancelAll', marketType: 'futures', symbol: 'BTCUSDT' })
    expect(closed).toMatchObject({
      action: 'trade.placeOrder',
      marketType: 'futures',
      orderType: 'MARKET',
      side: 'SELL',
      positionSide: 'LONG',
      reduceOnly: true,
      quantity: '0.01',
    })
    expect(closed.price).toBeUndefined()
  })

  it('reports disconnect and refuses to send on a closed socket', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      socket.dropConnection()
    })
    expect(result.current.connected).toBe(false)

    socket.readyState = 3
    let accepted
    act(() => {
      accepted = result.current.placeOrder({ side: 'BUY', quantity: '1', price: '1' })
    })
    expect(accepted).toBe(false)
  })

  it('tracks the backend pause state and sends the toggle command', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    expect(result.current.tradingPaused).toBe(false)
    act(() => {
      socket.receive({ futures_trading_paused: true })
    })
    expect(result.current.tradingPaused).toBe(true)

    act(() => {
      result.current.setTradingPaused(false)
    })
    expect(socket.sent.at(-1)).toMatchObject({
      action: 'trade.setTradingPaused',
      marketType: 'futures',
      paused: false,
    })
  })

  it('stays inert when disabled', () => {
    const socket = createSocket()
    renderHook(() => useFuturesTrading({
      enabled: false,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    expect(socket.sent).toHaveLength(0)
  })
})
