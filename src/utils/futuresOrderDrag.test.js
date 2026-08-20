// The move a grip promises is a cancellation followed by a plain LIMIT
// placement. These pin the one predicate that decides where that promise can
// be made — and that the replacement refuses every order it cannot keep it
// for, before anything is cancelled.

import { describe, expect, it } from 'vitest'
import {
  FUTURES_DRAG_REASONS,
  describeFuturesDragRefusal,
  describeFuturesDragReplacement,
  futuresOrderPriceIsMovable,
} from './futuresOrderDrag.js'

const order = (overrides = {}) => ({
  orderKind: 'REGULAR',
  symbol: 'BTCUSDT',
  side: 'SELL',
  orderId: '41',
  price: '59900',
  origQty: '0.5',
  reduceOnly: false,
  positionSide: 'BOTH',
  ...overrides,
})

describe('futuresOrderPriceIsMovable', () => {
  it('keeps the move promise only for a plain limit order', () => {
    expect(futuresOrderPriceIsMovable(order())).toBe(true)
    // A stop-market rests at no price: nothing to put back.
    expect(futuresOrderPriceIsMovable(order({ price: '0', triggerPrice: '57000' }))).toBe(false)
    // A stop-limit rests at its own price, but moving it would discard the
    // trigger it guards.
    expect(futuresOrderPriceIsMovable(order({ triggerPrice: '59800' }))).toBe(false)
    // An exchange-managed order is not the desk's to move.
    expect(futuresOrderPriceIsMovable(order({ orderKind: 'ALGO' }))).toBe(false)
    expect(futuresOrderPriceIsMovable(null)).toBe(false)
  })
})

describe('describeFuturesDragReplacement', () => {
  it('refuses to replace an order that guards a trigger', () => {
    const replacement = describeFuturesDragReplacement({
      order: order({ type: 'STOP', triggerPrice: '58000', price: '57900' }),
      price: '57910',
    })
    expect(replacement).toMatchObject({
      ok: false,
      reason: FUTURES_DRAG_REASONS.NOT_DRAGGABLE,
    })
    expect(describeFuturesDragRefusal(replacement))
      .toBe('Only a regular order resting at its own price, with no trigger, can be moved by dragging.')
  })

  it('refuses an order resting at no price before anything is cancelled', () => {
    expect(describeFuturesDragReplacement({
      order: order({ type: 'STOP_MARKET', price: '0', triggerPrice: '57000' }),
      price: '0',
    })).toMatchObject({
      ok: false,
      reason: FUTURES_DRAG_REASONS.NOT_DRAGGABLE,
    })
  })

  it('still replaces a plain limit order as itself', () => {
    expect(describeFuturesDragReplacement({
      order: order(),
      price: '59850',
    })).toMatchObject({
      ok: true,
      symbol: 'BTCUSDT',
      side: 'SELL',
      orderType: 'LIMIT',
      price: '59850',
      quantity: '0.5',
    })
  })
})
