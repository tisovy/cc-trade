import { useCallback, useRef, useState } from 'react'
import { FUTURES_COMMAND_OUTCOME } from '../utils/futuresCommandOutcome.js'
import {
  describeFuturesDragRefusal,
  describeFuturesDragReplacement,
} from '../utils/futuresOrderDrag.js'

// The obligation a drag creates, and the three ways it ends.
//
// Picking a working order up cancels it. From the moment the exchange confirms
// that cancellation the desk owes the operator an order, and it discharges that
// debt in exactly one of three ways: by placing the replacement where the drag
// ended, by placing it again where the drag started when the drag is abandoned,
// or by saying — where it cannot be missed — that neither could be placed.
//
// The window between the two calls is real and is accepted deliberately (see
// the change proposal). What is not accepted is losing an order quietly: every
// path out of here either leaves an order working or raises an alert naming the
// order that is gone.

const PAUSED_ALERT = Object.freeze({
  tone: 'refused',
  title: 'Order NOT lifted',
  detail: 'Trading is paused — resume to move orders.',
  order: null,
  retryPrice: null,
})

const orderSummary = (order, replacement) => Object.freeze({
  symbol: order?.symbol ?? null,
  side: order?.side ?? null,
  price: replacement?.price ?? order?.price ?? null,
  quantity: replacement?.quantity ?? order?.origQty ?? null,
  reduceOnly: order?.reduceOnly === true,
})

