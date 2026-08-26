import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  useFuturesPositionValuation,
  useFuturesPositionValuationAggregate,
} from './useFuturesPositionValuation.js'
import {
  FUTURES_LAST_PRICE_GRACE_MS,
  createFuturesPositionMarkStore,
} from '../utils/futuresPositionMarks.js'

describe('useFuturesPositionValuation subscription lanes', () => {
  it('routes value-only and presentation-only consumers to their numeric channels', () => {
    const store = createFuturesPositionMarkStore()
    const position = {
      symbol: 'BEATUSDT',
      positionSide: 'SHORT',
      quantity: '1',
      entryPrice: '100',
      isolatedWallet: '10',
    }
    store.replace({
      BEATUSDT: {
        markPrice: '90.0', updatedAt: 100, lastPrice: '110.0', lastPriceAt: 100,
      },
    })
    const valueView = renderHook(() => (
      useFuturesPositionValuation(position, store, { valueOnly: true })
    ))
    const presentationView = renderHook(() => (
      useFuturesPositionValuation(position, store, { presentationOnly: true })
    ))
    const initialValue = valueView.result.current
    const initialPresentation = presentationView.result.current

    act(() => {
      store.replace({
        BEATUSDT: {
          markPrice: '90.00', updatedAt: 200, lastPrice: '110.00', lastPriceAt: 200,
        },
      })
    })
    expect(valueView.result.current).toBe(initialValue)
    expect(presentationView.result.current).toBe(initialPresentation)

    // The contract prints. Both consumers move: this is money.
    act(() => {
      store.replace({
        BEATUSDT: {
          markPrice: '90', updatedAt: 200, lastPrice: '80', lastPriceAt: 300,
        },
      })
    })
    expect(valueView.result.current).not.toBe(initialValue)
    expect(valueView.result.current.unrealizedPnl).toBe(20)
    expect(presentationView.result.current).not.toBe(initialPresentation)
    expect(presentationView.result.current).toMatchObject({
      basis: 'last-price',
      unrealizedPnl: 20,
      markScenario: { price: '90', unrealizedPnl: 10 },
    })
    const printedPresentation = presentationView.result.current
    const printedValue = valueView.result.current

    // The mark moves while the contract is still printing. The figure the row
    // states is unchanged, so the consumer that renders only that figure does
    // not rerun; the card that also states the mark's own reckoning does.
    act(() => {
      store.replace({
        BEATUSDT: {
          markPrice: '120', updatedAt: 400, lastPrice: '80', lastPriceAt: 300,
        },
      })
    })
    expect(valueView.result.current).toBe(printedValue)
    expect(presentationView.result.current).not.toBe(printedPresentation)
    expect(presentationView.result.current).toMatchObject({
      unrealizedPnl: 20,
      markScenario: { price: '120', unrealizedPnl: -20 },
    })
  })

  it('recomputes an aggregate for a print and not for a clock', () => {
    const store = createFuturesPositionMarkStore()
    const positions = [{
      symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '1', entryPrice: '100',
    }]
    store.replace({
      BTCUSDT: {
        markPrice: '110', updatedAt: 100, lastPrice: '109', lastPriceAt: 100,
      },
    })
    const aggregateView = renderHook(() => useFuturesPositionValuationAggregate({
      positions,
      positionsKnown: true,
      store,
    }))
    const initialAggregate = aggregateView.result.current

    act(() => {
      store.replace({
        BTCUSDT: {
          markPrice: '110.0', updatedAt: 200, lastPrice: '109.0', lastPriceAt: 200,
        },
      })
    })
    expect(aggregateView.result.current).toBe(initialAggregate)

    // A print between two marks is what the total is for.
    act(() => {
      store.replace({
        BTCUSDT: {
          markPrice: '110', updatedAt: 200, lastPrice: '111', lastPriceAt: 300,
        },
      })
    })
    expect(aggregateView.result.current).not.toBe(initialAggregate)
    expect(aggregateView.result.current).toMatchObject({ value: 11, complete: true })
    const printedAggregate = aggregateView.result.current

    // The mark moving underneath a contract that is still printing does not
    // change what the total is a total of.
    act(() => {
      store.replace({
        BTCUSDT: {
          markPrice: '120', updatedAt: 400, lastPrice: '111', lastPriceAt: 300,
        },
      })
    })
    expect(aggregateView.result.current).toBe(printedAggregate)

    // The contract goes quiet for longer than the window, the mark becomes the
    // newer statement, and the total is recomputed on it.
    act(() => {
      store.replace({
        BTCUSDT: {
          markPrice: '120',
          updatedAt: 300 + FUTURES_LAST_PRICE_GRACE_MS + 1,
          lastPrice: '111',
          lastPriceAt: 300,
        },
      })
    })
    expect(aggregateView.result.current).toMatchObject({ value: 20, complete: true })
  })
})
