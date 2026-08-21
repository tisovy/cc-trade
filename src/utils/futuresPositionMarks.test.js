import { describe, expect, it, vi } from 'vitest'
import {
  createFuturesPositionMarkStore,
  mergeFuturesPositionMarks,
  readFuturesPositionMarks,
  readFuturesPositionValuation,
  readFuturesPositionValuationAggregate,
} from './futuresPositionMarks.js'

const position = Object.freeze({
  symbol: 'BMTUSDT',
  positionSide: 'BOTH',
  quantity: '-446082',
  entryPrice: '0.03140',
  markPrice: '0.03523',
  liquidationPrice: '0.04102',
  unrealizedPnl: '-1708.49',
  isolatedWallet: '1000',
})

describe('readFuturesPositionMarks', () => {
  it('keeps usable mark and optional tape readings without making tape authoritative', () => {
    expect(readFuturesPositionMarks({
      bmtusdt: {
        markPrice: '0.03600',
        updatedAt: 1_700_000_000_000,
        lastPrice: '0.03611',
        lastPriceAt: 1_700_000_000_400,
      },
      ZEROUSDT: { markPrice: '0' },
      BROKENUSDT: { markPrice: 'abc' },
      EMPTYUSDT: null,
    })).toEqual({
      BMTUSDT: {
        markPrice: '0.03600',
        updatedAt: 1_700_000_000_000,
        lastPrice: '0.03611',
        lastPriceAt: 1_700_000_000_400,
      },
    })
  })

  it('keeps a valid mark when tape data is absent or unusable', () => {
    expect(readFuturesPositionMarks({
      BMTUSDT: { markPrice: '0.03600', updatedAt: 1, lastPrice: '0', lastPriceAt: 2 },
      ETHUSDT: { markPrice: '2500', updatedAt: 1 },
    })).toEqual({
      BMTUSDT: { markPrice: '0.03600', updatedAt: 1, lastPrice: null, lastPriceAt: 2 },
      ETHUSDT: { markPrice: '2500', updatedAt: 1, lastPrice: null, lastPriceAt: null },
    })
  })

  it('refuses a payload that is not a mark map', () => {
    expect(readFuturesPositionMarks('BMTUSDT')).toBeNull()
    expect(readFuturesPositionMarks([])).toBeNull()
    expect(readFuturesPositionMarks(null)).toBeNull()
  })
})

describe('readFuturesPositionValuation', () => {
  it('uses one live mark for price, notional, uPnL, and ROE', () => {
    const valuation = readFuturesPositionValuation(position, {
      markPrice: '0.03600',
      updatedAt: 1_700_000_000_000,
    })

    expect(valuation).toMatchObject({
      source: 'live-mark',
      sourceAt: 1_700_000_000_000,
      markPrice: '0.03600',
      complete: true,
      roeComplete: true,
      missingReason: null,
    })
    // (0.03600 - 0.03140) x -446082 contracts.
    expect(valuation.unrealizedPnl).toBeCloseTo(-2051.98, 2)
    expect(valuation.notional).toBeCloseTo(16058.952, 3)
    expect(valuation.roe).toBeCloseTo(-205.19772, 5)
  })

  it('uses a coherent account snapshot as a complete fallback generation', () => {
    const valuation = readFuturesPositionValuation(position, null, {
      snapshotAt: 1_700_000_000_000,
      snapshotConfirmed: true,
      snapshotCoherent: true,
    })

    expect(valuation).toMatchObject({
      source: 'account-snapshot',
      sourceAt: 1_700_000_000_000,
      markPrice: '0.03523',
      unrealizedPnl: -1708.49,
      complete: true,
      roeComplete: true,
      tapeScenario: null,
    })
    expect(valuation.notional).toBeCloseTo(15715.46886, 5)
    expect(valuation.roe).toBeCloseTo(-170.849, 5)
  })

  it('retains only the confirmed snapshot PnL when snapshot fields are not coherent', () => {
    expect(readFuturesPositionValuation(position, null, {
      snapshotAt: 1_700_000_000_000,
      snapshotConfirmed: true,
      snapshotCoherent: false,
    })).toMatchObject({
      source: 'account-snapshot',
      sourceAt: 1_700_000_000_000,
      markPrice: null,
      unrealizedPnl: -1708.49,
      notional: null,
      roe: null,
      complete: true,
      roeComplete: false,
    })
  })

  it('reports unknown instead of zero when neither mark nor snapshot PnL exists', () => {
    const valuation = readFuturesPositionValuation({
      ...position,
      markPrice: null,
      unrealizedPnl: null,
    }, null, {
      snapshotConfirmed: true,
    })

    expect(valuation).toMatchObject({
      source: 'unknown',
      sourceAt: null,
      markPrice: null,
      unrealizedPnl: null,
      notional: null,
      roe: null,
      complete: false,
      roeComplete: false,
      missingReason: 'mark-and-snapshot-unavailable',
    })
  })

  it('applies the SHORT sign when hedge-mode quantity is positive', () => {
    const valuation = readFuturesPositionValuation({
      symbol: 'BEATUSDT',
      positionSide: 'SHORT',
      quantity: '2873',
      entryPrice: '3.3450',
      isolatedWallet: '100',
    }, {
      markPrice: '3.36',
      updatedAt: 2,
    })

    expect(valuation.source).toBe('live-mark')
    expect(valuation.unrealizedPnl).toBeCloseTo(-43.095, 6)
    expect(valuation.notional).toBeCloseTo(9653.28, 6)
    expect(valuation.roe).toBeCloseTo(-43.095, 6)
  })

  it('keeps primary valuation unchanged when only the tape changes', () => {
    const base = {
      markPrice: '3.36',
      updatedAt: 2,
      lastPrice: '3.30',
      lastPriceAt: 3,
    }
    const short = {
      symbol: 'BEATUSDT',
      positionSide: 'SHORT',
      quantity: '2873',
      entryPrice: '3.3450',
    }
    const before = readFuturesPositionValuation(short, base)
    const after = readFuturesPositionValuation(short, {
      ...base,
      lastPrice: '3.34',
      lastPriceAt: 4,
    })

    expect(after).toMatchObject({
      source: before.source,
      sourceAt: before.sourceAt,
      markPrice: before.markPrice,
      unrealizedPnl: before.unrealizedPnl,
      notional: before.notional,
      roe: before.roe,
      complete: before.complete,
    })
    expect(before.tapeScenario).toMatchObject({
      price: '3.30',
      disagreesWithMark: true,
    })
    expect(after.tapeScenario.price).toBe('3.34')
  })
})

