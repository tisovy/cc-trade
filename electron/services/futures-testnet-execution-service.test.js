import { describe, expect, it, vi } from 'vitest';
import {
    FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS,
    FuturesTestnetExecutionFacadeError,
} from './futures-testnet-execution-facade.js';
import {
    FUTURES_TESTNET_EXECUTION_STATES,
} from './futures-testnet-execution-protocol.js';
import {
    createFuturesTestnetExecutionCommandDigest,
} from './futures-testnet-execution-ledger.js';
import {
    createFuturesTestnetExecutionService,
} from './futures-testnet-execution-service.js';

const requestId = '0123456789abcdef0123456789abcdef';
const clientOrderId = `cc6-${requestId}`;
const exchangeOrderId = '9223372036854775807';
const makeCommand = (overrides = {}) => ({
    action: 'futures.execution.placeOrder',
    version: 1,
    requestId,
    marketType: 'futures',
    environment: 'testnet',
    symbol: 'BTCUSDT',
    side: 'SELL',
    orderType: 'LIMIT',
    quantity: '0.001',
    price: '70000.0',
    timeInForce: 'GTC',
    positionSide: 'BOTH',
    marginType: 'ISOLATED',
    leverage: 3,
    reduceOnly: true,
    workingType: null,
    priceProtect: false,
    clientOrderId,
    ...overrides,
});
const sessionRequest = (action, revision = '0') => JSON.stringify({
    action,
    version: 1,
    revision,
    marketType: 'futures',
    environment: 'testnet',
    symbol: 'BTCUSDT',
});
const queryOrder = (overrides = {}) => ({
    symbol: 'BTCUSDT',
    clientOrderId,
    orderId: exchangeOrderId,
    side: 'SELL',
    positionSide: 'BOTH',
    type: 'LIMIT',
    origType: 'LIMIT',
    timeInForce: 'GTC',
    status: 'FILLED',
    originalQuantity: '0.0010',
    executedQuantity: '0.001',
    averagePrice: '70000.00',
    price: '70000.00',
    workingType: 'CONTRACT_PRICE',
    reduceOnly: true,
    closePosition: false,
    priceProtect: false,
    updateTime: 1783814400123,
    ...overrides,
});

class FakeLedger {
    constructor(records = []) {
        this.records = [...records];
        this.failEvent = null;
        this.closed = false;
    }

    async open() {}
    async close() { this.closed = true; }
    async append(record) {
        if (record.event === this.failEvent) throw new Error('fsync failed');
        this.records.push(record);
        return { record };
    }
    getRecords() { return [...this.records]; }
    getRevision() { return String(this.records.length); }
    getLatestAttempt() { return this.records.at(-1) ?? null; }
    getActiveAttempt() {
        const byRequest = new Map();
        this.records.forEach((record) => byRequest.set(record.requestId, record));
        return [...byRequest.values()].find(record => ![
            'locally_rejected',
            'exchange_rejected',
            'confirmed_filled',
            'confirmed_canceled',
        ].includes(record.state)) ?? null;
    }
    getOrderRateState() {
        return {
            dispatchTimes: this.records
                .filter(record => record.event === 'dispatch_intent')
                .map(record => record.observedAt),
            pauseUntil: this.records.reduce((maximum, record) => (
                Number.isSafeInteger(record.pauseUntil)
                    ? Math.max(maximum, record.pauseUntil)
                    : maximum
            ), 0),
        };
    }
    findRequest(id) {
        return [...this.records].reverse().find(record => record.requestId === id) ?? null;
    }
    findClientOrder(id) {
        return [...this.records].reverse().find(record => record.clientOrderId === id) ?? null;
    }
}

const config = Object.freeze({
    enabled: true,
    code: 'FUTURES_EXECUTION_ENABLED',
    policy: Object.freeze({
        allowedSymbols: Object.freeze(['BTCUSDT']),
        maxNotionalUsdt: '10000',
        maxLeverage: 3,
        minAvailableBalanceUsdt: '10',
        minLiquidationDistanceBps: '1000',
    }),
});

