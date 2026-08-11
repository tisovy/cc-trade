// A settled order and an executed trade never change, so buying them again is
// waste — of a request, of the account's weight budget, and of the seconds the
// operator spends looking at an empty review while it is bought. The account
// review is therefore kept locally, per contract: the terminal rows, the
// identity the exchange pages them from, and when that contract was last read.
//
// Modelled on `futuresCandleHistoryCache.js`, and degrading the same way. A
// store that will not open is a review that has not been read yet — never a
// review that fails.

import {
  TERMINAL_FUTURES_ORDER_STATUSES,
  createHeldFuturesHistory,
} from './futuresHeldHistory.js'

const DATABASE_NAME = 'FuturesAccountHistory'
const DATABASE_VERSION = 1
const STORE_NAME = 'contracts'

// Per contract, the read's own depth: `allOrders` answers a hundred at a time
// and `userTrades` a thousand, and the thousand is not a list — fills are folded
// back into the positions they formed, so a fold that starts mid-position states
// a round it cannot name the entry of.
export const FUTURES_HISTORY_STORE_MAX_ORDERS = 200
export const FUTURES_HISTORY_STORE_MAX_TRADES = 1_000
// The fan-out reads twelve contracts. Holding twice that keeps a rotation's
// worth of them without the store growing for the life of the account.
export const FUTURES_HISTORY_STORE_MAX_CONTRACTS = 24

export const futuresHistoryContractKey = symbol => String(symbol ?? '').toUpperCase()

const isTerminalOrder = order => TERMINAL_FUTURES_ORDER_STATUSES.has(
  String(order?.status ?? '').toUpperCase(),
)

const asArray = value => (Array.isArray(value) ? value : [])
const newestFirst = (left, right) => (Number(right?.time) || 0) - (Number(left?.time) || 0)
const identityOf = value => (
  value === null || value === undefined || value === '' ? null : String(value)
)

// Exchange identities are integers that outgrow a double, and they are compared
// here to decide what has already been read — so they are compared as integers
// when they are integers, and left alone when they are not.
const higherIdentity = (left, right) => {
  if (left === null) return right
  if (right === null) return left
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    return BigInt(left) >= BigInt(right) ? left : right
  }
  return left
}

const boundedRows = (rows, keyOf, limit) => {
  const byIdentity = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (key === null) continue
    // A row read from the exchange wins over the one already stored: it is the
    // exchange's own record, and the stored one may have been folded in from a
    // stream report that knew less.
    byIdentity.set(key, row)
  }
  return Object.freeze([...byIdentity.values()].sort(newestFirst).slice(0, limit))
}

const cursorOf = (rows, keyOf) => rows.reduce(
  (highest, row) => higherIdentity(highest, keyOf(row)),
  null,
)

const orderIdentity = order => identityOf(order?.orderId)
const tradeIdentity = trade => identityOf(trade?.id)

/**
 * What one contract is known to hold, after a read that covered it.
 *
 * Only terminal rows are stored: a working order is not history, and storing one
 * would present it as settled in the next run, when the exchange may have filled
 * or cancelled it while the desk was closed.
 */
export const mergeFuturesHistoryContract = (stored, {
  symbol,
  orders = [],
  trades = [],
  readAt = null,
} = {}, {
  maxOrders = FUTURES_HISTORY_STORE_MAX_ORDERS,
  maxTrades = FUTURES_HISTORY_STORE_MAX_TRADES,
} = {}) => {
  const key = futuresHistoryContractKey(symbol ?? stored?.symbol)
  const mergedOrders = boundedRows(
    [...asArray(stored?.orders), ...asArray(orders).filter(isTerminalOrder)],
    orderIdentity,
    maxOrders,
  )
  const mergedTrades = boundedRows(
    [...asArray(stored?.trades), ...asArray(trades)],
    tradeIdentity,
    maxTrades,
  )
  return Object.freeze({
    key,
    symbol: key,
    orders: mergedOrders,
    trades: mergedTrades,
    // What the contract is covered up to: the identities the next read pages
    // forward from, and when the reading was taken.
    orderCursor: cursorOf(mergedOrders, orderIdentity),
    tradeCursor: cursorOf(mergedTrades, tradeIdentity),
    readAt: Number.isSafeInteger(readAt) ? readAt : (stored?.readAt ?? null),
  })
}

/**
 * Split one account-wide reading into the contracts it covered.
 *
 * A contract the read reached but returned nothing for is still covered — that
 * is the answer "this contract has no history", and it is worth storing so the
 * next run does not ask again.
 */
