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
      // What the contract itself last printed at. A reading never carries one
      // without a mark beside it — the feed publishes by walking its marks, and
      // this loop drops any entry without one.
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

// How far behind the mark the contract's own last print may fall and still be
// the price the position is valued at.
//
// The two are different quantities, not a fast copy and a slow one: the mark is
// an index the exchange publishes once a second and settles, charges funding and
// liquidates on; the print is what the contract actually traded at, and it is
// what the chart draws and what an exit fills near. Measured 2026-08-26 through
// the operator's proxy over 180s, the print stood 1.0 bps from the mark at the
// median and up to 7.0 bps at its worst, and inside a single mark second the
// price roamed as far as 7.0 bps from the standing mark — money a mark-priced
// row could not show until the second was over.
//
// This window decides which of the two is the newer statement about the price,
// and it is a window rather than a plain comparison because the mark arrives on
// a metronome: without one, every mark would briefly take the reading back off
// a contract that is printing perfectly well, and the row would alternate
// between two figures a bp apart once a second. Set above the worst mark
// interval that session measured (1272ms, p95 1015ms) so a late mark frame
// cannot do that either, and no higher, because everything above it is age the
// operator would be shown instead of the mark's own.
//
// Measured print gaps for scale, same session: BTCUSDT p95 196ms, ETHUSDT
// 354ms, SOLUSDT 712ms, DOGEUSDT 1609ms. A contract that stops trading hands
// the reading back to the mark within about two marks, which is what should
// happen — a price nobody has traded at for two seconds is not the fresher one.
export const FUTURES_LAST_PRICE_GRACE_MS = 1500

// Which price a reading states, and when the exchange said it. One place, so
// the notification predicates below and the valuation itself cannot disagree
// about what a row is showing.
export const readFuturesPositionPriceBasis = (mark) => {
  const markPrice = positiveNumber(mark?.markPrice)
  if (markPrice === null) return null
  const markAt = safeTime(mark?.updatedAt)
  const onMark = Object.freeze({ basis: 'mark', price: String(mark.markPrice), at: markAt })
  const lastPrice = positiveNumber(mark?.lastPrice)
  const lastAt = safeTime(mark?.lastPriceAt)
  // An untimed print cannot be compared with the mark, and an untimed mark
  // gives nothing to compare it against. Neither is a reason to prefer it.
  if (lastPrice === null || lastAt === null || markAt === null) return onMark
  if (markAt - lastAt > FUTURES_LAST_PRICE_GRACE_MS) return onMark
  return Object.freeze({ basis: 'last-price', price: String(mark.lastPrice), at: lastAt })
}

// Everything a whole valuation is built from: the price the row is read at with
// the time the exchange put on it, and the mark, which the row does not state
// its money at but does take its notional, its margin and the figure it carries
// beside itself from. Freshness belongs here because the basis can change on a
// timestamp alone — a mark arriving while the contract has gone quiet takes the
// reading back without any price having moved.
const samePrimaryMark = (left, right) => {
  if (left === right) return true
  const before = readFuturesPositionPriceBasis(left)
  const after = readFuturesPositionPriceBasis(right)
  return left?.markPrice === right?.markPrice
    && left?.updatedAt === right?.updatedAt
    && before?.basis === after?.basis
    && before?.price === after?.price
    && before?.at === after?.at
}

// The money, and only the money: a source clock advancing over an unchanged
// price is not a new figure to draw.
const sameMarkValue = (left, right) => {
  if (left === right) return true
  const before = readFuturesPositionPriceBasis(left)
  const after = readFuturesPositionPriceBasis(right)
  if (before === null || after === null) return before === after
  return Number(before.price) === Number(after.price)
}

// Rows that state the mark beside the figure need both prices to move them,
// and neither source clock. A middle channel: richer than the aggregate's
// single number, cheaper than the full freshness reading.
const samePresentationValue = (left, right) => sameMarkValue(left, right)
  && Number(left?.markPrice) === Number(right?.markPrice)

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

  // There is no second way in. A print used to arrive here on its own, off the
  // renderer's chart stream and only for the contract on screen; the feed now
  // carries every open contract's print in the same publication as its mark, so
  // one publication is one coherent reading of both prices and the admission
  // rules above apply to all of it.
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

// What the exchange's own mark makes the position worth.
//
// Carried whenever the reading is priced at something else, because this is the
// figure the account agrees with: funding is charged on it, liquidation is
// decided by it, and it is what the Binance app shows unless it is told
// otherwise. The row states the price the contract is trading at; this states
// the price it is settled at, and on a fast move they are not the same number.
const markScenarioOf = (position, mark, readingPnl, margin) => {
  const markPrice = positiveNumber(mark?.markPrice)
  const quantity = signedQuantityOf(position)
  const entryPrice = positiveNumber(position?.entryPrice)
  if (markPrice === null || quantity === null || entryPrice === null) return null
  const unrealizedPnl = stableDerivedNumber((markPrice - entryPrice) * quantity)
  return Object.freeze({
    price: String(mark.markPrice),
    sourceAt: safeTime(mark?.updatedAt),
    unrealizedPnl,
    roe: margin === null
      ? null
      : stableDerivedNumber((unrealizedPnl / margin) * 100),
    // The two are on opposite sides of the entry: the chart shows the price
    // past the line while the account still records a loss, or the reverse.
    // Both are right — one is an index average, the other is what printed — but
    // a row that contradicts the account without saying why reads as broken
    // arithmetic, and this is what lets a surface say why.
    disagreesWithReading: unrealizedPnl !== 0
      && readingPnl !== 0
      && (unrealizedPnl > 0) !== (readingPnl > 0),
  })
}

