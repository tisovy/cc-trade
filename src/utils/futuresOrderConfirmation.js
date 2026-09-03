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
  if (value === null
    || value === undefined
    || (typeof value === 'string' && value.trim() === '')) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const HEADLINE_BY_ACTION = Object.freeze({
  LONG_ENTRY: 'OPEN LONG',
  LONG_EXIT: 'CLOSE LONG',
  SHORT_ENTRY: 'OPEN SHORT',
  SHORT_EXIT: 'CLOSE SHORT',
})

// A hedge book can be net flat while both named legs are open. An exit is
// therefore bounded by the leg it names, never by the net exposure shown on the
// confirmation. BOTH rows use their signed one-way quantity to recover that
// semantic leg.
const futuresPositionLegQuantity = (positions, symbol, semanticSide) => {
  if (!Array.isArray(positions)) return null
  let total = 0
  for (const position of positions) {
    if (position?.symbol !== symbol) continue
    const declaredSide = String(position?.positionSide ?? '').toUpperCase()
    const quantity = toFiniteNumber(position?.quantity)
    if (quantity === null) {
      if (declaredSide === semanticSide || !['LONG', 'SHORT'].includes(declaredSide)) {
        return null
      }
      continue
    }
    const heldSide = declaredSide === 'LONG' || declaredSide === 'SHORT'
      ? declaredSide
      : quantity > 0 ? 'LONG' : quantity < 0 ? 'SHORT' : null
    if (heldSide === semanticSide) total += Math.abs(quantity)
  }
  return total
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
  marginMode = null,
  positions = [],
  priceReading = null,
} = {}) => {
  if (!action) return null
  const orderQuantity = toFiniteNumber(quantity)
  const orderPrice = toFiniteNumber(price)
  const before = netFuturesPositionQuantity(positions, symbol)
  const isExit = action.positionEffect === 'EXIT'
  const delta = orderQuantity === null
    ? null
    : (action.side === 'BUY' ? orderQuantity : -orderQuantity)
  const targetQuantity = isExit
    ? futuresPositionLegQuantity(positions, symbol, action.positionSide)
    : null
  const appliedDelta = !isExit
    ? delta
    : delta === null || targetQuantity === null
      ? null
      : Math.sign(delta) * Math.min(Math.abs(delta), targetQuantity)
  const after = before === null || appliedDelta === null
    ? null
    : before + appliedDelta

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
    } else if (isExit && targetQuantity === 0) {
      warning = {
        code: 'NOTHING_TO_CLOSE',
        message: 'There is no position to close — the exchange will reject a reduce-only order.',
      }
    } else if (isExit && targetQuantity !== null && Math.abs(delta) > targetQuantity) {
      // The desk proves a reduce-only order against the leg it holds and
      // refuses one that exceeds it — nothing is cut to fit. Said here, with
      // the leg, before the confirmation rather than after the refusal.
      warning = {
        code: 'LARGER_THAN_POSITION',
        message: `Larger than the open ${action.positionSide} leg (${targetQuantity}) — the desk will not send it. Size to the leg.`,
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
    // The leg an exit is measured against, in contracts, as the desk holds it
    // now — null for an entry or when no leg is held.
    openLegQuantity: isExit ? targetQuantity : null,
    tone: action.side === 'BUY' ? 'buy' : 'sell',
    symbol,
    price,
    quantity,
    notionalUsdt,
    // Where this price was taken from, when it was taken off a surface that
    // could not vouch for it. A price the operator typed carries none, and the
    // panel states nothing about its age — there is nothing to state.
    priceReading: priceReading?.live === false ? priceReading : null,
    // The terms the position will be carried at. A whole multiple the exchange
    // stated, or null: a leverage nobody reported must not become a number here
    // of all places, and an operator reading "1×" where the contract is at 20×
    // is worse off than one reading nothing.
    leverage: Number.isSafeInteger(leverage) && leverage >= 1 ? leverage : null,
    // And what stands behind the multiple. Read on the same terms: the mode the
    // exchange last reported, or null. The two answer one question between them
    // — what a losing entry can cost — and a mode assumed here would answer it
    // wrongly in the direction that costs the whole wallet.
    marginMode: marginMode === 'ISOLATED' || marginMode === 'CROSSED' ? marginMode : null,
    positionBefore: before,
    positionAfter: after,
    positionBeforeUsdt: valueUsdt(before),
    positionAfterUsdt: valueUsdt(after),
    warning,
  })
}
