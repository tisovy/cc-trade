import { describe, expect, it } from 'vitest'
import {
  FUTURES_DEFAULT_LEVERAGE,
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
  it('is 1x', () => {
    expect(FUTURES_DEFAULT_LEVERAGE).toBe(1)
  })

  // The case that produced this: a contract the desk had never traded opened at
  // the account-wide 20x, and nothing on the way to the send button said so.
  it('brings a flat contract down to 1x', () => {
    expect(plan()).toEqual({ leverage: 1 })
  })

  // The whole of the decision, and the name of the one field in it. A plan that
  // still carried a margin mode would be a plan that could still send one — the
  // second half of this module was deleted, not disabled.
  it('decides the multiple and nothing else', () => {
    expect(Object.keys(plan())).toEqual(['leverage'])
    expect(Object.keys(plan({ positionsRead: false }))).toEqual(['leverage'])
  })

  // The operator's own case: cross was set in Binance's own app, on a contract
  // holding nothing, and the desk wrote ISOLATED back over it on the next start
  // — once per contract per session, so every restart did it again.
  it('leaves a contract the operator set to cross in cross', () => {
    expect(plan({ config: config({ leverage: 1, marginType: 'CROSSED' }) }))
      .toEqual({ leverage: null })
    // Including where the multiple does have work to do: lowering 20x to 1x is
    // not a licence to change what stands behind it.
    expect(plan({ config: config({ leverage: 20, marginType: 'CROSSED' }) }))
      .toEqual({ leverage: 1 })
  })

  it('leaves a contract already at the default alone', () => {
    expect(plan({ config: config({ leverage: 1, marginType: 'ISOLATED' }) }))
      .toEqual({ leverage: null })
  })

  // Changing the leverage of an open position moves the price it is closed at.
  // That is the operator's own decision, made from the leverage panel, which
  // states the risk — never a default applied behind them.
  it('never touches a contract carrying a position', () => {
    expect(plan({
      positions: [{ symbol: 'EPICUSDT', quantity: '400', positionSide: 'LONG' }],
    })).toEqual({ leverage: null })

    // A row that closed to zero is not a position.
    expect(plan({
      positions: [{ symbol: 'EPICUSDT', quantity: '0', positionSide: 'BOTH' }],
    })).toEqual({ leverage: 1 })

    // Somebody else's contract does not protect this one.
    expect(plan({
      positions: [{ symbol: 'BTCUSDT', quantity: '0.5', positionSide: 'LONG' }],
    })).toEqual({ leverage: 1 })
  })

  // An account that has not answered yet is not an account that is flat: acting
  // on an unread position list is how a default lands on an open trade.
  it('says nothing until the positions have been read', () => {
    expect(plan({ positionsRead: false })).toEqual({ leverage: null })
  })

  // Binance allows a leverage change while an order rests — it is only the
  // margin mode it refuses, and the desk no longer sends one. So a resting
  // order holds nothing back here.
  it('lowers the multiple of a contract with a working order', () => {
    expect(plan({ openOrders: [{ symbol: 'EPICUSDT', orderId: 7, status: 'NEW' }] }))
      .toEqual({ leverage: 1 })
  })

  it('says nothing about a contract the configuration is not for', () => {
    expect(plan({ config: config({ symbol: 'BTCUSDT' }) })).toEqual({ leverage: null })
    expect(plan({ config: null })).toEqual({ leverage: null })
    expect(planFuturesContractDefaults()).toEqual({ leverage: null })
  })

  // The same bound the leverage control obeys: a contract's own bracket ceiling
  // is the highest it can be carried at, default or not.
  it('is bounded by the contract ceiling', () => {
    expect(plan({ config: config({ leverage: 1, maxLeverage: 1 }) })).toEqual({ leverage: null })
  })

  // Nothing is inferred from a reading the exchange did not give: a leverage
  // reported as absent is left absent rather than written over.
  it('acts only on what the exchange actually reported', () => {
    expect(plan({ config: config({ leverage: null, marginType: null }) }))
      .toEqual({ leverage: null })
  })
})
