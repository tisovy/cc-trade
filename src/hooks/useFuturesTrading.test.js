import { act, renderHook, waitFor } from '@testing-library/react'
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

    // One frame on subscribe: the account refresh. The opening history read is
    // the workstation's, because this hook is not told which contract is on
    // screen and a history command without a symbol is completed by the backend
    // from the panel's selection.
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

  // What the record could not say until now: when the exchange stated something
  // about an order, and when the desk drew it. The operator has reported a
  // number updating late twice, and both times the answer was to ask them what
  // and where — because the account lane carried no marks and the trading hook
  // closed none.
  describe('the marks a fill leaves behind', () => {
    const stamped = (payload, at) => ({
      marks: { exchangeAt: at - 300, receivedAt: at - 120, queuedAt: at - 100 },
      ...payload,
    })

    const reportedMarks = socket => socket.sent.filter(
      message => message.action === 'report_frame_marks',
    )

    it('reports the fill after the commit that drew it, naming the order and its state', () => {
      const socket = createSocket()
      renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))

      act(() => {
        socket.receive({
          futures_execution_update: {
            symbol: 'TUTUSDT', orderId: 41, status: 'NEW', side: 'BUY',
            price: '1', origQty: '5', z: '0', T: 1_000,
          },
        })
      })
      expect(reportedMarks(socket)).toHaveLength(0)

      act(() => {
        socket.receive(stamped({
          futures_execution_update: {
            symbol: 'TUTUSDT', orderId: 41, status: 'PARTIALLY_FILLED', side: 'BUY',
            price: '1', origQty: '5', z: '2', T: 2_000,
          },
        }, Date.now()))
      })

      const [reported] = reportedMarks(socket)
      expect(reported).toMatchObject({
        action: 'report_frame_marks',
        resource: 'orders',
        symbol: 'TUTUSDT',
        identity: 41,
        status: 'PARTIALLY_FILLED',
        // The half fill changed what these surfaces draw, and the record says
        // so rather than leaving it to be inferred from a line existing.
        code: 'DELIVERED',
      })
      expect(reported.upstreamMs).toBeGreaterThanOrEqual(0)
      expect(reported.status).toBe('PARTIALLY_FILLED')
      expect(reported.deliveredMs).toBeGreaterThanOrEqual(0)
      expect(reported.committedMs).toBeGreaterThanOrEqual(0)
      expect(reported.totalMs).toBeGreaterThanOrEqual(reported.committedMs)
    })

    // The operator's own description — "the report arrives and nothing on the
    // order changes" — has to be a reading rather than the absence of one.
    it('reports a frame that changed nothing as unchanged', () => {
      const socket = createSocket()
      renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))

      act(() => {
        socket.receive(stamped({
          futures_execution_update: {
            symbol: 'TUTUSDT', orderId: 77, status: 'FILLED', side: 'BUY',
            price: '1', origQty: '5', z: '5', T: 2_000,
          },
        }, Date.now()))
      })

      expect(reportedMarks(socket)).toHaveLength(1)
      expect(reportedMarks(socket)[0]).toMatchObject({
        resource: 'orders',
        identity: 77,
        status: 'FILLED',
        code: 'UNCHANGED',
      })
    })

    it('reports the account envelope the same fill folded', () => {
      const socket = createSocket()
      renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))

      act(() => {
        socket.receive(stamped({
          version: 1,
          type: 'futures_account_state',
          resources: {
            regularOrders: {
              status: 'ready',
              data: [{
                symbol: 'TUTUSDT', orderId: 41, status: 'PARTIALLY_FILLED',
                side: 'BUY', price: '1', origQty: '5', executedQty: '2',
              }],
              lastSuccessfulAt: 100,
            },
          },
        }, Date.now()))
      })

      expect(reportedMarks(socket)[0]).toMatchObject({
        resource: 'account',
        code: 'DELIVERED',
      })
    })

    // A fill produces two frames back to back — the folded account envelope and
    // the report itself. Delivered in one tick they become one React commit, and
    // a single pending slot would report the second and lose the first: the
    // order line, which is the one the operator asked for.
    it('reports every marked frame of a batch, not only the last', () => {
      const socket = createSocket()
      renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))

      const at = Date.now()
      act(() => {
        socket.receive(stamped({
          version: 1,
          type: 'futures_account_state',
          resources: {
            regularOrders: {
              status: 'ready',
              data: [{
                symbol: 'TUTUSDT', orderId: 41, status: 'PARTIALLY_FILLED',
                side: 'BUY', price: '1', origQty: '5', executedQty: '2',
              }],
              lastSuccessfulAt: 100,
            },
          },
        }, at))
        socket.receive(stamped({
          futures_execution_update: {
            symbol: 'TUTUSDT', orderId: 41, status: 'PARTIALLY_FILLED', side: 'BUY',
            price: '1', origQty: '5', z: '2', T: 2_000,
          },
        }, at))
      })

      // Both are reported, and both as delivered: they were drawn in the same
      // commit, so neither can be said to have arrived after the other. What
      // matters here is that the order line exists at all — a single pending
      // slot reported the envelope and lost it.
      expect(reportedMarks(socket).map(entry => entry.resource)).toEqual(['account', 'orders'])
      expect(reportedMarks(socket).at(-1)).toMatchObject({
        identity: 41,
        status: 'PARTIALLY_FILLED',
        code: 'DELIVERED',
      })
    })

    // The ordinary case on a live desk: the two frames of one fill arrive as two
    // socket messages and are drawn in two commits. The second says what the
    // first already drew, and that is not a fault — it is what separates it from
    // a frame the screen never showed.
    it('reports the second frame of one fill as already drawn, not as missing', () => {
      const socket = createSocket()
      renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))

      act(() => {
        socket.receive(stamped({
          version: 1,
          type: 'futures_account_state',
          resources: {
            regularOrders: {
              status: 'ready',
              data: [{
                symbol: 'TUTUSDT', orderId: 41, status: 'PARTIALLY_FILLED',
                side: 'BUY', price: '1', origQty: '5', executedQty: '2',
              }],
              lastSuccessfulAt: 100,
            },
          },
        }, Date.now()))
      })
      act(() => {
        socket.receive(stamped({
          futures_execution_update: {
            symbol: 'TUTUSDT', orderId: 41, status: 'PARTIALLY_FILLED', side: 'BUY',
            price: '1', origQty: '5', z: '2', T: 2_000,
          },
        }, Date.now()))
      })

      expect(reportedMarks(socket).map(entry => [entry.resource, entry.code])).toEqual([
        ['account', 'DELIVERED'],
        ['orders', 'UNCHANGED'],
      ])
    })

    // The reading the whole change exists for: the exchange said something
    // about an order and the screen does not show it. Reached here through the
    // settled memory, which is the desk's own refusal to redraw an order it has
    // already seen finish — a real path, and the only one a test can take
    // without breaking the hook on purpose.
    it('reports a frame the screen does not show as not drawn', () => {
      const socket = createSocket()
      renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))

      act(() => {
        socket.receive({
          futures_execution_update: {
            symbol: 'TUTUSDT', orderId: 41, status: 'FILLED', side: 'BUY',
            price: '1', origQty: '5', z: '5', T: 3_000,
          },
        })
      })

      act(() => {
        socket.receive(stamped({
          futures_execution_update: {
            symbol: 'TUTUSDT', orderId: 41, status: 'PARTIALLY_FILLED', side: 'BUY',
            price: '1', origQty: '5', z: '2', T: 2_000,
          },
        }, Date.now()))
      })

      expect(reportedMarks(socket)).toHaveLength(1)
      expect(reportedMarks(socket)[0]).toMatchObject({
        resource: 'orders',
        identity: 41,
        status: 'PARTIALLY_FILLED',
        code: 'NOT_DRAWN',
      })
    })

    it('reports nothing for the frames that carry no marks, which is most of them', () => {
      const socket = createSocket()
      renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))

      act(() => {
        socket.receive({
          futures_execution_update: {
            symbol: 'TUTUSDT', orderId: 41, status: 'PARTIALLY_FILLED', side: 'BUY',
            price: '1', origQty: '5', z: '2', T: 2_000,
          },
        })
      })

      expect(reportedMarks(socket)).toHaveLength(0)
    })
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

  it('loads bounded history on request and keeps it per contract', async () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    await waitFor(() => expect(result.current.historyStoreReady).toBe(true))
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
          symbols: ['BTCUSDT', 'BICOUSDT'],
          discovered: 17,
          error: null,
        },
      })
    })
    expect(result.current.history.status).toBe('ready')
    expect(result.current.history.trades).toHaveLength(1)
    // How wide the read was, and how wide it should have been. Both were on the
    // payload and neither reached the surface, which is how a bounded review
    // presented itself as the whole account.
    expect(result.current.history.symbols).toEqual(['BTCUSDT', 'BICOUSDT'])
    expect(result.current.history.discovered).toBe(17)

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
    // A failed re-read keeps the reading it could not replace, and states itself
    // beside it: emptying the panel would make the operator wait again for rows
    // they were already reading.
    expect(result.current.history.status).toBe('ready')
    expect(result.current.history.trades).toHaveLength(1)
    expect(result.current.history.error).toMatchObject({ code: 'FUTURES_API_ERROR' })
    // A failed history read never disturbs live trading state.
    expect(result.current.openOrders).toEqual([])
    expect(result.current.lastError).toBeNull()
  })

  // A settled order does not change while the desk is closed, so the review of
  // the last run is on screen before anything is asked of the exchange.
  it('presents the review the store holds without issuing a read', async () => {
    const socket = createSocket()
    const historyStore = {
      readContracts: async () => [{
        key: 'BTCUSDT',
        symbol: 'BTCUSDT',
        orders: [{ orderId: 4, symbol: 'BTCUSDT', status: 'FILLED', time: 1_784_000_000_000 }],
        trades: [{ id: 9, symbol: 'BTCUSDT', realizedPnl: '3.5', time: 1_784_000_000_000 }],
        orderCursor: '4',
        tradeCursor: '9',
        readAt: 1_784_000_000_000,
      }],
      writeReading: vi.fn(async () => true),
    }
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))

    await waitFor(() => expect(result.current.history.status).toBe('ready'))
    expect(result.current.history.orders).toHaveLength(1)
    expect(result.current.history.trades).toHaveLength(1)
    // Stamped with when it was read, so nobody mistakes it for a reading taken
    // now, and carrying what each contract is covered up to.
    expect(result.current.history.readAt).toBe(1_784_000_000_000)
    expect(result.current.history.coverage.BTCUSDT).toMatchObject({
      orderCursor: '4',
      tradeCursor: '9',
    })
    // The store names what it holds; it does not know what the account traded.
    expect(result.current.history.discoveryComplete).toBe(false)
    // Nothing was asked of the exchange for any of it — only the account refresh
    // the subscription always sends.
    expect(socket.sent.map(frame => frame.action)).toEqual(['account.refresh'])
    expect(historyStore.writeReading).not.toHaveBeenCalled()
  })

  it('carries the stored coverage on an incremental read and marks an explicit full read', async () => {
    const socket = createSocket()
    const historyStore = {
      readContracts: async () => [{
        key: 'BTCUSDT',
        symbol: 'BTCUSDT',
        orders: [],
        trades: [],
        orderCursor: '90071992547409931234',
        tradeCursor: '90071992547409931235',
        readAt: 1_784_000_000_000,
      }],
      writeReading: vi.fn(async () => true),
    }
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))

    await waitFor(() => expect(result.current.historyStoreReady).toBe(true))
    act(() => { result.current.loadHistory('BTCUSDT') })
    expect(socket.sent.at(-1)).toMatchObject({
      action: 'account.history',
      symbol: 'BTCUSDT',
      full: false,
      coverage: {
        BTCUSDT: {
          readAt: 1_784_000_000_000,
          orderCursor: '90071992547409931234',
          tradeCursor: '90071992547409931235',
        },
      },
    })

    act(() => { result.current.loadHistory('BTCUSDT', { full: true }) })
    expect(socket.sent.at(-1)).toMatchObject({
      action: 'account.history',
      symbol: 'BTCUSDT',
      full: true,
    })
  })

  it('stores a reading that succeeded and never one that failed', async () => {
    const socket = createSocket()
    const historyStore = {
      readContracts: async () => [],
      writeReading: vi.fn(async () => true),
    }
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))

    act(() => {
      socket.receive({
        futures_history: {
          symbol: 'BTCUSDT',
          orders: [{ orderId: 1, symbol: 'BTCUSDT', side: 'BUY', status: 'FILLED' }],
          trades: [{ id: 7, symbol: 'BTCUSDT', realizedPnl: '12.5' }],
          symbols: ['BTCUSDT', 'BICOUSDT'],
          discovered: 2,
          readFrom: {
            BTCUSDT: { orderCursor: '1', tradeCursor: '7' },
            BICOUSDT: { orderCursor: null, tradeCursor: null },
          },
          error: null,
        },
      })
    })
    await waitFor(() => expect(historyStore.writeReading).toHaveBeenCalledTimes(1))
    expect(historyStore.writeReading.mock.calls[0][0]).toMatchObject({
      symbols: ['BTCUSDT', 'BICOUSDT'],
      orders: [{ orderId: 1 }],
      trades: [{ id: 7 }],
      readFrom: {
        BTCUSDT: { orderCursor: '1', tradeCursor: '7' },
        BICOUSDT: { orderCursor: null, tradeCursor: null },
      },
    })
    expect(Number.isSafeInteger(historyStore.writeReading.mock.calls[0][0].readAt)).toBe(true)

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
    // A read that failed proves nothing about what the account holds.
    expect(historyStore.writeReading).toHaveBeenCalledTimes(1)
    expect(result.current.history.trades).toHaveLength(1)
  })

  it('keeps the review the exchange answered when the store answers late', async () => {
    const socket = createSocket()
    let deliverStore
    const historyStore = {
      readContracts: () => new Promise((resolve) => { deliverStore = resolve }),
      writeReading: vi.fn(async () => true),
    }
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))

    act(() => {
      socket.receive({
        futures_history: {
          symbol: 'ETHUSDT',
          orders: [{ orderId: 21, symbol: 'ETHUSDT', side: 'SELL', status: 'FILLED' }],
          trades: [],
          symbols: ['ETHUSDT'],
          discovered: 1,
          error: null,
        },
      })
    })
    await act(async () => {
      deliverStore([{
        key: 'BTCUSDT',
        symbol: 'BTCUSDT',
        orders: [{ orderId: 4, symbol: 'BTCUSDT', status: 'FILLED', time: 1 }],
        trades: [],
        orderCursor: '4',
        tradeCursor: null,
        readAt: 1_784_000_000_000,
      }])
      await Promise.resolve()
    })

    // The exchange's own answer is the newer of the two and is not replaced by
    // the store opening behind it.
    expect(result.current.history.orders).toEqual([expect.objectContaining({ orderId: 21 })])
    expect(result.current.history.symbols).toEqual(['ETHUSDT'])
  })

  // The exchange sends no event for the risk passing, so what takes a warning
  // back down is the position itself: closed, smaller, or better backed.
  it('holds a margin call against its position until the position says otherwise', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    const statePositions = rows => ({
      version: 1,
      type: 'futures_account_state',
      resources: { positions: { status: 'ready', data: rows, lastSuccessfulAt: 100 } },
    })

    act(() => {
      socket.receive(statePositions([
        { symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '0.5', isolatedWallet: '5' },
      ]))
    })
    act(() => socket.receive({
      futures_margin_call: {
        positions: [{
          symbol: 'BTCUSDT',
          positionSide: 'BOTH',
          quantity: '0.5',
          isolatedWallet: '5',
          maintenanceMargin: '1.61',
        }],
      },
    }))
    expect(result.current.marginCalls['BTCUSDT:BOTH'])
      .toMatchObject({ symbol: 'BTCUSDT', maintenanceMargin: 1.61 })

    // The position is still there, unchanged. So is the warning.
    act(() => {
      socket.receive(statePositions([
        { symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '0.5', isolatedWallet: '5' },
      ]))
    })
    expect(result.current.marginCalls['BTCUSDT:BOTH']).toBeDefined()

    // Margin added behind it. The warning goes.
    act(() => {
      socket.receive(statePositions([
        { symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '0.5', isolatedWallet: '40' },
      ]))
    })
    expect(result.current.marginCalls).toEqual({})
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

  it('sends a margin-mode change for the named contract and nothing without one', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      expect(result.current.setMarginType({ symbol: 'EPICUSDT', marginType: 'ISOLATED' })).toBe(true)
    })
    expect(socket.sent.at(-1)).toMatchObject({
      action: 'trade.setMarginType',
      marketType: 'futures',
      symbol: 'EPICUSDT',
      marginType: 'ISOLATED',
    })

    const sentBefore = socket.sent.length
    act(() => {
      // The mode decides what a losing position can cost, so it names its own
      // contract for the same reason leverage does.
      expect(result.current.setMarginType({ marginType: 'ISOLATED' })).toBe(false)
      expect(result.current.setMarginType()).toBe(false)
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

  // Algorithmic orders are not reported by the authenticated stream, so a stop
  // that fired went on being drawn at its trigger price until the thirty-second
  // beat came round. The desk is already told which regular order the parent
  // spawned; this is that order's report.
  describe('an execution resolves the algorithmic parent that spawned it', () => {
    const listAlgoParent = (socket, algoOrder) => {
      act(() => {
        socket.receive({
          version: 1,
          type: 'futures_account_state',
          resources: {
            balances: {
              status: 'ready',
              data: { USDT: { available: '25', total: '25' } },
              lastSuccessfulAt: 100,
            },
            positions: { status: 'ready', data: [], lastSuccessfulAt: 100 },
            regularOrders: { status: 'ready', data: [], lastSuccessfulAt: 100 },
            algoOrders: { status: 'ready', data: [algoOrder], lastSuccessfulAt: 100 },
            userDataStream: {
              status: 'ready', data: { connected: true }, lastSuccessfulAt: 100,
            },
          },
        })
      })
    }

    const firedParent = {
      symbol: 'TUTUSDT',
      orderId: 42,
      algoId: 42,
      status: 'NEW',
      orderKind: 'ALGO',
      algoType: 'CONDITIONAL',
      triggerPrice: '0.0123',
      actualOrderId: '990281234',
      actualPrice: '0.0121',
    }

    const refreshesIn = socket => socket.sent.filter(frame => frame.action === 'account.refresh')

    it('takes the parent off the desk on the fill, and reads once for the match', () => {
      const socket = createSocket()
      const { result } = renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))
      listAlgoParent(socket, firedParent)
      expect(result.current.openOrders).toHaveLength(1)
      const refreshesBefore = refreshesIn(socket).length

      act(() => {
        socket.receive({
          futures_execution_update: {
            symbol: 'TUTUSDT',
            orderId: 990281234,
            status: 'FILLED',
            orderKind: 'REGULAR',
          },
        })
      })

      // Resolved from the report, not from the beat.
      expect(result.current.openOrders).toHaveLength(0)
      expect(refreshesIn(socket)).toHaveLength(refreshesBefore + 1)
      expect(refreshesIn(socket).at(-1)).toMatchObject({ symbol: 'TUTUSDT' })
    })

    // Binance keeps a fired parent listed for a moment. While it is, several
    // reports can land against the order it spawned — and they are all the same
    // trigger.
    it('answers a burst of fills on one spawned order with one read', () => {
      const socket = createSocket()
      const { result } = renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))
      listAlgoParent(socket, firedParent)
      const refreshesBefore = refreshesIn(socket).length

      for (const executedQty of ['0.2', '0.5', '0.9']) {
        act(() => {
          socket.receive({
            futures_execution_update: {
              symbol: 'TUTUSDT',
              orderId: 990281234,
              status: 'PARTIALLY_FILLED',
              orderKind: 'REGULAR',
              z: executedQty,
            },
          })
        })
      }

      expect(refreshesIn(socket)).toHaveLength(refreshesBefore + 1)
      // Still working on the exchange, so still listed — and still stated as
      // the fired parent it is.
      expect(result.current.openOrders.some(order => (
        order.orderKind === 'ALGO' && order.actualOrderId === '990281234'
      ))).toBe(true)
    })

    it('resolves a parent whose spawned order was cancelled the same way', () => {
      const socket = createSocket()
      const { result } = renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))
      listAlgoParent(socket, firedParent)
      const refreshesBefore = refreshesIn(socket).length

      act(() => {
        socket.receive({
          futures_execution_update: {
            symbol: 'TUTUSDT',
            orderId: 990281234,
            status: 'CANCELED',
            orderKind: 'REGULAR',
          },
        })
      })

      expect(result.current.openOrders).toHaveLength(0)
      expect(refreshesIn(socket)).toHaveLength(refreshesBefore + 1)
    })

    // Binance numbers orders per contract, so the same id on another contract
    // is another order. Matching on the number alone would take a live stop off
    // the screen because something unrelated filled.
    it('does not resolve a parent from the same order id on another contract', () => {
      const socket = createSocket()
      const { result } = renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))
      listAlgoParent(socket, firedParent)
      const sentBefore = socket.sent.length

      act(() => {
        socket.receive({
          futures_execution_update: {
            symbol: 'BTCUSDT',
            orderId: 990281234,
            status: 'FILLED',
            orderKind: 'REGULAR',
          },
        })
      })

      expect(socket.sent).toHaveLength(sentBefore)
      expect(result.current.openOrders).toHaveLength(1)
      expect(result.current.openOrders[0]).toMatchObject({ symbol: 'TUTUSDT', orderKind: 'ALGO' })
    })

    // A scheduled algo names its current child in the same field a conditional
    // order names the order that finished it. Settling the parent on that
    // child's fill would be permanent: a settled identity is filtered out of
    // every later snapshot, so a TWAP that is still working would leave the
    // desk and never come back — uncancellable and invisible until reload.
    it('leaves an algo that outlives its spawned order listed, and readable again', () => {
      const socket = createSocket()
      const { result } = renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))
      const scheduled = { ...firedParent, algoType: 'TWAP' }
      listAlgoParent(socket, scheduled)
      const sentBefore = socket.sent.length

      act(() => {
        socket.receive({
          futures_execution_update: {
            symbol: 'TUTUSDT',
            orderId: 990281234,
            status: 'FILLED',
            orderKind: 'REGULAR',
          },
        })
      })

      expect(socket.sent).toHaveLength(sentBefore)
      expect(result.current.openOrders).toHaveLength(1)

      // And the next read still lists it. This is the half that would have been
      // permanent: nothing may have been remembered as settled.
      listAlgoParent(socket, { ...scheduled, actualOrderId: '990281299' })
      expect(result.current.openOrders).toHaveLength(1)
      expect(result.current.openOrders[0]).toMatchObject({ orderKind: 'ALGO', algoType: 'TWAP' })
    })

    // The exception is the match and nothing else. Everything the audit before
    // this one closed — reading the account on every fill — stays closed.
    it('reads nothing for a fill that no listed parent spawned', () => {
      const socket = createSocket()
      const { result } = renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'TUTUSDT',
        wsConnection: socket,
      }))
      listAlgoParent(socket, { ...firedParent, actualOrderId: '', actualPrice: '' })
      const sentBefore = socket.sent.length

      act(() => {
        socket.receive({
          futures_execution_update: {
            symbol: 'TUTUSDT',
            orderId: 990281234,
            status: 'FILLED',
            orderKind: 'REGULAR',
          },
        })
      })

      expect(socket.sent).toHaveLength(sentBefore)
      // The parent that never claimed that order is still listed, untouched.
      expect(result.current.openOrders).toHaveLength(1)
    })
  })

  // An order placed as a level breaks fills instantly, and the stream's FILLED
  // overtakes the reply to the placement itself. The reply describes the order
  // as it left — NEW — and put it back in the list, where nothing removed it
  // again because nothing reads the account unless the desk acts.
  it('refuses to relist an order the exchange has already reported settled', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT', orderId: 7, status: 'FILLED', side: 'BUY', orderKind: 'REGULAR',
        },
      })
    })
    expect(result.current.openOrders).toHaveLength(0)

    // The placement's own reply, which left the exchange before the fill.
    act(() => {
      socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT', orderId: 7, status: 'NEW', side: 'BUY', orderKind: 'REGULAR',
        },
      })
    })
    expect(result.current.openOrders).toHaveLength(0)

    // And a snapshot read from the account service, which is eventually
    // consistent with the stream and can still be describing the order.
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
              { symbol: 'BTCUSDT', orderId: 7, status: 'NEW', orderKind: 'REGULAR' },
              { symbol: 'BTCUSDT', orderId: 8, status: 'NEW', orderKind: 'REGULAR' },
            ],
            lastSuccessfulAt: 100,
          },
          algoOrders: { status: 'ready', data: [], lastSuccessfulAt: 100 },
        },
      })
    })
    // Only the settled one is refused; the order beside it is still resting.
    expect(result.current.openOrders.map(order => order.orderId)).toEqual([8])
  })

  it('settles only the orders the exchange named', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    // No id: the identity would be a prefix every unidentified order on the
    // contract shares, and settling that silences the whole contract.
    act(() => {
      socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT', orderId: null, status: 'FILLED', side: 'BUY',
        },
      })
    })
    act(() => {
      socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT', orderId: 9, status: 'NEW', side: 'BUY', orderKind: 'REGULAR',
        },
      })
    })

    expect(result.current.openOrders.map(order => order.orderId)).toEqual([9])
  })

  it('re-reads the account while orders rest and stops once none do', () => {
    vi.useFakeTimers()
    const socket = createSocket()
    const snapshot = orders => ({
      version: 1,
      type: 'futures_account_state',
      resources: {
        balances: {
          status: 'ready', data: { USDT: { available: '25', total: '25' } }, lastSuccessfulAt: 100,
        },
        positions: { status: 'ready', data: [], lastSuccessfulAt: 100 },
        regularOrders: { status: 'ready', data: orders, lastSuccessfulAt: 100 },
        algoOrders: { status: 'ready', data: [], lastSuccessfulAt: 100 },
      },
    })
    try {
      renderHook(() => useFuturesTrading({
        enabled: true,
        symbol: 'BTCUSDT',
        wsConnection: socket,
      }))
      const refreshes = () => socket.sent.filter(message => message.action === 'account.refresh').length
      // The mount's own read, before any beat.
      expect(refreshes()).toBe(1)

      // Nothing is resting, so nothing is re-read.
      act(() => { vi.advanceTimersByTime(120_000) })
      expect(refreshes()).toBe(1)

      act(() => {
        socket.receive(snapshot([{ symbol: 'BTCUSDT', orderId: 11, status: 'NEW', orderKind: 'REGULAR' }]))
      })
      act(() => { vi.advanceTimersByTime(90_000) })
      expect(refreshes()).toBe(4)

      act(() => { socket.receive(snapshot([])) })
      act(() => { vi.advanceTimersByTime(120_000) })
      expect(refreshes()).toBe(4)
    } finally {
      vi.useRealTimers()
    }
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

  // An unknown outcome is the one warning that must not be cleared by anything
  // but its own answer: an operator who stops seeing it sends the order again.
  it('keeps an unresolved outcome standing while another order reports', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      socket.receive({
        command_unresolved: {
          request: 'trade.placeOrder',
          code: 'FUTURES_OUTCOME_PENDING',
          message: 'Binance did not confirm this order either way.',
          details: {
            marketType: 'futures',
            symbol: 'BTCUSDT',
            orderId: null,
            clientOrderId: 'desk-btc-1',
          },
        },
      })
    })
    expect(result.current.unresolvedCommand?.code).toBe('FUTURES_OUTCOME_PENDING')

    act(() => {
      socket.receive({
        futures_execution_update: {
          symbol: 'ETHUSDT',
          orderId: 55,
          clientOrderId: 'desk-eth-9',
          status: 'NEW',
          side: 'BUY',
          price: '3000',
          origQty: '1',
        },
      })
    })
    expect(result.current.unresolvedCommand?.code).toBe('FUTURES_OUTCOME_PENDING')

    act(() => {
      socket.receive({
        command_rejected: {
          request: 'trade.cancelOrder',
          code: 'FUTURES_API_ERROR',
          message: 'Unknown order sent.',
          details: { marketType: 'futures', symbol: 'ETHUSDT', orderId: 55 },
        },
      })
    })
    expect(result.current.unresolvedCommand?.code).toBe('FUTURES_OUTCOME_PENDING')

    act(() => {
      socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT',
          orderId: 77,
          clientOrderId: 'desk-btc-1',
          status: 'NEW',
          side: 'BUY',
          price: '58000',
          origQty: '0.01',
        },
      })
    })
    expect(result.current.unresolvedCommand).toBeNull()
  })

  it('withdraws an unresolved outcome the backend resolved by name', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      socket.receive({
        command_unresolved: {
          request: 'trade.placeOrder',
          code: 'FUTURES_OUTCOME_PENDING',
          message: 'Binance did not confirm this order either way.',
          details: { marketType: 'futures', symbol: 'BTCUSDT', clientOrderId: 'desk-btc-2' },
        },
      })
      socket.receive({
        command_resolved: {
          request: 'trade.placeOrder',
          code: 'FUTURES_OUTCOME_ABSENT',
          message: 'Binance does not have this order — nothing was executed.',
          details: { marketType: 'futures', symbol: 'BTCUSDT', clientOrderId: 'desk-btc-2' },
        },
      })
    })
    expect(result.current.unresolvedCommand).toBeNull()
  })


  // A balance held across a transport loss is a reading, not a confirmation.
  // The ticket sizes orders from it, so it may not stay `ready` until a read has
  // answered on the connection that is up now.
  it('marks the held account unconfirmed when the transport drops', () => {
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
          balances: {
            status: 'ready',
            data: { USDT: { available: '90', total: '100' } },
            lastSuccessfulAt: 100,
          },
        },
      })
    })
    expect(result.current.accountResources.balances.status).toBe('ready')

    act(() => socket.dropConnection())
    expect(result.current.accountResources.balances.status).toBe('stale')
    expect(result.current.accountResources.balances.error.message)
      .toMatch(/Not confirmed since the connection dropped/)
    // The values stay readable — an empty desk on reconnect is worse.
    expect(result.current.balances).toMatchObject({ USDT: { available: '90' } })

    act(() => {
      socket.receive({
        version: 1,
        type: 'futures_account_state',
        resources: {
          balances: {
            status: 'ready',
            data: { USDT: { available: '95', total: '100' } },
            lastSuccessfulAt: 200,
          },
        },
      })
    })
    expect(result.current.accountResources.balances.status).toBe('ready')
  })

})

