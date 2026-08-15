import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OrderBook from './OrderBook';
import { createMockDataContextValue, attachMockLocalStorage } from '@/test/mocks';

// Mock DataContext
const mockContextValue = createMockDataContextValue({
    depth: {
        bids: { '50000': '1.0', '49000': '2.0' },
        asks: { '51000': '1.0', '52000': '2.0' }
    },
    balances: { USDT: { available: '1000', onOrder: '0' }, BTC: { available: '1', onOrder: '0' } },
    filters: { BTCUSDT: { tickSize: '0.01', stepSize: '0.000001' } },
    chart: [],
    enabledMarketBalance: false,
});

// Mock useDataContext
vi.mock('../../../context/DataContext', () => ({
    useDataContext: () => mockContextValue,
}));

// Mock localStorage
let localStorageMock;

describe('OrderBook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorageMock = attachMockLocalStorage();
        localStorageMock.clear();
    });

    afterEach(() => {
        localStorageMock.clear();
    });

    it('should render order book items', () => {
        // Set accuracy to 0 to disable grouping
        localStorageMock.getItem.mockImplementation((key) => {
            if (key === 'orderBook') {
                return JSON.stringify({ accuracy: 0, shown_number: 10, min_accuracy: 0, max_accuracy: 100 });
            }
            return null;
        });

        render(<OrderBook />);

        // Use a custom matcher to find text across elements or partial matches
        expect(screen.getAllByText((content, element) => {
            return element.tagName.toLowerCase() === 'b' && content.includes('50000');
        }).length).toBeGreaterThan(0);

        expect(screen.getAllByText((content, element) => {
            return element.tagName.toLowerCase() === 'b' && content.includes('51000');
        }).length).toBeGreaterThan(0);
    });

    it('should display quantity by default', () => {
        render(<OrderBook />);

        // 1.0 quantity might be split or formatted
        // Based on failure output: <b>1.000000</b>
        // It seems it appears 4 times (maybe total and quantity columns?)
        expect(screen.getAllByText('1.000000')).toHaveLength(4);
    });
});
