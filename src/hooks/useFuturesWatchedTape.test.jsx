import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useFuturesWatchedTape from './useFuturesWatchedTape.js'

const storeStub = () => ({ noteTape: vi.fn(() => true) })

const props = (overrides = {}) => ({
  store: null,
  symbol: 'BTCUSDT',
  lastPrice: null,
  lastPriceAt: null,
  carried: true,
  intervalMs: 100,
  ...overrides,
})

describe('useFuturesWatchedTape', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // The tape's rate is the market's business; the redraw rate has to be the
  // desk's. A burst on a liquid contract prints far faster than anything can be
  // read, and every note re-renders the rows subscribed to that symbol.
  it('coalesces a burst of prints to the bounded rate and lands on the last one', () => {
    const store = storeStub()
    const view = renderHook(next => useFuturesWatchedTape(next), {
      initialProps: props({ store, lastPrice: '60000', lastPriceAt: 1000 }),
    })

    // The first print of a quiet market is not held back.
    expect(store.noteTape).toHaveBeenCalledTimes(1)
    expect(store.noteTape).toHaveBeenLastCalledWith(
      'BTCUSDT',
      { lastPrice: '60000', lastPriceAt: 1000 },
    )

    for (const [price, at] of [['60010', 1010], ['60020', 1020], ['60030', 1030]]) {
      view.rerender(props({ store, lastPrice: price, lastPriceAt: at }))
      vi.advanceTimersByTime(10)
    }
    // Nothing extra reached the store while the window was open...
    expect(store.noteTape).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    // ...and what landed when it closed is the newest print, not the oldest one
    // that was waiting.
    expect(store.noteTape).toHaveBeenCalledTimes(2)
    expect(store.noteTape).toHaveBeenLastCalledWith(
      'BTCUSDT',
      { lastPrice: '60030', lastPriceAt: 1030 },
    )
  })

  it('withdraws the reading when the operator leaves the contract', () => {
    const store = storeStub()
    const view = renderHook(next => useFuturesWatchedTape(next), {
      initialProps: props({ store, lastPrice: '60000', lastPriceAt: 1000 }),
    })
    expect(store.noteTape).toHaveBeenCalledTimes(1)

    view.rerender(props({
      store, symbol: 'ETHUSDT', lastPrice: '2500', lastPriceAt: 1100,
    }))
    // The price drawn from a chart no longer on screen is taken off the old
    // contract before the new one is fed — nothing on that row would have said
    // where it came from.
    expect(store.noteTape).toHaveBeenNthCalledWith(2, 'BTCUSDT', null)
    vi.advanceTimersByTime(100)
    expect(store.noteTape).toHaveBeenLastCalledWith(
      'ETHUSDT',
      { lastPrice: '2500', lastPriceAt: 1100 },
    )
  })

  it('withdraws the reading when the workstation stops carrying the tape', () => {
    const store = storeStub()
    const view = renderHook(next => useFuturesWatchedTape(next), {
      initialProps: props({ store, lastPrice: '60000', lastPriceAt: 1000 }),
    })

    view.rerender(props({ store, lastPrice: '60000', lastPriceAt: 1000, carried: false }))
    expect(store.noteTape).toHaveBeenNthCalledWith(2, 'BTCUSDT', null)

    // Still not carrying: nothing is fed and nothing is withdrawn twice.
    view.rerender(props({ store, lastPrice: '60050', lastPriceAt: 1200, carried: false }))
    vi.advanceTimersByTime(500)
    expect(store.noteTape).toHaveBeenCalledTimes(2)
  })

  it('withdraws the reading when the desk tears the workstation down', () => {
    const store = storeStub()
    const view = renderHook(next => useFuturesWatchedTape(next), {
      initialProps: props({ store, lastPrice: '60000', lastPriceAt: 1000 }),
    })

    view.unmount()
    expect(store.noteTape).toHaveBeenNthCalledWith(2, 'BTCUSDT', null)
    // A window still open at teardown does not fire into a torn-down tree.
    vi.advanceTimersByTime(500)
    expect(store.noteTape).toHaveBeenCalledTimes(2)
  })

  it('feeds nothing without a store, a contract or a price', () => {
    const store = storeStub()
    const view = renderHook(next => useFuturesWatchedTape(next), {
      initialProps: props({ store }),
    })
    vi.advanceTimersByTime(500)
    expect(store.noteTape).not.toHaveBeenCalled()

    view.rerender(props({ store, symbol: null, lastPrice: '60000', lastPriceAt: 1000 }))
    vi.advanceTimersByTime(500)
    expect(store.noteTape).not.toHaveBeenCalled()

    view.rerender(props({ store: null, lastPrice: '60000', lastPriceAt: 1000 }))
    vi.advanceTimersByTime(500)
    expect(store.noteTape).not.toHaveBeenCalled()
  })
})
