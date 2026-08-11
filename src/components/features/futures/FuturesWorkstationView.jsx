import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS,
  FUTURES_WORKSTATION_INTERVALS,
  FUTURES_WORKSTATION_TAPE_LIMITS,
} from '../../../utils/futuresWorkstationProtocolShared.js'
import { orderFuturesContracts } from '../../../utils/futuresSymbolHistory.js'
import {
  futuresBookDepthRange,
  futuresBookGroupKey,
  futuresBookGroupSteps,
  futuresBookWallKeys,
  groupFuturesBookLevels,
} from '../../../utils/futuresOrderBook.js'
import { formatCompactUsdt, formatExchangePrice } from '../../../utils/futuresPriceFormat.js'
import {
  normalizeTapeNotional,
  readStoredTapeSettings,
  writeStoredTapeSettings,
} from '../../../utils/futuresTapeSettings.js'
import {
  FUTURES_BOOK_SIDE_MODES,
  readStoredBookView,
  writeStoredBookView,
} from '../../../utils/futuresBookView.js'
import {
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  stepUiScale,
} from '../../../utils/uiScale.js'
import { resolveFuturesTradingGesture } from '../../../utils/futuresTradingGestures.js'
import FuturesWorkstationChart from './FuturesWorkstationChart.jsx'
import './FuturesWorkstation.css'

const EMPTY_ROWS = Object.freeze([])
const EMPTY_SYMBOL_HISTORY = Object.freeze({ recent: EMPTY_ROWS, favorites: EMPTY_ROWS })
const IGNORE_PRICE_PICK = () => {}
// Used only where the panel cannot be measured — a book that has not been laid
// out, or an environment with no resize observation. The rendered count is
// otherwise whatever fits, so a row is never half-drawn or clipped away.
const VISIBLE_DEPTH_LEVELS_PER_SIDE = 14
const BOOK_ROW_HEIGHT_PX = 14
// A ceiling, not a setting: a very tall panel must not ask the grouper for an
// unbounded number of rows.
const MAX_DEPTH_LEVELS_PER_SIDE = 200
const BOOK_SIDE_MODE_LABELS = Object.freeze({
  both: 'Show both book sides',
  bids: 'Show buy side only',
  asks: 'Show sell side only',
})
const NEUTRAL_TICK = Object.freeze({ symbol: null, price: null, direction: 'flat' })
// The tape carries base quantity, so the USDT a print is worth is derived here
// rather than added to the exact-keys market contract.
const tradeNotionalUsdt = trade => Number(trade.price) * Number(trade.quantity)

