import { describe, expect, it } from 'vitest'
import {
  FUTURES_DEFAULT_LEVERAGE,
  FUTURES_DEFAULT_MARGIN_TYPE,
  planFuturesContractDefaults,
} from './futuresContractDefaults.js'

const config = (overrides = {}) => ({
  symbol: 'EPICUSDT',
  leverage: 20,
  maxLeverage: 75,
  marginType: 'CROSSED',
  maxNotionalValue: '500000',
  ...overrides,
})

const plan = (overrides = {}) => planFuturesContractDefaults({
  symbol: 'EPICUSDT',
  config: config(),
  positions: [],
  positionsRead: true,
  ...overrides,
})

describe('the default a futures contract is held at', () => {
  it('is 2x isolated', () => {
    expect(FUTURES_DEFAULT_LEVERAGE).toBe(2)
    expect(FUTURES_DEFAULT_MARGIN_TYPE).toBe('ISOLATED')
  })

  // The case that produced this: a contract the desk had never traded opened at
  // the account-wide 20x, and nothing on the way to the send button said so.
  it('brings a flat contract down to 2x isolated', () => {
    expect(plan()).toEqual({ leverage: 2, marginType: 'ISOLATED' })
  })

  it('leaves a contract already at or below the default alone', () => {
    expect(plan({ config: config({ leverage: 2, marginType: 'ISOLATED' }) }))
      .toEqual({ leverage: null, marginType: null })
    // 1x is safer than the default, and raising a multiple is a decision the
    // operator makes, never one the desk makes for them.
    expect(plan({ config: config({ leverage: 1, marginType: 'ISOLATED' }) }))
      .toEqual({ leverage: null, marginType: null })
  })

  // Changing the leverage of an open position moves the price it is closed at.
  // That is the operator's own decision, made from the leverage panel, which
  // states the risk — never a default applied behind them.
  it('never touches a contract carrying a position', () => {
    expect(plan({
      positions: [{ symbol: 'EPICUSDT', quantity: '400', positionSide: 'LONG' }],
    })).toEqual({ leverage: null, marginType: null })

    // A row that closed to zero is not a position.
    expect(plan({
      positions: [{ symbol: 'EPICUSDT', quantity: '0', positionSide: 'BOTH' }],
    })).toEqual({ leverage: 2, marginType: 'ISOLATED' })

    // Somebody else's contract does not protect this one.
    expect(plan({
      positions: [{ symbol: 'BTCUSDT', quantity: '0.5', positionSide: 'LONG' }],
    })).toEqual({ leverage: 2, marginType: 'ISOLATED' })
  })

  // An account that has not answered yet is not an account that is flat: acting
  // on an unread position list is how a default lands on an open trade.
  it('says nothing until the positions have been read', () => {
    expect(plan({ positionsRead: false })).toEqual({ leverage: null, marginType: null })
  })

  // Binance refuses a margin-mode change while an order rests on the contract,
  // and a refusal nobody asked for is a red card the operator has to read and
  // dismiss. The multiple still moves — the exchange allows that one.
  it('leaves the mode of a contract with a working order alone, but not its multiple', () => {
    expect(plan({ openOrders: [{ symbol: 'EPICUSDT', orderId: 7, status: 'NEW' }] }))
      .toEqual({ leverage: 2, marginType: null })

    // Another contract's order does not hold this one back.
    expect(plan({ openOrders: [{ symbol: 'BTCUSDT', orderId: 8, status: 'NEW' }] }))
      .toEqual({ leverage: 2, marginType: 'ISOLATED' })
  })

  it('says nothing about a contract the configuration is not for', () => {
    expect(plan({ config: config({ symbol: 'BTCUSDT' }) }))
      .toEqual({ leverage: null, marginType: null })
    expect(plan({ config: null })).toEqual({ leverage: null, marginType: null })
    expect(planFuturesContractDefaults()).toEqual({ leverage: null, marginType: null })
  })

  // The same bound the leverage control obeys: a contract's own bracket ceiling
  // is the highest it can be carried at, default or not.
  it('is bounded by the contract ceiling', () => {
    expect(plan({ config: config({ leverage: 1, maxLeverage: 1, marginType: 'ISOLATED' }) }))
      .toEqual({ leverage: null, marginType: null })
  })

  it('changes only the mode where the multiple is already low enough', () => {
    expect(plan({ config: config({ leverage: 2, marginType: 'CROSSED' }) }))
      .toEqual({ leverage: null, marginType: 'ISOLATED' })
  })

  // Nothing is inferred from a reading the exchange did not give: a leverage or
  // a mode reported as absent is left absent rather than written over.
  it('acts only on what the exchange actually reported', () => {
    expect(plan({ config: config({ leverage: null, marginType: null }) }))
      .toEqual({ leverage: null, marginType: null })
  })
})
