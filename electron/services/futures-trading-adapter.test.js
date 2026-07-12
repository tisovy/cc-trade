import { describe, expect, it, vi } from 'vitest';
import {
    FUTURES_ACCOUNT_BALANCE_ERROR_CODES,
    FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES,
    FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES,
    FUTURES_ALGO_ORDER_ERROR_CODES,
    FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES,
    FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES,
    FUTURES_EXCHANGE_INFO_ERROR_CODES,
    FUTURES_FUNDING_STATE_ERROR_CODES,
    FUTURES_INCOME_HISTORY_ERROR_CODES,
    FUTURES_MARK_PRICE_ERROR_CODES,
    FUTURES_OPEN_ORDERS_ERROR_CODES,
    FUTURES_ORDER_HISTORY_ERROR_CODES,
    FUTURES_ORDER_ERROR_CODES,
    FUTURES_POSITION_RISK_ERROR_CODES,
    FuturesAccountBalanceError,
    FuturesAccountTradeHistoryError,
    FuturesAlgoOrderHistoryError,
    FuturesAlgoOrderError,
    FuturesAlgoOpenOrdersError,
    FuturesCurrentOpenOrderError,
    FuturesExchangeInfoError,
    FuturesFundingStateError,
    FuturesIncomeHistoryError,
    FuturesMarkPriceError,
    FuturesOpenOrdersError,
    FuturesOrderHistoryError,
    FuturesOrderError,
    FuturesPositionRiskError,
    FuturesTradingAdapter,
    normalizeFuturesAccountBalance,
    normalizeFuturesAccountTradeHistory,
    normalizeFuturesAlgoOrderHistory,
    normalizeFuturesAlgoOrder,
    normalizeFuturesAlgoOpenOrders,
    normalizeFuturesCurrentOpenOrder,
    normalizeFuturesExchangeInfo,
    normalizeFuturesFundingState,
    normalizeFuturesIncomeHistory,
    normalizeFuturesMarkPrice,
    normalizeFuturesOpenOrders,
    normalizeFuturesOrderHistory,
    normalizeFuturesOrder,
    normalizeFuturesPositionRisk,
    normalizeFuturesPositionRisks,
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

describe('normalizeFuturesPositionRisks', () => {
    it('preserves a valid empty symbol-scoped V3 snapshot without synthesizing a position', () => {
        expect(normalizeFuturesPositionRisks([], 'BTCUSDT')).toEqual([]);
        expect(normalizeFuturesPositionRisks([], 'BTCUSDT')).not.toBe(
            normalizeFuturesPositionRisks([], 'BTCUSDT'),
        );
    });

    it('returns one detached one-way position with exact decimal strings', () => {
        const source = [makePositionRisk({
            positionAmt: '0.000',
            unRealizedProfit: '-0.00000000',
            liquidationPrice: '0',
        })];

        const result = normalizeFuturesPositionRisks(source, 'BTCUSDT');

        expect(result).toEqual([{
            ...expectedPositionRisk,
            positionAmt: '0.000',
            unRealizedProfit: '-0.00000000',
            liquidationPrice: '0',
        }]);
        expect(result[0]).not.toBe(source[0]);
    });

    it('preserves both source-ordered hedge legs and positive/negative PnL', () => {
        const longPosition = makePositionRisk({
            positionSide: 'LONG',
            positionAmt: '1.250',
            unRealizedProfit: '12.34000000',
            liquidationPrice: '25000.00000000',
        });
        const shortPosition = makePositionRisk({
            positionSide: 'SHORT',
            positionAmt: '-0.750',
            unRealizedProfit: '-3.21000000',
            liquidationPrice: '78000.00000000',
        });

        const result = normalizeFuturesPositionRisks(
            [longPosition, shortPosition],
            'BTCUSDT',
        );

        expect(result.map(({ positionSide }) => positionSide)).toEqual(['LONG', 'SHORT']);
        expect(result.map(({ unRealizedProfit }) => unRealizedProfit)).toEqual([
            '12.34000000',
            '-3.21000000',
        ]);
    });

    it('rejects mixed symbols, duplicate identities, and mixed position modes', () => {
        const malformedResponses = [
            [makePositionRisk(), makePositionRisk({ symbol: 'ETHUSDT' })],
            [makePositionRisk(), makePositionRisk()],
            [makePositionRisk(), makePositionRisk({ positionSide: 'LONG' })],
        ];

        malformedResponses.forEach((response) => {
            try {
                normalizeFuturesPositionRisks(response, 'BTCUSDT');
                throw new Error('Expected position-risk normalization to fail');
            } catch (error) {
                expect(error).toBeInstanceOf(FuturesPositionRiskError);
                expect(error.code).toBe(
                    FUTURES_POSITION_RISK_ERROR_CODES.MALFORMED_RESPONSE,
                );
            }
        });
    });

    it('retains the unavailable-symbol identity for an all-wrong-symbol response', () => {
        expect(() => normalizeFuturesPositionRisks(
            [makePositionRisk({ symbol: 'ETHUSDT' })],
            'BTCUSDT',
        )).toThrowError(new FuturesPositionRiskError(
            FUTURES_POSITION_RISK_ERROR_CODES.SYMBOL_UNAVAILABLE,
            'Futures symbol "BTCUSDT" is unavailable in position-risk response',
        ));
    });
});

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

const makeAlgoOrderQuery = (overrides = {}) => ({
    algoId: 2146760,
    clientAlgoId: 'queried-algo-order-000001',
    algoType: 'CONDITIONAL',
    orderType: 'TAKE_PROFIT',
    symbol: 'BTCUSDT',
    side: 'SELL',
    positionSide: 'BOTH',
    timeInForce: 'GTC',
    quantity: '0.010000',
    algoStatus: 'CANCELED',
    actualOrderId: '',
    actualPrice: '0.00000',
    actualType: 'LIMIT',
    actualQty: '0.010000',
    triggerPrice: '750.000',
    price: '750.000',
    icebergQuantity: null,
    tpOrderType: '',
    selfTradePreventionMode: 'EXPIRE_MAKER',
    workingType: 'CONTRACT_PRICE',
    priceMatch: 'NONE',
    closePosition: false,
    priceProtect: false,
    reduceOnly: false,
    createTime: 1750485492076,
    updateTime: 1750514545091,
    triggerTime: 0,
    goodTillDate: 0,
    ...overrides,
});

const expectedAlgoOrderQuery = {
    marketType: 'futures',
    algoId: 2146760,
    clientAlgoId: 'queried-algo-order-000001',
    algoType: 'CONDITIONAL',
    orderType: 'TAKE_PROFIT',
    symbol: 'BTCUSDT',
    side: 'SELL',
    positionSide: 'BOTH',
    timeInForce: 'GTC',
    quantity: '0.010000',
    algoStatus: 'CANCELED',
    actualOrderId: '',
    actualPrice: '0.00000',
    actualType: 'LIMIT',
    actualQty: '0.010000',
    triggerPrice: '750.000',
    price: '750.000',
    icebergQuantity: null,
    tpOrderType: '',
    selfTradePreventionMode: 'EXPIRE_MAKER',
    workingType: 'CONTRACT_PRICE',
    priceMatch: 'NONE',
    closePosition: false,
    priceProtect: false,
    reduceOnly: false,
    createTime: 1750485492076,
    updateTime: 1750514545091,
    triggerTime: 0,
    goodTillDate: 0,
};

const makeOrderQuery = (overrides = {}) => ({
    avgPrice: '0.00000',
    clientOrderId: 'queried-order-000001',
    cumQuote: '0',
    executedQty: '0',
    orderId: 1917643,
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

const expectedOrderQuery = {
    marketType: 'futures',
    avgPrice: '0.00000',
    clientOrderId: 'queried-order-000001',
    cumQuote: '0',
    executedQty: '0',
    orderId: 1917643,
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

const makeCurrentOpenOrderQuery = (overrides = {}) => ({
    avgPrice: '0.00000',
    clientOrderId: 'current-open-order-000001',
    cumQuote: '0',
    executedQty: '0',
    orderId: 1917645,
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

const expectedCurrentOpenOrderQuery = {
    marketType: 'futures',
    avgPrice: '0.00000',
    clientOrderId: 'current-open-order-000001',
    cumQuote: '0',
    executedQty: '0',
    orderId: 1917645,
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

const makeOrderHistoryEntry = (overrides = {}) => ({
    avgPrice: '9312.34000000',
    clientOrderId: 'historical-order-000001',
    cumQuote: '3724.93600000',
    executedQty: '0.40',
    orderId: 1917647,
    origQty: '0.40',
    origType: 'TRAILING_STOP_MARKET',
    price: '0',
    reduceOnly: false,
    side: 'BUY',
    positionSide: 'SHORT',
    status: 'FILLED',
    stopPrice: '9300.00000000',
    closePosition: false,
    symbol: 'BTCUSDT',
    time: 1579276756075,
    timeInForce: 'GTC',
    type: 'TRAILING_STOP_MARKET',
    activatePrice: '9020.00000000',
    priceRate: '0.3000',
    updateTime: 1579276756123,
    workingType: 'CONTRACT_PRICE',
    priceProtect: false,
    priceMatch: 'NONE',
    selfTradePreventionMode: 'EXPIRE_MAKER',
    goodTillDate: 0,
    ...overrides,
});

const expectedOrderHistoryEntry = {
    marketType: 'futures',
    avgPrice: '9312.34000000',
    clientOrderId: 'historical-order-000001',
    cumQuote: '3724.93600000',
    executedQty: '0.40',
    orderId: 1917647,
    origQty: '0.40',
    origType: 'TRAILING_STOP_MARKET',
    price: '0',
    reduceOnly: false,
    side: 'BUY',
    positionSide: 'SHORT',
    status: 'FILLED',
    stopPrice: '9300.00000000',
    closePosition: false,
    symbol: 'BTCUSDT',
    time: 1579276756075,
    timeInForce: 'GTC',
    type: 'TRAILING_STOP_MARKET',
    activatePrice: '9020.00000000',
    priceRate: '0.3000',
    updateTime: 1579276756123,
    workingType: 'CONTRACT_PRICE',
    priceProtect: false,
    priceMatch: 'NONE',
    selfTradePreventionMode: 'EXPIRE_MAKER',
    goodTillDate: 0,
};

const makeAlgoOrderHistoryEntry = (overrides = {}) => ({
    algoId: 2146760,
    clientAlgoId: 'historical-algo-order-000001',
    algoType: 'CONDITIONAL',
    orderType: 'TAKE_PROFIT',
    symbol: 'BTCUSDT',
    side: 'SELL',
    positionSide: 'BOTH',
    timeInForce: 'GTC',
    quantity: '0.010000',
    algoStatus: 'CANCELED',
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
    createTime: 1750485492076,
    updateTime: 1750514545091,
    triggerTime: 0,
    goodTillDate: 0,
    ...overrides,
});

const expectedAlgoOrderHistoryEntry = {
    marketType: 'futures',
    algoId: 2146760,
    clientAlgoId: 'historical-algo-order-000001',
    algoType: 'CONDITIONAL',
    orderType: 'TAKE_PROFIT',
    symbol: 'BTCUSDT',
    side: 'SELL',
    positionSide: 'BOTH',
    timeInForce: 'GTC',
    quantity: '0.010000',
    algoStatus: 'CANCELED',
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
    createTime: 1750485492076,
    updateTime: 1750514545091,
    triggerTime: 0,
    goodTillDate: 0,
};

const makeAccountTradeHistoryEntry = (overrides = {}) => ({
    buyer: false,
    commission: '0.07819010',
    commissionAsset: 'USDT',
    id: 698759,
    maker: false,
    orderId: 25851813,
    price: '7819.01000000',
    qty: '0.002000',
    quoteQty: '15.63802000',
    realizedPnl: '-0.91539999',
    side: 'SELL',
    positionSide: 'SHORT',
    symbol: 'BTCUSDT',
    time: 1569514978020,
    ...overrides,
});

const expectedAccountTradeHistoryEntry = {
    marketType: 'futures',
    buyer: false,
    commission: '0.07819010',
    commissionAsset: 'USDT',
    id: 698759,
    maker: false,
    orderId: 25851813,
    price: '7819.01000000',
    qty: '0.002000',
    quoteQty: '15.63802000',
    realizedPnl: '-0.91539999',
    side: 'SELL',
    positionSide: 'SHORT',
    symbol: 'BTCUSDT',
    time: 1569514978020,
};

const makeIncomeHistoryEntry = (overrides = {}) => ({
    symbol: 'BTCUSDT',
    incomeType: 'COMMISSION',
    income: '-0.01000000',
    asset: 'USDT',
    info: 'COMMISSION',
    time: 1570636800000,
    tranId: 9689322392,
    tradeId: '2059192',
    ...overrides,
});

const expectedIncomeHistoryEntry = {
    marketType: 'futures',
    symbol: 'BTCUSDT',
    incomeType: 'COMMISSION',
    income: '-0.01000000',
    asset: 'USDT',
    info: 'COMMISSION',
    time: 1570636800000,
    tranId: 9689322392,
    tradeId: '2059192',
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

describe('normalizeFuturesAlgoOrder', () => {
    const malformedError = () => new FuturesAlgoOrderError(
        FUTURES_ALGO_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
        'Malformed futures algo-order response',
    );
    const invalidLookupError = () => new FuturesAlgoOrderError(
        FUTURES_ALGO_ORDER_ERROR_CODES.INVALID_LOOKUP_IDENTITY,
        'Futures algo-order lookup must contain exactly one safe-integer algoId or non-empty clientAlgoId',
    );

    it('normalizes the official single-object algo-order query contract exactly', () => {
        const result = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760 },
        );

        expect(result).toEqual(expectedAlgoOrderQuery);
        [
            ['quantity', '0.010000'],
            ['actualPrice', '0.00000'],
            ['actualQty', '0.010000'],
            ['triggerPrice', '750.000'],
            ['price', '750.000'],
        ].forEach(([field, expectedValue]) => {
            expect(result[field]).toBe(expectedValue);
            expect(typeof result[field]).toBe('string');
        });
        expect(result.actualOrderId).toBe('');
        expect(result.tpOrderType).toBe('');
        expect(result.icebergQuantity).toBeNull();
        expect(result.closePosition).toBe(false);
        expect(result.priceProtect).toBe(false);
        expect(result.reduceOnly).toBe(false);
    });

    it('supports exact clientAlgoId lookup without converting either identifier', () => {
        const result = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            { clientAlgoId: 'queried-algo-order-000001' },
        );

        expect(result).toEqual(expectedAlgoOrderQuery);
        expect(result.algoId).toBe(2146760);
        expect(result.clientAlgoId).toBe('queried-algo-order-000001');
    });

    it('preserves exact lookup identity text without canonicalization', () => {
        const clientAlgoId = 'Query-Algo-000001';
        const result = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({ clientAlgoId }),
            'BTCUSDT',
            { clientAlgoId },
        );

        expect(result.clientAlgoId).toBe(clientAlgoId);
    });

    it.each([
        ['a different response symbol', 'ETHUSDT', 'BTCUSDT'],
        ['a case-mismatched response symbol', 'btcusdt', 'BTCUSDT'],
        ['a case-mismatched expected symbol', 'BTCUSDT', 'btcusdt'],
    ])('rejects %s with the established unavailable-symbol identity', (
        _label,
        responseSymbol,
        expectedSymbol,
    ) => {
        expect(() => normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({ symbol: responseSymbol }),
            expectedSymbol,
            { algoId: 2146760 },
        )).toThrowError(new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${expectedSymbol}" is unavailable in algo-order response`,
        ));
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid expected symbol %# before parsing the response',
        (expectedSymbol) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery(),
                expectedSymbol,
                { algoId: 2146760 },
            )).toThrowError(new FuturesAlgoOrderError(
                FUTURES_ALGO_ORDER_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
        },
    );

    it.each([undefined, null, 1, 'client-id', [], () => ({})])(
        'rejects non-object lookup identity %#',
        (lookupIdentity) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery(),
                'BTCUSDT',
                lookupIdentity,
            )).toThrowError(invalidLookupError());
        },
    );

    it.each([
        ['neither identity', {}],
        ['both identities', {
            algoId: 2146760,
            clientAlgoId: 'queried-algo-order-000001',
        }],
        ['both identities explicitly undefined', {
            algoId: undefined,
            clientAlgoId: undefined,
        }],
        ['a valid algoId plus an invalid clientAlgoId', {
            algoId: 2146760,
            clientAlgoId: '',
        }],
        ['an invalid algoId plus a valid clientAlgoId', {
            algoId: null,
            clientAlgoId: 'queried-algo-order-000001',
        }],
    ])('requires exactly one lookup identity for %s', (_label, lookupIdentity) => {
        expect(() => normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            lookupIdentity,
        )).toThrowError(invalidLookupError());
    });

    it.each([null, '2146760', -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
        'rejects invalid algoId lookup value %#',
        (algoId) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery(),
                'BTCUSDT',
                { algoId },
            )).toThrowError(invalidLookupError());
        },
    );

    it.each([null, 2146760, '', '   ', false, {}])(
        'rejects invalid clientAlgoId lookup value %#',
        (clientAlgoId) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery(),
                'BTCUSDT',
                { clientAlgoId },
            )).toThrowError(invalidLookupError());
        },
    );

    it('treats an explicitly undefined alternate client identity as absent', () => {
        expect(normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760, clientAlgoId: undefined },
        )).toEqual(expectedAlgoOrderQuery);
    });

    it('treats an explicitly undefined alternate numeric identity as absent', () => {
        expect(normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            {
                algoId: undefined,
                clientAlgoId: 'queried-algo-order-000001',
            },
        )).toEqual(expectedAlgoOrderQuery);
    });

    it.each([
        ['algoId', makeAlgoOrderQuery({ algoId: 2146761 }), { algoId: 2146760 }],
        ['clientAlgoId', makeAlgoOrderQuery({
            clientAlgoId: 'different-query-identity',
        }), { clientAlgoId: 'queried-algo-order-000001' }],
    ])('rejects a response whose %s disagrees with the lookup identity', (
        _field,
        response,
        lookupIdentity,
    ) => {
        expect(() => normalizeFuturesAlgoOrder(
            response,
            'BTCUSDT',
            lookupIdentity,
        )).toThrowError(new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.LOOKUP_IDENTITY_MISMATCH,
            'Futures algo-order response does not match the requested lookup identity',
        ));
    });

    it.each([
        ['an undefined payload', undefined],
        ['a null payload', null],
        ['the current-open-algo array shape', [makeAlgoOrderQuery()]],
        ['an empty array', []],
        ['a string payload', 'BTCUSDT'],
        ['a numeric payload', 2146760],
    ])('rejects %s because the query contract is one object', (_label, payload) => {
        expect(() => normalizeFuturesAlgoOrder(
            payload,
            'BTCUSDT',
            { algoId: 2146760 },
        )).toThrowError(malformedError());
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects malformed response symbol identity %#',
        (symbol) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery({ symbol }),
                'BTCUSDT',
                { algoId: 2146760 },
            )).toThrowError(malformedError());
        },
    );

    it.each([undefined, null, '2146760', -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects malformed response algoId identity %#',
        (algoId) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery({ algoId }),
                'BTCUSDT',
                { clientAlgoId: 'queried-algo-order-000001' },
            )).toThrowError(malformedError());
        },
    );

    it.each([undefined, null, 2146760, '', '   '])(
        'rejects malformed response clientAlgoId identity %#',
        (clientAlgoId) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery({ clientAlgoId }),
                'BTCUSDT',
                { algoId: 2146760 },
            )).toThrowError(malformedError());
        },
    );

    it.each(['quantity', 'actualPrice', 'triggerPrice', 'price'])(
        'rejects a non-string required query decimal in %s',
        (field) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery({ [field]: 0 }),
                'BTCUSDT',
                { algoId: 2146760 },
            )).toThrowError(malformedError());
        },
    );

    it.each(['quantity', 'actualPrice', 'triggerPrice', 'price'])(
        'rejects a blank required query decimal in %s',
        (field) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery({ [field]: '   ' }),
                'BTCUSDT',
                { algoId: 2146760 },
            )).toThrowError(malformedError());
        },
    );

    it.each([
        'algoType',
        'orderType',
        'side',
        'positionSide',
        'timeInForce',
        'algoStatus',
        'selfTradePreventionMode',
        'workingType',
        'priceMatch',
    ])('rejects a blank required query string in %s', (field) => {
        expect(() => normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({ [field]: '   ' }),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toThrowError(malformedError());
    });

    it.each([
        'algoId',
        'clientAlgoId',
        'symbol',
        'algoType',
        'quantity',
        'actualOrderId',
        'actualPrice',
        'triggerPrice',
        'price',
        'icebergQuantity',
        'tpOrderType',
        'closePosition',
        'createTime',
        'goodTillDate',
    ])('rejects a missing required query field %s', (field) => {
        const source = makeAlgoOrderQuery();
        delete source[field];

        expect(() => normalizeFuturesAlgoOrder(
            source,
            'BTCUSDT',
            field === 'algoId'
                ? { clientAlgoId: 'queried-algo-order-000001' }
                : { algoId: 2146760 },
        )).toThrowError(malformedError());
    });

    it('preserves documented empty-string-capable fields without inventing nulls', () => {
        const result = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760 },
        );

        expect(result.actualOrderId).toBe('');
        expect(result.tpOrderType).toBe('');
        expect(result.actualOrderId).not.toBeNull();
        expect(result.tpOrderType).not.toBeNull();
    });

    it('preserves populated actual-order and take-profit-order strings exactly', () => {
        const result = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({
                actualOrderId: '00192837465',
                tpOrderType: 'TAKE_PROFIT_MARKET',
            }),
            'BTCUSDT',
            { algoId: 2146760 },
        );

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
        expect(() => normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({ [field]: value }),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toThrowError(malformedError());
    });

    it('preserves each documented iceberg-quantity representation exactly', () => {
        const nullableResult = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({ icebergQuantity: null }),
            'BTCUSDT',
            { algoId: 2146760 },
        );
        const decimalResult = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({ icebergQuantity: '0.00010000' }),
            'BTCUSDT',
            { algoId: 2146760 },
        );
        const literalNullResult = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({ icebergQuantity: 'null' }),
            'BTCUSDT',
            { algoId: 2146760 },
        );

        expect(nullableResult.icebergQuantity).toBeNull();
        expect(decimalResult.icebergQuantity).toBe('0.00010000');
        expect(literalNullResult.icebergQuantity).toBe('null');
    });

    it.each([undefined, 0, false, '', '   '])(
        'rejects undocumented iceberg-quantity value %#',
        (icebergQuantity) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery({ icebergQuantity }),
                'BTCUSDT',
                { algoId: 2146760 },
            )).toThrowError(malformedError());
        },
    );

    it('preserves actualType and actualQty only when the response supplies them', () => {
        const source = makeAlgoOrderQuery();
        delete source.actualType;
        delete source.actualQty;

        const result = normalizeFuturesAlgoOrder(
            source,
            'BTCUSDT',
            { algoId: 2146760 },
        );

        expect(result).not.toHaveProperty('actualType');
        expect(result).not.toHaveProperty('actualQty');
    });

    it('keeps conditionally present actual fields independent without inference', () => {
        const withoutActualQty = makeAlgoOrderQuery();
        delete withoutActualQty.actualQty;
        const withoutActualType = makeAlgoOrderQuery();
        delete withoutActualType.actualType;

        const typeOnly = normalizeFuturesAlgoOrder(
            withoutActualQty,
            'BTCUSDT',
            { algoId: 2146760 },
        );
        const quantityOnly = normalizeFuturesAlgoOrder(
            withoutActualType,
            'BTCUSDT',
            { algoId: 2146760 },
        );

        expect(typeOnly.actualType).toBe('LIMIT');
        expect(typeOnly).not.toHaveProperty('actualQty');
        expect(quantityOnly.actualQty).toBe('0.010000');
        expect(quantityOnly).not.toHaveProperty('actualType');
    });

    it('treats explicit undefined conditional values as absent response fields', () => {
        const result = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({ actualType: undefined, actualQty: undefined }),
            'BTCUSDT',
            { algoId: 2146760 },
        );

        expect(result).not.toHaveProperty('actualType');
        expect(result).not.toHaveProperty('actualQty');
    });

    it.each([
        ['actualType', null],
        ['actualType', 0],
        ['actualType', ''],
        ['actualType', '   '],
        ['actualQty', null],
        ['actualQty', 0],
        ['actualQty', ''],
        ['actualQty', '   '],
    ])('rejects malformed conditional %s value %#', (field, value) => {
        expect(() => normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({ [field]: value }),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toThrowError(malformedError());
    });

    it.each(['createTime', 'updateTime', 'triggerTime', 'goodTillDate'])(
        'rejects a non-integer timestamp in %s',
        (field) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery({ [field]: '0' }),
                'BTCUSDT',
                { algoId: 2146760 },
            )).toThrowError(malformedError());
        },
    );

    it.each([
        ['a negative integer', -1],
        ['a fractional number', 1.5],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects %s for a query timestamp', (_label, updateTime) => {
        expect(() => normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({ updateTime }),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toThrowError(malformedError());
    });

    it('preserves zero identifiers and timestamps without synthesizing state', () => {
        const result = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({
                algoId: 0,
                createTime: 0,
                updateTime: 0,
                triggerTime: 0,
                goodTillDate: 0,
            }),
            'BTCUSDT',
            { algoId: 0 },
        );

        expect(result).toMatchObject({
            algoId: 0,
            createTime: 0,
            updateTime: 0,
            triggerTime: 0,
            goodTillDate: 0,
        });
    });

    it.each(['closePosition', 'priceProtect', 'reduceOnly'])(
        'rejects a non-boolean query flag in %s',
        (field) => {
            expect(() => normalizeFuturesAlgoOrder(
                makeAlgoOrderQuery({ [field]: 'false' }),
                'BTCUSDT',
                { algoId: 2146760 },
            )).toThrowError(malformedError());
        },
    );

    it('preserves true query flags without coercion', () => {
        const result = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({
                closePosition: true,
                priceProtect: true,
                reduceOnly: true,
            }),
            'BTCUSDT',
            { algoId: 2146760 },
        );

        expect(result.closePosition).toBe(true);
        expect(result.priceProtect).toBe(true);
        expect(result.reduceOnly).toBe(true);
    });

    it('preserves source immutability and returns a fresh queried-order object', () => {
        const source = makeAlgoOrderQuery({ ignoredField: 'not-normalized' });
        const snapshot = structuredClone(source);

        const result = normalizeFuturesAlgoOrder(
            source,
            'BTCUSDT',
            { algoId: 2146760 },
        );
        const secondResult = normalizeFuturesAlgoOrder(
            source,
            'BTCUSDT',
            { algoId: 2146760 },
        );

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source);
        expect(result).not.toBe(secondResult);
        expect(result).not.toHaveProperty('ignoredField');
    });

    it('excludes fields documented only by open-algo or other order contracts', () => {
        const result = normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery({
                tpTriggerPrice: '700.000',
                tpPrice: '700.000',
                slTriggerPrice: '800.000',
                slPrice: '800.000',
                activatePrice: '720.000',
                callbackRate: '0.3000',
                priceRate: '0.3000',
                orderId: 1917641,
                clientOrderId: 'regular-order-id',
            }),
            'BTCUSDT',
            { algoId: 2146760 },
        );

        [
            'tpTriggerPrice',
            'tpPrice',
            'slTriggerPrice',
            'slPrice',
            'activatePrice',
            'callbackRate',
            'priceRate',
            'orderId',
            'clientOrderId',
        ].forEach((field) => expect(result).not.toHaveProperty(field));
    });

    it('keeps single query, algo-open array, and regular-open array shapes separate', () => {
        expect(() => normalizeFuturesAlgoOrder(
            [makeAlgoOrderQuery()],
            'BTCUSDT',
            { algoId: 2146760 },
        )).toThrowError(malformedError());
        expect(() => normalizeFuturesAlgoOpenOrders(
            makeAlgoOrderQuery(),
            'BTCUSDT',
        )).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
        expect(() => normalizeFuturesOpenOrders(
            makeAlgoOrderQuery(),
            'BTCUSDT',
        )).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
    });

    it('keeps all seven completed futures read-only contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            filters: expectedFilters,
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
        expect(normalizeFuturesAlgoOpenOrders(
            [makeAlgoOpenOrder()],
            'BTCUSDT',
        )).toEqual([expectedAlgoOpenOrder]);
    });
});

