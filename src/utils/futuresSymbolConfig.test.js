import { describe, expect, it } from 'vitest'
import {
  mergeFuturesPositionConfigs,
  readFuturesSymbolConfig,
  readFuturesSymbolConfigs,
} from './futuresSymbolConfig.js'

describe('readFuturesSymbolConfig', () => {
  it('reads the leverage, the ceiling and the margin mode the exchange reported', () => {
    expect(readFuturesSymbolConfig({
      symbol: 'btcusdt',
      leverage: 20,
      maxLeverage: 125,
      marginType: 'CROSSED',
      maxNotionalValue: '5000000',
    })).toEqual({
      symbol: 'BTCUSDT',
      leverage: 20,
      maxLeverage: 125,
      marginType: 'CROSSED',
      maxNotionalValue: '5000000',
    })
  })

  // A leverage nobody stated is the one number an operator must not be shown
  // beside their own money, so nothing is defaulted.
  it('reports a field the exchange did not report as absent', () => {
    expect(readFuturesSymbolConfig({ symbol: 'BTCUSDT', leverage: '0', marginType: 'ISOLATED' }))
      .toMatchObject({ leverage: null, maxLeverage: null, marginType: 'ISOLATED' })
    expect(readFuturesSymbolConfig({ symbol: 'BTCUSDT', leverage: 2.5, marginType: 'nonsense' }))
      .toBeNull()
    expect(readFuturesSymbolConfig({ leverage: 5 }, 'ethusdt'))
      .toMatchObject({ symbol: 'ETHUSDT', leverage: 5 })
    expect(readFuturesSymbolConfig(null)).toBeNull()
  })
})

describe('readFuturesSymbolConfigs', () => {
  it('keys the configs it can read by symbol and drops the ones it cannot', () => {
    expect(readFuturesSymbolConfigs({
      BTCUSDT: { symbol: 'BTCUSDT', leverage: 20 },
      BICOUSDT: { symbol: 'BICOUSDT', leverage: 'abc' },
    })).toEqual({ BTCUSDT: { symbol: 'BTCUSDT', leverage: 20, maxLeverage: null, marginType: null, maxNotionalValue: null } })
    expect(readFuturesSymbolConfigs({})).toBeNull()
    expect(readFuturesSymbolConfigs('nope')).toBeNull()
  })
})

describe('mergeFuturesPositionConfigs', () => {
  const position = { symbol: 'BTCUSDT', quantity: '0.5', entryPrice: '58000' }

  it('states the leverage and the mode a position is carried at', () => {
    const [merged] = mergeFuturesPositionConfigs([position], {
      BTCUSDT: { symbol: 'BTCUSDT', leverage: 20, marginType: 'ISOLATED' },
    })
    expect(merged).toMatchObject({ leverage: 20, marginType: 'ISOLATED' })
  })

  // A source that states the field outright is believed over the account-wide
  // setting, and a position no config covers is returned untouched.
  it('leaves a position that already states them alone', () => {
    const stated = { ...position, leverage: 10, marginType: 'CROSSED' }
    const positions = [stated, { symbol: 'BICOUSDT', quantity: '1000' }]
    const merged = mergeFuturesPositionConfigs(positions, {
      BTCUSDT: { symbol: 'BTCUSDT', leverage: 20, marginType: 'ISOLATED' },
    })
    expect(merged[0]).toBe(stated)
    expect(merged[1]).not.toHaveProperty('leverage')
  })

  it('returns the same list when there is nothing to merge', () => {
    const positions = [position]
    expect(mergeFuturesPositionConfigs(positions, null)).toBe(positions)
    expect(mergeFuturesPositionConfigs(positions, {})).toBe(positions)
    expect(mergeFuturesPositionConfigs([], { BTCUSDT: { symbol: 'BTCUSDT', leverage: 20 } })).toEqual([])
  })
})
