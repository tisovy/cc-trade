import { act, render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChartWrapper } from './ChartWrapper'
import * as DataContextModule from '../../../context/DataContext'
import { createMockDataContextValue } from '@/test/mocks'

// Mock DataContext
vi.mock('../../../context/DataContext', () => ({
    useDataContext: vi.fn()
}))

// The alert and drawing contexts are reached through their hooks, not through
// the context modules: mocking the modules left the hooks resolving the real
// contexts and every render of this component throwing, which is what had these
// tests skipped.
vi.mock('../../../hooks/useAlertContext', () => ({
    useAlertContext: () => ({
        alerts: [],
        triggeredAlerts: [],
        checkPriceAlerts: vi.fn(),
        deleteAlert: vi.fn(),
        updateAlertPrice: vi.fn(),
    })
}))

vi.mock('../../../hooks/useDrawingContext', () => ({
    useDrawingContext: () => ({
        drawings: [],
        activeDrawing: null,
        addDrawing: vi.fn(),
        removeDrawing: vi.fn(),
        updateDrawing: vi.fn(),
        selectedDrawingId: null,
        setSelectedDrawingId: vi.fn(),
        activeTool: 'cursor',
        setActiveTool: vi.fn(),
        activeColor: '#26a69a',
        setActiveColor: vi.fn(),
        updateCurrentKey: vi.fn(),
        currentKey: 'BTCUSDT-1h',
        isDragging: false,
        addHorizontalLine: vi.fn(),
        addTextAnnotation: vi.fn(),
        startDrawing: vi.fn(),
        updateActiveDrawing: vi.fn(),
        finalizeDrawing: vi.fn(),
        cancelDrawing: vi.fn(),
        selectDrawing: vi.fn(),
        deselectAll: vi.fn(),
        deleteSelectedDrawing: vi.fn(),
        startDrag: vi.fn(),
        updateDrag: vi.fn(),
        endDrag: vi.fn(),
    }),
}))

// Mock lightweight-charts
const mockApplyOptions = vi.fn()
const mockSetData = vi.fn()
const mockUpdate = vi.fn()
const mockTimeScale = {
    fitContent: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    getVisibleLogicalRange: vi.fn(),
    setVisibleLogicalRange: vi.fn(),
    applyOptions: vi.fn(),
    height: vi.fn(() => 24),
    timeToCoordinate: vi.fn(() => null),
    coordinateToTime: vi.fn(() => null),
    coordinateToLogical: vi.fn(() => null),
}
const mockSeries = {
    applyOptions: mockApplyOptions,
    setData: mockSetData,
    update: mockUpdate,
    attachPrimitive: vi.fn(),
    createPriceLine: vi.fn(),
    removePriceLine: vi.fn(),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
}
// Each series answers with its own object so a write can be attributed to the
// series that made it, while still being recorded by the one spy the older
// tests assert on. What a frame costs the chart is exactly which series it
// wrote to and how much of each it wrote.
const seriesWrites = (seriesType) => ({
    ...mockSeries,
    setData: (...args) => mockSetData(seriesType, ...args),
    update: (...args) => mockUpdate(seriesType, ...args),
})
const writesOf = (spy, seriesType) => spy.mock.calls.filter(([type]) => type === seriesType)
const mockChart = {
    addSeries: vi.fn(seriesType => seriesWrites(seriesType)),
    timeScale: vi.fn(() => mockTimeScale),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    resize: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    subscribeClick: vi.fn(),
    unsubscribeClick: vi.fn(),
}

vi.mock('lightweight-charts', () => ({
    createChart: vi.fn(() => mockChart),
    ColorType: { Solid: 'Solid' },
    CrosshairMode: { Normal: 'Normal' },
    LineStyle: { Dotted: 'Dotted' },
    CandlestickSeries: 'CandlestickSeries',
    HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries',
}))

// Mock ResizeObserver
// eslint-disable-next-line no-undef
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
}

