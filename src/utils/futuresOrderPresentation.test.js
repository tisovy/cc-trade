import { describe, expect, it } from 'vitest'
import {
  describeFuturesOrderIntent,
  describeFuturesPosition,
  describeFuturesPositionMargin,
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
} from './futuresOrderPresentation.js'

describe('describeFuturesOrderIntent', () => {
  it('colours by side so a one-way BUY never reads as a short', () => {
    expect(describeFuturesOrderIntent({ side: 'BUY', positionSide: 'BOTH' })).toMatchObject({
      side: 'BUY',
      positionSide: 'LONG',
      positionEffect: 'ENTRY',
      tone: 'buy',
      label: 'LONG',
    })
    expect(describeFuturesOrderIntent({ side: 'SELL', positionSide: 'BOTH' })).toMatchObject({
      positionSide: 'SHORT',
      positionEffect: 'ENTRY',
      tone: 'sell',
    })
  })

  it('reads one-way reduce-only orders as exits of the opposite leg', () => {
    expect(describeFuturesOrderIntent({
      side: 'SELL', positionSide: 'BOTH', reduceOnly: true,
    })).toMatchObject({ positionSide: 'LONG', positionEffect: 'EXIT', tone: 'sell' })
    expect(describeFuturesOrderIntent({
      side: 'BUY', positionSide: 'BOTH', reduceOnly: true,
    })).toMatchObject({ positionSide: 'SHORT', positionEffect: 'EXIT', tone: 'buy' })
  })

  it('trusts the declared leg on hedge accounts', () => {
    expect(describeFuturesOrderIntent({ side: 'BUY', positionSide: 'SHORT' }))
      .toMatchObject({ positionSide: 'SHORT', positionEffect: 'EXIT', tone: 'buy' })
    expect(describeFuturesOrderIntent({ side: 'SELL', positionSide: 'SHORT' }))
      .toMatchObject({ positionSide: 'SHORT', positionEffect: 'ENTRY', tone: 'sell' })
  })
})

describe('describeFuturesPosition', () => {
  it('derives the leg from the signed quantity and reports ROE against margin', () => {
    expect(describeFuturesPosition({
      symbol: 'BTCUSDT',
      positionSide: 'BOTH',
      quantity: '-0.5',
      entryPrice: '60000',
      leverage: '10',
      unrealizedPnl: '-150',
    })).toMatchObject({
      positionSide: 'SHORT',
      tone: 'sell',
      absoluteQuantity: 0.5,
      notional: 30000,
      pnlTone: 'negative',
    })
    expect(describeFuturesPosition({
      quantity: '0.5', entryPrice: '60000', leverage: '10', unrealizedPnl: '300',
    }).roePercent).toBeCloseTo(10)
  })

  it('values a short at the mark as an amount, not as a negative number', () => {
    expect(describeFuturesPosition({
      quantity: '-0.5',
      entryPrice: '60000',
      markPrice: '60600',
    }).markNotional).toBe(30300)
  })

  it('stays neutral when the exchange has not reported numbers yet', () => {
    expect(describeFuturesPosition({})).toMatchObject({
      positionSide: 'LONG',
      quantity: null,
      roePercent: null,
      pnlTone: 'flat',
    })
  })
})

describe('describeFuturesPositionMargin', () => {
  // `/fapi/v3/positionRisk` reports no marginType, so the mode has to be read
  // from the walled-off funds themselves.
  it('reads the isolated mode from the wallet the position holds', () => {
    expect(describeFuturesPositionMargin({
      quantity: '0.5',
      entryPrice: '60000',
      isolatedWallet: '512.4',
      isolatedMargin: '480',
      initialMargin: '300',
    })).toEqual({ marginMode: 'ISOLATED', margin: 512.4, adjustable: true })
  })

  it('reports a position with no isolated wallet as cross and refuses adjustment', () => {
    expect(describeFuturesPositionMargin({
      quantity: '0.5',
      entryPrice: '60000',
      isolatedWallet: '0',
      initialMargin: '3000',
    })).toEqual({ marginMode: 'CROSS', margin: 3000, adjustable: false })
  })

  it('believes a source that states the mode outright', () => {
    expect(describeFuturesPositionMargin({
      marginType: 'CROSSED', quantity: '0.5', entryPrice: '60000', leverage: '10',
    })).toMatchObject({ marginMode: 'CROSS', adjustable: false })
    expect(describeFuturesPositionMargin({
      marginType: 'ISOLATED', quantity: '0.5', entryPrice: '60000', initialMargin: '3000',
    })).toMatchObject({ marginMode: 'ISOLATED', margin: 3000, adjustable: true })
  })

  it('reports no margin at all rather than a confident zero', () => {
    expect(describeFuturesPositionMargin({ quantity: '0.5', entryPrice: '60000' }))
      .toEqual({ marginMode: null, margin: null, adjustable: false })
    expect(describeFuturesPositionMargin({})).toMatchObject({ margin: null, adjustable: false })
  })

  // The row shows the percentage and the amount it was divided by. Computing
  // them apart is how the two come to disagree.
  it('is the denominator of the ROE on the same row', () => {
    const position = {
      quantity: '0.5', entryPrice: '60000', isolatedWallet: '1500', unrealizedPnl: '150',
    }
    const { margin } = describeFuturesPositionMargin(position)
    expect(margin).toBe(1500)
    expect(describeFuturesPosition(position).roePercent).toBeCloseTo(10)
  })
})

describe('signed formatting', () => {
  it('always shows the sign so gains and losses are distinguishable at a glance', () => {
    expect(formatSignedUsdt('12.3456')).toBe('+12.35')
    expect(formatSignedUsdt(-4)).toBe('−4.00')
    expect(formatSignedUsdt(0)).toBe('0.00')
    expect(formatSignedUsdt('abc')).toBe('—')
    expect(formatSignedPercent(-3.5)).toBe('−3.50%')
  })

  it('reports an absent number as absent instead of as a confident zero', () => {
    expect(formatSignedUsdt(null)).toBe('—')
    expect(formatSignedPercent(undefined)).toBe('—')
    expect(describeFuturesPosition({ quantity: '1', entryPrice: '10' }).roePercent).toBeNull()
  })

  it('states an amount without a sign, because an amount has no direction', () => {
    expect(formatUsdt('15716.4949')).toBe('15716.49')
    expect(formatUsdt(-15716.49)).toBe('15716.49')
    expect(formatUsdt(null)).toBe('—')
  })
})
