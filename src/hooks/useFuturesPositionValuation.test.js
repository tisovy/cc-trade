import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  useFuturesPositionValuation,
  useFuturesPositionValuationAggregate,
} from './useFuturesPositionValuation.js'
import { createFuturesPositionMarkStore } from '../utils/futuresPositionMarks.js'

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

    act(() => {
      store.replace({
        BEATUSDT: {
          markPrice: '90', updatedAt: 200, lastPrice: '80', lastPriceAt: 300,
        },
      })
    })
    expect(valueView.result.current).toBe(initialValue)
    expect(presentationView.result.current).not.toBe(initialPresentation)
    expect(presentationView.result.current).toMatchObject({
      unrealizedPnl: 10,
      tapeScenario: { price: '80', unrealizedPnl: 20 },
    })
    const tapePresentation = presentationView.result.current

    act(() => {
      store.replace({
        BEATUSDT: {
          markPrice: '120', updatedAt: 400, lastPrice: '80', lastPriceAt: 300,
        },
      })
    })
    expect(valueView.result.current).not.toBe(initialValue)
    expect(valueView.result.current.unrealizedPnl).toBe(-20)
    expect(presentationView.result.current).not.toBe(tapePresentation)
    expect(presentationView.result.current.unrealizedPnl).toBe(-20)
  })

  it('does not recompute an aggregate for timestamp-only or tape-only movement', () => {
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

    act(() => {
      store.replace({
        BTCUSDT: {
          markPrice: '110', updatedAt: 200, lastPrice: '111', lastPriceAt: 300,
        },
      })
    })
    expect(aggregateView.result.current).toBe(initialAggregate)

    act(() => {
      store.replace({
        BTCUSDT: {
          markPrice: '120', updatedAt: 400, lastPrice: '111', lastPriceAt: 300,
        },
      })
    })
    expect(aggregateView.result.current).not.toBe(initialAggregate)
    expect(aggregateView.result.current).toMatchObject({ value: 20, complete: true })
  })
})