// NOTE: ChartWrapper has complex drawing/interaction logic that makes it hard to test
// with simple mocks. These tests are skipped pending a more comprehensive mocking strategy.
// TODO: Create proper test fixtures for drawing primitives and chart interactions
describe('ChartWrapper', () => {
    const defaultContext = createMockDataContextValue()

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should create chart on mount', () => {
        vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(defaultContext)
        render(<ChartWrapper />)

        // The price chart draws candles, volume and the moving average. The
        // count is not asserted: the RSI pane builds its own chart and this mock
        // returns the same one for both.
        expect(mockChart.addSeries).toHaveBeenCalledWith('CandlestickSeries', expect.any(Object))
        expect(mockChart.addSeries).toHaveBeenCalledWith('HistogramSeries', expect.any(Object))
        expect(mockChart.addSeries).toHaveBeenCalledWith('LineSeries', expect.any(Object))
    })

    it('should set data when chart data changes', () => {
        const contextWithData = createMockDataContextValue({
            chart: [
                { time: 1000, open: 10, high: 20, low: 5, close: 15, volume: 100 }
            ]
        })
        vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(contextWithData)
        render(<ChartWrapper />)

        expect(mockSetData).toHaveBeenCalled()
    })

    // Simple test to verify the test file loads correctly
    it('should have test file available', () => {
        expect(true).toBe(true)
    })
})

// Depth behind the live window is only useful if arriving at the oldest bar
// loads more of it, and if the bars the operator is reading stay where they are
// when it arrives.
describe('ChartWrapper chart depth', () => {
    const candle = (time, close = 10) => ({
        time,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
    })
    const run = (startTime, count) => Array.from(
        { length: count },
        (_unused, index) => candle(startTime + index * 3600),
    )
    const START = 1_700_000_000

    const renderWithChart = (chart, loadChartHistory = vi.fn(() => true)) => {
        vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(
            createMockDataContextValue({
                chart,
                loadChartHistory,
                panel: { selected: 'BTCUSDT', interval: '1h' },
            }),
        )
        return { loadChartHistory, ...render(<ChartWrapper />) }
    }

    // The RSI pane draws on its own chart, and this mock hands every chart the
    // same time scale, so more than one subscriber is registered here. The
    // library notifies all of them; so does this.
    const notifyRange = range => mockTimeScale.subscribeVisibleLogicalRangeChange.mock.calls
        .forEach(([handler]) => handler?.(range))

    beforeEach(() => {
        vi.clearAllMocks()
        mockTimeScale.getVisibleLogicalRange.mockReturnValue(null)
    })

    it('asks for older candles when the viewport reaches the oldest loaded bar', async () => {
        const { loadChartHistory } = renderWithChart(run(START, 40))

        expect(mockTimeScale.subscribeVisibleLogicalRangeChange).toHaveBeenCalled()
        notifyRange({ from: 4, to: 30 })
        await waitFor(() => expect(loadChartHistory).toHaveBeenCalled())
    })

    // The tape is running while the operator scrolls back — that is the whole
    // point of scrolling back on a liquid contract. Every print used to rebuild
    // the series effect, which tore down the range subscription and cancelled
    // the debounced read it had scheduled; the next print cancelled the next
    // one. A contract printing faster than the debounce waits never issued the
    // request at all, so the chart stayed as short as it was.
    it('asks for older candles while the tape keeps printing', async () => {
        const live = run(START, 40)
        const loadChartHistory = vi.fn(() => true)
        const { rerender } = renderWithChart(live, loadChartHistory)

        notifyRange({ from: 4, to: 30 })

        for (let print = 0; print < 12; print += 1) {
            vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(
                createMockDataContextValue({
                    chart: [...live.slice(0, -1), candle(live.at(-1).time, 10 + print)],
                    loadChartHistory,
                    panel: { selected: 'BTCUSDT', interval: '1h' },
                }),
            )
            // Inside `act`, because a print is a commit and the twenty
            // milliseconds after it are when the chart's own timers run.
            await act(async () => {
                rerender(<ChartWrapper />)
                await new Promise(resolve => setTimeout(resolve, 20))
            })
        }

        expect(loadChartHistory).toHaveBeenCalled()
    })

    it('asks for nothing while the viewport is nowhere near the oldest bar', async () => {
        const { loadChartHistory } = renderWithChart(run(START, 400))

        notifyRange({ from: 300, to: 390 })
        await new Promise(resolve => setTimeout(resolve, 80))
        expect(loadChartHistory).not.toHaveBeenCalled()
    })

    // Older candles arriving in front shift every bar's index. Left alone, the
    // chart jumps backwards under the cursor at the moment the operator was
    // reading those bars.
    it('moves the visible range by exactly as many bars as arrived in front', () => {
        const live = run(START, 20)
        const { rerender } = renderWithChart(live)
        mockTimeScale.getVisibleLogicalRange.mockReturnValue({ from: 2, to: 18 })

        const older = run(START - 3 * 3600, 3)
        vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(
            createMockDataContextValue({
                chart: [...older, ...live],
                loadChartHistory: vi.fn(),
                panel: { selected: 'BTCUSDT', interval: '1h' },
            }),
        )
        rerender(<ChartWrapper />)

        expect(mockTimeScale.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 5, to: 21 })
    })

    it('leaves the range alone when the live window merely ticks', () => {
        const live = run(START, 20)
        const { rerender } = renderWithChart(live)
        mockTimeScale.getVisibleLogicalRange.mockReturnValue({ from: 2, to: 18 })

        vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(
            createMockDataContextValue({
                chart: [...live.slice(0, -1), candle(live.at(-1).time, 42)],
                loadChartHistory: vi.fn(),
                panel: { selected: 'BTCUSDT', interval: '1h' },
            }),
        )
        rerender(<ChartWrapper />)

        expect(mockTimeScale.setVisibleLogicalRange).not.toHaveBeenCalled()
    })
})

