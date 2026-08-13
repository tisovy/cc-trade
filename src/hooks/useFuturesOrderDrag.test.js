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

    let lift
    await act(async () => { lift = await result.current.lift(order({ z: '0.001' })) })
    expect(lift).toEqual({ ok: true })
    expect(cancelOrder).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      orderId: 11,
      origClientOrderId: undefined,
    })

    await act(async () => { await result.current.drop({ price: '58500.04' }) })
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

    await act(async () => { await result.current.lift(order()) })
    await act(async () => { await result.current.drop({ price: '59000', restored: true }) })

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

    let lift
    await act(async () => { lift = await result.current.lift(order()) })
    await act(async () => { await result.current.drop({ price: '58500' }) })

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

    await act(async () => { await result.current.lift(order()) })
    await act(async () => { await result.current.drop({ price: '58500.04' }) })

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

  it('refuses an over-cap drop and never places a second order for it', async () => {
    const { result, placeOrder } = setup({ maxOrderNotionalUsdt: '250' })

    await act(async () => { await result.current.lift(order()) })
    // 0.004 at 58445 is 233 USDT and fits; at 65000 it does not.
    await act(async () => { await result.current.drop({ price: '65000' }) })

    expect(placeOrder).not.toHaveBeenCalled()
    expect(result.current.alerts[0]).toMatchObject({ tone: 'lost', retryPrice: '58445.00' })
    expect(result.current.alerts[0].detail).toContain('above the local 250 USDT limit')
  })

  // A second attempt on an unknown outcome is how two orders end up on the book.
  it('offers no retry when the replacement is unresolved', async () => {
    const { result, placeOrder } = setup({ placeAnswer: UNKNOWN })

    await act(async () => { await result.current.lift(order()) })
    await act(async () => { await result.current.drop({ price: '58500' }) })

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

    await act(async () => { await result.current.lift(order()) })
    act(() => { result.current.drop({ price: '58500' }) })
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

  // Two obligations outstanding was the case the single alert could not report,
  // and refusing the second drag was how that was avoided. The alert is a list
  // now, so each one is named on its own.
  it('states two failed replacements apart, and answers them apart', async () => {
    const { result, placeOrder } = setup({ placeAnswer: REFUSED })

    await act(async () => { await result.current.lift(order()) })
    await act(async () => { await result.current.drop({ price: '58500' }) })
    await act(async () => { await result.current.lift(order({ orderId: 12, symbol: 'ETHUSDT' })) })
    await act(async () => { await result.current.drop({ price: '3000' }) })

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

    await act(async () => {
      await result.current.lift(order({ price: '0.0308370', origQty: '3000' }))
    })
    // The operator moves to a contract that trades in whole cents.
    rerender({ tickSize: '0.01' })
    await act(async () => { await result.current.drop({ restored: true }) })

    expect(placeOrder).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ price: '0.030837' }),
    )
  })

  it('carries the exchange leg of a hedged order onto its replacement', async () => {
    const { result, placeOrder } = setup()

    await act(async () => {
      await result.current.lift(order({ exchangePositionSide: 'LONG', positionSide: 'SHORT' }))
    })
    await act(async () => { await result.current.drop({ price: '58500' }) })

    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ positionSide: 'LONG' }))
  })
})
