import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FuturesTradingAdapter } from './futures-trading-adapter.js';
import {
    FUTURES_READ_ONLY_MOCK_RESOURCES,
    FUTURES_READ_ONLY_MOCK_SCENARIOS,
    createFuturesReadOnlyMockFixtureSet,
    getFuturesReadOnlyMockFixture,
} from './futures-readonly-fixtures.js';
import {
    FUTURES_READ_ONLY_REQUEST_WEIGHTS,
    FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES,
    FUTURES_READ_ONLY_TRANSPORT_MODES,
    FUTURES_SIGNED_RECV_WINDOW,
    FUTURES_TESTNET_REST_BASE_URL,
    FUTURES_TESTNET_WEBSOCKET_BASE_URL,
    FuturesReadOnlyStreamError,
    FuturesReadOnlyTransportArgumentError,
    FuturesReadOnlyTransportConfigError,
    FuturesReadOnlyUpstreamError,
    createFuturesReadOnlyTransport,
    resolveFuturesReadOnlyTransportConfig,
} from './futures-readonly-transport.js';

const TEST_API_KEY = 'testnet-api-key';
const TEST_API_SECRET = 'testnet-api-secret';
const TEST_TIMESTAMP = 1783810800123;

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
});

const createTestnetTransport = (dependencies = {}) => createFuturesReadOnlyTransport({
    mode: FUTURES_READ_ONLY_TRANSPORT_MODES.TESTNET,
    apiKey: TEST_API_KEY,
    apiSecret: TEST_API_SECRET,
}, {
    fetchImpl: vi.fn().mockResolvedValue(createJsonResponse({})),
    WebSocketImpl: class {},
    now: () => TEST_TIMESTAMP,
    ...dependencies,
});

const sign = (query) => createHmac('sha256', TEST_API_SECRET)
    .update(query)
    .digest('hex');

class FakeWebSocket {
    static instances = [];

    constructor(url) {
        this.url = url;
        this.listeners = new Map();
        this.closeCalls = 0;
        FakeWebSocket.instances.push(this);
    }

    on(eventName, listener) {
        const listeners = this.listeners.get(eventName) ?? new Set();
        listeners.add(listener);
        this.listeners.set(eventName, listeners);
    }

    off(eventName, listener) {
        this.listeners.get(eventName)?.delete(listener);
    }

    emit(eventName, ...args) {
        const listeners = [...(this.listeners.get(eventName) ?? [])];
        if (eventName === 'error' && listeners.length === 0) throw args[0];
        listeners.forEach((listener) => listener(...args));
    }

    close() {
        this.closeCalls += 1;
    }
}

