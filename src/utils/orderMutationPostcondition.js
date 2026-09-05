import { matchesOrderReportIdentity } from './orderReportIdentity.js'

const CANCELLED = new Set(['CANCELED', 'CANCELLED'])
const CLOSED = new Set(['FILLED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED'])
const WORKING = new Set(['NEW', 'PARTIALLY_FILLED', 'PENDING_NEW', 'PENDING_CANCEL'])
const PENDING = Object.freeze({ state: 'pending', status: null })

const exactPositiveDecimal = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  if (text.length > 256 || !/^\d+(?:\.\d+)?$/.test(text)) return null
  const [whole, fractional = ''] = text.split('.')
  const integer = whole.replace(/^0+(?=\d)/, '')
  const fraction = fractional.replace(/0+$/, '')
  const canonical = fraction ? `${integer}.${fraction}` : integer
  return canonical === '0' ? null : canonical
}

// This proves the observed state, not which actor caused it or exactly-once
// execution. Identity is checked by the query owner / held-warning matcher.
export const evaluateOrderMutationPostcondition = ({ action, report, expected } = {}) => {
  const rawStatus = report?.status ?? report?.X
  const status = typeof rawStatus === 'string' ? rawStatus.toUpperCase() : ''
  if (!WORKING.has(status) && !CANCELLED.has(status) && !CLOSED.has(status)) return PENDING
  if (action === 'trade.placeOrder') {
    return status === 'REJECTED'
      ? { state: 'terminal', status, code: 'ORDER_NOT_PLACED', message: 'Binance reports this order rejected.' }
      : { state: 'confirmed', status, code: 'OUTCOME_EXECUTED', message: 'Binance holds this order — it was accepted.' }
  }
  if (action === 'trade.cancelOrder') {
    if (CANCELLED.has(status)) return {
      state: 'confirmed', status, code: 'OUTCOME_CANCELED', message: 'Binance confirms this order was cancelled.',
    }
    if (CLOSED.has(status)) return {
      state: 'terminal', status, code: 'ORDER_NOT_CANCELLED',
      message: `The order is ${status.toLowerCase()} — it was not confirmed cancelled. Do not automatically replace it.`,
    }
    return { ...PENDING, status }
  }
  if (action === 'trade.replaceOrder') {
    const price = exactPositiveDecimal(expected?.price)
    const quantity = exactPositiveDecimal(expected?.quantity)
    const matches = price !== null && quantity !== null
      && price === exactPositiveDecimal(report?.price ?? report?.p)
      && quantity === exactPositiveDecimal(report?.origQty ?? report?.quantity ?? report?.q)
    if (matches && (WORKING.has(status) || status === 'FILLED')) return {
      state: 'confirmed', status, code: 'OUTCOME_AMENDED',
      message: `Binance reports the requested price and original quantity; the order is ${status.toLowerCase()}.`,
    }
    if (CLOSED.has(status) || CANCELLED.has(status)) return {
      state: 'terminal', status, code: 'AMENDMENT_NOT_CONFIRMED',
      message: `The order is ${status.toLowerCase()}; the requested amendment was not confirmed. No replacement was sent.`,
    }
  }
  return { ...PENDING, status }
}

export const readUnresolvedOrderPostcondition = (unresolved, report) => {
  if (!unresolved || !matchesOrderReportIdentity(report, unresolved.details)) return null
  return evaluateOrderMutationPostcondition({
    action: unresolved.request, report, expected: unresolved.details?.expected,
  })
}

export const orderMutationUnconfirmedMessage = action => {
  if (action === 'trade.cancelOrder') return 'Cancellation is unconfirmed; the order may still fill. Check its status on Binance. No automatic retry or replacement was sent.'
  if (action === 'trade.replaceOrder') return 'The requested price and quantity are unconfirmed. Check the order on Binance before changing it again. No automatic retry was sent.'
  return null
}
