// What an open position has already put into or taken out of the wallet.
//
// The unrealized PnL beside it says what the position would produce if it were
// closed now. This says what it has produced already: the realized PnL of the
// parts closed out of it, the funding paid or received while it has been held,
// the commission charged on its fills, and the insurance clearance if it has
// ever been part-liquidated. On a position scaled out of several times and held
// across a funding boundary those are the larger number, and unlike the
// unrealized figure they are settled — the money is in the wallet and is not
// coming back out.
//
// Two conventions meet here and only one of them is used. Every amount below is
// the exchange's own `income`, which is signed its way: positive is an inflow,
// so funding paid, commission and insurance clearance all arrive negative and
// the total is their sum. A fill's `commission` is the opposite — an unsigned
// magnitude that has to be subtracted — and nothing on this path may mix the
// two, because doing so returns a fee to the operator as profit.

// Which kinds of flow are the position's own. A transfer in or out of the
// futures wallet is the operator moving money, not a position earning or costing
// it, and counting it would make a deposit read as a winning trade.
const COMPONENT_OF_INCOME_TYPE = Object.freeze({
  REALIZED_PNL: 'realizedPnl',
  FUNDING_FEE: 'funding',
  COMMISSION: 'commission',
  INSURANCE_CLEAR: 'insuranceClear',
  // Rebates are commission coming back. They belong with the charge rather than
  // in a line of their own: what the operator wants to know is what the position
  // cost them to trade, and on a rebated account the gross charge is not it.
  COMMISSION_REBATE: 'commission',
  REFERRAL_KICKBACK: 'commission',
  API_REBATE: 'commission',
  FEE_RETURN: 'commission',
})

export const FUTURES_SETTLED_COMPONENTS = Object.freeze([
  'realizedPnl',
  'funding',
  'commission',
  'insuranceClear',
])

const toFiniteNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// A row is identified by its type and its transaction together. Binance states
// that `tranId` is unique only within one `incomeType`, so the id alone would
// collapse a real commission row onto the realized-PnL row it was charged
// beside — and a page boundary inside one millisecond hands the same row back
// twice, which is a funding charge counted twice if nothing catches it.
const incomeRowKey = row => `${row?.incomeType ?? ''}:${row?.tranId ?? ''}`

export const readFuturesSettledIncome = (rows) => {
  if (!Array.isArray(rows)) return []
  const seen = new Set()
  const kept = []
  for (const row of rows) {
    const component = COMPONENT_OF_INCOME_TYPE[row?.incomeType]
    if (component === undefined) continue
    const amount = toFiniteNumber(row?.income)
    const symbol = typeof row?.symbol === 'string' && row.symbol.length > 0
      ? row.symbol.toUpperCase()
      : null
    // A flow with no contract against it cannot be attributed to a position, and
    // an unreadable amount is not a zero.
    if (amount === null || symbol === null) continue
    // Only a row the exchange gave an identity to can be deduplicated. One
    // without is kept rather than dropped: an uncounted charge is a wrong total
    // just as surely as a doubled one, and the identity is the exchange's to
    // provide.
    if (row?.tranId !== null && row?.tranId !== undefined) {
      const key = incomeRowKey(row)
      if (seen.has(key)) continue
      seen.add(key)
    }
    kept.push(Object.freeze({
      symbol,
      component,
      amount,
      asset: typeof row?.asset === 'string' && row.asset.length > 0 ? row.asset : null,
      time: Number.isFinite(row?.time) ? row.time : 0,
      tradeId: row?.tradeId ?? null,
    }))
  }
  return kept
}

// What the main process broadcast, validated at the boundary the way every other
// frame on this lane is. The window matters as much as the rows: a contract with
// no row inside it is indistinguishable from one the read never reached, and only
// `from` tells the two apart.
export const readFuturesSettledIncomeFrame = (payload) => {
  if (payload === null || typeof payload !== 'object') return null
  if (!Array.isArray(payload.rows)) return null
  const from = toFiniteNumber(payload.from)
  const readAt = toFiniteNumber(payload.readAt)
  if (from === null || readAt === null) return null
  return Object.freeze({
    rows: Object.freeze(readFuturesSettledIncome(payload.rows)),
    from,
    readAt,
    // Whether the read reached the end of the window or gave up part-way. A
    // walk that stopped at its page budget has rows the desk never saw, and a
    // total built from what it did see must not read as the whole of it.
    complete: payload.complete !== false,
  })
}

