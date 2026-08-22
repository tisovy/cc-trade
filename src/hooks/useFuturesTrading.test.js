import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useFuturesTrading from './useFuturesTrading.js'
import * as futuresTradeRounds from '../utils/futuresTradeRounds.js'
import { FUTURES_UNDERIVABLE_INCOME_TYPES } from '../utils/futuresSettledMoney.js'

const ACCOUNT_FINGERPRINT = '0123456789abcdef'
const OTHER_ACCOUNT_FINGERPRINT = 'fedcba9876543210'
const HISTORY_READ_AT = 1_784_000_000_000

const settledIncomeLanes = ({ rows = [], ...lane }) => Object.fromEntries(
  FUTURES_UNDERIVABLE_INCOME_TYPES.map(incomeType => [incomeType, {
    incomeType,
    rows: incomeType === 'FUNDING_FEE' ? rows : [],
    ...lane,
  }]),
)

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

const accountEnvelope = (resources = {}, fingerprint = ACCOUNT_FINGERPRINT) => ({
  version: 1,
  type: 'futures_account_state',
  accountFingerprint: fingerprint,
  resources,
})

const historyEnvelope = (history, {
  fingerprint = ACCOUNT_FINGERPRINT,
  readAt = HISTORY_READ_AT,
} = {}) => ({
  futures_history: {
    ...history,
    accountFingerprint: fingerprint,
    readAt,
  },
})

