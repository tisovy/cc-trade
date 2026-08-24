import { sumFuturesWalletDecimalAmounts } from './futuresWalletLedger.js'
import { exactFuturesDeskTime } from './futuresDeskTime.js'

// A commission charged in BNB is a quantity of the wrong thing beside a USDT
// result. Since 2026-08-24 the operator's account pays every Futures fee in
// BNB, so the desk values that quantity in the settlement asset — at the
// BNBUSDT price of each charge's own minute, read from the exchange's own
// minute klines and never inferred from a fee tier — and folds the valuation
// into the presented net. The valuation is presentation on top of the exact
// per-asset record: `feesByAsset` and the wallet ledger's per-asset
// conservation are never touched by it, and a valuation whose price could not
// be read degrades to the fee stated in its own asset as "not included",
// never to a wrong number.

export const FUTURES_FEE_VALUATION_MINUTE_MS = 60_000

// How far back the fee-reserve readout may reach for a price before it calls
// itself unpriced. The reserve is a warning gauge, not an accounting figure;
// a half-hour-old minute close still answers "is the reserve running out".
export const FUTURES_FEE_RESERVE_PRICE_STALE_MS = 30 * 60_000

// The bound under which the remaining BNB fee reserve is marked low, in USDT
// equivalent. Declared where it is enforced (the reserve reading below), from
// the operator's 2026-08-24 ruling: "помечать его если его становится мало
// <50 USDT эквивалент" — Binance reverts to undiscounted USDT fees silently
// when the reserve empties, so this mark is the only warning ahead of it.
export const FUTURES_BNB_FEE_RESERVE_LOW_USDT = 50

export const futuresFeeValuationMinute = time => (
  Number.isFinite(time)
    ? Math.floor(time / FUTURES_FEE_VALUATION_MINUTE_MS) * FUTURES_FEE_VALUATION_MINUTE_MS
    : null
)

// The synchronous lookup the round fold consumes, over the price table the
// renderer holds (`{ BNBUSDT: { [minuteMs]: closeText | null } }`). A minute
// answered `null` by the source (no kline for that minute) and a minute never
// answered look the same to the fold — no price, degrade — and differ only in
// whether the ask effect keeps asking.
export const createFuturesFeeValuationPriceLookup = pricesByPair => (pair, time) => {
  const minute = futuresFeeValuationMinute(time)
  if (minute === null) return null
  const price = pricesByPair?.[pair]?.[minute]
  return typeof price === 'string' && price !== '' ? { price, minute } : null
}

// Which minutes the held rounds still need priced, per pair, newest first.
// Bounded by the caller's command budget rather than here.
export const collectFuturesFeeValuationMissingMinutes = (rounds) => {
  const byPair = new Map()
  for (const round of Array.isArray(rounds) ? rounds : []) {
    for (const valuation of Array.isArray(round?.feeValuations) ? round.feeValuations : []) {
      if (valuation.complete === true) continue
      for (const minute of Array.isArray(valuation.missingMinutes)
        ? valuation.missingMinutes
        : []) {
        if (!Number.isSafeInteger(minute) || minute < 0) continue
        if (!byPair.has(valuation.pair)) byPair.set(valuation.pair, new Set())
        byPair.get(valuation.pair).add(minute)
      }
    }
  }
  return new Map([...byPair.entries()].map(([pair, minutes]) => [
    pair,
    [...minutes].sort((left, right) => right - left),
  ]))
}

const FEE_VALUATION_PAIR_PATTERN = /^[A-Z0-9]{5,20}$/
const FEE_VALUATION_PRICE_PATTERN = /^\d+(?:\.\d+)?$/
const MAX_FEE_VALUATION_FRAME_MINUTES = 1000

