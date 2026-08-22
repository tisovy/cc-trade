import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { buildFuturesTradeRoundIndex } from './futuresTradeRounds.js'

const READ_AT = 1_784_000_000_000
const ACCOUNT_FINGERPRINT = '0123456789abcdef'
const OTHER_ACCOUNT_FINGERPRINT = 'fedcba9876543210'

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
  id: String(id),
  orderId: String(id),
  symbol,
  side: 'BUY',
  positionSide: 'BOTH',
  price: '58400',
  quantity: '0.010',
  quoteQty: '584',
  realizedPnl: '1.25',
  commission: '0.02',
  commissionAsset: 'USDT',
  marginAsset: 'USDT',
  maker: false,
  time,
})

const createMemoryStore = (seed = []) => {
  const records = new Map(seed.map((record) => {
    const fingerprint = record.fingerprint ?? ACCOUNT_FINGERPRINT
    const key = record.key ?? `${fingerprint}:${record.symbol}`
    return [key, { ...record, key, fingerprint }]
  }))
  const rawStore = createFuturesHistoryStore({
    readAll: async () => [...records.values()],
    write: async record => records.set(record.key, record),
    remove: async key => records.delete(key),
  })
  return {
    records,
    rawStore,
    store: {
      readContracts: (fingerprint = ACCOUNT_FINGERPRINT) => (
        rawStore.readContracts(fingerprint)
      ),
      writeReading: reading => rawStore.writeReading({
        accountFingerprint: ACCOUNT_FINGERPRINT,
        ...reading,
      }),
    },
  }
}

