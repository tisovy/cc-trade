import { describe, expect, it } from 'vitest'
import {
  applyFuturesHistoryReading,
  beginFuturesHistoryRead,
  createHeldFuturesHistory,
  foldExecutionIntoFuturesHistory,
} from './futuresHeldHistory.js'

const READING = Object.freeze({
  symbol: 'BTCUSDT',
  orders: [Object.freeze({ symbol: 'BTCUSDT', orderId: 1, status: 'FILLED', time: 1_000 })],
  trades: [Object.freeze({ symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5', time: 1_000 })],
  symbols: ['BTCUSDT', 'ETHUSDT'],
  discovered: 4,
  error: null,
})

const held = () => applyFuturesHistoryReading(createHeldFuturesHistory(), READING, 5_000)

const fill = (overrides = {}) => ({
  symbol: 'BTCUSDT',
  orderId: 2,
  status: 'FILLED',
  side: 'SELL',
  origQty: '0.004',
  executedQty: '0.004',
  price: '58500',
  tradeId: 8,
  lastFilledQty: '0.004',
  lastFilledPrice: '58500',
  realizedPnl: '31.2',
  commission: '0.02',
  time: 9_000,
  ...overrides,
})

describe('futuresHeldHistory', () => {
  it('has nothing to hold until something is read', () => {
    const empty = createHeldFuturesHistory()
    expect(empty.readAt).toBeNull()
    expect(foldExecutionIntoFuturesHistory(empty, fill())).toBe(empty)
  })

  it('carries the time the reading was taken', () => {
    expect(held()).toMatchObject({ status: 'ready', readAt: 5_000, discovered: 4 })
  })

  // Emptying the rows makes the operator wait a second time for what they were
  // already reading — the whole reason a tab click cost a fan-out.
  it('keeps the held rows while a read is in flight and when it fails', () => {
    const refreshing = beginFuturesHistoryRead(held(), { symbol: 'BTCUSDT', sent: true })
    expect(refreshing.status).toBe('refreshing')
    expect(refreshing.orders).toHaveLength(1)

    const failed = applyFuturesHistoryReading(refreshing, {
      symbol: 'BTCUSDT',
      error: { code: 'FUTURES_API_ERROR', message: 'refused' },
    }, 9_999)
    expect(failed.status).toBe('ready')
    expect(failed.orders).toHaveLength(1)
    expect(failed.error).toMatchObject({ code: 'FUTURES_API_ERROR' })
    // The reading is still the one that was taken, not the one that failed.
    expect(failed.readAt).toBe(5_000)
  })

  it('states a failure as a failure when nothing has ever been read', () => {
    const first = beginFuturesHistoryRead(createHeldFuturesHistory(), { symbol: 'BTCUSDT', sent: true })
    expect(first.status).toBe('loading')
    const failed = applyFuturesHistoryReading(first, { error: { code: 'X' } }, 1)
    expect(failed.status).toBe('error')
  })

  it('says so rather than pretending a frame left when it did not', () => {
    const unsent = beginFuturesHistoryRead(held(), { symbol: 'BTCUSDT', sent: false })
    expect(unsent.status).toBe('ready')
    expect(unsent.error).toMatchObject({ code: 'LOCAL_CONNECTION_UNAVAILABLE' })
    expect(unsent.orders).toHaveLength(1)
  })

  it('folds a settled order and its fill into the held reading', () => {
    const next = foldExecutionIntoFuturesHistory(held(), fill())
    expect(next.orders).toHaveLength(2)
    expect(next.trades).toHaveLength(2)
    // Newest first, like every other history table on the desk.
    expect(next.orders[0]).toMatchObject({ orderId: 2, status: 'FILLED' })
    expect(next.trades[0]).toMatchObject({ id: 8, realizedPnl: '31.2', price: '58500' })
    expect(next.foldedOrders).toEqual(['BTCUSDT:2'])
    expect(next.foldedTrades).toEqual(['BTCUSDT:8'])
  })

  it('folds nothing from an order that is still working', () => {
    const next = foldExecutionIntoFuturesHistory(held(), fill({
      status: 'NEW', tradeId: null, lastFilledQty: '0',
    }))
    expect(next.orders).toHaveLength(1)
    expect(next.trades).toHaveLength(1)
  })

  it('replaces rather than repeats when the same order reports twice', () => {
    const once = foldExecutionIntoFuturesHistory(held(), fill({ status: 'PARTIALLY_FILLED' }))
    const twice = foldExecutionIntoFuturesHistory(once, fill())
    expect(twice.orders.filter(order => order.orderId === 2)).toHaveLength(1)
    expect(twice.trades.filter(trade => trade.id === 8)).toHaveLength(1)
  })

  // The read is the authority on what it covered. A folded entry the read also
  // returned is the read's row; one it did not cover survives, and is counted
  // separately so the scope statement never claims a read that did not happen.
  it('does not duplicate a folded entry that the next read returns', () => {
    const folded = foldExecutionIntoFuturesHistory(held(), fill())
    const reread = applyFuturesHistoryReading(folded, {
      ...READING,
      orders: [
        { symbol: 'BTCUSDT', orderId: 1, status: 'FILLED', time: 1_000 },
        { symbol: 'BTCUSDT', orderId: 2, status: 'FILLED', time: 9_000, executedQty: '0.004' },
      ],
      trades: [
        { symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5', time: 1_000 },
        { symbol: 'BTCUSDT', id: 8, realizedPnl: '31.2', time: 9_000 },
      ],
    }, 12_000)

    expect(reread.orders).toHaveLength(2)
    expect(reread.trades).toHaveLength(2)
    expect(reread.foldedOrders).toEqual([])
    expect(reread.foldedTrades).toEqual([])
    expect(reread.readAt).toBe(12_000)
  })

  it('keeps a folded entry the next read did not cover, and counts it apart', () => {
    const folded = foldExecutionIntoFuturesHistory(held(), fill({ symbol: 'SOLUSDT' }))
    const reread = applyFuturesHistoryReading(folded, READING, 12_000)

    expect(reread.orders).toHaveLength(2)
    expect(reread.foldedOrders).toEqual(['SOLUSDT:2'])
    // The read covered what it covered: a folded row never widens that claim.
    expect(reread.symbols).toEqual(['BTCUSDT', 'ETHUSDT'])
    expect(reread.discovered).toBe(4)
  })
})
