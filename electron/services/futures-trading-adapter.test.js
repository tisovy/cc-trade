import { describe, expect, it, vi } from 'vitest';
import {
    FUTURES_EXCHANGE_INFO_ERROR_CODES,
    FuturesExchangeInfoError,
    FuturesTradingAdapter,
    normalizeFuturesExchangeInfo,
} from './futures-trading-adapter.js';

const makeFuturesSymbol = (overrides = {}) => ({
    symbol: 'BTCUSDT',
    pair: 'BTCUSDT',
    contractType: 'PERPETUAL',
    status: 'TRADING',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    marginAsset: 'USDT',
    pricePrecision: 2,
    quantityPrecision: 3,
    filters: [
        {
            filterType: 'PRICE_FILTER',
            minPrice: '0.01000000',
            maxPrice: '1000000.00000000',
            tickSize: '0.01000000',
        },
        {
            filterType: 'LOT_SIZE',
            minQty: '0.00100000',
            maxQty: '1000.00000000',
            stepSize: '0.00100000',
        },
        {
            filterType: 'MARKET_LOT_SIZE',
            minQty: '0.01000000',
            maxQty: '250.00000000',
            stepSize: '0.01000000',
        },
        {
            filterType: 'MIN_NOTIONAL',
            notional: '50.00000000',
        },
    ],
    orderTypes: ['LIMIT', 'MARKET', 'STOP'],
    timeInForce: ['GTC', 'IOC', 'FOK', 'GTX'],
    ...overrides,
});

const makeExchangeInfo = (...symbols) => ({
    timezone: 'UTC',
    symbols,
});

const expectedFilters = {
    price: {
        min: '0.01000000',
        max: '1000000.00000000',
        tickSize: '0.01000000',
    },
    quantity: {
        min: '0.00100000',
        max: '1000.00000000',
        stepSize: '0.00100000',
    },
    marketQuantity: {
        min: '0.01000000',
        max: '250.00000000',
        stepSize: '0.01000000',
    },
    minimumNotional: '50.00000000',
};