const emptyTotals = () => ({
  realizedPnl: null,
  funding: null,
  commission: null,
  insuranceClear: null,
})

// Never a confident zero. A component the account has none of is absent, because
// `0.00` beside "insurance clearance" reads as a liquidation that cost nothing
// rather than as a position that was never liquidated.
const addAmount = (totals, component, amount) => {
  const held = totals[component]
  totals[component] = held === null ? amount : held + amount
}

/**
 * Folds settled income into one reading per contract.
 *
 * `from` bounds each contract's window at the moment its open position began, so
 * that what is stated is the position's own settled money rather than the
 * account's history on that contract. A contract with no known start is not
 * excluded — it is reported with `complete: false`, and the surface says the
 * reading covers the read's window rather than the position's life. A partial
 * total presented as a whole one is the failure this guards against; a partial
 * total that says so is useful.
 *
 * Assets are kept apart. Binance charges commission in BNB whenever the account
 * holds it, and a BNB amount added into a USDT total is not a quantity of
 * anything. The settlement asset leads; anything else is stated in its own.
 */
export const foldFuturesSettledMoney = (income, { starts = {}, settlementAsset = 'USDT' } = {}) => {
  const byContract = new Map()
  for (const entry of readFuturesSettledIncome(income)) {
    const start = starts[entry.symbol]
    const known = Number.isFinite(start)
    if (known && entry.time < start) continue
    if (!byContract.has(entry.symbol)) {
      byContract.set(entry.symbol, {
        symbol: entry.symbol,
        settled: emptyTotals(),
        byAsset: new Map(),
        from: known ? start : null,
        complete: known,
      })
    }
    const held = byContract.get(entry.symbol)
    const asset = entry.asset ?? settlementAsset
    if (asset === settlementAsset) {
      addAmount(held.settled, entry.component, entry.amount)
    } else {
      if (!held.byAsset.has(asset)) held.byAsset.set(asset, emptyTotals())
      addAmount(held.byAsset.get(asset), entry.component, entry.amount)
    }
  }
  // A contract whose position start is known but which settled nothing still has
  // a reading: "nothing settled yet" is an answer, and it is a different answer
  // from "not read".
  for (const [symbol, start] of Object.entries(starts)) {
    if (byContract.has(symbol) || !Number.isFinite(start)) continue
    byContract.set(symbol, {
      symbol,
      settled: emptyTotals(),
      byAsset: new Map(),
      from: start,
      complete: true,
    })
  }
  const readings = {}
  for (const [symbol, held] of byContract) {
    const settled = held.settled
    const stated = FUTURES_SETTLED_COMPONENTS.filter(name => settled[name] !== null)
    readings[symbol] = Object.freeze({
      symbol,
      ...settled,
      // The sum of everything settled in the contract's own settlement asset.
      // Absent rather than zero when nothing has settled at all: a position that
      // has produced nothing yet has not broken even, it has not started.
      total: stated.length === 0
        ? null
        : stated.reduce((sum, name) => sum + settled[name], 0),
      settlementAsset,
      // What was charged in something other than the settlement asset, in the
      // asset it was charged in. The desk holds no rate to convert it at and
      // will not print a guess beside money.
      otherAssets: Object.freeze([...held.byAsset.entries()]
        .map(([asset, totals]) => Object.freeze({
          asset,
          ...totals,
          total: FUTURES_SETTLED_COMPONENTS
            .filter(name => totals[name] !== null)
            .reduce((sum, name) => sum + totals[name], 0),
        }))
        .sort((left, right) => (left.asset < right.asset ? -1 : 1))),
      // Whether this covers the position's life or only as far back as the read
      // reached.
      from: held.from,
      complete: held.complete,
    })
  }
  return Object.freeze(readings)
}

export default foldFuturesSettledMoney
