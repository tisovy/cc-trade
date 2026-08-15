import { TRADING_COMMAND_ACTIONS } from './tradingCommands.js'

// A trading command carries the identity its operator intent was minted with.
// When the command never reaches the backend — a closed socket, a throwing
// send — the intent has not been acted on, so it may be sent again. It must be
// sent again *as the same object*: rebuilding it mints a new client order id,
// and the exchange then has no way to recognise the two attempts as one intent
// and deduplicate them.
//
// Only mutating commands are held. A refresh or a history read has no identity
// worth preserving, and remembering one would mask a genuinely unsent order
// behind a failed read.
export const MUTATING_TRADING_ACTIONS = Object.freeze(new Set([
  TRADING_COMMAND_ACTIONS.PLACE_ORDER,
  TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
  TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
  TRADING_COMMAND_ACTIONS.CANCEL_ALL,
]))

export const isMutatingTradingCommand = command => (
  MUTATING_TRADING_ACTIONS.has(command?.action)
)

/**
 * Holds at most one command that did not reach the backend.
 *
 * At most one, because a desk that could not send its last order has no
 * business queueing a backlog of them: the operator resends the one that
 * failed, or abandons it.
 */
export const createUnsentCommandStore = () => {
  let pending = null
  return Object.freeze({
    remember(command) {
      if (isMutatingTradingCommand(command)) pending = command
      return command
    },
    clear() {
      pending = null
    },
    peek() {
      return pending
    },
    take() {
      const command = pending
      pending = null
      return command
    },
  })
}