export const useFuturesOrderDrag = ({
  tradingPaused = false,
  maxOrderNotionalUsdt = null,
  tickSize = null,
  cancelOrder,
  placeOrder,
} = {}) => {
  const [alert, setAlert] = useState(null)
  const [replacementInFlight, setReplacementInFlight] = useState(false)
  // What was lifted, and where from. Held in a ref because the pointer handlers
  // that discharge it are not re-created between the lift and the drop.
  const liftedRef = useRef(null)

  const dismiss = useCallback(() => {
    liftedRef.current = null
    setAlert(null)
  }, [])

  // Everything that leaves the book empty ends here, in a form the operator
  // cannot scroll past: the order that is gone, why it is gone, and — unless a
  // second attempt could duplicate it — a control that places it again.
  const raiseObligation = useCallback((lifted, replacement, { code, message, unknown }) => {
    const summary = orderSummary(lifted.order, replacement)
    setAlert(Object.freeze(unknown
      ? {
          tone: 'unresolved',
          title: 'Replacement NOT confirmed',
          detail: `${message ?? 'Binance did not confirm the replacement either way.'} Check ${summary.symbol} on Binance before placing anything — a second attempt could leave two orders on the book.`,
          order: summary,
          // Deliberately none: an unknown outcome is exactly the case where
          // trying again is how two real orders end up resting.
          retryPrice: null,
        }
      : {
          tone: 'lost',
          title: 'Order cancelled and NOT replaced',
          detail: `${summary.symbol} ${summary.side} ${summary.quantity} @ ${summary.price} was cancelled and could not be placed again. ${message ?? code ?? 'The placement was refused.'}`,
          order: summary,
          retryPrice: lifted.originPrice,
        }))
  }, [])

  const sendReplacement = useCallback(async (lifted, price) => {
    const replacement = describeFuturesDragReplacement({
      order: lifted.order,
      price,
      // The tick the order's own contract trades at, captured when it was
      // lifted. A drag that ends because the operator changed contract would
      // otherwise round the old order's price to the new contract's tick —
      // 0.0308370 against a 0.01 tick is an order at 0.03.
      tickSize: lifted.tickSize,
      maxOrderNotionalUsdt,
    })
    if (!replacement.ok) {
      raiseObligation(lifted, replacement, {
        code: replacement.reason,
        message: describeFuturesDragRefusal(replacement),
        unknown: false,
      })
      return false
    }
    setReplacementInFlight(true)
    try {
      const answer = await placeOrder({
        symbol: replacement.symbol,
        side: replacement.side,
        orderType: replacement.orderType,
        price: replacement.price,
        quantity: replacement.quantity,
        positionSide: replacement.positionSide,
        reduceOnly: replacement.reduceOnly,
      })
      if (answer?.outcome === FUTURES_COMMAND_OUTCOME.CONFIRMED) {
        liftedRef.current = null
        setAlert(null)
        return true
      }
      raiseObligation(lifted, replacement, {
        code: answer?.code ?? null,
        message: answer?.message ?? null,
        unknown: answer?.outcome === FUTURES_COMMAND_OUTCOME.UNKNOWN,
      })
      return false
    } finally {
      setReplacementInFlight(false)
    }
  }, [maxOrderNotionalUsdt, placeOrder, raiseObligation])

  /**
   * Take the order off the book. Resolves `{ ok: true }` only once Binance has
   * confirmed the cancellation — a refusal leaves the order alone, and an
   * unanswered cancellation starts nothing and says it is unanswered.
   */
  const lift = useCallback(async (order) => {
    if (typeof cancelOrder !== 'function' || typeof placeOrder !== 'function') {
      return { ok: false }
    }
    // While the desk still owes an order, nothing else may be lifted: two
    // outstanding obligations cannot be told apart on one alert.
    if (liftedRef.current !== null) return { ok: false }
    if (tradingPaused) {
      setAlert(PAUSED_ALERT)
      return { ok: false }
    }
    // Whether this order can be put back at the price it is resting at, asked
    // before anything is cancelled: an order the desk could not replace is one
    // the drag must not lift in the first place.
    const restorable = describeFuturesDragReplacement({
      order,
      price: order?.price,
      tickSize,
      maxOrderNotionalUsdt,
    })
    if (!restorable.ok) {
      setAlert(Object.freeze({
        tone: 'refused',
        title: 'Order NOT lifted',
        detail: `${describeFuturesDragRefusal(restorable)} The order was left where it is.`,
        order: orderSummary(order, null),
        retryPrice: null,
      }))
      return { ok: false }
    }
    setAlert(null)
    const lifted = Object.freeze({ order, originPrice: order.price, tickSize })
    liftedRef.current = lifted
    const answer = await cancelOrder({
      symbol: order.symbol,
      orderId: order.orderId,
      origClientOrderId: order.orderId ? undefined : order.clientOrderId,
    })
    if (answer?.outcome === FUTURES_COMMAND_OUTCOME.CONFIRMED) return { ok: true }
    // Nothing was lifted, so nothing is owed. The order is either still working
    // or its fate is the exchange's to state; either way the drag does not run.
    liftedRef.current = null
    setAlert(Object.freeze(answer?.outcome === FUTURES_COMMAND_OUTCOME.UNKNOWN
      ? {
          tone: 'unresolved',
          title: 'Cancellation NOT confirmed',
          detail: `${answer?.message ?? 'Binance did not confirm the cancellation either way.'} The order was not moved — check ${order.symbol} on Binance.`,
          order: orderSummary(order, null),
          retryPrice: null,
        }
      : {
          tone: 'refused',
          title: 'Order NOT lifted',
          detail: `${answer?.message ?? answer?.code ?? 'The cancellation was refused.'} The order is still working where it was.`,
          order: orderSummary(order, null),
          retryPrice: null,
        }))
    return { ok: false }
  }, [cancelOrder, maxOrderNotionalUsdt, placeOrder, tickSize, tradingPaused])

  /**
   * End the drag. `restored` puts the order back where it was lifted from —
   * the drag was abandoned, the contract changed under it, or it was dropped
   * where it started.
   */
  const drop = useCallback(async ({ price = null, restored = false } = {}) => {
    const lifted = liftedRef.current
    if (lifted === null) return false
    return sendReplacement(lifted, restored || price === null ? lifted.originPrice : price)
  }, [sendReplacement])

  // Offered only where a second attempt cannot duplicate anything: after a
  // refusal, never after silence.
  const retry = useCallback(async () => {
    const lifted = liftedRef.current
    if (lifted === null || alert?.retryPrice === null || alert?.retryPrice === undefined) {
      return false
    }
    return sendReplacement(lifted, alert.retryPrice)
  }, [alert, sendReplacement])

  return {
    alert,
    replacementInFlight,
    lift,
    drop,
    retry,
    dismiss,
  }
}

export default useFuturesOrderDrag
