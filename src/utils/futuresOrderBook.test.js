import { describe, expect, it } from 'vitest'
import {
  GROUPING_MULTIPLIERS,
  futuresBookDepthRange,
  futuresBookGroupKey,
  futuresBookGroupSteps,
  futuresBookParsedDecimalCount,
  futuresBookWallKeys,
  groupFuturesBookLevels,
  readFuturesBookRows,
} from './futuresOrderBook.js'

const level = (price, quantity) => ({ price, quantity })

describe('futuresBookDepthRange', () => {
  // The reading the backend buys the book against: fourteen rows at a tick of
  // 0.000001 reach fourteen millionths past the best price, and a book bought
  // deeper than that costs ten times the weight for nothing.
  it('states how far the rows on screen reach, exactly', () => {
    expect(futuresBookDepthRange({ step: '0.000001', rows: 14 })).toBe('0.000014')
    expect(futuresBookDepthRange({ step: '0.5', rows: 200 })).toBe('100')
    expect(futuresBookDepthRange({ step: '0.1', rows: 3 })).toBe('0.3')
  })

  it('states nothing it cannot state exactly', () => {
    expect(futuresBookDepthRange({ step: '0', rows: 14 })).toBeNull()
    expect(futuresBookDepthRange({ step: '-1', rows: 14 })).toBeNull()
    expect(futuresBookDepthRange({ step: null, rows: 14 })).toBeNull()
    expect(futuresBookDepthRange({ step: '0.1', rows: 0 })).toBeNull()
    expect(futuresBookDepthRange({ step: '0.1', rows: 1.5 })).toBeNull()
    expect(futuresBookDepthRange()).toBeNull()
  })
})

describe('futuresBookGroupSteps', () => {
  it('derives steps from the contract tick so a step is always tradable', () => {
    expect(futuresBookGroupSteps({ tickSize: '0.0001' }).slice(0, 4)).toEqual([
      { multiplier: 1, step: '0.0001' },
      { multiplier: 2, step: '0.0002' },
      { multiplier: 5, step: '0.0005' },
      { multiplier: 10, step: '0.001' },
    ])
  })

  it('offers no steps when the contract filters have not arrived', () => {
    expect(futuresBookGroupSteps({ tickSize: null })).toEqual([])
    expect(futuresBookGroupSteps({ tickSize: '0' })).toEqual([])
    expect(futuresBookGroupSteps()).toEqual([])
  })

  // AKEUSDT as the exchange published it on 2026-08-13: a tick of 0.0000001 and
  // a thousand levels a side reaching 0.000317 below the best bid and 0.000301
  // above the best ask, on a mid of 0.00772395. The coarsest step the desk used
  // to offer was 500 ticks, whose fourteen rows ask for 0.0007 — more than twice
  // what the exchange publishes, drawn as six rows of book over eight blanks.
  it('ends the ladder at the coarsest step the reach can fill', () => {
    const steps = futuresBookGroupSteps({
      tickSize: '0.0000001',
      reach: { below: '0.000317', above: '0.000301' },
      rows: 14,
    })
    expect(steps.at(-1)).toEqual({ multiplier: 200, step: '0.00002' })
    // Fourteen rows of the last step fit inside the narrower side.
    expect(Number(steps.at(-1).step) * 14).toBeLessThanOrEqual(0.000301)
  })

  // The step is one step on both halves of the panel, so a ladder cut against
  // the side that reaches further asks the other half for rows nothing can fill.
  it('cuts against the narrower of the two sides', () => {
    const wide = { below: '0.000317', above: '0.000317' }
    const lopsided = { below: '0.000317', above: '0.000120' }
    expect(futuresBookGroupSteps({ tickSize: '0.0000001', reach: wide, rows: 14 }).at(-1))
      .toEqual({ multiplier: 200, step: '0.00002' })
    expect(futuresBookGroupSteps({ tickSize: '0.0000001', reach: lopsided, rows: 14 }).at(-1))
      .toEqual({ multiplier: 50, step: '0.000005' })
  })

  // Until the ladder of pages is exhausted the desk has not shown everything the
  // exchange publishes, so there is nothing to cut against — and cutting anyway
  // would stop the operator selecting the step that buys the deeper page.
  it('offers the whole ladder while the book states no reach', () => {
    const steps = futuresBookGroupSteps({ tickSize: '0.0000001', reach: null, rows: 14 })
    expect(steps.map(entry => entry.multiplier)).toEqual([...GROUPING_MULTIPLIERS])
  })

  // A reach that cannot fit even one tick of grouping is a reading with nothing
  // left to cut. The finest step is the book as the exchange sent it, and the
  // panel is never left without one.
  it('always offers the finest step', () => {
    const steps = futuresBookGroupSteps({
      tickSize: '0.1',
      reach: { below: '0.0001', above: '0.0001' },
      rows: 14,
    })
    expect(steps).toEqual([{ multiplier: 1, step: '0.1' }])
  })

  // The book the desk holds is no longer one snapshot page, so the reading that
  // used to run past the end of the ladder now runs off it. This is the
  // operator's own contract on 2026-08-14: AKEUSDT at 0.0074561 with the book
  // reaching 54.96% of price, read over fourteen rows. A fourteenth of that
  // reach is 2 900 ticks, so the cut belongs between 2 000 and 5 000 — where the
  // ladder used to stop at 1 000 and leave the panel drawing 19% of a book more
  // than twice that deep.
  it('offers a step past a thousand ticks when the book reaches that far', () => {
    const reach = { below: '0.0040978', above: '0.0040978' }
    const steps = futuresBookGroupSteps({ tickSize: '0.0000001', reach, rows: 14 })
    expect(steps.at(-1)).toEqual({ multiplier: 2_000, step: '0.0002' })
    // Fourteen rows of it fit inside the reach, and the rung above would not.
    expect(Number(steps.at(-1).step) * 14).toBeLessThanOrEqual(Number(reach.below))
    expect(0.0005 * 14).toBeGreaterThan(Number(reach.below))
  })

  // The ladder is still cut by the book rather than by its own length: a
  // contract quoted coarsely against its price runs out of reach long before it
  // runs out of rungs, and adding rungs at the top must not offer it any.
  //
  // A guard, not a finding: it passes against the tree before this change, where
  // the rungs it must not be offered did not exist. It holds the cut in place
  // while the ladder above it grows — 522 of the 570 perpetuals trading on
  // 2026-08-14 are this contract rather than the one above.
  it('leaves a coarsely quoted contract where its own reach ends', () => {
    const steps = futuresBookGroupSteps({
      tickSize: '0.001',
      reach: { below: '0.35', above: '0.35' },
      rows: 14,
    })
    expect(steps.at(-1)).toEqual({ multiplier: 25, step: '0.025' })
  })

  it('offers the whole ladder when the rows are not a count', () => {
    expect(futuresBookGroupSteps({
      tickSize: '0.1',
      reach: { below: '1', above: '1' },
      rows: 0,
    })).toHaveLength(GROUPING_MULTIPLIERS.length)
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
        value: '20',
        notionalUsdt: 20,
        cumulativeUsdt: 20,
      },
      {
        price: '0.019',
        groupKey: futuresBookGroupKey({ price: '0.019', side: 'bid' }),
        quantity: '2000',
        value: '38',
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
      value: '2',
      notionalUsdt: 2,
      cumulativeUsdt: 2,
    }])
  })
})

