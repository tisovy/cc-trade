import { describe, expect, it } from 'vitest'
import {
  FUTURES_BNB_FEE_RESERVE_LOW_USDT,
  collectFuturesFeeValuationMissingMinutes,
  createFuturesFeeValuationPriceLookup,
  futuresFeeNotIncludedTitle,
  futuresFeeValuationMinute,
  futuresFeeValuationTitle,
  mergeFuturesFeeValuationPrices,
  readFuturesFeeReserve,
  readFuturesFeeValuationFrame,
  valueFuturesForeignFees,
} from './futuresFeeValuation.js'

const MINUTE = 60_000
const minuteA = 1_756_000_020_000

describe('createFuturesFeeValuationPriceLookup', () => {
  it('answers the minute holding the charge and null for everything unknown', () => {
    const lookup = createFuturesFeeValuationPriceLookup({
      BNBUSDT: { [minuteA]: '612.34', [minuteA + MINUTE]: null },
    })
    expect(lookup('BNBUSDT', minuteA + 30_500)).toEqual({ price: '612.34', minute: minuteA })
    // A minute answered null is a final absence, not a price.
    expect(lookup('BNBUSDT', minuteA + MINUTE + 1)).toBeNull()
    expect(lookup('BNBUSDT', minuteA + (2 * MINUTE))).toBeNull()
    expect(lookup('ETHUSDT', minuteA)).toBeNull()
    expect(lookup('BNBUSDT', Number.NaN)).toBeNull()
  })
})

describe('collectFuturesFeeValuationMissingMinutes', () => {
  it('collects incomplete valuations per pair, newest first, deduplicated', () => {
    const rounds = [
      {
        feeValuations: [
          { pair: 'BNBUSDT', complete: false, missingMinutes: [minuteA, minuteA + MINUTE] },
        ],
      },
      {
        feeValuations: [
          { pair: 'BNBUSDT', complete: false, missingMinutes: [minuteA] },
          { pair: 'BNBUSDT', complete: true, missingMinutes: [] },
        ],
      },
    ]
    const needed = collectFuturesFeeValuationMissingMinutes(rounds)
    expect([...needed.keys()]).toEqual(['BNBUSDT'])
    expect(needed.get('BNBUSDT')).toEqual([minuteA + MINUTE, minuteA])
  })
})

describe('readFuturesFeeValuationFrame', () => {
  it('accepts a canonical frame and refuses a malformed price or minute', () => {
    expect(readFuturesFeeValuationFrame({
      type: 'futures_fee_valuation',
      version: 1,
      pair: 'BNBUSDT',
      prices: { [minuteA]: '612.34', [minuteA + MINUTE]: null },
    })).toEqual({
      pair: 'BNBUSDT',
      prices: { [minuteA]: '612.34', [minuteA + MINUTE]: null },
    })
    expect(readFuturesFeeValuationFrame({
      type: 'futures_fee_valuation', version: 1, pair: 'BNBUSDT',
      prices: { [minuteA]: '-1' },
    })).toBeNull()
    expect(readFuturesFeeValuationFrame({
      type: 'futures_fee_valuation', version: 1, pair: 'BNBUSDT',
      prices: { [minuteA + 1]: '612.34' },
    })).toBeNull()
    expect(readFuturesFeeValuationFrame({
      type: 'futures_fee_valuation', version: 1, pair: 'bnb', prices: {},
    })).toBeNull()
  })
})

describe('mergeFuturesFeeValuationPrices', () => {
  it('merges new minutes, keeps identity when nothing changed, never nulls a price', () => {
    const held = { BNBUSDT: { [minuteA]: '612.34' } }
    const merged = mergeFuturesFeeValuationPrices(held, {
      pair: 'BNBUSDT',
      prices: { [minuteA + MINUTE]: '613.1' },
    })
    expect(merged.BNBUSDT).toEqual({ [minuteA]: '612.34', [minuteA + MINUTE]: '613.1' })
    // Same content again: the held object is returned unchanged, so memoized
    // folds do not re-run for a frame that taught nothing.
    expect(mergeFuturesFeeValuationPrices(merged, {
      pair: 'BNBUSDT',
      prices: { [minuteA]: '612.34' },
    })).toBe(merged)
    // A held price is a fact; a later null cannot erase it.
    expect(mergeFuturesFeeValuationPrices(merged, {
      pair: 'BNBUSDT',
      prices: { [minuteA]: null },
    })).toBe(merged)
  })
})