describe('useFuturesTrading command answers', () => {
  // A drag that lifts an order off the book may not begin on a dispatch: it
  // needs to know the exchange actually cancelled the order.
  const renderTrading = (socket) => renderHook(() => useFuturesTrading({
    enabled: true,
    symbol: 'BTCUSDT',
    wsConnection: socket,
  }))

  it('answers a cancellation with what the exchange did, not with what was sent', async () => {
    const socket = createSocket()
    const { result } = renderTrading(socket)

    let answer = null
    act(() => {
      result.current.cancelOrderAndConfirm({ symbol: 'BTCUSDT', orderId: 11 })
        .then((outcome) => { answer = outcome })
    })
    expect(socket.sent.at(-1)).toMatchObject({ action: 'trade.cancelOrder', orderId: 11 })
    // Another order's traffic answers nothing.
    await act(async () => {
      socket.receive({
        futures_execution_update: { symbol: 'BTCUSDT', orderId: 99, status: 'CANCELED' },
      })
    })
    expect(answer).toBeNull()

    await act(async () => {
      socket.receive({
        futures_execution_update: { symbol: 'BTCUSDT', orderId: 11, status: 'CANCELED' },
      })
    })
    expect(answer).toMatchObject({ outcome: 'confirmed' })
  })

  it('answers a refusal that names the order as a refusal', async () => {
    const socket = createSocket()
    const { result } = renderTrading(socket)

    let answer = null
    act(() => {
      result.current.cancelOrderAndConfirm({ symbol: 'BTCUSDT', orderId: 11 })
        .then((outcome) => { answer = outcome })
    })
    await act(async () => {
      socket.receive({
        command_rejected: {
          request: 'trade.cancelOrder',
          code: 'FUTURES_API_ERROR',
          message: 'Unknown order sent.',
          details: { marketType: 'futures', symbol: 'BTCUSDT', orderId: 11 },
        },
      })
    })

    expect(answer).toMatchObject({ outcome: 'refused', message: 'Unknown order sent.' })
  })

  it('answers an unconfirmed outcome as unknown, never as a failure', async () => {
    const socket = createSocket()
    const { result } = renderTrading(socket)

    let answer = null
    act(() => {
      result.current.cancelOrderAndConfirm({ symbol: 'BTCUSDT', orderId: 11 })
        .then((outcome) => { answer = outcome })
    })
    await act(async () => {
      socket.receive({
        command_unresolved: {
          request: 'trade.cancelOrder',
          code: 'FUTURES_OUTCOME_PENDING',
          message: 'Binance did not confirm this order either way.',
          details: { marketType: 'futures', symbol: 'BTCUSDT', orderId: 11 },
        },
      })
    })

    expect(answer).toMatchObject({ outcome: 'unknown' })
  })

  it('recognises its own placement by the identity the command minted', async () => {
    const socket = createSocket()
    const { result } = renderTrading(socket)

    let answer = null
    act(() => {
      result.current.placeOrderAndConfirm({
        symbol: 'BTCUSDT',
        side: 'BUY',
        price: '58445',
        quantity: '0.004',
      }).then((outcome) => { answer = outcome })
    })
    const placement = socket.sent.at(-1)
    expect(placement).toMatchObject({ action: 'trade.placeOrder', quantity: '0.004' })

    await act(async () => {
      socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT',
          orderId: 12,
          clientOrderId: placement.clientOrderId,
          status: 'NEW',
        },
      })
    })

    expect(answer).toMatchObject({ outcome: 'confirmed' })
    // Exactly one frame: the account refresh on subscribe, and this order.
    expect(socket.sent.filter(frame => frame.action === 'trade.placeOrder')).toHaveLength(1)
  })

  // A refusal that names no order — a paused desk, a local cap — answers one
  // command of that action. Settling every waiting command on it would let a
  // refusal of the ticket's order end the drag's wait for a different one.
  it('settles one command on an answer that names no order', async () => {
    const socket = createSocket()
    const { result } = renderTrading(socket)

    const answers = []
    act(() => {
      result.current.placeOrderAndConfirm({ symbol: 'BTCUSDT', side: 'BUY', price: '1', quantity: '1' })
        .then(outcome => answers.push(['first', outcome]))
      result.current.placeOrderAndConfirm({ symbol: 'BTCUSDT', side: 'SELL', price: '2', quantity: '1' })
        .then(outcome => answers.push(['second', outcome]))
    })
    await act(async () => {
      socket.receive({
        command_rejected: {
          request: 'trade.placeOrder',
          code: 'FUTURES_ORDER_CAP_EXCEEDED',
          message: 'above the cap',
          details: { marketType: 'futures', capUsdt: '200' },
        },
      })
    })

    expect(answers).toEqual([['first', expect.objectContaining({ outcome: 'refused' })]])

    // The second is still waiting, and its own report answers it.
    const second = socket.sent.at(-1)
    await act(async () => {
      socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT', orderId: 5, clientOrderId: second.clientOrderId, status: 'NEW',
        },
      })
    })
    expect(answers).toHaveLength(2)
    expect(answers[1]).toEqual(['second', expect.objectContaining({ outcome: 'confirmed' })])
  })

  it('refuses immediately when the frame cannot leave the renderer', async () => {
    const socket = createSocket()
    const { result } = renderTrading(socket)
    socket.readyState = 3

    let answer = null
    await act(async () => {
      answer = await result.current.cancelOrderAndConfirm({ symbol: 'BTCUSDT', orderId: 11 })
    })

    expect(answer).toMatchObject({ outcome: 'refused', code: 'LOCAL_CONNECTION_UNAVAILABLE' })
  })

  it('leaves a command unanswered by a dropped connection as unknown', async () => {
    const socket = createSocket()
    const { result } = renderTrading(socket)

    let answer = null
    act(() => {
      result.current.cancelOrderAndConfirm({ symbol: 'BTCUSDT', orderId: 11 })
        .then((outcome) => { answer = outcome })
    })
    await act(async () => { socket.dropConnection() })

    expect(answer).toMatchObject({ outcome: 'unknown', code: 'TRANSPORT_LOST' })
  })
})

