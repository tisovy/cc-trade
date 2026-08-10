import { useEffect } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { getCachedCandles, setCachedCandles } from '../utils/cache'
import { DataProvider, useDataContext } from './DataContext'
import { GatewayProvider } from './GatewayContext.jsx'
import { NotificationProvider } from './NotificationProvider'
import { useNotifications } from '../hooks/useNotifications'

const webSocketMocks = vi.hoisted(() => ({
    connection: { readyState: 1 },
    handleMessage: null,
    sendMessage: vi.fn(() => true),
}))

// Mock dependencies
vi.mock('../hooks/useWebSocket', () => ({
    default: vi.fn((_url, _detail, handleMessage) => {
        webSocketMocks.handleMessage = handleMessage
        return {
            send: vi.fn(),
            readyState: 1,
            connection: webSocketMocks.connection,
            subscribe: vi.fn(),
            unsubscribe: vi.fn(),
            sendMessage: webSocketMocks.sendMessage,
        }
    })
}))

vi.mock('../utils/storage', () => ({
    readStorage: vi.fn((key, def) => def),
    writeStorage: vi.fn()
}))

vi.mock('../utils/cache', () => ({
    initCache: vi.fn(() => Promise.resolve()),
    getCachedCandles: vi.fn(() => Promise.resolve(null)),
    setCachedCandles: vi.fn(() => Promise.resolve()),
    mergeCandles: vi.fn(),
    getCacheStats: vi.fn(() => Promise.resolve({ candles: 0, trades: 0, alerts: 0, exchangeInfo: false })),
}))

vi.mock('../utils/analytics', () => ({
    requestAnalyticsCombined: vi.fn(() => Promise.resolve({ items: [] })),
    requestActivityMetrics: vi.fn(() => Promise.resolve({ items: [] })),
}))

// Test component to consume context
const renderObserver = vi.fn()

const TestConsumer = () => {
    const context = useDataContext()
    renderObserver()
    return (
        <div>
            <span data-testid="selected">{context.panel.selected}</span>
            <span data-testid="market">{context.panel.market}</span>
            <span data-testid="balances">{JSON.stringify(context.balances)}</span>
            <span data-testid="orders">{JSON.stringify(context.orders)}</span>
        </div>
    )
}

const NotificationConsumer = () => {
    const { notifications, notificationHistory } = useNotifications()
    return (
        <div>
            <span data-testid="notification-count">{notifications.length}</span>
            <span data-testid="notification-history">{JSON.stringify(notificationHistory)}</span>
        </div>
    )
}

// Wrapper with required providers
const TestWrapper = ({ children }) => (
    <NotificationProvider>
        <GatewayProvider activeMarketMode="spot">
            {children}
        </GatewayProvider>
    </NotificationProvider>
)

describe('DataContext', () => {
    it('should provide default values', () => {
        render(
            <TestWrapper>
                <DataProvider>
                    <TestConsumer />
                </DataProvider>
            </TestWrapper>
        )

        expect(screen.getByTestId('selected').textContent).toBe('PAXUSDT')
        expect(screen.getByTestId('market').textContent).toBe('USDT')
    })

    it('does not map a retired futures read-only payload into Spot balances or orders', () => {
        renderObserver.mockClear()
        render(
            <TestWrapper>
                <DataProvider>
                    <TestConsumer />
                </DataProvider>
            </TestWrapper>
        )
        const balancesBefore = screen.getByTestId('balances').textContent
        const ordersBefore = screen.getByTestId('orders').textContent

        act(() => webSocketMocks.handleMessage({
            data: JSON.stringify({
                channelId: 'futures-readonly',
                version: 1,
                marketType: 'futures',
                requestId: 'isolation-test',
                type: 'snapshot',
                symbol: 'BTCUSDT',
                environment: 'mock',
                payload: {
                    status: 'ready',
                    balances: { USDT: { available: '999999' } },
                    orders: [{ orderId: 1 }],
                },
            }),
        }, null))

        expect(screen.getByTestId('balances').textContent).toBe(balancesBefore)
        expect(screen.getByTestId('orders').textContent).toBe(ordersBefore)
    })

    it('deduplicates startup configuration alerts and re-arms after recovery', async () => {
        render(
            <TestWrapper>
                <DataProvider>
                    <NotificationConsumer />
                </DataProvider>
            </TestWrapper>
        )
        const configurationError = {
            type: 'startup_status',
            version: 1,
            state: 'CONFIG_ERROR',
            code: 'MISSING_API_SECRET',
            ready: false,
            missingFields: ['BS'],
            retiredFields: [],
        }

        act(() => webSocketMocks.handleMessage({
            data: JSON.stringify(configurationError),
        }, webSocketMocks.connection))
        await waitFor(() => expect(screen.getByTestId('notification-count')).toHaveTextContent('1'))
        expect(screen.getByTestId('notification-history')).toHaveTextContent(
            'Configure BK and BS for Spot and BFK and BFS for Futures, '
            + 'then restart the application.',
        )

        act(() => webSocketMocks.handleMessage({
            data: JSON.stringify(configurationError),
        }, webSocketMocks.connection))
        expect(screen.getByTestId('notification-count')).toHaveTextContent('1')

        act(() => webSocketMocks.handleMessage({
            data: JSON.stringify({
                ...configurationError,
                state: 'READY',
                code: 'READY',
                ready: true,
                missingFields: [],
            }),
        }, webSocketMocks.connection))
        act(() => webSocketMocks.handleMessage({
            data: JSON.stringify(configurationError),
        }, webSocketMocks.connection))
        await waitFor(() => expect(screen.getByTestId('notification-count')).toHaveTextContent('2'))
    })
})

