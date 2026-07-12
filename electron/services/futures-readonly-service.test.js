import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    FUTURES_READONLY_SAFE_ERROR_CODES,
    FUTURES_READONLY_STATUSES,
    FUTURES_READONLY_TIMING,
    FUTURES_READONLY_WEIGHTS,
    FuturesReadOnlyService,
} from './futures-readonly-service.js';
import {
    createFuturesReadSubscribeRequest,
    createFuturesReadUnsubscribeRequest,
} from '../../src/utils/futuresReadOnlyProtocol.js';
import { FuturesTradingAdapter } from './futures-trading-adapter.js';
import { createFuturesReadOnlyTransport } from './futures-readonly-transport.js';

const SYMBOL = 'BTCUSDT';

const EXCHANGE_INFO = Object.freeze({
    marketType: 'futures',
    symbol: SYMBOL,
    pair: SYMBOL,
    contractType: 'PERPETUAL',
    status: 'TRADING',
    assets: Object.freeze({ base: 'BTC', quote: 'USDT', margin: 'USDT' }),
    filters: Object.freeze({}),
    supportedOrderTypes: Object.freeze(['LIMIT']),
    supportedTimeInForce: Object.freeze(['GTC']),
});

const MARKET = Object.freeze({
    markPrice: Object.freeze({
        marketType: 'futures',
        symbol: SYMBOL,
        markPrice: '60123.40000000',
        indexPrice: '60120.10000000',
        estimatedSettlePrice: '60121.20000000',
        time: 1_783_814_400_000,
    }),
    fundingState: Object.freeze({
        marketType: 'futures',
        symbol: SYMBOL,
        lastFundingRate: '0.00010000',
        interestRate: '0.00010000',
        nextFundingTime: 1_783_843_200_000,
        time: 1_783_814_400_000,
    }),
});

const POSITIONS = Object.freeze([Object.freeze({
    marketType: 'futures',
    symbol: SYMBOL,
    positionSide: 'BOTH',
    positionAmt: '0.010',
    unRealizedProfit: '-1.25000000',
    liquidationPrice: '25000.00000000',
})]);

const BALANCE = Object.freeze({
    marketType: 'futures',
    asset: 'USDT',
    balance: '1000.00000000',
    crossWalletBalance: '999.00000000',
    crossUnPnl: '-1.00000000',
    availableBalance: '900.00000000',
    maxWithdrawAmount: '900.00000000',
    marginAvailable: true,
    updateTime: 1_783_814_400_000,
});

