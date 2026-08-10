import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DataProvider, useDataContext } from './DataContext'
import { GatewayProvider } from './GatewayContext.jsx'
import { NotificationProvider } from './NotificationProvider'
import { useNotifications } from '../hooks/useNotifications'
import { attachMockLocalStorage } from '@/test/mocks'

// Mock localStorage
const _localStorageMock = attachMockLocalStorage()

const webSocketMocks = vi.hoisted(() => ({
    connection: { readyState: 1 },
    handleMessage: null,
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
            sendMessage: vi.fn(),
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
