import { describe, expect, it, vi } from 'vitest';
import {
    FUTURES_ACCOUNT_BALANCE_ERROR_CODES,
    FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES,
    FUTURES_EXCHANGE_INFO_ERROR_CODES,
    FUTURES_FUNDING_STATE_ERROR_CODES,
    FUTURES_MARK_PRICE_ERROR_CODES,
    FUTURES_OPEN_ORDERS_ERROR_CODES,
    FUTURES_POSITION_RISK_ERROR_CODES,
    FuturesAccountBalanceError,
    FuturesAlgoOpenOrdersError,
    FuturesExchangeInfoError,
    FuturesFundingStateError,
    FuturesMarkPriceError,
    FuturesOpenOrdersError,
    FuturesPositionRiskError,
    FuturesTradingAdapter,
    normalizeFuturesAccountBalance,
    normalizeFuturesAlgoOpenOrders,
    normalizeFuturesExchangeInfo,
    normalizeFuturesFundingState,
    normalizeFuturesMarkPrice,
    normalizeFuturesOpenOrders,
    normalizeFuturesPositionRisk,
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

const makePositionRisk = (overrides = {}) => ({
    symbol: 'BTCUSDT',
    positionSide: 'BOTH',
    positionAmt: '30.000',
    entryPrice: '0.385000',
    breakEvenPrice: '0.385077',
    markPrice: '0.41047590',
    unRealizedProfit: '0.76427700',
    liquidationPrice: '0',
    isolatedMargin: '0.00000000',
    notional: '12.31427700',
    marginAsset: 'USDT',
    isolatedWallet: '0',
    initialMargin: '0.61571385',
    maintMargin: '0.08004280',
    positionInitialMargin: '0.61571385',
    openOrderInitialMargin: '0',
    adl: 2,
    bidNotional: '0',
    askNotional: '0',
    updateTime: 1720736417660,
    ...overrides,
});

const expectedPositionRisk = {
    marketType: 'futures',
    symbol: 'BTCUSDT',
    positionSide: 'BOTH',
    positionAmt: '30.000',
    entryPrice: '0.385000',
    breakEvenPrice: '0.385077',
    markPrice: '0.41047590',
    unRealizedProfit: '0.76427700',
    liquidationPrice: '0',
    isolatedMargin: '0.00000000',
    notional: '12.31427700',
    marginAsset: 'USDT',
    isolatedWallet: '0',
    initialMargin: '0.61571385',
    maintMargin: '0.08004280',
    positionInitialMargin: '0.61571385',
    openOrderInitialMargin: '0',
    adl: 2,
    updateTime: 1720736417660,
};

const makeAccountBalance = (overrides = {}) => ({
    accountAlias: 'SgsR',
    asset: 'USDT',
    balance: '122607.3513790300',
    crossWalletBalance: '23.724692060',
    crossUnPnl: '-0.00000000',
    availableBalance: '22.00000010',
    maxWithdrawAmount: '21.500000000',
    marginAvailable: true,
    updateTime: 1617939110373,
    ...overrides,
});

const expectedAccountBalance = {
    marketType: 'futures',
    accountAlias: 'SgsR',
    asset: 'USDT',
    balance: '122607.3513790300',
    crossWalletBalance: '23.724692060',
    crossUnPnl: '-0.00000000',
    availableBalance: '22.00000010',
    maxWithdrawAmount: '21.500000000',
    marginAvailable: true,
    updateTime: 1617939110373,
};

const makeOpenOrder = (overrides = {}) => ({
    avgPrice: '0.00000',
    clientOrderId: 'current-order-000001',
    cumQuote: '0',
    executedQty: '0',
    orderId: 1917641,
    origQty: '0.40',
    origType: 'TRAILING_STOP_MARKET',
    price: '0',
    reduceOnly: false,
    side: 'BUY',
    positionSide: 'SHORT',
    status: 'NEW',
    stopPrice: '9300.00000000',
    closePosition: false,
    symbol: 'BTCUSDT',
    time: 1579276756075,
    timeInForce: 'GTC',
    type: 'TRAILING_STOP_MARKET',
    activatePrice: '9020.00000000',
    priceRate: '0.3000',
    updateTime: 1579276756075,
    workingType: 'CONTRACT_PRICE',
    priceProtect: false,
    priceMatch: 'NONE',
    selfTradePreventionMode: 'NONE',
    goodTillDate: 0,
    ...overrides,
});

const expectedOpenOrder = {
    marketType: 'futures',
    avgPrice: '0.00000',
    clientOrderId: 'current-order-000001',
    cumQuote: '0',
    executedQty: '0',
    orderId: 1917641,
    origQty: '0.40',
    origType: 'TRAILING_STOP_MARKET',
    price: '0',
    reduceOnly: false,
    side: 'BUY',
    positionSide: 'SHORT',
    status: 'NEW',
    stopPrice: '9300.00000000',
    closePosition: false,
    symbol: 'BTCUSDT',
    time: 1579276756075,
    timeInForce: 'GTC',
    type: 'TRAILING_STOP_MARKET',
    activatePrice: '9020.00000000',
    priceRate: '0.3000',
    updateTime: 1579276756075,
    workingType: 'CONTRACT_PRICE',
    priceProtect: false,
    priceMatch: 'NONE',
    selfTradePreventionMode: 'NONE',
    goodTillDate: 0,
};

const makeAlgoOpenOrder = (overrides = {}) => ({
    algoId: 2148627,
    clientAlgoId: 'current-algo-order-000001',
    algoType: 'CONDITIONAL',
    orderType: 'TAKE_PROFIT',
    symbol: 'BTCUSDT',
    side: 'SELL',
    positionSide: 'BOTH',
    timeInForce: 'GTC',
    quantity: '0.010000',
    algoStatus: 'NEW',
    actualOrderId: '',
    actualPrice: '0.00000',
    triggerPrice: '750.000',
    price: '750.000',
    icebergQuantity: null,
    tpTriggerPrice: '0.000',
    tpPrice: '0.000',
    slTriggerPrice: '0.000',
    slPrice: '0.000',
    tpOrderType: '',
    selfTradePreventionMode: 'EXPIRE_MAKER',
    workingType: 'CONTRACT_PRICE',
    priceMatch: 'NONE',
    closePosition: false,
    priceProtect: false,
    reduceOnly: false,
    createTime: 1750514941540,
    updateTime: 1750514941540,
    triggerTime: 0,
    goodTillDate: 0,
    ...overrides,
});

const expectedAlgoOpenOrder = {
    marketType: 'futures',
    algoId: 2148627,
    clientAlgoId: 'current-algo-order-000001',
    algoType: 'CONDITIONAL',
    orderType: 'TAKE_PROFIT',
    symbol: 'BTCUSDT',
    side: 'SELL',
    positionSide: 'BOTH',
    timeInForce: 'GTC',
    quantity: '0.010000',
    algoStatus: 'NEW',
    actualOrderId: '',
    actualPrice: '0.00000',
    triggerPrice: '750.000',
    price: '750.000',
    icebergQuantity: null,
    tpTriggerPrice: '0.000',
    tpPrice: '0.000',
    slTriggerPrice: '0.000',
    slPrice: '0.000',
    tpOrderType: '',
    selfTradePreventionMode: 'EXPIRE_MAKER',
    workingType: 'CONTRACT_PRICE',
    priceMatch: 'NONE',
    closePosition: false,
    priceProtect: false,
    reduceOnly: false,
    createTime: 1750514941540,
    updateTime: 1750514941540,
    triggerTime: 0,
    goodTillDate: 0,
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

describe('normalizeFuturesPositionRisk', () => {
    it('normalizes the official V3 one-way response without changing decimal strings', () => {
        const source = [makePositionRisk()];
        const result = normalizeFuturesPositionRisk(source, 'BTCUSDT', 'BOTH');

        expect(result).toEqual(expectedPositionRisk);
        expect(result.positionAmt).not.toBe('30');
        expect(result.entryPrice).not.toBe('0.385');
        expect(result.markPrice).not.toBe('0.4104759');
        expect(result.unRealizedProfit).not.toBe('0.764277');
        expect(result.updateTime).toBe(1720736417660);
        expect(result).not.toHaveProperty('bidNotional');
        expect(result).not.toHaveProperty('askNotional');
    });

    it('models and selects the official V3 LONG and SHORT hedge-mode identities', () => {
        const longPosition = makePositionRisk({
            positionSide: 'LONG',
            positionAmt: '30.000',
        });
        const shortPosition = makePositionRisk({
            positionSide: 'SHORT',
            positionAmt: '-10.000',
            entryPrice: '70.92841000',
            breakEvenPrice: '70.900038636',
            unRealizedProfit: '21.20817624',
            liquidationPrice: '2260.56757210',
            notional: '-49.72023376',
            updateTime: 1708943511656,
        });
        const source = [longPosition, shortPosition];

        expect(normalizeFuturesPositionRisk(source, 'BTCUSDT', 'LONG')).toEqual({
            ...expectedPositionRisk,
            positionSide: 'LONG',
        });
        expect(normalizeFuturesPositionRisk(source, 'BTCUSDT', 'SHORT')).toEqual({
            ...expectedPositionRisk,
            positionSide: 'SHORT',
            positionAmt: '-10.000',
            entryPrice: '70.92841000',
            breakEvenPrice: '70.900038636',
            unRealizedProfit: '21.20817624',
            liquidationPrice: '2260.56757210',
            notional: '-49.72023376',
            updateTime: 1708943511656,
        });
    });

    it('selects the requested symbol and side independently of response order', () => {
        const source = [
            makePositionRisk({
                symbol: 'ETHUSDT',
                positionSide: 'LONG',
                marginAsset: 'USDT',
            }),
            makePositionRisk({
                positionSide: 'SHORT',
                positionAmt: '-10.000',
                notional: '-4.10475900',
            }),
            makePositionRisk({ positionSide: 'LONG' }),
        ];

        expect(normalizeFuturesPositionRisk(source, 'BTCUSDT', 'SHORT')).toEqual({
            ...expectedPositionRisk,
            positionSide: 'SHORT',
            positionAmt: '-10.000',
            notional: '-4.10475900',
        });
    });

    it('accepts a single hedge-side identity without requiring its counterpart', () => {
        const source = [makePositionRisk({ positionSide: 'SHORT' })];

        expect(normalizeFuturesPositionRisk(source, 'BTCUSDT', 'SHORT')).toEqual({
            ...expectedPositionRisk,
            positionSide: 'SHORT',
        });
    });

    it.each([
        ['an empty response', [], 'BTCUSDT'],
        ['a response with a different symbol', [makePositionRisk({ symbol: 'ETHUSDT' })], 'BTCUSDT'],
        ['a multi-symbol response without the requested symbol', [
            makePositionRisk({ symbol: 'ETHUSDT' }),
            makePositionRisk({ symbol: 'BNBUSDT' }),
        ], 'BTCUSDT'],
        ['a case-mismatched requested symbol', [makePositionRisk()], 'btcusdt'],
    ])('fails deterministically when the requested symbol is unavailable in %s', (
        _label,
        payload,
        requestedSymbol,
    ) => {
        expect(() => normalizeFuturesPositionRisk(
            payload,
            requestedSymbol,
            'BOTH',
        )).toThrowError(new FuturesPositionRiskError(
            FUTURES_POSITION_RISK_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in position-risk response`,
        ));
    });

    it.each([
        ['a one-way response when LONG is requested', [makePositionRisk()], 'LONG'],
        ['a hedge response when BOTH is requested', [
            makePositionRisk({ positionSide: 'LONG' }),
            makePositionRisk({ positionSide: 'SHORT' }),
        ], 'BOTH'],
        ['a LONG-only response when SHORT is requested', [
            makePositionRisk({ positionSide: 'LONG' }),
        ], 'SHORT'],
    ])('fails deterministically when the requested side is unavailable in %s', (
        _label,
        payload,
        requestedPositionSide,
    ) => {
        expect(() => normalizeFuturesPositionRisk(
            payload,
            'BTCUSDT',
            requestedPositionSide,
        )).toThrowError(new FuturesPositionRiskError(
            FUTURES_POSITION_RISK_ERROR_CODES.POSITION_SIDE_UNAVAILABLE,
            `Futures position side "${requestedPositionSide}" is unavailable for symbol "BTCUSDT" in position-risk response`,
        ));
    });

    it.each([null, 123, '', '   '])(
        'fails deterministically for an invalid requested symbol %#',
        (symbol) => {
            expect(() => normalizeFuturesPositionRisk(
                [makePositionRisk()],
                symbol,
                'BOTH',
            )).toThrowError(new FuturesPositionRiskError(
                FUTURES_POSITION_RISK_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
        },
    );

    it.each([undefined, null, '', 'both', 'BUY', 123])(
        'fails deterministically for an invalid requested position side %#',
        (positionSide) => {
            expect(() => normalizeFuturesPositionRisk(
                [makePositionRisk()],
                'BTCUSDT',
                positionSide,
            )).toThrowError(new FuturesPositionRiskError(
                FUTURES_POSITION_RISK_ERROR_CODES.INVALID_POSITION_SIDE,
                'Futures position side must be one of BOTH, LONG, or SHORT',
            ));
        },
    );

    it.each([
        ['a null payload', null],
        ['an object instead of the documented array', makePositionRisk()],
        ['a scalar payload', 'BTCUSDT'],
        ['a missing symbol identity', [makePositionRisk({ symbol: undefined })]],
        ['a non-string symbol identity', [makePositionRisk({ symbol: 123 })]],
        ['a missing response-side identity', [makePositionRisk({ positionSide: undefined })]],
        ['an unsupported response-side identity', [makePositionRisk({ positionSide: 'BUY' })]],
        ['a malformed unrelated candidate', [makePositionRisk(), null]],
        ['mixed one-way and hedge identities for one symbol', [
            makePositionRisk(),
            makePositionRisk({ positionSide: 'LONG' }),
        ]],
        ['mixed one-way and hedge identities across symbols', [
            makePositionRisk({ symbol: 'ETHUSDT', positionSide: 'LONG' }),
            makePositionRisk(),
        ]],
        ['a duplicate non-requested hedge identity', [
            makePositionRisk({ positionSide: 'LONG' }),
            makePositionRisk({ positionSide: 'SHORT' }),
            makePositionRisk({ positionSide: 'SHORT' }),
        ]],
        ['a duplicate composite identity for another symbol', [
            makePositionRisk({ symbol: 'ETHUSDT' }),
            makePositionRisk({ symbol: 'ETHUSDT' }),
            makePositionRisk(),
        ]],
        ['a missing position amount', [makePositionRisk({ positionAmt: undefined })]],
        ['a numeric entry price', [makePositionRisk({ entryPrice: 0.385 })]],
        ['a blank break-even price', [makePositionRisk({ breakEvenPrice: '   ' })]],
        ['a missing mark price', [makePositionRisk({ markPrice: undefined })]],
        ['a numeric unrealized profit', [makePositionRisk({ unRealizedProfit: 0.764277 })]],
        ['a missing liquidation price', [makePositionRisk({ liquidationPrice: undefined })]],
        ['a numeric isolated margin', [makePositionRisk({ isolatedMargin: 0 })]],
        ['a missing notional', [makePositionRisk({ notional: undefined })]],
        ['a blank margin asset', [makePositionRisk({ marginAsset: '   ' })]],
        ['a missing isolated wallet', [makePositionRisk({ isolatedWallet: undefined })]],
        ['a numeric initial margin', [makePositionRisk({ initialMargin: 0.61571385 })]],
        ['a missing maintenance margin', [makePositionRisk({ maintMargin: undefined })]],
        ['a blank position initial margin', [makePositionRisk({
            positionInitialMargin: '',
        })]],
        ['a numeric open-order initial margin', [makePositionRisk({
            openOrderInitialMargin: 0,
        })]],
        ['a string ADL rank', [makePositionRisk({ adl: '2' })]],
        ['a negative ADL rank', [makePositionRisk({ adl: -1 })]],
        ['a fractional ADL rank', [makePositionRisk({ adl: 1.5 })]],
        ['an unsafe ADL rank', [makePositionRisk({
            adl: Number.MAX_SAFE_INTEGER + 1,
        })]],
        ['a string update time', [makePositionRisk({ updateTime: '1720736417660' })]],
        ['a fractional update time', [makePositionRisk({
            updateTime: 1720736417660.5,
        })]],
        ['a negative update time', [makePositionRisk({ updateTime: -1 })]],
        ['an unsafe update time', [makePositionRisk({
            updateTime: Number.MAX_SAFE_INTEGER + 1,
        })]],
        ['duplicate symbol and side identities', [makePositionRisk(), makePositionRisk()]],
    ])('fails deterministically for %s', (_label, payload) => {
        expect(() => normalizeFuturesPositionRisk(
            payload,
            'BTCUSDT',
            'BOTH',
        )).toThrowError(new FuturesPositionRiskError(
            FUTURES_POSITION_RISK_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures position-risk response',
        ));
    });

    it('preserves zero as a valid normalizer-policy update timestamp', () => {
        expect(normalizeFuturesPositionRisk(
            [makePositionRisk({ updateTime: 0 })],
            'BTCUSDT',
            'BOTH',
        ).updateTime).toBe(0);
    });

    it('does not mutate the source response or return the selected source object', () => {
        const source = [
            makePositionRisk({ symbol: 'ETHUSDT', positionSide: 'LONG' }),
            makePositionRisk({ positionSide: 'LONG' }),
            makePositionRisk({ positionSide: 'SHORT' }),
        ];
        const snapshot = structuredClone(source);

        const result = normalizeFuturesPositionRisk(source, 'BTCUSDT', 'LONG');

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source[1]);
        expect(result).toEqual({
            ...expectedPositionRisk,
            positionSide: 'LONG',
        });
    });

    it('keeps all completed futures contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toEqual({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            contractType: 'PERPETUAL',
            status: 'TRADING',
            assets: { base: 'BTC', quote: 'USDT', margin: 'USDT' },
            filters: expectedFilters,
            supportedOrderTypes: ['LIMIT', 'MARKET', 'STOP'],
            supportedTimeInForce: ['GTC', 'IOC', 'FOK', 'GTX'],
        });
        expect(normalizeFuturesMarkPrice(premiumIndex, 'BTCUSDT')).toEqual(
            expectedMarkPrice,
        );
        expect(normalizeFuturesFundingState(premiumIndex, 'BTCUSDT')).toEqual(
            expectedFundingState,
        );
    });
});

describe('normalizeFuturesAccountBalance', () => {
    it('normalizes the official V3 array response without changing decimal strings', () => {
        const result = normalizeFuturesAccountBalance(
            [makeAccountBalance()],
            'USDT',
        );

        expect(result).toEqual(expectedAccountBalance);
        expect(result.balance).toBe('122607.3513790300');
        expect(result.crossWalletBalance).toBe('23.724692060');
        expect(result.crossUnPnl).toBe('-0.00000000');
        expect(result.availableBalance).toBe('22.00000010');
        expect(result.maxWithdrawAmount).toBe('21.500000000');
        expect(result.updateTime).toBe(1617939110373);
    });

    it('selects the requested margin asset independently of response order', () => {
        const source = [
            makeAccountBalance({
                accountAlias: 'AnotherAlias',
                asset: 'USDC',
                balance: '10.00000000',
            }),
            makeAccountBalance(),
        ];

        expect(normalizeFuturesAccountBalance(source, 'USDT')).toEqual(
            expectedAccountBalance,
        );
    });

    it('validates full fields only for the requested asset after validating all identities', () => {
        const source = [
            makeAccountBalance({
                asset: 'USDC',
                accountAlias: undefined,
                balance: 10,
            }),
            makeAccountBalance(),
        ];

        expect(normalizeFuturesAccountBalance(source, 'USDT')).toEqual(
            expectedAccountBalance,
        );
    });

    it.each([
        ['an empty response', [], 'USDT'],
        ['a response with a different asset', [
            makeAccountBalance({ asset: 'USDC' }),
        ], 'USDT'],
        ['a multi-asset response without the requested asset', [
            makeAccountBalance({ asset: 'USDC' }),
            makeAccountBalance({ asset: 'BNB' }),
        ], 'USDT'],
        ['a case-mismatched requested asset', [makeAccountBalance()], 'usdt'],
    ])('fails deterministically when the requested margin asset is unavailable in %s', (
        _label,
        payload,
        requestedMarginAsset,
    ) => {
        expect(() => normalizeFuturesAccountBalance(
            payload,
            requestedMarginAsset,
        )).toThrowError(new FuturesAccountBalanceError(
            FUTURES_ACCOUNT_BALANCE_ERROR_CODES.MARGIN_ASSET_UNAVAILABLE,
            `Futures margin asset "${requestedMarginAsset}" is unavailable in account-balance response`,
        ));
    });

    it.each([null, 123, '', '   '])(
        'fails deterministically for an invalid requested margin asset %#',
        (marginAsset) => {
            expect(() => normalizeFuturesAccountBalance(
                [makeAccountBalance()],
                marginAsset,
            )).toThrowError(new FuturesAccountBalanceError(
                FUTURES_ACCOUNT_BALANCE_ERROR_CODES.INVALID_MARGIN_ASSET,
                'Futures margin asset must be a non-empty string',
            ));
        },
    );

    it.each([
        ['a null payload', null],
        ['an object instead of the documented array', makeAccountBalance()],
        ['a scalar payload', 'USDT'],
        ['a null candidate', [null]],
        ['a missing asset identity', [makeAccountBalance({ asset: undefined })]],
        ['a non-string asset identity', [makeAccountBalance({ asset: 123 })]],
        ['a blank asset identity', [makeAccountBalance({ asset: '   ' })]],
        ['a malformed unrelated asset identity', [
            makeAccountBalance(),
            makeAccountBalance({ asset: undefined }),
        ]],
        ['a missing account alias', [makeAccountBalance({ accountAlias: undefined })]],
        ['a blank account alias', [makeAccountBalance({ accountAlias: '   ' })]],
        ['a numeric wallet balance', [makeAccountBalance({ balance: 122607.35 })]],
        ['a blank cross-wallet balance', [makeAccountBalance({
            crossWalletBalance: '   ',
        })]],
        ['a missing cross unrealized PnL', [makeAccountBalance({ crossUnPnl: undefined })]],
        ['a numeric available balance', [makeAccountBalance({ availableBalance: 22 })]],
        ['a blank maximum withdrawal amount', [makeAccountBalance({
            maxWithdrawAmount: '',
        })]],
        ['a string margin-availability flag', [makeAccountBalance({
            marginAvailable: 'true',
        })]],
        ['a numeric margin-availability flag', [makeAccountBalance({
            marginAvailable: 1,
        })]],
        ['a null margin-availability flag', [makeAccountBalance({
            marginAvailable: null,
        })]],
        ['a string update time', [makeAccountBalance({ updateTime: '1617939110373' })]],
        ['a fractional update time', [makeAccountBalance({
            updateTime: 1617939110373.5,
        })]],
        ['a negative update time', [makeAccountBalance({ updateTime: -1 })]],
        ['an unsafe update time', [makeAccountBalance({
            updateTime: Number.MAX_SAFE_INTEGER + 1,
        })]],
        ['a duplicate requested asset identity', [
            makeAccountBalance(),
            makeAccountBalance(),
        ]],
        ['a duplicate unrelated asset identity', [
            makeAccountBalance({ asset: 'USDC' }),
            makeAccountBalance({ asset: 'USDC' }),
            makeAccountBalance(),
        ]],
    ])('fails deterministically for %s', (_label, payload) => {
        expect(() => normalizeFuturesAccountBalance(
            payload,
            'USDT',
        )).toThrowError(new FuturesAccountBalanceError(
            FUTURES_ACCOUNT_BALANCE_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures account-balance response',
        ));
    });

    it('preserves false as a valid margin-availability flag', () => {
        expect(normalizeFuturesAccountBalance(
            [makeAccountBalance({ marginAvailable: false })],
            'USDT',
        )).toEqual({
            ...expectedAccountBalance,
            marginAvailable: false,
        });
    });

    it('preserves zero as a valid normalizer-policy update timestamp', () => {
        expect(normalizeFuturesAccountBalance(
            [makeAccountBalance({ updateTime: 0 })],
            'USDT',
        ).updateTime).toBe(0);
    });

    it('does not mutate the source or return the selected source object', () => {
        const source = [
            makeAccountBalance({ asset: 'USDC' }),
            makeAccountBalance({ ignoredField: 'ignored' }),
        ];
        const snapshot = structuredClone(source);

        const result = normalizeFuturesAccountBalance(source, 'USDT');

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source[1]);
        expect(result).toEqual(expectedAccountBalance);
        expect(result).not.toHaveProperty('ignoredField');
    });

    it('keeps all completed futures contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toEqual({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            contractType: 'PERPETUAL',
            status: 'TRADING',
            assets: { base: 'BTC', quote: 'USDT', margin: 'USDT' },
            filters: expectedFilters,
            supportedOrderTypes: ['LIMIT', 'MARKET', 'STOP'],
            supportedTimeInForce: ['GTC', 'IOC', 'FOK', 'GTX'],
        });
        expect(normalizeFuturesMarkPrice(premiumIndex, 'BTCUSDT')).toEqual(
            expectedMarkPrice,
        );
        expect(normalizeFuturesFundingState(premiumIndex, 'BTCUSDT')).toEqual(
            expectedFundingState,
        );
        expect(normalizeFuturesPositionRisk(
            [makePositionRisk()],
            'BTCUSDT',
            'BOTH',
        )).toEqual(expectedPositionRisk);
    });
});

describe('normalizeFuturesOpenOrders', () => {
    it('normalizes the official current-open-orders array with exact source types', () => {
        const result = normalizeFuturesOpenOrders([makeOpenOrder()], 'BTCUSDT');

        expect(result).toEqual([expectedOpenOrder]);

        [
            ['avgPrice', '0.00000'],
            ['cumQuote', '0'],
            ['executedQty', '0'],
            ['origQty', '0.40'],
            ['price', '0'],
            ['stopPrice', '9300.00000000'],
            ['activatePrice', '9020.00000000'],
            ['priceRate', '0.3000'],
        ].forEach(([field, expectedValue]) => {
            expect(result[0][field]).toBe(expectedValue);
            expect(typeof result[0][field]).toBe('string');
        });

        expect(result[0].clientOrderId).toBe('current-order-000001');
        expect(result[0].symbol).toBe('BTCUSDT');
        ['orderId', 'time', 'updateTime', 'goodTillDate'].forEach((field) => {
            expect(Number.isInteger(result[0][field])).toBe(true);
        });
        expect(result[0].orderId).toBe(1917641);
        expect(result[0].time).toBe(1579276756075);
        expect(result[0].updateTime).toBe(1579276756075);
        expect(result[0].goodTillDate).toBe(0);
        expect(result[0].reduceOnly).toBe(false);
        expect(result[0].closePosition).toBe(false);
        expect(result[0].priceProtect).toBe(false);
    });

    it('preserves source order across multiple current open orders', () => {
        const source = [
            makeOpenOrder({
                orderId: 3003,
                clientOrderId: 'third-source-order',
                price: '93003.00000000',
            }),
            makeOpenOrder({
                orderId: 1001,
                clientOrderId: 'first-numbered-order',
                price: '93001.00000000',
            }),
            makeOpenOrder({
                orderId: 2002,
                clientOrderId: 'second-numbered-order',
                price: '93002.00000000',
            }),
        ];

        const result = normalizeFuturesOpenOrders(source, 'BTCUSDT');

        expect(result.map((order) => order.orderId)).toEqual([3003, 1001, 2002]);
        expect(result.map((order) => order.clientOrderId)).toEqual([
            'third-source-order',
            'first-numbered-order',
            'second-numbered-order',
        ]);
        expect(result.map((order) => order.price)).toEqual([
            '93003.00000000',
            '93001.00000000',
            '93002.00000000',
        ]);
    });

    it('accepts an empty official array as a valid fresh empty result', () => {
        const source = [];
        const result = normalizeFuturesOpenOrders(source, 'BTCUSDT');

        expect(result).toEqual([]);
        expect(result).not.toBe(source);
    });

    it('requires and preserves exact symbol identity without canonicalization', () => {
        const result = normalizeFuturesOpenOrders([
            makeOpenOrder({ clientOrderId: 'BTCUSDT-exact-000001' }),
        ], 'BTCUSDT');

        expect(result).toEqual([{
            ...expectedOpenOrder,
            clientOrderId: 'BTCUSDT-exact-000001',
        }]);
        expect(result[0].symbol).toBe('BTCUSDT');
    });

    it.each([
        ['a different symbol', [makeOpenOrder({ symbol: 'ETHUSDT' })], 'BTCUSDT'],
        ['a case-mismatched response symbol', [
            makeOpenOrder({ symbol: 'btcusdt' }),
        ], 'BTCUSDT'],
        ['a case-mismatched requested symbol', [makeOpenOrder()], 'btcusdt'],
    ])('fails deterministically for %s', (_label, payload, requestedSymbol) => {
        expect(() => normalizeFuturesOpenOrders(
            payload,
            requestedSymbol,
        )).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in open-orders response`,
        ));
    });

    it('rejects a mixed-symbol response instead of silently filtering it', () => {
        expect(() => normalizeFuturesOpenOrders([
            makeOpenOrder(),
            makeOpenOrder({
                symbol: 'ETHUSDT',
                orderId: 1917642,
                clientOrderId: 'eth-current-order-000001',
            }),
        ], 'BTCUSDT')).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
    });

    it.each([undefined, null, 123, '', '   '])(
        'fails before response parsing for invalid requested symbol %#',
        (requestedSymbol) => {
            expect(() => normalizeFuturesOpenOrders(
                [makeOpenOrder()],
                requestedSymbol,
            )).toThrowError(new FuturesOpenOrdersError(
                FUTURES_OPEN_ORDERS_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
        },
    );

    it.each([
        ['a null payload', null],
        ['an object instead of the documented array', makeOpenOrder()],
        ['a scalar payload', 'BTCUSDT'],
        ['a null entry', [null]],
        ['a missing symbol identity', [makeOpenOrder({ symbol: undefined })]],
        ['a numeric symbol identity', [makeOpenOrder({ symbol: 123 })]],
        ['a blank symbol identity', [makeOpenOrder({ symbol: '   ' })]],
        ['a malformed entry among otherwise valid entries', [
            makeOpenOrder(),
            null,
        ]],
    ])('fails deterministically for %s', (_label, payload) => {
        expect(() => normalizeFuturesOpenOrders(
            payload,
            'BTCUSDT',
        )).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
    });

    it.each([
        'avgPrice',
        'cumQuote',
        'executedQty',
        'origQty',
        'price',
        'stopPrice',
    ])('rejects a non-string required decimal in %s', (field) => {
        expect(() => normalizeFuturesOpenOrders([
            makeOpenOrder({ [field]: 0 }),
        ], 'BTCUSDT')).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
    });

    it.each([
        'clientOrderId',
        'origType',
        'side',
        'positionSide',
        'status',
        'timeInForce',
        'type',
        'workingType',
        'priceMatch',
        'selfTradePreventionMode',
    ])('rejects a blank required string in %s', (field) => {
        expect(() => normalizeFuturesOpenOrders([
            makeOpenOrder({ [field]: '   ' }),
        ], 'BTCUSDT')).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
    });

    it.each(['avgPrice', 'clientOrderId', 'orderId', 'reduceOnly'])(
        'rejects a missing required %s field',
        (field) => {
            const source = makeOpenOrder();
            delete source[field];

            expect(() => normalizeFuturesOpenOrders([
                source,
            ], 'BTCUSDT')).toThrowError(new FuturesOpenOrdersError(
                FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
                'Malformed futures open-orders response',
            ));
        },
    );

    it.each(['orderId', 'time', 'updateTime', 'goodTillDate'])(
        'rejects a non-integer value in %s',
        (field) => {
            expect(() => normalizeFuturesOpenOrders([
                makeOpenOrder({ [field]: '0' }),
            ], 'BTCUSDT')).toThrowError(new FuturesOpenOrdersError(
                FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
                'Malformed futures open-orders response',
            ));
        },
    );

    it.each([
        ['a negative integer', -1],
        ['a fractional number', 1.5],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects %s for an integer field', (_label, invalidInteger) => {
        expect(() => normalizeFuturesOpenOrders([
            makeOpenOrder({ time: invalidInteger }),
        ], 'BTCUSDT')).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
    });

    it.each(['reduceOnly', 'closePosition', 'priceProtect'])(
        'rejects a non-boolean flag in %s',
        (field) => {
            expect(() => normalizeFuturesOpenOrders([
                makeOpenOrder({ [field]: 'false' }),
            ], 'BTCUSDT')).toThrowError(new FuturesOpenOrdersError(
                FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
                'Malformed futures open-orders response',
            ));
        },
    );

    it('normalizes omitted trailing-stop fields to explicit null values', () => {
        const source = makeOpenOrder();
        delete source.activatePrice;
        delete source.priceRate;

        expect(normalizeFuturesOpenOrders([source], 'BTCUSDT')).toEqual([{
            ...expectedOpenOrder,
            activatePrice: null,
            priceRate: null,
        }]);
    });

    it.each([
        ['activatePrice', 'priceRate', '0.3000'],
        ['priceRate', 'activatePrice', '9020.00000000'],
    ])('normalizes independently omitted optional %s while preserving %s', (
        omittedField,
        preservedField,
        preservedValue,
    ) => {
        const source = makeOpenOrder();
        delete source[omittedField];

        const [result] = normalizeFuturesOpenOrders([source], 'BTCUSDT');

        expect(result[omittedField]).toBeNull();
        expect(result[preservedField]).toBe(preservedValue);
    });

    it('preserves true boolean flags without coercion', () => {
        const [result] = normalizeFuturesOpenOrders([
            makeOpenOrder({
                reduceOnly: true,
                closePosition: true,
                priceProtect: true,
            }),
        ], 'BTCUSDT');

        expect(result.reduceOnly).toBe(true);
        expect(result.closePosition).toBe(true);
        expect(result.priceProtect).toBe(true);
    });

    it.each([
        ['activatePrice', null],
        ['activatePrice', 9020],
        ['activatePrice', '   '],
        ['priceRate', null],
        ['priceRate', 0.3],
        ['priceRate', ''],
    ])('rejects malformed optional %s value %#', (field, invalidValue) => {
        expect(() => normalizeFuturesOpenOrders([
            makeOpenOrder({ [field]: invalidValue }),
        ], 'BTCUSDT')).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
    });

    it.each([
        ['orderId', {
            orderId: 1917641,
            clientOrderId: 'different-client-order-id',
        }],
        ['clientOrderId', {
            orderId: 1917642,
            clientOrderId: 'current-order-000001',
        }],
    ])('rejects duplicate %s identities', (_identity, duplicateOverrides) => {
        expect(() => normalizeFuturesOpenOrders([
            makeOpenOrder(),
            makeOpenOrder(duplicateOverrides),
        ], 'BTCUSDT')).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
    });

    it('preserves source immutability and returns fresh order objects', () => {
        const source = [
            makeOpenOrder({ ignoredField: 'not-normalized' }),
            makeOpenOrder({
                orderId: 1917642,
                clientOrderId: 'current-order-000002',
            }),
        ];
        const snapshot = structuredClone(source);

        const result = normalizeFuturesOpenOrders(source, 'BTCUSDT');
        const secondResult = normalizeFuturesOpenOrders(source, 'BTCUSDT');

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source);
        expect(result[0]).not.toBe(source[0]);
        expect(result[1]).not.toBe(source[1]);
        expect(result[0]).not.toBe(result[1]);
        expect(result[0]).not.toBe(secondResult[0]);
        expect(result[0]).not.toHaveProperty('ignoredField');
    });

    it('keeps all five completed futures read-only contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toEqual({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            contractType: 'PERPETUAL',
            status: 'TRADING',
            assets: { base: 'BTC', quote: 'USDT', margin: 'USDT' },
            filters: expectedFilters,
            supportedOrderTypes: ['LIMIT', 'MARKET', 'STOP'],
            supportedTimeInForce: ['GTC', 'IOC', 'FOK', 'GTX'],
        });
        expect(normalizeFuturesMarkPrice(premiumIndex, 'BTCUSDT')).toEqual(
            expectedMarkPrice,
        );
        expect(normalizeFuturesFundingState(premiumIndex, 'BTCUSDT')).toEqual(
            expectedFundingState,
        );
        expect(normalizeFuturesPositionRisk(
            [makePositionRisk()],
            'BTCUSDT',
            'BOTH',
        )).toEqual(expectedPositionRisk);
        expect(normalizeFuturesAccountBalance(
            [makeAccountBalance()],
            'USDT',
        )).toEqual(expectedAccountBalance);
    });
});