describe('normalizeFuturesOrder', () => {
    const malformedError = () => new FuturesOrderError(
        FUTURES_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
        'Malformed futures order response',
    );
    const invalidLookupError = () => new FuturesOrderError(
        FUTURES_ORDER_ERROR_CODES.INVALID_LOOKUP_IDENTITY,
        'Futures order lookup must contain a safe-integer orderId or non-empty origClientOrderId',
    );

    it('normalizes the official single-object regular-order query contract exactly', () => {
        const result = normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            { orderId: 1917643 },
        );

        expect(result).toEqual(expectedOrderQuery);
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
            expect(result[field]).toBe(expectedValue);
            expect(typeof result[field]).toBe('string');
        });
        expect(result.orderId).toBe(1917643);
        expect(result.clientOrderId).toBe('queried-order-000001');
        expect(result.reduceOnly).toBe(false);
        expect(result.closePosition).toBe(false);
        expect(result.priceProtect).toBe(false);
    });

    it('supports exact origClientOrderId lookup against returned clientOrderId', () => {
        const result = normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            { origClientOrderId: 'queried-order-000001' },
        );

        expect(result).toEqual(expectedOrderQuery);
        expect(result.orderId).toBe(1917643);
        expect(result.clientOrderId).toBe('queried-order-000001');
    });

    it('uses presence-based orderId precedence when both valid identities are supplied', () => {
        const result = normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            {
                orderId: 1917643,
                origClientOrderId: 'different-client-id-is-not-the-selected-lookup',
            },
        );

        expect(result).toEqual(expectedOrderQuery);
    });

    it.each([null, 123, '', '   ', false, {}])(
        'lets valid orderId precedence ignore untransported origClientOrderId %#',
        (origClientOrderId) => {
            expect(normalizeFuturesOrder(
                makeOrderQuery(),
                'BTCUSDT',
                { orderId: 1917643, origClientOrderId },
            )).toEqual(expectedOrderQuery);
        },
    );

    it('preserves exact client lookup identity text without canonicalization', () => {
        const clientOrderId = 'Query-Regular-Order-000001';
        const result = normalizeFuturesOrder(
            makeOrderQuery({ clientOrderId }),
            'BTCUSDT',
            { origClientOrderId: clientOrderId },
        );

        expect(result.clientOrderId).toBe(clientOrderId);
    });

    it.each([
        ['a different response symbol', 'ETHUSDT', 'BTCUSDT'],
        ['a case-mismatched response symbol', 'btcusdt', 'BTCUSDT'],
        ['a case-mismatched requested symbol', 'BTCUSDT', 'btcusdt'],
    ])('rejects %s with the established unavailable-symbol identity', (
        _label,
        responseSymbol,
        requestedSymbol,
    ) => {
        expect(() => normalizeFuturesOrder(
            makeOrderQuery({ symbol: responseSymbol }),
            requestedSymbol,
            { orderId: 1917643 },
        )).toThrowError(new FuturesOrderError(
            FUTURES_ORDER_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in order response`,
        ));
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid requested symbol %# before parsing the response',
        (requestedSymbol) => {
            expect(() => normalizeFuturesOrder(
                makeOrderQuery(),
                requestedSymbol,
                { orderId: 1917643 },
            )).toThrowError(new FuturesOrderError(
                FUTURES_ORDER_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
        },
    );

    it.each([undefined, null, 1, 'client-id', [], () => ({})])(
        'rejects non-object lookup identity %#',
        (lookupIdentity) => {
            expect(() => normalizeFuturesOrder(
                makeOrderQuery(),
                'BTCUSDT',
                lookupIdentity,
            )).toThrowError(invalidLookupError());
        },
    );

    it.each([
        ['neither identity', {}],
        ['both identities explicitly undefined', {
            orderId: undefined,
            origClientOrderId: undefined,
        }],
        ['a null orderId plus a valid client identity', {
            orderId: null,
            origClientOrderId: 'queried-order-000001',
        }],
        ['an invalid orderId plus a valid client identity', {
            orderId: -1,
            origClientOrderId: 'queried-order-000001',
        }],
    ])('rejects %s instead of falling back', (_label, lookupIdentity) => {
        expect(() => normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            lookupIdentity,
        )).toThrowError(invalidLookupError());
    });

    it.each([
        null,
        '1917643',
        -1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        NaN,
        Infinity,
        false,
    ])('rejects invalid orderId lookup value %#', (orderId) => {
        expect(() => normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            { orderId },
        )).toThrowError(invalidLookupError());
    });

    it.each([null, 1917643, '', '   ', false, {}])(
        'rejects invalid origClientOrderId lookup value %#',
        (origClientOrderId) => {
            expect(() => normalizeFuturesOrder(
                makeOrderQuery(),
                'BTCUSDT',
                { origClientOrderId },
            )).toThrowError(invalidLookupError());
        },
    );

    it('treats an explicitly undefined orderId as absent for client lookup', () => {
        expect(normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            {
                orderId: undefined,
                origClientOrderId: 'queried-order-000001',
            },
        )).toEqual(expectedOrderQuery);
    });

    it.each([
        ['orderId', makeOrderQuery({ orderId: 1917644 }), { orderId: 1917643 }],
        ['clientOrderId', makeOrderQuery({
            clientOrderId: 'different-query-identity',
        }), { origClientOrderId: 'queried-order-000001' }],
    ])('rejects a response whose %s disagrees with the selected lookup identity', (
        _field,
        response,
        lookupIdentity,
    ) => {
        expect(() => normalizeFuturesOrder(
            response,
            'BTCUSDT',
            lookupIdentity,
        )).toThrowError(new FuturesOrderError(
            FUTURES_ORDER_ERROR_CODES.LOOKUP_IDENTITY_MISMATCH,
            'Futures order response does not match the requested lookup identity',
        ));
    });

    it.each([
        ['an undefined payload', undefined],
        ['a null payload', null],
        ['the regular-open array shape', [makeOrderQuery()]],
        ['an empty array', []],
        ['a string payload', 'BTCUSDT'],
        ['a numeric payload', 1917643],
    ])('rejects %s because the query contract is one object', (_label, payload) => {
        expect(() => normalizeFuturesOrder(
            payload,
            'BTCUSDT',
            { orderId: 1917643 },
        )).toThrowError(malformedError());
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects malformed response symbol identity %#',
        (symbol) => {
            expect(() => normalizeFuturesOrder(
                makeOrderQuery({ symbol }),
                'BTCUSDT',
                { orderId: 1917643 },
            )).toThrowError(malformedError());
        },
    );

    it.each([undefined, null, '1917643', -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects malformed response orderId identity %#',
        (orderId) => {
            expect(() => normalizeFuturesOrder(
                makeOrderQuery({ orderId }),
                'BTCUSDT',
                { origClientOrderId: 'queried-order-000001' },
            )).toThrowError(malformedError());
        },
    );

    it.each([undefined, null, 1917643, '', '   '])(
        'rejects malformed response clientOrderId identity %#',
        (clientOrderId) => {
            expect(() => normalizeFuturesOrder(
                makeOrderQuery({ clientOrderId }),
                'BTCUSDT',
                { orderId: 1917643 },
            )).toThrowError(malformedError());
        },
    );

    it.each([
        'avgPrice',
        'cumQuote',
        'executedQty',
        'origQty',
        'price',
        'stopPrice',
    ])('rejects a non-string required query decimal in %s', (field) => {
        expect(() => normalizeFuturesOrder(
            makeOrderQuery({ [field]: 0 }),
            'BTCUSDT',
            { orderId: 1917643 },
        )).toThrowError(malformedError());
    });

    it.each([
        'avgPrice',
        'cumQuote',
        'executedQty',
        'origQty',
        'price',
        'stopPrice',
    ])('rejects a blank required query decimal in %s', (field) => {
        expect(() => normalizeFuturesOrder(
            makeOrderQuery({ [field]: '   ' }),
            'BTCUSDT',
            { orderId: 1917643 },
        )).toThrowError(malformedError());
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
    ])('rejects a blank required query string in %s', (field) => {
        expect(() => normalizeFuturesOrder(
            makeOrderQuery({ [field]: '   ' }),
            'BTCUSDT',
            { orderId: 1917643 },
        )).toThrowError(malformedError());
    });

    it.each([
        'avgPrice',
        'clientOrderId',
        'cumQuote',
        'executedQty',
        'orderId',
        'origQty',
        'origType',
        'price',
        'reduceOnly',
        'side',
        'positionSide',
        'status',
        'stopPrice',
        'closePosition',
        'symbol',
        'time',
        'timeInForce',
        'type',
        'updateTime',
        'workingType',
        'priceProtect',
        'priceMatch',
        'selfTradePreventionMode',
        'goodTillDate',
    ])('rejects a missing required query field %s', (field) => {
        const source = makeOrderQuery();
        delete source[field];

        expect(() => normalizeFuturesOrder(
            source,
            'BTCUSDT',
            field === 'orderId'
                ? { origClientOrderId: 'queried-order-000001' }
                : { orderId: 1917643 },
        )).toThrowError(malformedError());
    });

    it.each(['orderId', 'time', 'updateTime', 'goodTillDate'])(
        'rejects a non-integer value in %s',
        (field) => {
            expect(() => normalizeFuturesOrder(
                makeOrderQuery({ [field]: '0' }),
                'BTCUSDT',
                field === 'orderId'
                    ? { origClientOrderId: 'queried-order-000001' }
                    : { orderId: 1917643 },
            )).toThrowError(malformedError());
        },
    );

    it.each([
        ['a negative integer', -1],
        ['a fractional number', 1.5],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects %s for an integer response field', (_label, invalidInteger) => {
        expect(() => normalizeFuturesOrder(
            makeOrderQuery({ updateTime: invalidInteger }),
            'BTCUSDT',
            { orderId: 1917643 },
        )).toThrowError(malformedError());
    });

    it.each(['reduceOnly', 'closePosition', 'priceProtect'])(
        'rejects a non-boolean query flag in %s',
        (field) => {
            expect(() => normalizeFuturesOrder(
                makeOrderQuery({ [field]: 'false' }),
                'BTCUSDT',
                { orderId: 1917643 },
            )).toThrowError(malformedError());
        },
    );

    it('omits conditional trailing-stop fields when the response omits them', () => {
        const source = makeOrderQuery();
        delete source.activatePrice;
        delete source.priceRate;

        const result = normalizeFuturesOrder(
            source,
            'BTCUSDT',
            { orderId: 1917643 },
        );

        expect(result).not.toHaveProperty('activatePrice');
        expect(result).not.toHaveProperty('priceRate');
    });

    it.each([
        ['activatePrice', 'priceRate', '0.3000'],
        ['priceRate', 'activatePrice', '9020.00000000'],
    ])('keeps conditional %s absence independent from present %s', (
        omittedField,
        preservedField,
        preservedValue,
    ) => {
        const source = makeOrderQuery();
        delete source[omittedField];

        const result = normalizeFuturesOrder(
            source,
            'BTCUSDT',
            { orderId: 1917643 },
        );

        expect(result).not.toHaveProperty(omittedField);
        expect(result[preservedField]).toBe(preservedValue);
    });

    it('treats explicit undefined conditional fields as absent', () => {
        const result = normalizeFuturesOrder(
            makeOrderQuery({ activatePrice: undefined, priceRate: undefined }),
            'BTCUSDT',
            { orderId: 1917643 },
        );

        expect(result).not.toHaveProperty('activatePrice');
        expect(result).not.toHaveProperty('priceRate');
    });

    it.each([
        ['activatePrice', null],
        ['activatePrice', 9020],
        ['activatePrice', '   '],
        ['priceRate', null],
        ['priceRate', 0.3],
        ['priceRate', ''],
    ])('rejects malformed conditional %s value %#', (field, value) => {
        expect(() => normalizeFuturesOrder(
            makeOrderQuery({ [field]: value }),
            'BTCUSDT',
            { orderId: 1917643 },
        )).toThrowError(malformedError());
    });

    it('preserves true query flags without coercion', () => {
        const result = normalizeFuturesOrder(
            makeOrderQuery({
                reduceOnly: true,
                closePosition: true,
                priceProtect: true,
            }),
            'BTCUSDT',
            { orderId: 1917643 },
        );

        expect(result.reduceOnly).toBe(true);
        expect(result.closePosition).toBe(true);
        expect(result.priceProtect).toBe(true);
    });

    it('preserves zero identifiers and timestamps without synthesizing state', () => {
        const result = normalizeFuturesOrder(
            makeOrderQuery({
                orderId: 0,
                time: 0,
                updateTime: 0,
                goodTillDate: 0,
            }),
            'BTCUSDT',
            { orderId: 0, origClientOrderId: 'ignored-by-zero-order-id' },
        );

        expect(result).toMatchObject({
            orderId: 0,
            time: 0,
            updateTime: 0,
            goodTillDate: 0,
        });
    });

    it('preserves source immutability and returns a fresh queried-order object', () => {
        const source = makeOrderQuery({ ignoredField: 'not-normalized' });
        const snapshot = structuredClone(source);

        const result = normalizeFuturesOrder(
            source,
            'BTCUSDT',
            { orderId: 1917643 },
        );
        const secondResult = normalizeFuturesOrder(
            source,
            'BTCUSDT',
            { orderId: 1917643 },
        );

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source);
        expect(result).not.toBe(secondResult);
        expect(result).not.toHaveProperty('ignoredField');
    });

    it('excludes fields documented only by algo or other order contracts', () => {
        const result = normalizeFuturesOrder(
            makeOrderQuery({
                algoId: 2146760,
                clientAlgoId: 'algo-query-identity',
                algoType: 'CONDITIONAL',
                callbackRate: '0.3000',
                icebergQuantity: null,
                actualOrderId: '',
                actualPrice: '0.00000',
            }),
            'BTCUSDT',
            { orderId: 1917643 },
        );

        [
            'algoId',
            'clientAlgoId',
            'algoType',
            'callbackRate',
            'icebergQuantity',
            'actualOrderId',
            'actualPrice',
        ].forEach((field) => expect(result).not.toHaveProperty(field));
    });

    it('keeps regular query, regular-open, algo-open, and algo-query shapes separate', () => {
        expect(() => normalizeFuturesOrder(
            [makeOrderQuery()],
            'BTCUSDT',
            { orderId: 1917643 },
        )).toThrowError(malformedError());
        expect(() => normalizeFuturesOpenOrders(
            makeOrderQuery(),
            'BTCUSDT',
        )).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
        expect(() => normalizeFuturesAlgoOpenOrders(
            makeOrderQuery(),
            'BTCUSDT',
        )).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
        expect(() => normalizeFuturesAlgoOrder(
            makeOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toThrowError(new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-order response',
        ));
    });

    it('keeps all eight completed futures read-only contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            filters: expectedFilters,
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
        expect(normalizeFuturesAlgoOpenOrders(
            [makeAlgoOpenOrder()],
            'BTCUSDT',
        )).toEqual([expectedAlgoOpenOrder]);
        expect(normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toEqual(expectedAlgoOrderQuery);
    });
});

describe('normalizeFuturesCurrentOpenOrder', () => {
    const malformedError = () => new FuturesCurrentOpenOrderError(
        FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
        'Malformed futures current-open-order response',
    );
    const invalidLookupError = () => new FuturesCurrentOpenOrderError(
        FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.INVALID_LOOKUP_IDENTITY,
        'Futures current-open-order lookup must contain a safe-integer orderId or non-empty origClientOrderId',
    );

    it('normalizes the official single-object current-open regular-order contract exactly', () => {
        const result = normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            { orderId: 1917645 },
        );

        expect(result).toEqual(expectedCurrentOpenOrderQuery);
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
            expect(result[field]).toBe(expectedValue);
            expect(typeof result[field]).toBe('string');
        });
        expect(result.orderId).toBe(1917645);
        expect(result.clientOrderId).toBe('current-open-order-000001');
        expect(result.reduceOnly).toBe(false);
        expect(result.closePosition).toBe(false);
        expect(result.priceProtect).toBe(false);
    });

    it('supports exact origClientOrderId lookup against returned clientOrderId', () => {
        expect(normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            { origClientOrderId: 'current-open-order-000001' },
        )).toEqual(expectedCurrentOpenOrderQuery);
    });

    it('uses presence-based orderId precedence when both identities are supplied', () => {
        expect(normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            {
                orderId: 1917645,
                origClientOrderId: 'different-unselected-client-id',
            },
        )).toEqual(expectedCurrentOpenOrderQuery);
    });

    it.each([null, 1917645, '', '   ', false, {}])(
        'lets valid orderId precedence ignore untransported origClientOrderId %#',
        (origClientOrderId) => {
            expect(normalizeFuturesCurrentOpenOrder(
                makeCurrentOpenOrderQuery(),
                'BTCUSDT',
                { orderId: 1917645, origClientOrderId },
            )).toEqual(expectedCurrentOpenOrderQuery);
        },
    );

    it('preserves exact client lookup identity text without canonicalization', () => {
        const clientOrderId = 'Current-Open-Order-CaseSensitive-000001';
        const result = normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({ clientOrderId }),
            'BTCUSDT',
            { origClientOrderId: clientOrderId },
        );

        expect(result.clientOrderId).toBe(clientOrderId);
    });

    it.each([
        ['a different response symbol', 'ETHUSDT', 'BTCUSDT'],
        ['a case-mismatched response symbol', 'btcusdt', 'BTCUSDT'],
        ['a case-mismatched requested symbol', 'BTCUSDT', 'btcusdt'],
    ])('rejects %s with the established unavailable-symbol identity', (
        _label,
        responseSymbol,
        requestedSymbol,
    ) => {
        expect(() => normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({ symbol: responseSymbol }),
            requestedSymbol,
            { orderId: 1917645 },
        )).toThrowError(new FuturesCurrentOpenOrderError(
            FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in current-open-order response`,
        ));
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid requested symbol %# before parsing the response',
        (requestedSymbol) => {
            expect(() => normalizeFuturesCurrentOpenOrder(
                makeCurrentOpenOrderQuery(),
                requestedSymbol,
                { orderId: 1917645 },
            )).toThrowError(new FuturesCurrentOpenOrderError(
                FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
        },
    );

    it.each([undefined, null, 1, 'client-id', [], () => ({})])(
        'rejects non-object lookup identity %#',
        (lookupIdentity) => {
            expect(() => normalizeFuturesCurrentOpenOrder(
                makeCurrentOpenOrderQuery(),
                'BTCUSDT',
                lookupIdentity,
            )).toThrowError(invalidLookupError());
        },
    );

    it.each([
        ['neither identity', {}],
        ['both identities explicitly undefined', {
            orderId: undefined,
            origClientOrderId: undefined,
        }],
        ['a null orderId plus a valid client identity', {
            orderId: null,
            origClientOrderId: 'current-open-order-000001',
        }],
        ['an invalid orderId plus a valid client identity', {
            orderId: -1,
            origClientOrderId: 'current-open-order-000001',
        }],
    ])('rejects %s instead of falling back', (_label, lookupIdentity) => {
        expect(() => normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            lookupIdentity,
        )).toThrowError(invalidLookupError());
    });

    it.each([
        null,
        '1917645',
        -1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        NaN,
        Infinity,
        false,
    ])('rejects invalid orderId lookup value %#', (orderId) => {
        expect(() => normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            { orderId },
        )).toThrowError(invalidLookupError());
    });

    it.each([null, 1917645, '', '   ', false, {}])(
        'rejects invalid origClientOrderId lookup value %#',
        (origClientOrderId) => {
            expect(() => normalizeFuturesCurrentOpenOrder(
                makeCurrentOpenOrderQuery(),
                'BTCUSDT',
                { origClientOrderId },
            )).toThrowError(invalidLookupError());
        },
    );

    it('treats an explicitly undefined orderId as absent for client lookup', () => {
        expect(normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            {
                orderId: undefined,
                origClientOrderId: 'current-open-order-000001',
            },
        )).toEqual(expectedCurrentOpenOrderQuery);
    });

    it.each([
        [
            'orderId',
            makeCurrentOpenOrderQuery({ orderId: 1917646 }),
            { orderId: 1917645 },
        ],
        [
            'clientOrderId',
            makeCurrentOpenOrderQuery({
                clientOrderId: 'different-current-open-identity',
            }),
            { origClientOrderId: 'current-open-order-000001' },
        ],
    ])('rejects a response whose %s disagrees with the selected identity', (
        _field,
        response,
        lookupIdentity,
    ) => {
        expect(() => normalizeFuturesCurrentOpenOrder(
            response,
            'BTCUSDT',
            lookupIdentity,
        )).toThrowError(new FuturesCurrentOpenOrderError(
            FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.LOOKUP_IDENTITY_MISMATCH,
            'Futures current-open-order response does not match the requested lookup identity',
        ));
    });

    it.each([
        ['an undefined payload', undefined],
        ['a null payload', null],
        ['the current-open array shape', [makeCurrentOpenOrderQuery()]],
        ['an empty array', []],
        ['a string payload', 'BTCUSDT'],
        ['a numeric payload', 1917645],
    ])('rejects %s because the endpoint contract is one object', (_label, payload) => {
        expect(() => normalizeFuturesCurrentOpenOrder(
            payload,
            'BTCUSDT',
            { orderId: 1917645 },
        )).toThrowError(malformedError());
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects malformed response symbol identity %#',
        (symbol) => {
            expect(() => normalizeFuturesCurrentOpenOrder(
                makeCurrentOpenOrderQuery({ symbol }),
                'BTCUSDT',
                { orderId: 1917645 },
            )).toThrowError(malformedError());
        },
    );

    it.each([undefined, null, '1917645', -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects malformed response orderId identity %#',
        (orderId) => {
            expect(() => normalizeFuturesCurrentOpenOrder(
                makeCurrentOpenOrderQuery({ orderId }),
                'BTCUSDT',
                { origClientOrderId: 'current-open-order-000001' },
            )).toThrowError(malformedError());
        },
    );

    it.each([undefined, null, 1917645, '', '   '])(
        'rejects malformed response clientOrderId identity %#',
        (clientOrderId) => {
            expect(() => normalizeFuturesCurrentOpenOrder(
                makeCurrentOpenOrderQuery({ clientOrderId }),
                'BTCUSDT',
                { orderId: 1917645 },
            )).toThrowError(malformedError());
        },
    );

    it.each([
        'avgPrice',
        'cumQuote',
        'executedQty',
        'origQty',
        'price',
        'stopPrice',
    ])('rejects a non-string required decimal in %s', (field) => {
        expect(() => normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({ [field]: 0 }),
            'BTCUSDT',
            { orderId: 1917645 },
        )).toThrowError(malformedError());
    });

    it.each([
        'avgPrice',
        'cumQuote',
        'executedQty',
        'origQty',
        'price',
        'stopPrice',
    ])('rejects a blank required decimal in %s', (field) => {
        expect(() => normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({ [field]: '   ' }),
            'BTCUSDT',
            { orderId: 1917645 },
        )).toThrowError(malformedError());
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
        expect(() => normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({ [field]: '   ' }),
            'BTCUSDT',
            { orderId: 1917645 },
        )).toThrowError(malformedError());
    });

    it.each([
        'avgPrice',
        'clientOrderId',
        'cumQuote',
        'executedQty',
        'orderId',
        'origQty',
        'origType',
        'price',
        'reduceOnly',
        'side',
        'positionSide',
        'status',
        'stopPrice',
        'closePosition',
        'symbol',
        'time',
        'timeInForce',
        'type',
        'updateTime',
        'workingType',
        'priceProtect',
        'priceMatch',
        'selfTradePreventionMode',
        'goodTillDate',
    ])('rejects a missing required current-open field %s', (field) => {
        const source = makeCurrentOpenOrderQuery();
        delete source[field];

        expect(() => normalizeFuturesCurrentOpenOrder(
            source,
            'BTCUSDT',
            field === 'orderId'
                ? { origClientOrderId: 'current-open-order-000001' }
                : { orderId: 1917645 },
        )).toThrowError(malformedError());
    });

    it.each(['orderId', 'time', 'updateTime', 'goodTillDate'])(
        'rejects a non-integer value in %s',
        (field) => {
            expect(() => normalizeFuturesCurrentOpenOrder(
                makeCurrentOpenOrderQuery({ [field]: '0' }),
                'BTCUSDT',
                field === 'orderId'
                    ? { origClientOrderId: 'current-open-order-000001' }
                    : { orderId: 1917645 },
            )).toThrowError(malformedError());
        },
    );

    it.each([
        ['time', -1],
        ['time', 1.5],
        ['updateTime', Number.MAX_SAFE_INTEGER + 1],
        ['goodTillDate', -1],
    ])('rejects malformed integer response value in %s', (field, value) => {
        expect(() => normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({ [field]: value }),
            'BTCUSDT',
            { orderId: 1917645 },
        )).toThrowError(malformedError());
    });

    it.each(['reduceOnly', 'closePosition', 'priceProtect'])(
        'rejects a non-boolean current-open flag in %s',
        (field) => {
            expect(() => normalizeFuturesCurrentOpenOrder(
                makeCurrentOpenOrderQuery({ [field]: 'false' }),
                'BTCUSDT',
                { orderId: 1917645 },
            )).toThrowError(malformedError());
        },
    );

    it('omits conditional trailing-stop fields when the response omits them', () => {
        const source = makeCurrentOpenOrderQuery();
        delete source.activatePrice;
        delete source.priceRate;

        const result = normalizeFuturesCurrentOpenOrder(
            source,
            'BTCUSDT',
            { orderId: 1917645 },
        );

        expect(result).not.toHaveProperty('activatePrice');
        expect(result).not.toHaveProperty('priceRate');
    });

    it.each([
        ['activatePrice', 'priceRate', '0.3000'],
        ['priceRate', 'activatePrice', '9020.00000000'],
    ])('keeps conditional %s absence independent from present %s', (
        omittedField,
        preservedField,
        preservedValue,
    ) => {
        const source = makeCurrentOpenOrderQuery();
        delete source[omittedField];

        const result = normalizeFuturesCurrentOpenOrder(
            source,
            'BTCUSDT',
            { orderId: 1917645 },
        );

        expect(result).not.toHaveProperty(omittedField);
        expect(result[preservedField]).toBe(preservedValue);
    });

    it('treats explicit undefined conditional fields as absent', () => {
        const result = normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({
                activatePrice: undefined,
                priceRate: undefined,
            }),
            'BTCUSDT',
            { orderId: 1917645 },
        );

        expect(result).not.toHaveProperty('activatePrice');
        expect(result).not.toHaveProperty('priceRate');
    });

    it.each([
        ['activatePrice', null],
        ['activatePrice', 9020],
        ['activatePrice', '   '],
        ['priceRate', null],
        ['priceRate', 0.3],
        ['priceRate', ''],
    ])('rejects undocumented or malformed conditional %s value %#', (field, value) => {
        expect(() => normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({ [field]: value }),
            'BTCUSDT',
            { orderId: 1917645 },
        )).toThrowError(malformedError());
    });

    it('preserves true flags without coercion', () => {
        const result = normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({
                reduceOnly: true,
                closePosition: true,
                priceProtect: true,
            }),
            'BTCUSDT',
            { orderId: 1917645 },
        );

        expect(result.reduceOnly).toBe(true);
        expect(result.closePosition).toBe(true);
        expect(result.priceProtect).toBe(true);
    });

    it('preserves zero identifiers and timestamps without synthesizing state', () => {
        const result = normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({
                orderId: 0,
                time: 0,
                updateTime: 0,
                goodTillDate: 0,
            }),
            'BTCUSDT',
            { orderId: 0, origClientOrderId: 'ignored-by-zero-order-id' },
        );

        expect(result).toMatchObject({
            orderId: 0,
            time: 0,
            updateTime: 0,
            goodTillDate: 0,
        });
    });

    it('preserves source immutability and returns a fresh object', () => {
        const source = makeCurrentOpenOrderQuery({
            ignoredField: 'not-normalized',
        });
        const snapshot = structuredClone(source);

        const result = normalizeFuturesCurrentOpenOrder(
            source,
            'BTCUSDT',
            { orderId: 1917645 },
        );
        const secondResult = normalizeFuturesCurrentOpenOrder(
            source,
            'BTCUSDT',
            { orderId: 1917645 },
        );

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source);
        expect(result).not.toBe(secondResult);
        expect(result).not.toHaveProperty('ignoredField');
    });

    it('excludes fields documented only by broader, array, algo, or history contracts', () => {
        const result = normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery({
                algoId: 2146760,
                clientAlgoId: 'algo-query-identity',
                algoType: 'CONDITIONAL',
                callbackRate: '0.3000',
                icebergQuantity: null,
                actualOrderId: '',
                actualPrice: '0.00000',
                history: [],
            }),
            'BTCUSDT',
            { orderId: 1917645 },
        );

        [
            'algoId',
            'clientAlgoId',
            'algoType',
            'callbackRate',
            'icebergQuantity',
            'actualOrderId',
            'actualPrice',
            'history',
        ].forEach((field) => expect(result).not.toHaveProperty(field));
    });

    it('keeps current-open, broader query, and regular/algo array shapes separate', () => {
        expect(() => normalizeFuturesCurrentOpenOrder(
            [makeCurrentOpenOrderQuery()],
            'BTCUSDT',
            { orderId: 1917645 },
        )).toThrowError(malformedError());
        expect(() => normalizeFuturesOrder(
            [makeCurrentOpenOrderQuery()],
            'BTCUSDT',
            { orderId: 1917645 },
        )).toThrowError(new FuturesOrderError(
            FUTURES_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures order response',
        ));
        expect(() => normalizeFuturesOpenOrders(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
        )).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
        expect(() => normalizeFuturesAlgoOpenOrders(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
        )).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
        expect(() => normalizeFuturesAlgoOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toThrowError(new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-order response',
        ));
    });

    it('keeps all nine completed futures read-only contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            filters: expectedFilters,
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
        expect(normalizeFuturesAlgoOpenOrders(
            [makeAlgoOpenOrder()],
            'BTCUSDT',
        )).toEqual([expectedAlgoOpenOrder]);
        expect(normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toEqual(expectedAlgoOrderQuery);
        expect(normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            { orderId: 1917643 },
        )).toEqual(expectedOrderQuery);
    });
});