export const splitFuturesHistoryReading = ({
  symbols = [],
  orders = [],
  trades = [],
} = {}) => {
  const covered = asArray(symbols)
    .map(futuresHistoryContractKey)
    .filter(symbol => symbol !== '')
  const rowSymbols = [...asArray(orders), ...asArray(trades)]
    .map(row => futuresHistoryContractKey(row?.symbol))
    .filter(symbol => symbol !== '')
  const keys = new Set(covered.length > 0 ? covered : rowSymbols)
  return [...keys].map(symbol => Object.freeze({
    symbol,
    orders: asArray(orders).filter(row => futuresHistoryContractKey(row?.symbol) === symbol),
    trades: asArray(trades).filter(row => futuresHistoryContractKey(row?.symbol) === symbol),
  }))
}

// The contracts worth keeping: the most recently read ones. A store that grew
// without a bound would carry every contract the account ever touched into every
// launch, which is the cost this store exists to remove.
export const boundFuturesHistoryContracts = (
  records,
  limit = FUTURES_HISTORY_STORE_MAX_CONTRACTS,
) => [...records]
  .sort((left, right) => (right?.readAt ?? 0) - (left?.readAt ?? 0))
  .slice(0, limit)

/**
 * The review as the store holds it, ready to be presented before anything is
 * asked of the exchange.
 *
 * `null` when there is nothing to present: an empty store must leave the review
 * saying it has never been read, which is the one case where an empty panel is
 * honest.
 */
export const restoreFuturesHistoryFromStore = (records) => {
  const usable = asArray(records).filter(record => (
    futuresHistoryContractKey(record?.symbol) !== ''
    && Number.isSafeInteger(record?.readAt)
  ))
  if (usable.length === 0) return null
  const orders = usable.flatMap(record => asArray(record.orders)).sort(newestFirst)
  const trades = usable.flatMap(record => asArray(record.trades)).sort(newestFirst)
  if (orders.length === 0 && trades.length === 0) return null
  const symbols = usable.map(record => futuresHistoryContractKey(record.symbol))
  return Object.freeze({
    ...createHeldFuturesHistory(),
    status: 'ready',
    orders: Object.freeze(orders),
    trades: Object.freeze(trades),
    symbols: Object.freeze(symbols),
    discovered: symbols.length,
    // What the store holds is what was read into it, not a statement about what
    // the account traded. A bounded list stated flatly reads as a total, so the
    // panel is told the list may be short of the account.
    discoveryComplete: false,
    // A review is only as fresh as its stalest contract, and this is the stamp
    // the desk prints beside ↻.
    readAt: Math.min(...usable.map(record => record.readAt)),
    coverage: Object.freeze(Object.fromEntries(usable.map(record => [
      futuresHistoryContractKey(record.symbol),
      Object.freeze({
        readAt: record.readAt,
        orderCursor: identityOf(record.orderCursor),
        tradeCursor: identityOf(record.tradeCursor),
      }),
    ]))),
  })
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
    // Unavailable, corrupted, or refused: the review is read from the exchange
    // exactly as it is without a store.
    return null
  }
}

/**
 * A store the review can call without ever having to handle its failure.
 *
 * Every path answers "nothing stored" rather than raising, and a write that
 * cannot happen is reported as `false` rather than as an error the panel would
 * have to explain.
 */
export const createFuturesHistoryStore = ({
  readAll = () => withStore('readonly', (store, deliver) => {
    const request = store.getAll()
    request.onsuccess = () => deliver(Array.isArray(request.result) ? request.result : [])
  }),
  write = record => withStore('readwrite', (store) => {
    store.put(record)
  }),
  remove = key => withStore('readwrite', (store) => {
    store.delete(key)
  }),
} = {}) => ({
  async readContracts() {
    try {
      const records = await readAll()
      if (!Array.isArray(records) || records.length === 0) return []
      return boundFuturesHistoryContracts(
        records.filter(record => futuresHistoryContractKey(record?.symbol) !== ''),
      )
    } catch {
      return []
    }
  },
  async writeReading(reading) {
    const readAt = Number.isSafeInteger(reading?.readAt) ? reading.readAt : null
    const contracts = splitFuturesHistoryReading(reading)
    if (contracts.length === 0) return false
    try {
      const stored = await readAll()
      if (!Array.isArray(stored)) return false
      const byKey = new Map(stored
        .filter(record => futuresHistoryContractKey(record?.symbol) !== '')
        .map(record => [futuresHistoryContractKey(record.symbol), record]))
      for (const contract of contracts) {
        byKey.set(
          contract.symbol,
          mergeFuturesHistoryContract(byKey.get(contract.symbol), { ...contract, readAt }),
        )
      }
      const kept = boundFuturesHistoryContracts([...byKey.values()])
      const keptKeys = new Set(kept.map(record => record.key ?? record.symbol))
      for (const record of byKey.values()) {
        const key = record.key ?? record.symbol
        if (!keptKeys.has(key)) await remove(key)
      }
      for (const contract of contracts) {
        const record = kept.find(entry => (entry.key ?? entry.symbol) === contract.symbol)
        if (record) await write(record)
      }
      return true
    } catch {
      // A review that could not be stored is still a review that was read.
      return false
    }
  },
})

export const futuresHistoryStore = createFuturesHistoryStore()