// Validates one `futures_fee_valuation` frame at the IPC boundary. A price is
// a positive decimal text; `null` is a final absence (the exchange served the
// window and printed no kline); anything else refuses the whole frame.
export const readFuturesFeeValuationFrame = (payload) => {
  if (payload === null || typeof payload !== 'object') return null
  if (payload.type !== 'futures_fee_valuation' || payload.version !== 1) return null
  const pair = typeof payload.pair === 'string' ? payload.pair.trim().toUpperCase() : ''
  if (!FEE_VALUATION_PAIR_PATTERN.test(pair)) return null
  if (payload.prices === null || typeof payload.prices !== 'object'
    || Array.isArray(payload.prices)) return null
  const entries = Object.entries(payload.prices)
  if (entries.length > MAX_FEE_VALUATION_FRAME_MINUTES) return null
  const prices = {}
  for (const [key, value] of entries) {
    const minute = Number(key)
    if (!Number.isSafeInteger(minute) || minute < 0
      || minute % FUTURES_FEE_VALUATION_MINUTE_MS !== 0) return null
    if (value === null) {
      prices[minute] = null
      continue
    }
    if (typeof value !== 'string' || !FEE_VALUATION_PRICE_PATTERN.test(value)
      || Number(value) <= 0) return null
    prices[minute] = value
  }
  return Object.freeze({ pair, prices })
}

// Merges a validated frame into the held table, returning the held object
// unchanged when the frame adds nothing — so memoized folds do not re-run for
// a frame that answered only what was already known. A price already held is
// never overwritten by null: a closed minute's close is a fact.
export const mergeFuturesFeeValuationPrices = (held, frame) => {
  if (frame === null) return held ?? {}
  const table = held ?? {}
  const heldPair = table[frame.pair] ?? {}
  let changed = false
  const next = { ...heldPair }
  for (const [minute, price] of Object.entries(frame.prices)) {
    if (Object.hasOwn(heldPair, minute)
      && (heldPair[minute] === price || (price === null && heldPair[minute] !== null))) {
      continue
    }
    next[minute] = price
    changed = true
  }
  return changed ? { ...table, [frame.pair]: next } : table
}

const settlementAssetOfPair = valuation => (
  typeof valuation?.pair === 'string' && typeof valuation?.asset === 'string'
    && valuation.pair.startsWith(valuation.asset)
    ? valuation.pair.slice(valuation.asset.length)
    : ''
)

const feeQuantityText = valuation => (
  typeof valuation?.amountExact === 'string' && valuation.amountExact !== ''
    ? valuation.amountExact
    : String(valuation?.amount ?? '')
)

// One sentence for the element: the charged quantity in its own asset, the
// valuation, and the price used — both quantities named, per the spec delta.
export const futuresFeeValuationTitle = (valuation) => {
  const settlement = settlementAssetOfPair(valuation)
  const prices = (Array.isArray(valuation?.prices) ? valuation.prices : [])
    .map(reading => `${reading.price}${
      exactFuturesDeskTime(reading.minute) === undefined
        ? ''
        : ` (${exactFuturesDeskTime(reading.minute)})`
    }`)
    .join(' · ')
  return `fee ${feeQuantityText(valuation)} ${valuation.asset}`
    + ` valued −${valuation.valuedAmount}${settlement === '' ? '' : ` ${settlement}`}`
    + `${prices === '' ? '' : ` at ${valuation.pair} ${prices}`}`
}

// The degraded statement: the fee in its own asset, named as not included,
// and why. Today's honesty kept, in the spec delta's words.
export const futuresFeeNotIncludedTitle = valuation => (
  `fee ${feeQuantityText(valuation)} ${valuation.asset} not included`
  + ` — no readable ${valuation.pair} price for its minute`
)

