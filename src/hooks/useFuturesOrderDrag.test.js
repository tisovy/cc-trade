import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useFuturesOrderDrag from './useFuturesOrderDrag.js'
import { FUTURES_COMMAND_OUTCOME } from '../utils/futuresCommandOutcome.js'

const CONFIRMED = { outcome: FUTURES_COMMAND_OUTCOME.CONFIRMED }
const REFUSED = {
  outcome: FUTURES_COMMAND_OUTCOME.REFUSED,
  code: 'FUTURES_API_ERROR',
  message: 'Margin is insufficient.',
}
const UNKNOWN = {
  outcome: FUTURES_COMMAND_OUTCOME.UNKNOWN,
  code: 'FUTURES_OUTCOME_PENDING',
  message: 'Binance did not confirm this order either way.',
}

const order = (overrides = {}) => ({
  symbol: 'BTCUSDT',
  orderKind: 'REGULAR',
  orderId: 11,
  clientOrderId: 'abc',
  side: 'BUY',
  price: '58445.00',
  origQty: '0.004',
  z: '0',
  ...overrides,
})

const setup = ({
  cancelAnswer = CONFIRMED,
  placeAnswer = CONFIRMED,
  ...options
} = {}) => {
  const cancelOrder = vi.fn(async () => cancelAnswer)
  const placeOrder = vi.fn(async () => placeAnswer)
  const rendered = renderHook(() => useFuturesOrderDrag({
    tickSize: '0.10',
    cancelOrder,
    placeOrder,
    ...options,
  }))
  return { ...rendered, cancelOrder, placeOrder }
}

