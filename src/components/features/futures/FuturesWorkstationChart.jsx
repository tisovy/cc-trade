import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
} from 'lightweight-charts'
import { buildVolumeHistogramPresentation } from '../../../utils/chartVolume.js'
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

const toCandleData = rows => rows.flatMap((row) => {
  const open = toNumber(row.open)
  const high = toNumber(row.high)
  const low = toNumber(row.low)
  const close = toNumber(row.close)
  if ([open, high, low, close].some(value => value === null)) return []
  return [{ time: toSeconds(row.openTime), open, high, low, close }]
})

const toVolumeData = rows => buildVolumeHistogramPresentation(rows.flatMap((row) => {
  const value = toNumber(row.volume)
  const open = toNumber(row.open)
  const close = toNumber(row.close)
  if ([value, open, close].some(entry => entry === null)) return []
  return [{
    time: toSeconds(row.openTime),
    volume: value,
    open,
    close,
  }]
}), {
  upColor: 'rgba(40, 190, 140, 0.42)',
  downColor: 'rgba(241, 91, 105, 0.42)',
})

const toLineData = rows => rows.flatMap((row) => {
  const value = toNumber(row.close)
  return value === null ? [] : [{ time: toSeconds(row.openTime), value }]
})

const toDraftString = (value) => (
  value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
)

const CANONICAL_NONNEGATIVE_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/

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

const rememberRows = rows => rows.length === 0 ? null : Object.freeze({
  first: rowTime(rows[0]),
  last: rowTime(rows.at(-1)),
  length: rows.length,
})