describe('futures read-only transport configuration and facade', () => {
    it('resolves only explicit mock and testnet modes with fixed testnet bases', () => {
        expect(resolveFuturesReadOnlyTransportConfig({ mode: 'mock' })).toEqual({
            mode: 'mock',
            environment: 'mock',
            mockScenario: FUTURES_READ_ONLY_MOCK_SCENARIOS.ONE_WAY,
        });
        expect(resolveFuturesReadOnlyTransportConfig({
            mode: 'testnet',
            apiKey: TEST_API_KEY,
            apiSecret: TEST_API_SECRET,
        })).toEqual({
            mode: 'testnet',
            environment: 'testnet',
            restBaseUrl: FUTURES_TESTNET_REST_BASE_URL,
            websocketBaseUrl: FUTURES_TESTNET_WEBSOCKET_BASE_URL,
            apiKey: TEST_API_KEY,
            apiSecret: TEST_API_SECRET,
        });

        const invalidConfigs = [
            undefined,
            {},
            { mode: 'production', apiKey: TEST_API_KEY, apiSecret: TEST_API_SECRET },
            { mode: 'testnet' },
            { mode: 'testnet', apiKey: TEST_API_KEY, apiSecret: TEST_API_SECRET, mockScenario: 'empty' },
            { mode: 'mock', apiKey: TEST_API_KEY, apiSecret: TEST_API_SECRET },
            { mode: 'mock', restBaseUrl: 'https://fapi.binance.com' },
        ];
        invalidConfigs.forEach((config) => {
            expect(() => resolveFuturesReadOnlyTransportConfig(config))
                .toThrow(FuturesReadOnlyTransportConfigError);
        });
    });

    it('exposes exactly the reviewed read methods on a frozen facade', () => {
        const transport = createFuturesReadOnlyTransport({ mode: 'mock' });

        expect(Object.keys(transport)).toEqual([
            'getExchangeInfo',
            'getMarkPrice',
            'getPositionRiskV3',
            'getBalanceV3',
            'getOpenOrders',
            'getOpenAlgoOrders',
            'subscribeMarkPrice',
        ]);
        expect(Object.isFrozen(transport)).toBe(true);
        expect(transport).not.toHaveProperty('client');
        expect(transport).not.toHaveProperty('request');
        expect(transport).not.toHaveProperty('placeOrder');
        expect(transport).not.toHaveProperty('cancelOrder');
        expect(transport).not.toHaveProperty('changeLeverage');
        expect(transport).not.toHaveProperty('changeMarginType');
        expect(transport).not.toHaveProperty('apiKey');
        expect(transport).not.toHaveProperty('apiSecret');
    });

    it('publishes the reviewed symbol-scoped request weights', () => {
        expect(FUTURES_READ_ONLY_REQUEST_WEIGHTS).toEqual({
            getExchangeInfo: 1,
            getMarkPrice: 1,
            getPositionRiskV3: 5,
            getBalanceV3: 5,
            getOpenOrders: 1,
            getOpenAlgoOrders: 1,
        });
        expect(Object.isFrozen(FUTURES_READ_ONLY_REQUEST_WEIGHTS)).toBe(true);
    });

    it('rejects caller-controlled options and account-wide symbol fallbacks', async () => {
        const transport = createFuturesReadOnlyTransport({ mode: 'mock' });
        const invalidCalls = [
            () => transport.getExchangeInfo({ symbol: 'BTCUSDT' }),
            () => transport.getExchangeInfo({ signal: 'not-an-abort-signal' }),
            () => transport.getBalanceV3({ asset: 'USDT' }),
            () => transport.getMarkPrice(),
            () => transport.getMarkPrice({}),
            () => transport.getPositionRiskV3({ symbol: 'BTCUSDT', recvWindow: 60000 }),
            () => transport.getOpenOrders({ endpoint: '/fapi/v1/openOrders' }),
            () => transport.getOpenAlgoOrders({ symbol: '' }),
            () => transport.getOpenOrders({ symbol: 'btcusdt' }),
            () => transport.getOpenOrders({ symbol: 'BTCUSDT', signal: {} }),
            () => transport.getMarkPrice({ symbol: 'BTCUSDT/../listenKey' }),
        ];

        invalidCalls.forEach((operation) => {
            expect(operation).toThrow(FuturesReadOnlyTransportArgumentError);
        });

        await expect(transport.getOpenOrders({ symbol: 'BTCUSDT' })).resolves.toHaveLength(1);
    });
});