describe('useFuturesTrading held account review', () => {
  const subscribe = (socket) => renderHook(() => useFuturesTrading({
    enabled: true,
    symbol: 'BTCUSDT',
    wsConnection: socket,
  }))

  const readingArrives = (socket) => {
    act(() => {
      socket.receive({
        futures_history: {
          symbol: 'BTCUSDT',
          orders: [{ symbol: 'BTCUSDT', orderId: 1, status: 'FILLED', time: 1_000 }],
          trades: [{ symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5', time: 1_000 }],
          symbols: ['BTCUSDT'],
          discovered: 1,
          error: null,
        },
      })
    })
  }

  // The review is read once and then maintained. An order that settles after it
  // was read belongs in it, and asking Binance for the account again to learn
  // something the desk was already told is what this replaces.
  it('folds a settled order and its fill into the reading without sending anything', () => {
    const socket = createSocket()
    const { result } = subscribe(socket)
    readingArrives(socket)
    const framesAfterReading = socket.sent.length

    act(() => {
      socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT',
          orderId: 2,
          status: 'FILLED',
          side: 'SELL',
          origQty: '0.004',
          executedQty: '0.004',
          tradeId: 8,
          lastFilledQty: '0.004',
          lastFilledPrice: '58500',
          realizedPnl: '31.2',
          time: 9_000,
        },
      })
    })

    expect(result.current.history.orders).toHaveLength(2)
    expect(result.current.history.trades).toHaveLength(2)
    expect(result.current.history.orders[0]).toMatchObject({ orderId: 2, status: 'FILLED' })
    // Not one frame: the stream already carried it.
    expect(socket.sent).toHaveLength(framesAfterReading)

    // And the read that follows lists it once, not twice.
    act(() => {
      socket.receive({
        futures_history: {
          symbol: 'BTCUSDT',
          orders: [
            { symbol: 'BTCUSDT', orderId: 1, status: 'FILLED', time: 1_000 },
            { symbol: 'BTCUSDT', orderId: 2, status: 'FILLED', time: 9_000 },
          ],
          trades: [
            { symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5', time: 1_000 },
            { symbol: 'BTCUSDT', id: 8, realizedPnl: '31.2', time: 9_000 },
          ],
          symbols: ['BTCUSDT'],
          discovered: 1,
          error: null,
        },
      })
    })
    expect(result.current.history.orders).toHaveLength(2)
    expect(result.current.history.trades).toHaveLength(2)
  })

  it('holds the rows through a refresh and states when the reading was taken', async () => {
    const socket = createSocket()
    const { result } = subscribe(socket)
    await waitFor(() => expect(result.current.historyStoreReady).toBe(true))
    readingArrives(socket)
    const readAt = result.current.history.readAt
    expect(readAt).toBeGreaterThan(0)

    act(() => { result.current.loadHistory('BTCUSDT') })
    expect(result.current.history.status).toBe('refreshing')
    expect(result.current.history.orders).toHaveLength(1)
    expect(result.current.history.readAt).toBe(readAt)
  })

  it('folds nothing into a review nobody has read', () => {
    const socket = createSocket()
    const { result } = subscribe(socket)

    act(() => {
      socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT', orderId: 2, status: 'FILLED', time: 9_000,
        },
      })
    })

    // A lone folded row would present itself as an account review, and the scope
    // beneath it would describe a read that never happened.
    expect(result.current.history.orders).toEqual([])
    expect(result.current.history.readAt).toBeNull()
  })
})
