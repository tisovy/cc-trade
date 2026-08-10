import { describe, expect, it } from 'vitest'
import {
  FUTURES_RECENT_SYMBOL_LIMIT,
  orderFuturesContracts,
  readFuturesSymbolHistory,
  rememberFuturesSymbol,
  toggleFuturesFavorite,
  writeFuturesSymbolHistory,
} from './futuresSymbolHistory.js'

const createStorage = (initial = {}) => {
  const entries = new Map(Object.entries(initial))
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  }
}

describe('futures symbol history', () => {
  it('round-trips recent symbols, newest first, without duplicates', () => {
    const storage = createStorage()
    let history = readFuturesSymbolHistory(storage)
    for (const symbol of ['BTCUSDT', 'SOLUSDT', 'BTCUSDT']) {
      history = rememberFuturesSymbol(history, symbol)
    }
    writeFuturesSymbolHistory(history, storage)

    expect(readFuturesSymbolHistory(storage)).toMatchObject({
      recent: ['BTCUSDT', 'SOLUSDT'],
      lastSymbol: 'BTCUSDT',
    })
  })

  it('bounds the recent list and ignores malformed entries', () => {
    let history = readFuturesSymbolHistory(createStorage())
    for (let index = 0; index < FUTURES_RECENT_SYMBOL_LIMIT + 4; index += 1) {
      history = rememberFuturesSymbol(history, `SYM${index}USDT`)
    }
    expect(history.recent).toHaveLength(FUTURES_RECENT_SYMBOL_LIMIT)
    expect(rememberFuturesSymbol(history, 'not a symbol')).toBe(history)
  })

  it('survives unreadable or corrupt storage', () => {
    expect(readFuturesSymbolHistory({ getItem: () => '{{{' }))
      .toMatchObject({ recent: [], favorites: [], lastSymbol: null })
    expect(writeFuturesSymbolHistory({ recent: ['BTCUSDT'] }, {
      setItem: () => { throw new Error('quota') },
    })).toBe(false)
  })

  it('toggles favourites without disturbing recency', () => {
    const history = rememberFuturesSymbol(readFuturesSymbolHistory(createStorage()), 'ETHUSDT')
    const withFavorite = toggleFuturesFavorite(history, 'ETHUSDT')
    expect(withFavorite.favorites).toEqual(['ETHUSDT'])
    expect(withFavorite.recent).toEqual(['ETHUSDT'])
    expect(toggleFuturesFavorite(withFavorite, 'ETHUSDT').favorites).toEqual([])
  })

  it('orders contracts by recency, then favourites, then alphabetically', () => {
    const contracts = ['AAVEUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT']
      .map(symbol => ({ symbol }))
    expect(orderFuturesContracts(contracts, {
      recent: ['SOLUSDT', 'ETHUSDT'],
      favorites: ['BTCUSDT'],
    }).map(contract => contract.symbol)).toEqual([
      'SOLUSDT', 'ETHUSDT', 'BTCUSDT', 'AAVEUSDT',
    ])
  })
})