// Strict source ladder: complete live arithmetic on the public price feed, then
// one confirmed account snapshot, then unknown. The object is the one source
// for row price, notional, uPnL, ROE and aggregate selection.
//
// Within the live rung the price is whichever of the contract's two — its last
// print and its mark — the exchange stated more recently, as
// `readFuturesPositionPriceBasis` decides. The mark's own figure is carried
// alongside as `markScenario` whenever it differs, and the mark alone still
// sets notional and margin: those are what the exchange requires of the
// position, and a trade printing does not change them.
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
  const basis = readFuturesPositionPriceBasis(mark)

  if (quantity !== null && entryPrice !== null && basis !== null) {
    const livePrice = Number(basis.price)
    const unrealizedPnl = stableDerivedNumber((livePrice - entryPrice) * quantity)
    // Notional stays on the mark, and so does the margin derived from it: the
    // exchange sizes its requirement on the mark, and a print moving does not
    // change what the position must keep. Only what it is worth moves.
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
      source: 'live-price',
      // Which of the contract's two prices this reading is on, and the time the
      // exchange put on that one — not on the other.
      basis: basis.basis,
      basisPrice: basis.price,
      sourceAt: basis.at,
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
      markScenario: markScenarioOf(position, mark, unrealizedPnl, liveMargin),
    })
  }

  const snapshotPnl = toFiniteNumber(position?.unrealizedPnl)
  if (snapshotConfirmed && snapshotPnl !== null) {
    const snapshotMark = positiveNumber(position?.markPrice)
    return Object.freeze({
      source: 'account-snapshot',
      // A snapshot has one price and it is the account's own. There is no
      // choice of basis to state.
      basis: null,
      basisPrice: snapshotCoherent && positiveNumber(position?.markPrice) !== null
        ? String(position.markPrice)
        : null,
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
      markScenario: null,
    })
  }

  return Object.freeze({
    source: 'unknown',
    basis: null,
    basisPrice: null,
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
    markScenario: null,
  })
}

// A number the legacy presentation parser must not see as zero when it is
// absent. `undefined` is dropped from the row; `null` would be read as 0.
const carriedAmount = value => (
  value === null || value === undefined ? undefined : String(value)
)

export const applyFuturesPositionValuation = (position, valuation) => ({
  ...position,
  // The legacy presentation parser treats JavaScript null as numeric zero.
  // Omit unavailable numeric fields so unknown remains unknown without changing
  // that CRITICAL shared parser in this focused change.
  markPrice: valuation?.markPrice ?? undefined,
  // The price the figures on this row were actually computed at, which is what
  // a close estimate must use: a market exit fills near what the contract is
  // printing, not near the index the exchange settles it on.
  valuationPrice: valuation?.basisPrice ?? valuation?.markPrice ?? undefined,
  valuationBasis: valuation?.basis ?? null,
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
  unrealizedPnl: carriedAmount(valuation?.unrealizedPnl),
  // The mark's own figure, under its own name and never merged with the one
  // above. This is the seam that holds: margin balance, removable margin and
  // the liquidation buffer all read this field first, so what the exchange will
  // do to the position stays decided by the price the exchange decides it on,
  // whatever price the row is being read at. Falls through to the reading only
  // on the snapshot rung, where there is one price and it is the account's.
  markUnrealizedPnl: carriedAmount(
    valuation?.markScenario?.unrealizedPnl ?? valuation?.unrealizedPnl,
  ),
  // Preserve the already signed arithmetic rather than recomputing it. From a
  // raw positive hedge SHORT quantity the sign would silently flip.
  markScenario: valuation?.markScenario ?? undefined,
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

// Compatibility helper for non-React consumers and probes. It applies the same
// live valuation the surfaces read, on the same basis rule.
export const mergeFuturesPositionMarks = (positions, marks) => {
  if (!Array.isArray(positions) || positions.length === 0) return positions
  if (marks === null || typeof marks !== 'object') return positions
  let changed = false
  const merged = positions.map((position) => {
    const mark = marks[normalizedSymbol(position?.symbol)]
    if (positiveNumber(mark?.markPrice) === null) return position
    const valuation = readFuturesPositionValuation(position, mark)
    if (valuation.source !== 'live-price') return position
    changed = true
    return applyFuturesPositionValuation(position, valuation)
  })
  return changed ? merged : positions
}