const authorizeAccount = (socket, resources = {}, fingerprint = ACCOUNT_FINGERPRINT) => {
  act(() => socket.receive(accountEnvelope(resources, fingerprint)))
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

  it('routes mark frames through the external store without rewriting account positions', () => {
    const socket = createSocket()
    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount += 1
      return useFuturesTrading({
        enabled: true,
        symbol: 'BMTUSDT',
        wsConnection: socket,
      })
    })

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
    const snapshotPositions = result.current.positions
    const store = result.current.positionMarkStore
    const listener = vi.fn()
    const unsubscribe = store.subscribe('BMTUSDT', listener)
    const rendersAfterSnapshot = renderCount

    act(() => socket.receive({
      type: 'futures_position_marks',
      version: 1,
      marks: { BMTUSDT: { markPrice: '0.03600', updatedAt: 200 } },
    }))
    expect(result.current.positions).toBe(snapshotPositions)
    expect(result.current.positions[0]).toMatchObject({
      markPrice: '0.03523',
      unrealizedPnl: '-1708.49',
    })
    expect(store.get('bmtusdt')).toEqual({
      markPrice: '0.03600',
      updatedAt: 200,
      lastPrice: null,
      lastPriceAt: null,
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(renderCount).toBe(rendersAfterSnapshot)

    // A dropped feed clears only the high-frequency lane. Consumers then read
    // the untouched account position as their qualified fallback.
    act(() => socket.receive({ type: 'futures_position_marks', version: 1, marks: {} }))
    expect(store.get('BMTUSDT')).toBeNull()
    expect(result.current.positions[0].markPrice).toBe('0.03523')
    expect(result.current.positions[0].unrealizedPnl).toBe('-1708.49')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(renderCount).toBe(rendersAfterSnapshot)
    unsubscribe()
  })

  it('clears visible marks without retiring a feed that survives a market generation change', () => {
    const socket = createSocket()
    const { result, rerender } = renderHook(
      ({ generation }) => useFuturesTrading({
        enabled: true,
        symbol: 'BTCUSDT',
        wsConnection: socket,
        marketGeneration: generation,
      }),
      { initialProps: { generation: 7 } },
    )

    act(() => socket.receive({
      type: 'futures_position_marks',
      version: 1,
      feedEpoch: 3,
      revision: 12,
      marks: { BTCUSDT: { markPrice: '60000', updatedAt: 100 } },
    }))
    expect(result.current.positionMarkStore.get('BTCUSDT')?.markPrice).toBe('60000')

    rerender({ generation: 8 })
    expect(result.current.positionMarkStore.get('BTCUSDT')).toBeNull()

    // Market activation and feed lifetime are independent on the backend. The
    // next revision from the same feed is therefore current and must repopulate
    // the cleared reading without reopening the old revision window.
    act(() => socket.receive({
      type: 'futures_position_marks',
      version: 1,
      feedEpoch: 3,
      revision: 13,
      marks: { BTCUSDT: { markPrice: '60100', updatedAt: 200 } },
    }))
    expect(result.current.positionMarkStore.get('BTCUSDT')?.markPrice).toBe('60100')

    act(() => socket.receive({
      type: 'futures_position_marks',
      version: 1,
      feedEpoch: 3,
      revision: 12,
      marks: { BTCUSDT: { markPrice: '59000', updatedAt: 50 } },
    }))
    expect(result.current.positionMarkStore.get('BTCUSDT')?.markPrice).toBe('60100')

    // A real feed replacement still opens a fresh revision namespace.
    act(() => socket.receive({
      type: 'futures_position_marks',
      version: 1,
      feedEpoch: 4,
      revision: 1,
      marks: { BTCUSDT: { markPrice: '60200', updatedAt: 300 } },
    }))
    expect(result.current.positionMarkStore.get('BTCUSDT')?.markPrice).toBe('60200')

    act(() => socket.receive({
      type: 'futures_position_marks',
      version: 1,
      feedEpoch: 3,
      revision: 15,
      marks: { BTCUSDT: { markPrice: '59000', updatedAt: 50 } },
    }))
    expect(result.current.positionMarkStore.get('BTCUSDT')?.markPrice).toBe('60200')
    // Changing only activation generation does not resubscribe the account lane.
    expect(socket.sent).toHaveLength(1)
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

    authorizeAccount(socket)
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
      socket.receive(historyEnvelope({
          symbol: 'BTCUSDT',
          orders: [{ symbol: 'BTCUSDT', orderId: 1, side: 'BUY', status: 'FILLED' }],
          trades: [{ symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5' }],
          symbols: ['BTCUSDT', 'BICOUSDT'],
          discovered: 17,
          error: null,
      }))
    })
    expect(result.current.history.status).toBe('ready')
    expect(result.current.history.trades).toHaveLength(1)
    // How wide the read was, and how wide it should have been. Both were on the
    // payload and neither reached the surface, which is how a bounded review
    // presented itself as the whole account.
    expect(result.current.history.symbols).toEqual(['BTCUSDT', 'BICOUSDT'])
    expect(result.current.history.discovered).toBe(17)

    act(() => {
      socket.receive(historyEnvelope({
          symbol: 'BTCUSDT',
          orders: [],
          trades: [],
          error: { code: 'FUTURES_API_ERROR', message: 'refused' },
      }, { readAt: HISTORY_READ_AT + 1 }))
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
      readContracts: vi.fn(async () => [{
        key: `${ACCOUNT_FINGERPRINT}:BTCUSDT`,
        fingerprint: ACCOUNT_FINGERPRINT,
        symbol: 'BTCUSDT',
        orders: [{ orderId: 4, symbol: 'BTCUSDT', status: 'FILLED', time: 1_784_000_000_000 }],
        trades: [{
          id: '9',
          orderId: '4',
          symbol: 'BTCUSDT',
          side: 'BUY',
          positionSide: 'BOTH',
          price: '100',
          quantity: '1',
          realizedPnl: '3.5',
          commission: '0',
          marginAsset: 'USDT',
          time: 1_784_000_000_000,
        }],
        orderCursor: '4',
        tradeCursor: '9',
        readAt: 1_784_000_000_000,
      }]),
      writeReading: vi.fn(async () => true),
    }
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))

    authorizeAccount(socket)
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
    expect(result.current.accountFingerprint).toBe(ACCOUNT_FINGERPRINT)
    expect(historyStore.readContracts).toHaveBeenCalledWith(ACCOUNT_FINGERPRINT)
    // Nothing was asked of the exchange for any of it — only the account refresh
    // the subscription always sends.
    expect(socket.sent.map(frame => frame.action)).toEqual(['account.refresh'])
    expect(historyStore.writeReading).not.toHaveBeenCalled()
  })

  it('carries the stored coverage on an incremental read and marks an explicit full read', async () => {
    const socket = createSocket()
    const historyStore = {
      readContracts: vi.fn(async () => [{
        key: `${ACCOUNT_FINGERPRINT}:BTCUSDT`,
        fingerprint: ACCOUNT_FINGERPRINT,
        symbol: 'BTCUSDT',
        orders: [],
        trades: [],
        orderCursor: '90071992547409931234',
        tradeCursor: '90071992547409931235',
        readAt: 1_784_000_000_000,
      }]),
      writeReading: vi.fn(async () => true),
    }
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))

    authorizeAccount(socket)
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

    authorizeAccount(socket)
    await waitFor(() => expect(result.current.historyStoreReady).toBe(true))
    act(() => {
      socket.receive(historyEnvelope({
          symbol: 'BTCUSDT',
          orders: [{ orderId: 1, symbol: 'BTCUSDT', side: 'BUY', status: 'FILLED' }],
          trades: [{ id: 7, symbol: 'BTCUSDT', realizedPnl: '12.5' }],
          symbols: ['BTCUSDT', 'BICOUSDT'],
          discovered: 2,
          readFrom: {
            BTCUSDT: { orderCursor: '1', tradeCursor: '7' },
            BICOUSDT: { orderCursor: null, tradeCursor: null },
          },
          merge: {
            BTCUSDT: { orders: true, trades: true },
          },
          error: null,
      }))
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
      merge: {
        BTCUSDT: { orders: true, trades: true },
      },
      accountFingerprint: ACCOUNT_FINGERPRINT,
      readAt: HISTORY_READ_AT,
    })
    expect(Number.isSafeInteger(historyStore.writeReading.mock.calls[0][0].readAt)).toBe(true)

    act(() => {
      socket.receive(historyEnvelope({
          symbol: 'BTCUSDT',
          orders: [],
          trades: [],
          error: { code: 'FUTURES_API_ERROR', message: 'refused' },
      }, { readAt: HISTORY_READ_AT + 1 }))
    })
    // A read that failed proves nothing about what the account holds.
    expect(historyStore.writeReading).toHaveBeenCalledTimes(1)
    expect(result.current.history.trades).toHaveLength(1)
  })

  it('keeps restored and arriving history inside its fingerprint and market generation', async () => {
    const socket = createSocket()
    const pendingReads = []
    const historyStore = {
      readContracts: vi.fn(fingerprint => new Promise((resolve) => {
        pendingReads.push({ fingerprint, resolve })
      })),
      writeReading: vi.fn(async () => true),
    }
    const stored = (fingerprint, id, readAt) => [{
      key: `${fingerprint}:BTCUSDT`,
      fingerprint,
      symbol: 'BTCUSDT',
      orders: [],
      trades: [{ symbol: 'BTCUSDT', id, realizedPnl: `${id}`, time: readAt }],
      orderCursor: null,
      tradeCursor: `${id}`,
      readAt,
    }]
    const { result, rerender } = renderHook(
      ({ generation }) => useFuturesTrading({
        enabled: true,
        symbol: 'BTCUSDT',
        wsConnection: socket,
        historyStore,
        marketGeneration: generation,
      }),
      { initialProps: { generation: 7 } },
    )

    authorizeAccount(socket)
    await waitFor(() => expect(pendingReads).toHaveLength(1))
    expect(pendingReads[0].fingerprint).toBe(ACCOUNT_FINGERPRINT)
    await act(async () => {
      pendingReads[0].resolve(stored(ACCOUNT_FINGERPRINT, 1, HISTORY_READ_AT))
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.history.trades[0]?.id).toBe(1))
    act(() => socket.receive({
      type: 'futures_settled_income',
      version: 2,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      generation: 1,
      digest: 'account-a',
      rows: [],
      lanes: settledIncomeLanes({
        coveredFrom: 0,
        coveredTo: HISTORY_READ_AT,
        targetTo: HISTORY_READ_AT,
        status: 'ready',
        attemptedAt: HISTORY_READ_AT,
        successfulAt: HISTORY_READ_AT,
        complete: true,
        error: null,
      }),
      coveredFrom: 0,
      coveredTo: HISTORY_READ_AT,
      targetTo: HISTORY_READ_AT,
      readAt: HISTORY_READ_AT,
      attemptedAt: HISTORY_READ_AT,
      successfulAt: HISTORY_READ_AT,
      status: 'ready',
      complete: true,
    }))
    expect(result.current.settledIncome?.digest).toBe('account-a')

    authorizeAccount(socket, {}, OTHER_ACCOUNT_FINGERPRINT)
    await waitFor(() => expect(pendingReads).toHaveLength(2))
    expect(result.current).toMatchObject({
      accountFingerprint: OTHER_ACCOUNT_FINGERPRINT,
      history: { orders: [], trades: [], readAt: null },
      settledIncome: null,
    })
    act(() => socket.receive(historyEnvelope({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [{ symbol: 'BTCUSDT', id: 99, realizedPnl: '99', time: HISTORY_READ_AT + 99 }],
      error: null,
    }, { fingerprint: ACCOUNT_FINGERPRINT, readAt: HISTORY_READ_AT + 99 })))
    expect(result.current.history.trades).toEqual([])

    await act(async () => {
      pendingReads[1].resolve(stored(OTHER_ACCOUNT_FINGERPRINT, 2, HISTORY_READ_AT + 1))
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.history.trades[0]?.id).toBe(2))
    act(() => socket.receive(historyEnvelope({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [{ symbol: 'BTCUSDT', id: 3, realizedPnl: '3', time: HISTORY_READ_AT + 2 }],
      error: null,
    }, { fingerprint: OTHER_ACCOUNT_FINGERPRINT, readAt: HISTORY_READ_AT + 2 })))
    await waitFor(() => expect(historyStore.writeReading).toHaveBeenCalledTimes(1))
    expect(historyStore.writeReading).toHaveBeenCalledWith(expect.objectContaining({
      accountFingerprint: OTHER_ACCOUNT_FINGERPRINT,
      readAt: HISTORY_READ_AT + 2,
    }))

    rerender({ generation: 8 })
    await waitFor(() => expect(result.current.accountFingerprint).toBeNull())
    expect(result.current.history).toMatchObject({ orders: [], trades: [], readAt: null })
    expect(result.current.settledIncome).toBeNull()
    act(() => socket.receive(historyEnvelope({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [{ symbol: 'BTCUSDT', id: 100, realizedPnl: '100', time: HISTORY_READ_AT + 100 }],
      error: null,
    }, { fingerprint: OTHER_ACCOUNT_FINGERPRINT, readAt: HISTORY_READ_AT + 100 })))
    expect(result.current.history.trades).toEqual([])
    expect(historyStore.writeReading).toHaveBeenCalledTimes(1)

    authorizeAccount(socket, {}, OTHER_ACCOUNT_FINGERPRINT)
    await waitFor(() => expect(pendingReads).toHaveLength(3))
    expect(historyStore.readContracts.mock.calls.map(([fingerprint]) => fingerprint))
      .toEqual([ACCOUNT_FINGERPRINT, OTHER_ACCOUNT_FINGERPRINT, OTHER_ACCOUNT_FINGERPRINT])
  })

  it('admits crossed history answers independently per endpoint', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    authorizeAccount(socket)

    act(() => socket.receive(historyEnvelope({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [{ symbol: 'BTCUSDT', id: 30, realizedPnl: '30', time: 30_000 }],
      views: ['trades'],
      basisOnly: true,
      error: null,
    }, { readAt: 30_000 })))
    act(() => socket.receive(historyEnvelope({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      orders: [{ symbol: 'BTCUSDT', orderId: 20, status: 'FILLED', time: 20_000 }],
      trades: [{ symbol: 'BTCUSDT', id: 20, realizedPnl: '20', time: 20_000 }],
      views: ['orders', 'trades'],
      error: null,
    }, { readAt: 20_000 })))

    expect(result.current.history.orders.map(row => row.orderId)).toEqual([20])
    expect(result.current.history.trades.map(row => row.id)).toEqual([30])
    expect(result.current.history.coverage.BTCUSDT).toMatchObject({
      orderReadAt: 20_000,
      tradeReadAt: 30_000,
    })
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

    authorizeAccount(socket)
    await waitFor(() => expect(deliverStore).toBeTypeOf('function'))
    act(() => {
      socket.receive(historyEnvelope({
          symbol: 'ETHUSDT',
          orders: [{ orderId: 21, symbol: 'ETHUSDT', side: 'SELL', status: 'FILLED' }],
          trades: [],
          symbols: ['ETHUSDT'],
          discovered: 1,
          error: null,
      }, { readAt: HISTORY_READ_AT + 1 }))
    })
    await act(async () => {
      deliverStore([{
        key: `${ACCOUNT_FINGERPRINT}:BTCUSDT`,
        fingerprint: ACCOUNT_FINGERPRINT,
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

  it('starts one basis-only trade read only after current positions and the store are ready', async () => {
    const socket = createSocket()
    const historyStore = {
      readContracts: vi.fn(async () => []),
      writeReading: vi.fn(async () => true),
    }
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))
    const historyReads = () => socket.sent.filter(frame => frame.action === 'account.history')

    act(() => socket.receive(accountEnvelope({
      positions: {
        status: 'loading',
        data: [{ symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '1', entryPrice: '100' }],
        lastAttemptAt: 90,
      },
    })))
    await waitFor(() => expect(result.current.historyStoreReady).toBe(true))
    expect(historyReads()).toEqual([])

    const readyPositions = accountEnvelope({
        positions: {
          status: 'ready',
          data: [
            { symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '1', entryPrice: '100' },
            { symbol: 'ETHUSDT', positionSide: 'SHORT', quantity: '-2', entryPrice: '120' },
          ],
          lastSuccessfulAt: 100,
        },
    })
    act(() => socket.receive(readyPositions))
    expect(historyReads()).toHaveLength(1)
    expect(historyReads()[0]).toMatchObject({
      action: 'account.history',
      marketType: 'futures',
      symbol: 'BTCUSDT',
      basisOnly: true,
      views: ['trades'],
    })

    act(() => socket.receive(readyPositions))
    expect(historyReads()).toHaveLength(1)
  })

  it('turns each new authenticated reconcile generation into one incremental trade read', async () => {
    const socket = createSocket()
    const historyStore = {
      readContracts: vi.fn(async () => []),
      writeReading: vi.fn(async () => true),
    }
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))
    const historyReads = () => socket.sent.filter(frame => frame.action === 'account.history')

    authorizeAccount(socket, {
      positions: { status: 'ready', data: [], lastSuccessfulAt: 100 },
    })
    await waitFor(() => expect(result.current.historyStoreReady).toBe(true))
    expect(historyReads()).toEqual([])

    act(() => socket.receive({
      type: 'futures_history_reconcile',
      version: 1,
      accountFingerprint: OTHER_ACCOUNT_FINGERPRINT,
      generation: 99,
    }))
    expect(historyReads()).toEqual([])

    act(() => socket.receive({
      type: 'futures_history_reconcile',
      version: 1,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      generation: 1,
    }))
    await waitFor(() => expect(historyReads()).toHaveLength(1))
    expect(historyReads()[0]).toMatchObject({
      symbol: 'BTCUSDT',
      full: false,
      views: ['trades'],
    })
    expect(historyReads()[0]).not.toHaveProperty('basisOnly')

    act(() => {
      socket.receive({
        type: 'futures_history_reconcile',
        version: 1,
        accountFingerprint: ACCOUNT_FINGERPRINT,
        generation: 1,
      })
      socket.receive({
        type: 'futures_history_reconcile',
        version: 1,
        accountFingerprint: ACCOUNT_FINGERPRINT,
        generation: 0,
      })
    })
    expect(historyReads()).toHaveLength(1)

    act(() => socket.receive({
      type: 'futures_history_reconcile',
      version: 1,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      generation: 2,
    }))
    await waitFor(() => expect(historyReads()).toHaveLength(2))
  })

  it('coalesces a reconcile frame with legacy margin-asset migration into one Full read', async () => {
    const socket = createSocket()
    let deliverStore
    const historyStore = {
      readContracts: vi.fn(() => new Promise((resolve) => { deliverStore = resolve })),
      writeReading: vi.fn(async () => true),
    }
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))
    const historyReads = () => socket.sent.filter(frame => frame.action === 'account.history')

    authorizeAccount(socket, {
      positions: { status: 'ready', data: [], lastSuccessfulAt: 100 },
    })
    await waitFor(() => expect(deliverStore).toBeTypeOf('function'))
    act(() => socket.receive({
      type: 'futures_history_reconcile',
      version: 1,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      generation: 1,
    }))
    await act(async () => {
      deliverStore([{
        version: 2,
        key: `${ACCOUNT_FINGERPRINT}:BTCUSDT`,
        fingerprint: ACCOUNT_FINGERPRINT,
        symbol: 'BTCUSDT',
        orders: [],
        // This is intentionally an old persisted row: no marginAsset evidence.
        trades: [{
          id: '7',
          orderId: '70',
          symbol: 'BTCUSDT',
          positionSide: 'BOTH',
          side: 'BUY',
          price: '100',
          quantity: '1',
          realizedPnl: '0',
          commission: '0.1',
          commissionAsset: 'USDT',
          time: HISTORY_READ_AT,
        }],
        orderCursor: null,
        tradeCursor: '7',
        tradeCoverage: {
          version: 2,
          coveredFrom: HISTORY_READ_AT - 60_000,
          coveredTo: HISTORY_READ_AT,
          complete: true,
          continuityComplete: true,
        },
        readAt: HISTORY_READ_AT,
      }])
      await Promise.resolve()
    })

    await waitFor(() => expect(historyReads()).toHaveLength(1))
    expect(result.current.history.trades).toEqual([expect.objectContaining({ id: '7' })])
    expect(result.current.history.coverage.BTCUSDT).toMatchObject({
      tradeCursor: null,
      tradeCoverage: null,
    })
    expect(historyReads()[0]).toMatchObject({
      symbol: 'BTCUSDT',
      full: true,
      views: ['trades'],
    })
    expect(historyReads()[0]).not.toHaveProperty('basisOnly')
  })

  it('leaves basis-read continuation exclusively to the backend', async () => {
    const socket = createSocket()
    const historyStore = {
      readContracts: vi.fn(async () => []),
      writeReading: vi.fn(async () => true),
    }
    const { result, unmount } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))
    const historyReads = () => socket.sent.filter(frame => frame.action === 'account.history')

    authorizeAccount(socket, {
      positions: {
        status: 'ready',
        data: [{
          symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '1', entryPrice: '100',
        }],
        lastSuccessfulAt: 100,
      },
    })
    await waitFor(() => expect(result.current.historyStoreReady).toBe(true))
    await waitFor(() => expect(historyReads()).toHaveLength(1))
    expect(historyReads()[0]).toMatchObject({ basisOnly: true, views: ['trades'] })

    vi.useFakeTimers()
    try {
      act(() => socket.receive(historyEnvelope({
        symbol: 'BTCUSDT',
        symbols: ['BTCUSDT'],
        orders: [],
        trades: [{
          id: '7',
          orderId: '70',
          symbol: 'BTCUSDT',
          positionSide: 'BOTH',
          side: 'BUY',
          price: '100',
          quantity: '1',
          realizedPnl: '0',
          commission: '0.1',
          commissionAsset: 'USDT',
          marginAsset: 'USDT',
          time: HISTORY_READ_AT,
        }],
        views: ['trades'],
        basisOnly: true,
        readFrom: { BTCUSDT: { tradeCursor: null } },
        tradeCoverage: {
          BTCUSDT: {
            version: 2,
            targetFrom: HISTORY_READ_AT - 60_000,
            targetTo: HISTORY_READ_AT,
            coveredFrom: HISTORY_READ_AT - 30_000,
            coveredTo: HISTORY_READ_AT,
            complete: false,
            pageLimited: true,
            retentionLimited: false,
            continuityComplete: false,
          },
        },
        error: null,
      })))
      expect(result.current.history.coverage.BTCUSDT.tradeCoverage)
        .toMatchObject({ complete: false, pageLimited: true })

      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(historyReads()).toHaveLength(1)
    } finally {
      unmount()
      vi.useRealTimers()
    }
  })

  it('does not schedule trade repair for zero-fill lifecycle reports', async () => {
    const socket = createSocket()
    const historyStore = {
      readContracts: vi.fn(async () => []),
      writeReading: vi.fn(async () => true),
    }
    const { result, unmount } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))
    authorizeAccount(socket)
    await waitFor(() => expect(result.current.historyStoreReady).toBe(true))
    const historyReads = () => socket.sent.filter(frame => frame.action === 'account.history')

    vi.useFakeTimers()
    try {
      act(() => {
        for (const [index, status] of ['NEW', 'CANCELED', 'EXPIRED'].entries()) {
          socket.receive({
            futures_execution_update: {
              symbol: 'BTCUSDT',
              orderId: `lifecycle-${index}`,
              status,
              executionType: status,
              side: 'BUY',
              executedQty: '0',
              lastFilledQty: '0',
              time: 1_000 + index,
            },
          })
        }
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(1_200) })
      expect(historyReads()).toEqual([])
      expect(result.current.history.trades).toEqual([])

      act(() => socket.receive({
        futures_execution_update: {
          symbol: 'BTCUSDT',
          orderId: 'filled-1',
          tradeId: '7001',
          status: 'FILLED',
          executionType: 'TRADE',
          side: 'BUY',
          executedQty: '1',
          lastFilledQty: '1',
          lastFilledPrice: '100',
          realizedPnl: '0',
          commission: '0',
          commissionAsset: 'USDT',
          time: 2_000,
        },
      }))
      await act(async () => { await vi.advanceTimersByTimeAsync(1_200) })
      expect(historyReads()).toHaveLength(1)
      expect(historyReads()[0]).toMatchObject({
        symbol: 'BTCUSDT', basisOnly: true, views: ['trades'],
      })
    } finally {
      unmount()
      vi.useRealTimers()
    }
  })

  it('coalesces fill bursts into one delayed targeted gap read per contract', async () => {
    const socket = createSocket()
    const historyStore = {
      readContracts: vi.fn(async () => []),
      writeReading: vi.fn(async () => true),
    }
    const { result, unmount } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))
    authorizeAccount(socket)
    await waitFor(() => expect(result.current.historyStoreReady).toBe(true))
    vi.useFakeTimers()
    try {
      const execution = (symbol, tradeId) => ({
        futures_execution_update: {
          symbol,
          positionSide: 'BOTH',
          orderId: `${symbol}-${tradeId}`,
          tradeId,
          status: 'PARTIALLY_FILLED',
          side: 'BUY',
          lastFilledQty: '0.1',
          lastFilledPrice: '100',
          realizedPnl: '0',
          commission: '0.01',
          commissionAsset: 'USDT',
          time: 1_000 + tradeId,
        },
      })
      act(() => {
        socket.receive(execution('BTCUSDT', 1))
        socket.receive(execution('BTCUSDT', 2))
        socket.receive(execution('ETHUSDT', 3))
      })
      const historyReads = () => socket.sent.filter(frame => frame.action === 'account.history')
      expect(historyReads()).toEqual([])
      act(() => { vi.advanceTimersByTime(1_199) })
      expect(historyReads()).toEqual([])
      act(() => { vi.advanceTimersByTime(1) })
      expect(historyReads()).toHaveLength(2)
      expect(historyReads().map(frame => frame.symbol).sort()).toEqual(['BTCUSDT', 'ETHUSDT'])
      for (const frame of historyReads()) {
        expect(frame).toMatchObject({ basisOnly: true, views: ['trades'] })
      }
    } finally {
      unmount()
      vi.useRealTimers()
    }
  })

  it('caps one position key before a stream-only fill until REST absorbs it', () => {
    const fold = vi.spyOn(futuresTradeRounds, 'buildFuturesTradeRoundIndex')
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    authorizeAccount(socket)
    const trade = overrides => ({
      symbol: 'BTCUSDT',
      positionSide: 'BOTH',
      side: 'BUY',
      id: '1',
      orderId: '101',
      quantity: '1',
      price: '100',
      realizedPnl: '0',
      commission: '0',
      commissionAsset: 'USDT',
      marginAsset: 'USDT',
      time: 1_000,
      ...overrides,
    })
    const confirmed = [
      trade({ id: '1', time: 1_000 }),
      trade({ id: '2', side: 'SELL', price: '110', realizedPnl: '10', time: 2_000 }),
      trade({ id: '3', price: '120', time: 3_000 }),
      trade({ id: '4', side: 'SELL', price: '130', realizedPnl: '10', time: 3_500 }),
    ]
    const reading = trades => historyEnvelope({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      views: ['trades'],
      trades,
      orders: [],
      discovered: 1,
      discoveryComplete: true,
      readFrom: { BTCUSDT: { tradeCursor: null } },
      tradeCoverage: {
        BTCUSDT: {
          version: 2,
          targetFrom: 0,
          targetTo: 5_000,
          coveredFrom: 0,
          coveredTo: 5_000,
          complete: true,
          pageLimited: false,
          retentionLimited: false,
          continuityComplete: true,
        },
      },
      error: null,
    })

    act(() => socket.receive(reading(confirmed)))
    fold.mockClear()
    act(() => socket.receive({
      futures_execution_update: {
        symbol: 'BTCUSDT',
        positionSide: 'BOTH',
        side: 'BUY',
        orderId: '105',
        tradeId: '5',
        status: 'FILLED',
        executionType: 'TRADE',
        lastFilledQty: '1',
        lastFilledPrice: '140',
        realizedPnl: '0',
        commission: '0',
        commissionAsset: 'USDT',
        marginAsset: 'USDT',
        time: 4_000,
      },
    }))

    expect(fold.mock.calls.at(-1)[1].coverage['BTCUSDT:BOTH']).toMatchObject({
      coveredFrom: 0,
      coveredTo: 3_999,
      continuityComplete: true,
    })
    expect(result.current.tradeRoundIndex.closed.map(round => round.closeTime)).toContain(3_500)

    fold.mockClear()
    act(() => socket.receive(historyEnvelope({
      ...reading([...confirmed, trade({ id: '5', orderId: '105', price: '140', time: 4_000 })])
        .futures_history,
    }, { readAt: HISTORY_READ_AT + 1 })))

    expect(fold.mock.calls.at(-1)[1].coverage['BTCUSDT:BOTH']).toMatchObject({
      coveredFrom: 0,
      coveredTo: 5_000,
      continuityComplete: true,
    })
  })

  it('projects retention-limited contract coverage to a snapshot-only leg', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    authorizeAccount(socket, {
      positions: {
        status: 'ready',
        data: [{
          symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '1', entryPrice: '100',
        }],
        lastSuccessfulAt: 100,
      },
    })

    act(() => socket.receive(historyEnvelope({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      views: ['trades'],
      trades: [],
      orders: [],
      discovered: 1,
      discoveryComplete: true,
      readFrom: { BTCUSDT: { tradeCursor: null } },
      tradeCoverage: {
        BTCUSDT: {
          version: 2,
          targetFrom: 0,
          targetTo: 5_000,
          coveredFrom: 1_000,
          coveredTo: 5_000,
          complete: false,
          pageLimited: false,
          retentionLimited: true,
          continuityComplete: true,
        },
      },
      error: null,
    })))

    expect(result.current.tradeRoundIndex.byPosition['BTCUSDT:LONG'].coverage)
      .toMatchObject({
        coveredFrom: 1_000,
        coveredTo: 5_000,
        retentionLimited: true,
        sourceVersionCompatible: true,
        sourceGenerationCompatible: true,
        terminalReconciled: false,
      })
    const [missing] = result.current.tradeRoundIndex.unresolved
    expect(missing).toMatchObject({
      positionKey: 'BTCUSDT:LONG',
      reasons: expect.arrayContaining([
        'fill-basis-missing',
        'history-retention-limited',
      ]),
    })
    for (const field of ['realizedPnl', 'fee', 'netPnl', 'fillNetPnl']) {
      expect(missing).not.toHaveProperty(field)
    }
  })

  it('preserves a numeric reverse-flat boundary through the per-key fold projection', () => {
    const fold = vi.spyOn(futuresTradeRounds, 'buildFuturesTradeRoundIndex')
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    authorizeAccount(socket)
    const trade = overrides => ({
      symbol: 'BTCUSDT',
      positionSide: 'BOTH',
      side: 'BUY',
      id: '1',
      orderId: '101',
      quantity: '1',
      price: '100',
      realizedPnl: '0',
      commission: '0',
      commissionAsset: 'USDT',
      marginAsset: 'USDT',
      time: 2_000,
      ...overrides,
    })

    act(() => socket.receive(historyEnvelope({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      views: ['trades'],
      trades: [
        trade({ id: '1', time: 2_000 }),
        trade({
          id: '2', orderId: '102', side: 'SELL', price: '110',
          realizedPnl: '10', time: 3_000,
        }),
      ],
      orders: [],
      discovered: 1,
      discoveryComplete: true,
      readFrom: { BTCUSDT: { tradeCursor: null } },
      tradeCoverage: {
        BTCUSDT: {
          version: 2,
          targetFrom: 0,
          targetTo: 5_000,
          coveredFrom: 1_000,
          coveredTo: 5_000,
          complete: false,
          flatBoundary: 1_000,
          pageLimited: true,
          retentionLimited: false,
          continuityComplete: true,
        },
      },
      error: null,
    })))

    expect(fold.mock.calls.at(-1)[1].coverage['BTCUSDT:BOTH'])
      .toMatchObject({ flatBoundary: 1_000, coveredFrom: 1_000 })
    expect(result.current.tradeRoundIndex.closed).toHaveLength(1)
    expect(result.current.tradeRoundIndex.closed[0]).toMatchObject({
      realizedPnl: 10,
      resolved: true,
    })
  })

  it('folds duplicate execution delivery once and schedules one reconciliation', async () => {
    const socket = createSocket()
    const historyStore = {
      readContracts: vi.fn(async () => []),
      writeReading: vi.fn(async () => true),
    }
    const { result, unmount } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      historyStore,
    }))
    authorizeAccount(socket)
    await waitFor(() => expect(result.current.historyStoreReady).toBe(true))
    act(() => socket.receive(historyEnvelope({
        symbol: 'BTCUSDT',
        orders: [],
        trades: [],
        symbols: ['BTCUSDT'],
        discovered: 1,
        error: null,
    })))
    const report = {
      futures_execution_update: {
        symbol: 'BTCUSDT',
        positionSide: 'BOTH',
        orderId: '9007199254740992',
        tradeId: '9007199254740993',
        status: 'FILLED',
        side: 'SELL',
        origQty: '1',
        executedQty: '1',
        lastFilledQty: '1',
        lastFilledPrice: '110',
        realizedPnl: '10',
        commission: '0.1',
        commissionAsset: 'USDT',
        time: 2_000,
      },
    }

    vi.useFakeTimers()
    try {
      act(() => {
        socket.receive(report)
        socket.receive(report)
      })
      expect(result.current.history.orders).toHaveLength(1)
      expect(result.current.history.trades).toHaveLength(1)
      expect(result.current.history.trades[0]).toMatchObject({
        id: '9007199254740993', orderId: '9007199254740992', realizedPnl: '10',
      })
      act(() => { vi.advanceTimersByTime(1_200) })
      expect(socket.sent.filter(frame => frame.action === 'account.history')).toHaveLength(1)
    } finally {
      unmount()
      vi.useRealTimers()
    }
  })

  it('keeps v2 settled income when legacy or older-generation frames arrive late', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    const v2 = (generation, digest, readAt) => ({
      type: 'futures_settled_income',
      version: 2,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      generation,
      digest,
      rows: [],
      lanes: settledIncomeLanes({
        coveredFrom: 0,
        coveredTo: readAt,
        targetTo: readAt,
        status: 'ready',
        attemptedAt: readAt,
        successfulAt: readAt,
        complete: true,
        error: null,
      }),
      coveredFrom: 0,
      coveredTo: readAt,
      targetTo: readAt,
      readAt,
      attemptedAt: readAt,
      successfulAt: readAt,
      status: 'ready',
      complete: true,
    })

    authorizeAccount(socket)
    act(() => socket.receive(v2(7, 'generation-7', 700)))
    const held = result.current.settledIncome
    expect(held).toMatchObject({ version: 2, generation: 7, digest: 'generation-7' })

    act(() => {
      socket.receive(v2(6, 'late-generation-6', 900))
      socket.receive(v2(7, 'contradictory-generation-7', 1_000))
      socket.receive({
        type: 'futures_settled_income', rows: [], from: 0, readAt: 1_100, complete: true,
      })
    })
    expect(result.current.settledIncome).toBe(held)
    expect(result.current.settledIncome.version).toBe(2)

    act(() => socket.receive(v2(8, 'generation-8', 1_200)))
    expect(result.current.settledIncome).toMatchObject({
      version: 2, generation: 8, digest: 'generation-8',
    })
  })

  it('keeps manual account completion independent from authoritative income failure', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    const accountResources = (lastAttemptAt, status = 'ready') => Object.fromEntries([
      'balances', 'positions', 'regularOrders', 'algoOrders',
    ].map(name => [name, {
      status,
      data: name === 'balances' ? {} : [],
      lastAttemptAt,
      lastSuccessfulAt: status === 'ready' ? lastAttemptAt : 50,
      error: null,
    }]))
    authorizeAccount(socket, accountResources(50))

    act(() => expect(result.current.refresh('BTCUSDT')).toBe(true))
    const request = socket.sent.at(-1).clientOrderId
    expect(socket.sent.at(-1)).toMatchObject({ manual: true })
    expect(result.current.manualRefresh).toMatchObject({
      status: 'sending',
      request,
      account: { terminal: false, status: 'loading' },
      settledIncome: { disposition: 'resource', status: 'idle' },
    })

    act(() => socket.receive({
      type: 'futures_manual_refresh_outcome',
      version: 1,
      status: 'accepted',
      request,
      requestedAt: 110,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      account: { disposition: 'resource' },
      settledIncome: { disposition: 'resource' },
    }))
    expect(result.current.manualRefresh).toMatchObject({
      status: 'accepted',
      account: { terminal: false, status: 'loading' },
    })

    act(() => socket.receive(accountEnvelope(accountResources(110))))
    expect(result.current.manualRefresh.account).toMatchObject({
      terminal: true,
      status: 'ready',
    })

    act(() => socket.receive({
      type: 'futures_settled_income',
      version: 2,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      generation: 1,
      digest: 'manual-income-failed',
      rows: [],
      lanes: settledIncomeLanes({
        coveredFrom: 0,
        coveredTo: 80,
        targetTo: 120,
        status: 'stale',
        attemptedAt: 120,
        successfulAt: 80,
        complete: false,
        error: { code: 'FUTURES_RATE_LIMITED', message: 'Retry later.' },
      }),
      coveredFrom: 0,
      coveredTo: 80,
      targetTo: 120,
      readAt: 120,
      attemptedAt: 120,
      successfulAt: 80,
      status: 'stale',
      complete: false,
      error: { code: 'FUTURES_RATE_LIMITED', message: 'Retry later.' },
    }))
    expect(result.current.manualRefresh).toMatchObject({
      account: { terminal: true, status: 'ready' },
      settledIncome: {
        disposition: 'resource',
        status: 'stale',
        successfulAt: 80,
        error: { code: 'FUTURES_RATE_LIMITED' },
      },
    })

    // A second accepted receipt cannot reuse the first pass's terminal state.
    act(() => socket.receive({
      type: 'futures_manual_refresh_outcome',
      version: 1,
      status: 'accepted',
      request: 'manual-refresh-queued',
      requestedAt: 200,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      account: { disposition: 'resource' },
      settledIncome: { disposition: 'resource' },
    }))
    expect(result.current.manualRefresh).toMatchObject({
      request: 'manual-refresh-queued',
      account: { terminal: false, status: 'loading' },
      settledIncome: { status: 'stale' },
    })
    act(() => socket.receive(accountEnvelope(accountResources(200))))
    expect(result.current.manualRefresh).toMatchObject({
      account: { terminal: true, status: 'ready' },
      settledIncome: { status: 'stale' },
    })
  })

  it('retains confirmed settled income when a newer IPC frame loses lane evidence', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    const funding = {
      symbol: 'BTCUSDT',
      incomeType: 'FUNDING_FEE',
      income: '-1.25',
      asset: 'USDT',
      time: 2_000,
      tranId: '101',
      tradeId: null,
    }
    const frame = (generation, rows, aggregateRows = rows) => ({
      type: 'futures_settled_income',
      version: 2,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      generation,
      digest: `renderer-seam-${generation}`,
      lanes: settledIncomeLanes({
        rows,
        coveredFrom: 1_000,
        coveredTo: 5_000,
        targetTo: 5_000,
        status: 'ready',
        attemptedAt: 5_000,
        successfulAt: 5_000,
        complete: true,
        error: null,
      }),
      rows: aggregateRows,
      coveredFrom: 1_000,
      coveredTo: 5_000,
      targetTo: 5_000,
      readAt: 5_000,
      attemptedAt: 5_000,
      successfulAt: 5_000,
      status: 'ready',
      complete: true,
    })

    authorizeAccount(socket)
    act(() => socket.receive(frame(1, [funding])))
    const held = result.current.settledIncome
    expect(held).toMatchObject({ generation: 1, complete: true, rows: [funding] })

    const conflict = { ...funding, income: '-99.00' }
    act(() => socket.receive(frame(2, [funding, conflict])))
    expect(result.current.settledIncome).toBe(held)

    const aggregateOnly = { ...funding, tranId: '102', income: '-50.00' }
    act(() => socket.receive(frame(3, [funding], [funding, aggregateOnly])))
    expect(result.current.settledIncome).toBe(held)
    expect(result.current.settledIncome.rows).toHaveLength(1)

    const incomplete = frame(4, [funding])
    delete incomplete.lanes.FEE_RETURN
    act(() => socket.receive(incomplete))
    expect(result.current.settledIncome).toBe(held)

    const lossyRows = [
      { ...funding, symbol: ' BTCUSDT' },
      { ...funding, symbol: 'btcusdt' },
      { ...funding, symbol: 'BTCU\u017FDT' },
      { ...funding, incomeType: ' FUNDING_FEE' },
      { ...funding, incomeType: 'funding_fee' },
      { ...funding, incomeType: '\u0131NSURANCE_CLEAR' },
      { ...funding, asset: ' USDT' },
      { ...funding, asset: 'usdt' },
      { ...funding, asset: 'U\u017FDT' },
      { ...funding, tranId: 'not-an-integer' },
      { ...funding, tradeId: '42.5' },
    ]
    for (const [index, lossyRow] of lossyRows.entries()) {
      act(() => socket.receive(frame(5 + index, [lossyRow])))
      expect(result.current.settledIncome).toBe(held)
    }
  })

  it('admits a settled snapshot only after matching account authority arrives', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    const snapshot = {
      type: 'futures_settled_income',
      version: 2,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      generation: 1,
      digest: 'joining-renderer-snapshot',
      rows: [],
      lanes: settledIncomeLanes({
        coveredFrom: 0,
        coveredTo: HISTORY_READ_AT,
        targetTo: HISTORY_READ_AT,
        status: 'ready',
        attemptedAt: HISTORY_READ_AT,
        successfulAt: HISTORY_READ_AT,
        complete: true,
        error: null,
      }),
      coveredFrom: 0,
      coveredTo: HISTORY_READ_AT,
      targetTo: HISTORY_READ_AT,
      readAt: HISTORY_READ_AT,
      attemptedAt: HISTORY_READ_AT,
      successfulAt: HISTORY_READ_AT,
      status: 'ready',
      complete: true,
    }

    act(() => socket.receive(snapshot))
    expect(result.current.settledIncome).toBeNull()

    act(() => {
      socket.receive(accountEnvelope())
      socket.receive(snapshot)
    })
    expect(result.current).toMatchObject({
      accountFingerprint: ACCOUNT_FINGERPRINT,
      settledIncome: {
        accountFingerprint: ACCOUNT_FINGERPRINT,
        digest: 'joining-renderer-snapshot',
      },
    })
  })

  it('keeps a complete BNB-only closed wallet exact without relabelling or refolding fills', () => {
    const baseRound = Object.freeze({
      key: 'bnb-closed-round',
      symbol: 'BTCUSDT',
      positionKey: 'BTCUSDT:BOTH',
      leg: 'BOTH',
      positionSide: 'LONG',
      fillIds: ['bnb-fill'],
      openTime: 1_000,
      closeTime: 2_000,
      open: false,
      partial: false,
      resolved: true,
      settlementAsset: 'USDT',
      exitPrice: 101,
      realizedPnl: 0,
      realizedPnlExact: '0',
      feesByAsset: [{ asset: 'BNB', amount: '0.003' }],
      tradeCoverage: true,
      commissionCoverage: true,
      // A sentinel legacy value proves the selector follows the exact ledger
      // amount without relabelling its BNB denomination as settlement USDT.
      netPnl: 42,
    })
    const fold = vi.spyOn(futuresTradeRounds, 'buildFuturesTradeRoundIndex')
      .mockReturnValue(Object.freeze({
        version: 2,
        rounds: Object.freeze([baseRound]),
        all: Object.freeze([baseRound]),
        open: Object.freeze([]),
        closed: Object.freeze([baseRound]),
        unresolved: Object.freeze([]),
        byPosition: Object.freeze({}),
        legacyRounds: Object.freeze([baseRound]),
      }))
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    authorizeAccount(socket)
    fold.mockClear()

    const settledFrame = (generation, status) => ({
      type: 'futures_settled_income',
      version: 2,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      generation,
      digest: `same-money-${generation}`,
      rows: [],
      lanes: Object.fromEntries([
        'FUNDING_FEE',
        'INSURANCE_CLEAR',
        'COMMISSION_REBATE',
        'REFERRAL_KICKBACK',
        'API_REBATE',
        'FEE_RETURN',
      ].map(incomeType => [incomeType, {
        incomeType,
        rows: [],
        coveredFrom: 0,
        coveredTo: 5_000,
        targetTo: 5_000,
        status,
        attemptedAt: generation,
        successfulAt: generation,
        complete: status === 'ready',
        error: null,
      }])),
      coveredFrom: 0,
      coveredTo: 5_000,
      targetTo: 5_000,
      readAt: generation,
      attemptedAt: generation,
      successfulAt: generation,
      status,
      complete: status === 'ready',
      error: null,
    })

    act(() => socket.receive(settledFrame(1, 'ready')))

    const round = result.current.tradeRoundIndex.closed[0]
    expect(round.wallet.walletNet).toEqual({ asset: 'BNB', amount: '-0.003' })
    expect(round).toMatchObject({
      settlementAsset: 'USDT',
      netExact: true,
      netPnlText: '-0.003',
      netPnl: -0.003,
    })
    expect(fold).not.toHaveBeenCalled()

    // Only resource metadata changes. Reconciliation may update its
    // qualification, but the O(fills) round fold has no income dependency.
    act(() => socket.receive(settledFrame(2, 'stale')))
    expect(result.current.settledIncome).toMatchObject({ generation: 2, status: 'stale' })
    expect(fold).not.toHaveBeenCalled()
  })

  it('reuses wallet identities for observation-only frames and keeps the window on unrelated state', () => {
    const baseRound = Object.freeze({
      key: 'stable-open-round',
      symbol: 'BTCUSDT',
      positionKey: 'BTCUSDT:LONG',
      leg: 'LONG',
      positionSide: 'LONG',
      fillIds: ['stable-fill'],
      openTime: 1_000,
      closeTime: 2_000,
      open: true,
      partial: false,
      resolved: true,
      settlementAsset: 'USDT',
      exitPrice: null,
      realizedPnl: '2',
      feesByAsset: [],
      tradeCoverage: true,
      commissionCoverage: true,
      netPnl: 2,
    })
    vi.spyOn(futuresTradeRounds, 'buildFuturesTradeRoundIndex')
      .mockReturnValue(Object.freeze({
        version: 2,
        rounds: Object.freeze([baseRound]),
        all: Object.freeze([baseRound]),
        open: Object.freeze([baseRound]),
        closed: Object.freeze([]),
        unresolved: Object.freeze([]),
        byPosition: Object.freeze({}),
        legacyRounds: Object.freeze([baseRound]),
      }))
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    authorizeAccount(socket)

    const observedFrame = observedAt => ({
      type: 'futures_settled_income',
      version: 2,
      accountFingerprint: ACCOUNT_FINGERPRINT,
      generation: 4,
      digest: 'stable-content-revision',
      rows: [],
      lanes: settledIncomeLanes({
        coveredFrom: 0,
        coveredTo: 5_000,
        targetTo: 5_000,
        status: 'ready',
        attemptedAt: observedAt,
        successfulAt: observedAt,
        complete: true,
        error: null,
      }),
      coveredFrom: 0,
      coveredTo: 5_000,
      targetTo: 5_000,
      readAt: observedAt,
      attemptedAt: observedAt,
      successfulAt: observedAt,
      status: 'ready',
      complete: true,
      error: null,
    })

    act(() => socket.receive(observedFrame(100)))
    const firstIncome = result.current.settledIncome
    const firstWindow = result.current.settledIncomeWindow
    const firstIndex = result.current.tradeRoundIndex
    const firstLedger = firstIndex.walletLedger
    const firstOpenRound = firstIndex.open[0]
    const firstSettledMoney = result.current.settledMoney
    const firstSettledReading = firstSettledMoney['BTCUSDT:LONG']

    act(() => socket.receive(observedFrame(200)))
    expect(result.current.settledIncome).not.toBe(firstIncome)
    expect(result.current.settledIncome.readAt).toBe(200)
    expect(result.current.settledIncomeWindow).not.toBe(firstWindow)
    expect(result.current.settledIncomeWindow.readAt).toBe(200)
    expect(result.current.tradeRoundIndex).toBe(firstIndex)
    expect(result.current.tradeRoundIndex.walletLedger).toBe(firstLedger)
    expect(result.current.tradeRoundIndex.open[0]).toBe(firstOpenRound)
    expect(result.current.settledMoney).toBe(firstSettledMoney)
    expect(result.current.settledMoney['BTCUSDT:LONG']).toBe(firstSettledReading)

    const observedIncome = result.current.settledIncome
    const observedWindow = result.current.settledIncomeWindow
    act(() => socket.receive(observedFrame(200)))
    expect(result.current.settledIncome).toBe(observedIncome)
    expect(result.current.settledIncomeWindow).toBe(observedWindow)

    act(() => socket.receive(accountEnvelope({
      balances: {
        status: 'ready',
        data: { USDT: { available: '90', total: '100' } },
        lastAttemptAt: 300,
        lastSuccessfulAt: 300,
      },
    })))
    expect(result.current.balances.USDT.available).toBe('90')
    expect(result.current.settledIncomeWindow).toBe(observedWindow)
    expect(result.current.tradeRoundIndex).toBe(firstIndex)
    expect(result.current.settledMoney).toBe(firstSettledMoney)
  })

  it('does not refold fills when an account refresh changes only position valuation', () => {
    const fold = vi.spyOn(futuresTradeRounds, 'buildFuturesTradeRoundIndex')
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    const positionFrame = overrides => accountEnvelope({
      positions: {
        status: 'ready',
        lastSuccessfulAt: 100,
        data: [{
          symbol: 'BTCUSDT',
          positionSide: 'BOTH',
          quantity: '1',
          entryPrice: '100',
          markPrice: '101',
          unrealizedPnl: '1',
          isolatedMargin: '10',
          ...overrides,
        }],
      },
    })

    act(() => socket.receive(positionFrame()))
    const beforeValuation = result.current.tradeRoundIndex
    fold.mockClear()

    act(() => socket.receive(positionFrame({
      markPrice: '102',
      unrealizedPnl: '2',
      isolatedMargin: '11',
    })))
    expect(result.current.positions[0]).toMatchObject({
      markPrice: '102',
      unrealizedPnl: '2',
      isolatedMargin: '11',
    })
    expect(result.current.tradeRoundIndex).toBe(beforeValuation)
    expect(fold).not.toHaveBeenCalled()

    act(() => socket.receive(positionFrame({ quantity: '2' })))
    expect(fold).toHaveBeenCalledTimes(1)
    fold.mockClear()

    act(() => socket.receive(positionFrame({ quantity: '2', entryPrice: '101' })))
    expect(fold).toHaveBeenCalledTimes(1)
  })

  it('keeps round and wallet identities through order-only history', () => {
    const fold = vi.spyOn(futuresTradeRounds, 'buildFuturesTradeRoundIndex')
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    authorizeAccount(socket)
    const tradeReading = readAt => historyEnvelope({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      views: ['trades'],
      basisOnly: true,
      orders: [],
      trades: [],
      tradeCoverage: {
        BTCUSDT: {
          version: 2,
          targetFrom: 0,
          targetTo: readAt,
          coveredFrom: 0,
          coveredTo: readAt,
          complete: true,
          pageLimited: false,
          retentionLimited: false,
          continuityComplete: true,
        },
      },
      error: null,
    }, { readAt })

    act(() => socket.receive(tradeReading(HISTORY_READ_AT)))
    const firstIndex = result.current.tradeRoundIndex
    const firstLedger = firstIndex.walletLedger
    const firstTradeGeneration = result.current.history.tradeGeneration
    fold.mockClear()

    act(() => socket.receive(historyEnvelope({
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      views: ['orders'],
      basisOnly: true,
      orders: [{ symbol: 'BTCUSDT', orderId: '2', status: 'FILLED', time: 2_000 }],
      trades: [],
      error: null,
    }, { readAt: HISTORY_READ_AT + 1 })))

    expect(result.current.history.orders.map(order => order.orderId)).toEqual(['2'])
    expect(result.current.history.tradeGeneration).toBe(firstTradeGeneration)
    expect(result.current.tradeRoundIndex).toBe(firstIndex)
    expect(result.current.tradeRoundIndex.walletLedger).toBe(firstLedger)
    expect(fold).not.toHaveBeenCalled()

    act(() => socket.receive(tradeReading(HISTORY_READ_AT + 2)))
    const afterTradeRead = result.current.tradeRoundIndex
    expect(result.current.history.tradeGeneration).toBe(firstTradeGeneration + 1)
    expect(afterTradeRead).not.toBe(firstIndex)
    expect(fold).toHaveBeenCalledTimes(1)
    fold.mockClear()

    act(() => socket.receive({
      futures_execution_update: {
        symbol: 'BTCUSDT',
        positionSide: 'BOTH',
        side: 'BUY',
        orderId: '3',
        tradeId: '3',
        status: 'FILLED',
        executionType: 'TRADE',
        lastFilledQty: '1',
        lastFilledPrice: '100',
        realizedPnl: '0',
        commission: '0',
        commissionAsset: 'USDT',
        marginAsset: 'USDT',
        time: HISTORY_READ_AT + 3,
      },
    }))
    expect(result.current.history.tradeGeneration).toBe(firstTradeGeneration + 2)
    expect(result.current.tradeRoundIndex).not.toBe(afterTradeRead)
    expect(fold).toHaveBeenCalledTimes(1)
  })

  it('preserves round and wallet identities when the exchange only reorders positions', () => {
    const fold = vi.spyOn(futuresTradeRounds, 'buildFuturesTradeRoundIndex')
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    const btc = {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      quantity: '1',
      entryPrice: '100',
      markPrice: '101',
    }
    const eth = {
      symbol: 'ETHUSDT',
      positionSide: 'SHORT',
      quantity: '-2',
      entryPrice: '200',
      markPrice: '199',
    }
    const positionFrame = data => accountEnvelope({
      positions: { status: 'ready', data, lastSuccessfulAt: 100 },
    })

    act(() => socket.receive(positionFrame([btc, eth])))
    const firstIndex = result.current.tradeRoundIndex
    const firstLedger = firstIndex.walletLedger
    fold.mockClear()

    act(() => socket.receive(positionFrame([eth, btc])))
    expect(result.current.tradeRoundIndex).toBe(firstIndex)
    expect(result.current.tradeRoundIndex.walletLedger).toBe(firstLedger)
    expect(fold).not.toHaveBeenCalled()
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

  // A leverage and a margin mode held for an activation that is over are a
  // memory, not a reading. The backend forgets its own when the market is left
  // or the credentials change; the renderer merged for ever, so a contract's
  // mode from a previous account could still be on screen — the one field the
  // exchange announces on no stream, and the one an operator sizes against.
  it('drops the configurations it holds when the market activation changes', () => {
    const socket = createSocket()
    const { result, rerender } = renderHook(
      ({ generation }) => useFuturesTrading({
        enabled: true,
        symbol: 'BTCUSDT',
        wsConnection: socket,
        marketGeneration: generation,
      }),
      { initialProps: { generation: 7 } },
    )

    act(() => socket.receive({
      futures_symbol_configs: {
        BTCUSDT: { symbol: 'BTCUSDT', leverage: 20, maxLeverage: 125, marginType: 'CROSSED' },
      },
    }))
    expect(result.current.symbolConfigs.BTCUSDT.marginType).toBe('CROSSED')

    rerender({ generation: 8 })
    expect(result.current.symbolConfigs).toEqual({})

    // And the next activation's own reading lands normally.
    act(() => socket.receive({
      futures_symbol_configs: {
        BTCUSDT: { symbol: 'BTCUSDT', leverage: 3, maxLeverage: 125, marginType: 'ISOLATED' },
      },
    }))
    expect(result.current.symbolConfigs.BTCUSDT).toMatchObject({
      leverage: 3,
      marginType: 'ISOLATED',
    })
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
      expect(refreshesIn(socket).at(-1)).not.toHaveProperty('manual')
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

  it('derives close direction from an explicit hedge leg before quantity sign', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => {
      result.current.closePosition({
        symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '0.02',
      })
      result.current.closePosition({
        symbol: 'ETHUSDT', positionSide: 'LONG', quantity: '-0.03',
      })
      result.current.closePosition({
        symbol: 'SOLUSDT', positionSide: 'BOTH', quantity: '-2',
      })
      result.current.closePosition({
        symbol: 'BNBUSDT', positionSide: 'BOTH', quantity: '3',
      })
    })

    expect(socket.sent.slice(1)).toEqual([
      expect.objectContaining({ symbol: 'BTCUSDT', positionSide: 'SHORT', side: 'BUY', quantity: '0.02' }),
      expect.objectContaining({ symbol: 'ETHUSDT', positionSide: 'LONG', side: 'SELL', quantity: '0.03' }),
      expect.objectContaining({ symbol: 'SOLUSDT', positionSide: 'BOTH', side: 'BUY', quantity: '2' }),
      expect.objectContaining({ symbol: 'BNBUSDT', positionSide: 'BOTH', side: 'SELL', quantity: '3' }),
    ])
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

    act(() => socket.receive({
      type: 'futures_position_marks',
      version: 1,
      revision: 1,
      marks: { BTCUSDT: { markPrice: '60000', updatedAt: 100 } },
    }))
    expect(result.current.positionMarkStore.get('BTCUSDT')?.markPrice).toBe('60000')

    act(() => {
      socket.dropConnection()
    })
    expect(result.current.connected).toBe(false)
    expect(result.current.positionMarkStore.get('BTCUSDT')).toBeNull()

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
  const subscribe = (socket) => {
    const rendered = renderHook(() => useFuturesTrading({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    authorizeAccount(socket)
    return rendered
  }

  const readingArrives = (socket) => {
    act(() => {
      socket.receive(historyEnvelope({
          symbol: 'BTCUSDT',
          orders: [{ symbol: 'BTCUSDT', orderId: 1, status: 'FILLED', time: 1_000 }],
          trades: [{ symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5', time: 1_000 }],
          symbols: ['BTCUSDT'],
          discovered: 1,
          error: null,
      }))
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
      socket.receive(historyEnvelope({
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
      }, { readAt: HISTORY_READ_AT + 1 }))
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
