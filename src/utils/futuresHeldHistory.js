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
// Dense contracts are acquired by bounded time-window subdivision. Keeping the
// old single-page ceiling here would throw the recovered opening fill away
// immediately and make the backend backfill pure request waste.
export const FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT = 8_000

export const createHeldFuturesHistory = () => Object.freeze({
  version: 2,
  generation: 0,
  // Trade consumers are deliberately isolated from order-only history reads.
  // This revision advances only when fill rows or their coverage can change.
  tradeGeneration: 0,
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
  // Discovery and endpoint reads can finish out of order. Their request stamps
  // are kept separately so a newer narrow fill read does not erase an older,
  // still useful order answer — while an older discovery cannot regress the
  // account-wide scope statement.
  discoveryReadAt: null,
  lastResponseAt: null,
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
  // When each view was last answered by a read, or `null` for a view no read has
  // ever covered. A review reads the endpoint the open view needs, so the view
  // the operator has not opened is genuinely unread — and this is what says so,
  // rather than an empty list that looks like "nothing happened".
  readViews: Object.freeze({ orders: null, trades: null }),
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

const truncatedContractsOf = (rows, keyOf, limit) => {
  const counts = new Map()
  const seen = new Set()
  const truncated = new Set()
  for (const row of rows) {
    const key = keyOf(row)
    if (seen.has(key)) continue
    seen.add(key)
    const contract = contractOf(row)
    const count = (counts.get(contract) ?? 0) + 1
    counts.set(contract, count)
    if (count > limit) truncated.add(contract)
  }
  return truncated
}

const retentionLimitedCoverage = (coverage, rows, symbol) => {
  const oldestRetained = rows
    .filter(row => contractOf(row) === symbol)
    .map(row => coverageTime(row?.time))
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

const identityOf = value => (
  value === null || value === undefined || value === '' ? null : String(value)
)

const coverageTime = value => (
  Number.isSafeInteger(value) && value >= 0 ? value : null
)

const advanceGeneration = value => (
  Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER
    ? value + 1
    : 1
)

const readTradeCoverage = (value, rows, now) => {
  if (value?.version === 2) {
    const targetFrom = coverageTime(value.targetFrom)
    const targetTo = coverageTime(value.targetTo)
    const coveredFrom = coverageTime(value.coveredFrom)
    const coveredTo = coverageTime(value.coveredTo)
    const statedFlatBoundary = value.flatBoundary === true
      ? true
      : coverageTime(value.flatBoundary)
    const flatBoundary = statedFlatBoundary === true
      ? true
      : statedFlatBoundary !== null
        && coveredFrom !== null
        && statedFlatBoundary <= coveredFrom
        ? statedFlatBoundary
        : false
    return Object.freeze({
      version: 2,
      targetFrom,
      targetTo,
      coveredFrom,
      coveredTo,
      complete: value.complete === true
        && targetFrom !== null
        && targetTo !== null
        && coveredFrom !== null
        && coveredTo !== null
        && coveredFrom <= targetFrom
        && coveredTo >= targetTo,
      pageLimited: value.pageLimited === true,
      retentionLimited: value.retentionLimited === true,
      continuityComplete: value.continuityComplete === true,
      flatBoundary,
    })
  }
  // A v1 reading still contributes its canonical fills, but its one-page shape
  // cannot prove the opening boundary. Fail closed and let the round fold prove
  // any later flat boundary from the fills themselves.
  return Object.freeze({
    version: 2,
    targetFrom: null,
    targetTo: now,
    coveredFrom: null,
    coveredTo: now,
    complete: false,
    pageLimited: rows.length >= 1_000,
    retentionLimited: false,
    continuityComplete: false,
  })
}

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
  const candidates = [...readRows, ...survivors].sort(newestFirst)
  const truncatedContracts = truncatedContractsOf(candidates, keyOf, limit)
  const rows = boundNewestByContract(candidates, limit)
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
    truncatedContracts,
  }
}

const retainUntouchedRows = (rows, folded, symbols) => ({
  rows,
  folded,
  // The prior scope already names every endpoint read being retained. Reusing
  // it avoids an O(rows) scan merely to reconstruct the same carried symbols.
  carried: asArray(symbols),
  truncatedContracts: new Set(),
})

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
  const responseAt = coverageTime(payload?.readAt) ?? coverageTime(now)
  if (responseAt === null) return history
  const rawOrders = asArray(payload?.orders)
  const rawTrades = asArray(payload?.trades)
  const named = asArray(payload?.symbols)
    .map(entry => String(entry ?? '').toUpperCase())
    .filter(Boolean)
  const requested = [...new Set(named.length > 0
    ? named
    : [...rawOrders, ...rawTrades].map(contractOf).filter(Boolean))]
  const answered = asArray(payload?.views).filter(view => (
    view === 'orders' || view === 'trades'
  ))
  const views = answered.length > 0 ? answered : ['orders', 'trades']
  const endpointStamp = (symbol, view) => {
    const coverage = history?.coverage?.[symbol] ?? null
    const key = `${view.slice(0, -1)}ReadAt`
    // A v2 null means this endpoint has never answered. Only a legacy record
    // with no endpoint field at all lets the old aggregate stamp stand for it.
    return Object.hasOwn(coverage ?? {}, key)
      ? coverageTime(coverage[key])
      : coverageTime(coverage?.readAt)
  }
  const acceptsEndpoint = (symbol, view) => {
    const previous = endpointStamp(symbol, view)
    return previous === null || responseAt >= previous
  }
  if (payload?.error) {
    // An error carries no rows worth merging. Once a later response has landed,
    // surfacing an older request's failure only makes the panel move backwards.
    if (coverageTime(history?.lastResponseAt) > responseAt) return history
    const relevant = requested.length === 0 || requested.some(symbol => (
      views.some(view => acceptsEndpoint(symbol, view))
    ))
    if (!relevant) return history
    return Object.freeze({
      ...history,
      symbol: typeof payload.symbol === 'string' ? payload.symbol : history.symbol,
      status: held ? 'ready' : 'error',
      error: payload.error,
      lastResponseAt: Math.max(history?.lastResponseAt ?? responseAt, responseAt),
    })
  }
  // Which contracts this read actually looked at. A payload that does not say —
  // an older backend, or a read that named none — is taken at face value for the
  // contracts its rows mention, which is the behaviour that was there before.
  const acceptedOrders = new Set(views.includes('orders')
    ? requested.filter(symbol => acceptsEndpoint(symbol, 'orders'))
    : [])
  const acceptedTrades = new Set(views.includes('trades')
    ? requested.filter(symbol => acceptsEndpoint(symbol, 'trades'))
    : [])
  const read = [...new Set([...acceptedOrders, ...acceptedTrades])]
  const discoveryStamp = coverageTime(history?.discoveryReadAt)
  const acceptsDiscovery = payload?.basisOnly !== true
    && (discoveryStamp === null || responseAt >= discoveryStamp)
  if (read.length === 0 && !acceptsDiscovery) return history
  const readOrders = rawOrders.filter(row => acceptedOrders.has(contractOf(row)))
  const readTrades = rawTrades.filter(row => acceptedTrades.has(contractOf(row)))
  // Which endpoints this answer is about. A read of the fills covers a contract's
  // fills and nothing else, so its order log is not "covered and empty" — it is
  // untouched, and the rows already held for it stay exactly where they are.
  // A payload that does not say covers both, which is what it used to mean.
  const coveredOrders = acceptedOrders
  const coveredTrades = acceptedTrades
  const readFrom = payload?.readFrom !== null
    && typeof payload?.readFrom === 'object'
    && !Array.isArray(payload.readFrom)
    ? payload.readFrom
    : {}
  const merge = payload?.merge !== null
    && typeof payload?.merge === 'object'
    && !Array.isArray(payload.merge)
    ? payload.merge
    : {}
  const readTradeCoverageBySymbol = payload?.tradeCoverage !== null
    && typeof payload?.tradeCoverage === 'object'
    && !Array.isArray(payload.tradeCoverage)
    ? payload.tradeCoverage
    : {}
  const incrementalOrders = new Set(read.filter(symbol => (
    identityOf(readFrom[symbol]?.orderCursor) !== null
      || merge[symbol]?.orders === true
  )))
  const incrementalTrades = new Set(read.filter(symbol => (
    identityOf(readFrom[symbol]?.tradeCursor) !== null
      || merge[symbol]?.trades === true
  )))
  const orders = coveredOrders.size === 0
    ? retainUntouchedRows(history.orders, history.foldedOrders, history.symbols)
    : mergeRows(
      readOrders,
      history.orders,
      new Set(history.foldedOrders),
      futuresHistoryOrderKey,
      coveredOrders,
      incrementalOrders,
      FUTURES_HELD_HISTORY_MAX_ORDERS_PER_CONTRACT,
    )
  const trades = coveredTrades.size === 0
    ? retainUntouchedRows(history.trades, history.foldedTrades, history.symbols)
    : mergeRows(
      readTrades,
      history.trades,
      new Set(history.foldedTrades),
      futuresHistoryTradeKey,
      coveredTrades,
      incrementalTrades,
      FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT,
    )
  const coverage = { ...(history.coverage ?? {}) }
  const generation = advanceGeneration(history?.generation)
  const tradeGeneration = coveredTrades.size > 0
    ? advanceGeneration(history?.tradeGeneration)
    : Number.isSafeInteger(history?.tradeGeneration) && history.tradeGeneration >= 0
      ? history.tradeGeneration
      : 0
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
    const nextTradeCoverage = !coveredTrades.has(symbol)
      ? previous.tradeCoverage ?? null
      : readTradeCoverage(
        readTradeCoverageBySymbol[symbol],
        readTrades.filter(row => contractOf(row) === symbol),
        responseAt,
      )
    coverage[symbol] = Object.freeze({
      readAt: Math.max(coverageTime(previous.readAt) ?? responseAt, responseAt),
      orderReadAt: coveredOrders.has(symbol)
        ? responseAt
        : coverageTime(previous.orderReadAt) ?? coverageTime(previous.readAt),
      tradeReadAt: coveredTrades.has(symbol)
        ? responseAt
        : coverageTime(previous.tradeReadAt) ?? coverageTime(previous.readAt),
      // Only the endpoint this read looked at moves. The other keeps what the
      // read that did look at it left, so the desk still knows where to resume
      // it — and, until one has, that it has never been read at all.
      orderCursor: !coveredOrders.has(symbol)
        ? previous.orderCursor ?? null
        : incrementalOrders.has(symbol)
          ? higherIdentity(identityOf(previous.orderCursor), orderCursor)
          : orderCursor,
      tradeCursor: !coveredTrades.has(symbol)
        ? previous.tradeCursor ?? null
        : incrementalTrades.has(symbol)
          ? higherIdentity(identityOf(previous.tradeCursor), tradeCursor)
          : tradeCursor,
      tradeCoverage: trades.truncatedContracts.has(symbol) && nextTradeCoverage !== null
        ? retentionLimitedCoverage(nextTradeCoverage, trades.rows, symbol)
        : nextTradeCoverage,
    })
  }
  // The generation names this composite held reading, not only contracts touched
  // by the last response. Re-stamping carried coverage keeps exact per-key
  // metadata admissible when another contract is refreshed independently.
  const frozenCoverage = Object.freeze(Object.fromEntries(
    Object.entries(coverage).map(([symbol, entry]) => [symbol, Object.freeze({
      ...entry,
      generation,
    })]),
  ))
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
  const discovered = acceptsDiscovery
    ? Math.max(
      Number.isSafeInteger(payload?.discovered) ? payload.discovered : 0,
      symbols.length,
    )
    : Math.max(Number.isSafeInteger(history?.discovered) ? history.discovered : 0, symbols.length)
  const stamps = Object.values(frozenCoverage)
    .map(entry => entry?.readAt)
    .filter(Number.isSafeInteger)
  return Object.freeze({
    ...history,
    symbol: typeof payload?.symbol === 'string' ? payload.symbol : history.symbol,
    status: 'ready',
    version: 2,
    generation,
    tradeGeneration,
    orders: orders.rows,
    trades: trades.rows,
    foldedOrders: orders.folded,
    foldedTrades: trades.folded,
    symbols: Object.freeze(symbols),
    discovered: Math.max(discovered, symbols.length),
    discoveryComplete: acceptsDiscovery
      ? payload?.discoveryComplete !== false
      : history.discoveryComplete,
    discoveryReadAt: acceptsDiscovery ? responseAt : history.discoveryReadAt ?? null,
    lastResponseAt: Math.max(history?.lastResponseAt ?? responseAt, responseAt),
    error: null,
    readAt: stamps.length > 0 ? Math.min(...stamps) : responseAt,
    coverage: frozenCoverage,
    readViews: Object.freeze({
      orders: coveredOrders.size > 0 || (
        acceptsDiscovery && requested.length === 0 && payload?.discoveryComplete !== false
      )
        ? Math.max(history.readViews?.orders ?? responseAt, responseAt)
        : history.readViews?.orders ?? null,
      trades: coveredTrades.size > 0 || (
        acceptsDiscovery && requested.length === 0 && payload?.discoveryComplete !== false
      )
        ? Math.max(history.readViews?.trades ?? responseAt, responseAt)
        : history.readViews?.trades ?? null,
    }),
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
  marginAsset: typeof report.marginAsset === 'string' && report.marginAsset.trim() !== ''
    ? report.marginAsset.trim().toUpperCase()
    : null,
  maker: report.maker === true,
  time: Number(report.time ?? report.T) || 0,
})