describe('deterministic futures read-only mock transport', () => {
    it('composes through FuturesTradingAdapter without credentials or network access', async () => {
        const fetchImpl = vi.fn(() => {
            throw new Error('Mock mode must not use fetch');
        });
        class ForbiddenWebSocket {
            constructor() {
                throw new Error('Mock mode must not create a WebSocket');
            }
        }
        const transport = createFuturesReadOnlyTransport({ mode: 'mock' }, {
            fetchImpl,
            WebSocketImpl: ForbiddenWebSocket,
        });
        const adapter = new FuturesTradingAdapter({ transport });

        await expect(adapter.getExchangeInfo('BTCUSDT')).resolves.toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            filters: {
                minimumNotional: '5.00000000',
            },
        });
        await expect(adapter.getMarkPrice('BTCUSDT')).resolves.toMatchObject({
            markPrice: '58420.12500000',
            indexPrice: '58418.98765432',
        });
        await expect(adapter.getFundingState('BTCUSDT')).resolves.toMatchObject({
            lastFundingRate: '-0.00012500',
            nextFundingTime: 1783814400000,
        });
        await expect(adapter.getPositionRisk('BTCUSDT', 'BOTH')).resolves.toMatchObject({
            unRealizedProfit: '52.51562500',
            liquidationPrice: '42125.50000000',
        });
        await expect(adapter.getAccountBalance('USDT')).resolves.toMatchObject({
            balance: '12500.00000000',
            availableBalance: '11717.23281250',
        });
        await expect(adapter.getOpenOrders('BTCUSDT')).resolves.toHaveLength(1);
        await expect(adapter.getAlgoOpenOrders('BTCUSDT')).resolves.toHaveLength(1);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('covers hedge legs, empty current state, positive/negative PnL, and zero values', async () => {
        const hedge = createFuturesReadOnlyTransport({
            mode: 'mock',
            mockScenario: FUTURES_READ_ONLY_MOCK_SCENARIOS.HEDGE,
        });
        const empty = createFuturesReadOnlyTransport({
            mode: 'mock',
            mockScenario: FUTURES_READ_ONLY_MOCK_SCENARIOS.EMPTY,
        });

        await expect(hedge.getPositionRiskV3({ symbol: 'BTCUSDT' })).resolves.toMatchObject([
            { positionSide: 'LONG', unRealizedProfit: '184.02500000' },
            { positionSide: 'SHORT', unRealizedProfit: '-39.00937500' },
        ]);
        await expect(empty.getPositionRiskV3({ symbol: 'BTCUSDT' })).resolves.toEqual([]);
        await expect(empty.getOpenOrders({ symbol: 'BTCUSDT' })).resolves.toEqual([]);
        await expect(empty.getOpenAlgoOrders({ symbol: 'BTCUSDT' })).resolves.toEqual([]);
        await expect(empty.getBalanceV3()).resolves.toMatchObject([{
            balance: '0.00000000',
            crossUnPnl: '-0.00000000',
            marginAvailable: false,
            updateTime: 0,
        }]);
    });

    it('returns fresh fixture graphs on every read', async () => {
        const fixture = getFuturesReadOnlyMockFixture({
            scenario: 'one-way',
            resource: FUTURES_READ_ONLY_MOCK_RESOURCES.POSITION_RISK_V3,
        });
        const fixtureAgain = getFuturesReadOnlyMockFixture({
            scenario: 'one-way',
            resource: FUTURES_READ_ONLY_MOCK_RESOURCES.POSITION_RISK_V3,
        });
        const fixtureSet = createFuturesReadOnlyMockFixtureSet('one-way');

        fixture[0].unRealizedProfit = 'mutated';
        fixtureSet.markPrice.markPrice = 'mutated';
        expect(fixtureAgain[0].unRealizedProfit).toBe('52.51562500');
        expect(createFuturesReadOnlyMockFixtureSet('one-way').markPrice.markPrice)
            .toBe('58420.12500000');

        const transport = createFuturesReadOnlyTransport({ mode: 'mock' });
        const first = await transport.getOpenOrders({ symbol: 'BTCUSDT' });
        first[0].clientOrderId = 'mutated';
        await expect(transport.getOpenOrders({ symbol: 'BTCUSDT' })).resolves.toMatchObject([{
            clientOrderId: 'mock-current-order-000001',
        }]);
    });

    it('provides deterministic structured failure fixtures', async () => {
        const transport = createFuturesReadOnlyTransport({
            mode: 'mock',
            mockScenario: FUTURES_READ_ONLY_MOCK_SCENARIOS.FAILURE,
        });

        try {
            await transport.getPositionRiskV3({ symbol: 'BTCUSDT' });
            throw new Error('Expected deterministic mock failure');
        } catch (error) {
            expect(error).toBeInstanceOf(FuturesReadOnlyUpstreamError);
            expect(error.code).toBe(-1001);
            expect(error.status).toBe(503);
            expect(error.operation).toBe('getPositionRiskV3');
            expect(error.body).toEqual({
                code: -1001,
                msg: 'Deterministic mock positionRiskV3 failure',
            });
        }
    });
});

