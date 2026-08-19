import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  TickMarkType,
  createChart,
} from 'lightweight-charts'
import { buildVolumeHistogramPresentation } from '../../../utils/chartVolume.js'
import {
  describeFuturesAlgoTrigger,
  describeFuturesOrderIntent,
  exitTitle,
  describeFuturesPosition,
  orderPresentationPrice,
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

const LOCAL_CHART_MONTHS = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
])

const padLocalChartPart = value => String(value).padStart(2, '0')

const localChartParts = (time) => {
  if (typeof time !== 'number' || !Number.isFinite(time)) return null
  const date = new Date(time * 1_000)
  if (!Number.isFinite(date.getTime())) return null
  return Object.freeze({
    year: String(date.getFullYear()),
    month: LOCAL_CHART_MONTHS[date.getMonth()],
    day: padLocalChartPart(date.getDate()),
    hour: padLocalChartPart(date.getHours()),
    minute: padLocalChartPart(date.getMinutes()),
    second: padLocalChartPart(date.getSeconds()),
  })
}

const formatLocalChartTime = (time) => {
  const parts = localChartParts(time)
  if (!parts) return ''
  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}`
}

const formatLocalChartTick = (time, tickMarkType) => {
  const parts = localChartParts(time)
  if (!parts) return null
  if (tickMarkType === TickMarkType.Year) return parts.year
  if (tickMarkType === TickMarkType.Month) return parts.month
  if (tickMarkType === TickMarkType.DayOfMonth) return `${parts.day} ${parts.month}`
  if (tickMarkType === TickMarkType.TimeWithSeconds) {
    return `${parts.hour}:${parts.minute}:${parts.second}`
  }
  return `${parts.hour}:${parts.minute}`
}

const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// A fired conditional is shown where its spawned order fired; one still resting
// uses the ordinary positive limit and then its trigger. This is deliberately a
// chart-only projection: the derived value never replaces `order.price` on the
// object sent to edit, drag, lift, drop or cancellation paths.
const chartOrderPresentationPrice = (order) => {
  const spawnedPrice = describeFuturesAlgoTrigger(order).spawnedPrice
  return spawnedPrice === null
    ? orderPresentationPrice(order)
    : orderPresentationPrice({ price: spawnedPrice, triggerPrice: orderPresentationPrice(order) })
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
const EMPTY_CHART_ROWS = Object.freeze([])
const EMPTY_SETTLING = Object.freeze([])

// What the render needs of a drag: everything it draws, and nothing that only
// the pointer handlers own.
const dragSnapshot = drag => Object.freeze({
  orderIdentity: drag.orderIdentity,
  order: drag.order,
  originPrice: drag.originPrice,
  price: drag.price,
  y: drag.y,
  status: drag.status,
})

// What tells one drag from another once several can be in the air at once. The
// pointer id stands in for an order the desk has no identity for, which cannot
// be more than one at a time anyway.
const dragKey = drag => drag.orderIdentity ?? drag.pointerId

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

const futuresPositionIdentity = position => (
  `${position?.symbol}:${position?.positionSide}`
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
  interval,
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
  // A candle scale belongs to both halves of the market selection. Reusing the
  // symbol's generation across an interval change left the replacement series
  // carrying the previous interval's fitted viewport and interaction state.
  const measurementGeneration = useMemo(
    () => Symbol(`${symbol}:${interval}`),
    [interval, symbol],
  )
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
  const dragRectRef = useRef(null)
  const requestOrderCoordinateRefreshRef = useRef(NOOP_ORDER_COORDINATE_REFRESH)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [measurement, setMeasurement] = useState(null)
  const [orderCoordinates, setOrderCoordinates] = useState([])
  const [positionAnnotationCoordinates, setPositionAnnotationCoordinates] = useState([])
  // The order the drag holds: `lifting` while the exchange is being asked to
  // cancel it, `moving` once it has, `placing` while its replacement is in
  // flight. Nothing on the book corresponds to it after the lift, which is why
  // it is drawn from here rather than from the open-orders list.
  const [orderDrag, setOrderDrag] = useState(null)
  // Drags whose gesture is over and whose business with the exchange is not.
  // They are drawn exactly as they were, and they hold no pointer: the operator
  // can pick the next order up while these land.
  //
  // A gesture ends when the operator lets go, which is not when the exchange
  // answers. Both round trips outlive it — the cancellation that lifts the
  // order and the placement that puts it back, 340-800 ms each through the
  // operator's proxy — and a drag that kept the pointer slot for either of them
  // is a chart that has stopped listening. Both are held here instead.
  const [settlingDrags, setSettlingDrags] = useState(EMPTY_SETTLING)
  const settlingRef = useRef(new Map())
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

  // The chart canvas is imperative and survives React renders. An interval can
  // therefore change one commit before its candle window arrives, and a passive
  // effect would let the previous selection reach the screen under the new
  // label. Clear both coupled series in the layout phase so that replacement is
  // atomic from the operator's point of view. Dropping the candle ref first also
  // keeps the previous range subscription from issuing a history read if
  // setData changes the logical range synchronously.
  useLayoutEffect(() => {
    candlesRef.current = EMPTY_CHART_ROWS
    rowStateRef.current = { contract: null }
    const series = seriesRef.current
    if (!series) return
    series.volumeSeries.setData(EMPTY_CHART_ROWS)
    series.contractSeries.setData(EMPTY_CHART_ROWS)
  }, [measurementGeneration])

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
      // Its own lines must not survive onto the next contract's chart.
      for (const line of [drag.lines.price, drag.lines.origin]) {
        if (!line) continue
        try {
          seriesRef.current?.contractSeries?.removePriceLine(line)
        } catch {
          // The series may already be gone; the line dies with it either way.
        }
      }
      drag.lines.price = null
      drag.lines.origin = null
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
    // A handed-over drag is still owed — either its cancellation has not
    // answered or its replacement is on its way — and that obligation is the
    // hook's, not the chart's. What cannot survive is its marks on a chart that
    // is being replaced.
    for (const settling of settlingRef.current.values()) {
      settling.abandoned = true
      for (const line of [settling.lines.price, settling.lines.origin]) {
        if (!line) continue
        try {
          seriesRef.current?.contractSeries?.removePriceLine(line)
        } catch {
          // The series may already be gone; the line dies with it either way.
        }
      }
      settling.lines.price = null
      settling.lines.origin = null
    }
    settlingRef.current.clear()
    setSettlingDrags(EMPTY_SETTLING)
    measurementRef.current = null
  }, [interval, measurementGeneration, symbol])

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
        // Standard scale ticks stay readable independently of the smaller DOM
        // annotations that name entry and liquidation lines inside the plot.
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(135, 151, 170, 0.08)' },
        horzLines: { color: 'rgba(135, 151, 170, 0.08)' },
      },
      localization: {
        // The data keeps its exchange instant. Only the labels read that instant
        // through the host clock, so Moscow (or any other local zone) agrees
        // with the workspace clock without shifting a candle on the timeline.
        timeFormatter: formatLocalChartTime,
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: 'rgba(135, 151, 170, 0.2)' },
      timeScale: {
        borderColor: 'rgba(135, 151, 170, 0.2)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: formatLocalChartTick,
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
      setPositionAnnotationCoordinates([])
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

  const oldestCandleTime = rowTime(candles?.[0])

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
  }, [historyExhausted, oldestCandleTime, onLoadHistory])

  // The order a drag is holding is not resting anywhere: it was cancelled when
  // the drag picked it up. It is drawn once, by the drag, so it is taken out of
  // every pass that draws the book's own orders — an account snapshot that has
  // not caught up yet must not put a second line back at the old price.
  // Every order that is off the book right now: the one under the pointer once
  // its cancellation is confirmed, and every one whose replacement is still
  // travelling. Each of them is drawn by its own mark, so none may also be
  // drawn as resting.
  const liftedOrderIdentities = useMemo(() => {
    const identities = new Set(settlingDrags.map(drag => drag.orderIdentity))
    if (orderDrag !== null && orderDrag.status !== 'lifting') {
      identities.add(orderDrag.orderIdentity)
    }
    return identities
  }, [orderDrag, settlingDrags])
  const restingOrders = useMemo(() => (
    liftedOrderIdentities.size === 0
      ? ownedOrders
      : ownedOrders.filter(order => !liftedOrderIdentities.has(futuresOrderIdentity(order)))
  ), [liftedOrderIdentities, ownedOrders])
  const positionAnnotations = useMemo(() => positions.flatMap((position) => {
    const presentation = describeFuturesPosition(position)
    const identity = futuresPositionIdentity(position)
    const entryPrice = toNumber(position.entryPrice)
    const liquidationPrice = toNumber(position.liquidationPrice)
    return [
      ...(entryPrice !== null && entryPrice > 0 ? [{
        key: `${identity}:entry`,
        kind: 'entry',
        label: `ENTRY ${presentation.positionSide}`,
        price: entryPrice,
        tone: presentation.tone,
      }] : []),
      ...(liquidationPrice !== null && liquidationPrice > 0 ? [{
        key: `${identity}:liquidation`,
        kind: 'liquidation',
        label: 'LIQ',
        price: liquidationPrice,
        tone: 'liquidation',
      }] : []),
    ]
  }), [positions])

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
        title: '',
      })
      addLine(position.liquidationPrice, {
        color: '#f0b90b',
        lineWidth: 1,
        lineStyle: LineStyle.LargeDashed,
        axisLabelVisible: true,
        title: '',
      })
    })
    // One-way accounts report positionSide BOTH, so a `positionSide === 'LONG'`
    // test painted every order — including plain buys — red. Colour by side.
    restingOrders.forEach((order) => {
      const intent = describeFuturesOrderIntent(order)
      addLine(chartOrderPresentationPrice(order), {
        // One pixel, like every other line on this chart. A resting order was
        // the only overlay drawn at two, and against candles a few pixels wide
        // it read as a band rather than as a price — it hid the bars sitting at
        // it, which is the one place the operator is looking when the order is
        // about to fill. Weight is kept for the drag, where it marks an action
        // in progress rather than a standing fact.
        color: intent.tone === 'buy' ? '#2bc48a' : '#ef5b69',
        lineWidth: 1,
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
          const displayPrice = chartOrderPresentationPrice(order)
          const price = toNumber(displayPrice)
          const y = price === null ? null : series.priceToCoordinate(price)
          return typeof y === 'number'
            && Number.isFinite(y)
            && y >= 0
            && y <= containerSize.height
            ? [{ order, displayPrice, y }]
            : []
        })
      const next = layoutOrderCoordinates(coordinates, containerSize.height)
      setOrderCoordinates((previous) => {
        const unchanged = previous.length === next.length && previous.every((entry, index) => (
          futuresOrderIdentity(entry.order) === futuresOrderIdentity(next[index].order)
          && entry.displayPrice === next[index].displayPrice
          && entry.anchorY === next[index].anchorY
          && entry.y === next[index].y
        ))
        return unchanged ? previous : next
      })
      const nextPositionAnnotations = !series || typeof series.priceToCoordinate !== 'function'
        ? []
        : positionAnnotations.flatMap((annotation) => {
          const y = series.priceToCoordinate(annotation.price)
          return typeof y === 'number'
            && Number.isFinite(y)
            && y >= 0
            && y <= containerSize.height
            ? [{ ...annotation, y }]
            : []
        })
      setPositionAnnotationCoordinates((previous) => {
        const unchanged = previous.length === nextPositionAnnotations.length
          && previous.every((annotation, index) => (
            annotation.key === nextPositionAnnotations[index].key
            && annotation.price === nextPositionAnnotations[index].price
            && annotation.y === nextPositionAnnotations[index].y
          ))
        return unchanged ? previous : nextPositionAnnotations
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
  }, [candles, containerSize.height, positionAnnotations, restingOrders])

  // A dragged order is shown as its own price line so the move is read on the
  // chart and on the price axis, not only on the handle badge.
  //
  // The lines belong to the drag that drew them rather than to the chart,
  // because a drag outlives the gesture: several can be drawn at once, and one
  // being handed off the pointer must take its own lines with it.
  const removeDragLines = useCallback((drag) => {
    const series = seriesRef.current?.contractSeries
    const lines = [drag.lines.price, drag.lines.origin]
    drag.lines.price = null
    drag.lines.origin = null
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

  const publishOrderDrag = useCallback(
    drag => setOrderDrag(drag === null ? null : dragSnapshot(drag)),
    [],
  )

  const publishSettling = useCallback(() => {
    const entries = [...settlingRef.current.values()].map(drag => dragSnapshot(drag))
    setSettlingDrags(entries.length === 0 ? EMPTY_SETTLING : Object.freeze(entries))
  }, [])

  const applyDragLinePrice = useCallback((drag, price) => {
    const value = toNumber(price)
    if (typeof drag.lines.price?.applyOptions !== 'function'
      || value === null
      || value <= 0) return
    drag.lines.price.applyOptions({ price: value })
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
  const drawDragLines = useCallback((drag, { price, originPrice = null }) => {
    const series = seriesRef.current?.contractSeries
    const value = toNumber(price)
    removeDragLines(drag)
    if (!series || value === null || value <= 0) return
    const intent = describeFuturesOrderIntent(drag.order)
    const origin = toNumber(originPrice)
    const lifted = origin !== null && origin > 0
    if (lifted) {
      drag.lines.origin = series.createPriceLine({
        price: origin,
        color: 'rgba(126, 143, 166, 0.45)',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: '',
      })
    }
    drag.lines.price = series.createPriceLine({
      price: value,
      color: lifted
        ? (intent.tone === 'buy' ? '#2bc48a' : '#ef5b69')
        : (intent.tone === 'buy' ? 'rgba(43, 196, 138, 0.5)' : 'rgba(239, 91, 105, 0.5)'),
      lineWidth: lifted ? 2 : 1,
      lineStyle: lifted ? LineStyle.Dashed : LineStyle.Dotted,
      axisLabelVisible: lifted,
      title: '',
    })
  }, [removeDragLines])

  // Give the pointer back, unless the gesture the operator is making now is the
  // one holding it. A mouse reports the same pointer id for every gesture, so a
  // drag that ended a round trip ago would otherwise take the capture off the
  // drag in hand — and a pointer that then left the chart would take its
  // `pointerup` with it, leaving an order lifted off the book and never dropped.
  const releasePointer = useCallback((drag) => {
    const live = orderDragRef.current
    if (live !== null && live !== drag && live.pointerId === drag.pointerId) return
    shellRef.current?.releasePointerCapture?.(drag.pointerId)
  }, [])

  // The drag is over and left nothing behind: nothing was lifted, or what was
  // lifted has been answered for.
  const releaseDrag = useCallback((drag) => {
    if (orderDragRef.current === drag) {
      orderDragRef.current = null
      dragRectRef.current = null
      publishOrderDrag(null)
    }
    if (settlingRef.current.get(dragKey(drag)) === drag) {
      settlingRef.current.delete(dragKey(drag))
      publishSettling()
    }
    removeDragLines(drag)
    releasePointer(drag)
  }, [publishOrderDrag, publishSettling, releasePointer, removeDragLines])

  // Take the drag off the pointer without ending it. The gesture is finished —
  // the operator has let go — but the exchange has not answered yet, for the
  // cancellation that lifts the order or for the placement that puts it back.
  // What it drew stays drawn, and the next order can be picked up now.
  const handOverDrag = useCallback((drag) => {
    if (orderDragRef.current === drag) {
      orderDragRef.current = null
      dragRectRef.current = null
    }
    releasePointer(drag)
    settlingRef.current.set(dragKey(drag), drag)
    publishOrderDrag(null)
    publishSettling()
  }, [publishOrderDrag, publishSettling, releasePointer])

  // Whether the drag is still one of the chart's own, on the pointer or handed
  // over. A drag the contract change swept away is neither.
  const dragIsHeld = useCallback(drag => (
    orderDragRef.current === drag || settlingRef.current.get(dragKey(drag)) === drag
  ), [])

  // The end of the drag, and the moment the obligation is discharged. The mark
  // stays on the chart, dashed, until the placement is answered: the level is
  // uncovered until then, and drawing a working order there would be a lie.
  const settleOrderDrag = useCallback((drag, { restored = false } = {}) => {
    if (drag.status === 'placing' || !dragIsHeld(drag)) return
    const abandoned = restored || toNumber(drag.price) === toNumber(drag.originPrice)
    drag.price = abandoned ? drag.originPrice : drag.price
    drag.status = 'placing'
    applyDragLinePrice(drag, drag.price)
    // The gesture is over, so the pointer is free at once — the next order can
    // be picked up while this one lands. What the drag drew is handed over with
    // it rather than removed: the level is uncovered until the placement is
    // answered, and drawing nothing there would say less than drawing it dashed
    // does. A drag released before its cancellation answered is already handed
    // over, and this only republishes it in its new state.
    handOverDrag(drag)
    Promise.resolve(onOrderDropRef.current?.({
      order: drag.order,
      price: drag.price,
      restored: abandoned,
    })).catch(() => {}).finally(() => {
      if (settlingRef.current.get(dragKey(drag)) !== drag) return
      releaseDrag(drag)
    })
  }, [applyDragLinePrice, dragIsHeld, handOverDrag, releaseDrag])

  // Picking an order up cancels it, and the gesture runs beside that
  // cancellation rather than behind it: waiting for the exchange before the mark
  // would move meant half a second of a chart that ignored the pointer.
  //
  // What waits for the answer is what the chart *claims*. Until the cancellation
  // is confirmed the order is still drawn where it rests, still labelled as being
  // lifted, and the mark under the pointer is drawn as pending — a refusal
  // removes that mark and leaves the order exactly where it was.
  //
  // Exactly one trading modifier begins it, and that is the whole of the
  // modifier's part: from here the gesture is held by the button, and what the
  // keyboard does while it is held is not the desk's business.
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
      // Drawn by this drag and removed with it. They travel with it off the
      // pointer, which is what lets several be on the chart at once.
      lines: { price: null, origin: null },
    }
    orderDragRef.current = drag
    measureDragRect()
    shellRef.current?.setPointerCapture?.(event.pointerId)
    publishOrderDrag(drag)
    drawDragLines(drag, { price: drag.price })
    Promise.resolve(onOrderLiftRef.current(order)).then((outcome) => {
      if (outcome?.ok !== true) {
        // Nothing was lifted: the order is still drawn where it rests, and the
        // refusal is stated by the surface that asked for the cancellation.
        releaseDrag(drag)
        return
      }
      if (drag.abandoned || !dragIsHeld(drag)) {
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
      drawDragLines(drag, { price: drag.price, originPrice: drag.originPrice })
      if (orderDragRef.current === drag) publishOrderDrag(drag)
      else publishSettling()
      // The gesture was over before this answer arrived. Now that the order is
      // known to be off the book, it is placed where the operator left it.
      if (drag.releasedEarly) settleOrderDrag(drag, { restored: drag.releasedRestored })
    }).catch(() => {
      releaseDrag(drag)
    })
  }, [
    dragIsHeld,
    drawDragLines,
    measureDragRect,
    publishOrderDrag,
    publishSettling,
    releaseDrag,
    settleOrderDrag,
  ])

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
    applyDragLinePrice(drag, drag.price)
    publishOrderDrag(drag)
  }, [applyDragLinePrice, measureDragRect, publishOrderDrag])

  const finishOrderDrag = useCallback((event, canceled = false) => {
    const drag = orderDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (drag.status !== 'moving' && drag.status !== 'lifting') return
    // The button holds the drag, so the button ends it, and the price it ends
    // on is the one under the pointer. The modifier is not asked about: it began
    // the gesture, and the operator's fingers come off it before the button,
    // which used to throw the move away and put the order back where it started.
    const restored = canceled
    if (drag.status === 'lifting') {
      // Released before the exchange answered. The lift discharges it when the
      // answer arrives — at the price the gesture actually ended on, which is
      // why that verdict is recorded here rather than assumed to be the origin.
      //
      // The pointer is free now regardless. Holding the slot until the
      // cancellation came back is what stopped the next order being picked up:
      // the operator flicks an order across and lets go well inside the round
      // trip, so this is the ordinary path, not the rare one.
      drag.releasedEarly = true
      drag.releasedRestored = restored
      handOverDrag(drag)
      return
    }
    settleOrderDrag(drag, { restored })
  }, [handOverDrag, settleOrderDrag])

  // Nothing listens for the modifier once a drag has begun. It used to abandon
  // the gesture on `keyup` — written when the modifier was the only thing that
  // could end a drag early — and on a desk traded by mouse that made the key,
  // not the button, the thing holding the order. The operator let go of Ctrl on
  // the way and the order went back where it came from. The way out of a drag
  // by hand is to bring the order back to the level it was lifted from, which
  // the chart marks for exactly that.

  // The one mark standing for the order the drag holds. It is not on the book,
  // so it carries what the operator needs to recognise it — side and size — and
  // says outright whether it is following the pointer or being placed.
  const liftedMarks = useMemo(() => {
    const drags = orderDrag === null ? settlingDrags : [orderDrag, ...settlingDrags]
    return drags.filter(drag => drag.y !== null).map((drag) => {
      const intent = describeFuturesOrderIntent(drag.order)
      return Object.freeze({
        key: drag.orderIdentity ?? drag.price,
        tone: intent.tone,
        label: intent.label,
        side: intent.side,
        notional: orderNotionalUsdt(drag.order),
        price: drag.price,
        y: drag.y,
        placing: drag.status === 'placing',
        // Following the pointer while the order it stands for is still on the
        // book. Drawn as a destination, not as an order.
        pending: drag.status === 'lifting',
      })
    })
  }, [orderDrag, settlingDrags])

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
        {positionAnnotationCoordinates.map(annotation => (
          <span
            className={`futures-workstation-position-annotation is-${annotation.tone}`}
            key={annotation.key}
            style={{ top: `${annotation.y}px` }}
            data-position-annotation={annotation.kind}
            data-price={annotation.price}
            role="note"
            aria-label={`${annotation.label} at ${annotation.price}`}
          >
            {annotation.label}
          </span>
        ))}
        {liftedMarks.map(liftedMark => (
          <div
            key={liftedMark.key}
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
        ))}
        {/* The coordinate pass settles a frame later than the lift does, so the
            lifted order is taken out here as well: for that one frame it would
            otherwise be drawn twice, once at the pointer and once where it no
            longer rests. */}
        {orderCoordinates.filter(({ order }) => (
          !liftedOrderIdentities.has(futuresOrderIdentity(order))
        )).map(({ order, displayPrice, y, anchorY }) => {
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
          const trigger = describeFuturesAlgoTrigger(order)
          // What the order does to the position, not only which leg it is on.
          // The line's colour says buy or sell and the leg says which position —
          // between them nothing said whether this line opens something or
          // closes it, which for a stop resting under a long is the whole
          // question being asked of it.
          // The badge is added to what is drawn, not to the accessible names:
          // those are the handles this chart's drag tests address orders by, and
          // this file belongs to another session. A visible word is what the
          // change asked for; renaming fifteen of someone else's fixtures is not.
          const exits = intent.positionEffect === 'EXIT'
          const content = (
            <>
              <b>
                {order.orderKind === 'ALGO' ? 'ALGO ' : ''}{intent.label}
                {exits ? (
                  <em
                    className="futures-workstation-owned-order-exit"
                    title={exitTitle(intent)}
                  >
                    exit
                  </em>
                ) : null}
              </b>
              <span>
                {lifting ? 'lifting…' : null}
                {/* A fired stop is not resting here for the operator to reach
                    for. It is drawn at the price it fired at because that is
                    where it happened, and it says so instead of pricing itself
                    like something still on the book. */}
                {!lifting && trigger.triggered ? 'triggered' : null}
                {!lifting && !trigger.triggered ? `${notional ?? '—'} USDT` : null}
              </span>
            </>
          )
          if (order.orderKind === 'ALGO') {
            return (
              <div
                className={`futures-workstation-owned-order is-${intent.tone} is-algo${trigger.triggered ? ' is-triggered' : ''}${displaced ? ' is-displaced' : ''}`}
                key={orderIdentity}
                style={{ top: `${top}px` }}
                data-anchor-y={anchorY}
                role="note"
                aria-label={trigger.triggered
                  ? `ALGO ${intent.side} ${intent.label} order triggered at ${displayPrice}; it fired into order ${trigger.spawnedOrderId} and is awaiting confirmation, so it is no longer working and cannot be moved or cancelled`
                  : `ALGO ${intent.side} ${intent.label} order at ${displayPrice}; price is managed by Binance and is not draggable`}
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
                aria-label={`Move ${intent.side} ${intent.label} order at ${displayPrice} with Ctrl or Alt drag`}
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
                aria-label={`Cancel ${intent.side} ${intent.label} order at ${displayPrice}`}
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