const formatTime = (timestamp) => {
  if (!Number.isSafeInteger(timestamp)) return '—'
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const formatCountdown = (target, now) => {
  if (!Number.isSafeInteger(target) || target <= now) return '00:00:00'
  const totalSeconds = Math.floor((target - now) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

const displayPercent = value => value ? `${value}%` : '—'

// A grouping step means nothing until it is read against the price it groups.
// On a 0.03551 contract a 0.001 step is 2.8% of price per row, so the whole
// book collapses into two or three of them — which looks like a broken book
// rather than a coarse setting. Stating the share makes the choice legible at
// the moment it is made instead of after the book empties.
const describeBookStep = (step, referencePrice) => {
  const stepNumber = Number(step)
  const price = Number(referencePrice)
  if (!Number.isFinite(stepNumber) || !Number.isFinite(price) || price <= 0) return step
  const share = (stepNumber / price) * 100
  if (share <= 0) return step
  return `${step} · ${share < 0.01 ? '<0.01' : share.toFixed(2)}%`
}

const percentTone = (value) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed === 0) return 'flat'
  return parsed > 0 ? 'positive' : 'negative'
}

const FundingCountdown = ({ target }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return <dd>{formatCountdown(target, now)}</dd>
}

const StateBadge = ({ state }) => (
  <span className={`futures-workstation-state is-${state ?? 'loading'}`} role="status">
    {(state ?? 'loading').toUpperCase()}
  </span>
)

const EMPTY_CANDLE_HISTORY = Object.freeze({
  symbol: null,
  interval: null,
  rows: Object.freeze([]),
  exhausted: false,
})

export const FuturesWorkstationView = ({
  identity,
  state,
  selectedSymbol,
  selectedInterval,
  draftPrice,
  ownedOrders = EMPTY_ROWS,
  ownedPositions = EMPTY_ROWS,
  candleHistory = EMPTY_CANDLE_HISTORY,
  onLoadHistory,
  tradingRail,
  portfolioDock = null,
  symbolHistory = EMPTY_SYMBOL_HISTORY,
  accountSynchronizing = false,
  uiScale = UI_SCALE_DEFAULT,
  onToggleFavorite,
  onUiScaleChange,
  onDraftPriceChange,
  onTradingGesture,
  onOrderLift,
  onOrderDrop,
  onOrderCancel,
  onOrderEdit,
  onRetry,
  onTapeConfigurationChange,
  onDepthRangeChange,
  onSymbolChange,
  onIntervalChange,
}) => {
  const [search, setSearch] = useState('')
  const [localDraftPrice, setLocalDraftPrice] = useState(null)
  const [drawingMode, setDrawingMode] = useState(false)
  const [drawings, setDrawings] = useState(EMPTY_ROWS)
  const [alerts, setAlerts] = useState(EMPTY_ROWS)
  const [tapePaused, setTapePaused] = useState(false)
  const [pausedTrades, setPausedTrades] = useState(EMPTY_ROWS)
  // Tape settings outlive the session: the operator tunes them once for the
  // desk, not once per launch. The workstation hook seeds its own reference
  // from the same store, so a restored setting is re-applied on subscribe
  // rather than only displayed here.
  const [storedTapeSettings] = useState(readStoredTapeSettings)
  const [tapeSettings, setTapeSettings] = useState(storedTapeSettings)
  const [tapeThrottleInput, setTapeThrottleInput] = useState(storedTapeSettings.throttleEnabled)
  const [tapeTimeoutInput, setTapeTimeoutInput] = useState(String(storedTapeSettings.timeoutMs))
  const [tapeNotionalInput, setTapeNotionalInput] = useState(storedTapeSettings.minNotionalUsdt)
  const [tapeSettingsError, setTapeSettingsError] = useState(null)
  // How this contract's book is read: restored for the contract it was chosen
  // for rather than reset, and rather than carried over as one global setting —
  // a step is a multiple of the contract's own tick, and the same multiplier is
  // a different share of price elsewhere.
  const [bookGrouping, setBookGrouping] = useState(
    () => readStoredBookView(selectedSymbol).stepMultiplier,
  )
  const [bookSideMode, setBookSideMode] = useState(
    () => readStoredBookView(selectedSymbol).sideMode,
  )
  const [measuredBookRows, setMeasuredBookRows] = useState(null)
  // The price previously shown, with the contract it belonged to: a direction
  // is only a direction within one book.
  const [lastTick, setLastTick] = useState(NEUTRAL_TICK)
  const askSideRef = useRef(null)
  const bidSideRef = useRef(null)
  const lastBookLeftClickRef = useRef({ at: 0, price: null, modifier: null, symbol: null })
  const lastBookRightClickRef = useRef({ at: 0, price: null, modifier: null, symbol: null })
  const selectedDraftPrice = draftPrice === undefined ? localDraftPrice : draftPrice
  // The row is as tall as the type it carries, so the count that fits and the
  // height the rows are drawn at come from one number rather than from a CSS
  // constant and a JS constant free to disagree with it.
  const bookRowHeight = Math.max(11, Math.round(BOOK_ROW_HEIGHT_PX * uiScale))

  useEffect(() => {
    lastBookLeftClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
    lastBookRightClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
    // These controls are display-only and belong to one selected-symbol owner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalDraftPrice(null)
    setDrawingMode(false)
    setDrawings(EMPTY_ROWS)
    setAlerts(EMPTY_ROWS)
    setTapePaused(false)
    setPausedTrades(EMPTY_ROWS)
    // Not a reset: the book opens the way this contract was last read, and at
    // both sides and 1× for a contract never configured.
    const storedBookView = readStoredBookView(selectedSymbol)
    setBookGrouping(storedBookView.stepMultiplier)
    setBookSideMode(storedBookView.sideMode)
  }, [selectedSymbol])

  const resources = state.resources
  const selectionOwned = state.symbol === selectedSymbol
  const contracts = resources.catalog?.contracts ?? EMPTY_ROWS
  const header = selectionOwned ? resources.header : null
  const candles = selectionOwned ? resources.candles : null
  const depth = selectionOwned ? resources.depth : null
  const trades = selectionOwned ? resources.trades : null
  const liveTrades = trades?.rows ?? EMPTY_ROWS
  const selectedContract = contracts.find(contract => contract.symbol === selectedSymbol) ?? null
  const baseAsset = selectedContract?.baseAsset ?? selectedSymbol.replace(/USDT$/, '')
  // Both legs of the day's volume, each with its unit named. The quote leg is the
  // figure the cell abbreviates; the base leg is the same day counted in contracts
  // and belongs beside it rather than instead of it.
  const volumeDetail = [
    header?.quoteVolume ? `${header.quoteVolume} USDT` : null,
    header?.volume ? `${header.volume} ${baseAsset}` : null,
  ].filter(Boolean).join(' · ') || undefined
  const aggregateState = !selectionOwned || state.status === 'idle' ? 'loading' : state.status
  const identityState = aggregateState === 'live' && accountSynchronizing
    ? 'sync'
    : aggregateState
  const resourceState = resource => resource?.state ?? aggregateState
  const contractsUnavailable = selectionOwned && state.status === 'unavailable'
  const candlesState = resourceState(candles)
  const liveCandles = candles?.contract ?? EMPTY_ROWS
  // History is drawn behind the live window, never over it: the streaming rows
  // own the tail, and anything the history read repeats is dropped.
  const chartCandles = useMemo(() => {
    const history = candleHistory.symbol === selectedSymbol
      && candleHistory.interval === selectedInterval
      ? candleHistory.rows
      : EMPTY_ROWS
    if (history.length === 0) return liveCandles
    if (liveCandles.length === 0) return history
    const oldestLive = liveCandles[0].openTime
    const behind = history.filter(row => row.openTime < oldestLive)
    return behind.length === 0 ? liveCandles : [...behind, ...liveCandles]
  }, [candleHistory, liveCandles, selectedInterval, selectedSymbol])
  const depthState = resourceState(depth)
  const tradesState = resourceState(trades)
  const contractsUnavailableMessage = state.reasonCode === 'RECONNECT_EXHAUSTED'
    ? 'Contracts stream stopped after repeated reconnect failures.'
    : state.reasonCode === 'LOCAL_SUBSCRIBE_REJECTED'
      ? 'Contracts subscription was rejected by the local connection.'
      : 'Contracts are unavailable. Fix the reported connection issue, then retry.'

  const favorites = useMemo(() => new Set(symbolHistory.favorites), [symbolHistory.favorites])
  const searchQuery = search.trim().toUpperCase()
  // Recency belongs to local history, not to the asynchronous catalogue. Resolve
  // each stored symbol in place when metadata arrives and keep a pending contract
  // selectable before that happens.
  const recentContracts = useMemo(() => {
    const catalogBySymbol = new Map(contracts.map(contract => [contract.symbol, contract]))
    return [...new Set(symbolHistory.recent ?? EMPTY_ROWS)].map(symbol => (
      catalogBySymbol.get(symbol) ?? Object.freeze({
        symbol,
        baseAsset: symbol.replace(/USDT$/, ''),
        contractType: 'RECENT',
        pending: true,
      })
    ))
  }, [contracts, symbolHistory.recent])
  const recentContractSymbols = useMemo(
    () => new Set(recentContracts.map(contract => contract.symbol)),
    [recentContracts],
  )
  const visibleContracts = useMemo(() => {
    const bySymbol = new Map(contracts.map(contract => [contract.symbol, contract]))
    for (const contract of recentContracts) {
      if (!bySymbol.has(contract.symbol)) bySymbol.set(contract.symbol, contract)
    }
    const candidates = searchQuery
      ? [...bySymbol.values()].filter(contract => (
        contract.symbol.includes(searchQuery) || contract.baseAsset.includes(searchQuery)
      ))
      : contracts.filter(contract => !recentContractSymbols.has(contract.symbol))
    return orderFuturesContracts(candidates, symbolHistory).slice(0, 128)
  }, [contracts, recentContractSymbols, recentContracts, searchQuery, symbolHistory])
  const catalogPending = contracts.length === 0 && !contractsUnavailable

  const pickPrice = useCallback((price) => {
    if (typeof onDraftPriceChange === 'function') onDraftPriceChange(price)
    else setLocalDraftPrice(price)
    if (drawingMode) {
      setDrawings(previous => Object.freeze([
        ...previous.slice(-15),
        Object.freeze({ id: `drawing-${previous.length + 1}`, price }),
      ]))
    }
  }, [drawingMode, onDraftPriceChange])

  const emitBookGesture = useCallback((event, button, price) => {
    const gesture = resolveFuturesTradingGesture({
      button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
    if (!gesture) return false
    event.preventDefault()
    event.stopPropagation()
    onTradingGesture?.({
      ...gesture,
      price,
      source: 'order-book',
      // The confirmation opens on the level the operator clicked, not across
      // the workspace in the trading rail.
      anchor: { x: event.clientX, y: event.clientY },
    })
    return true
  }, [onTradingGesture])

  const handleBookContextMenu = useCallback((event, price) => {
    const gesture = resolveFuturesTradingGesture({
      button: 'right',
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
    if (!gesture) {
      lastBookRightClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
      return
    }
    event.preventDefault()
    const modifier = event.altKey ? 'alt' : 'ctrl'
    const current = { at: Date.now(), price, modifier, symbol: selectedSymbol }
    const previous = lastBookRightClickRef.current
    lastBookRightClickRef.current = current
    if (current.at - previous.at > 350
      || previous.price !== price
      || previous.modifier !== modifier
      || previous.symbol !== selectedSymbol) return
    lastBookRightClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
    emitBookGesture(event, 'right', price)
  }, [emitBookGesture, selectedSymbol])

  const handleBookClick = useCallback((event, price) => {
    pickPrice(price)
    const gesture = resolveFuturesTradingGesture({
      button: 'left',
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    })
    if (!gesture) {
      lastBookLeftClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
      return
    }
    const modifier = event.altKey ? 'alt' : 'ctrl'
    const current = { at: Date.now(), price, modifier, symbol: selectedSymbol }
    const previous = lastBookLeftClickRef.current
    lastBookLeftClickRef.current = current
    if (current.at - previous.at > 350
      || previous.price !== price
      || previous.modifier !== modifier
      || previous.symbol !== selectedSymbol) return
    lastBookLeftClickRef.current = { at: 0, price: null, modifier: null, symbol: null }
    emitBookGesture(event, 'left', price)
  }, [emitBookGesture, pickPrice, selectedSymbol])

  // How many rows the panel can actually hold. Sizing the sides by content and
  // letting flex shrink take the difference clipped the last five rows of each
  // side — and on the ask side, which is drawn farthest-first, those five are
  // the best asks. Measuring means the rows dropped are the ones nobody reads.
  //
  // Each side is measured directly rather than derived from the body less the
  // last-print row: that row carries vertical margins, which `offsetHeight`
  // does not count, and eight unaccounted pixels are half a row on screen.
  // A side's height is `flex: 1 1 0`, so it does not depend on the rows the
  // measurement puts in it and cannot feed back into itself.
  useEffect(() => {
    const sides = [askSideRef.current, bidSideRef.current].filter(side => side !== null)
    if (sides.length === 0) return undefined
    const measure = () => {
      const available = Math.min(...sides.map(side => side.clientHeight))
      // Nothing laid out yet: keep the default rather than render an empty book.
      if (!(available > 0)) return
      const rows = Math.floor(available / bookRowHeight)
      setMeasuredBookRows(Math.min(Math.max(rows, 1), MAX_DEPTH_LEVELS_PER_SIDE))
    }
    measure()
    const ResizeObserverImpl = globalThis.ResizeObserver
    if (typeof ResizeObserverImpl !== 'function') return undefined
    const observer = new ResizeObserverImpl(measure)
    for (const side of sides) observer.observe(side)
    return () => observer.disconnect()
  }, [bookRowHeight, bookSideMode])

  // Written on the choice, not on every render: what is stored is what the
  // operator picked for this contract.
  const chooseBookSideMode = useCallback((sideMode) => {
    setBookSideMode(sideMode)
    writeStoredBookView(selectedSymbol, { sideMode, stepMultiplier: bookGrouping })
  }, [bookGrouping, selectedSymbol])

  const chooseBookGrouping = useCallback((stepMultiplier) => {
    setBookGrouping(stepMultiplier)
    writeStoredBookView(selectedSymbol, { sideMode: bookSideMode, stepMultiplier })
  }, [bookSideMode, selectedSymbol])

  const toggleFavorite = useCallback((symbol) => {
    onToggleFavorite?.(symbol)
  }, [onToggleFavorite])

  const addDisplayAlert = useCallback(() => {
    if (!selectedDraftPrice) return
    setAlerts(previous => Object.freeze([
      ...previous.slice(-15),
      Object.freeze({ id: `alert-${previous.length + 1}`, price: selectedDraftPrice }),
    ]))
  }, [selectedDraftPrice])

  const toggleTape = useCallback(() => {
    if (!tapePaused) setPausedTrades(liveTrades)
    setTapePaused(previous => !previous)
  }, [liveTrades, tapePaused])

  const applyTapeSettings = useCallback((event) => {
    event.preventDefault()
    const timeoutMs = Number(tapeTimeoutInput)
    const minNotionalUsdt = normalizeTapeNotional(tapeNotionalInput)
    if (!/^[0-9]+$/.test(tapeTimeoutInput)
      || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < FUTURES_WORKSTATION_TAPE_LIMITS.MIN_TIMEOUT_MS
      || timeoutMs > FUTURES_WORKSTATION_TAPE_LIMITS.MAX_TIMEOUT_MS) {
      setTapeSettingsError(
        `Timeout must be an integer from ${FUTURES_WORKSTATION_TAPE_LIMITS.MIN_TIMEOUT_MS} to ${FUTURES_WORKSTATION_TAPE_LIMITS.MAX_TIMEOUT_MS} ms.`,
      )
      return
    }
    if (minNotionalUsdt === null) {
      setTapeSettingsError('Minimum displayed trade must be a finite non-negative USDT value.')
      return
    }
    const next = Object.freeze({
      throttleEnabled: tapeThrottleInput,
      timeoutMs,
      minNotionalUsdt,
    })
    let accepted = true
    try {
      accepted = onTapeConfigurationChange?.(next) !== false
    } catch {
      accepted = false
    }
    if (!accepted) {
      setTapeSettingsError('Tape configuration was rejected by the local workstation.')
      return
    }
    setTapeSettings(next)
    setTapeTimeoutInput(String(timeoutMs))
    setTapeNotionalInput(minNotionalUsdt)
    setTapeSettingsError(null)
    // Only a configuration the workstation accepted is remembered, so a restart
    // never restores a setting that was never in effect.
    writeStoredTapeSettings(next)
  }, [onTapeConfigurationChange, tapeNotionalInput, tapeThrottleInput, tapeTimeoutInput])

  const changeTone = percentTone(header?.priceChangePercent)
  const fundingTone = percentTone(header?.fundingRatePercent)
  const displayedTrades = tapePaused ? pausedTrades : liveTrades
  const lastTrade = liveTrades[0] ?? null
  // The tape is a filtered, throttled *display* of prints — the service drops
  // anything under the operator's minimum notional on ingestion and only arms
  // its throttle when an eligible print arrives. Reading a price off it means
  // a desk set to "≥ 400 USDT" watches a frozen number while depth and the
  // chart run. The newest candle's close is the same last trade the chart is
  // drawing, at the kline stream's own cadence, and no display setting can
  // filter it; the ticker is next, and the tape only if there is nothing else.
  const lastPrice = (candlesState === 'live' ? liveCandles.at(-1)?.close : null)
    ?? header?.lastPrice
    ?? lastTrade?.price
    ?? null
  // The stream pads its prices: a kline close arrives as `2.6010000` and a mark
  // as `58500.00`, and those zeros are the payload's fixed width rather than the
  // contract's precision. They are dropped for display only — the raw value still
  // seeds order drafts and the step description, where an exact decimal matters —
  // and nothing is rounded away, so a coin quoted at 0.00123 keeps every digit.
  const lastPriceText = formatExchangePrice(lastPrice, null, '—')
  // Direction is the change from the price previously on screen. Taking it from
  // the newest displayed trade's maker flag would report the side of a print
  // the filter left on screen long after the market moved past it. The first
  // price of a contract is a reading rather than a move, and an unchanged price
  // keeps the direction it last had instead of dropping to neutral.
  const carriedTick = lastTick.symbol === selectedSymbol
  let lastDirection = carriedTick ? lastTick.direction : 'flat'
  if (lastPrice !== null && (!carriedTick || lastTick.price !== lastPrice)) {
    const moved = Number(lastPrice) - Number(lastTick.price)
    if (carriedTick && Number.isFinite(moved) && moved !== 0) {
      lastDirection = moved > 0 ? 'up' : 'down'
    }
    setLastTick({ symbol: selectedSymbol, price: lastPrice, direction: lastDirection })
  }
  const lastDirectionLabel = lastDirection === 'up'
    ? 'moving up'
    : lastDirection === 'down' ? 'moving down' : 'neutral'
  const groupSteps = useMemo(
    () => futuresBookGroupSteps(selectedContract?.filters?.price?.tickSize ?? null),
    [selectedContract],
  )
  // 1× is "as the exchange sent it": no alignment pass at all, so a contract
  // whose filters disagree with its quoted prices still renders level by level.
  const activeGroupStep = bookGrouping === 1
    ? null
    : groupSteps.find(entry => entry.multiplier === bookGrouping)?.step ?? null
  const depthLevelsPerSide = measuredBookRows ?? VISIBLE_DEPTH_LEVELS_PER_SIDE
  // Grouping happens on the whole delivered book, then the visible window is
  // taken — otherwise a coarse step would only ever aggregate the first rows.
  // Both sides are grouped in every mode: a hidden side still carries half of
  // the pressure split.
  const visibleAsks = useMemo(() => [...groupFuturesBookLevels({
    levels: depth?.asks ?? EMPTY_ROWS,
    side: 'ask',
    step: activeGroupStep,
    limit: depthLevelsPerSide,
  })].reverse(), [activeGroupStep, depth, depthLevelsPerSide])
  const visibleBids = useMemo(() => groupFuturesBookLevels({
    levels: depth?.bids ?? EMPTY_ROWS,
    side: 'bid',
    step: activeGroupStep,
    limit: depthLevelsPerSide,
  }), [activeGroupStep, depth, depthLevelsPerSide])
  // The book is bought as deep as it is read, and this is the reading: the rows
  // on screen times the step they are grouped by. Stated whenever it changes —
  // a coarser step, a taller panel, another contract — so the backend can buy
  // the page that covers it instead of the deepest page every time.
  const depthRange = futuresBookDepthRange({
    step: activeGroupStep ?? selectedContract?.filters?.price?.tickSize ?? null,
    rows: depthLevelsPerSide,
  })
  useEffect(() => {
    if (depthRange === null) return
    onDepthRangeChange?.(depthRange)
  }, [depthRange, onDepthRangeChange, selectedSymbol])

  // The heaviest levels on each visible side. Only the size is thickened: the
  // wall is the size, and a whole bold row would drag its price and its running
  // total into the marking with it — five loud rows instead of five walls.
  const bookWalls = useMemo(() => ({
    ask: futuresBookWallKeys(visibleAsks),
    bid: futuresBookWallKeys(visibleBids),
  }), [visibleAsks, visibleBids])

  // Where the operator's own working orders sit in the book. Matched by the
  // row's bucket, not its printed price, so a grouped row still marks an order
  // resting anywhere inside it.
  const ownBookLevels = useMemo(() => {
    const marks = { bid: new Map(), ask: new Map() }
    for (const order of ownedOrders) {
      if (order.symbol !== selectedSymbol) continue
      const side = order.side === 'BUY' ? 'bid' : 'ask'
      const key = futuresBookGroupKey({ price: order.price, side, step: activeGroupStep })
      if (key === null) continue
      marks[side].set(key, (marks[side].get(key) ?? 0) + 1)
    }
    return marks
  }, [activeGroupStep, ownedOrders, selectedSymbol])

  // Depth bars are scaled against the deepest visible level on either side, so
  // the two halves of the book stay comparable to each other.
  const deepestVisibleTotal = [...visibleAsks, ...visibleBids].reduce(
    (deepest, level) => (level.cumulativeUsdt > deepest ? level.cumulativeUsdt : deepest),
    0,
  )
  const depthShare = (level) => {
    if (deepestVisibleTotal <= 0) return '0%'
    return `${Math.min(100, (level.cumulativeUsdt / deepestVisibleTotal) * 100).toFixed(2)}%`
  }
  // Which side is leaning on the book: the resting USDT on each visible side,
  // measured over exactly the levels on screen, so changing the step changes
  // how wide a range the reading covers.
  const askDepthUsdt = visibleAsks[0]?.cumulativeUsdt ?? 0
  const bidDepthUsdt = visibleBids.at(-1)?.cumulativeUsdt ?? 0
  const bookDepthUsdt = askDepthUsdt + bidDepthUsdt
  const bidPressure = bookDepthUsdt > 0 ? (bidDepthUsdt / bookDepthUsdt) * 100 : 0
  // How far from the last trade the rows on screen actually reach. The pressure
  // reading above is measured over exactly those rows, so without this a 0.3%
  // reading and a 10% reading print as the same number and mean opposite things.
  const bookReach = useMemo(() => {
    const reference = Number(lastPrice)
    if (!Number.isFinite(reference) || reference <= 0) return null
    const edges = [visibleAsks[0]?.price, visibleBids.at(-1)?.price]
      .map(Number)
      .filter(edge => Number.isFinite(edge) && edge > 0)
      .map(edge => (Math.abs(edge - reference) / reference) * 100)
    if (edges.length === 0) return null
    const reach = Math.max(...edges)
    if (reach <= 0) return null
    return `±${reach < 0.01 ? '<0.01' : reach.toFixed(2)}%`
  }, [lastPrice, visibleAsks, visibleBids])

  return (
    <section className="futures-workstation" aria-label={`${identity} live trading workstation`}>
      <div className="futures-workstation-identity" data-testid="futures-workstation-identity">
        <strong>{identity}</strong>
        <StateBadge state={identityState} />
        {selectionOwned && state.reasonCode ? (
          <code className="futures-workstation-reason" aria-label="Futures workstation reason">
            reason {state.reasonCode}
          </code>
        ) : null}
        <div className="futures-workstation-scale" role="group" aria-label="Interface scale">
          <span>{Math.round(uiScale * 100)}%</span>
          <button
            type="button"
            aria-label="Decrease interface scale"
            disabled={uiScale <= UI_SCALE_MIN}
            onClick={() => onUiScaleChange?.(stepUiScale(uiScale, -1))}
          >
            A−
          </button>
          <button
            type="button"
            aria-label="Reset interface scale"
            disabled={uiScale === UI_SCALE_DEFAULT}
            onClick={() => onUiScaleChange?.(UI_SCALE_DEFAULT)}
          >
            A
          </button>
          <button
            type="button"
            aria-label="Increase interface scale"
            disabled={uiScale >= UI_SCALE_MAX}
            onClick={() => onUiScaleChange?.(stepUiScale(uiScale, 1))}
          >
            A+
          </button>
        </div>
      </div>

      <aside className="futures-workstation-instruments" aria-label="USDⓈ-M contract selector">
        <div className="futures-workstation-section-heading">
          <div>
            <span>Contracts</span>
            <strong>USDⓈ-M only</strong>
          </div>
        </div>
        <label className="futures-workstation-search">
          <span>Search symbol</span>
          <input
            aria-label="Search Futures contracts"
            value={search}
            onChange={event => setSearch(event.target.value.toUpperCase())}
            placeholder="BTC, ETH, SOL…"
            maxLength={20}
          />
        </label>
        {!searchQuery && recentContracts.length > 0 ? (
          <div
            className="futures-workstation-recent-contracts"
            aria-label="Recent contracts"
            role="list"
          >
            {recentContracts.map(contract => (
              <div
                className={`futures-workstation-recent-contract${
                  contract.symbol === selectedSymbol ? ' is-selected' : ''
                }`}
                data-pending={contract.pending ? 'true' : undefined}
                key={contract.symbol}
                role="listitem"
              >
                <button
                  type="button"
                  className="futures-workstation-recent-select"
                  aria-pressed={contract.symbol === selectedSymbol}
                  title={contract.pending ? `${contract.symbol} catalogue loading` : contract.symbol}
                  onClick={() => onSymbolChange(contract.symbol)}
                >
                  <strong>{contract.symbol}</strong>
                </button>
                <button
                  type="button"
                  className="futures-workstation-recent-favorite"
                  aria-label={`${favorites.has(contract.symbol) ? 'Remove' : 'Add'} ${contract.symbol} favorite`}
                  aria-pressed={favorites.has(contract.symbol)}
                  onClick={() => toggleFavorite(contract.symbol)}
                >
                  {favorites.has(contract.symbol) ? '★' : '☆'}
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="futures-workstation-contract-list">
          {visibleContracts.map(contract => (
            <div
              className={`futures-workstation-contract${
                contract.symbol === selectedSymbol ? ' is-selected' : ''
              }`}
              key={contract.symbol}
            >
              <button
                type="button"
                className="futures-workstation-favorite"
                aria-label={`${favorites.has(contract.symbol) ? 'Remove' : 'Add'} ${contract.symbol} favorite`}
                aria-pressed={favorites.has(contract.symbol)}
                onClick={() => toggleFavorite(contract.symbol)}
              >
                {favorites.has(contract.symbol) ? '★' : '☆'}
              </button>
              <button
                type="button"
                className="futures-workstation-contract-select"
                onClick={() => onSymbolChange(contract.symbol)}
                aria-pressed={contract.symbol === selectedSymbol}
              >
                <strong>{contract.symbol}</strong>
                <span>{contract.pending ? 'loading' : contract.contractType}</span>
              </button>
            </div>
          ))}
          {visibleContracts.length === 0
            && (searchQuery || recentContracts.length === 0)
            && !contractsUnavailable ? (
            <p className="futures-workstation-empty">
              {catalogPending ? 'Loading contracts…' : 'No matching USDⓈ-M contract.'}
            </p>
          ) : null}
          {(visibleContracts.length > 0 || recentContracts.length > 0) && catalogPending ? (
            <p className="futures-workstation-empty">Loading contracts…</p>
          ) : null}
        </div>
        {contractsUnavailable ? (
          <div className="futures-workstation-contract-retry" role="alert">
            <span>{contractsUnavailableMessage}</span>
            <button type="button" disabled={typeof onRetry !== 'function'} onClick={onRetry}>Retry</button>
          </div>
        ) : null}
        {tradingRail}
      </aside>

      <header className="futures-workstation-market-header" aria-label="Futures market header">
        <div className="futures-workstation-symbol-title">
          <span>{selectedContract?.contractType ?? 'CONTRACT'}</span>
          <strong>{selectedSymbol}</strong>
          <small>{selectedContract?.status ?? 'LOADING'}</small>
        </div>
        <dl>
          <div className="is-primary"><dt>Last</dt><dd>{lastPriceText}</dd></div>
          <div className={`is-change is-${changeTone}`}>
            <dt>24h change</dt>
            <dd>{displayPercent(header?.priceChangePercent)}</dd>
          </div>
          <div><dt>24h high</dt><dd>{header?.highPrice ?? '—'}</dd></div>
          <div><dt>24h low</dt><dd>{header?.lowPrice ?? '—'}</dd></div>
          {/* A day's volume is eight or ten digits, and read for its magnitude:
              nobody compares the last three. Abbreviated it is a size the eye
              takes in at once, and the exact figure stays in the title.
              It is the quote leg — what the exchange's own app shows and what a
              trader means by "volume". The base count is the same day measured in
              contracts, and a USDT abbreviation over it reads as a lie: 19.9B of
              BMT is 571M of USDT. It stays in the title, where its unit is named. */}
          <div className="is-volume">
            <dt>24h volume, USDT</dt>
            <dd title={volumeDetail}>
              {formatCompactUsdt(header?.quoteVolume, '—', 1)}
            </dd>
          </div>
          {/* Funding is a cost or an income depending on the leg; its sign is
              the whole point, so it is coloured like one. */}
          <div className={`is-change is-${fundingTone}`}>
            <dt>Funding</dt>
            <dd>{displayPercent(header?.fundingRatePercent)}</dd>
          </div>
          <div><dt>Next funding</dt><FundingCountdown target={header?.nextFundingTime} /></div>
        </dl>
      </header>

      <main className="futures-workstation-chart" data-state={candlesState}>
        <div className="futures-workstation-chart-toolbar">
          <div className="futures-workstation-intervals" role="group" aria-label="Chart interval">
            {FUTURES_WORKSTATION_INTERVALS.map(interval => (
              <button
                type="button"
                key={interval}
                className={interval === selectedInterval ? 'is-selected' : ''}
                aria-pressed={interval === selectedInterval}
                onClick={() => onIntervalChange(interval)}
              >
                {interval}
              </button>
            ))}
          </div>
          <div className="futures-workstation-drawing-tools" role="group" aria-label="Display-only chart tools">
            <button
              type="button"
              className={drawingMode ? 'is-selected' : ''}
              aria-pressed={drawingMode}
              disabled={candlesState !== 'live'}
              onClick={() => setDrawingMode(previous => !previous)}
            >
              Horizontal drawing
            </button>
            <button type="button" onClick={() => setDrawings(EMPTY_ROWS)} disabled={drawings.length === 0}>
              Clear drawings
            </button>
            <button type="button" onClick={addDisplayAlert} disabled={!selectedDraftPrice || candlesState !== 'live'}>
              Add display alert
            </button>
            <button type="button" onClick={() => setAlerts(EMPTY_ROWS)} disabled={alerts.length === 0}>
              Clear alerts
            </button>
          </div>
        </div>
        {/* `onOrderDrop` is never gated on the chart being live: a drag already
            in flight owes a replacement whatever the candles are doing. */}
        <div className="futures-workstation-chart-frame">
          <FuturesWorkstationChart
            symbol={selectedSymbol}
            candles={chartCandles}
            historyExhausted={candleHistory.exhausted}
            onLoadHistory={onLoadHistory}
            priceTickSize={selectedContract?.filters.price?.tickSize ?? null}
            quantityStepSize={selectedContract?.filters.quantity?.stepSize ?? null}
            drawings={drawings}
            alerts={alerts}
            ownedOrders={ownedOrders}
            positions={ownedPositions}
            onPricePick={candlesState === 'live' ? pickPrice : IGNORE_PRICE_PICK}
            onTradingGesture={candlesState === 'live' ? onTradingGesture : undefined}
            onOrderLift={candlesState === 'live' ? onOrderLift : undefined}
            onOrderDrop={onOrderDrop}
            onOrderCancel={onOrderCancel}
            onOrderEdit={onOrderEdit}
          />
          {candlesState !== 'live' ? (
            <div className={`futures-workstation-overlay is-${candlesState}`}>
              <strong>{candlesState.toUpperCase()}</strong>
              <span>Chart remains read-only until authoritative data is live.</span>
            </div>
          ) : null}
        </div>
      </main>

      <aside
        className="futures-workstation-depth"
        data-state={depthState}
        style={{ '--fx-book-row-height': `${bookRowHeight}px` }}
      >
        <div className="futures-workstation-section-heading">
          <div><span>Order book</span><strong>USDT</strong></div>
          <StateBadge state={depthState} />
        </div>
        {/* The side control shares the step's line on purpose: the panel is
            already short of the room its rows need, and a control row of its
            own would cost six of them. */}
        <div className="futures-workstation-book-controls">
          <div
            className="futures-workstation-book-modes"
            role="group"
            aria-label="Order book sides"
          >
            {FUTURES_BOOK_SIDE_MODES.map(mode => (
              <button
                type="button"
                key={mode}
                className={`is-${mode}${bookSideMode === mode ? ' is-selected' : ''}`}
                aria-label={BOOK_SIDE_MODE_LABELS[mode]}
                aria-pressed={bookSideMode === mode}
                title={BOOK_SIDE_MODE_LABELS[mode]}
                onClick={() => chooseBookSideMode(mode)}
              >
                <i aria-hidden="true" />
              </button>
            ))}
          </div>
          {groupSteps.length > 0 ? (
            <label className="futures-workstation-book-grouping">
              <span>Step</span>
              <select
                aria-label="Order book price step"
                value={bookGrouping}
                onChange={event => chooseBookGrouping(Number(event.target.value))}
              >
                {groupSteps.map(entry => (
                  <option key={entry.multiplier} value={entry.multiplier}>
                    {describeBookStep(entry.step, lastPrice)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="futures-workstation-book-body">
        {bookSideMode === 'bids' ? null : (
        <div className="futures-workstation-book-side is-ask" ref={askSideRef}>
          {visibleAsks.map(level => (
            <button
              type="button"
              key={`ask-${level.price}`}
              className={ownBookLevels.ask.has(level.groupKey) ? 'has-own-order' : undefined}
              title={ownBookLevels.ask.get(level.groupKey)
                ? `${ownBookLevels.ask.get(level.groupKey)} working sell order here`
                : undefined}
              aria-label={`Ask book level: price ${level.price}; level ${formatCompactUsdt(level.notionalUsdt)} USDT; cumulative ${formatCompactUsdt(level.cumulativeUsdt)} USDT`}
              disabled={depthState !== 'live'}
              style={{ '--futures-depth-share': depthShare(level) }}
              onClick={event => handleBookClick(event, level.price)}
              onContextMenu={event => handleBookContextMenu(event, level.price)}
            >
              {ownBookLevels.ask.has(level.groupKey)
                ? <i className="futures-workstation-book-own is-sell" aria-hidden="true" />
                : null}
              <span>{level.price}</span>
              <span className={bookWalls.ask.has(level.groupKey) ? 'is-wall' : undefined}>
                {formatCompactUsdt(level.notionalUsdt)}
              </span>
              <span>{formatCompactUsdt(level.cumulativeUsdt)}</span>
            </button>
          ))}
        </div>
        )}
        <div
          className={`futures-workstation-book-last is-${lastDirection}`}
          role="group"
          aria-label={`Last traded price ${lastPriceText}, ${lastDirectionLabel}`}
        >
          <strong>{lastPriceText}</strong>
        </div>
        {bookSideMode === 'asks' ? null : (
        <div className="futures-workstation-book-side is-bid" ref={bidSideRef}>
          {visibleBids.map(level => (
            <button
              type="button"
              key={`bid-${level.price}`}
              className={ownBookLevels.bid.has(level.groupKey) ? 'has-own-order' : undefined}
              title={ownBookLevels.bid.get(level.groupKey)
                ? `${ownBookLevels.bid.get(level.groupKey)} working buy order here`
                : undefined}
              aria-label={`Bid book level: price ${level.price}; level ${formatCompactUsdt(level.notionalUsdt)} USDT; cumulative ${formatCompactUsdt(level.cumulativeUsdt)} USDT`}
              disabled={depthState !== 'live'}
              style={{ '--futures-depth-share': depthShare(level) }}
              onClick={event => handleBookClick(event, level.price)}
              onContextMenu={event => handleBookContextMenu(event, level.price)}
            >
              {ownBookLevels.bid.has(level.groupKey)
                ? <i className="futures-workstation-book-own is-buy" aria-hidden="true" />
                : null}
              <span>{level.price}</span>
              <span className={bookWalls.bid.has(level.groupKey) ? 'is-wall' : undefined}>
                {formatCompactUsdt(level.notionalUsdt)}
              </span>
              <span>{formatCompactUsdt(level.cumulativeUsdt)}</span>
            </button>
          ))}
        </div>
        )}
        </div>
        {bookDepthUsdt > 0 ? (
          <div
            className="futures-workstation-book-pressure"
            aria-label="Order book buy and sell pressure"
            title={`${formatCompactUsdt(bidDepthUsdt)} USDT bid · ${formatCompactUsdt(askDepthUsdt)} USDT ask`}
          >
            <div className="futures-workstation-book-pressure-bar">
              <span className="is-buy" style={{ width: `${bidPressure.toFixed(2)}%` }} />
              <span className="is-sell" style={{ width: `${(100 - bidPressure).toFixed(2)}%` }} />
            </div>
            <div className="futures-workstation-book-pressure-legend">
              <strong className="is-buy">B {bidPressure.toFixed(2)}%</strong>
              {bookReach ? (
                <span
                  className="futures-workstation-book-reach"
                  title="Price range the split is measured over"
                >
                  {bookReach}
                </span>
              ) : null}
              <strong className="is-sell">{(100 - bidPressure).toFixed(2)}% S</strong>
            </div>
          </div>
        ) : null}
      </aside>

      <aside className="futures-workstation-trades" data-state={tradesState}>
        <details className="futures-workstation-tape-disclosure">
          <summary>
            <span>Aggregate trades</span>
            <strong>Bounded tape</strong>
          </summary>
          <div className="futures-workstation-tape-settings">
            <button type="button" className="futures-workstation-tape-pause" onClick={toggleTape}>
              {tapePaused ? 'Resume' : 'Pause'}
            </button>
            <form className="futures-workstation-tape-controls" onSubmit={applyTapeSettings}>
              <label className="futures-workstation-tape-toggle">
                <input
                  type="checkbox"
                  checked={tapeThrottleInput}
                  onChange={event => setTapeThrottleInput(event.target.checked)}
                />
                <span>Throttle</span>
              </label>
              <label>
                <span>Timeout (ms)</span>
                <input
                  aria-label="Tape timeout in ms"
                  inputMode="numeric"
                  value={tapeTimeoutInput}
                  onChange={event => setTapeTimeoutInput(event.target.value)}
                />
              </label>
              <label>
                <span>Min trade (USDT)</span>
                <input
                  aria-label="Minimum displayed trade in USDT"
                  inputMode="decimal"
                  value={tapeNotionalInput}
                  onChange={event => setTapeNotionalInput(event.target.value)}
                />
              </label>
              <button type="submit">Apply</button>
              <output className="futures-workstation-tape-effective" aria-live="polite">
                Effective: {tapeSettings.throttleEnabled ? 'throttled' : 'unthrottled'} ·{' '}
                {tapeSettings.timeoutMs} ms · ≥ {tapeSettings.minNotionalUsdt} USDT
              </output>
              {tapeSettingsError ? (
                <span className="futures-workstation-tape-error" role="alert">{tapeSettingsError}</span>
              ) : null}
            </form>
          </div>
        </details>
        <div className="futures-workstation-trade-rows">
          {displayedTrades.map(trade => (
            <div
              className={trade.buyerMaker ? 'is-sell' : 'is-buy'}
              key={trade.aggregateTradeId}
              role="group"
              aria-label={`Aggregate trade: price ${trade.price}; notional ${formatCompactUsdt(tradeNotionalUsdt(trade))} USDT; time ${formatTime(trade.tradeTime)}`}
            >
              <span>{trade.price}</span>
              <span title={`${trade.quantity} base`}>{formatCompactUsdt(tradeNotionalUsdt(trade))}</span>
              <span>{formatTime(trade.tradeTime)}</span>
            </div>
          ))}
          {displayedTrades.length === 0 ? <p className="futures-workstation-empty">Waiting for aggregate trades…</p> : null}
        </div>
      </aside>

      {portfolioDock}
    </section>
  )
}

export default FuturesWorkstationView
