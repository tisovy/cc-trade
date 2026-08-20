// The order a drag owes the book.
//
// Picking a working order up cancels it, so from that moment the desk owes the
// operator an order: the one they are dragging. This module derives that order —
// what is left of it, at the price it is being aimed at — and refuses it here,
// before anything is sent, for the same reasons the placement path refuses any
// other order: the local ceiling, an unusable price, nothing left to place.
//
// It is deliberately the *placement*'s arithmetic, not the amendment's. An
// amendment carried the original quantity because Binance re-states the whole
// order; a placement carries what is actually still working, so a partly filled
// order that is lifted comes back the size it was, not the size it started.

import {
  FUTURES_RISK_REASONS,
  calculateFuturesOrderNotional,
  evaluateFuturesOrderRisk,
  fallsBelowFuturesMinimumNotional,
  normalizeFuturesDraftPrice,
  remainingFuturesQuantity,
} from './futuresOrderDraft.js'

const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/

export const FUTURES_DRAG_REASONS = Object.freeze({
  NOT_DRAGGABLE: 'NOT_DRAGGABLE',
  NO_REMAINING_QUANTITY: 'NO_REMAINING_QUANTITY',
  UNUSABLE_PRICE: 'UNUSABLE_PRICE',
  BELOW_MINIMUM_NOTIONAL: 'BELOW_MINIMUM_NOTIONAL',
  ABOVE_ORDER_CAP: FUTURES_RISK_REASONS.ABOVE_ORDER_CAP,
  UNPRICEABLE_ORDER: FUTURES_RISK_REASONS.UNPRICEABLE_ORDER,
})

// Exchange decimals arrive as strings from the account read and as numbers from
// hand-written state. An exponent form is unreadable rather than rounded.
const decimalText = (value) => {
  if (typeof value === 'string') return value.trim()
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const text = String(value)
  return text.includes('e') || text.includes('E') ? null : text
}

const isPositiveDecimal = text => (
  typeof text === 'string'
  && text.length > 0
  && text.length <= 64
  && CANONICAL_DECIMAL.test(text)
  && Number(text) > 0
)

const refuse = (reason, extra = {}) => Object.freeze({ ok: false, reason, ...extra })

/**
 * Whether this order's price is the desk's to move: a regular order resting
 * at its own price, guarding no trigger. Every mover makes the same promise —
 * the drag lifts by cancelling and placing a plain LIMIT, the editor submits
 * to Binance's amend endpoint, which re-states LIMIT orders only. For an
 * order resting at no price there is nothing to re-price, and for one
 * guarding a trigger the plain-LIMIT replacement would discard the trigger
 * and leave a naked limit where a guard stood. One predicate, asked by the
 * grip and editor doorways that offer the gesture, the guard that begins it,
 * and the replacement that would send it.
 */
export const futuresOrderPriceIsMovable = order => (
  (order?.orderKind ?? 'REGULAR') === 'REGULAR'
  && Number(order?.price) > 0
  && !(Number(order?.triggerPrice) > 0)
)

/**
 * What a drag would place, and why it could not.
 *
 * `positionSide` is the exchange's own leg for the order, never a derived one:
 * a one-way account reports BOTH, and sending it the LONG that a label was
 * derived from is refused by Binance.
 */