describe('useFuturesOrderDrag', () => {
  it('cancels the order the drag lifts and places the remainder where it is dropped', async () => {
    const { result, cancelOrder, placeOrder } = setup()

    const lifted = order({ z: '0.001' })
    let lift
    await act(async () => { lift = await result.current.lift(lifted) })
    expect(lift).toEqual({ ok: true })
    expect(cancelOrder).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      orderId: 11,
      origClientOrderId: undefined,
    })

    await act(async () => { await result.current.drop({ order: lifted, price: '58500.04' }) })
    // The price is the contract's tick, and the size is what was still working:
    // the filled 0.001 is already a position and is not placed again.
    expect(placeOrder).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      side: 'BUY',
      orderType: 'LIMIT',
      price: '58500',
      quantity: '0.003',
      positionSide: undefined,
      reduceOnly: false,
    })
    expect(result.current.alerts).toEqual([])
  })

  it('places the order again where it was lifted from when the drag is abandoned', async () => {
    const { result, placeOrder } = setup()

    const lifted = order()
    await act(async () => { await result.current.lift(lifted) })
    await act(async () => {
      await result.current.drop({ order: lifted, price: '59000', restored: true })
    })

    expect(placeOrder).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ price: '58445', quantity: '0.004' }),
    )
  })

  // Cancelling is what makes the window; a paused desk may not open one.
  it('lifts nothing while trading is paused', async () => {
    const { result, cancelOrder } = setup({ tradingPaused: true })

    let lift
    await act(async () => { lift = await result.current.lift(order()) })

    expect(lift).toEqual({ ok: false })
    expect(cancelOrder).not.toHaveBeenCalled()
    expect(result.current.alerts[0]).toMatchObject({
      tone: 'refused',
      detail: 'Trading is paused — resume to move orders.',
    })
  })

  // An order that could not be put back where it came from is one the drag must
  // not take off the book in the first place.
  it('refuses to lift an order the local ceiling would not let it replace', async () => {
    const { result, cancelOrder } = setup({
      maxOrderNotionalUsdt: '200',
      tickSize: '0.10',
    })

    let lift
    await act(async () => { lift = await result.current.lift(order()) })

    expect(lift).toEqual({ ok: false })
    expect(cancelOrder).not.toHaveBeenCalled()
    expect(result.current.alerts[0].detail).toContain('above the local 200 USDT limit')
  })

  it('lifts a reduce-only order whatever the ceiling says', async () => {
    const { result, cancelOrder } = setup({ maxOrderNotionalUsdt: '200' })

    await act(async () => { await result.current.lift(order({ reduceOnly: true })) })

    expect(cancelOrder).toHaveBeenCalledOnce()
  })

  it('starts no drag on a refused cancellation and leaves the order alone', async () => {
    const { result, placeOrder } = setup({ cancelAnswer: REFUSED })

    const lifted = order()
    let lift
    await act(async () => { lift = await result.current.lift(lifted) })
    await act(async () => { await result.current.drop({ order: lifted, price: '58500' }) })

    expect(lift).toEqual({ ok: false })
    expect(placeOrder).not.toHaveBeenCalled()
    expect(result.current.alerts[0]).toMatchObject({ tone: 'refused' })
    expect(result.current.alerts[0].detail).toContain('still working where it was')
  })

  it('presents an unconfirmed cancellation as unknown rather than as a loss', async () => {
    const { result } = setup({ cancelAnswer: UNKNOWN })

    await act(async () => { await result.current.lift(order()) })

    expect(result.current.alerts[0]).toMatchObject({ tone: 'unresolved', retryPrice: null })
    expect(result.current.alerts[0].title).toBe('Cancellation NOT confirmed')
  })

  // The order is gone and nothing replaced it. That is the one thing the desk
  // must say out loud, with the control that puts it back.
  it('states the obligation when the replacement is refused, and can place it again', async () => {
    const { result, placeOrder } = setup({ placeAnswer: REFUSED })

    const lifted = order()
    await act(async () => { await result.current.lift(lifted) })
    await act(async () => { await result.current.drop({ order: lifted, price: '58500.04' }) })

    expect(result.current.alerts[0]).toMatchObject({
      tone: 'lost',
      title: 'Order cancelled and NOT replaced',
      retryPrice: '58445.00',
    })
    expect(result.current.alerts[0].detail).toContain('Margin is insufficient.')

    placeOrder.mockResolvedValueOnce(CONFIRMED)
    await act(async () => { await result.current.retry() })

    expect(placeOrder).toHaveBeenCalledTimes(2)
    expect(placeOrder).toHaveBeenLastCalledWith(expect.objectContaining({ price: '58445' }))
    expect(result.current.alerts).toEqual([])
  })

  // A bound the desk holds refuses the move, not the order. The order was
  // taken off the book by the lift, so refusing the move means putting it back
  // where it was resting — the operator keeps the order and learns the bound.
  it('refuses an over-cap drop and puts the order back where it was', async () => {
    const { result, placeOrder } = setup({ maxOrderNotionalUsdt: '250' })

    const lifted = order()
    await act(async () => { await result.current.lift(lifted) })
    // 0.004 at 58445 is 233 USDT and fits; at 65000 it does not.
    await act(async () => { await result.current.drop({ order: lifted, price: '65000' }) })

    expect(placeOrder).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ price: '58445', quantity: '0.004' }),
    )
    expect(result.current.alerts[0]).toMatchObject({
      tone: 'refused',
      title: 'Order NOT moved',
      retryPrice: null,
    })
    expect(result.current.alerts[0].detail).toContain('above the local 250 USDT limit')
  })

  // A second attempt on an unknown outcome is how two orders end up on the book.
  it('offers no retry when the replacement is unresolved', async () => {
    const { result, placeOrder } = setup({ placeAnswer: UNKNOWN })

    const lifted = order()
    await act(async () => { await result.current.lift(lifted) })
    await act(async () => { await result.current.drop({ order: lifted, price: '58500' }) })

    expect(result.current.alerts[0]).toMatchObject({
      tone: 'unresolved',
      title: 'Replacement NOT confirmed',
      retryPrice: null,
    })

    await act(async () => { await result.current.retry() })
    expect(placeOrder).toHaveBeenCalledTimes(1)
  })

  // The same order is not on the book to be lifted again — and saying nothing
  // about it was indistinguishable from a drag the desk never registered.
  it('refuses a second lift of the same order, in words', async () => {
    const { result, cancelOrder } = setup({ placeAnswer: REFUSED })

    await act(async () => { await result.current.lift(order()) })
    let again
    await act(async () => { again = await result.current.lift(order()) })

    expect(again).toEqual({ ok: false })
    expect(cancelOrder).toHaveBeenCalledOnce()
    expect(result.current.alerts.at(-1)).toMatchObject({ tone: 'refused' })
    expect(result.current.alerts.at(-1).detail).toContain('already lifted')
  })

  // The operator reached for a second order before the first had landed and
  // nothing happened. The wait was one round trip through their proxy, and for
  // its whole length no order on any contract could be moved.
  it('lifts another order while the last replacement is still in flight', async () => {
    let settlePlacement
    const cancelOrder = vi.fn(async () => CONFIRMED)
    const placeOrder = vi.fn(() => new Promise((resolve) => { settlePlacement = resolve }))
    const { result } = renderHook(() => useFuturesOrderDrag({
      tickSize: '0.10',
      cancelOrder,
      placeOrder,
    }))

    const lifted = order()
    await act(async () => { await result.current.lift(lifted) })
    act(() => { result.current.drop({ order: lifted, price: '58500' }) })
    expect(result.current.replacementInFlight).toBe(true)

    let second
    await act(async () => { second = await result.current.lift(order({ orderId: 12 })) })
    expect(second).toEqual({ ok: true })
    expect(cancelOrder).toHaveBeenCalledTimes(2)
    expect(result.current.alerts).toEqual([])

    await act(async () => {
      settlePlacement(CONFIRMED)
      await Promise.resolve()
    })
  })

  // The gesture ends when the operator lets go, which is well inside the
  // cancellation round trip — so the second order is lifted before the first is
  // dropped. Both obligations are outstanding at once and neither has been
  // discharged yet, which is the case a single slot cannot hold: the second
  // lift overwrote the first, the first drop placed the second order's size at
  // the first order's price, and the second drop found nothing left to place.
  it('discharges each obligation against the order it was made for', async () => {
    const { result, placeOrder } = setup()

    const first = order({ orderId: 11, clientOrderId: 'first', price: '58445.00' })
    const second = order({
      orderId: 12,
      clientOrderId: 'second',
      price: '58200.00',
      origQty: '0.007',
    })

    await act(async () => { await result.current.lift(first) })
    await act(async () => { await result.current.lift(second) })

    await act(async () => { await result.current.drop({ order: first, price: '58500' }) })
    await act(async () => { await result.current.drop({ order: second, price: '58300' }) })

    // Two orders were taken off the book, so two must go back on it.
    expect(placeOrder).toHaveBeenCalledTimes(2)
    expect(placeOrder).toHaveBeenNthCalledWith(1, expect.objectContaining({
      price: '58500',
      quantity: '0.004',
    }))
    expect(placeOrder).toHaveBeenNthCalledWith(2, expect.objectContaining({
      price: '58300',
      quantity: '0.007',
    }))
    expect(result.current.alerts).toEqual([])
  })

  // The other way to lose count: one obligation discharged twice leaves two
  // real orders resting where the operator asked for one.
  it('places one replacement however many times the same drag ends', async () => {
    const { result, placeOrder } = setup()
    const lifted = order()

    await act(async () => { await result.current.lift(lifted) })
    await act(async () => { await result.current.drop({ order: lifted, price: '58500' }) })
    await act(async () => { await result.current.drop({ order: lifted, price: '58600' }) })

    expect(placeOrder).toHaveBeenCalledOnce()
  })

  // Nothing was lifted, so nothing may be placed. A drop that names an order
  // the desk owes nothing for is not a replacement, it is a new order.
  it('places nothing for a drop that names an order the desk never lifted', async () => {
    const { result, placeOrder } = setup()

    await act(async () => { await result.current.lift(order()) })
    await act(async () => {
      await result.current.drop({ order: order({ orderId: 99 }), price: '58500' })
    })

    expect(placeOrder).not.toHaveBeenCalled()
  })

  // Two obligations outstanding was the case the single alert could not report,
  // and refusing the second drag was how that was avoided. The alert is a list
  // now, so each one is named on its own.
  it('states two failed replacements apart, and answers them apart', async () => {
    const { result, placeOrder } = setup({ placeAnswer: REFUSED })

    const bitcoin = order()
    const ether = order({ orderId: 12, symbol: 'ETHUSDT' })
    await act(async () => { await result.current.lift(bitcoin) })
    await act(async () => { await result.current.drop({ order: bitcoin, price: '58500' }) })
    await act(async () => { await result.current.lift(ether) })
    await act(async () => { await result.current.drop({ order: ether, price: '3000' }) })

    expect(result.current.alerts).toHaveLength(2)
    expect(result.current.alerts.map(entry => entry.order.symbol)).toEqual(['BTCUSDT', 'ETHUSDT'])

    // Placing one again leaves the other's statement standing.
    placeOrder.mockResolvedValue(CONFIRMED)
    const [first] = result.current.alerts
    await act(async () => { await result.current.retry(first.id) })

    expect(result.current.alerts).toHaveLength(1)
    expect(result.current.alerts[0].order.symbol).toBe('ETHUSDT')
  })

  // A drag that ends because the operator changed contract must not price the
  // old order at the new contract's tick: 0.0308370 against a 0.01 tick is an
  // order at 0.03.
  it('replaces at the tick of the order\'s own contract, not the one on screen', async () => {
    const cancelOrder = vi.fn(async () => CONFIRMED)
    const placeOrder = vi.fn(async () => CONFIRMED)
    const { result, rerender } = renderHook(
      ({ tickSize }) => useFuturesOrderDrag({ tickSize, cancelOrder, placeOrder }),
      { initialProps: { tickSize: '0.0000010' } },
    )

    const lifted = order({ price: '0.0308370', origQty: '3000' })
    await act(async () => { await result.current.lift(lifted) })
    // The operator moves to a contract that trades in whole cents.
    rerender({ tickSize: '0.01' })
    await act(async () => { await result.current.drop({ order: lifted, restored: true }) })

    expect(placeOrder).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ price: '0.030837' }),
    )
  })

  // Dragging an order destroyed it. The operator moved a 5 USDT limit order
  // down; the cancellation was confirmed at 18:12:27 and the placement refused
  // at 18:12:29 with -4164, the exchange's minimum notional. A drag lowers the
  // price and leaves the quantity where it was, so it lowers the notional — and
  // the desk held that floor all along, on the path that places an order and
  // not on the path that moves one.
  describe('a move under a bound the desk already holds', () => {
    const smallOrder = (overrides = {}) => order({
      symbol: 'BTWUSDT',
      price: '0.2174',
      origQty: '23',
      ...overrides,
    })
    const smallSetup = (options = {}) => setup({
      tickSize: '0.0001',
      minNotionalUsdt: '5',
      ...options,
    })

    it('leaves the order live at the price it was resting at', async () => {
      const { result, cancelOrder, placeOrder } = smallSetup()

      const lifted = smallOrder()
      await act(async () => { await result.current.lift(lifted) })
      // 23 × 0.2029 is 4.6667 USDT, under the contract's 5 USDT floor.
      await act(async () => { await result.current.drop({ order: lifted, price: '0.2029' }) })

      expect(cancelOrder).toHaveBeenCalledOnce()
      // One placement, at the price the order was resting at: the move is
      // refused, the order is not.
      expect(placeOrder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        symbol: 'BTWUSDT',
        price: '0.2174',
        quantity: '23',
      }))
      expect(result.current.alerts).toHaveLength(1)
      expect(result.current.alerts[0]).toMatchObject({
        tone: 'refused',
        title: 'Order NOT moved',
        retryPrice: null,
      })
      expect(result.current.alerts[0].detail)
        .toContain('below the Binance minimum notional of 5 USDT')
    })

    // The literal reading of the rule: an order the desk could not place at its
    // own resting price is one the drag must not take off the book at all.
    it('cancels nothing it could not place back at the price it holds', async () => {
      const { result, cancelOrder, placeOrder } = smallSetup()

      let lift
      await act(async () => {
        lift = await result.current.lift(smallOrder({ price: '0.2029' }))
      })

      expect(lift).toEqual({ ok: false })
      expect(cancelOrder).not.toHaveBeenCalled()
      expect(placeOrder).not.toHaveBeenCalled()
      expect(result.current.alerts[0]).toMatchObject({
        tone: 'refused',
        title: 'Order NOT lifted',
      })
      expect(result.current.alerts[0].detail).toContain('The order was left where it is.')
    })

    // Only bounds the desk actually holds are consulted. A contract whose
    // catalogue has not loaded has no floor here, and inventing one would
    // refuse a move the exchange would have taken.
    it('refuses nothing on a floor the desk does not hold', async () => {
      const { result, placeOrder } = smallSetup({ minNotionalUsdt: null })

      const lifted = smallOrder()
      await act(async () => { await result.current.lift(lifted) })
      await act(async () => { await result.current.drop({ order: lifted, price: '0.2029' }) })

      expect(placeOrder).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ price: '0.2029' }),
      )
      expect(result.current.alerts).toEqual([])
    })

    // What this change must not silence: a refusal the desk had no bound for
    // still reaches the exchange, and still reads as an order that is gone.
    it('still states an order the exchange refused for a reason of its own', async () => {
      const { result, placeOrder } = smallSetup({ placeAnswer: REFUSED })

      const lifted = smallOrder()
      await act(async () => { await result.current.lift(lifted) })
      await act(async () => { await result.current.drop({ order: lifted, price: '0.2200' }) })

      expect(placeOrder).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ price: '0.22' }),
      )
      expect(result.current.alerts[0]).toMatchObject({
        tone: 'lost',
        title: 'Order cancelled and NOT replaced',
        retryPrice: '0.2174',
      })
    })

    // The order goes back on the book, and if that placement is the one the
    // exchange refuses, the desk says the order is gone rather than saying it
    // was merely not moved.
    it('says the order is gone when the price it rested at is refused too', async () => {
      const { result, placeOrder } = smallSetup({ placeAnswer: REFUSED })

      const lifted = smallOrder()
      await act(async () => { await result.current.lift(lifted) })
      await act(async () => { await result.current.drop({ order: lifted, price: '0.2029' }) })

      expect(placeOrder).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ price: '0.2174' }),
      )
      expect(result.current.alerts.map(entry => entry.title)).toEqual([
        'Order NOT moved',
        'Order cancelled and NOT replaced',
      ])
      expect(result.current.alerts.at(-1)).toMatchObject({ retryPrice: '0.2174' })
    })
  })

  it('carries the exchange leg of a hedged order onto its replacement', async () => {
    const { result, placeOrder } = setup()

    const lifted = order({ exchangePositionSide: 'LONG', positionSide: 'SHORT' })
    await act(async () => { await result.current.lift(lifted) })
    await act(async () => { await result.current.drop({ order: lifted, price: '58500' }) })

    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ positionSide: 'LONG' }))
  })
})