describe('normalizeFuturesOrderHistory', () => {
    const malformedError = () => new FuturesOrderHistoryError(
        FUTURES_ORDER_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
        'Malformed futures order-history response',
    );

    it('normalizes the official regular-order history array with exact source types', () => {
        const result = normalizeFuturesOrderHistory(
            [makeOrderHistoryEntry()],
            'BTCUSDT',
        );

        expect(result).toEqual([expectedOrderHistoryEntry]);
        [
            ['avgPrice', '9312.34000000'],
            ['cumQuote', '3724.93600000'],
            ['executedQty', '0.40'],
            ['origQty', '0.40'],
            ['price', '0'],
            ['stopPrice', '9300.00000000'],
            ['activatePrice', '9020.00000000'],
            ['priceRate', '0.3000'],
        ].forEach(([field, expectedValue]) => {
            expect(result[0][field]).toBe(expectedValue);
            expect(typeof result[0][field]).toBe('string');
        });
        expect(result[0].clientOrderId).toBe('historical-order-000001');
        expect(result[0].orderId).toBe(1917647);
        expect(result[0].time).toBe(1579276756075);
        expect(result[0].updateTime).toBe(1579276756123);
        expect(result[0].goodTillDate).toBe(0);
        expect(result[0].reduceOnly).toBe(false);
        expect(result[0].closePosition).toBe(false);
        expect(result[0].priceProtect).toBe(false);
    });

    it('preserves undocumented response ordering without imposing monotonic order IDs', () => {
        const source = [
            makeOrderHistoryEntry({
                orderId: 9003,
                clientOrderId: 'third-source-order',
                status: 'CANCELED',
            }),
            makeOrderHistoryEntry({
                orderId: 1001,
                clientOrderId: 'first-numbered-order',
                status: 'FILLED',
            }),
            makeOrderHistoryEntry({
                orderId: 5002,
                clientOrderId: 'second-numbered-order',
                status: 'EXPIRED',
            }),
        ];

        const result = normalizeFuturesOrderHistory(source, 'BTCUSDT');

        expect(result.map((order) => order.orderId)).toEqual([9003, 1001, 5002]);
        expect(result.map((order) => order.status)).toEqual([
            'CANCELED',
            'FILLED',
            'EXPIRED',
        ]);
    });

    it('preserves a valid empty history as a fresh empty array', () => {
        const source = [];
        const result = normalizeFuturesOrderHistory(source, 'BTCUSDT');

        expect(result).toEqual([]);
        expect(result).not.toBe(source);
    });

    it('requires and preserves the exact case-sensitive requested symbol', () => {
        const result = normalizeFuturesOrderHistory([
            makeOrderHistoryEntry({
                clientOrderId: 'BTCUSDT-history-exact-000001',
            }),
        ], 'BTCUSDT');

        expect(result[0].symbol).toBe('BTCUSDT');
        expect(result[0].clientOrderId).toBe('BTCUSDT-history-exact-000001');
    });

    it.each([
        ['a different response symbol', 'ETHUSDT', 'BTCUSDT'],
        ['a case-mismatched response symbol', 'btcusdt', 'BTCUSDT'],
        ['a case-mismatched requested symbol', 'BTCUSDT', 'btcusdt'],
    ])('rejects %s with the established unavailable-symbol identity', (
        _label,
        responseSymbol,
        requestedSymbol,
    ) => {
        expect(() => normalizeFuturesOrderHistory([
            makeOrderHistoryEntry({ symbol: responseSymbol }),
        ], requestedSymbol)).toThrowError(new FuturesOrderHistoryError(
            FUTURES_ORDER_HISTORY_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in order-history response`,
        ));
    });

    it('rejects a mixed-symbol history instead of silently filtering it', () => {
        expect(() => normalizeFuturesOrderHistory([
            makeOrderHistoryEntry(),
            makeOrderHistoryEntry({
                symbol: 'ETHUSDT',
                orderId: 1917648,
                clientOrderId: 'eth-historical-order-000001',
            }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid requested symbol %# before parsing history',
        (requestedSymbol) => {
            expect(() => normalizeFuturesOrderHistory(
                [makeOrderHistoryEntry()],
                requestedSymbol,
            )).toThrowError(new FuturesOrderHistoryError(
                FUTURES_ORDER_HISTORY_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
        },
    );

    it.each([
        ['an undefined payload', undefined],
        ['a null payload', null],
        ['a single object', makeOrderHistoryEntry()],
        ['a scalar payload', 'BTCUSDT'],
        ['a null entry', [null]],
        ['a missing entry symbol', [makeOrderHistoryEntry({ symbol: undefined })]],
        ['a numeric entry symbol', [makeOrderHistoryEntry({ symbol: 123 })]],
        ['a blank entry symbol', [makeOrderHistoryEntry({ symbol: '   ' })]],
        ['a malformed entry among valid entries', [makeOrderHistoryEntry(), null]],
    ])('rejects %s as malformed history', (_label, payload) => {
        expect(() => normalizeFuturesOrderHistory(
            payload,
            'BTCUSDT',
        )).toThrowError(malformedError());
    });

    it.each([
        'avgPrice',
        'cumQuote',
        'executedQty',
        'origQty',
        'price',
        'stopPrice',
    ])('rejects malformed required history decimal %s', (field) => {
        [0, '   '].forEach((value) => {
            expect(() => normalizeFuturesOrderHistory([
                makeOrderHistoryEntry({ [field]: value }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        });
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
    ])('rejects malformed required history string %s', (field) => {
        [123, '   '].forEach((value) => {
            expect(() => normalizeFuturesOrderHistory([
                makeOrderHistoryEntry({ [field]: value }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        });
    });

    it.each([
        'avgPrice',
        'clientOrderId',
        'cumQuote',
        'executedQty',
        'orderId',
        'origQty',
        'origType',
        'price',
        'reduceOnly',
        'side',
        'positionSide',
        'status',
        'stopPrice',
        'closePosition',
        'symbol',
        'time',
        'timeInForce',
        'type',
        'updateTime',
        'workingType',
        'priceProtect',
        'priceMatch',
        'selfTradePreventionMode',
        'goodTillDate',
    ])('rejects a missing required history field %s', (field) => {
        const source = makeOrderHistoryEntry();
        delete source[field];

        expect(() => normalizeFuturesOrderHistory(
            [source],
            'BTCUSDT',
        )).toThrowError(malformedError());
    });

    it.each(['orderId', 'time', 'updateTime', 'goodTillDate'])(
        'rejects a non-integer history value in %s',
        (field) => {
            expect(() => normalizeFuturesOrderHistory([
                makeOrderHistoryEntry({ [field]: '0' }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        },
    );

    it.each([
        ['a negative integer', -1],
        ['a fractional number', 1.5],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects %s for a history integer field', (_label, invalidInteger) => {
        expect(() => normalizeFuturesOrderHistory([
            makeOrderHistoryEntry({ updateTime: invalidInteger }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it.each(['reduceOnly', 'closePosition', 'priceProtect'])(
        'rejects a non-boolean history flag in %s',
        (field) => {
            expect(() => normalizeFuturesOrderHistory([
                makeOrderHistoryEntry({ [field]: 'false' }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        },
    );

    it('omits both live-documented trailing-stop fields when absent', () => {
        const source = makeOrderHistoryEntry();
        delete source.activatePrice;
        delete source.priceRate;

        const [result] = normalizeFuturesOrderHistory([source], 'BTCUSDT');

        expect(result).not.toHaveProperty('activatePrice');
        expect(result).not.toHaveProperty('priceRate');
    });

    it.each([
        ['activatePrice', 'priceRate', '0.3000'],
        ['priceRate', 'activatePrice', '9020.00000000'],
    ])('keeps conditional %s absence independent from present %s', (
        omittedField,
        preservedField,
        preservedValue,
    ) => {
        const source = makeOrderHistoryEntry();
        delete source[omittedField];

        const [result] = normalizeFuturesOrderHistory([source], 'BTCUSDT');

        expect(result).not.toHaveProperty(omittedField);
        expect(result[preservedField]).toBe(preservedValue);
    });

    it('treats explicit undefined conditional fields as absent', () => {
        const [result] = normalizeFuturesOrderHistory([
            makeOrderHistoryEntry({
                activatePrice: undefined,
                priceRate: undefined,
            }),
        ], 'BTCUSDT');

        expect(result).not.toHaveProperty('activatePrice');
        expect(result).not.toHaveProperty('priceRate');
    });

    it.each([
        ['activatePrice', null],
        ['activatePrice', 9020],
        ['activatePrice', '   '],
        ['priceRate', null],
        ['priceRate', 0.3],
        ['priceRate', ''],
    ])('rejects malformed conditional history %s value %#', (field, value) => {
        expect(() => normalizeFuturesOrderHistory([
            makeOrderHistoryEntry({ [field]: value }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it('preserves true flags plus zero identifiers and timestamps without coercion', () => {
        const [result] = normalizeFuturesOrderHistory([
            makeOrderHistoryEntry({
                orderId: 0,
                time: 0,
                updateTime: 0,
                goodTillDate: 0,
                reduceOnly: true,
                closePosition: true,
                priceProtect: true,
            }),
        ], 'BTCUSDT');

        expect(result).toMatchObject({
            orderId: 0,
            time: 0,
            updateTime: 0,
            goodTillDate: 0,
            reduceOnly: true,
            closePosition: true,
            priceProtect: true,
        });
    });

    it('rejects duplicate symbol-scoped orderId identities', () => {
        expect(() => normalizeFuturesOrderHistory([
            makeOrderHistoryEntry(),
            makeOrderHistoryEntry({
                orderId: 1917647,
                clientOrderId: 'different-client-id-same-order',
            }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it('preserves repeated historical clientOrderId values with distinct order IDs', () => {
        const result = normalizeFuturesOrderHistory([
            makeOrderHistoryEntry({
                orderId: 1917647,
                clientOrderId: 'reused-after-close',
                status: 'FILLED',
            }),
            makeOrderHistoryEntry({
                orderId: 1917648,
                clientOrderId: 'reused-after-close',
                status: 'CANCELED',
            }),
        ], 'BTCUSDT');

        expect(result.map((order) => order.orderId)).toEqual([1917647, 1917648]);
        expect(result.map((order) => order.clientOrderId)).toEqual([
            'reused-after-close',
            'reused-after-close',
        ]);
    });

    it('preserves source immutability and returns fresh history entries', () => {
        const source = [
            makeOrderHistoryEntry({ ignoredField: 'not-normalized' }),
            makeOrderHistoryEntry({
                orderId: 1917648,
                clientOrderId: 'historical-order-000002',
            }),
        ];
        const snapshot = structuredClone(source);

        const result = normalizeFuturesOrderHistory(source, 'BTCUSDT');
        const secondResult = normalizeFuturesOrderHistory(source, 'BTCUSDT');

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source);
        expect(result[0]).not.toBe(source[0]);
        expect(result[1]).not.toBe(source[1]);
        expect(result[0]).not.toBe(result[1]);
        expect(result[0]).not.toBe(secondResult[0]);
        expect(result[0]).not.toHaveProperty('ignoredField');

        result[0].price = 'mutated-result-only';
        expect(source[0].price).toBe('0');
        expect(secondResult[0].price).toBe('0');
    });

    it('excludes unknown algo and non-history fields', () => {
        const [result] = normalizeFuturesOrderHistory([
            makeOrderHistoryEntry({
                algoId: 2146760,
                clientAlgoId: 'algo-history-identity',
                algoType: 'CONDITIONAL',
                callbackRate: '0.3000',
                icebergQuantity: null,
                actualOrderId: '',
                actualPrice: '0.00000',
                cumQty: '0.40',
                pair: 'BTCUSDT',
                currentOpenOnly: true,
            }),
        ], 'BTCUSDT');

        [
            'algoId',
            'clientAlgoId',
            'algoType',
            'callbackRate',
            'icebergQuantity',
            'actualOrderId',
            'actualPrice',
            'cumQty',
            'pair',
            'currentOpenOnly',
        ].forEach((field) => expect(result).not.toHaveProperty(field));
    });

    it('keeps history separate from every completed order normalizer', () => {
        const nonTrailingHistory = makeOrderHistoryEntry({
            origType: 'LIMIT',
            type: 'LIMIT',
        });
        delete nonTrailingHistory.activatePrice;
        delete nonTrailingHistory.priceRate;

        const [historyResult] = normalizeFuturesOrderHistory(
            [nonTrailingHistory],
            'BTCUSDT',
        );
        const [openOrdersResult] = normalizeFuturesOpenOrders(
            [nonTrailingHistory],
            'BTCUSDT',
        );

        expect(historyResult).not.toHaveProperty('activatePrice');
        expect(historyResult).not.toHaveProperty('priceRate');
        expect(openOrdersResult.activatePrice).toBeNull();
        expect(openOrdersResult.priceRate).toBeNull();
        expect(() => normalizeFuturesCurrentOpenOrder(
            [makeOrderHistoryEntry()],
            'BTCUSDT',
            { orderId: 1917647 },
        )).toThrowError(new FuturesCurrentOpenOrderError(
            FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures current-open-order response',
        ));
        expect(() => normalizeFuturesOrder(
            [makeOrderHistoryEntry()],
            'BTCUSDT',
            { orderId: 1917647 },
        )).toThrowError(new FuturesOrderError(
            FUTURES_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures order response',
        ));
        expect(() => normalizeFuturesAlgoOpenOrders(
            [makeOrderHistoryEntry()],
            'BTCUSDT',
        )).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
        expect(() => normalizeFuturesAlgoOrder(
            makeOrderHistoryEntry(),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toThrowError(new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-order response',
        ));
    });

    it('keeps all ten completed futures read-only contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            filters: expectedFilters,
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
        expect(normalizeFuturesAlgoOpenOrders(
            [makeAlgoOpenOrder()],
            'BTCUSDT',
        )).toEqual([expectedAlgoOpenOrder]);
        expect(normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toEqual(expectedAlgoOrderQuery);
        expect(normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            { orderId: 1917643 },
        )).toEqual(expectedOrderQuery);
        expect(normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            { orderId: 1917645 },
        )).toEqual(expectedCurrentOpenOrderQuery);
    });
});

describe('normalizeFuturesAlgoOrderHistory', () => {
    const malformedError = () => new FuturesAlgoOrderHistoryError(
        FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
        'Malformed futures algo-order-history response',
    );

    it('normalizes the official algo-order history array with exact source types', () => {
        const result = normalizeFuturesAlgoOrderHistory(
            [makeAlgoOrderHistoryEntry()],
            'BTCUSDT',
        );

        expect(result).toEqual([expectedAlgoOrderHistoryEntry]);
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
        expect(result[0].algoId).toBe(2146760);
        expect(result[0].clientAlgoId).toBe('historical-algo-order-000001');
        expect(result[0].actualOrderId).toBe('');
        expect(result[0].tpOrderType).toBe('');
        expect(result[0].icebergQuantity).toBeNull();
        expect(result[0].createTime).toBe(1750485492076);
        expect(result[0].updateTime).toBe(1750514545091);
        expect(result[0].triggerTime).toBe(0);
        expect(result[0].goodTillDate).toBe(0);
        expect(result[0].closePosition).toBe(false);
        expect(result[0].priceProtect).toBe(false);
        expect(result[0].reduceOnly).toBe(false);
    });

    it('preserves undocumented response ordering without imposing monotonic algo IDs', () => {
        const source = [
            makeAlgoOrderHistoryEntry({
                algoId: 9003,
                clientAlgoId: 'third-source-algo-order',
                algoStatus: 'FINISHED',
            }),
            makeAlgoOrderHistoryEntry({
                algoId: 1001,
                clientAlgoId: 'first-numbered-algo-order',
                algoStatus: 'CANCELED',
            }),
            makeAlgoOrderHistoryEntry({
                algoId: 5002,
                clientAlgoId: 'second-numbered-algo-order',
                algoStatus: 'EXPIRED',
            }),
        ];

        const result = normalizeFuturesAlgoOrderHistory(source, 'BTCUSDT');

        expect(result.map((order) => order.algoId)).toEqual([9003, 1001, 5002]);
        expect(result.map((order) => order.algoStatus)).toEqual([
            'FINISHED',
            'CANCELED',
            'EXPIRED',
        ]);
    });

    it('preserves the live-documented algo status vocabulary exactly', () => {
        const statuses = [
            'NEW',
            'CANCELED',
            'TRIGGERING',
            'TRIGGERED',
            'FINISHED',
            'REJECTED',
            'EXPIRED',
        ];
        const result = normalizeFuturesAlgoOrderHistory(
            statuses.map((algoStatus, index) => makeAlgoOrderHistoryEntry({
                algoId: index,
                clientAlgoId: `status-${algoStatus}`,
                algoStatus,
            })),
            'BTCUSDT',
        );

        expect(result.map((order) => order.algoStatus)).toEqual(statuses);
    });

    it('preserves a valid empty history as a fresh empty array', () => {
        const source = [];
        const result = normalizeFuturesAlgoOrderHistory(source, 'BTCUSDT');

        expect(result).toEqual([]);
        expect(result).not.toBe(source);
    });

    it('requires and preserves the exact case-sensitive requested symbol', () => {
        const result = normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({
                clientAlgoId: 'BTCUSDT-algo-history-exact-000001',
            }),
        ], 'BTCUSDT');

        expect(result[0].symbol).toBe('BTCUSDT');
        expect(result[0].clientAlgoId).toBe(
            'BTCUSDT-algo-history-exact-000001',
        );
    });

    it.each([
        ['a different response symbol', 'ETHUSDT', 'BTCUSDT'],
        ['a case-mismatched response symbol', 'btcusdt', 'BTCUSDT'],
        ['a case-mismatched requested symbol', 'BTCUSDT', 'btcusdt'],
    ])('rejects %s with the established unavailable-symbol identity', (
        _label,
        responseSymbol,
        requestedSymbol,
    ) => {
        expect(() => normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({ symbol: responseSymbol }),
        ], requestedSymbol)).toThrowError(new FuturesAlgoOrderHistoryError(
            FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in algo-order-history response`,
        ));
    });

    it('rejects a mixed-symbol history instead of silently filtering it', () => {
        expect(() => normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry(),
            makeAlgoOrderHistoryEntry({
                algoId: 2146761,
                clientAlgoId: 'eth-historical-algo-order-000001',
                symbol: 'ETHUSDT',
            }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid requested symbol %# before parsing history',
        (requestedSymbol) => {
            expect(() => normalizeFuturesAlgoOrderHistory(
                [makeAlgoOrderHistoryEntry()],
                requestedSymbol,
            )).toThrowError(new FuturesAlgoOrderHistoryError(
                FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
        },
    );

    it.each([
        ['an undefined payload', undefined],
        ['a null payload', null],
        ['a single object', makeAlgoOrderHistoryEntry()],
        ['a scalar payload', 'BTCUSDT'],
        ['a null entry', [null]],
        ['a missing entry symbol', [makeAlgoOrderHistoryEntry({
            symbol: undefined,
        })]],
        ['a numeric entry symbol', [makeAlgoOrderHistoryEntry({ symbol: 123 })]],
        ['a blank entry symbol', [makeAlgoOrderHistoryEntry({ symbol: '   ' })]],
        ['a malformed entry among valid entries', [
            makeAlgoOrderHistoryEntry(),
            null,
        ]],
    ])('rejects %s as malformed history', (_label, payload) => {
        expect(() => normalizeFuturesAlgoOrderHistory(
            payload,
            'BTCUSDT',
        )).toThrowError(malformedError());
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
    ])('rejects malformed required history decimal %s', (field) => {
        [0, '   '].forEach((value) => {
            expect(() => normalizeFuturesAlgoOrderHistory([
                makeAlgoOrderHistoryEntry({ [field]: value }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        });
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
    ])('rejects malformed required history string %s', (field) => {
        [123, '   '].forEach((value) => {
            expect(() => normalizeFuturesAlgoOrderHistory([
                makeAlgoOrderHistoryEntry({ [field]: value }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        });
    });

    it.each([
        'algoId',
        'clientAlgoId',
        'algoType',
        'orderType',
        'symbol',
        'side',
        'positionSide',
        'timeInForce',
        'quantity',
        'algoStatus',
        'actualOrderId',
        'actualPrice',
        'triggerPrice',
        'price',
        'icebergQuantity',
        'tpTriggerPrice',
        'tpPrice',
        'slTriggerPrice',
        'slPrice',
        'tpOrderType',
        'selfTradePreventionMode',
        'workingType',
        'priceMatch',
        'closePosition',
        'priceProtect',
        'reduceOnly',
        'createTime',
        'updateTime',
        'triggerTime',
        'goodTillDate',
    ])('rejects a missing required history field %s', (field) => {
        const source = makeAlgoOrderHistoryEntry();
        delete source[field];

        expect(() => normalizeFuturesAlgoOrderHistory(
            [source],
            'BTCUSDT',
        )).toThrowError(malformedError());
    });

    it.each([
        'algoId',
        'createTime',
        'updateTime',
        'triggerTime',
        'goodTillDate',
    ])('rejects a non-integer history value in %s', (field) => {
        expect(() => normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({ [field]: '0' }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it.each([
        ['a negative integer', -1],
        ['a fractional number', 1.5],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects %s for a history integer field', (_label, invalidInteger) => {
        expect(() => normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({ updateTime: invalidInteger }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it.each(['closePosition', 'priceProtect', 'reduceOnly'])(
        'rejects a non-boolean history flag in %s',
        (field) => {
            expect(() => normalizeFuturesAlgoOrderHistory([
                makeAlgoOrderHistoryEntry({ [field]: 'false' }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        },
    );

    it('preserves documented empty string fields without synthesizing null', () => {
        const [result] = normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({
                actualOrderId: '',
                tpOrderType: '',
            }),
        ], 'BTCUSDT');

        expect(result.actualOrderId).toBe('');
        expect(result.tpOrderType).toBe('');
    });

    it.each([
        ['actualOrderId', null],
        ['actualOrderId', 123],
        ['actualOrderId', '   '],
        ['tpOrderType', null],
        ['tpOrderType', false],
        ['tpOrderType', '   '],
    ])('rejects malformed empty-string-capable %s value %#', (field, value) => {
        expect(() => normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({ [field]: value }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it('preserves each evidenced iceberg-quantity representation exactly', () => {
        const nullableResult = normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({ icebergQuantity: null }),
        ], 'BTCUSDT')[0];
        const decimalResult = normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({ icebergQuantity: '0.00010000' }),
        ], 'BTCUSDT')[0];
        const literalNullResult = normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({ icebergQuantity: 'null' }),
        ], 'BTCUSDT')[0];

        expect(nullableResult.icebergQuantity).toBeNull();
        expect(decimalResult.icebergQuantity).toBe('0.00010000');
        expect(typeof decimalResult.icebergQuantity).toBe('string');
        expect(literalNullResult.icebergQuantity).toBe('null');
        expect(typeof literalNullResult.icebergQuantity).toBe('string');
    });

    it.each([undefined, 0, false, '', '   '])(
        'rejects an undocumented iceberg-quantity value %# without coercion',
        (icebergQuantity) => {
            expect(() => normalizeFuturesAlgoOrderHistory([
                makeAlgoOrderHistoryEntry({ icebergQuantity }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        },
    );

    it('preserves true flags plus zero identifiers and timestamps without coercion', () => {
        const [result] = normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({
                algoId: 0,
                createTime: 0,
                updateTime: 0,
                triggerTime: 0,
                goodTillDate: 0,
                closePosition: true,
                priceProtect: true,
                reduceOnly: true,
            }),
        ], 'BTCUSDT');

        expect(result).toMatchObject({
            algoId: 0,
            createTime: 0,
            updateTime: 0,
            triggerTime: 0,
            goodTillDate: 0,
            closePosition: true,
            priceProtect: true,
            reduceOnly: true,
        });
    });

    it('rejects duplicate algoId identities', () => {
        expect(() => normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry(),
            makeAlgoOrderHistoryEntry({
                algoId: 2146760,
                clientAlgoId: 'different-client-id-same-algo-order',
            }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it('preserves repeated historical clientAlgoId values with distinct algo IDs', () => {
        const result = normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({
                algoId: 2146760,
                clientAlgoId: 'reused-after-close',
                algoStatus: 'FINISHED',
            }),
            makeAlgoOrderHistoryEntry({
                algoId: 2146761,
                clientAlgoId: 'reused-after-close',
                algoStatus: 'CANCELED',
            }),
        ], 'BTCUSDT');

        expect(result.map((order) => order.algoId)).toEqual([2146760, 2146761]);
        expect(result.map((order) => order.clientAlgoId)).toEqual([
            'reused-after-close',
            'reused-after-close',
        ]);
    });

    it('preserves source immutability and returns fresh history entries', () => {
        const source = [
            makeAlgoOrderHistoryEntry({ ignoredField: 'not-normalized' }),
            makeAlgoOrderHistoryEntry({
                algoId: 2146761,
                clientAlgoId: 'historical-algo-order-000002',
            }),
        ];
        const snapshot = structuredClone(source);

        const result = normalizeFuturesAlgoOrderHistory(source, 'BTCUSDT');
        const secondResult = normalizeFuturesAlgoOrderHistory(source, 'BTCUSDT');

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source);
        expect(result[0]).not.toBe(source[0]);
        expect(result[1]).not.toBe(source[1]);
        expect(result[0]).not.toBe(result[1]);
        expect(result[0]).not.toBe(secondResult[0]);
        expect(result[0]).not.toHaveProperty('ignoredField');

        result[0].price = 'mutated-result-only';
        expect(source[0].price).toBe('750.000');
        expect(secondResult[0].price).toBe('750.000');
    });

    it('excludes query-only, regular, current-open, and execution fields', () => {
        const [result] = normalizeFuturesAlgoOrderHistory([
            makeAlgoOrderHistoryEntry({
                actualType: 'LIMIT',
                actualQty: '0.010000',
                activatePrice: '720.000',
                callbackRate: '0.3000',
                priceRate: '0.3000',
                orderId: 1917647,
                clientOrderId: 'regular-history-identity',
                avgPrice: '750.000',
                cumQuote: '7.50000',
                executedQty: '0.010000',
                status: 'FILLED',
                currentOpenOnly: true,
                executionOnly: true,
            }),
        ], 'BTCUSDT');

        [
            'actualType',
            'actualQty',
            'activatePrice',
            'callbackRate',
            'priceRate',
            'orderId',
            'clientOrderId',
            'avgPrice',
            'cumQuote',
            'executedQty',
            'status',
            'currentOpenOnly',
            'executionOnly',
        ].forEach((field) => expect(result).not.toHaveProperty(field));
    });

    it('keeps algo history separate from every completed order normalizer', () => {
        const repeatedClientHistory = [
            makeAlgoOrderHistoryEntry({
                algoId: 2146760,
                clientAlgoId: 'historically-reused',
            }),
            makeAlgoOrderHistoryEntry({
                algoId: 2146761,
                clientAlgoId: 'historically-reused',
            }),
        ];

        expect(normalizeFuturesAlgoOrderHistory(
            repeatedClientHistory,
            'BTCUSDT',
        )).toHaveLength(2);
        expect(() => normalizeFuturesAlgoOpenOrders(
            repeatedClientHistory,
            'BTCUSDT',
        )).toThrowError(new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-open-orders response',
        ));
        expect(() => normalizeFuturesAlgoOrder(
            repeatedClientHistory,
            'BTCUSDT',
            { algoId: 2146760 },
        )).toThrowError(new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-order response',
        ));
        expect(() => normalizeFuturesOrderHistory(
            repeatedClientHistory,
            'BTCUSDT',
        )).toThrowError(new FuturesOrderHistoryError(
            FUTURES_ORDER_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures order-history response',
        ));
        expect(() => normalizeFuturesOpenOrders(
            repeatedClientHistory,
            'BTCUSDT',
        )).toThrowError(new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures open-orders response',
        ));
        expect(() => normalizeFuturesCurrentOpenOrder(
            repeatedClientHistory,
            'BTCUSDT',
            { orderId: 1917647 },
        )).toThrowError(new FuturesCurrentOpenOrderError(
            FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures current-open-order response',
        ));
        expect(() => normalizeFuturesOrder(
            repeatedClientHistory,
            'BTCUSDT',
            { orderId: 1917647 },
        )).toThrowError(new FuturesOrderError(
            FUTURES_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures order response',
        ));
    });

    it('keeps all eleven completed futures read-only contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            filters: expectedFilters,
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
        expect(normalizeFuturesAlgoOpenOrders(
            [makeAlgoOpenOrder()],
            'BTCUSDT',
        )).toEqual([expectedAlgoOpenOrder]);
        expect(normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toEqual(expectedAlgoOrderQuery);
        expect(normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            { orderId: 1917643 },
        )).toEqual(expectedOrderQuery);
        expect(normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            { orderId: 1917645 },
        )).toEqual(expectedCurrentOpenOrderQuery);
        expect(normalizeFuturesOrderHistory(
            [makeOrderHistoryEntry()],
            'BTCUSDT',
        )).toEqual([expectedOrderHistoryEntry]);
    });
});

describe('normalizeFuturesAccountTradeHistory', () => {
    const malformedError = () => new FuturesAccountTradeHistoryError(
        FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
        'Malformed futures account-trade-history response',
    );

    it('normalizes the official account-trade array with exact source types', () => {
        const result = normalizeFuturesAccountTradeHistory(
            [makeAccountTradeHistoryEntry()],
            'BTCUSDT',
        );

        expect(result).toEqual([expectedAccountTradeHistoryEntry]);
        [
            ['commission', '0.07819010'],
            ['price', '7819.01000000'],
            ['qty', '0.002000'],
            ['quoteQty', '15.63802000'],
            ['realizedPnl', '-0.91539999'],
        ].forEach(([field, expectedValue]) => {
            expect(result[0][field]).toBe(expectedValue);
            expect(typeof result[0][field]).toBe('string');
        });
        expect(result[0].commissionAsset).toBe('USDT');
        expect(result[0].id).toBe(698759);
        expect(result[0].orderId).toBe(25851813);
        expect(result[0].time).toBe(1569514978020);
        expect(result[0].buyer).toBe(false);
        expect(result[0].maker).toBe(false);
    });

    it('preserves undocumented response ordering without imposing monotonic IDs', () => {
        const source = [
            makeAccountTradeHistoryEntry({
                id: 9003,
                orderId: 8003,
                side: 'BUY',
            }),
            makeAccountTradeHistoryEntry({
                id: 1001,
                orderId: 8001,
                side: 'SELL',
            }),
            makeAccountTradeHistoryEntry({
                id: 5002,
                orderId: 8002,
                side: 'BUY',
            }),
        ];

        const result = normalizeFuturesAccountTradeHistory(source, 'BTCUSDT');

        expect(result.map((trade) => trade.id)).toEqual([9003, 1001, 5002]);
        expect(result.map((trade) => trade.side)).toEqual(['BUY', 'SELL', 'BUY']);
    });

    it('preserves a valid empty account-trade history as a fresh empty array', () => {
        const source = [];
        const result = normalizeFuturesAccountTradeHistory(source, 'BTCUSDT');

        expect(result).toEqual([]);
        expect(result).not.toBe(source);
    });

    it('requires and preserves the exact case-sensitive requested symbol', () => {
        const [result] = normalizeFuturesAccountTradeHistory([
            makeAccountTradeHistoryEntry({ id: 698760 }),
        ], 'BTCUSDT');

        expect(result.symbol).toBe('BTCUSDT');
        expect(result.id).toBe(698760);
    });

    it.each([
        ['a different response symbol', 'ETHUSDT', 'BTCUSDT'],
        ['a case-mismatched response symbol', 'btcusdt', 'BTCUSDT'],
        ['a case-mismatched requested symbol', 'BTCUSDT', 'btcusdt'],
    ])('rejects %s with the established unavailable-symbol identity', (
        _label,
        responseSymbol,
        requestedSymbol,
    ) => {
        expect(() => normalizeFuturesAccountTradeHistory([
            makeAccountTradeHistoryEntry({ symbol: responseSymbol }),
        ], requestedSymbol)).toThrowError(new FuturesAccountTradeHistoryError(
            FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in account-trade-history response`,
        ));
    });

    it('rejects mixed-symbol account trades instead of silently filtering', () => {
        expect(() => normalizeFuturesAccountTradeHistory([
            makeAccountTradeHistoryEntry(),
            makeAccountTradeHistoryEntry({
                id: 698760,
                orderId: 25851814,
                symbol: 'ETHUSDT',
            }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid requested symbol %# before parsing account trades',
        (requestedSymbol) => {
            expect(() => normalizeFuturesAccountTradeHistory(
                [makeAccountTradeHistoryEntry()],
                requestedSymbol,
            )).toThrowError(new FuturesAccountTradeHistoryError(
                FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
        },
    );

    it.each([
        ['an undefined payload', undefined],
        ['a null payload', null],
        ['a single object', makeAccountTradeHistoryEntry()],
        ['a scalar payload', 'BTCUSDT'],
        ['a null entry', [null]],
        ['a missing entry symbol', [makeAccountTradeHistoryEntry({
            symbol: undefined,
        })]],
        ['a numeric entry symbol', [makeAccountTradeHistoryEntry({ symbol: 123 })]],
        ['a blank entry symbol', [makeAccountTradeHistoryEntry({ symbol: '   ' })]],
        ['a malformed entry among valid entries', [
            makeAccountTradeHistoryEntry(),
            null,
        ]],
    ])('rejects %s as malformed account-trade history', (_label, payload) => {
        expect(() => normalizeFuturesAccountTradeHistory(
            payload,
            'BTCUSDT',
        )).toThrowError(malformedError());
    });

    it.each(['commission', 'price', 'qty', 'quoteQty', 'realizedPnl'])(
        'rejects malformed required account-trade decimal %s',
        (field) => {
            [0, null, '   '].forEach((value) => {
                expect(() => normalizeFuturesAccountTradeHistory([
                    makeAccountTradeHistoryEntry({ [field]: value }),
                ], 'BTCUSDT')).toThrowError(malformedError());
            });
        },
    );

    it.each(['commissionAsset', 'side', 'positionSide'])(
        'rejects malformed required account-trade string %s',
        (field) => {
            [123, null, '   '].forEach((value) => {
                expect(() => normalizeFuturesAccountTradeHistory([
                    makeAccountTradeHistoryEntry({ [field]: value }),
                ], 'BTCUSDT')).toThrowError(malformedError());
            });
        },
    );

    it.each([
        'buyer',
        'commission',
        'commissionAsset',
        'id',
        'maker',
        'orderId',
        'price',
        'qty',
        'quoteQty',
        'realizedPnl',
        'side',
        'positionSide',
        'symbol',
        'time',
    ])('rejects a missing required account-trade field %s', (field) => {
        const source = makeAccountTradeHistoryEntry();
        delete source[field];

        expect(() => normalizeFuturesAccountTradeHistory(
            [source],
            'BTCUSDT',
        )).toThrowError(malformedError());
    });

    it.each(['id', 'orderId', 'time'])(
        'rejects a non-integer account-trade value in %s',
        (field) => {
            expect(() => normalizeFuturesAccountTradeHistory([
                makeAccountTradeHistoryEntry({ [field]: '0' }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        },
    );

    it.each([
        ['a negative integer', -1],
        ['a fractional number', 1.5],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
        ['NaN', NaN],
        ['infinity', Infinity],
        ['null', null],
    ])('rejects %s for an account-trade integer field', (_label, invalidInteger) => {
        expect(() => normalizeFuturesAccountTradeHistory([
            makeAccountTradeHistoryEntry({ id: invalidInteger }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it.each(['buyer', 'maker'])(
        'rejects a non-boolean account-trade flag in %s',
        (field) => {
            ['false', 0, null].forEach((value) => {
                expect(() => normalizeFuturesAccountTradeHistory([
                    makeAccountTradeHistoryEntry({ [field]: value }),
                ], 'BTCUSDT')).toThrowError(malformedError());
            });
        },
    );

    it('preserves signed and scaled decimal strings without coercion', () => {
        const [result] = normalizeFuturesAccountTradeHistory([
            makeAccountTradeHistoryEntry({
                commission: '-0.00000000',
                price: '0007819.01000000',
                qty: '0.00200000',
                quoteQty: '15.6380200000',
                realizedPnl: '+0.00000000',
            }),
        ], 'BTCUSDT');

        expect(result).toMatchObject({
            commission: '-0.00000000',
            price: '0007819.01000000',
            qty: '0.00200000',
            quoteQty: '15.6380200000',
            realizedPnl: '+0.00000000',
        });
    });

    it('preserves true flags plus zero identifiers and timestamp', () => {
        const [result] = normalizeFuturesAccountTradeHistory([
            makeAccountTradeHistoryEntry({
                buyer: true,
                maker: true,
                id: 0,
                orderId: 0,
                time: 0,
            }),
        ], 'BTCUSDT');

        expect(result).toMatchObject({
            buyer: true,
            maker: true,
            id: 0,
            orderId: 0,
            time: 0,
        });
    });

    it('rejects duplicate symbol-scoped trade IDs', () => {
        expect(() => normalizeFuturesAccountTradeHistory([
            makeAccountTradeHistoryEntry(),
            makeAccountTradeHistoryEntry({
                id: 698759,
                orderId: 25851814,
                time: 1569514978021,
            }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it('preserves repeated order IDs across distinct fill trade IDs', () => {
        const result = normalizeFuturesAccountTradeHistory([
            makeAccountTradeHistoryEntry({
                id: 698759,
                orderId: 25851813,
                qty: '0.001000',
            }),
            makeAccountTradeHistoryEntry({
                id: 698760,
                orderId: 25851813,
                qty: '0.001000',
                time: 1569514978021,
            }),
        ], 'BTCUSDT');

        expect(result.map((trade) => trade.id)).toEqual([698759, 698760]);
        expect(result.map((trade) => trade.orderId)).toEqual([
            25851813,
            25851813,
        ]);
    });

    it('preserves source immutability and returns fresh detached trades', () => {
        const source = [
            makeAccountTradeHistoryEntry({ ignoredField: 'not-normalized' }),
            makeAccountTradeHistoryEntry({
                id: 698760,
                orderId: 25851813,
                time: 1569514978021,
            }),
        ];
        const snapshot = structuredClone(source);

        const result = normalizeFuturesAccountTradeHistory(source, 'BTCUSDT');
        const secondResult = normalizeFuturesAccountTradeHistory(source, 'BTCUSDT');

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source);
        expect(result[0]).not.toBe(source[0]);
        expect(result[1]).not.toBe(source[1]);
        expect(result[0]).not.toBe(result[1]);
        expect(result[0]).not.toBe(secondResult[0]);
        expect(result[0]).not.toHaveProperty('ignoredField');

        result[0].commission = 'mutated-result-only';
        expect(source[0].commission).toBe('0.07819010');
        expect(secondResult[0].commission).toBe('0.07819010');
    });

    it('excludes undocumented, order, balance, position, and spot-history fields', () => {
        const [result] = normalizeFuturesAccountTradeHistory([
            makeAccountTradeHistoryEntry({
                marginAsset: 'USDT',
                isRPITrade: true,
                clientOrderId: 'not-an-account-trade-field',
                tradeId: 'synthetic-alias',
                reduceOnly: false,
                incomeType: 'COMMISSION',
                isBestMatch: true,
            }),
        ], 'BTCUSDT');

        [
            'marginAsset',
            'isRPITrade',
            'clientOrderId',
            'tradeId',
            'reduceOnly',
            'incomeType',
            'isBestMatch',
        ].forEach((field) => expect(result).not.toHaveProperty(field));
    });

    it('keeps account trades separate from completed order-history normalizers', () => {
        const repeatedOrderTrades = [
            makeAccountTradeHistoryEntry({ id: 698759 }),
            makeAccountTradeHistoryEntry({ id: 698760 }),
        ];

        expect(normalizeFuturesAccountTradeHistory(
            repeatedOrderTrades,
            'BTCUSDT',
        )).toHaveLength(2);
        expect(() => normalizeFuturesOrderHistory(
            repeatedOrderTrades,
            'BTCUSDT',
        )).toThrowError(new FuturesOrderHistoryError(
            FUTURES_ORDER_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures order-history response',
        ));
        expect(() => normalizeFuturesAlgoOrderHistory(
            repeatedOrderTrades,
            'BTCUSDT',
        )).toThrowError(new FuturesAlgoOrderHistoryError(
            FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-order-history response',
        ));
        expect(() => normalizeFuturesCurrentOpenOrder(
            repeatedOrderTrades,
            'BTCUSDT',
            { orderId: 25851813 },
        )).toThrowError(new FuturesCurrentOpenOrderError(
            FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures current-open-order response',
        ));
        expect(() => normalizeFuturesOrder(
            repeatedOrderTrades,
            'BTCUSDT',
            { orderId: 25851813 },
        )).toThrowError(new FuturesOrderError(
            FUTURES_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures order response',
        ));
    });

    it('keeps all twelve completed futures read-only contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            filters: expectedFilters,
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
        expect(normalizeFuturesAlgoOpenOrders(
            [makeAlgoOpenOrder()],
            'BTCUSDT',
        )).toEqual([expectedAlgoOpenOrder]);
        expect(normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toEqual(expectedAlgoOrderQuery);
        expect(normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            { orderId: 1917643 },
        )).toEqual(expectedOrderQuery);
        expect(normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            { orderId: 1917645 },
        )).toEqual(expectedCurrentOpenOrderQuery);
        expect(normalizeFuturesOrderHistory(
            [makeOrderHistoryEntry()],
            'BTCUSDT',
        )).toEqual([expectedOrderHistoryEntry]);
        expect(normalizeFuturesAlgoOrderHistory(
            [makeAlgoOrderHistoryEntry()],
            'BTCUSDT',
        )).toEqual([expectedAlgoOrderHistoryEntry]);
    });
});

describe('normalizeFuturesIncomeHistory', () => {
    const malformedError = () => new FuturesIncomeHistoryError(
        FUTURES_INCOME_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
        'Malformed futures income-history response',
    );

    it('normalizes the current official income array with exact source types', () => {
        const result = normalizeFuturesIncomeHistory(
            [makeIncomeHistoryEntry()],
            'BTCUSDT',
        );

        expect(result).toEqual([expectedIncomeHistoryEntry]);
        expect(result[0].income).toBe('-0.01000000');
        expect(typeof result[0].income).toBe('string');
        expect(result[0].tradeId).toBe('2059192');
        expect(typeof result[0].tradeId).toBe('string');
        expect(result[0].time).toBe(1570636800000);
        expect(result[0].tranId).toBe(9689322392);
        expect(typeof result[0].tranId).toBe('number');
    });

    it('preserves undocumented response ordering without sorting by time or ID', () => {
        const source = [
            makeIncomeHistoryEntry({
                incomeType: 'REALIZED_PNL',
                time: 3000,
                tranId: 9003,
            }),
            makeIncomeHistoryEntry({
                incomeType: 'COMMISSION',
                time: 1000,
                tranId: 1001,
            }),
            makeIncomeHistoryEntry({
                incomeType: 'FUNDING_FEE',
                time: 2000,
                tranId: 5002,
            }),
        ];

        const result = normalizeFuturesIncomeHistory(source, 'BTCUSDT');

        expect(result.map((entry) => entry.tranId)).toEqual([9003, 1001, 5002]);
        expect(result.map((entry) => entry.time)).toEqual([3000, 1000, 2000]);
    });

    it('preserves a valid empty income history as a fresh empty array', () => {
        const source = [];
        const result = normalizeFuturesIncomeHistory(source, 'BTCUSDT');

        expect(result).toEqual([]);
        expect(result).not.toBe(source);
    });

    it('requires and preserves the exact case-sensitive requested symbol', () => {
        const [result] = normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({ tranId: 9689322393 }),
        ], 'BTCUSDT');

        expect(result.symbol).toBe('BTCUSDT');
        expect(result.tranId).toBe(9689322393);
    });

    it.each([
        ['a different response symbol', 'ETHUSDT', 'BTCUSDT'],
        ['a case-mismatched response symbol', 'btcusdt', 'BTCUSDT'],
        ['a case-mismatched requested symbol', 'BTCUSDT', 'btcusdt'],
        ['a documented account-wide empty response symbol', '', 'BTCUSDT'],
    ])('rejects %s with the established unavailable-symbol identity', (
        _label,
        responseSymbol,
        requestedSymbol,
    ) => {
        expect(() => normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({ symbol: responseSymbol }),
        ], requestedSymbol)).toThrowError(new FuturesIncomeHistoryError(
            FUTURES_INCOME_HISTORY_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in income-history response`,
        ));
    });

    it('rejects mixed exact and account-wide income rows instead of filtering', () => {
        expect(() => normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry(),
            makeIncomeHistoryEntry({
                symbol: '',
                incomeType: 'TRANSFER',
                tranId: 9689322393,
                tradeId: '',
            }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid requested symbol %# before parsing income history',
        (requestedSymbol) => {
            expect(() => normalizeFuturesIncomeHistory(
                [makeIncomeHistoryEntry()],
                requestedSymbol,
            )).toThrowError(new FuturesIncomeHistoryError(
                FUTURES_INCOME_HISTORY_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
        },
    );

    it.each([
        ['an undefined payload', undefined],
        ['a null payload', null],
        ['a single object', makeIncomeHistoryEntry()],
        ['a scalar payload', 'BTCUSDT'],
        ['a null entry', [null]],
        ['a missing entry symbol', [makeIncomeHistoryEntry({ symbol: undefined })]],
        ['a numeric entry symbol', [makeIncomeHistoryEntry({ symbol: 123 })]],
        ['a whitespace-only entry symbol', [makeIncomeHistoryEntry({ symbol: '   ' })]],
        ['a malformed entry among valid entries', [makeIncomeHistoryEntry(), null]],
    ])('rejects %s as malformed income history', (_label, payload) => {
        expect(() => normalizeFuturesIncomeHistory(
            payload,
            'BTCUSDT',
        )).toThrowError(malformedError());
    });

    it.each(['incomeType', 'income', 'asset'])(
        'rejects malformed required income string %s',
        (field) => {
            [123, null, '', '   '].forEach((value) => {
                expect(() => normalizeFuturesIncomeHistory([
                    makeIncomeHistoryEntry({ [field]: value }),
                ], 'BTCUSDT')).toThrowError(malformedError());
            });
        },
    );

    it('preserves an exact empty info string without synthesizing null', () => {
        const [result] = normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({ info: '' }),
        ], 'BTCUSDT');

        expect(result.info).toBe('');
        expect(typeof result.info).toBe('string');
    });

    it.each([null, 123, '   '])(
        'rejects malformed income info %# without coercion',
        (info) => {
            expect(() => normalizeFuturesIncomeHistory([
                makeIncomeHistoryEntry({ info }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        },
    );

    it('preserves the documented empty trade ID without synthesizing null', () => {
        const [result] = normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({ tradeId: '' }),
        ], 'BTCUSDT');

        expect(result.tradeId).toBe('');
        expect(typeof result.tradeId).toBe('string');
    });

    it.each([null, 123, '   '])(
        'rejects malformed trade ID %# without coercion',
        (tradeId) => {
            expect(() => normalizeFuturesIncomeHistory([
                makeIncomeHistoryEntry({ tradeId }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        },
    );

    it.each([
        'symbol',
        'incomeType',
        'income',
        'asset',
        'info',
        'time',
        'tranId',
        'tradeId',
    ])('rejects a missing required income-history field %s', (field) => {
        const source = makeIncomeHistoryEntry();
        delete source[field];

        expect(() => normalizeFuturesIncomeHistory(
            [source],
            'BTCUSDT',
        )).toThrowError(malformedError());
    });

    it.each(['time', 'tranId'])(
        'rejects a lexical integer in income-history field %s',
        (field) => {
            expect(() => normalizeFuturesIncomeHistory([
                makeIncomeHistoryEntry({ [field]: '0' }),
            ], 'BTCUSDT')).toThrowError(malformedError());
        },
    );

    it.each(['time', 'tranId'].flatMap((field) => [
        [field, -1],
        [field, 1.5],
        [field, Number.MAX_SAFE_INTEGER + 1],
        [field, NaN],
        [field, Infinity],
        [field, null],
    ]))('rejects invalid safe-integer value %# in %s', (field, invalidInteger) => {
        expect(() => normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({ [field]: invalidInteger }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it('preserves signed decimal strings and lexical identifiers without coercion', () => {
        const [result] = normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({
                income: '+0000.0100000000',
                info: 'exact source information',
                tradeId: '00002059192',
            }),
        ], 'BTCUSDT');

        expect(result).toMatchObject({
            income: '+0000.0100000000',
            info: 'exact source information',
            tradeId: '00002059192',
        });
    });

    it('preserves exact zero transaction identity and timestamp', () => {
        const [result] = normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({ time: 0, tranId: 0, tradeId: '' }),
        ], 'BTCUSDT');

        expect(result).toMatchObject({ time: 0, tranId: 0, tradeId: '' });
    });

    it('rejects duplicate transaction IDs within one income type', () => {
        expect(() => normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry(),
            makeIncomeHistoryEntry({
                income: '-0.02000000',
                time: 1570636800001,
                tradeId: '2059193',
            }),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it('preserves a repeated transaction ID across different income types', () => {
        const result = normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({
                incomeType: 'TRANSFER',
                info: 'TRANSFER',
                tradeId: '',
            }),
            makeIncomeHistoryEntry({
                incomeType: 'COMMISSION',
                info: 'COMMISSION',
            }),
        ], 'BTCUSDT');

        expect(result.map((entry) => entry.tranId)).toEqual([
            9689322392,
            9689322392,
        ]);
        expect(result.map((entry) => entry.incomeType)).toEqual([
            'TRANSFER',
            'COMMISSION',
        ]);
    });

    it('preserves repeated trade IDs across distinct transaction identities', () => {
        const result = normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({ tranId: 9689322392 }),
            makeIncomeHistoryEntry({
                incomeType: 'REALIZED_PNL',
                info: 'REALIZED_PNL',
                tranId: 9689322393,
            }),
        ], 'BTCUSDT');

        expect(result.map((entry) => entry.tradeId)).toEqual(['2059192', '2059192']);
    });

    it('preserves non-empty response income types without treating filters as an enum', () => {
        const [result] = normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({ incomeType: 'FUTURE_NEW_INCOME_TYPE' }),
        ], 'BTCUSDT');

        expect(result.incomeType).toBe('FUTURE_NEW_INCOME_TYPE');
    });

    it('preserves source immutability and returns fresh detached income rows', () => {
        const source = [
            makeIncomeHistoryEntry({ ignoredField: 'not-normalized' }),
            makeIncomeHistoryEntry({
                incomeType: 'REALIZED_PNL',
                info: 'REALIZED_PNL',
                tranId: 9689322393,
            }),
        ];
        const snapshot = structuredClone(source);

        const result = normalizeFuturesIncomeHistory(source, 'BTCUSDT');
        const secondResult = normalizeFuturesIncomeHistory(source, 'BTCUSDT');

        expect(source).toEqual(snapshot);
        expect(result).not.toBe(source);
        expect(result[0]).not.toBe(source[0]);
        expect(result[1]).not.toBe(source[1]);
        expect(result[0]).not.toBe(result[1]);
        expect(result[0]).not.toBe(secondResult[0]);
        expect(result[0]).not.toHaveProperty('ignoredField');

        result[0].income = 'mutated-result-only';
        expect(source[0].income).toBe('-0.01000000');
        expect(secondResult[0].income).toBe('-0.01000000');
    });

    it('excludes undocumented trade, order, balance, and position fields', () => {
        const [result] = normalizeFuturesIncomeHistory([
            makeIncomeHistoryEntry({
                id: 698759,
                orderId: 25851813,
                commission: '0.01',
                positionSide: 'BOTH',
                marginAsset: 'USDT',
                reduceOnly: false,
                unknown: true,
            }),
        ], 'BTCUSDT');

        [
            'id',
            'orderId',
            'commission',
            'positionSide',
            'marginAsset',
            'reduceOnly',
            'unknown',
        ].forEach((field) => expect(result).not.toHaveProperty(field));
    });

    it('keeps income history separate from account trades and order histories', () => {
        const income = [makeIncomeHistoryEntry()];

        expect(normalizeFuturesIncomeHistory(income, 'BTCUSDT')).toEqual([
            expectedIncomeHistoryEntry,
        ]);
        expect(() => normalizeFuturesAccountTradeHistory(
            income,
            'BTCUSDT',
        )).toThrowError(new FuturesAccountTradeHistoryError(
            FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures account-trade-history response',
        ));
        expect(() => normalizeFuturesOrderHistory(
            income,
            'BTCUSDT',
        )).toThrowError(new FuturesOrderHistoryError(
            FUTURES_ORDER_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures order-history response',
        ));
        expect(() => normalizeFuturesAlgoOrderHistory(
            income,
            'BTCUSDT',
        )).toThrowError(new FuturesAlgoOrderHistoryError(
            FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures algo-order-history response',
        ));
        expect(() => normalizeFuturesIncomeHistory([
            makeAccountTradeHistoryEntry(),
        ], 'BTCUSDT')).toThrowError(malformedError());
    });

    it('keeps all thirteen completed futures read-only contracts unchanged', () => {
        const exchangeInfo = makeExchangeInfo(makeFuturesSymbol());
        const premiumIndex = makeMarkPrice();

        expect(normalizeFuturesExchangeInfo(exchangeInfo, 'BTCUSDT')).toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            filters: expectedFilters,
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
        expect(normalizeFuturesAlgoOpenOrders(
            [makeAlgoOpenOrder()],
            'BTCUSDT',
        )).toEqual([expectedAlgoOpenOrder]);
        expect(normalizeFuturesAlgoOrder(
            makeAlgoOrderQuery(),
            'BTCUSDT',
            { algoId: 2146760 },
        )).toEqual(expectedAlgoOrderQuery);
        expect(normalizeFuturesOrder(
            makeOrderQuery(),
            'BTCUSDT',
            { orderId: 1917643 },
        )).toEqual(expectedOrderQuery);
        expect(normalizeFuturesCurrentOpenOrder(
            makeCurrentOpenOrderQuery(),
            'BTCUSDT',
            { orderId: 1917645 },
        )).toEqual(expectedCurrentOpenOrderQuery);
        expect(normalizeFuturesOrderHistory(
            [makeOrderHistoryEntry()],
            'BTCUSDT',
        )).toEqual([expectedOrderHistoryEntry]);
        expect(normalizeFuturesAlgoOrderHistory(
            [makeAlgoOrderHistoryEntry()],
            'BTCUSDT',
        )).toEqual([expectedAlgoOrderHistoryEntry]);
        expect(normalizeFuturesAccountTradeHistory(
            [makeAccountTradeHistoryEntry()],
            'BTCUSDT',
        )).toEqual([expectedAccountTradeHistoryEntry]);
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

    it('loads one algo-order query from an official-client-style body by algoId', async () => {
        const data = vi.fn().mockResolvedValue(makeAlgoOrderQuery());
        const transport = {
            queryAlgoOrder: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { algoId: 2146760 },
        )).resolves.toEqual(expectedAlgoOrderQuery);
        expect(transport.queryAlgoOrder.mock.calls).toEqual([
            [{ algoId: 2146760 }],
        ]);
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts one raw algo-order query response by exact clientAlgoId', async () => {
        const transport = {
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { clientAlgoId: 'queried-algo-order-000001' },
        )).resolves.toEqual(expectedAlgoOrderQuery);
        expect(transport.queryAlgoOrder).toHaveBeenCalledWith({
            clientAlgoId: 'queried-algo-order-000001',
        });
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid algo-order expected symbol %# before transport use',
        async (expectedSymbol) => {
            const transport = { queryAlgoOrder: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getAlgoOrder(
                expectedSymbol,
                { algoId: 2146760 },
            )).rejects.toThrowError(new FuturesAlgoOrderError(
                FUTURES_ALGO_ORDER_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
            expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['an undefined lookup', undefined],
        ['a null lookup', null],
        ['an array lookup', []],
        ['neither identity', {}],
        ['both identities', {
            algoId: 2146760,
            clientAlgoId: 'queried-algo-order-000001',
        }],
        ['a null algoId', { algoId: null }],
        ['a string algoId', { algoId: '2146760' }],
        ['a negative algoId', { algoId: -1 }],
        ['a fractional algoId', { algoId: 1.5 }],
        ['an unsafe algoId', { algoId: Number.MAX_SAFE_INTEGER + 1 }],
        ['a null clientAlgoId', { clientAlgoId: null }],
        ['a numeric clientAlgoId', { clientAlgoId: 2146760 }],
        ['an empty clientAlgoId', { clientAlgoId: '' }],
        ['a blank clientAlgoId', { clientAlgoId: '   ' }],
    ])('rejects %s before invoking the algo-order query transport', async (
        _label,
        lookupIdentity,
    ) => {
        const transport = { queryAlgoOrder: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            lookupIdentity,
        )).rejects.toThrowError(new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.INVALID_LOOKUP_IDENTITY,
            'Futures algo-order lookup must contain exactly one safe-integer algoId or non-empty clientAlgoId',
        ));
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
    });

    it('forwards only the validated algoId lookup key to the query transport', async () => {
        const transport = {
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery({
                algoId: 0,
            })),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrder('BTCUSDT', {
            algoId: 0,
            clientAlgoId: undefined,
            expectedSymbol: 'must-not-cross-the-transport-boundary',
            recvWindow: 60000,
        })).resolves.toMatchObject({ algoId: 0, symbol: 'BTCUSDT' });
        expect(transport.queryAlgoOrder.mock.calls).toEqual([[{ algoId: 0 }]]);
    });

    it('forwards only the validated clientAlgoId lookup key to the query transport', async () => {
        const clientAlgoId = 'Query-Algo-000001';
        const transport = {
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery({
                clientAlgoId,
            })),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrder('BTCUSDT', {
            algoId: undefined,
            clientAlgoId,
            symbol: 'must-not-cross-the-transport-boundary',
            history: true,
        })).resolves.toMatchObject({ clientAlgoId, symbol: 'BTCUSDT' });
        expect(transport.queryAlgoOrder.mock.calls).toEqual([[
            { clientAlgoId },
        ]]);
    });

    it('preserves algo-order query transport error identity', async () => {
        const transportError = new Error('futures algo-order query unavailable');
        const transport = {
            queryAlgoOrder: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { algoId: 2146760 },
        )).rejects.toBe(transportError);
        expect(transport.queryAlgoOrder).toHaveBeenCalledWith({ algoId: 2146760 });
    });

    it('preserves algo-order query response-body error identity', async () => {
        const responseError = new Error('futures algo-order body unavailable');
        const data = vi.fn().mockRejectedValue(responseError);
        const transport = {
            queryAlgoOrder: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { clientAlgoId: 'queried-algo-order-000001' },
        )).rejects.toBe(responseError);
        expect(transport.queryAlgoOrder).toHaveBeenCalledWith({
            clientAlgoId: 'queried-algo-order-000001',
        });
        expect(data).toHaveBeenCalledWith();
    });

    it('does not fall back to regular or algo-open arrays for query mismatches', async () => {
        const transport = {
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery({
                algoId: 2146761,
            })),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { algoId: 2146760 },
        )).rejects.toThrowError(new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.LOOKUP_IDENTITY_MISMATCH,
            'Futures algo-order response does not match the requested lookup identity',
        ));
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
    });

    it('keeps queried, algo-open, and regular-open transports independent', async () => {
        const transport = {
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { algoId: 2146760 },
        )).resolves.toEqual(expectedAlgoOrderQuery);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
        expect(transport.getOpenOrders).not.toHaveBeenCalled();

        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedAlgoOpenOrder,
        ]);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).not.toHaveBeenCalled();

        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedOpenOrder,
        ]);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledTimes(1);
    });

    it('loads one regular-order query from an official-client-style body by orderId', async () => {
        const data = vi.fn().mockResolvedValue(makeOrderQuery());
        const transport = {
            queryOrder: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrder(
            'BTCUSDT',
            { orderId: 1917643 },
        )).resolves.toEqual(expectedOrderQuery);
        expect(transport.queryOrder.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', orderId: 1917643 },
        ]]);
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts one raw regular-order query response by exact origClientOrderId', async () => {
        const transport = {
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrder(
            'BTCUSDT',
            { origClientOrderId: 'queried-order-000001' },
        )).resolves.toEqual(expectedOrderQuery);
        expect(transport.queryOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            origClientOrderId: 'queried-order-000001',
        });
    });

    it('canonicalizes both valid identifiers to orderId-only transport precedence', async () => {
        const transport = {
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrder('BTCUSDT', {
            orderId: 1917643,
            origClientOrderId: 'different-unselected-client-id',
        })).resolves.toEqual(expectedOrderQuery);
        expect(transport.queryOrder.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', orderId: 1917643 },
        ]]);
    });

    it.each([null, 1917643, '', '   ', false, {}])(
        'does not transport malformed alternate origClientOrderId %# when orderId wins',
        async (origClientOrderId) => {
            const transport = {
                queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getOrder('BTCUSDT', {
                orderId: 1917643,
                origClientOrderId,
            })).resolves.toEqual(expectedOrderQuery);
            expect(transport.queryOrder.mock.calls).toEqual([[
                { symbol: 'BTCUSDT', orderId: 1917643 },
            ]]);
        },
    );

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid regular-order symbol %# before transport use',
        async (symbol) => {
            const transport = { queryOrder: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getOrder(
                symbol,
                { orderId: 1917643 },
            )).rejects.toThrowError(new FuturesOrderError(
                FUTURES_ORDER_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
            expect(transport.queryOrder).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['an undefined lookup', undefined],
        ['a null lookup', null],
        ['an array lookup', []],
        ['neither identity', {}],
        ['both identities explicitly undefined', {
            orderId: undefined,
            origClientOrderId: undefined,
        }],
        ['a null orderId', { orderId: null }],
        ['a string orderId', { orderId: '1917643' }],
        ['a negative orderId', { orderId: -1 }],
        ['a fractional orderId', { orderId: 1.5 }],
        ['an unsafe orderId', { orderId: Number.MAX_SAFE_INTEGER + 1 }],
        ['a boolean orderId', { orderId: false }],
        ['an invalid present orderId plus a valid client identity', {
            orderId: null,
            origClientOrderId: 'queried-order-000001',
        }],
        ['a null origClientOrderId', { origClientOrderId: null }],
        ['a numeric origClientOrderId', { origClientOrderId: 1917643 }],
        ['an empty origClientOrderId', { origClientOrderId: '' }],
        ['a blank origClientOrderId', { origClientOrderId: '   ' }],
    ])('rejects %s before invoking the regular-order query transport', async (
        _label,
        lookupIdentity,
    ) => {
        const transport = { queryOrder: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrder(
            'BTCUSDT',
            lookupIdentity,
        )).rejects.toThrowError(new FuturesOrderError(
            FUTURES_ORDER_ERROR_CODES.INVALID_LOOKUP_IDENTITY,
            'Futures order lookup must contain a safe-integer orderId or non-empty origClientOrderId',
        ));
        expect(transport.queryOrder).not.toHaveBeenCalled();
    });

    it('forwards only the exact symbol and validated zero orderId lookup', async () => {
        const transport = {
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery({ orderId: 0 })),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrder('BTCUSDT', {
            orderId: 0,
            origClientOrderId: 'must-lose-to-order-id-presence',
            expectedSymbol: 'must-not-cross-the-transport-boundary',
            recvWindow: 60000,
            history: true,
        })).resolves.toMatchObject({ orderId: 0, symbol: 'BTCUSDT' });
        expect(transport.queryOrder.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', orderId: 0 },
        ]]);
    });

    it('forwards only the exact symbol and validated client lookup key', async () => {
        const clientOrderId = 'Query-Regular-Order-000001';
        const transport = {
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery({ clientOrderId })),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrder('BTCUSDT', {
            orderId: undefined,
            origClientOrderId: clientOrderId,
            symbol: 'must-not-cross-the-transport-boundary',
            currentOpenOnly: true,
        })).resolves.toMatchObject({ clientOrderId, symbol: 'BTCUSDT' });
        expect(transport.queryOrder.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', origClientOrderId: clientOrderId },
        ]]);
    });

    it('preserves regular-order query transport error identity', async () => {
        const transportError = new Error('futures regular-order query unavailable');
        const transport = {
            queryOrder: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrder(
            'BTCUSDT',
            { orderId: 1917643 },
        )).rejects.toBe(transportError);
        expect(transport.queryOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            orderId: 1917643,
        });
    });

    it('preserves regular-order query response-body error identity', async () => {
        const responseError = new Error('futures regular-order body unavailable');
        const data = vi.fn().mockRejectedValue(responseError);
        const transport = {
            queryOrder: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrder(
            'BTCUSDT',
            { origClientOrderId: 'queried-order-000001' },
        )).rejects.toBe(responseError);
        expect(transport.queryOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            origClientOrderId: 'queried-order-000001',
        });
        expect(data).toHaveBeenCalledWith();
    });

    it('does not fall back to any regular or algo list/query transport on mismatch', async () => {
        const transport = {
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery({
                orderId: 1917644,
            })),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrder(
            'BTCUSDT',
            { orderId: 1917643 },
        )).rejects.toThrowError(new FuturesOrderError(
            FUTURES_ORDER_ERROR_CODES.LOOKUP_IDENTITY_MISMATCH,
            'Futures order response does not match the requested lookup identity',
        ));
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
    });

    it('keeps all four regular/algo query and open-array transports independent', async () => {
        const transport = {
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrder(
            'BTCUSDT',
            { orderId: 1917643 },
        )).resolves.toEqual(expectedOrderQuery);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();

        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedOpenOrder,
        ]);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();

        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { algoId: 2146760 },
        )).resolves.toEqual(expectedAlgoOrderQuery);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();

        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedAlgoOpenOrder,
        ]);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
    });

    it('loads one current-open regular order from an official-client-style body', async () => {
        const data = vi.fn().mockResolvedValue(makeCurrentOpenOrderQuery());
        const transport = {
            queryCurrentOpenOrder: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { orderId: 1917645 },
        )).resolves.toEqual(expectedCurrentOpenOrderQuery);
        expect(transport.queryCurrentOpenOrder.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', orderId: 1917645 },
        ]]);
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts one raw current-open response by exact origClientOrderId', async () => {
        const transport = {
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { origClientOrderId: 'current-open-order-000001' },
        )).resolves.toEqual(expectedCurrentOpenOrderQuery);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            origClientOrderId: 'current-open-order-000001',
        });
    });

    it('canonicalizes both current-open identifiers to orderId-only precedence', async () => {
        const transport = {
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder('BTCUSDT', {
            orderId: 1917645,
            origClientOrderId: 'different-unselected-client-id',
        })).resolves.toEqual(expectedCurrentOpenOrderQuery);
        expect(transport.queryCurrentOpenOrder.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', orderId: 1917645 },
        ]]);
    });

    it.each([null, 1917645, '', '   ', false, {}])(
        'does not transport malformed alternate current-open client identity %#',
        async (origClientOrderId) => {
            const transport = {
                queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                    makeCurrentOpenOrderQuery(),
                ),
            };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getCurrentOpenOrder('BTCUSDT', {
                orderId: 1917645,
                origClientOrderId,
            })).resolves.toEqual(expectedCurrentOpenOrderQuery);
            expect(transport.queryCurrentOpenOrder.mock.calls).toEqual([[
                { symbol: 'BTCUSDT', orderId: 1917645 },
            ]]);
        },
    );

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid current-open-order symbol %# before transport use',
        async (symbol) => {
            const transport = { queryCurrentOpenOrder: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getCurrentOpenOrder(
                symbol,
                { orderId: 1917645 },
            )).rejects.toThrowError(new FuturesCurrentOpenOrderError(
                FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.INVALID_SYMBOL,
                'Futures symbol must be a non-empty string',
            ));
            expect(transport.queryCurrentOpenOrder).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['an undefined lookup', undefined],
        ['a null lookup', null],
        ['an array lookup', []],
        ['neither identity', {}],
        ['both identities explicitly undefined', {
            orderId: undefined,
            origClientOrderId: undefined,
        }],
        ['a null orderId', { orderId: null }],
        ['a string orderId', { orderId: '1917645' }],
        ['a negative orderId', { orderId: -1 }],
        ['a fractional orderId', { orderId: 1.5 }],
        ['an unsafe orderId', { orderId: Number.MAX_SAFE_INTEGER + 1 }],
        ['a boolean orderId', { orderId: false }],
        ['an invalid present orderId plus a valid client identity', {
            orderId: null,
            origClientOrderId: 'current-open-order-000001',
        }],
        ['a null origClientOrderId', { origClientOrderId: null }],
        ['a numeric origClientOrderId', { origClientOrderId: 1917645 }],
        ['an empty origClientOrderId', { origClientOrderId: '' }],
        ['a blank origClientOrderId', { origClientOrderId: '   ' }],
    ])('rejects %s before invoking the current-open-order transport', async (
        _label,
        lookupIdentity,
    ) => {
        const transport = { queryCurrentOpenOrder: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            lookupIdentity,
        )).rejects.toThrowError(new FuturesCurrentOpenOrderError(
            FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.INVALID_LOOKUP_IDENTITY,
            'Futures current-open-order lookup must contain a safe-integer orderId or non-empty origClientOrderId',
        ));
        expect(transport.queryCurrentOpenOrder).not.toHaveBeenCalled();
    });

    it('forwards only the exact symbol and validated zero orderId', async () => {
        const transport = {
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery({ orderId: 0 }),
            ),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder('BTCUSDT', {
            orderId: 0,
            origClientOrderId: 'must-lose-to-order-id-presence',
            expectedSymbol: 'must-not-cross-the-transport-boundary',
            recvWindow: 60000,
            fallback: 'queryOrder',
        })).resolves.toMatchObject({ orderId: 0, symbol: 'BTCUSDT' });
        expect(transport.queryCurrentOpenOrder.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', orderId: 0 },
        ]]);
    });

    it('forwards only the exact symbol and selected client lookup identity', async () => {
        const clientOrderId = 'Current-Open-Order-CaseSensitive-000001';
        const transport = {
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery({ clientOrderId }),
            ),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder('BTCUSDT', {
            orderId: undefined,
            origClientOrderId: clientOrderId,
            symbol: 'must-not-cross-the-transport-boundary',
            recvWindow: 60000,
            accountWide: true,
        })).resolves.toMatchObject({ clientOrderId, symbol: 'BTCUSDT' });
        expect(transport.queryCurrentOpenOrder.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', origClientOrderId: clientOrderId },
        ]]);
    });

    it('preserves current-open-order transport error identity', async () => {
        const transportError = new Error('current-open-order transport unavailable');
        const transport = {
            queryCurrentOpenOrder: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { orderId: 1917645 },
        )).rejects.toBe(transportError);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            orderId: 1917645,
        });
    });

    it('preserves filled or cancelled Order does not exist identity without fallback', async () => {
        const notFoundError = Object.assign(new Error('Order does not exist.'), {
            code: -2013,
            msg: 'Order does not exist.',
        });
        const transport = {
            queryCurrentOpenOrder: vi.fn().mockRejectedValue(notFoundError),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { orderId: 1917645 },
        )).rejects.toBe(notFoundError);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).not.toHaveBeenCalled();
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
    });

    it('preserves current-open-order response-body error identity', async () => {
        const responseError = new Error('current-open-order body unavailable');
        const data = vi.fn().mockRejectedValue(responseError);
        const transport = {
            queryCurrentOpenOrder: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { origClientOrderId: 'current-open-order-000001' },
        )).rejects.toBe(responseError);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            origClientOrderId: 'current-open-order-000001',
        });
        expect(data).toHaveBeenCalledWith();
    });

    it('does not fall back to broader or array/algo transports on mismatch', async () => {
        const transport = {
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery({ orderId: 1917646 }),
            ),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { orderId: 1917645 },
        )).rejects.toThrowError(new FuturesCurrentOpenOrderError(
            FUTURES_CURRENT_OPEN_ORDER_ERROR_CODES.LOOKUP_IDENTITY_MISMATCH,
            'Futures current-open-order response does not match the requested lookup identity',
        ));
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).not.toHaveBeenCalled();
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
    });

    it('keeps all five regular/algo query and open-array transports independent', async () => {
        const transport = {
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { orderId: 1917645 },
        )).resolves.toEqual(expectedCurrentOpenOrderQuery);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).not.toHaveBeenCalled();
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();

        await expect(adapter.getOrder(
            'BTCUSDT',
            { orderId: 1917643 },
        )).resolves.toEqual(expectedOrderQuery);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();

        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedOpenOrder,
        ]);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();

        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { algoId: 2146760 },
        )).resolves.toEqual(expectedAlgoOrderQuery);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();

        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedAlgoOpenOrder,
        ]);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
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

    it('loads bounded symbol-scoped order history from an official-client-style body', async () => {
        const data = vi.fn().mockResolvedValue([makeOrderHistoryEntry()]);
        const transport = {
            getAllOrders: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory('BTCUSDT')).resolves.toEqual([
            expectedOrderHistoryEntry,
        ]);
        expect(transport.getAllOrders.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', limit: 500 },
        ]]);
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw order history with exact zero cursor and maximum limit', async () => {
        const transport = {
            getAllOrders: vi.fn().mockResolvedValue([
                makeOrderHistoryEntry({ orderId: 0 }),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory('BTCUSDT', {
            orderId: 0,
            limit: 1000,
            symbol: 'ETHUSDT',
            recvWindow: 60000,
            timestamp: 123,
            accountWide: true,
            fallback: 'queryOrder',
            unknown: 'must-not-cross-the-transport-boundary',
        })).resolves.toMatchObject([{ orderId: 0, symbol: 'BTCUSDT' }]);
        expect(transport.getAllOrders.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', orderId: 0, limit: 1000 },
        ]]);
    });

    it.each([
        ['equal timestamps and minimum limit', 1000, 1000, 1],
        [
            'one millisecond below the maximum window and maximum limit',
            1000,
            1000 + (7 * 24 * 60 * 60 * 1000) - 1,
            1000,
        ],
    ])('transports an exact paired history window at %s', async (
        _label,
        startTime,
        endTime,
        limit,
    ) => {
        const transport = {
            getAllOrders: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory('BTCUSDT', {
            startTime,
            endTime,
            limit,
            recvWindow: 5000,
        })).resolves.toEqual([]);
        expect(transport.getAllOrders.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', startTime, endTime, limit },
        ]]);
    });

    it('uses the explicit local limit while stripping unknown default-mode keys', async () => {
        const requestBounds = {
            limit: undefined,
            orderId: undefined,
            startTime: undefined,
            endTime: undefined,
            recvWindow: 60000,
            accountWide: true,
            fallbackHint: 'getOpenOrders',
        };
        const snapshot = structuredClone(requestBounds);
        const transport = {
            getAllOrders: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory(
            'BTCUSDT',
            requestBounds,
        )).resolves.toEqual([]);
        expect(requestBounds).toEqual(snapshot);
        expect(transport.getAllOrders.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', limit: 500 },
        ]]);
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid order-history symbol %# before transport use',
        async (symbol) => {
            const transport = { getAllOrders: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getOrderHistory(symbol)).rejects.toThrowError(
                new FuturesOrderHistoryError(
                    FUTURES_ORDER_HISTORY_ERROR_CODES.INVALID_SYMBOL,
                    'Futures symbol must be a non-empty string',
                ),
            );
            expect(transport.getAllOrders).not.toHaveBeenCalled();
        },
    );

    it.each([null, 123, 'bounds', [], false, () => ({})])(
        'rejects non-record order-history request bounds %# before transport',
        async (requestBounds) => {
            const transport = { getAllOrders: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getOrderHistory(
                'BTCUSDT',
                requestBounds,
            )).rejects.toThrowError(new FuturesOrderHistoryError(
                FUTURES_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
                'Futures order-history request bounds are invalid',
            ));
            expect(transport.getAllOrders).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['zero', 0],
        ['negative', -1],
        ['above the official maximum', 1001],
        ['fractional', 1.5],
        ['a numeric string', '500'],
        ['unsafe', Number.MAX_SAFE_INTEGER + 1],
        ['NaN', NaN],
        ['infinite', Infinity],
        ['null', null],
        ['boolean', false],
    ])('rejects %s history limit before transport', async (_label, limit) => {
        const transport = { getAllOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory(
            'BTCUSDT',
            { limit },
        )).rejects.toThrowError(new FuturesOrderHistoryError(
            FUTURES_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures order-history request bounds are invalid',
        ));
        expect(transport.getAllOrders).not.toHaveBeenCalled();
    });

    it.each([
        ['null', null],
        ['negative', -1],
        ['fractional', 1.5],
        ['a numeric string', '1917647'],
        ['unsafe', Number.MAX_SAFE_INTEGER + 1],
        ['NaN', NaN],
        ['infinite', Infinity],
        ['boolean', false],
    ])('rejects %s history orderId before transport', async (_label, orderId) => {
        const transport = { getAllOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory(
            'BTCUSDT',
            { orderId },
        )).rejects.toThrowError(new FuturesOrderHistoryError(
            FUTURES_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures order-history request bounds are invalid',
        ));
        expect(transport.getAllOrders).not.toHaveBeenCalled();
    });

    it.each([
        ['cursor plus startTime', { orderId: 1, startTime: 1000 }],
        ['cursor plus endTime', { orderId: 1, endTime: 1000 }],
        ['cursor plus paired window', {
            orderId: 1,
            startTime: 1000,
            endTime: 2000,
        }],
    ])('rejects undocumented mixed %s mode before transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getAllOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesOrderHistoryError(
            FUTURES_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures order-history request bounds are invalid',
        ));
        expect(transport.getAllOrders).not.toHaveBeenCalled();
    });

    it.each([
        ['startTime only', { startTime: 1000 }],
        ['endTime only', { endTime: 2000 }],
        ['startTime plus explicitly undefined endTime', {
            startTime: 1000,
            endTime: undefined,
        }],
        ['endTime plus explicitly undefined startTime', {
            startTime: undefined,
            endTime: 2000,
        }],
    ])('rejects one-sided %s history window before transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getAllOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesOrderHistoryError(
            FUTURES_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures order-history request bounds are invalid',
        ));
        expect(transport.getAllOrders).not.toHaveBeenCalled();
    });

    it.each([
        ['negative startTime', { startTime: -1, endTime: 1000 }],
        ['fractional startTime', { startTime: 1.5, endTime: 1000 }],
        ['string startTime', { startTime: '0', endTime: 1000 }],
        ['unsafe startTime', {
            startTime: Number.MAX_SAFE_INTEGER + 1,
            endTime: Number.MAX_SAFE_INTEGER + 1,
        }],
        ['negative endTime', { startTime: 0, endTime: -1 }],
        ['fractional endTime', { startTime: 0, endTime: 1.5 }],
        ['string endTime', { startTime: 0, endTime: '1000' }],
        ['unsafe endTime', {
            startTime: 0,
            endTime: Number.MAX_SAFE_INTEGER + 1,
        }],
        ['null timestamps', { startTime: null, endTime: null }],
        ['boolean timestamps', { startTime: false, endTime: false }],
    ])('rejects %s before using the history transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getAllOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesOrderHistoryError(
            FUTURES_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures order-history request bounds are invalid',
        ));
        expect(transport.getAllOrders).not.toHaveBeenCalled();
    });

    it.each([
        ['a reversed window', 2000, 1000],
        ['an exactly seven-day window', 1000, 1000 + (7 * 24 * 60 * 60 * 1000)],
        [
            'an over-seven-day window',
            1000,
            1001 + (7 * 24 * 60 * 60 * 1000),
        ],
    ])('rejects %s before using the history transport', async (
        _label,
        startTime,
        endTime,
    ) => {
        const transport = { getAllOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory('BTCUSDT', {
            startTime,
            endTime,
        })).rejects.toThrowError(new FuturesOrderHistoryError(
            FUTURES_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures order-history request bounds are invalid',
        ));
        expect(transport.getAllOrders).not.toHaveBeenCalled();
    });

    it('preserves order-history transport error identity', async () => {
        const transportError = new Error('futures order-history unavailable');
        const transport = {
            getAllOrders: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory(
            'BTCUSDT',
            { limit: 25 },
        )).rejects.toBe(transportError);
        expect(transport.getAllOrders).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            limit: 25,
        });
    });

    it('preserves order-history response-body error identity', async () => {
        const responseError = new Error('futures order-history body unavailable');
        const data = vi.fn().mockRejectedValue(responseError);
        const transport = {
            getAllOrders: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory(
            'BTCUSDT',
            { orderId: 1917647 },
        )).rejects.toBe(responseError);
        expect(transport.getAllOrders).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            orderId: 1917647,
            limit: 500,
        });
        expect(data).toHaveBeenCalledWith();
    });

    it('preserves retention-driven empty history without fallback requests', async () => {
        const transport = {
            getAllOrders: vi.fn().mockResolvedValue([]),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
            getAllAlgoOrders: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory('BTCUSDT')).resolves.toEqual([]);
        expect(transport.getAllOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).not.toHaveBeenCalled();
        expect(transport.queryCurrentOpenOrder).not.toHaveBeenCalled();
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
        expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();
    });

    it('does not fall back across regular or algo endpoints on malformed history', async () => {
        const transport = {
            getAllOrders: vi.fn().mockResolvedValue([
                makeOrderHistoryEntry({ symbol: 'ETHUSDT' }),
            ]),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
            getAllAlgoOrders: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory('BTCUSDT')).rejects.toThrowError(
            new FuturesOrderHistoryError(
                FUTURES_ORDER_HISTORY_ERROR_CODES.SYMBOL_UNAVAILABLE,
                'Futures symbol "BTCUSDT" is unavailable in order-history response',
            ),
        );
        expect(transport.getAllOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).not.toHaveBeenCalled();
        expect(transport.queryCurrentOpenOrder).not.toHaveBeenCalled();
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
        expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();
    });

    it('keeps regular history and all five completed order transports independent', async () => {
        const transport = {
            getAllOrders: vi.fn().mockResolvedValue([makeOrderHistoryEntry()]),
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { orderId: 1917645 },
        )).resolves.toEqual(expectedCurrentOpenOrderQuery);
        await expect(adapter.getOrder(
            'BTCUSDT',
            { orderId: 1917643 },
        )).resolves.toEqual(expectedOrderQuery);
        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedOpenOrder,
        ]);
        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { algoId: 2146760 },
        )).resolves.toEqual(expectedAlgoOrderQuery);
        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedAlgoOpenOrder,
        ]);

        expect(transport.getAllOrders).not.toHaveBeenCalled();

        await expect(adapter.getOrderHistory('BTCUSDT')).resolves.toEqual([
            expectedOrderHistoryEntry,
        ]);
        expect(transport.getAllOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledTimes(1);
    });

    it('loads bounded symbol-scoped algo history from an official-client-style body', async () => {
        const data = vi.fn().mockResolvedValue([makeAlgoOrderHistoryEntry()]);
        const transport = {
            getAllAlgoOrders: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory('BTCUSDT')).resolves.toEqual([
            expectedAlgoOrderHistoryEntry,
        ]);
        expect(transport.getAllAlgoOrders.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', limit: 500 },
        ]]);
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw algo history with exact zero cursor and maximum limit', async () => {
        const transport = {
            getAllAlgoOrders: vi.fn().mockResolvedValue([
                makeAlgoOrderHistoryEntry({ algoId: 0 }),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory('BTCUSDT', {
            algoId: 0,
            limit: 1000,
            symbol: 'ETHUSDT',
            orderId: 1917647,
            recvWindow: 60000,
            timestamp: 123,
            accountWide: true,
            fallback: 'queryAlgoOrder',
            unknown: 'must-not-cross-the-transport-boundary',
        })).resolves.toMatchObject([{ algoId: 0, symbol: 'BTCUSDT' }]);
        expect(transport.getAllAlgoOrders.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', algoId: 0, limit: 1000 },
        ]]);
    });

    it.each([
        ['equal timestamps and minimum limit', 1000, 1000, 1],
        [
            'one millisecond below the maximum window and maximum limit',
            1000,
            1000 + (7 * 24 * 60 * 60 * 1000) - 1,
            1000,
        ],
    ])('transports an exact paired algo-history window at %s', async (
        _label,
        startTime,
        endTime,
        limit,
    ) => {
        const transport = {
            getAllAlgoOrders: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory('BTCUSDT', {
            startTime,
            endTime,
            limit,
            recvWindow: 5000,
        })).resolves.toEqual([]);
        expect(transport.getAllAlgoOrders.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', startTime, endTime, limit },
        ]]);
    });

    it('uses an explicit local algo limit while stripping unknown default-mode keys', async () => {
        const requestBounds = {
            limit: undefined,
            algoId: undefined,
            startTime: undefined,
            endTime: undefined,
            symbol: 'ETHUSDT',
            orderId: 1917647,
            recvWindow: 60000,
            timestamp: 123,
            accountWide: true,
            fallbackHint: 'getOpenAlgoOrders',
        };
        const snapshot = structuredClone(requestBounds);
        const transport = {
            getAllAlgoOrders: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory(
            'BTCUSDT',
            requestBounds,
        )).resolves.toEqual([]);
        expect(requestBounds).toEqual(snapshot);
        expect(transport.getAllAlgoOrders.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', limit: 500 },
        ]]);
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid algo-history symbol %# before transport use',
        async (symbol) => {
            const transport = { getAllAlgoOrders: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getAlgoOrderHistory(symbol)).rejects.toThrowError(
                new FuturesAlgoOrderHistoryError(
                    FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.INVALID_SYMBOL,
                    'Futures symbol must be a non-empty string',
                ),
            );
            expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();
        },
    );

    it.each([null, 123, 'bounds', [], false, () => ({})])(
        'rejects non-record algo-history request bounds %# before transport',
        async (requestBounds) => {
            const transport = { getAllAlgoOrders: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getAlgoOrderHistory(
                'BTCUSDT',
                requestBounds,
            )).rejects.toThrowError(new FuturesAlgoOrderHistoryError(
                FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
                'Futures algo-order-history request bounds are invalid',
            ));
            expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['zero', 0],
        ['negative', -1],
        ['above the official maximum', 1001],
        ['fractional', 1.5],
        ['a numeric string', '500'],
        ['unsafe', Number.MAX_SAFE_INTEGER + 1],
        ['NaN', NaN],
        ['infinite', Infinity],
        ['null', null],
        ['boolean', false],
    ])('rejects %s algo-history limit before transport', async (_label, limit) => {
        const transport = { getAllAlgoOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory(
            'BTCUSDT',
            { limit },
        )).rejects.toThrowError(new FuturesAlgoOrderHistoryError(
            FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures algo-order-history request bounds are invalid',
        ));
        expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();
    });

    it.each([
        ['null', null],
        ['negative', -1],
        ['fractional', 1.5],
        ['a numeric string', '2146760'],
        ['unsafe', Number.MAX_SAFE_INTEGER + 1],
        ['NaN', NaN],
        ['infinite', Infinity],
        ['boolean', false],
    ])('rejects %s history algoId before transport', async (_label, algoId) => {
        const transport = { getAllAlgoOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory(
            'BTCUSDT',
            { algoId },
        )).rejects.toThrowError(new FuturesAlgoOrderHistoryError(
            FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures algo-order-history request bounds are invalid',
        ));
        expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();
    });

    it.each([
        ['cursor plus startTime', { algoId: 1, startTime: 1000 }],
        ['cursor plus endTime', { algoId: 1, endTime: 1000 }],
        ['cursor plus paired window', {
            algoId: 1,
            startTime: 1000,
            endTime: 2000,
        }],
    ])('rejects undocumented mixed %s mode before algo transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getAllAlgoOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesAlgoOrderHistoryError(
            FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures algo-order-history request bounds are invalid',
        ));
        expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();
    });

    it.each([
        ['startTime only', { startTime: 1000 }],
        ['endTime only', { endTime: 2000 }],
        ['startTime plus explicitly undefined endTime', {
            startTime: 1000,
            endTime: undefined,
        }],
        ['endTime plus explicitly undefined startTime', {
            startTime: undefined,
            endTime: 2000,
        }],
    ])('rejects one-sided %s algo-history window before transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getAllAlgoOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesAlgoOrderHistoryError(
            FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures algo-order-history request bounds are invalid',
        ));
        expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();
    });

    it.each([
        ['negative startTime', { startTime: -1, endTime: 1000 }],
        ['fractional startTime', { startTime: 1.5, endTime: 1000 }],
        ['string startTime', { startTime: '0', endTime: 1000 }],
        ['unsafe startTime', {
            startTime: Number.MAX_SAFE_INTEGER + 1,
            endTime: Number.MAX_SAFE_INTEGER + 1,
        }],
        ['negative endTime', { startTime: 0, endTime: -1 }],
        ['fractional endTime', { startTime: 0, endTime: 1.5 }],
        ['string endTime', { startTime: 0, endTime: '1000' }],
        ['unsafe endTime', {
            startTime: 0,
            endTime: Number.MAX_SAFE_INTEGER + 1,
        }],
        ['null timestamps', { startTime: null, endTime: null }],
        ['boolean timestamps', { startTime: false, endTime: false }],
    ])('rejects %s before using the algo-history transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getAllAlgoOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesAlgoOrderHistoryError(
            FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures algo-order-history request bounds are invalid',
        ));
        expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();
    });

    it.each([
        ['a reversed window', 2000, 1000],
        ['an exactly seven-day window', 1000, 1000 + (7 * 24 * 60 * 60 * 1000)],
        [
            'an over-seven-day window',
            1000,
            1001 + (7 * 24 * 60 * 60 * 1000),
        ],
    ])('rejects %s before using the algo-history transport', async (
        _label,
        startTime,
        endTime,
    ) => {
        const transport = { getAllAlgoOrders: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory('BTCUSDT', {
            startTime,
            endTime,
        })).rejects.toThrowError(new FuturesAlgoOrderHistoryError(
            FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures algo-order-history request bounds are invalid',
        ));
        expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();
    });

    it('preserves algo-history transport error identity', async () => {
        const transportError = new Error('futures algo-order-history unavailable');
        const transport = {
            getAllAlgoOrders: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory(
            'BTCUSDT',
            { limit: 25 },
        )).rejects.toBe(transportError);
        expect(transport.getAllAlgoOrders).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            limit: 25,
        });
    });

    it('preserves algo-history response-body error identity', async () => {
        const responseError = new Error('futures algo-history body unavailable');
        const data = vi.fn().mockRejectedValue(responseError);
        const transport = {
            getAllAlgoOrders: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory(
            'BTCUSDT',
            { algoId: 2146760 },
        )).rejects.toBe(responseError);
        expect(transport.getAllAlgoOrders).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            algoId: 2146760,
            limit: 500,
        });
        expect(data).toHaveBeenCalledWith();
    });

    it('preserves retention-driven empty algo history without fallback requests', async () => {
        const transport = {
            getAllAlgoOrders: vi.fn().mockResolvedValue([]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
            getAllOrders: vi.fn().mockResolvedValue([makeOrderHistoryEntry()]),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory('BTCUSDT')).resolves.toEqual([]);
        expect(transport.getAllAlgoOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
        expect(transport.getAllOrders).not.toHaveBeenCalled();
        expect(transport.queryOrder).not.toHaveBeenCalled();
        expect(transport.queryCurrentOpenOrder).not.toHaveBeenCalled();
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
    });

    it('does not fall back across algo or regular endpoints on malformed history', async () => {
        const transport = {
            getAllAlgoOrders: vi.fn().mockResolvedValue([
                makeAlgoOrderHistoryEntry({ symbol: 'ETHUSDT' }),
            ]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
            getAllOrders: vi.fn().mockResolvedValue([makeOrderHistoryEntry()]),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAlgoOrderHistory(
            'BTCUSDT',
        )).rejects.toThrowError(new FuturesAlgoOrderHistoryError(
            FUTURES_ALGO_ORDER_HISTORY_ERROR_CODES.SYMBOL_UNAVAILABLE,
            'Futures symbol "BTCUSDT" is unavailable in algo-order-history response',
        ));
        expect(transport.getAllAlgoOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
        expect(transport.getAllOrders).not.toHaveBeenCalled();
        expect(transport.queryOrder).not.toHaveBeenCalled();
        expect(transport.queryCurrentOpenOrder).not.toHaveBeenCalled();
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
    });

    it('keeps algo history and all six completed order transports independent', async () => {
        const transport = {
            getAllAlgoOrders: vi.fn().mockResolvedValue([
                makeAlgoOrderHistoryEntry(),
            ]),
            getAllOrders: vi.fn().mockResolvedValue([makeOrderHistoryEntry()]),
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory('BTCUSDT')).resolves.toEqual([
            expectedOrderHistoryEntry,
        ]);
        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { orderId: 1917645 },
        )).resolves.toEqual(expectedCurrentOpenOrderQuery);
        await expect(adapter.getOrder(
            'BTCUSDT',
            { orderId: 1917643 },
        )).resolves.toEqual(expectedOrderQuery);
        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedOpenOrder,
        ]);
        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { algoId: 2146760 },
        )).resolves.toEqual(expectedAlgoOrderQuery);
        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedAlgoOpenOrder,
        ]);

        expect(transport.getAllAlgoOrders).not.toHaveBeenCalled();

        await expect(adapter.getAlgoOrderHistory('BTCUSDT')).resolves.toEqual([
            expectedAlgoOrderHistoryEntry,
        ]);
        expect(transport.getAllAlgoOrders).toHaveBeenCalledTimes(1);
        expect(transport.getAllOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledTimes(1);
    });

    it('loads bounded account trades from an official-client-style body', async () => {
        const data = vi.fn().mockResolvedValue([makeAccountTradeHistoryEntry()]);
        const transport = {
            getAccountTrades: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory('BTCUSDT')).resolves.toEqual([
            expectedAccountTradeHistoryEntry,
        ]);
        expect(transport.getAccountTrades.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', limit: 500 },
        ]]);
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw account trades with an exact zero order ID and maximum limit', async () => {
        const transport = {
            getAccountTrades: vi.fn().mockResolvedValue([
                makeAccountTradeHistoryEntry({ orderId: 0 }),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory('BTCUSDT', {
            orderId: 0,
            limit: 1000,
            symbol: 'ETHUSDT',
            recvWindow: 60000,
            timestamp: 123,
            accountWide: true,
            fallback: 'getAllOrders',
            unknown: 'must-not-cross-the-transport-boundary',
        })).resolves.toMatchObject([{ orderId: 0, symbol: 'BTCUSDT' }]);
        expect(transport.getAccountTrades.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', orderId: 0, limit: 1000 },
        ]]);
    });

    it('sends the inclusive trade-ID cursor without caller-owned request keys', async () => {
        const requestBounds = {
            fromId: 0,
            limit: 25,
            symbol: 'ETHUSDT',
            orderId: undefined,
            startTime: undefined,
            endTime: undefined,
            recvWindow: 5000,
            timestamp: 123,
            accountWide: true,
            fallbackHint: 'getRecentTrades',
        };
        const snapshot = structuredClone(requestBounds);
        const transport = {
            getAccountTrades: vi.fn().mockResolvedValue([
                makeAccountTradeHistoryEntry({ id: 0 }),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
            requestBounds,
        )).resolves.toMatchObject([{ id: 0, symbol: 'BTCUSDT' }]);
        expect(requestBounds).toEqual(snapshot);
        expect(transport.getAccountTrades.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', fromId: 0, limit: 25 },
        ]]);
    });

    it.each([
        ['equal timestamps and minimum limit', 1000, 1000, 1],
        [
            'the exact live-documented maximum window and maximum limit',
            1000,
            1000 + (7 * 24 * 60 * 60 * 1000),
            1000,
        ],
    ])('transports an exact paired account-trade window at %s', async (
        _label,
        startTime,
        endTime,
        limit,
    ) => {
        const transport = {
            getAccountTrades: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory('BTCUSDT', {
            startTime,
            endTime,
            limit,
            recvWindow: 5000,
            timestamp: 123,
        })).resolves.toEqual([]);
        expect(transport.getAccountTrades.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', startTime, endTime, limit },
        ]]);
    });

    it('uses an explicit live limit while stripping unknown default-mode keys', async () => {
        const requestBounds = {
            limit: undefined,
            orderId: undefined,
            fromId: undefined,
            startTime: undefined,
            endTime: undefined,
            symbol: 'ETHUSDT',
            recvWindow: 60000,
            timestamp: 123,
            accountWide: true,
            fallbackHint: 'getAccountTradeHistoryPage',
            unknown: true,
        };
        const snapshot = structuredClone(requestBounds);
        const transport = {
            getAccountTrades: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
            requestBounds,
        )).resolves.toEqual([]);
        expect(requestBounds).toEqual(snapshot);
        expect(transport.getAccountTrades.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', limit: 500 },
        ]]);
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid account-trade-history symbol %# before transport use',
        async (symbol) => {
            const transport = { getAccountTrades: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getAccountTradeHistory(symbol)).rejects.toThrowError(
                new FuturesAccountTradeHistoryError(
                    FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.INVALID_SYMBOL,
                    'Futures symbol must be a non-empty string',
                ),
            );
            expect(transport.getAccountTrades).not.toHaveBeenCalled();
        },
    );

    it.each([null, 123, 'bounds', [], false, () => ({})])(
        'rejects non-record account-trade request bounds %# before transport',
        async (requestBounds) => {
            const transport = { getAccountTrades: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getAccountTradeHistory(
                'BTCUSDT',
                requestBounds,
            )).rejects.toThrowError(new FuturesAccountTradeHistoryError(
                FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
                'Futures account-trade-history request bounds are invalid',
            ));
            expect(transport.getAccountTrades).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['zero', 0],
        ['negative', -1],
        ['above the official maximum', 1001],
        ['fractional', 1.5],
        ['a numeric string', '500'],
        ['unsafe', Number.MAX_SAFE_INTEGER + 1],
        ['NaN', NaN],
        ['infinite', Infinity],
        ['null', null],
        ['boolean', false],
    ])('rejects %s account-trade limit before transport', async (_label, limit) => {
        const transport = { getAccountTrades: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
            { limit },
        )).rejects.toThrowError(new FuturesAccountTradeHistoryError(
            FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures account-trade-history request bounds are invalid',
        ));
        expect(transport.getAccountTrades).not.toHaveBeenCalled();
    });

    it.each([
        ['orderId', null],
        ['orderId', -1],
        ['orderId', 1.5],
        ['orderId', '25851813'],
        ['orderId', Number.MAX_SAFE_INTEGER + 1],
        ['orderId', NaN],
        ['orderId', Infinity],
        ['orderId', false],
        ['fromId', null],
        ['fromId', -1],
        ['fromId', 1.5],
        ['fromId', '698759'],
        ['fromId', Number.MAX_SAFE_INTEGER + 1],
        ['fromId', NaN],
        ['fromId', Infinity],
        ['fromId', false],
    ])('rejects invalid account-trade %s %# before transport', async (
        field,
        value,
    ) => {
        const transport = { getAccountTrades: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
            { [field]: value },
        )).rejects.toThrowError(new FuturesAccountTradeHistoryError(
            FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures account-trade-history request bounds are invalid',
        ));
        expect(transport.getAccountTrades).not.toHaveBeenCalled();
    });

    it.each([
        ['order ID plus trade ID', { orderId: 1, fromId: 2 }],
        ['order ID plus startTime', { orderId: 1, startTime: 1000 }],
        ['order ID plus endTime', { orderId: 1, endTime: 2000 }],
        ['order ID plus paired window', {
            orderId: 1,
            startTime: 1000,
            endTime: 2000,
        }],
        ['trade ID plus startTime', { fromId: 1, startTime: 1000 }],
        ['trade ID plus endTime', { fromId: 1, endTime: 2000 }],
        ['trade ID plus paired window', {
            fromId: 1,
            startTime: 1000,
            endTime: 2000,
        }],
    ])('rejects undocumented mixed %s mode before account-trade transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getAccountTrades: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesAccountTradeHistoryError(
            FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures account-trade-history request bounds are invalid',
        ));
        expect(transport.getAccountTrades).not.toHaveBeenCalled();
    });

    it.each([
        ['startTime only', { startTime: 1000 }],
        ['endTime only', { endTime: 2000 }],
        ['startTime plus explicitly undefined endTime', {
            startTime: 1000,
            endTime: undefined,
        }],
        ['endTime plus explicitly undefined startTime', {
            startTime: undefined,
            endTime: 2000,
        }],
    ])('rejects one-sided %s account-trade window before transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getAccountTrades: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesAccountTradeHistoryError(
            FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures account-trade-history request bounds are invalid',
        ));
        expect(transport.getAccountTrades).not.toHaveBeenCalled();
    });

    it.each([
        ['negative startTime', { startTime: -1, endTime: 1000 }],
        ['fractional startTime', { startTime: 1.5, endTime: 1000 }],
        ['string startTime', { startTime: '0', endTime: 1000 }],
        ['unsafe startTime', {
            startTime: Number.MAX_SAFE_INTEGER + 1,
            endTime: Number.MAX_SAFE_INTEGER + 1,
        }],
        ['negative endTime', { startTime: 0, endTime: -1 }],
        ['fractional endTime', { startTime: 0, endTime: 1.5 }],
        ['string endTime', { startTime: 0, endTime: '1000' }],
        ['unsafe endTime', {
            startTime: 0,
            endTime: Number.MAX_SAFE_INTEGER + 1,
        }],
        ['null timestamps', { startTime: null, endTime: null }],
        ['boolean timestamps', { startTime: false, endTime: false }],
    ])('rejects %s before using the account-trade transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getAccountTrades: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesAccountTradeHistoryError(
            FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures account-trade-history request bounds are invalid',
        ));
        expect(transport.getAccountTrades).not.toHaveBeenCalled();
    });

    it.each([
        ['a reversed window', 2000, 1000],
        [
            'a window one millisecond over seven days',
            1000,
            1001 + (7 * 24 * 60 * 60 * 1000),
        ],
    ])('rejects %s before using the account-trade transport', async (
        _label,
        startTime,
        endTime,
    ) => {
        const transport = { getAccountTrades: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory('BTCUSDT', {
            startTime,
            endTime,
        })).rejects.toThrowError(new FuturesAccountTradeHistoryError(
            FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures account-trade-history request bounds are invalid',
        ));
        expect(transport.getAccountTrades).not.toHaveBeenCalled();
    });

    it('preserves account-trade transport error identity', async () => {
        const transportError = new Error('futures account-trades unavailable');
        const transport = {
            getAccountTrades: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
            { limit: 25 },
        )).rejects.toBe(transportError);
        expect(transport.getAccountTrades).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            limit: 25,
        });
    });

    it('preserves account-trade response-body error identity', async () => {
        const responseError = new Error('futures account-trade body unavailable');
        const data = vi.fn().mockRejectedValue(responseError);
        const transport = {
            getAccountTrades: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
            { fromId: 698759 },
        )).rejects.toBe(responseError);
        expect(transport.getAccountTrades).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            fromId: 698759,
            limit: 500,
        });
        expect(data).toHaveBeenCalledWith();
    });

    it('preserves retention-driven empty account trades without fallback reads', async () => {
        const transport = {
            getAccountTrades: vi.fn().mockResolvedValue([]),
            getAllOrders: vi.fn(),
            getAllAlgoOrders: vi.fn(),
            queryOrder: vi.fn(),
            queryCurrentOpenOrder: vi.fn(),
            getOpenOrders: vi.fn(),
            queryAlgoOrder: vi.fn(),
            getOpenAlgoOrders: vi.fn(),
            getPositionRiskV3: vi.fn(),
            getBalanceV3: vi.fn(),
            getIncomeHistory: vi.fn(),
            getRecentTrades: vi.fn(),
            accountTradeList: vi.fn(),
            getAccountTradeHistoryPage: vi.fn(),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory('BTCUSDT')).resolves.toEqual([]);
        expect(transport.getAccountTrades).toHaveBeenCalledTimes(1);
        Object.entries(transport)
            .filter(([name]) => name !== 'getAccountTrades')
            .forEach(([, method]) => expect(method).not.toHaveBeenCalled());
    });

    it('does not fall back on unavailable account-trade history', async () => {
        const fallbackMethods = {
            getAllOrders: vi.fn(),
            getAllAlgoOrders: vi.fn(),
            queryOrder: vi.fn(),
            queryCurrentOpenOrder: vi.fn(),
            getOpenOrders: vi.fn(),
            queryAlgoOrder: vi.fn(),
            getOpenAlgoOrders: vi.fn(),
            getPositionRiskV3: vi.fn(),
            getBalanceV3: vi.fn(),
            getIncomeHistory: vi.fn(),
            getRecentTrades: vi.fn(),
            accountTradeList: vi.fn(),
            getAccountTradeHistoryPage: vi.fn(),
        };
        const transport = {
            getAccountTrades: vi.fn().mockResolvedValue([
                makeAccountTradeHistoryEntry({ symbol: 'ETHUSDT' }),
            ]),
            ...fallbackMethods,
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
        )).rejects.toThrowError(new FuturesAccountTradeHistoryError(
            FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.SYMBOL_UNAVAILABLE,
            'Futures symbol "BTCUSDT" is unavailable in account-trade-history response',
        ));
        expect(transport.getAccountTrades).toHaveBeenCalledTimes(1);
        Object.values(fallbackMethods)
            .forEach((method) => expect(method).not.toHaveBeenCalled());
    });

    it('does not fall back on malformed account-trade history', async () => {
        const fallbackMethods = {
            getAllOrders: vi.fn(),
            getAllAlgoOrders: vi.fn(),
            queryOrder: vi.fn(),
            queryCurrentOpenOrder: vi.fn(),
            getOpenOrders: vi.fn(),
            queryAlgoOrder: vi.fn(),
            getOpenAlgoOrders: vi.fn(),
            getPositionRiskV3: vi.fn(),
            getBalanceV3: vi.fn(),
            getIncomeHistory: vi.fn(),
            getRecentTrades: vi.fn(),
            accountTradeList: vi.fn(),
            getAccountTradeHistoryPage: vi.fn(),
        };
        const transport = {
            getAccountTrades: vi.fn().mockResolvedValue([
                makeAccountTradeHistoryEntry({ id: '698759' }),
            ]),
            ...fallbackMethods,
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getAccountTradeHistory(
            'BTCUSDT',
        )).rejects.toThrowError(new FuturesAccountTradeHistoryError(
            FUTURES_ACCOUNT_TRADE_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures account-trade-history response',
        ));
        expect(transport.getAccountTrades).toHaveBeenCalledTimes(1);
        Object.values(fallbackMethods)
            .forEach((method) => expect(method).not.toHaveBeenCalled());
    });

    it('keeps account trades and every completed order transport independent', async () => {
        const transport = {
            getAccountTrades: vi.fn().mockResolvedValue([
                makeAccountTradeHistoryEntry(),
            ]),
            getAllAlgoOrders: vi.fn().mockResolvedValue([
                makeAlgoOrderHistoryEntry(),
            ]),
            getAllOrders: vi.fn().mockResolvedValue([makeOrderHistoryEntry()]),
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getOrderHistory('BTCUSDT')).resolves.toEqual([
            expectedOrderHistoryEntry,
        ]);
        await expect(adapter.getAlgoOrderHistory('BTCUSDT')).resolves.toEqual([
            expectedAlgoOrderHistoryEntry,
        ]);
        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { orderId: 1917645 },
        )).resolves.toEqual(expectedCurrentOpenOrderQuery);
        await expect(adapter.getOrder(
            'BTCUSDT',
            { orderId: 1917643 },
        )).resolves.toEqual(expectedOrderQuery);
        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedOpenOrder,
        ]);
        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { algoId: 2146760 },
        )).resolves.toEqual(expectedAlgoOrderQuery);
        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedAlgoOpenOrder,
        ]);

        expect(transport.getAccountTrades).not.toHaveBeenCalled();

        await expect(adapter.getAccountTradeHistory('BTCUSDT')).resolves.toEqual([
            expectedAccountTradeHistoryEntry,
        ]);
        expect(transport.getAccountTrades).toHaveBeenCalledTimes(1);
        expect(transport.getAllAlgoOrders).toHaveBeenCalledTimes(1);
        expect(transport.getAllOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledTimes(1);
    });

    it('loads one bounded income page from an official-client-style body', async () => {
        const data = vi.fn().mockResolvedValue([makeIncomeHistoryEntry()]);
        const transport = {
            getIncomeHistory: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory('BTCUSDT')).resolves.toEqual([
            expectedIncomeHistoryEntry,
        ]);
        expect(transport.getIncomeHistory.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', page: 1, limit: 100 },
        ]]);
        expect(data).toHaveBeenCalledWith();
    });

    it('accepts raw income while sending only the reviewed filter and bounds', async () => {
        const requestBounds = {
            incomeType: 'COMMISSION_REBATE',
            limit: 1000,
            symbol: 'ETHUSDT',
            recvWindow: 60000,
            timestamp: 123,
            accountWide: true,
            includeAccountWide: true,
            cursor: 'next-page',
            fromId: 9689322392,
            fallback: 'getAccountTrades',
            unknown: 'must-not-cross-the-transport-boundary',
        };
        const snapshot = structuredClone(requestBounds);
        const transport = {
            getIncomeHistory: vi.fn().mockResolvedValue([
                makeIncomeHistoryEntry({ incomeType: 'COMMISSION_REBATE' }),
            ]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory(
            'BTCUSDT',
            requestBounds,
        )).resolves.toMatchObject([{
            symbol: 'BTCUSDT',
            incomeType: 'COMMISSION_REBATE',
        }]);
        expect(requestBounds).toEqual(snapshot);
        expect(transport.getIncomeHistory.mock.calls).toEqual([[
            {
                symbol: 'BTCUSDT',
                incomeType: 'COMMISSION_REBATE',
                page: 1,
                limit: 1000,
            },
        ]]);
    });

    it.each([
        ['equal inclusive timestamps and minimum limit', 1000, 1000, 1],
        [
            'the exact local seven-day ceiling and maximum limit',
            1000,
            1000 + (7 * 24 * 60 * 60 * 1000),
            1000,
        ],
    ])('transports an exact paired income window at %s', async (
        _label,
        startTime,
        endTime,
        limit,
    ) => {
        const transport = {
            getIncomeHistory: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory('BTCUSDT', {
            incomeType: 'FUNDING_FEE',
            startTime,
            endTime,
            limit,
        })).resolves.toEqual([]);
        expect(transport.getIncomeHistory.mock.calls).toEqual([[
            {
                symbol: 'BTCUSDT',
                incomeType: 'FUNDING_FEE',
                startTime,
                endTime,
                page: 1,
                limit,
            },
        ]]);
    });

    it.each([
        'TRANSFER',
        'WELCOME_BONUS',
        'REALIZED_PNL',
        'FUNDING_FEE',
        'COMMISSION',
        'INSURANCE_CLEAR',
        'REFERRAL_KICKBACK',
        'COMMISSION_REBATE',
        'API_REBATE',
        'CONTEST_REWARD',
        'CROSS_COLLATERAL_TRANSFER',
        'OPTIONS_PREMIUM_FEE',
        'OPTIONS_SETTLE_PROFIT',
        'INTERNAL_TRANSFER',
        'AUTO_EXCHANGE',
        'DELIVERED_SETTELMENT',
        'COIN_SWAP_DEPOSIT',
        'COIN_SWAP_WITHDRAW',
        'POSITION_LIMIT_INCREASE_FEE',
        'STRATEGY_UMFUTURES_TRANSFER',
        'FEE_RETURN',
        'BFUSD_REWARD',
    ])('transports reviewed income-type filter %s exactly', async (incomeType) => {
        const transport = {
            getIncomeHistory: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory(
            'BTCUSDT',
            { incomeType },
        )).resolves.toEqual([]);
        expect(transport.getIncomeHistory).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            incomeType,
            page: 1,
            limit: 100,
        });
    });

    it('uses a fixed first page and explicit live limit in default mode', async () => {
        const requestBounds = {
            incomeType: undefined,
            startTime: undefined,
            endTime: undefined,
            page: undefined,
            limit: undefined,
            symbol: 'ETHUSDT',
            recvWindow: 60000,
            timestamp: 123,
            accountWide: true,
            cursor: 'opaque-cursor',
            nextPage: true,
            fallbackHint: 'getIncomeHistoryPage',
            unknown: true,
        };
        const snapshot = structuredClone(requestBounds);
        const transport = {
            getIncomeHistory: vi.fn().mockResolvedValue([]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory(
            'BTCUSDT',
            requestBounds,
        )).resolves.toEqual([]);
        expect(requestBounds).toEqual(snapshot);
        expect(transport.getIncomeHistory.mock.calls).toEqual([[
            { symbol: 'BTCUSDT', page: 1, limit: 100 },
        ]]);
    });

    it.each([undefined, null, 123, '', '   '])(
        'rejects invalid income-history symbol %# before transport use',
        async (symbol) => {
            const transport = { getIncomeHistory: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getIncomeHistory(symbol)).rejects.toThrowError(
                new FuturesIncomeHistoryError(
                    FUTURES_INCOME_HISTORY_ERROR_CODES.INVALID_SYMBOL,
                    'Futures symbol must be a non-empty string',
                ),
            );
            expect(transport.getIncomeHistory).not.toHaveBeenCalled();
        },
    );

    it.each([null, 123, 'bounds', [], false, () => ({})])(
        'rejects non-record income request bounds %# before transport',
        async (requestBounds) => {
            const transport = { getIncomeHistory: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getIncomeHistory(
                'BTCUSDT',
                requestBounds,
            )).rejects.toThrowError(new FuturesIncomeHistoryError(
                FUTURES_INCOME_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
                'Futures income-history request bounds are invalid',
            ));
            expect(transport.getIncomeHistory).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['zero', 0],
        ['negative', -1],
        ['above the official maximum', 1001],
        ['fractional', 1.5],
        ['a numeric string', '100'],
        ['unsafe', Number.MAX_SAFE_INTEGER + 1],
        ['NaN', NaN],
        ['infinite', Infinity],
        ['null', null],
        ['boolean', false],
    ])('rejects %s income limit before transport', async (_label, limit) => {
        const transport = { getIncomeHistory: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory(
            'BTCUSDT',
            { limit },
        )).rejects.toThrowError(new FuturesIncomeHistoryError(
            FUTURES_INCOME_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures income-history request bounds are invalid',
        ));
        expect(transport.getIncomeHistory).not.toHaveBeenCalled();
    });

    it.each([
        ['an empty string', ''],
        ['whitespace', '   '],
        ['a case mismatch', 'commission'],
        ['an undocumented filter', 'FUTURE_NEW_INCOME_TYPE'],
        ['a number', 123],
        ['null', null],
        ['a boolean', false],
    ])('rejects %s as an income-type filter before transport', async (
        _label,
        incomeType,
    ) => {
        const transport = { getIncomeHistory: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory(
            'BTCUSDT',
            { incomeType },
        )).rejects.toThrowError(new FuturesIncomeHistoryError(
            FUTURES_INCOME_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures income-history request bounds are invalid',
        ));
        expect(transport.getIncomeHistory).not.toHaveBeenCalled();
    });

    it.each([1, 2, 0, -1, null, '1', false])(
        'rejects caller-controlled income page %# before transport',
        async (page) => {
            const transport = { getIncomeHistory: vi.fn() };
            const adapter = new FuturesTradingAdapter({ transport });

            await expect(adapter.getIncomeHistory(
                'BTCUSDT',
                { page },
            )).rejects.toThrowError(new FuturesIncomeHistoryError(
                FUTURES_INCOME_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
                'Futures income-history request bounds are invalid',
            ));
            expect(transport.getIncomeHistory).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['startTime only', { startTime: 1000 }],
        ['endTime only', { endTime: 2000 }],
        ['startTime plus explicitly undefined endTime', {
            startTime: 1000,
            endTime: undefined,
        }],
        ['endTime plus explicitly undefined startTime', {
            startTime: undefined,
            endTime: 2000,
        }],
    ])('rejects one-sided %s income window before transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getIncomeHistory: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesIncomeHistoryError(
            FUTURES_INCOME_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures income-history request bounds are invalid',
        ));
        expect(transport.getIncomeHistory).not.toHaveBeenCalled();
    });

    it.each([
        ['negative startTime', { startTime: -1, endTime: 1000 }],
        ['fractional startTime', { startTime: 1.5, endTime: 1000 }],
        ['string startTime', { startTime: '0', endTime: 1000 }],
        ['unsafe startTime', {
            startTime: Number.MAX_SAFE_INTEGER + 1,
            endTime: Number.MAX_SAFE_INTEGER + 1,
        }],
        ['negative endTime', { startTime: 0, endTime: -1 }],
        ['fractional endTime', { startTime: 0, endTime: 1.5 }],
        ['string endTime', { startTime: 0, endTime: '1000' }],
        ['unsafe endTime', {
            startTime: 0,
            endTime: Number.MAX_SAFE_INTEGER + 1,
        }],
        ['null timestamps', { startTime: null, endTime: null }],
        ['boolean timestamps', { startTime: false, endTime: false }],
    ])('rejects %s before using the income transport', async (
        _label,
        requestBounds,
    ) => {
        const transport = { getIncomeHistory: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory(
            'BTCUSDT',
            requestBounds,
        )).rejects.toThrowError(new FuturesIncomeHistoryError(
            FUTURES_INCOME_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures income-history request bounds are invalid',
        ));
        expect(transport.getIncomeHistory).not.toHaveBeenCalled();
    });

    it.each([
        ['a reversed window', 2000, 1000],
        [
            'a window one millisecond over the local seven-day ceiling',
            1000,
            1001 + (7 * 24 * 60 * 60 * 1000),
        ],
    ])('rejects %s before using the income transport', async (
        _label,
        startTime,
        endTime,
    ) => {
        const transport = { getIncomeHistory: vi.fn() };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory('BTCUSDT', {
            startTime,
            endTime,
        })).rejects.toThrowError(new FuturesIncomeHistoryError(
            FUTURES_INCOME_HISTORY_ERROR_CODES.INVALID_REQUEST_BOUNDS,
            'Futures income-history request bounds are invalid',
        ));
        expect(transport.getIncomeHistory).not.toHaveBeenCalled();
    });

    it('preserves income transport error identity', async () => {
        const transportError = new Error('futures income unavailable');
        const transport = {
            getIncomeHistory: vi.fn().mockRejectedValue(transportError),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory(
            'BTCUSDT',
            { incomeType: 'COMMISSION', limit: 25 },
        )).rejects.toBe(transportError);
        expect(transport.getIncomeHistory).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            incomeType: 'COMMISSION',
            page: 1,
            limit: 25,
        });
    });

    it('preserves income response-body error identity', async () => {
        const responseError = new Error('futures income body unavailable');
        const data = vi.fn().mockRejectedValue(responseError);
        const transport = {
            getIncomeHistory: vi.fn().mockResolvedValue({ data }),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory('BTCUSDT', {
            startTime: 1000,
            endTime: 2000,
        })).rejects.toBe(responseError);
        expect(transport.getIncomeHistory).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            startTime: 1000,
            endTime: 2000,
            page: 1,
            limit: 100,
        });
        expect(data).toHaveBeenCalledWith();
    });

    it('preserves retention-driven empty income without fallback or another page', async () => {
        const transport = {
            getIncomeHistory: vi.fn().mockResolvedValue([]),
            getIncomeHistoryPage: vi.fn(),
            incomeHistory: vi.fn(),
            getAccountTrades: vi.fn(),
            getAllOrders: vi.fn(),
            getAllAlgoOrders: vi.fn(),
            queryOrder: vi.fn(),
            queryCurrentOpenOrder: vi.fn(),
            getOpenOrders: vi.fn(),
            queryAlgoOrder: vi.fn(),
            getOpenAlgoOrders: vi.fn(),
            getPositionRiskV3: vi.fn(),
            getBalanceV3: vi.fn(),
            getRecentTrades: vi.fn(),
            myTrades: vi.fn(),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory('BTCUSDT')).resolves.toEqual([]);
        expect(transport.getIncomeHistory).toHaveBeenCalledTimes(1);
        Object.entries(transport)
            .filter(([name]) => name !== 'getIncomeHistory')
            .forEach(([, method]) => expect(method).not.toHaveBeenCalled());
    });

    it('does not fall back on unavailable symbol-scoped income history', async () => {
        const fallbackMethods = {
            getIncomeHistoryPage: vi.fn(),
            incomeHistory: vi.fn(),
            getAccountTrades: vi.fn(),
            getAllOrders: vi.fn(),
            getAllAlgoOrders: vi.fn(),
            getPositionRiskV3: vi.fn(),
            getBalanceV3: vi.fn(),
            getRecentTrades: vi.fn(),
        };
        const transport = {
            getIncomeHistory: vi.fn().mockResolvedValue([
                makeIncomeHistoryEntry({ symbol: 'ETHUSDT' }),
            ]),
            ...fallbackMethods,
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory(
            'BTCUSDT',
        )).rejects.toThrowError(new FuturesIncomeHistoryError(
            FUTURES_INCOME_HISTORY_ERROR_CODES.SYMBOL_UNAVAILABLE,
            'Futures symbol "BTCUSDT" is unavailable in income-history response',
        ));
        expect(transport.getIncomeHistory).toHaveBeenCalledTimes(1);
        Object.values(fallbackMethods)
            .forEach((method) => expect(method).not.toHaveBeenCalled());
    });

    it('does not fall back on malformed income history', async () => {
        const fallbackMethods = {
            getIncomeHistoryPage: vi.fn(),
            incomeHistory: vi.fn(),
            getAccountTrades: vi.fn(),
            getAllOrders: vi.fn(),
            getAllAlgoOrders: vi.fn(),
            getPositionRiskV3: vi.fn(),
            getBalanceV3: vi.fn(),
            getRecentTrades: vi.fn(),
        };
        const transport = {
            getIncomeHistory: vi.fn().mockResolvedValue([
                makeIncomeHistoryEntry({ tranId: '9689322392' }),
            ]),
            ...fallbackMethods,
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getIncomeHistory(
            'BTCUSDT',
        )).rejects.toThrowError(new FuturesIncomeHistoryError(
            FUTURES_INCOME_HISTORY_ERROR_CODES.MALFORMED_RESPONSE,
            'Malformed futures income-history response',
        ));
        expect(transport.getIncomeHistory).toHaveBeenCalledTimes(1);
        Object.values(fallbackMethods)
            .forEach((method) => expect(method).not.toHaveBeenCalled());
    });

    it('keeps income and all thirteen completed futures transports independent', async () => {
        const transport = {
            getExchangeInfo: vi.fn().mockResolvedValue(
                makeExchangeInfo(makeFuturesSymbol()),
            ),
            getMarkPrice: vi.fn().mockResolvedValue(makeMarkPrice()),
            getPositionRiskV3: vi.fn().mockResolvedValue([makePositionRisk()]),
            getBalanceV3: vi.fn().mockResolvedValue([makeAccountBalance()]),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
            queryAlgoOrder: vi.fn().mockResolvedValue(makeAlgoOrderQuery()),
            queryOrder: vi.fn().mockResolvedValue(makeOrderQuery()),
            queryCurrentOpenOrder: vi.fn().mockResolvedValue(
                makeCurrentOpenOrderQuery(),
            ),
            getAllOrders: vi.fn().mockResolvedValue([makeOrderHistoryEntry()]),
            getAllAlgoOrders: vi.fn().mockResolvedValue([
                makeAlgoOrderHistoryEntry(),
            ]),
            getAccountTrades: vi.fn().mockResolvedValue([
                makeAccountTradeHistoryEntry(),
            ]),
            getIncomeHistory: vi.fn().mockResolvedValue([makeIncomeHistoryEntry()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getExchangeInfo('BTCUSDT')).resolves.toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
        });
        await expect(adapter.getMarkPrice('BTCUSDT')).resolves.toEqual(
            expectedMarkPrice,
        );
        await expect(adapter.getFundingState('BTCUSDT')).resolves.toEqual(
            expectedFundingState,
        );
        await expect(adapter.getPositionRisk(
            'BTCUSDT',
            'BOTH',
        )).resolves.toEqual(expectedPositionRisk);
        await expect(adapter.getAccountBalance('USDT')).resolves.toEqual(
            expectedAccountBalance,
        );
        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedOpenOrder,
        ]);
        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toEqual([
            expectedAlgoOpenOrder,
        ]);
        await expect(adapter.getAlgoOrder(
            'BTCUSDT',
            { algoId: 2146760 },
        )).resolves.toEqual(expectedAlgoOrderQuery);
        await expect(adapter.getOrder(
            'BTCUSDT',
            { orderId: 1917643 },
        )).resolves.toEqual(expectedOrderQuery);
        await expect(adapter.getCurrentOpenOrder(
            'BTCUSDT',
            { orderId: 1917645 },
        )).resolves.toEqual(expectedCurrentOpenOrderQuery);
        await expect(adapter.getOrderHistory('BTCUSDT')).resolves.toEqual([
            expectedOrderHistoryEntry,
        ]);
        await expect(adapter.getAlgoOrderHistory('BTCUSDT')).resolves.toEqual([
            expectedAlgoOrderHistoryEntry,
        ]);
        await expect(adapter.getAccountTradeHistory('BTCUSDT')).resolves.toEqual([
            expectedAccountTradeHistoryEntry,
        ]);

        expect(transport.getIncomeHistory).not.toHaveBeenCalled();

        await expect(adapter.getIncomeHistory('BTCUSDT')).resolves.toEqual([
            expectedIncomeHistoryEntry,
        ]);
        expect(transport.getIncomeHistory).toHaveBeenCalledTimes(1);
        expect(transport.getExchangeInfo).toHaveBeenCalledTimes(1);
        expect(transport.getMarkPrice).toHaveBeenCalledTimes(2);
        expect(transport.getPositionRiskV3).toHaveBeenCalledTimes(1);
        expect(transport.getBalanceV3).toHaveBeenCalledTimes(1);
        expect(transport.getOpenOrders).toHaveBeenCalledTimes(1);
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledTimes(1);
        expect(transport.queryAlgoOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryOrder).toHaveBeenCalledTimes(1);
        expect(transport.queryCurrentOpenOrder).toHaveBeenCalledTimes(1);
        expect(transport.getAllOrders).toHaveBeenCalledTimes(1);
        expect(transport.getAllAlgoOrders).toHaveBeenCalledTimes(1);
        expect(transport.getAccountTrades).toHaveBeenCalledTimes(1);
    });

    it('loads current mark and funding state through one premium-index request', async () => {
        const transport = {
            getMarkPrice: vi.fn().mockResolvedValue(makeMarkPrice()),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getCurrentMarketState('BTCUSDT')).resolves.toEqual({
            markPrice: expectedMarkPrice,
            fundingState: expectedFundingState,
        });
        expect(transport.getMarkPrice).toHaveBeenCalledOnce();
        expect(transport.getMarkPrice).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
    });

    it('loads all current position identities through one symbol-scoped V3 request', async () => {
        const source = [
            makePositionRisk({ positionSide: 'LONG', unRealizedProfit: '1.25000000' }),
            makePositionRisk({ positionSide: 'SHORT', unRealizedProfit: '-0.75000000' }),
        ];
        const transport = {
            getPositionRiskV3: vi.fn().mockResolvedValue(source),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getPositionRisks('BTCUSDT')).resolves.toEqual([
            { ...expectedPositionRisk, positionSide: 'LONG', unRealizedProfit: '1.25000000' },
            { ...expectedPositionRisk, positionSide: 'SHORT', unRealizedProfit: '-0.75000000' },
        ]);
        expect(transport.getPositionRiskV3).toHaveBeenCalledOnce();
        expect(transport.getPositionRiskV3).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
    });

    it('preserves an empty current-position V3 snapshot without fallback reads', async () => {
        const transport = {
            getPositionRiskV3: vi.fn().mockResolvedValue([]),
            getBalanceV3: vi.fn(),
            getOpenOrders: vi.fn(),
            getOpenAlgoOrders: vi.fn(),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getPositionRisks('BTCUSDT')).resolves.toEqual([]);
        expect(transport.getPositionRiskV3).toHaveBeenCalledOnce();
        expect(transport.getBalanceV3).not.toHaveBeenCalled();
        expect(transport.getOpenOrders).not.toHaveBeenCalled();
        expect(transport.getOpenAlgoOrders).not.toHaveBeenCalled();
    });

    it('propagates the owned AbortSignal through every Phase 5 current-state read', async () => {
        const controller = new AbortController();
        const transport = {
            getExchangeInfo: vi.fn().mockResolvedValue(makeExchangeInfo(makeFuturesSymbol())),
            getMarkPrice: vi.fn().mockResolvedValue(makeMarkPrice()),
            getPositionRiskV3: vi.fn().mockResolvedValue([makePositionRisk()]),
            getBalanceV3: vi.fn().mockResolvedValue([makeAccountBalance()]),
            getOpenOrders: vi.fn().mockResolvedValue([makeOpenOrder()]),
            getOpenAlgoOrders: vi.fn().mockResolvedValue([makeAlgoOpenOrder()]),
        };
        const adapter = new FuturesTradingAdapter({ transport });

        await adapter.getExchangeInfo('BTCUSDT', controller.signal);
        await adapter.getCurrentMarketState('BTCUSDT', controller.signal);
        await adapter.getPositionRisks('BTCUSDT', controller.signal);
        await adapter.getAccountBalance('USDT', controller.signal);
        await adapter.getOpenOrders('BTCUSDT', controller.signal);
        await adapter.getAlgoOpenOrders('BTCUSDT', controller.signal);

        expect(transport.getExchangeInfo).toHaveBeenCalledWith({ signal: controller.signal });
        expect(transport.getMarkPrice).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            signal: controller.signal,
        });
        expect(transport.getPositionRiskV3).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            signal: controller.signal,
        });
        expect(transport.getBalanceV3).toHaveBeenCalledWith({ signal: controller.signal });
        expect(transport.getOpenOrders).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            signal: controller.signal,
        });
        expect(transport.getOpenAlgoOrders).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            signal: controller.signal,
        });
    });

    it('exposes no futures execution surface', () => {
        const adapter = new FuturesTradingAdapter({ transport: {} });
        expect(Object.getOwnPropertyNames(FuturesTradingAdapter.prototype)).toEqual([
            'constructor',
            'getExchangeInfo',
            'getMarkPrice',
            'getFundingState',
            'getCurrentMarketState',
            'getPositionRisk',
            'getPositionRisks',
            'getAccountBalance',
            'getOpenOrders',
            'getAlgoOpenOrders',
            'getAlgoOrder',
            'getOrder',
            'getCurrentOpenOrder',
            'getOrderHistory',
            'getAlgoOrderHistory',
            'getAccountTradeHistory',
            'getIncomeHistory',
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
            'getAllAlgoOrders',
            'getAllOrders',
            'getAccountTrades',
            'accountTradeList',
            'incomeHistory',
            'getIncomeHistoryPage',
        ];

        forbiddenExecutionMethods.forEach((method) => {
            expect(adapter[method]).toBeUndefined();
        });
    });
});
