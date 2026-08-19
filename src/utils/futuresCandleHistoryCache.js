// A closed candle never changes, so reading one twice is pure waste — of a
// request, of exchange weight, and of a round trip on a slow link. History is
// therefore kept locally, per contract and interval, as a single contiguous run
// of closed candles. A run rather than a bag: contiguity is what lets a page be
// served without silently stitching across a hole in the data.

const DATABASE_NAME = 'FuturesCandleHistory'
const DATABASE_VERSION = 1
const STORE_NAME = 'runs'
export const FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS = 5_000

export const FUTURES_CANDLE_HISTORY_INTERVAL_MS = Object.freeze({
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
})

export const candleHistoryKey = (symbol, interval) => `${symbol}:${interval}`

// Exactly the page that was asked for, or nothing. A partial answer would be
// indistinguishable from "the contract starts here" and would stop the chart
// from ever loading the rest.
export const selectCandleHistoryPage = (run, { endTime, limit, intervalMs }) => {
  if (!Array.isArray(run) || run.length === 0) return null
  if (!Number.isSafeInteger(endTime) || !Number.isSafeInteger(limit) || limit <= 0) return null
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) return null
  const candidates = run.filter(row => row.openTime < endTime)
  if (candidates.length < limit) return null
  // The stored run must actually reach the point being read back from; a gap
  // here means the app was closed while the market kept trading.
  if (candidates.at(-1).openTime + intervalMs !== endTime) return null
  return Object.freeze(candidates.slice(-limit))
}

// Merging only accepts rows that touch the stored run. Two disjoint runs cannot
// be concatenated without inventing the candles in between, so the newer one
// wins outright.
export const mergeCandleHistoryRun = (run, rows, {
  intervalMs,
  maxRows = FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS,
} = {}) => {
  const incoming = (Array.isArray(rows) ? rows : []).filter(row => row?.closed === true)
  if (incoming.length === 0) return Array.isArray(run) ? run : []
  const sorted = [...incoming].sort((left, right) => left.openTime - right.openTime)
  if (!Array.isArray(run) || run.length === 0) return sorted.slice(-maxRows)
  const disjointBefore = sorted.at(-1).openTime + intervalMs < run[0].openTime
  const disjointAfter = run.at(-1).openTime + intervalMs < sorted[0].openTime
  if (disjointBefore || disjointAfter) {
    return (disjointAfter ? sorted : run).slice(-maxRows)
  }
  const byOpenTime = new Map(sorted.map(row => [row.openTime, row]))
  // The stored row wins a collision: it was confirmed closed earlier.
  for (const row of run) byOpenTime.set(row.openTime, row)
  return [...byOpenTime.values()]
    .sort((left, right) => left.openTime - right.openTime)
    .slice(-maxRows)
}

const openDatabase = () => new Promise((resolve) => {
  const factory = globalThis.indexedDB
  if (typeof factory?.open !== 'function') {
    resolve(null)
    return
  }
  let request
  try {
    request = factory.open(DATABASE_NAME, DATABASE_VERSION)
  } catch {
    resolve(null)
    return
  }
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => resolve(null)
  request.onblocked = () => resolve(null)
})

const withStore = async (mode, run) => {
  const database = await openDatabase()
  if (database === null) return null
  try {
    return await new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const store = transaction.objectStore(STORE_NAME)
      let result = null
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => resolve(null)
      transaction.onabort = () => resolve(null)
      run(store, (value) => { result = value })
    })
  } catch {
    // An unavailable or corrupted store is a missing cache, never a broken
    // chart: every caller falls back to reading from the exchange.
    return null
  }
}

// A store the chart can call without ever having to handle its failure: every
// path degrades to "no cached history".
export const createFuturesCandleHistoryCache = ({
  read = key => withStore('readonly', (store, deliver) => {
    const request = store.get(key)
    request.onsuccess = () => deliver(request.result?.rows ?? null)
  }),
  write = (key, rows) => withStore('readwrite', (store) => {
    store.put({ key, rows })
  }),
} = {}) => ({
  async readPage({ symbol, interval, endTime, limit }) {
    const intervalMs = FUTURES_CANDLE_HISTORY_INTERVAL_MS[interval]
    if (intervalMs === undefined) return null
    const run = await read(candleHistoryKey(symbol, interval))
    if (run === null) return null
    return selectCandleHistoryPage(run, { endTime, limit, intervalMs })
  },
  async writePage({ symbol, interval, rows }) {
    const intervalMs = FUTURES_CANDLE_HISTORY_INTERVAL_MS[interval]
    if (intervalMs === undefined) return false
    const key = candleHistoryKey(symbol, interval)
    const run = (await read(key)) ?? []
    const merged = mergeCandleHistoryRun(run, rows, { intervalMs })
    if (merged.length === run.length && merged.length === 0) return false
    await write(key, merged)
    return true
  },
})

export const futuresCandleHistoryCache = createFuturesCandleHistoryCache()
