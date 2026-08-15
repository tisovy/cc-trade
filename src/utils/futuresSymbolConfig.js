// What leverage a contract is set to, and what its ceiling is.
//
// `/fapi/v3/positionRisk` reports neither leverage nor margin mode any more, so a
// position read alone cannot say what a trade was entered at. Binance answers both
// on `/fapi/v1/symbolConfig`, and the backend forwards what it read here, keyed by
// symbol. Nothing is inferred: a field the exchange did not report is absent, not
// a default, because a leverage nobody stated is exactly the number an operator
// must not be shown beside their own money.

const toWholeNumber = (value) => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null
}

const toPositiveAmount = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? String(value) : null
}

// Binance says CROSSED where the desk says CROSS; both readings are understood
// wherever margin mode is described, so the exchange's own word is kept.
const toMarginType = (value) => {
  const mode = String(value ?? '').toUpperCase()
  if (mode === 'ISOLATED') return 'ISOLATED'
  return mode === 'CROSSED' || mode === 'CROSS' ? 'CROSSED' : null
}

const toSymbol = (value) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim().toUpperCase() : null
)

export const readFuturesSymbolConfig = (entry, fallbackSymbol = null) => {
  if (entry === null || typeof entry !== 'object') return null
  const symbol = toSymbol(entry.symbol) ?? toSymbol(fallbackSymbol)
  if (symbol === null) return null
  const leverage = toWholeNumber(entry.leverage)
  const maxLeverage = toWholeNumber(entry.maxLeverage)
  const marginType = toMarginType(entry.marginType)
  const maxNotionalValue = toPositiveAmount(entry.maxNotionalValue)
  // An entry that carries none of the four says nothing about the contract, and a
  // row of dashes is not worth keeping over the last reading that did carry one.
  if (leverage === null && maxLeverage === null && marginType === null) return null
  return Object.freeze({ symbol, leverage, maxLeverage, marginType, maxNotionalValue })
}

export const readFuturesSymbolConfigs = (payload) => {
  if (payload === null || typeof payload !== 'object') return null
  const configs = {}
  for (const [key, entry] of Object.entries(payload)) {
    const config = readFuturesSymbolConfig(entry, key)
    if (config !== null) configs[config.symbol] = config
  }
  return Object.keys(configs).length > 0 ? Object.freeze(configs) : null
}

// Positions read what the account is configured to, so every surface states the
// leverage a position is actually carried at instead of leaving it blank. A
// position that already carries the field keeps it: a source that states it
// outright is believed over the account-wide setting.
export const mergeFuturesPositionConfigs = (positions, configs) => {
  if (!Array.isArray(positions) || positions.length === 0) return positions
  if (configs === null || typeof configs !== 'object') return positions
  let changed = false
  const merged = positions.map((position) => {
    const config = configs[position?.symbol]
    if (!config) return position
    const leverage = position?.leverage ?? config.leverage ?? undefined
    const marginType = position?.marginType ?? config.marginType ?? undefined
    if (leverage === position?.leverage && marginType === position?.marginType) return position
    changed = true
    return {
      ...position,
      ...(leverage === undefined ? {} : { leverage }),
      ...(marginType === undefined ? {} : { marginType }),
    }
  })
  return changed ? merged : positions
}

export default readFuturesSymbolConfigs
