import { describe, expect, it } from 'vitest'
import {
  FUTURES_RECENT_SYMBOL_LIMIT,
  orderFuturesContracts,
  readFuturesSymbolHistory,
  rememberFuturesSymbol,
  removeFuturesRecentSymbol,
  searchFuturesSymbols,
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

  it('persists nine recent symbols and evicts only the oldest on the tenth', () => {
    expect(FUTURES_RECENT_SYMBOL_LIMIT).toBe(9)
    const storage = createStorage()
    let history = readFuturesSymbolHistory(storage)
    for (let index = 0; index < 10; index += 1) {
      history = rememberFuturesSymbol(history, `SYM${index}USDT`)
    }

    expect(history.recent).toEqual([
      'SYM9USDT', 'SYM8USDT', 'SYM7USDT',
      'SYM6USDT', 'SYM5USDT', 'SYM4USDT',
      'SYM3USDT', 'SYM2USDT', 'SYM1USDT',
    ])
    writeFuturesSymbolHistory(history, storage)
    expect(readFuturesSymbolHistory(storage)).toMatchObject({
      recent: history.recent,
      lastSymbol: 'SYM9USDT',
    })
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

  it('removes persisted recency without disturbing favorites and falls back safely', () => {
    const storage = createStorage()
    const history = {
      recent: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      favorites: ['ETHUSDT'],
      lastSymbol: 'BTCUSDT',
    }
    const withoutEth = removeFuturesRecentSymbol(history, 'ETHUSDT')
    expect(withoutEth).toEqual({
      recent: ['BTCUSDT', 'SOLUSDT'],
      favorites: ['ETHUSDT'],
      lastSymbol: 'BTCUSDT',
    })

    const withoutLast = removeFuturesRecentSymbol(withoutEth, 'BTCUSDT')
    expect(withoutLast).toEqual({
      recent: ['SOLUSDT'],
      favorites: ['ETHUSDT'],
      lastSymbol: 'SOLUSDT',
    })
    writeFuturesSymbolHistory(withoutLast, storage)
    expect(readFuturesSymbolHistory(storage)).toEqual(withoutLast)
    expect(removeFuturesRecentSymbol(withoutLast, 'AAVEUSDT')).toBe(withoutLast)
    expect(removeFuturesRecentSymbol(withoutLast, 'not a symbol')).toBe(withoutLast)
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

describe('searchFuturesSymbols', () => {
  const catalog = ['AAVEUSDT', 'BTCUSDT', 'BTCDOMUSDT', 'WBTCUSDT', 'ETHUSDT', 'SOLUSDT']

  // Typing `BT` must not offer WBTCUSDT before BTCUSDT: what the query starts is
  // what the operator is reaching for.
  it('ranks a symbol that starts with the query above one that only contains it', () => {
    expect(searchFuturesSymbols(catalog, 'BTC'))
      .toEqual(['BTCDOMUSDT', 'BTCUSDT', 'WBTCUSDT'])
  })

  // Recency outranks the alphabet — usually the pair being reached for is the one
  // just left.
  it('offers the contracts worked with lately first', () => {
    expect(searchFuturesSymbols(catalog, '', { recent: ['SOLUSDT', 'ETHUSDT'], favorites: ['AAVEUSDT'] }))
      .toEqual(['SOLUSDT', 'ETHUSDT', 'AAVEUSDT', 'BTCDOMUSDT', 'BTCUSDT', 'WBTCUSDT'])
    expect(searchFuturesSymbols(catalog, 'USDT', { recent: ['ETHUSDT'] })[0]).toBe('ETHUSDT')
  })

  it('offers a stored contract the catalogue has not delivered yet', () => {
    expect(searchFuturesSymbols(['BICOUSDT', ...catalog], 'BICO', { recent: ['BICOUSDT'] }))
      .toEqual(['BICOUSDT'])
  })

  it('deduplicates, ignores unreadable entries and bounds the list', () => {
    expect(searchFuturesSymbols(['BTCUSDT', 'BTCUSDT', 'btcusdt', null, 'X', 42], 'BTC'))
      .toEqual(['BTCUSDT'])
    expect(searchFuturesSymbols(catalog, '', { limit: 2 })).toHaveLength(2)
    expect(searchFuturesSymbols(null, 'BTC')).toEqual([])
    expect(searchFuturesSymbols()).toEqual([])
  })
})

// Binance lists USDⓈ-M perpetuals whose tickers are CJK words — 龙虾USDT traded
// live on 2026-08-28 — and a history that only read ASCII forgot the contract
// the operator was standing on: every workspace remount reopened the previous
// ASCII pair instead. The history reads the same identity alphabet the
// workstation protocol does.
describe('unicode listings', () => {
  const createStorage = (initial = {}) => {
    const entries = new Map(Object.entries(initial))
    return {
      getItem: key => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
    }
  }

  it('remembers a CJK perpetual and restores it as the last symbol', () => {
    const storage = createStorage()
    let history = readFuturesSymbolHistory(storage)
    history = rememberFuturesSymbol(history, 'VELVETUSDT')
    history = rememberFuturesSymbol(history, '龙虾USDT')
    writeFuturesSymbolHistory(history, storage)

    expect(readFuturesSymbolHistory(storage)).toMatchObject({
      recent: ['龙虾USDT', 'VELVETUSDT'],
      lastSymbol: '龙虾USDT',
    })
  })

  it('remembers a delivery contract under its dated name', () => {
    const history = rememberFuturesSymbol(
      readFuturesSymbolHistory(createStorage()),
      'BTCUSDT_260929',
    )
    expect(history.lastSymbol).toBe('BTCUSDT_260929')
  })

  it('still refuses spaces, punctuation and fragments', () => {
    const history = readFuturesSymbolHistory(createStorage())
    expect(rememberFuturesSymbol(history, 'not a symbol')).toBe(history)
    expect(rememberFuturesSymbol(history, 'BTC/USDT')).toBe(history)
    expect(rememberFuturesSymbol(history, 'X')).toBe(history)
  })
})
