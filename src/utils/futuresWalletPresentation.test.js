import { describe, expect, it } from 'vitest'
import { futuresSharedAdjustmentKey } from './futuresWalletPresentation.js'

describe('futuresSharedAdjustmentKey', () => {
  it('stays compact and stable across lane-sized membership changes', () => {
    const scope = {
      kind: 'accountShared',
      ownerId: 'account',
      symbol: null,
      leg: null,
    }
    const laneSizedEntryIds = Array.from({ length: 24_000 }, (unused, index) => (
      `income:credit-${index}`
    ))
    const before = futuresSharedAdjustmentKey({ ...scope, entryIds: laneSizedEntryIds })
    const after = futuresSharedAdjustmentKey({
      ...scope,
      entryIds: [...laneSizedEntryIds].reverse().concat('income:new-credit'),
    })

    expect(after).toBe(before)
    expect(after.length).toBeLessThan(128)
  })

  it('does not collide across simultaneous presentation scopes', () => {
    const scopes = [
      { kind: 'contractShared', ownerId: 'BTCUSDT', symbol: 'BTCUSDT', leg: null },
      { kind: 'legOwned', ownerId: 'BTCUSDT:LONG', symbol: 'BTCUSDT', leg: 'LONG' },
      { kind: 'unattributedShared', ownerId: 'BTCUSDT', symbol: 'BTCUSDT', leg: null },
      { kind: 'accountShared', ownerId: 'account', symbol: null, leg: null },
    ]

    expect(new Set(scopes.map(futuresSharedAdjustmentKey)).size).toBe(scopes.length)
  })
})
