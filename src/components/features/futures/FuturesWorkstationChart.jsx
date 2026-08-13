import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
} from 'lightweight-charts'
import { buildVolumeHistogramPresentation } from '../../../utils/chartVolume.js'
import {
  describeFuturesOrderIntent,
  describeFuturesPosition,
  orderNotionalUsdt,
} from '../../../utils/futuresOrderPresentation.js'
import {
  isFuturesTradingGestureTarget,
  resolveFuturesTradingGesture,
} from '../../../utils/futuresTradingGestures.js'
import { countPrependedRows, planSeriesDraw } from '../../../utils/chartSeriesDraw.js'
import { MeasurementOverlay } from '../../common/MeasurementOverlay.jsx'
import '../charts/ChartWrapper.css'

const toSeconds = milliseconds => Math.floor(milliseconds / 1000)

const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// The candles and their volume must cover exactly the same times. The library
// colours a histogram bar by looking up the row at the time it is drawing, so a
// row that reaches the candle series but not the volume series leaves it
// looking at nothing and the chart dies with "Value is null". Price decides
// whether a row is usable at all; a usable row whose volume is missing is drawn
// at zero rather than silently dropped from one series only.
const toChartRows = rows => rows.flatMap((row) => {
  const open = toNumber(row.open)
  const high = toNumber(row.high)
  const low = toNumber(row.low)
  const close = toNumber(row.close)
  if ([open, high, low, close].some(value => value === null)) return []
  return [{
    time: toSeconds(row.openTime),
    open,
    high,
    low,
    close,
    volume: toNumber(row.volume) ?? 0,
  }]
})

const toCandleData = rows => toChartRows(rows).map(({ volume: _volume, ...candle }) => candle)

const toVolumeData = rows => buildVolumeHistogramPresentation(toChartRows(rows), {
  upColor: 'rgba(40, 190, 140, 0.42)',
  downColor: 'rgba(241, 91, 105, 0.42)',
})

const toDraftString = (value) => (
  value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
)

const CANONICAL_NONNEGATIVE_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const ORDER_HANDLE_HALF_HEIGHT = 11
const ORDER_HANDLE_GAP = 24
const NOOP_ORDER_COORDINATE_REFRESH = () => {}
// Ask for the next page a few bars before the edge, so the candles are there by
// the time the operator scrolls onto them.
const HISTORY_PREFETCH_BARS = 12
const EMPTY_CLICK_CANDIDATE = Object.freeze({ at: 0, x: 0, y: 0, modifier: null })

const createPriceFormat = (tickSize) => {
  if (typeof tickSize !== 'string'
    || tickSize.length > 64
    || !CANONICAL_NONNEGATIVE_DECIMAL.test(tickSize)) return null
  const minMove = Number(tickSize)
  if (!Number.isFinite(minMove) || minMove <= 0) return null
  const fraction = tickSize.split('.')[1]?.replace(/0+$/, '') ?? ''
  return Object.freeze({
    type: 'price',
    precision: fraction.length,
    minMove,
  })
}

const rowTime = row => Number.isSafeInteger(row?.openTime) ? row.openTime : null

// A candle frame is parsed off the wire, so every row in it is a new object
// even where the market did not move — identity alone would call every tick a
// full redraw. Identity is still asked first: only the live window's rows are
// really new, and the history behind them is the same objects it was.
const sameDrawnCandle = (drawn, next) => drawn === next || (
  drawn?.openTime === next?.openTime
  && drawn?.open === next?.open
  && drawn?.high === next?.high
  && drawn?.low === next?.low
  && drawn?.close === next?.close
  && drawn?.volume === next?.volume
)

const DRAW_PLAN = Object.freeze({ timeOf: rowTime, sameRow: sameDrawnCandle })

const futuresOrderIdentity = order => (
  `${order?.symbol}:${order?.orderKind}:${order?.orderId}:${order?.clientOrderId}`
)

const layoutOrderCoordinates = (entries, height) => {
  if (entries.length === 0 || height <= 0) return []
  const top = Math.min(ORDER_HANDLE_HALF_HEIGHT, height / 2)
  const bottom = Math.max(top, height - ORDER_HANDLE_HALF_HEIGHT)
  const gap = entries.length <= 1
    ? 0
    : Math.min(ORDER_HANDLE_GAP, (bottom - top) / (entries.length - 1))
  const placed = entries
    .map((entry, originalIndex) => ({
      ...entry,
      anchorY: entry.y,
      originalIndex,
      y: Math.max(top, Math.min(bottom, entry.y)),
    }))
    .sort((left, right) => (
      left.y - right.y
      || futuresOrderIdentity(left.order).localeCompare(futuresOrderIdentity(right.order))
    ))

  for (let index = 1; index < placed.length; index += 1) {
    placed[index].y = Math.max(placed[index].y, placed[index - 1].y + gap)
  }
  if (placed.at(-1).y > bottom) {
    placed[placed.length - 1].y = bottom
    for (let index = placed.length - 2; index >= 0; index -= 1) {
      placed[index].y = Math.min(placed[index].y, placed[index + 1].y - gap)
    }
  }

  return placed
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map(({ originalIndex: _originalIndex, ...entry }) => entry)
}

