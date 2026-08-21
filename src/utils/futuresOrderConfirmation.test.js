import { describe, expect, it } from 'vitest'
import {
  describeFuturesOrderConfirmation,
  netFuturesPositionQuantity,
} from './futuresOrderConfirmation.js'

const LONG_EXIT = Object.freeze({
  key: 'LONG_EXIT', side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT', label: 'LONG exit',
})
const SHORT_ENTRY = Object.freeze({
  key: 'SHORT_ENTRY', side: 'SELL', positionSide: 'SHORT', positionEffect: 'ENTRY', label: 'SHORT entry',
})
const LONG_ENTRY = Object.freeze({
  key: 'LONG_ENTRY', side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', label: 'LONG entry',
})
const SHORT_EXIT = Object.freeze({
  key: 'SHORT_EXIT', side: 'BUY', positionSide: 'SHORT', positionEffect: 'EXIT', label: 'SHORT exit',
})

const longPosition = Object.freeze([
  Object.freeze({ symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.5' }),
])

describe('futures order confirmation', () => {
  // The whole point of the panel: these two gestures produce the same SELL, so
  // the confirmation has to separate them by what they do, not by the order.
  it('names the effect on the position, not the side of the order', () => {
    const shared = { symbol: 'BTCUSDT', price: '58445', quantity: '0.1', positions: longPosition }
    const exit = describeFuturesOrderConfirmation({ action: LONG_EXIT, ...shared })
    const entry = describeFuturesOrderConfirmation({ action: SHORT_ENTRY, ...shared })

    expect(exit.side).toBe(entry.side)
    expect(exit.headline).toBe('CLOSE LONG')
    expect(entry.headline).toBe('OPEN SHORT')
    expect(exit.warning).toBeNull()
    expect(entry.warning.code).toBe('OPPOSITE_ENTRY')
  })

  // The terms the position is carried at belong on the panel that sends it, and
  // a multiple the exchange never stated is absent rather than invented — "1×"
  // beside a contract the account holds at 20× is worse than nothing.
  it('carries the multiple the entry will be taken at, and never invents one', () => {
    const shared = { action: LONG_ENTRY, symbol: 'BTCUSDT', price: '58445', quantity: '0.1' }
    expect(describeFuturesOrderConfirmation({ ...shared, leverage: 20 }).leverage).toBe(20)
    expect(describeFuturesOrderConfirmation(shared).leverage).toBeNull()
    for (const leverage of [0, -2, 2.5, '20', null]) {
      expect(describeFuturesOrderConfirmation({ ...shared, leverage }).leverage).toBeNull()
    }
  })

  it('warns that an oversized opposite entry reverses the position', () => {
    const confirmation = describeFuturesOrderConfirmation({
      action: SHORT_ENTRY,
      symbol: 'BTCUSDT',
      price: '58445',
      quantity: '0.8',
      positions: longPosition,
    })
    expect(confirmation.warning.code).toBe('FLIPS_POSITION')
    expect(confirmation.warning.message).toContain('flips you SHORT')
    expect(confirmation.positionAfter).toBeCloseTo(-0.3, 10)
  })

  // Reduce-only orders are trimmed by the exchange, so the projection may not
  // promise a flip the order can never perform.
  it('clamps a reduce-only projection at flat instead of crossing zero', () => {
    const confirmation = describeFuturesOrderConfirmation({
      action: LONG_EXIT,
      symbol: 'BTCUSDT',
      price: '58445',
      quantity: '9',
      positions: longPosition,
    })
    expect(confirmation.positionAfter).toBe(0)
    expect(confirmation.warning.code).toBe('LARGER_THAN_POSITION')
  })

  it.each([
    { action: LONG_EXIT, expectedAfter: -0.5 },
    { action: SHORT_EXIT, expectedAfter: 0.5 },
  ])('projects a $action.positionSide exit from its named hedge leg, not net flat', ({
    action,
    expectedAfter,
  }) => {
    const confirmation = describeFuturesOrderConfirmation({
      action,
      symbol: 'BTCUSDT',
      price: '100',
      quantity: '0.5',
      positions: [
        { symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '1' },
        { symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '1' },
      ],
    })

    expect(confirmation.positionBefore).toBe(0)
    expect(confirmation.positionAfter).toBe(expectedAfter)
    expect(confirmation.warning).toBeNull()
  })

  it('bounds an oversized hedge exit by the named leg while leaving the opposite leg open', () => {
    const confirmation = describeFuturesOrderConfirmation({
      action: LONG_EXIT,
      symbol: 'BTCUSDT',
      price: '100',
      quantity: '2',
      positions: [
        { symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '1' },
        { symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '1' },
      ],
    })

    expect(confirmation.positionBefore).toBe(0)
    expect(confirmation.positionAfter).toBe(-1)
    expect(confirmation.warning.code).toBe('LARGER_THAN_POSITION')
  })

  it('reports no matching leg even when the opposite hedge leg makes net exposure nonzero', () => {
    const confirmation = describeFuturesOrderConfirmation({
      action: LONG_EXIT,
      symbol: 'BTCUSDT',
      price: '100',
      quantity: '0.5',
      positions: [{ symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '1' }],
    })

    expect(confirmation.positionBefore).toBe(-1)
    expect(confirmation.positionAfter).toBe(-1)
    expect(confirmation.warning.code).toBe('NOTHING_TO_CLOSE')
  })

  it.each([
    { action: LONG_EXIT, held: '0.5', expectedAfter: 0.3 },
    { action: SHORT_EXIT, held: '-0.5', expectedAfter: -0.3 },
  ])('projects a signed one-way $action.positionSide exit from its BOTH row', ({
    action,
    held,
    expectedAfter,
  }) => {
    const confirmation = describeFuturesOrderConfirmation({
      action,
      symbol: 'BTCUSDT',
      price: '100',
      quantity: '0.2',
      positions: [{ symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: held }],
    })

    expect(confirmation.positionAfter).toBeCloseTo(expectedAfter, 10)
    expect(confirmation.warning).toBeNull()
  })

  it('warns when there is nothing to close', () => {
    const confirmation = describeFuturesOrderConfirmation({
      action: SHORT_EXIT,
      symbol: 'BTCUSDT',
      price: '58445',
      quantity: '0.1',
      positions: [],
    })
    expect(confirmation.headline).toBe('CLOSE SHORT')
    expect(confirmation.warning.code).toBe('NOTHING_TO_CLOSE')
  })

  it('leaves an entry into a flat book unremarked', () => {
    const confirmation = describeFuturesOrderConfirmation({
      action: LONG_ENTRY,
      symbol: 'BTCUSDT',
      price: '58445',
      quantity: '0.1',
      positions: [],
    })
    expect(confirmation.headline).toBe('OPEN LONG')
    expect(confirmation.warning).toBeNull()
    expect(confirmation.positionAfter).toBeCloseTo(0.1, 10)
    expect(confirmation.positionAfterUsdt).toBeCloseTo(5844.5, 6)
  })

  it('leaves the projection unknown when an invalid resized draft has no quantity', () => {
    const confirmation = describeFuturesOrderConfirmation({
      action: LONG_ENTRY,
      symbol: 'BTCUSDT',
      price: '58445',
      quantity: null,
      notionalUsdt: '5',
      positions: longPosition,
    })
    expect(confirmation.positionBefore).toBe(0.5)
    expect(confirmation.positionAfter).toBeNull()
    expect(confirmation.positionAfterUsdt).toBeNull()
    expect(confirmation.warning).toBeNull()
  })

  // One-way accounts sign the quantity; hedge accounts report both legs
  // positive and name the side. Net exposure has to read the same either way.
  it('nets hedge legs and signed one-way quantities alike', () => {
    expect(netFuturesPositionQuantity([
      { symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '0.5' },
      { symbol: 'BTCUSDT', positionSide: 'SHORT', quantity: '0.2' },
      { symbol: 'ETHUSDT', positionSide: 'LONG', quantity: '4' },
    ], 'BTCUSDT')).toBeCloseTo(0.3, 10)

    expect(netFuturesPositionQuantity([
      { symbol: 'BTCUSDT', quantity: '-0.4' },
    ], 'BTCUSDT')).toBeCloseTo(-0.4, 10)

    expect(netFuturesPositionQuantity([], 'BTCUSDT')).toBe(0)
    expect(netFuturesPositionQuantity(null, 'BTCUSDT')).toBeNull()
    expect(netFuturesPositionQuantity([
      { symbol: 'BTCUSDT', positionSide: 'LONG', quantity: null },
    ], 'BTCUSDT')).toBeNull()
  })

  it('reports an unknown position rather than guessing at flat', () => {
    const confirmation = describeFuturesOrderConfirmation({
      action: LONG_ENTRY,
      symbol: 'BTCUSDT',
      price: '58445',
      quantity: '0.1',
      positions: [{ symbol: 'BTCUSDT', positionSide: 'LONG', quantity: 'n/a' }],
    })
    expect(confirmation.positionBefore).toBeNull()
    expect(confirmation.positionAfter).toBeNull()
    expect(confirmation.warning).toBeNull()
  })
})
