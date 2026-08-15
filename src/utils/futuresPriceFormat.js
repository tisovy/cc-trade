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

// A price of zero is not a price. Binance reports 0 for a market order's limit
// price, for the average price of an order that has not filled, and for a
// position it holds no liquidation price for. Rendered through the tick as
// `0.000` it reads as a level the market could reach, and in a column of prices
// it reads as the cheapest one there.
export const formatPriceOrAbsent = (value, tickSize = null, fallback = '—') => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return formatExchangePrice(value, tickSize, fallback)
}

export const formatUsdtAmount = (value, fractionDigits = 2, fallback = '—') => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed.toFixed(fractionDigits)
}

// Order-book and history columns are narrow; a 7-digit notional would push the
// price out of view, so large values are abbreviated instead of wrapped. A daily
// volume runs into the billions, where an M suffix stops abbreviating anything:
// 1_100_000_000 read as 1100.00M is the same nine digits with a letter on the end.
const compactTier = (magnitude) => (
  magnitude >= 1_000_000_000 ? { divisor: 1_000_000_000, suffix: 'B', digits: 2 }
    : magnitude >= 1_000_000 ? { divisor: 1_000_000, suffix: 'M', digits: 2 }
      : magnitude >= 10_000 ? { divisor: 1_000, suffix: 'k', digits: 1 }
        : null
)

// `fractionDigits` overrides the tier's own: a column of levels is compared
// digit by digit and keeps two, a headline figure is read at a glance and keeps
// one. The exact number belongs in a title wherever this is used — abbreviating
// is dropping digits, and the operator must be able to get them back.
export const formatCompactUsdt = (value, fallback = '—', fractionDigits = null) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const magnitude = Math.abs(parsed)
  const tier = compactTier(magnitude)
  if (tier !== null) {
    const digits = Number.isInteger(fractionDigits) ? fractionDigits : tier.digits
    return `${(parsed / tier.divisor).toFixed(digits)}${tier.suffix}`
  }
  if (magnitude >= 1) return String(Math.round(parsed))
  return parsed.toFixed(2)
}
