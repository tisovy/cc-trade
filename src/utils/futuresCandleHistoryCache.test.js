import { describe, expect, it } from 'vitest'
import {
  FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS,
  createFuturesCandleHistoryCache,
  mergeCandleHistoryRun,
  selectCandleHistoryPage,
} from './futuresCandleHistoryCache.js'

const MINUTE = 60_000
const START = 1_784_000_000_000

const candle = (index, { closed = true } = {}) => ({
  openTime: START + (index * MINUTE),
  closeTime: START + ((index + 1) * MINUTE) - 1,
  open: '58400',
  high: '58500',
  low: '58300',
  close: '58420',
  volume: '1',
  closed,
})

const run = (from, to) => Array.from({ length: to - from }, (_, index) => candle(from + index))

const createMemoryCache = (seed = new Map()) => {
  const store = seed
  return {
    store,
    cache: createFuturesCandleHistoryCache({
      read: async key => store.get(key) ?? null,
      write: async (key, rows) => store.set(key, rows),
    }),
  }
}

describe('selectCandleHistoryPage', () => {
  it('serves exactly the page immediately behind the requested point', () => {
    const page = selectCandleHistoryPage(run(0, 100), {
      endTime: START + (100 * MINUTE),
      limit: 20,
      intervalMs: MINUTE,
    })
    expect(page).toHaveLength(20)
    expect(page[0].openTime).toBe(START + (80 * MINUTE))
    expect(page.at(-1).openTime).toBe(START + (99 * MINUTE))
  })

  it('refuses a page it cannot fully cover', () => {
    expect(selectCandleHistoryPage(run(0, 10), {
      endTime: START + (10 * MINUTE),
      limit: 20,
      intervalMs: MINUTE,
    })).toBeNull()
  })

  it('refuses to stitch across a gap left by a closed app', () => {
    // The run stops an hour before the point being read back from.
    expect(selectCandleHistoryPage(run(0, 100), {
      endTime: START + (160 * MINUTE),
      limit: 20,
      intervalMs: MINUTE,
    })).toBeNull()
  })
})

describe('mergeCandleHistoryRun', () => {
  it('extends the run backwards and keeps it ordered', () => {
    const merged = mergeCandleHistoryRun(run(50, 60), run(40, 50), { intervalMs: MINUTE })
    expect(merged).toHaveLength(20)
    expect(merged[0].openTime).toBe(START + (40 * MINUTE))
    expect(merged.at(-1).openTime).toBe(START + (59 * MINUTE))
  })

  it('never invents the candles between two disjoint runs', () => {
    const merged = mergeCandleHistoryRun(run(0, 10), run(500, 510), { intervalMs: MINUTE })
    expect(merged).toHaveLength(10)
    expect(merged[0].openTime).toBe(START + (500 * MINUTE))
  })

  it('stores only closed candles', () => {
    const merged = mergeCandleHistoryRun([], [candle(0), candle(1, { closed: false })], {
      intervalMs: MINUTE,
    })
    expect(merged).toHaveLength(1)
  })

  it('bounds what one contract and interval may hold', () => {
    const merged = mergeCandleHistoryRun([], run(0, FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS + 500), {
      intervalMs: MINUTE,
    })
    expect(merged).toHaveLength(FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS)
    expect(merged.at(-1).openTime)
      .toBe(START + ((FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS + 499) * MINUTE))
  })
})

describe('futures candle history cache', () => {
  it('serves a written page back without a second read of the exchange', async () => {
    const { cache } = createMemoryCache()
    await cache.writePage({ symbol: 'BTCUSDT', interval: '1m', rows: run(0, 100) })
    const page = await cache.readPage({
      symbol: 'BTCUSDT',
      interval: '1m',
      endTime: START + (100 * MINUTE),
      limit: 100,
    })
    expect(page).toHaveLength(100)
  })

  it('reports a miss for another contract, another interval or an unknown one', async () => {
    const { cache } = createMemoryCache()
    await cache.writePage({ symbol: 'BTCUSDT', interval: '1m', rows: run(0, 100) })
    const request = { endTime: START + (100 * MINUTE), limit: 100 }
    expect(await cache.readPage({ symbol: 'ETHUSDT', interval: '1m', ...request })).toBeNull()
    expect(await cache.readPage({ symbol: 'BTCUSDT', interval: '5m', ...request })).toBeNull()
    expect(await cache.readPage({ symbol: 'BTCUSDT', interval: '3m', ...request })).toBeNull()
  })

  it('degrades to a miss when the store cannot be opened', async () => {
    const cache = createFuturesCandleHistoryCache({
      read: async () => null,
      write: async () => null,
    })
    expect(await cache.readPage({
      symbol: 'BTCUSDT',
      interval: '1m',
      endTime: START,
      limit: 10,
    })).toBeNull()
    await expect(cache.writePage({
      symbol: 'BTCUSDT',
      interval: '1m',
      rows: run(0, 10),
    })).resolves.toBe(true)
  })
})
