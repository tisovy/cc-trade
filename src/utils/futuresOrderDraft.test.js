import { describe, expect, it } from 'vitest'
import {
  calculateFuturesEntryBudget,
  calculateFuturesExitBudget,
  calculateFuturesNotionalForPercent,
  calculateFuturesNotionalPercent,
  deriveFuturesLimitOrderDraft,
  isFuturesDraftAmountWithinBudget,
  normalizeFuturesDraftPrice,
} from './futuresOrderDraft.js'

describe('futuresOrderDraft', () => {
  it('normalizes a picked price down to the exact Binance tick', () => {
    expect(normalizeFuturesDraftPrice('67234.12999999', '0.1')).toBe('67234.1')
    expect(normalizeFuturesDraftPrice('0.00000129', '0.0000001')).toBe('0.0000012')
  })

  it('keeps the percent and USDT controls synchronized without Number arithmetic', () => {
    expect(calculateFuturesNotionalForPercent('10', 25)).toBe('2.5')
    expect(calculateFuturesNotionalForPercent('0.000000000000000003', 66)).toBe(
      '0.000000000000000001',
    )
    expect(calculateFuturesNotionalPercent('7.5', '10')).toBe(75)
    expect(calculateFuturesNotionalPercent('25', '10')).toBe(100)
  })

  it('uses the smaller exact order or remaining daily cap as the entry budget', () => {
    expect(calculateFuturesEntryBudget({
      maximumOrderNotionalUsdt: '10',
      maximumDailyNotionalUsdt: '50',
      dailyUsedNotionalUsdt: '43.75',
    })).toBe('6.25')
    expect(calculateFuturesEntryBudget({
      maximumOrderNotionalUsdt: '10',
      maximumDailyNotionalUsdt: '50',
      dailyUsedNotionalUsdt: '50',
    })).toBe('0')
  })

  it('bounds new exposure by authoritative available balance, reserve, and leverage', () => {
    expect(calculateFuturesEntryBudget({
      maximumOrderNotionalUsdt: '100',
      maximumDailyNotionalUsdt: '500',
      dailyUsedNotionalUsdt: '0',
      availableBalanceUsdt: '18.75',
      minimumAvailableBalanceUsdt: '10',
      leverage: 2,
    })).toBe('17.5')
    expect(calculateFuturesEntryBudget({
      maximumOrderNotionalUsdt: '100',
      maximumDailyNotionalUsdt: '500',
      dailyUsedNotionalUsdt: '0',
      availableBalanceUsdt: '10',
      minimumAvailableBalanceUsdt: '10',
      leverage: 2,
    })).toBe('0')
    expect(calculateFuturesEntryBudget({
      maximumOrderNotionalUsdt: '100',
      maximumDailyNotionalUsdt: '500',
      dailyUsedNotionalUsdt: '0',
      availableBalanceUsdt: undefined,
      minimumAvailableBalanceUsdt: '10',
      leverage: 2,
    })).toBeNull()
  })

  it('bounds an exit slider by the exact selected Hedge leg, not entry exposure caps', () => {
    expect(calculateFuturesExitBudget({
      positionQuantity: '0.001',
      price: '7000.09',
      tickSize: '0.1',
      maximumOrderNotionalUsdt: '10',
      maximumDailyNotionalUsdt: '50',
      dailyUsedNotionalUsdt: '0',
    })).toBe('7')
    expect(calculateFuturesExitBudget({
      positionQuantity: '1',
      price: '7000',
      tickSize: '0.1',
      maximumOrderNotionalUsdt: '10',
      maximumDailyNotionalUsdt: '50',
      dailyUsedNotionalUsdt: '45',
    })).toBe('7000')
    expect(isFuturesDraftAmountWithinBudget('7000', '7000')).toBe(true)
    expect(isFuturesDraftAmountWithinBudget('7000.000000000000000001', '7000')).toBe(false)
  })

  it('derives quantity down to step size and reports exact notional and 2x margin', () => {
    expect(deriveFuturesLimitOrderDraft({
      notionalUsdt: '10',
      price: '2500.09',
      tickSize: '0.01',
      stepSize: '0.001',
      minQuantity: '0.001',
      maxQuantity: '1000',
      minNotionalUsdt: '5',
      leverage: 2,
    })).toEqual({
      ok: true,
      price: '2500.09',
      quantity: '0.003',
      notionalUsdt: '7.50027',
      estimatedMarginUsdt: '3.750135',
    })
  })

  it('aligns quantity to Binance LOT_SIZE from minQty rather than zero', () => {
    expect(deriveFuturesLimitOrderDraft({
      notionalUsdt: '16',
      price: '100',
      tickSize: '0.1',
      stepSize: '0.1',
      minQuantity: '0.05',
      maxQuantity: '1000',
      minNotionalUsdt: '5',
      leverage: 2,
    })).toEqual({
      ok: true,
      price: '100',
      quantity: '0.15',
      notionalUsdt: '15',
      estimatedMarginUsdt: '7.5',
    })
  })

  it('fails closed below Binance quantity and notional filters', () => {
    expect(deriveFuturesLimitOrderDraft({
      notionalUsdt: '1',
      price: '67000',
      tickSize: '0.1',
      stepSize: '0.001',
      minQuantity: '0.001',
      maxQuantity: '1000',
      minNotionalUsdt: '5',
    })).toEqual({ ok: false, reason: 'BELOW_MINIMUM_QUANTITY' })
  })
})
