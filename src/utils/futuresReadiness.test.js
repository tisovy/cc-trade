import { describe, expect, it } from 'vitest'
import { deriveFuturesReadiness } from './futuresReadiness'

const readyInput = {
  startupReady: true,
  connected: true,
  tradingPaused: false,
  selectedContractTradable: true,
  hasFilters: true,
  balanceResource: {
    status: 'ready',
    data: { USDT: { available: '100' } },
    lastSuccessfulAt: 100,
  },
  availableUsdt: '100',
  draftRequired: true,
  draftValid: true,
  amountWithinBudget: true,
  notionalUsdt: '25',
}

describe('deriveFuturesReadiness', () => {
  it('returns READY only when every disclosed gate passes', () => {
    expect(deriveFuturesReadiness(readyInput)).toMatchObject({
      code: 'READY',
      label: 'READY',
      ready: true,
    })
  })

  it.each([
    [{ startupReady: false }, 'CONFIGURATION'],
    [{ connected: false }, 'TRANSPORT'],
    [{ tradingPaused: true }, 'PAUSED'],
    [{ selectedContractTradable: false }, 'CONTRACT'],
    [{ hasFilters: false }, 'METADATA'],
    [{ balanceResource: { status: 'loading' } }, 'ACCOUNT_LOADING'],
    [{ balanceResource: { status: 'error', error: { message: 'permission' } } }, 'ACCOUNT_ERROR'],
    [{ balanceResource: { status: 'stale', error: { message: 'network' } } }, 'ACCOUNT_STALE'],
    [{ availableUsdt: '0' }, 'INSUFFICIENT_FUNDS'],
    [{ draftValid: false }, 'DRAFT'],
    [{ notionalUsdt: '51', maxOrderNotionalUsdt: '50' }, 'ORDER_CAP'],
  ])('returns %s gate deterministically', (override, code) => {
    expect(deriveFuturesReadiness({ ...readyInput, ...override })).toMatchObject({
      code,
      ready: false,
    })
  })

  // The desk re-reads the account, and every read marks the balance `loading`
  // while it runs. Treating that as "unknown" withdrew readiness for the length
  // of every read — with a read behind every command, the operator's next order
  // was refused for a number that had not changed and was not in doubt. A first
  // read, which has nothing behind it, still blocks: that is the case above.
  it('stays ready while a balance it already holds is being read again', () => {
    expect(deriveFuturesReadiness({
      ...readyInput,
      balanceResource: {
        status: 'loading',
        data: { USDT: { available: '100' } },
        lastSuccessfulAt: 100,
      },
    })).toMatchObject({ code: 'READY', ready: true })
  })

  // Neither of the other two withheld readings becomes usable by being re-read:
  // stale says the connection that is up now has not confirmed it, error that
  // the last attempt failed.
  it.each(['stale', 'error'])('does not trade on a %s reading being read again', (status) => {
    expect(deriveFuturesReadiness({
      ...readyInput,
      balanceResource: { status, error: { message: 'x' }, lastSuccessfulAt: 100 },
    })).toMatchObject({ ready: false })
  })

  // A reduce-only exit releases margin instead of consuming it, and under any
  // leverage the position outvalues the balance left over. Budgeting the exit
  // would lock the operator out of closing at the worst possible moment.
  it('budgets an entry against the balance but never an exit', () => {
    const overBudget = { ...readyInput, amountWithinBudget: false, notionalUsdt: '900' }

    expect(deriveFuturesReadiness({ ...overBudget, exposureIncreasing: true })).toMatchObject({
      code: 'DRAFT',
      ready: false,
      reason: 'Order size exceeds the confirmed available USDT balance.',
    })
    expect(deriveFuturesReadiness({ ...overBudget, exposureIncreasing: false })).toMatchObject({
      code: 'READY',
      ready: true,
    })
  })

  // An exit is exempt from the budget, not from being a valid order.
  it('still refuses an exit whose draft is invalid', () => {
    expect(deriveFuturesReadiness({
      ...readyInput,
      exposureIncreasing: false,
      draftValid: false,
    })).toMatchObject({
      code: 'DRAFT',
      ready: false,
      reason: 'Pick a valid limit price and order size.',
    })
  })
})
