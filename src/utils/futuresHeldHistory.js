// The account review is a reading the desk holds, not a query it runs.
//
// Opening it costs an account-wide fan-out — twenty-five REST requests through
// one admission queue — and the desk used to pay it on every click of a tab,
// blanking the rows the operator was reading while it waited. The past does not
// change, though. What changes is that entries are added to its end, and those
// arrive on the user-data stream the desk is already listening to.
//
// So this module holds what was read, folds the stream into it, and replaces it
// only when an answer to an explicit read arrives.

export const TERMINAL_FUTURES_ORDER_STATUSES = Object.freeze(new Set([
  'CANCELED',
  'CANCELLED',
  'EXPIRED',
  'FILLED',
  'FINISHED',
  'REJECTED',
]))

// Shared by the live held review and its persistent store. Gap pages and stream
// folds must not turn a bounded review into session-long unbounded memory.
export const FUTURES_HELD_HISTORY_MAX_ORDERS_PER_CONTRACT = 200
export const FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT = 1_000

export const createHeldFuturesHistory = () => Object.freeze({
  symbol: null,
  status: 'idle',
  orders: Object.freeze([]),
  trades: Object.freeze([]),
  // Which contracts the read covered, and how many the account actually traded
  // in the window. Both describe the *read*, so neither is ever widened by an
  // entry the stream folded in.
  symbols: Object.freeze([]),
  discovered: 0,
  // Whether that count is the whole set. Discovery can fail, or run out of pages
  // on a week busier than the walk is bounded to.
  discoveryComplete: true,
  error: null,
  // When the held rows were read. `null` means nothing has ever been read, which
  // is the one case where an empty panel is honest.
  readAt: null,
  // What each contract is covered up to, keyed by contract: the identities the
  // exchange pages from and when that contract was last read. Filled from the
  // local store, which is what holds the review across runs.
  coverage: Object.freeze({}),
  // Identities the stream added since the read. Kept apart so the panel can say
  // so, and so a later read can tell what it is allowed to drop.
  foldedOrders: Object.freeze([]),
  foldedTrades: Object.freeze([]),
})

const asArray = value => (Array.isArray(value) ? value : [])
const isHeld = history => history?.readAt !== null && history?.readAt !== undefined

export const futuresHistoryOrderKey = order => `${order?.symbol ?? ''}:${order?.orderId ?? ''}`
export const futuresHistoryTradeKey = trade => `${trade?.symbol ?? ''}:${trade?.id ?? ''}`

const contractOf = row => String(row?.symbol ?? '').toUpperCase()

const newestFirst = (left, right) => (Number(right?.time) || 0) - (Number(left?.time) || 0)

const boundNewestByContract = (rows, limit) => {
  const counts = new Map()
  return rows.filter((row) => {
    const contract = contractOf(row)
    const count = counts.get(contract) ?? 0
    if (count >= limit) return false
    counts.set(contract, count + 1)
    return true
  })
}

const identityOf = value => (
  value === null || value === undefined || value === '' ? null : String(value)
)

const higherIdentity = (left, right) => {
  if (left === null) return right
  if (right === null) return left
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    return BigInt(left) >= BigInt(right) ? left : right
  }
  return left
}

const cursorOf = (rows, keyOf) => rows.reduce(
  (highest, row) => higherIdentity(highest, identityOf(keyOf(row))),
  null,
)

const orderIdentity = order => order?.orderId
const tradeIdentity = trade => trade?.id

// Read rows win over folded ones: the exchange's own record of an order is more
// complete than the report that announced it.
//
// What survives a read is the second half of it, and it is what makes this a
// review rather than a snapshot. The account read is a fan-out over a bounded
// set of contracts — twelve at most, discovered from income, and any of them may
// come back as a failure — so two reads minutes apart can cover different
// contracts. Replacing everything with what the newer one returned deletes the
// rows of every contract it did not reach: a position closed an hour ago
// vanished from the closed-position list because the contract it was on no
// longer had a position or a working order to put it back in the read.
//
// A full endpoint read replaces the contract it covered. A gap read appends to
// that contract instead, while a contract the read did not cover keeps what the
// last read that did cover it said. The past does not change, and a completed
// trade is not un-completed by a narrower look.
const mergeRows = (readRows, heldRows, foldedKeys, keyOf, covered, incremental, limit) => {
  const read = new Set(readRows.map(keyOf))
  const survivors = heldRows.filter((row) => {
    if (read.has(keyOf(row))) return false
    return foldedKeys.has(keyOf(row))
      || !covered.has(contractOf(row))
      || incremental.has(contractOf(row))
  })
  const rows = boundNewestByContract(
    [...readRows, ...survivors].sort(newestFirst),
    limit,
  )
  const retained = new Set(rows.map(keyOf))
  const retainedSurvivors = survivors.filter(row => retained.has(keyOf(row)))
  return {
    rows: Object.freeze(rows),
    // Only what the stream added is still counted as added: a row held because
    // this read did not look at its contract was read, and saying otherwise
    // would inflate the "added since" the panel states.
    folded: Object.freeze(retainedSurvivors
      .filter(row => foldedKeys.has(keyOf(row)))
      .map(keyOf)),
    // Contracts whose rows are here because an *earlier read* covered them. A
    // folded row's contract is not one of these: the stream is not a read, and
    // the scope statement beneath the table counts reads.
    carried: retainedSurvivors
      .filter(row => !foldedKeys.has(keyOf(row)))
      .map(contractOf),
  }
}