describe('createFuturesPositionMarkStore', () => {
  it('notifies only subscribers of symbols whose reading changed', () => {
    const store = createFuturesPositionMarkStore()
    const btcListener = vi.fn()
    const ethListener = vi.fn()
    const releaseBtc = store.subscribe('btcusdt', btcListener)
    store.subscribe('ETHUSDT', ethListener)

    expect(store.replace({
      BTCUSDT: { markPrice: '60000', updatedAt: 100 },
      ETHUSDT: { markPrice: '2500', updatedAt: 100 },
    })).toBe(true)
    expect(btcListener).toHaveBeenCalledTimes(1)
    expect(ethListener).toHaveBeenCalledTimes(1)
    expect(store.version(['ETHUSDT', 'BTCUSDT'])).toBe('BTCUSDT:1|ETHUSDT:1')

    expect(store.replace({
      BTCUSDT: { markPrice: '60100', updatedAt: 200 },
      ETHUSDT: { markPrice: '2500', updatedAt: 100 },
    })).toBe(true)
    expect(btcListener).toHaveBeenCalledTimes(2)
    expect(ethListener).toHaveBeenCalledTimes(1)
    expect(store.version(['BTCUSDT', 'ETHUSDT'])).toBe('BTCUSDT:2|ETHUSDT:1')

    releaseBtc()
    store.replace({
      BTCUSDT: { markPrice: '60200', updatedAt: 300 },
      ETHUSDT: { markPrice: '2500', updatedAt: 100 },
    })
    expect(btcListener).toHaveBeenCalledTimes(2)
  })

  it('ignores older and duplicate frames without notifying or regressing a symbol', () => {
    const store = createFuturesPositionMarkStore()
    const listener = vi.fn()
    store.subscribe('BTCUSDT', listener)

    expect(store.replace({
      BTCUSDT: {
        markPrice: '60100', updatedAt: 200, lastPrice: '60090', lastPriceAt: 200,
      },
    })).toBe(true)
    expect(store.replace({
      BTCUSDT: { markPrice: '59900', updatedAt: 100 },
    })).toBe(false)
    expect(store.replace({
      BTCUSDT: {
        markPrice: '60100', updatedAt: 200, lastPrice: '60090', lastPriceAt: 200,
      },
    })).toBe(false)

    // An untimed frame cannot displace a timed one, and a later mark-only
    // frame does not erase the independent explanatory tape reading.
    expect(store.replace({
      BTCUSDT: { markPrice: '1', updatedAt: null },
    })).toBe(false)
    expect(store.replace({
      BTCUSDT: { markPrice: '60200', updatedAt: 300 },
    })).toBe(true)

    expect(store.get('btcusdt')).toEqual({
      markPrice: '60200',
      updatedAt: 300,
      lastPrice: '60090',
      lastPriceAt: 200,
    })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.version(['BTCUSDT'])).toBe('BTCUSDT:2')
  })

  it('rejects an older full frame before it can delete a newer symbol', () => {
    const store = createFuturesPositionMarkStore()
    expect(store.replace({
      BTCUSDT: { markPrice: '60000', updatedAt: 100 },
      ETHUSDT: { markPrice: '2500', updatedAt: 200 },
    }, 2)).toBe(true)

    expect(store.replace({
      BTCUSDT: { markPrice: '59000', updatedAt: 50 },
    }, 1)).toBe(false)
    expect(store.get('BTCUSDT').markPrice).toBe('60000')
    expect(store.get('ETHUSDT').markPrice).toBe('2500')

    expect(store.replace({
      BTCUSDT: { markPrice: '60100', updatedAt: 300 },
    }, 3)).toBe(true)
    expect(store.get('BTCUSDT').markPrice).toBe('60100')
    expect(store.get('ETHUSDT')).toBeNull()
  })

  it('uses feed epochs to separate restarted revision namespaces', () => {
    const store = createFuturesPositionMarkStore()
    expect(store.replace({
      BTCUSDT: { markPrice: '60000', updatedAt: 100 },
    }, 12, 3)).toBe(true)

    store.clear({ retireEpoch: true })
    // Traffic from the retired feed may arrive after the activation clear. It
    // cannot resurrect a mark while the replacement feed has not spoken yet.
    expect(store.replace({
      BTCUSDT: { markPrice: '59000', updatedAt: 50 },
    }, 13, 3)).toBe(false)
    expect(store.get('BTCUSDT')).toBeNull()
    expect(store.replace({}, 14, 3)).toBe(false)
    expect(store.replace({
      BTCUSDT: { markPrice: '60100', updatedAt: 200 },
    }, 1, 4)).toBe(true)

    // Even a numerically newer revision from the retired namespace is stale.
    expect(store.replace({
      BTCUSDT: { markPrice: '59000', updatedAt: 50 },
    }, 15, 3)).toBe(false)
    expect(store.get('BTCUSDT')?.markPrice).toBe('60100')
  })

  it('can notify explanatory tape movement without changing primary PnL', () => {
    const store = createFuturesPositionMarkStore()
    const listener = vi.fn()
    const valuationListener = vi.fn()
    store.subscribe('BEATUSDT', listener)
    store.subscribeValuation('BEATUSDT', valuationListener)
    store.replace({
      BEATUSDT: {
        markPrice: '3.36', updatedAt: 2, lastPrice: '3.30', lastPriceAt: 3,
      },
    })
    const before = readFuturesPositionValuation({
      symbol: 'BEATUSDT', positionSide: 'SHORT', quantity: '2873', entryPrice: '3.3450',
    }, store.get('BEATUSDT'))
    const primaryVersion = store.version(['BEATUSDT'])

    store.replace({
      BEATUSDT: {
        markPrice: '3.36', updatedAt: 2, lastPrice: '3.34', lastPriceAt: 4,
      },
    })
    const after = readFuturesPositionValuation({
      symbol: 'BEATUSDT', positionSide: 'SHORT', quantity: '2873', entryPrice: '3.3450',
    }, store.get('BEATUSDT'))

    expect(listener).toHaveBeenCalledTimes(2)
    expect(valuationListener).toHaveBeenCalledTimes(1)
    expect(store.version(['BEATUSDT'])).toBe(primaryVersion)
    expect(after.unrealizedPnl).toBe(before.unrealizedPnl)
    expect(after.notional).toBe(before.notional)
    expect(after.tapeScenario.price).toBe('3.34')
  })
})