const createIndexedDbHarness = (seed = [], { failPut = false } = {}) => {
  const records = new Map(seed.map(record => [record.key, record]))
  const metrics = {
    opens: 0,
    closes: 0,
    transactions: [],
    getAlls: 0,
    deletes: 0,
    puts: 0,
    aborts: 0,
  }
  const pendingReadwrite = []
  let readwriteActive = false
  const drainReadwrite = () => {
    if (readwriteActive || pendingReadwrite.length === 0) return
    readwriteActive = true
    const start = pendingReadwrite.shift()
    queueMicrotask(() => start(() => {
      readwriteActive = false
      drainReadwrite()
    }))
  }

  const createTransaction = (mode) => {
    metrics.transactions.push(mode)
    const deletes = []
    const puts = []
    let getAllRequest = null
    let aborted = false
    let released = false
    let release = () => {}
    const finish = () => {
      if (released) return
      released = true
      release()
    }
    const transaction = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      abort: () => {
        if (aborted) return
        aborted = true
        metrics.aborts += 1
        queueMicrotask(() => {
          transaction.onabort?.()
          finish()
        })
      },
      objectStore: () => ({
        getAll: () => {
          metrics.getAlls += 1
          getAllRequest = { result: null, onsuccess: null, onerror: null }
          return getAllRequest
        },
        delete: (key) => {
          metrics.deletes += 1
          deletes.push(key)
          return {}
        },
        put: (record) => {
          metrics.puts += 1
          if (failPut) throw new Error('put failed')
          puts.push(record)
          return {}
        },
      }),
    }
    const start = (releaseTransaction) => {
      release = releaseTransaction
      if (getAllRequest === null) {
        transaction.abort()
        return
      }
      getAllRequest.result = [...records.values()]
      getAllRequest.onsuccess?.()
      queueMicrotask(() => {
        if (aborted) return
        for (const key of deletes) records.delete(key)
        for (const record of puts) records.set(record.key, record)
        transaction.oncomplete?.()
        finish()
      })
    }
    if (mode === 'readwrite') {
      pendingReadwrite.push(start)
      drainReadwrite()
    } else {
      queueMicrotask(() => start(() => {}))
    }
    return transaction
  }

  const factory = {
    open: () => {
      metrics.opens += 1
      const database = {
        transaction: (unusedStoreName, mode) => createTransaction(mode),
        close: () => { metrics.closes += 1 },
      }
      const request = { result: database }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  }
  return { factory, metrics, records }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const restoreAccount = records => restoreFuturesHistoryFromStore(records, {
  fingerprint: ACCOUNT_FINGERPRINT,
})

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
    expect(merged.trades.map(row => row.id)).toEqual(['1'])
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

  it('counts distinct same-identity payload variants against the physical trade bound', () => {
    const completeCoverage = {
      version: 2,
      targetFrom: READ_AT - 1,
      targetTo: READ_AT + 1,
      coveredFrom: READ_AT - 1,
      coveredTo: READ_AT + 1,
      complete: true,
      pageLimited: false,
      retentionLimited: false,
      continuityComplete: true,
      flatBoundary: true,
    }
    const canonical = trade(9)
    const variants = [
      canonical,
      { ...canonical, realizedPnl: '2.50' },
      { ...canonical, quantity: '0.020', quoteQty: '1168' },
    ]
    const withinBound = mergeFuturesHistoryContract(null, {
      symbol: 'BTCUSDT',
      trades: [...variants, { ...canonical }],
      tradeCoverage: completeCoverage,
      readAt: READ_AT,
    }, { maxTrades: 3 })

    expect(withinBound.trades).toHaveLength(3)
    expect(withinBound.tradeCursor).toBe('9')
    expect(withinBound.tradeCoverage).toMatchObject({
      complete: true,
      retentionLimited: false,
    })

    const overflowRows = [
      ...variants,
      { ...canonical, commission: '0.03' },
      { ...canonical },
    ]
    const overflow = mergeFuturesHistoryContract(null, {
      symbol: 'BTCUSDT',
      trades: overflowRows,
      tradeCoverage: completeCoverage,
      readAt: READ_AT,
    }, { maxTrades: 3 })
    const reversed = mergeFuturesHistoryContract(null, {
      symbol: 'BTCUSDT',
      trades: [...overflowRows].reverse(),
      tradeCoverage: completeCoverage,
      readAt: READ_AT,
    }, { maxTrades: 3 })

    expect(overflow.trades).toHaveLength(3)
    expect(overflow.trades).toEqual(reversed.trades)
    expect(overflow.tradeCursor).toBe('9')
    expect(overflow.tradeCoverage).toMatchObject({
      complete: false,
      retentionLimited: true,
    })
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

    const restored = restoreAccount(await store.readContracts())

    expect(restored).toMatchObject({
      accountFingerprint: ACCOUNT_FINGERPRINT,
      status: 'ready',
      readAt: READ_AT,
    })
    expect(restored.orders.map(row => row.orderId)).toEqual([6, 5])
    expect(restored.trades.map(row => row.id)).toEqual(['2', '1'])
    expect([...restored.symbols].sort()).toEqual(['BTCUSDT', 'ETHUSDT'])
    expect(restored.coverage.BTCUSDT).toEqual({
      readAt: READ_AT,
      orderReadAt: READ_AT,
      tradeReadAt: READ_AT,
      orderCursor: '5',
      tradeCursor: '1',
      generation: 1,
      tradeCoverage: null,
    })
    // The store names the contracts it holds, which is no claim about the
    // account: the panel must keep saying the list may be short.
    expect(restored.discoveryComplete).toBe(false)
  })

  it.each([
    ['realized PnL', { realizedPnl: '11' }],
    ['quantity', { quantity: '2', quoteQty: '220' }],
  ])('keeps conflicting same-ID %s variants unresolved across restart independent of arrival order', async (
    _field,
    conflict,
  ) => {
    const opening = {
      ...trade(1, { time: READ_AT }),
      side: 'BUY',
      price: '100',
      quantity: '1',
      quoteQty: '100',
      realizedPnl: '0',
      commission: '1',
    }
    const closing = {
      ...trade(2, { time: READ_AT + 1 }),
      side: 'SELL',
      price: '110',
      quantity: '1',
      quoteQty: '110',
      realizedPnl: '10',
      commission: '1',
    }
    const conflicting = { ...closing, ...conflict }
    const completeCoverage = {
      version: 2,
      targetFrom: READ_AT - 1,
      targetTo: READ_AT + 2,
      coveredFrom: READ_AT - 1,
      coveredTo: READ_AT + 2,
      complete: true,
      pageLimited: false,
      retentionLimited: false,
      continuityComplete: true,
      flatBoundary: true,
    }
    const outcomes = []

    for (const delivered of [
      [opening, closing, { ...closing }, conflicting],
      [conflicting, { ...closing }, closing, opening],
    ]) {
      const firstRun = createMemoryStore()
      await firstRun.store.writeReading({
        symbols: ['BTCUSDT'],
        orders: [],
        trades: delivered,
        views: ['trades'],
        tradeCoverage: { BTCUSDT: completeCoverage },
        readAt: READ_AT + 2,
      })

      const restarted = createMemoryStore([...firstRun.records.values()])
      const restored = restoreAccount(await restarted.store.readContracts())
      const roundIndex = buildFuturesTradeRoundIndex(restored.trades, {
        generation: restored.generation,
        positions: [],
        coverage: {
          'BTCUSDT:BOTH': {
            ...restored.coverage.BTCUSDT.tradeCoverage,
            generation: restored.generation,
          },
        },
      })

      expect(restored.trades.filter(row => row.id === '2')).toHaveLength(2)
      expect(restored.coverage.BTCUSDT).toMatchObject({
        tradeCursor: null,
        tradeCoverage: null,
      })
      expect(roundIndex.closed).toEqual([])
      expect(roundIndex.rounds).toEqual([])
      expect(roundIndex.unresolved.flatMap(segment => segment.reasons)).toEqual(
        expect.arrayContaining(['conflicting-fill-identity', 'history-continuity-unproven']),
      )
      outcomes.push({
        restored: restored.trades,
        unresolved: roundIndex.unresolved.map(segment => ({
          positionKey: segment.positionKey,
          fillIds: segment.fillIds,
          reasons: [...segment.reasons].sort(),
        })),
      })
    }

    expect(outcomes[0]).toEqual(outcomes[1])
  })

  it('deduplicates exact same-ID copies across restart before the round fold', async () => {
    const opening = {
      ...trade(1, { time: READ_AT }),
      side: 'BUY',
      price: '100',
      quantity: '1',
      quoteQty: '100',
      realizedPnl: '0',
      commission: '1',
    }
    const closing = {
      ...trade(2, { time: READ_AT + 1 }),
      side: 'SELL',
      price: '110',
      quantity: '1',
      quoteQty: '110',
      realizedPnl: '10',
      commission: '1',
    }
    const firstRun = createMemoryStore()
    await firstRun.store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [opening, { ...opening }, closing, { ...closing }],
      views: ['trades'],
      tradeCoverage: {
        BTCUSDT: {
          version: 2,
          targetFrom: READ_AT - 1,
          targetTo: READ_AT + 2,
          coveredFrom: READ_AT - 1,
          coveredTo: READ_AT + 2,
          complete: true,
          pageLimited: false,
          retentionLimited: false,
          continuityComplete: true,
          flatBoundary: true,
        },
      },
      readAt: READ_AT + 2,
    })

    const restarted = createMemoryStore([...firstRun.records.values()])
    const restored = restoreAccount(await restarted.store.readContracts())
    const roundIndex = buildFuturesTradeRoundIndex(restored.trades, {
      generation: restored.generation,
      positions: [],
      coverage: {
        'BTCUSDT:BOTH': {
          ...restored.coverage.BTCUSDT.tradeCoverage,
          generation: restored.generation,
        },
      },
    })

    expect(restored.trades.map(row => row.id)).toEqual(['2', '1'])
    expect(restored.coverage.BTCUSDT).toMatchObject({
      tradeCursor: '2',
      tradeCoverage: expect.objectContaining({
        complete: true,
        continuityComplete: true,
      }),
    })
    expect(roundIndex.unresolved).toEqual([])
    expect(roundIndex.closed).toHaveLength(1)
    expect(roundIndex.closed[0]).toMatchObject({
      fillIds: ['1', '2'],
      realizedPnlExact: '10',
      feeExact: '2',
    })
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

    expect(restoreAccount(await store.readContracts()).readAt).toBe(READ_AT)
  })

  it('merges cursor gaps but replaces full endpoints in persistent state', async () => {
    const { store } = createMemoryStore()
    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [order(5)],
      trades: [trade(1)],
      readAt: READ_AT,
    })
    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [order(6, { time: READ_AT + 1 })],
      trades: [trade(2, { time: READ_AT + 1 })],
      readFrom: {
        BTCUSDT: { orderCursor: '5', tradeCursor: null },
      },
      readAt: READ_AT + 1,
    })

    const [record] = await store.readContracts()
    expect(record.orders.map(row => row.orderId)).toEqual([6, 5])
    expect(record.trades.map(row => row.id)).toEqual(['2'])
    expect(record).toMatchObject({ orderCursor: '6', tradeCursor: '2' })

    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [],
      readFrom: {
        BTCUSDT: { orderCursor: null, tradeCursor: null },
      },
      readAt: READ_AT + 2,
    })
    const [cleared] = await store.readContracts()
    expect(cleared).toMatchObject({
      orders: [], trades: [], orderCursor: null, tradeCursor: null,
    })
  })

  // A review reads the endpoint the open view needs. What it did not read, it
  // did not read — replacing the stored rows of the other endpoint with the
  // nothing it came back with would lose a run's worth of history to a tab.
  it('leaves the endpoint a one-view reading did not read exactly as it was', async () => {
    const { store } = createMemoryStore()
    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [order(5)],
      trades: [trade(1)],
      readAt: READ_AT,
    })
    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [trade(2, { time: READ_AT + 1 })],
      readFrom: { BTCUSDT: { tradeCursor: null } },
      views: ['trades'],
      readAt: READ_AT + 1,
    })

    const [record] = await store.readContracts()
    expect(record.orders.map(row => row.orderId)).toEqual([5])
    expect(record.trades.map(row => row.id)).toEqual(['2'])
    expect(record).toMatchObject({
      orderCursor: '5', tradeCursor: '2', orderReadAt: READ_AT, tradeReadAt: READ_AT + 1,
    })
  })

  // Which views the next run may present without asking again. A contract read
  // for one of them leaves the other worth reading, and the store is where that
  // survives the desk being closed.
  it('carries which views were read into the next run', async () => {
    const { store } = createMemoryStore()
    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [trade(1)],
      views: ['trades'],
      readAt: READ_AT,
    })
    expect(restoreAccount(await store.readContracts()).readViews)
      .toEqual({ orders: null, trades: READ_AT })

    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [order(5)],
      trades: [],
      views: ['orders'],
      readAt: READ_AT + 1,
    })
    expect(restoreAccount(await store.readContracts()).readViews)
      .toEqual({ orders: READ_AT + 1, trades: READ_AT })

    // One contract read for its fills alone is enough to leave the order log
    // worth asking for: the desk re-reads that contract and vouches the rest.
    await store.writeReading({
      symbols: ['ETHUSDT'], orders: [], trades: [trade(9)], views: ['trades'], readAt: READ_AT + 2,
    })
    expect(restoreAccount(await store.readContracts()).readViews)
      .toEqual({ orders: null, trades: READ_AT })
  })

  it('lets an empty-but-covered contract age the review it proves', async () => {
    const { store } = createMemoryStore()
    // "No rows" is still the result of a read and still names persisted
    // discovery, so the review is only as fresh as that oldest proof.
    await store.writeReading({
      symbols: ['SOLUSDT'], orders: [], trades: [], readAt: READ_AT - 259_200_000,
    })
    await store.writeReading({
      symbols: ['BTCUSDT'], orders: [order(5)], trades: [], readAt: READ_AT,
    })

    expect(restoreAccount(await store.readContracts()).readAt)
      .toBe(READ_AT - 259_200_000)
  })

  it('leaves the review unread when nothing is stored', async () => {
    const { store } = createMemoryStore()
    expect(restoreAccount(await store.readContracts())).toBeNull()
  })

  it('restores a contract that was read and had no terminal rows', async () => {
    const { store } = createMemoryStore()
    await store.writeReading({
      symbols: ['BTCUSDT'], orders: [], trades: [], readAt: READ_AT,
    })
    expect(restoreAccount(await store.readContracts())).toMatchObject({
      status: 'ready',
      readAt: READ_AT,
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [],
      coverage: {
        BTCUSDT: { readAt: READ_AT, orderCursor: null, tradeCursor: null },
      },
    })
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

  it('writes and restores only the requested account fingerprint', async () => {
    const { store, rawStore, records } = createMemoryStore()
    await store.writeReading({
      symbols: ['BTCUSDT'], orders: [order(5)], trades: [trade(1)], readAt: READ_AT,
    })

    expect([...records.values()]).toEqual([
      expect.objectContaining({
        key: `${ACCOUNT_FINGERPRINT}:BTCUSDT`,
        fingerprint: ACCOUNT_FINGERPRINT,
      }),
    ])
    expect(await rawStore.readContracts(OTHER_ACCOUNT_FINGERPRINT)).toEqual([])
    expect(restoreFuturesHistoryFromStore([...records.values()], {
      fingerprint: OTHER_ACCOUNT_FINGERPRINT,
    })).toBeNull()
    expect(restoreAccount(await store.readContracts())).toMatchObject({
      accountFingerprint: ACCOUNT_FINGERPRINT,
      symbols: ['BTCUSDT'],
    })
    await expect(rawStore.writeReading({
      accountFingerprint: 'not-a-fingerprint',
      symbols: ['ETHUSDT'],
      orders: [],
      trades: [],
      readAt: READ_AT,
    })).resolves.toBe(false)
  })

  it('purges legacy and previous-account namespaces while keeping the current bound', async () => {
    const legacyKey = 'LEGACYUSDT'
    const foreignKey = `${OTHER_ACCOUNT_FINGERPRINT}:OLDUSDT`
    const records = new Map([
      [legacyKey, {
        key: legacyKey,
        symbol: 'LEGACYUSDT',
        orders: [],
        trades: [],
        readAt: READ_AT - 2,
      }],
      [foreignKey, {
        key: foreignKey,
        fingerprint: OTHER_ACCOUNT_FINGERPRINT,
        symbol: 'OLDUSDT',
        orders: [],
        trades: [],
        readAt: READ_AT - 1,
      }],
    ])
    const rawStore = createFuturesHistoryStore({
      readAll: async () => [...records.values()],
      write: async record => records.set(record.key, record),
      remove: async key => records.delete(key),
    })
    const symbols = Array.from(
      { length: FUTURES_HISTORY_STORE_MAX_CONTRACTS + 6 },
      (unused, index) => `CURRENT${index}USDT`,
    )

    await expect(rawStore.writeReading({
      accountFingerprint: ACCOUNT_FINGERPRINT,
      symbols,
      orders: [],
      trades: [],
      readAt: READ_AT,
    })).resolves.toBe(true)

    expect(records.size).toBe(FUTURES_HISTORY_STORE_MAX_CONTRACTS)
    expect([...records.values()].every(record => (
      record.fingerprint === ACCOUNT_FINGERPRINT
      && record.key.startsWith(`${ACCOUNT_FINGERPRINT}:`)
    ))).toBe(true)
    expect(await rawStore.readContracts(ACCOUNT_FINGERPRINT))
      .toHaveLength(FUTURES_HISTORY_STORE_MAX_CONTRACTS)
    expect(await rawStore.readContracts(OTHER_ACCOUNT_FINGERPRINT)).toEqual([])
    expect(records.has(legacyKey)).toBe(false)
    expect(records.has(foreignKey)).toBe(false)
  })

  it('invalidates legacy trade coverage that cannot prove the settlement asset', () => {
    const legacyTrade = trade(7)
    delete legacyTrade.marginAsset
    const restored = restoreAccount([{
      version: 2,
      key: `${ACCOUNT_FINGERPRINT}:BTCUSDT`,
      fingerprint: ACCOUNT_FINGERPRINT,
      symbol: 'BTCUSDT',
      orders: [order(5)],
      trades: [legacyTrade],
      orderCursor: '5',
      tradeCursor: '7',
      tradeCoverage: {
        version: 2,
        coveredFrom: READ_AT - 60_000,
        coveredTo: READ_AT,
        complete: true,
      },
      readAt: READ_AT,
    }])

    // The cached row remains useful for identity/display, but it cannot vouch
    // for denominated PnL. A null cursor/coverage forces one bounded Full read.
    expect(restored.trades).toEqual([expect.objectContaining({ id: '7' })])
    expect(restored.coverage.BTCUSDT).toMatchObject({
      orderCursor: '5',
      tradeCursor: null,
      tradeCoverage: null,
    })
  })

  it.each([
    ['numeric trade identity', { id: 7 }],
    ['missing order identity', { orderId: null }],
    ['foreign contract', { symbol: 'ETHUSDT' }],
    ['missing side', { side: null }],
    ['invalid position side', { positionSide: 'OPEN' }],
    ['missing price', { price: null }],
    ['scientific quantity', { quantity: '1e-2' }],
    ['missing realized PnL', { realizedPnl: null }],
    ['negative commission', { commission: '-0.02' }],
    ['missing nonzero-commission asset', { commissionAsset: null }],
    ['missing settlement asset', { marginAsset: null }],
    ['missing time', { time: null }],
  ])('retains a v2 %s row but clears its cursor and coverage', (_case, malformedEvidence) => {
    const malformed = { ...trade(7), ...malformedEvidence }
    const tradeCoverage = {
      version: 2,
      coveredFrom: READ_AT - 60_000,
      coveredTo: READ_AT,
      complete: true,
      continuityComplete: true,
      retentionLimited: false,
    }
    const restored = restoreAccount([{
      version: 2,
      key: `${ACCOUNT_FINGERPRINT}:BTCUSDT`,
      fingerprint: ACCOUNT_FINGERPRINT,
      symbol: 'BTCUSDT',
      orders: [],
      trades: [trade(6), malformed],
      orderCursor: null,
      tradeCursor: '7',
      tradeCoverage,
      readAt: READ_AT,
    }])

    expect(restored.trades).toContain(malformed)
    expect(restored.coverage.BTCUSDT).toMatchObject({
      tradeCursor: null,
      tradeCoverage: null,
    })
  })

  it('preserves current trade coverage when every cached fill names marginAsset', () => {
    const tradeCoverage = {
      version: 2,
      coveredFrom: READ_AT - 60_000,
      coveredTo: READ_AT,
      complete: true,
      continuityComplete: true,
      retentionLimited: false,
    }
    const restored = restoreAccount([{
      version: 2,
      key: `${ACCOUNT_FINGERPRINT}:BTCUSDT`,
      fingerprint: ACCOUNT_FINGERPRINT,
      symbol: 'BTCUSDT',
      orders: [],
      trades: [trade(7)],
      orderCursor: null,
      tradeCursor: '7',
      tradeCoverage,
      readAt: READ_AT,
    }])

    expect(restored.trades[0].marginAsset).toBe('USDT')
    expect(restored.coverage.BTCUSDT).toMatchObject({
      tradeCursor: '7',
      tradeCoverage,
    })
  })

  it('keeps the held trade suffix when a cursorless older backfill explicitly merges', async () => {
    const { store } = createMemoryStore()
    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [trade(9, { time: READ_AT })],
      views: ['trades'],
      readFrom: { BTCUSDT: { tradeCursor: null } },
      readAt: READ_AT,
    })
    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [trade(1, { time: READ_AT - 10_000 })],
      views: ['trades'],
      readFrom: { BTCUSDT: { tradeCursor: null } },
      merge: { BTCUSDT: { trades: true } },
      readAt: READ_AT + 1,
    })

    const [record] = await store.readContracts()
    expect(record.trades.map(row => row.id)).toEqual(['9', '1'])
    expect(record.tradeCursor).toBe('9')
    expect(record.tradeReadAt).toBe(READ_AT + 1)
  })

  it('admits crossed responses independently for each endpoint', async () => {
    const { store } = createMemoryStore()
    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [],
      trades: [trade(30, { time: READ_AT + 30 })],
      views: ['trades'],
      readAt: READ_AT + 30,
    })
    await store.writeReading({
      symbols: ['BTCUSDT'],
      orders: [order(20, { time: READ_AT + 20 })],
      trades: [trade(20, { time: READ_AT + 20 })],
      views: ['orders', 'trades'],
      readAt: READ_AT + 20,
    })

    const [record] = await store.readContracts()
    expect(record.orders.map(row => row.orderId)).toEqual([20])
    expect(record.trades.map(row => row.id)).toEqual(['30'])
    expect(record).toMatchObject({
      orderReadAt: READ_AT + 20,
      tradeReadAt: READ_AT + 30,
      readAt: READ_AT + 30,
    })
  })

  it('serializes concurrent composite writes so neither endpoint is lost', async () => {
    const records = new Map()
    const store = createFuturesHistoryStore({
      readAll: async () => [...records.values()],
      write: async (record) => {
        await Promise.resolve()
        records.set(record.key, record)
        return true
      },
      remove: async key => records.delete(key),
    })

    await Promise.all([
      store.writeReading({
        accountFingerprint: ACCOUNT_FINGERPRINT,
        symbols: ['BTCUSDT'],
        orders: [order(5)],
        trades: [],
        views: ['orders'],
        readAt: READ_AT,
      }),
      store.writeReading({
        accountFingerprint: ACCOUNT_FINGERPRINT,
        symbols: ['BTCUSDT'],
        orders: [],
        trades: [trade(7)],
        views: ['trades'],
        readAt: READ_AT + 1,
      }),
    ])

    const [record] = await store.readContracts(ACCOUNT_FINGERPRINT)
    expect(record.orders.map(row => row.orderId)).toEqual([5])
    expect(record.trades.map(row => row.id)).toEqual(['7'])
    expect(record).toMatchObject({
      orderReadAt: READ_AT,
      tradeReadAt: READ_AT + 1,
    })
  })

  it('serializes complementary writes from separate store instances in IndexedDB', async () => {
    const { factory, metrics, records } = createIndexedDbHarness()
    vi.stubGlobal('indexedDB', factory)
    const orderStore = createFuturesHistoryStore()
    const tradeStore = createFuturesHistoryStore()

    await Promise.all([
      orderStore.writeReading({
        accountFingerprint: ACCOUNT_FINGERPRINT,
        symbols: ['BTCUSDT'],
        orders: [order(5)],
        trades: [],
        views: ['orders'],
        readAt: READ_AT,
      }),
      tradeStore.writeReading({
        accountFingerprint: ACCOUNT_FINGERPRINT,
        symbols: ['BTCUSDT'],
        orders: [],
        trades: [trade(7)],
        views: ['trades'],
        readAt: READ_AT + 1,
      }),
    ])

    const record = records.get(`${ACCOUNT_FINGERPRINT}:BTCUSDT`)
    expect(record.orders.map(row => row.orderId)).toEqual([5])
    expect(record.trades.map(row => row.id)).toEqual(['7'])
    expect(record).toMatchObject({
      orderReadAt: READ_AT,
      tradeReadAt: READ_AT + 1,
    })
    expect(metrics).toMatchObject({
      opens: 2,
      closes: 2,
      transactions: ['readwrite', 'readwrite'],
      getAlls: 2,
      puts: 2,
      aborts: 0,
    })

    await expect(orderStore.readContracts(ACCOUNT_FINGERPRINT))
      .resolves.toEqual([record])
    expect(metrics).toMatchObject({
      opens: 3,
      closes: 3,
      transactions: ['readwrite', 'readwrite', 'readonly'],
      getAlls: 3,
    })
  })

  it('uses one transaction and closes without committing a partial prune on failure', async () => {
    const foreignKey = `${OTHER_ACCOUNT_FINGERPRINT}:OLDUSDT`
    const foreignRecord = {
      key: foreignKey,
      fingerprint: OTHER_ACCOUNT_FINGERPRINT,
      symbol: 'OLDUSDT',
      orders: [],
      trades: [],
      readAt: READ_AT - 1,
    }
    const { factory, metrics, records } = createIndexedDbHarness(
      [foreignRecord],
      { failPut: true },
    )
    vi.stubGlobal('indexedDB', factory)
    const store = createFuturesHistoryStore()

    await expect(store.writeReading({
      accountFingerprint: ACCOUNT_FINGERPRINT,
      symbols: ['BTCUSDT'],
      orders: [order(5)],
      trades: [],
      readAt: READ_AT,
    })).resolves.toBe(false)

    expect([...records.values()]).toEqual([foreignRecord])
    expect(metrics).toMatchObject({
      opens: 1,
      closes: 1,
      transactions: ['readwrite'],
      getAlls: 1,
      deletes: 1,
      puts: 1,
      aborts: 1,
    })
  })

  it('behaves exactly as no store when it cannot be read or written', async () => {
    const unavailable = createFuturesHistoryStore({
      readAll: async () => null,
      write: async () => { throw new Error('quota exceeded') },
      remove: async () => null,
    })

    await expect(unavailable.readContracts(ACCOUNT_FINGERPRINT)).resolves.toEqual([])
    expect(restoreAccount(await unavailable.readContracts(ACCOUNT_FINGERPRINT))).toBeNull()
    await expect(unavailable.writeReading({
      accountFingerprint: ACCOUNT_FINGERPRINT,
      symbols: ['BTCUSDT'], orders: [order(5)], trades: [], readAt: READ_AT,
    })).resolves.toBe(false)
  })

  it('degrades rather than raising when the store throws on open', async () => {
    const hostile = createFuturesHistoryStore({
      readAll: async () => { throw new Error('store unavailable') },
    })
    await expect(hostile.readContracts(ACCOUNT_FINGERPRINT)).resolves.toEqual([])
    await expect(hostile.writeReading({
      accountFingerprint: ACCOUNT_FINGERPRINT,
      symbols: ['BTCUSDT'], orders: [order(5)], trades: [], readAt: READ_AT,
    })).resolves.toBe(false)
  })

  it('reports an aborted physical put or delete as a failed write', async () => {
    const putFailed = createFuturesHistoryStore({
      readAll: async () => [],
      write: async () => null,
    })
    await expect(putFailed.writeReading({
      accountFingerprint: ACCOUNT_FINGERPRINT,
      symbols: ['BTCUSDT'], orders: [order(5)], trades: [], readAt: READ_AT,
    })).resolves.toBe(false)

    const fullStore = Array.from({ length: FUTURES_HISTORY_STORE_MAX_CONTRACTS }, (_, index) => ({
      key: `${ACCOUNT_FINGERPRINT}:OLD${index}USDT`,
      fingerprint: ACCOUNT_FINGERPRINT,
      symbol: `OLD${index}USDT`,
      orders: [],
      trades: [],
      orderCursor: null,
      tradeCursor: null,
      readAt: READ_AT + index,
    }))
    const deleteFailed = createFuturesHistoryStore({
      readAll: async () => fullStore,
      remove: async () => null,
      write: async () => true,
    })
    await expect(deleteFailed.writeReading({
      accountFingerprint: ACCOUNT_FINGERPRINT,
      symbols: ['NEWUSDT'], orders: [], trades: [], readAt: READ_AT + 1_000,
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
