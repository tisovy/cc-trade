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

// A timestamp refresh is a new reading, but not a new valuation. Keep that
// distinction available to consumers that only render price-derived money so
// they can avoid recomputing it without forcing freshness-aware consumers to
// hold an old source time.
const sameMarkValue = (left, right) => left === right || (
  left !== null
  && left !== undefined
  && right !== null
  && right !== undefined
  && Number(left.markPrice) === Number(right.markPrice)
)

// Rows that explain mark/tape disagreement need both prices, but neither source
// clock changes their arithmetic. Give those surfaces a middle channel: richer
// than the aggregate's primary-mark value and cheaper than the full freshness
// reading.
const samePresentationValue = (left, right) => sameMarkValue(left, right) && (
  left.lastPrice === right.lastPrice
  || (left.lastPrice !== null
    && right.lastPrice !== null
    && Number(left.lastPrice) === Number(right.lastPrice))
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
  const valueRevisions = new Map()
  const presentationRevisions = new Map()
  const listeners = new Map()
  const valuationListeners = new Map()
  const valueListeners = new Map()
  const presentationListeners = new Map()

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
    // An epoch without its revision is a malformed scoped publication: letting
    // it through would bypass the accepted revision while still looking like it
    // came from the current feed.
    if (timedEpoch !== null && timedRevision === null) return false
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
    const valueChanged = []
    const presentationChanged = []
    for (const symbol of keys) {
      if (!(symbol in read)) {
        if (symbol in marks) {
          changed.push(symbol)
          valuationChanged.push(symbol)
          valueChanged.push(symbol)
          presentationChanged.push(symbol)
        }
        continue
      }
      const reading = preferNewestMarkReading(marks[symbol], read[symbol])
      next[symbol] = sameMark(marks[symbol], reading) ? marks[symbol] : reading
      if (!sameMark(marks[symbol], next[symbol])) {
        changed.push(symbol)
        if (!samePrimaryMark(marks[symbol], next[symbol])) valuationChanged.push(symbol)
        if (!sameMarkValue(marks[symbol], next[symbol])) valueChanged.push(symbol)
        if (!samePresentationValue(marks[symbol], next[symbol])) {
          presentationChanged.push(symbol)
        }
      }
    }
    if (changed.length === 0) return false
    marks = Object.freeze(next)
    for (const symbol of valuationChanged) {
      revisions.set(symbol, (revisions.get(symbol) ?? 0) + 1)
    }
    for (const symbol of valueChanged) {
      valueRevisions.set(symbol, (valueRevisions.get(symbol) ?? 0) + 1)
    }
    for (const symbol of presentationChanged) {
      presentationRevisions.set(symbol, (presentationRevisions.get(symbol) ?? 0) + 1)
    }
    notify(listeners, changed)
    notify(valuationListeners, valuationChanged)
    notify(valueListeners, valueChanged)
    notify(presentationListeners, presentationChanged)
    return true
  }

  const clear = ({ retireEpoch = false, preserveAdmission = false } = {}) => {
    // A renderer market generation can change while the shared backend feed
    // continues speaking in the same epoch. In that mode only the visible
    // readings are withdrawn: the last admitted revision and retirement floor
    // remain authoritative, so delayed frames cannot refill the cleared store
    // and the next higher same-feed revision can.
    if (!preserveAdmission) {
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
    }
    const changed = Object.keys(marks)
    if (changed.length === 0) return false
    marks = Object.freeze({})
    for (const symbol of changed) {
      revisions.set(symbol, (revisions.get(symbol) ?? 0) + 1)
      valueRevisions.set(symbol, (valueRevisions.get(symbol) ?? 0) + 1)
      presentationRevisions.set(symbol, (presentationRevisions.get(symbol) ?? 0) + 1)
    }
    notify(listeners, changed)
    notify(valuationListeners, changed)
    notify(valueListeners, changed)
    notify(presentationListeners, changed)
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

  const versionOf = (heldRevisions, symbols) => [...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map(normalizedSymbol)
      .filter(Boolean),
  )]
    .sort()
    .map(symbol => `${symbol}:${heldRevisions.get(symbol) ?? 0}`)
    .join('|')

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
    // Price-derived PnL/notional consumers do not need to rerun when only the
    // source timestamp advances. Freshness-aware consumers keep using the full
    // or primary-reading subscriptions above.
    subscribeValue: (symbol, callback) => subscribeTo(valueListeners, symbol, callback),
    subscribePresentation: (symbol, callback) => (
      subscribeTo(presentationListeners, symbol, callback)
    ),
    // A primitive snapshot stays referentially stable for useSyncExternalStore
    // and changes only when one of the requested symbols changes.
    version: symbols => versionOf(revisions, symbols),
    valueVersion: symbols => versionOf(valueRevisions, symbols),
    presentationVersion: symbols => versionOf(presentationRevisions, symbols),
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
  const marginState = describeFuturesPositionMargin(position)
  const snapshotMargin = marginState.margin
  const liveMark = positiveNumber(mark?.markPrice)

  if (quantity !== null && entryPrice !== null && liveMark !== null) {
    const unrealizedPnl = stableDerivedNumber((liveMark - entryPrice) * quantity)
    const notional = stableDerivedNumber(Math.abs(quantity * liveMark))
    const leverage = positiveNumber(position?.leverage)
    // An isolated wallet is committed money and remains a coherent denominator
    // between marks. CROSS initial margin is mark-dependent, so a snapshot dollar
    // amount cannot be reused after the mark moves; derive it from the same live
    // notional and a confirmed leverage or leave ROE unknown.
    const liveMargin = marginState.marginMode === 'ISOLATED'
      ? (positiveNumber(position?.isolatedWallet)
        ?? positiveNumber(position?.isolatedMargin))
      : marginState.marginMode === 'CROSS' && leverage !== null
        ? positiveNumber(notional / leverage)
        : null
    return Object.freeze({
      source: 'live-mark',
      sourceAt: safeTime(mark?.updatedAt),
      markPrice: String(mark.markPrice),
      unrealizedPnl,
      notional,
      margin: liveMargin === null ? null : stableDerivedNumber(liveMargin),
      roe: liveMargin === null
        ? null
        : stableDerivedNumber((unrealizedPnl / liveMargin) * 100),
      complete: true,
      roeComplete: liveMargin !== null,
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
      margin: snapshotCoherent && snapshotMargin !== null ? snapshotMargin : null,
      roe: snapshotCoherent && snapshotMargin !== null
        ? stableDerivedNumber((snapshotPnl / snapshotMargin) * 100)
        : null,
      complete: true,
      roeComplete: snapshotCoherent && snapshotMargin !== null,
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
    margin: null,
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
  // Presentation must show the denominator its adjacent ROE actually used.
  // In particular, live CROSS margin moves with current notional; retaining the
  // account snapshot amount here made two neighboring figures contradict one
  // another even though the percentage itself was correct.
  valuationMargin: valuation?.margin ?? undefined,
  unrealizedPnl: valuation?.unrealizedPnl === null || valuation?.unrealizedPnl === undefined
    ? undefined
    : String(valuation.unrealizedPnl),
  markUnrealizedPnl: valuation?.unrealizedPnl === null || valuation?.unrealizedPnl === undefined
    ? undefined
    : String(valuation.unrealizedPnl),
  tapePrice: valuation?.tapeScenario?.price ?? undefined,
  tapePriceAt: valuation?.tapeScenario?.sourceAt ?? null,
  // Preserve the already signed secondary arithmetic. Recomputing it from a
  // raw positive hedge SHORT quantity would silently turn the what-if into a
  // long even though the primary valuation correctly applied the explicit leg.
  tapeScenario: valuation?.tapeScenario ?? undefined,
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
  let sourceTimeComplete = true
  for (const position of rows) {
    const valuation = readFuturesPositionValuation(
      position,
      marks?.get?.(position?.symbol) ?? null,
      { snapshotAt, snapshotConfirmed: true, snapshotCoherent },
    )
    if (!valuation.complete || valuation.unrealizedPnl === null) missingCount += 1
    else {
      value += valuation.unrealizedPnl
      if (valuation.sourceAt === null) sourceTimeComplete = false
      else sourceAt = sourceAt === null
        ? valuation.sourceAt
        : Math.min(sourceAt, valuation.sourceAt)
    }
    if (valuation.source === 'account-snapshot') fallbackCount += 1
  }
  return Object.freeze({
    value: stableDerivedNumber(value),
    complete: missingCount === 0,
    missingCount,
    fallbackCount,
    sourceAt: sourceTimeComplete ? sourceAt : null,
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
