import { describe, expect, it } from 'vitest'
import {
  calculateFuturesEntryBudget,
  calculateFuturesExitBudget,
  calculateFuturesNotionalForPercent,
  calculateFuturesNotionalPercent,
  calculateFuturesOrderNotional,
  deriveFuturesLimitOrderDraft,
  evaluateFuturesLimitSubmission,
  evaluateFuturesOrderRisk,
  exceedsFuturesOrderCap,
  isFuturesDraftAmountWithinBudget,
  normalizeFuturesDraftPrice,
  quantizeFuturesNotionalUsdt,
} from './futuresOrderDraft.js'

describe('futuresOrderDraft', () => {
  it('normalizes a picked price down to the exact Binance tick', () => {
    expect(normalizeFuturesDraftPrice('67234.12999999', '0.1')).toBe('67234.1')
    expect(normalizeFuturesDraftPrice('0.00000129', '0.0000001')).toBe('0.0000012')
  })

  it('keeps the percent and USDT controls synchronized on whole USDT amounts', () => {
    // Sizing is quantized to whole USDT: 25% of 10 USDT floors to 2, not 2.5.
    expect(calculateFuturesNotionalForPercent('10', 25)).toBe('2')
    expect(calculateFuturesNotionalForPercent('1000', 25)).toBe('250')
    expect(calculateFuturesNotionalForPercent('0.000000000000000003', 66)).toBe('0')
    expect(quantizeFuturesNotionalUsdt('66030.478842815')).toBe('66030')
    expect(quantizeFuturesNotionalUsdt('not a number')).toBeNull()
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

  describe('the risk ceiling', () => {
    const capped = {
      notionalUsdt: '250',
      price: '50000',
      tickSize: '0.1',
      stepSize: '0.001',
      minQuantity: '0.001',
      maxQuantity: '1000',
      minNotionalUsdt: '5',
      leverage: 1,
      maxOrderNotionalUsdt: '200',
    }

    it('values an order exactly, from strings or from main-process numbers', () => {
      expect(calculateFuturesOrderNotional('0.004', '40000')).toBe('160')
      expect(calculateFuturesOrderNotional(0.004, 2500000)).toBe('10000')
      // 0.1 × 3 is 0.30000000000000004 in float arithmetic, and exact here.
      expect(calculateFuturesOrderNotional('0.1', '3')).toBe('0.3')
      expect(calculateFuturesOrderNotional('0.004', null)).toBeNull()
    })

    it('treats an unreadable cap or an unvaluable order as over the ceiling', () => {
      expect(exceedsFuturesOrderCap('160', '200')).toBe(false)
      expect(exceedsFuturesOrderCap('200', '200')).toBe(false)
      expect(exceedsFuturesOrderCap('200.000000000000000001', '200')).toBe(true)
      // No ceiling configured is not a ceiling of zero.
      expect(exceedsFuturesOrderCap('10000', null)).toBe(false)
      expect(exceedsFuturesOrderCap('10000', '')).toBe(false)
      expect(exceedsFuturesOrderCap(null, '200')).toBe(true)
      expect(exceedsFuturesOrderCap('160', 'not a number')).toBe(true)
    })

    it('measures an amendment against the notional it will leave working', () => {
      expect(evaluateFuturesOrderRisk({
        quantity: '0.004',
        price: '2500000',
        maxOrderNotionalUsdt: 200,
      })).toEqual({
        ok: false,
        reason: 'ABOVE_ORDER_CAP',
        notionalUsdt: '10000',
        capUsdt: '200',
      })
      expect(evaluateFuturesOrderRisk({
        quantity: '0.004',
        price: '40000',
        maxOrderNotionalUsdt: 200,
      })).toEqual({ ok: true, notionalUsdt: '160', capUsdt: '200' })
    })

    it('exempts a reduce-only exit so a position stays closable', () => {
      expect(evaluateFuturesOrderRisk({
        quantity: '10',
        price: '2500000',
        maxOrderNotionalUsdt: 200,
        exposureIncreasing: false,
      })).toEqual({ ok: true, notionalUsdt: '25000000', capUsdt: null })
    })

    it('refuses an order it cannot value while a ceiling is active', () => {
      expect(evaluateFuturesOrderRisk({
        quantity: '0.004',
        price: null,
        maxOrderNotionalUsdt: 200,
      })).toEqual({
        ok: false,
        reason: 'UNPRICEABLE_ORDER',
        notionalUsdt: null,
        capUsdt: '200',
      })
    })

    // One evaluator, so every submission surface refuses the same draft for the
    // same stated reason instead of each carrying its own comparison.
    it('applies submittability first and the ceiling second', () => {
      expect(evaluateFuturesLimitSubmission({ ...capped, notionalUsdt: '1' }))
        .toEqual({ ok: false, reason: 'BELOW_MINIMUM_QUANTITY' })
      expect(evaluateFuturesLimitSubmission(capped)).toEqual({
        ok: false,
        reason: 'ABOVE_ORDER_CAP',
        notionalUsdt: '250',
        capUsdt: '200',
      })
      expect(evaluateFuturesLimitSubmission({ ...capped, exposureIncreasing: false }))
        .toMatchObject({ ok: true, notionalUsdt: '250' })
      expect(evaluateFuturesLimitSubmission({ ...capped, maxOrderNotionalUsdt: null }))
        .toMatchObject({ ok: true, notionalUsdt: '250' })
    })

    // The band and the order count belong to Binance. The evaluator has no
    // input to state them with, which is the guarantee: a draft priced outside
    // the contract band is submitted and refused by the exchange, in its words.
    it('has no local price band or open-order count to fail against', () => {
      expect(evaluateFuturesLimitSubmission({
        notionalUsdt: '250',
        price: '500',
        minPrice: '1000',
        maxPrice: '2000',
        maxNumOrders: 0,
        tickSize: '0.1',
        stepSize: '0.001',
        minQuantity: '0.001',
        maxQuantity: '1000',
        minNotionalUsdt: '5',
        leverage: 1,
      })).toMatchObject({ ok: true, price: '500', quantity: '0.5' })
    })
  })
})
