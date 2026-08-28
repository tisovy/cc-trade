import { exceedsFuturesOrderCap } from './futuresOrderDraft.js'

export const FUTURES_READINESS_CODES = Object.freeze({
  READY: 'READY',
  CONFIGURATION: 'CONFIGURATION',
  TRANSPORT: 'TRANSPORT',
  PAUSED: 'PAUSED',
  CONTRACT: 'CONTRACT',
  LISTING: 'LISTING',
  METADATA: 'METADATA',
  ACCOUNT_LOADING: 'ACCOUNT_LOADING',
  ACCOUNT_ERROR: 'ACCOUNT_ERROR',
  ACCOUNT_STALE: 'ACCOUNT_STALE',
  BALANCE_UNAVAILABLE: 'BALANCE_UNAVAILABLE',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  DRAFT: 'DRAFT',
  ORDER_CAP: 'ORDER_CAP',
})

/**
 * Whether the desk has a balance it may act on.
 *
 * A resource being read is not a resource the desk knows nothing about. The
 * account refresh marks every resource `loading` and keeps its last values, so
 * a balance that has answered once stays exactly as usable while the next read
 * is in flight — it is the same number the desk sized the last order from a
 * second ago, and the read is what is about to make it fresher.
 *
 * Treating `loading` as unknown withdrew the desk's readiness for the length of
 * every account read. With a read after every command, that refused the
 * operator's next order, blanked the sizing panel and flashed the SYNC badge —
 * for a number that had not changed and was not in doubt.
 *
 * `stale` and `error` are different and still block: the first says the reading
 * is not confirmed by the connection that is up now, the second that the last
 * attempt failed.
 */
export const isFuturesBalanceConfirmed = balanceResource => (
  balanceResource?.status === 'ready'
  || (balanceResource?.status === 'loading'
    && Number.isFinite(balanceResource?.lastSuccessfulAt))
)

/**
 * What is behind the rows a surface is drawing.
 *
 * A list of no rows means three different things — nothing has been asked for,
 * an answer is on the way, or a read answered and found nothing — and a list of
 * rows means two: these are what the account holds, or these are what it held
 * when the connection dropped. Every surface that draws orders has to make the
 * same distinction, so they make it from here rather than each inventing its
 * own wording and drifting apart.
 *
 * `known` is the narrow question the counts ask: may this surface state a number
 * as fact? `state` is the whole answer, and `notice` is what to say when rows are
 * on screen but nothing has confirmed them.
 */
export const describeFuturesResourceAvailability = (resources) => {
  const present = (Array.isArray(resources) ? resources : []).filter(Boolean)
  const everRead = present.length > 0
    && present.every(resource => resource?.lastSuccessfulAt != null)
  const failed = present.find(resource => resource?.status === 'error') ?? null
  const stale = present.find(resource => resource?.status === 'stale') ?? null
  const reasonOf = resource => resource?.error?.message ?? null
  if (!everRead) {
    const reading = present.some(resource => resource?.status === 'loading')
    return Object.freeze({
      known: false,
      state: failed ? 'failed' : reading ? 'reading' : 'unread',
      label: failed
        ? 'Not read — the account read failed.'
        : reading ? 'Reading the account…' : 'Not read yet.',
      reason: reasonOf(failed),
      notice: null,
    })
  }
  if (failed !== null) {
    return Object.freeze({
      known: true,
      state: 'failed',
      label: null,
      reason: reasonOf(failed),
      notice: 'The last account read failed — showing what was read before it.',
    })
  }
  if (stale !== null) {
    return Object.freeze({
      known: true,
      state: 'stale',
      label: null,
      reason: reasonOf(stale),
      notice: 'Not confirmed since the connection dropped — showing the last reading.',
    })
  }
  // A refresh in flight over a reading that has answered is the ordinary case
  // and says nothing: the rows are the ones the last order was worked against,
  // and the read is what is about to make them fresher.
  return Object.freeze({ known: true, state: 'ready', label: null, reason: null, notice: null })
}

// The two resources every order surface draws from. Orders arrive on two reads —
// the regular book and the algo book — and a surface that draws both is only as
// synchronized as the worse of them.
export const describeFuturesOrderAvailability = accountResources => (
  describeFuturesResourceAvailability([
    accountResources?.regularOrders,
    accountResources?.algoOrders,
  ])
)

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
  selectedContractUntradableListing = false,
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
  // A live listing the desk deliberately will not trade — Binance lists
  // perpetuals whose tickers are outside the execution path's ASCII alphabet
  // (龙虾USDT and kin). Distinguished from CONTRACT, which reads as "you have
  // not picked one": the operator is standing on an active contract, watching
  // its chart, and is owed the real reason the ticket is dark.
  if (selectedContractUntradableListing) {
    return result(
      FUTURES_READINESS_CODES.LISTING,
      'attention',
      'LISTING',
      'Binance lists this contract, but its ticker is outside the desk\'s execution path — orders from the desk are disabled for it.',
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
  if (!isFuturesBalanceConfirmed(balanceResource)
    && (!balanceStatus || balanceStatus === 'idle' || balanceStatus === 'loading')) {
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