const flushMicrotasks = async (rounds = 12) => {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const createAdapter = (overrides = {}) => ({
    getExchangeInfo: vi.fn().mockResolvedValue(EXCHANGE_INFO),
    getCurrentMarketState: vi.fn().mockResolvedValue(MARKET),
    getPositionRisks: vi.fn().mockResolvedValue(POSITIONS),
    getAccountBalance: vi.fn().mockResolvedValue(BALANCE),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getAlgoOpenOrders: vi.fn().mockResolvedValue([]),
    getOrderHistory: vi.fn(),
    getAlgoOrderHistory: vi.fn(),
    getAccountTradeHistory: vi.fn(),
    getIncomeHistory: vi.fn(),
    getOrder: vi.fn(),
    getAlgoOrder: vi.fn(),
    getCurrentOpenOrder: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    setLeverage: vi.fn(),
    setMarginMode: vi.fn(),
    ...overrides,
});

const createTransport = () => {
    const connections = [];
    const subscriptions = [];
    const subscribeMarkPrice = vi.fn(async (options) => {
        subscriptions.push(options);
        const connection = { close: vi.fn() };
        connections.push(connection);
        options.onOpen();
        return connection;
    });
    return { transport: { subscribeMarkPrice }, subscribeMarkPrice, subscriptions, connections };
};

const createHarness = ({
    adapter = createAdapter(),
    transportHarness = createTransport(),
    executeRead = vi.fn((load) => load()),
    environment = 'mock',
    onInternalError = vi.fn(),
} = {}) => {
    const responses = [];
    const service = new FuturesReadOnlyService({
        adapter,
        transport: transportHarness.transport,
        executeRead,
        environment,
        onInternalError,
    });
    const subscribe = (requestId = 'request-1', symbol = SYMBOL) => service.subscribe(
        createFuturesReadSubscribeRequest({ requestId, symbol }),
        response => responses.push(response),
    );
    return {
        adapter,
        executeRead,
        onInternalError,
        responses,
        service,
        subscribe,
        ...transportHarness,
    };
};

const lastResponse = responses => responses.at(-1);

describe('FuturesReadOnlyService read composition', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_783_814_400_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('loads the exact minimum snapshot with reviewed weights and polls only signed current state', async () => {
        const harness = createHarness({ environment: 'testnet' });
        harness.subscribe('minimum-state');

        expect(harness.responses[0].payload).toMatchObject({
            status: FUTURES_READONLY_STATUSES.LOADING,
            environment: 'testnet',
            symbol: SYMBOL,
            connected: false,
        });
        await flushMicrotasks();

        expect(harness.adapter.getExchangeInfo).toHaveBeenCalledExactlyOnceWith(
            SYMBOL,
            expect.any(AbortSignal),
        );
        expect(harness.adapter.getCurrentMarketState).toHaveBeenCalledExactlyOnceWith(
            SYMBOL,
            expect.any(AbortSignal),
        );
        expect(harness.adapter.getPositionRisks).toHaveBeenCalledExactlyOnceWith(
            SYMBOL,
            expect.any(AbortSignal),
        );
        expect(harness.adapter.getAccountBalance).toHaveBeenCalledExactlyOnceWith(
            'USDT',
            expect.any(AbortSignal),
        );
        expect(harness.adapter.getOpenOrders).toHaveBeenCalledExactlyOnceWith(
            SYMBOL,
            expect.any(AbortSignal),
        );
        expect(harness.adapter.getAlgoOpenOrders).toHaveBeenCalledExactlyOnceWith(
            SYMBOL,
            expect.any(AbortSignal),
        );

        expect(harness.executeRead.mock.calls.map(([, weight]) => weight).sort((a, b) => a - b)).toEqual([
            FUTURES_READONLY_WEIGHTS.exchangeInfo,
            FUTURES_READONLY_WEIGHTS.market,
            FUTURES_READONLY_WEIGHTS.openOrders,
            FUTURES_READONLY_WEIGHTS.algoOpenOrders,
            FUTURES_READONLY_WEIGHTS.positions,
            FUTURES_READONLY_WEIGHTS.marginBalance,
        ].sort((a, b) => a - b));
        const signals = harness.executeRead.mock.calls.map(([, , options]) => options.signal);
        expect(new Set(signals).size).toBe(6);
        harness.executeRead.mock.calls.forEach(([, , options]) => {
            expect(options).toEqual({ signal: expect.any(AbortSignal), maxRetries: 0 });
            expect(options.signal).toBeInstanceOf(AbortSignal);
        });

        expect(harness.subscribeMarkPrice).toHaveBeenCalledTimes(1);
        expect(harness.subscribeMarkPrice.mock.calls[0][0]).toMatchObject({ symbol: SYMBOL });
        const snapshot = lastResponse(harness.responses);
        expect(snapshot).toMatchObject({
            marketType: 'futures',
            symbol: SYMBOL,
            environment: 'testnet',
            type: 'snapshot',
        });
        expect(snapshot.payload.status).toBe(FUTURES_READONLY_STATUSES.READY);
        expect(snapshot.payload.resources.market.data).toEqual(MARKET);
        expect(snapshot.payload.resources.positions.data).toEqual(POSITIONS);
        expect(snapshot.payload.resources.marginBalance.data).toEqual(BALANCE);
        expect(snapshot.payload.resources.openOrders.status).toBe(FUTURES_READONLY_STATUSES.EMPTY);
        expect(snapshot.payload.resources.algoOpenOrders.status).toBe(FUTURES_READONLY_STATUSES.EMPTY);

        await vi.advanceTimersByTimeAsync(FUTURES_READONLY_TIMING.currentPollMs);
        await flushMicrotasks();
        expect(harness.adapter.getExchangeInfo).toHaveBeenCalledTimes(1);
        expect(harness.adapter.getCurrentMarketState).toHaveBeenCalledTimes(1);
        expect(harness.adapter.getPositionRisks).toHaveBeenCalledTimes(2);
        expect(harness.adapter.getAccountBalance).toHaveBeenCalledTimes(2);
        expect(harness.adapter.getOpenOrders).toHaveBeenCalledTimes(2);
        expect(harness.adapter.getAlgoOpenOrders).toHaveBeenCalledTimes(2);

        [
            'getOrderHistory',
            'getAlgoOrderHistory',
            'getAccountTradeHistory',
            'getIncomeHistory',
            'getOrder',
            'getAlgoOrder',
            'getCurrentOpenOrder',
            'placeOrder',
            'cancelOrder',
            'setLeverage',
            'setMarginMode',
        ].forEach(method => expect(harness.adapter[method]).not.toHaveBeenCalled());
        expect(harness.service.placeOrder).toBeUndefined();
        expect(harness.service.cancelOrder).toBeUndefined();
        expect(harness.service.setLeverage).toBeUndefined();
    });

    it('composes the deterministic mock facade through the adapter into one read-only snapshot', async () => {
        const transport = createFuturesReadOnlyTransport({ mode: 'mock' });
        const adapter = new FuturesTradingAdapter({ transport });
        const responses = [];
        const executeRead = vi.fn(load => load());
        const service = new FuturesReadOnlyService({
            adapter,
            transport,
            executeRead,
            environment: 'mock',
        });

        service.subscribe(
            createFuturesReadSubscribeRequest({ requestId: 'composed-mock', symbol: SYMBOL }),
            response => responses.push(response),
        );
        await flushMicrotasks(30);

        const snapshot = lastResponse(responses).payload;
        expect(snapshot).toMatchObject({
            status: FUTURES_READONLY_STATUSES.READY,
            environment: 'mock',
            symbol: SYMBOL,
            connected: true,
        });
        expect(snapshot.resources.exchangeInfo.data).toMatchObject({
            marketType: 'futures',
            symbol: SYMBOL,
            pair: SYMBOL,
        });
        expect(snapshot.resources.market.data.markPrice).toMatchObject({
            markPrice: '58421.25000000',
            indexPrice: '58419.12500000',
        });
        expect(snapshot.resources.market.data.fundingState).toMatchObject({
            lastFundingRate: '-0.00012500',
            interestRate: '0.00010000',
            nextFundingTime: 1_783_843_200_000,
        });
        expect(snapshot.resources.positions.data).toHaveLength(1);
        expect(snapshot.resources.positions.data[0]).toMatchObject({
            positionSide: 'BOTH',
            unRealizedProfit: '52.51562500',
            liquidationPrice: '42125.50000000',
        });
        expect(snapshot.resources.marginBalance.data.balance).toBe('12500.00000000');
        expect(snapshot.resources.openOrders.data).toHaveLength(1);
        expect(snapshot.resources.algoOpenOrders.data).toHaveLength(1);
        service.stop();
    });

    it('does not report connected or ready merely because a socket handle was created', async () => {
        let streamOptions;
        const connection = { close: vi.fn() };
        const subscribeMarkPrice = vi.fn((options) => {
            streamOptions = options;
            return connection;
        });
        const harness = createHarness({
            transportHarness: {
                transport: { subscribeMarkPrice },
                subscribeMarkPrice,
                subscriptions: [],
                connections: [connection],
            },
        });
        harness.subscribe('pending-handshake');
        await flushMicrotasks();

        expect(lastResponse(harness.responses).payload).toMatchObject({
            status: FUTURES_READONLY_STATUSES.LOADING,
            connected: false,
        });
        streamOptions.onOpen();
        expect(lastResponse(harness.responses).payload).toMatchObject({
            status: FUTURES_READONLY_STATUSES.READY,
            connected: true,
        });
    });

    it('isolates resource failures, retains the exact internal error, and emits only a safe code', async () => {
        const positionError = Object.assign(new Error('secret account response'), {
            code: 'ECONNRESET',
            response: { data: { apiKey: 'must-not-leak' } },
        });
        const adapter = createAdapter({
            getPositionRisks: vi.fn().mockRejectedValue(positionError),
        });
        const harness = createHarness({ adapter });
        harness.subscribe('isolated-error');
        await flushMicrotasks();

        const snapshot = lastResponse(harness.responses);
        expect(snapshot.payload.resources.positions).toMatchObject({
            status: FUTURES_READONLY_STATUSES.ERROR,
            data: null,
            errorCode: FUTURES_READONLY_SAFE_ERROR_CODES.TRANSPORT_UNAVAILABLE,
        });
        expect(snapshot.payload.resources.marginBalance.status).toBe(FUTURES_READONLY_STATUSES.READY);
        expect(snapshot.payload.resources.openOrders.status).toBe(FUTURES_READONLY_STATUSES.EMPTY);
        expect(snapshot.payload.status).toBe(FUTURES_READONLY_STATUSES.PARTIAL);
        expect(harness.onInternalError).toHaveBeenCalledWith(expect.objectContaining({
            resource: 'positions',
            error: positionError,
            requestId: 'isolated-error',
            symbol: SYMBOL,
        }));
        expect(JSON.stringify(snapshot)).not.toContain('secret account response');
        expect(JSON.stringify(snapshot)).not.toContain('must-not-leak');
    });

    it('represents unavailable and disconnected state without synthetic account data', async () => {
        const unavailableError = Object.assign(new Error('missing symbol'), {
            code: 'FUTURES_SYMBOL_UNAVAILABLE',
        });
        const harness = createHarness({
            adapter: createAdapter({
                getPositionRisks: vi.fn().mockRejectedValue(unavailableError),
            }),
        });
        harness.subscribe('unavailable');
        await flushMicrotasks();

        let snapshot = lastResponse(harness.responses).payload;
        expect(snapshot.resources.positions).toMatchObject({
            status: FUTURES_READONLY_STATUSES.UNAVAILABLE,
            data: null,
            lastUpdatedAt: null,
            errorCode: FUTURES_READONLY_SAFE_ERROR_CODES.DATA_UNAVAILABLE,
        });

        harness.subscriptions[0].onClose();
        snapshot = lastResponse(harness.responses).payload;
        expect(snapshot.connected).toBe(false);
        expect(snapshot.status).toBe(FUTURES_READONLY_STATUSES.DISCONNECTED);
        expect(snapshot.resources.market).toMatchObject({
            status: FUTURES_READONLY_STATUSES.DISCONNECTED,
            data: MARKET,
            errorCode: FUTURES_READONLY_SAFE_ERROR_CODES.STREAM_DISCONNECTED,
        });
    });

    it('preserves exact stream decimals, refreshes funding inputs, and ignores older observations', async () => {
        const harness = createHarness();
        harness.subscribe('stream-state');
        await flushMicrotasks();

        const stream = harness.subscriptions[0];
        stream.onMessage({
            e: 'markPriceUpdate',
            E: 1_783_814_403_000,
            s: SYMBOL,
            p: '60125.00000000',
            i: '60122.00000000',
            P: '60123.00000000',
            r: '-0.00002500',
            T: 1_783_843_200_000,
        });

        const market = lastResponse(harness.responses).payload.resources.market.data;
        expect(market).toEqual({
            markPrice: {
                marketType: 'futures',
                symbol: SYMBOL,
                markPrice: '60125.00000000',
                indexPrice: '60122.00000000',
                estimatedSettlePrice: '60123.00000000',
                time: 1_783_814_403_000,
            },
            fundingState: {
                marketType: 'futures',
                symbol: SYMBOL,
                lastFundingRate: '-0.00002500',
                interestRate: '0.00010000',
                nextFundingTime: 1_783_843_200_000,
                time: 1_783_814_403_000,
            },
        });

        const responseCount = harness.responses.length;
        stream.onMessage({
            e: 'markPriceUpdate',
            E: 1_783_814_402_999,
            s: SYMBOL,
            p: '1.0',
            i: '1.0',
            P: '1.0',
            r: '1.0',
            T: 1_783_843_200_000,
        });
        expect(harness.responses).toHaveLength(responseCount);
        expect(lastResponse(harness.responses).payload.resources.market.data.markPrice.markPrice)
            .toBe('60125.00000000');
    });

    it('keeps a newer stream snapshot when premium-index REST fails later', async () => {
        const pendingMarket = deferred();
        const restError = Object.assign(new Error('premium unavailable'), {
            code: 'ECONNRESET',
        });
        const harness = createHarness({
            adapter: createAdapter({
                getCurrentMarketState: vi.fn(() => pendingMarket.promise),
            }),
        });
        harness.subscribe('stream-before-rest');
        await flushMicrotasks();

        harness.subscriptions[0].onMessage({
            e: 'markPriceUpdate',
            E: 1_783_814_403_000,
            s: SYMBOL,
            p: '60125.00000000',
            i: '60122.00000000',
            P: '60123.00000000',
            r: '-0.00002500',
            T: 1_783_843_200_000,
        });
        let market = lastResponse(harness.responses).payload.resources.market;
        expect(market).toMatchObject({
            status: FUTURES_READONLY_STATUSES.READY,
            errorCode: null,
            data: {
                fundingState: {
                    lastFundingRate: '-0.00002500',
                    interestRate: null,
                    nextFundingTime: 1_783_843_200_000,
                },
            },
        });

        const responseCount = harness.responses.length;
        pendingMarket.reject(restError);
        await flushMicrotasks();
        market = lastResponse(harness.responses).payload.resources.market;
        expect(harness.responses).toHaveLength(responseCount);
        expect(market.status).toBe(FUTURES_READONLY_STATUSES.READY);
        expect(market.data.markPrice.markPrice).toBe('60125.00000000');
        expect(harness.onInternalError).toHaveBeenCalledWith(expect.objectContaining({
            resource: 'market',
            error: restError,
        }));
    });

    it('marks a silent dynamic market snapshot stale without expiring one-shot metadata', async () => {
        const harness = createHarness();
        harness.subscribe('stale-market');
        await flushMicrotasks();

        await vi.advanceTimersByTimeAsync(FUTURES_READONLY_TIMING.staleAfterMs + 5_000);
        await flushMicrotasks();

        const snapshot = lastResponse(harness.responses).payload;
        expect(snapshot.resources.market.status).toBe(FUTURES_READONLY_STATUSES.STALE);
        expect(snapshot.resources.exchangeInfo.status).toBe(FUTURES_READONLY_STATUSES.READY);
        expect(snapshot.resources.positions.status).toBe(FUTURES_READONLY_STATUSES.READY);
        expect(snapshot.status).toBe(FUTURES_READONLY_STATUSES.STALE);
    });

    it('rejects extra protocol fields before starting reads or a stream', () => {
        const harness = createHarness();
        expect(() => harness.service.subscribe({
            ...createFuturesReadSubscribeRequest({ requestId: 'strict', symbol: SYMBOL }),
            endpoint: '/fapi/v3/balance',
        }, vi.fn())).toThrowError(expect.objectContaining({
            code: 'FUTURES_READ_INVALID_FIELDS',
        }));
        expect(harness.executeRead).not.toHaveBeenCalled();
        expect(harness.subscribeMarkPrice).not.toHaveBeenCalled();
    });
});