describe('Binance futures testnet REST transport', () => {
    it('uses exact public paths and symbol parameters', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(createJsonResponse({}));
        const transport = createTestnetTransport({ fetchImpl });

        await transport.getExchangeInfo();
        await transport.getMarkPrice({ symbol: 'BTCUSDT' });

        expect(fetchImpl.mock.calls).toEqual([
            [
                'https://demo-fapi.binance.com/fapi/v1/exchangeInfo',
                { method: 'GET' },
            ],
            [
                'https://demo-fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT',
                { method: 'GET' },
            ],
        ]);
    });

    it('signs exact symbol-scoped account reads with HMAC SHA256 and recvWindow 5000', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(createJsonResponse([]));
        const transport = createTestnetTransport({ fetchImpl });

        await transport.getPositionRiskV3({ symbol: 'BTCUSDT' });
        await transport.getBalanceV3();
        await transport.getOpenOrders({ symbol: 'BTCUSDT' });
        await transport.getOpenAlgoOrders({ symbol: 'BTCUSDT' });

        const symbolQuery = `symbol=BTCUSDT&recvWindow=${FUTURES_SIGNED_RECV_WINDOW}&timestamp=${TEST_TIMESTAMP}`;
        const accountQuery = `recvWindow=${FUTURES_SIGNED_RECV_WINDOW}&timestamp=${TEST_TIMESTAMP}`;
        const signedOptions = {
            method: 'GET',
            headers: { 'X-MBX-APIKEY': TEST_API_KEY },
        };
        expect(fetchImpl.mock.calls).toEqual([
            [
                `${FUTURES_TESTNET_REST_BASE_URL}/fapi/v3/positionRisk?${symbolQuery}&signature=${sign(symbolQuery)}`,
                signedOptions,
            ],
            [
                `${FUTURES_TESTNET_REST_BASE_URL}/fapi/v3/balance?${accountQuery}&signature=${sign(accountQuery)}`,
                signedOptions,
            ],
            [
                `${FUTURES_TESTNET_REST_BASE_URL}/fapi/v1/openOrders?${symbolQuery}&signature=${sign(symbolQuery)}`,
                signedOptions,
            ],
            [
                `${FUTURES_TESTNET_REST_BASE_URL}/fapi/v1/openAlgoOrders?${symbolQuery}&signature=${sign(symbolQuery)}`,
                signedOptions,
            ],
        ]);

        fetchImpl.mock.calls.forEach(([url, options]) => {
            expect(url).not.toContain(TEST_API_SECRET);
            expect(JSON.stringify(options)).not.toContain(TEST_API_SECRET);
        });
    });

    it('preserves network and response-body failure identity internally', async () => {
        const networkError = new Error('ECONNRESET');
        const networkTransport = createTestnetTransport({
            fetchImpl: vi.fn().mockRejectedValue(networkError),
        });
        await expect(networkTransport.getMarkPrice({ symbol: 'BTCUSDT' }))
            .rejects.toBe(networkError);

        const body = { code: -2015, msg: 'Invalid API-key, IP, or permissions.' };
        const responseTransport = createTestnetTransport({
            fetchImpl: vi.fn().mockResolvedValue(createJsonResponse(body, {
                ok: false,
                status: 401,
            })),
        });
        try {
            await responseTransport.getBalanceV3();
            throw new Error('Expected upstream body failure');
        } catch (error) {
            expect(error).toBeInstanceOf(FuturesReadOnlyUpstreamError);
            expect(error.code).toBe(-2015);
            expect(error.upstreamCode).toBe(-2015);
            expect(error.status).toBe(401);
            expect(error.body).toBe(body);
            expect(error.operation).toBe('getBalanceV3');
            expect(error.message).not.toContain(body.msg);
            expect(JSON.stringify(error)).not.toContain(TEST_API_SECRET);
        }

        const bodyError = { code: -1003, msg: 'Too many requests.' };
        const bodyErrorTransport = createTestnetTransport({
            fetchImpl: vi.fn().mockResolvedValue(createJsonResponse(bodyError)),
        });
        await expect(bodyErrorTransport.getExchangeInfo()).rejects.toMatchObject({
            code: -1003,
            status: 200,
            body: bodyError,
        });
    });

    it('preserves JSON decoding error identity', async () => {
        const decodingError = new SyntaxError('invalid upstream JSON');
        const transport = createTestnetTransport({
            fetchImpl: vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: vi.fn().mockRejectedValue(decodingError),
            }),
        });

        await expect(transport.getExchangeInfo()).rejects.toBe(decodingError);
    });

    it('forwards only the reviewed AbortSignal to fetch and rejects pre-aborted reads', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(createJsonResponse({}));
        const transport = createTestnetTransport({ fetchImpl });
        const controller = new AbortController();

        await transport.getMarkPrice({ symbol: 'BTCUSDT', signal: controller.signal });
        expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
            'https://demo-fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT',
            { method: 'GET', signal: controller.signal },
        );

        const abortError = Object.assign(new Error('owned teardown'), {
            name: 'AbortError',
            code: 'ABORT_ERR',
        });
        controller.abort(abortError);
        await expect(transport.getBalanceV3({ signal: controller.signal }))
            .rejects.toBe(abortError);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('rejects unsafe signing timestamps before fetch', async () => {
        const fetchImpl = vi.fn();
        const transport = createTestnetTransport({
            fetchImpl,
            now: () => Number.MAX_SAFE_INTEGER + 1,
        });

        await expect(transport.getBalanceV3()).rejects.toMatchObject({
            code: FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_TIMESTAMP,
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('futures mark-price stream transport', () => {
    it('opens the exact testnet stream and forwards exact parsed events and raw errors', () => {
        FakeWebSocket.instances = [];
        const onMessage = vi.fn();
        const onError = vi.fn();
        const onClose = vi.fn();
        const onOpen = vi.fn();
        const transport = createTestnetTransport({ WebSocketImpl: FakeWebSocket });
        const connection = transport.subscribeMarkPrice({
            symbol: 'BTCUSDT',
            onMessage,
            onError,
            onClose,
            onOpen,
        });
        const socket = FakeWebSocket.instances[0];
        const event = {
            e: 'markPriceUpdate',
            E: 1783810801000,
            s: 'BTCUSDT',
            p: '58421.25000000',
            i: '58419.12500000',
            P: '58419.00000000',
            r: '-0.00012500',
            T: 1783814400000,
        };

        expect(socket.url).toBe(
            'wss://demo-fstream.binance.com/ws/btcusdt@markPrice@1s',
        );
        const openEvent = { type: 'open' };
        socket.emit('open', openEvent);
        socket.emit('message', JSON.stringify(event));
        expect(onOpen).toHaveBeenCalledWith(openEvent);
        expect(onMessage).toHaveBeenCalledWith(event);

        const rawError = new Error('raw websocket failure');
        socket.emit('error', rawError);
        expect(onError).toHaveBeenCalledWith(rawError);

        const closeReason = Buffer.from('remote close');
        socket.emit('close', 1006, closeReason);
        expect(onClose).toHaveBeenCalledWith(1006, closeReason);

        connection.close();
        expect(socket.closeCalls).toBe(0);
    });

    it('reports raw JSON parse errors and typed malformed-event errors without delivery', () => {
        FakeWebSocket.instances = [];
        const onMessage = vi.fn();
        const onError = vi.fn();
        const transport = createTestnetTransport({ WebSocketImpl: FakeWebSocket });
        transport.subscribeMarkPrice({ symbol: 'BTCUSDT', onMessage, onError });
        const socket = FakeWebSocket.instances[0];

        socket.emit('message', '{');
        expect(onError.mock.calls[0][0]).toBeInstanceOf(SyntaxError);

        socket.emit('message', JSON.stringify({
            e: 'markPriceUpdate',
            E: 1783810801000,
            s: 'ETHUSDT',
            p: '1.0',
            i: '1.0',
            P: '1.0',
            r: '0.0',
            T: 1783814400000,
        }));
        expect(onError.mock.calls[1][0]).toBeInstanceOf(FuturesReadOnlyStreamError);
        expect(onError.mock.calls[1][0].code).toBe(
            FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_STREAM_EVENT,
        );
        expect(onMessage).not.toHaveBeenCalled();
    });

    it('does not misclassify consumer callback exceptions as transport errors', () => {
        FakeWebSocket.instances = [];
        const callbackError = new Error('consumer callback failed');
        const onError = vi.fn();
        const transport = createTestnetTransport({ WebSocketImpl: FakeWebSocket });
        transport.subscribeMarkPrice({
            symbol: 'BTCUSDT',
            onMessage: () => {
                throw callbackError;
            },
            onError,
        });
        const socket = FakeWebSocket.instances[0];
        const messageEvent = Object.create({ eventType: 'message' });
        messageEvent.data = JSON.stringify({
            e: 'markPriceUpdate',
            E: 1783810801000,
            s: 'BTCUSDT',
            p: '58421.25000000',
            i: '58419.12500000',
            P: '58419.00000000',
            r: '-0.00012500',
            T: 1783814400000,
        });

        expect(() => socket.emit('message', messageEvent)).toThrow(callbackError);
        expect(onError).not.toHaveBeenCalled();
    });

    it('tears down listeners and suppresses late delivery after explicit close', () => {
        FakeWebSocket.instances = [];
        const onMessage = vi.fn();
        const onError = vi.fn();
        const onClose = vi.fn();
        const transport = createTestnetTransport({ WebSocketImpl: FakeWebSocket });
        const connection = transport.subscribeMarkPrice({
            symbol: 'BTCUSDT',
            onMessage,
            onError,
            onClose,
        });
        const socket = FakeWebSocket.instances[0];

        connection.close();
        socket.emit('message', JSON.stringify({}));
        socket.emit('error', new Error('late'));
        socket.emit('close', 1000, Buffer.from('local close'));

        expect(socket.closeCalls).toBe(1);
        expect(onMessage).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect([...socket.listeners.values()].every((listeners) => listeners.size === 0))
            .toBe(true);
    });

    it('delivers a recurring 1s mock stream from the injected clock and tears down its timer', async () => {
        const queued = [];
        const scheduled = [];
        let clock = 1_783_810_801_000;
        const onMessage = vi.fn();
        const onOpen = vi.fn();
        const transport = createFuturesReadOnlyTransport({ mode: 'mock' }, {
            queueMicrotaskImpl: (callback) => queued.push(callback),
            now: () => clock,
            setTimeoutFn: (callback, delay) => {
                const timer = { callback, delay, cleared: false };
                scheduled.push(timer);
                return timer;
            },
            clearTimeoutFn: (timer) => {
                timer.cleared = true;
            },
        });
        const connection = transport.subscribeMarkPrice({
            symbol: 'BTCUSDT',
            onMessage,
            onOpen,
        });

        expect(queued).toHaveLength(1);
        connection.close();
        queued[0]();
        expect(onOpen).not.toHaveBeenCalled();
        expect(onMessage).not.toHaveBeenCalled();

        const second = transport.subscribeMarkPrice({ symbol: 'BTCUSDT', onMessage });
        queued[1]();
        expect(onMessage).toHaveBeenCalledWith({
            e: 'markPriceUpdate',
            E: 1783810801000,
            s: 'BTCUSDT',
            p: '58421.25000000',
            i: '58419.12500000',
            P: '58419.00000000',
            r: '-0.00012500',
            T: 1783814400000,
        });
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].delay).toBe(1_000);

        clock += 1_000;
        scheduled[0].callback();
        expect(onMessage).toHaveBeenLastCalledWith(expect.objectContaining({
            E: 1_783_810_802_000,
            T: 1_783_814_400_000,
        }));
        expect(scheduled).toHaveLength(2);

        second.close();
        expect(scheduled[1].cleared).toBe(true);
        scheduled[1].callback();
        expect(onMessage).toHaveBeenCalledTimes(2);
    });

    it('rejects arbitrary stream options and missing callbacks', () => {
        const transport = createFuturesReadOnlyTransport({ mode: 'mock' });
        const invalidOptions = [
            { symbol: 'BTCUSDT' },
            { symbol: '', onMessage: vi.fn() },
            { symbol: 'BTCUSDT', onMessage: vi.fn(), endpoint: 'markPrice' },
            { symbol: 'BTCUSDT', onMessage: vi.fn(), onError: true },
        ];

        invalidOptions.forEach((options) => {
            expect(() => transport.subscribeMarkPrice(options))
                .toThrow(FuturesReadOnlyTransportArgumentError);
        });
    });
});
