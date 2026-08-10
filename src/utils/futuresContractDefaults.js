// What a contract is held at when nobody has said otherwise.
//
// A contract the desk has never traded arrives carrying whatever Binance's
// account-wide setting left on it. Opening EPICUSDT for the first time and
// sending an entry at 20× is not a decision anyone made: it is an inherited
// number, on a desk where orders are sized in USDT and the multiple is read
// nowhere on the way to the send button. So the desk states its own default —
// 2×, isolated — and applies it to the contract in hand.
//
// This module only decides. It sends nothing, and every rule in it exists to
// keep the decision from touching money that is already at risk:
//
//   - It never raises. A contract at 1× stays at 1×: lowering an inherited 20×
//     removes risk nobody chose, raising a 1× adds risk nobody asked for.
//   - It never touches a contract carrying a position. Changing leverage there
//     moves the liquidation price of an open trade, and the exchange refuses a
//     margin-mode change outright.
//   - It leaves the margin mode of a contract with a working order alone.
//     Binance refuses that change while an order rests, and a refusal the
//     operator never asked for is a red card they have to read and dismiss.
//     The multiple still moves: the exchange allows that one.
//   - It says nothing until the positions have been read and that reading is
//     current. An account that has not answered yet — or that has not answered
//     since the connection dropped — is not an account known to be flat.

import {
  FUTURES_DEFAULT_LEVERAGE,
  FUTURES_DEFAULT_MARGIN_TYPE,
} from './tradingCommands.js'

export { FUTURES_DEFAULT_LEVERAGE, FUTURES_DEFAULT_MARGIN_TYPE }

const NOTHING = Object.freeze({ leverage: null, marginType: null })

const holdsPosition = (positions, symbol) => (
  Array.isArray(positions) && positions.some(position => (
    position?.symbol === symbol && Number(position?.quantity) !== 0
  ))
)

const holdsWorkingOrder = (openOrders, symbol) => (
  Array.isArray(openOrders) && openOrders.some(order => order?.symbol === symbol)
)

// Both spellings of cross are the exchange's own; only ISOLATED is the mode the
// default wants, so anything that is not already isolated is a candidate — and a
// mode the exchange has not reported is not a candidate at all, because the
// desk does not write over a reading it does not have.
const needsIsolated = marginType => (
  typeof marginType === 'string' && marginType.toUpperCase() !== 'ISOLATED'
)

/**
 * What to send for one contract, or nothing.
 *
 * @param {object} options
 * @param {string} options.symbol contract the configuration belongs to
 * @param {object|null} options.config the configuration read from the exchange
 * @param {Array|null} options.positions the account's positions, as last read
 * @param {Array|null} options.openOrders the account's working orders
 * @param {boolean} options.positionsRead whether that position read is current
 * @returns {{leverage: number|null, marginType: string|null}}
 */
export const planFuturesContractDefaults = ({
  symbol,
  config,
  positions,
  openOrders,
  positionsRead = false,
} = {}) => {
  if (!symbol || !config || config.symbol !== symbol) return NOTHING
  // An unread account is not a flat account: without positions to check, a
  // leverage change could land on an open trade and move its liquidation price.
  if (!positionsRead) return NOTHING
  if (holdsPosition(positions, symbol)) return NOTHING

  // Bounded by the contract's own ceiling, on the same terms as the leverage
  // control: a contract that cannot be carried at 2× is left where it is.
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
    marginType: needsIsolated(config.marginType) && !holdsWorkingOrder(openOrders, symbol)
      ? FUTURES_DEFAULT_MARGIN_TYPE
      : null,
  })
}

export default planFuturesContractDefaults
