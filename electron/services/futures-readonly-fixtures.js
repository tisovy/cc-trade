export const FUTURES_READ_ONLY_MOCK_SCENARIOS = Object.freeze({
    ONE_WAY: 'one-way',
    HEDGE: 'hedge',
    EMPTY: 'empty',
    FAILURE: 'failure',
});

export const FUTURES_READ_ONLY_MOCK_RESOURCES = Object.freeze({
    EXCHANGE_INFO: 'exchangeInfo',
    MARK_PRICE: 'markPrice',
    POSITION_RISK_V3: 'positionRiskV3',
    BALANCE_V3: 'balanceV3',
    OPEN_ORDERS: 'openOrders',
    OPEN_ALGO_ORDERS: 'openAlgoOrders',
    MARK_PRICE_STREAM: 'markPriceStream',
});

export const FUTURES_READ_ONLY_MOCK_SYMBOL = 'BTCUSDT';

const EXCHANGE_INFO = {
    timezone: 'UTC',
    serverTime: 1783810800000,
    symbols: [{
        symbol: FUTURES_READ_ONLY_MOCK_SYMBOL,
        pair: FUTURES_READ_ONLY_MOCK_SYMBOL,
        contractType: 'PERPETUAL',
        deliveryDate: 4133404800000,
        onboardDate: 1569398400000,
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
                minQty: '0.00100000',
                maxQty: '120.00000000',
                stepSize: '0.00100000',
            },
            {
                filterType: 'MIN_NOTIONAL',
                notional: '5.00000000',
            },
        ],
        orderTypes: [
            'LIMIT',
            'MARKET',
            'STOP',
            'STOP_MARKET',
            'TAKE_PROFIT',
            'TAKE_PROFIT_MARKET',
            'TRAILING_STOP_MARKET',
        ],
        timeInForce: ['GTC', 'IOC', 'FOK', 'GTX', 'GTD'],
    }],
};

const MARK_PRICE = {
    symbol: FUTURES_READ_ONLY_MOCK_SYMBOL,
    markPrice: '58420.12500000',
    indexPrice: '58418.98765432',
    estimatedSettlePrice: '58419.00000000',
    lastFundingRate: '-0.00012500',
    interestRate: '0.00010000',
    nextFundingTime: 1783814400000,
    time: 1783810800000,
};

const ONE_WAY_POSITION = {
    symbol: FUTURES_READ_ONLY_MOCK_SYMBOL,
    positionSide: 'BOTH',
    positionAmt: '0.12500000',
    entryPrice: '58000.00000000',
    breakEvenPrice: '58005.80000000',
    markPrice: '58420.12500000',
    unRealizedProfit: '52.51562500',
    liquidationPrice: '42125.50000000',
    isolatedMargin: '0.00000000',
    notional: '7302.51562500',
    marginAsset: 'USDT',
    isolatedWallet: '0',
    initialMargin: '730.25156250',
    maintMargin: '36.51257813',
    positionInitialMargin: '730.25156250',
    openOrderInitialMargin: '0',
    adl: 1,
    bidNotional: '0',
    askNotional: '0',
    updateTime: 1783810799000,
};

const HEDGE_LONG_POSITION = {
    ...ONE_WAY_POSITION,
    positionSide: 'LONG',
    positionAmt: '0.20000000',
    entryPrice: '57500.00000000',
    breakEvenPrice: '57505.75000000',
    unRealizedProfit: '184.02500000',
    liquidationPrice: '40250.00000000',
    notional: '11684.02500000',
    initialMargin: '1168.40250000',
    maintMargin: '58.42012500',
    positionInitialMargin: '1168.40250000',
};

const HEDGE_SHORT_POSITION = {
    ...ONE_WAY_POSITION,
    positionSide: 'SHORT',
    positionAmt: '-0.07500000',
    entryPrice: '57900.00000000',
    breakEvenPrice: '57894.21000000',
    unRealizedProfit: '-39.00937500',
    liquidationPrice: '79250.00000000',
    notional: '-4381.50937500',
    initialMargin: '438.15093750',
    maintMargin: '21.90754688',
    positionInitialMargin: '438.15093750',
};

const BALANCE = {
    accountAlias: 'mock-readonly',
    asset: 'USDT',
    balance: '12500.00000000',
    crossWalletBalance: '12447.48437500',
    crossUnPnl: '52.51562500',
    availableBalance: '11717.23281250',
    maxWithdrawAmount: '11717.23281250',
    marginAvailable: true,
    updateTime: 1783810799000,
};

const ZERO_BALANCE = {
    ...BALANCE,
    balance: '0.00000000',
    crossWalletBalance: '0',
    crossUnPnl: '-0.00000000',
    availableBalance: '0.00000000',
    maxWithdrawAmount: '0',
    marginAvailable: false,
    updateTime: 0,
};

