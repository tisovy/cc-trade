// Does this message answer the command whose outcome is unknown?
//
// Only its own answer may clear it. Any execution update used to do so, so a
// placement on one contract stopped warning as soon as an unrelated order on
// another contract ticked — and an operator reading no warning sends the order
// again. A command the backend could not identify is answered only by the
// resolution envelope for that command, never by order traffic.
//
// Both markets ask the same question of the same envelopes, so they ask it here
// rather than each in its own words.
export const answersUnresolvedCommand = (unresolved, {
  symbol,
  orderId,
  clientOrderId,
  request,
} = {}) => {
  if (!unresolved) return false
  const held = unresolved.details ?? {}
  const heldOrderId = held.orderId ?? null
  const heldClientOrderId = held.clientOrderId ?? null
  const sameSymbol = held.symbol == null || symbol == null || String(held.symbol) === String(symbol)
  if (heldOrderId === null && heldClientOrderId === null) {
    // Nothing to match on but the command itself.
    return request != null && request === unresolved.request
  }
  if (!sameSymbol) return false
  return (heldOrderId !== null && orderId != null && String(heldOrderId) === String(orderId))
    || (heldClientOrderId !== null
      && clientOrderId != null
      && String(heldClientOrderId) === String(clientOrderId))
}

export default answersUnresolvedCommand
