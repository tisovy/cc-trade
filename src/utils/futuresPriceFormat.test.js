import { describe, expect, it } from 'vitest'
import {
  formatCompactUsdt,
  formatExchangePrice,
  formatUsdtAmount,
  tickDecimals,
} from './futuresPriceFormat.js'

describe('formatExchangePrice', () => {
  it('renders an averaged entry price at the contract tick', () => {
    expect(formatExchangePrice('3.3449999999999998', '0.0001')).toBe('3.3450')
    expect(formatExchangePrice('3.37867363', '0.0001')).toBe('3.3787')
    expect(formatExchangePrice('58420.5', '0.1')).toBe('58420.5')
    expect(formatExchangePrice('58420', '1')).toBe('58420')
  })

  it('only strips float residue when the tick is unknown', () => {
    expect(formatExchangePrice('3.3449999999999998')).toBe('3.345')
    expect(formatExchangePrice('0.02033')).toBe('0.02033')
  })

  it('reports missing and unparseable values instead of inventing a price', () => {
    expect(formatExchangePrice(null, '0.1')).toBe('—')
    expect(formatExchangePrice('', '0.1')).toBe('—')
    expect(formatExchangePrice('n/a', '0.1')).toBe('n/a')
  })
})

describe('tickDecimals', () => {
  it('counts the decimals a contract actually quotes', () => {
    expect(tickDecimals('0.0001')).toBe(4)
    expect(tickDecimals('1')).toBe(0)
    expect(tickDecimals('10')).toBe(0)
    expect(tickDecimals(null)).toBeNull()
  })
})

describe('USDT amounts', () => {
  it('shows a balance to cents', () => {
    expect(formatUsdtAmount('245228.33961912')).toBe('245228.34')
    expect(formatUsdtAmount('0.00012', 4)).toBe('0.0001')
    expect(formatUsdtAmount('bad')).toBe('—')
  })

  it('abbreviates book values so a narrow column stays readable', () => {
    expect(formatCompactUsdt(951.1)).toBe('951')
    expect(formatCompactUsdt(33624)).toBe('33.6k')
    expect(formatCompactUsdt(2_500_000)).toBe('2.50M')
    expect(formatCompactUsdt(0.4)).toBe('0.40')
  })
})