describe('normalizeFuturesAlgoOpenOrders', () => {
    it('normalizes the official current-algo-open-orders array with exact source types', () => {
        const result = normalizeFuturesAlgoOpenOrders(
            [makeAlgoOpenOrder()],
            'BTCUSDT',
        );

        expect(result).toEqual([expectedAlgoOpenOrder]);

        [
            ['quantity', '0.010000'],
            ['actualPrice', '0.00000'],
            ['triggerPrice', '750.000'],
            ['price', '750.000'],
            ['tpTriggerPrice', '0.000'],
            ['tpPrice', '0.000'],
            ['slTriggerPrice', '0.000'],
            ['slPrice', '0.000'],
        ].forEach(([field, expectedValue]) => {
            expect(result[0][field]).toBe(expectedValue);
            expect(typeof result[0][field]).toBe('string');
        });

        expect(result[0].algoId).toBe(2148627);
        expect(result[0].clientAlgoId).toBe('current-algo-order-000001');
        expect(result[0].actualOrderId).toBe('');
        expect(result[0].tpOrderType).toBe('');
        expect(result[0].icebergQuantity).toBeNull();
        [
            'algoId',
            'createTime',
            'updateTime',
            'triggerTime',
            'goodTillDate',
        ].forEach((field) => {
            expect(Number.isSafeInteger(result[0][field])).toBe(true);
        });
        expect(result[0].closePosition).toBe(false);
        expect(result[0].priceProtect).toBe(false);
        expect(result[0].reduceOnly).toBe(false);
    });

    it('preserves source order across multiple current algo open orders', () => {
        const source = [
            makeAlgoOpenOrder({
                algoId: 3003,
                clientAlgoId: 'third-source-algo-order',
                triggerPrice: '93003.00000000',
            }),
            makeAlgoOpenOrder({
                algoId: 1001,
                clientAlgoId: 'first-numbered-algo-order',
                triggerPrice: '93001.00000000',
            }),
            makeAlgoOpenOrder({
                algoId: 2002,
                clientAlgoId: 'second-numbered-algo-order',
                triggerPrice: '93002.00000000',
            }),
        ];

        const result = normalizeFuturesAlgoOpenOrders(source, 'BTCUSDT');

        expect(result.map((order) => order.algoId)).toEqual([3003, 1001, 2002]);
        expect(result.map((order) => order.clientAlgoId)).toEqual([
            'third-source-algo-order',
            'first-numbered-algo-order',
            'second-numbered-algo-order',
        ]);
        expect(result.map((order) => order.triggerPrice)).toEqual([
            '93003.00000000',
            '93001.00000000',
            '93002.00000000',
        ]);
    });

    it('accepts an empty official array as a valid fresh empty result', () => {
        const source = [];
        const result = normalizeFuturesAlgoOpenOrders(source, 'BTCUSDT');

        expect(result).toEqual([]);
        expect(result).not.toBe(source);
    });

    it('requires and preserves exact symbol identity without canonicalization', () => {
        const result = normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({ clientAlgoId: 'BTCUSDT-exact-algo-000001' }),
        ], 'BTCUSDT');

        expect(result).toEqual([{
            ...expectedAlgoOpenOrder,
            clientAlgoId: 'BTCUSDT-exact-algo-000001',
        }]);
        expect(result[0].symbol).toBe('BTCUSDT');
    });

    it.each([
        ['a different symbol', [makeAlgoOpenOrder({ symbol: 'ETHUSDT' })], 'BTCUSDT'],
        ['a case-mismatched response symbol', [
            makeAlgoOpenOrder({ symbol: 'btcusdt' }),
        ], 'BTCUSDT'],
        ['a case-mismatched requested symbol', [makeAlgoOpenOrder()], 'btcusdt'],
    ])('fails deterministically for %s', (_label, payload, requestedSymbol) => {
        expect(() => normalizeFuturesAlgoOpenOrders(
            payload,
            requestedSymbol,
        )).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in algo-open-orders response`,
        ));
    });

    it('rejects a mixed-symbol response instead of silently filtering it', () => {
        expect(() => normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder(),
            makeAlgoOpenOrder({
                symbol: 'ETHUSDT',
                algoId: 2148628,
                clientAlgoId: 'eth-current-algo-order-000001',
            }),
        ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
    });

    it.each([undefined, null, 123, '', '   '])(
        'fails before response parsing for invalid requested symbol %#',
        (requestedSymbol) => {
            expect(() => normalizeFuturesAlgoOpenOrders(
                [makeAlgoOpenOrder()],
                requestedSymbol,
            )).toThrowError(new FuturesAlgoOpenOrdersError(
                FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
        },
    );

    it.each([
        ['an undefined payload', undefined],
        ['a null payload', null],
        ['an object instead of the documented array', makeAlgoOpenOrder()],
        ['a scalar payload', 'BTCUSDT'],
        ['a null entry', [null]],
        ['an array entry', [[]]],
        ['a missing symbol identity', [makeAlgoOpenOrder({ symbol: undefined })]],
        ['a numeric symbol identity', [makeAlgoOpenOrder({ symbol: 123 })]],
        ['a blank symbol identity', [makeAlgoOpenOrder({ symbol: '   ' })]],
        ['a malformed entry among otherwise valid entries', [
            makeAlgoOpenOrder(),
            null,
        ]],
    ])('fails deterministically for %s', (_label, payload) => {
        expect(() => normalizeFuturesAlgoOpenOrders(
            payload,
            'BTCUSDT',
        )).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
    });

    it.each([
        'quantity',
        'actualPrice',
        'triggerPrice',
        'price',
        'tpTriggerPrice',
        'tpPrice',
        'slTriggerPrice',
        'slPrice',
    ])('rejects a non-string required decimal in %s', (field) => {
        expect(() => normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({ [field]: 0 }),
        ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
    });

    it.each([
        'quantity',
        'actualPrice',
        'triggerPrice',
        'price',
        'tpTriggerPrice',
        'tpPrice',
        'slTriggerPrice',
        'slPrice',
    ])('rejects a blank required decimal in %s', (field) => {
        expect(() => normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({ [field]: '   ' }),
        ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
    });

    it.each([
        'clientAlgoId',
        'algoType',
        'orderType',
        'side',
        'positionSide',
        'timeInForce',
        'algoStatus',
        'selfTradePreventionMode',
        'workingType',
        'priceMatch',
    ])('rejects a blank required string in %s', (field) => {
        expect(() => normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({ [field]: '   ' }),
        ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
    });

    it.each([
        'clientAlgoId',
        'quantity',
        'actualOrderId',
        'icebergQuantity',
        'algoId',
        'closePosition',
        'goodTillDate',
    ])('rejects a missing required %s field', (field) => {
        const source = makeAlgoOpenOrder();
        delete source[field];

        expect(() => normalizeFuturesAlgoOpenOrders([
            source,
        ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
    });

    it('preserves documented empty-string identifiers without inventing nulls', () => {
        const [result] = normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder(),
        ], 'BTCUSDT');

        expect(result.actualOrderId).toBe('');
        expect(result.tpOrderType).toBe('');
        expect(result.actualOrderId).not.toBeNull();
        expect(result.tpOrderType).not.toBeNull();
    });

    it('preserves populated actual-order and take-profit-order identifiers exactly', () => {
        const [result] = normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({
                actualOrderId: '00192837465',
                tpOrderType: 'TAKE_PROFIT_MARKET',
            }),
        ], 'BTCUSDT');

        expect(result.actualOrderId).toBe('00192837465');
        expect(result.tpOrderType).toBe('TAKE_PROFIT_MARKET');
    });

    it.each([
        ['actualOrderId', null],
        ['actualOrderId', 123],
        ['actualOrderId', '   '],
        ['tpOrderType', null],
        ['tpOrderType', false],
        ['tpOrderType', '   '],
    ])('rejects malformed empty-string-capable %s value %#', (field, value) => {
        expect(() => normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({ [field]: value }),
        ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
    });

    it('preserves the documented nullable iceberg quantity without coercion', () => {
        const [nullableResult] = normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({ icebergQuantity: null }),
        ], 'BTCUSDT');
        const [decimalResult] = normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({ icebergQuantity: '0.00010000' }),
        ], 'BTCUSDT');
        const [literalNullResult] = normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({ icebergQuantity: 'null' }),
        ], 'BTCUSDT');

        expect(nullableResult.icebergQuantity).toBeNull();
        expect(decimalResult.icebergQuantity).toBe('0.00010000');
        expect(typeof decimalResult.icebergQuantity).toBe('string');
        expect(literalNullResult.icebergQuantity).toBe('null');
        expect(typeof literalNullResult.icebergQuantity).toBe('string');
    });

    it.each([undefined, 0, false, '', '   '])(
        'rejects an undocumented iceberg-quantity value %# without coercion',
        (icebergQuantity) => {
            expect(() => normalizeFuturesAlgoOpenOrders([
                makeAlgoOpenOrder({ icebergQuantity }),
            ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
                FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
                'Malformed futures algo-open-orders response',
            ));
        },
    );

    it.each([
        'algoId',
        'createTime',
        'updateTime',
        'triggerTime',
        'goodTillDate',
    ])('rejects a non-integer value in %s', (field) => {
        expect(() => normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({ [field]: '0' }),
        ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
    });

    it.each([
        ['a negative integer', -1],
        ['a fractional number', 1.5],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects %s for an integer field', (_label, invalidInteger) => {
        expect(() => normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({ updateTime: invalidInteger }),
        ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
    });

    it('preserves zero as a safe integer without synthesizing timestamp state', () => {
        const [result] = normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({
                algoId: 0,
                createTime: 0,
                updateTime: 0,
                triggerTime: 0,
                goodTillDate: 0,
            }),
        ], 'BTCUSDT');

        expect(result).toMatchObject({
            algoId: 0,
            createTime: 0,
            updateTime: 0,
            triggerTime: 0,
            goodTillDate: 0,
        });
    });

    it.each(['closePosition', 'priceProtect', 'reduceOnly'])(
        'rejects a non-boolean flag in %s',
        (field) => {
            expect(() => normalizeFuturesAlgoOpenOrders([
                makeAlgoOpenOrder({ [field]: 'false' }),
            ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
                FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
                'Malformed futures algo-open-orders response',
            ));
        },
    );

    it('preserves true boolean flags without coercion', () => {
        const [result] = normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder({
                closePosition: true,
                priceProtect: true,
                reduceOnly: true,
            }),
        ], 'BTCUSDT');

        expect(result.closePosition).toBe(true);
        expect(result.priceProtect).toBe(true);
        expect(result.reduceOnly).toBe(true);
    });

    it.each([
        ['algoId', {
            algoId: 2148627,
            clientAlgoId: 'different-client-algo-id',
        }],
        ['clientAlgoId', {
            algoId: 2148628,
            clientAlgoId: 'current-algo-order-000001',
        }],
    ])('rejects duplicate %s identities', (_identity, duplicateOverrides) => {
        expect(() => normalizeFuturesAlgoOpenOrders([
            makeAlgoOpenOrder(),
            makeAlgoOpenOrder(duplicateOverrides),
        ], 'BTCUSDT')).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
    });

    it('preserves source immutability and returns fresh algo-order objects', () => {
        const source = [
            makeAlgoOpenOrder({ ignoredField: 'not-normalized' }),
            makeAlgoOpenOrder({
                algoId: 2148628,
                clientAlgoId: 'current-algo-order-000002',
            }),
        ];
        const snapshot = structuredClone(source);

        const result = normalizeFuturesAlgoOpenOrders(source, 'BTCUSDT');
        const secondResult = normalizeFuturesAlgoOpenOrders(source, 'BTCUSDT');

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source);
        expect(result[0]).not.toBe(source[0]);
        expect(result[1]).not.toBe(source[1]);
        expect(result[0]).not.toBe(result[1]);
        expect(result[0]).not.toBe(secondResult[0]);
        expect(result[0]).not.toHaveProperty('ignoredField');
    });

    it('keeps regular and algo open-order contracts strictly separate', () => {
        const [regularOrder] = normalizeFuturesOpenOrders([makeOpenOrder({
            algoId: 2148627,
            clientAlgoId: 'must-not-cross-into-regular-orders',
            icebergQuantity: null,
        })], 'BTCUSDT');
        const [algoOrder] = normalizeFuturesAlgoOpenOrders([makeAlgoOpenOrder({
            orderId: 1917641,
            clientOrderId: 'must-not-cross-into-algo-orders',
            avgPrice: '0.00000',
            activatePrice: '9020.00000000',
            priceRate: '0.3000',
            callbackRate: '0.3000',
        })], 'BTCUSDT');

        expect(regularOrder).not.toHaveProperty('algoId');
        expect(regularOrder).not.toHaveProperty('clientAlgoId');
        expect(regularOrder).not.toHaveProperty('icebergQuantity');
        expect(algoOrder).not.toHaveProperty('orderId');
        expect(algoOrder).not.toHaveProperty('clientOrderId');
        expect(algoOrder).not.toHaveProperty('avgPrice');
        expect(algoOrder).not.toHaveProperty('activatePrice');
        expect(algoOrder).not.toHaveProperty('priceRate');
        expect(algoOrder).not.toHaveProperty('callbackRate');
    });

    it('keeps all six completed futures read-only contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toEqual({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            contractType: 'PERPETUAL',
            status: 'TRADING',
            assets: { base: 'BTC', quote: 'USDT', margin: 'USDT' },
            filters: expectedFilters,
            supportedOrderTypes: ['LIMIT', 'MARKET', 'STOP'],
            supportedTimeInForce: ['GTC', 'IOC', 'FOK', 'GTX'],
        });
        expect(normalizeFuturesMarkPrice(premiumIndex, 'BTCUSDT')).toEqual(
            expectedMarkPrice,
        );
        expect(normalizeFuturesFundingState(premiumIndex, 'BTCUSDT')).toEqual(
            expectedFundingState,
        );
        expect(normalizeFuturesPositionRisk(
            [makePositionRisk()],
            'BTCUSDT',
            'BOTH',
        )).toEqual(expectedPositionRisk);
        expect(normalizeFuturesAccountBalance(
            [makeAccountBalance()],
            'USDT',
        )).toEqual(expectedAccountBalance);
        expect(normalizeFuturesOpenOrders(
            [makeOpenOrder()],
            'BTCUSDT',
        )).toEqual([expectedOpenOrder]);
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

    it('loads and unwraps V3 position risk at the adapter boundary', async () => {
        const data = vi.fn().mockResolvedValue([makePositionRisk()]);
        const transport = {
            getPositionRiskV3: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getPositionRisk('BTCUSDT', 'BOTH')).resolves.toEqual(
            expectedPositionRisk,
        );
        expect(transport.getPositionRiskV3).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
        });
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw V3 hedge positions from the injected read-only transport', async () => {
        const transport = {
            getPositionRiskV3: vi.fn().mockResolvedValue([
                makePositionRisk({ positionSide: 'LONG' }),
                makePositionRisk({
                    positionSide: 'SHORT',
                    positionAmt: '-10.000',
                }),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getPositionRisk('BTCUSDT', 'SHORT')).resolves.toEqual({
            ...expectedPositionRisk,
            positionSide: 'SHORT',
            positionAmt: '-10.000',
        });
    });

    it('loads and unwraps V3 account balances at the adapter boundary', async () => {
        const data = vi.fn().mockResolvedValue([makeAccountBalance()]);
        const transport = {
            getBalanceV3: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountBalance('USDT')).resolves.toEqual(
            expectedAccountBalance,
        );
        expect(transport.getBalanceV3).toHaveBeenCalledWith();
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw V3 multi-asset balances from the injected read-only transport', async () => {
        const transport = {
            getBalanceV3: vi.fn().mockResolvedValue([
                makeAccountBalance({ asset: 'USDC' }),
                makeAccountBalance(),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountBalance('USDT')).resolves.toEqual(
            expectedAccountBalance,
        );
    });

    it('loads symbol-scoped current open orders from an official-client-style body', async () => {
        const data = vi.fn().mockResolvedValue([makeOpenOrder()]);
        const transport = {
            getOpenOrders: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedOpenOrder,
        ]);
        expect(transport.getOpenOrders.mock.calls).toEqual([
            [{ symbol: 'BTCUSDT' }],
        ]);
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw current-open-orders arrays from the read-only transport', async () => {
        const transport = {
            getOpenOrders: vi.fn().mockResolvedValue([
                makeOpenOrder({
                    orderId: 1917642,
                    clientOrderId: 'current-order-000002',
                }),
                makeOpenOrder(),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([
            {
                ...expectedOpenOrder,
                orderId: 1917642,
                clientOrderId: 'current-order-000002',
            },
            expectedOpenOrder,
        ]);
        expect(transport.getOpenOrders).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
    });

    it('accepts a raw empty current-open-orders array', async () => {
        const transport = {
            getOpenOrders: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([]);
        expect(transport.getOpenOrders).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid open-orders symbol %# before invoking the transport',
        async (symbol) => {
            const transport = {
                getOpenOrders: vi.fn(),
            };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getOpenOrders(symbol)).rejects.toThrowError(
                new FuturesOpenOrdersError(
                    FUTURES_OPEN_ORDERS_ERROR_CODES.INVALID_SYMBOL,
                    'Futures symbol must be a non-empty string',
                ),
            );
            expect(transport.getOpenOrders).not.toHaveBeenCalled();
        },
    );

    it('preserves current-open-orders transport error identity', async () => {
        const transportError = new Error('futures open-orders transport unavailable');
        const transport = {
            getOpenOrders: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOpenOrders('BTCUSDT')).rejects.toBe(transportError);
        expect(transport.getOpenOrders).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
    });

    it('preserves current-open-orders response-body error identity', async () => {
        const responseError = new Error('futures open-orders response body unavailable');
        const data = vi.fn().mockRejectedValue(responseError);
        const transport = {
            getOpenOrders: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOpenOrders('BTCUSDT')).rejects.toBe(responseError);
        expect(transport.getOpenOrders).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
        expect(data).toHaveBeenCalledWith();
    });

    it('loads symbol-scoped current algo open orders from an official-client-style body', async () => {
        const data = vi.fn().mockResolvedValue([makeAlgoOpenOrder()]);
        const transport = {
            getOpenAlgoOrders: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedAlgoOpenOrder,
        ]);
        expect(transport.getOpenAlgoOrders.mock.calls).toEqual([
            [{ symbol: 'BTCUSDT' }],
        ]);
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw current-algo-open-orders arrays from the read-only transport', async () => {
        const transport = {
            getOpenAlgoOrders: vi.fn().mockResolvedValue([
                makeAlgoOpenOrder({
                    algoId: 2148628,
                    clientAlgoId: 'current-algo-order-000002',
                }),
                makeAlgoOpenOrder(),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([
            {
                ...expectedAlgoOpenOrder,
                algoId: 2148628,
                clientAlgoId: 'current-algo-order-000002',
            },
            expectedAlgoOpenOrder,
        ]);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
        });
    });

    it('accepts a raw empty current-algo-open-orders array', async () => {
        const transport = {
            getOpenAlgoOrders: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([]);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
        });
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid algo-open-orders symbol %# before invoking the transport',
        async (symbol) => {
            const transport = {
                getOpenAlgoOrders: vi.fn(),
            };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getAlgoOpenOrders(symbol)).rejects.toThrowError(
                new FuturesAlgoOpenOrdersError(
                    FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.INVALID_SYMBOL,
                    'Futures symbol must be a non-empty string',
                ),
            );
            expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
        },
    );

    it('preserves current-algo-open-orders transport error identity', async () => {
        const transportError = new Error(
            'futures algo-open-orders transport unavailable',
        );
        const transport = {
            getOpenAlgoOrders: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).rejects.toBe(
            transportError,
        );
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
        });
    });

    it('preserves current-algo-open-orders response-body error identity', async () => {
        const responseError = new Error(
            'futures algo-open-orders response body unavailable',
        );
        const data = vi.fn().mockRejectedValue(responseError);
        const transport = {
            getOpenAlgoOrders: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).rejects.toBe(
            responseError,
        );
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
        });
        expect(data).toHaveBeenCalledWith();
    });

    it('keeps regular and algo open-order transports independent', async () => {
        const transport = {
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedOpenOrder,
        ]);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();

        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedAlgoOpenOrder,
        ]);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledWith({
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

    it('preserves position-risk transport error identity', async () => {
        const transportError = new Error('futures position-risk transport unavailable');
        const transport = {
            getPositionRiskV3: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getPositionRisk('BTCUSDT', 'BOTH')).rejects.toBe(
            transportError,
        );
    });

    it('preserves position-risk response-body error identity', async () => {
        const responseError = new Error('futures position-risk response body unavailable');
        const transport = {
            getPositionRiskV3: vi.fn().mockResolvedValue({
                data: vi.fn().mockRejectedValue(responseError),
            }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getPositionRisk('BTCUSDT', 'BOTH')).rejects.toBe(
            responseError,
        );
    });

    it('preserves account-balance transport error identity', async () => {
        const transportError = new Error('futures account-balance transport unavailable');
        const transport = {
            getBalanceV3: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountBalance('USDT')).rejects.toBe(transportError);
    });

    it('preserves account-balance response-body error identity', async () => {
        const responseError = new Error('futures account-balance response body unavailable');
        const transport = {
            getBalanceV3: vi.fn().mockResolvedValue({
                data: vi.fn().mockRejectedValue(responseError),
            }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountBalance('USDT')).rejects.toBe(responseError);
    });

    it('exposes no futures execution surface', () => {
        const adapter = new FuturesTradingAdapter({ transport: {} });
        expect(Object.getOwnPropertyNames(FuturesTradingAdapter.prototype)).toEqual([
            'constructor',
            'getExchangeInfo',
            'getMarkPrice',
            'getFundingState',
            'getPositionRisk',
            'getAccountBalance',
            'getOpenOrders',
            'getAlgoOpenOrders',
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
