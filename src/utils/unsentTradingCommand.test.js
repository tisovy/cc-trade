import { describe, expect, it } from 'vitest'
import { TRADING_COMMAND_ACTIONS } from './tradingCommands.js'
import {
  createUnsentCommandStore,
  isMutatingTradingCommand,
} from './unsentTradingCommand.js'

const placement = clientOrderId => ({
  action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
  clientOrderId,
  symbol: 'BTCUSDT',
})

describe('unsent trading command store', () => {
  it('holds a mutating command that never reached the backend', () => {
    const store = createUnsentCommandStore()
    const command = placement('intent-1')

    store.remember(command)

    // The same object, so the identity of the first attempt is resent verbatim.
    expect(store.peek()).toBe(command)
  })

  it('forgets the command once one reaches the backend', () => {
    const store = createUnsentCommandStore()
    store.remember(placement('intent-1'))

    store.clear()

    expect(store.peek()).toBeNull()
  })

  it('keeps only the last unsent command', () => {
    const store = createUnsentCommandStore()
    store.remember(placement('intent-1'))
    store.remember(placement('intent-2'))

    expect(store.peek().clientOrderId).toBe('intent-2')
  })

  it('does not let a failed read masquerade as an unsent order', () => {
    const store = createUnsentCommandStore()
    store.remember(placement('intent-1'))

    store.remember({ action: TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH, symbol: 'BTCUSDT' })
    store.remember({ action: TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY, symbol: 'BTCUSDT' })

    expect(store.peek().clientOrderId).toBe('intent-1')
  })

  it('takes the command exactly once', () => {
    const store = createUnsentCommandStore()
    store.remember(placement('intent-1'))

    expect(store.take().clientOrderId).toBe('intent-1')
    expect(store.take()).toBeNull()
  })

  it('classifies which commands are worth holding', () => {
    expect(isMutatingTradingCommand(placement('a'))).toBe(true)
    expect(isMutatingTradingCommand({ action: TRADING_COMMAND_ACTIONS.CANCEL_ORDER })).toBe(true)
    expect(isMutatingTradingCommand({ action: TRADING_COMMAND_ACTIONS.REPLACE_ORDER })).toBe(true)
    expect(isMutatingTradingCommand({ action: TRADING_COMMAND_ACTIONS.CANCEL_ALL })).toBe(true)
    expect(isMutatingTradingCommand({ action: TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH })).toBe(false)
    expect(isMutatingTradingCommand({ action: TRADING_COMMAND_ACTIONS.SET_TRADING_PAUSED })).toBe(false)
    expect(isMutatingTradingCommand(null)).toBe(false)
  })
})