export const describeFuturesDragReplacement = ({
  order,
  price,
  tickSize = null,
  minNotionalUsdt = null,
  maxOrderNotionalUsdt = null,
} = {}) => {
  if (!order || !futuresOrderPriceIsMovable(order)) {
    return refuse(FUTURES_DRAG_REASONS.NOT_DRAGGABLE)
  }
  const originalQuantity = decimalText(order.origQty)
  if (!isPositiveDecimal(originalQuantity)) {
    return refuse(FUTURES_DRAG_REASONS.NO_REMAINING_QUANTITY)
  }
  const executed = decimalText(order.z ?? order.executedQty)
  const quantity = isPositiveDecimal(executed)
    ? remainingFuturesQuantity({ openQuantity: originalQuantity, quantity: executed })
    : originalQuantity
  if (!isPositiveDecimal(quantity)) {
    return refuse(FUTURES_DRAG_REASONS.NO_REMAINING_QUANTITY)
  }
  const target = decimalText(price)
  // The contract's tick when it is known; the price as picked when it is not —
  // Binance applies the filter itself either way, and refusing here on a
  // missing filter would make an unloaded catalogue look like a bad price.
  const normalizedPrice = normalizeFuturesDraftPrice(target, tickSize)
    ?? (isPositiveDecimal(target) ? target : null)
  if (normalizedPrice === null) return refuse(FUTURES_DRAG_REASONS.UNUSABLE_PRICE)

  // A drag lowers the price and leaves the quantity where it was, so it lowers
  // the notional — and the floor under an order is a bound this desk already
  // holds and already enforces on the path that places one. Asked here, it
  // refuses the move; unasked, it was the exchange that refused, after the
  // cancellation that lifted the order had already been confirmed.
  const dragNotionalUsdt = calculateFuturesOrderNotional(quantity, normalizedPrice)
  if (fallsBelowFuturesMinimumNotional(dragNotionalUsdt, minNotionalUsdt)) {
    return refuse(FUTURES_DRAG_REASONS.BELOW_MINIMUM_NOTIONAL, {
      notionalUsdt: dragNotionalUsdt,
      minNotionalUsdt,
    })
  }

  const reduceOnly = order.reduceOnly === true
  const risk = evaluateFuturesOrderRisk({
    quantity,
    price: normalizedPrice,
    maxOrderNotionalUsdt,
    exposureIncreasing: !reduceOnly,
  })
  if (!risk.ok) {
    return refuse(risk.reason, { notionalUsdt: risk.notionalUsdt, capUsdt: risk.capUsdt })
  }

  const positionSide = order.exchangePositionSide ?? order.positionSide ?? null
  return Object.freeze({
    ok: true,
    symbol: order.symbol,
    side: order.side,
    orderType: 'LIMIT',
    price: normalizedPrice,
    quantity,
    reduceOnly,
    ...(positionSide === null ? {} : { positionSide }),
    notionalUsdt: risk.notionalUsdt,
  })
}

/**
 * Why the desk will not place it, in the operator's terms.
 *
 * The order is already off the book when most of these are read, so each one
 * says what is wrong rather than what to click: the control that places it
 * again sits beside the message.
 */
export const describeFuturesDragRefusal = (replacement) => {
  switch (replacement?.reason) {
    case FUTURES_DRAG_REASONS.NOT_DRAGGABLE:
      return 'Only a regular order resting at its own price, with no trigger, can be moved by dragging.'
    case FUTURES_DRAG_REASONS.NO_REMAINING_QUANTITY:
      return 'The order has no remaining quantity to place.'
    case FUTURES_DRAG_REASONS.UNUSABLE_PRICE:
      return 'The price the order was dropped at cannot be used.'
    // The words the ticket already refuses a placement in, so one order refusal
    // does not read differently from another — and where the order could not be
    // valued at all, a size the desk does not have is not stated as if it did.
    case FUTURES_DRAG_REASONS.BELOW_MINIMUM_NOTIONAL:
      return replacement.notionalUsdt === null
        ? `The order could not be valued, so the Binance minimum notional of ${replacement.minNotionalUsdt} USDT could not be checked.`
        : `The order would be ${replacement.notionalUsdt} USDT, below the Binance minimum notional of ${replacement.minNotionalUsdt} USDT.`
    case FUTURES_DRAG_REASONS.ABOVE_ORDER_CAP:
      return `The order would be ${replacement.notionalUsdt} USDT, above the local ${replacement.capUsdt} USDT limit.`
    case FUTURES_DRAG_REASONS.UNPRICEABLE_ORDER:
      return 'The order could not be valued, so the local order limit could not be checked.'
    default:
      return 'The order could not be placed.'
  }
}

export default describeFuturesDragReplacement
