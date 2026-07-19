import { describe, expect, it, vi } from 'vitest';
import {
    FUTURES_PRODUCTION_EXECUTION_ACTIONS,
    FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
} from './futures-production-execution-protocol.js';
import {
    FUTURES_PRODUCTION_ACTIVATION_GATES,
} from './futures-production-execution-activation.js';
import {
    FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS,
    FuturesProductionExecutionFacadeError,
} from './futures-production-execution-facade.js';
import {
    createFuturesProductionExecutionService,
} from './futures-production-execution-service.js';
import {
    FUTURES_PRODUCTION_EXECUTION_RISK_CODES,
    evaluateFuturesProductionExecutionRisk,
} from './futures-production-execution-risk.js';

const fingerprint = 'a'.repeat(64);
const binding = 'b'.repeat(64);
const connectionId = 'c'.repeat(32);
const requestId = '1'.repeat(32);
const lifecycleEventTypes = new Set([
    'intent_issued',
    'intent_consumed',
    'intent_expired',
    'queued',
    'daily_notional_reserved',
    'dispatch_intent',
    'response_classified',
    'acknowledgement',
    'terminal_transition',
    'reconciliation_result',
    'monitor_result',
    'cancel_all_parent',
    'cancel_all_child',
    'close_positions_parent',
    'close_positions_child',
    'restart_recovery',
]);
const receipt = endpointId => ({
    operation: endpointId,
    endpointId,
    status: 200,
    bodyDigest: 'd'.repeat(64),
    rateLimitHeaders: {},
});
const result = (endpointId, data) => ({ data, receipt: receipt(endpointId) });

const config = Object.freeze({
    environment: 'production',
    enabled: true,
    configured: true,
    liveAuthorized: true,
    code: 'FUTURES_PRODUCTION_EXECUTION_ENABLED',
    credentials: Object.freeze({ apiKey: 'key', apiSecret: 'secret' }),
    recoveryAuthorization: 'r'.repeat(32),
    account: Object.freeze({ alias: 'primary', fingerprint }),
    policy: Object.freeze({
        maxLeverage: 2,
        maxOrderNotionalUsdt: '10',
        maxDailyNotionalUsdt: '50',
        minAvailableBalanceUsdt: '10',
        minLiquidationDistanceBps: '1000',
        killSwitchPolicy: 'v1-persistent-block-new-exposure',
    }),
});

class FakeLedger {
    constructor(records = [], {
        lastServerTime = null,
        pauseUntil = 0,
        killSwitchEngaged = false,
    } = {}) {
        this.records = [...records];
        this.opened = false;
        this.killSwitchEngaged = killSwitchEngaged;
        this.lastServerTime = lastServerTime;
        this.pauseUntil = pauseUntil;
    }

    async open() { this.opened = true; }
    async close() { this.opened = false; }
    async append(record) {
        this.records.push({ ...record });
        return { sequence: String(this.records.length), record };
    }
    async setKillSwitch({ engaged, ...record }) {
        this.killSwitchEngaged = engaged;
        return this.append({
            ...record,
            eventType: 'kill_switch_transition',
            category: 'safety',
            outcome: engaged ? 'engaged' : 'disengaged',
            observedAt: 1,
            state: engaged ? 'engaged' : 'disengaged',
        });
    }
    async assertHealthy() { return true; }
    getHealth() { return { healthy: this.opened }; }
    getRevision() { return String(this.records.length); }
    getRecords() { return [...this.records]; }
    getReplaySnapshot() {
        return {
            killSwitchEngaged: this.killSwitchEngaged,
            lastServerTime: this.lastServerTime,
        };
    }
    getOrderRateState() {
        return {
            dispatchTimes: [],
            originWeightReservations: [],
            lastOriginWeightObservedAt: null,
            pauseUntil: this.pauseUntil,
            dailyReservations: {},
            lastUtcDay: null,
            lastServerTime: this.lastServerTime,
        };
    }
    findRequest(id) {
        return [...this.records].reverse().find(record => record.requestId === id) ?? null;
    }
    getActiveOperations() {
        const latest = new Map();
        for (const record of this.records) {
            if (!lifecycleEventTypes.has(record.eventType)) continue;
            const key = record.operationId ?? record.requestId;
            if (key) {
                const previous = latest.get(key) ?? {};
                const present = Object.fromEntries(Object.entries(record).filter(
                    ([, value]) => value !== null && value !== undefined,
                ));
                latest.set(key, { ...previous, ...present });
            }
        }
        return [...latest.values()].filter(record => ![
            'locally_rejected',
            'exchange_rejected',
            'confirmed_open',
            'confirmed_filled',
            'confirmed_canceled',
            'confirmed_closed',
            'confirmed_margin_adjusted',
            'confirmed_order_amended',
            'confirmed_empty',
            'kill_switch_engaged',
            'kill_switch_disengaged',
            'expired',
        ].includes(record.state));
    }
}

const exchangeInfo = {
    symbols: [{
        symbol: 'BTCUSDT',
        status: 'TRADING',
        contractType: 'PERPETUAL',
        quoteAsset: 'USDT',
        marginAsset: 'USDT',
        orderTypes: ['LIMIT', 'MARKET'],
        timeInForce: ['GTC'],
        filters: [
            { filterType: 'PRICE_FILTER', minPrice: '1', maxPrice: '1000000', tickSize: '0.1' },
            { filterType: 'PERCENT_PRICE', multiplierUp: '2', multiplierDown: '0.5' },
            { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '100', stepSize: '0.001' },
            { filterType: 'MARKET_LOT_SIZE', minQty: '0.001', maxQty: '100', stepSize: '0.001' },
            { filterType: 'MIN_NOTIONAL', notional: '5' },
            { filterType: 'MAX_NUM_ORDERS', limit: 20 },
        ],
    }],
};

const twoSymbolExchangeInfo = Object.freeze({
    symbols: Object.freeze([
        exchangeInfo.symbols[0],
        Object.freeze({
            ...exchangeInfo.symbols[0],
            symbol: 'ETHUSDT',
            filters: Object.freeze(exchangeInfo.symbols[0].filters.map(filter => (
                Object.freeze({ ...filter })
            ))),
        }),
    ]),
});

const validProductionAccountConfig = () => ({
    canTrade: true,
    dualSidePosition: true,
    multiAssetsMargin: false,
});

const validProductionBalance = () => [{
    accountAlias: 'primary',
    asset: 'USDT',
    availableBalance: '1000',
    marginAvailable: true,
}];

const productionIdentityGateCases = [
    {
        name: 'a wrong signed account alias',
        accountConfig: validProductionAccountConfig(),
        balance: [{ ...validProductionBalance()[0], accountAlias: 'secondary' }],
    },
    {
        name: 'a missing signed account alias',
        accountConfig: validProductionAccountConfig(),
        balance: [{
            asset: 'USDT',
            availableBalance: '1000',
            marginAvailable: true,
        }],
    },
    {
        name: 'duplicate USDT balance rows',
        accountConfig: validProductionAccountConfig(),
        balance: [validProductionBalance()[0], validProductionBalance()[0]],
    },
    {
        name: 'one-way mode',
        accountConfig: { ...validProductionAccountConfig(), dualSidePosition: false },
        balance: validProductionBalance(),
    },
    {
        name: 'multi-asset margin mode',
        accountConfig: { ...validProductionAccountConfig(), multiAssetsMargin: true },
        balance: validProductionBalance(),
    },
    {
        name: 'an unavailable USDT margin balance',
        accountConfig: validProductionAccountConfig(),
        balance: [{ ...validProductionBalance()[0], marginAvailable: false }],
    },
    {
        name: 'account trading disabled',
        accountConfig: { ...validProductionAccountConfig(), canTrade: false },
        balance: validProductionBalance(),
    },
];

const order = (overrides = {}) => ({
    symbol: 'BTCUSDT',
    clientOrderId: `cc7-${requestId}`,
    orderId: '9223372036854775807',
    side: 'SELL',
    positionSide: 'LONG',
    type: 'LIMIT',
    originalType: 'LIMIT',
    timeInForce: 'GTC',
    status: 'FILLED',
    originalQuantity: '0.0010',
    executedQuantity: '0.001',
    averagePrice: '70000',
    price: '70000.0',
    reduceOnly: false,
    closePosition: false,
    updateTime: 1_783_814_400_123,
    ...overrides,
});

const createHarness = ({
    ledger = new FakeLedger(),
    runtimeConfig = config,
    exchangeInfoValue = exchangeInfo,
    place = vi.fn().mockResolvedValue(result('new-limit-gtc-order', {
        symbol: 'BTCUSDT',
        clientOrderId: `cc7-${requestId}`,
        orderId: '9223372036854775807',
    })),
    getServerTime = null,
    accountConfig = vi.fn().mockResolvedValue(result('account-config', {
        canTrade: true, dualSidePosition: true, multiAssetsMargin: false,
    })),
    balance = vi.fn().mockResolvedValue(result('balance-v3', [{
        accountAlias: 'primary', asset: 'USDT', availableBalance: '1000', marginAvailable: true,
    }])),
    markPrice = vi.fn(symbol => result('mark-price', {
        symbol,
        markPrice: symbol === 'ETHUSDT' ? '3500' : '70000',
    })),
    symbolConfig = vi.fn(symbol => result('symbol-config', [{
        symbol, marginType: 'ISOLATED', isAutoAddMargin: false,
        leverage: 2, maxNotionalValue: '1000000',
    }])),
    allSymbolConfig = vi.fn().mockResolvedValue(result('all-symbol-config', [
        {
            symbol: 'BTCUSDT', marginType: 'ISOLATED', isAutoAddMargin: false,
            leverage: 2, maxNotionalValue: '1000000',
        },
        {
            symbol: 'ETHUSDT', marginType: 'ISOLATED', isAutoAddMargin: false,
            leverage: 2, maxNotionalValue: '1000000',
        },
    ])),
    query = vi.fn().mockResolvedValue(result('query-order', order())),
    positionRisk = vi.fn().mockResolvedValue(result('position-risk', [
        {
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            positionAmt: '1',
            liquidationPrice: '50000',
            isolatedMargin: '35000',
            marginAsset: 'USDT',
        },
        {
            symbol: 'BTCUSDT',
            positionSide: 'SHORT',
            positionAmt: '0',
            liquidationPrice: '0',
            isolatedMargin: '0',
            marginAsset: 'USDT',
        },
    ])),
    allPositionRisk = vi.fn().mockResolvedValue(result('position-risk', [
        {
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            positionAmt: '1',
            entryPrice: '60000',
            markPrice: '70000',
            notional: '70000',
            unRealizedProfit: '10000',
            isolatedMargin: '35000',
            liquidationPrice: '50000',
            leverage: '2',
            marginType: 'isolated',
            marginAsset: 'USDT',
        },
        {
            symbol: 'BTCUSDT',
            positionSide: 'SHORT',
            positionAmt: '0',
            entryPrice: '0',
            markPrice: '70000',
            notional: '0',
            unRealizedProfit: '0',
            isolatedMargin: '0',
            liquidationPrice: '0',
            leverage: '2',
            marginType: 'isolated',
            marginAsset: 'USDT',
        },
    ])),
    openOrders = vi.fn().mockResolvedValue(result('open-orders', [])),
    allOpenOrders = openOrders,
    startUserDataStream = vi.fn().mockResolvedValue(result('user-data-stream-start', {
        listenKey: 'a'.repeat(64),
    })),
    keepAliveUserDataStream = vi.fn().mockResolvedValue(result(
        'user-data-stream-keepalive',
        { listenKey: 'a'.repeat(64) },
    )),
    closeUserDataStream = vi.fn().mockResolvedValue(result(
        'user-data-stream-close',
        { acknowledged: true },
    )),
    connectUserDataStream = vi.fn().mockReturnValue({
        ready: Promise.resolve(true),
        close: vi.fn(),
    }),
    openAlgoOrders = vi.fn().mockResolvedValue(result('open-algo-orders', [])),
    allOpenAlgoOrders = openAlgoOrders,
    marginHistory = vi.fn().mockResolvedValue(result('position-margin-history', [])),
    modifyMargin = vi.fn().mockResolvedValue(result('modify-isolated-position-margin', {
        acknowledged: true,
        code: 200,
        type: 1,
        amount: '5',
    })),
    modifyOrder = vi.fn((args) => Promise.resolve(result('modify-limit-order', order({
        clientOrderId: args.clientOrderId,
        side: args.side,
        positionSide: args.positionSide,
        status: 'NEW',
        originalQuantity: args.quantity,
        executedQuantity: '0',
        averagePrice: '0',
        price: args.price,
    })))),
    cancelRegular = vi.fn().mockResolvedValue(result('cancel-all-open-orders', {
        acknowledged: true,
    })),
    cancelAlgo = vi.fn().mockResolvedValue(result('cancel-all-algo-open-orders', {
        acknowledged: true,
    })),
    placeMarket = vi.fn().mockResolvedValue(result('new-hedge-market-exit-order', {
        symbol: 'BTCUSDT',
        clientOrderId: `cc7-${requestId}`,
        orderId: '9223372036854775806',
    })),
    evaluateRisk = vi.fn(() => ({
        ok: true,
        classification: 'reducing',
        notionalUsdt: '7',
        conservativePrice: '70000',
        dailyNotionalBeforeUsdt: '0',
        dailyNotionalAfterUsdt: '7',
        observedLeverage: 2,
    })),
    pauseUntil = 0,
    timers = [],
    randomBytes = () => Buffer.from(requestId, 'hex'),
} = {}) => {
    let clock = 1_783_814_400_000;
    const dailyReservations = {};
    const facade = {
        getServerTime: getServerTime ?? vi.fn().mockImplementation(() => result('server-time', {
            serverTime: clock++, sentAt: clock, receivedAt: clock, roundTripMs: 0,
        })),
        getExchangeInfo: vi.fn().mockResolvedValue(result('exchange-info', exchangeInfoValue)),
        getMarkPrice: markPrice,
        getAccountConfig: accountConfig,
        getSymbolConfig: symbolConfig,
        getAllSymbolConfig: allSymbolConfig,
        getBalance: balance,
        getPositionRisk: positionRisk,
        getAllPositionRisk: allPositionRisk,
        getOpenOrders: openOrders,
        getAllOpenOrders: allOpenOrders,
        startUserDataStream,
        keepAliveUserDataStream,
        closeUserDataStream,
        connectUserDataStream,
        getOpenAlgoOrders: openAlgoOrders,
        getAllOpenAlgoOrders: allOpenAlgoOrders,
        getPositionMarginHistory: marginHistory,
        modifyIsolatedPositionMargin: modifyMargin,
        modifyLimitOrder: modifyOrder,
        placeLimitGtcOrder: place,
        placeHedgeMarketExitOrder: placeMarket,
        queryOrderByOriginalClientOrderId: query,
        cancelAllOpenOrders: cancelRegular,
        cancelAllAlgoOpenOrders: cancelAlgo,
    };
    const coordinator = {
        beginPreflight: vi.fn(async () => ({
            executeGet: async operation => operation(),
            release: vi.fn(),
        })),
        executeGet: vi.fn(async operation => operation()),
        executeProduction: vi.fn(async operation => operation()),
        executeRecoveryQuery: vi.fn(async operation => operation()),
        restoreOrderState: vi.fn(),
        restoreOriginWeightState: vi.fn(),
        setOrderPauseUntil: vi.fn(),
        reserveOrderDispatch: vi.fn(async ({ exactNotional, utcDay, serverTime, audit }) => {
            const dispatchAt = clock++;
            dailyReservations[utcDay] = exactNotional;
            await ledger.append({
                ...audit,
                eventType: 'daily_notional_reserved',
                category: 'rate',
                outcome: 'accepted',
                observedAt: dispatchAt,
                exactNotional,
                utcDay,
                serverTime,
                dispatchAt,
            });
            return { dispatchAt, serverTime, utcDay, exactNotional };
        }),
        getOrderAdmissionSnapshot: () => ({ dailyReservations, dispatchTimes: [], pauseUntil }),
    };
    const service = createFuturesProductionExecutionService({
        config: runtimeConfig,
        credentialBinding: binding,
        ledger,
        facade,
        coordinator,
        evaluateRisk,
        randomBytes,
        now: () => clock++,
        setTimeoutFn: (callback, delay) => {
            const timer = { callback, delay };
            timers.push(timer);
            return timer;
        },
        clearTimeoutFn: vi.fn(),
    });
    return {
        service,
        ledger,
        facade,
        coordinator,
        place,
        placeMarket,
        modifyOrder,
        query,
        evaluateRisk,
        timers,
        setClock: value => { clock = value; },
    };
};

const command = (action, revision, extra = {}) => JSON.stringify({
    action,
    version: 3,
    revision,
    marketType: 'futures',
    environment: 'production',
    accountFingerprint: fingerprint,
    ...extra,
});

const subscribe = async (service, emitted) => service.handleRequest(JSON.stringify({
    action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
    version: 3,
    revision: '0',
    marketType: 'futures',
    environment: 'production',
    accountFingerprint: '0'.repeat(64),
}), { connectionId, emit: value => emitted.push(value) });

const waitForPortfolioBootstrap = async (service) => {
    await vi.waitFor(() => {
        expect(['live', 'degraded']).toContain(service.getStatus().portfolio.syncState);
    });
};

const prepareOrder = async (service, emitted) => {
    if (service.getStatus().capabilities.placeOrder) await waitForPortfolioBootstrap(service);
    const revision = emitted.at(-1).revision;
    await service.handleRequest(command(
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
        revision,
        {
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            positionEffect: 'EXIT',
            quantity: '0.001',
            price: '70000.0',
        },
    ), { connectionId, emit: value => emitted.push(value) });
    return emitted.at(-1).intent;
};

const ownedOpenOrder = (overrides = {}) => ({
    symbol: 'BTCUSDT',
    orderId: '9223372036854775807',
    clientOrderId: `cc7-${requestId}`,
    side: 'SELL',
    positionSide: 'LONG',
    price: '70000.0',
    origQty: '0.0010',
    executedQty: '0',
    status: 'NEW',
    type: 'LIMIT',
    timeInForce: 'GTC',
    reduceOnly: false,
    closePosition: false,
    updateTime: 1_783_814_400_123,
    ...overrides,
});

const externalAlgoOrder = (overrides = {}) => ({
    algoId: '9007199254740993',
    clientAlgoId: 'external-stop-1',
    algoType: 'CONDITIONAL',
    orderType: 'STOP_MARKET',
    symbol: 'BTCUSDT',
    side: 'SELL',
    positionSide: 'LONG',
    timeInForce: 'GTE_GTC',
    quantity: '0.010',
    algoStatus: 'NEW',
    actualOrderId: '',
    actualPrice: '0',
    triggerPrice: '64000.0',
    price: '0',
    closePosition: false,
    reduceOnly: false,
    createTime: 1_783_814_400_000,
    updateTime: 1_783_814_400_100,
    ...overrides,
});

