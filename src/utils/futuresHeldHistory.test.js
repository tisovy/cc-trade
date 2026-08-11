import { describe, expect, it } from 'vitest'
import {
  FUTURES_HELD_HISTORY_MAX_ORDERS_PER_CONTRACT,
  FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT,
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

  it('merges a cursor gap without replacing older rows or untouched coverage', () => {
    const first = applyFuturesHistoryReading(createHeldFuturesHistory(), {
      ...READING,
      orders: [
        { symbol: 'BTCUSDT', orderId: '9007199254740993', status: 'FILLED', time: 1_000 },
        { symbol: 'ETHUSDT', orderId: '2', status: 'FILLED', time: 900 },
      ],
      trades: [
        { symbol: 'BTCUSDT', id: '7', realizedPnl: '12.5', time: 1_000 },
        { symbol: 'BTCUSDT', id: '8', realizedPnl: '2.5', time: 1_100 },
      ],
      symbols: ['BTCUSDT', 'ETHUSDT'],
    }, 5_000)

    const gap = applyFuturesHistoryReading(first, {
      symbol: 'BTCUSDT',
      symbols: ['BTCUSDT'],
      orders: [
        { symbol: 'BTCUSDT', orderId: '9007199254740993', status: 'FILLED', time: 1_000 },
        { symbol: 'BTCUSDT', orderId: '9007199254740995', status: 'FILLED', time: 2_000 },
      ],
      // This endpoint had no cursor, so its full answer replaces BTC trades.
      trades: [{ symbol: 'BTCUSDT', id: '9', realizedPnl: '3.5', time: 2_000 }],
      readFrom: {
        BTCUSDT: { orderCursor: '9007199254740993', tradeCursor: null },
      },
      discovered: 2,
      error: null,
    }, 12_000)

    expect(gap.orders.map(row => row.orderId)).toEqual([
      '9007199254740995', '9007199254740993', '2',
    ])
    expect(gap.trades.map(row => row.id)).toEqual(['9'])
    expect(gap.coverage.BTCUSDT).toEqual({
      readAt: 12_000,
      orderCursor: '9007199254740995',
      tradeCursor: '9',
    })
    expect(gap.coverage.ETHUSDT.readAt).toBe(5_000)
    expect(gap.readAt).toBe(5_000)
  })

  it('bounds REST rows and stream folds per contract for the whole session', () => {
    const orders = Array.from(
      { length: FUTURES_HELD_HISTORY_MAX_ORDERS_PER_CONTRACT },
      (_, index) => ({
        symbol: 'BTCUSDT', orderId: index + 1, status: 'FILLED', time: index + 1,
      }),
    )
    const trades = Array.from(
      { length: FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT },
      (_, index) => ({
        symbol: 'BTCUSDT', id: index + 1, realizedPnl: '1', time: index + 1,
      }),
    )
    const first = applyFuturesHistoryReading(createHeldFuturesHistory(), {
      symbol: 'BTCUSDT', symbols: ['BTCUSDT'], orders, trades, error: null,
    }, 5_000)
    const next = foldExecutionIntoFuturesHistory(first, fill({
      orderId: FUTURES_HELD_HISTORY_MAX_ORDERS_PER_CONTRACT + 1,
      tradeId: FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT + 1,
      time: 9_000,
    }))

    expect(next.orders).toHaveLength(FUTURES_HELD_HISTORY_MAX_ORDERS_PER_CONTRACT)
    expect(next.trades).toHaveLength(FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT)
    expect(next.orders.at(-1).orderId).toBe(2)
    expect(next.trades.at(-1).id).toBe(2)
    expect(next.foldedOrders).toContain('BTCUSDT:201')
    expect(next.foldedTrades).toContain('BTCUSDT:1001')
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

  // The account read is a fan-out over a bounded, discovered set of contracts,
  // and any of them can drop out of it: a failure on that contract, a discovery
  // that ran short, a contract that no longer holds a position to seed it. What
  // it read stands; what it did not look at is not thereby untrue. A position
  // closed an hour ago used to disappear from the closed-position list the
  // moment a later read stopped covering the contract it was on.
  it('replaces only the contracts the read covered', () => {
    const first = applyFuturesHistoryReading(createHeldFuturesHistory(), {
      ...READING,
      orders: [
        { symbol: 'BTCUSDT', orderId: 1, status: 'FILLED', time: 1_000 },
        { symbol: 'BEATUSDT', orderId: 5, status: 'FILLED', time: 2_000 },
      ],
      trades: [
        { symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5', time: 1_000 },
        { symbol: 'BEATUSDT', id: 9, realizedPnl: '-44.1', time: 2_000 },
      ],
      symbols: ['BTCUSDT', 'BEATUSDT'],
      discovered: 2,
    }, 5_000)

    // The next read reaches BTC only — BEAT failed, or fell out of the twelve.
    const narrower = applyFuturesHistoryReading(first, {
      ...READING,
      orders: [{ symbol: 'BTCUSDT', orderId: 1, status: 'FILLED', time: 1_000 }],
      trades: [{ symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5', time: 1_000 }],
      symbols: ['BTCUSDT'],
      discovered: 1,
    }, 12_000)

    expect(narrower.trades.map(trade => trade.symbol)).toEqual(['BEATUSDT', 'BTCUSDT'])
    expect(narrower.orders.map(order => order.symbol)).toEqual(['BEATUSDT', 'BTCUSDT'])
    // Carried rows were read, so they widen the scope statement and are not
    // counted among what the stream added since.
    expect(narrower.symbols).toEqual(['BTCUSDT', 'BEATUSDT'])
    expect(narrower.discovered).toBe(2)
    expect(narrower.foldedTrades).toEqual([])
  })

  // A read that did cover the contract is still the authority on it: a row it
  // dropped is a row the exchange no longer reports, not one to hold on to.
  it('drops a row the read covered and did not return', () => {
    const first = applyFuturesHistoryReading(createHeldFuturesHistory(), {
      ...READING,
      trades: [
        { symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5', time: 1_000 },
        { symbol: 'BTCUSDT', id: 8, realizedPnl: '1.0', time: 2_000 },
      ],
      symbols: ['BTCUSDT'],
    }, 5_000)
    const again = applyFuturesHistoryReading(first, {
      ...READING,
      trades: [{ symbol: 'BTCUSDT', id: 7, realizedPnl: '12.5', time: 1_000 }],
      symbols: ['BTCUSDT'],
    }, 12_000)

    expect(again.trades.map(trade => trade.id)).toEqual([7])
  })
})
