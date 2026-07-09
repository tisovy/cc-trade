import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const moduleMocks = vi.hoisted(() => {
    const state = {};

    const makeSocket = () => {
        const handlers = {};
        return {
            handlers,
            on: vi.fn((event, handler) => {
                handlers[event] = handler;
            }),
            disconnect: vi.fn().mockResolvedValue(undefined),
        };
    };

    const reset = () => {
        state.websocketServerHandlers = {};
        state.rendererHandlers = {};
        state.marketSocket = makeSocket();
        state.userDataSocket = makeSocket();
        state.userDataConnection = Promise.resolve(state.userDataSocket);
        state.httpServer = {
            listen: vi.fn((port, host, callback) => callback?.()),
            close: vi.fn(),
        };
        state.websocketServer = {
            on: vi.fn((event, handler) => {
                state.websocketServerHandlers[event] = handler;
            }),
        };
        state.sendRequest = vi.fn(async (path, method) => ({
            data: vi.fn().mockResolvedValue(
                path === '/api/v3/time' && method === 'GET'
                    ? { serverTime: Date.now() }
                    : path === '/api/v3/userDataStream' && method === 'POST'
                        ? { listenKey: 'listen-key-123' }
                        : {},
            ),
        }));
        state.connect = vi.fn(({ stream }) => (
            stream === '!miniTicker@arr'
                ? Promise.resolve(state.marketSocket)
                : state.userDataConnection
        ));
        state.spotClient = {
            restAPI: {
                configuration: { baseOptions: { headers: {} } },
                axiosInstance: {
                    interceptors: {
                        request: { use: vi.fn() },
                    },
                },
                sendRequest: state.sendRequest,
                ticker24hr: vi.fn().mockResolvedValue({
                    data: vi.fn().mockResolvedValue([]),
                }),
            },
            websocketStreams: { connect: state.connect },
        };
        state.rendererConnection = {
            connected: true,
            remoteAddress: '127.0.0.1',
            sendUTF: vi.fn(),
            close: vi.fn(() => {
                state.rendererConnection.connected = false;
                state.rendererHandlers.close?.();
            }),
            on: vi.fn((event, handler) => {
                state.rendererHandlers[event] = handler;
            }),
        };
    };

    const createHttpServer = vi.fn(() => state.httpServer);
    const WebSocketServer = vi.fn(function MockWebSocketServer() {
        return state.websocketServer;
    });
    const Spot = vi.fn(function MockSpot() {
        return state.spotClient;
    });

    reset();

    return {
        Spot,
        WebSocketServer,
        createHttpServer,
        makeSocket,
        reset,
        setUserDataConnection: (connection) => {
            state.userDataConnection = connection;
        },
        get connect() { return state.connect; },
        get httpServer() { return state.httpServer; },
        get marketSocket() { return state.marketSocket; },
        get rendererConnection() { return state.rendererConnection; },
        get rendererHandlers() { return state.rendererHandlers; },
        get sendRequest() { return state.sendRequest; },
        get spotClient() { return state.spotClient; },
        get userDataSocket() { return state.userDataSocket; },
        get websocketServer() { return state.websocketServer; },
        get websocketServerHandlers() { return state.websocketServerHandlers; },
    };
});

vi.mock('http', () => ({
    default: { createServer: moduleMocks.createHttpServer },
}));

vi.mock('websocket', () => ({
    server: moduleMocks.WebSocketServer,
}));

vi.mock('@binance/spot', () => ({
    Spot: moduleMocks.Spot,
}));

vi.mock('./local-websocket-access.js', () => ({
    LOCAL_WEBSOCKET_HOST: '127.0.0.1',
    createLocalWebSocketAccess: vi.fn(() => ({ host: '127.0.0.1' })),
    validateLocalWebSocketRequest: vi.fn(() => ({ allowed: true })),
}));

const flushMicrotasks = async () => {
    for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
    }
};