describe('FuturesReadOnlyService lifecycle ownership', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reconnects failed stream attempts after 1s, 2s, then a capped 5s delay', async () => {
        const attemptTimes = [];
        const connections = [];
        const subscribeMarkPrice = vi.fn((options) => {
            attemptTimes.push(Date.now());
            const connection = { close: vi.fn() };
            connections.push(connection);
            queueMicrotask(() => options.onError(
                Object.assign(new Error('offline'), { code: 'ECONNRESET' }),
            ));
            return connection;
        });
        const harness = createHarness({
            transportHarness: {
                transport: { subscribeMarkPrice },
                subscribeMarkPrice,
                subscriptions: [],
                connections: [],
            },
        });
        harness.subscribe('reconnect');
        await flushMicrotasks();
        expect(attemptTimes).toEqual([0]);

        await vi.advanceTimersByTimeAsync(999);
        expect(attemptTimes).toEqual([0]);
        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        expect(attemptTimes).toEqual([0, 1_000]);

        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        expect(attemptTimes).toEqual([0, 1_000, 3_000]);

        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
        expect(attemptTimes).toEqual([0, 1_000, 3_000, 8_000]);

        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
        expect(attemptTimes).toEqual([0, 1_000, 3_000, 8_000, 13_000]);
        connections.forEach(connection => expect(connection.close).toHaveBeenCalledTimes(1));
    });

    it('aborts superseded reads, orphan-closes a late stream, and suppresses stale generation delivery', async () => {
        const firstExchange = deferred();
        const firstStream = deferred();
        const secondStream = deferred();
        const lateConnection = { close: vi.fn() };
        const liveConnection = { close: vi.fn() };
        const adapter = createAdapter({
            getExchangeInfo: vi.fn(symbol => (
                symbol === 'BTCUSDT' ? firstExchange.promise : Promise.resolve({
                    ...EXCHANGE_INFO,
                    symbol,
                    pair: symbol,
                })
            )),
        });
        const subscribeMarkPrice = vi.fn()
            .mockImplementationOnce(() => firstStream.promise)
            .mockImplementationOnce(() => secondStream.promise);
        const executeRead = vi.fn(load => load());
        const firstResponses = [];
        const secondResponses = [];
        const service = new FuturesReadOnlyService({
            adapter,
            transport: { subscribeMarkPrice },
            executeRead,
            environment: 'mock',
        });

        const firstCleanup = service.subscribe(
            createFuturesReadSubscribeRequest({ requestId: 'first', symbol: 'BTCUSDT' }),
            response => firstResponses.push(response),
        );
        const firstSignal = executeRead.mock.calls[0][2].signal;
        await flushMicrotasks();
        service.subscribe(
            createFuturesReadSubscribeRequest({ requestId: 'second', symbol: 'ETHUSDT' }),
            response => secondResponses.push(response),
        );
        expect(firstSignal.aborted).toBe(true);
        expect(firstCleanup()).toBe(false);
        expect(service.unsubscribe(createFuturesReadUnsubscribeRequest({ requestId: 'first' })))
            .toBe(false);

        const firstStreamOptions = subscribeMarkPrice.mock.calls[0][0];
        const staleDeliveryCount = firstResponses.length;
        firstStreamOptions.onMessage({
            e: 'markPriceUpdate',
            E: 100,
            s: 'BTCUSDT',
            p: '1',
            i: '1',
            P: '1',
            r: '0',
            T: 200,
        });
        expect(firstResponses).toHaveLength(staleDeliveryCount);

        const firstCount = firstResponses.length;
        firstExchange.resolve(EXCHANGE_INFO);
        firstStream.resolve(lateConnection);
        secondStream.resolve(liveConnection);
        await flushMicrotasks();

        expect(firstResponses).toHaveLength(firstCount);
        expect(lateConnection.close).toHaveBeenCalledTimes(1);
        expect(liveConnection.close).not.toHaveBeenCalled();
        expect(lastResponse(secondResponses).requestId).toBe('second');
        expect(lastResponse(secondResponses).symbol).toBe('ETHUSDT');
    });

    it('teardown clears reconnects and polling, closes the socket, and prevents later delivery', async () => {
        const harness = createHarness();
        harness.subscribe('teardown');
        await flushMicrotasks();
        const responseCount = harness.responses.length;
        const connection = harness.connections[0];

        harness.subscriptions[0].onClose();
        expect(harness.service.unsubscribe(
            createFuturesReadUnsubscribeRequest({ requestId: 'teardown' }),
        )).toBe(true);
        expect(connection.close).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(60_000);
        await flushMicrotasks();
        expect(harness.subscribeMarkPrice).toHaveBeenCalledTimes(1);
        expect(harness.adapter.getPositionRisks).toHaveBeenCalledTimes(1);
        expect(harness.responses).toHaveLength(responseCount + 1);
    });

    it('suppresses an older overlapping poll result after a newer request owns the resource', async () => {
        const slowPositions = deferred();
        const newerPositions = [{ ...POSITIONS[0], unRealizedProfit: '9.00000000' }];
        const getPositionRisks = vi.fn()
            .mockImplementationOnce(() => slowPositions.promise)
            .mockResolvedValueOnce(newerPositions);
        const harness = createHarness({
            adapter: createAdapter({ getPositionRisks }),
        });
        harness.subscribe('overlap');
        await flushMicrotasks();

        await vi.advanceTimersByTimeAsync(FUTURES_READONLY_TIMING.currentPollMs);
        await flushMicrotasks();
        expect(lastResponse(harness.responses).payload.resources.positions.data)
            .toEqual(newerPositions);

        slowPositions.resolve(POSITIONS);
        await flushMicrotasks();
        expect(lastResponse(harness.responses).payload.resources.positions.data)
            .toEqual(newerPositions);
    });

    it('bounds each read, aborts its transport signal, prevents overlap, and recovers', async () => {
        const stuckPositions = deferred();
        const recoveredPositions = [{ ...POSITIONS[0], unRealizedProfit: '8.00000000' }];
        const getPositionRisks = vi.fn()
            .mockImplementationOnce(() => stuckPositions.promise)
            .mockResolvedValueOnce(recoveredPositions);
        const harness = createHarness({
            adapter: createAdapter({ getPositionRisks }),
        });
        harness.subscribe('bounded-read');
        await flushMicrotasks();

        const firstSignal = getPositionRisks.mock.calls[0][1];
        harness.service.startCurrentReads(harness.service.session);
        expect(getPositionRisks).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(FUTURES_READONLY_TIMING.readTimeoutMs);
        await flushMicrotasks();
        expect(firstSignal.aborted).toBe(true);
        expect(lastResponse(harness.responses).payload.resources.positions).toMatchObject({
            status: FUTURES_READONLY_STATUSES.ERROR,
            data: null,
            errorCode: FUTURES_READONLY_SAFE_ERROR_CODES.READ_TIMEOUT,
        });
        expect(harness.onInternalError).toHaveBeenCalledWith(expect.objectContaining({
            resource: 'positions',
            error: expect.objectContaining({
                name: 'FuturesReadOnlyTimeoutError',
                code: FUTURES_READONLY_SAFE_ERROR_CODES.READ_TIMEOUT,
            }),
        }));

        await vi.advanceTimersByTimeAsync(
            FUTURES_READONLY_TIMING.currentPollMs - FUTURES_READONLY_TIMING.readTimeoutMs,
        );
        await flushMicrotasks();
        expect(getPositionRisks).toHaveBeenCalledTimes(2);
        expect(lastResponse(harness.responses).payload.resources.positions).toMatchObject({
            status: FUTURES_READONLY_STATUSES.READY,
            data: recoveredPositions,
            errorCode: null,
        });
        harness.service.stop();
    });

    it('retries metadata until its first success and never polls it after ready', async () => {
        const getExchangeInfo = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('temporary metadata failure'), {
                code: 'ECONNRESET',
            }))
            .mockResolvedValueOnce(EXCHANGE_INFO);
        const harness = createHarness({
            adapter: createAdapter({ getExchangeInfo }),
        });
        harness.subscribe('metadata-retry');
        await flushMicrotasks();

        expect(getExchangeInfo).toHaveBeenCalledTimes(1);
        expect(lastResponse(harness.responses).payload.resources.exchangeInfo).toMatchObject({
            status: FUTURES_READONLY_STATUSES.ERROR,
            errorCode: FUTURES_READONLY_SAFE_ERROR_CODES.TRANSPORT_UNAVAILABLE,
        });

        await vi.advanceTimersByTimeAsync(FUTURES_READONLY_TIMING.metadataRetryMs);
        await flushMicrotasks();
        expect(getExchangeInfo).toHaveBeenCalledTimes(2);
        expect(lastResponse(harness.responses).payload.resources.exchangeInfo).toMatchObject({
            status: FUTURES_READONLY_STATUSES.READY,
            data: EXCHANGE_INFO,
            errorCode: null,
        });

        await vi.advanceTimersByTimeAsync(60_000);
        await flushMicrotasks();
        expect(getExchangeInfo).toHaveBeenCalledTimes(2);
        harness.service.stop();
    });

    it('classifies HTTP 418 and pauses current-state retry polling for the fixed safe window', async () => {
        const getExchangeInfo = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('metadata offline'), {
                code: 'ECONNRESET',
            }))
            .mockResolvedValueOnce(EXCHANGE_INFO);
        const getPositionRisks = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('banned'), { status: 418 }))
            .mockResolvedValueOnce(POSITIONS);
        const harness = createHarness({
            adapter: createAdapter({ getExchangeInfo, getPositionRisks }),
        });
        harness.subscribe('rate-limit-pause');
        await flushMicrotasks();

        expect(lastResponse(harness.responses).payload.resources.positions).toMatchObject({
            status: FUTURES_READONLY_STATUSES.ERROR,
            errorCode: FUTURES_READONLY_SAFE_ERROR_CODES.RATE_LIMITED,
        });
        await vi.advanceTimersByTimeAsync(FUTURES_READONLY_TIMING.rateLimitPauseMs - 1);
        await flushMicrotasks();
        expect(getPositionRisks).toHaveBeenCalledTimes(1);
        expect(getExchangeInfo).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        expect(getPositionRisks).toHaveBeenCalledTimes(2);
        expect(getExchangeInfo).toHaveBeenCalledTimes(2);
        expect(lastResponse(harness.responses).payload.resources.positions).toMatchObject({
            status: FUTURES_READONLY_STATUSES.READY,
            data: POSITIONS,
            errorCode: null,
        });
        harness.service.stop();
    });

    it('expires a stream that never opens and owns the close before reconnecting', async () => {
        const attemptTimes = [];
        const connections = [];
        const subscribeMarkPrice = vi.fn(() => {
            attemptTimes.push(Date.now());
            const connection = { close: vi.fn() };
            connections.push(connection);
            return connection;
        });
        const harness = createHarness({
            transportHarness: {
                transport: { subscribeMarkPrice },
                subscribeMarkPrice,
                subscriptions: [],
                connections,
            },
        });
        harness.subscribe('connect-watchdog');
        await flushMicrotasks();

        await vi.advanceTimersByTimeAsync(FUTURES_READONLY_TIMING.streamConnectTimeoutMs);
        await flushMicrotasks();
        expect(connections[0].close).toHaveBeenCalledTimes(1);
        expect(lastResponse(harness.responses).payload).toMatchObject({
            connected: false,
            status: FUTURES_READONLY_STATUSES.DISCONNECTED,
        });
        expect(attemptTimes).toEqual([0]);

        await vi.advanceTimersByTimeAsync(FUTURES_READONLY_TIMING.reconnectDelaysMs[0]);
        await flushMicrotasks();
        expect(attemptTimes).toEqual([0, 11_000]);
        harness.service.stop();
    });

    it('does not reset reconnect backoff on open, but resets it after one valid message', async () => {
        const attemptTimes = [];
        const subscriptions = [];
        const connections = [];
        const subscribeMarkPrice = vi.fn((options) => {
            attemptTimes.push(Date.now());
            subscriptions.push(options);
            const connection = { close: vi.fn() };
            connections.push(connection);
            queueMicrotask(() => options.onOpen());
            return connection;
        });
        const harness = createHarness({
            transportHarness: {
                transport: { subscribeMarkPrice },
                subscribeMarkPrice,
                subscriptions,
                connections,
            },
        });
        harness.subscribe('silence-watchdog');
        await flushMicrotasks();

        await vi.advanceTimersByTimeAsync(
            FUTURES_READONLY_TIMING.streamSilenceTimeoutMs
                + FUTURES_READONLY_TIMING.reconnectDelaysMs[0],
        );
        await flushMicrotasks();
        expect(attemptTimes).toEqual([0, 6_000]);

        await vi.advanceTimersByTimeAsync(
            FUTURES_READONLY_TIMING.streamSilenceTimeoutMs
                + FUTURES_READONLY_TIMING.reconnectDelaysMs[1],
        );
        await flushMicrotasks();
        expect(attemptTimes).toEqual([0, 6_000, 13_000]);

        subscriptions[2].onMessage({
            e: 'markPriceUpdate',
            E: MARKET.markPrice.time + 1,
            s: SYMBOL,
            p: '60125.00000000',
            i: '60122.00000000',
            P: '60123.00000000',
            r: '-0.00002500',
            T: MARKET.fundingState.nextFundingTime,
        });
        subscriptions[2].onClose();
        await vi.advanceTimersByTimeAsync(FUTURES_READONLY_TIMING.reconnectDelaysMs[0]);
        await flushMicrotasks();
        expect(attemptTimes).toEqual([0, 6_000, 13_000, 14_000]);
        harness.service.stop();
    });
});