/**
 * A read has been asked for. The rows already held stay on screen: emptying them
 * makes the operator wait again for what they were already reading.
 */
export const beginFuturesHistoryRead = (history, { symbol, sent }) => {
  const held = isHeld(history)
  return Object.freeze({
    ...history,
    symbol: symbol ?? history.symbol,
    status: sent
      ? (held ? 'refreshing' : 'loading')
      : (held ? 'ready' : 'error'),
    // A failure to send is stated beside the held rows, never in place of them.
    error: sent ? null : { code: 'LOCAL_CONNECTION_UNAVAILABLE' },
  })
}

/**
 * The read answered. A failure keeps the held reading and states itself beside
 * it; success replaces the rows and carries the time it was taken.
 */
export const applyFuturesHistoryReading = (history, payload, now) => {
  const held = isHeld(history)
  if (payload?.error) {
    return Object.freeze({
      ...history,
      symbol: typeof payload.symbol === 'string' ? payload.symbol : history.symbol,
      status: held ? 'ready' : 'error',
      error: payload.error,
    })
  }
  // Which contracts this read actually looked at. A payload that does not say —
  // an older backend, or a read that named none — is taken at face value for the
  // contracts its rows mention, which is the behaviour that was there before.
  const readOrders = asArray(payload?.orders)
  const readTrades = asArray(payload?.trades)
  const named = asArray(payload?.symbols)
    .map(entry => String(entry ?? '').toUpperCase())
    .filter(Boolean)
  const read = [...new Set(named.length > 0
    ? named
    : [...readOrders, ...readTrades].map(contractOf).filter(Boolean))]
  const covered = new Set(read)
  const readFrom = payload?.readFrom !== null
    && typeof payload?.readFrom === 'object'
    && !Array.isArray(payload.readFrom)
    ? payload.readFrom
    : {}
  const incrementalOrders = new Set(read.filter(symbol => (
    identityOf(readFrom[symbol]?.orderCursor) !== null
  )))
  const incrementalTrades = new Set(read.filter(symbol => (
    identityOf(readFrom[symbol]?.tradeCursor) !== null
  )))
  const orders = mergeRows(
    readOrders,
    history.orders,
    new Set(history.foldedOrders),
    futuresHistoryOrderKey,
    covered,
    incrementalOrders,
    FUTURES_HELD_HISTORY_MAX_ORDERS_PER_CONTRACT,
  )
  const trades = mergeRows(
    readTrades,
    history.trades,
    new Set(history.foldedTrades),
    futuresHistoryTradeKey,
    covered,
    incrementalTrades,
    FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT,
  )
  const coverage = { ...(history.coverage ?? {}) }
  for (const symbol of read) {
    const previous = coverage[symbol] ?? {}
    const orderCursor = cursorOf(
      readOrders.filter(row => contractOf(row) === symbol),
      orderIdentity,
    )
    const tradeCursor = cursorOf(
      readTrades.filter(row => contractOf(row) === symbol),
      tradeIdentity,
    )
    coverage[symbol] = Object.freeze({
      readAt: now,
      orderCursor: incrementalOrders.has(symbol)
        ? higherIdentity(identityOf(previous.orderCursor), orderCursor)
        : orderCursor,
      tradeCursor: incrementalTrades.has(symbol)
        ? higherIdentity(identityOf(previous.tradeCursor), tradeCursor)
        : tradeCursor,
    })
  }
  const frozenCoverage = Object.freeze(coverage)
  // Every contract the review now covers, each of them from a read that happened
  // — this one, or the one that last reached it. Stating only this read's set
  // would undercount a panel that is showing more than this read returned.
  const symbols = [...new Set([
    ...Object.keys(frozenCoverage),
    ...read,
    ...orders.carried,
    ...trades.carried,
  ])]
    .filter(symbol => symbol !== '')
  const discovered = Number.isSafeInteger(payload?.discovered) ? payload.discovered : 0
  const stamps = Object.values(frozenCoverage)
    .map(entry => entry?.readAt)
    .filter(Number.isSafeInteger)
  return Object.freeze({
    ...history,
    symbol: typeof payload?.symbol === 'string' ? payload.symbol : history.symbol,
    status: 'ready',
    orders: orders.rows,
    trades: trades.rows,
    foldedOrders: orders.folded,
    foldedTrades: trades.folded,
    symbols: Object.freeze(symbols),
    discovered: Math.max(discovered, symbols.length),
    discoveryComplete: payload?.discoveryComplete !== false,
    error: null,
    readAt: stamps.length > 0 ? Math.min(...stamps) : now,
    coverage: frozenCoverage,
  })
}

