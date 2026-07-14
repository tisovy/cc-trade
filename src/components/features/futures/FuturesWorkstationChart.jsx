import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
} from 'lightweight-charts'

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

const toVolumeData = rows => rows.flatMap((row) => {
  const value = toNumber(row.volume)
  const open = toNumber(row.open)
  const close = toNumber(row.close)
  if ([value, open, close].some(entry => entry === null)) return []
  return [{
    time: toSeconds(row.openTime),
    value,
    color: close >= open ? 'rgba(40, 190, 140, 0.42)' : 'rgba(241, 91, 105, 0.42)',
  }]
})

const toLineData = rows => rows.flatMap((row) => {
  const value = toNumber(row.close)
  return value === null ? [] : [{ time: toSeconds(row.openTime), value }]
})

const toDraftString = (value) => (
  value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
)

export const FuturesWorkstationChart = ({
  candles,
  markCandles,
  indexCandles,
  markPrice,
  indexPrice,
  drawings,
  alerts,
  onPricePick,
}) => {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const overlayLinesRef = useRef([])
  const onPricePickRef = useRef(onPricePick)

  useEffect(() => {
    onPricePickRef.current = onPricePick
  }, [onPricePick])

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
    chart.subscribeClick(handleClick)
    chartRef.current = chart
    seriesRef.current = { contractSeries, volumeSeries, markSeries, indexSeries }

    const resize = () => chart.applyOptions({
      width: Math.max(320, container.clientWidth),
      height: Math.max(320, container.clientHeight),
    })
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
      chart.unsubscribeClick(handleClick)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      overlayLinesRef.current = []
    }
  }, [])

  useEffect(() => {
    if (!seriesRef.current) return
    const contractData = toCandleData(candles)
    seriesRef.current.contractSeries.setData(contractData)
    seriesRef.current.volumeSeries.setData(toVolumeData(candles))
    seriesRef.current.markSeries.setData(toLineData(markCandles))
    seriesRef.current.indexSeries.setData(toLineData(indexCandles))
    if (contractData.length > 0) chartRef.current?.timeScale().fitContent()
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
    overlayLinesRef.current = nextLines
  }, [alerts, drawings, indexPrice, markPrice])

  return (
    <div
      className="futures-workstation-chart-canvas"
      data-testid="futures-workstation-chart"
      ref={containerRef}
      aria-label="Futures candlestick chart with volume, mark and index overlays"
    />
  )
}

export default FuturesWorkstationChart
