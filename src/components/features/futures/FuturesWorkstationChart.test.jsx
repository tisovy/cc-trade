import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LIGHTWEIGHT_CHARTS_MAX_SERIES_VALUE } from '../../../utils/chartVolume.js'
import FuturesWorkstationChart from './FuturesWorkstationChart.jsx'

const chartMock = vi.hoisted(() => ({ charts: [] }))

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'CandlestickSeries',
  ColorType: { Solid: 'Solid' },
  CrosshairMode: { Normal: 'Normal' },
  HistogramSeries: 'HistogramSeries',
  LineSeries: 'LineSeries',
  LineStyle: { Dashed: 'Dashed', Dotted: 'Dotted', Solid: 'Solid' },
  createChart: vi.fn(() => {
    const timeScale = {
      fitContent: vi.fn(),
    }
    const series = []
    const chart = {
      addSeries: vi.fn(() => {
        const next = {
          applyOptions: vi.fn(),
          coordinateToPrice: vi.fn(() => 58_420.25),
          createPriceLine: vi.fn(options => options),
          removePriceLine: vi.fn(),
          setData: vi.fn(),
        }
        series.push(next)
        return next
      }),
      applyOptions: vi.fn(),
      priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
      remove: vi.fn(),
      series,
      subscribeClick: vi.fn(),
      timeScale: vi.fn(() => timeScale),
      unsubscribeClick: vi.fn(),
    }
    chartMock.charts.push(chart)
    return chart
  }),
}))

const candle = (openTime, close = '58420.25', volume = '1000.5') => Object.freeze({
  openTime,
  open: '58400.00',
  high: '58500.00',
  low: '58350.00',
  close,
  volume,
})

const properties = candles => ({
  candles,
  markCandles: candles,
  indexCandles: candles,
  markPrice: '58419.99',
  indexPrice: '58418.75',
  drawings: [],
  alerts: [],
  onPricePick: vi.fn(),
})

beforeEach(() => {
  chartMock.charts.length = 0
})

describe('FuturesWorkstationChart viewport ownership', () => {
  it('fits the first authoritative candle set once and preserves user pan on stream updates', () => {
    const initial = [candle(1_784_000_000_000)]
    const { rerender } = render(<FuturesWorkstationChart {...properties(initial)} />)
    const chart = chartMock.charts[0]

    expect(chart.timeScale().fitContent).toHaveBeenCalledTimes(1)

    const updated = [candle(1_784_000_000_000, '58430.25')]
    rerender(<FuturesWorkstationChart {...properties(updated)} />)

    expect(chart.timeScale().fitContent).toHaveBeenCalledTimes(1)
    expect(chart.series[0].setData).toHaveBeenCalledTimes(2)
  })

  it('reuses the bounded Spot volume presentation for oversized Futures volume', () => {
    render(<FuturesWorkstationChart {...properties([
      candle(1_784_000_000_000, '58420.25', '123456789012345'),
    ])} />)
    const volumeSeries = chartMock.charts[0].series[1]
    const volumeRows = volumeSeries.setData.mock.calls.at(-1)[0]
    const priceFormat = volumeSeries.applyOptions.mock.calls.at(-1)[0].priceFormat

    expect(volumeRows[0].value).toBeLessThanOrEqual(LIGHTWEIGHT_CHARTS_MAX_SERIES_VALUE)
    expect(priceFormat.type).toBe('custom')
  })

  it('formats low-price contracts from the exact exchange tick size', () => {
    render(
      <FuturesWorkstationChart
        {...properties([candle(1_784_000_000_000, '0.009362')])}
        priceTickSize="0.00000100"
      />,
    )
    const { series } = chartMock.charts[0]
    const expected = {
      priceFormat: {
        type: 'price',
        precision: 6,
        minMove: 0.000001,
      },
    }

    expect(series[0].applyOptions).toHaveBeenCalledWith(expected)
    expect(series[2].applyOptions).toHaveBeenCalledWith(expected)
    expect(series[3].applyOptions).toHaveBeenCalledWith(expected)
  })
})