// Values a multi-asset visible net into one settlement-asset figure, or
// refuses. `amounts` are the ledger's signed per-asset totals; `feeValuations`
// come from the round fold. Every foreign-asset amount must be exactly the
// round's charged fee (negated) with a complete valuation behind it —
// anything else in a foreign asset (a rebate, a mismatched record) keeps
// today's per-asset statement, because valuing part of an amount and
// presenting the sum as the whole would be a wrong number.
export const valueFuturesForeignFees = ({
  amounts,
  settlementAsset,
  feeValuations,
} = {}) => {
  if (typeof settlementAsset !== 'string' || settlementAsset === '') return null
  const held = Array.isArray(amounts) ? amounts : []
  const foreign = held.filter(reading => reading?.asset !== settlementAsset)
  if (foreign.length === 0) return null
  const valuations = Array.isArray(feeValuations) ? feeValuations : []
  const matched = []
  for (const reading of foreign) {
    const valuation = valuations.find(candidate => candidate.asset === reading?.asset) ?? null
    if (valuation === null
      || valuation.complete !== true
      || typeof valuation.valuedAmount !== 'string'
      || valuation.valuedAmount === '') return null
    // The ledger amount is the signed movement (a fee arrives negative); the
    // fold's amount is the unsigned charge. They must cancel exactly, or the
    // foreign asset holds something besides this commission.
    const cancelled = sumFuturesWalletDecimalAmounts([
      String(reading.amount ?? ''),
      feeQuantityText(valuation),
    ])
    if (cancelled !== '0') return null
    matched.push(valuation)
  }
  const settlementAmount = held
    .find(reading => reading?.asset === settlementAsset)?.amount ?? '0'
  const amount = sumFuturesWalletDecimalAmounts([
    String(settlementAmount),
    ...matched.map(valuation => `-${valuation.valuedAmount}`),
  ])
  if (amount === null) return null
  return Object.freeze({
    amount,
    settlementAsset,
    settlementAmount: String(settlementAmount),
    valuations: Object.freeze(matched),
  })
}

const decimalNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The Futures wallet's remaining BNB fee reserve, valued at the newest priced
 * minute the desk holds. One global reading — the operator ruled it off the
 * rows — that states absence and unreadability instead of a zero that looks
 * like a reading:
 *
 * - `unread`: the balances resource has not answered.
 * - `absent`: the wallet holds no BNB — Binance is already charging USDT fees
 *   without the discount, silently.
 * - `unpriced`: BNB is there but no BNBUSDT price is readable within the
 *   staleness bound; the amount is stated without a worth.
 * - `low` / `ok`: the worth against `FUTURES_BNB_FEE_RESERVE_LOW_USDT`.
 */
export const readFuturesFeeReserve = ({
  balances,
  prices,
  now,
  asset = 'BNB',
  pair = 'BNBUSDT',
} = {}) => {
  // The newest complete minute: the current one is still forming and its
  // close is not a fact yet.
  const targetMinute = Number.isFinite(now)
    ? futuresFeeValuationMinute(now - FUTURES_FEE_VALUATION_MINUTE_MS)
    : null
  const reserve = {
    asset,
    pair,
    lowBoundUsdt: FUTURES_BNB_FEE_RESERVE_LOW_USDT,
    requestMinute: targetMinute,
    amount: null,
    worth: null,
    price: null,
    priceMinute: null,
    low: false,
  }
  if (balances === null || balances === undefined) {
    return Object.freeze({ ...reserve, state: 'unread' })
  }
  const amountText = balances?.[asset]?.total ?? balances?.[asset]?.available ?? null
  const amount = decimalNumber(amountText)
  if (amount === null || amount <= 0) {
    return Object.freeze({ ...reserve, state: 'absent' })
  }
  const held = prices ?? {}
  let price = null
  let priceMinute = null
  if (targetMinute !== null) {
    for (let minute = targetMinute;
      minute >= targetMinute - FUTURES_FEE_RESERVE_PRICE_STALE_MS;
      minute -= FUTURES_FEE_VALUATION_MINUTE_MS) {
      const candidate = held[minute]
      if (typeof candidate === 'string' && candidate !== '') {
        price = candidate
        priceMinute = minute
        break
      }
    }
  }
  const priceNumber = decimalNumber(price)
  if (priceNumber === null || priceNumber <= 0) {
    return Object.freeze({
      ...reserve,
      state: 'unpriced',
      amount: String(amountText),
    })
  }
  const worth = amount * priceNumber
  return Object.freeze({
    ...reserve,
    state: worth < FUTURES_BNB_FEE_RESERVE_LOW_USDT ? 'low' : 'ok',
    amount: String(amountText),
    worth,
    price,
    priceMinute,
    low: worth < FUTURES_BNB_FEE_RESERVE_LOW_USDT,
  })
}
