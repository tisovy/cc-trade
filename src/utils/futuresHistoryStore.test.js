import { describe, expect, it } from 'vitest'
import {
  FUTURES_HISTORY_STORE_MAX_CONTRACTS,
  FUTURES_HISTORY_STORE_MAX_ORDERS,
  FUTURES_HISTORY_STORE_MAX_TRADES,
  boundFuturesHistoryContracts,
  createFuturesHistoryStore,
  mergeFuturesHistoryContract,
  restoreFuturesHistoryFromStore,
  splitFuturesHistoryReading,
} from './futuresHistoryStore.js'

const READ_AT = 1_784_000_000_000

const order = (orderId, {
  symbol = 'BTCUSDT',
  status = 'FILLED',
  time = READ_AT,
} = {}) => ({
  orderId,
  clientOrderId: `c-${orderId}`,
  symbol,
  side: 'BUY',
  positionSide: 'BOTH',
  type: 'LIMIT',
  status,
  price: '58400',
  averagePrice: '58400',
  origQty: '0.010',
  executedQty: '0.010',
  quoteQty: '584',
  reduceOnly: false,
  time,
})

const trade = (id, { symbol = 'BTCUSDT', time = READ_AT } = {}) => ({
  id,
  orderId: id * 10,
  symbol,
  side: 'BUY',
  positionSide: 'BOTH',
  price: '58400',
  quantity: '0.010',
  quoteQty: '584',
  realizedPnl: '1.25',
  commission: '0.02',
  commissionAsset: 'USDT',
  maker: false,
  time,
})

const createMemoryStore = (seed = []) => {
  const records = new Map(seed.map(record => [record.key ?? record.symbol, record]))
  return {
    records,
    store: createFuturesHistoryStore({
      readAll: async () => [...records.values()],
      write: async record => records.set(record.key, record),
      remove: async key => records.delete(key),
    }),
  }
}

describe('mergeFuturesHistoryContract', () => {
  it('stores only rows the exchange has settled', () => {
    const merged = mergeFuturesHistoryContract(null, {
      symbol: 'BTCUSDT',
      orders: [
        order(5, { status: 'FILLED' }),
        order(6, { status: 'NEW' }),
        order(7, { status: 'PARTIALLY_FILLED' }),
        order(8, { status: 'CANCELED' }),
      ],
      trades: [trade(1)],
      readAt: READ_AT,
    })
    expect([...merged.orders.map(row => row.orderId)].sort()).toEqual([5, 8])
    expect(merged.trades.map(row => row.id)).toEqual([1])
  })

  it('states what the contract is covered up to', () => {
    const merged = mergeFuturesHistoryContract(null, {
      symbol: 'btcusdt',
      orders: [order(11), order(4), order(9)],
      trades: [trade(31), trade(12)],
      readAt: READ_AT,
    })
    expect(merged).toMatchObject({
      key: 'BTCUSDT',
      symbol: 'BTCUSDT',
      orderCursor: '11',
      tradeCursor: '31',
      readAt: READ_AT,
    })
  })

  it('carries identities past what a double can count', () => {
    const huge = '9223372036854775807'
    const merged = mergeFuturesHistoryContract(null, {
      symbol: 'BTCUSDT',
      orders: [order(huge), order('9223372036854775806')],
      trades: [],
      readAt: READ_AT,
    })
    expect(merged.orderCursor).toBe(huge)
  })

  it('keeps the newest rows within the bound', () => {
    const orders = Array.from({ length: FUTURES_HISTORY_STORE_MAX_ORDERS + 40 }, (_, index) => (
      order(index + 1, { time: READ_AT + index })
    ))
    const trades = Array.from({ length: FUTURES_HISTORY_STORE_MAX_TRADES + 40 }, (_, index) => (
      trade(index + 1, { time: READ_AT + index })
    ))
    const merged = mergeFuturesHistoryContract(null, {
      symbol: 'BTCUSDT', orders, trades, readAt: READ_AT,
    })
    expect(merged.orders).toHaveLength(FUTURES_HISTORY_STORE_MAX_ORDERS)
    expect(merged.trades).toHaveLength(FUTURES_HISTORY_STORE_MAX_TRADES)
    expect(merged.orders[0].orderId).toBe(orders.at(-1).orderId)
    expect(merged.trades[0].id).toBe(trades.at(-1).id)
  })

  it('lets the read replace what was stored for the same identity', () => {
    const stored = mergeFuturesHistoryContract(null, {
      symbol: 'BTCUSDT',
      orders: [order(5, { status: 'CANCELED' })],
      trades: [],
      readAt: READ_AT,
    })
    const merged = mergeFuturesHistoryContract(stored, {
      symbol: 'BTCUSDT',
      orders: [order(5, { status: 'FILLED' })],
      trades: [],
      readAt: READ_AT + 1_000,
    })
    expect(merged.orders).toHaveLength(1)
    expect(merged.orders[0].status).toBe('FILLED')
    expect(merged.readAt).toBe(READ_AT + 1_000)
  })
})

