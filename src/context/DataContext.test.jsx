import { act, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DataProvider, useDataContext } from './DataContext'
import { NotificationProvider } from './NotificationProvider'
import { attachMockLocalStorage } from '@/test/mocks'

// Mock localStorage
const _localStorageMock = attachMockLocalStorage()

const webSocketMocks = vi.hoisted(() => ({
    handleMessage: null,
}))

// Mock dependencies
vi.mock('../hooks/useWebSocket', () => ({
    default: vi.fn((_url, _detail, handleMessage) => {
        webSocketMocks.handleMessage = handleMessage
        return {
            send: vi.fn(),
            readyState: 1,
            connection: null,
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

// Wrapper with required providers
const TestWrapper = ({ children }) => (
    <NotificationProvider>
        {children}
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

    it('keeps futures read-only snapshots out of spot state and channel health', () => {
        renderObserver.mockClear()
        render(
            <TestWrapper>
                <DataProvider>
                    <TestConsumer />
                </DataProvider>
            </TestWrapper>
        )
        const rendersBefore = renderObserver.mock.calls.length
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

        expect(renderObserver).toHaveBeenCalledTimes(rendersBefore)
        expect(screen.getByTestId('balances').textContent).toBe(balancesBefore)
        expect(screen.getByTestId('orders').textContent).toBe(ordersBefore)
    })
})
