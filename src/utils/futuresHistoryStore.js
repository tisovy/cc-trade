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
import { futuresTradeHistoryEvidenceError } from './futuresTradeHistoryEvidence.js'

const DATABASE_NAME = 'FuturesAccountHistory'
// Version one keyed records by symbol alone. Those rows cannot prove which
// authenticated account (or settlement-asset schema) they belong to, and they
// would otherwise survive forever beside the fingerprinted v2 records.
const DATABASE_VERSION = 2
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

const futuresHistoryFingerprint = value => {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-f0-9]{16}$/.test(normalized) ? normalized : null
}

export const futuresHistoryStorageKey = (fingerprint, symbol) => {
  const account = futuresHistoryFingerprint(fingerprint)
  const contract = futuresHistoryContractKey(symbol)
  return account === null || contract === '' ? null : `${account}:${contract}`
}

const isTerminalOrder = order => TERMINAL_FUTURES_ORDER_STATUSES.has(
  String(order?.status ?? '').toUpperCase(),
)

const asArray = value => (Array.isArray(value) ? value : [])
const newestFirst = (left, right) => (Number(right?.time) || 0) - (Number(left?.time) || 0)
const identityOf = value => (
  value === null || value === undefined || value === '' ? null : String(value)
)

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

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

const boundedRows = (rows, keyOf, limit, variantOf = keyOf) => {
  const byVariant = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    const variant = variantOf(row)
    if (key === null || variant === null) continue
    // A row read from the exchange wins over the one already stored: it is the
    // exchange's own record, and the stored one may have been folded in from a
    // stream report that knew less. Distinct immutable trade evidence uses a
    // distinct variant key below, so this replacement cannot erase a conflict.
    byVariant.set(variant, row)
  }
  return Object.freeze([...byVariant.entries()]
    .sort((left, right) => newestFirst(left[1], right[1]) || compareText(left[0], right[0]))
    .slice(0, limit)
    .map(([, row]) => row))
}

const uniqueRowCount = (rows, keyOf) => new Set(
  rows.map(keyOf).filter(key => key !== null),
).size

const retentionLimitedTradeCoverage = (coverage, rows) => {
  if (coverage?.version !== 2) return coverage ?? null
  const oldestRetained = rows
    .map(row => Number.isSafeInteger(row?.time) ? row.time : null)
    .filter(time => time !== null)
    .reduce((oldest, time) => oldest === null ? time : Math.min(oldest, time), null)
  return Object.freeze({
    ...coverage,
    coveredFrom: oldestRetained === null
      ? coverage.coveredFrom
      : Math.max(coverage.coveredFrom ?? oldestRetained, oldestRetained),
    complete: false,
    retentionLimited: true,
  })
}

const cursorOf = (rows, keyOf) => rows.reduce(
  (highest, row) => higherIdentity(highest, keyOf(row)),
  null,
)

const orderIdentity = order => identityOf(order?.orderId)
const tradeIdentity = trade => identityOf(trade?.id)

const TRADE_EVIDENCE_FIELDS = Object.freeze([
  'id',
  'orderId',
  'symbol',
  'side',
  'positionSide',
  'price',
  'quantity',
  'quoteQty',
  'realizedPnl',
  'commission',
  'commissionAsset',
  'marginAsset',
  'maker',
  'buyer',
  'time',
])
const TRADE_EVIDENCE_SIGNATURE_TEXT_LIMIT = 512

const boundedEvidenceValue = (value) => {
  if (value === null) return Object.freeze(['null'])
  const kind = typeof value
  if (kind === 'string') {
    return value.length <= TRADE_EVIDENCE_SIGNATURE_TEXT_LIMIT
      ? Object.freeze([kind, value])
      : Object.freeze([kind, 'oversized', value.length])
  }
  if (kind === 'number' || kind === 'bigint' || kind === 'boolean') {
    return Object.freeze([kind, String(value)])
  }
  if (kind === 'undefined') return Object.freeze([kind])
  // Non-scalar exchange evidence is already invalid. One bounded marker keeps
  // it as a continuity barrier without serializing attacker-controlled graphs.
  return Object.freeze([kind, 'non-scalar'])
}

const tradeEvidenceVariant = (trade) => {
  const identity = tradeIdentity(trade)
  if (identity === null) return null
  const source = trade !== null && typeof trade === 'object' ? trade : {}
  return JSON.stringify([
    identity,
    ...TRADE_EVIDENCE_FIELDS.map((field) => {
      const present = Object.hasOwn(source, field)
      return Object.freeze([
        field,
        present,
        boundedEvidenceValue(present ? source[field] : undefined),
      ])
    }),
  ])
}

