import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MainView from './MainView';
import { createMockDataContextValue, createMockMiniCharts, mockChartData, attachMockLocalStorage } from '@/test/mocks';

// Mock context value with mini charts data
const mockSubscribeChannel = vi.fn();
const mockUnsubscribeChannel = vi.fn();
const mockContextValue = createMockDataContextValue({
    subscribeChannel: mockSubscribeChannel,
    unsubscribeChannel: mockUnsubscribeChannel,
    miniCharts: createMockMiniCharts({ data: mockChartData }),
});

// Mock useDataContext
vi.mock('../../context/DataContext', () => ({
    useDataContext: () => mockContextValue,
}));

// Mock lightweight-charts
const mockPriceScale = {
    applyOptions: vi.fn(),
    width: vi.fn(() => 50),
};
const mockSeries = {
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(() => ({})),
    removePriceLine: vi.fn(),
    priceToCoordinate: vi.fn(() => 100),
    coordinateToPrice: vi.fn(() => 50000),
};
const mockTimeScale = {
    fitContent: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 100 })),
    setVisibleLogicalRange: vi.fn(),
    coordinateToTime: vi.fn(() => 1700000000),
    coordinateToLogical: vi.fn(() => 50),
};
const mockChart = {
    addSeries: vi.fn(() => mockSeries),
    timeScale: vi.fn(() => mockTimeScale),
    priceScale: vi.fn(() => mockPriceScale),
    applyOptions: vi.fn(),
    resize: vi.fn(),
    remove: vi.fn(),
};

vi.mock('lightweight-charts', () => ({
    createChart: vi.fn(() => mockChart),
    ColorType: { Solid: 'Solid' },
    CrosshairMode: { Normal: 'Normal' },
    CandlestickSeries: 'CandlestickSeries',
    LineSeries: 'LineSeries',
    HistogramSeries: 'HistogramSeries',
}));

// Mock RSIPane component
vi.mock('../features/charts/RSIPane', () => ({
    default: () => <div data-testid="rsi-pane">RSI Pane Mock</div>,
}));

// Mock ResizeObserver
// eslint-disable-next-line no-undef
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

// Mock localStorage
let localStorageMock;

