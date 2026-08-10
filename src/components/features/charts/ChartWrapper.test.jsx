import { render, waitFor } from '@testing-library/react'
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
    attachPrimitive: vi.fn(),
    createPriceLine: vi.fn(),
    removePriceLine: vi.fn(),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
}
const mockChart = {
    addSeries: vi.fn(() => mockSeries),
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
