import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import InfoPanel from './InfoPanel'
import * as DataContextModule from '../../context/DataContext'
import { createMockDataContextValue } from '@/test/mocks'
import { resetPnL } from '../../utils/pnl'

// Mock DataContext
vi.mock('../../context/DataContext', () => ({
    useDataContext: vi.fn()
}))

describe('InfoPanel', () => {
    const mockHandleRequest = vi.fn()
    const mockHandlePanelUpdate = vi.fn()

    const defaultContext = createMockDataContextValue({
        handlePanelUpdate: mockHandlePanelUpdate,
        balances: {},
        orders: [],
        filters: {},
        ticker: [],
        marketHistory: [],
    })

    it('should render tabs correctly', () => {
        vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(defaultContext)
        render(<InfoPanel handleRequest={mockHandleRequest} />)

        expect(screen.getByText('Journal')).toBeInTheDocument()
        expect(screen.getByText('Orders')).toBeInTheDocument()
        expect(screen.getByText('Balances')).toBeInTheDocument()
    })

    it('should switch tabs', () => {
        vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(defaultContext)
        render(<InfoPanel handleRequest={mockHandleRequest} />)

        const balancesTab = screen.getByText('Balances')
        fireEvent.click(balancesTab)

        expect(balancesTab.className).toContain('selected')
        expect(screen.getByText('Coin')).toBeInTheDocument() // Header for balances
    })

    it('should display orders', () => {
        const contextWithOrders = createMockDataContextValue({
            handlePanelUpdate: mockHandlePanelUpdate,
            orders: [
                {
                    orderId: 1,
                    symbol: 'BTCUSDT',
                    price: '50000',
                    origQty: '1',
                    side: 'BUY',
                    time: Date.now(),
                }
            ],
            filters: {
                BTCUSDT: { tickSize: '0.01', stepSize: '0.000001' }
            }
        })
        vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(contextWithOrders)
        render(<InfoPanel handleRequest={mockHandleRequest} />)

        expect(screen.getByText('BTCUSDT')).toBeInTheDocument()
        expect(screen.getByText('50000.00')).toBeInTheDocument()
    })

    it('should display balances', () => {
        const contextWithBalances = createMockDataContextValue({
            handlePanelUpdate: mockHandlePanelUpdate,
            balances: {
                BTC: { available: '1.5', onOrder: '0' }
            },
            ticker: [{ symbol: 'BTCUSDT', lastPrice: '50000' }],
            filters: {
                BTCUSDT: { tickSize: '0.01', stepSize: '0.000001' }
            }
        })
        vi.spyOn(DataContextModule, 'useDataContext').mockReturnValue(contextWithBalances)
        render(<InfoPanel handleRequest={mockHandleRequest} />)

        // Switch to balances tab
        fireEvent.click(screen.getByText('Balances'))

        expect(screen.getByText('BTC')).toBeInTheDocument()
        expect(screen.getByText('1.500000')).toBeInTheDocument()
    })

    it('holds PnL until current account identity and full balances are available', () => {
        const ticker = [{ symbol: 'BTCUSDT', lastPrice: '50000' }]
        const balances = { USDT: { available: '1000', onOrder: '0' } }
        const context = { ...defaultContext, balances, ticker, spotAccountFingerprint: null }
        vi.mocked(DataContextModule.useDataContext).mockReturnValue(context)
        const view = render(<InfoPanel handleRequest={mockHandleRequest} />)
        fireEvent.click(screen.getByText('P&L'))
        expect(screen.getByText('Waiting for account identity...')).toBeInTheDocument()
        expect(screen.queryByText(/Start Tracking/)).not.toBeInTheDocument()
        const A = 'a'.repeat(64), B = 'b'.repeat(64)
        resetPnL('day', { USDT: { available: '10000', onOrder: '0' } }, ticker, A)
        vi.mocked(DataContextModule.useDataContext).mockReturnValue({ ...context, spotAccountFingerprint: A })
        view.rerender(<InfoPanel handleRequest={mockHandleRequest} />)
        expect(screen.getAllByText('-90.00%')).toHaveLength(2)
        vi.mocked(DataContextModule.useDataContext).mockReturnValue({ ...context, balances: {}, spotAccountFingerprint: B })
        view.rerender(<InfoPanel handleRequest={mockHandleRequest} />)
        expect(screen.queryByText('-90.00%')).not.toBeInTheDocument()
        expect(screen.getByText('Loading balance data...')).toBeInTheDocument()
        vi.mocked(DataContextModule.useDataContext).mockReturnValue({ ...context, spotAccountFingerprint: B })
        view.rerender(<InfoPanel handleRequest={mockHandleRequest} />)
        expect(screen.queryByText('-90.00%')).not.toBeInTheDocument()
        expect(screen.getByText('Current')).toBeInTheDocument()
    })
})