const createHarness = ({
    ledger = new FakeLedger(),
    place = vi.fn().mockResolvedValue({ orderId: exchangeOrderId }),
    query = vi.fn().mockResolvedValue(queryOrder()),
    evaluateRisk = vi.fn(() => ({ ok: true })),
    timers = [],
    binding = 'binding-a',
} = {}) => {
    let clock = 1783814400000;
    const reader = {
        readPreflight: vi.fn().mockResolvedValue({
            riskOwnership: {},
            observations: {
                accountConfig: {
                    data: {
                        canTrade: true,
                        dualSidePosition: false,
                        multiAssetsMargin: false,
                    },
                },
                symbolConfig: {
                    data: {
                        symbol: 'BTCUSDT',
                        marginType: 'ISOLATED',
                        isAutoAddMargin: false,
                        leverage: 3,
                    },
                },
                positions: {
                    data: {
                        positions: [{
                            symbol: 'BTCUSDT',
                            positionSide: 'BOTH',
                            positionAmt: '1.0',
                            marginAsset: 'USDT',
                        }],
                    },
                },
            },
        }),
    };
    let orderPauseUntil = 0;
    const coordinator = {
        reserveOrderDispatch: vi.fn(() => ({ dispatchTimes: [clock], pauseUntil: 0 })),
        setOrderPauseUntil: vi.fn((value) => {
            orderPauseUntil = Math.max(orderPauseUntil, value);
        }),
        restoreOrderState: vi.fn((state) => {
            orderPauseUntil = state.pauseUntil;
        }),
        getOrderAdmissionSnapshot: vi.fn(() => ({
            dispatchTimes: [],
            pauseUntil: orderPauseUntil,
        })),
        executeRecoveryQuery: vi.fn(async (operation) => {
            if (clock < orderPauseUntil) {
                const error = new Error('rate paused');
                error.code = 'FUTURES_EXECUTION_RATE_PAUSED';
                throw error;
            }
            return operation();
        }),
    };
    const service = createFuturesTestnetExecutionService({
        config,
        credentialBinding: binding,
        ledger,
        reader,
        facade: {
            placeReduceOnlyLimitGtcOrder: place,
            queryOrderByOriginalClientOrderId: query,
        },
        coordinator,
        evaluateRisk,
        randomBytes: () => Buffer.from(requestId, 'hex'),
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
        reader,
        coordinator,
        place,
        query,
        evaluateRisk,
        timers,
        setClock: value => { clock = value; },
    };
};

const bindAndPrepare = async (service, emitted, connectionId = 'connection-a') => {
    expect(service.bindReadSession({ connectionId, symbol: 'BTCUSDT' })).toBe(true);
    await expect(service.handleSessionRequest(
        sessionRequest('futures.execution.subscribeStatus'),
        { connectionId, emit: message => emitted.push(message) },
    )).resolves.toBe(true);
    await expect(service.handleSessionRequest(
        sessionRequest('futures.execution.prepareIntent'),
        { connectionId, emit: message => emitted.push(message) },
    )).resolves.toBe(true);
};

describe('FuturesTestnetExecutionService', () => {
    it('issues one backend-owned 30-second intent from trusted preflight facts without POST', async () => {
        const emitted = [];
        const harness = createHarness();
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        const latest = emitted.at(-1);
        expect(latest).toMatchObject({
            action: 'futures.execution.status',
            capability: { enabled: true, code: 'FUTURES_EXECUTION_ENABLED' },
            intent: {
                requestId,
                clientOrderId,
                symbol: 'BTCUSDT',
                side: 'SELL',
                leverage: 3,
                expiresAt: expect.any(Number),
            },
        });
        expect(harness.reader.readPreflight).toHaveBeenCalledOnce();
        expect(harness.place).not.toHaveBeenCalled();
        await harness.service.shutdown();
    });

    it('derives the only reducing side and leverage from backend risk facts', async () => {
        const emitted = [];
        const harness = createHarness();
        const preflight = await harness.reader.readPreflight();
        preflight.observations.positions.data.positions[0].positionAmt = '-1.0';
        harness.reader.readPreflight.mockResolvedValue(preflight);
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        expect(emitted.at(-1).intent).toMatchObject({ side: 'BUY', leverage: 3 });
        expect(harness.place).not.toHaveBeenCalled();
        await harness.service.shutdown();
    });

    it('serializes same-revision intent preparation across the preflight await', async () => {
        const emitted = [];
        const harness = createHarness();
        const facts = await harness.reader.readPreflight();
        harness.reader.readPreflight.mockClear();
        let resolvePreflight;
        harness.reader.readPreflight.mockImplementation(() => new Promise((resolve) => {
            resolvePreflight = resolve;
        }));
        await harness.service.start();
        harness.service.bindReadSession({ connectionId: 'connection-a', symbol: 'BTCUSDT' });
        await harness.service.handleSessionRequest(
            sessionRequest('futures.execution.subscribeStatus'),
            { connectionId: 'connection-a', emit: message => emitted.push(message) },
        );
        const first = harness.service.handleSessionRequest(
            sessionRequest('futures.execution.prepareIntent'),
            { connectionId: 'connection-a', emit: message => emitted.push(message) },
        );
        while (!resolvePreflight) await Promise.resolve();
        await expect(harness.service.handleSessionRequest(
            sessionRequest('futures.execution.prepareIntent'),
            { connectionId: 'connection-a', emit: message => emitted.push(message) },
        )).resolves.toBe(false);
        expect(harness.reader.readPreflight).toHaveBeenCalledOnce();
        resolvePreflight(facts);
        await expect(first).resolves.toBe(true);
        expect(emitted.filter(status => status.intent !== null)).toHaveLength(1);
        await harness.service.shutdown();
    });

    it('rejects a stale prepare revision and advances an authoritative status', async () => {
        const emitted = [];
        const harness = createHarness();
        await harness.service.start();
        expect(harness.service.bindReadSession({
            connectionId: 'connection-a',
            symbol: 'BTCUSDT',
        })).toBe(true);
        await expect(harness.service.handleSessionRequest(
            sessionRequest('futures.execution.subscribeStatus'),
            { connectionId: 'connection-a', emit: message => emitted.push(message) },
        )).resolves.toBe(true);
        await expect(harness.service.handleSessionRequest(
            sessionRequest('futures.execution.prepareIntent', '999'),
            { connectionId: 'connection-a', emit: message => emitted.push(message) },
        )).resolves.toBe(false);
        expect(emitted.at(-1)).toMatchObject({ revision: '1', intent: null });
        await expect(harness.service.handleSessionRequest(
            sessionRequest('futures.execution.prepareIntent', '1'),
            { connectionId: 'connection-a', emit: message => emitted.push(message) },
        )).resolves.toBe(true);
        expect(emitted.at(-1).intent).not.toBeNull();
        await harness.service.shutdown();
    });

    it('hydrates persisted dispatch counters and pauses before enabling capability', async () => {
        const ledger = new FakeLedger();
        ledger.getOrderRateState = () => ({
            dispatchTimes: [1783814395000],
            pauseUntil: 1783814700000,
        });
        const harness = createHarness({ ledger });
        await harness.service.start();
        expect(harness.coordinator.restoreOrderState).toHaveBeenCalledExactlyOnceWith({
            dispatchTimes: [1783814395000],
            pauseUntil: 1783814700000,
        });
        await harness.service.shutdown();
    });

    it('durably orders queued, dispatch intent, POST ACK, and exact reconciliation', async () => {
        const emitted = [];
        const harness = createHarness();
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await expect(harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a',
            emit: message => emitted.push(message),
        })).resolves.toBe(true);

        expect(harness.ledger.records.map(record => record.event)).toEqual([
            'queued', 'dispatch_intent', 'post_ack', 'reconciled',
        ]);
        expect(harness.ledger.records.find(record => record.event === 'post_ack'))
            .toMatchObject({ exchangeOrderId });
        expect(harness.place).toHaveBeenCalledOnce();
        expect(harness.place).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            side: 'SELL',
            quantity: '0.001',
            price: '70000.0',
            clientOrderId,
        });
        expect(harness.query).toHaveBeenCalledOnce();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_FILLED,
            attempt: {
                acknowledgement: 'accepted',
                order: { orderId: '9223372036854775807', status: 'FILLED' },
            },
        });
        const revisions = harness.ledger.records.map(record => BigInt(record.revision));
        expect(revisions.every((value, index) => index === 0 || value > revisions[index - 1])).toBe(true);
        await harness.service.shutdown();
    });

    it('durably cross-checks the POST ACK order identity through restart', async () => {
        const emitted = [];
        const place = vi.fn().mockResolvedValue({ orderId: '123' });
        const query = vi.fn().mockResolvedValue(queryOrder());
        const harness = createHarness({ place, query });
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });

        expect(query).toHaveBeenCalledOnce();
        expect(harness.ledger.records.map(record => record.event)).toEqual([
            'queued', 'dispatch_intent', 'post_ack',
        ]);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'reconciling',
            exchangeOrderId: '123',
        });
        await harness.service.shutdown();

        const restartQuery = vi.fn()
            .mockResolvedValueOnce(queryOrder())
            .mockResolvedValue(queryOrder({ orderId: '123' }));
        const restart = createHarness({
            ledger: new FakeLedger(harness.ledger.records),
            query: restartQuery,
        });
        restart.setClock(harness.ledger.records.at(-1).observedAt + 1);
        await restart.service.start();
        expect(restart.service.getCurrentAttempt()).toMatchObject({
            state: 'reconciling',
            exchangeOrderId: '123',
        });
        expect(restart.ledger.records.some(record => record.event === 'reconciled')).toBe(false);
        expect(restart.timers[0]).toMatchObject({ delay: 1_000 });

        restart.timers[0].callback();
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
        expect(restartQuery).toHaveBeenCalledTimes(2);
        expect(restart.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_filled',
            exchangeOrderId: '123',
            attempt: { order: { orderId: '123' } },
        });
        await restart.service.shutdown();
    });

    it('persists unknown before exact reconciliation and never retries the POST', async () => {
        const emitted = [];
        const place = vi.fn().mockRejectedValue(new FuturesTestnetExecutionFacadeError({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeOrder',
        }));
        const query = vi.fn().mockResolvedValue(queryOrder({ status: 'NEW', executedQuantity: '0', averagePrice: '0' }));
        const harness = createHarness({ place, query });
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a',
            emit: message => emitted.push(message),
        });
        expect(place).toHaveBeenCalledOnce();
        expect(harness.ledger.records.map(record => record.event)).toEqual([
            'queued', 'dispatch_intent', 'post_unknown', 'reconciled',
        ]);
        expect(emitted.some(status => status.attempt?.acknowledgement === 'unknown')).toBe(true);
        expect(harness.service.getCurrentAttempt().state).toBe('confirmed_open');
        expect(harness.timers).toContainEqual(expect.objectContaining({ delay: 60_000 }));
        await harness.service.shutdown();
    });

    it('monitors unchanged open orders without consuming durable ledger capacity', async () => {
        const emitted = [];
        const query = vi.fn().mockResolvedValue(queryOrder({
            status: 'NEW',
            executedQuantity: '0',
            averagePrice: '0',
        }));
        const harness = createHarness({ query });
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        expect(harness.ledger.records).toHaveLength(4);

        for (let index = 0; index < 1_024; index += 1) {
            const timer = harness.timers[index];
            expect(timer).toMatchObject({ delay: 60_000 });
            timer.callback();
            for (let spin = 0; spin < 10; spin += 1) await Promise.resolve();
        }
        expect(query).toHaveBeenCalledTimes(1_025);
        expect(harness.ledger.records).toHaveLength(4);

        query.mockResolvedValue(queryOrder({
            status: 'PARTIALLY_FILLED',
            executedQuantity: '0.0005',
            averagePrice: '70000.0',
            updateTime: 1783814400124,
        }));
        harness.timers[1_024].callback();
        for (let spin = 0; spin < 10; spin += 1) await Promise.resolve();
        expect(harness.ledger.records).toHaveLength(5);
        expect(harness.ledger.records.at(-1)).toMatchObject({
            event: 'reconciled',
            state: 'confirmed_open',
            exchangeOrderId,
            attempt: {
                order: {
                    status: 'PARTIALLY_FILLED',
                    executedQuantity: '0.0005',
                },
            },
        });
        await harness.service.shutdown();
    });

    it('runs only the reviewed Query Order fast schedule before slow recovery', async () => {
        const emitted = [];
        const place = vi.fn().mockRejectedValue(new FuturesTestnetExecutionFacadeError({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeOrder',
        }));
        const query = vi.fn().mockRejectedValue(new FuturesTestnetExecutionFacadeError({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
            operation: 'queryOrder',
        }));
        const harness = createHarness({ place, query });
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });

        let timerIndex = 0;
        for (const delay of [1_000, 1_000, 3_000, 5_000, 20_000]) {
            const timer = harness.timers[timerIndex];
            timerIndex += 1;
            expect(timer).toBeDefined();
            expect(timer.delay).toBe(delay);
            timer.callback();
            for (let index = 0; index < 10; index += 1) await Promise.resolve();
        }
        expect(place).toHaveBeenCalledOnce();
        expect(query).toHaveBeenCalledTimes(6);
        expect(harness.service.getCurrentAttempt().state).toBe('reconciliation_unavailable');
        expect(harness.timers.some(({ delay }) => delay === 5 * 60_000)).toBe(true);
        await harness.service.shutdown();
    });

    it('returns identical replay without another POST and rejects a changed collision', async () => {
        const emitted = [];
        const harness = createHarness();
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        const calls = harness.place.mock.calls.length;
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        expect(harness.place).toHaveBeenCalledTimes(calls);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand({ price: '70001.0' })), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        expect(harness.place).toHaveBeenCalledTimes(calls);
        expect(harness.service.getCurrentAttempt().attempt.code).toBe('FUTURES_EXECUTION_CONFIRMED');
        expect(emitted.at(-1).attempt.code).toBe('FUTURES_EXECUTION_DUPLICATE_REJECTED');
        expect(harness.ledger.records.map(record => record.event)).toEqual([
            'queued', 'dispatch_intent', 'post_ack', 'reconciled',
        ]);
        await harness.service.shutdown();
    });

    it('continues POST ownership and reconciliation after renderer teardown', async () => {
        let resolvePlace;
        const place = vi.fn(() => new Promise(resolve => { resolvePlace = resolve; }));
        const harness = createHarness({ place });
        const emitted = [];
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        const pending = harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        await Promise.resolve();
        while (!resolvePlace) await Promise.resolve();
        expect(harness.service.unbindReadSession('connection-a')).toBe(true);
        resolvePlace({ orderId: exchangeOrderId });
        await pending;
        expect(harness.place).toHaveBeenCalledOnce();
        expect(harness.query).toHaveBeenCalledOnce();
        expect(harness.service.getCurrentAttempt().state).toBe('confirmed_filled');
        await harness.service.shutdown();
    });

    it('waits for an in-flight post-intent POST and closes on durable recovery ownership', async () => {
        let resolvePlace;
        const place = vi.fn(() => new Promise(resolve => { resolvePlace = resolve; }));
        const harness = createHarness({ place });
        const emitted = [];
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        const placement = harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        while (!resolvePlace) await Promise.resolve();
        const shutdown = harness.service.shutdown();
        await Promise.resolve();
        expect(harness.ledger.closed).toBe(false);
        resolvePlace({ orderId: exchangeOrderId });
        await Promise.all([placement, shutdown]);

        expect(place).toHaveBeenCalledOnce();
        expect(harness.query).not.toHaveBeenCalled();
        expect(harness.ledger.records.map(record => record.event)).toEqual([
            'queued', 'dispatch_intent', 'post_ack',
        ]);
        expect(harness.service.getCurrentAttempt().state).toBe('reconciling');
        expect(harness.ledger.closed).toBe(true);
    });

    it('aborts pre-dispatch risk work during shutdown and proves no POST', async () => {
        const harness = createHarness();
        const emitted = [];
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        harness.reader.readPreflight.mockImplementation(({ signal }) => new Promise(
            (_resolve, reject) => signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            }, { once: true }),
        ));
        const placement = harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        while (harness.reader.readPreflight.mock.calls.length < 2) await Promise.resolve();
        const shutdown = harness.service.shutdown();
        await Promise.all([placement, shutdown]);

        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.ledger.records.map(record => record.event)).toEqual([
            'queued', 'locally_rejected',
        ]);
        expect(harness.ledger.closed).toBe(true);
    });

    it('proves no POST when queued fsync fails', async () => {
        const emitted = [];
        const ledger = new FakeLedger();
        ledger.failEvent = 'queued';
        const harness = createHarness({ ledger });
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await expect(harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        })).resolves.toBe(false);
        expect(harness.place).not.toHaveBeenCalled();
        await harness.service.shutdown();
    });

    it('recovers queued as interrupted and dispatch intent as durable unknown on restart', async () => {
        const queuedCommand = makeCommand();
        const base = {
            revision: '1',
            observedAt: 1783814400000,
            requestId,
            clientOrderId,
            command: queuedCommand,
            commandDigest: createFuturesTestnetExecutionCommandDigest(queuedCommand),
            credentialBinding: 'binding-a',
            attempt: null,
        };
        const queuedHarness = createHarness({
            ledger: new FakeLedger([{ ...base, event: 'queued', state: 'queued' }]),
        });
        await queuedHarness.service.start();
        expect(queuedHarness.service.getCurrentAttempt()).toMatchObject({
            event: 'restart_before_dispatch',
            state: 'locally_rejected',
            attempt: { code: 'FUTURES_EXECUTION_INTERRUPTED_BEFORE_DISPATCH' },
        });
        expect(queuedHarness.place).not.toHaveBeenCalled();
        await queuedHarness.service.shutdown();

        const dispatchedHarness = createHarness({
            ledger: new FakeLedger([{ ...base, event: 'dispatch_intent', state: 'dispatched' }]),
            query: vi.fn().mockResolvedValue(queryOrder()),
        });
        await dispatchedHarness.service.start();
        expect(dispatchedHarness.place).not.toHaveBeenCalled();
        expect(dispatchedHarness.query).toHaveBeenCalledOnce();
        expect(dispatchedHarness.ledger.records.map(record => record.event)).toEqual([
            'dispatch_intent', 'restart_unknown', 'reconciled',
        ]);
        await dispatchedHarness.service.shutdown();
    });

    it('blocks credential rotation and exposes only backend recovery', async () => {
        const queuedCommand = makeCommand();
        const prior = {
            version: 1,
            event: 'post_unknown',
            state: 'result_unknown',
            revision: '2',
            observedAt: 1783814400000,
            requestId,
            clientOrderId,
            command: queuedCommand,
            commandDigest: createFuturesTestnetExecutionCommandDigest(queuedCommand),
            credentialBinding: 'old-binding',
            attempt: null,
        };
        const query = vi.fn();
        const harness = createHarness({ ledger: new FakeLedger([prior]), query, binding: 'new-binding' });
        await harness.service.start();
        expect(query).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt().state).toBe('reconciliation_unavailable');
        await harness.service.recoverTestnetAttempt();
        expect(query).not.toHaveBeenCalled();
        expect(harness.service).not.toHaveProperty('forceClear');
        await harness.service.shutdown();
    });

    it('stops automatic Query Order at the 90-day recovery horizon without clearing ownership', async () => {
        const queuedCommand = makeCommand();
        const prior = {
            version: 1,
            event: 'post_unknown',
            state: 'result_unknown',
            revision: '2',
            observedAt: 1783814400000 - (91 * 24 * 60 * 60_000),
            dispatchObservedAt: 1783814400000 - (91 * 24 * 60 * 60_000),
            requestId,
            clientOrderId,
            command: queuedCommand,
            commandDigest: createFuturesTestnetExecutionCommandDigest(queuedCommand),
            credentialBinding: 'binding-a',
            attempt: null,
        };
        const query = vi.fn();
        const harness = createHarness({ ledger: new FakeLedger([prior]), query });
        await harness.service.start();
        expect(query).not.toHaveBeenCalled();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'reconciliation_unavailable',
            requestId,
        });
        expect(harness.timers).toHaveLength(0);
        await harness.service.shutdown();
    });

    it('keeps an active unknown globally blocking against unrelated commands and restart', async () => {
        const emitted = [];
        const place = vi.fn().mockRejectedValue(new FuturesTestnetExecutionFacadeError({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeOrder',
        }));
        const query = vi.fn().mockRejectedValue(new FuturesTestnetExecutionFacadeError({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
            operation: 'queryOrder',
        }));
        const harness = createHarness({ place, query });
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        expect(harness.service.getCurrentAttempt().state).toBe('result_unknown');
        const durableCount = harness.ledger.records.length;

        expect(harness.service.bindReadSession({
            connectionId: 'connection-b',
            symbol: 'BTCUSDT',
        })).toBe(true);
        await harness.service.handleSessionRequest(
            sessionRequest('futures.execution.subscribeStatus'),
            { connectionId: 'connection-b', emit: message => emitted.push(message) },
        );
        const unrelated = makeCommand({
            requestId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            clientOrderId: 'cc6-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        });
        await expect(harness.service.handlePlaceOrder(JSON.stringify(unrelated), {
            connectionId: 'connection-b', emit: message => emitted.push(message),
        })).resolves.toBe(false);

        expect(harness.ledger.records).toHaveLength(durableCount);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            requestId,
            state: 'result_unknown',
        });
        expect(emitted.at(-1).attempt.code).toBe('FUTURES_EXECUTION_BUSY');
        await harness.service.shutdown();

        const restart = createHarness({
            ledger: new FakeLedger(harness.ledger.records),
            query: vi.fn().mockRejectedValue(new FuturesTestnetExecutionFacadeError({
                kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
                operation: 'queryOrder',
            })),
        });
        await restart.service.start();
        expect(restart.service.getCurrentAttempt()).toMatchObject({
            requestId,
            state: 'reconciliation_unavailable',
        });
        await restart.service.shutdown();
    });

    it('takes the mutex before the first durable await and permits only one POST', async () => {
        let resolvePlace;
        const place = vi.fn(() => new Promise(resolve => { resolvePlace = resolve; }));
        const emitted = [];
        const harness = createHarness({ place });
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        const first = harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        while (!resolvePlace) await Promise.resolve();
        const second = await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        expect(second).toBe(false);
        expect(place).toHaveBeenCalledOnce();
        resolvePlace({ orderId: exchangeOrderId });
        await first;
        expect(place).toHaveBeenCalledOnce();
        await harness.service.shutdown();
    });

    it('remains failed closed after persistence failure and cannot issue a second intent', async () => {
        const emitted = [];
        const ledger = new FakeLedger();
        ledger.failEvent = 'queued';
        const harness = createHarness({ ledger });
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        expect(harness.place).not.toHaveBeenCalled();

        await harness.service.handleSessionRequest(
            sessionRequest('futures.execution.prepareIntent', harness.service.getRevision()),
            { connectionId: 'connection-a', emit: message => emitted.push(message) },
        );
        expect(emitted.at(-1)).toMatchObject({
            capability: {
                enabled: false,
                code: 'FUTURES_EXECUTION_RECONCILIATION_UNAVAILABLE',
            },
            intent: null,
        });
        await harness.service.shutdown();
    });

    it('rechecks the one-second final freshness boundary after fsynced dispatch intent', async () => {
        const evaluateRisk = vi.fn(({ ownership }) => (
            ownership.validationToDispatchAgeMs > 1_000
                ? { ok: false, code: 'FUTURES_EXECUTION_RISK_DATA_REJECTED' }
                : { ok: true }
        ));
        const harness = createHarness({ evaluateRisk });
        harness.reader.getValidationToDispatchAgeMs = vi.fn(() => 1_001);
        const emitted = [];
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });

        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.ledger.records.map(record => record.event)).toEqual([
            'queued', 'dispatch_intent', 'dispatch_stale',
        ]);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'locally_rejected',
            attempt: { code: 'FUTURES_EXECUTION_RISK_DATA_REJECTED' },
        });
        await harness.service.shutdown();
    });

    it('rejects placement at the exact intent expiry and replaces an expired intent', async () => {
        const emitted = [];
        const harness = createHarness();
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        const expiresAt = emitted.at(-1).intent.expiresAt;
        harness.setClock(expiresAt);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        expect(harness.place).not.toHaveBeenCalled();
        expect(harness.ledger.records).toEqual([]);
        await harness.service.handleSessionRequest(
            sessionRequest('futures.execution.prepareIntent', harness.service.getRevision()),
            { connectionId: 'connection-a', emit: message => emitted.push(message) },
        );
        expect(emitted.at(-1).intent.expiresAt).toBeGreaterThan(expiresAt);
        await harness.service.shutdown();
    });

    it('cannot exhaust the append-only ledger with commands lacking backend intents', async () => {
        const harness = createHarness();
        await harness.service.start();
        for (let index = 0; index < 50_001; index += 1) {
            const unownedRequestId = index.toString(16).padStart(32, '0');
            await harness.service.handlePlaceOrder(JSON.stringify(makeCommand({
                requestId: unownedRequestId,
                clientOrderId: `cc6-${unownedRequestId}`,
            })), { connectionId: 'unbound-renderer' });
        }
        expect(harness.ledger.records).toEqual([]);
        expect(harness.place).not.toHaveBeenCalled();
        await harness.service.shutdown();
    }, 10_000);

    it('durably restores a Query Order rate pause across restart', async () => {
        const emitted = [];
        const query = vi.fn().mockRejectedValue(new FuturesTestnetExecutionFacadeError({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.RATE_LIMITED,
            operation: 'queryOrder',
            status: 429,
            headers: { 'retry-after': '120' },
        }));
        const harness = createHarness({ query });
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        expect(harness.place).toHaveBeenCalledOnce();
        expect(query).toHaveBeenCalledOnce();
        expect(harness.ledger.records.map(record => record.event)).toEqual([
            'queued', 'dispatch_intent', 'post_ack', 'recovery_rate_pause',
        ]);
        const pauseUntil = harness.service.getCurrentAttempt().pauseUntil;
        expect(pauseUntil).toBeGreaterThan(1783814400000);
        await harness.service.shutdown();

        const restartQuery = vi.fn();
        const restart = createHarness({
            ledger: new FakeLedger(harness.ledger.records),
            query: restartQuery,
        });
        restart.setClock(pauseUntil - 1_000);
        await restart.service.start();
        expect(restart.coordinator.restoreOrderState).toHaveBeenCalledWith(expect.objectContaining({
            pauseUntil,
        }));
        expect(restartQuery).not.toHaveBeenCalled();
        expect(restart.service.getCurrentAttempt()).toMatchObject({
            event: 'recovery_rate_pause',
            pauseUntil,
        });
        await restart.service.shutdown();
    });

    it('persists rate pauses, treats a 429 POST as unknown, and reconciles without retry', async () => {
        const emitted = [];
        const place = vi.fn().mockRejectedValue(new FuturesTestnetExecutionFacadeError({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.RATE_LIMITED,
            operation: 'placeOrder',
            status: 429,
            headers: { 'retry-after': '300' },
        }));
        const query = vi.fn().mockResolvedValue(queryOrder({
            status: 'NEW',
            executedQuantity: '0',
            averagePrice: '0',
        }));
        const harness = createHarness({ place, query });
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });
        expect(place).toHaveBeenCalledOnce();
        expect(harness.query).not.toHaveBeenCalled();
        expect(harness.coordinator.setOrderPauseUntil).toHaveBeenCalledOnce();
        expect(harness.ledger.records.map(record => record.event)).toEqual([
            'queued', 'dispatch_intent', 'post_unknown',
        ]);
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'result_unknown',
            pauseUntil: expect.any(Number),
            attempt: { acknowledgement: 'unknown', code: 'FUTURES_EXECUTION_RESULT_UNKNOWN' },
        });
        expect(harness.timers.some(({ delay }) => delay > 299_000)).toBe(true);
        await harness.service.shutdown();
    });

    it.each([
        [429, { 'retry-after': 'Mon, 13 Jul 2026 08:00:00 GMT' }, 120_000],
        [418, {}, 3 * 24 * 60 * 60_000],
    ])('durably pauses ambiguous HTTP %s responses with conservative floors', async (
        status,
        headers,
        minimumPauseMs,
    ) => {
        const place = vi.fn().mockRejectedValue(new FuturesTestnetExecutionFacadeError({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeOrder',
            status,
            headers,
        }));
        const harness = createHarness({ place });
        const emitted = [];
        await harness.service.start();
        await bindAndPrepare(harness.service, emitted);
        await harness.service.handlePlaceOrder(JSON.stringify(makeCommand()), {
            connectionId: 'connection-a', emit: message => emitted.push(message),
        });

        expect(place).toHaveBeenCalledOnce();
        expect(harness.query).not.toHaveBeenCalled();
        expect(harness.coordinator.setOrderPauseUntil).toHaveBeenCalledOnce();
        expect(harness.service.getCurrentAttempt()).toMatchObject({
            state: 'result_unknown',
            pauseUntil: expect.any(Number),
        });
        expect(harness.service.getCurrentAttempt().pauseUntil - 1783814400000)
            .toBeGreaterThanOrEqual(minimumPauseMs);
        expect(harness.ledger.records.map(record => record.event)).toEqual([
            'queued', 'dispatch_intent', 'post_unknown',
        ]);
        await harness.service.shutdown();
    });
});