const upsert = (rows, folded, row, keyOf, limit) => {
  const key = keyOf(row)
  const without = rows.filter(existing => keyOf(existing) !== key)
  const candidates = [row, ...without].sort(newestFirst)
  const truncatedContracts = truncatedContractsOf(candidates, keyOf, limit)
  const bounded = boundNewestByContract(candidates, limit)
  const retained = new Set(bounded.map(keyOf))
  const nextFolded = folded.filter(entry => retained.has(entry))
  return {
    rows: Object.freeze(bounded),
    // Recorded once: an identity already folded in stays folded, and a second
    // report about the same order replaces the row rather than adding one.
    folded: Object.freeze(!retained.has(key) || nextFolded.includes(key)
      ? nextFolded
      : [...nextFolded, key]),
    truncatedContracts,
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
    const symbol = contractOf(report)
    const previousCoverage = next.coverage?.[symbol]
    const tradeCoverage = merged.truncatedContracts.has(symbol)
      && previousCoverage?.tradeCoverage?.version === 2
      ? retentionLimitedCoverage(previousCoverage.tradeCoverage, merged.rows, symbol)
      : previousCoverage?.tradeCoverage
    next = Object.freeze({
      ...next,
      tradeGeneration: advanceGeneration(next.tradeGeneration),
      trades: merged.rows,
      foldedTrades: merged.folded,
      ...(tradeCoverage === undefined ? {} : {
        coverage: Object.freeze({
          ...next.coverage,
          [symbol]: Object.freeze({ ...previousCoverage, tradeCoverage }),
        }),
      }),
    })
  }
  return next
}
