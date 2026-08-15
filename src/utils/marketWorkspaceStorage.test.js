import { describe, expect, it, vi } from 'vitest'
import {
  MARKET_WORKSPACES,
  MARKET_WORKSPACE_STORAGE_KEY,
  readLastMarketWorkspace,
  writeLastMarketWorkspace,
} from './marketWorkspaceStorage'

const makeStorage = initialValue => ({
  getItem: vi.fn(() => initialValue),
  setItem: vi.fn(),
})

describe('market workspace persistence', () => {
  it.each([
    MARKET_WORKSPACES.SPOT,
    MARKET_WORKSPACES.FUTURES_LIVE,
  ])('restores the last activated %s workspace', workspace => {
    const storage = makeStorage(workspace)

    expect(readLastMarketWorkspace(storage)).toBe(workspace)
    expect(storage.getItem).toHaveBeenCalledWith(MARKET_WORKSPACE_STORAGE_KEY)
  })

  it.each([null, '', 'SPOT', 'futures', '{broken-json'])(
    'returns UNSELECTED without a Spot fallback for %s',
    storedValue => {
      expect(readLastMarketWorkspace(makeStorage(storedValue)))
        .toBe(MARKET_WORKSPACES.UNSELECTED)
    },
  )

  it('returns UNSELECTED when browser storage is unreadable', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException('Storage denied', 'SecurityError')
      }),
    }

    expect(readLastMarketWorkspace(storage)).toBe(MARKET_WORKSPACES.UNSELECTED)
  })

  it('writes only activatable workspaces', () => {
    const storage = makeStorage(null)

    expect(writeLastMarketWorkspace(MARKET_WORKSPACES.SPOT, storage)).toBe(true)
    expect(writeLastMarketWorkspace(MARKET_WORKSPACES.FUTURES_LIVE, storage)).toBe(true)
    expect(writeLastMarketWorkspace(MARKET_WORKSPACES.UNSELECTED, storage)).toBe(false)
    expect(storage.setItem.mock.calls).toEqual([
      [MARKET_WORKSPACE_STORAGE_KEY, MARKET_WORKSPACES.SPOT],
      [MARKET_WORKSPACE_STORAGE_KEY, MARKET_WORKSPACES.FUTURES_LIVE],
    ])
  })

  it('fails closed when persistence writes are rejected', () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new DOMException('Storage denied', 'SecurityError')
      }),
    }

    expect(writeLastMarketWorkspace(MARKET_WORKSPACES.SPOT, storage)).toBe(false)
  })
})