export const FuturesWorkstationChart = ({
  symbol,
  candles,
  historyExhausted = false,
  onLoadHistory,
  priceTickSize,
  drawings,
  alerts,
  ownedOrders = [],
  positions = [],
  onPricePick,
  onTradingGesture,
  onOrderLift,
  onOrderDrop,
  onOrderCancel,
  onOrderEdit,
}) => {
  const measurementGeneration = useMemo(() => Symbol(symbol), [symbol])
  const containerRef = useRef(null)
  // Everything the drag listens on. The grip the drag starts from is gone a
  // moment later — the order it belonged to has been cancelled — so the pointer
  // is captured by the shell, which outlives the whole gesture.
  const shellRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const overlayLinesRef = useRef([])
  const onPricePickRef = useRef(onPricePick)
  const onTradingGestureRef = useRef(onTradingGesture)
  const onOrderLiftRef = useRef(onOrderLift)
  const onOrderDropRef = useRef(onOrderDrop)
  const onOrderCancelRef = useRef(onOrderCancel)
  const onOrderEditRef = useRef(onOrderEdit)
  const symbolRef = useRef(symbol)
  const candlesRef = useRef(candles)
  const onLoadHistoryRef = useRef(onLoadHistory)
  const hasFittedContentRef = useRef(false)
  const volumeScaleRef = useRef(null)
  const rowStateRef = useRef({ contract: null, index: null })
  const measurementRef = useRef(null)
  const measurementGenerationRef = useRef(measurementGeneration)
  const ignoreNextLeftClickRef = useRef(false)
  const lastLeftClickRef = useRef(EMPTY_CLICK_CANDIDATE)
  const lastRightClickRef = useRef(EMPTY_CLICK_CANDIDATE)
  const orderDragRef = useRef(null)
  const dragPriceLineRef = useRef(null)
  const dragOriginLineRef = useRef(null)
  const dragRectRef = useRef(null)
  const requestOrderCoordinateRefreshRef = useRef(NOOP_ORDER_COORDINATE_REFRESH)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [measurement, setMeasurement] = useState(null)
  const [orderCoordinates, setOrderCoordinates] = useState([])
  // The order the drag holds: `lifting` while the exchange is being asked to
  // cancel it, `moving` once it has, `placing` while its replacement is in
  // flight. Nothing on the book corresponds to it after the lift, which is why
  // it is drawn from here rather than from the open-orders list.
  const [orderDrag, setOrderDrag] = useState(null)
  const [heldGestureModifier, setHeldGestureModifier] = useState(null)
  const tradingGesturesEnabled = typeof onTradingGesture === 'function'

  useEffect(() => {
    onPricePickRef.current = onPricePick
  }, [onPricePick])

  useEffect(() => {
    onTradingGestureRef.current = onTradingGesture
  }, [onTradingGesture])

  useEffect(() => {
    onOrderLiftRef.current = onOrderLift
  }, [onOrderLift])

  useEffect(() => {
    onOrderDropRef.current = onOrderDrop
  }, [onOrderDrop])

  useEffect(() => {
    onOrderCancelRef.current = onOrderCancel
  }, [onOrderCancel])

  useEffect(() => {
    onOrderEditRef.current = onOrderEdit
  }, [onOrderEdit])

  useEffect(() => {
    symbolRef.current = symbol
    measurementGenerationRef.current = measurementGeneration
    hasFittedContentRef.current = false
    volumeScaleRef.current = null
    rowStateRef.current = { contract: null }
    ignoreNextLeftClickRef.current = false
    lastLeftClickRef.current = EMPTY_CLICK_CANDIDATE
    lastRightClickRef.current = EMPTY_CLICK_CANDIDATE
    // A contract change ends any drag in flight. It does not end what the drag
    // owes: the order was cancelled when it was picked up, so it is placed again
    // at the price it was lifted from rather than left off the book.
    const drag = orderDragRef.current
    if (drag !== null) {
      drag.abandoned = true
      orderDragRef.current = null
      setOrderDrag(null)
      // A lift still waiting on the exchange settles itself when the answer
      // arrives; only a confirmed one owes a replacement now.
      if (drag.status !== 'lifting') {
        onOrderDropRef.current?.({
          order: drag.order,
          price: drag.originPrice,
          restored: true,
        })
      }
    }
    // The drag's own lines must not survive onto the next contract's chart.
    for (const lineRef of [dragPriceLineRef, dragOriginLineRef]) {
      if (!lineRef.current) continue
      try {
        seriesRef.current?.contractSeries?.removePriceLine(lineRef.current)
      } catch {
        // The series may already be gone; the line dies with it either way.
      }
      lineRef.current = null
    }
    measurementRef.current = null
  }, [measurementGeneration, symbol])

  const cancelMeasurement = useCallback(() => {
    measurementRef.current = null
    ignoreNextLeftClickRef.current = false
    lastLeftClickRef.current = EMPTY_CLICK_CANDIDATE
    lastRightClickRef.current = EMPTY_CLICK_CANDIDATE
    setMeasurement(null)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const chart = createChart(container, {
      width: Math.max(320, container.clientWidth),
      height: Math.max(320, container.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: '#071019' },
        textColor: '#9eb0c2',
        attributionLogo: false,
        // Every label the library draws — the price line titles (ENTRY, LIQ,
        // ALERT) and the plates they put on the scale — is set from this one
        // size, and at the default twelve they carried the weight of the candles
        // they annotate. Nine is as small as the price scale stays readable at.
        fontSize: 9,
      },
      grid: {
        vertLines: { color: 'rgba(135, 151, 170, 0.08)' },
        horzLines: { color: 'rgba(135, 151, 170, 0.08)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(135, 151, 170, 0.2)' },
      timeScale: {
        borderColor: 'rgba(135, 151, 170, 0.2)',
        timeVisible: true,
        secondsVisible: false,
      },
    })
    const contractSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#2bc48a',
      downColor: '#ef5b69',
      borderVisible: false,
      wickUpColor: '#2bc48a',
      wickDownColor: '#ef5b69',
      priceScaleId: 'right',
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      // The volume of the newest bar was stamped on the price scale, in the same
      // plate the desk reads prices from — a quantity on a scale of prices, at the
      // height its own bar happens to reach. The bars carry the reading; the last
      // one needs no badge of its own.
      lastValueVisible: false,
      priceLineVisible: false,
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    })
    const pointFromEvent = (event) => {
      const rect = container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
      const price = contractSeries.coordinateToPrice(y)
      if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
      const timeScale = chart.timeScale()
      return {
        x,
        y,
        price,
        time: timeScale.coordinateToTime?.(x) ?? null,
        logical: timeScale.coordinateToLogical?.(x) ?? null,
      }
    }
    const emitTradingGesture = (event, button) => {
      if (!isFuturesTradingGestureTarget(event.target)) return false
      const intent = resolveFuturesTradingGesture({
        button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      })
      if (!intent) return false
      const point = pointFromEvent(event)
      if (!point) return false
      event.preventDefault()
      event.stopPropagation()
      onTradingGestureRef.current?.({
        ...intent,
        price: toDraftString(point.price),
        source: 'chart',
        // Where the operator was looking when they asked: the confirmation
        // opens there rather than making them hunt for it.
        anchor: { x: event.clientX, y: event.clientY },
      })
      return true
    }
    const startMeasurement = (event) => {
      const point = pointFromEvent(event)
      if (!point) return false
      event.preventDefault()
      event.stopPropagation()
      lastLeftClickRef.current = EMPTY_CLICK_CANDIDATE
      lastRightClickRef.current = EMPTY_CLICK_CANDIDATE
      measurementRef.current = { start: point, current: point }
      setMeasurement({
        symbol: symbolRef.current,
        generation: measurementGenerationRef.current,
        projection: {
          startX: point.x,
          currentX: point.x,
          startY: point.y,
          currentY: point.y,
          deltaPrice: 0,
          deltaPercent: 0,
          deltaTime: 0,
        },
      })
      return true
    }
    const handleMouseDown = (event) => {
      if (event.button !== 0) return
      if (measurementRef.current) {
        event.preventDefault()
        event.stopPropagation()
        cancelMeasurement()
        ignoreNextLeftClickRef.current = true
        return
      }
      if (event.shiftKey && startMeasurement(event)) {
        ignoreNextLeftClickRef.current = true
      }
    }
    const handleLeftClick = (event) => {
      if (ignoreNextLeftClickRef.current) {
        ignoreNextLeftClickRef.current = false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (measurementRef.current) {
        event.preventDefault()
        event.stopPropagation()
        cancelMeasurement()
        return
      }
      if (event.shiftKey) {
        startMeasurement(event)
        return
      }
      const intent = resolveFuturesTradingGesture({
        button: 'left',
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      })
      if (!intent || !isFuturesTradingGestureTarget(event.target)) {
        lastLeftClickRef.current = EMPTY_CLICK_CANDIDATE
        lastRightClickRef.current = EMPTY_CLICK_CANDIDATE
        const point = pointFromEvent(event)
        if (point) onPricePickRef.current?.(toDraftString(point.price))
        return
      }
      const modifier = event.altKey ? 'alt' : 'ctrl'
      const current = {
        at: Date.now(), x: event.clientX, y: event.clientY, modifier,
      }
      const previous = lastLeftClickRef.current
      lastRightClickRef.current = EMPTY_CLICK_CANDIDATE
      lastLeftClickRef.current = current
      if (current.at - previous.at > 350
        || Math.abs(current.x - previous.x) > 6
        || Math.abs(current.y - previous.y) > 6
        || previous.modifier !== modifier) return
      lastLeftClickRef.current = EMPTY_CLICK_CANDIDATE
      lastRightClickRef.current = EMPTY_CLICK_CANDIDATE
      emitTradingGesture(event, 'left')
    }
    const handleContextMenu = (event) => {
      if (measurementRef.current) {
        cancelMeasurement()
        return
      }
      const intent = resolveFuturesTradingGesture({
        button: 'right',
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      })
      if (!intent || !isFuturesTradingGestureTarget(event.target)) {
        lastLeftClickRef.current = EMPTY_CLICK_CANDIDATE
        lastRightClickRef.current = EMPTY_CLICK_CANDIDATE
        return
      }
      event.preventDefault()
      const modifier = event.altKey ? 'alt' : 'ctrl'
      const current = {
        at: Date.now(), x: event.clientX, y: event.clientY, modifier,
      }
      const previous = lastRightClickRef.current
      lastLeftClickRef.current = EMPTY_CLICK_CANDIDATE
      lastRightClickRef.current = current
      if (current.at - previous.at > 350
        || Math.abs(current.x - previous.x) > 6
        || Math.abs(current.y - previous.y) > 6
        || previous.modifier !== modifier) return
      lastLeftClickRef.current = EMPTY_CLICK_CANDIDATE
      lastRightClickRef.current = EMPTY_CLICK_CANDIDATE
      emitTradingGesture(event, 'right')
    }
    const handleViewportChange = () => {
      requestOrderCoordinateRefreshRef.current()
    }
    const handleMouseMove = (event) => {
      handleViewportChange()
      if (!measurementRef.current) return
      const point = pointFromEvent(event)
      if (!point) return
      const start = measurementRef.current.start
      measurementRef.current = { start, current: point }
      const deltaPrice = point.price - start.price
      let deltaTime = 0
      if (typeof start.time === 'number' && typeof point.time === 'number') {
        deltaTime = point.time - start.time
      }
      setMeasurement({
        symbol: symbolRef.current,
        generation: measurementGenerationRef.current,
        projection: {
          startX: start.x,
          currentX: point.x,
          startY: start.y,
          currentY: point.y,
          deltaPrice,
          deltaPercent: start.price === 0 ? 0 : (deltaPrice / start.price) * 100,
          deltaTime,
        },
      })
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') cancelMeasurement()
    }
    const timeScale = chart.timeScale()
    timeScale.subscribeVisibleLogicalRangeChange?.(handleViewportChange)
    container.addEventListener('mousedown', handleMouseDown)
    container.addEventListener('click', handleLeftClick)
    container.addEventListener('contextmenu', handleContextMenu)
    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('wheel', handleViewportChange, { passive: true })
    globalThis.addEventListener?.('keydown', handleKeyDown)
    chartRef.current = chart
    seriesRef.current = { contractSeries, volumeSeries }

    const resize = () => {
      const width = Math.max(320, container.clientWidth)
      const height = Math.max(320, container.clientHeight)
      // The one thing that moves the chart's box under a captured pointer. The
      // drag reads that box once and reuses it; dropping it here is what makes
      // the next move measure again.
      dragRectRef.current = null
      chart.applyOptions({ width, height })
      setContainerSize(previous => (
        previous.width === width && previous.height === height ? previous : { width, height }
      ))
    }
    resize()
    let observer = null
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(resize)
      observer.observe(container)
    } else {
      globalThis.addEventListener?.('resize', resize)
    }
    return () => {
      observer?.disconnect()
      globalThis.removeEventListener?.('resize', resize)
      globalThis.removeEventListener?.('keydown', handleKeyDown)
      container.removeEventListener('mousedown', handleMouseDown)
      container.removeEventListener('click', handleLeftClick)
      container.removeEventListener('contextmenu', handleContextMenu)
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('wheel', handleViewportChange)
      timeScale.unsubscribeVisibleLogicalRangeChange?.(handleViewportChange)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      overlayLinesRef.current = []
      rowStateRef.current = { contract: null }
    }
  }, [cancelMeasurement])

  // Holding exactly one trading modifier shows the gesture legend on the
  // chart, so the double-click shortcuts are discoverable where they act.
  useEffect(() => {
    if (!tradingGesturesEnabled) {
      setHeldGestureModifier(null)
      return undefined
    }
    const resolveModifier = (event) => {
      if (event.shiftKey || event.metaKey || event.altKey === event.ctrlKey) return null
      return event.altKey ? 'alt' : 'ctrl'
    }
    const handleModifierChange = (event) => {
      setHeldGestureModifier(previous => {
        const next = resolveModifier(event)
        return previous === next ? previous : next
      })
    }
    const clearModifier = () => setHeldGestureModifier(null)
    globalThis.addEventListener?.('keydown', handleModifierChange)
    globalThis.addEventListener?.('keyup', handleModifierChange)
    globalThis.addEventListener?.('blur', clearModifier)
    return () => {
      globalThis.removeEventListener?.('keydown', handleModifierChange)
      globalThis.removeEventListener?.('keyup', handleModifierChange)
      globalThis.removeEventListener?.('blur', clearModifier)
    }
  }, [tradingGesturesEnabled])

  useEffect(() => {
    const priceFormat = createPriceFormat(priceTickSize)
    if (!priceFormat || !seriesRef.current) return
    seriesRef.current.contractSeries.applyOptions({ priceFormat })
  }, [priceTickSize])

  useEffect(() => {
    candlesRef.current = candles
  }, [candles])

  useEffect(() => {
    onLoadHistoryRef.current = onLoadHistory
  }, [onLoadHistory])

  useEffect(() => {
    if (!seriesRef.current) return
    const { contractSeries, volumeSeries } = seriesRef.current
    const drawnRows = rowStateRef.current.contract
    // Comparing only length and endpoints called a re-read that corrected a
    // candle inside the series "the last bar moved", and the correction never
    // reached the canvas. What is redrawn is decided from what actually
    // changed.
    const plan = planSeriesDraw(drawnRows, candles, DRAW_PLAN)
    const contractData = toCandleData(candles)
    const volumePresentation = toVolumeData(candles)
    // The volume series is written first and the candles second. The candles
    // own the time scale, and the library answers a time-scale change by
    // re-sending every series' data — so writing them last leaves both series
    // holding the same generation of rows when the frame ends.
    if ((plan === 'tick' || plan === 'append')
      && contractData.length > 0
      && volumePresentation.data.length > 0) {
      volumeSeries.update(volumePresentation.data.at(-1))
      contractSeries.update(contractData.at(-1))
    } else {
      // Older candles arriving in front shift every bar's logical index. Left
      // alone, the chart would jump backwards under the operator's cursor at
      // the exact moment they were reading it, so the visible range is moved by
      // as many bars as were prepended and the view stands still.
      const prepended = countPrependedRows(rowTime(drawnRows?.[0]), candles, DRAW_PLAN)
      const timeScale = chartRef.current?.timeScale()
      const heldRange = prepended > 0 ? timeScale?.getVisibleLogicalRange?.() ?? null : null
      volumeSeries.setData(volumePresentation.data)
      contractSeries.setData(contractData)
      if (heldRange) {
        timeScale.setVisibleLogicalRange?.({
          from: heldRange.from + prepended,
          to: heldRange.to + prepended,
        })
      }
    }
    // Applying options is never free: the library recreates the formatter,
    // forces a full chart update, and marks the series' drawn items as needing
    // a restyle. Done on every tick it also keeps the histogram permanently in
    // the one state where a restyle can outrun the data it is styling. The
    // volume format only changes when the scale does, so it is applied then.
    if (volumeScaleRef.current !== volumePresentation.scale) {
      volumeScaleRef.current = volumePresentation.scale
      volumeSeries.applyOptions({ priceFormat: volumePresentation.priceFormat })
    }
    rowStateRef.current = { contract: candles }
    if (contractData.length > 0 && !hasFittedContentRef.current) {
      chartRef.current?.timeScale().fitContent()
      hasFittedContentRef.current = true
    }
    requestOrderCoordinateRefreshRef.current()
  }, [candles])

  // Scrolling into the left edge is the request for more history: the operator
  // is asking to see what came before, and the chart answers by loading it
  // rather than by ending.
  useEffect(() => {
    const timeScale = chartRef.current?.timeScale()
    if (!timeScale || typeof onLoadHistory !== 'function') return undefined
    const handleRangeChange = (range) => {
      if (!range || historyExhausted) return
      if (range.from > HISTORY_PREFETCH_BARS) return
      const oldest = candlesRef.current[0]?.openTime
      if (!Number.isSafeInteger(oldest)) return
      onLoadHistoryRef.current?.(oldest)
    }
    timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange)
    // The range the chart already settled on after its first fit never fires an
    // event we are subscribed for, so the opening view is evaluated directly —
    // otherwise a contract would only deepen once the operator scrolled.
    handleRangeChange(timeScale.getVisibleLogicalRange?.() ?? null)
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange)
  }, [historyExhausted, onLoadHistory])

  // The order a drag is holding is not resting anywhere: it was cancelled when
  // the drag picked it up. It is drawn once, by the drag, so it is taken out of
  // every pass that draws the book's own orders — an account snapshot that has
  // not caught up yet must not put a second line back at the old price.
  const liftedOrderIdentity = orderDrag !== null && orderDrag.status !== 'lifting'
    ? orderDrag.orderIdentity
    : null
  const restingOrders = useMemo(() => (
    liftedOrderIdentity === null
      ? ownedOrders
      : ownedOrders.filter(order => futuresOrderIdentity(order) !== liftedOrderIdentity)
  ), [liftedOrderIdentity, ownedOrders])

  useEffect(() => {
    const series = seriesRef.current?.contractSeries
    if (!series) return
    for (const line of overlayLinesRef.current) series.removePriceLine(line)
    const nextLines = []
    const addLine = (priceValue, options) => {
      const price = toNumber(priceValue)
      if (price === null || price <= 0) return
      nextLines.push(series.createPriceLine({ price, ...options }))
    }
    drawings.forEach((drawing, index) => addLine(drawing.price, {
      color: '#8b5cf6',
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: false,
      title: `D${index + 1}`,
    }))
    alerts.forEach((alert, index) => addLine(alert.price, {
      color: '#ff8a3d',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `ALERT ${index + 1}`,
    }))
    // Where the position was opened and where it dies are the two prices a
    // trader must never have to look up in another panel.
    positions.forEach((position) => {
      const presentation = describeFuturesPosition(position)
      // Half opacity: the entry band is a reference the candles are read
      // against, not a signal competing with them. At full strength its axis
      // label and its line both hid the bars sitting at that price.
      //
      // The label plate needs its own colour because the library will not honour
      // alpha there: it builds the plate with `rgb(...)` from the parsed colour
      // and drops the fourth component, so the band faded and its plate stayed
      // solid. The translucency is pre-composited instead — the same tone at half
      // strength over the chart's own `#071019` — which leaves the entry reading
      // as a dimmed plate beside the solid ones the last price and the working
      // orders get, rather than as one more price on the scale.
      const entryTone = presentation.tone === 'buy'
        ? { band: 'rgba(43, 196, 138, 0.5)', plate: '#196a51' }
        : { band: 'rgba(239, 91, 105, 0.5)', plate: '#7b3541' }
      addLine(position.entryPrice, {
        color: entryTone.band,
        axisLabelColor: entryTone.plate,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `ENTRY ${presentation.positionSide}`,
      })
      addLine(position.liquidationPrice, {
        color: '#f0b90b',
        lineWidth: 1,
        lineStyle: LineStyle.LargeDashed,
        axisLabelVisible: true,
        title: 'LIQ',
      })
    })
    // One-way accounts report positionSide BOTH, so a `positionSide === 'LONG'`
    // test painted every order — including plain buys — red. Colour by side.
    restingOrders.forEach((order) => {
      const intent = describeFuturesOrderIntent(order)
      addLine(order.price, {
        color: intent.tone === 'buy' ? '#2bc48a' : '#ef5b69',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: '',
      })
    })
    overlayLinesRef.current = nextLines
    requestOrderCoordinateRefreshRef.current()
  }, [alerts, drawings, positions, restingOrders])

  useEffect(() => {
    let pending = null
    const updateCoordinates = () => {
      pending = null
      const series = seriesRef.current?.contractSeries
      const coordinates = !series || typeof series.priceToCoordinate !== 'function'
        ? []
        : restingOrders.flatMap((order) => {
          const price = toNumber(order?.price)
          const y = price === null ? null : series.priceToCoordinate(price)
          return typeof y === 'number'
            && Number.isFinite(y)
            && y >= 0
            && y <= containerSize.height
            ? [{ order, y }]
            : []
        })
      const next = layoutOrderCoordinates(coordinates, containerSize.height)
      setOrderCoordinates((previous) => {
        const unchanged = previous.length === next.length && previous.every((entry, index) => (
          futuresOrderIdentity(entry.order) === futuresOrderIdentity(next[index].order)
          && entry.order.price === next[index].order.price
          && entry.anchorY === next[index].anchorY
          && entry.y === next[index].y
        ))
        return unchanged ? previous : next
      })
    }
    const scheduleUpdate = () => {
      if (pending !== null) return
      if (typeof globalThis.requestAnimationFrame === 'function') {
        pending = Object.freeze({
          kind: 'frame',
          id: globalThis.requestAnimationFrame(updateCoordinates),
        })
        return
      }
      pending = Object.freeze({
        kind: 'timer',
        id: globalThis.setTimeout(updateCoordinates, 0),
      })
    }
    requestOrderCoordinateRefreshRef.current = scheduleUpdate
    scheduleUpdate()
    return () => {
      if (requestOrderCoordinateRefreshRef.current === scheduleUpdate) {
        requestOrderCoordinateRefreshRef.current = NOOP_ORDER_COORDINATE_REFRESH
      }
      if (pending?.kind === 'frame') globalThis.cancelAnimationFrame?.(pending.id)
      if (pending?.kind === 'timer') globalThis.clearTimeout(pending.id)
      pending = null
    }
  }, [candles, containerSize.height, restingOrders])

  // A dragged order is shown as its own price line so the move is read on the
  // chart and on the price axis, not only on the handle badge.
  const removeDragPriceLine = useCallback(() => {
    const series = seriesRef.current?.contractSeries
    const lines = [dragPriceLineRef.current, dragOriginLineRef.current]
    dragPriceLineRef.current = null
    dragOriginLineRef.current = null
    if (!series) return
    for (const line of lines) {
      if (!line) continue
      try {
        series.removePriceLine(line)
      } catch {
        // The series can be disposed before the pointer is released.
      }
    }
  }, [])

  const publishOrderDrag = useCallback(drag => setOrderDrag(drag === null ? null : Object.freeze({
    orderIdentity: drag.orderIdentity,
    order: drag.order,
    originPrice: drag.originPrice,
    price: drag.price,
    y: drag.y,
    status: drag.status,
  })), [])

  const applyDragLinePrice = useCallback((price) => {
    const value = toNumber(price)
    if (typeof dragPriceLineRef.current?.applyOptions !== 'function'
      || value === null
      || value <= 0) return
    dragPriceLineRef.current.applyOptions({ price: value })
  }, [])

  // The chart's box, measured once for the whole gesture.
  //
  // `getBoundingClientRect` is a layout read, and a layout read is only cheap
  // when the page's layout is already clean. The desk's is never clean for long:
  // the book, the dock and the header all write to the DOM while the drag is
  // running, so every read at pointer rate forced the browser to lay the entire
  // desk out again before it could answer — once per frame, on the frame's
  // critical path, and the busier the desk the more that read cost. Nothing but
  // a resize moves the chart while the pointer is captured, and that clears this.
  const measureDragRect = useCallback(() => {
    const container = containerRef.current
    if (!container) return null
    const { top, height } = container.getBoundingClientRect()
    dragRectRef.current = Object.freeze({ top, height })
    return dragRectRef.current
  }, [])

  // What the chart shows once the order has left the book: a dashed line at the
  // price being aimed at, and one faint unlabelled mark at the level it was
  // lifted from. Neither is a working order, and neither is drawn like one.
  //
  // Before the cancellation is answered the order is still on the book and still
  // drawn there with its own line, so there is nothing to mark an emptied level
  // with: the faint marker is what says the level is uncovered, and that only
  // becomes true on the confirmation. Passing no origin is what says so, and the
  // aim is then drawn thinner, dimmer and without an axis label, because at that
  // point it is a destination rather than an order.
  const drawDragLines = useCallback((order, { price, originPrice = null }) => {
    const series = seriesRef.current?.contractSeries
    const value = toNumber(price)
    removeDragPriceLine()
    if (!series || value === null || value <= 0) return
    const intent = describeFuturesOrderIntent(order)
    const origin = toNumber(originPrice)
    const lifted = origin !== null && origin > 0
    if (lifted) {
      dragOriginLineRef.current = series.createPriceLine({
        price: origin,
        color: 'rgba(126, 143, 166, 0.45)',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: '',
      })
    }
    dragPriceLineRef.current = series.createPriceLine({
      price: value,
      color: lifted
        ? (intent.tone === 'buy' ? '#2bc48a' : '#ef5b69')
        : (intent.tone === 'buy' ? 'rgba(43, 196, 138, 0.5)' : 'rgba(239, 91, 105, 0.5)'),
      lineWidth: lifted ? 2 : 1,
      lineStyle: lifted ? LineStyle.Dashed : LineStyle.Dotted,
      axisLabelVisible: lifted,
      title: '',
    })
  }, [removeDragPriceLine])

  const releaseDrag = useCallback((drag) => {
    if (orderDragRef.current === drag) orderDragRef.current = null
    dragRectRef.current = null
    removeDragPriceLine()
    shellRef.current?.releasePointerCapture?.(drag.pointerId)
    publishOrderDrag(null)
  }, [publishOrderDrag, removeDragPriceLine])

  // The end of the drag, and the moment the obligation is discharged. The mark
  // stays on the chart, dashed, until the placement is answered: the level is
  // uncovered until then, and drawing a working order there would be a lie.
  const settleOrderDrag = useCallback((drag, { restored = false } = {}) => {
    if (orderDragRef.current !== drag || drag.status === 'placing') return
    const abandoned = restored || toNumber(drag.price) === toNumber(drag.originPrice)
    drag.price = abandoned ? drag.originPrice : drag.price
    drag.status = 'placing'
    applyDragLinePrice(drag.price)
    publishOrderDrag(drag)
    shellRef.current?.releasePointerCapture?.(drag.pointerId)
    Promise.resolve(onOrderDropRef.current?.({
      order: drag.order,
      price: drag.price,
      restored: abandoned,
    })).catch(() => {}).finally(() => {
      if (orderDragRef.current !== drag) return
      releaseDrag(drag)
    })
  }, [applyDragLinePrice, publishOrderDrag, releaseDrag])

  // Picking an order up cancels it, and the gesture runs beside that
  // cancellation rather than behind it: waiting for the exchange before the mark
  // would move meant half a second of a chart that ignored the pointer.
  //
  // What waits for the answer is what the chart *claims*. Until the cancellation
  // is confirmed the order is still drawn where it rests, still labelled as being
  // lifted, and the mark under the pointer is drawn as pending — a refusal
  // removes that mark and leaves the order exactly where it was.
  const beginOrderDrag = useCallback((event, order) => {
    if (order?.orderKind !== 'REGULAR'
      || event.button !== 0
      || event.metaKey
      || event.shiftKey
      || event.altKey === event.ctrlKey) return
    event.preventDefault()
    event.stopPropagation()
    if (orderDragRef.current !== null || typeof onOrderLiftRef.current !== 'function') return
    const series = seriesRef.current?.contractSeries
    const originY = typeof series?.priceToCoordinate === 'function'
      ? series.priceToCoordinate(toNumber(order.price))
      : null
    const drag = {
      pointerId: event.pointerId,
      modifier: event.altKey ? 'alt' : 'ctrl',
      order,
      orderIdentity: futuresOrderIdentity(order),
      originPrice: order.price,
      price: order.price,
      y: typeof originY === 'number' && Number.isFinite(originY) ? originY : null,
      status: 'lifting',
      abandoned: false,
      releasedEarly: false,
      // Where a gesture that finished inside the round trip left the order. The
      // drop is honoured at the price it landed on once the answer arrives —
      // restoring the origin instead would throw away the operator's move.
      releasedRestored: true,
    }
    orderDragRef.current = drag
    measureDragRect()
    shellRef.current?.setPointerCapture?.(event.pointerId)
    publishOrderDrag(drag)
    drawDragLines(order, { price: drag.price })
    Promise.resolve(onOrderLiftRef.current(order)).then((outcome) => {
      if (outcome?.ok !== true) {
        // Nothing was lifted: the order is still drawn where it rests, and the
        // refusal is stated by the surface that asked for the cancellation.
        if (orderDragRef.current === drag) releaseDrag(drag)
        return
      }
      if (drag.abandoned || orderDragRef.current !== drag) {
        // The contract changed under the drag, or the chart was torn down. The
        // order was cancelled all the same, so it goes back where it was lifted
        // from — the gesture's own price belongs to a chart that is gone.
        onOrderDropRef.current?.({
          order: drag.order,
          price: drag.originPrice,
          restored: true,
        })
        return
      }
      drag.status = 'moving'
      drawDragLines(order, { price: drag.price, originPrice: drag.originPrice })
      publishOrderDrag(drag)
      if (drag.releasedEarly) settleOrderDrag(drag, { restored: drag.releasedRestored })
    }).catch(() => {
      if (orderDragRef.current === drag) releaseDrag(drag)
    })
  }, [drawDragLines, measureDragRect, publishOrderDrag, releaseDrag, settleOrderDrag])

  const moveOrderDrag = useCallback((event) => {
    const drag = orderDragRef.current
    const series = seriesRef.current?.contractSeries
    // `lifting` follows the pointer too: the cancellation is in flight, and the
    // mark that follows is a destination, not a claim that the order has moved.
    if (!drag
      || drag.pointerId !== event.pointerId
      || (drag.status !== 'moving' && drag.status !== 'lifting')
      || drag.releasedEarly
      || !series) return
    const rect = dragRectRef.current ?? measureDragRect()
    if (rect === null) return
    // The gesture owns the event whether or not it changed anything: leaving it
    // to the page would let a drag select text across the desk.
    event.preventDefault()
    event.stopPropagation()
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    // Sideways, or less than the row the mark already occupies. Redrawing the
    // line and republishing the drag would repaint the chart to put both back
    // exactly where they are.
    if (drag.y !== null && Math.round(drag.y) === Math.round(y)) return
    const price = series.coordinateToPrice(y)
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return
    drag.price = toDraftString(price)
    drag.y = y
    applyDragLinePrice(drag.price)
    publishOrderDrag(drag)
  }, [applyDragLinePrice, measureDragRect, publishOrderDrag])

  const finishOrderDrag = useCallback((event, canceled = false) => {
    const drag = orderDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (drag.status !== 'moving' && drag.status !== 'lifting') return
    const modifierHeld = drag.modifier === 'alt'
      ? event.altKey && !event.ctrlKey
      : event.ctrlKey && !event.altKey
    const restored = canceled || !modifierHeld
    if (drag.status === 'lifting') {
      // Released before the exchange answered. The lift discharges it when the
      // answer arrives — at the price the gesture actually ended on, which is
      // why that verdict is recorded here rather than assumed to be the origin.
      drag.releasedEarly = true
      drag.releasedRestored = restored
      return
    }
    settleOrderDrag(drag, { restored })
  }, [settleOrderDrag])

  // Letting the modifier go abandons the drag rather than leaving it hanging:
  // the order goes back to the price it was lifted from. It abandons one whose
  // cancellation is still in flight too — the gesture follows the pointer from
  // the moment it begins now, so a drag that ignored the modifier until the
  // exchange answered would keep moving after the operator had let go.
  const dragIsLive = orderDrag?.status === 'moving' || orderDrag?.status === 'lifting'
  useEffect(() => {
    if (!dragIsLive) return undefined
    const handleModifierRelease = (event) => {
      const drag = orderDragRef.current
      if (!drag) return
      if (drag.modifier === 'alt' ? event.altKey : event.ctrlKey) return
      if (drag.status === 'lifting') {
        if (drag.releasedEarly) return
        drag.releasedEarly = true
        drag.releasedRestored = true
        return
      }
      if (drag.status !== 'moving') return
      settleOrderDrag(drag, { restored: true })
    }
    globalThis.addEventListener?.('keyup', handleModifierRelease)
    return () => globalThis.removeEventListener?.('keyup', handleModifierRelease)
  }, [dragIsLive, settleOrderDrag])

  // The one mark standing for the order the drag holds. It is not on the book,
  // so it carries what the operator needs to recognise it — side and size — and
  // says outright whether it is following the pointer or being placed.
  const liftedMark = useMemo(() => {
    if (orderDrag === null || orderDrag.y === null) return null
    const intent = describeFuturesOrderIntent(orderDrag.order)
    return Object.freeze({
      tone: intent.tone,
      label: intent.label,
      side: intent.side,
      notional: orderNotionalUsdt(orderDrag.order),
      price: orderDrag.price,
      y: orderDrag.y,
      placing: orderDrag.status === 'placing',
      // Following the pointer while the order it stands for is still on the
      // book. Drawn as a destination, not as an order.
      pending: orderDrag.status === 'lifting',
    })
  }, [orderDrag])

  const measurementPrecision = useMemo(() => {
    const fraction = typeof priceTickSize === 'string'
      ? priceTickSize.split('.')[1]?.replace(/0+$/, '') ?? ''
      : ''
    return { price: Math.min(18, fraction.length), quantity: 3 }
  }, [priceTickSize])

  return (
    <div
      className="futures-workstation-chart-canvas-shell"
      ref={shellRef}
      onPointerMove={moveOrderDrag}
      onPointerUp={finishOrderDrag}
      onPointerCancel={event => finishOrderDrag(event, true)}
    >
      <div
        className="futures-workstation-chart-canvas"
        data-testid="futures-workstation-chart"
        ref={containerRef}
        aria-label="Futures candlestick chart with volume"
      />
      <MeasurementOverlay
        projection={measurement
          && measurement.symbol === symbol
          && measurement.generation === measurementGeneration
          ? measurement.projection
          : null}
        containerSize={containerSize}
        precision={measurementPrecision}
      />
      {heldGestureModifier ? (
        <div
          className={`futures-workstation-gesture-hint is-${heldGestureModifier}`}
          role="status"
          aria-label="Futures gesture shortcuts for the held modifier"
        >
          <strong>{heldGestureModifier === 'alt' ? 'ALT · LONG' : 'CTRL · SHORT'}</strong>
          <span>
            {heldGestureModifier === 'alt'
              ? 'double left-click: enter · double right-click: exit'
              : 'double right-click: enter · double left-click: exit'}
          </span>
        </div>
      ) : null}
      <div className="futures-workstation-owned-order-layer" aria-label="Owned Futures orders">
        {liftedMark === null ? null : (
          <div
            className={`futures-workstation-owned-order is-${liftedMark.tone} is-lifted${liftedMark.placing ? ' is-placing' : ''}${liftedMark.pending ? ' is-pending' : ''}`}
            style={{
              // Moved by transform rather than by `top`, and it is the only
              // handle that moves at pointer rate. `top` is a layout property:
              // writing it marks the desk's layout dirty every frame, and the
              // next thing that reads a box — this chart, the charting library,
              // any panel — pays for laying the desk out again before it gets an
              // answer. A transform is composited and dirties no layout at all.
              top: 0,
              transform: `translate3d(0, ${liftedMark.y}px, 0) translateY(-50%)`,
            }}
            role="status"
            aria-label={liftedMark.placing
              ? `${liftedMark.side} ${liftedMark.label} order being placed at ${liftedMark.price}; nothing rests at that price yet`
              : liftedMark.pending
                ? `${liftedMark.side} ${liftedMark.label} order heading for ${liftedMark.price}; it is still working where it rests until the cancellation is confirmed`
                : `${liftedMark.side} ${liftedMark.label} order lifted off the book, following the pointer at ${liftedMark.price}`}
          >
            {/* The same plate a resting order is drawn on. Left as bare children
                of the handle, the label and the value fell outside every rule
                that sizes a handle's text — the value rendered at the desk's
                body size inside a 16px plate and broke out of it, which is what
                a dragged order looked like on screen. */}
            <span className="futures-workstation-owned-order-plate">
              <b>{liftedMark.label}</b>
              <span>{liftedMark.price}</span>
              <em>{liftedMark.placing ? 'placing…' : `${liftedMark.notional ?? '—'} USDT`}</em>
            </span>
          </div>
        )}
        {/* The coordinate pass settles a frame later than the lift does, so the
            lifted order is taken out here as well: for that one frame it would
            otherwise be drawn twice, once at the pointer and once where it no
            longer rests. */}
        {orderCoordinates.filter(({ order }) => (
          futuresOrderIdentity(order) !== liftedOrderIdentity
        )).map(({ order, y, anchorY }) => {
          const orderIdentity = futuresOrderIdentity(order)
          // The cancellation that lifts this order is in flight: it is still
          // working on the exchange, so it stays drawn where it rests and says
          // what is being done to it.
          const lifting = orderDrag !== null
            && orderDrag.status === 'lifting'
            && orderDrag.orderIdentity === orderIdentity
          const top = y
          const displaced = Math.abs(anchorY - y) > 0.5
          const intent = describeFuturesOrderIntent(order)
          const notional = orderNotionalUsdt(order)
          const content = (
            <>
              <b>{order.orderKind === 'ALGO' ? 'ALGO ' : ''}{intent.label}</b>
              <span>{lifting ? 'lifting…' : `${notional ?? '—'} USDT`}</span>
            </>
          )
          if (order.orderKind === 'ALGO') {
            return (
              <div
                className={`futures-workstation-owned-order is-${intent.tone} is-algo${displaced ? ' is-displaced' : ''}`}
                key={orderIdentity}
                style={{ top: `${top}px` }}
                data-anchor-y={anchorY}
                role="note"
                aria-label={`ALGO ${intent.side} ${intent.label} order at ${order.price}; price is managed by Binance and is not draggable`}
              >
                {content}
              </div>
            )
          }
          return (
            <div
              className={`futures-workstation-owned-order is-${intent.tone}${displaced ? ' is-displaced' : ''}${lifting ? ' is-lifting' : ''}`}
              key={orderIdentity}
              style={{ top: `${top}px` }}
              data-anchor-y={anchorY}
            >
              <button
                type="button"
                className="futures-workstation-owned-order-grip"
                aria-label={`Move ${intent.side} ${intent.label} order at ${order.price} with Ctrl or Alt drag`}
                onPointerDown={event => beginOrderDrag(event, order)}
                onDoubleClick={event => onOrderEditRef.current?.(order, {
                  x: event.clientX,
                  y: event.clientY,
                })}
              >
                {content}
              </button>
              <button
                type="button"
                className="futures-workstation-owned-order-cancel"
                aria-label={`Cancel ${intent.side} ${intent.label} order at ${order.price}`}
                onClick={() => onOrderCancelRef.current?.({
                  symbol: order.symbol,
                  orderId: order.orderId,
                })}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const MemoizedFuturesWorkstationChart = memo(FuturesWorkstationChart)
MemoizedFuturesWorkstationChart.displayName = 'FuturesWorkstationChart'

export default MemoizedFuturesWorkstationChart
