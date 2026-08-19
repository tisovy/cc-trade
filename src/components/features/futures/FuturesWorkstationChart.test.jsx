import { readFileSync } from 'node:fs'
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createChart, TickMarkType } from 'lightweight-charts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFuturesOrderDrag } from '../../../hooks/useFuturesOrderDrag.js'
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
  TickMarkType: {
    Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4,
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
  // A drag begins with a cancellation and ends with a placement: the chart asks
  // for both and waits on the first, so both are promises here.
  onOrderLift: vi.fn(async () => ({ ok: true })),
  onOrderDrop: vi.fn(async () => true),
})

const workingOrder = (overrides = {}) => ({
  symbol: 'BTCUSDT',
  orderKind: 'REGULAR',
  orderId: '71',
  clientOrderId: 'cc7-0123456789abcdef0123456789abcdef',
  side: 'SELL',
  positionSide: 'LONG',
  positionEffect: 'EXIT',
  price: '59900',
  origQty: '0.5',
  ...overrides,
})

// A stop-market order as Binance reports it through the regular order read:
// REGULAR to the desk, resting with `price: '0'` while the trigger lives in
// stopPrice. There is no resting price a drag could lift it from.
const stopMarketOrder = (overrides = {}) => workingOrder({
  orderId: '77',
  clientOrderId: 'cc7-stop-market-order',
  type: 'STOP_MARKET',
  price: '0',
  triggerPrice: '57000',
  ...overrides,
})

// The chart wired to the real drag hook rather than to a mock that confirms
// every lift. The mocked `{ ok: true }` in `properties()` masked exactly the
// case this exists for: a grip offered on an order the lift path refuses.
const RealLiftHarness = ({ chartProps, dragProps }) => {
  const drag = useFuturesOrderDrag(dragProps)
  return (
    <>
      <FuturesWorkstationChart
        {...chartProps}
        onOrderLift={drag.lift}
        onOrderDrop={({ order, price, restored }) => drag.drop({ order, price, restored })}
      />
      <ol data-testid="drag-refusals">
        {drag.alerts.map(alert => (
          <li key={alert.id}>{alert.title}: {alert.detail}</li>
        ))}
      </ol>
    </>
  )
}

// The shell captures the pointer, because the grip the drag started from is
// gone the moment the exchange confirms the cancellation.
const dragSurface = () => screen.getByTestId('futures-workstation-chart').parentElement

const settle = async () => { await act(async () => {}) }

