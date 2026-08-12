import { describe, expect, it } from 'vitest'
import {
  mergeFuturesPositionMarks,
  readFuturesPositionMarks,
} from './futuresPositionMarks.js'

const position = Object.freeze({
  symbol: 'BMTUSDT',
  positionSide: 'BOTH',
  quantity: '-446082',
  entryPrice: '0.03140',
  markPrice: '0.03523',
  liquidationPrice: '0.04102',
  unrealizedPnl: '-1708.49',
})

describe('readFuturesPositionMarks', () => {
  it('keeps usable marks and drops the rest', () => {
    expect(readFuturesPositionMarks({
      bmtusdt: {
        markPrice: '0.03600',
        updatedAt: 1_700_000_000_000,
        lastPrice: '0.03611',
        lastPriceAt: 1_700_000_000_400,
      },
      ZEROUSDT: { markPrice: '0' },
      BROKENUSDT: { markPrice: 'abc' },
      EMPTYUSDT: null,
    })).toEqual({
      BMTUSDT: {
        markPrice: '0.03600',
        updatedAt: 1_700_000_000_000,
        lastPrice: '0.03611',
        lastPriceAt: 1_700_000_000_400,
      },
    })
  })

  // A mark with no print beside it is the ordinary state for the first second
  // of a contract, and an unusable print is not a reason to drop the mark.
  it('keeps a mark whose last price is missing or unusable', () => {
    expect(readFuturesPositionMarks({
      BMTUSDT: { markPrice: '0.03600', updatedAt: 1, lastPrice: '0', lastPriceAt: 2 },
      ETHUSDT: { markPrice: '2500', updatedAt: 1 },
    })).toEqual({
      BMTUSDT: { markPrice: '0.03600', updatedAt: 1, lastPrice: null, lastPriceAt: 2 },
      ETHUSDT: { markPrice: '2500', updatedAt: 1, lastPrice: null, lastPriceAt: null },
    })
  })

  it('refuses a payload that is not a mark map', () => {
    expect(readFuturesPositionMarks('BMTUSDT')).toBeNull()
    expect(readFuturesPositionMarks(null)).toBeNull()
  })
})

describe('mergeFuturesPositionMarks', () => {
  it('re-values a position at the live mark', () => {
    const [merged] = mergeFuturesPositionMarks([position], {
      BMTUSDT: { markPrice: '0.03600', updatedAt: 1 },
    })
    expect(merged.markPrice).toBe('0.03600')
    // (0.03600 - 0.03140) × -446082 contracts.
    expect(Number(merged.unrealizedPnl)).toBeCloseTo(-2051.98, 2)
    expect(merged).toMatchObject({ valuationPrice: '0.03600', valuationEstimated: false })
  })

  // Binance publishes no mark faster than one a second, and the move the
  // operator is trading happens inside that second.
  it('re-prices against a print that happened after the mark', () => {
    const [merged] = mergeFuturesPositionMarks([position], {
      BMTUSDT: {
        markPrice: '0.03600',
        updatedAt: 1,
        lastPrice: '0.03650',
        lastPriceAt: 2,
      },
    })
    // (0.03650 - 0.03140) × -446082 contracts.
    expect(Number(merged.unrealizedPnl)).toBeCloseTo(-2275.02, 2)
    expect(merged).toMatchObject({
      // The mark itself is untouched: it is what the liquidation is measured
      // against, and the estimate is not.
      markPrice: '0.03600',
      valuationPrice: '0.03650',
      valuationEstimated: true,
    })
    expect(merged.liquidationPrice).toBe(position.liquidationPrice)
  })

  it('lets a mark replace the estimate the print made', () => {
    const [merged] = mergeFuturesPositionMarks([position], {
      BMTUSDT: {
        markPrice: '0.03600',
        updatedAt: 3,
        lastPrice: '0.03650',
        lastPriceAt: 2,
      },
    })
    expect(Number(merged.unrealizedPnl)).toBeCloseTo(-2051.98, 2)
    expect(merged).toMatchObject({ valuationPrice: '0.03600', valuationEstimated: false })
  })

  // Without both stamps there is no way to tell a print that happened after the
  // mark from one that happened before it, and a guess is not worth the risk of
  // presenting an older price as the newer reading.
  it('does not estimate from a print it cannot place in time', () => {
    const [noTradeStamp] = mergeFuturesPositionMarks([position], {
      BMTUSDT: { markPrice: '0.03600', updatedAt: 1, lastPrice: '0.03650' },
    })
    const [noMarkStamp] = mergeFuturesPositionMarks([position], {
      BMTUSDT: { markPrice: '0.03600', lastPrice: '0.03650', lastPriceAt: 2 },
    })
    expect(noTradeStamp.valuationEstimated).toBe(false)
    expect(noMarkStamp.valuationEstimated).toBe(false)
  })

  it('leaves the account snapshot alone when no mark has arrived', () => {
    const positions = [position]
    expect(mergeFuturesPositionMarks(positions, {})).toBe(positions)
    expect(mergeFuturesPositionMarks(positions, null)).toBe(positions)
  })

  it('never half re-values a position whose inputs are unusable', () => {
    const marks = { BMTUSDT: { markPrice: '0.03600' } }
    const withoutEntry = [{ ...position, entryPrice: '0' }]
    const withoutQuantity = [{ ...position, quantity: '0' }]
    expect(mergeFuturesPositionMarks(withoutEntry, marks)).toBe(withoutEntry)
    expect(mergeFuturesPositionMarks(withoutQuantity, marks)).toBe(withoutQuantity)
  })

  it('ignores a mark for a symbol that is not open', () => {
    const positions = [position]
    expect(mergeFuturesPositionMarks(positions, { ETHUSDT: { markPrice: '2500' } }))
      .toBe(positions)
  })
})
