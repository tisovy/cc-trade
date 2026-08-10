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
  it('subscribes with an account refresh and ingests the versioned account state', () => {
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
      socket.receive({
        version: 1,
        type: 'futures_account_state',
        resources: {
          balances: {
            status: 'ready',
            data: { USDT: { available: '90', total: '100' } },
            lastSuccessfulAt: 100,
          },
          regularOrders: {
            status: 'ready',
            data: [
              { symbol: 'BTCUSDT', orderId: 1, status: 'NEW', side: 'BUY' },
              { symbol: 'BTCUSDT', orderId: 2, status: 'FILLED', side: 'BUY' },
            ],
            lastSuccessfulAt: 100,
          },
          algoOrders: { status: 'ready', data: [], lastSuccessfulAt: 100 },
          positions: {
            status: 'ready',
            data: [{ symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.01' }],
            lastSuccessfulAt: 100,
          },
        },
      })
    })

    expect(result.current.balances.USDT.available).toBe('90')
    expect(result.current.openOrders).toHaveLength(1)
    expect(result.current.positions).toHaveLength(1)
  })

  it('re-values open positions from the mark feed and falls back when it clears', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BMTUSDT',
      wsConnection: socket,
    }))

    act(() => socket.receive({
      version: 1,
      type: 'futures_account_state',
      resources: {
        positions: {
          status: 'ready',
          data: [{
            symbol: 'BMTUSDT',
            positionSide: 'BOTH',
            quantity: '-446082',
            entryPrice: '0.03140',
            markPrice: '0.03523',
            unrealizedPnl: '-1708.49',
          }],
          lastSuccessfulAt: 100,
        },
      },
    }))
    expect(result.current.positions[0].unrealizedPnl).toBe('-1708.49')

    act(() => socket.receive({
      type: 'futures_position_marks',
      version: 1,
      marks: { BMTUSDT: { markPrice: '0.03600', updatedAt: 200 } },
    }))
    expect(result.current.positions[0].markPrice).toBe('0.03600')
    expect(Number(result.current.positions[0].unrealizedPnl)).toBeCloseTo(-2051.98, 2)

    // A dropped feed clears its marks: the row returns to the account snapshot
    // rather than holding a mark that stopped moving.
    act(() => socket.receive({ type: 'futures_position_marks', version: 1, marks: {} }))
    expect(result.current.positions[0].markPrice).toBe('0.03523')
    expect(result.current.positions[0].unrealizedPnl).toBe('-1708.49')
  })

  it('exposes the backend order-notional cap through the shared readiness state', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'TUTUSDT',
      wsConnection: socket,
    }))

    act(() => socket.receive({
      futures_trading_paused: false,
      futures_max_order_usdt: '50',
    }))
    expect(result.current).toMatchObject({
      tradingPaused: false,
      maxOrderNotionalUsdt: '50',
    })

    act(() => socket.receive({
      futures_trading_paused: true,
      futures_max_order_usdt: null,
    }))
    expect(result.current).toMatchObject({
      tradingPaused: true,
      maxOrderNotionalUsdt: null,
    })
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

  it('keeps a confirmed amendment when the snapshot that follows is older', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT', orderId: 5, status: 'NEW', side: 'BUY',
          price: '58500', origQty: '0.008', T: 2_000,
        },
      })
    })

    // Binance's order snapshot is a separate, eventually consistent service:
    // fetched right after the amendment it can still describe the old size.
    act(() => {
      socket.receive({
        version: 1,
        type: 'futures_account_state',
        resources: {
          regularOrders: {
            status: 'ready',
            lastSuccessfulAt: 300,
            data: [{
              symbol: 'BTCUSDT', orderId: 5, status: 'NEW', side: 'BUY',
              price: '58500', origQty: '0.004', T: 1_000,
            }],
          },
        },
      })
    })
    expect(result.current.openOrders[0].origQty).toBe('0.008')

    act(() => {
      socket.receive({
        version: 1,
        type: 'futures_account_state',
        resources: {
          regularOrders: {
            status: 'ready',
            lastSuccessfulAt: 400,
            data: [{
              symbol: 'BTCUSDT', orderId: 5, status: 'NEW', side: 'BUY',
              price: '58500', origQty: '0.012', T: 3_000,
            }],
          },
        },
      })
    })
    expect(result.current.openOrders[0].origQty).toBe('0.012')
  })

  it('loads bounded history on request and keeps it per contract', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      result.current.loadHistory('BTCUSDT')
    })
    expect(socket.sent.at(-1)).toMatchObject({
      action: 'account.history',
      marketType: 'futures',
      symbol: 'BTCUSDT',
    })
    expect(result.current.history).toMatchObject({ symbol: 'BTCUSDT', status: 'loading' })

    act(() => {
      socket.receive({
        futures_history: {
          symbol: 'BTCUSDT',
          orders: [{ orderId: 1, side: 'BUY', status: 'FILLED' }],
          trades: [{ id: 7, realizedPnl: '12.5' }],
          error: null,
        },
      })
    })
    expect(result.current.history.status).toBe('ready')
    expect(result.current.history.trades).toHaveLength(1)

    act(() => {
      socket.receive({
        futures_history: {
          symbol: 'BTCUSDT',
          orders: [],
          trades: [],
          error: { code: 'FUTURES_API_ERROR', message: 'refused' },
        },
      })
    })
    expect(result.current.history.status).toBe('error')
    // A failed history read never disturbs live trading state.
    expect(result.current.openOrders).toEqual([])
    expect(result.current.lastError).toBeNull()
  })

  // /fapi/v3/positionRisk reports neither leverage nor margin mode any more, so
  // both are asked for per contract and folded into the rows that display them.
  it('states the leverage a position is carried at once the config arrives', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      socket.receive({
        version: 1,
        type: 'futures_account_state',
        resources: {
          positions: {
            status: 'ready',
            data: [{ symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '0.01' }],
            lastSuccessfulAt: 100,
          },
        },
      })
    })
    expect(result.current.positions[0].leverage).toBeUndefined()

    act(() => {
      result.current.loadSymbolConfig('BTCUSDT')
    })
    expect(socket.sent.at(-1)).toMatchObject({
      action: 'account.symbolConfig',
      marketType: 'futures',
      symbol: 'BTCUSDT',
    })

    act(() => socket.receive({
      futures_symbol_configs: {
        BTCUSDT: { symbol: 'BTCUSDT', leverage: 20, maxLeverage: 125, marginType: 'ISOLATED' },
      },
    }))
    expect(result.current.positions[0]).toMatchObject({ leverage: 20, marginType: 'ISOLATED' })
    expect(result.current.symbolConfigs.BTCUSDT.maxLeverage).toBe(125)

    // The reads arrive one contract at a time, so a second answer must not erase
    // the first: the desk holds positions on more than one contract at once.
    act(() => socket.receive({
      futures_symbol_configs: { BICOUSDT: { symbol: 'BICOUSDT', leverage: 10 } },
    }))
    expect(result.current.symbolConfigs.BTCUSDT.leverage).toBe(20)
    expect(result.current.symbolConfigs.BICOUSDT.leverage).toBe(10)
  })

  it('sends a leverage change for the named contract and nothing without one', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      expect(result.current.setLeverage({ symbol: 'BICOUSDT', leverage: 20 })).toBe(true)
    })
    expect(socket.sent.at(-1)).toMatchObject({
      action: 'trade.setLeverage',
      marketType: 'futures',
      symbol: 'BICOUSDT',
      leverage: 20,
    })

    const sentBefore = socket.sent.length
    act(() => {
      // Never falls back to the contract on screen: leverage applied to the wrong
      // one reprices every position on it.
      expect(result.current.setLeverage({ leverage: 20 })).toBe(false)
      expect(result.current.setLeverage()).toBe(false)
    })
    expect(socket.sent).toHaveLength(sentBefore)
  })

  it('keeps account-wide regular and ALGO namespaces distinct across terminal updates', () => {
    const socket = createSocket()
    const { result, rerender } = renderHook(
      ({ symbol }) => useFuturesTrading({ enabled: true, symbol, wsConnection: socket }),
      { initialProps: { symbol: 'TUTUSDT' } },
    )

    act(() => {
      socket.receive({
        version: 1,
        type: 'futures_account_state',
        resources: {
          balances: {
            status: 'ready', data: { USDT: { available: '25', total: '25' } }, lastSuccessfulAt: 100,
          },
          positions: { status: 'ready', data: [], lastSuccessfulAt: 100 },
          regularOrders: {
            status: 'ready',
            data: [
              { symbol: 'TUTUSDT', orderId: 42, status: 'NEW', orderKind: 'REGULAR' },
              { symbol: 'BTCUSDT', orderId: 8, status: 'NEW', orderKind: 'REGULAR' },
            ],
            lastSuccessfulAt: 100,
          },
          algoOrders: {
            status: 'ready',
            data: [{ symbol: 'TUTUSDT', orderId: 42, algoId: 42, status: 'NEW', orderKind: 'ALGO' }],
            lastSuccessfulAt: 100,
          },
          userDataStream: {
            status: 'ready', data: { connected: true }, lastSuccessfulAt: 100,
          },
        },
      })
    })

    expect(result.current.openOrders).toHaveLength(3)
    expect(result.current.openOrders.filter(order => order.orderId === 42)
      .map(order => order.orderKind).sort()).toEqual(['ALGO', 'REGULAR'])
    expect(result.current.accountResources.regularOrders.lastSuccessfulAt).toBe(100)

    rerender({ symbol: 'BTCUSDT' })
    expect(result.current.openOrders).toHaveLength(3)

    act(() => {
      socket.receive({
        futures_execution_update: {
          symbol: 'TUTUSDT',
          orderId: 42,
          status: 'CANCELED',
          orderKind: 'REGULAR',
        },
      })
    })

    expect(result.current.openOrders).toHaveLength(2)
    expect(result.current.openOrders.some(order => order.orderKind === 'ALGO' && order.orderId === 42))
      .toBe(true)
    expect(result.current.openOrders.some(order => order.symbol === 'BTCUSDT')).toBe(true)
  })

  it('retains last-known resource data and exposes partial stale/error state', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'TUTUSDT',
      wsConnection: socket,
    }))

    act(() => {
      socket.receive({
        version: 1,
        type: 'futures_account_state',
        resources: {
          balances: {
            status: 'stale',
            data: { USDT: { available: '0', total: '0' } },
            lastSuccessfulAt: 100,
            error: { code: 'FUTURES_NETWORK_ERROR', message: 'Check network.', retryable: true },
          },
          regularOrders: {
            status: 'ready',
            data: [{ symbol: 'TUTUSDT', orderId: 1, status: 'NEW', orderKind: 'REGULAR' }],
            lastSuccessfulAt: 110,
          },
          algoOrders: {
            status: 'error',
            data: [],
            lastSuccessfulAt: null,
            error: { code: 'FUTURES_PERMISSION_DENIED', message: 'Check permission.', retryable: false },
          },
        },
      })
    })

    expect(result.current.balances.USDT.available).toBe('0')
    expect(result.current.accountResources.balances.status).toBe('stale')
    expect(result.current.accountResources.algoOrders.status).toBe('error')
    expect(result.current.openOrders).toEqual([
      expect.objectContaining({ orderId: 1, orderKind: 'REGULAR' }),
    ])
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

  // Margin belongs to one position, so the command is addressed by symbol and
  // leg rather than by whatever contract the workstation is showing.
  it('sends a margin adjustment for the named position and nothing without one', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'ETHUSDT',
      wsConnection: socket,
    }))

    act(() => {
      result.current.adjustPositionMargin({
        symbol: 'BTCUSDT', positionSide: 'LONG', direction: 'ADD', amount: '250',
      })
    })
    const [, adjustment] = socket.sent
    expect(adjustment).toMatchObject({
      action: 'trade.adjustPositionMargin',
      marketType: 'futures',
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      direction: 'ADD',
      amount: '250',
    })

    act(() => {
      expect(result.current.adjustPositionMargin({ direction: 'ADD', amount: '250' })).toBe(false)
    })
    expect(socket.sent).toHaveLength(2)
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

  it('keeps the account snapshot across disable/enable cycles and re-syncs', () => {
    const socket = createSocket()
    const { result, rerender } = renderHook(
      ({ enabled }) => useFuturesTrading({ enabled, symbol: 'BTCUSDT', wsConnection: socket }),
      { initialProps: { enabled: true } },
    )
    act(() => {
      socket.receive({
        version: 1,
        type: 'futures_account_state',
        resources: {
          balances: {
            status: 'ready',
            data: { USDT: { available: '90', total: '100' } },
            lastSuccessfulAt: 100,
          },
          regularOrders: {
            status: 'ready',
            data: [{ symbol: 'BTCUSDT', orderId: 1, status: 'NEW', side: 'BUY' }],
            lastSuccessfulAt: 100,
          },
          algoOrders: { status: 'ready', data: [], lastSuccessfulAt: 100 },
          positions: { status: 'ready', data: [], lastSuccessfulAt: 100 },
        },
      })
      socket.receive({
        command_rejected: {
          code: 'FUTURES_API_ERROR', message: 'stale', details: { marketType: 'futures' },
        },
      })
    })

    rerender({ enabled: false })
    expect(result.current.connected).toBe(false)
    expect(result.current.balances.USDT.available).toBe('90')
    expect(result.current.openOrders).toHaveLength(1)
    expect(result.current.lastError).toBeNull()

    rerender({ enabled: true })
    expect(result.current.connected).toBe(true)
    expect(result.current.balances.USDT.available).toBe('90')
    expect(socket.sent.filter(message => message.action === 'account.refresh')).toHaveLength(2)
  })

  it('resends an unsent order with the identity of the first attempt', () => {
    // Rebuilding the command would mint a new client order id, and Binance could
    // then no longer recognise the two attempts as one intent.
    const socket = createSocket()
    socket.readyState = 3
    const { result, rerender } = renderHook(({ connection }) => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: connection,
    }), { initialProps: { connection: socket } })

    let accepted = true
    act(() => {
      accepted = result.current.placeOrder({
        side: 'BUY', price: '50000', quantity: '0.01',
      })
    })
    expect(accepted).toBe(false)
    expect(socket.sent).toHaveLength(0)

    socket.readyState = 1
    rerender({ connection: socket })

    act(() => {
      expect(result.current.retryUnsentCommand()).toBe(true)
    })

    const placements = socket.sent.filter(message => message.action === 'trade.placeOrder')
    expect(placements).toHaveLength(1)
    expect(placements[0]).toMatchObject({ symbol: 'BTCUSDT', side: 'BUY', price: '50000' })
    expect(typeof placements[0].clientOrderId).toBe('string')

    // A second retry sends the same identity again, not a new one.
    act(() => {
      result.current.retryUnsentCommand()
    })
    const resent = socket.sent.filter(message => message.action === 'trade.placeOrder')
    expect(resent).toHaveLength(1)
  })

  it('has nothing to resend once a command reached the backend', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      result.current.placeOrder({ side: 'SELL', price: '51000', quantity: '0.02' })
    })
    const sentCount = socket.sent.length

    act(() => {
      expect(result.current.retryUnsentCommand()).toBe(false)
    })
    expect(socket.sent).toHaveLength(sentCount)
  })
})
