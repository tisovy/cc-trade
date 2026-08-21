// The account snapshot says what is open; the public mark feed says what that
// exposure is worth now. Keep the two generations separate and select one
// coherent valuation at read time so a row never displays one price while doing
// its arithmetic on another.

import { describeFuturesPositionMargin } from './futuresOrderPresentation.js'

const toFiniteNumber = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const positiveNumber = value => {
  const parsed = toFiniteNumber(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

const safeTime = value => (Number.isSafeInteger(value) && value > 0 ? value : null)

// Exchange decimals enter JavaScript as binary floats. Keep their useful
// precision while removing tails such as `14.450000000000001` before a derived
// value becomes a callback payload or another selector's input.
const stableDerivedNumber = (value) => (
  Number.isFinite(value) ? Number(value.toPrecision(15)) : value
)

const normalizedSymbol = value => (
  typeof value === 'string' && value.length > 0 ? value.toUpperCase() : ''
)

const signedQuantityOf = (position) => {
  const quantity = toFiniteNumber(position?.quantity)
  if (quantity === null || quantity === 0) return null
  const side = String(position?.positionSide ?? '').trim().toUpperCase()
  if (side === 'LONG') return Math.abs(quantity)
  if (side === 'SHORT') return -Math.abs(quantity)
  return quantity
}

export const readFuturesPositionMarks = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const marks = {}
  for (const [symbol, mark] of Object.entries(value)) {
    const key = normalizedSymbol(symbol)
    const markPrice = positiveNumber(mark?.markPrice)
    if (!key || markPrice === null) continue
    const lastPrice = positiveNumber(mark?.lastPrice)
    marks[key] = Object.freeze({
      markPrice: String(mark.markPrice),
      updatedAt: safeTime(mark?.updatedAt),
      // Tape data is explanatory only. It can say why the chart and the mark
      // disagree, but it never becomes a primary valuation input.
      lastPrice: lastPrice === null ? null : String(mark.lastPrice),
      lastPriceAt: safeTime(mark?.lastPriceAt),
    })
  }
  return Object.freeze(marks)
}

const sameMark = (left, right) => left === right || (
  left?.markPrice === right?.markPrice
  && left?.updatedAt === right?.updatedAt
  && left?.lastPrice === right?.lastPrice
  && left?.lastPriceAt === right?.lastPriceAt
)

const samePrimaryMark = (left, right) => left === right || (
  left?.markPrice === right?.markPrice
  && left?.updatedAt === right?.updatedAt
)

// A full feed frame may arrive after a newer renderer frame when IPC work is
// interleaved. Preserve each source's newest timestamp independently: a late
// tape print cannot regress the mark and a late mark cannot regress tape detail.
const preferNewestMarkReading = (previous, incoming) => {
  if (previous === null || previous === undefined) return incoming
  const keepsMark = previous.updatedAt !== null
    && (incoming.updatedAt === null || incoming.updatedAt < previous.updatedAt)
  const keepsTape = previous.lastPriceAt !== null
    && (incoming.lastPriceAt === null || incoming.lastPriceAt < previous.lastPriceAt)
  if (!keepsMark && !keepsTape) return incoming
  return Object.freeze({
    markPrice: keepsMark ? previous.markPrice : incoming.markPrice,
    updatedAt: keepsMark ? previous.updatedAt : incoming.updatedAt,
    lastPrice: keepsTape ? previous.lastPrice : incoming.lastPrice,
    lastPriceAt: keepsTape ? previous.lastPriceAt : incoming.lastPriceAt,
  })
}

// Small external store for the high-frequency lane. React rows subscribe to
// their own symbol and the aggregate subscribes to the active symbol set; the
// account hook and held-history tree are not state-updated by a market tick.
export const createFuturesPositionMarkStore = () => {
  let marks = Object.freeze({})
  let acceptedFrameEpoch = null
  let acceptedFrameRevision = null
  let retiredThroughEpoch = null
  const revisions = new Map()
  const listeners = new Map()
  const valuationListeners = new Map()

  const notify = (heldListeners, symbols) => {
    const callbacks = new Set()
    for (const symbol of symbols) {
      for (const callback of heldListeners.get(symbol) ?? []) callbacks.add(callback)
    }
    for (const callback of callbacks) callback()
  }

  const replace = (value, frameRevision = null, frameEpoch = null) => {
    const read = readFuturesPositionMarks(value)
    if (read === null) return false
    const timedEpoch = Number.isSafeInteger(frameEpoch) && frameEpoch > 0
      ? frameEpoch
      : null
    const timedRevision = Number.isSafeInteger(frameRevision) && frameRevision > 0
      ? frameRevision
      : null
    // IPC preserves order in the ordinary case, but renderer scheduling and
    // reconnect teardown can still deliver an older full frame late. Symbol
    // timestamps cannot decide whether an absent symbol was closed or omitted
    // by that old frame, so admission is made once for the whole publication.
    // Revisions restart at one for every feed instance. A larger epoch opens a
    // new namespace; an older epoch is rejected even if its final empty frame
    // arrives after the new feed. Unscoped callers remain supported until the
    // store has seen a real scoped publication, but cannot bypass one later.
    if (timedEpoch !== null
      && retiredThroughEpoch !== null
      && timedEpoch <= retiredThroughEpoch) return false
    if (timedEpoch !== null
      && acceptedFrameEpoch !== null
      && timedEpoch < acceptedFrameEpoch) return false
    if (timedEpoch === null
      && (acceptedFrameEpoch !== null || retiredThroughEpoch !== null)) return false
    if (timedEpoch !== null
      && (acceptedFrameEpoch === null || timedEpoch > acceptedFrameEpoch)) {
      acceptedFrameEpoch = timedEpoch
      acceptedFrameRevision = null
    }
    if (timedRevision !== null
      && acceptedFrameRevision !== null
      && timedRevision <= acceptedFrameRevision) return false
    if (timedRevision !== null) acceptedFrameRevision = timedRevision
    const keys = new Set([...Object.keys(marks), ...Object.keys(read)])
    const next = {}
    const changed = []
    const valuationChanged = []
    for (const symbol of keys) {
      if (!(symbol in read)) {
        if (symbol in marks) {
          changed.push(symbol)
          valuationChanged.push(symbol)
        }
        continue
      }
      const reading = preferNewestMarkReading(marks[symbol], read[symbol])
      next[symbol] = sameMark(marks[symbol], reading) ? marks[symbol] : reading
      if (!sameMark(marks[symbol], next[symbol])) {
        changed.push(symbol)
        if (!samePrimaryMark(marks[symbol], next[symbol])) valuationChanged.push(symbol)
      }
    }
    if (changed.length === 0) return false
    marks = Object.freeze(next)
    for (const symbol of valuationChanged) {
      revisions.set(symbol, (revisions.get(symbol) ?? 0) + 1)
    }
    notify(listeners, changed)
    notify(valuationListeners, valuationChanged)
    return true
  }

  const clear = ({ retireEpoch = false } = {}) => {
    if (retireEpoch && acceptedFrameEpoch !== null) {
      retiredThroughEpoch = retiredThroughEpoch === null
        ? acceptedFrameEpoch
        : Math.max(retiredThroughEpoch, acceptedFrameEpoch)
    } else if (!retireEpoch) {
      // A transport/process reset has no surviving source from which an older
      // frame can arrive. Forget its epoch floor so a restarted process whose
      // module counter begins at one can publish normally.
      retiredThroughEpoch = null
    }
    acceptedFrameEpoch = null
    acceptedFrameRevision = null
    const changed = Object.keys(marks)
    if (changed.length === 0) return false
    marks = Object.freeze({})
    for (const symbol of changed) {
      revisions.set(symbol, (revisions.get(symbol) ?? 0) + 1)
    }
    notify(listeners, changed)
    notify(valuationListeners, changed)
    return true
  }

  const subscribeTo = (heldListeners, symbol, callback) => {
    const key = normalizedSymbol(symbol)
    if (!key || typeof callback !== 'function') return () => {}
    const held = heldListeners.get(key) ?? new Set()
    held.add(callback)
    heldListeners.set(key, held)
    return () => {
      held.delete(callback)
      if (held.size === 0) heldListeners.delete(key)
    }
  }

  return Object.freeze({
    replace,
    clear,
    get: symbol => marks[normalizedSymbol(symbol)] ?? null,
    subscribe: (symbol, callback) => subscribeTo(listeners, symbol, callback),
    subscribeValuation: (symbol, callback) => subscribeTo(
      valuationListeners,
      symbol,
      callback,
    ),
    // A primitive snapshot stays referentially stable for useSyncExternalStore
    // and changes only when one of the requested symbols changes.
    version(symbols) {
      return [...new Set((Array.isArray(symbols) ? symbols : [])
        .map(normalizedSymbol)
        .filter(Boolean))]
        .sort()
        .map(symbol => `${symbol}:${revisions.get(symbol) ?? 0}`)
        .join('|')
    },
  })
}

const tapeScenarioOf = (position, mark, primaryPnl) => {
  const tapePrice = positiveNumber(mark?.lastPrice)
  const quantity = signedQuantityOf(position)
  const entryPrice = positiveNumber(position?.entryPrice)
  if (tapePrice === null || quantity === null || entryPrice === null) return null
  const unrealizedPnl = stableDerivedNumber((tapePrice - entryPrice) * quantity)
  return Object.freeze({
    price: String(mark.lastPrice),
    sourceAt: safeTime(mark?.lastPriceAt),
    unrealizedPnl,
    disagreesWithMark: unrealizedPnl !== 0
      && primaryPnl !== 0
      && (unrealizedPnl > 0) !== (primaryPnl > 0),
  })
}

// Strict source ladder: complete live mark arithmetic, then one confirmed
// account snapshot, then unknown. The object is the one source for row price,
// notional, uPnL, ROE and aggregate selection.
export const readFuturesPositionValuation = (position, mark, {
  snapshotAt = null,
  snapshotConfirmed = true,
  snapshotCoherent = false,
} = {}) => {
  const quantity = signedQuantityOf(position)
  const entryPrice = positiveNumber(position?.entryPrice)
  // Reuse the desk's one committed-margin ladder. Duplicating it here let a
  // stale isolated-wallet field win over initial margin on a CROSS position,
  // so the same live PnL could produce two different ROE readings.
  const margin = describeFuturesPositionMargin(position).margin
  const liveMark = positiveNumber(mark?.markPrice)

  if (quantity !== null && entryPrice !== null && liveMark !== null) {
    const unrealizedPnl = stableDerivedNumber((liveMark - entryPrice) * quantity)
    return Object.freeze({
      source: 'live-mark',
      sourceAt: safeTime(mark?.updatedAt),
      markPrice: String(mark.markPrice),
      unrealizedPnl,
      notional: stableDerivedNumber(Math.abs(quantity * liveMark)),
      roe: margin === null
        ? null
        : stableDerivedNumber((unrealizedPnl / margin) * 100),
      complete: true,
      roeComplete: margin !== null,
      missingReason: null,
      tapeScenario: tapeScenarioOf(position, mark, unrealizedPnl),
    })
  }

  const snapshotPnl = toFiniteNumber(position?.unrealizedPnl)
  if (snapshotConfirmed && snapshotPnl !== null) {
    const snapshotMark = positiveNumber(position?.markPrice)
    return Object.freeze({
      source: 'account-snapshot',
      sourceAt: safeTime(snapshotAt),
      // ACCOUNT_UPDATE can replace quantity/entry/uPnL while the reducer keeps
      // the older REST mark. Until provenance says these fields are one
      // generation, retain only Binance's uPnL scalar and do not synthesize the
      // missing price/notional/ROE around it.
      markPrice: snapshotCoherent && snapshotMark !== null ? String(position.markPrice) : null,
      unrealizedPnl: snapshotPnl,
      notional: !snapshotCoherent || snapshotMark === null || quantity === null
        ? null
        : stableDerivedNumber(Math.abs(quantity * snapshotMark)),
      roe: snapshotCoherent && margin !== null
        ? stableDerivedNumber((snapshotPnl / margin) * 100)
        : null,
      complete: true,
      roeComplete: snapshotCoherent && margin !== null,
      missingReason: null,
      tapeScenario: null,
    })
  }

  return Object.freeze({
    source: 'unknown',
    sourceAt: null,
    markPrice: null,
    unrealizedPnl: null,
    notional: null,
    roe: null,
    complete: false,
    roeComplete: false,
    missingReason: quantity === null || entryPrice === null
      ? 'position-inputs-unusable'
      : 'mark-and-snapshot-unavailable',
    tapeScenario: null,
  })
}

export const applyFuturesPositionValuation = (position, valuation) => ({
  ...position,
  // The legacy presentation parser treats JavaScript null as numeric zero.
  // Omit unavailable numeric fields so unknown remains unknown without changing
  // that CRITICAL shared parser in this focused change.
  markPrice: valuation?.markPrice ?? undefined,
  valuationPrice: valuation?.markPrice ?? undefined,
  valuationEstimated: false,
  valuationSource: valuation?.source ?? 'unknown',
  valuationSourceAt: valuation?.sourceAt ?? null,
  valuationComplete: valuation?.complete === true,
  // Margin removal is safe only when the PnL and its denominator form a
  // complete reading. Scalar-only snapshot fallback remains useful as uPnL,
  // but cannot silently become zero or mix with an older margin generation.
  valuationMarginComplete: valuation?.roeComplete === true,
  unrealizedPnl: valuation?.unrealizedPnl === null || valuation?.unrealizedPnl === undefined
    ? undefined
    : String(valuation.unrealizedPnl),
  markUnrealizedPnl: valuation?.unrealizedPnl === null || valuation?.unrealizedPnl === undefined
    ? undefined
    : String(valuation.unrealizedPnl),
  tapePrice: valuation?.tapeScenario?.price ?? undefined,
  tapePriceAt: valuation?.tapeScenario?.sourceAt ?? null,
})

export const readFuturesPositionValuationAggregate = (positions, marks, {
  positionsKnown = true,
  snapshotAt = null,
  snapshotCoherent = false,
} = {}) => {
  if (!positionsKnown) {
    return Object.freeze({
      value: null,
      complete: false,
      missingCount: null,
      fallbackCount: null,
      sourceAt: null,
    })
  }
  const rows = Array.isArray(positions) ? positions : []
  let value = 0
  let missingCount = 0
  let fallbackCount = 0
  let sourceAt = null
  for (const position of rows) {
    const valuation = readFuturesPositionValuation(
      position,
      marks?.get?.(position?.symbol) ?? null,
      { snapshotAt, snapshotConfirmed: true, snapshotCoherent },
    )
    if (!valuation.complete || valuation.unrealizedPnl === null) missingCount += 1
    else value += valuation.unrealizedPnl
    if (valuation.source === 'account-snapshot') fallbackCount += 1
    if (valuation.sourceAt !== null) {
      sourceAt = sourceAt === null ? valuation.sourceAt : Math.min(sourceAt, valuation.sourceAt)
    }
  }
  return Object.freeze({
    value: stableDerivedNumber(value),
    complete: missingCount === 0,
    missingCount,
    fallbackCount,
    sourceAt,
  })
}

// Compatibility helper for non-React consumers and probes. It now applies the
// same mark-only valuation; a tape-only change can alter explanatory detail but
// never the primary position fields.
export const mergeFuturesPositionMarks = (positions, marks) => {
  if (!Array.isArray(positions) || positions.length === 0) return positions
  if (marks === null || typeof marks !== 'object') return positions
  let changed = false
  const merged = positions.map((position) => {
    const mark = marks[normalizedSymbol(position?.symbol)]
    if (positiveNumber(mark?.markPrice) === null) return position
    const valuation = readFuturesPositionValuation(position, mark)
    if (valuation.source !== 'live-mark') return position
    changed = true
    return applyFuturesPositionValuation(position, valuation)
  })
  return changed ? merged : positions
}
