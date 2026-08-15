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
  FUTURES_HELD_HISTORY_MAX_ORDERS_PER_CONTRACT,
  FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT,
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
export const FUTURES_HISTORY_STORE_MAX_ORDERS = FUTURES_HELD_HISTORY_MAX_ORDERS_PER_CONTRACT
export const FUTURES_HISTORY_STORE_MAX_TRADES = FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT
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
  replaceOrders = false,
  replaceTrades = false,
  // Which endpoints the reading behind this actually covered. A review reads the
  // endpoint the open view needs, so a contract can be read for its fills and
  // never for its order log — and the next run has to be able to tell the
  // difference between an endpoint read and empty and one never asked about.
  readsOrders = true,
  readsTrades = true,
} = {}) => {
  const key = futuresHistoryContractKey(symbol ?? stored?.symbol)
  const mergedOrders = boundedRows(
    [
      ...(replaceOrders ? [] : asArray(stored?.orders)),
      ...asArray(orders).filter(isTerminalOrder),
    ],
    orderIdentity,
    maxOrders,
  )
  const mergedTrades = boundedRows(
    [...(replaceTrades ? [] : asArray(stored?.trades)), ...asArray(trades)],
    tradeIdentity,
    maxTrades,
  )
  const storedStamp = Number.isSafeInteger(stored?.readAt) ? stored.readAt : null
  // A record written before reads were per endpoint has no per-view stamp, and
  // every read behind it covered both — so its own stamp stands for both.
  const heldStamp = key => (Object.hasOwn(stored ?? {}, key) ? stored[key] : storedStamp)
  const stamp = Number.isSafeInteger(readAt) ? readAt : null
  return Object.freeze({
    key,
    symbol: key,
    orders: mergedOrders,
    trades: mergedTrades,
    // What the contract is covered up to: the identities the next read pages
    // forward from, and when the reading was taken.
    orderCursor: cursorOf(mergedOrders, orderIdentity),
    tradeCursor: cursorOf(mergedTrades, tradeIdentity),
    orderReadAt: readsOrders ? (stamp ?? heldStamp('orderReadAt')) : heldStamp('orderReadAt'),
    tradeReadAt: readsTrades ? (stamp ?? heldStamp('tradeReadAt')) : heldStamp('tradeReadAt'),
    readAt: stamp ?? storedStamp,
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
// When a view was last read across every contract the store holds, or `null` if
// any of them was never read for it. A record from before reads were per
// endpoint carries no per-view stamp, and its own stamp answers for both.
const viewStampOf = (records, key) => {
  const stamps = records.map((record) => {
    const stamp = Object.hasOwn(record, key) ? record[key] : record.readAt
    return Number.isSafeInteger(stamp) ? stamp : null
  })
  return stamps.some(stamp => stamp === null) ? null : Math.min(...stamps)
}

export const restoreFuturesHistoryFromStore = (records) => {
  const usable = asArray(records).filter(record => (
    futuresHistoryContractKey(record?.symbol) !== ''
    && Number.isSafeInteger(record?.readAt)
  ))
  if (usable.length === 0) return null
  const orders = usable.flatMap(record => asArray(record.orders)).sort(newestFirst)
  const trades = usable.flatMap(record => asArray(record.trades)).sort(newestFirst)
  const symbols = [...new Set(usable.map(record => futuresHistoryContractKey(record.symbol)))]
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
    // the desk prints beside ↻. An empty-but-covered contract participates too:
    // "there were no rows" is a reading, not an absence of one.
    readAt: Math.min(...usable.map(record => record.readAt)),
    // A view counts as read only where every restored contract was read for it.
    // One contract read for its fills alone is enough to make the order log
    // worth asking for again, and the desk only re-reads the contracts that
    // need it — the rest are vouched for and cost nothing.
    readViews: Object.freeze({
      orders: viewStampOf(usable, 'orderReadAt'),
      trades: viewStampOf(usable, 'tradeReadAt'),
    }),
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
  write = record => withStore('readwrite', (store, deliver) => {
    store.put(record)
    deliver(true)
  }),
  remove = key => withStore('readwrite', (store, deliver) => {
    store.delete(key)
    deliver(true)
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
    // Which endpoints this reading covered. A reading that does not say covered
    // both, which is what every reading meant before they were split by view.
    const answered = Array.isArray(reading?.views)
      ? reading.views.filter(view => view === 'orders' || view === 'trades')
      : []
    const readsOrders = answered.length === 0 || answered.includes('orders')
    const readsTrades = answered.length === 0 || answered.includes('trades')
    const contracts = splitFuturesHistoryReading(reading)
    const readFrom = reading?.readFrom !== null
      && typeof reading?.readFrom === 'object'
      && !Array.isArray(reading.readFrom)
      ? reading.readFrom
      : null
    if (contracts.length === 0) return false
    try {
      const stored = await readAll()
      if (!Array.isArray(stored)) return false
      const byKey = new Map(stored
        .filter(record => futuresHistoryContractKey(record?.symbol) !== '')
        .map(record => [futuresHistoryContractKey(record.symbol), record]))
      for (const contract of contracts) {
        const hasOrigins = readFrom !== null
          && Object.hasOwn(readFrom, contract.symbol)
          && readFrom[contract.symbol] !== null
          && typeof readFrom[contract.symbol] === 'object'
          && !Array.isArray(readFrom[contract.symbol])
        const origins = hasOrigins ? readFrom[contract.symbol] : {}
        byKey.set(
          contract.symbol,
          mergeFuturesHistoryContract(
            byKey.get(contract.symbol),
            { ...contract, readAt },
            {
              // A cursor-origin page is a gap and joins the stored rows. A null
              // origin (and an old payload with no origins) is a full endpoint
              // reading and must replace that endpoint in persistent state too.
              // An endpoint this reading never looked at replaces nothing: it
              // would replace the stored rows with the nothing it did not read.
              readsOrders,
              readsTrades,
              replaceOrders: readsOrders
                && (!hasOrigins || identityOf(origins.orderCursor) === null),
              replaceTrades: readsTrades
                && (!hasOrigins || identityOf(origins.tradeCursor) === null),
            },
          ),
        )
      }
      const kept = boundFuturesHistoryContracts([...byKey.values()])
      const keptKeys = new Set(kept.map(record => record.key ?? record.symbol))
      for (const record of byKey.values()) {
        const key = record.key ?? record.symbol
        if (!keptKeys.has(key)) {
          const removed = await remove(key)
          if (removed === null || removed === false) return false
        }
      }
      for (const contract of contracts) {
        const record = kept.find(entry => (entry.key ?? entry.symbol) === contract.symbol)
        if (record) {
          const written = await write(record)
          if (written === null || written === false) return false
        }
      }
      return true
    } catch {
      // A review that could not be stored is still a review that was read.
      return false
    }
  },
})

export const futuresHistoryStore = createFuturesHistoryStore()