const orderRowFromReport = report => Object.freeze({
  orderId: report.orderId ?? report.i ?? null,
  clientOrderId: report.clientOrderId ?? report.c ?? null,
  symbol: report.symbol ?? report.s ?? null,
  side: report.side ?? report.S ?? null,
  positionSide: report.positionSide ?? 'BOTH',
  type: report.type ?? report.o ?? null,
  status: String(report.status ?? report.X ?? '').toUpperCase(),
  price: report.price ?? report.p ?? '0',
  averagePrice: report.avgPrice ?? '0',
  origQty: report.origQty ?? report.q ?? '0',
  executedQty: report.executedQty ?? report.z ?? '0',
  quoteQty: '0',
  reduceOnly: report.reduceOnly === true,
  time: Number(report.time ?? report.T) || 0,
})

const tradeRowFromReport = report => Object.freeze({
  id: report.tradeId ?? null,
  orderId: report.orderId ?? report.i ?? null,
  symbol: report.symbol ?? report.s ?? null,
  side: report.side ?? report.S ?? null,
  positionSide: report.positionSide ?? 'BOTH',
  price: report.lastFilledPrice ?? report.price ?? '0',
  quantity: report.lastFilledQty ?? report.l ?? '0',
  quoteQty: '0',
  realizedPnl: report.realizedPnl ?? '0',
  commission: report.commission ?? '0',
  commissionAsset: report.commissionAsset ?? null,
  maker: report.maker === true,
  time: Number(report.time ?? report.T) || 0,
})

const upsert = (rows, folded, row, keyOf, limit) => {
  const key = keyOf(row)
  const without = rows.filter(existing => keyOf(existing) !== key)
  const bounded = boundNewestByContract([row, ...without].sort(newestFirst), limit)
  const retained = new Set(bounded.map(keyOf))
  const nextFolded = folded.filter(entry => retained.has(entry))
  return {
    rows: Object.freeze(bounded),
    // Recorded once: an identity already folded in stays folded, and a second
    // report about the same order replaces the row rather than adding one.
    folded: Object.freeze(!retained.has(key) || nextFolded.includes(key)
      ? nextFolded
      : [...nextFolded, key]),
  }
}

const isFill = report => (
  (report?.tradeId ?? null) !== null && Number(report?.lastFilledQty ?? report?.l) > 0
)

/**
 * Fold what the stream reports into the held reading.
 *
 * Only into a reading that exists: with nothing read, a lone folded row would
 * present itself as an account review, and the scope statement beneath it would
 * describe a read that never happened.
 */
export const foldExecutionIntoFuturesHistory = (history, report) => {
  if (!isHeld(history) || !report) return history
  let next = history
  if (TERMINAL_FUTURES_ORDER_STATUSES.has(String(report.status ?? report.X ?? '').toUpperCase())
    && (report.orderId ?? report.i ?? null) !== null) {
    const merged = upsert(
      next.orders,
      next.foldedOrders,
      orderRowFromReport(report),
      futuresHistoryOrderKey,
      FUTURES_HELD_HISTORY_MAX_ORDERS_PER_CONTRACT,
    )
    next = Object.freeze({ ...next, orders: merged.rows, foldedOrders: merged.folded })
  }
  if (isFill(report)) {
    const merged = upsert(
      next.trades,
      next.foldedTrades,
      tradeRowFromReport(report),
      futuresHistoryTradeKey,
      FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT,
    )
    next = Object.freeze({ ...next, trades: merged.rows, foldedTrades: merged.folded })
  }
  return next
}