// The Spot chart used to end at the 500 candles the bootstrap delivers, and the
// bootstrap replaced whatever the chart already held — so the depth an operator
// scrolled to, and the depth the local store kept across a restart, were both
// discarded on arrival of the live window.
describe('DataContext spot chart depth', () => {
    const HOUR = 3600
    const LIVE_START = 1_700_000_000
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
        (_unused, index) => candle(startTime + index * HOUR),
    )
    const times = series => series.map(row => row.time)

    // Captured after commit rather than during render: the context is read from
    // a committed render, which is also the only point at which its callbacks
    // are the ones the chart would be holding.
    const captured = { current: null }
    const DepthConsumer = () => {
        const context = useDataContext()
        useEffect(() => { captured.current = context })
        return <span data-testid="chart-times">{JSON.stringify(times(context.chart))}</span>
    }
    const desk = () => captured.current
    const chartTimes = () => JSON.parse(screen.getByTestId('chart-times').textContent)

    // Awaited: a delivered chart writes the cache and re-reads its statistics,
    // and those state updates belong inside the same act as the delivery.
    const deliver = message => act(async () => {
        webSocketMocks.handleMessage({
            data: JSON.stringify({
                channelId: 'detail-PAXUSDT-1h-test',
                symbol: 'PAXUSDT',
                interval: '1h',
                ...message,
            }),
        }, webSocketMocks.connection)
    })

    const renderDepthChart = async () => {
        captured.current = null
        render(
            <TestWrapper>
                <DataProvider>
                    <DepthConsumer />
                </DataProvider>
            </TestWrapper>
        )
        await act(async () => { desk().handlePanelUpdate({ selected: 'PAXUSDT', interval: '1h' }, true) })
        // The cache read and the subscription that follows it are two hops of a
        // promise chain; both settle before anything is asserted.
        await act(async () => {})
    }

    // The gateway sends its own startup and activation frames on the same
    // socket, so only the chart's own requests are counted.
    const historyRequests = () => webSocketMocks.sendMessage.mock.calls
        .filter(([message]) => message?.action === 'load_chart_history')

    beforeEach(() => {
        vi.mocked(getCachedCandles).mockResolvedValue(null)
        vi.mocked(setCachedCandles).mockClear()
        webSocketMocks.sendMessage.mockClear()
    })

    it('merges the bootstrap window in front of stored depth instead of replacing it', async () => {
        const stored = run(LIVE_START - 12 * HOUR, 12)
        vi.mocked(getCachedCandles).mockResolvedValue({
            candles: stored,
            lastTime: stored.at(-1).time,
        })
        await renderDepthChart()
        await waitFor(() => expect(chartTimes()).toEqual(times(stored)))

        const live = run(LIVE_START, 12)
        await deliver({ type: 'chart', payload: live, extra: live.at(-1) })

        // Every stored candle is still there, the live window is in front of it,
        // and the seam holds no duplicate.
        expect(chartTimes()).toEqual([...times(stored), ...times(live)])
    })

    it('asks for the page behind the oldest candle, once, and prepends the answer', async () => {
        await renderDepthChart()
        const live = run(LIVE_START, 12)
        await deliver({ type: 'chart', payload: live, extra: live.at(-1) })

        let requested
        act(() => { requested = desk().loadChartHistory() })
        expect(requested).toBe(true)
        expect(webSocketMocks.sendMessage).toHaveBeenCalledWith({
            action: 'load_chart_history',
            symbol: 'PAXUSDT',
            interval: '1h',
            // Binance reads endTime inclusively: one millisecond behind the
            // oldest loaded candle, so nothing is read twice.
            endTime: LIVE_START * 1000 - 1,
            limit: 1000,
        })

        // The left edge fires continuously while the operator scrolls; only one
        // read may be outstanding.
        act(() => { expect(desk().loadChartHistory()).toBe(false) })
        expect(historyRequests()).toHaveLength(1)

        const page = run(LIVE_START - 5 * HOUR, 5)
        await deliver({
            type: 'chart_history',
            payload: page,
            extra: {
                symbol: 'PAXUSDT',
                interval: '1h',
                endTime: LIVE_START * 1000 - 1,
                limit: 1000,
            },
        })
        expect(chartTimes()).toEqual([...times(page), ...times(live)])
        // Stored, so the next run of the app starts where this one left off.
        expect(setCachedCandles).toHaveBeenCalledWith(
            'PAXUSDT',
            '1h',
            expect.arrayContaining(page),
        )

        // A page shorter than the limit is the exchange saying there is nothing
        // older; asking again would re-read the same short answer forever.
        act(() => { expect(desk().loadChartHistory()).toBe(false) })
        expect(historyRequests()).toHaveLength(1)
    })

    // The series has a ceiling. A page that lands entirely below it cannot be
    // held, and asking for it again would repeat the same read for as long as
    // the operator sits at the left edge.
    it('stops asking once a delivered page cannot extend the series', async () => {
        await renderDepthChart()
        const live = run(LIVE_START, 12)
        await deliver({ type: 'chart', payload: live, extra: live.at(-1) })
        act(() => { desk().loadChartHistory() })

        // A full page, but every row is one the chart already holds.
        await deliver({
            type: 'chart_history',
            payload: Array.from({ length: 1000 }, (_unused, index) => candle(
                live[0].time + (index % 12) * HOUR,
            )),
            extra: {
                symbol: 'PAXUSDT',
                interval: '1h',
                endTime: LIVE_START * 1000 - 1,
                limit: 1000,
            },
        })

        act(() => { expect(desk().loadChartHistory()).toBe(false) })
        expect(historyRequests()).toHaveLength(1)
    })

    it('ignores a page answered for a read point the chart has moved on from', async () => {
        await renderDepthChart()
        const live = run(LIVE_START, 12)
        await deliver({ type: 'chart', payload: live, extra: live.at(-1) })
        act(() => { desk().loadChartHistory() })

        await deliver({
            type: 'chart_history',
            payload: run(LIVE_START - 900 * HOUR, 5),
            extra: {
                symbol: 'PAXUSDT',
                interval: '1h',
                endTime: LIVE_START * 1000 - 90_000_000,
                limit: 1000,
            },
        })
        expect(chartTimes()).toEqual(times(live))
    })

    it('keeps a live tick applying to the tail while depth sits behind it', async () => {
        await renderDepthChart()
        const live = run(LIVE_START, 12)
        await deliver({ type: 'chart', payload: live, extra: live.at(-1) })
        act(() => { desk().loadChartHistory() })
        const page = run(LIVE_START - 5 * HOUR, 5)
        await deliver({
            type: 'chart_history',
            payload: page,
            extra: {
                symbol: 'PAXUSDT',
                interval: '1h',
                endTime: LIVE_START * 1000 - 1,
                limit: 1000,
            },
        })

        const tick = candle(live.at(-1).time, 999)
        await deliver({ type: 'chart', payload: [tick], extra: tick })
        expect(chartTimes()).toEqual([...times(page), ...times(live)])
        expect(desk().chart.at(-1).close).toBe(999)
    })
})
