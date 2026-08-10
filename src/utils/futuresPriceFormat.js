// Binance reports account prices as raw floats: an averaged entry price arrives
// as 3.3449999999999998 and a mark price with more digits than the contract can
// ever trade at. A trader reads those as noise, so every account-side price is
// rendered at the precision the contract actually quotes.

const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/

export const tickDecimals = (tickSize) => {
  if (typeof tickSize !== 'string' || !DECIMAL_PATTERN.test(tickSize)) return null
  const [, fraction = ''] = tickSize.split('.')
  const trimmed = fraction.replace(/0+$/, '')
  // 0.0001 quotes four decimals; 1 and 10 both quote none.
  return trimmed.length
}

const stripTrailingZeros = (value) => (
  value.includes('.') ? value.replace(/\.?0+$/, '') : value
)

// Without a tick size the only defensible cleanup is dropping the binary
// float residue, never inventing a precision the contract does not have.
const trimFloatNoise = (parsed) => stripTrailingZeros(parsed.toFixed(8))

export const formatExchangePrice = (value, tickSize = null, fallback = '—') => {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return typeof value === 'string' ? value : fallback
  const decimals = tickDecimals(tickSize)
  if (decimals === null) return trimFloatNoise(parsed)
  return parsed.toFixed(Math.min(decimals, 12))
}

export const formatUsdtAmount = (value, fractionDigits = 2, fallback = '—') => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed.toFixed(fractionDigits)
}

// Order-book and history columns are narrow; a 7-digit notional would push the
// price out of view, so large values are abbreviated instead of wrapped.
export const formatCompactUsdt = (value, fallback = '—') => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const magnitude = Math.abs(parsed)
  if (magnitude >= 1_000_000) return `${(parsed / 1_000_000).toFixed(2)}M`
  if (magnitude >= 10_000) return `${(parsed / 1_000).toFixed(1)}k`
  if (magnitude >= 1) return String(Math.round(parsed))
  return parsed.toFixed(2)
}
