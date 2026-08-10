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

const canUpdateLastRow = (previous, rows) => {
  if (!previous || rows.length === 0) return false
  const first = rowTime(rows[0])
  const last = rowTime(rows.at(-1))
  return first !== null
    && last !== null
    && first === previous.first
    && (rows.length === previous.length || rows.length === previous.length + 1)
    && last >= previous.last
}

// How many rows appeared in front of what was drawn last time. Counted from the
// open time that used to be first, so a tail update reads as zero.
const countPrependedRows = (previous, rows) => {
  if (!previous || rows.length === 0) return 0
  const first = rowTime(rows[0])
  if (first === null || previous.first === null || first >= previous.first) return 0
  const index = rows.findIndex(row => rowTime(row) === previous.first)
  return index > 0 ? index : 0
}

const rememberRows = rows => rows.length === 0 ? null : Object.freeze({
  first: rowTime(rows[0]),
  last: rowTime(rows.at(-1)),
  length: rows.length,
})

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
  onOrderDrag,
  onOrderCancel,
  onOrderEdit,
}) => {
  const measurementGeneration = useMemo(() => Symbol(symbol), [symbol])
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const overlayLinesRef = useRef([])
  const onPricePickRef = useRef(onPricePick)
  const onTradingGestureRef = useRef(onTradingGesture)
  const onOrderDragRef = useRef(onOrderDrag)
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
  const requestOrderCoordinateRefreshRef = useRef(NOOP_ORDER_COORDINATE_REFRESH)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [measurement, setMeasurement] = useState(null)
  const [orderCoordinates, setOrderCoordinates] = useState([])
  const [orderDragPreview, setOrderDragPreview] = useState(null)
  const [heldGestureModifier, setHeldGestureModifier] = useState(null)
  const tradingGesturesEnabled = typeof onTradingGesture === 'function'

  useEffect(() => {
    onPricePickRef.current = onPricePick
  }, [onPricePick])

  useEffect(() => {
    onTradingGestureRef.current = onTradingGesture
  }, [onTradingGesture])

  useEffect(() => {
    onOrderDragRef.current = onOrderDrag
  }, [onOrderDrag])

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
    orderDragRef.current = null
    // A contract change ends any drag in flight, so its preview line must not
    // survive onto the next contract's chart.
    if (dragPriceLineRef.current) {
      try {
        seriesRef.current?.contractSeries?.removePriceLine(dragPriceLineRef.current)
      } catch {
        // The series may already be gone; the line dies with it either way.
      }
      dragPriceLineRef.current = null
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
    const contractData = toCandleData(candles)
    const volumePresentation = toVolumeData(candles)
    // The volume series is written first and the candles second. The candles
    // own the time scale, and the library answers a time-scale change by
    // re-sending every series' data — so writing them last leaves both series
    // holding the same generation of rows when the frame ends.
    if (canUpdateLastRow(rowStateRef.current.contract, candles)
      && contractData.length > 0
      && volumePresentation.data.length > 0) {
      volumeSeries.update(volumePresentation.data.at(-1))
      contractSeries.update(contractData.at(-1))
    } else {
      // Older candles arriving in front shift every bar's logical index. Left
      // alone, the chart would jump backwards under the operator's cursor at
      // the exact moment they were reading it, so the visible range is moved by
      // as many bars as were prepended and the view stands still.
      const prepended = countPrependedRows(rowStateRef.current.contract, candles)
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
    rowStateRef.current = { contract: rememberRows(candles) }
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
    ownedOrders.forEach((order) => {
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
  }, [alerts, drawings, ownedOrders, positions])

  useEffect(() => {
    let pending = null
    const updateCoordinates = () => {
      pending = null
      const series = seriesRef.current?.contractSeries
      const coordinates = !series || typeof series.priceToCoordinate !== 'function'
        ? []
        : ownedOrders.flatMap((order) => {
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
  }, [candles, containerSize.height, ownedOrders])

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

  const beginOrderDrag = useCallback((event, order) => {
    if (order?.orderKind !== 'REGULAR'
      || event.button !== 0
      || event.metaKey
      || event.shiftKey
      || event.altKey === event.ctrlKey) return
    event.preventDefault()
    event.stopPropagation()
    const modifier = event.altKey ? 'alt' : 'ctrl'
    const series = seriesRef.current?.contractSeries
    const startPrice = toNumber(order.price)
    removeDragPriceLine()
    if (series && startPrice !== null && startPrice > 0) {
      const intent = describeFuturesOrderIntent(order)
      // The level the order is leaving stays drawn, faint and unlabelled on the
      // axis: without it the handle simply walks off and nothing says the old
      // price is no longer where the order rests. The axis belongs to the price
      // being aimed at, so only the moving line claims a label there.
      dragOriginLineRef.current = series.createPriceLine({
        price: startPrice,
        color: 'rgba(126, 143, 166, 0.55)',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: 'WAS',
      })
      dragPriceLineRef.current = series.createPriceLine({
        price: startPrice,
        color: intent.tone === 'buy' ? '#2bc48a' : '#ef5b69',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'MOVING',
      })
    }
    orderDragRef.current = {
      pointerId: event.pointerId,
      modifier,
      order,
      orderIdentity: futuresOrderIdentity(order),
      price: order.price,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setOrderDragPreview({
      orderIdentity: futuresOrderIdentity(order),
      price: order.price,
      y: null,
    })
  }, [removeDragPriceLine])

  const moveOrderDrag = useCallback((event) => {
    const drag = orderDragRef.current
    const container = containerRef.current
    const series = seriesRef.current?.contractSeries
    if (!drag || drag.pointerId !== event.pointerId || !container || !series) return
    const rect = container.getBoundingClientRect()
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    const price = series.coordinateToPrice(y)
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return
    drag.price = toDraftString(price)
    const draggedPrice = toNumber(drag.price)
    if (typeof dragPriceLineRef.current?.applyOptions === 'function'
      && draggedPrice !== null
      && draggedPrice > 0) {
      dragPriceLineRef.current.applyOptions({ price: draggedPrice })
    }
    event.preventDefault()
    event.stopPropagation()
    setOrderDragPreview({
      orderIdentity: drag.orderIdentity,
      price: drag.price,
      y,
    })
  }, [])

  const finishOrderDrag = useCallback((event, canceled = false) => {
    const drag = orderDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    orderDragRef.current = null
    removeDragPriceLine()
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
    const modifierHeld = drag.modifier === 'alt'
      ? event.altKey && !event.ctrlKey
      : event.ctrlKey && !event.altKey
    const changed = toNumber(drag.price) !== toNumber(drag.order.price)
    if (!canceled && drag.order.orderKind === 'REGULAR' && modifierHeld && changed) {
      onOrderDragRef.current?.({
        symbol: drag.order.symbol,
        positionSide: drag.order.positionSide,
        clientOrderId: drag.order.clientOrderId,
        price: drag.price,
        modifier: drag.modifier,
      })
    }
    setOrderDragPreview(null)
  }, [removeDragPriceLine])

  const measurementPrecision = useMemo(() => {
    const fraction = typeof priceTickSize === 'string'
      ? priceTickSize.split('.')[1]?.replace(/0+$/, '') ?? ''
      : ''
    return { price: Math.min(18, fraction.length), quantity: 3 }
  }, [priceTickSize])

  return (
    <div className="futures-workstation-chart-canvas-shell">
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
        {orderCoordinates.map(({ order, y, anchorY }) => {
          const orderIdentity = futuresOrderIdentity(order)
          const preview = orderDragPreview?.orderIdentity === orderIdentity
            ? orderDragPreview
            : null
          const top = preview?.y ?? y
          const displayedPrice = preview?.price ?? order.price
          const displaced = preview === null && Math.abs(anchorY - y) > 0.5
          const intent = describeFuturesOrderIntent(order)
          const notional = orderNotionalUsdt(order)
          // Idle handles show what the order is worth; a dragged handle shows the
          // price being aimed at. The exact resting price stays on the axis.
          const label = preview === null ? `${notional ?? '—'} USDT` : displayedPrice
          const content = (
            <>
              <b>{order.orderKind === 'ALGO' ? 'ALGO ' : ''}{intent.label}</b>
              <span>{label}</span>
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
              className={`futures-workstation-owned-order is-${intent.tone}${displaced ? ' is-displaced' : ''}${preview === null ? '' : ' is-moving'}`}
              key={orderIdentity}
              style={{ top: `${top}px` }}
              data-anchor-y={anchorY}
            >
              <button
                type="button"
                className="futures-workstation-owned-order-grip"
                aria-label={`Move ${intent.side} ${intent.label} order at ${order.price} with Ctrl or Alt drag`}
                onPointerDown={event => beginOrderDrag(event, order)}
                onPointerMove={moveOrderDrag}
                onPointerUp={event => finishOrderDrag(event)}
                onPointerCancel={event => finishOrderDrag(event, true)}
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
