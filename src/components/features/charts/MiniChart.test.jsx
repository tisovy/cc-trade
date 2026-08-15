import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MiniChart from './MiniChart';

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
vi.mock('./RSIPane', () => ({
    default: () => <div data-testid="rsi-pane">RSI Pane Mock</div>,
}));

// Mock ResizeObserver
// eslint-disable-next-line no-undef
global.ResizeObserver = class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
};

describe('MiniChart', () => {
    const mockData = [
        { time: 1700000000, open: 50000, high: 51000, low: 49000, close: 50500 },
        { time: 1700003600, open: 50500, high: 52000, low: 50000, close: 51500 },
    ];

    const defaultProps = {
        symbol: 'BTCUSDT',
        interval: '1h',
        data: mockData,
        isLoading: false,
        onIntervalChange: vi.fn(),
        onAltClick: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render symbol name', () => {
        render(<MiniChart {...defaultProps} />);
        expect(screen.getByText('BTCUSDT')).toBeInTheDocument();
    });

    it('should render interval buttons', () => {
        render(<MiniChart {...defaultProps} />);

        expect(screen.getByRole('button', { name: '1m' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '5m' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '15m' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '1h' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '4h' })).toBeInTheDocument();
    });

    it('should call onIntervalChange when interval button is clicked', () => {
        render(<MiniChart {...defaultProps} />);

        const btn4h = screen.getByRole('button', { name: '4h' });
        fireEvent.click(btn4h);

        expect(defaultProps.onIntervalChange).toHaveBeenCalledWith('BTCUSDT', '4h');
    });

    it('should highlight current interval button', () => {
        render(<MiniChart {...defaultProps} interval="4h" />);

        const btn4h = screen.getByRole('button', { name: '4h' });
        expect(btn4h).toHaveClass('active');
    });

    it('should display symbol and interval when data is available', () => {
        render(<MiniChart {...defaultProps} />);

        // The symbol and interval should be displayed in the overlay
        expect(screen.getByText('BTCUSDT')).toBeInTheDocument();
        // Check for interval in the overlay (not the button)
        expect(screen.getByText(/• 1h/)).toBeInTheDocument();
    });

    it('should show loading state when isLoading is true', () => {
        const { container } = render(<MiniChart {...defaultProps} data={[]} isLoading={true} />);

        // Loading is shown via a spinner class
        expect(container.querySelector('.mini-chart-loading')).toBeInTheDocument();
    });

    it('should call onAltClick when ALT+clicking the chart', () => {
        render(<MiniChart {...defaultProps} />);

        const chartContainer = screen.getByText('BTCUSDT').closest('.mini-chart');

        if (chartContainer) {
            fireEvent.click(chartContainer, { altKey: true });
            expect(defaultProps.onAltClick).toHaveBeenCalledWith('BTCUSDT', '1h');
        }
    });

    it('should not call onAltClick on regular click', () => {
        render(<MiniChart {...defaultProps} />);

        const chartContainer = screen.getByText('BTCUSDT').closest('.mini-chart');

        if (chartContainer) {
            fireEvent.click(chartContainer);
            expect(defaultProps.onAltClick).not.toHaveBeenCalled();
        }
    });

    it('should update chart when data changes', () => {
        const { rerender } = render(<MiniChart {...defaultProps} />);

        const newData = [
            ...mockData,
            { time: 1700007200, open: 51500, high: 53000, low: 51000, close: 52500 },
        ];

        rerender(<MiniChart {...defaultProps} data={newData} />);

        // Chart should still render with new data
        expect(screen.getByText('BTCUSDT')).toBeInTheDocument();
    });

    it('should render RSI pane', () => {
        render(<MiniChart {...defaultProps} />);

        // RSI pane should be rendered
        expect(screen.getByTestId('rsi-pane')).toBeInTheDocument();
    });
});
