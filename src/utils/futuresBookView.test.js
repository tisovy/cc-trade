import { afterEach, describe, expect, it } from 'vitest'
import {
  FUTURES_BOOK_VIEW_DEFAULT,
  FUTURES_BOOK_VIEW_MAX_CONTRACTS,
  FUTURES_BOOK_VIEW_STORAGE_KEY,
  parseStoredBookView,
  readStoredBookView,
  writeStoredBookView,
} from './futuresBookView.js'

const storedMap = () => JSON.parse(localStorage.getItem(FUTURES_BOOK_VIEW_STORAGE_KEY) ?? '{}')

afterEach(() => {
  localStorage.clear()
})

describe('futures book view store', () => {
  it('keeps how a contract was read against that contract', () => {
    writeStoredBookView('BTCUSDT', { sideMode: 'asks', stepMultiplier: 10 })
    writeStoredBookView('RIFUSDT', { sideMode: 'bids', stepMultiplier: 100 })

    expect(readStoredBookView('BTCUSDT')).toEqual({ sideMode: 'asks', stepMultiplier: 10 })
    expect(readStoredBookView('RIFUSDT')).toEqual({ sideMode: 'bids', stepMultiplier: 100 })
    // The step is a multiple of the contract's own tick, so what was chosen for
    // one contract is not a setting for another that has never been configured.
    expect(readStoredBookView('ETHUSDT')).toEqual(FUTURES_BOOK_VIEW_DEFAULT)
  })

  // Restored entries are operator input that outlived a restart, so they are
  // validated exactly like fresh input.
  it('refuses an entry it cannot honour instead of applying it', () => {
    expect(parseStoredBookView({ sideMode: 'left', stepMultiplier: 10 })).toBeNull()
    expect(parseStoredBookView({ sideMode: 'both', stepMultiplier: 7 })).toBeNull()
    expect(parseStoredBookView({ sideMode: 'both', stepMultiplier: '10' })).toBeNull()
    expect(parseStoredBookView(null)).toBeNull()
    expect(parseStoredBookView([])).toBeNull()

    expect(writeStoredBookView('BTCUSDT', { sideMode: 'both', stepMultiplier: 7 })).toBe(false)
    expect(writeStoredBookView('not a symbol', { sideMode: 'both', stepMultiplier: 1 })).toBe(false)
    expect(localStorage.getItem(FUTURES_BOOK_VIEW_STORAGE_KEY)).toBeNull()

    localStorage.setItem(
      FUTURES_BOOK_VIEW_STORAGE_KEY,
      JSON.stringify({ BTCUSDT: { sideMode: 'sideways', stepMultiplier: 3 } }),
    )
    expect(readStoredBookView('BTCUSDT')).toEqual(FUTURES_BOOK_VIEW_DEFAULT)
  })

  it('survives a store that is not a map at all', () => {
    localStorage.setItem(FUTURES_BOOK_VIEW_STORAGE_KEY, '"nonsense"')
    expect(readStoredBookView('BTCUSDT')).toEqual(FUTURES_BOOK_VIEW_DEFAULT)
    expect(writeStoredBookView('BTCUSDT', { sideMode: 'asks', stepMultiplier: 2 })).toBe(true)
    expect(readStoredBookView('BTCUSDT')).toEqual({ sideMode: 'asks', stepMultiplier: 2 })
  })

  it('rewrites a contract in place rather than accumulating it', () => {
    writeStoredBookView('BTCUSDT', { sideMode: 'asks', stepMultiplier: 10 })
    writeStoredBookView('BTCUSDT', { sideMode: 'both', stepMultiplier: 25 })
    expect(Object.keys(storedMap())).toEqual(['BTCUSDT'])
    expect(readStoredBookView('BTCUSDT')).toEqual({ sideMode: 'both', stepMultiplier: 25 })
  })

  // A desk watches tens of contracts, not thousands: the bound is what keeps a
  // year of browsing from growing one unbounded key.
  it('drops the least recently written contract at the bound', () => {
    const written = FUTURES_BOOK_VIEW_MAX_CONTRACTS + 5
    for (let index = 0; index < written; index += 1) {
      writeStoredBookView(`SYM${index}USDT`, { sideMode: 'bids', stepMultiplier: 2 })
    }
    const keys = Object.keys(storedMap())
    expect(keys).toHaveLength(FUTURES_BOOK_VIEW_MAX_CONTRACTS)
    expect(keys.at(-1)).toBe(`SYM${written - 1}USDT`)
    expect(readStoredBookView('SYM0USDT')).toEqual(FUTURES_BOOK_VIEW_DEFAULT)
    expect(readStoredBookView(`SYM${written - 1}USDT`)).toEqual({
      sideMode: 'bids',
      stepMultiplier: 2,
    })
  })

  // Rewriting a contract makes it the most recent one, so the contract the
  // operator keeps configuring is not the one evicted.
  it('treats a rewrite as recency', () => {
    for (let index = 0; index < FUTURES_BOOK_VIEW_MAX_CONTRACTS; index += 1) {
      writeStoredBookView(`SYM${index}USDT`, { sideMode: 'bids', stepMultiplier: 2 })
    }
    writeStoredBookView('SYM0USDT', { sideMode: 'asks', stepMultiplier: 5 })
    writeStoredBookView('LATEUSDT', { sideMode: 'both', stepMultiplier: 1 })

    expect(readStoredBookView('SYM0USDT')).toEqual({ sideMode: 'asks', stepMultiplier: 5 })
    expect(readStoredBookView('SYM1USDT')).toEqual(FUTURES_BOOK_VIEW_DEFAULT)
  })
})