export const FuturesWorkstationChart = ({
  candles,
  markCandles,
  indexCandles,
  markPrice,
  indexPrice,
  priceTickSize,
  draftPrice,
  drawings,
  alerts,
  ownedOrders = [],
  onPricePick,
  onTradingGesture,
  onOrderDrag,
}) => {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const overlayLinesRef = useRef([])
  const onPricePickRef = useRef(onPricePick)
  const onTradingGestureRef = useRef(onTradingGesture)
  const onOrderDragRef = useRef(onOrderDrag)
  const hasFittedContentRef = useRef(false)
  const rowStateRef = useRef({ contract: null, mark: null, index: null })
  const measurementRef = useRef(null)
  const lastLeftClickRef = useRef({ at: 0, x: 0, y: 0, modifier: null })
  const lastRightClickRef = useRef({ at: 0, x: 0, y: 0, modifier: null })
  const orderDragRef = useRef(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [measurement, setMeasurement] = useState(null)
  const [orderCoordinates, setOrderCoordinates] = useState([])
  const [orderDragPreview, setOrderDragPreview] = useState(null)

  useEffect(() => {
    onPricePickRef.current = onPricePick
  }, [onPricePick])

  useEffect(() => {
    onTradingGestureRef.current = onTradingGesture
  }, [onTradingGesture])

  useEffect(() => {
    onOrderDragRef.current = onOrderDrag
  }, [onOrderDrag])

  const cancelMeasurement = useCallback(() => {
    measurementRef.current = null
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
    const markSeries = chart.addSeries(LineSeries, {
      color: '#f0b90b',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    const indexSeries = chart.addSeries(LineSeries, {
      color: '#7e8fa6',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    const handleClick = (parameter) => {
      if (!parameter?.point) return
      const price = contractSeries.coordinateToPrice(parameter.point.y)
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
        onPricePickRef.current?.(toDraftString(price))
      }
    }
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
      })
      return true
    }
    const handleLeftClick = (event) => {
      const intent = resolveFuturesTradingGesture({
        button: 'left',
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      })
      if (!intent || !isFuturesTradingGestureTarget(event.target)) {
        lastLeftClickRef.current = { at: 0, x: 0, y: 0, modifier: null }
        return
      }
      const modifier = event.altKey ? 'alt' : 'ctrl'
      const current = {
        at: Date.now(), x: event.clientX, y: event.clientY, modifier,
      }
      const previous = lastLeftClickRef.current
      lastLeftClickRef.current = current
      if (current.at - previous.at > 350
        || Math.abs(current.x - previous.x) > 6
        || Math.abs(current.y - previous.y) > 6
        || previous.modifier !== modifier) return
      lastLeftClickRef.current = { at: 0, x: 0, y: 0, modifier: null }
      emitTradingGesture(event, 'left')
    }
    const handleContextMenu = (event) => {
      const intent = resolveFuturesTradingGesture({
        button: 'right',
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      })
      if (!intent || !isFuturesTradingGestureTarget(event.target)) return
      event.preventDefault()
      const modifier = event.altKey ? 'alt' : 'ctrl'
      const current = {
        at: Date.now(), x: event.clientX, y: event.clientY, modifier,
      }
      const previous = lastRightClickRef.current
      lastRightClickRef.current = current
      if (current.at - previous.at > 350
        || Math.abs(current.x - previous.x) > 6
        || Math.abs(current.y - previous.y) > 6
        || previous.modifier !== modifier) return
      lastRightClickRef.current = { at: 0, x: 0, y: 0, modifier: null }
      emitTradingGesture(event, 'right')
    }
    const handleMouseMove = (event) => {
      if (!event.shiftKey) {
        if (measurementRef.current) cancelMeasurement()
        return
      }
      const point = pointFromEvent(event)
      if (!point) return
      const start = measurementRef.current?.start ?? point
      measurementRef.current = { start, current: point }
      const deltaPrice = point.price - start.price
      let deltaTime = 0
      if (typeof start.time === 'number' && typeof point.time === 'number') {
        deltaTime = point.time - start.time
      }
      setMeasurement({
        startX: start.x,
        currentX: point.x,
        startY: start.y,
        currentY: point.y,
        deltaPrice,
        deltaPercent: start.price === 0 ? 0 : (deltaPrice / start.price) * 100,
        deltaTime,
      })
    }
    const handleKeyUp = (event) => {
      if (event.key === 'Shift' || event.key === 'Escape') cancelMeasurement()
    }
    chart.subscribeClick(handleClick)
    container.addEventListener('click', handleLeftClick)
    container.addEventListener('contextmenu', handleContextMenu)
    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mouseleave', cancelMeasurement)
    globalThis.addEventListener?.('keyup', handleKeyUp)
    chartRef.current = chart
    seriesRef.current = { contractSeries, volumeSeries, markSeries, indexSeries }

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
      globalThis.removeEventListener?.('keyup', handleKeyUp)
      container.removeEventListener('click', handleLeftClick)
      container.removeEventListener('contextmenu', handleContextMenu)
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseleave', cancelMeasurement)
      chart.unsubscribeClick(handleClick)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      overlayLinesRef.current = []
      rowStateRef.current = { contract: null, mark: null, index: null }
    }
  }, [cancelMeasurement])

  useEffect(() => {
    const priceFormat = createPriceFormat(priceTickSize)
    if (!priceFormat || !seriesRef.current) return
    const { contractSeries, markSeries, indexSeries } = seriesRef.current
    contractSeries.applyOptions({ priceFormat })
    markSeries.applyOptions({ priceFormat })
    indexSeries.applyOptions({ priceFormat })
  }, [priceTickSize])

  useEffect(() => {
    if (!seriesRef.current) return
    const contractData = toCandleData(candles)
    const volumePresentation = toVolumeData(candles)
    seriesRef.current.volumeSeries.applyOptions({
      priceFormat: volumePresentation.priceFormat,
    })
    if (canUpdateLastRow(rowStateRef.current.contract, candles)
      && contractData.length > 0
      && volumePresentation.data.length > 0) {
      seriesRef.current.contractSeries.update(contractData.at(-1))
      seriesRef.current.volumeSeries.update(volumePresentation.data.at(-1))
    } else {
      seriesRef.current.contractSeries.setData(contractData)
      seriesRef.current.volumeSeries.setData(volumePresentation.data)
    }
    const markData = toLineData(markCandles)
    if (canUpdateLastRow(rowStateRef.current.mark, markCandles) && markData.length > 0) {
      seriesRef.current.markSeries.update(markData.at(-1))
    } else {
      seriesRef.current.markSeries.setData(markData)
    }
    const indexData = toLineData(indexCandles)
    if (canUpdateLastRow(rowStateRef.current.index, indexCandles) && indexData.length > 0) {
      seriesRef.current.indexSeries.update(indexData.at(-1))
    } else {
      seriesRef.current.indexSeries.setData(indexData)
    }
    rowStateRef.current = {
      contract: rememberRows(candles),
      mark: rememberRows(markCandles),
      index: rememberRows(indexCandles),
    }
    if (contractData.length > 0 && !hasFittedContentRef.current) {
      chartRef.current?.timeScale().fitContent()
      hasFittedContentRef.current = true
    }
  }, [candles, indexCandles, markCandles])

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
    addLine(draftPrice, {
      color: '#f4f7fb',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'LIMIT',
    })
    addLine(markPrice, {
      color: '#f0b90b',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'MARK',
    })
    addLine(indexPrice, {
      color: '#7e8fa6',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: 'INDEX',
    })
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
    ownedOrders.forEach(order => addLine(order.price, {
      color: order.positionSide === 'LONG' ? '#2bc48a' : '#ef5b69',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `${order.positionSide} ${order.positionEffect}`,
    }))
    overlayLinesRef.current = nextLines
  }, [alerts, draftPrice, drawings, indexPrice, markPrice, ownedOrders])

  useEffect(() => {
    const updateCoordinates = () => {
      const series = seriesRef.current?.contractSeries
      const next = !series || typeof series.priceToCoordinate !== 'function'
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
      setOrderCoordinates((previous) => {
        const unchanged = previous.length === next.length && previous.every((entry, index) => (
          entry.order.clientOrderId === next[index].order.clientOrderId
          && entry.order.price === next[index].order.price
          && entry.y === next[index].y
        ))
        return unchanged ? previous : next
      })
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      const frame = globalThis.requestAnimationFrame(updateCoordinates)
      return () => globalThis.cancelAnimationFrame?.(frame)
    }
    const timer = globalThis.setTimeout(updateCoordinates, 0)
    return () => globalThis.clearTimeout(timer)
  }, [candles, containerSize.height, ownedOrders])

  const beginOrderDrag = useCallback((event, order) => {
    if (event.button !== 0
      || event.metaKey
      || event.shiftKey
      || event.altKey === event.ctrlKey) return
    event.preventDefault()
    event.stopPropagation()
    const modifier = event.altKey ? 'alt' : 'ctrl'
    orderDragRef.current = {
      pointerId: event.pointerId,
      modifier,
      order,
      price: order.price,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setOrderDragPreview({ clientOrderId: order.clientOrderId, price: order.price, y: null })
  }, [])

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
    event.preventDefault()
    event.stopPropagation()
    setOrderDragPreview({
      clientOrderId: drag.order.clientOrderId,
      price: drag.price,
      y,
    })
  }, [])

  const finishOrderDrag = useCallback((event, canceled = false) => {
    const drag = orderDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    orderDragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
    const modifierHeld = drag.modifier === 'alt'
      ? event.altKey && !event.ctrlKey
      : event.ctrlKey && !event.altKey
    const changed = toNumber(drag.price) !== toNumber(drag.order.price)
    if (!canceled && modifierHeld && changed) {
      onOrderDragRef.current?.({
        symbol: drag.order.symbol,
        positionSide: drag.order.positionSide,
        clientOrderId: drag.order.clientOrderId,
        price: drag.price,
        modifier: drag.modifier,
      })
    }
    setOrderDragPreview(null)
  }, [])

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
        aria-label="Futures candlestick chart with volume, mark and index overlays"
      />
      <MeasurementOverlay
        projection={measurement}
        containerSize={containerSize}
        precision={measurementPrecision}
      />
      <div className="futures-workstation-owned-order-layer" aria-label="Owned Futures orders">
        {orderCoordinates.map(({ order, y }) => {
          const preview = orderDragPreview?.clientOrderId === order.clientOrderId
            ? orderDragPreview
            : null
          const top = preview?.y ?? y
          const displayedPrice = preview?.price ?? order.price
          return (
            <button
              type="button"
              className={`futures-workstation-owned-order is-${order.positionSide.toLowerCase()}`}
              key={order.clientOrderId}
              style={{ top: `${top}px` }}
              aria-label={`Move ${order.positionSide} ${order.positionEffect} order at ${order.price} with Ctrl or Alt drag`}
              onPointerDown={event => beginOrderDrag(event, order)}
              onPointerMove={moveOrderDrag}
              onPointerUp={event => finishOrderDrag(event)}
              onPointerCancel={event => finishOrderDrag(event, true)}
              onContextMenu={event => event.preventDefault()}
            >
              <span>{order.positionSide} {order.positionEffect}</span>
              <strong>{displayedPrice}</strong>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default FuturesWorkstationChart
