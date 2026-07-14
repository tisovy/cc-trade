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
        allowedSymbols: Object.freeze(['BTCUSDT']),
        maxLeverage: 3,
        maxOrderNotionalUsdt: '10000',
        maxDailyNotionalUsdt: '50000',
        minAvailableBalanceUsdt: '10',
        minLiquidationDistanceBps: '1000',
        killSwitchPolicy: 'v1-persistent-block-new-exposure',
    }),
});

class FakeLedger {
    constructor(records = [], {
        lastServerTime = null,
        pauseUntil = 0,
        killSwitchEngaged = true,
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
            'confirmed_filled',
            'confirmed_canceled',
            'confirmed_closed',
            'confirmed_empty',
            'kill_switch_engaged',
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
            { filterType: 'MIN_NOTIONAL', notional: '5' },
            { filterType: 'MAX_NUM_ORDERS', limit: 20 },
        ],
    }],
};

const twoSymbolConfig = Object.freeze({
    ...config,
    policy: Object.freeze({
        ...config.policy,
        allowedSymbols: Object.freeze(['BTCUSDT', 'ETHUSDT']),
    }),
});

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
    dualSidePosition: false,
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
        name: 'hedge mode',
        accountConfig: { ...validProductionAccountConfig(), dualSidePosition: true },
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
    positionSide: 'BOTH',
    type: 'LIMIT',
    originalType: 'LIMIT',
    timeInForce: 'GTC',
    status: 'FILLED',
    originalQuantity: '0.0010',
    executedQuantity: '0.001',
    averagePrice: '70000',
    price: '70000.0',
    reduceOnly: true,
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
        canTrade: true, dualSidePosition: false, multiAssetsMargin: false,
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
        leverage: 3, maxNotionalValue: '1000000',
    }])),
    query = vi.fn().mockResolvedValue(result('query-order', order())),
    positionRisk = vi.fn().mockResolvedValue(result('position-risk', [{
        symbol: 'BTCUSDT',
        positionSide: 'BOTH',
        positionAmt: '1',
        liquidationPrice: '50000',
        marginAsset: 'USDT',
    }])),
    openOrders = vi.fn().mockResolvedValue(result('open-orders', [])),
    openAlgoOrders = vi.fn().mockResolvedValue(result('open-algo-orders', [])),
    cancelRegular = vi.fn().mockResolvedValue(result('cancel-all-open-orders', {
        acknowledged: true,
    })),
    cancelAlgo = vi.fn().mockResolvedValue(result('cancel-all-algo-open-orders', {
        acknowledged: true,
    })),
    placeMarket = vi.fn().mockResolvedValue(result('new-reduce-only-market-order', {
        symbol: 'BTCUSDT',
        clientOrderId: `cc7-${requestId}`,
        orderId: '9223372036854775806',
    })),
    evaluateRisk = vi.fn(() => ({
        ok: true,
        classification: 'reducing',
        notionalUsdt: '70',
        conservativePrice: '70000',
        dailyNotionalBeforeUsdt: '0',
        dailyNotionalAfterUsdt: '70',
        observedLeverage: 3,
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
        getBalance: balance,
        getPositionRisk: positionRisk,
        getOpenOrders: openOrders,
        getOpenAlgoOrders: openAlgoOrders,
        placeLimitGtcOrder: place,
        placeReduceOnlyMarketOrder: placeMarket,
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
        query,
        evaluateRisk,
        timers,
        setClock: value => { clock = value; },
    };
};

const command = (action, revision, extra = {}) => JSON.stringify({
    action,
    version: 1,
    revision,
    marketType: 'futures',
    environment: 'production',
    accountFingerprint: fingerprint,
    ...extra,
});

const subscribe = async (service, emitted) => service.handleRequest(JSON.stringify({
    action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
    version: 1,
    revision: '0',
    marketType: 'futures',
    environment: 'production',
    accountFingerprint: '0'.repeat(64),
}), { connectionId, emit: value => emitted.push(value) });

const prepareOrder = async (service, emitted) => {
    const revision = emitted.at(-1).revision;
    await service.handleRequest(command(
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
        revision,
        { symbol: 'BTCUSDT', side: 'SELL', quantity: '0.001', price: '70000.0', reduceOnly: true },
    ), { connectionId, emit: value => emitted.push(value) });
    return emitted.at(-1).intent;
};

describe('FuturesProductionExecutionService', () => {
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
            version: 1,
            revision: '0',
            marketType: 'futures',
            environment: 'production',
            accountFingerprint: '0'.repeat(64),
        }), { connectionId: peerConnectionId, emit: value => peerEmitted.push(value) });
        await disconnectHarness.service.handleRequest(command(
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
            peerEmitted.at(-1).revision,
            {
                symbol: 'BTCUSDT', side: 'SELL', quantity: '0.001',
                price: '70000.0', reduceOnly: true,
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
        expect(harness.timers).toContainEqual(expect.objectContaining({ delay: 1_000 }));
        await harness.service.shutdown();
    });

    it('keeps cancel-all separate from close-position order placement', async () => {
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
        expect(harness.facade.cancelAllOpenOrders).toHaveBeenCalledOnce();
        expect(harness.facade.cancelAllAlgoOpenOrders).toHaveBeenCalledOnce();
        expect(harness.facade.placeReduceOnlyMarketOrder).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt().state).toBe('confirmed_canceled');
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
            version: 1,
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
        const openOrders = vi.fn().mockResolvedValue(result('open-orders', [{
            symbol: 'BTCUSDT',
            orderId: '9223372036854775807',
        }]));
        const harness = createHarness({ openOrders });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
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

    it('reports close-positions as partial after one ambiguous market POST and exact query failure', async () => {
        const placeMarket = vi.fn().mockRejectedValue(
            new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                operation: 'placeReduceOnlyMarketOrder',
                endpointId: 'new-reduce-only-market-order',
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
            && record.endpointId === 'new-reduce-only-market-order'
        ));
        expect(reservationIndex).toBeGreaterThanOrEqual(0);
        expect(dispatchIndex).toBeGreaterThan(reservationIndex);
        expect(exchangeRequestIndex).toBeGreaterThan(dispatchIndex);
        await harness.service.shutdown();
    });

    it('keeps two-symbol regular and algo cancel outcomes exact across GET-only restart recovery', async () => {
        const openOrders = vi.fn(() => result('open-orders', []));
        const openAlgoOrders = vi.fn(symbol => result('open-algo-orders', (
            symbol === 'ETHUSDT'
                ? [{ symbol, algoId: '9223372036854775807' }]
                : []
        )));
        const cancelRegular = vi.fn(({ symbol }) => result('cancel-all-open-orders', {
            acknowledged: true,
            symbol,
        }));
        const cancelAlgo = vi.fn(({ symbol }) => result('cancel-all-algo-open-orders', {
            acknowledged: true,
            symbol,
        }));
        const harness = createHarness({
            runtimeConfig: twoSymbolConfig,
            exchangeInfoValue: twoSymbolExchangeInfo,
            openOrders,
            openAlgoOrders,
            cancelRegular,
            cancelAlgo,
        });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
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
                { symbol: 'BTCUSDT', outcome: 'canceled' },
                { symbol: 'ETHUSDT', outcome: 'unknown' },
            ],
        });
        expect(harness.ledger.records.filter(record => (
            record.eventType === 'cancel_all_child'
        ))).toEqual([
            expect.objectContaining({
                requestId: intent.requestId,
                operationId: `${intent.requestId}:BTCUSDT`,
                parentOperationId: intent.requestId,
                symbol: 'BTCUSDT',
                outcome: 'confirmed',
                state: 'confirmed_empty',
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
        const restartOpenAlgoOrders = vi.fn(symbol => result('open-algo-orders', (
            symbol === 'ETHUSDT'
                ? [{ symbol, algoId: '9223372036854775807' }]
                : []
        )));
        const restartCancelRegular = vi.fn();
        const restartCancelAlgo = vi.fn();
        const restarted = createHarness({
            ledger: harness.ledger,
            runtimeConfig: twoSymbolConfig,
            exchangeInfoValue: twoSymbolExchangeInfo,
            openOrders: restartOpenOrders,
            openAlgoOrders: restartOpenAlgoOrders,
            cancelRegular: restartCancelRegular,
            cancelAlgo: restartCancelAlgo,
        });
        restarted.setClock(1_783_814_500_000);
        await restarted.service.start();

        expect(restartOpenOrders.mock.calls).toEqual([['BTCUSDT'], ['ETHUSDT']]);
        expect(restartOpenAlgoOrders.mock.calls).toEqual([['BTCUSDT'], ['ETHUSDT']]);
        expect(restartCancelRegular).not.toHaveBeenCalled();
        expect(restartCancelAlgo).not.toHaveBeenCalled();
        expect(restarted.coordinator.executeProduction).not.toHaveBeenCalled();
        expect(restarted.place).not.toHaveBeenCalled();
        expect(restarted.placeMarket).not.toHaveBeenCalled();
        expect(restarted.service.getCurrentAttempt()).toMatchObject({
            requestId: intent.requestId,
            state: 'partial',
            items: [
                { symbol: 'BTCUSDT', outcome: 'canceled' },
                { symbol: 'ETHUSDT', outcome: 'unknown' },
            ],
        });
        expect(harness.ledger.records.filter(record => (
            record.eventType === 'restart_recovery'
            && record.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS
            && record.symbol
        )).slice(-2)).toEqual([
            expect.objectContaining({
                operationId: `${intent.requestId}:BTCUSDT`,
                symbol: 'BTCUSDT',
                state: 'confirmed_empty',
            }),
            expect.objectContaining({
                operationId: `${intent.requestId}:ETHUSDT`,
                symbol: 'ETHUSDT',
                state: 'recovery_required',
            }),
        ]);
        await restarted.service.shutdown();
    });

    it('keeps mixed close child identities exact and restart recovery strictly GET-only', async () => {
        const childRequestId = '2'.repeat(32);
        const identifiers = ['0'.repeat(32), requestId, childRequestId];
        const randomBytes = vi.fn(() => Buffer.from(
            identifiers.shift() ?? 'f'.repeat(32),
            'hex',
        ));
        const positionRisk = vi.fn(symbol => result('position-risk', [{
            symbol,
            positionSide: 'BOTH',
            positionAmt: symbol === 'BTCUSDT' ? '0' : '2.000',
            liquidationPrice: symbol === 'BTCUSDT' ? '0' : '2000',
            marginAsset: 'USDT',
        }]));
        const placeMarket = vi.fn().mockRejectedValue(
            new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                operation: 'placeReduceOnlyMarketOrder',
                endpointId: 'new-reduce-only-market-order',
            }),
        );
        const query = vi.fn().mockRejectedValue(new FuturesProductionExecutionFacadeError({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
            operation: 'queryOrder',
            endpointId: 'query-order',
        }));
        const harness = createHarness({
            runtimeConfig: twoSymbolConfig,
            exchangeInfoValue: twoSymbolExchangeInfo,
            positionRisk,
            placeMarket,
            query,
            randomBytes,
        });
        const emitted = [];
        await harness.service.start();
        await subscribe(harness.service, emitted);
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
                { symbol: 'BTCUSDT', outcome: 'closed' },
                { symbol: 'ETHUSDT', outcome: 'unknown' },
            ],
        });
        expect(harness.ledger.records.filter(record => (
            record.eventType === 'close_positions_child'
        ))).toEqual([
            expect.objectContaining({
                requestId,
                operationId: `${requestId}:BTCUSDT`,
                parentOperationId: requestId,
                symbol: 'BTCUSDT',
                state: 'confirmed_closed',
                safeDetail: 'already-flat',
            }),
            expect.objectContaining({
                requestId: childRequestId,
                operationId: childRequestId,
                parentOperationId: requestId,
                clientOrderId: `cc7-${childRequestId}`,
                symbol: 'ETHUSDT',
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

        const restartPositionRisk = vi.fn(symbol => result('position-risk', [{
            symbol,
            positionSide: 'BOTH',
            positionAmt: symbol === 'BTCUSDT' ? '0' : '2.000',
            liquidationPrice: symbol === 'BTCUSDT' ? '0' : '2000',
            marginAsset: 'USDT',
        }]));
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
            runtimeConfig: twoSymbolConfig,
            exchangeInfoValue: twoSymbolExchangeInfo,
            positionRisk: restartPositionRisk,
            query: restartQuery,
            placeMarket: restartPlaceMarket,
        });
        restarted.setClock(1_783_814_500_000);
        await restarted.service.start();

        expect(restartQuery).toHaveBeenCalledOnce();
        expect(restartPositionRisk.mock.calls).toEqual([['BTCUSDT'], ['ETHUSDT']]);
        expect(restartPlaceMarket).not.toHaveBeenCalled();
        expect(restarted.place).not.toHaveBeenCalled();
        expect(restarted.facade.cancelAllOpenOrders).not.toHaveBeenCalled();
        expect(restarted.facade.cancelAllAlgoOpenOrders).not.toHaveBeenCalled();
        expect(restarted.coordinator.executeProduction).not.toHaveBeenCalled();
        expect(restarted.service.getCurrentAttempt()).toMatchObject({
            requestId,
            state: 'partial',
            items: [
                { symbol: 'BTCUSDT', outcome: 'closed' },
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
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            quantity: '0.001',
            price: '70000.0',
            reduceOnly: true,
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

    it('resumes confirmed-open monitoring after restart until an exact terminal result', async () => {
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
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                quantity: '0.001',
                price: '70000',
                reduceOnly: true,
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
        const query = vi.fn()
            .mockResolvedValueOnce(result('query-order', order({ status: 'NEW' })))
            .mockResolvedValueOnce(result('query-order', order({ status: 'FILLED' })));
        const timers = [];
        const harness = createHarness({ ledger, query, timers });

        await harness.service.start();

        expect(harness.place).not.toHaveBeenCalled();
        expect(query).toHaveBeenCalledOnce();
        expect(harness.service.getCurrentAttempt()).toMatchObject({ state: 'confirmed_open' });
        expect(harness.service.getStatus().recovery).toMatchObject({
            required: true,
            state: 'recovering',
        });
        const monitor = timers.find(timer => timer.delay === 60_000);
        expect(monitor).toBeDefined();

        monitor.callback();
        for (let index = 0; index < 20 && query.mock.calls.length < 2; index += 1) {
            await Promise.resolve();
        }
        for (let index = 0; index < 20
            && harness.service.getCurrentAttempt()?.state !== 'confirmed_filled'; index += 1) {
            await Promise.resolve();
        }

        expect(query).toHaveBeenCalledTimes(2);
        expect(harness.service.getCurrentAttempt()).toMatchObject({ state: 'confirmed_filled' });
        expect(ledger.getActiveOperations()).toEqual([]);
        expect(ledger.records).toContainEqual(expect.objectContaining({
            eventType: 'monitor_result',
            state: 'confirmed_filled',
        }));
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
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                quantity: '0.001',
                price: '70000',
                reduceOnly: true,
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
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            quantity: '0.001',
            price: '70000',
            reduceOnly: true,
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
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            quantity: '0.001',
            price: '70000.0',
            reduceOnly: true,
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

    it('fails activation closed before account validation when persisted server time regresses', async () => {
        const ledger = new FakeLedger([], {
            lastServerTime: 1_783_814_500_000,
        });
        const harness = createHarness({ ledger });

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
                required: true,
                state: 'blocked',
                code: 'FUTURES_PRODUCTION_SERVER_CLOCK_REGRESSED',
            },
        });
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
                orderType: 'MARKET',
                timeInForce: null,
                quantity: '1',
                price: null,
                reduceOnly: true,
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
        const positionRisk = vi.fn().mockResolvedValue(result('position-risk', [{
            symbol: 'BTCUSDT',
            positionSide: 'BOTH',
            positionAmt: '0.000',
            liquidationPrice: '0',
            marginAsset: 'USDT',
        }]));
        const harness = createHarness({ ledger, query, positionRisk });

        await harness.service.start();

        expect(harness.placeMarket).not.toHaveBeenCalled();
        expect(query).toHaveBeenCalledOnce();
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
            && record.endpointId === 'query-order'
        ))).toEqual([
            expect.objectContaining({
                operationId: requestId,
                parentOperationId: parentRequestId,
                clientOrderId: `cc7-${requestId}`,
            }),
            expect.objectContaining({
                operationId: requestId,
                parentOperationId: parentRequestId,
                clientOrderId: `cc7-${requestId}`,
            }),
        ]);
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

        const first = harness.service.recoverOperationally({
            authorization: config.recoveryAuthorization,
            action: 'disengageKillSwitch',
        });
        while (setKillSwitch.mock.calls.length === 0) await Promise.resolve();
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
