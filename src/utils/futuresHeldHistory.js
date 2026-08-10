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
  // Identities the stream added since the read. Kept apart so the panel can say
  // so, and so a later read can tell what it is allowed to drop.
  foldedOrders: Object.freeze([]),
  foldedTrades: Object.freeze([]),
})

const asArray = value => (Array.isArray(value) ? value : [])
const isHeld = history => history?.readAt !== null && history?.readAt !== undefined

export const futuresHistoryOrderKey = order => `${order?.symbol ?? ''}:${order?.orderId ?? ''}`
export const futuresHistoryTradeKey = trade => `${trade?.symbol ?? ''}:${trade?.id ?? ''}`

const newestFirst = (left, right) => (Number(right?.time) || 0) - (Number(left?.time) || 0)

// Read rows win over folded ones: the exchange's own record of an order is more
// complete than the report that announced it.
const mergeRows = (readRows, heldRows, foldedKeys, keyOf) => {
  const read = new Set(readRows.map(keyOf))
  const survivors = heldRows.filter(row => foldedKeys.has(keyOf(row)) && !read.has(keyOf(row)))
  return {
    rows: Object.freeze([...readRows, ...survivors].sort(newestFirst)),
    folded: Object.freeze(survivors.map(keyOf)),
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
  const orders = mergeRows(
    asArray(payload?.orders),
    history.orders,
    new Set(history.foldedOrders),
    futuresHistoryOrderKey,
  )
  const trades = mergeRows(
    asArray(payload?.trades),
    history.trades,
    new Set(history.foldedTrades),
    futuresHistoryTradeKey,
  )
  return Object.freeze({
    ...history,
    symbol: typeof payload?.symbol === 'string' ? payload.symbol : history.symbol,
    status: 'ready',
    orders: orders.rows,
    trades: trades.rows,
    foldedOrders: orders.folded,
    foldedTrades: trades.folded,
    symbols: Object.freeze(asArray(payload?.symbols)),
    discovered: Number.isSafeInteger(payload?.discovered) ? payload.discovered : 0,
    discoveryComplete: payload?.discoveryComplete !== false,
    error: null,
    readAt: now,
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

const upsert = (rows, folded, row, keyOf) => {
  const key = keyOf(row)
  const without = rows.filter(existing => keyOf(existing) !== key)
  return {
    rows: Object.freeze([row, ...without].sort(newestFirst)),
    // Recorded once: an identity already folded in stays folded, and a second
    // report about the same order replaces the row rather than adding one.
    folded: Object.freeze(folded.includes(key) ? folded : [...folded, key]),
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
    )
    next = Object.freeze({ ...next, orders: merged.rows, foldedOrders: merged.folded })
  }
  if (isFill(report)) {
    const merged = upsert(
      next.trades,
      next.foldedTrades,
      tradeRowFromReport(report),
      futuresHistoryTradeKey,
    )
    next = Object.freeze({ ...next, trades: merged.rows, foldedTrades: merged.folded })
  }
  return next
}