describe('futuresBookWallKeys', () => {
  const rows = sizes => sizes.map((notionalUsdt, index) => ({
    groupKey: `k${index}`,
    notionalUsdt,
  }))

  it('marks the five heaviest levels and nothing else', () => {
    const walls = futuresBookWallKeys(rows([10, 900, 20, 800, 30, 700, 40, 600, 50, 500]))
    expect([...walls].sort()).toEqual(['k1', 'k3', 'k5', 'k7', 'k9'])
  })

  it('keeps a tie whole rather than marking one twin and not the other', () => {
    // Sixth place ties with fifth: both rest the same size, so both are walls.
    const walls = futuresBookWallKeys(rows([100, 90, 80, 70, 60, 60, 10]))
    expect(walls.size).toBe(6)
    expect(walls.has('k5')).toBe(true)
  })

  it('marks nothing when there are no more levels than walls', () => {
    expect(futuresBookWallKeys(rows([5, 4, 3, 2, 1])).size).toBe(0)
    expect(futuresBookWallKeys(null).size).toBe(0)
  })

  it('ignores levels it cannot size instead of ranking them as empty walls', () => {
    const walls = futuresBookWallKeys(rows([0, Number.NaN, 12, 8, 4, 2]), 3)
    expect([...walls].sort()).toEqual(['k2', 'k3', 'k4'])
  })
})

// The cache under the grouping pass exists because a book restates the same
// prices frame after frame. What a frame *computes* has the opposite shape: a
// row's value is a sum that moves the moment any level in its bucket moves, so
// every one of them is a string that will never be asked for twice.
//
// Left going through the cache they fill it, evict the prices that do repeat,
// and empty it on a timer nobody chose — measured on the operator's own panel,
// twenty-eight rows a frame at ten frames a second put 9.2 MiB of dead entries
// through it and cleared the whole thing every 234 seconds.
describe('what the grouping pass remembers', () => {
  it('remembers a price the book restates', () => {
    const before = futuresBookParsedDecimalCount()
    groupFuturesBookLevels({
      levels: [{ price: '11111.0001', quantity: '2.5' }],
      side: 'bid',
      step: null,
      limit: 1,
    })
    expect(futuresBookParsedDecimalCount()).toBeGreaterThan(before)
  })

  it('does not remember the sums a frame computed', () => {
    // Unique to this run, so a hit could only come from this call.
    const rows = Array.from({ length: 40 }, (_, index) => ({
      price: '1',
      quantity: '1',
      groupKey: '1',
      value: `987654321${String(index).padStart(3, '0')}.7654321`,
    }))
    const before = futuresBookParsedDecimalCount()
    const read = readFuturesBookRows(rows)
    expect(read).toHaveLength(40)
    // Compared against the string's own value rather than a literal: the sum is
    // exact through atoms and only becomes a double on the way to a bar width.
    expect(read[0].notionalUsdt).toBe(Number(rows[0].value))
    expect(futuresBookParsedDecimalCount()).toBe(before)
  })
})
