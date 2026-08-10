import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LIGHTWEIGHT_CHARTS_MAX_SERIES_VALUE } from '../../../utils/chartVolume.js'
import FuturesWorkstationChart, {
  FuturesWorkstationChart as UnmemoizedFuturesWorkstationChart,
} from './FuturesWorkstationChart.jsx'

const chartMock = vi.hoisted(() => ({ charts: [], openingLogicalRange: null }))

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'CandlestickSeries',
  ColorType: { Solid: 'Solid' },
  CrosshairMode: { Normal: 'Normal' },
  HistogramSeries: 'HistogramSeries',
  LineSeries: 'LineSeries',
  LineStyle: {
    Dashed: 'Dashed', Dotted: 'Dotted', LargeDashed: 'LargeDashed', Solid: 'Solid',
  },
  createChart: vi.fn(() => {
    const visibleLogicalRangeListeners = new Set()
    const timeScale = {
      coordinateToLogical: vi.fn(value => value),
      coordinateToTime: vi.fn(value => value),
      fitContent: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn((listener) => {
        visibleLogicalRangeListeners.add(listener)
      }),
      unsubscribeVisibleLogicalRangeChange: vi.fn((listener) => {
        visibleLogicalRangeListeners.delete(listener)
      }),
      emitVisibleLogicalRangeChange: (range = null) => {
        visibleLogicalRangeListeners.forEach(listener => listener(range))
      },
      visibleLogicalRange: chartMock.openingLogicalRange,
      getVisibleLogicalRange: vi.fn(() => timeScale.visibleLogicalRange),
      setVisibleLogicalRange: vi.fn((range) => {
        timeScale.visibleLogicalRange = range
      }),
    }
    const series = []
    const chart = {
      addSeries: vi.fn(() => {
        const next = {
          applyOptions: vi.fn(),
          coordinateToPrice: vi.fn(y => 60_000 - y),
          priceToCoordinate: vi.fn(price => 60_000 - price),
          // Mirrors the library's IPriceLine: a handle whose options can be
          // reapplied, which is how a dragged order line follows the pointer.
          createPriceLine: vi.fn((options) => {
            const line = { ...options }
            line.applyOptions = vi.fn((next) => Object.assign(line, next))
            return line
          }),
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

const handleOf = grip => grip.closest('.futures-workstation-owned-order')

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
  drawings: [],
  alerts: [],
  onPricePick: vi.fn(),
  onTradingGesture: vi.fn(),
  onOrderDrag: vi.fn(),
})

beforeEach(() => {
  chartMock.charts.length = 0
  chartMock.openingLogicalRange = null
})

describe('FuturesWorkstationChart viewport ownership', () => {
  it('memoizes the default renderer boundary while retaining the named unit surface', () => {
    expect(FuturesWorkstationChart.type).toBe(UnmemoizedFuturesWorkstationChart)
  })

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

  // A row that reached the candles but not the volume left the library colouring
  // a bar it could not find, and the chart died on load with "Value is null".
  it('gives the volume series a bar for every candle it draws', () => {
    const rows = [
      candle(1_784_000_000_000),
      { ...candle(1_784_000_900_000), volume: null },
      { ...candle(1_784_001_800_000), volume: 'n/a' },
      candle(1_784_002_700_000),
    ]
    render(<FuturesWorkstationChart {...properties(rows)} />)
    const [contractSeries, volumeSeries] = chartMock.charts[0].series

    const candleRows = contractSeries.setData.mock.calls.at(-1)[0]
    const volumeRows = volumeSeries.setData.mock.calls.at(-1)[0]
    expect(candleRows).toHaveLength(4)
    expect(volumeRows.map(row => row.time)).toEqual(candleRows.map(row => row.time))
    // Missing volume is drawn at zero, and still carries a colour: the library
    // rejects a bar without one.
    expect(volumeRows[1].value).toBe(0)
    expect(volumeRows.every(row => typeof row.color === 'string')).toBe(true)
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
    expect(series).toHaveLength(2)
  })

  it('leaves no draft marker or index line on the price scale', () => {
    render(<FuturesWorkstationChart {...properties([candle(1_784_000_000_000)])} />)
    const { createPriceLine } = chartMock.charts[0].series[0]
    expect(createPriceLine).not.toHaveBeenCalledWith(
      expect.objectContaining({ color: '#f0b90b' }),
    )
    expect(createPriceLine).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'INDEX' }),
    )
    expect(createPriceLine).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'LIMIT' }),
    )
  })

  // MARK and INDEX were removed from the chart by review, not by a test, so
  // nothing would have failed if either came back. These assertions are the
  // guard: the chart owns exactly the contract candles and their volume, and
  // mark or index data offered to it must change nothing at all.
  it('draws no MARK or INDEX overlay even when mark and index data are offered', () => {
    const props = properties([candle(1_784_000_000_000)])
    render(
      <FuturesWorkstationChart
        {...props}
        markPrice="58500.00"
        markCandles={[candle(1_784_000_000_000, '58500.00')]}
        indexPrice="58490.00"
        indexCandles={[candle(1_784_000_000_000, '58490.00')]}
      />,
    )
    const chart = chartMock.charts[0]

    // Two series exist: the contract candles and their volume histogram. A
    // MARK or INDEX series would be a third, and would also feed autoscaling.
    expect(chart.series).toHaveLength(2)
    expect(chart.addSeries).toHaveBeenCalledTimes(2)

    const priceLineTitles = chart.series
      .flatMap(series => series.createPriceLine.mock.calls)
      .map(([options]) => options?.title ?? '')
    expect(priceLineTitles.join(' ')).not.toMatch(/MARK|INDEX/i)

    const surface = screen.getByTestId('futures-workstation-chart')
    expect(surface.closest('[aria-label]').getAttribute('aria-label'))
      .not.toMatch(/mark|index/i)
    expect(document.body.textContent).not.toMatch(/\bMARK\b|\bINDEX\b/)
  })

  it('still hands mark price to the surfaces that own it', () => {
    // Distinguishes "the overlay was removed" from "mark price was lost": the
    // chart must not draw it, and the position row must still read it.
    render(
      <FuturesWorkstationChart
        {...properties([candle(1_784_000_000_000)])}
        positions={[{
          symbol: 'BTCUSDT',
          positionAmt: '0.500',
          entryPrice: '58000.00',
          markPrice: '58500.00',
          liquidationPrice: '50000.00',
        }]}
      />,
    )
    const chart = chartMock.charts[0]

    expect(chart.series).toHaveLength(2)
    const overlayTitles = chart.series
      .flatMap(series => series.createPriceLine.mock.calls)
      .map(([options]) => options?.title ?? '')
    expect(overlayTitles.some(title => /ENTRY/i.test(title))).toBe(true)
    expect(overlayTitles.join(' ')).not.toMatch(/MARK|INDEX/i)
  })

  it('keeps a Shift-click measurement after Shift release and clears it on the next click', () => {
    const props = properties([candle(1_784_000_000_000)])
    render(
      <FuturesWorkstationChart
        {...props}
        priceTickSize="0.1"
      />,
    )
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })

    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 100, shiftKey: true, button: 0 })
    fireEvent.click(canvas, { clientX: 20, clientY: 100, shiftKey: true, button: 0 })
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 80, shiftKey: true })
    expect(document.querySelector('.measurement-info-box')).toHaveTextContent('+0.03% +20.0')
    expect(document.querySelector('.measurement-info-box')).toHaveTextContent('40s')

    fireEvent.keyUp(globalThis, { key: 'Shift' })
    fireEvent.mouseMove(canvas, { clientX: 80, clientY: 70 })
    fireEvent.mouseLeave(canvas)
    expect(document.querySelector('.measurement-info-box')).toHaveTextContent('+0.05% +30.0')
    expect(document.querySelector('.measurement-info-box')).toHaveTextContent('1m')

    fireEvent.mouseDown(canvas, { clientX: 80, clientY: 70, button: 0 })
    fireEvent.click(canvas, { clientX: 80, clientY: 70, button: 0 })
    expect(document.querySelector('.measurement-info-box')).not.toBeInTheDocument()
    expect(props.onPricePick).not.toHaveBeenCalled()

    fireEvent.click(canvas, { clientX: 80, clientY: 70, button: 0 })
    expect(props.onPricePick).toHaveBeenCalledExactlyOnceWith('59930')
  })

  it('clears a Shift-click measurement on right click or Escape without firing a gesture', () => {
    const props = properties([candle(1_784_000_000_000)])
    render(<FuturesWorkstationChart {...props} priceTickSize="0.1" />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })

    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 100, shiftKey: true, button: 0 })
    fireEvent.click(canvas, { clientX: 20, clientY: 100, shiftKey: true, button: 0 })
    const contextMenu = createEvent.contextMenu(canvas, {
      clientX: 60, clientY: 80, ctrlKey: true, button: 2,
    })
    fireEvent(canvas, contextMenu)
    expect(contextMenu.defaultPrevented).toBe(false)
    expect(document.querySelector('.measurement-info-box')).not.toBeInTheDocument()
    expect(props.onTradingGesture).not.toHaveBeenCalled()

    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 100, shiftKey: true, button: 0 })
    fireEvent.click(canvas, { clientX: 20, clientY: 100, shiftKey: true, button: 0 })
    fireEvent.keyDown(globalThis, { key: 'Escape' })
    expect(document.querySelector('.measurement-info-box')).not.toBeInTheDocument()
    expect(props.onTradingGesture).not.toHaveBeenCalled()
    expect(props.onPricePick).not.toHaveBeenCalled()
  })

  it('clears a Shift measurement on symbol change without remounting the chart', () => {
    const candles = [candle(1_784_000_000_000)]
    const { rerender } = render(
      <FuturesWorkstationChart {...properties(candles)} symbol="BTCUSDT" priceTickSize="0.1" />,
    )
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    fireEvent.mouseDown(canvas, { clientX: 20, clientY: 100, shiftKey: true, button: 0 })
    fireEvent.click(canvas, { clientX: 20, clientY: 100, shiftKey: true, button: 0 })
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 80, shiftKey: true })
    expect(document.querySelector('.measurement-info-box')).toBeInTheDocument()

    rerender(
      <FuturesWorkstationChart {...properties(candles)} symbol="ETHUSDT" priceTickSize="0.1" />,
    )

    expect(document.querySelector('.measurement-info-box')).not.toBeInTheDocument()
    expect(chartMock.charts).toHaveLength(1)

    rerender(
      <FuturesWorkstationChart {...properties(candles)} symbol="BTCUSDT" priceTickSize="0.1" />,
    )
    expect(document.querySelector('.measurement-info-box')).not.toBeInTheDocument()
    expect(chartMock.charts).toHaveLength(1)
  })

  it('does not carry a right-click gesture candidate across the ruler lifecycle', () => {
    const props = properties([candle(1_784_000_000_000)])
    render(<FuturesWorkstationChart {...props} priceTickSize="0.1" />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })

    fireEvent.contextMenu(canvas, {
      clientX: 50, clientY: 120, ctrlKey: true, button: 2,
    })
    fireEvent.mouseDown(canvas, {
      clientX: 20, clientY: 100, shiftKey: true, button: 0,
    })
    fireEvent.click(canvas, {
      clientX: 20, clientY: 100, shiftKey: true, button: 0,
    })
    fireEvent.keyDown(globalThis, { key: 'Escape' })
    fireEvent.contextMenu(canvas, {
      clientX: 50, clientY: 120, ctrlKey: true, button: 2,
    })

    expect(props.onTradingGesture).not.toHaveBeenCalled()
  })

  it('does not join interleaved left and right clicks into a double gesture', () => {
    const props = properties([candle(1_784_000_000_000)])
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })

    fireEvent.click(canvas, { clientX: 40, clientY: 100, altKey: true, button: 0 })
    fireEvent.contextMenu(canvas, {
      clientX: 40, clientY: 100, altKey: true, button: 2,
    })
    fireEvent.click(canvas, { clientX: 40, clientY: 100, altKey: true, button: 0 })
    expect(props.onTradingGesture).not.toHaveBeenCalled()

    fireEvent.click(canvas, { clientX: 42, clientY: 102, button: 0 })
    fireEvent.contextMenu(canvas, {
      clientX: 50, clientY: 120, ctrlKey: true, button: 2,
    })
    fireEvent.click(canvas, { clientX: 50, clientY: 120, ctrlKey: true, button: 0 })
    fireEvent.contextMenu(canvas, {
      clientX: 50, clientY: 120, ctrlKey: true, button: 2,
    })
    expect(props.onTradingGesture).not.toHaveBeenCalled()
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
      // The confirmation panel opens under the cursor that asked for it.
      anchor: { x: 40, y: 100 },
    })

    const callsBeforeRightClick = props.onTradingGesture.mock.calls.length
    const unsupportedRightClick = createEvent.contextMenu(canvas, {
      clientX: 50, clientY: 120, button: 2,
    })
    fireEvent(canvas, unsupportedRightClick)
    expect(unsupportedRightClick.defaultPrevented).toBe(false)

    const firstSupportedRightClick = createEvent.contextMenu(canvas, {
      clientX: 50, clientY: 120, ctrlKey: true, button: 2,
    })
    fireEvent(canvas, firstSupportedRightClick)
    expect(firstSupportedRightClick.defaultPrevented).toBe(true)
    expect(props.onTradingGesture).toHaveBeenCalledTimes(callsBeforeRightClick)

    const recognizedRightClick = createEvent.contextMenu(canvas, {
      clientX: 50, clientY: 120, ctrlKey: true, button: 2,
    })
    fireEvent(canvas, recognizedRightClick)
    expect(recognizedRightClick.defaultPrevented).toBe(true)
    expect(props.onTradingGesture).toHaveBeenLastCalledWith(expect.objectContaining({
      side: 'SELL', positionSide: 'SHORT', positionEffect: 'ENTRY', price: '59880',
    }))

    const callsBeforeAltRightClick = props.onTradingGesture.mock.calls.length
    const firstAltRightClick = createEvent.contextMenu(canvas, {
      clientX: 70, clientY: 140, altKey: true, button: 2,
    })
    fireEvent(canvas, firstAltRightClick)
    expect(firstAltRightClick.defaultPrevented).toBe(true)
    expect(props.onTradingGesture).toHaveBeenCalledTimes(callsBeforeAltRightClick)

    const recognizedAltRightClick = createEvent.contextMenu(canvas, {
      clientX: 70, clientY: 140, altKey: true, button: 2,
    })
    fireEvent(canvas, recognizedAltRightClick)
    expect(recognizedAltRightClick.defaultPrevented).toBe(true)
    expect(props.onTradingGesture).toHaveBeenCalledTimes(callsBeforeAltRightClick + 1)
    expect(props.onTradingGesture).toHaveBeenLastCalledWith(expect.objectContaining({
      side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT', price: '59860',
    }))

    const strayAltCandidate = createEvent.contextMenu(canvas, {
      clientX: 70, clientY: 140, altKey: true, button: 2,
    })
    fireEvent(canvas, strayAltCandidate)
    expect(strayAltCandidate.defaultPrevented).toBe(true)
    const ordinaryRightClick = createEvent.contextMenu(canvas, {
      clientX: 70, clientY: 140, button: 2,
    })
    fireEvent(canvas, ordinaryRightClick)
    expect(ordinaryRightClick.defaultPrevented).toBe(false)
    const nextAltCandidate = createEvent.contextMenu(canvas, {
      clientX: 70, clientY: 140, altKey: true, button: 2,
    })
    fireEvent(canvas, nextAltCandidate)
    expect(props.onTradingGesture).toHaveBeenCalledTimes(callsBeforeAltRightClick + 1)

    const calls = props.onTradingGesture.mock.calls.length
    fireEvent.click(canvas, {
      clientX: 40, clientY: 100, altKey: true, shiftKey: true, button: 0,
    })
    fireEvent.click(canvas, {
      clientX: 40, clientY: 100, altKey: true, shiftKey: true, button: 0,
    })
    expect(props.onTradingGesture).toHaveBeenCalledTimes(calls)
  })

  it('shows the gesture legend only while exactly one trading modifier is held', () => {
    render(<FuturesWorkstationChart {...properties([candle(1_784_000_000_000)])} />)
    const hintLabel = 'Futures gesture shortcuts for the held modifier'
    expect(screen.queryByLabelText(hintLabel)).not.toBeInTheDocument()

    fireEvent.keyDown(globalThis, { key: 'Alt', altKey: true })
    expect(screen.getByLabelText(hintLabel)).toHaveTextContent('ALT · LONG')

    fireEvent.keyDown(globalThis, { key: 'Control', altKey: true, ctrlKey: true })
    expect(screen.queryByLabelText(hintLabel)).not.toBeInTheDocument()

    fireEvent.keyUp(globalThis, { key: 'Alt', ctrlKey: true })
    expect(screen.getByLabelText(hintLabel)).toHaveTextContent('CTRL · SHORT')

    fireEvent.keyUp(globalThis, { key: 'Control' })
    expect(screen.queryByLabelText(hintLabel)).not.toBeInTheDocument()
  })

  it('hides the gesture legend when trading gestures are not wired', () => {
    render(
      <FuturesWorkstationChart
        {...properties([candle(1_784_000_000_000)])}
        onTradingGesture={undefined}
      />,
    )
    fireEvent.keyDown(globalThis, { key: 'Alt', altKey: true })
    expect(screen.queryByLabelText('Futures gesture shortcuts for the held modifier'))
      .not.toBeInTheDocument()
  })

  it('marks the entry and liquidation prices of an open position on the chart', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      positions: [{
        symbol: 'BTCUSDT',
        positionSide: 'BOTH',
        quantity: '-0.5',
        entryPrice: '59900',
        liquidationPrice: '61200',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    await waitFor(() => {
      expect(chartMock.charts[0].series[0].createPriceLine).toHaveBeenCalledWith(
        // Half-opaque on purpose: the entry band must not hide the candles at
        // its own price, and its label plate carries the same translucency
        // pre-composited, because the library drops alpha from label plates.
        expect.objectContaining({
          price: 59900,
          title: 'ENTRY SHORT',
          color: 'rgba(239, 91, 105, 0.5)',
          axisLabelColor: '#7b3541',
        }),
      )
    })
    expect(chartMock.charts[0].series[0].createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 61200, title: 'LIQ' }),
    )
  })

  it('renders owned order lines and emits one Ctrl-drag amendment draft on release', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '71',
        clientOrderId: 'cc7-0123456789abcdef0123456789abcdef',
        side: 'SELL',
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
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
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
      expect.objectContaining({ price: 59900, title: '' }),
    )
    const orderContextMenu = createEvent.contextMenu(order, { button: 2 })
    fireEvent(order, orderContextMenu)
    expect(orderContextMenu.defaultPrevented).toBe(false)
  })

  it('emits one Alt-drag amendment draft on release', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '72',
        clientOrderId: 'cc7-0123456789abcdef0123456789abcdef',
        side: 'SELL',
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
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })
    fireEvent.pointerDown(order, { pointerId: 8, button: 0, altKey: true })
    fireEvent.pointerMove(order, { pointerId: 8, clientY: 80, altKey: true })
    fireEvent.pointerUp(order, { pointerId: 8, clientY: 80, altKey: true })

    expect(props.onOrderDrag).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      positionSide: 'LONG',
      clientOrderId: 'cc7-0123456789abcdef0123456789abcdef',
      price: '59920',
      modifier: 'alt',
    })
  })

  it('separates same-price regular order handles so each remains independently draggable', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '101',
        clientOrderId: 'first-same-price-order',
        side: 'SELL',
        positionSide: 'LONG',
        positionEffect: 'EXIT',
        price: '59900',
      }, {
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '102',
        clientOrderId: 'second-same-price-order',
        side: 'SELL',
        positionSide: 'SHORT',
        positionEffect: 'ENTRY',
        price: '59900',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const first = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })
    const second = await screen.findByRole('button', {
      name: 'Move SELL SHORT order at 59900 with Ctrl or Alt drag',
    })
    await waitFor(() => expect(handleOf(first).style.top).not.toBe(handleOf(second).style.top))

    fireEvent.pointerDown(first, { pointerId: 11, button: 0, ctrlKey: true })
    fireEvent.pointerMove(first, { pointerId: 11, clientY: 80, ctrlKey: true })
    fireEvent.pointerUp(first, { pointerId: 11, clientY: 80, ctrlKey: true })
    fireEvent.pointerDown(second, { pointerId: 12, button: 0, altKey: true })
    fireEvent.pointerMove(second, { pointerId: 12, clientY: 70, altKey: true })
    fireEvent.pointerUp(second, { pointerId: 12, clientY: 70, altKey: true })

    expect(props.onOrderDrag).toHaveBeenNthCalledWith(1, expect.objectContaining({
      clientOrderId: 'first-same-price-order',
      modifier: 'ctrl',
      price: '59920',
    }))
    expect(props.onOrderDrag).toHaveBeenNthCalledWith(2, expect.objectContaining({
      clientOrderId: 'second-same-price-order',
      modifier: 'alt',
      price: '59930',
    }))
  })

  it('refreshes order handle coordinates when the visible chart range changes', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '103',
        clientOrderId: 'viewport-order',
        side: 'SELL',
        positionSide: 'LONG',
        positionEffect: 'EXIT',
        price: '59900',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    const order = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })
    await waitFor(() => expect(handleOf(order)).toHaveStyle({ top: '100px' }))
    const chart = chartMock.charts[0]
    chart.series[0].priceToCoordinate.mockImplementation(price => 59_950 - price)

    act(() => chart.timeScale().emitVisibleLogicalRangeChange())

    await waitFor(() => expect(handleOf(order)).toHaveStyle({ top: '50px' }))
  })

  it('draws the dragged order as a moving price line with an axis label', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '91',
        clientOrderId: 'moving-order',
        side: 'BUY',
        positionSide: 'LONG',
        positionEffect: 'ENTRY',
        price: '59900',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const handle = await screen.findByRole('button', {
      name: 'Move BUY LONG order at 59900 with Ctrl or Alt drag',
    })
    const series = chartMock.charts[0].series[0]

    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, altKey: true })
    const movingLine = series.createPriceLine.mock.results
      .map(result => result.value)
      .find(line => line.title === 'MOVING')
    expect(movingLine).toBeDefined()
    expect(movingLine.axisLabelVisible).toBe(true)
    expect(movingLine.price).toBe(59900)

    fireEvent.pointerMove(handle, { pointerId: 4, clientY: 80, altKey: true })
    expect(movingLine.applyOptions).toHaveBeenCalledWith({ price: 59920 })

    fireEvent.pointerUp(handle, { pointerId: 4, clientY: 80, altKey: true })
    expect(series.removePriceLine).toHaveBeenCalledWith(movingLine)
  })

  // Without a mark at the origin the handle simply walks off and nothing on the
  // chart says the order is no longer resting at the price it started from.
  it('leaves the price the order is being moved off marked for the whole drag', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '77',
        clientOrderId: 'moving-order',
        side: 'BUY',
        positionSide: 'LONG',
        positionEffect: 'ENTRY',
        price: '59900',
        origQty: '0.5',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const handle = await screen.findByRole('button', {
      name: 'Move BUY LONG order at 59900 with Ctrl or Alt drag',
    })
    const series = chartMock.charts[0].series[0]

    fireEvent.pointerDown(handle, { pointerId: 9, button: 0, altKey: true })
    const originLine = series.createPriceLine.mock.results
      .map(result => result.value)
      .find(line => line.title === 'WAS')
    expect(originLine).toBeDefined()
    expect(originLine.price).toBe(59900)
    // The axis states the price being aimed at; two labels would compete there.
    expect(originLine.axisLabelVisible).toBe(false)
    expect(handleOf(handle)).toHaveClass('is-moving')

    // The origin does not follow the pointer — that is the whole point of it.
    fireEvent.pointerMove(handle, { pointerId: 9, clientY: 80, altKey: true })
    expect(originLine.applyOptions).not.toHaveBeenCalled()
    expect(originLine.price).toBe(59900)

    fireEvent.pointerUp(handle, { pointerId: 9, clientY: 80, altKey: true })
    expect(series.removePriceLine).toHaveBeenCalledWith(originLine)
    expect(handleOf(handle)).not.toHaveClass('is-moving')
  })

  it('keeps REGULAR and ALGO rows distinct when Binance reuses a client order id', async () => {
    const sharedClientOrderId = 'shared-client-order-id'
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '81',
        clientOrderId: sharedClientOrderId,
        side: 'SELL',
        positionSide: 'LONG',
        positionEffect: 'EXIT',
        price: '59900',
      }, {
        symbol: 'BTCUSDT',
        orderKind: 'ALGO',
        orderId: '82',
        clientOrderId: sharedClientOrderId,
        side: 'SELL',
        positionSide: 'SHORT',
        positionEffect: 'ENTRY',
        price: '59850',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const regularOrder = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })
    const algoOrder = screen.getByRole('note', {
      name: 'ALGO SELL SHORT order at 59850; price is managed by Binance and is not draggable',
    })

    fireEvent.pointerDown(regularOrder, { pointerId: 9, button: 0, ctrlKey: true })
    fireEvent.pointerMove(regularOrder, { pointerId: 9, clientY: 80, ctrlKey: true })

    expect(regularOrder).toHaveTextContent('59920')
    expect(algoOrder).toHaveTextContent('ALGO SHORT')
    expect(algoOrder).not.toHaveTextContent('59920')

    fireEvent.pointerUp(regularOrder, { pointerId: 9, clientY: 80, ctrlKey: true })
    expect(props.onOrderDrag).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      clientOrderId: sharedClientOrderId,
      price: '59920',
    }))
  })

  it('shows an order as notional in USDT with a cancel control and an editor on double-click', async () => {
    const onOrderCancel = vi.fn()
    const onOrderEdit = vi.fn()
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      onOrderCancel,
      onOrderEdit,
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '71',
        clientOrderId: 'notional-order',
        side: 'BUY',
        positionSide: 'BOTH',
        price: '59900',
        origQty: '0.004',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    const grip = await screen.findByRole('button', {
      name: 'Move BUY LONG order at 59900 with Ctrl or Alt drag',
    })
    expect(grip).toHaveTextContent('LONG240 USDT')

    fireEvent.doubleClick(grip, { clientX: 140, clientY: 220 })
    expect(onOrderEdit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ orderId: '71' }),
      { x: 140, y: 220 },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel BUY LONG order at 59900' }))
    expect(onOrderCancel).toHaveBeenCalledExactlyOnceWith({ symbol: 'BTCUSDT', orderId: '71' })
  })

  it('renders ALGO orders as non-draggable Binance-managed notes', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'ALGO',
        orderId: '91',
        clientOrderId: 'conditional-order-id',
        side: 'SELL',
        positionSide: 'LONG',
        positionEffect: 'EXIT',
        price: '59900',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    const algoOrder = await screen.findByRole('note', {
      name: 'ALGO SELL LONG order at 59900; price is managed by Binance and is not draggable',
    })

    fireEvent.pointerDown(algoOrder, { pointerId: 10, button: 0, altKey: true })
    fireEvent.pointerMove(algoOrder, { pointerId: 10, clientY: 80, altKey: true })
    fireEvent.pointerUp(algoOrder, { pointerId: 10, clientY: 80, altKey: true })

    expect(algoOrder).toHaveTextContent('ALGO LONG— USDT')
    expect(props.onOrderDrag).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('FuturesWorkstationChart history loading', () => {
  const MINUTE = 60_000
  const START = 1_784_000_000_000
  const series = (from, to) => Array.from(
    { length: to - from },
    (_, index) => candle(START + ((from + index) * MINUTE)),
  )

  it('asks for history on open, before the operator scrolls anywhere', () => {
    // The chart settles its opening range before anyone can subscribe to a
    // change of it, so a contract that only deepened on scroll would open
    // shallow every time.
    chartMock.openingLogicalRange = { from: 0, to: 79 }
    const onLoadHistory = vi.fn()
    render(<FuturesWorkstationChart
      {...properties(series(0, 80))}
      onLoadHistory={onLoadHistory}
    />)
    expect(onLoadHistory).toHaveBeenCalledWith(START)
  })

  it('asks again when scrolling reaches the oldest loaded candle', () => {
    const onLoadHistory = vi.fn()
    render(<FuturesWorkstationChart
      {...properties(series(0, 80))}
      onLoadHistory={onLoadHistory}
    />)
    expect(onLoadHistory).not.toHaveBeenCalled()

    act(() => chartMock.charts[0].timeScale().emitVisibleLogicalRangeChange({ from: 0, to: 79 }))
    expect(onLoadHistory).toHaveBeenCalledWith(START)

    // Deep in the middle of the series there is nothing to ask for.
    onLoadHistory.mockClear()
    act(() => chartMock.charts[0].timeScale().emitVisibleLogicalRangeChange({ from: 40, to: 79 }))
    expect(onLoadHistory).not.toHaveBeenCalled()
  })

  it('says nothing once the contract has no history left', () => {
    const onLoadHistory = vi.fn()
    render(<FuturesWorkstationChart
      {...properties(series(0, 80))}
      historyExhausted
      onLoadHistory={onLoadHistory}
    />)
    act(() => chartMock.charts[0].timeScale().emitVisibleLogicalRangeChange({ from: 0, to: 79 }))
    expect(onLoadHistory).not.toHaveBeenCalled()
  })

  it('leaves the operator looking at the same bars after older ones are prepended', () => {
    const { rerender } = render(<FuturesWorkstationChart {...properties(series(20, 100))} />)
    const timeScale = chartMock.charts[0].timeScale()
    timeScale.visibleLogicalRange = { from: 0, to: 40 }

    rerender(<FuturesWorkstationChart {...properties(series(0, 100))} />)

    // Twenty older bars moved every index forward by twenty.
    expect(timeScale.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 20, to: 60 })
  })

  it('does not move the viewport when only the last candle changed', () => {
    const { rerender } = render(<FuturesWorkstationChart {...properties(series(0, 80))} />)
    const timeScale = chartMock.charts[0].timeScale()
    timeScale.visibleLogicalRange = { from: 10, to: 50 }

    rerender(<FuturesWorkstationChart {...properties([
      ...series(0, 79),
      candle(START + (79 * MINUTE), '58500.00'),
    ])} />)

    expect(timeScale.setVisibleLogicalRange).not.toHaveBeenCalled()
  })
})

