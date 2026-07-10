import { describe, expect, it, vi } from 'vitest';
import {
    FUTURES_EXCHANGE_INFO_ERROR_CODES,
    FUTURES_FUNDING_STATE_ERROR_CODES,
    FUTURES_MARK_PRICE_ERROR_CODES,
    FuturesExchangeInfoError,
    FuturesFundingStateError,
    FuturesMarkPriceError,
    FuturesTradingAdapter,
    normalizeFuturesExchangeInfo,
    normalizeFuturesFundingState,
    normalizeFuturesMarkPrice,
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

const makeMarkPrice = (overrides = {}) => ({
    symbol: 'BTCUSDT',
    markPrice: '11793.631045620000',
    indexPrice: '11781.804959700000',
    estimatedSettlePrice: '11781.161388150000',
    lastFundingRate: '0.000382460000',
    interestRate: '0.000100000000',
    nextFundingTime: 1597392000000,
    time: 1597370495002,
    ...overrides,
});

const expectedMarkPrice = {
    marketType: 'futures',
    symbol: 'BTCUSDT',
    markPrice: '11793.631045620000',
    indexPrice: '11781.804959700000',
    estimatedSettlePrice: '11781.161388150000',
    time: 1597370495002,
};

const expectedFundingState = {
    marketType: 'futures',
    symbol: 'BTCUSDT',
    lastFundingRate: '0.000382460000',
    interestRate: '0.000100000000',
    nextFundingTime: 1597392000000,
    time: 1597370495002,
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

describe('normalizeFuturesMarkPrice', () => {
    it('normalizes the official single-symbol response without changing decimal strings', () => {
        const result = normalizeFuturesMarkPrice(makeMarkPrice(), 'BTCUSDT');

        expect(result).toEqual(expectedMarkPrice);
        expect(result.markPrice).not.toBe('11793.63104562');
        expect(result.indexPrice).not.toBe('11781.8049597');
        expect(result.estimatedSettlePrice).not.toBe('11781.16138815');
        expect(result).not.toHaveProperty('lastFundingRate');
        expect(result).not.toHaveProperty('interestRate');
        expect(result).not.toHaveProperty('nextFundingTime');
    });

    it('selects the requested symbol from the official multi-symbol response variant', () => {
        const source = [
            makeMarkPrice({
                symbol: 'ETHUSDT',
                markPrice: '3000.10000000',
                indexPrice: '2999.90000000',
                estimatedSettlePrice: '2998.80000000',
            }),
            makeMarkPrice(),
        ];

        expect(normalizeFuturesMarkPrice(source, 'BTCUSDT')).toEqual(expectedMarkPrice);
    });

    it.each([
        ['a different single-symbol response', makeMarkPrice({ symbol: 'ETHUSDT' })],
        ['an empty multi-symbol response', []],
        ['a multi-symbol response without the requested symbol', [
            makeMarkPrice({ symbol: 'ETHUSDT' }),
            makeMarkPrice({ symbol: 'BNBUSDT' }),
        ]],
    ])('fails deterministically when the requested symbol is unavailable in %s', (_label, payload) => {
        expect(() => normalizeFuturesMarkPrice(payload, 'BTCUSDT')).toThrowError(
            new FuturesMarkPriceError(
                FUTURES_MARK_PRICE_ERROR_CODES.SYMBOL_UNAVAILABLE,
                'Futures symbol "BTCUSDT" is unavailable in mark-price response',
            ),
        );
    });

    it.each([
        ['a null payload', null],
        ['a scalar payload', 'BTCUSDT'],
        ['a missing symbol identity', {}],
        ['a non-string symbol identity', makeMarkPrice({ symbol: 123 })],
        ['a malformed candidate in a multi-symbol response', [makeMarkPrice(), null]],
        ['a missing mark price', makeMarkPrice({ markPrice: undefined })],
        ['a numeric mark price', makeMarkPrice({ markPrice: 11793.63 })],
        ['a missing index price', makeMarkPrice({ indexPrice: undefined })],
        ['a numeric estimated settlement price', makeMarkPrice({
            estimatedSettlePrice: 11781.16,
        })],
        ['a string observation time', makeMarkPrice({ time: '1597370495002' })],
        ['a negative observation time', makeMarkPrice({ time: -1 })],
        ['duplicate requested symbols', [makeMarkPrice(), makeMarkPrice()]],
    ])('fails deterministically for %s', (_label, payload) => {
        expect(() => normalizeFuturesMarkPrice(payload, 'BTCUSDT')).toThrowError(
            new FuturesMarkPriceError(
                FUTURES_MARK_PRICE_ERROR_CODES.MALFORMED_RESPONSE,
                'Malformed futures mark-price response',
            ),
        );
    });

    it.each(['', '   '])('fails deterministically for an invalid requested symbol %#', (symbol) => {
        expect(() => normalizeFuturesMarkPrice(makeMarkPrice(), symbol)).toThrowError(
            new FuturesMarkPriceError(
                FUTURES_MARK_PRICE_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ),
        );
    });

    it('does not mutate the source response or return the selected source object', () => {
        const source = [
            makeMarkPrice({ symbol: 'ETHUSDT' }),
            makeMarkPrice(),
        ];
        const snapshot = structuredClone(source);

        const result = normalizeFuturesMarkPrice(source, 'BTCUSDT');

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source[1]);
        expect(result).toEqual(expectedMarkPrice);
    });
});

describe('normalizeFuturesFundingState', () => {
    it('normalizes the official single-symbol response without changing rate strings', () => {
        const source = makeMarkPrice({ lastFundingRate: '-0.000382460000' });
        const result = normalizeFuturesFundingState(source, 'BTCUSDT');

        expect(result).toEqual({
            ...expectedFundingState,
            lastFundingRate: '-0.000382460000',
        });
        expect(result.lastFundingRate).not.toBe('-0.00038246');
        expect(result.interestRate).not.toBe('0.0001');
        expect(result.nextFundingTime).toBe(1597392000000);
        expect(result.time).toBe(1597370495002);
        expect(result).not.toHaveProperty('markPrice');
        expect(result).not.toHaveProperty('indexPrice');
        expect(result).not.toHaveProperty('estimatedSettlePrice');
        expect(result).not.toHaveProperty('countdownMs');
    });

    it('selects the requested symbol from the official multi-symbol response variant', () => {
        const source = [
            makeMarkPrice({
                symbol: 'ETHUSDT',
                lastFundingRate: '0.000010000000',
                interestRate: '0.000200000000',
                nextFundingTime: 1597400000000,
                time: 1597370500000,
            }),
            makeMarkPrice(),
        ];

        expect(normalizeFuturesFundingState(source, 'BTCUSDT')).toEqual(
            expectedFundingState,
        );
    });

    it.each([
        ['a different single-symbol response', makeMarkPrice({ symbol: 'ETHUSDT' }), 'BTCUSDT'],
        ['an empty multi-symbol response', [], 'BTCUSDT'],
        ['a multi-symbol response without the requested symbol', [
            makeMarkPrice({ symbol: 'ETHUSDT' }),
            makeMarkPrice({ symbol: 'BNBUSDT' }),
        ], 'BTCUSDT'],
        ['a case-mismatched requested symbol', makeMarkPrice(), 'btcusdt'],
    ])('fails deterministically when the requested symbol is unavailable in %s', (
        _label,
        payload,
        requestedSymbol,
    ) => {
        expect(() => normalizeFuturesFundingState(payload, requestedSymbol)).toThrowError(
            new FuturesFundingStateError(
                FUTURES_FUNDING_STATE_ERROR_CODES.SYMBOL_UNAVAILABLE,
                `Futures symbol "${requestedSymbol}" is unavailable in funding-state response`,
            ),
        );
    });

    it.each([
        ['a null payload', null],
        ['a scalar payload', 'BTCUSDT'],
        ['a missing symbol identity', {}],
        ['a non-string symbol identity', makeMarkPrice({ symbol: 123 })],
        ['a malformed candidate in a multi-symbol response', [makeMarkPrice(), null]],
        ['a missing latest funding rate', makeMarkPrice({ lastFundingRate: undefined })],
        ['a numeric latest funding rate', makeMarkPrice({ lastFundingRate: 0.00038246 })],
        ['a blank latest funding rate', makeMarkPrice({ lastFundingRate: '   ' })],
        ['a missing interest rate', makeMarkPrice({ interestRate: undefined })],
        ['a numeric interest rate', makeMarkPrice({ interestRate: 0.0001 })],
        ['a string next-funding time', makeMarkPrice({ nextFundingTime: '1597392000000' })],
        ['a negative next-funding time', makeMarkPrice({ nextFundingTime: -1 })],
        ['an unsafe next-funding time', makeMarkPrice({
            nextFundingTime: Number.MAX_SAFE_INTEGER + 1,
        })],
        ['a string observation time', makeMarkPrice({ time: '1597370495002' })],
        ['a fractional observation time', makeMarkPrice({ time: 1597370495002.5 })],
        ['a negative observation time', makeMarkPrice({ time: -1 })],
        ['duplicate requested symbols', [makeMarkPrice(), makeMarkPrice()]],
    ])('fails deterministically for %s', (_label, payload) => {
        expect(() => normalizeFuturesFundingState(payload, 'BTCUSDT')).toThrowError(
            new FuturesFundingStateError(
                FUTURES_FUNDING_STATE_ERROR_CODES.MALFORMED_RESPONSE,
                'Malformed futures funding-state response',
            ),
        );
    });

    it.each([null, 123, '', '   '])(
        'fails deterministically for an invalid requested symbol %#',
        (symbol) => {
            expect(() => normalizeFuturesFundingState(makeMarkPrice(), symbol)).toThrowError(
                new FuturesFundingStateError(
                    FUTURES_FUNDING_STATE_ERROR_CODES.INVALID_SYMBOL,
                    'Futures symbol must be a non-empty string',
                ),
            );
        },
    );

    it('does not mutate the source response or return the selected source object', () => {
        const source = [
            makeMarkPrice({ symbol: 'ETHUSDT' }),
            makeMarkPrice(),
        ];
        const snapshot = structuredClone(source);

        const result = normalizeFuturesFundingState(source, 'BTCUSDT');

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source[1]);
        expect(result).toEqual(expectedFundingState);
    });

    it('keeps the completed mark/index contract unchanged for the shared source payload', () => {
        const source = makeMarkPrice();

        expect(normalizeFuturesMarkPrice(source, 'BTCUSDT')).toEqual(expectedMarkPrice);
        expect(normalizeFuturesFundingState(source, 'BTCUSDT')).toEqual(expectedFundingState);
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

    it('loads and unwraps official-client-style mark prices at the adapter boundary', async () => {
        const data = vi.fn().mockResolvedValue(makeMarkPrice());
        const transport = {
            getMarkPrice: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getMarkPrice('BTCUSDT')).resolves.toEqual(expectedMarkPrice);
        expect(transport.getMarkPrice).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw multi-symbol mark prices from an injected read-only transport', async () => {
        const transport = {
            getMarkPrice: vi.fn().mockResolvedValue([
                makeMarkPrice({ symbol: 'ETHUSDT' }),
                makeMarkPrice(),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getMarkPrice('BTCUSDT')).resolves.toEqual(expectedMarkPrice);
    });

    it('loads current funding state from the wrapped premium-index response', async () => {
        const data = vi.fn().mockResolvedValue(makeMarkPrice());
        const transport = {
            getMarkPrice: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getFundingState('BTCUSDT')).resolves.toEqual(
            expectedFundingState,
        );
        expect(transport.getMarkPrice).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw multi-symbol funding state from the injected read-only transport', async () => {
        const transport = {
            getMarkPrice: vi.fn().mockResolvedValue([
                makeMarkPrice({ symbol: 'ETHUSDT' }),
                makeMarkPrice(),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getFundingState('BTCUSDT')).resolves.toEqual(
            expectedFundingState,
        );
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

    it('preserves mark-price transport error identity', async () => {
        const transportError = new Error('futures mark-price transport unavailable');
        const transport = {
            getMarkPrice: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getMarkPrice('BTCUSDT')).rejects.toBe(transportError);
    });

    it('preserves mark-price response-body error identity', async () => {
        const responseError = new Error('futures mark-price response body unavailable');
        const transport = {
            getMarkPrice: vi.fn().mockResolvedValue({
                data: vi.fn().mockRejectedValue(responseError),
            }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getMarkPrice('BTCUSDT')).rejects.toBe(responseError);
    });

    it('preserves current-funding transport error identity', async () => {
        const transportError = new Error('futures funding transport unavailable');
        const transport = {
            getMarkPrice: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getFundingState('BTCUSDT')).rejects.toBe(transportError);
    });

    it('preserves current-funding response-body error identity', async () => {
        const responseError = new Error('futures funding response body unavailable');
        const transport = {
            getMarkPrice: vi.fn().mockResolvedValue({
                data: vi.fn().mockRejectedValue(responseError),
            }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getFundingState('BTCUSDT')).rejects.toBe(responseError);
    });

    it('exposes no futures execution surface', () => {
        const adapter = new FuturesTradingAdapter({ transport: {} });
        expect(Object.getOwnPropertyNames(FuturesTradingAdapter.prototype)).toEqual([
            'constructor',
            'getExchangeInfo',
            'getMarkPrice',
            'getFundingState',
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
