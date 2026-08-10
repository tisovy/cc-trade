import { describe, expect, it } from 'vitest'
import {
  futuresBookGroupKey,
  futuresBookGroupSteps,
  groupFuturesBookLevels,
} from './futuresOrderBook.js'

const level = (price, quantity) => ({ price, quantity })

describe('futuresBookGroupSteps', () => {
  it('derives steps from the contract tick so a step is always tradable', () => {
    expect(futuresBookGroupSteps('0.0001').slice(0, 4)).toEqual([
      { multiplier: 1, step: '0.0001' },
      { multiplier: 2, step: '0.0002' },
      { multiplier: 5, step: '0.0005' },
      { multiplier: 10, step: '0.001' },
    ])
  })

  it('offers no steps when the contract filters have not arrived', () => {
    expect(futuresBookGroupSteps(null)).toEqual([])
    expect(futuresBookGroupSteps('0')).toEqual([])
  })
})

describe('groupFuturesBookLevels', () => {
  it('denominates size and cumulative size in USDT', () => {
    const rows = groupFuturesBookLevels({
      levels: [level('0.02', '1000'), level('0.019', '2000')],
      side: 'bid',
    })
    expect(rows).toEqual([
      {
        price: '0.02',
        groupKey: futuresBookGroupKey({ price: '0.02', side: 'bid' }),
        quantity: '1000',
        notionalUsdt: 20,
        cumulativeUsdt: 20,
      },
      {
        price: '0.019',
        groupKey: futuresBookGroupKey({ price: '0.019', side: 'bid' }),
        quantity: '2000',
        notionalUsdt: 38,
        cumulativeUsdt: 58,
      },
    ])
  })

  it('maps an order resting inside a grouped bucket onto that bucket row', () => {
    const bids = groupFuturesBookLevels({
      levels: [level('100.07', '1'), level('99.98', '1')],
      side: 'bid',
      step: '0.1',
    })
    // The row prints its boundary 100.0, but an order at 100.07 rests in it.
    expect(futuresBookGroupKey({ price: '100.07', side: 'bid', step: '0.1' }))
      .toBe(bids[0].groupKey)
    expect(futuresBookGroupKey({ price: '99.98', side: 'bid', step: '0.1' }))
      .toBe(bids[1].groupKey)
  })

  it('has no group key for a price it cannot parse', () => {
    expect(futuresBookGroupKey({ price: 'x', side: 'bid', step: '0.1' })).toBeNull()
    expect(futuresBookGroupKey({ price: null })).toBeNull()
  })

  it('keeps the exchange price string when no grouping applies', () => {
    const [row] = groupFuturesBookLevels({ levels: [level('58420.50', '1')], side: 'ask' })
    expect(row.price).toBe('58420.50')
  })

  it('aggregates a bid group down to its boundary and an ask group up to its', () => {
    const bids = groupFuturesBookLevels({
      levels: [level('100.07', '1'), level('100.03', '2'), level('99.98', '1')],
      side: 'bid',
      step: '0.1',
    })
    expect(bids.map(row => row.price)).toEqual(['100.0', '99.9'])
    expect(bids[0].quantity).toBe('3')
    expect(bids[0].notionalUsdt).toBeCloseTo(300.13, 6)

    const asks = groupFuturesBookLevels({
      levels: [level('100.01', '1'), level('100.06', '2')],
      side: 'ask',
      step: '0.1',
    })
    expect(asks.map(row => row.price)).toEqual(['100.1'])
    expect(asks[0].quantity).toBe('3')
  })

  it('accumulates exactly across many levels instead of drifting', () => {
    const levels = Array.from({ length: 100 }, () => level('0.1', '0.1'))
    const rows = groupFuturesBookLevels({ levels, side: 'bid', step: '0.1', limit: 5 })
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity).toBe('10')
    expect(rows[0].cumulativeUsdt).toBe(1)
  })

  // A row is closed by the next row opening, not by a level count. Stopping any
  // earlier under-reports the last row on screen; not stopping at all walks a
  // thousand delivered levels to fill fourteen, ten times a second.
  it('closes a row only once the next one opens, however deep the book runs', () => {
    const rows = groupFuturesBookLevels({
      levels: [
        level('100.09', '1'), level('100.02', '2'),
        level('99.97', '4'), level('99.91', '8'),
        ...Array.from({ length: 900 }, (_, index) => level((99 - index * 0.01).toFixed(2), '1')),
      ],
      side: 'bid',
      step: '0.1',
      limit: 2,
    })
    expect(rows.map(row => row.price)).toEqual(['100.0', '99.9'])
    expect(rows[0].quantity).toBe('3')
    expect(rows[1].quantity).toBe('12')
  })

  it('drops empty and malformed levels and honours the row limit', () => {
    const rows = groupFuturesBookLevels({
      levels: [level('1', '0'), level('x', '1'), level('2', '1'), level('3', '1')],
      side: 'ask',
      limit: 1,
    })
    expect(rows).toEqual([{
      price: '2',
      groupKey: futuresBookGroupKey({ price: '2', side: 'ask' }),
      quantity: '1',
      notionalUsdt: 2,
      cumulativeUsdt: 2,
    }])
  })
})