const tradeSettlementEvidenceIsCurrent = (trades, expectedSymbol) => {
  const variantsByIdentity = new Map()
  for (const trade of asArray(trades)) {
    if (futuresTradeHistoryEvidenceError(trade, { expectedSymbol }) !== null) return false
    const identity = tradeIdentity(trade)
    const variant = tradeEvidenceVariant(trade)
    if (identity === null || variant === null) return false
    const previous = variantsByIdentity.get(identity)
    if (previous !== undefined && previous !== variant) return false
    variantsByIdentity.set(identity, variant)
  }
  return true
}

/**
 * What one contract is known to hold, after a read that covered it.
 *
 * Only terminal rows are stored: a working order is not history, and storing one
 * would present it as settled in the next run, when the exchange may have filled
 * or cancelled it while the desk was closed.
 */
export const mergeFuturesHistoryContract = (stored, {
  fingerprint = null,
  symbol,
  orders = [],
  trades = [],
  tradeCoverage = null,
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
  const account = futuresHistoryFingerprint(fingerprint ?? stored?.fingerprint)
  const symbolKey = futuresHistoryContractKey(symbol ?? stored?.symbol)
  const key = futuresHistoryStorageKey(account, symbolKey) ?? symbolKey
  const storedStamp = Number.isSafeInteger(stored?.readAt) ? stored.readAt : null
  // A record written before reads were per endpoint has no per-view stamp, and
  // every read behind it covered both — so its own stamp stands for both.
  const heldStamp = name => (Object.hasOwn(stored ?? {}, name) ? stored[name] : storedStamp)
  const stamp = Number.isSafeInteger(readAt) ? readAt : null
  const accepts = name => {
    const held = Number.isSafeInteger(heldStamp(name)) ? heldStamp(name) : null
    return stamp === null || held === null || stamp >= held
  }
  const acceptsOrders = readsOrders && accepts('orderReadAt')
  const acceptsTrades = readsTrades && accepts('tradeReadAt')
  const mergedOrders = boundedRows(
    [
      ...(replaceOrders && acceptsOrders ? [] : asArray(stored?.orders)),
      ...(acceptsOrders ? asArray(orders).filter(isTerminalOrder) : []),
    ],
    orderIdentity,
    maxOrders,
  )
  const tradeCandidates = [
    ...(replaceTrades && acceptsTrades ? [] : asArray(stored?.trades)),
    ...(acceptsTrades ? asArray(trades) : []),
  ]
  const mergedTrades = boundedRows(
    tradeCandidates,
    tradeIdentity,
    maxTrades,
    tradeEvidenceVariant,
  )
  const tradesTruncated = uniqueRowCount(tradeCandidates, tradeEvidenceVariant) > maxTrades
  return Object.freeze({
    version: 2,
    key,
    fingerprint: account,
    symbol: symbolKey,
    orders: mergedOrders,
    trades: mergedTrades,
    // What the contract is covered up to: the identities the next read pages
    // forward from, and when the reading was taken.
    orderCursor: cursorOf(mergedOrders, orderIdentity),
    tradeCursor: cursorOf(mergedTrades, tradeIdentity),
    tradeCoverage: (() => {
      const selected = acceptsTrades
        ? (tradeCoverage?.version === 2 ? Object.freeze({ ...tradeCoverage }) : null)
        : stored?.tradeCoverage ?? null
      return tradesTruncated
        ? retentionLimitedTradeCoverage(selected, mergedTrades)
        : selected
    })(),
    orderReadAt: acceptsOrders ? (stamp ?? heldStamp('orderReadAt')) : heldStamp('orderReadAt'),
    tradeReadAt: acceptsTrades ? (stamp ?? heldStamp('tradeReadAt')) : heldStamp('tradeReadAt'),
    readAt: storedStamp === null
      ? stamp
      : stamp === null ? storedStamp : Math.max(storedStamp, stamp),
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

export const restoreFuturesHistoryFromStore = (records, { fingerprint = null } = {}) => {
  const account = futuresHistoryFingerprint(fingerprint)
  const usable = asArray(records).filter(record => (
    futuresHistoryContractKey(record?.symbol) !== ''
    && Number.isSafeInteger(record?.readAt)
    && (account === null || futuresHistoryFingerprint(record?.fingerprint) === account)
  ))
  if (usable.length === 0) return null
  const orders = usable.flatMap(record => asArray(record.orders)).sort(newestFirst)
  const trades = usable.flatMap(record => asArray(record.trades)).sort(newestFirst)
  const symbols = [...new Set(usable.map(record => futuresHistoryContractKey(record.symbol)))]
  return Object.freeze({
    ...createHeldFuturesHistory(),
    version: 2,
    generation: 1,
    // Restored fills are a real trade-evidence transition from the hook's
    // initially memoized empty snapshot. Keep this revision independent from
    // the general history generation so Closed/wallet folds run immediately
    // without making order-only reads invalidate them later.
    tradeGeneration: trades.length > 0 ? 1 : 0,
    accountFingerprint: account,
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
    lastResponseAt: Math.max(...usable.map(record => record.readAt)),
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
      Object.freeze((() => {
        // History saved before Binance's `marginAsset` field was carried into
        // the store still has useful fill identities, but it cannot denominate
        // realized PnL. Do not let its old cursor vouch for exact money: a cold
        // bounded read replaces the contract with asset-bearing REST rows.
        const settlementEvidenceCurrent = tradeSettlementEvidenceIsCurrent(
          record.trades,
          futuresHistoryContractKey(record.symbol),
        )
        return {
        readAt: record.readAt,
        orderReadAt: Number.isSafeInteger(record.orderReadAt)
          ? record.orderReadAt
          : record.readAt,
        tradeReadAt: Number.isSafeInteger(record.tradeReadAt)
          ? record.tradeReadAt
          : record.readAt,
        orderCursor: identityOf(record.orderCursor),
        tradeCursor: settlementEvidenceCurrent ? identityOf(record.tradeCursor) : null,
        tradeCoverage: settlementEvidenceCurrent && record?.tradeCoverage?.version === 2
          ? Object.freeze({ ...record.tradeCoverage })
          : null,
        generation: 1,
        }
      })()),
    ]))),
  })
}

