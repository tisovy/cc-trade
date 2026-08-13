import { describe, expect, it } from 'vitest'
import {
  futuresMarginCallKey,
  pruneFuturesMarginCalls,
  readFuturesMarginCall,
} from './futuresMarginCall.js'

describe('futures margin calls', () => {
  // One contract carries two positions on a hedged account, and the exchange
  // warns about them separately.
  it('keys a warning by contract and side', () => {
    expect(futuresMarginCallKey({ symbol: 'ethusdt', positionSide: 'LONG' })).toBe('ETHUSDT:LONG')
    expect(futuresMarginCallKey({ symbol: 'ETHUSDT' })).toBe('ETHUSDT:BOTH')
    expect(futuresMarginCallKey({ positionSide: 'LONG' })).toBeNull()
  })

  it('reads the positions a margin call names, and what stood behind them', () => {
    const calls = readFuturesMarginCall({
      positions: [{
        symbol: 'ETHUSDT',
        positionSide: 'LONG',
        quantity: '1.327',
        isolatedWallet: '0',
        markPrice: '187.17127',
        maintenanceMargin: '1.614445',
      }],
    }, 4_000)

    expect(calls['ETHUSDT:LONG']).toEqual({
      symbol: 'ETHUSDT',
      positionSide: 'LONG',
      at: 4_000,
      quantity: 1.327,
      isolatedWallet: 0,
      maintenanceMargin: 1.614445,
      markPrice: 187.17127,
    })
    expect(readFuturesMarginCall({ positions: [] })).toBeNull()
    expect(readFuturesMarginCall(null)).toBeNull()
  })

  // The exchange sends no event for the risk passing, so the only honest grounds
  // for taking a warning down are the exchange's own statements about the
  // position itself.
  it('takes a warning down when the position it names is gone', () => {
    const calls = readFuturesMarginCall({
      positions: [{ symbol: 'ETHUSDT', positionSide: 'LONG', quantity: '1.327', isolatedWallet: '5' }],
    }, 1_000)

    expect(pruneFuturesMarginCalls(calls, [])).toEqual({})
    expect(pruneFuturesMarginCalls(calls, [
      { symbol: 'ETHUSDT', positionSide: 'LONG', quantity: '0' },
    ])).toEqual({})
  })

  it('takes a warning down when the position gets smaller or better backed', () => {
    const calls = readFuturesMarginCall({
      positions: [{ symbol: 'ETHUSDT', positionSide: 'LONG', quantity: '1.327', isolatedWallet: '5' }],
    }, 1_000)

    expect(pruneFuturesMarginCalls(calls, [
      { symbol: 'ETHUSDT', positionSide: 'LONG', quantity: '0.5', isolatedWallet: '5' },
    ])).toEqual({})
    expect(pruneFuturesMarginCalls(calls, [
      { symbol: 'ETHUSDT', positionSide: 'LONG', quantity: '1.327', isolatedWallet: '9' },
    ])).toEqual({})
  })

  // A warning that expires on a timer is a warning that disappears while the
  // danger is still there. Nothing about an unchanged position takes it down.
  it('leaves a warning standing while the position is unchanged or larger', () => {
    const calls = readFuturesMarginCall({
      positions: [{ symbol: 'ETHUSDT', positionSide: 'LONG', quantity: '1.327', isolatedWallet: '5' }],
    }, 1_000)

    expect(pruneFuturesMarginCalls(calls, [
      { symbol: 'ETHUSDT', positionSide: 'LONG', quantity: '1.327', isolatedWallet: '5' },
    ])).toBe(calls)
    expect(pruneFuturesMarginCalls(calls, [
      { symbol: 'ETHUSDT', positionSide: 'LONG', quantity: '2', isolatedWallet: '5' },
    ])).toBe(calls)
    // A different position on the same contract is not this one.
    expect(pruneFuturesMarginCalls(calls, [
      { symbol: 'ETHUSDT', positionSide: 'SHORT', quantity: '3', isolatedWallet: '5' },
    ])).toEqual({})
  })
})
