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
        anchorPrice: null,
      },
    })
  })

  // The print the mark was taken beside travels with it, under the same
  // validation the other prices get: it is a price, and an unusable one is no
  // more usable here than anywhere else.
  it('carries the print each mark was taken beside', () => {
    expect(readFuturesPositionMarks({
      BMTUSDT: {
        markPrice: '0.03600',
        updatedAt: 1,
        anchorPrice: '0.03598',
        lastPrice: '0.03611',
        lastPriceAt: 2,
      },
      ETHUSDT: { markPrice: '2500', updatedAt: 1, anchorPrice: '0' },
    })).toEqual({
      BMTUSDT: {
        markPrice: '0.03600',
        updatedAt: 1,
        anchorPrice: '0.03598',
        lastPrice: '0.03611',
        lastPriceAt: 2,
      },
      ETHUSDT: { markPrice: '2500', updatedAt: 1, anchorPrice: null, lastPrice: null, lastPriceAt: null },
    })
  })

  // A mark with no print beside it is the ordinary state for the first second
  // of a contract, and an unusable print is not a reason to drop the mark.
  it('keeps a mark whose last price is missing or unusable', () => {
    expect(readFuturesPositionMarks({
      BMTUSDT: { markPrice: '0.03600', updatedAt: 1, lastPrice: '0', lastPriceAt: 2 },
      ETHUSDT: { markPrice: '2500', updatedAt: 1 },
    })).toEqual({
      BMTUSDT: { markPrice: '0.03600', updatedAt: 1, lastPrice: null, lastPriceAt: 2, anchorPrice: null },
      ETHUSDT: { markPrice: '2500', updatedAt: 1, lastPrice: null, lastPriceAt: null, anchorPrice: null },
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
        // The tape stood at 0.03610 when the mark was taken and has printed
        // 0.03650 since, so the mark is carried forward by the 0.00040 the
        // market has actually moved — not replaced by the tape's own level.
        anchorPrice: '0.03610',
        lastPrice: '0.03650',
        lastPriceAt: 2,
      },
    })
    // (0.03640 - 0.03140) × -446082 contracts.
    expect(Number(merged.unrealizedPnl)).toBeCloseTo(-2230.41, 2)
    expect(merged).toMatchObject({
      // The mark itself is untouched: it is what the liquidation is measured
      // against, and the estimate is not.
      markPrice: '0.03600',
      valuationEstimated: true,
    })
    expect(Number(merged.valuationPrice)).toBeCloseTo(0.0364, 8)
    expect(merged.liquidationPrice).toBe(position.liquidationPrice)
    // And the mark's own arithmetic is kept beside the estimate: every margin
    // reading is measured from it, and the reading states it as its confirmation.
    // (0.03600 - 0.03140) × -446082 contracts.
    expect(Number(merged.markUnrealizedPnl)).toBeCloseTo(-2051.98, 2)
  })

  // The defect this whole rule exists to remove. A short is in profit whenever
  // the price is below its entry — the operator reads that off their own ENTRY
  // SHORT line on the chart — and on a fast move the exchange's mark lags the
  // tape far enough that the two straddle the entry. Substituting one series for
  // the other then made the sign of a live position depend on which of two
  // sockets happened to deliver last.
  it('does not reverse a position because a print outran the mark', () => {
    // Short 2873 at 3.3450. The mark is above the entry, the tape below it.
    const short = {
      symbol: 'BEATUSDT',
      quantity: '-2873',
      entryPrice: '3.3450',
      markPrice: '3.37',
      unrealizedPnl: '-96.74',
    }
    const market = { markPrice: '3.36', anchorPrice: '3.3005', lastPrice: '3.30' }
    const [afterPrint] = mergeFuturesPositionMarks([short], {
      BEATUSDT: { ...market, updatedAt: 1, lastPriceAt: 2 },
    })
    const [afterMark] = mergeFuturesPositionMarks([short], {
      BEATUSDT: { ...market, updatedAt: 2, lastPriceAt: 1 },
    })
    // Same market, same position — only which reading arrived last differs. The
    // mark is above the entry, so the position is at a loss on both readings.
    expect(Number(afterPrint.unrealizedPnl)).toBeLessThan(0)
    expect(Number(afterMark.unrealizedPnl)).toBeLessThan(0)
    // They differ only by what the tape has done since the mark was taken —
    // 0.0005 over 2873 contracts, about 1.44 USDT — and not by the whole
    // mark-to-tape spread of 0.06, which is the 172 USDT swing that used to
    // turn this position's loss into a profit and back.
    expect(Math.abs(Number(afterPrint.unrealizedPnl) - Number(afterMark.unrealizedPnl)))
      .toBeLessThan(5)
    // And the tape's own level travels with it, so the surface can say why the
    // row disagrees with the chart instead of leaving it to read as broken.
    expect(afterPrint.tapePrice).toBe('3.30')
  })

  // Continuity is the property that makes the estimate safe: with a still tape
  // the carried-forward figure is the mark, so a mark arriving cannot move the
  // reading by itself.
  it('is unchanged by a mark arriving while the tape stands still', () => {
    const [estimated] = mergeFuturesPositionMarks([position], {
      BMTUSDT: {
        markPrice: '0.03600',
        updatedAt: 1,
        anchorPrice: '0.03610',
        lastPrice: '0.03610',
        lastPriceAt: 2,
      },
    })
    const [confirmed] = mergeFuturesPositionMarks([position], {
      BMTUSDT: { markPrice: '0.03600', updatedAt: 3, lastPrice: '0.03610', lastPriceAt: 2 },
    })
    expect(Number(estimated.unrealizedPnl)).toBeCloseTo(Number(confirmed.unrealizedPnl), 6)
    expect(Number(estimated.valuationPrice)).toBeCloseTo(0.036, 8)
  })

  // Without the print the mark was taken beside there is nothing to carry the
  // mark forward by, and the only thing left to do with the tape is substitute
  // it — which is the defect.
  it('values at the mark when it has no print to carry it forward from', () => {
    const [merged] = mergeFuturesPositionMarks([position], {
      BMTUSDT: { markPrice: '0.03600', updatedAt: 1, lastPrice: '0.03650', lastPriceAt: 2 },
    })
    expect(merged).toMatchObject({ valuationPrice: '0.03600', valuationEstimated: false })
    expect(Number(merged.unrealizedPnl)).toBeCloseTo(-2051.98, 2)
  })

  // A price is a positive number, and an extrapolation is not exempt.
  it('stands on the mark when carrying it forward lands at or below zero', () => {
    const [merged] = mergeFuturesPositionMarks([position], {
      BMTUSDT: {
        markPrice: '0.03600',
        updatedAt: 1,
        anchorPrice: '0.09000',
        lastPrice: '0.00100',
        lastPriceAt: 2,
      },
    })
    expect(merged).toMatchObject({ valuationPrice: '0.03600', valuationEstimated: false })
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