describe('FuturesWorkstationChart series writes', () => {
  const MINUTE = 60_000
  const START = 1_784_000_000_000
  const series = (from, to, volume = '1000') => Array.from(
    { length: to - from },
    (_, index) => candle(START + ((from + index) * MINUTE), '58420.25', volume),
  )

  // applyOptions recreates the formatter, forces a full chart update, and marks
  // the histogram's drawn items as needing a restyle. On every tick that keeps
  // the series permanently in the one state where the restyle can outrun the
  // data it is styling, which is how the chart died with "Value is null".
  it('applies the volume price format only when the volume scale changes', () => {
    const { rerender } = render(<FuturesWorkstationChart {...properties(series(0, 10))} />)
    const volumeSeries = chartMock.charts[0].series[1]
    expect(volumeSeries.applyOptions).toHaveBeenCalledTimes(1)

    rerender(<FuturesWorkstationChart {...properties(series(0, 11))} />)
    rerender(<FuturesWorkstationChart {...properties(series(0, 12))} />)
    expect(volumeSeries.applyOptions).toHaveBeenCalledTimes(1)

    // A volume large enough to need scaling is a different price format.
    rerender(<FuturesWorkstationChart {...properties(series(0, 13, '1e17'))} />)
    expect(volumeSeries.applyOptions).toHaveBeenCalledTimes(2)
    expect(volumeSeries.applyOptions.mock.calls.at(-1)[0].priceFormat.type).toBe('custom')
  })

  // The candles own the time scale, and the library answers a time-scale change
  // by re-sending every series' data. Writing the volume first leaves both
  // series holding the same generation of rows when the frame ends.
  it('writes the volume series before the candles that move the time scale', () => {
    const order = []
    const { rerender } = render(<FuturesWorkstationChart {...properties(series(20, 100))} />)
    const [contractSeries, volumeSeries] = chartMock.charts[0].series
    contractSeries.setData.mockImplementation(() => order.push('candles'))
    volumeSeries.setData.mockImplementation(() => order.push('volume'))

    rerender(<FuturesWorkstationChart {...properties(series(0, 100))} />)

    expect(order).toEqual(['volume', 'candles'])
  })
})
