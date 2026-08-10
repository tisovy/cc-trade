// What answers a mutating command, and what that answer means.
//
// `sendCommand` reports whether a frame left the renderer. That is enough for a
// fire-and-forget action, and not enough for a drag that lifts an order off the
// book: the drag may only begin once the exchange has actually cancelled the
// order, and it has to tell a refusal ("the order is still there") from silence
// ("it may or may not be"). The three answers are kept apart for the same reason
// the backend keeps them apart — an unknown outcome presented as a failure is
// what makes an operator act twice.

export const FUTURES_COMMAND_OUTCOME = Object.freeze({
  CONFIRMED: 'confirmed',
  REFUSED: 'refused',
  UNKNOWN: 'unknown',
})

const CANCELLED_STATUSES = new Set(['CANCELED', 'CANCELLED'])
const WORKING_STATUSES = new Set(['NEW', 'PARTIALLY_FILLED'])
const PLACED_STATUSES = new Set(['NEW', 'PARTIALLY_FILLED', 'FILLED'])

const sameText = (left, right) => (
  left !== null && left !== undefined
  && right !== null && right !== undefined
  && String(left) === String(right)
)

const reportStatus = report => String(report?.status ?? report?.X ?? report?.x ?? '').toUpperCase()

// An envelope names the command it answers by the order's identity. A message
// that names another order says nothing about this one — the desk learned that
// the hard way, when any execution update cleared any unresolved warning.
const namesTheOrder = (watcher, { symbol, orderId, clientOrderId } = {}) => {
  if (watcher.symbol != null && symbol != null
    && String(watcher.symbol) !== String(symbol)) return false
  return sameText(watcher.orderId, orderId) || sameText(watcher.clientOrderId, clientOrderId)
}

// A rejection composed before the order was identified carries only the action
// it refused. That is still an answer to a command in flight — but only when
// there is nothing more specific to compare, so a named refusal of another order
// can never be read as this one's.
const carriesNoIdentity = details => (
  details?.symbol == null && details?.orderId == null && details?.clientOrderId == null
)

const answersEnvelope = (watcher, envelope) => {
  const details = envelope?.details ?? {}
  if (carriesNoIdentity(details)) return envelope?.request === watcher.request
  return namesTheOrder(watcher, {
    symbol: details.symbol,
    orderId: details.orderId,
    clientOrderId: details.clientOrderId,
  })
}

/**
 * Does this message answer the command being waited on, and how?
 *
 * Returns `null` while the command is still unanswered — including for a report
 * that describes the order as still working, which is what an amendment-free
 * cancellation looks like before the exchange has acted on it.
 */
export const readFuturesCommandAnswer = (watcher, answer) => {
  if (!watcher || !answer) return null

  if (answer.kind === 'execution') {
    const report = answer.report ?? {}
    if (!namesTheOrder(watcher, {
      symbol: report.symbol ?? report.s,
      orderId: report.orderId ?? report.i,
      clientOrderId: report.clientOrderId ?? report.c,
    })) return null
    const status = reportStatus(report)
    if (watcher.kind === 'cancel') {
      if (CANCELLED_STATUSES.has(status)) {
        return Object.freeze({ outcome: FUTURES_COMMAND_OUTCOME.CONFIRMED, status })
      }
      // Still on the book: the cancellation has not happened yet, so this is not
      // its answer. The reconciliation that reports an order as still existing
      // lands here too, and the wait ends as unknown rather than as a success.
      if (WORKING_STATUSES.has(status)) return null
      // Filled or expired: the order is gone, but not because it was cancelled.
      // The desk owes no replacement for an order the market took.
      return Object.freeze({
        outcome: FUTURES_COMMAND_OUTCOME.REFUSED,
        status,
        code: 'ORDER_NOT_CANCELLED',
        message: `The order is ${status.toLowerCase()} — it was not cancelled.`,
      })
    }
    return Object.freeze(PLACED_STATUSES.has(status)
      ? { outcome: FUTURES_COMMAND_OUTCOME.CONFIRMED, status }
      : {
          outcome: FUTURES_COMMAND_OUTCOME.REFUSED,
          status,
          code: 'ORDER_NOT_WORKING',
          message: `Binance reports the order as ${status.toLowerCase()}.`,
        })
  }

  if (answer.kind === 'rejected') {
    if (!answersEnvelope(watcher, answer.envelope)) return null
    return Object.freeze({
      outcome: FUTURES_COMMAND_OUTCOME.REFUSED,
      code: answer.envelope?.code ?? null,
      message: answer.envelope?.message ?? null,
    })
  }

  // Both the warning and its withdrawal end the wait the same way: neither says
  // what the exchange did, and the answer that eventually does arrive is the
  // account state itself, which the operator reads rather than the drag.
  if (answer.kind === 'unresolved' || answer.kind === 'resolved') {
    if (!answersEnvelope(watcher, answer.envelope)) return null
    return Object.freeze({
      outcome: FUTURES_COMMAND_OUTCOME.UNKNOWN,
      code: answer.envelope?.code ?? null,
      message: answer.envelope?.message ?? null,
    })
  }

  return null
}

export default readFuturesCommandAnswer
