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
// Falls back to what the row *is* when the exchange gave it no identity this
// desk can use — a `tranId` past 2^53 has lost digits before it is parsed, and
// the adapter refuses a rounded one. Keying every such row alike is what left the
// desk holding one funding charge out of twenty on 2026-08-20.
//
// The fill the row was charged on is part of that fallback, because contract,
// kind, instant and amount are not enough to tell two commission rows apart: an
// account filling the same size at the same price twice in one millisecond pays
// the same fee twice, and without `tradeId` the second charge is read as a
// repeat of the first and dropped. Funding names no fill and needs none — a
// contract is charged once per settlement.
const incomeRowKey = (row) => {
  const identity = row?.tranId
  if (identity !== null && identity !== undefined && identity !== '') {
    return `${row?.incomeType ?? ''}:${identity}`
  }
  return `${row?.incomeType ?? ''}:${row?.symbol ?? ''}:${row?.time ?? ''}`
    + `:${row?.income ?? ''}:${row?.tradeId ?? ''}`
}

// Whether an income row, as the exchange states it, is one a position can be
// charged or credited with.
export const isFuturesSettledIncomeRow = row => (
  COMPONENT_OF_INCOME_TYPE[row?.incomeType] !== undefined
  && typeof row?.symbol === 'string'
  && row.symbol.length > 0
)

/**
 * Reads a page of income into the entries a position's money is made of.
 *
 * **Idempotent, and that is load-bearing rather than tidy.** This runs at three
 * points on one path — the main process narrowing what it broadcasts, the
 * renderer validating the frame, and the fold below — and on 2026-08-20 it
 * silently emptied the operator's column because it did not. The main process
 * sent rows already read into `{component, amount}`; every later call looked for
 * the `incomeType` and `income` that the first had consumed, matched nothing,
 * and dropped every row. The Positions column showed `—` against a position the
 * Binance app had 264.38 USDT of charges on. Both halves had tests; the seam
 * between them did not.
 *
 * So an entry this function has already produced is accepted as itself. A caller
 * cannot get it wrong by calling it once too often, which is the only way this
 * shape of bug is prevented for good — a comment saying "call me once" is not.
 */
export const readFuturesSettledIncome = (rows) => {
  if (!Array.isArray(rows)) return []
  const seen = new Set()
  const kept = []
  for (const row of rows) {
    // Already read: keep it as it is rather than looking for exchange fields it
    // no longer carries.
    if (FUTURES_SETTLED_COMPONENTS.includes(row?.component)
      && Number.isFinite(row?.amount)
      && typeof row?.symbol === 'string'
      && row.symbol.length > 0) {
      kept.push(row)
      continue
    }
    const component = COMPONENT_OF_INCOME_TYPE[row?.incomeType]
    if (component === undefined) continue
    const amount = toFiniteNumber(row?.income)
    const symbol = typeof row?.symbol === 'string' && row.symbol.length > 0
      ? row.symbol.toUpperCase()
      : null
    // A flow with no contract against it cannot be attributed to a position, and
    // an unreadable amount is not a zero.
    if (amount === null || symbol === null) continue
    // Every row is deduplicated, by the exchange's identity where there is one
    // and by what the row is where there is not. Skipping the check for rows
    // without an identity let a page boundary inside one millisecond count a
    // funding charge twice; keying them all alike let a Map keep one of twenty.
    // Both are wrong totals, and the natural key is wrong in neither direction.
    {
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

/**
 * When each open position began, from the fold of fills.
 *
 * The flag that matters here is `partial`, not `entryImplied`. They answer
 * different questions and only one of them is about time: `entryImplied` says
 * the entry *price* was recovered from what the round realized rather than read
 * from its own fills, while `partial` says the round began by reducing a
 * position that was opened before this window of fills. A round can carry either
 * without the other — a reducing fill larger than the round holds sets `partial`
 * on its own, with no implied entry anywhere — so reading provenance as coverage
 * accepts an `openTime` that is the moment the window happened to start, and
 * reports the settled money of a position older than the read as though it were
 * the whole of it.
 *
 * A contract with no trustworthy start is simply absent from the result, and the
 * fold below reports it as window-bounded rather than complete.
 */
export const readFuturesOpenPositionStarts = (rounds, symbols) => {
  const wanted = symbols instanceof Set
    ? symbols
    : new Set((Array.isArray(symbols) ? symbols : [])
      .map(symbol => String(symbol ?? '').toUpperCase()))
  const starts = {}
  for (const round of Array.isArray(rounds) ? rounds : []) {
    if (round?.open !== true) continue
    if (round.partial === true) continue
    if (!wanted.has(round.symbol)) continue
    const openTime = Number(round.openTime)
    if (!Number.isFinite(openTime)) continue
    // One contract can carry two open rounds on a hedged account. The earliest
    // is when the exposure the row shows began.
    const held = starts[round.symbol]
    if (held === undefined || openTime < held) starts[round.symbol] = openTime
  }
  return starts
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
 * `starts` bounds each contract's window at the moment its open position began,
 * so that what is stated is the position's own settled money rather than the
 * account's history on that contract.
 *
 * A contract with **no** known start states no total at all. Until 2026-08-20 it
 * stated one anyway — the sum of everything the contract settled anywhere in the
 * read's window — and that is not a partial answer to the question the column
 * asks, it is a whole answer to a different one: a round closed three days ago
 * for +900 and one closed two days ago for -900 both land in the figure beside a
 * position opened this morning. The operator read -34.7 against a position that
 * had settled -34.7 of its own and called it a lie, and it was. `from` is null
 * for such a contract, which is what a surface tests to say why the figure is
 * absent.
 *
 * A partial total that says so is useful; a total of the wrong thing is not.
 *
 * Assets are kept apart. Binance charges commission in BNB whenever the account
 * holds it, and a BNB amount added into a USDT total is not a quantity of
 * anything. The settlement asset leads; anything else is stated in its own.
 */
export const foldFuturesSettledMoney = (
  income,
  { starts = {}, from = null, settlementAsset = 'USDT' } = {},
) => {
  // Not `toFiniteNumber` on its own: `Number(null)` is 0, and a coverage of zero
  // is the epoch — every position that ever opened would read as covered by a
  // read that stated nothing at all. The absence has to be kept as an absence.
  const covered = from === null || from === undefined ? null : toFiniteNumber(from)
  // Knowing when a position began is not the same as having read back to it.
  // Until 2026-08-20 this asked only the first question, so a read that had
  // covered a single day of its window reported every contract in it as
  // completely accounted for — and the desk believed its own truncated reading
  // rather than marking it. Both halves are required: the start must be known,
  // and the read must reach it.
  const reaches = start => covered !== null && covered <= start
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
        complete: known && reaches(start),
      })
    }
    // Nothing is attributed to a contract whose position start is unknown. The
    // contract is still recorded, so a surface can tell "the read answered
    // nothing about this one" from "the read cannot say which of this contract's
    // money is this position's" — but no amount is accumulated, because every
    // amount here would be the contract's rather than the position's.
    if (!known) continue
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
      complete: reaches(start),
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
      // When this reading starts: the moment the position began. Null when the
      // desk could not establish that — and then every amount above is null too,
      // because a figure bounded by nothing is the contract's history, not the
      // position's.
      from: held.from,
      complete: held.complete,
    })
  }
  return Object.freeze(readings)
}

export default foldFuturesSettledMoney
