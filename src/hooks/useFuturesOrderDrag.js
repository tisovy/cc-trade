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
//
// Obligations are held per order. They used to be held one at a time, on the
// grounds that two of them could not be told apart on a single alert — true of
// a single alert, and the wrong thing to bound. The window that limit closed is
// one round trip through the operator's proxy, 340–800 ms measured, and for its
// whole length no order on any contract could be moved. The alert is a list
// now, so the reason the limit existed is gone with it.

const PAUSED_ALERT = Object.freeze({
  tone: 'refused',
  title: 'Order NOT lifted',
  detail: 'Trading is paused — resume to move orders.',
  order: null,
  retryPrice: null,
})

// Keyed by contract as well as by id: two contracts can answer with the same
// order id, and an obligation matched across them would discharge the wrong one.
const dragIdentity = (order) => {
  const symbol = String(order?.symbol ?? '')
  const id = order?.orderId ?? order?.clientOrderId ?? null
  return id === null || symbol === '' ? null : `${symbol}:${id}`
}

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
  const [alerts, setAlerts] = useState([])
  const [inFlight, setInFlight] = useState(0)
  // The drag the pointer is driving. One pointer, one drag — what changed is
  // that the previous drag no longer has to have landed for the next to start.
  const liftedRef = useRef(null)
  // Everything the desk currently owes an order for, by identity: the drag in
  // hand and every replacement still in flight behind it.
  const owedRef = useRef(new Set())
  const alertSequence = useRef(0)

  const raise = useCallback((entry) => {
    alertSequence.current += 1
    const id = alertSequence.current
    setAlerts(previous => [...previous, Object.freeze({ ...entry, id })])
    return id
  }, [])

  const dismiss = useCallback((id = null) => {
    setAlerts(previous => (id === null ? [] : previous.filter(entry => entry.id !== id)))
  }, [])

  // Everything that leaves the book empty ends here, in a form the operator
  // cannot scroll past: the order that is gone, why it is gone, and — unless a
  // second attempt could duplicate it — a control that places it again. Each
  // one carries what it was lifted from, so retrying one says nothing about
  // another.
  const raiseObligation = useCallback((lifted, replacement, { code, message, unknown }) => {
    const summary = orderSummary(lifted.order, replacement)
    raise(unknown
      ? {
          tone: 'unresolved',
          title: 'Replacement NOT confirmed',
          detail: `${message ?? 'Binance did not confirm the replacement either way.'} Check ${summary.symbol} on Binance before placing anything — a second attempt could leave two orders on the book.`,
          order: summary,
          // Deliberately none: an unknown outcome is exactly the case where
          // trying again is how two real orders end up resting.
          retryPrice: null,
          lifted: null,
        }
      : {
          tone: 'lost',
          title: 'Order cancelled and NOT replaced',
          detail: `${summary.symbol} ${summary.side} ${summary.quantity} @ ${summary.price} was cancelled and could not be placed again. ${message ?? code ?? 'The placement was refused.'}`,
          order: summary,
          retryPrice: lifted.originPrice,
          lifted,
        })
  }, [raise])

  const release = useCallback((lifted) => {
    const identity = dragIdentity(lifted.order)
    if (identity !== null) owedRef.current.delete(identity)
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
      release(lifted)
      return false
    }
    setInFlight(count => count + 1)
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
        release(lifted)
        return true
      }
      raiseObligation(lifted, replacement, {
        code: answer?.code ?? null,
        message: answer?.message ?? null,
        unknown: answer?.outcome === FUTURES_COMMAND_OUTCOME.UNKNOWN,
      })
      release(lifted)
      return false
    } finally {
      setInFlight(count => Math.max(0, count - 1))
    }
  }, [maxOrderNotionalUsdt, placeOrder, raiseObligation, release])

  /**
   * Take the order off the book. Resolves `{ ok: true }` only once Binance has
   * confirmed the cancellation — a refusal leaves the order alone, and an
   * unanswered cancellation starts nothing and says it is unanswered.
   */
  const lift = useCallback(async (order) => {
    if (typeof cancelOrder !== 'function' || typeof placeOrder !== 'function') {
      return { ok: false }
    }
    const identity = dragIdentity(order)
    // The same order twice. It is not on the book to be lifted again, and
    // saying nothing here is indistinguishable from a drag the desk never
    // registered — which is exactly how this read to the operator.
    if (identity === null || owedRef.current.has(identity)) {
      raise({
        tone: 'refused',
        title: 'Order NOT lifted',
        detail: identity === null
          ? 'That order has no identity the desk can move it by. It was left where it is.'
          : `${order.symbol} is already lifted and has not landed yet. It was left where it is.`,
        order: orderSummary(order, null),
        retryPrice: null,
        lifted: null,
      })
      return { ok: false }
    }
    if (tradingPaused) {
      raise(PAUSED_ALERT)
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
      raise({
        tone: 'refused',
        title: 'Order NOT lifted',
        detail: `${describeFuturesDragRefusal(restorable)} The order was left where it is.`,
        order: orderSummary(order, null),
        retryPrice: null,
        lifted: null,
      })
      return { ok: false }
    }
    const lifted = Object.freeze({ order, originPrice: order.price, tickSize })
    liftedRef.current = lifted
    owedRef.current.add(identity)
    const answer = await cancelOrder({
      symbol: order.symbol,
      orderId: order.orderId,
      origClientOrderId: order.orderId ? undefined : order.clientOrderId,
    })
    if (answer?.outcome === FUTURES_COMMAND_OUTCOME.CONFIRMED) return { ok: true }
    // Nothing was lifted, so nothing is owed. The order is either still working
    // or its fate is the exchange's to state; either way the drag does not run.
    if (liftedRef.current === lifted) liftedRef.current = null
    owedRef.current.delete(identity)
    raise(answer?.outcome === FUTURES_COMMAND_OUTCOME.UNKNOWN
      ? {
          tone: 'unresolved',
          title: 'Cancellation NOT confirmed',
          detail: `${answer?.message ?? 'Binance did not confirm the cancellation either way.'} The order was not moved — check ${order.symbol} on Binance.`,
          order: orderSummary(order, null),
          retryPrice: null,
          lifted: null,
        }
      : {
          tone: 'refused',
          title: 'Order NOT lifted',
          detail: `${answer?.message ?? answer?.code ?? 'The cancellation was refused.'} The order is still working where it was.`,
          order: orderSummary(order, null),
          retryPrice: null,
          lifted: null,
        })
    return { ok: false }
  }, [cancelOrder, maxOrderNotionalUsdt, placeOrder, raise, tickSize, tradingPaused])

  /**
   * End the drag. `restored` puts the order back where it was lifted from —
   * the drag was abandoned, the contract changed under it, or it was dropped
   * where it started.
   *
   * The pointer is free the moment this is called: the replacement travels on
   * its own, and the next order can be lifted while it does.
   */
  const drop = useCallback(async ({ price = null, restored = false } = {}) => {
    const lifted = liftedRef.current
    if (lifted === null) return false
    liftedRef.current = null
    return sendReplacement(lifted, restored || price === null ? lifted.originPrice : price)
  }, [sendReplacement])

  // Offered only where a second attempt cannot duplicate anything: after a
  // refusal, never after silence. Per statement, so answering one leaves the
  // other standing.
  const retry = useCallback(async (id = null) => {
    const entry = id === null ? alerts[0] ?? null : alerts.find(one => one.id === id) ?? null
    if (entry === null || entry.lifted === null || entry.retryPrice === null
      || entry.retryPrice === undefined) {
      return false
    }
    dismiss(entry.id)
    const identity = dragIdentity(entry.lifted.order)
    if (identity !== null) owedRef.current.add(identity)
    return sendReplacement(entry.lifted, entry.retryPrice)
  }, [alerts, dismiss, sendReplacement])

  return {
    alerts,
    replacementInFlight: inFlight > 0,
    lift,
    drop,
    retry,
    dismiss,
  }
}

export default useFuturesOrderDrag
