import { fireEvent, render, screen } from '@testing-library/react'
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
      coordinateToLogical: vi.fn(value => value),
      coordinateToTime: vi.fn(value => value),
      fitContent: vi.fn(),
    }
    const series = []
    const chart = {
      addSeries: vi.fn(() => {
        const next = {
          applyOptions: vi.fn(),
          coordinateToPrice: vi.fn(y => 60_000 - y),
          priceToCoordinate: vi.fn(price => 60_000 - price),
          createPriceLine: vi.fn(options => options),
          removePriceLine: vi.fn(),
          setData: vi.fn(),
          update: vi.fn(),
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
  onTradingGesture: vi.fn(),
  onOrderDrag: vi.fn(),
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
    expect(chart.series[0].setData).toHaveBeenCalledTimes(1)
    expect(chart.series[0].update).toHaveBeenCalledTimes(1)
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

  it('shows Shift price/percent/time measurement and clears it on Shift release', () => {
    render(
      <FuturesWorkstationChart
        {...properties([candle(1_784_000_000_000)])}
        priceTickSize="0.1"
      />,
    )
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })

    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 100, shiftKey: true })
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 80, shiftKey: true })
    expect(document.querySelector('.measurement-info-box')).toHaveTextContent('+0.03% +20.0')
    expect(document.querySelector('.measurement-info-box')).toHaveTextContent('40s')

    fireEvent.keyUp(globalThis, { key: 'Shift' })
    expect(document.querySelector('.measurement-info-box')).not.toBeInTheDocument()
  })

  it('maps exact chart double-click modifiers and keeps Shift combinations inert', () => {
    const props = properties([candle(1_784_000_000_000)])
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })

    fireEvent.click(canvas, { clientX: 40, clientY: 100, ctrlKey: true, button: 0 })
    fireEvent.click(canvas, { clientX: 40, clientY: 100, altKey: true, button: 0 })
    expect(props.onTradingGesture).not.toHaveBeenCalled()
    fireEvent.click(canvas, { clientX: 40, clientY: 100, altKey: true, button: 0 })
    expect(props.onTradingGesture).toHaveBeenLastCalledWith({
      side: 'BUY',
      positionSide: 'LONG',
      positionEffect: 'ENTRY',
      label: 'Enter LONG',
      price: '59900',
      source: 'chart',
    })

    const callsBeforeRightClick = props.onTradingGesture.mock.calls.length
    fireEvent.contextMenu(canvas, { clientX: 50, clientY: 120, altKey: true, button: 2 })
    fireEvent.contextMenu(canvas, { clientX: 50, clientY: 120, ctrlKey: true, button: 2 })
    expect(props.onTradingGesture).toHaveBeenCalledTimes(callsBeforeRightClick)
    fireEvent.contextMenu(canvas, { clientX: 50, clientY: 120, ctrlKey: true, button: 2 })
    expect(props.onTradingGesture).toHaveBeenLastCalledWith(expect.objectContaining({
      side: 'SELL', positionSide: 'SHORT', positionEffect: 'ENTRY', price: '59880',
    }))
    const calls = props.onTradingGesture.mock.calls.length
    fireEvent.click(canvas, {
      clientX: 40, clientY: 100, altKey: true, shiftKey: true, button: 0,
    })
    fireEvent.click(canvas, {
      clientX: 40, clientY: 100, altKey: true, shiftKey: true, button: 0,
    })
    expect(props.onTradingGesture).toHaveBeenCalledTimes(calls)
  })

  it('renders owned order lines and emits one Ctrl-drag amendment draft on release', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        clientOrderId: 'cc7-0123456789abcdef0123456789abcdef',
        positionSide: 'LONG',
        positionEffect: 'EXIT',
        price: '59900',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const order = await screen.findByRole('button', {
      name: 'Move LONG EXIT order at 59900 with Ctrl or Alt drag',
    })
    fireEvent.pointerDown(order, { pointerId: 7, button: 0, ctrlKey: true })
    fireEvent.pointerMove(order, { pointerId: 7, clientY: 80, ctrlKey: true })
    fireEvent.pointerUp(order, { pointerId: 7, clientY: 80, ctrlKey: true })

    expect(props.onOrderDrag).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      clientOrderId: 'cc7-0123456789abcdef0123456789abcdef',
      price: '59920',
      modifier: 'ctrl',
    })
    expect(chartMock.charts[0].series[0].createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 59900, title: 'LONG EXIT' }),
    )
  })
})
