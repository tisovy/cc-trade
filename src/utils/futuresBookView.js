// How a contract's order book is read — which sides are shown and how coarsely
// levels are grouped — kept against the contract it was chosen for.
//
// Deliberately not one global setting. The step is a multiple of the contract's
// own tick, so the same multiplier is a different share of price elsewhere: at
// 100× a 0.0000001-tick contract quoted at 0.0152780 puts 0.066% of price in a
// row, while a 0.1-tick contract at 58420 puts 0.017%. Carried across contracts,
// a sane zoom-out on one collapses the other into three rows.

import { GROUPING_MULTIPLIERS } from './futuresOrderBook.js'
import { readStorage, writeStorage } from './storage.js'

export const FUTURES_BOOK_VIEW_STORAGE_KEY = 'futures.bookView'
export const FUTURES_BOOK_SIDE_MODES = Object.freeze(['both', 'bids', 'asks'])
export const FUTURES_BOOK_VIEW_DEFAULT = Object.freeze({ sideMode: 'both', stepMultiplier: 1 })

// A desk watches tens of contracts, not thousands. The bound is what keeps a
// year of browsing from growing one unbounded key.
export const FUTURES_BOOK_VIEW_MAX_CONTRACTS = 64

// The exchange's identity alphabet, not ASCII — the operator zooms 龙虾USDT's
// book too, and an ASCII key silently refused to remember how.
const SYMBOL_PATTERN = /^[\p{Lu}\p{Lt}\p{Lo}\p{N}_]{1,32}$/u
const SIDE_MODES = new Set(FUTURES_BOOK_SIDE_MODES)
const MULTIPLIERS = new Set(GROUPING_MULTIPLIERS)

export const isFuturesBookViewSymbol = value => (
  typeof value === 'string' && SYMBOL_PATTERN.test(value)
)

// Restored settings are operator input that outlived a restart, so they are
// validated exactly like fresh input. A hand-edited or stale entry can never
// select a step the grouper does not offer; it simply falls back to the default.
export const parseStoredBookView = (stored) => {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return null
  const { sideMode, stepMultiplier } = stored
  if (!SIDE_MODES.has(sideMode) || !MULTIPLIERS.has(stepMultiplier)) return null
  return Object.freeze({ sideMode, stepMultiplier })
}

const readStoredMap = () => {
  const stored = readStorage(FUTURES_BOOK_VIEW_STORAGE_KEY, null)
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return {}
  return stored
}

export const readStoredBookView = (symbol) => {
  if (!isFuturesBookViewSymbol(symbol)) return FUTURES_BOOK_VIEW_DEFAULT
  return parseStoredBookView(readStoredMap()[symbol]) ?? FUTURES_BOOK_VIEW_DEFAULT
}

export const writeStoredBookView = (symbol, view) => {
  if (!isFuturesBookViewSymbol(symbol)) return false
  const validated = parseStoredBookView(view)
  if (validated === null) return false
  const entries = Object.entries(readStoredMap())
    // Re-inserting at the end makes insertion order a recency order, so the
    // bound drops the contracts the operator stopped configuring.
    .filter(([key, value]) => key !== symbol && parseStoredBookView(value) !== null)
    .slice(-(FUTURES_BOOK_VIEW_MAX_CONTRACTS - 1))
  writeStorage(
    FUTURES_BOOK_VIEW_STORAGE_KEY,
    Object.fromEntries([...entries, [symbol, validated]]),
  )
  return true
}
