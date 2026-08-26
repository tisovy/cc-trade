import { describe, expect, it, vi } from 'vitest'
import {
  FUTURES_LAST_PRICE_GRACE_MS,
  applyFuturesPositionValuation,
  createFuturesPositionMarkStore,
  mergeFuturesPositionMarks,
  readFuturesPositionMarks,
  readFuturesPositionValuation,
  readFuturesPositionValuationAggregate,
} from './futuresPositionMarks.js'
import {
  describeFuturesPosition,
  describeFuturesPositionMargin,
} from './futuresOrderPresentation.js'

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
      source: 'live-price',
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
      markScenario: null,
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
      margin: null,
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
      margin: null,
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

    expect(valuation.source).toBe('live-price')
    expect(valuation.unrealizedPnl).toBeCloseTo(-43.095, 6)
    expect(valuation.notional).toBeCloseTo(9653.28, 6)
    expect(valuation.roe).toBeCloseTo(-43.095, 6)
  })

  it('reads the position at the price the contract printed and keeps the mark beside it', () => {
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
      isolatedWallet: '100',
    }
    const before = readFuturesPositionValuation(short, base)

    expect(before).toMatchObject({
      source: 'live-price',
      basis: 'last-price',
      basisPrice: '3.30',
      sourceAt: 3,
      // The mark still names itself, and still sizes the position.
      markPrice: '3.36',
      notional: 9653.28,
    })
    // A short entered at 3.3450 is in profit at 3.30 and in loss on a mark of
    // 3.36 — one position, two prices, opposite signs.
    expect(before.unrealizedPnl).toBeCloseTo(129.285, 6)
    expect(before.markScenario).toMatchObject({
      price: '3.36',
      sourceAt: 2,
      disagreesWithReading: true,
    })
    expect(before.markScenario.unrealizedPnl).toBeCloseTo(-43.095, 6)
    // ROE follows the figure it is a percentage of; the denominator is the
    // committed margin either way.
    expect(before.roe).toBeCloseTo(129.285, 6)
    expect(before.markScenario.roe).toBeCloseTo(-43.095, 6)

    const after = readFuturesPositionValuation(short, {
      ...base,
      lastPrice: '3.34',
      lastPriceAt: 4,
    })
    expect(after.basisPrice).toBe('3.34')
    expect(after.sourceAt).toBe(4)
    expect(after.unrealizedPnl).toBeCloseTo(14.365, 6)
    // Nothing the exchange requires of the position moved with the print.
    expect(after.notional).toBe(before.notional)
    expect(after.margin).toBe(before.margin)
    expect(after.markScenario.unrealizedPnl).toBe(before.markScenario.unrealizedPnl)
  })

  it('hands the reading back to the mark once the contract stops printing', () => {
    const short = {
      symbol: 'BEATUSDT',
      positionSide: 'SHORT',
      quantity: '2873',
      entryPrice: '3.3450',
      isolatedWallet: '100',
    }
    const printedAt = 1_700_000_000_000
    // Still inside the window, the print is what the contract traded at.
    expect(readFuturesPositionValuation(short, {
      markPrice: '3.36',
      updatedAt: printedAt + FUTURES_LAST_PRICE_GRACE_MS,
      lastPrice: '3.30',
      lastPriceAt: printedAt,
    })).toMatchObject({ basis: 'last-price', basisPrice: '3.30' })

    // A millisecond past it the mark is the newer statement and takes the
    // reading — with nothing left to disagree with.
    const quiet = readFuturesPositionValuation(short, {
      markPrice: '3.36',
      updatedAt: printedAt + FUTURES_LAST_PRICE_GRACE_MS + 1,
      lastPrice: '3.30',
      lastPriceAt: printedAt,
    })
    expect(quiet).toMatchObject({
      basis: 'mark',
      basisPrice: '3.36',
      sourceAt: printedAt + FUTURES_LAST_PRICE_GRACE_MS + 1,
    })
    expect(quiet.unrealizedPnl).toBeCloseTo(-43.095, 6)
    expect(quiet.markScenario.disagreesWithReading).toBe(false)
  })

  it('will not prefer a print the exchange did not time', () => {
    const short = {
      symbol: 'BEATUSDT',
      positionSide: 'SHORT',
      quantity: '2873',
      entryPrice: '3.3450',
      isolatedWallet: '100',
    }
    // Without a trade time there is nothing to weigh against the mark's, and an
    // untimed price cannot be shown to be the newer of the two.
    expect(readFuturesPositionValuation(short, {
      markPrice: '3.36',
      updatedAt: 2,
      lastPrice: '3.30',
      lastPriceAt: null,
    })).toMatchObject({ basis: 'mark', basisPrice: '3.36' })
    // And the same in reverse: an untimed mark cannot be outranked either.
    expect(readFuturesPositionValuation(short, {
      markPrice: '3.36',
      updatedAt: null,
      lastPrice: '3.30',
      lastPriceAt: 3,
    })).toMatchObject({ basis: 'mark', basisPrice: '3.36' })
  })

  it('derives live CROSS ROE from the current mark notional and confirmed leverage', () => {
    const rawPosition = {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      quantity: '2',
      entryPrice: '100',
      marginType: 'CROSS',
      leverage: '10',
      positionInitialMargin: '20',
      initialMargin: '80',
    }
    const valuation = readFuturesPositionValuation(rawPosition, {
      markPrice: '120',
      updatedAt: 20,
    })

    expect(valuation).toMatchObject({
      source: 'live-price',
      unrealizedPnl: 40,
      notional: 240,
      margin: 24,
      roeComplete: true,
    })
    // Current margin is 240 / 10 = 24, rather than either snapshot dollar
    // field carried beside the position.
    expect(valuation.roe).toBeCloseTo((40 / 24) * 100, 10)
    const applied = applyFuturesPositionValuation(rawPosition, valuation)
    const displayedMargin = describeFuturesPositionMargin(applied).margin
    expect(applied.valuationMargin).toBe(24)
    expect(displayedMargin).toBe(24)
    expect(describeFuturesPosition(applied).roePercent).toBeCloseTo(valuation.roe, 10)
    expect(valuation.roe).toBeCloseTo((valuation.unrealizedPnl / displayedMargin) * 100, 10)
  })

  it('keeps live CROSS ROE unknown without confirmed leverage', () => {
    const rawPosition = {
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      quantity: '2',
      entryPrice: '100',
      marginType: 'CROSS',
      positionInitialMargin: '20',
      initialMargin: '80',
    }
    const valuation = readFuturesPositionValuation(rawPosition, {
      markPrice: '120',
      updatedAt: 20,
    })

    expect(valuation).toMatchObject({
      source: 'live-price',
      unrealizedPnl: 40,
      notional: 240,
      margin: null,
      roe: null,
      complete: true,
      roeComplete: false,
    })
    expect(applyFuturesPositionValuation(rawPosition, valuation).valuationMargin)
      .toBeUndefined()
  })

  it('uses committed isolated margin for live isolated ROE', () => {
    const valuation = readFuturesPositionValuation({
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      quantity: '2',
      entryPrice: '100',
      marginType: 'ISOLATED',
      isolatedWallet: '50',
      positionInitialMargin: '20',
      initialMargin: '80',
    }, {
      markPrice: '120',
      updatedAt: 20,
    })

    expect(valuation).toMatchObject({ roe: 80, roeComplete: true })
  })

  it('uses position-only margin for a coherent snapshot ROE', () => {
    const valuation = readFuturesPositionValuation({
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      quantity: '2',
      entryPrice: '100',
      markPrice: '105',
      unrealizedPnl: '10',
      marginType: 'CROSS',
      positionInitialMargin: '20',
      initialMargin: '80',
    }, null, {
      snapshotAt: 30,
      snapshotConfirmed: true,
      snapshotCoherent: true,
    })

    expect(valuation).toMatchObject({
      source: 'account-snapshot',
      margin: 20,
      roe: 50,
      roeComplete: true,
    })
  })

  it('carries the signed mark scenario through the compatibility DTO', () => {
    const rawPosition = {
      symbol: 'BEATUSDT',
      positionSide: 'SHORT',
      quantity: '2873',
      entryPrice: '3.3450',
      isolatedWallet: '100',
    }
    const valuation = readFuturesPositionValuation(rawPosition, {
      markPrice: '3.36',
      updatedAt: 2,
      lastPrice: '3.30',
      lastPriceAt: 3,
    })
    const applied = applyFuturesPositionValuation(rawPosition, valuation)

    expect(valuation.markScenario).toMatchObject({
      price: '3.36',
      disagreesWithReading: true,
    })
    expect(valuation.markScenario.unrealizedPnl).toBeCloseTo(-43.095, 9)
    expect(applied.markScenario).toBe(valuation.markScenario)
    // The row carries both figures, each under its own name. The margin ladder
    // reads the second one, so what the exchange may do to this position is
    // still decided at 3.36 even though the row is read at 3.30.
    expect(applied.unrealizedPnl).toBe(String(valuation.unrealizedPnl))
    expect(applied.markUnrealizedPnl).toBe(String(valuation.markScenario.unrealizedPnl))
    expect(applied.valuationPrice).toBe('3.30')
    expect(applied.markPrice).toBe('3.36')
    expect(describeFuturesPositionMargin(applied).marginBalance)
      .toBeCloseTo(100 - 43.095, 9)
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

  // The mark arrives once a second; the contract prints whenever it trades.
  // A print is the only thing that can move a position row in between, and it
  // arrives in the same publication as the mark it stands beside.
  const long = Object.freeze({
    symbol: 'BTCUSDT',
    positionSide: 'LONG',
    quantity: '2',
    entryPrice: '59000',
    leverage: '10',
  })

  it('moves the money when the contract prints between two marks', () => {
    const store = createFuturesPositionMarkStore()
    const full = vi.fn()
    const valuation = vi.fn()
    const value = vi.fn()
    const presentation = vi.fn()
    store.subscribe('BTCUSDT', full)
    store.subscribeValuation('BTCUSDT', valuation)
    store.subscribeValue('BTCUSDT', value)
    store.subscribePresentation('BTCUSDT', presentation)

    store.replace({ BTCUSDT: { markPrice: '60000', updatedAt: 1000 } })
    const onMark = readFuturesPositionValuation(long, store.get('BTCUSDT'))
    expect(onMark).toMatchObject({ basis: 'mark', unrealizedPnl: 2000 })
    expect(full).toHaveBeenCalledTimes(1)
    expect(value).toHaveBeenCalledTimes(1)

    // The same mark, and a trade the contract printed after it.
    expect(store.replace({
      BTCUSDT: {
        markPrice: '60000', updatedAt: 1000, lastPrice: '60250', lastPriceAt: 1400,
      },
    })).toBe(true)

    // Every channel fires, including the two primary arithmetic subscribes to.
    // That is the change: 250 dollars of price moved a position row without a
    // new mark, which is the second the operator was trading blind through.
    expect(full).toHaveBeenCalledTimes(2)
    expect(valuation).toHaveBeenCalledTimes(2)
    expect(value).toHaveBeenCalledTimes(2)
    expect(presentation).toHaveBeenCalledTimes(2)
    expect(store.valueVersion(['BTCUSDT'])).toBe('BTCUSDT:2')

    const onPrint = readFuturesPositionValuation(long, store.get('BTCUSDT'))
    expect(onPrint).toMatchObject({
      basis: 'last-price',
      basisPrice: '60250',
      sourceAt: 1400,
      unrealizedPnl: 2500,
      // Sized on the mark, as the exchange sizes it.
      markPrice: '60000',
      notional: 120000,
      margin: 12000,
    })
    expect(onPrint.markScenario).toEqual({
      price: '60000',
      sourceAt: 1000,
      unrealizedPnl: 2000,
      roe: onMark.roe,
      disagreesWithReading: false,
    })
  })

  it('does not redraw money for a mark clock that only advances', () => {
    const store = createFuturesPositionMarkStore()
    const full = vi.fn()
    const value = vi.fn()
    store.subscribe('BTCUSDT', full)
    store.subscribeValue('BTCUSDT', value)
    store.replace({
      BTCUSDT: {
        markPrice: '60000', updatedAt: 1000, lastPrice: '60250', lastPriceAt: 1400,
      },
    })
    expect(value).toHaveBeenCalledTimes(1)

    // A second mark, unchanged in price, while the print is still the newer of
    // the two. Nothing on the row is a different number.
    expect(store.replace({
      BTCUSDT: {
        markPrice: '60000', updatedAt: 2000, lastPrice: '60250', lastPriceAt: 1400,
      },
    })).toBe(true)
    expect(full).toHaveBeenCalledTimes(2)
    expect(value).toHaveBeenCalledTimes(1)
  })

  it('redraws money when a clock alone hands the reading back to the mark', () => {
    const store = createFuturesPositionMarkStore()
    const value = vi.fn()
    store.subscribeValue('BTCUSDT', value)
    store.replace({
      BTCUSDT: {
        markPrice: '60000', updatedAt: 1000, lastPrice: '60250', lastPriceAt: 1400,
      },
    })
    expect(readFuturesPositionValuation(long, store.get('BTCUSDT')).unrealizedPnl).toBe(2500)
    expect(value).toHaveBeenCalledTimes(1)

    // Neither price changed. The contract simply stopped trading long enough
    // for the mark to become the newer statement — and the row's figure is a
    // different number because of it, so the money channel must say so.
    expect(store.replace({
      BTCUSDT: {
        markPrice: '60000',
        updatedAt: 1400 + FUTURES_LAST_PRICE_GRACE_MS + 1,
        lastPrice: '60250',
        lastPriceAt: 1400,
      },
    })).toBe(true)
    expect(value).toHaveBeenCalledTimes(2)
    expect(readFuturesPositionValuation(long, store.get('BTCUSDT'))).toMatchObject({
      basis: 'mark',
      unrealizedPnl: 2000,
    })
  })

  it('refuses a price for a contract with no mark, and a print that arrives late', () => {
    const store = createFuturesPositionMarkStore()

    // A print stands beside a mark, never in place of one: the feed publishes
    // by walking its marks, and the reader drops anything that arrives without
    // one anyway.
    expect(store.replace({ SOLUSDT: { lastPrice: '150', lastPriceAt: 1000 } })).toBe(false)
    expect(store.get('SOLUSDT')).toBeNull()

    store.replace({
      BTCUSDT: {
        markPrice: '60000', updatedAt: 1000, lastPrice: '60250', lastPriceAt: 1400,
      },
    })
    expect(store.replace({
      BTCUSDT: {
        markPrice: '60000', updatedAt: 1000, lastPrice: '60100', lastPriceAt: 1300,
      },
    })).toBe(false)
    expect(store.get('BTCUSDT').lastPrice).toBe('60250')
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

  it('clears visible readings while preserving same-feed revision admission', () => {
    const store = createFuturesPositionMarkStore()
    expect(store.replace({
      BTCUSDT: { markPrice: '60000', updatedAt: 100 },
    }, 12, 3)).toBe(true)

    expect(store.clear({ preserveAdmission: true })).toBe(true)
    expect(store.get('BTCUSDT')).toBeNull()
    expect(store.replace({
      BTCUSDT: { markPrice: '59000', updatedAt: 90 },
    }, 11, 3)).toBe(false)
    expect(store.replace({
      BTCUSDT: { markPrice: '59100', updatedAt: 91 },
    }, 12, 3)).toBe(false)
    expect(store.replace({
      BTCUSDT: { markPrice: '60100', updatedAt: 200 },
    }, 13, 3)).toBe(true)

    // A replacement feed restarts its own revision namespace at one, and the
    // old namespace cannot regain authority after that epoch has been accepted.
    expect(store.replace({
      BTCUSDT: { markPrice: '60200', updatedAt: 300 },
    }, 1, 4)).toBe(true)
    expect(store.replace({
      BTCUSDT: { markPrice: '58000', updatedAt: 400 },
    }, 14, 3)).toBe(false)
    expect(store.get('BTCUSDT')?.markPrice).toBe('60200')
  })

  it('rejects a scoped feed frame that has no valid positive revision', () => {
    const store = createFuturesPositionMarkStore()
    const readingListener = vi.fn()
    store.subscribe('BTCUSDT', readingListener)
    expect(store.replace({
      BTCUSDT: { markPrice: '60000', updatedAt: 100 },
    }, 12, 3)).toBe(true)

    for (const malformedRevision of [null, undefined, 0, -1, 1.5]) {
      expect(store.replace({
        BTCUSDT: { markPrice: '59000', updatedAt: 200 },
      }, malformedRevision, 3)).toBe(false)
    }
    expect(store.get('BTCUSDT')?.markPrice).toBe('60000')
    expect(readingListener).toHaveBeenCalledTimes(1)
  })

  it('separates reading, presentation, and numeric valuation notifications', () => {
    const store = createFuturesPositionMarkStore()
    const readingListener = vi.fn()
    const presentationListener = vi.fn()
    const valueListener = vi.fn()
    store.subscribe('BTCUSDT', readingListener)
    store.subscribePresentation('BTCUSDT', presentationListener)
    store.subscribeValue('BTCUSDT', valueListener)

    expect(store.replace({
      BTCUSDT: {
        markPrice: '60000.0', updatedAt: 100, lastPrice: '59900.0', lastPriceAt: 100,
      },
    })).toBe(true)
    const readingVersion = store.version(['BTCUSDT'])
    const presentationVersion = store.presentationVersion(['BTCUSDT'])
    const valueVersion = store.valueVersion(['BTCUSDT'])

    // New source times remain observable on the full reading, but numerically
    // identical prices do not invalidate presentation or financial arithmetic.
    expect(store.replace({
      BTCUSDT: {
        markPrice: '60000.00', updatedAt: 200, lastPrice: '59900.00', lastPriceAt: 200,
      },
    })).toBe(true)
    expect(store.get('BTCUSDT')).toMatchObject({ updatedAt: 200, lastPriceAt: 200 })
    expect(readingListener).toHaveBeenCalledTimes(2)
    expect(presentationListener).toHaveBeenCalledTimes(1)
    expect(valueListener).toHaveBeenCalledTimes(1)
    expect(store.version(['BTCUSDT'])).not.toBe(readingVersion)
    expect(store.presentationVersion(['BTCUSDT'])).toBe(presentationVersion)
    expect(store.valueVersion(['BTCUSDT'])).toBe(valueVersion)

    // A print moves the money. This is the whole point of carrying it: the row
    // is read at what the contract is trading at, so a trade is a new figure.
    expect(store.replace({
      BTCUSDT: {
        markPrice: '60000.00', updatedAt: 200, lastPrice: '59950', lastPriceAt: 300,
      },
    })).toBe(true)
    expect(readingListener).toHaveBeenCalledTimes(3)
    expect(presentationListener).toHaveBeenCalledTimes(2)
    expect(valueListener).toHaveBeenCalledTimes(2)
    expect(store.presentationVersion(['BTCUSDT'])).not.toBe(presentationVersion)
    expect(store.valueVersion(['BTCUSDT'])).not.toBe(valueVersion)

    // A mark moving while the contract is still printing changes what stands
    // beside the figure — the mark's own reckoning, the notional, the margin —
    // and not the figure itself. The money channel stays quiet; the surfaces
    // that state both prices do not.
    const printedValueVersion = store.valueVersion(['BTCUSDT'])
    expect(store.replace({
      BTCUSDT: {
        markPrice: '60100', updatedAt: 400, lastPrice: '59950', lastPriceAt: 300,
      },
    })).toBe(true)
    expect(readingListener).toHaveBeenCalledTimes(4)
    expect(presentationListener).toHaveBeenCalledTimes(3)
    expect(valueListener).toHaveBeenCalledTimes(2)
    expect(store.valueVersion(['BTCUSDT'])).toBe(printedValueVersion)
  })

  it('leaves the mark’s own figure where it was when only the contract prints', () => {
    const store = createFuturesPositionMarkStore()
    const listener = vi.fn()
    const valuationListener = vi.fn()
    const short = {
      symbol: 'BEATUSDT', positionSide: 'SHORT', quantity: '2873', entryPrice: '3.3450',
    }
    store.subscribe('BEATUSDT', listener)
    store.subscribeValuation('BEATUSDT', valuationListener)
    store.replace({
      BEATUSDT: {
        markPrice: '3.36', updatedAt: 2, lastPrice: '3.30', lastPriceAt: 3,
      },
    })
    const before = readFuturesPositionValuation(short, store.get('BEATUSDT'))

    store.replace({
      BEATUSDT: {
        markPrice: '3.36', updatedAt: 2, lastPrice: '3.34', lastPriceAt: 4,
      },
    })
    const after = readFuturesPositionValuation(short, store.get('BEATUSDT'))

    expect(listener).toHaveBeenCalledTimes(2)
    expect(valuationListener).toHaveBeenCalledTimes(2)
    // The row moved; what the exchange is holding the position at did not, and
    // neither did the notional the exchange sizes its requirement on.
    expect(after.unrealizedPnl).not.toBe(before.unrealizedPnl)
    expect(after.basisPrice).toBe('3.34')
    expect(after.notional).toBe(before.notional)
    expect(after.markScenario).toEqual(before.markScenario)
  })
})

describe('valuation compatibility and aggregate helpers', () => {
  it('merges the price the contract is trading at and keeps the mark on the row', () => {
    const mark = { markPrice: '0.03600', updatedAt: 1 }
    const [markOnly] = mergeFuturesPositionMarks([position], { BMTUSDT: mark })
    const [withPrint] = mergeFuturesPositionMarks([position], {
      BMTUSDT: { ...mark, lastPrice: '0.03650', lastPriceAt: 2 },
    })

    // The mark is on the row under its own name and still decides the
    // liquidation; the figures the operator reads are on the printed price.
    expect(withPrint).toMatchObject({
      markPrice: markOnly.markPrice,
      valuationBasis: 'last-price',
      valuationPrice: '0.03650',
      markUnrealizedPnl: markOnly.unrealizedPnl,
      liquidationPrice: position.liquidationPrice,
    })
    expect(markOnly).toMatchObject({
      valuationBasis: 'mark',
      valuationPrice: '0.03600',
    })
    expect(Number(withPrint.unrealizedPnl))
      .toBeCloseTo((0.03650 - 0.03140) * -446082, 6)
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

  it('keeps a complete aggregate timestamp unknown when an included source is undated', () => {
    const store = createFuturesPositionMarkStore()
    store.replace({ BTCUSDT: { markPrice: '110', updatedAt: 50 } })
    const aggregate = readFuturesPositionValuationAggregate([
      {
        symbol: 'BTCUSDT',
        positionSide: 'LONG',
        quantity: '1',
        entryPrice: '100',
      },
      {
        symbol: 'ETHUSDT',
        positionSide: 'LONG',
        quantity: '1',
        entryPrice: '10',
        unrealizedPnl: '3',
      },
    ], store, { positionsKnown: true, snapshotAt: null })

    expect(aggregate).toEqual({
      value: 13,
      complete: true,
      missingCount: 0,
      fallbackCount: 1,
      sourceAt: null,
    })
  })
})