const closeDatabase = (database) => {
  try {
    database?.close()
  } catch {
    // Closing is best-effort. The transaction result is still authoritative.
  }
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
  let settled = false
  const finish = (database) => {
    if (settled) {
      // `blocked` deliberately degrades to no store. If the blocker disappears
      // later, close that late connection rather than leaking an unused handle.
      closeDatabase(database)
      return
    }
    settled = true
    resolve(database)
  }
  request.onupgradeneeded = () => {
    const database = request.result
    if (database.objectStoreNames.contains(STORE_NAME)) database.deleteObjectStore(STORE_NAME)
    database.createObjectStore(STORE_NAME, { keyPath: 'key' })
  }
  request.onsuccess = () => finish(request.result)
  request.onerror = () => finish(null)
  request.onblocked = () => finish(null)
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
      const abort = () => {
        try {
          transaction.abort()
        } catch {
          resolve(null)
        }
      }
      try {
        run(store, (value) => { result = value }, abort)
      } catch {
        abort()
      }
    })
  } catch {
    // Unavailable, corrupted, or refused: the review is read from the exchange
    // exactly as it is without a store.
    return null
  } finally {
    closeDatabase(database)
  }
}

const readAllStoredContracts = () => withStore('readonly', (store, deliver) => {
  const request = store.getAll()
  request.onsuccess = () => deliver(Array.isArray(request.result) ? request.result : [])
})

const writeStoredContract = record => withStore('readwrite', (store, deliver) => {
  store.put(record)
  deliver(true)
})

const removeStoredContract = key => withStore('readwrite', (store, deliver) => {
  store.delete(key)
  deliver(true)
})

// A single read/write transaction is both the atomic commit and the lock shared
// by separate renderer globals. IndexedDB runs overlapping transactions for the
// same object store serially, so the planner always sees the latest committed
// contracts before it queues the matching prune and writes.
const mutateStoredContracts = plan => withStore('readwrite', (store, deliver, abort) => {
  const request = store.getAll()
  request.onerror = abort
  request.onsuccess = () => {
    let mutation
    try {
      mutation = plan(Array.isArray(request.result) ? request.result : [])
      if (mutation === null || typeof mutation !== 'object') {
        abort()
        return
      }
      for (const key of asArray(mutation.removeKeys)) store.delete(key)
      for (const record of asArray(mutation.writeRecords)) store.put(record)
      deliver(true)
    } catch {
      abort()
    }
  }
})

/**
 * A store the review can call without ever having to handle its failure.
 *
 * Every path answers "nothing stored" rather than raising, and a write that
 * cannot happen is reported as `false` rather than as an error the panel would
 * have to explain.
 */
