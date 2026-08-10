// A futures gesture cannot be read back from the order it produces.
//
// "Exit LONG" (Alt + right) and "Enter SHORT" (Ctrl + right) are both a SELL, at
// the same price, for the same size: the payloads differ only by reduceOnly. An
// operator who slipped a modifier sees an order that looks exactly like the one
// they meant to place, and finds out only when the position moves the wrong way
// — believing they went flat while they are in fact short.
//
// So a confirmation that repeats the side ("SELL 1250 USDT") confirms nothing.
// The only thing that separates the two is what happens to the position, which
// is what this module states: an outright headline, and the net exposure before
// and after. Everything here is presentation over already-validated numbers; it
// never decides whether an order may be sent.

const toFiniteNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const HEADLINE_BY_ACTION = Object.freeze({
  LONG_ENTRY: 'OPEN LONG',
  LONG_EXIT: 'CLOSE LONG',
  SHORT_ENTRY: 'OPEN SHORT',
  SHORT_EXIT: 'CLOSE SHORT',
})

// Reduce-only orders cannot cross zero: the exchange trims them to whatever the
// position still holds, so the projection must trim them too rather than show a
// flip that can never happen.
const applyExitDelta = (before, delta) => {
  const after = before + delta
  if (before === 0) return 0
  return (before > 0) === (after > 0) ? after : 0
}

export const netFuturesPositionQuantity = (positions, symbol) => {
  if (!Array.isArray(positions)) return null
  const rows = positions.filter(position => position?.symbol === symbol)
  if (rows.length === 0) return 0
  let net = 0
  for (const position of rows) {
    const quantity = toFiniteNumber(position?.quantity)
    if (quantity === null) return null
    // Hedge accounts report both legs positive and name the side; one-way
    // accounts sign the quantity. Reading the side first covers both.
    const declaredSide = String(position?.positionSide ?? '').toUpperCase()
    const sign = declaredSide === 'SHORT' ? -1 : declaredSide === 'LONG' ? 1 : Math.sign(quantity) || 1
    net += sign * Math.abs(quantity)
  }
  return net
}

export const describeFuturesOrderConfirmation = ({
  action,
  symbol,
  price,
  quantity,
  notionalUsdt = null,
  leverage = null,
  positions = [],
} = {}) => {
  if (!action) return null
  const orderQuantity = toFiniteNumber(quantity)
  const orderPrice = toFiniteNumber(price)
  const before = netFuturesPositionQuantity(positions, symbol)
  const isExit = action.positionEffect === 'EXIT'
  const delta = orderQuantity === null
    ? null
    : (action.side === 'BUY' ? orderQuantity : -orderQuantity)
  const after = before === null || delta === null
    ? null
    : isExit ? applyExitDelta(before, delta) : before + delta

  // Only the cases an operator can actually be wrong about, stated as what the
  // order will do — not as advice about what they should have meant.
  let warning = null
  if (before !== null && delta !== null) {
    if (!isExit && before !== 0 && (before > 0) !== (delta > 0)) {
      const held = before > 0 ? 'LONG' : 'SHORT'
      const opposite = before > 0 ? 'SHORT' : 'LONG'
      // Not reduce-only, so nothing stops it at zero: past the size of the
      // position it does not flatten the operator, it reverses them.
      warning = Math.abs(delta) > Math.abs(before)
        ? {
          code: 'FLIPS_POSITION',
          message: `This does NOT close your ${held} — it flips you ${opposite}.`,
        }
        : {
          code: 'OPPOSITE_ENTRY',
          message: `This does NOT close your ${held} — it opens an opposite position.`,
        }
    } else if (isExit && before === 0) {
      warning = {
        code: 'NOTHING_TO_CLOSE',
        message: 'There is no position to close — the exchange will reject a reduce-only order.',
      }
    } else if (isExit && Math.abs(delta) > Math.abs(before)) {
      warning = {
        code: 'LARGER_THAN_POSITION',
        message: 'Larger than the position — only what is open will be closed.',
      }
    }
  }

  const valueUsdt = value => (
    value === null || orderPrice === null ? null : value * orderPrice
  )

  return Object.freeze({
    key: action.key,
    headline: HEADLINE_BY_ACTION[action.key] ?? action.label,
    label: action.label,
    side: action.side,
    positionSide: action.positionSide,
    positionEffect: action.positionEffect,
    tone: action.side === 'BUY' ? 'buy' : 'sell',
    symbol,
    price,
    quantity,
    notionalUsdt,
    // The terms the position will be carried at. A whole multiple the exchange
    // stated, or null: a leverage nobody reported must not become a number here
    // of all places, and an operator reading "1×" where the contract is at 20×
    // is worse off than one reading nothing.
    leverage: Number.isSafeInteger(leverage) && leverage >= 1 ? leverage : null,
    positionBefore: before,
    positionAfter: after,
    positionBeforeUsdt: valueUsdt(before),
    positionAfterUsdt: valueUsdt(after),
    warning,
  })
}