const OPEN_ORDER = {
    avgPrice: '0.00000',
    clientOrderId: 'mock-current-order-000001',
    cumQuote: '0',
    executedQty: '0',
    orderId: 9007199254740001,
    origQty: '0.01000000',
    origType: 'LIMIT',
    price: '56000.00000000',
    reduceOnly: false,
    side: 'BUY',
    positionSide: 'BOTH',
    status: 'NEW',
    stopPrice: '0',
    closePosition: false,
    symbol: FUTURES_READ_ONLY_MOCK_SYMBOL,
    time: 1783810700000,
    timeInForce: 'GTC',
    type: 'LIMIT',
    updateTime: 1783810700000,
    workingType: 'CONTRACT_PRICE',
    priceProtect: false,
    priceMatch: 'NONE',
    selfTradePreventionMode: 'EXPIRE_MAKER',
    goodTillDate: 0,
};

const OPEN_ALGO_ORDER = {
    algoId: 9007199254739001,
    clientAlgoId: 'mock-current-algo-000001',
    algoType: 'CONDITIONAL',
    orderType: 'STOP_MARKET',
    symbol: FUTURES_READ_ONLY_MOCK_SYMBOL,
    side: 'SELL',
    positionSide: 'BOTH',
    timeInForce: 'GTC',
    quantity: '0.01000000',
    algoStatus: 'NEW',
    actualOrderId: '',
    actualPrice: '0.00000',
    triggerPrice: '54000.00000000',
    price: '0',
    icebergQuantity: null,
    tpTriggerPrice: '0',
    tpPrice: '0.00000000',
    slTriggerPrice: '0',
    slPrice: '0.00000000',
    tpOrderType: '',
    selfTradePreventionMode: 'EXPIRE_MAKER',
    workingType: 'MARK_PRICE',
    priceMatch: 'NONE',
    closePosition: false,
    priceProtect: true,
    reduceOnly: true,
    createTime: 1783810710000,
    updateTime: 1783810710000,
    triggerTime: 0,
    goodTillDate: 0,
};

const MARK_PRICE_STREAM = {
    e: 'markPriceUpdate',
    E: 1783810801000,
    s: FUTURES_READ_ONLY_MOCK_SYMBOL,
    p: '58421.25000000',
    i: '58419.12500000',
    P: '58419.00000000',
    r: '-0.00012500',
    T: 1783814400000,
};

const makeFailure = (resource) => ({
    failure: {
        code: -1001,
        status: 503,
        message: `Deterministic mock ${resource} failure`,
        body: {
            code: -1001,
            msg: `Deterministic mock ${resource} failure`,
        },
    },
});

const ONE_WAY_FIXTURES = {
    exchangeInfo: EXCHANGE_INFO,
    markPrice: MARK_PRICE,
    positionRiskV3: [ONE_WAY_POSITION],
    balanceV3: [BALANCE],
    openOrders: [OPEN_ORDER],
    openAlgoOrders: [OPEN_ALGO_ORDER],
    markPriceStream: MARK_PRICE_STREAM,
};

const FIXTURES = {
    [FUTURES_READ_ONLY_MOCK_SCENARIOS.ONE_WAY]: ONE_WAY_FIXTURES,
    [FUTURES_READ_ONLY_MOCK_SCENARIOS.HEDGE]: {
        ...ONE_WAY_FIXTURES,
        positionRiskV3: [HEDGE_LONG_POSITION, HEDGE_SHORT_POSITION],
        balanceV3: [{
            ...BALANCE,
            crossUnPnl: '145.01562500',
            availableBalance: '10840.43156250',
            maxWithdrawAmount: '10840.43156250',
        }],
    },
    [FUTURES_READ_ONLY_MOCK_SCENARIOS.EMPTY]: {
        ...ONE_WAY_FIXTURES,
        positionRiskV3: [],
        balanceV3: [ZERO_BALANCE],
        openOrders: [],
        openAlgoOrders: [],
    },
    [FUTURES_READ_ONLY_MOCK_SCENARIOS.FAILURE]: Object.fromEntries(
        Object.values(FUTURES_READ_ONLY_MOCK_RESOURCES).map((resource) => [
            resource,
            makeFailure(resource),
        ]),
    ),
};

const deepFreeze = (value) => {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
};

const cloneFixture = (value) => {
    if (Array.isArray(value)) return value.map(cloneFixture);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, cloneFixture(entry)]),
        );
    }
    return value;
};

deepFreeze(FIXTURES);

export const isFuturesReadOnlyMockScenario = (scenario) => (
    Object.values(FUTURES_READ_ONLY_MOCK_SCENARIOS).includes(scenario)
);

export const getFuturesReadOnlyMockFixture = ({ scenario, resource }) => {
    if (!isFuturesReadOnlyMockScenario(scenario)) {
        throw new Error(`Unsupported futures read-only mock scenario: ${scenario}`);
    }
    if (!Object.values(FUTURES_READ_ONLY_MOCK_RESOURCES).includes(resource)) {
        throw new Error(`Unsupported futures read-only mock resource: ${resource}`);
    }

    return cloneFixture(FIXTURES[scenario][resource]);
};

export const createFuturesReadOnlyMockFixtureSet = (scenario) => {
    if (!isFuturesReadOnlyMockScenario(scenario)) {
        throw new Error(`Unsupported futures read-only mock scenario: ${scenario}`);
    }
    return cloneFixture(FIXTURES[scenario]);
};