describe('MainView', () => {
    const mockOnSwitchToDepth = vi.fn();
    const mockOnToggleAnalyticsPanel = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        localStorageMock = attachMockLocalStorage();
        localStorageMock.clear();
        mockSubscribeChannel.mockClear();
        mockUnsubscribeChannel.mockClear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        localStorageMock.clear();
        vi.useRealTimers();
    });

    it('should render 8 mini charts by default', () => {
        render(<MainView onSwitchToDepth={mockOnSwitchToDepth} showAnalyticsPanel={true} />);

        // Check for default symbols (PAXUSDT is first in DEFAULT_PAIRS)
        expect(screen.getByText('PAXUSDT')).toBeInTheDocument();
        expect(screen.getByText('BTCUSDT')).toBeInTheDocument();
        expect(screen.getByText('ETHUSDT')).toBeInTheDocument();
        expect(screen.getByText('BNBUSDT')).toBeInTheDocument();
        expect(screen.getByText('XRPUSDT')).toBeInTheDocument();
        expect(screen.getByText('SOLUSDT')).toBeInTheDocument();
        expect(screen.getByText('ADAUSDT')).toBeInTheDocument();
        expect(screen.getByText('DOGEUSDT')).toBeInTheDocument();
    });

    it('should render analytics panel toggle button', () => {
        render(<MainView onSwitchToDepth={mockOnSwitchToDepth} showAnalyticsPanel={true} />);

        const toggleButton = screen.getByTitle(/analytics panel/i);
        expect(toggleButton).toBeInTheDocument();
    });

    it('should toggle analytics panel visibility via callback', () => {
        const { rerender } = render(
            <MainView
                onSwitchToDepth={mockOnSwitchToDepth}
                showAnalyticsPanel={true}
                onToggleAnalyticsPanel={mockOnToggleAnalyticsPanel}
            />
        );

        const toggleButton = screen.getByTitle(/analytics panel/i);

        // Initially visible (shows ◀)
        expect(screen.getByText('◀')).toBeInTheDocument();

        // Click calls the callback
        fireEvent.click(toggleButton);
        expect(mockOnToggleAnalyticsPanel).toHaveBeenCalledTimes(1);

        // Rerender with hidden state to verify icon changes
        rerender(
            <MainView
                onSwitchToDepth={mockOnSwitchToDepth}
                showAnalyticsPanel={false}
                onToggleAnalyticsPanel={mockOnToggleAnalyticsPanel}
            />
        );
        expect(screen.getByText('▶')).toBeInTheDocument();
    });

    it('should call onToggleAnalyticsPanel when toggle button is clicked', () => {
        render(
            <MainView
                onSwitchToDepth={mockOnSwitchToDepth}
                showAnalyticsPanel={true}
                onToggleAnalyticsPanel={mockOnToggleAnalyticsPanel}
            />
        );

        const toggleButton = screen.getByTitle(/analytics panel/i);
        fireEvent.click(toggleButton);

        // Callback should be called (state managed by App.jsx)
        expect(mockOnToggleAnalyticsPanel).toHaveBeenCalledTimes(1);
    });

    it('should subscribe to mini channels on mount', async () => {
        render(<MainView onSwitchToDepth={mockOnSwitchToDepth} showAnalyticsPanel={true} />);

        // First subscription is immediate (PAXUSDT is first in DEFAULT_PAIRS)
        expect(mockSubscribeChannel).toHaveBeenCalledTimes(1);
        expect(mockSubscribeChannel).toHaveBeenCalledWith(
            expect.objectContaining({
                channelType: 'mini',
                symbol: 'PAXUSDT',
                interval: '1h',
            })
        );

        // Advance timers to allow staggered subscriptions (500ms each - rate limit conservative)
        await act(async () => {
            for (let i = 0; i < 7; i++) {
                vi.advanceTimersByTime(500);
                await Promise.resolve(); // Flush promises
            }
        });

        // Should have subscribed to all 8 channels
        expect(mockSubscribeChannel).toHaveBeenCalledTimes(8);
    });

    it('should call onSwitchToDepth when ALT+clicking a chart', () => {
        render(<MainView onSwitchToDepth={mockOnSwitchToDepth} showAnalyticsPanel={true} />);

        // Find the first mini chart container (PAXUSDT is first)
        const paxChart = screen.getByText('PAXUSDT').closest('.mini-chart');

        if (paxChart) {
            fireEvent.click(paxChart, { altKey: true });
            expect(mockOnSwitchToDepth).toHaveBeenCalledWith('PAXUSDT', '1h');
        }
    });

    it('should show interval buttons on each mini chart', () => {
        render(<MainView onSwitchToDepth={mockOnSwitchToDepth} showAnalyticsPanel={true} />);

        // Each chart should have interval buttons
        const intervalButtons1m = screen.getAllByRole('button', { name: '1m' });
        const intervalButtons1h = screen.getAllByRole('button', { name: '1h' });

        // Should have 8 of each (one per chart)
        expect(intervalButtons1m.length).toBe(8);
        expect(intervalButtons1h.length).toBe(8);
    });

    it('should load chart configs from localStorage', () => {
        // Set custom configs in localStorage
        const customConfigs = [
            { symbol: 'CUSTOMUSDT', interval: '4h' },
            { symbol: 'TESTUSDT', interval: '1d' },
        ];
        localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(customConfigs));

        render(<MainView onSwitchToDepth={mockOnSwitchToDepth} showAnalyticsPanel={true} />);

        expect(screen.getByText('CUSTOMUSDT')).toBeInTheDocument();
        expect(screen.getByText('TESTUSDT')).toBeInTheDocument();
    });

    it('should persist chart configs to localStorage when changed', async () => {
        render(<MainView onSwitchToDepth={mockOnSwitchToDepth} showAnalyticsPanel={true} />);

        // Configs should be saved (8 default charts, PAXUSDT is first)
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            'mainViewCharts',
            expect.stringContaining('PAXUSDT')
        );
    });

    it('should persist selected slot to localStorage', () => {
        render(<MainView onSwitchToDepth={mockOnSwitchToDepth} showAnalyticsPanel={true} />);

        // Should save selected slot
        expect(localStorageMock.setItem).toHaveBeenCalledWith('mainViewSelectedSlot', '0');
    });

    it('should select a chart when clicked', () => {
        render(<MainView onSwitchToDepth={mockOnSwitchToDepth} showAnalyticsPanel={true} />);

        // Find the third mini chart (ETHUSDT is at index 2) and click it
        const ethChart = screen.getByText('ETHUSDT').closest('.mini-chart');

        if (ethChart) {
            fireEvent.click(ethChart);
            // Should save the new selected slot (ETHUSDT is at index 2)
            expect(localStorageMock.setItem).toHaveBeenCalledWith('mainViewSelectedSlot', '2');
        }
    });
});
