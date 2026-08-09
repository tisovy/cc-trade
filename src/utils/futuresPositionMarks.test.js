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
  unrealizedPnl: '-1708.49',
})

describe('readFuturesPositionMarks', () => {
  it('keeps usable marks and drops the rest', () => {
    expect(readFuturesPositionMarks({
      bmtusdt: { markPrice: '0.03600', updatedAt: 1_700_000_000_000 },
      ZEROUSDT: { markPrice: '0' },
      BROKENUSDT: { markPrice: 'abc' },
      EMPTYUSDT: null,
    })).toEqual({
      BMTUSDT: { markPrice: '0.03600', updatedAt: 1_700_000_000_000 },
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