describe('valueFuturesForeignFees', () => {
  const feeValuations = [{
    asset: 'BNB',
    pair: 'BNBUSDT',
    amount: 0.0085,
    amountExact: '0.0085',
    valuedAmount: '5.19',
    complete: true,
    prices: [{ price: '612.34', minute: minuteA }],
    missingMinutes: [],
  }]

  it('folds a fully valued foreign fee onto the settlement amount exactly', () => {
    const valued = valueFuturesForeignFees({
      amounts: [
        { asset: 'USDT', amount: '120' },
        { asset: 'BNB', amount: '-0.0085' },
      ],
      settlementAsset: 'USDT',
      feeValuations,
    })
    expect(valued).toMatchObject({
      amount: '114.81',
      settlementAmount: '120',
      settlementAsset: 'USDT',
    })
    expect(valued.valuations).toHaveLength(1)
  })

  it('refuses when the foreign amount is not exactly the charged fee', () => {
    // Something else moved BNB besides this commission (a rebate, a mismatch):
    // valuing part of an amount and presenting the sum as the whole would be a
    // wrong number.
    expect(valueFuturesForeignFees({
      amounts: [
        { asset: 'USDT', amount: '120' },
        { asset: 'BNB', amount: '-0.008' },
      ],
      settlementAsset: 'USDT',
      feeValuations,
    })).toBeNull()
  })

  it('refuses on an incomplete valuation and on no foreign amounts at all', () => {
    expect(valueFuturesForeignFees({
      amounts: [
        { asset: 'USDT', amount: '120' },
        { asset: 'BNB', amount: '-0.0085' },
      ],
      settlementAsset: 'USDT',
      feeValuations: [{ ...feeValuations[0], complete: false, valuedAmount: null }],
    })).toBeNull()
    expect(valueFuturesForeignFees({
      amounts: [{ asset: 'USDT', amount: '120' }],
      settlementAsset: 'USDT',
      feeValuations,
    })).toBeNull()
  })
})

describe('fee titles', () => {
  it('names both quantities and the price used', () => {
    const title = futuresFeeValuationTitle({
      asset: 'BNB',
      pair: 'BNBUSDT',
      amountExact: '0.0085',
      valuedAmount: '5.19',
      prices: [{ price: '612.34', minute: minuteA }],
    })
    expect(title).toContain('fee 0.0085 BNB')
    expect(title).toContain('valued −5.19 USDT')
    expect(title).toContain('BNBUSDT 612.34')
  })

  it('states an unvalued fee as not included with its reason', () => {
    const title = futuresFeeNotIncludedTitle({
      asset: 'BNB',
      pair: 'BNBUSDT',
      amountExact: '0.0085',
    })
    expect(title).toContain('fee 0.0085 BNB not included')
    expect(title).toContain('no readable BNBUSDT price')
  })
})

describe('readFuturesFeeReserve', () => {
  const now = minuteA + (10 * MINUTE) + 30_000
  const latestCompleteMinute = futuresFeeValuationMinute(now - MINUTE)

  it('values the reserve at the newest priced minute and marks low under the bound', () => {
    const healthy = readFuturesFeeReserve({
      balances: { BNB: { available: '0.9', total: '1.0' } },
      prices: { [latestCompleteMinute]: '612.34' },
      now,
    })
    expect(healthy).toMatchObject({
      state: 'ok',
      amount: '1.0',
      price: '612.34',
      priceMinute: latestCompleteMinute,
      low: false,
      requestMinute: latestCompleteMinute,
    })
    expect(healthy.worth).toBeCloseTo(612.34, 6)

    const low = readFuturesFeeReserve({
      balances: { BNB: { available: '0.07', total: '0.08' } },
      prices: { [latestCompleteMinute]: '612.34' },
      now,
    })
    expect(low.state).toBe('low')
    expect(low.low).toBe(true)
    expect(low.worth).toBeLessThan(FUTURES_BNB_FEE_RESERVE_LOW_USDT)
  })

  it('reaches back to an older priced minute within the staleness bound', () => {
    const older = latestCompleteMinute - (5 * MINUTE)
    const reserve = readFuturesFeeReserve({
      balances: { BNB: { total: '1.0' } },
      prices: { [older]: '600' },
      now,
    })
    expect(reserve).toMatchObject({ state: 'ok', price: '600', priceMinute: older })
  })

  it('states unread, absent and unpriced instead of a zero that looks read', () => {
    expect(readFuturesFeeReserve({ balances: null, prices: {}, now }).state).toBe('unread')
    expect(readFuturesFeeReserve({
      balances: { USDT: { total: '100' } }, prices: {}, now,
    }).state).toBe('absent')
    const unpriced = readFuturesFeeReserve({
      balances: { BNB: { total: '1.0' } }, prices: {}, now,
    })
    expect(unpriced).toMatchObject({ state: 'unpriced', amount: '1.0', worth: null })
  })
})
