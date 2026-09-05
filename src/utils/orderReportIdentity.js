// Exchange IDs must survive comparison without floating-point rounding.
export const readExchangeOrderId = value => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  return typeof value === 'string' && /^[1-9]\d{0,255}$/.test(value) ? value : null
}

export const matchesOrderReportIdentity = (report, { symbol, orderId, clientOrderId } = {}) => {
  if (typeof symbol !== 'string' || !symbol || (report?.symbol ?? report?.s) !== symbol) return false
  const reportedOrderId = readExchangeOrderId(report?.orderId ?? report?.i)
  if (reportedOrderId === null) return false
  if (orderId != null) {
    // A matching client name cannot overrule a contradictory exchange ID.
    return readExchangeOrderId(orderId) === reportedOrderId
  }
  if (typeof clientOrderId !== 'string' || !clientOrderId) return false
  return clientOrderId === (report?.clientOrderId ?? report?.c)
    || clientOrderId === (report?.originalClientOrderId ?? report?.origClientOrderId ?? report?.C)
}