describe('normalizeFuturesExchangeInfo', () => {
    it('normalizes a futures symbol into the declared futures-only domain contract', () => {
        expect(normalizeFuturesExchangeInfo(
            makeExchangeInfo(makeFuturesSymbol()),
            'BTCUSDT',
        )).toEqual({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            contractType: 'PERPETUAL',
            status: 'TRADING',
            assets: {
                base: 'BTC',
                quote: 'USDT',
                margin: 'USDT',
            },
            filters: expectedFilters,
            supportedOrderTypes: ['LIMIT', 'MARKET', 'STOP'],
            supportedTimeInForce: ['GTC', 'IOC', 'FOK', 'GTX'],
        });
    });

    it('parses recognized filters independently of response order', () => {
        const symbol = makeFuturesSymbol();
        symbol.filters = [...symbol.filters].reverse();

        expect(normalizeFuturesExchangeInfo(
            makeExchangeInfo(symbol),
            'BTCUSDT',
        ).filters).toEqual(expectedFilters);
    });

    it('keeps missing optional futures filters absent without borrowing defaults', () => {
        const quantityFilter = makeFuturesSymbol().filters.find(
            (filter) => filter.filterType === 'LOT_SIZE',
        );
        const result = normalizeFuturesExchangeInfo(
            makeExchangeInfo(makeFuturesSymbol({ filters: [quantityFilter] })),
            'BTCUSDT',
        );

        expect(result.filters).toEqual({
            price: null,
            quantity: expectedFilters.quantity,
            marketQuantity: null,
            minimumNotional: null,
        });

        expect(normalizeFuturesExchangeInfo(
            makeExchangeInfo(makeFuturesSymbol({ filters: undefined })),
            'BTCUSDT',
        ).filters).toEqual({
            price: null,
            quantity: null,
            marketQuantity: null,
            minimumNotional: null,
        });
    });

    it('ignores unknown futures filters without corrupting recognized fields', () => {
        const symbol = makeFuturesSymbol();
        symbol.filters.splice(1, 0, {
            filterType: 'POSITION_RISK_CONTROL',
            minPrice: 'corrupt-price',
            maxQty: 'corrupt-quantity',
            notional: 'corrupt-notional',
        });

        expect(normalizeFuturesExchangeInfo(
            makeExchangeInfo(symbol),
            'BTCUSDT',
        ).filters).toEqual(expectedFilters);
    });

    it('selects the requested symbol from a multi-symbol response', () => {
        const ethSymbol = makeFuturesSymbol({
            symbol: 'ETHUSDT',
            pair: 'ETHUSDT',
            baseAsset: 'ETH',
        });

        expect(normalizeFuturesExchangeInfo(
            makeExchangeInfo(ethSymbol, makeFuturesSymbol()),
            'BTCUSDT',
        )).toMatchObject({
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            assets: { base: 'BTC' },
        });
    });

    it('preserves distinct futures symbol and pair identities', () => {
        const datedContract = makeFuturesSymbol({
            symbol: 'BTCUSDT_260925',
            pair: 'BTCUSDT',
            contractType: 'CURRENT_QUARTER',
        });

        expect(normalizeFuturesExchangeInfo(
            makeExchangeInfo(datedContract),
            'BTCUSDT_260925',
        )).toMatchObject({
            symbol: 'BTCUSDT_260925',
            pair: 'BTCUSDT',
            contractType: 'CURRENT_QUARTER',
        });
    });

    it('fails deterministically when the requested symbol is unavailable', () => {
        expect(() => normalizeFuturesExchangeInfo(
            makeExchangeInfo(makeFuturesSymbol()),
            'ETHUSDT',
        )).toThrowError(new FuturesExchangeInfoError(
            FUTURES_EXCHANGE_INFO_ERROR_CODES.SYMBOL_UNAVAILABLE,
            'Futures symbol "ETHUSDT" is unavailable in exchange info',
        ));
    });

    it.each([
        ['a null payload', null],
        ['a missing symbols collection', {}],
        ['a non-array symbols collection', { symbols: {} }],
        ['an invalid symbol identity', { symbols: [null, { symbol: 123 }] }],
        ['missing futures identity fields', makeExchangeInfo(makeFuturesSymbol({ marginAsset: undefined }))],
        ['a non-array filter collection', makeExchangeInfo(makeFuturesSymbol({ filters: {} }))],
        ['a malformed recognized filter', makeExchangeInfo(makeFuturesSymbol({
            filters: [{ filterType: 'PRICE_FILTER', minPrice: '1', maxPrice: '2' }],
        }))],
        ['a malformed supported-order collection', makeExchangeInfo(makeFuturesSymbol({
            orderTypes: 'LIMIT',
        }))],
    ])('fails deterministically for %s', (_label, payload) => {
        expect(() => normalizeFuturesExchangeInfo(payload, 'BTCUSDT')).toThrowError(
            new FuturesExchangeInfoError(
                FUTURES_EXCHANGE_INFO_ERROR_CODES.MALFORMED_RESPONSE,
                'Malformed futures exchange-info response',
            ),
        );
    });

    it.each(['', '   '])('fails deterministically for an invalid requested symbol %#', (symbol) => {
        expect(() => normalizeFuturesExchangeInfo(
            makeExchangeInfo(makeFuturesSymbol()),
            symbol,
        )).toThrowError(new FuturesExchangeInfoError(
            FUTURES_EXCHANGE_INFO_ERROR_CODES.INVALID_SYMBOL,
            'Futures symbol must be a non-empty string',
        ));
    });

    it('rejects duplicate recognized filters instead of choosing one by order', () => {
        const symbol = makeFuturesSymbol();
        symbol.filters.push({
            filterType: 'MIN_NOTIONAL',
            notional: '75.00000000',
        });

        expect(() => normalizeFuturesExchangeInfo(
            makeExchangeInfo(symbol),
            'BTCUSDT',
        )).toThrowError(new FuturesExchangeInfoError(
            FUTURES_EXCHANGE_INFO_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures exchange-info response',
        ));
    });

    it('preserves exact decimal strings without precision-based conversion', () => {
        const result = normalizeFuturesExchangeInfo(
            makeExchangeInfo(makeFuturesSymbol()),
            'BTCUSDT',
        );

        expect(result.filters).toEqual(expectedFilters);
        expect(result.filters.price.tickSize).not.toBe('0.01');
        expect(result.filters.quantity.stepSize).not.toBe('0.001');
    });

    it('does not mutate or retain mutable parts of the source response', () => {
        const source = makeExchangeInfo(makeFuturesSymbol());
        const snapshot = structuredClone(source);

        const result = normalizeFuturesExchangeInfo(source, 'BTCUSDT');

        expect(source).toEqual(snapshot);
        expect(result.assets).not.toBe(source.symbols[0]);
        expect(result.filters.price).not.toBe(source.symbols[0].filters[0]);
        expect(result.supportedOrderTypes).not.toBe(source.symbols[0].orderTypes);
        expect(result.supportedTimeInForce).not.toBe(source.symbols[0].timeInForce);
    });
});

describe('FuturesTradingAdapter', () => {
    it('loads and unwraps official-client-style exchange metadata at the adapter boundary', async () => {
        const source = makeExchangeInfo(makeFuturesSymbol());
        const data = vi.fn().mockResolvedValue(source);
        const transport = {
            getExchangeInfo: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getExchangeInfo('BTCUSDT')).resolves.toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            filters: expectedFilters,
        });
        expect(transport.getExchangeInfo).toHaveBeenCalledWith();
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw exchange metadata from an injected read-only transport', async () => {
        const transport = {
            getExchangeInfo: vi.fn().mockResolvedValue(makeExchangeInfo(makeFuturesSymbol())),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getExchangeInfo('BTCUSDT')).resolves.toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
        });
    });

    it('propagates transport errors without relabeling them as normalization failures', async () => {
        const transportError = new Error('futures transport unavailable');
        const transport = {
            getExchangeInfo: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getExchangeInfo('BTCUSDT')).rejects.toBe(transportError);
    });

    it('propagates response-unwrapping errors without relabeling them', async () => {
        const responseError = new Error('futures response body unavailable');
        const transport = {
            getExchangeInfo: vi.fn().mockResolvedValue({
                data: vi.fn().mockRejectedValue(responseError),
            }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getExchangeInfo('BTCUSDT')).rejects.toBe(responseError);
    });

    it('exposes no futures execution surface', () => {
        const adapter = new FuturesTradingAdapter({ transport: {} });
        expect(Object.getOwnPropertyNames(FuturesTradingAdapter.prototype)).toEqual([
            'constructor',
            'getExchangeInfo',
        ]);

        const forbiddenExecutionMethods = [
            'placeOrder',
            'cancelOrder',
            'setLeverage',
            'changeLeverage',
            'setMarginMode',
            'changeMarginMode',
            'setMarginType',
            'changeMarginType',
        ];

        forbiddenExecutionMethods.forEach((method) => {
            expect(adapter[method]).toBeUndefined();
        });
    });
});