describe('splitFuturesHistoryReading', () => {
  it('covers every contract the read reached, including the empty ones', () => {
    const contracts = splitFuturesHistoryReading({
      symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      orders: [order(1, { symbol: 'BTCUSDT' }), order(2, { symbol: 'ETHUSDT' })],
      trades: [trade(1, { symbol: 'BTCUSDT' })],
    })
    expect(contracts.map(entry => entry.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])
    expect(contracts.find(entry => entry.symbol === 'SOLUSDT')).toMatchObject({
      orders: [], trades: [],
    })
  })

  it('falls back to the contracts the rows name when the read states none', () => {
    const contracts = splitFuturesHistoryReading({
      orders: [order(1, { symbol: 'ETHUSDT' })],
      trades: [trade(1, { symbol: 'BTCUSDT' })],
    })
    expect(contracts.map(entry => entry.symbol).sort()).toEqual(['BTCUSDT', 'ETHUSDT'])
  })
})

describe('the store across runs', () => {
  it('presents the review it read in an earlier run', async () => {
    const { store } = createMemoryStore()
    await store.writeReading({
      symbols: ['BTCUSDT', 'ETHUSDT'],
      orders: [order(5), order(6, { symbol: 'ETHUSDT', time: READ_AT + 5 })],
      trades: [trade(1), trade(2, { symbol: 'ETHUSDT', time: READ_AT + 5 })],
      readAt: READ_AT,
    })

    const restored = restoreFuturesHistoryFromStore(await store.readContracts())

    expect(restored).toMatchObject({ status: 'ready', readAt: READ_AT })
    expect(restored.orders.map(row => row.orderId)).toEqual([6, 5])
    expect(restored.trades.map(row => row.id)).toEqual([2, 1])
    expect([...restored.symbols].sort()).toEqual(['BTCUSDT', 'ETHUSDT'])
    expect(restored.coverage.BTCUSDT).toEqual({
      readAt: READ_AT, orderCursor: '5', tradeCursor: '1',
    })
    // The store names the contracts it holds, which is no claim about the
    // account: the panel must keep saying the list may be short.
    expect(restored.discoveryComplete).toBe(false)
  })

  it('stamps the review with its stalest contract', async () => {
    const { store } = createMemoryStore()
    await store.writeReading({
      symbols: ['BTCUSDT'], orders: [order(5)], trades: [], readAt: READ_AT,
    })
    await store.writeReading({
      symbols: ['ETHUSDT'],
      orders: [order(9, { symbol: 'ETHUSDT' })],
      trades: [],
      readAt: READ_AT + 60_000,
    })

    expect(restoreFuturesHistoryFromStore(await store.readContracts()).readAt).toBe(READ_AT)
  })

  it('takes its stamp from the contracts that put rows on screen', async () => {
    const { store } = createMemoryStore()
    // Read days ago and holding nothing — it says nothing about how fresh the
    // rows below are, so it must not age them.
    await store.writeReading({
      symbols: ['SOLUSDT'], orders: [], trades: [], readAt: READ_AT - 259_200_000,
    })
    await store.writeReading({
      symbols: ['BTCUSDT'], orders: [order(5)], trades: [], readAt: READ_AT,
    })

    expect(restoreFuturesHistoryFromStore(await store.readContracts()).readAt).toBe(READ_AT)
  })

  it('leaves the review unread when nothing is stored', async () => {
    const { store } = createMemoryStore()
    expect(restoreFuturesHistoryFromStore(await store.readContracts())).toBeNull()
    // A store that holds contracts but no rows is not a review either.
    await store.writeReading({
      symbols: ['BTCUSDT'], orders: [], trades: [], readAt: READ_AT,
    })
    expect(restoreFuturesHistoryFromStore(await store.readContracts())).toBeNull()
  })

  it('keeps the contracts most recently read and drops the rest', async () => {
    const { store, records } = createMemoryStore()
    for (let index = 0; index < FUTURES_HISTORY_STORE_MAX_CONTRACTS + 6; index += 1) {
      const symbol = `SYM${index}USDT`
      await store.writeReading({
        symbols: [symbol],
        orders: [order(index + 1, { symbol })],
        trades: [],
        readAt: READ_AT + (index * 1_000),
      })
    }
    expect(records.size).toBe(FUTURES_HISTORY_STORE_MAX_CONTRACTS)
    const kept = await store.readContracts()
    expect(kept.map(record => record.symbol)).toContain('SYM29USDT')
    expect(kept.map(record => record.symbol)).not.toContain('SYM0USDT')
  })

  it('behaves exactly as no store when it cannot be read or written', async () => {
    const unavailable = createFuturesHistoryStore({
      readAll: async () => null,
      write: async () => { throw new Error('quota exceeded') },
      remove: async () => null,
    })

    await expect(unavailable.readContracts()).resolves.toEqual([])
    expect(restoreFuturesHistoryFromStore(await unavailable.readContracts())).toBeNull()
    await expect(unavailable.writeReading({
      symbols: ['BTCUSDT'], orders: [order(5)], trades: [], readAt: READ_AT,
    })).resolves.toBe(false)
  })

  it('degrades rather than raising when the store throws on open', async () => {
    const hostile = createFuturesHistoryStore({
      readAll: async () => { throw new Error('store unavailable') },
    })
    await expect(hostile.readContracts()).resolves.toEqual([])
    await expect(hostile.writeReading({
      symbols: ['BTCUSDT'], orders: [order(5)], trades: [], readAt: READ_AT,
    })).resolves.toBe(false)
  })
})

describe('boundFuturesHistoryContracts', () => {
  it('orders by when each contract was read', () => {
    const kept = boundFuturesHistoryContracts([
      { symbol: 'A', readAt: 3 },
      { symbol: 'B', readAt: 1 },
      { symbol: 'C', readAt: 2 },
    ], 2)
    expect(kept.map(record => record.symbol)).toEqual(['A', 'C'])
  })
})