describe('FuturesProductionExecutionService', () => {
    it('loads an authoritative private snapshot on startup and retains external orders', async () => {
        const ownedOrder = {
            symbol: 'BTCUSDT',
            orderId: '9223372036854775807',
            clientOrderId: `cc7-${requestId}`,
            side: 'BUY',
            positionSide: 'LONG',
            price: '65000',
            origQty: '0.01',
            executedQty: '0',
            status: 'NEW',
            type: 'LIMIT',
            timeInForce: 'GTC',
            reduceOnly: false,
            closePosition: false,
            updateTime: 1_783_814_400_123,
        };
        const foreignOrder = {
            ...ownedOrder,
            orderId: '2',
            clientOrderId: 'manual-order',
            updateTime: 1_783_814_400_124,
        };
        const openOrders = vi.fn().mockResolvedValue(result(
            'open-orders',
            [foreignOrder, ownedOrder],
        ));
        const harness = createHarness({ openOrders });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await vi.waitFor(() => {
            expect(harness.service.getStatus().portfolio.state).toBe('live');
        });

        expect(harness.facade.getAllPositionRisk).toHaveBeenCalledTimes(1);
        expect(harness.facade.getAllSymbolConfig).toHaveBeenCalledTimes(1);
        expect(harness.facade.getAllOpenOrders).toHaveBeenCalledTimes(1);
        expect(harness.facade.getAllOpenAlgoOrders).toHaveBeenCalledTimes(1);
        expect(harness.facade.getServerTime).toHaveBeenCalledTimes(1);
        expect(harness.facade.getBalance).toHaveBeenCalledTimes(1);
        expect(openOrders).toHaveBeenCalledTimes(1);
        expect(emitted.at(-1).portfolio).toMatchObject({
            state: 'live',
            positions: [{
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                quantity: '1',
                leverage: 2,
                marginType: 'ISOLATED',
            }],
        });
        expect(emitted.at(-1).portfolio.openOrders).toEqual(expect.arrayContaining([
            expect.objectContaining({
                clientOrderId: 'manual-order',
                positionEffect: 'ENTRY',
                isAppOwned: false,
            }),
            expect.objectContaining({
                clientOrderId: `cc7-${requestId}`,
                isAppOwned: true,
            }),
        ]));
        expect(emitted.at(-1).portfolio.openOrders).toHaveLength(2);
        await harness.service.shutdown();
    });

    it('loads all-symbol regular and algo inventory without applying the execution allowlist', async () => {
        const allOpenOrders = vi.fn().mockResolvedValue(result('all-open-orders', [
            ownedOpenOrder({
                symbol: 'ETHUSDT',
                orderId: '9007199254740993',
                clientOrderId: 'external-eth-limit',
            }),
        ]));
        const allOpenAlgoOrders = vi.fn().mockResolvedValue(result('all-open-algo-orders', [
            externalAlgoOrder({ symbol: 'ETHUSDT', clientAlgoId: 'external-eth-stop' }),
        ]));
        const allPositionRisk = vi.fn().mockResolvedValue(result('position-risk', [{
            symbol: 'ETHUSDT',
            positionSide: 'LONG',
            positionAmt: '1',
            entryPrice: '3000',
            markPrice: '3500',
            notional: '3500',
            unRealizedProfit: '500',
            isolatedMargin: '0',
            liquidationPrice: '2000',
            leverage: '20',
            marginType: 'cross',
            marginAsset: 'USDT',
        }]));
        const symbolOpenOrders = vi.fn().mockResolvedValue(result('open-orders', []));
        const symbolAlgoOrders = vi.fn().mockResolvedValue(result('open-algo-orders', []));
        const harness = createHarness({
            allOpenOrders,
            allOpenAlgoOrders,
            allPositionRisk,
            openOrders: symbolOpenOrders,
            openAlgoOrders: symbolAlgoOrders,
        });

        await harness.service.start();
        await waitForPortfolioBootstrap(harness.service);

        expect(symbolOpenOrders).not.toHaveBeenCalled();
        expect(symbolAlgoOrders).not.toHaveBeenCalled();
        expect(harness.service.getStatus()).toMatchObject({
            caps: {
                symbolConfigurations: [
                    {
                        symbol: 'BTCUSDT', marginType: 'ISOLATED', leverage: 2,
                        isAutoAddMargin: false,
                    },
                    {
                        symbol: 'ETHUSDT', marginType: 'ISOLATED', leverage: 2,
                        isAutoAddMargin: false,
                    },
                ],
            },
            portfolio: {
                positions: [{
                    symbol: 'ETHUSDT', marginType: 'CROSSED', leverage: 20,
                }],
                openOrders: expect.arrayContaining([
                    expect.objectContaining({
                        symbol: 'ETHUSDT', orderKind: 'REGULAR',
                        orderId: '9007199254740993', isAppOwned: false,
                    }),
                    expect.objectContaining({
                        symbol: 'ETHUSDT', orderKind: 'ALGO',
                        orderId: '9007199254740993', isAppOwned: false,
                    }),
                ]),
            },
        });
        await harness.service.shutdown();
    });

    it('publishes more than sixteen strict symbol configurations and fails closed above 1024', async () => {
        const configurations = Array.from({ length: 24 }, (_, index) => ({
            symbol: `ASSET${String(index).padStart(3, '0')}USDT`,
            marginType: 'ISOLATED',
            isAutoAddMargin: false,
            leverage: 2,
            maxNotionalValue: '1000000',
        }));
        const harness = createHarness({
            allSymbolConfig: vi.fn().mockResolvedValue(result(
                'all-symbol-config',
                [...configurations, {
                    symbol: 'BTCUSDT_250926',
                    marginType: 'ISOLATED',
                    isAutoAddMargin: false,
                    leverage: 2,
                    maxNotionalValue: '1000000',
                }],
            )),
        });

        await harness.service.start();
        await waitForPortfolioBootstrap(harness.service);

        expect(harness.service.getStatus().caps.symbolConfigurations).toHaveLength(24);
        expect(harness.service.getStatus().caps.symbolConfigurations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ symbol: 'ASSET000USDT' }),
                expect.objectContaining({ symbol: 'ASSET023USDT' }),
            ]),
        );
        await harness.service.shutdown();

        const overflow = createHarness({
            allSymbolConfig: vi.fn().mockResolvedValue(result(
                'all-symbol-config',
                Array.from({ length: 1_025 }, (_, index) => ({
                    symbol: `S${String(index).padStart(4, '0')}USDT`,
                    marginType: 'ISOLATED',
                    isAutoAddMargin: false,
                    leverage: 2,
                    maxNotionalValue: '1000000',
                })),
            )),
        });
        await overflow.service.start();
        await waitForPortfolioBootstrap(overflow.service);
        expect(overflow.service.getStatus().caps.symbolConfigurations).toEqual([]);
        await overflow.service.shutdown();
    });

    it('keeps a BTC order beside Unicode and delivery external orders in one snapshot', async () => {
        const allOpenOrders = vi.fn().mockResolvedValue(result('all-open-orders', [
            ownedOpenOrder({ orderId: '1', clientOrderId: 'btc-external' }),
            ownedOpenOrder({
                symbol: '币安人生USDT',
                orderId: '2',
                clientOrderId: 'unicode-external',
            }),
            ownedOpenOrder({
                symbol: 'BTCUSDT_250926',
                orderId: '3',
                clientOrderId: 'delivery-external',
            }),
        ]));
        const harness = createHarness({ allOpenOrders });

        await harness.service.start();
        await waitForPortfolioBootstrap(harness.service);

        expect(harness.service.getStatus().portfolio.openOrders).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ symbol: 'BTCUSDT', orderId: '1' }),
                expect.objectContaining({ symbol: '币安人生USDT', orderId: '2' }),
                expect.objectContaining({ symbol: 'BTCUSDT_250926', orderId: '3' }),
            ]),
        );
        expect(harness.service.getStatus().portfolio.state).toBe('live');
        await harness.service.shutdown();
    });

    it('schedules reconnect before a slow REST snapshot after private socket failure', async () => {
        let resolveOpenOrders;
        const slowOpenOrders = new Promise(resolve => { resolveOpenOrders = resolve; });
        const allOpenOrders = vi.fn().mockReturnValue(slowOpenOrders);
        const connectUserDataStream = vi.fn().mockReturnValue({
            ready: Promise.reject(new Error('private stream unavailable')),
            close: vi.fn(),
        });
        const harness = createHarness({ allOpenOrders, connectUserDataStream });

        await harness.service.start();
        await vi.waitFor(() => expect(allOpenOrders).toHaveBeenCalledTimes(1));
        expect(harness.timers).toContainEqual(expect.objectContaining({ delay: 1_000 }));
        resolveOpenOrders(result('all-open-orders', [
            ownedOpenOrder({ clientOrderId: 'external-offline-order' }),
        ]));
        await vi.waitFor(() => {
            expect(harness.service.getStatus().portfolio).toMatchObject({
                state: 'stale',
                syncState: 'degraded',
                    syncCode: 'FUTURES_PRODUCTION_ACCOUNT_STREAM_UNAVAILABLE',
                openOrders: [expect.objectContaining({
                    clientOrderId: 'external-offline-order',
                    syncState: 'stale',
                })],
            });
        });
        expect(harness.service.getStatus().portfolio.state).not.toBe('live');
        await harness.service.shutdown();
    });

    it('waits for a slow private socket before taking one authoritative REST inventory', async () => {
        let resolveReady;
        const ready = new Promise(resolve => { resolveReady = resolve; });
        const allOpenOrders = vi.fn().mockResolvedValue(result('all-open-orders', [
            ownedOpenOrder({ clientOrderId: 'external-before-private-ready' }),
        ]));
        const allOpenAlgoOrders = vi.fn().mockResolvedValue(result('all-open-algo-orders', []));
        const connectUserDataStream = vi.fn().mockReturnValue({ ready, close: vi.fn() });
        const harness = createHarness({
            allOpenOrders,
            allOpenAlgoOrders,
            connectUserDataStream,
        });

        await harness.service.start();
        await vi.waitFor(() => expect(connectUserDataStream).toHaveBeenCalledOnce());
        expect(allOpenOrders).not.toHaveBeenCalled();
        expect(allOpenAlgoOrders).not.toHaveBeenCalled();
        expect(harness.service.getStatus().portfolio.state).not.toBe('live');

        resolveReady(true);
        await vi.waitFor(() => expect(allOpenOrders).toHaveBeenCalledOnce());
        expect(allOpenAlgoOrders).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(harness.service.getStatus().portfolio.state).toBe('live'));
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({
                clientOrderId: 'external-before-private-ready',
            }),
        ]);
        await harness.service.shutdown();
    });

    it('takes a generation-owned snapshot after reconnect instead of reusing an older refresh', async () => {
        let resolveOldSnapshot;
        let resolveNewSnapshot;
        const oldSnapshot = new Promise(resolve => { resolveOldSnapshot = resolve; });
        const newSnapshot = new Promise(resolve => { resolveNewSnapshot = resolve; });
        const externalOrder = ownedOpenOrder({
            orderId: '71',
            clientOrderId: 'external-reconnect-gap',
            updateTime: 1_783_814_400_100,
        });
        const allOpenOrders = vi.fn()
            .mockResolvedValueOnce(result('all-open-orders', [externalOrder]))
            .mockImplementationOnce(() => oldSnapshot)
            .mockImplementationOnce(() => newSnapshot);
        const allOpenAlgoOrders = vi.fn().mockResolvedValue(result('all-open-algo-orders', []));
        const streamCallbacks = [];
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks.push(callbacks);
            return { ready: Promise.resolve(true), close: vi.fn() };
        });
        const harness = createHarness({
            allOpenAlgoOrders,
            allOpenOrders,
            connectUserDataStream,
        });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        const manualRefresh = harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        await vi.waitFor(() => expect(allOpenOrders).toHaveBeenCalledTimes(2));

        streamCallbacks[0].onDisconnect('FUTURES_PRODUCTION_ACCOUNT_STREAM_DISCONNECTED');
        const reconnectTimer = [...harness.timers].reverse().find(timer => timer.delay === 1_000);
        expect(reconnectTimer).toBeDefined();
        reconnectTimer.callback();
        await vi.waitFor(() => expect(connectUserDataStream).toHaveBeenCalledTimes(2));
        expect(allOpenOrders).toHaveBeenCalledTimes(2);

        resolveOldSnapshot(result('all-open-orders', [externalOrder]));
        await manualRefresh;
        await vi.waitFor(() => expect(allOpenOrders).toHaveBeenCalledTimes(3));
        expect(harness.service.getStatus().portfolio.state).not.toBe('live');

        streamCallbacks[1].onMessage(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 1_783_814_400_900,
            T: 1_783_814_400_800,
            o: {
                s: 'BTCUSDT',
                i: 71,
                c: 'external-reconnect-gap',
                S: 'SELL',
                ps: 'LONG',
                o: 'LIMIT',
                f: 'GTC',
                p: '70000.0',
                q: '0.0010',
                z: '0',
                X: 'CANCELED',
                R: false,
                cp: false,
                T: 1_783_814_400_700,
            },
        }));
        resolveNewSnapshot(result('all-open-orders', [externalOrder]));

        await vi.waitFor(() => expect(harness.service.getStatus().portfolio).toMatchObject({
            state: 'live',
            openOrders: [],
        }));
        expect(allOpenAlgoOrders).toHaveBeenCalledTimes(3);
        await harness.service.shutdown();
    });

    it('reconnects when Binance renews a different listen key than the active stream', async () => {
        const streamHandle = { ready: Promise.resolve(true), close: vi.fn() };
        const keepAliveUserDataStream = vi.fn().mockResolvedValue(result(
            'user-data-stream-keepalive',
            { listenKey: 'b'.repeat(64) },
        ));
        const harness = createHarness({
            keepAliveUserDataStream,
            connectUserDataStream: vi.fn().mockReturnValue(streamHandle),
        });

        await harness.service.start();
        await waitForPortfolioBootstrap(harness.service);
        const keepAliveTimer = [...harness.timers].reverse().find(timer => (
            timer.delay === 30 * 60_000
        ));
        expect(keepAliveTimer).toBeDefined();
        keepAliveTimer.callback();

        await vi.waitFor(() => expect(keepAliveUserDataStream).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(streamHandle.close).toHaveBeenCalledOnce());
        expect(harness.service.getStatus().portfolio).toMatchObject({
            state: 'stale',
            syncState: 'degraded',
        });
        expect(harness.timers).toContainEqual(expect.objectContaining({ delay: 1_000 }));
        await harness.service.shutdown();
    });

    it('applies lossless ALGO_UPDATE events to the authoritative algo inventory', async () => {
        let streamCallbacks = null;
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks = callbacks;
            return { ready: Promise.resolve(true), close: vi.fn() };
        });
        const allOpenAlgoOrders = vi.fn().mockResolvedValue(result(
            'all-open-algo-orders',
            [externalAlgoOrder()],
        ));
        const harness = createHarness({ allOpenAlgoOrders, connectUserDataStream });

        await harness.service.start();
        await waitForPortfolioBootstrap(harness.service);
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({
                orderKind: 'ALGO', orderId: '9007199254740993', status: 'NEW',
            }),
        ]);

        streamCallbacks.onMessage(`{"e":"ALGO_UPDATE","T":1783814400250,"E":1783814400300,"o":{"caid":"external-stop-1","aid":9007199254740993,"at":"CONDITIONAL","o":"STOP_MARKET","s":"BTCUSDT","S":"SELL","ps":"LONG","f":"GTE_GTC","q":"0.010","X":"TRIGGERING","ai":"","ap":"0","aq":"0","tp":"64000.0","p":"0","cp":false,"R":false}}`);
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({
                orderKind: 'ALGO', orderId: '9007199254740993', status: 'TRIGGERING',
            }),
        ]);

        streamCallbacks.onMessage(`{"e":"ALGO_UPDATE","T":1783814400350,"E":1783814400400,"o":{"caid":"external-stop-1","aid":9007199254740993,"at":"CONDITIONAL","o":"STOP_MARKET","s":"BTCUSDT","S":"SELL","ps":"LONG","f":"GTE_GTC","q":"0.010","X":"CANCELED","ai":"","ap":"0","aq":"0","tp":"64000.0","p":"0","cp":false,"R":false}}`);
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([]);
        await harness.service.shutdown();
    });

    it('reconciles user-stream cancels over stale REST snapshots and resyncs after reconnect', async () => {
        const restOrders = [
            ownedOpenOrder({
                orderId: '1',
                clientOrderId: 'external-one',
                updateTime: 1_783_814_400_100,
            }),
            ownedOpenOrder({
                orderId: '2',
                clientOrderId: 'external-two',
                updateTime: 1_783_814_400_101,
            }),
        ];
        const openOrders = vi.fn().mockResolvedValue(result('open-orders', restOrders));
        let streamCallbacks = null;
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks = callbacks;
            return { ready: Promise.resolve(true), close: vi.fn() };
        });
        const harness = createHarness({ openOrders, connectUserDataStream });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        expect(harness.service.getStatus().portfolio.openOrders).toHaveLength(2);

        streamCallbacks.onMessage(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 1_783_814_400_900,
            T: 1_783_814_400_800,
            o: {
                s: 'BTCUSDT',
                i: 1,
                c: 'external-one',
                S: 'SELL',
                ps: 'LONG',
                o: 'LIMIT',
                f: 'GTC',
                p: '70000.0',
                q: '0.0010',
                z: '0',
                X: 'CANCELED',
                R: false,
                cp: false,
                T: 1_783_814_400_700,
            },
        }));
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({ orderId: '2', clientOrderId: 'external-two' }),
        ]);

        streamCallbacks.onDisconnect('FUTURES_PRODUCTION_ACCOUNT_STREAM_DISCONNECTED');
        expect(harness.service.getStatus().portfolio).toMatchObject({
            state: 'stale',
            syncState: 'degraded',
            openOrders: [expect.objectContaining({ orderId: '2', syncState: 'stale' })],
        });
        const reconnectTimer = harness.timers.find(timer => timer.delay === 1_000);
        expect(reconnectTimer).toBeDefined();
        reconnectTimer.callback();
        await vi.waitFor(() => expect(connectUserDataStream).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => {
            expect(harness.service.getStatus().portfolio.syncState).toBe('live');
        });
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({ orderId: '2', clientOrderId: 'external-two' }),
        ]);
        expect(openOrders).toHaveBeenCalledTimes(2);
        await harness.service.shutdown();
    });

    it.each(['ACCOUNT_UPDATE', 'ACCOUNT_CONFIG_UPDATE'])(
        'runs a trailing targeted account refresh when %s arrives during a full refresh',
        async (eventType) => {
        let streamCallbacks = null;
        let releaseOverlappedBalance;
        const overlappedBalance = new Promise(resolve => { releaseOverlappedBalance = resolve; });
        const balance = vi.fn()
            .mockResolvedValueOnce(result('balance-v3', validProductionBalance()))
            .mockImplementationOnce(() => overlappedBalance)
            .mockResolvedValue(result('balance-v3', [{
                ...validProductionBalance()[0],
                availableBalance: '900',
            }]));
        const accountConfig = vi.fn().mockResolvedValue(result(
            'account-config',
            validProductionAccountConfig(),
        ));
        const allSymbolConfig = vi.fn().mockResolvedValue(result('all-symbol-config', [{
            symbol: 'BTCUSDT', marginType: 'ISOLATED', isAutoAddMargin: false,
            leverage: 2, maxNotionalValue: '1000000',
        }]));
        const allOpenOrders = vi.fn().mockResolvedValue(result('all-open-orders', []));
        const allOpenAlgoOrders = vi.fn().mockResolvedValue(result('all-open-algo-orders', []));
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks = callbacks;
            return { ready: Promise.resolve(true), close: vi.fn() };
        });
        const harness = createHarness({
            accountConfig,
            allOpenAlgoOrders,
            allOpenOrders,
            allSymbolConfig,
            balance,
            connectUserDataStream,
        });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        const refresh = harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(2));

        streamCallbacks.onMessage(JSON.stringify({ e: eventType }));
        const accountUpdateTimer = [...harness.timers].reverse().find(timer => timer.delay === 100);
        expect(accountUpdateTimer).toBeDefined();
        accountUpdateTimer.callback();
        releaseOverlappedBalance(result('balance-v3', validProductionBalance()));
        await refresh;

        await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(3));
        await vi.waitFor(() => {
            expect(harness.service.getStatus().portfolio.availableBalanceUsdt).toBe('900');
        });
        expect(allOpenOrders).toHaveBeenCalledTimes(2);
        expect(allOpenAlgoOrders).toHaveBeenCalledTimes(2);
        expect(accountConfig).toHaveBeenCalledTimes(eventType === 'ACCOUNT_CONFIG_UPDATE' ? 3 : 2);
        expect(allSymbolConfig).toHaveBeenCalledTimes(
            eventType === 'ACCOUNT_CONFIG_UPDATE' ? 3 : 2,
        );
        await harness.service.shutdown();
        },
    );

    it('coalesces account event bursts without reloading order inventories', async () => {
        let streamCallbacks = null;
        const accountConfig = vi.fn().mockResolvedValue(result(
            'account-config',
            validProductionAccountConfig(),
        ));
        const allSymbolConfig = vi.fn().mockResolvedValue(result('all-symbol-config', [{
            symbol: 'BTCUSDT', marginType: 'ISOLATED', isAutoAddMargin: false,
            leverage: 2, maxNotionalValue: '1000000',
        }]));
        const balance = vi.fn().mockResolvedValue(result(
            'balance-v3',
            validProductionBalance(),
        ));
        const allPositionRisk = vi.fn().mockResolvedValue(result('position-risk', []));
        const allOpenOrders = vi.fn().mockResolvedValue(result('all-open-orders', []));
        const allOpenAlgoOrders = vi.fn().mockResolvedValue(result('all-open-algo-orders', []));
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks = callbacks;
            return { ready: Promise.resolve(true), close: vi.fn() };
        });
        const harness = createHarness({
            accountConfig,
            allOpenAlgoOrders,
            allOpenOrders,
            allPositionRisk,
            allSymbolConfig,
            balance,
            connectUserDataStream,
        });

        await harness.service.start();
        await waitForPortfolioBootstrap(harness.service);
        const baseline = {
            accountConfig: accountConfig.mock.calls.length,
            allOpenAlgoOrders: allOpenAlgoOrders.mock.calls.length,
            allOpenOrders: allOpenOrders.mock.calls.length,
            allPositionRisk: allPositionRisk.mock.calls.length,
            allSymbolConfig: allSymbolConfig.mock.calls.length,
            balance: balance.mock.calls.length,
        };

        streamCallbacks.onMessage(JSON.stringify({ e: 'ACCOUNT_UPDATE' }));
        streamCallbacks.onMessage(JSON.stringify({ e: 'ACCOUNT_CONFIG_UPDATE' }));
        streamCallbacks.onMessage(JSON.stringify({ e: 'ACCOUNT_UPDATE' }));
        const eventTimers = harness.timers.filter(timer => timer.delay === 100);
        expect(eventTimers).toHaveLength(1);
        eventTimers[0].callback();

        await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(baseline.balance + 1));
        expect(allPositionRisk).toHaveBeenCalledTimes(baseline.allPositionRisk + 1);
        expect(accountConfig).toHaveBeenCalledTimes(baseline.accountConfig + 1);
        expect(allSymbolConfig).toHaveBeenCalledTimes(baseline.allSymbolConfig + 1);
        expect(allOpenOrders).toHaveBeenCalledTimes(baseline.allOpenOrders);
        expect(allOpenAlgoOrders).toHaveBeenCalledTimes(baseline.allOpenAlgoOrders);
        await harness.service.shutdown();
    });

    it('retries a failed targeted account refresh without a full order resnapshot', async () => {
        let streamCallbacks = null;
        let rejectNextBalance = false;
        const balance = vi.fn(() => {
            if (rejectNextBalance) {
                rejectNextBalance = false;
                return Promise.reject(new Error('targeted balance unavailable'));
            }
            return Promise.resolve(result('balance-v3', validProductionBalance()));
        });
        const allOpenOrders = vi.fn().mockResolvedValue(result('all-open-orders', []));
        const allOpenAlgoOrders = vi.fn().mockResolvedValue(result('all-open-algo-orders', []));
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks = callbacks;
            return { ready: Promise.resolve(true), close: vi.fn() };
        });
        const harness = createHarness({
            allOpenAlgoOrders,
            allOpenOrders,
            balance,
            connectUserDataStream,
        });

        await harness.service.start();
        await waitForPortfolioBootstrap(harness.service);
        const baselineBalance = balance.mock.calls.length;
        const baselineRegular = allOpenOrders.mock.calls.length;
        const baselineAlgo = allOpenAlgoOrders.mock.calls.length;
        rejectNextBalance = true;

        streamCallbacks.onMessage(JSON.stringify({ e: 'ACCOUNT_UPDATE' }));
        const eventTimer = [...harness.timers].reverse().find(timer => timer.delay === 100);
        eventTimer.callback();
        await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(baselineBalance + 1));
        expect(harness.service.getStatus().portfolio).toMatchObject({
            state: 'stale',
            syncCode: 'FUTURES_PRODUCTION_ACCOUNT_STATE_REFRESH_UNAVAILABLE',
        });
        expect(allOpenOrders).toHaveBeenCalledTimes(baselineRegular);
        expect(allOpenAlgoOrders).toHaveBeenCalledTimes(baselineAlgo);

        const targetedRetry = [...harness.timers].reverse().find(timer => timer.delay === 2_000);
        expect(targetedRetry).toBeDefined();
        targetedRetry.callback();
        await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(baselineBalance + 2));
        await vi.waitFor(() => expect(harness.service.getStatus().portfolio.state).toBe('live'));
        expect(allOpenOrders).toHaveBeenCalledTimes(baselineRegular);
        expect(allOpenAlgoOrders).toHaveBeenCalledTimes(baselineAlgo);
        await harness.service.shutdown();
    });

    it('keeps amendment disabled when targeted account refresh follows a failed order snapshot', async () => {
        let streamCallbacks = null;
        const externalOrder = ownedOpenOrder({
            orderId: '88',
            clientOrderId: 'external-stale-amendment',
        });
        const allOpenOrders = vi.fn()
            .mockResolvedValueOnce(result('all-open-orders', [externalOrder]))
            .mockRejectedValue(new Error('order inventory unavailable'));
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks = callbacks;
            return { ready: Promise.resolve(true), close: vi.fn() };
        });
        const harness = createHarness({ allOpenOrders, connectUserDataStream });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        expect(harness.service.getStatus().capabilities.amendOrder).toBe(true);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        expect(harness.service.getStatus().portfolio).toMatchObject({
            state: 'stale',
            syncState: 'degraded',
            syncCode: 'FUTURES_PRODUCTION_OPEN_ORDERS_SNAPSHOT_UNAVAILABLE',
            openOrders: [expect.objectContaining({
                clientOrderId: 'external-stale-amendment',
                syncState: 'stale',
            })],
        });

        streamCallbacks.onMessage(JSON.stringify({ e: 'ACCOUNT_UPDATE' }));
        const eventTimer = [...harness.timers].reverse().find(timer => timer.delay === 100);
        expect(eventTimer).toBeDefined();
        eventTimer.callback();
        await vi.waitFor(() => expect(harness.service.getStatus().portfolio.state).toBe('live'));
        expect(harness.service.getStatus().portfolio).toMatchObject({
            syncState: 'degraded',
            syncCode: 'FUTURES_PRODUCTION_OPEN_ORDERS_SNAPSHOT_UNAVAILABLE',
        });
        expect(harness.service.getStatus().capabilities.amendOrder).toBe(false);

        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
            harness.service.getStatus().revision,
            {
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                clientOrderId: 'external-stale-amendment',
                price: '70100.0',
            },
        ), { connectionId, emit: value => emitted.push(value) });
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'locally_rejected',
            code: 'FUTURES_PRODUCTION_GATE_REJECTED',
        });
        expect(harness.modifyOrder).not.toHaveBeenCalled();
        await harness.service.shutdown();
    });

    it('serializes a full portfolio refresh behind an active targeted account refresh', async () => {
        let streamCallbacks = null;
        let releaseTargetedBalance;
        const targetedBalance = new Promise(resolve => { releaseTargetedBalance = resolve; });
        const balance = vi.fn()
            .mockResolvedValueOnce(result('balance-v3', validProductionBalance()))
            .mockImplementationOnce(() => targetedBalance)
            .mockResolvedValue(result('balance-v3', [{
                ...validProductionBalance()[0],
                availableBalance: '800',
            }]));
        const accountConfig = vi.fn().mockResolvedValue(result(
            'account-config',
            validProductionAccountConfig(),
        ));
        const allOpenOrders = vi.fn().mockResolvedValue(result('all-open-orders', []));
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks = callbacks;
            return { ready: Promise.resolve(true), close: vi.fn() };
        });
        const harness = createHarness({
            accountConfig,
            allOpenOrders,
            balance,
            connectUserDataStream,
        });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        streamCallbacks.onMessage(JSON.stringify({ e: 'ACCOUNT_UPDATE' }));
        const eventTimer = [...harness.timers].reverse().find(timer => timer.delay === 100);
        expect(eventTimer).toBeDefined();
        eventTimer.callback();
        await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(2));

        const fullRefresh = harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        await new Promise(resolve => { setImmediate(resolve); });
        expect(accountConfig).toHaveBeenCalledOnce();
        expect(allOpenOrders).toHaveBeenCalledOnce();

        releaseTargetedBalance(result('balance-v3', [{
            ...validProductionBalance()[0],
            availableBalance: '900',
        }]));
        await fullRefresh;

        expect(accountConfig).toHaveBeenCalledTimes(2);
        expect(allOpenOrders).toHaveBeenCalledTimes(2);
        expect(harness.service.getStatus().portfolio.availableBalanceUsdt).toBe('800');
        await harness.service.shutdown();
    });

    it('reuses a queued generation-owned reconnect snapshot without duplicate inventories', async () => {
        let releaseTargetedBalance;
        let resolveReconnectReady;
        const targetedBalance = new Promise(resolve => { releaseTargetedBalance = resolve; });
        const reconnectReady = new Promise(resolve => { resolveReconnectReady = resolve; });
        const balance = vi.fn()
            .mockResolvedValueOnce(result('balance-v3', validProductionBalance()))
            .mockImplementationOnce(() => targetedBalance)
            .mockResolvedValue(result('balance-v3', validProductionBalance()));
        const allOpenOrders = vi.fn().mockResolvedValue(result('all-open-orders', []));
        const allOpenAlgoOrders = vi.fn().mockResolvedValue(result('all-open-algo-orders', []));
        const streamCallbacks = [];
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks.push(callbacks);
            return {
                ready: streamCallbacks.length === 1 ? Promise.resolve(true) : reconnectReady,
                close: vi.fn(),
            };
        });
        const harness = createHarness({
            allOpenAlgoOrders,
            allOpenOrders,
            balance,
            connectUserDataStream,
        });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        streamCallbacks[0].onMessage(JSON.stringify({ e: 'ACCOUNT_UPDATE' }));
        const accountTimer = [...harness.timers].reverse().find(timer => timer.delay === 100);
        expect(accountTimer).toBeDefined();
        accountTimer.callback();
        await vi.waitFor(() => expect(balance).toHaveBeenCalledTimes(2));

        streamCallbacks[0].onDisconnect('FUTURES_PRODUCTION_ACCOUNT_STREAM_DISCONNECTED');
        const reconnectTimer = [...harness.timers].reverse().find(timer => timer.delay === 1_000);
        expect(reconnectTimer).toBeDefined();
        reconnectTimer.callback();
        await vi.waitFor(() => expect(connectUserDataStream).toHaveBeenCalledTimes(2));
        const queuedRefresh = harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        await new Promise(resolve => { setImmediate(resolve); });

        resolveReconnectReady(true);
        await new Promise(resolve => { setImmediate(resolve); });
        expect(allOpenOrders).toHaveBeenCalledOnce();
        releaseTargetedBalance(result('balance-v3', validProductionBalance()));
        await queuedRefresh;
        await vi.waitFor(() => expect(harness.service.getStatus().portfolio.state).toBe('live'));
        await new Promise(resolve => { setImmediate(resolve); });

        expect(allOpenOrders).toHaveBeenCalledTimes(2);
        expect(allOpenAlgoOrders).toHaveBeenCalledTimes(2);
        await harness.service.shutdown();
    });

    it('invalidates stale readiness on ACCOUNT_CONFIG_UPDATE and recovers automatically', async () => {
        const accountConfig = vi.fn()
            .mockResolvedValueOnce(result('account-config', validProductionAccountConfig()))
            .mockResolvedValueOnce(result('account-config', {
                ...validProductionAccountConfig(),
                dualSidePosition: false,
            }))
            .mockResolvedValue(result('account-config', validProductionAccountConfig()));
        let streamCallbacks = null;
        const streamHandles = [];
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks = callbacks;
            const handle = { ready: Promise.resolve(true), close: vi.fn() };
            streamHandles.push(handle);
            return handle;
        });
        const harness = createHarness({ accountConfig, connectUserDataStream });

        await harness.service.start();
        await waitForPortfolioBootstrap(harness.service);
        expect(harness.service.getStatus().capabilities.placeOrder).toBe(true);
        streamCallbacks.onMessage(JSON.stringify({ e: 'ACCOUNT_CONFIG_UPDATE' }));
        const eventTimer = [...harness.timers].reverse().find(timer => timer.delay === 100);
        expect(eventTimer).toBeDefined();
        eventTimer.callback();

        await vi.waitFor(() => expect(accountConfig).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(harness.service.getStatus().capabilities).toMatchObject({
            placeOrder: false,
            code: 'FUTURES_PRODUCTION_ACCOUNT_IDENTITY_REJECTED',
        }));
        expect(streamHandles[0].close).toHaveBeenCalledOnce();
        expect(harness.coordinator.executeProduction).not.toHaveBeenCalled();

        const identityRetry = [...harness.timers].reverse().find(timer => timer.delay === 1_000);
        expect(identityRetry).toBeDefined();
        identityRetry.callback();
        await vi.waitFor(() => expect(accountConfig).toHaveBeenCalledTimes(3));
        await vi.waitFor(() => expect(harness.service.getStatus().capabilities.placeOrder).toBe(true));
        expect(connectUserDataStream).toHaveBeenCalledTimes(2);
        await harness.service.shutdown();
    });

    it('fails closed on a post-startup Binance auth rejection and retries identity safely', async () => {
        const authRejected = new FuturesProductionExecutionFacadeError({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED,
            operation: 'allOpenOrders',
            endpointId: 'all-open-orders',
            status: 401,
        });
        const allOpenOrders = vi.fn()
            .mockResolvedValueOnce(result('all-open-orders', []))
            .mockRejectedValueOnce(authRejected)
            .mockResolvedValue(result('all-open-orders', []));
        const harness = createHarness({ allOpenOrders });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });

        expect(harness.service.getStatus()).toMatchObject({
            capabilities: {
                placeOrder: false,
                code: 'FUTURES_PRODUCTION_ACCOUNT_IDENTITY_REJECTED',
            },
            portfolio: {
                state: 'stale',
                syncCode: 'FUTURES_PRODUCTION_ACCOUNT_IDENTITY_REJECTED',
            },
        });
        expect(harness.coordinator.executeProduction).not.toHaveBeenCalled();
        expect(harness.place).not.toHaveBeenCalled();

        const identityRetry = [...harness.timers].reverse().find(timer => timer.delay === 1_000);
        expect(identityRetry).toBeDefined();
        identityRetry.callback();
        await vi.waitFor(() => expect(allOpenOrders).toHaveBeenCalledTimes(3));
        await vi.waitFor(() => expect(harness.service.getStatus().capabilities.placeOrder).toBe(true));
        await harness.service.shutdown();
    });

    it.each(['acknowledged', 'ambiguous-after-accept'])(
        '%s owned LIMIT amendment sends one PUT and confirms the exact new price by query',
        async (mode) => {
            let currentPrice = '70000.0';
            const openOrders = vi.fn().mockResolvedValue(result(
                'open-orders',
                [ownedOpenOrder()],
            ));
            const query = vi.fn(() => Promise.resolve(result('query-order', order({
                status: 'NEW',
                executedQuantity: '0',
                averagePrice: '0',
                price: currentPrice,
            }))));
            const modifyOrder = vi.fn((args) => {
                currentPrice = args.price;
                if (mode === 'ambiguous-after-accept') {
                    return Promise.reject(new FuturesProductionExecutionFacadeError({
                        kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                        operation: 'modifyLimitOrder',
                        endpointId: 'modify-limit-order',
                    }));
                }
                return Promise.resolve(result('modify-limit-order', order({
                    status: 'NEW',
                    executedQuantity: '0',
                    averagePrice: '0',
                    price: args.price,
                })));
            });
            const harness = createHarness({ openOrders, query, modifyOrder });
            const emitted = [];

            await harness.service.start();
            await subscribe(harness.service, emitted);
            await harness.service.handleRequest(command(
                FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
                emitted.at(-1).revision,
            ), { connectionId, emit: value => emitted.push(value) });
            expect(emitted.at(-1).capabilities.amendOrder).toBe(true);
            await harness.service.handleRequest(command(
                FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
                emitted.at(-1).revision,
                {
                    symbol: 'BTCUSDT',
                    positionSide: 'LONG',
                    clientOrderId: `cc7-${requestId}`,
                    price: '70100.1',
                },
            ), { connectionId, emit: value => emitted.push(value) });
            const amendmentIntent = emitted.at(-1).intent;
            expect(amendmentIntent.kind).toBe('order_amendment');
            await harness.service.handleRequest(command(
                FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER,
                amendmentIntent.revision,
                {
                    requestId: amendmentIntent.requestId,
                    confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                        FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER
                    ],
                },
            ), { connectionId, emit: value => emitted.push(value) });

            expect(modifyOrder).toHaveBeenCalledExactlyOnceWith({
                symbol: 'BTCUSDT',
                side: 'SELL',
                positionSide: 'LONG',
                quantity: '0.0010',
                price: '70100.1',
                clientOrderId: `cc7-${requestId}`,
            });
            expect(query).toHaveBeenCalledTimes(3);
            expect(harness.service.getCurrentAttempt()).toMatchObject({
                kind: 'order_amendment',
                acknowledgement: 'accepted',
                state: 'confirmed_order_amended',
                code: 'FUTURES_PRODUCTION_ORDER_AMENDED',
                items: [{ symbol: 'BTCUSDT', outcome: 'amended' }],
            });
            expect(harness.service.getStatus().portfolio.openOrders[0].price).toBe('70100.1');
            expect(harness.ledger.records.filter(record => (
                record.eventType === 'exchange_request'
                && record.endpointId === 'modify-limit-order'
            ))).toHaveLength(1);
            await harness.service.shutdown();
        },
    );

    it('amends a partial fill with TOTAL exchange quantity and REMAINING risk quantity', async () => {
        let currentPrice = '70000.0';
        const openOrders = vi.fn().mockResolvedValue(result('open-orders', [ownedOpenOrder({
            origQty: '1.000',
            executedQty: '0.950',
            status: 'PARTIALLY_FILLED',
        })]));
        const query = vi.fn(() => Promise.resolve(result('query-order', order({
            status: 'PARTIALLY_FILLED',
            originalQuantity: '1.000',
            executedQuantity: '0.950',
            averagePrice: '70000',
            price: currentPrice,
        }))));
        const modifyOrder = vi.fn((args) => {
            currentPrice = args.price;
            return Promise.resolve(result('modify-limit-order', order({
                status: 'PARTIALLY_FILLED',
                originalQuantity: args.quantity,
                executedQuantity: '0.950',
                averagePrice: '70000',
                price: args.price,
            })));
        });
        const openAlgoOrders = vi.fn().mockResolvedValue(result(
            'open-algo-orders',
            [externalAlgoOrder()],
        ));
        const positionRisk = vi.fn(symbol => result('position-risk', [
            {
                symbol,
                positionSide: 'LONG',
                positionAmt: '0.050',
                liquidationPrice: '50000',
                isolatedMargin: '35000',
                marginAsset: 'USDT',
            },
            {
                symbol,
                positionSide: 'SHORT',
                positionAmt: '0',
                liquidationPrice: '0',
                isolatedMargin: '0',
                marginAsset: 'USDT',
            },
        ]));
        const exchangeInfoAtLimit = structuredClone(exchangeInfo);
        exchangeInfoAtLimit.symbols[0].filters.find(
            filter => filter.filterType === 'MAX_NUM_ORDERS',
        ).limit = 2;
        const evaluateRisk = vi.fn(evaluateFuturesProductionExecutionRisk);
        const harness = createHarness({
            evaluateRisk,
            exchangeInfoValue: exchangeInfoAtLimit,
            modifyOrder,
            openAlgoOrders,
            openOrders,
            positionRisk,
            query,
        });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
            harness.service.getStatus().revision,
            {
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                clientOrderId: `cc7-${requestId}`,
                price: '70100.0',
            },
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(modifyOrder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            quantity: '1.000',
            price: '70100.0',
        }));
        expect(evaluateRisk).toHaveBeenCalled();
        expect(evaluateRisk.mock.calls.every(([input]) => (
            input.draft.quantity === '1.000' && input.draft.riskQuantity === '0.050'
        ))).toBe(true);
        expect(evaluateRisk.mock.calls.every(([input]) => (
            input.snapshot.regularOpenOrderCount === 0
            && input.snapshot.algoOpenOrderCount === 1
        ))).toBe(true);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_order_amended',
            acknowledgement: 'accepted',
        });
        await harness.service.shutdown();
    });

    it('publishes a validated amendment price as pending until equal-time query confirmation', async () => {
        let queryCount = 0;
        let resolveReconciliation;
        const openOrders = vi.fn().mockResolvedValue(result(
            'open-orders',
            [ownedOpenOrder()],
        ));
        const query = vi.fn(() => {
            queryCount += 1;
            if (queryCount < 3) {
                return Promise.resolve(result('query-order', order({
                    status: 'NEW',
                    executedQuantity: '0',
                    averagePrice: '0',
                    price: '70000.0',
                })));
            }
            return new Promise((resolve) => { resolveReconciliation = resolve; });
        });
        const modifyOrder = vi.fn(args => Promise.resolve(result(
            'modify-limit-order',
            order({
                status: 'NEW',
                executedQuantity: '0',
                averagePrice: '0',
                price: args.price,
            }),
        )));
        const harness = createHarness({ openOrders, query, modifyOrder });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
            emitted.at(-1).revision,
        ), { connectionId, emit: value => emitted.push(value) });
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
            emitted.at(-1).revision,
            {
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                clientOrderId: `cc7-${requestId}`,
                price: '70100.1',
            },
        ), { connectionId, emit: value => emitted.push(value) });
        const amendmentIntent = emitted.at(-1).intent;

        const final = harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER,
            amendmentIntent.revision,
            {
                requestId: amendmentIntent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(3));
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({
                orderKind: 'REGULAR',
                orderId: '9223372036854775807',
                clientOrderId: `cc7-${requestId}`,
                price: '70100.1',
                syncState: 'pending',
            }),
        ]);
        resolveReconciliation(result('query-order', order({
            status: 'NEW',
            executedQuantity: '0',
            averagePrice: '0',
            price: '70100.1',
        })));
        await final;
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({ price: '70100.1', syncState: 'synced' }),
        ]);
        await harness.service.shutdown();
    });

    it('recovers an accepted ambiguous LIMIT amendment after restart by query only', async () => {
        let currentPrice = '70000.0';
        let queryCount = 0;
        const query = vi.fn(() => {
            queryCount += 1;
            if (queryCount === 3) {
                return Promise.reject(new FuturesProductionExecutionFacadeError({
                    kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
                    operation: 'queryOrder',
                    endpointId: 'query-order',
                }));
            }
            return Promise.resolve(result('query-order', order({
                status: 'NEW',
                executedQuantity: '0',
                averagePrice: '0',
                price: currentPrice,
            })));
        });
        const modifyOrder = vi.fn((args) => {
            currentPrice = args.price;
            return Promise.reject(new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                operation: 'modifyLimitOrder',
                endpointId: 'modify-limit-order',
            }));
        });
        const first = createHarness({
            openOrders: vi.fn().mockResolvedValue(result('open-orders', [ownedOpenOrder()])),
            query,
            modifyOrder,
        });
        const emitted = [];
        await first.service.start();
        await subscribe(first.service, emitted);
        await first.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
            emitted.at(-1).revision,
        ), { connectionId, emit: value => emitted.push(value) });
        await first.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
            emitted.at(-1).revision,
            {
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                clientOrderId: `cc7-${requestId}`,
                price: '70100.1',
            },
        ), { connectionId, emit: value => emitted.push(value) });
        const amendmentIntent = emitted.at(-1).intent;
        await first.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER,
            amendmentIntent.revision,
            {
                requestId: amendmentIntent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });
        expect(modifyOrder).toHaveBeenCalledOnce();
        expect(first.service.getCurrentAttempt().state).toBe('result_unknown');
        await first.service.shutdown();

        const restartPutTripwire = vi.fn(() => {
            throw new Error('restart must never repeat an amendment PUT');
        });
        const recoveryQuery = vi.fn().mockResolvedValue(result('query-order', order({
            status: 'NEW',
            executedQuantity: '0',
            averagePrice: '0',
            price: currentPrice,
        })));
        const second = createHarness({
            ledger: first.ledger,
            query: recoveryQuery,
            modifyOrder: restartPutTripwire,
        });
        second.setClock(1_783_814_500_000);
        await second.service.start();

        expect(restartPutTripwire).not.toHaveBeenCalled();
        expect(recoveryQuery).toHaveBeenCalledOnce();
        expect(second.service.getCurrentAttempt()).toMatchObject({
            kind: 'order_amendment',
            acknowledgement: 'accepted',
            state: 'confirmed_order_amended',
        });
        expect(second.ledger.getActiveOperations()).toEqual([]);
        await second.service.shutdown();
    });

    it.each(['acknowledged', 'ambiguous-after-accept'])('%s margin POST is sent once and confirmed by exact history plus leg margin', async (mode) => {
        let adjusted = false;
        let streamCallbacks = null;
        const positionRisk = vi.fn(symbol => result('position-risk', [
            {
                symbol,
                positionSide: 'LONG',
                positionAmt: '1',
                liquidationPrice: '50000',
                isolatedMargin: adjusted ? '35005' : '35000',
                marginAsset: 'USDT',
            },
            {
                symbol,
                positionSide: 'SHORT',
                positionAmt: '0',
                liquidationPrice: '0',
                isolatedMargin: '0',
                marginAsset: 'USDT',
            },
        ]));
        const marginHistory = vi.fn().mockResolvedValue(result('position-margin-history', [{
            symbol: 'BTCUSDT',
            type: 1,
            amount: '5',
            asset: 'USDT',
            time: 1_783_814_500_000,
            positionSide: 'LONG',
        }]));
        const modifyMargin = vi.fn(() => {
            adjusted = true;
            if (mode === 'ambiguous-after-accept') {
                return Promise.reject(new FuturesProductionExecutionFacadeError({
                    kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                    endpointId: 'modify-isolated-position-margin',
                }));
            }
            return Promise.resolve(result('modify-isolated-position-margin', {
                acknowledged: true,
                code: 200,
                type: 1,
                amount: '5',
            }));
        });
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks = callbacks;
            return { ready: Promise.resolve(true), close: vi.fn() };
        });
        const harness = createHarness({
            connectUserDataStream,
            positionRisk,
            marginHistory,
            modifyMargin,
        });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
            emitted.at(-1).revision,
        ), { connectionId, emit: value => emitted.push(value) });
        expect(emitted.at(-1).capabilities.adjustMargin).toBe(true);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT,
            emitted.at(-1).revision,
            {
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                marginAction: 'ADD',
                amount: '5',
            },
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        expect(intent.kind).toBe('margin_adjustment');
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: 'ADJUST REAL FUTURES ISOLATED MARGIN',
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(modifyMargin).toHaveBeenCalledTimes(1);
        expect(marginHistory).toHaveBeenCalledTimes(1);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            kind: 'margin_adjustment',
            acknowledgement: 'accepted',
            state: 'confirmed_margin_adjusted',
            code: 'FUTURES_PRODUCTION_MARGIN_ADJUSTED',
        });
        expect(harness.service.getStatus().portfolio.positions[0].isolatedMarginUsdt)
            .toBe('35005');
        streamCallbacks.onMessage(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 1_783_814_500_001,
            T: 1_783_814_500_001,
            o: {
                s: 'BTCUSDT',
                i: 7,
                c: 'margin-projection-check',
                S: 'BUY',
                ps: 'LONG',
                o: 'LIMIT',
                f: 'GTC',
                p: '65000',
                q: '0.01',
                z: '0',
                x: 'NEW',
                X: 'NEW',
                R: false,
                cp: false,
                T: 1_783_814_500_001,
            },
        }));
        expect(harness.service.getStatus().portfolio.positions[0].isolatedMarginUsdt)
            .toBe('35005');
        const marginDispatches = harness.ledger.records.filter(record => (
            record.eventType === 'dispatch_intent'
            && record.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN
        ));
        expect(marginDispatches).toEqual([expect.objectContaining({
            marginAction: 'ADD',
            amount: '5',
            marginBefore: '35000',
        })]);
        await harness.service.shutdown();
    });

    it('recovers an ambiguous isolated-margin POST after restart by GET only', async () => {
        let adjusted = false;
        const positionRisk = vi.fn(symbol => result('position-risk', [
            {
                symbol,
                positionSide: 'LONG',
                positionAmt: '1',
                liquidationPrice: '50000',
                isolatedMargin: adjusted ? '35005' : '35000',
                marginAsset: 'USDT',
            },
            {
                symbol,
                positionSide: 'SHORT',
                positionAmt: '0',
                liquidationPrice: '0',
                isolatedMargin: '0',
                marginAsset: 'USDT',
            },
        ]));
        const modifyMargin = vi.fn(() => {
            adjusted = true;
            return Promise.reject(new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                endpointId: 'modify-isolated-position-margin',
            }));
        });
        const first = createHarness({
            positionRisk,
            modifyMargin,
            marginHistory: vi.fn().mockResolvedValue(result('position-margin-history', [])),
        });
        const emitted = [];
        await first.service.start();
        await subscribe(first.service, emitted);
        await first.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
            emitted.at(-1).revision,
        ), { connectionId, emit: value => emitted.push(value) });
        await first.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT,
            emitted.at(-1).revision,
            {
                symbol: 'BTCUSDT', positionSide: 'LONG', marginAction: 'ADD', amount: '5',
            },
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await first.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: 'ADJUST REAL FUTURES ISOLATED MARGIN',
            },
        ), { connectionId, emit: value => emitted.push(value) });
        expect(modifyMargin).toHaveBeenCalledTimes(1);
        expect(first.service.getCurrentAttempt()).toMatchObject({
            acknowledgement: 'unknown',
            state: 'result_unknown',
        });
        await first.service.shutdown();

        const restartModify = vi.fn();
        const restarted = createHarness({
            ledger: first.ledger,
            positionRisk,
            modifyMargin: restartModify,
            marginHistory: vi.fn().mockResolvedValue(result('position-margin-history', [{
                symbol: 'BTCUSDT',
                type: 1,
                amount: '5',
                asset: 'USDT',
                time: 1_783_814_500_000,
                positionSide: 'LONG',
            }])),
        });
        restarted.setClock(1_783_814_450_000);
        await restarted.service.start();

        expect(restartModify).not.toHaveBeenCalled();
        expect(restarted.coordinator.executeProduction).not.toHaveBeenCalled();
        expect(restarted.service.getCurrentAttempt()).toMatchObject({
            requestId: intent.requestId,
            acknowledgement: 'accepted',
            state: 'confirmed_margin_adjusted',
        });
        expect(first.ledger.getActiveOperations()).toEqual([]);
        await restarted.service.shutdown();
    });

    it('durably audits every startup activation gate exactly once', async () => {
        const harness = createHarness();

        await harness.service.start();

        const startupGates = harness.ledger.records.filter(record => (
            record.eventType === 'gate_decision'
            && record.category === 'gate'
        ));
        expect(startupGates).toHaveLength(FUTURES_PRODUCTION_ACTIVATION_GATES.length);
        expect(startupGates.map(record => record.gate)).toEqual(
            FUTURES_PRODUCTION_ACTIVATION_GATES,
        );
        for (const gate of FUTURES_PRODUCTION_ACTIVATION_GATES) {
            expect(startupGates.filter(record => record.gate === gate)).toHaveLength(1);
        }
        await harness.service.shutdown();
    });

    it('durably expires owner intents on TTL and disconnect without any exchange write', async () => {
        const expiryHarness = createHarness();
        const expiryEmitted = [];
        await expiryHarness.service.start();
        await subscribe(expiryHarness.service, expiryEmitted);
        const expiringIntent = await prepareOrder(expiryHarness.service, expiryEmitted);
        expect(expiryHarness.service.getStatus().capabilities.placeOrder).toBe(false);

        const expiryTimer = expiryHarness.timers.find(timer => timer.delay === 30_000);
        expect(expiryTimer).toBeDefined();
        expiryTimer.callback();
        for (let index = 0; index < 20 && !expiryHarness.ledger.records.some(record => (
            record.eventType === 'intent_expired'
        )); index += 1) await Promise.resolve();

        expect(expiryHarness.ledger.records.filter(record => (
            record.eventType === 'intent_expired'
        ))).toEqual([
            expect.objectContaining({
                requestId: expiringIntent.requestId,
                operationId: expiringIntent.requestId,
                intentId: expiringIntent.requestId,
                outcome: 'expired',
                state: 'expired',
            }),
        ]);
        expect(expiryHarness.service.getStatus()).toMatchObject({
            intent: null,
            capabilities: {
                placeOrder: true,
                cancelAllOpenOrders: true,
                closePositions: true,
            },
        });
        expect(expiryHarness.place).not.toHaveBeenCalled();
        expect(expiryHarness.placeMarket).not.toHaveBeenCalled();
        expect(expiryHarness.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(expiryHarness.facade.cancelAllAlgoOpenOrders).not.toHaveBeenCalled();
        await expiryHarness.service.shutdown();

        const disconnectHarness = createHarness();
        const ownerEmitted = [];
        await disconnectHarness.service.start();
        await subscribe(disconnectHarness.service, ownerEmitted);
        const disconnectedIntent = await prepareOrder(disconnectHarness.service, ownerEmitted);
        expect(disconnectHarness.service.disconnect(connectionId)).toBe(true);
        for (let index = 0; index < 20 && !disconnectHarness.ledger.records.some(record => (
            record.eventType === 'intent_expired'
        )); index += 1) await Promise.resolve();

        const peerConnectionId = 'd'.repeat(32);
        const peerEmitted = [];
        await disconnectHarness.service.handleRequest(JSON.stringify({
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
            version: 3,
            revision: '0',
            marketType: 'futures',
            environment: 'production',
            accountFingerprint: '0'.repeat(64),
        }), { connectionId: peerConnectionId, emit: value => peerEmitted.push(value) });
        await disconnectHarness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
            peerEmitted.at(-1).revision,
            {
                symbol: 'BTCUSDT', side: 'SELL', positionSide: 'LONG',
                positionEffect: 'EXIT', quantity: '0.001', price: '70000.0',
            },
        ), { connectionId: peerConnectionId, emit: value => peerEmitted.push(value) });

        expect(disconnectHarness.ledger.records.filter(record => (
            record.eventType === 'intent_expired'
        ))).toEqual([
            expect.objectContaining({
                requestId: disconnectedIntent.requestId,
                operationId: disconnectedIntent.requestId,
                intentId: disconnectedIntent.requestId,
                outcome: 'expired',
                state: 'expired',
            }),
        ]);
        expect(peerEmitted.at(-1).intent).toMatchObject({ kind: 'order' });
        expect(disconnectHarness.place).not.toHaveBeenCalled();
        expect(disconnectHarness.placeMarket).not.toHaveBeenCalled();
        expect(disconnectHarness.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(disconnectHarness.facade.cancelAllAlgoOpenOrders).not.toHaveBeenCalled();
        await disconnectHarness.service.shutdown();
    });

    it.each(productionIdentityGateCases)(
        'fails startup closed for $name after signed config and balance observations',
        async ({ accountConfig, balance }) => {
            const getAccountConfig = vi.fn().mockResolvedValue(
                result('account-config', accountConfig),
            );
            const getBalance = vi.fn().mockResolvedValue(result('balance-v3', balance));
            const harness = createHarness({
                accountConfig: getAccountConfig,
                balance: getBalance,
            });

            await harness.service.start();

            expect(getAccountConfig).toHaveBeenCalledOnce();
            expect(getBalance).toHaveBeenCalledOnce();
            expect(harness.service.getStatus().capabilities).toMatchObject({
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
            });
            expect(harness.evaluateRisk).not.toHaveBeenCalled();
            expect(harness.coordinator.reserveOrderDispatch).not.toHaveBeenCalled();
            expect(harness.coordinator.executeProduction).not.toHaveBeenCalled();
            expect(harness.place).not.toHaveBeenCalled();
            expect(harness.placeMarket).not.toHaveBeenCalled();
            await harness.service.shutdown();
        },
    );

    it.each(productionIdentityGateCases)(
        'rejects order preflight for $name before risk, reservation, or exchange write',
        async ({ accountConfig, balance }) => {
            const getAccountConfig = vi.fn()
                .mockResolvedValueOnce(result('account-config', validProductionAccountConfig()))
                .mockResolvedValue(result('account-config', accountConfig));
            const getBalance = vi.fn()
                .mockResolvedValueOnce(result('balance-v3', validProductionBalance()))
                .mockResolvedValue(result('balance-v3', balance));
            const harness = createHarness({
                accountConfig: getAccountConfig,
                balance: getBalance,
            });
            const emitted = [];
            await harness.service.start();
            await subscribe(harness.service, emitted);

            await prepareOrder(harness.service, emitted);

            expect(getAccountConfig).toHaveBeenCalledTimes(2);
            expect(getBalance).toHaveBeenCalledTimes(2);
            expect(harness.service.getCurrentAttempt()).toMatchObject({
                state: 'locally_rejected',
                code: 'FUTURES_PRODUCTION_GATE_REJECTED',
            });
            expect(harness.evaluateRisk).not.toHaveBeenCalled();
            expect(harness.coordinator.reserveOrderDispatch).not.toHaveBeenCalled();
            expect(harness.coordinator.executeProduction).not.toHaveBeenCalled();
            expect(harness.place).not.toHaveBeenCalled();
            await harness.service.shutdown();
        },
    );

    it.each(productionIdentityGateCases)(
        'rejects close preflight for $name before risk, reservation, or exchange write',
        async ({ accountConfig, balance }) => {
            const getAccountConfig = vi.fn()
                .mockResolvedValueOnce(result('account-config', validProductionAccountConfig()))
                .mockResolvedValue(result('account-config', accountConfig));
            const getBalance = vi.fn()
                .mockResolvedValueOnce(result('balance-v3', validProductionBalance()))
                .mockResolvedValue(result('balance-v3', balance));
            const harness = createHarness({
                accountConfig: getAccountConfig,
                balance: getBalance,
            });
            const emitted = [];
            await harness.service.start();
            await subscribe(harness.service, emitted);
            await vi.waitFor(() => {
                expect(harness.service.getStatus().portfolio.state).toBe('live');
            });
            await harness.service.handleRequest(command(
                FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT,
                harness.service.getStatus().revision,
            ), { connectionId, emit: value => emitted.push(value) });
            const intent = emitted.at(-1).intent;

            await harness.service.handleRequest(command(
                FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
                intent.revision,
                {
                    requestId: intent.requestId,
                    confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                        FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS
                    ],
                },
            ), { connectionId, emit: value => emitted.push(value) });

            expect(getAccountConfig).toHaveBeenCalledTimes(2);
            expect(getBalance).toHaveBeenCalledTimes(2);
            expect(harness.evaluateRisk).not.toHaveBeenCalled();
            expect(harness.coordinator.reserveOrderDispatch).not.toHaveBeenCalled();
            expect(harness.coordinator.executeProduction).not.toHaveBeenCalled();
            expect(harness.placeMarket).not.toHaveBeenCalled();
            await harness.service.shutdown();
        },
    );

    it('rejects an entry when fresh preflight balance no longer preserves the USDT reserve', async () => {
        const balance = vi.fn()
            .mockResolvedValueOnce(result('balance-v3', [{
                ...validProductionBalance()[0],
                availableBalance: '15',
            }]))
            .mockResolvedValue(result('balance-v3', [{
                ...validProductionBalance()[0],
                availableBalance: '11',
            }]));
        const markPrice = vi.fn().mockResolvedValue(result('mark-price', {
            symbol: 'BTCUSDT',
            markPrice: '5000',
        }));
        const positionRisk = vi.fn().mockResolvedValue(result('position-risk', [
            {
                symbol: 'BTCUSDT', positionSide: 'LONG', positionAmt: '0',
                liquidationPrice: '0', isolatedMargin: '0', marginAsset: 'USDT',
            },
            {
                symbol: 'BTCUSDT', positionSide: 'SHORT', positionAmt: '0',
                liquidationPrice: '0', isolatedMargin: '0', marginAsset: 'USDT',
            },
        ]));
        const harness = createHarness({
            balance,
            evaluateRisk: evaluateFuturesProductionExecutionRisk,
            markPrice,
            positionRisk,
        });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        expect(harness.service.getStatus().portfolio.availableBalanceUsdt).toBe('15');
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
            harness.service.getStatus().revision,
            {
                symbol: 'BTCUSDT',
                side: 'BUY',
                positionSide: 'LONG',
                positionEffect: 'ENTRY',
                quantity: '0.001',
                price: '5000',
            },
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        expect(intent).toBeNull();

        expect(balance).toHaveBeenCalledTimes(2);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'locally_rejected',
            code: FUTURES_PRODUCTION_EXECUTION_RISK_CODES.BALANCE_REJECTED,
        });
        expect(harness.coordinator.reserveOrderDispatch).not.toHaveBeenCalled();
        expect(harness.place).not.toHaveBeenCalled();
        await harness.service.shutdown();
    });

    it('uses a durable one-use intent, one POST, and exact Query Order confirmation', async () => {
        const harness = createHarness();
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);
        expect(intent).toMatchObject({ requestId, kind: 'order' });
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });
        expect(harness.place).toHaveBeenCalledOnce();
        expect(harness.query).toHaveBeenCalledOnce();
        expect(harness.coordinator.reserveOrderDispatch).toHaveBeenCalledOnce();
        expect(harness.coordinator.reserveOrderDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ exactNotional: '0' }),
        );
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_filled', acknowledgement: 'accepted',
        });
        expect(harness.ledger.records.some(record => (
            record.eventType === 'daily_notional_reserved'
            && record.quantity === '0.001'
        ))).toBe(true);
        expect(harness.ledger.records).toContainEqual(expect.objectContaining({
            eventType: 'dispatch_intent',
            requestId,
            operationId: requestId,
            clientOrderId: `cc7-${requestId}`,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            state: 'dispatched',
        }));
        const tracedExchange = harness.ledger.records.filter(record => (
            ['exchange_request', 'exchange_response'].includes(record.eventType)
            && ['new-limit-gtc-order', 'query-order'].includes(record.endpointId)
        ));
        expect(tracedExchange).toHaveLength(4);
        expect(tracedExchange).toEqual(tracedExchange.map(() => expect.objectContaining({
            requestId,
            operationId: requestId,
            clientOrderId: `cc7-${requestId}`,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            symbol: 'BTCUSDT',
        })));
        expect(harness.ledger.records).toContainEqual(expect.objectContaining({
            eventType: 'reconciliation_result',
            detailDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        }));
        await harness.service.shutdown();
    });

    it('places an ETH order after fresh symbol preflight without a configured symbol list', async () => {
        const positionRisk = vi.fn(symbol => result('position-risk', [
            {
                symbol, positionSide: 'LONG', positionAmt: '1',
                liquidationPrice: '2000', isolatedMargin: '1750', marginAsset: 'USDT',
            },
            {
                symbol, positionSide: 'SHORT', positionAmt: '0',
                liquidationPrice: '0', isolatedMargin: '0', marginAsset: 'USDT',
            },
        ]));
        const place = vi.fn(args => result('new-limit-gtc-order', {
            symbol: args.symbol,
            clientOrderId: args.clientOrderId,
            orderId: '41',
        }));
        const query = vi.fn(args => result('query-order', order({
            symbol: 'ETHUSDT',
            clientOrderId: args.originalClientOrderId,
            orderId: '41',
            side: 'SELL',
            positionSide: 'LONG',
            status: 'FILLED',
            originalQuantity: '0.001',
            executedQuantity: '0.001',
            price: '3500',
        })));
        const harness = createHarness({
            exchangeInfoValue: twoSymbolExchangeInfo,
            positionRisk,
            place,
            query,
        });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
            harness.service.getStatus().revision,
            {
                symbol: 'ETHUSDT',
                side: 'SELL',
                positionSide: 'LONG',
                positionEffect: 'EXIT',
                quantity: '0.001',
                price: '3500',
            },
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        expect(intent).toMatchObject({ kind: 'order' });
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(place).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETHUSDT' }));
        expect(query).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETHUSDT' }));
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_filled',
            items: [{ symbol: 'ETHUSDT' }],
        });
        await harness.service.shutdown();
    });

    it('projects a newly confirmed open order without waiting for a stream event or REST refresh', async () => {
        const query = vi.fn().mockResolvedValue(result('query-order', order({
            status: 'NEW',
            executedQuantity: '0',
            averagePrice: '0',
        })));
        const openOrders = vi.fn().mockResolvedValue(result('open-orders', []));
        const harness = createHarness({ query, openOrders });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);

        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({
                clientOrderId: `cc7-${requestId}`,
                status: 'NEW',
                syncState: 'synced',
            }),
        ]);
        expect(openOrders).toHaveBeenCalledTimes(3);
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
        expect(openOrders).toHaveBeenCalledTimes(3);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_open',
            acknowledgement: 'accepted',
        });
        expect(harness.service.getStatus()).toMatchObject({
            recovery: { required: false, state: 'healthy' },
            capabilities: { placeOrder: true },
        });
        expect(harness.ledger.getActiveOperations()).toEqual([]);
        expect(harness.timers.some(timer => timer.delay === 60_000)).toBe(false);
        await harness.service.shutdown();
    });

    it('publishes an ACK-backed create as pending before deferred Query Order then syncs it', async () => {
        let resolveQuery;
        const query = vi.fn(() => new Promise((resolve) => { resolveQuery = resolve; }));
        const transactTime = 1_783_814_400_123;
        const place = vi.fn().mockResolvedValue(result('new-limit-gtc-order', {
            symbol: 'BTCUSDT',
            clientOrderId: `cc7-${requestId}`,
            orderId: '9223372036854775807',
            transactTime,
        }));
        const harness = createHarness({ place, query });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);

        const final = harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({
                orderId: '9223372036854775807',
                clientOrderId: `cc7-${requestId}`,
                price: '70000.0',
                status: 'NEW',
                syncState: 'pending',
            }),
        ]);

        resolveQuery(result('query-order', order({
            status: 'NEW',
            executedQuantity: '0',
            averagePrice: '0',
            updateTime: transactTime,
        })));
        await final;
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({
                orderId: '9223372036854775807',
                syncState: 'synced',
            }),
        ]);
        await harness.service.shutdown();
    });

    it('does not fabricate a create projection when ACK omits the server transaction time', async () => {
        let resolveQuery;
        const query = vi.fn(() => new Promise((resolve) => { resolveQuery = resolve; }));
        const harness = createHarness({ query });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);

        const final = harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([]);
        resolveQuery(result('query-order', order({
            status: 'REJECTED',
            executedQuantity: '0',
            averagePrice: '0',
        })));
        await final;
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([]);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'exchange_rejected',
            acknowledgement: 'rejected',
        });
        expect(harness.service.getStatus()).toMatchObject({
            recovery: { required: false, state: 'healthy' },
            capabilities: { placeOrder: true },
        });
        expect(harness.ledger.getActiveOperations()).toEqual([]);
        await harness.service.shutdown();
    });

    it('never retries an ambiguous POST and retains query-only unknown recovery', async () => {
        const place = vi.fn().mockRejectedValue(new FuturesProductionExecutionFacadeError({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeLimitGtcOrder',
            endpointId: 'new-limit-gtc-order',
        }));
        const query = vi.fn().mockRejectedValue(new FuturesProductionExecutionFacadeError({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
            operation: 'queryOrder',
            endpointId: 'query-order',
        }));
        const harness = createHarness({ place, query });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });
        expect(place).toHaveBeenCalledOnce();
        expect(query).toHaveBeenCalledOnce();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'result_unknown', acknowledgement: 'unknown',
        });
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([]);
        expect(harness.timers).toContainEqual(expect.objectContaining({ delay: 1_000 }));
        await harness.service.shutdown();
    });

    it('confirms an empty authoritative order inventory without issuing delete writes', async () => {
        const harness = createHarness();
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await harness.service.recoverOperationally({
            authorization: config.recoveryAuthorization,
            action: 'disengageKillSwitch',
        });
        const revision = harness.service.getStatus().revision;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
            revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });
        expect(harness.facade.getAllOpenOrders).toHaveBeenCalledTimes(3);
        expect(harness.facade.getAllOpenAlgoOrders).toHaveBeenCalledTimes(3);
        expect(harness.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(harness.facade.cancelAllAlgoOpenOrders).not.toHaveBeenCalled();
        expect(harness.facade.placeHedgeMarketExitOrder).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt().state).toBe('confirmed_canceled');
        await harness.service.shutdown();
    });

    it('preserves a new private-stream order that arrives inside cancel-all', async () => {
        let streamCallbacks = null;
        const oldOrder = ownedOpenOrder({
            orderId: '1',
            clientOrderId: 'cancel-target',
            updateTime: 1_783_814_400_000,
        });
        const newOrder = ownedOpenOrder({
            orderId: '2',
            clientOrderId: 'arrived-during-cancel',
            side: 'BUY',
            updateTime: 1_783_814_400_001,
        });
        const allOpenOrders = vi.fn()
            .mockResolvedValueOnce(result('all-open-orders', [oldOrder]))
            .mockResolvedValueOnce(result('all-open-orders', [oldOrder]))
            .mockResolvedValue(result('all-open-orders', [newOrder]));
        const openOrders = vi.fn().mockResolvedValue(result('open-orders', []));
        const connectUserDataStream = vi.fn((callbacks) => {
            streamCallbacks = callbacks;
            return { ready: Promise.resolve(true), close: vi.fn() };
        });
        const cancelRegular = vi.fn(() => {
            streamCallbacks.onMessage(JSON.stringify({
                e: 'ORDER_TRADE_UPDATE',
                E: 1_783_814_400_001,
                T: 1_783_814_400_001,
                o: {
                    s: 'BTCUSDT',
                    i: 2,
                    c: 'arrived-during-cancel',
                    S: 'BUY',
                    ps: 'LONG',
                    o: 'LIMIT',
                    f: 'GTC',
                    p: '65000',
                    q: '0.01',
                    z: '0',
                    x: 'NEW',
                    X: 'NEW',
                    R: false,
                    cp: false,
                    T: 1_783_814_400_001,
                },
            }));
            return Promise.resolve(result('cancel-all-open-orders', { acknowledged: true }));
        });
        const harness = createHarness({
            allOpenOrders,
            cancelRegular,
            connectUserDataStream,
            openOrders,
        });
        const emitted = [];

        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(harness.service.getStatus().portfolio.openOrders).toEqual(expect.arrayContaining([
            expect.objectContaining({
                orderId: '2',
                clientOrderId: 'arrived-during-cancel',
            }),
            expect.objectContaining({
                orderId: '1',
                clientOrderId: 'cancel-target',
                syncState: 'stale',
            }),
        ]));
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'partial',
            items: [{ symbol: 'BTCUSDT', outcome: 'unknown' }],
        });
        expect(harness.service.getStatus().recovery.required).toBe(true);
        await harness.service.shutdown();
    });

    it('engages the persistent kill switch without any exchange action', async () => {
        const harness = createHarness();
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await harness.service.recoverOperationally({
            authorization: config.recoveryAuthorization,
            action: 'disengageKillSwitch',
        });
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ENGAGE_KILL_SWITCH_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });
        expect(harness.service.getStatus().killSwitch.engaged).toBe(true);
        expect(harness.coordinator.executeProduction).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt().state).toBe('kill_switch_engaged');
        await harness.service.shutdown();
    });

    it('arms live only through an exact durable one-use intent and performs no exchange request', async () => {
        const ledger = new FakeLedger([], { killSwitchEngaged: true });
        const setKillSwitch = vi.spyOn(ledger, 'setKillSwitch');
        const identifiers = ['0'.repeat(32), requestId];
        const harness = createHarness({
            ledger,
            randomBytes: () => Buffer.from(
                identifiers.shift() ?? '2'.repeat(32),
                'hex',
            ),
        });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);

        expect(harness.service.getStatus()).toMatchObject({
            killSwitch: { engaged: true },
            capabilities: {
                placeOrder: true,
                engageKillSwitch: false,
                disengageKillSwitch: true,
            },
        });
        await expect(harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
            harness.service.getStatus().revision,
            {
                symbol: 'BTCUSDT',
                side: 'BUY',
                positionSide: 'LONG',
                positionEffect: 'ENTRY',
                quantity: '0.001',
                price: '7000',
            },
        ), { connectionId, emit: value => emitted.push(value) })).resolves.toBe(false);
        expect(harness.facade.getExchangeInfo).not.toHaveBeenCalled();

        await expect(harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_DISENGAGE_KILL_SWITCH_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) })).resolves.toBe(true);
        const intent = emitted.at(-1).intent;
        expect(intent).toMatchObject({ kind: 'disengage_kill_switch' });
        const final = command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH
                ],
            },
        );
        await expect(harness.service.handleRequest(final, {
            connectionId,
            emit: value => emitted.push(value),
        })).resolves.toBe(true);
        await expect(harness.service.handleRequest(final, {
            connectionId,
            emit: value => emitted.push(value),
        })).resolves.toBe(true);

        expect(setKillSwitch).toHaveBeenCalledOnce();
        expect(setKillSwitch).toHaveBeenCalledWith(expect.objectContaining({
            engaged: false,
            requestId: intent.requestId,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
        }));
        expect(harness.service.getStatus()).toMatchObject({
            killSwitch: { engaged: false },
            capabilities: {
                placeOrder: true,
                engageKillSwitch: true,
                disengageKillSwitch: false,
            },
            attempt: {
                state: 'kill_switch_disengaged',
                acknowledgement: 'accepted',
                code: 'FUTURES_PRODUCTION_LIVE_ARMED',
            },
        });
        expect(harness.coordinator.executeProduction).not.toHaveBeenCalled();
        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.placeMarket).not.toHaveBeenCalled();
        expect(harness.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(harness.facade.cancelAllAlgoOpenOrders).not.toHaveBeenCalled();
        await harness.service.shutdown();
    });

    it('idempotently absorbs concurrent reuse of a one-use final command before a second POST', async () => {
        let release;
        const place = vi.fn(() => new Promise(resolve => { release = resolve; }));
        const harness = createHarness({ place });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);
        const final = command(FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER, intent.revision, {
            requestId: intent.requestId,
            confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
            ],
        });
        const first = harness.service.handleRequest(final, {
            connectionId, emit: value => emitted.push(value),
        });
        while (!release) await Promise.resolve();
        const duplicate = harness.service.handleRequest(final, {
            connectionId, emit: value => emitted.push(value),
        });
        await Promise.resolve();
        expect(place).toHaveBeenCalledOnce();
        release(result('new-limit-gtc-order', {
            symbol: 'BTCUSDT', clientOrderId: `cc7-${requestId}`, orderId: '9223372036854775807',
        }));
        await expect(Promise.all([first, duplicate])).resolves.toEqual([true, true]);
        expect(place).toHaveBeenCalledOnce();
        await harness.service.shutdown();
    });

    it('rejects cross-owner and cross-action replays without mutating the completed attempt', async () => {
        const harness = createHarness();
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);
        const final = command(FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER, intent.revision, {
            requestId: intent.requestId,
            confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
            ],
        });
        await expect(harness.service.handleRequest(final, {
            connectionId, emit: value => emitted.push(value),
        })).resolves.toBe(true);
        const completedAttempt = harness.service.getCurrentAttempt();

        const otherConnectionId = 'd'.repeat(32);
        const otherEmitted = [];
        await harness.service.handleRequest(JSON.stringify({
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
            version: 3,
            revision: '0',
            marketType: 'futures',
            environment: 'production',
            accountFingerprint: '0'.repeat(64),
        }), { connectionId: otherConnectionId, emit: value => otherEmitted.push(value) });
        await expect(harness.service.handleRequest(final, {
            connectionId: otherConnectionId,
            emit: value => otherEmitted.push(value),
        })).resolves.toBe(false);
        await expect(harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) })).resolves.toBe(false);

        expect(harness.place).toHaveBeenCalledOnce();
        expect(harness.service.getCurrentAttempt()).toBe(completedAttempt);
        expect(harness.ledger.records.filter(record => (
            record.eventType === 'gate_decision'
            && record.gate === 'finalCommandIdentity'
        ))).toHaveLength(2);
        await harness.service.shutdown();
    });

    it('reports cancel-all as partial until both exact inventories are confirmed empty', async () => {
        const openOrders = vi.fn().mockResolvedValue(result(
            'open-orders',
            [ownedOpenOrder({ clientOrderId: 'still-open-after-cancel' })],
        ));
        const harness = createHarness({ openOrders });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(harness.facade.cancelAllOpenOrders).toHaveBeenCalledOnce();
        expect(harness.facade.cancelAllAlgoOpenOrders).toHaveBeenCalledOnce();
        expect(harness.placeMarket).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'partial',
            acknowledgement: 'partial',
            items: [{ symbol: 'BTCUSDT', outcome: 'unknown' }],
        });
        expect(harness.service.getStatus().recovery).toMatchObject({
            required: true,
            state: 'blocked',
        });
        expect(harness.ledger.records).toContainEqual(expect.objectContaining({
            eventType: 'cancel_all_child',
            state: 'recovery_required',
            safeDetail: 'delete-acknowledged',
        }));
        await expect(harness.service.recoverOperationally({
            authorization: config.recoveryAuthorization,
            action: 'disengageKillSwitch',
        })).resolves.toBe(false);
        expect(harness.ledger.records.filter(record => (
            record.eventType === 'operator_recovery'
            && record.action === 'backend.futuresProduction.disengageKillSwitch'
        )).slice(-2)).toEqual([
            expect.objectContaining({ outcome: 'pending', state: 'pending' }),
            expect.objectContaining({ outcome: 'blocked', state: 'blocked' }),
        ]);
        await harness.service.shutdown();
    });

    it('keeps cancel targets visible as pending and restores them stale when exact GET fails', async () => {
        let rejectInventory;
        const inventory = [
            ownedOpenOrder({
                orderId: '7',
                clientOrderId: 'external-cancel-target',
                updateTime: 1_783_814_400_000,
            }),
            ownedOpenOrder({
                symbol: 'ETHUSDT',
                orderId: '8',
                clientOrderId: 'external-eth-cancel-target',
                updateTime: 1_783_814_400_001,
            }),
        ];
        const openOrders = vi.fn()
            .mockResolvedValueOnce(result('open-orders', inventory))
            .mockResolvedValueOnce(result('open-orders', inventory))
            .mockImplementationOnce(() => new Promise((_resolve, reject) => {
                rejectInventory = reject;
            }));
        const harness = createHarness({ openOrders });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;

        const final = harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        await vi.waitFor(() => expect(rejectInventory).toBeTypeOf('function'));
        expect(harness.service.getStatus().portfolio.openOrders).toEqual(expect.arrayContaining([
            expect.objectContaining({
                symbol: 'BTCUSDT',
                clientOrderId: 'external-cancel-target',
                syncState: 'pending',
            }),
            expect.objectContaining({
                symbol: 'ETHUSDT',
                clientOrderId: 'external-eth-cancel-target',
                syncState: 'pending',
            }),
        ]));
        rejectInventory(new FuturesProductionExecutionFacadeError({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'openOrders',
            endpointId: 'open-orders',
        }));
        await final;

        expect(harness.service.getStatus().portfolio.openOrders).toEqual(expect.arrayContaining([
            expect.objectContaining({
                symbol: 'BTCUSDT',
                clientOrderId: 'external-cancel-target',
                syncState: 'stale',
            }),
            expect.objectContaining({
                symbol: 'ETHUSDT',
                clientOrderId: 'external-eth-cancel-target',
                syncState: 'stale',
            }),
        ]));
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'partial',
            acknowledgement: 'partial',
        });
        await harness.service.shutdown();
    });

    it('cancels arbitrary external BTC and ETH inventory without a catalog allowlist', async () => {
        const inventory = [
            ownedOpenOrder({
                orderId: '7',
                clientOrderId: 'external-btc-cancel-target',
                updateTime: 1_783_814_400_000,
            }),
            ownedOpenOrder({
                symbol: 'ETHUSDT',
                orderId: '8',
                clientOrderId: 'external-eth-cancel-target',
                updateTime: 1_783_814_400_001,
            }),
        ];
        const openOrders = vi.fn()
            .mockResolvedValueOnce(result('open-orders', inventory))
            .mockResolvedValueOnce(result('open-orders', inventory))
            .mockResolvedValue(result('open-orders', []));
        const harness = createHarness({ openOrders });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        expect(harness.service.getStatus().portfolio.openOrders).toHaveLength(2);

        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_canceled',
            acknowledgement: 'accepted',
        });
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([]);
        expect(harness.facade.cancelAllOpenOrders.mock.calls).toEqual([
            [{ symbol: 'BTCUSDT' }],
            [{ symbol: 'ETHUSDT' }],
        ]);
        expect(openOrders).toHaveBeenCalledTimes(3);
        await harness.service.shutdown();
    });

    it('uses a Binance-time boundary to confirm cancellation when the local clock is behind', async () => {
        const serverTimes = [1_900_000_000_000, 1_900_000_000_200];
        const getServerTime = vi.fn(() => {
            const serverTime = serverTimes.shift() ?? 1_900_000_000_200;
            return result('server-time', {
                serverTime,
                sentAt: serverTime,
                receivedAt: serverTime,
                roundTripMs: 0,
            });
        });
        const openOrders = vi.fn()
            .mockResolvedValueOnce(result('open-orders', [ownedOpenOrder({
                orderId: '71',
                clientOrderId: 'clock-skew-cancel-target',
                updateTime: 1_900_000_000_100,
            })]))
            .mockResolvedValueOnce(result('open-orders', [ownedOpenOrder({
                orderId: '71',
                clientOrderId: 'clock-skew-cancel-target',
                updateTime: 1_900_000_000_100,
            })]))
            .mockResolvedValue(result('open-orders', []));
        const harness = createHarness({ getServerTime, openOrders });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([
            expect.objectContaining({ clientOrderId: 'clock-skew-cancel-target' }),
        ]);

        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_canceled',
            acknowledgement: 'accepted',
        });
        expect(harness.service.getStatus().portfolio.openOrders).toEqual([]);
        expect(getServerTime).toHaveBeenCalledTimes(3);
        await harness.service.shutdown();
    });

    it('reports close-positions as partial after one ambiguous market POST and exact query failure', async () => {
        const placeMarket = vi.fn().mockRejectedValue(
            new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                operation: 'placeHedgeMarketExitOrder',
                endpointId: 'new-hedge-market-exit-order',
            }),
        );
        const query = vi.fn().mockRejectedValue(new FuturesProductionExecutionFacadeError({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
            operation: 'queryOrder',
            endpointId: 'query-order',
        }));
        const harness = createHarness({ placeMarket, query });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(placeMarket).toHaveBeenCalledOnce();
        expect(query).toHaveBeenCalledOnce();
        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'partial',
            acknowledgement: 'partial',
            items: [{ symbol: 'BTCUSDT', outcome: 'unknown' }],
        });
        expect(harness.service.getStatus().recovery.required).toBe(true);
        expect(harness.ledger.records).toContainEqual(expect.objectContaining({
            eventType: 'close_positions_child',
            state: 'recovery_required',
        }));
        const reservationIndex = harness.ledger.records.findIndex(record => (
            record.eventType === 'daily_notional_reserved'
        ));
        const dispatchIndex = harness.ledger.records.findIndex(record => (
            record.eventType === 'dispatch_intent'
            && record.orderType === 'MARKET'
        ));
        const exchangeRequestIndex = harness.ledger.records.findIndex(record => (
            record.eventType === 'exchange_request'
            && record.endpointId === 'new-hedge-market-exit-order'
        ));
        expect(reservationIndex).toBeGreaterThanOrEqual(0);
        expect(dispatchIndex).toBeGreaterThan(reservationIndex);
        expect(exchangeRequestIndex).toBeGreaterThan(dispatchIndex);
        await harness.service.shutdown();
    });

    it('closes an arbitrary SOL hedge leg from authoritative global position inventory', async () => {
        const livePosition = {
            symbol: 'SOLUSDT',
            positionSide: 'LONG',
            positionAmt: '3',
            entryPrice: '150',
            markPrice: '160',
            notional: '480',
            unRealizedProfit: '30',
            isolatedMargin: '240',
            liquidationPrice: '100',
            leverage: '2',
            marginType: 'isolated',
            marginAsset: 'USDT',
        };
        const allPositionRisk = vi.fn()
            .mockResolvedValueOnce(result('position-risk', [livePosition]))
            .mockResolvedValueOnce(result('position-risk', [livePosition]))
            .mockResolvedValue(result('position-risk', []));
        const positionRisk = vi.fn()
            .mockResolvedValueOnce(result('position-risk', [{
                symbol: 'SOLUSDT', positionSide: 'LONG', positionAmt: '3',
                liquidationPrice: '100', isolatedMargin: '240', marginAsset: 'USDT',
            }]))
            .mockResolvedValue(result('position-risk', [{
                symbol: 'SOLUSDT', positionSide: 'LONG', positionAmt: '0',
                liquidationPrice: '0', isolatedMargin: '0', marginAsset: 'USDT',
            }]));
        const query = vi.fn(args => result('query-order', order({
            symbol: 'SOLUSDT',
            clientOrderId: args.originalClientOrderId,
            side: 'SELL',
            positionSide: 'LONG',
            type: 'MARKET',
            originalType: 'MARKET',
            status: 'FILLED',
            originalQuantity: '3',
            executedQuantity: '3',
            price: '0',
        })));
        const placeMarket = vi.fn(args => result('new-hedge-market-exit-order', {
            symbol: args.symbol,
            clientOrderId: args.clientOrderId,
            orderId: '31',
        }));
        const solExchangeInfo = {
            symbols: [{
                ...exchangeInfo.symbols[0],
                symbol: 'SOLUSDT',
                filters: exchangeInfo.symbols[0].filters.map(filter => ({ ...filter })),
            }],
        };
        const harness = createHarness({
            exchangeInfoValue: solExchangeInfo,
            allPositionRisk,
            positionRisk,
            query,
            placeMarket,
            allSymbolConfig: vi.fn().mockResolvedValue(result('all-symbol-config', [{
                symbol: 'SOLUSDT', marginType: 'ISOLATED', isAutoAddMargin: false,
                leverage: 2, maxNotionalValue: '1000000',
            }])),
        });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(placeMarket).toHaveBeenCalledWith(expect.objectContaining({
            symbol: 'SOLUSDT', side: 'SELL', positionSide: 'LONG', quantity: '3',
        }));
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_closed',
            items: [{ symbol: 'SOLUSDT', outcome: 'closed' }],
        });
        expect(harness.service.getStatus().portfolio.positions).toEqual([]);
        expect(allPositionRisk).toHaveBeenCalledTimes(3);
        await harness.service.shutdown();
    });

    it('blocks close-all when a new position appears after the target snapshot', async () => {
        const newPosition = {
            symbol: 'SOLUSDT',
            positionSide: 'SHORT',
            positionAmt: '-1',
            entryPrice: '150',
            markPrice: '160',
            notional: '-160',
            unRealizedProfit: '-10',
            isolatedMargin: '80',
            liquidationPrice: '220',
            leverage: '2',
            marginType: 'isolated',
            marginAsset: 'USDT',
        };
        const allPositionRisk = vi.fn()
            .mockResolvedValueOnce(result('position-risk', []))
            .mockResolvedValueOnce(result('position-risk', []))
            .mockResolvedValue(result('position-risk', [newPosition]));
        const harness = createHarness({ allPositionRisk });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(harness.placeMarket).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'partial',
            items: [{ symbol: 'SOLUSDT', outcome: 'unknown' }],
        });
        expect(harness.service.getStatus().recovery).toMatchObject({
            required: true,
            state: 'blocked',
        });
        await harness.service.shutdown();
    });

    it('uses global regular and algo inventory for GET-only cancel recovery', async () => {
        const btcOrder = ownedOpenOrder({
            orderId: '11',
            clientOrderId: 'external-btc-limit',
        });
        const ethAlgo = externalAlgoOrder({
            symbol: 'ETHUSDT',
            algoId: '12',
            clientAlgoId: 'external-eth-algo',
        });
        const openOrders = vi.fn()
            .mockResolvedValueOnce(result('open-orders', [btcOrder]))
            .mockResolvedValueOnce(result('open-orders', [btcOrder]))
            .mockResolvedValue(result('open-orders', []));
        const openAlgoOrders = vi.fn()
            .mockResolvedValueOnce(result('open-algo-orders', [ethAlgo]))
            .mockResolvedValueOnce(result('open-algo-orders', [ethAlgo]))
            .mockResolvedValue(result('open-algo-orders', [ethAlgo]));
        const cancelRegular = vi.fn(({ symbol }) => result('cancel-all-open-orders', {
            acknowledged: true,
            symbol,
        }));
        const cancelAlgo = vi.fn(({ symbol }) => result('cancel-all-algo-open-orders', {
            acknowledged: true,
            symbol,
        }));
        const harness = createHarness({
            runtimeConfig: config,
            exchangeInfoValue: twoSymbolExchangeInfo,
            openOrders,
            openAlgoOrders,
            cancelRegular,
            cancelAlgo,
        });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(cancelRegular.mock.calls).toEqual([
            [{ symbol: 'BTCUSDT' }],
            [{ symbol: 'ETHUSDT' }],
        ]);
        expect(cancelAlgo.mock.calls).toEqual([
            [{ symbol: 'BTCUSDT' }],
            [{ symbol: 'ETHUSDT' }],
        ]);
        expect(harness.coordinator.executeProduction).toHaveBeenCalledTimes(4);
        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.placeMarket).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            requestId: intent.requestId,
            state: 'partial',
            acknowledgement: 'partial',
            items: [
                { symbol: 'BTCUSDT', outcome: 'unknown' },
                { symbol: 'ETHUSDT', outcome: 'unknown' },
            ],
        });
        expect(harness.ledger.records.filter(record => (
            record.eventType === 'cancel_all_child'
            && record.state !== 'dispatched'
        ))).toEqual([
            expect.objectContaining({
                requestId: intent.requestId,
                operationId: `${intent.requestId}:BTCUSDT`,
                parentOperationId: intent.requestId,
                symbol: 'BTCUSDT',
                outcome: 'unknown',
                state: 'recovery_required',
            }),
            expect.objectContaining({
                requestId: intent.requestId,
                operationId: `${intent.requestId}:ETHUSDT`,
                parentOperationId: intent.requestId,
                symbol: 'ETHUSDT',
                outcome: 'unknown',
                state: 'recovery_required',
            }),
        ]);
        await harness.service.shutdown();

        const restartOpenOrders = vi.fn(() => result('open-orders', []));
        const restartOpenAlgoOrders = vi.fn(() => result('open-algo-orders', [ethAlgo]));
        const restartCancelRegular = vi.fn();
        const restartCancelAlgo = vi.fn();
        const restarted = createHarness({
            ledger: harness.ledger,
            runtimeConfig: config,
            exchangeInfoValue: twoSymbolExchangeInfo,
            openOrders: restartOpenOrders,
            openAlgoOrders: restartOpenAlgoOrders,
            cancelRegular: restartCancelRegular,
            cancelAlgo: restartCancelAlgo,
        });
        restarted.setClock(1_783_814_500_000);
        await restarted.service.start();

        expect(restartOpenOrders.mock.calls).toEqual([[]]);
        expect(restartOpenAlgoOrders.mock.calls).toEqual([[]]);
        expect(restartCancelRegular).not.toHaveBeenCalled();
        expect(restartCancelAlgo).not.toHaveBeenCalled();
        expect(restarted.coordinator.executeProduction).not.toHaveBeenCalled();
        expect(restarted.place).not.toHaveBeenCalled();
        expect(restarted.placeMarket).not.toHaveBeenCalled();
        expect(restarted.service.getCurrentAttempt()).toMatchObject({
            requestId: intent.requestId,
            state: 'partial',
            items: [
                { symbol: 'BTCUSDT', outcome: 'unknown' },
                { symbol: 'ETHUSDT', outcome: 'unknown' },
            ],
        });
        expect(harness.ledger.records.some(record => (
            record.eventType === 'restart_recovery'
            && record.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS
            && record.state === 'confirmed_empty'
        ))).toBe(false);
        await restarted.service.shutdown();
    });

    it('keeps mixed close child identities exact and restart recovery strictly GET-only', async () => {
        const childRequestId = '2'.repeat(32);
        const identifiers = ['0'.repeat(32), requestId, childRequestId];
        const randomBytes = vi.fn(() => Buffer.from(
            identifiers.shift() ?? 'f'.repeat(32),
            'hex',
        ));
        const positionRisk = vi.fn(symbol => result('position-risk', [
            {
                symbol,
                positionSide: 'LONG',
                positionAmt: symbol === 'BTCUSDT' ? '0' : '2.000',
                liquidationPrice: symbol === 'BTCUSDT' ? '0' : '2000',
                marginAsset: 'USDT',
            },
            {
                symbol,
                positionSide: 'SHORT',
                positionAmt: '0',
                liquidationPrice: '0',
                marginAsset: 'USDT',
            },
        ]));
        const allPositionRows = [{
            symbol: 'ETHUSDT',
            positionSide: 'LONG',
            positionAmt: '2.000',
            entryPrice: '3000',
            markPrice: '3500',
            notional: '7000',
            unRealizedProfit: '1000',
            isolatedMargin: '3500',
            liquidationPrice: '2000',
            leverage: '2',
            marginType: 'isolated',
            marginAsset: 'USDT',
        }];
        const allPositionRisk = vi.fn(() => result('position-risk', allPositionRows));
        const placeMarket = vi.fn().mockRejectedValue(
            new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                operation: 'placeHedgeMarketExitOrder',
                endpointId: 'new-hedge-market-exit-order',
            }),
        );
        const query = vi.fn().mockRejectedValue(new FuturesProductionExecutionFacadeError({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
            operation: 'queryOrder',
            endpointId: 'query-order',
        }));
        const harness = createHarness({
            runtimeConfig: config,
            exchangeInfoValue: twoSymbolExchangeInfo,
            positionRisk,
            allPositionRisk,
            placeMarket,
            query,
            randomBytes,
        });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        await waitForPortfolioBootstrap(harness.service);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT,
            harness.service.getStatus().revision,
        ), { connectionId, emit: value => emitted.push(value) });
        const intent = emitted.at(-1).intent;
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(intent.requestId).toBe(requestId);
        expect(placeMarket).toHaveBeenCalledOnce();
        expect(placeMarket).toHaveBeenCalledWith({
            symbol: 'ETHUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            quantity: '2.000',
            clientOrderId: `cc7-${childRequestId}`,
        });
        expect(query).toHaveBeenCalledOnce();
        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(harness.facade.cancelAllAlgoOpenOrders).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            requestId,
            state: 'partial',
            acknowledgement: 'partial',
            items: [
                { symbol: 'ETHUSDT', outcome: 'unknown' },
            ],
        });
        expect(harness.ledger.records.filter(record => (
            record.eventType === 'close_positions_child'
        ))).toEqual([
            expect.objectContaining({
                requestId: childRequestId,
                operationId: childRequestId,
                parentOperationId: requestId,
                clientOrderId: `cc7-${childRequestId}`,
                symbol: 'ETHUSDT',
                positionSide: 'LONG',
                quantity: '2.000',
                state: 'recovery_required',
            }),
        ]);
        expect(harness.ledger.records.filter(record => (
            record.eventType === 'dispatch_intent'
            && record.parentOperationId === requestId
        ))).toEqual([
            expect.objectContaining({
                requestId: childRequestId,
                operationId: childRequestId,
                clientOrderId: `cc7-${childRequestId}`,
                symbol: 'ETHUSDT',
            }),
        ]);
        await harness.service.shutdown();

        const restartPositionRisk = vi.fn(symbol => result('position-risk', [
            {
                symbol,
                positionSide: 'LONG',
                positionAmt: symbol === 'BTCUSDT' ? '0' : '2.000',
                liquidationPrice: symbol === 'BTCUSDT' ? '0' : '2000',
                marginAsset: 'USDT',
            },
            {
                symbol,
                positionSide: 'SHORT',
                positionAmt: '0',
                liquidationPrice: '0',
                marginAsset: 'USDT',
            },
        ]));
        const restartAllPositionRisk = vi.fn(() => result('position-risk', allPositionRows));
        const restartQuery = vi.fn().mockRejectedValue(
            new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
                operation: 'queryOrder',
                endpointId: 'query-order',
            }),
        );
        const restartPlaceMarket = vi.fn();
        const restarted = createHarness({
            ledger: harness.ledger,
            runtimeConfig: config,
            exchangeInfoValue: twoSymbolExchangeInfo,
            positionRisk: restartPositionRisk,
            allPositionRisk: restartAllPositionRisk,
            query: restartQuery,
            placeMarket: restartPlaceMarket,
        });
        restarted.setClock(1_783_814_500_000);
        await restarted.service.start();

        expect(restartQuery).not.toHaveBeenCalled();
        expect(restartPositionRisk).not.toHaveBeenCalled();
        expect(restartAllPositionRisk.mock.calls).toEqual([[]]);
        expect(restartPlaceMarket).not.toHaveBeenCalled();
        expect(restarted.place).not.toHaveBeenCalled();
        expect(restarted.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(restarted.facade.cancelAllAlgoOpenOrders).not.toHaveBeenCalled();
        expect(restarted.coordinator.executeProduction).not.toHaveBeenCalled();
        expect(restarted.service.getCurrentAttempt()).toMatchObject({
            requestId,
            state: 'partial',
            items: [
                { symbol: 'ETHUSDT', outcome: 'unknown' },
            ],
        });
        expect(harness.ledger.records.some(record => (
            record.eventType === 'restart_recovery'
            && record.symbol === 'ETHUSDT'
            && record.state === 'confirmed_closed'
        ))).toBe(false);
        await restarted.service.shutdown();
    });

    it('recovers a durable dispatched order by Query Order only after restart', async () => {
        const ledger = new FakeLedger([{
            eventType: 'dispatch_intent',
            requestId,
            operationId: requestId,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            commandDigest: 'e'.repeat(64),
            clientOrderId: `cc7-${requestId}`,
            credentialBinding: binding,
            state: 'dispatched',
            dispatchAt: 1_783_814_400_000,
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            positionEffect: 'EXIT',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            quantity: '0.001',
            price: '70000.0',
            exchangeOrderId: '9223372036854775807',
        }]);
        const harness = createHarness({ ledger });

        await harness.service.start();

        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.query).toHaveBeenCalledOnce();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_filled',
            acknowledgement: 'accepted',
        });
        expect(harness.ledger.records).toContainEqual(expect.objectContaining({
            eventType: 'restart_recovery',
            state: 'recovering',
            clientOrderId: `cc7-${requestId}`,
        }));
        await harness.service.shutdown();
    });

    it('treats a persisted confirmed-open order as terminal without blocking restart', async () => {
        const dispatchAt = 1_783_814_400_000;
        const ledger = new FakeLedger([
            {
                eventType: 'dispatch_intent',
                requestId,
                operationId: requestId,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
                commandDigest: 'e'.repeat(64),
                clientOrderId: `cc7-${requestId}`,
                credentialBinding: binding,
                state: 'dispatched',
                dispatchAt,
                symbol: 'BTCUSDT',
                side: 'SELL',
                positionSide: 'LONG',
                positionEffect: 'EXIT',
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                quantity: '0.001',
                price: '70000',
            },
            {
                eventType: 'reconciliation_result',
                requestId,
                operationId: requestId,
                outcome: 'confirmed',
                state: 'confirmed_open',
                exchangeOrderId: '9223372036854775807',
            },
        ]);
        const query = vi.fn();
        const timers = [];
        const harness = createHarness({ ledger, query, timers });

        await harness.service.start();

        expect(harness.place).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt()).toBeNull();
        expect(harness.service.getStatus().recovery).toMatchObject({
            required: false,
            state: 'healthy',
        });
        expect(ledger.getActiveOperations()).toEqual([]);
        expect(timers.some(timer => timer.delay === 60_000)).toBe(false);
        await harness.service.shutdown();
    });

    it.each([false, true])(
        'idempotently recovers a consumed kill-switch intent after restart (engaged=%s)',
        async (killSwitchEngaged) => {
            const ledger = new FakeLedger([{
                eventType: 'intent_consumed',
                requestId,
                operationId: requestId,
                intentId: requestId,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
                commandDigest: 'e'.repeat(64),
                credentialBinding: binding,
                state: 'consumed',
            }], { killSwitchEngaged });
            const setKillSwitch = vi.spyOn(ledger, 'setKillSwitch');
            const harness = createHarness({ ledger });

            await harness.service.start();

            expect(setKillSwitch).toHaveBeenCalledTimes(killSwitchEngaged ? 0 : 1);
            expect(harness.place).not.toHaveBeenCalled();
            expect(harness.placeMarket).not.toHaveBeenCalled();
            expect(harness.query).not.toHaveBeenCalled();
            expect(ledger.killSwitchEngaged).toBe(true);
            expect(ledger.getActiveOperations()).toEqual([]);
            expect(harness.service.getCurrentAttempt()).toMatchObject({
                state: 'kill_switch_engaged',
            });
            expect(ledger.records).toContainEqual(expect.objectContaining({
                eventType: 'restart_recovery',
                requestId,
                state: 'kill_switch_engaged',
            }));
            await harness.service.shutdown();
        },
    );

    it.each([
        ['before the durable transition', false],
        ['after the durable transition', true],
    ])('recovers a crashed ARM LIVE command %s without exchange writes', async (
        _label,
        transitioned,
    ) => {
        const digest = 'f'.repeat(64);
        const records = [{
            eventType: 'intent_consumed',
            requestId,
            operationId: requestId,
            intentId: requestId,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
            commandDigest: digest,
            credentialBinding: binding,
            state: 'consumed',
        }];
        if (transitioned) {
            records.push({
                eventType: 'kill_switch_transition',
                requestId,
                operationId: requestId,
                intentId: requestId,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
                commandDigest: digest,
                credentialBinding: binding,
                state: 'disengaged',
                outcome: 'disengaged',
            });
        }
        const ledger = new FakeLedger(records, { killSwitchEngaged: !transitioned });
        const setKillSwitch = vi.spyOn(ledger, 'setKillSwitch');
        const harness = createHarness({ ledger });

        await harness.service.start();

        expect(setKillSwitch).not.toHaveBeenCalled();
        expect(ledger.killSwitchEngaged).toBe(!transitioned);
        expect(ledger.getActiveOperations()).toEqual([]);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: transitioned ? 'kill_switch_disengaged' : 'locally_rejected',
            acknowledgement: transitioned ? 'accepted' : 'rejected',
            code: transitioned
                ? 'FUTURES_PRODUCTION_LIVE_ARMED'
                : 'FUTURES_PRODUCTION_COMMAND_REJECTED',
        });
        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.placeMarket).not.toHaveBeenCalled();
        expect(harness.query).not.toHaveBeenCalled();
        expect(harness.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(harness.facade.cancelAllAlgoOpenOrders).not.toHaveBeenCalled();
        await harness.service.shutdown();
    });

    it('fails closed on an inconsistent durable ARM LIVE transition', async () => {
        const digest = 'f'.repeat(64);
        const ledger = new FakeLedger([{
            eventType: 'intent_consumed',
            requestId,
            operationId: requestId,
            intentId: requestId,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
            commandDigest: digest,
            credentialBinding: binding,
            state: 'consumed',
        }, {
            eventType: 'kill_switch_transition',
            requestId,
            operationId: requestId,
            intentId: requestId,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
            commandDigest: '0'.repeat(64),
            credentialBinding: binding,
            state: 'disengaged',
            outcome: 'disengaged',
        }], { killSwitchEngaged: true });
        const harness = createHarness({ ledger });

        await harness.service.start();

        expect(ledger.killSwitchEngaged).toBe(true);
        expect(ledger.getActiveOperations()).not.toEqual([]);
        expect(harness.service.getStatus()).toMatchObject({
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
                engageKillSwitch: false,
                disengageKillSwitch: false,
            },
            recovery: {
                required: true,
                state: 'blocked',
                code: 'FUTURES_PRODUCTION_RECOVERY_REQUIRED',
            },
        });
        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.query).not.toHaveBeenCalled();
        await harness.service.shutdown();
    });

    it('terminalizes a durable definitive rejected POST response without Query or retry', async () => {
        const dispatchAt = 1_783_814_400_000;
        const ledger = new FakeLedger([
            {
                eventType: 'dispatch_intent',
                requestId,
                operationId: requestId,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
                commandDigest: 'e'.repeat(64),
                clientOrderId: `cc7-${requestId}`,
                credentialBinding: binding,
                state: 'dispatched',
                dispatchAt,
                symbol: 'BTCUSDT',
                side: 'SELL',
                positionSide: 'LONG',
                positionEffect: 'EXIT',
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                quantity: '0.001',
                price: '70000',
            },
            {
                eventType: 'exchange_request',
                requestId,
                operationId: requestId,
                endpointId: 'new-limit-gtc-order',
                outcome: 'pending',
            },
            {
                eventType: 'exchange_response',
                requestId,
                operationId: requestId,
                endpointId: 'new-limit-gtc-order',
                outcome: 'rejected',
            },
        ]);
        const harness = createHarness({ ledger });

        await harness.service.start();

        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.query).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'exchange_rejected',
        });
        expect(ledger.getActiveOperations()).toEqual([]);
        await harness.service.shutdown();
    });

    it('reports durable work as blocked recovery when production runtime is disabled', async () => {
        const ledger = new FakeLedger([{
            eventType: 'dispatch_intent',
            requestId,
            operationId: requestId,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            commandDigest: 'e'.repeat(64),
            clientOrderId: `cc7-${requestId}`,
            credentialBinding: binding,
            state: 'dispatched',
            dispatchAt: 1_783_814_400_000,
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            positionEffect: 'EXIT',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            quantity: '0.001',
            price: '70000',
        }]);
        const runtimeConfig = Object.freeze({
            ...config,
            enabled: false,
            liveAuthorized: false,
        });
        const harness = createHarness({ ledger, runtimeConfig });

        await harness.service.start();

        expect(harness.facade.getServerTime).not.toHaveBeenCalled();
        expect(harness.query).not.toHaveBeenCalled();
        expect(harness.service.getStatus()).toMatchObject({
            recovery: {
                required: true,
                state: 'blocked',
                code: 'FUTURES_PRODUCTION_RECOVERY_UNAVAILABLE',
            },
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
            },
        });
        await harness.service.shutdown();
    });

    it('blocks credential rotation with durable unknown work before any exchange request', async () => {
        const ledger = new FakeLedger([{
            eventType: 'dispatch_intent',
            requestId,
            operationId: requestId,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            commandDigest: 'e'.repeat(64),
            clientOrderId: `cc7-${requestId}`,
            credentialBinding: 'f'.repeat(64),
            state: 'dispatched',
            dispatchAt: 1_783_814_400_000,
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            positionEffect: 'EXIT',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            quantity: '0.001',
            price: '70000.0',
        }]);
        const harness = createHarness({ ledger });

        await harness.service.start();

        expect(harness.facade.getServerTime).not.toHaveBeenCalled();
        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.query).not.toHaveBeenCalled();
        expect(harness.service.getStatus()).toMatchObject({
            recovery: {
                required: true,
                state: 'blocked',
                code: 'FUTURES_PRODUCTION_CREDENTIAL_ROTATION_BLOCKED',
            },
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
            },
        });
        await expect(harness.service.recoverOperationally({
            authorization: config.recoveryAuthorization,
            action: 'reconcile',
        })).resolves.toBe(false);
        expect(harness.ledger.records.filter(record => (
            record.eventType === 'operator_recovery'
            && record.action === 'backend.futuresProduction.reconcile'
        )).slice(-2)).toEqual([
            expect.objectContaining({ outcome: 'pending', state: 'pending' }),
            expect.objectContaining({
                outcome: 'blocked',
                state: 'blocked',
                code: 'FUTURES_PRODUCTION_CREDENTIAL_ROTATION_BLOCKED',
            }),
        ]);
        await harness.service.shutdown();
    });

    it('keeps activation disabled for a persisted rate pause and deterministically reopens after expiry', async () => {
        const pauseUntil = 1_783_814_500_000;
        const timers = [];
        const harness = createHarness({ pauseUntil, timers });
        await harness.service.start();

        expect(harness.service.getStatus().capabilities).toMatchObject({
            placeOrder: false,
            cancelAllOpenOrders: false,
            closePositions: false,
            code: 'FUTURES_PRODUCTION_RATE_PAUSED',
        });
        const refreshTimer = timers.find(timer => timer.delay > 30_000);
        expect(refreshTimer).toBeDefined();

        harness.setClock(pauseUntil + 1);
        refreshTimer.callback();
        for (let index = 0; index < 10; index += 1) await Promise.resolve();

        expect(harness.service.getStatus().capabilities).toMatchObject({
            placeOrder: true,
            cancelAllOpenOrders: true,
            closePositions: true,
            code: 'FUTURES_PRODUCTION_ENABLED',
        });
        await harness.service.shutdown();
    });

    it('samples server time after full preflight and charges a midnight-crossing dispatch to the new UTC day', async () => {
        const times = [
            Date.UTC(2026, 6, 13, 12, 0, 0, 0),
            Date.UTC(2026, 6, 13, 12, 1, 0, 0),
            Date.UTC(2026, 6, 13, 12, 1, 1, 0),
            Date.UTC(2026, 6, 13, 23, 59, 59, 990),
            Date.UTC(2026, 6, 14, 0, 0, 0, 5),
        ];
        const getServerTime = vi.fn(() => {
            const serverTime = times.shift();
            return result('server-time', {
                serverTime,
                sentAt: serverTime,
                receivedAt: serverTime,
                roundTripMs: 0,
            });
        });
        const harness = createHarness({ getServerTime });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });

        expect(getServerTime).toHaveBeenCalledTimes(5);
        expect(harness.coordinator.reserveOrderDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                utcDay: '2026-07-14',
                serverTime: Date.UTC(2026, 6, 14, 0, 0, 0, 5),
            }),
        );
        expect(harness.place).toHaveBeenCalledOnce();
        await harness.service.shutdown();
    });

    it('rejects a preflight inside the deterministic UTC rollover guard without reserving or posting', async () => {
        const times = [
            Date.UTC(2026, 6, 13, 12, 0, 0, 0),
            Date.UTC(2026, 6, 13, 23, 59, 0, 0),
            Date.UTC(2026, 6, 13, 23, 59, 50, 0),
        ];
        const getServerTime = vi.fn(() => {
            const serverTime = times.shift();
            return result('server-time', {
                serverTime,
                sentAt: serverTime,
                receivedAt: serverTime,
                roundTripMs: 0,
            });
        });
        const harness = createHarness({ getServerTime });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);

        await prepareOrder(harness.service, emitted);

        expect(emitted.at(-1).intent).toBeNull();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'locally_rejected',
            code: 'FUTURES_PRODUCTION_UTC_ROLLOVER_GUARD',
        });
        expect(harness.coordinator.reserveOrderDispatch).not.toHaveBeenCalled();
        expect(harness.place).not.toHaveBeenCalled();
        await harness.service.shutdown();
    });

    it('automatically restores execution after a transient identity clock failure', async () => {
        const ledger = new FakeLedger([], {
            lastServerTime: 1_783_814_500_000,
        });
        const timers = [];
        const getServerTime = vi.fn()
            .mockResolvedValueOnce(result('server-time', {
                serverTime: 1_783_814_400_000,
                sentAt: 1_783_814_400_000,
                receivedAt: 1_783_814_400_000,
                roundTripMs: 0,
            }))
            .mockResolvedValue(result('server-time', {
                serverTime: 1_783_814_500_001,
                sentAt: 1_783_814_500_001,
                receivedAt: 1_783_814_500_001,
                roundTripMs: 0,
            }));
        const harness = createHarness({ ledger, getServerTime, timers });

        await harness.service.start();

        expect(harness.facade.getServerTime).toHaveBeenCalledOnce();
        expect(harness.facade.getAccountConfig).not.toHaveBeenCalled();
        expect(harness.service.getStatus()).toMatchObject({
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
            },
            recovery: {
                required: false,
                state: 'healthy',
                code: 'FUTURES_PRODUCTION_ENABLED',
            },
        });
        const identityRetry = timers.find(timer => timer.delay === 1_000);
        expect(identityRetry).toBeDefined();

        await identityRetry.callback();
        await vi.waitFor(() => {
            expect(harness.service.getStatus().capabilities).toMatchObject({
                placeOrder: true,
                cancelAllOpenOrders: true,
                closePositions: true,
                code: 'FUTURES_PRODUCTION_ENABLED',
            });
        });
        await waitForPortfolioBootstrap(harness.service);
        expect(getServerTime.mock.calls.length).toBeGreaterThanOrEqual(2);
        await harness.service.shutdown();
    });

    it('terminalizes every durable close child after restart confirms the account flat', async () => {
        const parentRequestId = '2'.repeat(32);
        const ledger = new FakeLedger([
            {
                eventType: 'queued',
                requestId: parentRequestId,
                operationId: parentRequestId,
                parentOperationId: null,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
                commandDigest: 'e'.repeat(64),
                credentialBinding: binding,
                state: 'queued',
                dispatchAt: 1_783_814_400_000,
            },
            {
                eventType: 'reconciliation_result',
                requestId,
                operationId: requestId,
                parentOperationId: parentRequestId,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
                commandDigest: 'f'.repeat(64),
                clientOrderId: `cc7-${requestId}`,
                credentialBinding: binding,
                state: 'recovery_required',
                dispatchAt: 1_783_814_400_001,
                symbol: 'BTCUSDT',
                side: 'SELL',
                positionSide: 'LONG',
                positionEffect: 'EXIT',
                orderType: 'MARKET',
                timeInForce: null,
                quantity: '1',
                price: null,
                exchangeOrderId: '9223372036854775807',
            },
        ]);
        const query = vi.fn().mockResolvedValue(result('query-order', order({
            clientOrderId: `cc7-${requestId}`,
            type: 'MARKET',
            originalType: 'MARKET',
            originalQuantity: '1.0',
            price: '0',
        })));
        const allPositionRisk = vi.fn().mockResolvedValue(result('position-risk', [
            {
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                positionAmt: '0.000',
                liquidationPrice: '0',
                marginAsset: 'USDT',
            },
            {
                symbol: 'BTCUSDT',
                positionSide: 'SHORT',
                positionAmt: '0.000',
                liquidationPrice: '0',
                marginAsset: 'USDT',
            },
        ]));
        const harness = createHarness({ ledger, query, allPositionRisk });

        await harness.service.start();

        expect(harness.placeMarket).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
        expect(allPositionRisk).toHaveBeenCalledOnce();
        expect(ledger.getActiveOperations()).toEqual([]);
        expect(ledger.records).toContainEqual(expect.objectContaining({
            eventType: 'restart_recovery',
            requestId,
            operationId: requestId,
            parentOperationId: parentRequestId,
            state: 'confirmed_closed',
        }));
        expect(ledger.records.filter(record => (
            ['exchange_request', 'exchange_response'].includes(record.eventType)
            && ['query-order', 'new-hedge-market-exit-order'].includes(record.endpointId)
        ))).toEqual([]);
        expect(harness.service.getStatus().recovery.required).toBe(false);
        await harness.service.shutdown();
    });

    it('recovers cancel-all only from globally empty regular and algo inventories', async () => {
        const parentRequestId = '2'.repeat(32);
        const ledger = new FakeLedger([
            {
                eventType: 'cancel_all_parent',
                requestId: parentRequestId,
                operationId: parentRequestId,
                parentOperationId: null,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
                commandDigest: 'e'.repeat(64),
                credentialBinding: binding,
                state: 'partial',
                dispatchAt: 1_783_814_400_000,
            },
            {
                eventType: 'cancel_all_child',
                requestId: parentRequestId,
                operationId: `${parentRequestId}:ETHUSDT`,
                parentOperationId: parentRequestId,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
                commandDigest: 'e'.repeat(64),
                credentialBinding: binding,
                symbol: 'ETHUSDT',
                state: 'recovery_required',
                dispatchAt: 1_783_814_400_001,
            },
        ]);
        const allOpenOrders = vi.fn().mockResolvedValue(result('all-open-orders', []));
        const allOpenAlgoOrders = vi.fn().mockResolvedValue(result('all-open-algo-orders', []));
        const harness = createHarness({ ledger, allOpenOrders, allOpenAlgoOrders });

        await harness.service.start();

        expect(allOpenOrders).toHaveBeenCalledOnce();
        expect(allOpenAlgoOrders).toHaveBeenCalledOnce();
        expect(harness.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(harness.facade.cancelAllAlgoOpenOrders).not.toHaveBeenCalled();
        expect(harness.coordinator.executeProduction).not.toHaveBeenCalled();
        expect(ledger.getActiveOperations()).toEqual([]);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            requestId: parentRequestId,
            state: 'confirmed_canceled',
            items: [{ symbol: 'ETHUSDT', outcome: 'canceled' }],
        });
        expect(harness.service.getStatus().recovery.required).toBe(false);
        await harness.service.shutdown();
    });

    it('reports partial restart safety recovery as blocked instead of healthy or enabled', async () => {
        const ledger = new FakeLedger([{
            eventType: 'cancel_all_parent',
            requestId,
            operationId: requestId,
            parentOperationId: null,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
            commandDigest: 'e'.repeat(64),
            credentialBinding: binding,
            state: 'partial',
            dispatchAt: 1_783_814_400_000,
        }]);
        const openOrders = vi.fn().mockResolvedValue(result('open-orders', [{
            symbol: 'BTCUSDT',
            orderId: '9223372036854775807',
        }]));
        const harness = createHarness({ ledger, openOrders });

        await harness.service.start();

        expect(harness.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(harness.facade.cancelAllAlgoOpenOrders).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'partial',
            acknowledgement: 'partial',
        });
        expect(harness.service.getStatus()).toMatchObject({
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
            },
            recovery: {
                required: true,
                state: 'blocked',
                code: 'FUTURES_PRODUCTION_RECOVERY_REQUIRED',
            },
        });
        await harness.service.shutdown();
    });

    it('serializes backend recovery and durably blocks a concurrent recovery action', async () => {
        const ledger = new FakeLedger();
        const originalSetKillSwitch = ledger.setKillSwitch.bind(ledger);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const setKillSwitch = vi.spyOn(ledger, 'setKillSwitch').mockImplementation(async args => {
            await gate;
            return originalSetKillSwitch(args);
        });
        const harness = createHarness({ ledger });
        await harness.service.start();
        await waitForPortfolioBootstrap(harness.service);
        for (let index = 0; index < 10; index += 1) await Promise.resolve();

        const first = harness.service.recoverOperationally({
            authorization: config.recoveryAuthorization,
            action: 'disengageKillSwitch',
        });
        for (let index = 0; index < 20 && setKillSwitch.mock.calls.length === 0; index += 1) {
            await Promise.resolve();
        }
        expect(setKillSwitch).toHaveBeenCalledOnce();
        await expect(harness.service.recoverOperationally({
            authorization: config.recoveryAuthorization,
            action: 'engageKillSwitch',
        })).resolves.toBe(false);
        expect(setKillSwitch).toHaveBeenCalledOnce();
        expect(ledger.records).toContainEqual(expect.objectContaining({
            eventType: 'operator_recovery',
            action: 'backend.futuresProduction.engageKillSwitch',
            outcome: 'blocked',
            state: 'blocked',
            code: 'FUTURES_PRODUCTION_OPERATION_BUSY',
        }));

        release();
        await expect(first).resolves.toBe(true);
        expect(harness.service.getStatus().killSwitch.engaged).toBe(false);
        await harness.service.shutdown();
    });

    it('resumes reconciliation when a pending timer overlaps operator kill-switch recovery', async () => {
        const place = vi.fn().mockRejectedValue(new FuturesProductionExecutionFacadeError({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeLimitGtcOrder',
            endpointId: 'new-limit-gtc-order',
        }));
        const query = vi.fn()
            .mockRejectedValueOnce(new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
                operation: 'queryOrder',
                endpointId: 'query-order',
            }))
            .mockResolvedValueOnce(result('query-order', order()));
        const ledger = new FakeLedger();
        const originalSetKillSwitch = ledger.setKillSwitch.bind(ledger);
        let releaseKillSwitch;
        const killSwitchGate = new Promise(resolve => { releaseKillSwitch = resolve; });
        const setKillSwitch = vi.spyOn(ledger, 'setKillSwitch').mockImplementation(async (args) => {
            await killSwitchGate;
            return originalSetKillSwitch(args);
        });
        const timers = [];
        const harness = createHarness({ ledger, place, query, timers });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });
        const retryTimer = timers.find(timer => timer.delay === 1_000);
        expect(retryTimer).toBeDefined();

        const recovery = harness.service.recoverOperationally({
            authorization: config.recoveryAuthorization,
            action: 'engageKillSwitch',
        });
        while (setKillSwitch.mock.calls.length === 0) await Promise.resolve();
        retryTimer.callback();
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
        expect(query).toHaveBeenCalledOnce();

        releaseKillSwitch();
        await expect(recovery).resolves.toBe(true);
        const resumed = timers.find(timer => timer.delay === 0);
        expect(resumed).toBeDefined();
        resumed.callback();
        for (let index = 0; index < 20 && query.mock.calls.length < 2; index += 1) {
            await Promise.resolve();
        }
        for (let index = 0; index < 20
            && harness.service.getCurrentAttempt()?.state !== 'confirmed_filled'; index += 1) {
            await Promise.resolve();
        }

        expect(query).toHaveBeenCalledTimes(2);
        expect(harness.service.getCurrentAttempt()).toMatchObject({ state: 'confirmed_filled' });
        await harness.service.shutdown();
    });

    it('awaits an in-flight scheduled reconciliation before closing durable state', async () => {
        const place = vi.fn().mockRejectedValue(new FuturesProductionExecutionFacadeError({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeLimitGtcOrder',
            endpointId: 'new-limit-gtc-order',
        }));
        let releaseQuery;
        const query = vi.fn()
            .mockRejectedValueOnce(new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
                operation: 'queryOrder',
                endpointId: 'query-order',
            }))
            .mockImplementationOnce(() => new Promise(resolve => { releaseQuery = resolve; }));
        const timers = [];
        const harness = createHarness({ place, query, timers });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);
        await harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });
        const retryTimer = timers.find(timer => timer.delay === 1_000);
        expect(retryTimer).toBeDefined();

        retryTimer.callback();
        while (query.mock.calls.length < 2) await Promise.resolve();
        await expect(harness.service.recoverOperationally({
            authorization: config.recoveryAuthorization,
            action: 'reconcile',
        })).resolves.toBe(false);
        expect(harness.ledger.records).toContainEqual(expect.objectContaining({
            eventType: 'operator_recovery',
            action: 'backend.futuresProduction.reconcile',
            outcome: 'blocked',
            code: 'FUTURES_PRODUCTION_OPERATION_BUSY',
        }));
        const shutdown = harness.service.shutdown();
        let shutdownSettled = false;
        void shutdown.then(() => { shutdownSettled = true; });
        await Promise.resolve();
        expect(shutdownSettled).toBe(false);
        expect(harness.ledger.opened).toBe(true);

        releaseQuery(result('query-order', order()));
        await shutdown;
        expect(harness.ledger.opened).toBe(false);
        expect(place).toHaveBeenCalledOnce();
        expect(query).toHaveBeenCalledTimes(2);
        expect(harness.ledger.getActiveOperations()).toEqual([
            expect.objectContaining({
                requestId,
                state: 'result_unknown',
                clientOrderId: `cc7-${requestId}`,
            }),
        ]);
        expect(harness.ledger.records.some(record => (
            ['confirmed_canceled', 'confirmed_closed'].includes(record.state)
        ))).toBe(false);

        const restartQuery = vi.fn().mockResolvedValue(result('query-order', order()));
        const restarted = createHarness({ ledger: harness.ledger, query: restartQuery });
        restarted.setClock(1_783_814_500_000);
        await restarted.service.start();
        expect(restarted.place).not.toHaveBeenCalled();
        expect(restartQuery).toHaveBeenCalledOnce();
        expect(restarted.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_filled',
        });
        expect(harness.ledger.getActiveOperations()).toEqual([]);
        await restarted.service.shutdown();
    });

    it('completes shutdown while the private account socket is still opening', async () => {
        let rejectReady;
        const ready = new Promise((_resolve, reject) => { rejectReady = reject; });
        const streamHandle = {
            ready,
            close: vi.fn(() => rejectReady(new Error('stream closed before open'))),
        };
        const connectUserDataStream = vi.fn().mockReturnValue(streamHandle);
        const harness = createHarness({ connectUserDataStream });

        await harness.service.start();
        await vi.waitFor(() => expect(connectUserDataStream).toHaveBeenCalledOnce());

        await expect(harness.service.shutdown()).resolves.toBeUndefined();
        expect(streamHandle.close).toHaveBeenCalledOnce();
        expect(harness.ledger.opened).toBe(false);
    });

    it('closes a listen key whose start request completes during shutdown', async () => {
        let resolveStart;
        const startUserDataStream = vi.fn(() => new Promise(resolve => {
            resolveStart = resolve;
        }));
        const closeUserDataStream = vi.fn().mockResolvedValue(result(
            'user-data-stream-close',
            { acknowledged: true },
        ));
        const harness = createHarness({ startUserDataStream, closeUserDataStream });

        await harness.service.start();
        await vi.waitFor(() => expect(startUserDataStream).toHaveBeenCalledOnce());
        const shutdown = harness.service.shutdown();
        resolveStart(result('user-data-stream-start', { listenKey: 'a'.repeat(64) }));

        await expect(shutdown).resolves.toBeUndefined();
        expect(closeUserDataStream).toHaveBeenCalledOnce();
        expect(harness.ledger.opened).toBe(false);
    });

    it('shares one shutdown completion and leaves an in-flight POST query-only replayable', async () => {
        let releasePost;
        const place = vi.fn(() => new Promise(resolve => { releasePost = resolve; }));
        const query = vi.fn().mockResolvedValue(result('query-order', order()));
        const harness = createHarness({ place, query });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
        const intent = await prepareOrder(harness.service, emitted);
        const execution = harness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            intent.revision,
            {
                requestId: intent.requestId,
                confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
                ],
            },
        ), { connectionId, emit: value => emitted.push(value) });
        while (!releasePost) await Promise.resolve();

        const firstShutdown = harness.service.shutdown();
        const secondShutdown = harness.service.shutdown();
        expect(secondShutdown).toBe(firstShutdown);
        let shutdownSettled = false;
        void firstShutdown.then(() => { shutdownSettled = true; });
        await Promise.resolve();
        expect(shutdownSettled).toBe(false);
        expect(harness.ledger.opened).toBe(true);

        releasePost(result('new-limit-gtc-order', {
            symbol: 'BTCUSDT',
            clientOrderId: `cc7-${requestId}`,
            orderId: '9223372036854775807',
        }));
        await expect(execution).resolves.toBe(true);
        await firstShutdown;

        expect(place).toHaveBeenCalledOnce();
        expect(query).not.toHaveBeenCalled();
        expect(harness.ledger.getActiveOperations()).toEqual([
            expect.objectContaining({
                requestId,
                state: 'reconciling',
                clientOrderId: `cc7-${requestId}`,
            }),
        ]);

        const restartQuery = vi.fn().mockResolvedValue(result('query-order', order()));
        const restarted = createHarness({ ledger: harness.ledger, query: restartQuery });
        restarted.setClock(1_783_814_500_000);
        await restarted.service.start();
        expect(restarted.place).not.toHaveBeenCalled();
        expect(restartQuery).toHaveBeenCalledOnce();
        expect(harness.ledger.getActiveOperations()).toEqual([]);
        await restarted.service.shutdown();
    });

    it('durably rejects invalid backend recovery authorization and action without recording either', async () => {
        const harness = createHarness();
        await harness.service.start();

        await expect(harness.service.recoverOperationally({
            authorization: 'invalid-recovery-authorization',
            action: 'engageKillSwitch',
        })).resolves.toBe(false);
        await expect(harness.service.recoverOperationally({
            authorization: config.recoveryAuthorization,
            action: 'placeOrderWithSecret=forbidden',
        })).resolves.toBe(false);

        const rejected = harness.ledger.records.filter(record => (
            record.eventType === 'operator_recovery'
            && record.outcome === 'rejected'
        ));
        expect(rejected).toEqual([
            expect.objectContaining({
                action: 'backend.futuresProduction.engageKillSwitch',
                state: 'blocked',
                code: 'FUTURES_PRODUCTION_COMMAND_REJECTED',
            }),
            expect.objectContaining({
                action: 'backend.futuresProduction.invalidAction',
                state: 'blocked',
                code: 'FUTURES_PRODUCTION_COMMAND_REJECTED',
            }),
        ]);
        const serialized = JSON.stringify(rejected);
        expect(serialized).not.toContain('invalid-recovery-authorization');
        expect(serialized).not.toContain('placeOrderWithSecret');
        await harness.service.shutdown();
    });
});