const priceLinesOf = series => series.createPriceLine.mock.results.map(result => result.value)

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

  // Position annotations live in the DOM so their smaller type does not make
  // ordinary price ticks hard to read. The volume badge is also kept off that
  // price scale, where its quantity would be mistaken for a price.
  it('sizes position annotations independently and puts no volume badge on the price scale', () => {
    render(<FuturesWorkstationChart {...properties([candle(1_784_000_000_000)])} />)

    const scaleFontSize = createChart.mock.calls.at(-1)[1].layout.fontSize
    expect(scaleFontSize).toBe(11)
    const stylesheet = readFileSync(
      'src/components/features/futures/FuturesWorkstation.css',
      'utf8',
    )
    const annotationRule = stylesheet.match(
      /--futures-position-annotation-font-size:\s*calc\([^;]*\*\s*([\d.]+)px\)/,
    )
    expect(annotationRule).not.toBeNull()
    expect(Number(annotationRule[1])).toBeLessThan(scaleFontSize)
    expect(stylesheet).toMatch(
      /\.futures-workstation-position-annotation\s*\{[^}]*font-size:\s*var\(--futures-position-annotation-font-size\)/s,
    )
    const [, volumeOptions] = chartMock.charts[0].addSeries.mock.calls
      .find(([type]) => type === 'HistogramSeries')
    expect(volumeOptions).toMatchObject({ lastValueVisible: false, priceLineVisible: false })
  })

  it('formats chart labels in host-local time without shifting shared series coordinates', () => {
    const NativeDate = globalThis.Date
    const openTime = NativeDate.parse('2026-08-18T15:22:41.000Z')
    // A non-UTC host probe: local getters read 18:22 while the inherited UTC
    // getters still read 15:22. This exercises the formatter's choice without
    // mutating process.env.TZ while other Vitest files run in parallel.
    class NonUtcDate extends NativeDate {
      getFullYear() { return 2026 }
      getMonth() { return 7 }
      getDate() { return 18 }
      getHours() { return 18 }
      getMinutes() { return 22 }
      getSeconds() { return 41 }
    }
    vi.stubGlobal('Date', NonUtcDate)

    render(<FuturesWorkstationChart {...properties([candle(openTime)])} />)

    const options = createChart.mock.calls.at(-1)[1]
    const time = Math.floor(openTime / 1_000)
    expect(options.localization.timeFormatter(time)).toBe('18 Aug 2026 18:22')
    expect(options.timeScale.tickMarkFormatter(time, TickMarkType.DayOfMonth))
      .toBe('18 Aug')
    expect(options.timeScale.tickMarkFormatter(time, TickMarkType.TimeWithSeconds))
      .toBe('18:22:41')

    const [contractSeries, volumeSeries] = chartMock.charts[0].series
    expect(contractSeries.setData.mock.calls.at(-1)[0][0].time).toBe(time)
    expect(volumeSeries.setData.mock.calls.at(-1)[0][0].time).toBe(time)
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

  it('still hands mark price to the surfaces that own it', async () => {
    // Distinguishes "the overlay was removed" from "mark price was lost": the
    // chart must not draw it, and the position row must still read it.
    render(
      <FuturesWorkstationChart
        {...properties([candle(1_784_000_000_000)])}
        positions={[{
          symbol: 'BTCUSDT',
          positionAmt: '0.500',
          entryPrice: '59900.00',
          markPrice: '58500.00',
          liquidationPrice: '59800.00',
        }]}
      />,
    )
    const chart = chartMock.charts[0]

    expect(chart.series).toHaveLength(2)
    const overlayTitles = chart.series
      .flatMap(series => series.createPriceLine.mock.calls)
      .map(([options]) => options?.title ?? '')
    expect(overlayTitles.join(' ')).not.toMatch(/MARK|INDEX/i)
    expect(await screen.findByRole('note', { name: 'ENTRY LONG at 59900' })).toBeInTheDocument()
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

  it('keeps custom position labels on their price coordinates without standard titles', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      positions: [{
        symbol: 'BTCUSDT',
        positionSide: 'BOTH',
        quantity: '-0.5',
        entryPrice: '59900',
        liquidationPrice: '59800',
      }],
    }
    const { rerender } = render(<FuturesWorkstationChart {...props} />)
    const series = chartMock.charts[0].series[0]
    await waitFor(() => {
      expect(series.createPriceLine).toHaveBeenCalledWith(
        // Half-opaque on purpose: the entry band must not hide the candles at
        // its own price, and its label plate carries the same translucency
        // pre-composited, because the library drops alpha from label plates.
        expect.objectContaining({
          price: 59900,
          title: '',
          axisLabelVisible: true,
          color: 'rgba(239, 91, 105, 0.5)',
          axisLabelColor: '#7b3541',
        }),
      )
    })
    expect(series.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 59800, title: '', axisLabelVisible: true }),
    )
    const entry = await screen.findByRole('note', { name: 'ENTRY SHORT at 59900' })
    const liquidation = await screen.findByRole('note', { name: 'LIQ at 59800' })
    expect(entry).toHaveStyle({ top: '100px' })
    expect(liquidation).toHaveStyle({ top: '200px' })

    series.priceToCoordinate.mockImplementation(price => 59_950 - price)
    act(() => chartMock.charts[0].timeScale().emitVisibleLogicalRangeChange())

    await waitFor(() => expect(entry).toHaveStyle({ top: '50px' }))
    expect(liquidation).toHaveStyle({ top: '150px' })

    series.createPriceLine.mockClear()
    rerender(<FuturesWorkstationChart {...props} positions={[{
      ...props.positions[0],
      liquidationPrice: '0',
    }]} />)
    await waitFor(() => expect(screen.queryByRole('note', { name: /LIQ at/ })).not.toBeInTheDocument())
    expect(series.createPriceLine).not.toHaveBeenCalledWith(
      expect.objectContaining({ price: 0 }),
    )
  })

  // One-way accounts report positionSide BOTH in both directions, so a flip at
  // the same entry price changes nothing the coordinate gate used to compare —
  // key, price and y all hold — while the label and tone it must repaint both
  // changed. The annotation has to state the new side without waiting for the
  // price or the viewport to move.
  it('renames the entry annotation when a one-way position flips at an unchanged entry price', async () => {
    const short = {
      symbol: 'BTCUSDT',
      positionSide: 'BOTH',
      quantity: '-0.5',
      entryPrice: '59900',
      // No liquidation figure, as a cross position can report: the entry is
      // then the only annotation, and every coordinate the gate compares is
      // identical on both sides of the flip.
      liquidationPrice: '0',
    }
    const props = { ...properties([candle(1_784_000_000_000)]), positions: [short] }
    const { rerender } = render(<FuturesWorkstationChart {...props} />)
    const annotation = await screen.findByRole('note', { name: 'ENTRY SHORT at 59900' })
    expect(annotation).toHaveClass('is-sell')

    rerender(<FuturesWorkstationChart {...props} positions={[{ ...short, quantity: '0.5' }]} />)

    const flipped = await screen.findByRole('note', { name: 'ENTRY LONG at 59900' })
    expect(flipped).toHaveClass('is-buy')
    expect(flipped).not.toHaveClass('is-sell')
    expect(screen.queryByRole('note', { name: 'ENTRY SHORT at 59900' })).not.toBeInTheDocument()
  })

  it('draws stop-market orders at trigger and stop-limit orders at limit without rewriting actions', async () => {
    const regularStop = Object.freeze(workingOrder({
      orderId: 'stop-market',
      clientOrderId: 'regular-stop-market',
      price: '0',
      triggerPrice: '59850',
    }))
    const algoStop = Object.freeze(workingOrder({
      orderKind: 'ALGO',
      algoType: 'CONDITIONAL',
      orderId: 'algo-stop-market',
      clientOrderId: 'algo-stop-market',
      price: '0',
      triggerPrice: '59750',
    }))
    const stopLimit = Object.freeze(workingOrder({
      orderId: 'stop-limit',
      clientOrderId: 'regular-stop-limit',
      price: '59910',
      triggerPrice: '59800',
    }))
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [regularStop, algoStop, stopLimit],
      onOrderCancel: vi.fn(),
      onOrderEdit: vi.fn(),
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const series = chartMock.charts[0].series[0]

    await waitFor(() => {
      for (const price of [59850, 59750, 59910]) {
        expect(series.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price }))
        expect(series.priceToCoordinate).toHaveBeenCalledWith(price)
      }
    })

    // The stop-market is drawn at its trigger but rests at no price, so it
    // offers no grip and no double-click editor — the lift path could only
    // ever refuse it, and the editor edits the resting price it does not
    // have. Cancelling stays, named at the price the order is drawn at.
    const plate = screen.getByRole('note', {
      name: 'SELL LONG order resting at no price; it cannot be moved by dragging',
    })
    fireEvent.doubleClick(plate, { clientX: 120, clientY: 220 })
    expect(props.onOrderEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel SELL LONG order at 59850' }))
    expect(props.onOrderCancel).toHaveBeenCalledExactlyOnceWith({
      symbol: 'BTCUSDT',
      orderId: 'stop-market',
    })
    fireEvent.pointerDown(plate, { pointerId: 31, button: 0, altKey: true })
    await settle()
    expect(props.onOrderLift).not.toHaveBeenCalled()
    // The stop-limit rests at its limit price and keeps its grip.
    expect(screen.getByRole('button', {
      name: 'Move SELL LONG order at 59910 with Ctrl or Alt drag',
    })).toBeInTheDocument()
    expect(regularStop).toEqual(expect.objectContaining({ price: '0', triggerPrice: '59850' }))
    expect(algoStop).toEqual(expect.objectContaining({ price: '0', triggerPrice: '59750' }))
  })

  // The drag is a cancellation followed by a placement, and the operator asked
  // for exactly that: the order they pick up leaves the book.
  it('cancels the order the drag lifts and places it again where it is dropped', async () => {
    const props = { ...properties([candle(1_784_000_000_000)]), ownedOrders: [workingOrder()] }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const order = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(order, { pointerId: 7, button: 0, ctrlKey: true })
    expect(props.onOrderLift).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ orderId: '71' }),
    )
    // Until Binance answers, the order is still working and still says so.
    expect(order).toHaveTextContent('lifting…')
    expect(props.onOrderDrop).not.toHaveBeenCalled()

    await settle()
    const surface = dragSurface()
    fireEvent.pointerMove(surface, { pointerId: 7, clientY: 80, ctrlKey: true })
    fireEvent.pointerUp(surface, { pointerId: 7, clientY: 80, ctrlKey: true })
    await settle()

    expect(props.onOrderDrop).toHaveBeenCalledExactlyOnceWith({
      order: expect.objectContaining({ orderId: '71' }),
      price: '59920',
      restored: false,
    })
  })

  // The operator dropped one order and reached straight for the next, and the
  // chart did not begin the gesture at all: the settling drag still held the
  // single drag slot until its placement was answered — one round trip through
  // their proxy, 340–800 ms, during which the chart looked like it had stopped
  // listening.
  it('begins the next drag while the last replacement is still travelling', async () => {
    let settlePlacement
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [workingOrder(), workingOrder({ orderId: '72', price: '59700' })],
      onOrderDrop: vi.fn(() => new Promise((resolve) => { settlePlacement = resolve })),
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })

    const first = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })
    fireEvent.pointerDown(first, { pointerId: 7, button: 0, ctrlKey: true })
    await settle()
    const surface = dragSurface()
    fireEvent.pointerMove(surface, { pointerId: 7, clientY: 80, ctrlKey: true })
    fireEvent.pointerUp(surface, { pointerId: 7, clientY: 80, ctrlKey: true })
    await settle()
    expect(props.onOrderDrop).toHaveBeenCalledOnce()

    // Still travelling, and still drawn — the level it is aimed at is uncovered
    // until Binance answers.
    expect(screen.getByText('placing…')).toBeInTheDocument()

    const second = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59700 with Ctrl or Alt drag',
    })
    fireEvent.pointerDown(second, { pointerId: 8, button: 0, ctrlKey: true })
    await settle()

    expect(props.onOrderLift).toHaveBeenCalledTimes(2)
    expect(props.onOrderLift).toHaveBeenLastCalledWith(
      expect.objectContaining({ orderId: '72' }),
    )

    settlePlacement(true)
    await settle()
  })

  // The operator's own speed. They flick an order across and let go inside the
  // round trip, so the gesture is over before the cancellation is answered —
  // and the test above never covered it, because it let the lift resolve before
  // the pointer came up. Held in the slot, the drag refused the next grab: "не
  // даёт схватить другой пока не закончит предыдущий".
  it('begins the next drag when the last gesture ended before its cancellation answered', async () => {
    // One resolver per lift: the second gesture must not be able to answer the
    // first one's cancellation.
    const confirmLift = []
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [workingOrder(), workingOrder({ orderId: '72', price: '59700' })],
      onOrderLift: vi.fn(() => new Promise((resolve) => { confirmLift.push(resolve) })),
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })

    const first = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })
    // One pointer id throughout: a mouse reports the same one for every gesture,
    // and giving each drag its own would test a desk nobody is sitting at.
    fireEvent.pointerDown(first, { pointerId: 1, button: 0, ctrlKey: true })
    const surface = dragSurface()
    fireEvent.pointerMove(surface, { pointerId: 1, clientY: 80, ctrlKey: true })
    // Let go while the cancellation is still travelling.
    fireEvent.pointerUp(surface, { pointerId: 1, clientY: 80, ctrlKey: true })
    await settle()
    expect(props.onOrderDrop).not.toHaveBeenCalled()

    const second = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59700 with Ctrl or Alt drag',
    })
    fireEvent.pointerDown(second, { pointerId: 1, button: 0, ctrlKey: true })
    await settle()

    expect(props.onOrderLift).toHaveBeenCalledTimes(2)
    expect(props.onOrderLift).toHaveBeenLastCalledWith(
      expect.objectContaining({ orderId: '72' }),
    )

    // And the first is still owed: its cancellation answers, and the price the
    // gesture ended on is the price it is placed at.
    confirmLift[0]({ ok: true })
    await settle()
    expect(props.onOrderDrop).toHaveBeenCalledOnce()
    expect(props.onOrderDrop).toHaveBeenCalledWith(
      expect.objectContaining({ restored: false }),
    )
  })

  // A mouse reports the same pointer id for every gesture it makes, so a drag
  // that has been let go must not hand that id back while the next gesture is
  // holding it: the capture would be taken from the drag the operator is making
  // now, and a pointer that leaves the chart would take its `pointerup` with it
  // — an order lifted off the book and never dropped. jsdom implements no
  // pointer capture, so what is measured here is what the chart asks for.
  it('leaves the live gesture its pointer when an earlier drag is discharged', async () => {
    const confirmLift = []
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [workingOrder(), workingOrder({ orderId: '72', price: '59700' })],
      onOrderLift: vi.fn(() => new Promise((resolve) => { confirmLift.push(resolve) })),
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const surface = dragSurface()
    surface.setPointerCapture = vi.fn()
    surface.releasePointerCapture = vi.fn()

    const first = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })
    fireEvent.pointerDown(first, { pointerId: 1, button: 0, ctrlKey: true })
    fireEvent.pointerMove(surface, { pointerId: 1, clientY: 80, ctrlKey: true })
    fireEvent.pointerUp(surface, { pointerId: 1, clientY: 80, ctrlKey: true })
    await settle()

    // The next gesture takes the same pointer.
    const second = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59700 with Ctrl or Alt drag',
    })
    fireEvent.pointerDown(second, { pointerId: 1, button: 0, ctrlKey: true })
    await settle()
    expect(surface.setPointerCapture).toHaveBeenLastCalledWith(1)
    surface.releasePointerCapture.mockClear()

    // The first drag is discharged from under it: cancellation, then placement.
    confirmLift[0]({ ok: true })
    await settle()
    expect(props.onOrderDrop).toHaveBeenCalledOnce()
    await settle()

    expect(surface.releasePointerCapture).not.toHaveBeenCalled()
  })

  // The modifier begins the drag and is asked for nothing after that. The
  // operator's fingers come off Ctrl before the button — which used to throw
  // the move away and put the order back where it started.
  it('places the order where the pointer left it, with the modifier long gone', async () => {
    const props = { ...properties([candle(1_784_000_000_000)]), ownedOrders: [workingOrder()] }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const order = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(order, { pointerId: 8, button: 0, altKey: true })
    await settle()
    const surface = dragSurface()
    fireEvent.pointerMove(surface, { pointerId: 8, clientY: 80, altKey: true })
    // Alt goes, mid-gesture, with the button still down. The drag is the
    // operator's until they let go of it.
    fireEvent.keyUp(globalThis, { key: 'Alt' })
    fireEvent.pointerMove(surface, { pointerId: 8, clientY: 60, altKey: false })
    await settle()
    expect(screen.getByRole('status', { name: /following the pointer at 59940/ }))
      .toBeInTheDocument()

    fireEvent.pointerUp(surface, { pointerId: 8, clientY: 60 })
    await settle()

    expect(props.onOrderDrop).toHaveBeenCalledExactlyOnceWith({
      order: expect.objectContaining({ orderId: '71' }),
      price: '59940',
      restored: false,
    })
  })

  // What abandons a drag by hand now that the modifier does not: bringing the
  // order back to the level it was lifted from, which the chart marks.
  it('places the order again where it was lifted from when it is dropped there', async () => {
    const props = { ...properties([candle(1_784_000_000_000)]), ownedOrders: [workingOrder()] }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const order = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(order, { pointerId: 8, button: 0, altKey: true })
    await settle()
    const surface = dragSurface()
    fireEvent.pointerMove(surface, { pointerId: 8, clientY: 80, altKey: true })
    // Back to the price it came from — 60 000 less the coordinate is 59 900.
    fireEvent.pointerMove(surface, { pointerId: 8, clientY: 100, altKey: true })
    fireEvent.pointerUp(surface, { pointerId: 8, clientY: 100, altKey: true })
    await settle()

    expect(props.onOrderDrop).toHaveBeenCalledExactlyOnceWith({
      order: expect.objectContaining({ orderId: '71' }),
      price: '59900',
      restored: true,
    })
  })

  // A cancellation the exchange refuses leaves the order exactly where it was,
  // and the drag never starts — there is no state where the chart shows a
  // lifted order that is still resting on the book.
  it('starts no drag when the cancellation is not confirmed', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      onOrderLift: vi.fn(async () => ({ ok: false })),
      ownedOrders: [workingOrder()],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const order = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(order, { pointerId: 9, button: 0, ctrlKey: true })
    await settle()
    const surface = dragSurface()
    fireEvent.pointerMove(surface, { pointerId: 9, clientY: 80, ctrlKey: true })
    fireEvent.pointerUp(surface, { pointerId: 9, clientY: 80, ctrlKey: true })
    await settle()

    expect(props.onOrderDrop).not.toHaveBeenCalled()
    // Still listed, still drawn, still worth what it was.
    expect(screen.getByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })).toHaveTextContent('29950 USDT')
    expect(screen.queryByRole('status', { name: /lifted off the book/ })).not.toBeInTheDocument()
    // Nor the mark the gesture followed while the answer was outstanding.
    expect(screen.queryByRole('status', { name: /heading for/ })).not.toBeInTheDocument()
  })

  // The gesture does not wait on a round trip to Binance. The cancellation runs
  // beside it; what waits for the answer is what the chart claims, not what it
  // follows.
  it('follows the pointer while the cancellation is still in flight', async () => {
    let confirmLift = null
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      onOrderLift: vi.fn(() => new Promise((resolve) => { confirmLift = resolve })),
      ownedOrders: [workingOrder()],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const order = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })
    const series = chartMock.charts[0].series[0]

    fireEvent.pointerDown(order, { pointerId: 21, button: 0, ctrlKey: true })
    await settle()
    // Drawn as a destination: no axis label, because no order is there.
    const pendingLine = priceLinesOf(series).find(line => line.lineStyle === 'Dotted')
    expect(pendingLine).toMatchObject({ price: 59900, axisLabelVisible: false })

    const surface = dragSurface()
    fireEvent.pointerMove(surface, { pointerId: 21, clientY: 80, ctrlKey: true })
    await settle()
    expect(pendingLine.applyOptions).toHaveBeenCalledWith({ price: 59920 })

    // Moving already, and saying outright that nothing has been lifted yet.
    expect(screen.getByRole('status', { name: /heading for 59920/ }))
      .toHaveClass('is-pending')
    // The order it stands for is still on the book, still drawn where it rests.
    expect(screen.getByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })).toHaveTextContent('lifting…')

    const drawnBeforeConfirmation = priceLinesOf(series).length
    confirmLift({ ok: true })
    await settle()
    expect(screen.getByRole('status', {
      name: /lifted off the book, following the pointer at 59920/,
    })).not.toHaveClass('is-pending')
    // Confirmed gone: the resting mark is the one that goes now, and the level
    // it left is marked where it actually was, not where the pointer had got to.
    expect(screen.queryByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })).not.toBeInTheDocument()
    expect(series.removePriceLine).toHaveBeenCalledWith(pendingLine)
    expect(priceLinesOf(series).slice(drawnBeforeConfirmation)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ price: 59900, lineStyle: 'Dotted', axisLabelVisible: false }),
        expect.objectContaining({ price: 59920, lineStyle: 'Dashed', axisLabelVisible: true }),
      ]),
    )
  })

  // A drag fast enough to finish inside the round trip is the ordinary case now
  // that it starts on the pointer. The drop is the operator's move, and it is
  // honoured where it landed.
  it('places the replacement where a drop that beat the answer landed', async () => {
    let confirmLift = null
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      onOrderLift: vi.fn(() => new Promise((resolve) => { confirmLift = resolve })),
      ownedOrders: [workingOrder()],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const order = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(order, { pointerId: 22, button: 0, ctrlKey: true })
    await settle()
    const surface = dragSurface()
    fireEvent.pointerMove(surface, { pointerId: 22, clientY: 80, ctrlKey: true })
    fireEvent.pointerUp(surface, { pointerId: 22, clientY: 80, ctrlKey: true })
    await settle()
    // Nothing is owed until the cancellation is confirmed.
    expect(props.onOrderDrop).not.toHaveBeenCalled()

    confirmLift({ ok: true })
    await settle()
    expect(props.onOrderDrop).toHaveBeenCalledExactlyOnceWith({
      order: expect.objectContaining({ orderId: '71' }),
      price: '59920',
      restored: false,
    })
  })

  // The modifier let go while the cancellation is still out is still not the
  // operator letting go of the order: the button is down, so the drag is theirs.
  it('keeps a drag whose modifier is released before the answer arrives', async () => {
    let confirmLift = null
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      onOrderLift: vi.fn(() => new Promise((resolve) => { confirmLift = resolve })),
      ownedOrders: [workingOrder()],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const order = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(order, { pointerId: 24, button: 0, ctrlKey: true })
    await settle()
    const surface = dragSurface()
    fireEvent.pointerMove(surface, { pointerId: 24, clientY: 80, ctrlKey: true })
    await settle()
    expect(screen.getByRole('status', { name: /heading for 59920/ })).toBeInTheDocument()

    // The modifier goes while the pointer is still down and the cancellation is
    // still out.
    fireEvent.keyUp(globalThis, { key: 'Control' })
    fireEvent.pointerMove(surface, { pointerId: 24, clientY: 40, ctrlKey: false })
    await settle()
    // The mark went on with the pointer.
    expect(screen.getByRole('status', { name: /heading for 59960/ })).toBeInTheDocument()

    confirmLift({ ok: true })
    await settle()
    expect(props.onOrderDrop).not.toHaveBeenCalled()

    fireEvent.pointerUp(surface, { pointerId: 24, clientY: 40 })
    await settle()
    expect(props.onOrderDrop).toHaveBeenCalledExactlyOnceWith({
      order: expect.objectContaining({ orderId: '71' }),
      price: '59960',
      restored: false,
    })
  })

  it('restores the origin when the gesture is cancelled before the answer arrives', async () => {
    let confirmLift = null
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      onOrderLift: vi.fn(() => new Promise((resolve) => { confirmLift = resolve })),
      ownedOrders: [workingOrder()],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const order = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(order, { pointerId: 23, button: 0, ctrlKey: true })
    await settle()
    const surface = dragSurface()
    fireEvent.pointerMove(surface, { pointerId: 23, clientY: 80, ctrlKey: true })
    // The pointer was taken away rather than released — the one ending the
    // operator did not choose — and the answer that arrives afterwards puts the
    // order back where it came from.
    fireEvent.pointerCancel(surface, { pointerId: 23, clientY: 80, ctrlKey: true })
    await settle()

    confirmLift({ ok: true })
    await settle()
    expect(props.onOrderDrop).toHaveBeenCalledExactlyOnceWith({
      order: expect.objectContaining({ orderId: '71' }),
      price: '59900',
      restored: true,
    })
  })

  it('leaves every other order untouched while one is being dragged', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [
        workingOrder({ orderId: '101', clientOrderId: 'first-same-price-order' }),
        workingOrder({
          orderId: '102',
          clientOrderId: 'second-same-price-order',
          positionSide: 'SHORT',
          positionEffect: 'ENTRY',
        }),
      ],
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
    await settle()
    fireEvent.pointerMove(dragSurface(), { pointerId: 11, clientY: 80, ctrlKey: true })

    // One mark for the dragged order, and the other order exactly as it was.
    expect(screen.getAllByRole('status', { name: /lifted off the book/ })).toHaveLength(1)
    expect(screen.getByRole('button', {
      name: 'Move SELL SHORT order at 59900 with Ctrl or Alt drag',
    })).toHaveTextContent('29950 USDT')

    fireEvent.pointerUp(dragSurface(), { pointerId: 11, clientY: 80, ctrlKey: true })
    await settle()
    expect(props.onOrderDrop).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      order: expect.objectContaining({ clientOrderId: 'first-same-price-order' }),
      price: '59920',
      restored: false,
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

  it('draws the lifted order at the pointer, dashed, until the exchange answers', async () => {
    let answerPlacement = null
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      onOrderDrop: vi.fn(() => new Promise((resolve) => { answerPlacement = resolve })),
      ownedOrders: [workingOrder({ orderId: '91', side: 'BUY', positionEffect: 'ENTRY' })],
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
    await settle()
    const movingLine = priceLinesOf(series).find(line => line.lineStyle === 'Dashed')
    expect(movingLine).toMatchObject({ price: 59900, axisLabelVisible: true })

    fireEvent.pointerMove(dragSurface(), { pointerId: 4, clientY: 80, altKey: true })
    expect(movingLine.applyOptions).toHaveBeenCalledWith({ price: 59920 })

    fireEvent.pointerUp(dragSurface(), { pointerId: 4, clientY: 80, altKey: true })
    await settle()
    // The replacement is in flight: the level is uncovered, and nothing on the
    // chart says an order is resting there.
    expect(screen.getByRole('status', { name: /being placed at 59920/ }))
      .toHaveTextContent('placing…')
    expect(screen.queryByRole('button', { name: /Move BUY LONG order/ })).not.toBeInTheDocument()

    await act(async () => { answerPlacement(true) })
    expect(series.removePriceLine).toHaveBeenCalledWith(movingLine)
    expect(screen.queryByRole('status', { name: /lifted off the book|being placed/ }))
      .not.toBeInTheDocument()
  })
  // A layout read is only cheap against a clean layout, and the desk's is never
  // clean: the book, the dock and the header write to the DOM the whole time the
  // drag is running. Measuring the chart on every pointer move made the browser
  // lay the entire desk out again before it would answer — once a frame, on the
  // frame's critical path, and the busier the desk the slower the drag.
  it('measures the chart once for a drag, not once for every pointer move', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [workingOrder({ orderId: '96', side: 'BUY', positionEffect: 'ENTRY' })],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    const measure = vi.fn(() => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    }))
    canvas.getBoundingClientRect = measure
    const handle = await screen.findByRole('button', {
      name: 'Move BUY LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(handle, { pointerId: 11, button: 0, altKey: true })
    await settle()
    const measuredForTheLift = measure.mock.calls.length
    expect(measuredForTheLift).toBeGreaterThan(0)

    for (const clientY of [80, 84, 88, 92, 96]) {
      fireEvent.pointerMove(dragSurface(), { pointerId: 11, clientY, altKey: true })
    }

    expect(screen.getByRole('status', { name: /lifted off the book, following the pointer at 59904/ }))
      .toBeInTheDocument()
    expect(measure).toHaveBeenCalledTimes(measuredForTheLift)

    // A resize is the one thing that moves the chart's box under a captured
    // pointer, so the measurement it invalidates is taken again.
    fireEvent(globalThis, new Event('resize'))
    fireEvent.pointerMove(dragSurface(), { pointerId: 11, clientY: 100, altKey: true })
    expect(measure.mock.calls.length).toBeGreaterThan(measuredForTheLift)
  })

  // `top` is a layout property: written at pointer rate it marks the desk's
  // layout dirty every frame, and the next box anyone reads — this chart, the
  // charting library, any panel — is paid for with a fresh layout pass.
  it('moves the lifted mark by transform, leaving the desk layout alone', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [workingOrder({ orderId: '97', side: 'BUY', positionEffect: 'ENTRY' })],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const handle = await screen.findByRole('button', {
      name: 'Move BUY LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(handle, { pointerId: 12, button: 0, altKey: true })
    await settle()
    fireEvent.pointerMove(dragSurface(), { pointerId: 12, clientY: 80, altKey: true })

    const lifted = screen.getByRole('status', { name: /lifted off the book/ })
    expect(lifted.style.top).toBe('0px')
    expect(lifted.style.transform).toBe('translate3d(0, 80px, 0) translateY(-50%)')
  })

  // Pointer moves arrive whether or not they change the price: sideways, or a
  // fraction of the row the mark already sits on. Redrawing on those repaints
  // the chart to put the line back exactly where it is.
  it('leaves the chart alone for a move that stays on the same row', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [workingOrder({ orderId: '98', side: 'BUY', positionEffect: 'ENTRY' })],
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

    fireEvent.pointerDown(handle, { pointerId: 13, button: 0, altKey: true })
    await settle()
    const movingLine = priceLinesOf(series).find(line => line.lineStyle === 'Dashed')

    fireEvent.pointerMove(dragSurface(), { pointerId: 13, clientY: 80, altKey: true })
    expect(movingLine.applyOptions).toHaveBeenCalledTimes(1)

    fireEvent.pointerMove(dragSurface(), { pointerId: 13, clientX: 200, clientY: 80, altKey: true })
    expect(movingLine.applyOptions).toHaveBeenCalledTimes(1)

    fireEvent.pointerMove(dragSurface(), { pointerId: 13, clientY: 81, altKey: true })
    expect(movingLine.applyOptions).toHaveBeenCalledTimes(2)
  })

  // Every label and value on a handle is sized by the rules that style its
  // plate. Left as bare children of the handle, the dragged order's value fell
  // outside all of them and rendered at the desk's body size inside a 16px
  // plate — the drag looked broken on screen for as long as it lasted.
  it('draws the lifted order on the same plate a resting one is drawn on', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [workingOrder({ orderId: '93', side: 'BUY', positionEffect: 'ENTRY' })],
    }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const handle = await screen.findByRole('button', {
      name: 'Move BUY LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(handle, { pointerId: 5, button: 0, altKey: true })
    await settle()
    fireEvent.pointerMove(dragSurface(), { pointerId: 5, clientY: 80, altKey: true })

    const lifted = screen.getByRole('status', { name: /lifted off the book/ })
    const plate = lifted.querySelector('.futures-workstation-owned-order-plate')
    expect(plate).not.toBeNull()
    // Nothing is drawn outside it: the handle is a positioning box only.
    expect(lifted.children).toHaveLength(1)
    expect(plate).toHaveTextContent('LONG')
    expect(plate).toHaveTextContent('59920')
    expect(plate).toHaveTextContent('29950 USDT')
  })

  // The order is gone from the book the moment the drag starts, so the level it
  // was lifted from carries one faint, unlabelled mark and nothing else.
  it('marks the price it was lifted from once, faintly and without an axis label', async () => {
    const props = { ...properties([candle(1_784_000_000_000)]), ownedOrders: [workingOrder()] }
    render(<FuturesWorkstationChart {...props} />)
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    const handle = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })
    const series = chartMock.charts[0].series[0]

    fireEvent.pointerDown(handle, { pointerId: 9, button: 0, altKey: true })
    await settle()
    const originLine = priceLinesOf(series).find(line => line.lineStyle === 'Dotted')
    expect(originLine).toMatchObject({
      price: 59900,
      axisLabelVisible: false,
      title: '',
    })
    // The order itself no longer has a working-order handle: it is not working.
    expect(screen.queryByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })).not.toBeInTheDocument()

    // The origin does not follow the pointer — that is the whole point of it.
    fireEvent.pointerMove(dragSurface(), { pointerId: 9, clientY: 80, altKey: true })
    expect(originLine.applyOptions).not.toHaveBeenCalled()
    expect(originLine.price).toBe(59900)

    fireEvent.pointerUp(dragSurface(), { pointerId: 9, clientY: 80, altKey: true })
    await settle()
    expect(series.removePriceLine).toHaveBeenCalledWith(originLine)
  })

  // The chart is what the operator trades from, and a marker there at a price
  // the market has already gone through is the whole complaint: it reads as an
  // order that is still on the book.
  it('draws an algo that has fired as triggered rather than as working at its trigger', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [
        workingOrder({
          orderKind: 'ALGO',
          algoType: 'CONDITIONAL',
          orderId: '82',
          positionSide: 'SHORT',
          positionEffect: 'ENTRY',
          price: '0',
          triggerPrice: '59850',
          actualOrderId: '990281234',
          actualPrice: '59848.3',
        }),
      ],
    }
    render(<FuturesWorkstationChart {...props} />)
    screen.getByTestId('futures-workstation-chart').getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })

    const series = chartMock.charts[0].series[0]
    await waitFor(() => {
      expect(series.createPriceLine).toHaveBeenCalledWith(
        expect.objectContaining({ price: 59848.3 }),
      )
      expect(series.priceToCoordinate).toHaveBeenCalledWith(59848.3)
    })
    const fired = await screen.findByRole('note', { name: /triggered at 59848\.3/ })
    expect(fired.getAttribute('aria-label'))
      .toContain('fired into order 990281234 and is awaiting confirmation')
    expect(fired.getAttribute('aria-label')).toContain('cannot be moved or cancelled')
    expect(fired).toHaveClass('is-triggered')
    expect(fired).toHaveTextContent('triggered')
    // A fired stop is not worth a resting order's notional: it is not resting.
    expect(fired).not.toHaveTextContent('USDT')

    // And the wording it used to carry — the one that said it was still managed
    // and merely undraggable — is gone.
    expect(screen.queryByRole('note', { name: /price is managed by Binance/ })).toBeNull()
  })

  it('keeps REGULAR and ALGO rows distinct when Binance reuses a client order id', async () => {
    const sharedClientOrderId = 'shared-client-order-id'
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [
        workingOrder({ orderId: '81', clientOrderId: sharedClientOrderId }),
        workingOrder({
          orderKind: 'ALGO',
          orderId: '82',
          clientOrderId: sharedClientOrderId,
          positionSide: 'SHORT',
          positionEffect: 'ENTRY',
          price: '59850',
        }),
      ],
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
    await settle()
    fireEvent.pointerMove(dragSurface(), { pointerId: 9, clientY: 80, ctrlKey: true })

    // The lifted one is drawn once, at the pointer; the ALGO row is untouched.
    expect(screen.getByRole('status', { name: /lifted off the book/ }))
      .toHaveTextContent('59920')
    expect(algoOrder).toHaveTextContent('ALGO SHORT')
    expect(algoOrder).not.toHaveTextContent('59920')

    fireEvent.pointerUp(dragSurface(), { pointerId: 9, clientY: 80, ctrlKey: true })
    await settle()
    expect(props.onOrderDrop).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      order: expect.objectContaining({ clientOrderId: sharedClientOrderId, orderKind: 'REGULAR' }),
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

    // The leg says which position it belongs to; the badge beside it says what
    // it does to that position, which the side colour alone left to be inferred.
    expect(algoOrder).toHaveTextContent('ALGO LONGexit— USDT')
    expect(within(algoOrder).getByTitle(/^Exit —/)).toHaveTextContent('exit')
    expect(props.onOrderLift).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  // A grip is a promise — "Move … with Ctrl or Alt drag" — and for an order
  // resting at no price it is one the lift path always refuses: there is no
  // resting price to put the order back at. A control that invites a gesture
  // that can never succeed is worse than no control.
  it('offers no drag grip on an order resting at no price', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [stopMarketOrder()],
    }
    render(<FuturesWorkstationChart {...props} />)
    // Price 0 sits on the pane for this scale, the way it does when the
    // operator has dragged the price scale down to it.
    const chart = chartMock.charts[0]
    chart.series[0].priceToCoordinate.mockImplementation(price => 300 - price / 1000)
    act(() => chart.timeScale().emitVisibleLogicalRangeChange())

    // Still drawn, and still cancellable: refusing the drag is not hiding the
    // order.
    const cancel = await screen.findByRole('button', { name: 'Cancel SELL LONG order at 57000' })
    expect(screen.queryByRole('button', { name: /with Ctrl or Alt drag/ }))
      .not.toBeInTheDocument()
    const note = within(handleOf(cancel)).getByRole('note', {
      name: 'SELL LONG order resting at no price; it cannot be moved by dragging',
    })
    // The plate still states what the order is worth — valued at its trigger,
    // the way the order-values change reads a stop-market: 0.5 × 57000.
    expect(note).toHaveTextContent('28500 USDT')
  })

  it('begins no drag and draws no pending mark for an order resting at no price', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [stopMarketOrder()],
    }
    render(<FuturesWorkstationChart {...props} />)
    const chart = chartMock.charts[0]
    chart.series[0].priceToCoordinate.mockImplementation(price => 300 - price / 1000)
    act(() => chart.timeScale().emitVisibleLogicalRangeChange())
    const cancel = await screen.findByRole('button', { name: 'Cancel SELL LONG order at 57000' })
    // Whatever plate the order is drawn on, the gesture lands on it: on the
    // grip while one is offered, on the bare plate once none is.
    const plate = within(handleOf(cancel)).queryByRole('button', { name: /with Ctrl or Alt drag/ })
      ?? within(handleOf(cancel)).getByRole('note')

    fireEvent.pointerDown(plate, { pointerId: 5, button: 0, ctrlKey: true })
    await settle()

    expect(props.onOrderLift).not.toHaveBeenCalled()
    // No pending mark either — before this, one was published at the
    // y-coordinate of price 0, off the visible pane.
    expect(screen.queryByRole('status', { name: /heading for|lifted off the book/ }))
      .not.toBeInTheDocument()
  })

  // The refusal path itself, unmasked: through the real drag hook rather than
  // a mock answering `{ ok: true }` to every lift. A lift the desk's own bound
  // refuses cancels nothing, states the refusal, and leaves the grip standing.
  it('refuses a broken lift through the real hook and leaves the order resting', async () => {
    const cancelOrder = vi.fn()
    const placeOrder = vi.fn()
    const chartProps = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [workingOrder()],
    }
    render(<RealLiftHarness
      chartProps={chartProps}
      dragProps={{ maxOrderNotionalUsdt: '100', cancelOrder, placeOrder }}
    />)
    const grip = await screen.findByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })

    fireEvent.pointerDown(grip, { pointerId: 6, button: 0, ctrlKey: true })
    await settle()

    // Nothing left the desk: the refusal came before the cancellation.
    expect(cancelOrder).not.toHaveBeenCalled()
    expect(placeOrder).not.toHaveBeenCalled()
    expect(screen.getByTestId('drag-refusals')).toHaveTextContent(
      'Order NOT lifted: The order would be 29950 USDT, above the local 100 USDT limit. '
      + 'The order was left where it is.',
    )
    // The order is still resting, still gripped, still worth what it was, and
    // no mark of a drag survives.
    expect(screen.getByRole('button', {
      name: 'Move SELL LONG order at 59900 with Ctrl or Alt drag',
    })).toHaveTextContent('29950 USDT')
    expect(screen.queryByRole('status', { name: /heading for|lifted off the book/ }))
      .not.toBeInTheDocument()
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

  it('asks when the live window arrives after the chart mounted empty', () => {
    chartMock.openingLogicalRange = { from: 0, to: 79 }
    const onLoadHistory = vi.fn()
    const { rerender } = render(<FuturesWorkstationChart
      {...properties([])}
      symbol="BTCUSDT"
      interval="1m"
      onLoadHistory={onLoadHistory}
    />)
    expect(onLoadHistory).not.toHaveBeenCalled()

    rerender(<FuturesWorkstationChart
      {...properties(series(0, 80))}
      symbol="BTCUSDT"
      interval="1m"
      onLoadHistory={onLoadHistory}
    />)

    expect(onLoadHistory).toHaveBeenCalledExactlyOnceWith(START)
  })

  it('fits and pages an interval that replaces the series without remounting the chart', () => {
    chartMock.openingLogicalRange = { from: 40, to: 79 }
    const onLoadHistory = vi.fn()
    const { rerender } = render(<FuturesWorkstationChart
      {...properties(series(0, 80))}
      symbol="BTCUSDT"
      interval="15m"
      onLoadHistory={onLoadHistory}
    />)
    const chart = chartMock.charts[0]
    expect(chart.timeScale().fitContent).toHaveBeenCalledTimes(1)
    expect(onLoadHistory).not.toHaveBeenCalled()

    rerender(<FuturesWorkstationChart
      {...properties([])}
      symbol="BTCUSDT"
      interval="1m"
      onLoadHistory={onLoadHistory}
    />)
    chart.timeScale().visibleLogicalRange = { from: 0, to: 79 }
    rerender(<FuturesWorkstationChart
      {...properties(series(-80, 0))}
      symbol="BTCUSDT"
      interval="1m"
      onLoadHistory={onLoadHistory}
    />)

    expect(chartMock.charts).toHaveLength(1)
    expect(chart.timeScale().fitContent).toHaveBeenCalledTimes(2)
    expect(onLoadHistory).toHaveBeenCalledExactlyOnceWith(START - (80 * MINUTE))
  })

  it('clears both imperative series when a replacement interval commits', () => {
    const rows = series(0, 80)
    const { rerender } = render(<FuturesWorkstationChart
      {...properties(rows)}
      symbol="BTCUSDT"
      interval="15m"
    />)
    const [contractSeries, volumeSeries] = chartMock.charts[0].series
    contractSeries.setData.mockClear()
    volumeSeries.setData.mockClear()

    // Keep the same row reference deliberately. The ordinary candle effect has
    // nothing new to draw, so only the selection layout boundary can remove the
    // retained canvas before it is painted under the new interval label.
    rerender(<FuturesWorkstationChart
      {...properties(rows)}
      symbol="BTCUSDT"
      interval="1m"
    />)

    expect(volumeSeries.setData).toHaveBeenCalledExactlyOnceWith([])
    expect(contractSeries.setData).toHaveBeenCalledExactlyOnceWith([])
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

  it('asks for the page behind the new oldest candle on the next trip to the edge', () => {
    const onLoadHistory = vi.fn()
    const { rerender } = render(<FuturesWorkstationChart
      {...properties(series(0, 80))}
      symbol="BTCUSDT"
      interval="1m"
      onLoadHistory={onLoadHistory}
    />)
    const timeScale = chartMock.charts[0].timeScale()
    act(() => timeScale.emitVisibleLogicalRangeChange({ from: 0, to: 79 }))
    expect(onLoadHistory).toHaveBeenCalledExactlyOnceWith(START)

    timeScale.visibleLogicalRange = { from: 0, to: 79 }
    rerender(<FuturesWorkstationChart
      {...properties(series(-20, 80))}
      symbol="BTCUSDT"
      interval="1m"
      onLoadHistory={onLoadHistory}
    />)
    expect(timeScale.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 20, to: 99 })
    expect(onLoadHistory).toHaveBeenCalledTimes(1)

    act(() => timeScale.emitVisibleLogicalRangeChange({ from: 0, to: 79 }))
    expect(onLoadHistory).toHaveBeenNthCalledWith(2, START - (20 * MINUTE))
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

  // A re-read of the series corrects candles the stream got wrong — a volume
  // completed after the bar closed, a high the aggregate trade feed missed.
  // Deciding what to redraw from length and endpoints alone called that "the
  // last bar moved" and wrote the last bar only, so the correction stayed off
  // the canvas for as long as the contract was open.
  it('redraws a candle a re-read corrected inside the series', () => {
    const drawn = series(0, 40)
    const { rerender } = render(<FuturesWorkstationChart {...properties(drawn)} />)
    const [contractSeries, volumeSeries] = chartMock.charts[0].series
    contractSeries.setData.mockClear()
    contractSeries.update.mockClear()
    volumeSeries.setData.mockClear()

    // Same length, same first and last open time — only a candle in the middle
    // is not what the chart is drawing.
    const corrected = [...drawn]
    corrected[20] = candle(START + (20 * MINUTE), '59999.00', '4242')
    rerender(<FuturesWorkstationChart {...properties(corrected)} />)

    expect(contractSeries.update).not.toHaveBeenCalled()
    expect(contractSeries.setData).toHaveBeenCalledTimes(1)
    const redrawn = contractSeries.setData.mock.calls.at(-1)[0]
    expect(redrawn[20].close).toBe(59_999)
    expect(volumeSeries.setData.mock.calls.at(-1)[0][20].value).toBe(4242)
  })

  // The cheap path is the whole reason the question is asked: at the thousands
  // of bars this chart holds, redrawing both series for one bar's news is the
  // work of the entire series on every print.
  it('still writes the last bar alone when only the last bar moved', () => {
    const drawn = series(0, 40)
    const { rerender } = render(<FuturesWorkstationChart {...properties(drawn)} />)
    const [contractSeries, volumeSeries] = chartMock.charts[0].series
    contractSeries.setData.mockClear()
    volumeSeries.setData.mockClear()

    // Re-sent off the wire, so every row is a new object and only the last
    // one's value differs.
    const ticked = drawn.map(row => ({ ...row }))
    ticked[ticked.length - 1] = candle(START + (39 * MINUTE), '58500.00')
    rerender(<FuturesWorkstationChart {...properties(ticked)} />)

    expect(contractSeries.setData).not.toHaveBeenCalled()
    expect(contractSeries.update).toHaveBeenCalledTimes(1)
    expect(contractSeries.update.mock.calls.at(-1)[0].close).toBe(58_500)
  })

  // The live window the stream re-sends is bounded and slides: when a bar
  // opens, the oldest live bar leaves it. With history loaded in front, the
  // series still starts at the same open time and still ends one bar later —
  // exactly what a bar opening looks like from the endpoints — while a row has
  // gone out of the middle. Written as a tick, the chart keeps drawing it.
  it('redraws when the live window slid under the history in front of it', () => {
    const history = series(0, 20)
    const { rerender } = render(
      <FuturesWorkstationChart {...properties([...history, ...series(20, 60)])} />,
    )
    const contractSeries = chartMock.charts[0].series[0]
    contractSeries.setData.mockClear()
    contractSeries.update.mockClear()

    // The window dropped bar 20 and opened bar 60. History does not cover the
    // bar that left, so the series is one row shorter in the middle than what
    // is on the canvas.
    rerender(<FuturesWorkstationChart {...properties([...history, ...series(21, 61)])} />)

    expect(contractSeries.update).not.toHaveBeenCalled()
    expect(contractSeries.setData).toHaveBeenCalledTimes(1)
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