// A trade moves the last candle and nothing else. The chart used to answer it by
// redrawing every series it holds, recomputing the moving average over every bar
// and rebuilding the whole volume histogram — the entire series' work for one
// bar's news, on a chart that accumulates five thousand of them.
describe('what one Spot print redraws', () => {
    const candle = (time, close = 10) => ({
        time,
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
    })
    const run = (startTime, count) => Array.from(
        { length: count },
        (_unused, index) => candle(startTime + index * 3600),
    )
    const START = 1_700_000_000
    const HOUR = 3600
    // Long enough that the moving average has something to average: the SMA is
    // over eighty bars, and under that the incremental path has no point to
    // write and neither does the full one.
    const OPENED = run(START, 400)

    const showing = (chart) => {
        vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(
            createMockDataContextValue({
                chart,
                loadChartHistory: vi.fn(),
                panel: { selected: 'BTCUSDT', interval: '1h' },
            }),
        )
    }

    // Renders the opened chart, then hands back a way to show it something else
    // with only the writes that something else caused recorded.
    const drawnAfter = (next) => {
        showing(OPENED)
        const { rerender } = render(<ChartWrapper />)
        mockSetData.mockClear()
        mockUpdate.mockClear()
        showing(next)
        rerender(<ChartWrapper />)
        return {
            redrawn: seriesType => writesOf(mockSetData, seriesType).length,
            written: seriesType => writesOf(mockUpdate, seriesType).length,
        }
    }

    beforeEach(() => {
        vi.clearAllMocks()
        mockTimeScale.getVisibleLogicalRange.mockReturnValue(null)
    })

    it('writes the one bar a print moved, and redraws nothing', () => {
        const printed = [...OPENED.slice(0, -1), candle(OPENED.at(-1).time, 42)]
        const draw = drawnAfter(printed)

        expect(draw.redrawn('CandlestickSeries')).toBe(0)
        expect(draw.redrawn('HistogramSeries')).toBe(0)
        expect(draw.written('CandlestickSeries')).toBe(1)
        expect(draw.written('HistogramSeries')).toBe(1)
        // One line is the moving average, written as one point. The other is the
        // RSI pane's own line, which computes over every bar and redraws whole —
        // it is what §2 left, and it is stated rather than counted as nothing.
        expect(draw.written('LineSeries')).toBe(1)
        expect(draw.redrawn('LineSeries')).toBe(1)
    })

    it('writes the one bar that opened, and redraws nothing', () => {
        const opened = [...OPENED, candle(OPENED.at(-1).time + HOUR, 42)]
        const draw = drawnAfter(opened)

        expect(draw.redrawn('CandlestickSeries')).toBe(0)
        expect(draw.redrawn('HistogramSeries')).toBe(0)
        expect(draw.written('CandlestickSeries')).toBe(1)
        expect(draw.written('HistogramSeries')).toBe(1)
        expect(draw.written('LineSeries')).toBe(1)
    })

    // A bar settling behind the last one is the close of the candle just past —
    // its true high, low and volume. It reaches the chart through the same
    // series as a tick and must not be mistaken for one.
    it('redraws every series when a bar behind the last one settles', () => {
        const settled = [...OPENED]
        settled[settled.length - 2] = candle(settled.at(-2).time, 99)
        const draw = drawnAfter(settled)

        expect(draw.redrawn('CandlestickSeries')).toBe(1)
        expect(draw.redrawn('HistogramSeries')).toBe(1)
        expect(draw.written('CandlestickSeries')).toBe(0)
    })

    it('redraws every series when older candles arrive in front', () => {
        const draw = drawnAfter([...run(START - 3 * HOUR, 3), ...OPENED])

        expect(draw.redrawn('CandlestickSeries')).toBe(1)
        expect(draw.redrawn('HistogramSeries')).toBe(1)
        expect(draw.written('CandlestickSeries')).toBe(0)
    })
})