describe('valuation compatibility and aggregate helpers', () => {
  it('merges a live mark without letting tape movement alter the primary fields', () => {
    const mark = { markPrice: '0.03600', updatedAt: 1 }
    const [markOnly] = mergeFuturesPositionMarks([position], { BMTUSDT: mark })
    const [withTape] = mergeFuturesPositionMarks([position], {
      BMTUSDT: { ...mark, lastPrice: '0.03650', lastPriceAt: 2 },
    })

    expect(withTape).toMatchObject({
      markPrice: markOnly.markPrice,
      valuationPrice: markOnly.valuationPrice,
      valuationEstimated: false,
      unrealizedPnl: markOnly.unrealizedPnl,
      markUnrealizedPnl: markOnly.markUnrealizedPnl,
    })
    expect(withTape.tapePrice).toBe('0.03650')
    expect(withTape.liquidationPrice).toBe(position.liquidationPrice)
  })

  it('marks an aggregate incomplete instead of presenting a known subset as complete', () => {
    const store = createFuturesPositionMarkStore()
    store.replace({ BMTUSDT: { markPrice: '0.03600', updatedAt: 10 } })
    const aggregate = readFuturesPositionValuationAggregate([
      position,
      {
        symbol: 'UNKNOWNUSDT',
        positionSide: 'BOTH',
        quantity: '1',
        entryPrice: '1',
      },
    ], store, { positionsKnown: true })

    expect(aggregate.value).toBeCloseTo(-2051.98, 2)
    expect(aggregate).toMatchObject({
      complete: false,
      missingCount: 1,
      fallbackCount: 0,
      sourceAt: 10,
    })
  })
})
