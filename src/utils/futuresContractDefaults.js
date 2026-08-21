// What a contract is held at when nobody has said otherwise.
//
// A contract the desk has never traded arrives carrying whatever Binance's
// account-wide setting left on it. Opening EPICUSDT for the first time and
// sending an entry at 20× is not a decision anyone made: it is an inherited
// number, on a desk where orders are sized in USDT and the multiple is read
// nowhere on the way to the send button. So the desk states its own default —
// 1× — and applies it to the contract in hand.
//
// The multiple only. The margin mode is not decided here and is not decided
// anywhere: the desk states which mode a contract is in and offers the control
// to change it, and the choice is the operator's. This module used to write
// ISOLATED over a contract the operator had set to cross in Binance's own app,
// once per contract per session, so a restart silently undid the choice — and
// because the exchange announces no margin mode on the stream, the desk could
// not even see what it had overwritten.
//
// This module only decides. It sends nothing, and every rule in it exists to
// keep the decision from touching money that is already at risk:
//
//   - It never raises. A contract at 1× stays at 1×: lowering an inherited 20×
//     removes risk nobody chose, raising a 1× adds risk nobody asked for.
//   - It never touches a contract carrying a position. The multiple decides what
//     margin the exchange requires against that position, so lowering it there
//     calls in margin on a trade that is already at risk — and on an isolated
//     contract Binance refuses the change outright (`-4161`).
//   - It says nothing until the positions have been read and that reading is
//     current. An account that has not answered yet — or that has not answered
//     since the connection dropped — is not an account known to be flat.

import { FUTURES_DEFAULT_LEVERAGE } from './tradingCommands.js'

export { FUTURES_DEFAULT_LEVERAGE }

const NOTHING = Object.freeze({ leverage: null })

const holdsPosition = (positions, symbol) => (
  Array.isArray(positions) && positions.some(position => (
    position?.symbol === symbol && Number(position?.quantity) !== 0
  ))
)

/**
 * What to send for one contract, or nothing.
 *
 * @param {object} options
 * @param {string} options.symbol contract the configuration belongs to
 * @param {object|null} options.config the configuration read from the exchange
 * @param {Array|null} options.positions the account's positions, as last read
 * @param {boolean} options.positionsRead whether that position read is current
 * @returns {{leverage: number|null}}
 */
export const planFuturesContractDefaults = ({
  symbol,
  config,
  positions,
  positionsRead = false,
} = {}) => {
  if (!symbol || !config || config.symbol !== symbol) return NOTHING
  // An unread account is not a flat account: without positions to check, a
  // leverage change could land on an open trade and call in margin against it.
  if (!positionsRead) return NOTHING
  if (holdsPosition(positions, symbol)) return NOTHING

  // Bounded by the contract's own ceiling, on the same terms as the leverage
  // control. 1× is below every ceiling Binance lists, so this bound cannot bite
  // today; it stays because the default is a number that can be changed and the
  // ceiling is the exchange's, not the desk's.
  const ceiling = Number.isSafeInteger(config.maxLeverage) && config.maxLeverage >= 1
    ? config.maxLeverage
    : null
  const target = ceiling === null
    ? FUTURES_DEFAULT_LEVERAGE
    : Math.min(FUTURES_DEFAULT_LEVERAGE, ceiling)
  const current = Number.isSafeInteger(config.leverage) && config.leverage >= 1
    ? config.leverage
    : null

  return Object.freeze({
    // Only downwards, and only against a multiple the exchange actually stated.
    leverage: current !== null && current > target ? target : null,
  })
}

export default planFuturesContractDefaults