describe('setupBinanceConnection user-data orchestration', () => {
    let originalConsoleLog;
    let originalStdoutWrite;
    let originalStderrWrite;
    let setupBinanceConnection;
    let SpotTradingAdapter;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        moduleMocks.reset();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-09T10:00:00.000Z'));
        vi.stubEnv('BK', 'test-api-key');
        vi.stubEnv('BS', 'test-api-secret');
        vi.stubEnv('WS_PORT', '14477');
        vi.stubEnv('LOG_LEVEL', 'info');
        vi.stubEnv('https_proxy', '');
        vi.stubEnv('HTTPS_PROXY', '');
        vi.stubEnv('http_proxy', '');
        vi.stubEnv('HTTP_PROXY', '');

        originalConsoleLog = console.log;
        originalStdoutWrite = process.stdout.write;
        originalStderrWrite = process.stderr.write;
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        ({ setupBinanceConnection } = await import('./binance-connection.js'));
        ({ SpotTradingAdapter } = await import('./spot-trading-adapter.js'));
    });

    afterEach(async () => {
        moduleMocks.rendererHandlers.close?.();
        await flushMicrotasks();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        console.log = originalConsoleLog;
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    });

    it('connects live user data and coalesces adapter-owned stream refreshes', async () => {
        let resolveUserDataConnection;
        const userDataConnectionPromise = new Promise((resolve) => {
            resolveUserDataConnection = resolve;
        });
        moduleMocks.setUserDataConnection(userDataConnectionPromise);

        let resolveInitialBalancePayload;
        let resolveStreamBalancePayload;
        const initialBalancePayload = {
            balances: {
                USDT: { available: '100.00', onOrder: '5.00' },
            },
        };
        const streamBalancePayload = {
            balances: {
                USDT: { available: '103.00', onOrder: '5.00' },
            },
        };
        const initialBalancePayloadPromise = new Promise((resolve) => {
            resolveInitialBalancePayload = resolve;
        });
        const streamBalancePayloadPromise = new Promise((resolve) => {
            resolveStreamBalancePayload = resolve;
        });
        const loadBalancePayload = vi.fn()
            .mockImplementationOnce(() => initialBalancePayloadPromise)
            .mockImplementationOnce(() => streamBalancePayloadPromise);
        const loadOpenOrdersPayload = vi.fn();
        const initialWeightValueOf = vi.fn(() => 10);
        const streamWeightValueOf = vi.fn(() => 10);
        const initialWeight = { valueOf: initialWeightValueOf };
        const streamWeight = { valueOf: streamWeightValueOf };
        const readBalanceWeight = vi.fn()
            .mockReturnValueOnce(initialWeight)
            .mockReturnValueOnce(streamWeight);
        const balanceOperation = {
            type: 'balances',
            get weight() {
                return readBalanceWeight();
            },
            loadPayload: loadBalancePayload,
        };
        const openOrdersOperation = {
            type: 'openOrders',
            weight: 3,
            loadPayload: loadOpenOrdersPayload,
        };
        const createListenKey = vi.spyOn(
            SpotTradingAdapter.prototype,
            'createUserDataStreamListenKey',
        );
        const connectUserDataStream = vi.spyOn(
            SpotTradingAdapter.prototype,
            'connectUserDataStream',
        );
        const getAccountRefreshOperations = vi.spyOn(
            SpotTradingAdapter.prototype,
            'getAccountRefreshOperations',
        ).mockReturnValue([openOrdersOperation, balanceOperation]);

        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });

        const request = {
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        };
        moduleMocks.websocketServerHandlers.request(request);

        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(500);
        await flushMicrotasks();

        expect(createListenKey).toHaveBeenCalledOnce();
        expect(moduleMocks.sendRequest).toHaveBeenCalledWith(
            '/api/v3/userDataStream',
            'POST',
        );
        expect(connectUserDataStream).toHaveBeenCalledOnce();
        expect(connectUserDataStream).toHaveBeenCalledWith('listen-key-123');
        expect(connectUserDataStream.mock.results[0].value).toBe(userDataConnectionPromise);
        expect(moduleMocks.connect).toHaveBeenCalledWith({ stream: 'listen-key-123' });
        expect(moduleMocks.userDataSocket.on).not.toHaveBeenCalled();
        expect(getAccountRefreshOperations).not.toHaveBeenCalled();
        expect(loadBalancePayload).not.toHaveBeenCalled();

        resolveUserDataConnection(moduleMocks.userDataSocket);
        await flushMicrotasks();

        expect(moduleMocks.userDataSocket.on).toHaveBeenNthCalledWith(
            1,
            'message',
            expect.any(Function),
        );
        expect(moduleMocks.userDataSocket.on).toHaveBeenNthCalledWith(
            2,
            'error',
            expect.any(Function),
        );
        expect(moduleMocks.userDataSocket.on).toHaveBeenNthCalledWith(
            3,
            'close',
            expect.any(Function),
        );

        expect(getAccountRefreshOperations).toHaveBeenCalledOnce();
        expect(getAccountRefreshOperations).toHaveBeenCalledWith();
        expect(readBalanceWeight).toHaveBeenCalledOnce();
        expect(readBalanceWeight).toHaveNthReturnedWith(1, initialWeight);
        expect(initialWeightValueOf).toHaveBeenCalledOnce();
        expect(initialWeightValueOf).toHaveReturnedWith(10);
        expect(loadBalancePayload).toHaveBeenCalledOnce();
        expect(loadOpenOrdersPayload).not.toHaveBeenCalled();
        expect(initialWeightValueOf.mock.invocationCallOrder[0]).toBeLessThan(
            loadBalancePayload.mock.invocationCallOrder[0],
        );
        expect(moduleMocks.rendererConnection.sendUTF).not.toHaveBeenCalled();

        resolveInitialBalancePayload(initialBalancePayload);
        await flushMicrotasks();

        expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledOnce();
        expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenNthCalledWith(
            1,
            JSON.stringify(initialBalancePayload),
        );

        moduleMocks.userDataSocket.handlers.message(JSON.stringify({
            e: 'balanceUpdate',
            a: 'USDT',
            d: '1.00',
        }));
        moduleMocks.userDataSocket.handlers.message(JSON.stringify({
            e: 'balanceUpdate',
            a: 'USDT',
            d: '2.00',
        }));
        await flushMicrotasks();

        expect(getAccountRefreshOperations).toHaveBeenCalledTimes(2);
        expect(readBalanceWeight).toHaveBeenCalledTimes(2);
        expect(readBalanceWeight).toHaveNthReturnedWith(2, streamWeight);
        expect(streamWeightValueOf).toHaveBeenCalledOnce();
        expect(streamWeightValueOf).toHaveReturnedWith(10);
        expect(loadBalancePayload).toHaveBeenCalledOnce();
        expect(loadOpenOrdersPayload).not.toHaveBeenCalled();
        expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(500);
        await flushMicrotasks();

        expect(loadBalancePayload).toHaveBeenCalledTimes(2);
        expect(streamWeightValueOf.mock.invocationCallOrder[0]).toBeLessThan(
            loadBalancePayload.mock.invocationCallOrder[1],
        );
        expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledOnce();

        resolveStreamBalancePayload(streamBalancePayload);
        await flushMicrotasks();

        expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledTimes(2);
        expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenNthCalledWith(
            2,
            JSON.stringify(streamBalancePayload),
        );
    });

    it('retries failed user-data connections at exact service boundaries', async () => {
        const retryDelays = [3000, 6000, 9000, 12000, 15000];
        const listenKeys = Array.from(
            { length: retryDelays.length + 1 },
            (_, index) => `retry-listen-key-${index + 1}`,
        );
        const lifecycle = [];
        const attemptTimes = [];
        let nextListenKeyIndex = 0;

        moduleMocks.sendRequest.mockImplementation(async (path, method) => {
            if (path === '/api/v3/time' && method === 'GET') {
                return {
                    data: vi.fn().mockResolvedValue({ serverTime: Date.now() }),
                };
            }

            if (path === '/api/v3/userDataStream' && method === 'POST') {
                const listenKey = listenKeys[nextListenKeyIndex];
                nextListenKeyIndex += 1;
                lifecycle.push(`create:${listenKey}`);
                return {
                    data: vi.fn().mockResolvedValue({ listenKey }),
                };
            }

            return { data: vi.fn().mockResolvedValue({}) };
        });

        const createListenKey = vi.spyOn(
            SpotTradingAdapter.prototype,
            'createUserDataStreamListenKey',
        );
        const connectUserDataStream = vi.spyOn(
            SpotTradingAdapter.prototype,
            'connectUserDataStream',
        ).mockImplementation((listenKey) => {
            lifecycle.push(`connect:${listenKey}`);
            attemptTimes.push(Date.now());
            return Promise.reject(Object.assign(
                new Error('user-data socket reset'),
                { code: 'ECONNRESET' },
            ));
        });
        const getListenKeyRequests = () => moduleMocks.sendRequest.mock.calls.filter(
            ([path, method]) => (
                path === '/api/v3/userDataStream' && method === 'POST'
            ),
        );

        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });

        const request = {
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        };
        moduleMocks.websocketServerHandlers.request(request);

        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(500);
        await flushMicrotasks();

        expect(moduleMocks.marketSocket.handlers.message).toEqual(expect.any(Function));
        expect(moduleMocks.connect).toHaveBeenCalledOnce();
        expect(moduleMocks.connect).toHaveBeenCalledWith({ stream: '!miniTicker@arr' });
        expect(createListenKey).toHaveBeenCalledOnce();
        expect(getListenKeyRequests()).toHaveLength(1);
        expect(connectUserDataStream).toHaveBeenCalledOnce();
        expect(connectUserDataStream).toHaveBeenNthCalledWith(1, listenKeys[0]);
        expect(moduleMocks.rendererConnection.connected).toBe(true);

        for (const [index, delay] of retryDelays.entries()) {
            // Keep the independent market-stream watchdog from reconnecting while
            // the cumulative user-data retry schedule crosses 45 seconds.
            moduleMocks.marketSocket.handlers.message('{}');

            await vi.advanceTimersByTimeAsync(delay - 1);
            await flushMicrotasks();

            expect(createListenKey).toHaveBeenCalledTimes(index + 1);
            expect(getListenKeyRequests()).toHaveLength(index + 1);
            expect(connectUserDataStream).toHaveBeenCalledTimes(index + 1);
            expect(moduleMocks.rendererConnection.connected).toBe(true);

            await vi.advanceTimersByTimeAsync(1);
            await flushMicrotasks();

            expect(createListenKey).toHaveBeenCalledTimes(index + 2);
            expect(getListenKeyRequests()).toHaveLength(index + 2);
            expect(connectUserDataStream).toHaveBeenCalledTimes(index + 2);
            expect(connectUserDataStream).toHaveBeenNthCalledWith(
                index + 2,
                listenKeys[index + 1],
            );
            expect(moduleMocks.rendererConnection.connected).toBe(true);
        }

        expect(connectUserDataStream.mock.calls.map(([listenKey]) => listenKey)).toEqual(
            listenKeys,
        );
        expect(lifecycle).toEqual(
            listenKeys.flatMap((listenKey) => [
                `create:${listenKey}`,
                `connect:${listenKey}`,
            ]),
        );
        for (let index = 0; index < listenKeys.length; index += 1) {
            expect(createListenKey.mock.invocationCallOrder[index]).toBeLessThan(
                connectUserDataStream.mock.invocationCallOrder[index],
            );
        }
        expect(
            attemptTimes.slice(1).map((time, index) => time - attemptTimes[index]),
        ).toEqual(retryDelays);

        const retryWarnings = console.warn.mock.calls
            .map(([message]) => message)
            .filter((message) => String(message).startsWith(
                'User Data Stream connection failed',
            ));
        expect(retryWarnings).toEqual(retryDelays.map(
            (delay, index) => (
                `User Data Stream connection failed (ECONNRESET), retrying in ${delay}ms (${index + 1}/5)`
            ),
        ));

        moduleMocks.marketSocket.handlers.message('{}');
        // A wrongly permitted sixth retry would use the next linear delay (18s),
        // so cross that boundary to make the no-seventh-attempt proof direct.
        await vi.advanceTimersByTimeAsync(
            retryDelays.at(-1) + retryDelays[0] + 1,
        );
        await flushMicrotasks();

        expect(createListenKey).toHaveBeenCalledTimes(6);
        expect(getListenKeyRequests()).toHaveLength(6);
        expect(connectUserDataStream).toHaveBeenCalledTimes(6);
        expect(moduleMocks.connect).toHaveBeenCalledOnce();
        expect(moduleMocks.rendererConnection.close).not.toHaveBeenCalled();
        expect(moduleMocks.rendererConnection.connected).toBe(true);
    });
});
