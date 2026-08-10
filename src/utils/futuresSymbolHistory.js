// Which contracts a trader actually works with is session history, not an
// alphabetical accident. The instrument rail reads this to show what was traded
// recently instead of whatever sorts first.

export const FUTURES_SYMBOL_HISTORY_STORAGE_KEY = 'cc-trade:futures-symbols:v1'
export const FUTURES_RECENT_SYMBOL_LIMIT = 8

const SYMBOL_PATTERN = /^[A-Z0-9]{4,20}$/

const normalizeSymbol = (value) => {
  if (typeof value !== 'string') return null
  const symbol = value.trim().toUpperCase()
  return SYMBOL_PATTERN.test(symbol) ? symbol : null
}

const normalizeSymbolList = (value, limit) => {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  for (const entry of value) {
    const symbol = normalizeSymbol(entry)
    if (symbol && !seen.has(symbol)) seen.add(symbol)
    if (seen.size >= limit) break
  }
  return [...seen]
}

export const readFuturesSymbolHistory = (storage = globalThis.localStorage) => {
  try {
    const raw = storage?.getItem?.(FUTURES_SYMBOL_HISTORY_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    const recent = normalizeSymbolList(parsed?.recent, FUTURES_RECENT_SYMBOL_LIMIT)
    return Object.freeze({
      recent,
      favorites: normalizeSymbolList(parsed?.favorites, 32),
      lastSymbol: normalizeSymbol(parsed?.lastSymbol) ?? recent[0] ?? null,
    })
  } catch {
    return Object.freeze({ recent: [], favorites: [], lastSymbol: null })
  }
}

export const writeFuturesSymbolHistory = (history, storage = globalThis.localStorage) => {
  const recent = normalizeSymbolList(history?.recent, FUTURES_RECENT_SYMBOL_LIMIT)
  const payload = {
    recent,
    favorites: normalizeSymbolList(history?.favorites, 32),
    lastSymbol: normalizeSymbol(history?.lastSymbol) ?? recent[0] ?? null,
  }
  try {
    storage?.setItem?.(FUTURES_SYMBOL_HISTORY_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export const rememberFuturesSymbol = (history, symbol) => {
  const normalized = normalizeSymbol(symbol)
  if (!normalized) return history
  const recent = [
    normalized,
    ...normalizeSymbolList(history?.recent, FUTURES_RECENT_SYMBOL_LIMIT)
      .filter(entry => entry !== normalized),
  ].slice(0, FUTURES_RECENT_SYMBOL_LIMIT)
  return Object.freeze({
    recent,
    favorites: normalizeSymbolList(history?.favorites, 32),
    lastSymbol: normalized,
  })
}

export const toggleFuturesFavorite = (history, symbol) => {
  const normalized = normalizeSymbol(symbol)
  if (!normalized) return history
  const favorites = normalizeSymbolList(history?.favorites, 32)
  return Object.freeze({
    recent: normalizeSymbolList(history?.recent, FUTURES_RECENT_SYMBOL_LIMIT),
    favorites: favorites.includes(normalized)
      ? favorites.filter(entry => entry !== normalized)
      : [...favorites, normalized],
    lastSymbol: normalizeSymbol(history?.lastSymbol),
  })
}

// Recent first (most recent leftmost), then favourites, then everything else
// alphabetically — the order a trader scans when reaching for a contract.
export const orderFuturesContracts = (contracts, { recent = [], favorites = [] } = {}) => {
  const recentRank = new Map(recent.map((symbol, index) => [symbol, index]))
  const favoriteSet = new Set(favorites)
  const rank = (symbol) => {
    if (recentRank.has(symbol)) return recentRank.get(symbol)
    if (favoriteSet.has(symbol)) return FUTURES_RECENT_SYMBOL_LIMIT
    return FUTURES_RECENT_SYMBOL_LIMIT + 1
  }
  return [...contracts].sort((left, right) => (
    rank(left.symbol) - rank(right.symbol) || left.symbol.localeCompare(right.symbol)
  ))
}
