import { exceedsFuturesOrderCap } from './futuresOrderDraft.js'

export const FUTURES_READINESS_CODES = Object.freeze({
  READY: 'READY',
  CONFIGURATION: 'CONFIGURATION',
  TRANSPORT: 'TRANSPORT',
  PAUSED: 'PAUSED',
  CONTRACT: 'CONTRACT',
  METADATA: 'METADATA',
  ACCOUNT_LOADING: 'ACCOUNT_LOADING',
  ACCOUNT_ERROR: 'ACCOUNT_ERROR',
  ACCOUNT_STALE: 'ACCOUNT_STALE',
  BALANCE_UNAVAILABLE: 'BALANCE_UNAVAILABLE',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  DRAFT: 'DRAFT',
  ORDER_CAP: 'ORDER_CAP',
})

const result = (code, tone, label, reason, ready = false) => Object.freeze({
  code,
  tone,
  label,
  reason,
  ready,
})

export const deriveFuturesReadiness = ({
  startupReady = true,
  connected,
  tradingPaused,
  selectedContractTradable,
  hasFilters,
  balanceResource,
  availableUsdt,
  draftRequired = false,
  draftValid = false,
  amountWithinBudget = true,
  notionalUsdt = null,
  maxOrderNotionalUsdt = null,
  exposureIncreasing = true,
}) => {
  if (!startupReady) {
    return result(
      FUTURES_READINESS_CODES.CONFIGURATION,
      'attention',
      'CONFIG',
      'Binance Futures credentials are not ready. Configure BFK and BFS, then restart.',
    )
  }
  if (!connected) {
    return result(
      FUTURES_READINESS_CODES.TRANSPORT,
      'attention',
      'OFFLINE',
      'Local backend connection unavailable — reconnect.',
    )
  }
  if (tradingPaused) {
    return result(
      FUTURES_READINESS_CODES.PAUSED,
      'attention',
      'PAUSED',
      'Trading is paused — new orders are blocked until you resume.',
    )
  }
  if (!selectedContractTradable) {
    return result(
      FUTURES_READINESS_CODES.CONTRACT,
      'attention',
      'CONTRACT',
      'Select an active USDⓈ-M contract.',
    )
  }
  if (!hasFilters) {
    return result(
      FUTURES_READINESS_CODES.METADATA,
      'loading',
      'METADATA',
      'Loading exact Binance price, quantity, and notional filters…',
    )
  }

  const balanceStatus = balanceResource?.status
  if (!balanceStatus || balanceStatus === 'idle' || balanceStatus === 'loading') {
    return result(
      FUTURES_READINESS_CODES.ACCOUNT_LOADING,
      'loading',
      'SYNC',
      'Loading Futures account state — synchronizing the authenticated balance…',
    )
  }
  if (balanceStatus === 'error') {
    return result(
      FUTURES_READINESS_CODES.ACCOUNT_ERROR,
      'attention',
      'BALANCE',
      balanceResource.error?.message || 'Futures balance is unavailable. Retry account synchronization.',
    )
  }
  if (balanceStatus === 'stale') {
    return result(
      FUTURES_READINESS_CODES.ACCOUNT_STALE,
      'attention',
      'STALE',
      balanceResource.error?.message || 'The last Futures balance is stale. Retry before increasing exposure.',
    )
  }

  const available = Number(availableUsdt)
  if (!Number.isFinite(available)) {
    return result(
      FUTURES_READINESS_CODES.BALANCE_UNAVAILABLE,
      'attention',
      'BALANCE',
      'A confirmed available USDT balance was not returned by Binance.',
    )
  }
  if (available <= 0) {
    return result(
      FUTURES_READINESS_CODES.INSUFFICIENT_FUNDS,
      'attention',
      'FUNDS',
      'Available Futures balance is 0 USDT.',
    )
  }
  // Free balance bounds what may be *opened*. A reduce-only exit consumes no
  // margin — it releases it — and under any leverage the position is worth more
  // than the balance left over, so budgeting an exit would block the operator
  // from closing exactly when they most need to.
  const overBudget = exposureIncreasing && !amountWithinBudget
  if (draftRequired && (!draftValid || overBudget)) {
    return result(
      FUTURES_READINESS_CODES.DRAFT,
      'attention',
      'DRAFT',
      overBudget
        ? 'Order size exceeds the confirmed available USDT balance.'
        : 'Pick a valid limit price and order size.',
    )
  }

  // An unsized ticket is not an over-cap ticket: sizing starts at zero and the
  // DRAFT gate above owns that case. Only a stated size is measured, and it is
  // measured by the one ceiling rule the whole desk shares.
  const sizeStated = typeof notionalUsdt === 'string' ? notionalUsdt.trim() : notionalUsdt
  const hasStatedSize = sizeStated !== null
    && sizeStated !== undefined
    && sizeStated !== ''
    && Number(sizeStated) > 0
  if (exposureIncreasing
    && hasStatedSize
    && exceedsFuturesOrderCap(sizeStated, maxOrderNotionalUsdt)) {
    return result(
      FUTURES_READINESS_CODES.ORDER_CAP,
      'attention',
      'RISK CAP',
      `Order notional exceeds the local ${maxOrderNotionalUsdt} USDT limit.`,
    )
  }

  return result(
    FUTURES_READINESS_CODES.READY,
    'live',
    'READY',
    'Futures trading ready — orders submit immediately.',
    true,
  )
}
