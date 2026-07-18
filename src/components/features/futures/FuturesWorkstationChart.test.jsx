import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LIGHTWEIGHT_CHARTS_MAX_SERIES_VALUE } from '../../../utils/chartVolume.js'
import FuturesWorkstationChart, {
  FuturesWorkstationChart as UnmemoizedFuturesWorkstationChart,
} from './FuturesWorkstationChart.jsx'

const chartMock = vi.hoisted(() => ({ charts: [] }))

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'CandlestickSeries',
  ColorType: { Solid: 'Solid' },
  CrosshairMode: { Normal: 'Normal' },
  HistogramSeries: 'HistogramSeries',
  LineSeries: 'LineSeries',
  LineStyle: { Dashed: 'Dashed', Dotted: 'Dotted', Solid: 'Solid' },
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
      emitVisibleLogicalRangeChange: () => {
        visibleLogicalRangeListeners.forEach(listener => listener(null))
      },
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

  it('shows a selected price only on the scale without a white LIMIT stripe', () => {
    render(
      <FuturesWorkstationChart
        {...properties([candle(1_784_000_000_000)])}
        draftPrice="58425.1"
      />,
    )
    expect(chartMock.charts[0].series[0].createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 58425.1,
        color: '#f0b90b',
        lineVisible: false,
        axisLabelVisible: true,
        title: '',
      }),
    )
    expect(chartMock.charts[0].series[0].createPriceLine).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'LIMIT' }),
    )
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

  it('clears a Shift measurement on symbol change without remounting the chart', () => {
    const candles = [candle(1_784_000_000_000)]
    const { rerender } = render(
      <FuturesWorkstationChart {...properties(candles)} symbol="BTCUSDT" priceTickSize="0.1" />,
    )
    const canvas = screen.getByTestId('futures-workstation-chart')
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320,
    })
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 100, shiftKey: true })
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 80, shiftKey: true })
    expect(document.querySelector('.measurement-info-box')).toBeInTheDocument()

    rerender(
      <FuturesWorkstationChart {...properties(candles)} symbol="ETHUSDT" priceTickSize="0.1" />,
    )

    expect(document.querySelector('.measurement-info-box')).not.toBeInTheDocument()
    expect(chartMock.charts).toHaveLength(1)
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

  it('renders owned order lines and emits one Ctrl-drag amendment draft on release', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '71',
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
        positionSide: 'LONG',
        positionEffect: 'EXIT',
        price: '59900',
      }, {
        symbol: 'BTCUSDT',
        orderKind: 'REGULAR',
        orderId: '102',
        clientOrderId: 'second-same-price-order',
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
      name: 'Move LONG EXIT order at 59900 with Ctrl or Alt drag',
    })
    const second = await screen.findByRole('button', {
      name: 'Move SHORT ENTRY order at 59900 with Ctrl or Alt drag',
    })
    await waitFor(() => expect(first.style.top).not.toBe(second.style.top))

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
        positionSide: 'LONG',
        positionEffect: 'EXIT',
        price: '59900',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    const order = await screen.findByRole('button', {
      name: 'Move LONG EXIT order at 59900 with Ctrl or Alt drag',
    })
    await waitFor(() => expect(order).toHaveStyle({ top: '100px' }))
    const chart = chartMock.charts[0]
    chart.series[0].priceToCoordinate.mockImplementation(price => 59_950 - price)

    act(() => chart.timeScale().emitVisibleLogicalRangeChange())

    await waitFor(() => expect(order).toHaveStyle({ top: '50px' }))
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
        positionSide: 'LONG',
        positionEffect: 'EXIT',
        price: '59900',
      }, {
        symbol: 'BTCUSDT',
        orderKind: 'ALGO',
        orderId: '82',
        clientOrderId: sharedClientOrderId,
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
      name: 'Move LONG EXIT order at 59900 with Ctrl or Alt drag',
    })
    const algoOrder = screen.getByRole('note', {
      name: 'ALGO SHORT ENTRY order at 59850; price is managed by Binance and is not draggable',
    })

    fireEvent.pointerDown(regularOrder, { pointerId: 9, button: 0, ctrlKey: true })
    fireEvent.pointerMove(regularOrder, { pointerId: 9, clientY: 80, ctrlKey: true })

    expect(regularOrder).toHaveTextContent('59920')
    expect(algoOrder).toHaveTextContent('59850')

    fireEvent.pointerUp(regularOrder, { pointerId: 9, clientY: 80, ctrlKey: true })
    expect(props.onOrderDrag).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      clientOrderId: sharedClientOrderId,
      price: '59920',
    }))
  })

  it('renders ALGO orders as non-draggable Binance-managed notes', async () => {
    const props = {
      ...properties([candle(1_784_000_000_000)]),
      ownedOrders: [{
        symbol: 'BTCUSDT',
        orderKind: 'ALGO',
        orderId: '91',
        clientOrderId: 'conditional-order-id',
        positionSide: 'LONG',
        positionEffect: 'EXIT',
        price: '59900',
      }],
    }
    render(<FuturesWorkstationChart {...props} />)
    const algoOrder = await screen.findByRole('note', {
      name: 'ALGO LONG EXIT order at 59900; price is managed by Binance and is not draggable',
    })

    fireEvent.pointerDown(algoOrder, { pointerId: 10, button: 0, altKey: true })
    fireEvent.pointerMove(algoOrder, { pointerId: 10, clientY: 80, altKey: true })
    fireEvent.pointerUp(algoOrder, { pointerId: 10, clientY: 80, altKey: true })

    expect(algoOrder).toHaveTextContent('ALGO · LONG EXIT59900')
    expect(props.onOrderDrag).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