export const createFuturesHistoryStore = (options = {}) => {
  const readAll = typeof options.readAll === 'function'
    ? options.readAll
    : readAllStoredContracts
  const write = typeof options.write === 'function'
    ? options.write
    : writeStoredContract
  const remove = typeof options.remove === 'function'
    ? options.remove
    : removeStoredContract
  const hasInjectedLegacyAdapter = ['readAll', 'write', 'remove']
    .some(name => Object.hasOwn(options, name))
  const mutate = typeof options.mutate === 'function'
    ? options.mutate
    : hasInjectedLegacyAdapter ? null : mutateStoredContracts
  // IndexedDB's individual transactions are atomic, but the old read/merge/write
  // sequence spanned several of them. Two history answers finishing together
  // could both read the same old record and the later write would erase the
  // first answer. Serialize that composite operation per store instance.
  let writeQueue = Promise.resolve()

  const readContracts = async (fingerprint = null) => {
    const account = futuresHistoryFingerprint(fingerprint)
    if (account === null) return []
    try {
      const records = await readAll()
      if (!Array.isArray(records) || records.length === 0) return []
      return boundFuturesHistoryContracts(
        records.filter(record => (
          futuresHistoryContractKey(record?.symbol) !== ''
          && futuresHistoryFingerprint(record?.fingerprint) === account
        )),
      )
    } catch {
      return []
    }
  }

  const writeReadingNow = async (reading) => {
    const fingerprint = futuresHistoryFingerprint(reading?.accountFingerprint)
    if (fingerprint === null) return false
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
    const tradeCoverage = reading?.tradeCoverage !== null
      && typeof reading?.tradeCoverage === 'object'
      && !Array.isArray(reading.tradeCoverage)
      ? reading.tradeCoverage
      : {}
    const merge = reading?.merge !== null
      && typeof reading?.merge === 'object'
      && !Array.isArray(reading.merge)
      ? reading.merge
      : {}
    if (contracts.length === 0) return false
    const planMutation = (stored) => {
      if (!Array.isArray(stored)) return null
      const byKey = new Map(stored
        .filter(record => (
          futuresHistoryContractKey(record?.symbol) !== ''
          && futuresHistoryFingerprint(record?.fingerprint) === fingerprint
        ))
        .map(record => [futuresHistoryContractKey(record.symbol), record]))
      for (const contract of contracts) {
        const hasOrigins = readFrom !== null
          && Object.hasOwn(readFrom, contract.symbol)
          && readFrom[contract.symbol] !== null
          && typeof readFrom[contract.symbol] === 'object'
          && !Array.isArray(readFrom[contract.symbol])
        const origins = hasOrigins ? readFrom[contract.symbol] : {}
        const mergeMode = merge[contract.symbol] !== null
          && typeof merge[contract.symbol] === 'object'
          && !Array.isArray(merge[contract.symbol])
          ? merge[contract.symbol]
          : {}
        byKey.set(
          contract.symbol,
          mergeFuturesHistoryContract(
            byKey.get(contract.symbol),
            {
              ...contract,
              fingerprint,
              readAt,
              tradeCoverage: tradeCoverage[contract.symbol] ?? null,
            },
            {
              // A cursor-origin page is a gap and joins the stored rows. A null
              // origin (and an old payload with no origins) is a full endpoint
              // reading and must replace that endpoint in persistent state too.
              // An endpoint this reading never looked at replaces nothing: it
              // would replace the stored rows with the nothing it did not read.
              readsOrders,
              readsTrades,
              replaceOrders: readsOrders
                && mergeMode.orders !== true
                && (!hasOrigins || identityOf(origins.orderCursor) === null),
              replaceTrades: readsTrades
                && mergeMode.trades !== true
                && (!hasOrigins || identityOf(origins.tradeCursor) === null),
            },
          ),
        )
      }
      const kept = boundFuturesHistoryContracts([...byKey.values()])
      const keptKeys = new Set(kept.map(record => record.key))
      // The physical store is one active account cache, not 24 records per API
      // key ever used by this profile. Reading with `getAll` clones every record
      // before the fingerprint filter can run, so foreign and legacy namespaces
      // must be removed too rather than merely hidden from the current account.
      return Object.freeze({
        removeKeys: Object.freeze(stored
          .map(record => identityOf(record?.key))
          .filter(key => key !== null && !keptKeys.has(key))),
        writeRecords: Object.freeze(contracts
          .map(contract => kept.find(entry => entry.symbol === contract.symbol))
          .filter(record => record !== undefined)),
      })
    }
    try {
      if (mutate !== null) {
        const persisted = await mutate(planMutation)
        return persisted !== null && persisted !== false
      }
      const mutation = planMutation(await readAll())
      if (mutation === null) return false
      for (const key of mutation.removeKeys) {
        const removed = await remove(key)
        if (removed === null || removed === false) return false
      }
      for (const record of mutation.writeRecords) {
        const written = await write(record)
        if (written === null || written === false) return false
      }
      return true
    } catch {
      // A review that could not be stored is still a review that was read.
      return false
    }
  }

  const writeReading = (reading) => {
    const pending = writeQueue.then(
      () => writeReadingNow(reading),
      () => writeReadingNow(reading),
    )
    writeQueue = pending.then(() => undefined, () => undefined)
    return pending
  }

  return { readContracts, writeReading }
}

export const futuresHistoryStore = createFuturesHistoryStore()
