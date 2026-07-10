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

    it('replaces a prior user-data socket in teardown order and ignores its late close', async () => {
        const listenKeys = {
            a: 'replacement-listen-key-A',
            b: 'replacement-listen-key-B',
            c: 'replacement-listen-key-C',
        };
        const keepAliveDelay = 30 * 60 * 1000;
        const lifecycle = [];
        const socketA = moduleMocks.makeSocket();
        const socketB = moduleMocks.makeSocket();
        const socketC = moduleMocks.makeSocket();
        let nextListenKeyIndex = 0;
        let resolveListenKeyC;
        let resolveSocketBDisconnect;

        const listenKeyCResponse = new Promise((resolve) => {
            resolveListenKeyC = resolve;
        });
        const socketBDisconnect = new Promise((resolve) => {
            resolveSocketBDisconnect = resolve;
        });
        const readListenKeyCResponse = vi.fn(() => listenKeyCResponse);

        socketB.close = vi.fn().mockResolvedValue(undefined);
        socketB.disconnect.mockImplementation(() => {
            lifecycle.push('disconnect:B:start');
            return socketBDisconnect.then(() => {
                lifecycle.push('disconnect:B:resolved');
            });
        });

        const orderedListenKeys = [listenKeys.a, listenKeys.b, listenKeys.c];
        moduleMocks.sendRequest.mockImplementation(async (path, method) => {
            if (path === '/api/v3/time' && method === 'GET') {
                return {
                    data: vi.fn().mockResolvedValue({ serverTime: Date.now() }),
                };
            }

            if (path === '/api/v3/userDataStream' && method === 'POST') {
                const listenKey = orderedListenKeys[nextListenKeyIndex];
                nextListenKeyIndex += 1;
                lifecycle.push(`create:${listenKey}`);

                if (!listenKey) {
                    throw new Error('Unexpected user-data listen-key creation');
                }

                return {
                    data: listenKey === listenKeys.c
                        ? readListenKeyCResponse
                        : vi.fn().mockResolvedValue({ listenKey }),
                };
            }

            return { data: vi.fn().mockResolvedValue({}) };
        });

        const loadBalancePayload = vi.fn().mockResolvedValue({ balances: {} });
        vi.spyOn(
            SpotTradingAdapter.prototype,
            'getAccountRefreshOperations',
        ).mockReturnValue([{
            type: 'balances',
            weight: 10,
            loadPayload: loadBalancePayload,
        }]);

        const createListenKey = vi.spyOn(
            SpotTradingAdapter.prototype,
            'createUserDataStreamListenKey',
        );
        const connectUserDataStream = vi.spyOn(
            SpotTradingAdapter.prototype,
            'connectUserDataStream',
        ).mockImplementation((listenKey) => {
            lifecycle.push(`connect:${listenKey}`);

            if (listenKey === listenKeys.a) return Promise.resolve(socketA);
            if (listenKey === listenKeys.b) return Promise.resolve(socketB);
            if (listenKey === listenKeys.c) return Promise.resolve(socketC);
            return Promise.reject(new Error(`Unexpected user-data stream: ${listenKey}`));
        });
        const getListenKeyRequests = () => moduleMocks.sendRequest.mock.calls.filter(
            ([path, method]) => (
                path === '/api/v3/userDataStream' && method === 'POST'
            ),
        );

        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
        const getKeepAliveHandles = () => setIntervalSpy.mock.calls.flatMap(
            ([, delay], index) => (
                delay === keepAliveDelay
                    ? [setIntervalSpy.mock.results[index].value]
                    : []
            ),
        );
        const getClearCount = (handle) => clearIntervalSpy.mock.calls.filter(
            ([clearedHandle]) => Object.is(clearedHandle, handle),
        ).length;
        const getReconnectScheduleCount = () => console.info.mock.calls.filter(
            ([message]) => message === 'Scheduling User Data Stream reconnection...',
        ).length;

        try {
            setupBinanceConnection({
                localWebSocketAccess: { host: '127.0.0.1' },
            });

            const requestA = {
                origin: 'http://localhost:5174',
                accept: vi.fn(() => moduleMocks.rendererConnection),
            };
            moduleMocks.websocketServerHandlers.request(requestA);

            await flushMicrotasks();
            await vi.advanceTimersByTimeAsync(500);
            await flushMicrotasks();

            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);
            expect(connectUserDataStream).toHaveBeenCalledOnce();
            expect(connectUserDataStream).toHaveBeenNthCalledWith(1, listenKeys.a);
            expect(socketA.handlers.close).toEqual(expect.any(Function));
            expect(new Set([socketA, socketB, socketC])).toHaveProperty('size', 3);

            const [keepAliveA] = getKeepAliveHandles();
            expect(keepAliveA).toBeDefined();

            const oldReconnectBoundary = Date.now() + 5000;
            socketA.handlers.close();
            await flushMicrotasks();

            expect(getClearCount(keepAliveA)).toBe(1);
            expect(getReconnectScheduleCount()).toBe(1);

            moduleMocks.rendererConnection.close();
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.close).toHaveBeenCalledOnce();
            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(socketA.disconnect).not.toHaveBeenCalled();

            moduleMocks.rendererConnection.connected = true;
            const requestB = {
                origin: 'http://localhost:5174',
                accept: vi.fn(() => moduleMocks.rendererConnection),
            };
            moduleMocks.websocketServerHandlers.request(requestB);

            await flushMicrotasks();
            await vi.advanceTimersByTimeAsync(500);
            await flushMicrotasks();
            await vi.advanceTimersByTimeAsync(500);
            await flushMicrotasks();

            expect(createListenKey).toHaveBeenCalledTimes(2);
            expect(getListenKeyRequests()).toHaveLength(2);
            expect(connectUserDataStream).toHaveBeenCalledTimes(2);
            expect(connectUserDataStream).toHaveBeenNthCalledWith(2, listenKeys.b);
            expect(socketB.handlers.close).toEqual(expect.any(Function));
            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(moduleMocks.rendererConnection.close).toHaveBeenCalledOnce();

            const [, keepAliveB] = getKeepAliveHandles();
            expect(keepAliveB).toBeDefined();
            expect(keepAliveB).not.toBe(keepAliveA);
            expect(getClearCount(keepAliveB)).toBe(0);

            const rendererBPayload = {
                e: 'outboundAccountPosition',
                u: Date.now(),
                B: [{ a: 'USDT', f: '100.00', l: '0.00' }],
            };
            const sendsBeforeBMessage = moduleMocks.rendererConnection.sendUTF.mock.calls.length;
            socketB.handlers.message(JSON.stringify(rendererBPayload));

            expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledTimes(
                sendsBeforeBMessage + 1,
            );
            expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenLastCalledWith(
                JSON.stringify({ balance_update: rendererBPayload }),
            );

            const timeUntilOldReconnect = oldReconnectBoundary - Date.now();
            expect(timeUntilOldReconnect).toBeGreaterThan(1);

            await vi.advanceTimersByTimeAsync(timeUntilOldReconnect - 1);
            await flushMicrotasks();

            expect(createListenKey).toHaveBeenCalledTimes(2);
            expect(connectUserDataStream).toHaveBeenCalledTimes(2);
            expect(socketB.disconnect).not.toHaveBeenCalled();
            expect(getClearCount(keepAliveB)).toBe(0);

            await vi.advanceTimersByTimeAsync(1);
            await flushMicrotasks();

            expect(createListenKey).toHaveBeenCalledTimes(3);
            expect(getListenKeyRequests()).toHaveLength(3);
            expect(readListenKeyCResponse).toHaveBeenCalledOnce();
            expect(connectUserDataStream).toHaveBeenCalledTimes(2);
            expect(socketB.disconnect).not.toHaveBeenCalled();
            expect(socketB.close).not.toHaveBeenCalled();
            expect(getClearCount(keepAliveB)).toBe(0);
            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(moduleMocks.rendererConnection.close).toHaveBeenCalledOnce();

            resolveListenKeyC({ listenKey: listenKeys.c });
            await flushMicrotasks();

            expect(getClearCount(keepAliveB)).toBe(1);
            expect(socketB.disconnect).toHaveBeenCalledOnce();
            expect(socketB.close).not.toHaveBeenCalled();
            expect(connectUserDataStream).toHaveBeenCalledTimes(2);
            expect(getKeepAliveHandles()).toHaveLength(2);

            const clearBCallIndex = clearIntervalSpy.mock.calls.findIndex(
                ([handle]) => Object.is(handle, keepAliveB),
            );
            expect(clearBCallIndex).toBeGreaterThanOrEqual(0);
            expect(createListenKey.mock.invocationCallOrder[2]).toBeLessThan(
                clearIntervalSpy.mock.invocationCallOrder[clearBCallIndex],
            );
            expect(readListenKeyCResponse.mock.invocationCallOrder[0]).toBeLessThan(
                clearIntervalSpy.mock.invocationCallOrder[clearBCallIndex],
            );
            expect(clearIntervalSpy.mock.invocationCallOrder[clearBCallIndex]).toBeLessThan(
                socketB.disconnect.mock.invocationCallOrder[0],
            );

            await flushMicrotasks();
            expect(connectUserDataStream).toHaveBeenCalledTimes(2);
            expect(moduleMocks.rendererConnection.connected).toBe(true);

            resolveSocketBDisconnect();
            await flushMicrotasks();

            expect(connectUserDataStream).toHaveBeenCalledTimes(3);
            expect(connectUserDataStream).toHaveBeenNthCalledWith(3, listenKeys.c);
            expect(socketB.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
                connectUserDataStream.mock.invocationCallOrder[2],
            );
            expect(socketC.on).toHaveBeenCalledTimes(3);
            expect(socketC.on).toHaveBeenNthCalledWith(
                1,
                'message',
                expect.any(Function),
            );
            expect(socketC.on).toHaveBeenNthCalledWith(
                2,
                'error',
                expect.any(Function),
            );
            expect(socketC.on).toHaveBeenNthCalledWith(
                3,
                'close',
                expect.any(Function),
            );

            const [, , keepAliveC] = getKeepAliveHandles();
            expect(keepAliveC).toBeDefined();
            expect(keepAliveC).not.toBe(keepAliveB);
            expect(getClearCount(keepAliveC)).toBe(0);
            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(moduleMocks.rendererConnection.close).toHaveBeenCalledOnce();

            socketB.handlers.close();
            await flushMicrotasks();

            expect(getClearCount(keepAliveC)).toBe(0);
            expect(socketC.disconnect).not.toHaveBeenCalled();
            expect(createListenKey).toHaveBeenCalledTimes(3);
            expect(connectUserDataStream).toHaveBeenCalledTimes(3);

            await vi.advanceTimersByTimeAsync(5001);
            await flushMicrotasks();

            expect(getClearCount(keepAliveC)).toBe(0);
            expect(socketC.disconnect).not.toHaveBeenCalled();
            expect(createListenKey).toHaveBeenCalledTimes(3);
            expect(getListenKeyRequests()).toHaveLength(3);
            expect(connectUserDataStream).toHaveBeenCalledTimes(3);
            expect(getReconnectScheduleCount()).toBe(1);
            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(moduleMocks.rendererConnection.close).toHaveBeenCalledOnce();

            const rendererCPayload = {
                e: 'outboundAccountPosition',
                u: Date.now(),
                B: [{ a: 'USDT', f: '101.00', l: '0.00' }],
            };
            const sendsBeforeCMessage = moduleMocks.rendererConnection.sendUTF.mock.calls.length;
            socketC.handlers.message(JSON.stringify(rendererCPayload));

            expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledTimes(
                sendsBeforeCMessage + 1,
            );
            expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenLastCalledWith(
                JSON.stringify({ balance_update: rendererCPayload }),
            );
            expect(connectUserDataStream.mock.calls.map(([listenKey]) => listenKey)).toEqual([
                listenKeys.a,
                listenKeys.b,
                listenKeys.c,
            ]);
            expect(lifecycle).toEqual([
                `create:${listenKeys.a}`,
                `connect:${listenKeys.a}`,
                `create:${listenKeys.b}`,
                `connect:${listenKeys.b}`,
                `create:${listenKeys.c}`,
                'disconnect:B:start',
                'disconnect:B:resolved',
                `connect:${listenKeys.c}`,
            ]);
            expect(moduleMocks.connect.mock.calls).toEqual([
                [{ stream: '!miniTicker@arr' }],
                [{ stream: '!miniTicker@arr' }],
            ]);

            socketC.handlers.close();
            await flushMicrotasks();

            expect(getClearCount(keepAliveC)).toBe(1);
            expect(getReconnectScheduleCount()).toBe(2);
            expect(createListenKey).toHaveBeenCalledTimes(3);
            expect(connectUserDataStream).toHaveBeenCalledTimes(3);

            moduleMocks.rendererConnection.close();
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);

            await vi.advanceTimersByTimeAsync(5000);
            await flushMicrotasks();

            expect(createListenKey).toHaveBeenCalledTimes(3);
            expect(getListenKeyRequests()).toHaveLength(3);
            expect(connectUserDataStream).toHaveBeenCalledTimes(3);
        } finally {
            clearIntervalSpy.mockRestore();
            setIntervalSpy.mockRestore();
        }
    });

    it('renews only the active user-data listen key at the exact keep-alive boundary', async () => {
        const listenKeys = {
            stale: 'renewal-listen-key-stale',
            active: 'renewal-listen-key-active',
        };
        const keepAliveDelay = 30 * 60 * 1000;
        const marketWatchdogDelay = 15 * 1000;
        const staleSocket = moduleMocks.makeSocket();
        const activeSocket = moduleMocks.makeSocket();
        const orderedListenKeys = [listenKeys.stale, listenKeys.active];
        const renewalResponse = { data: vi.fn().mockResolvedValue({}) };
        let nextListenKeyIndex = 0;

        moduleMocks.sendRequest.mockImplementation(async (path, method) => {
            if (path === '/api/v3/time' && method === 'GET') {
                return {
                    data: vi.fn().mockResolvedValue({ serverTime: Date.now() }),
                };
            }

            if (path === '/api/v3/userDataStream' && method === 'POST') {
                const listenKey = orderedListenKeys[nextListenKeyIndex];
                nextListenKeyIndex += 1;

                if (!listenKey) {
                    throw new Error('Unexpected user-data listen-key creation');
                }

                return {
                    data: vi.fn().mockResolvedValue({ listenKey }),
                };
            }

            if (path === '/api/v3/userDataStream' && method === 'PUT') {
                return renewalResponse;
            }

            return { data: vi.fn().mockResolvedValue({}) };
        });

        moduleMocks.connect.mockImplementation(({ stream }) => {
            if (stream === '!miniTicker@arr') {
                return Promise.resolve(moduleMocks.marketSocket);
            }
            if (stream === listenKeys.stale) return Promise.resolve(staleSocket);
            if (stream === listenKeys.active) return Promise.resolve(activeSocket);
            return Promise.reject(new Error(`Unexpected Binance stream: ${stream}`));
        });

        vi.spyOn(
            SpotTradingAdapter.prototype,
            'getAccountRefreshOperations',
        ).mockReturnValue([{
            type: 'balances',
            weight: 10,
            loadPayload: vi.fn().mockResolvedValue({ balances: {} }),
        }]);

        const createListenKey = vi.spyOn(
            SpotTradingAdapter.prototype,
            'createUserDataStreamListenKey',
        );
        const connectUserDataStream = vi.spyOn(
            SpotTradingAdapter.prototype,
            'connectUserDataStream',
        );
        const renewListenKey = vi.spyOn(
            SpotTradingAdapter.prototype,
            'renewUserDataStreamListenKey',
        );
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
        const getIntervalHandles = (delay) => setIntervalSpy.mock.calls.flatMap(
            ([, intervalDelay], index) => (
                intervalDelay === delay
                    ? [setIntervalSpy.mock.results[index].value]
                    : []
            ),
        );
        const getClearCount = (handle) => clearIntervalSpy.mock.calls.filter(
            ([clearedHandle]) => Object.is(clearedHandle, handle),
        ).length;
        const getActiveKeepAliveHandles = () => getIntervalHandles(keepAliveDelay).filter(
            (handle) => getClearCount(handle) === 0,
        );
        const getRenewalRequests = () => moduleMocks.sendRequest.mock.calls.filter(
            ([path, method]) => path === '/api/v3/userDataStream' && method === 'PUT',
        );
        const getMarketStreamCalls = () => moduleMocks.connect.mock.calls.filter(
            ([{ stream }]) => stream === '!miniTicker@arr',
        );
        const getUserDataStreamCalls = () => moduleMocks.connect.mock.calls.filter(
            ([{ stream }]) => Object.values(listenKeys).includes(stream),
        );

        try {
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
            expect(connectUserDataStream).toHaveBeenCalledOnce();
            expect(connectUserDataStream).toHaveBeenCalledWith(listenKeys.stale);
            expect(new Set([
                moduleMocks.marketSocket,
                staleSocket,
                activeSocket,
            ])).toHaveProperty('size', 3);

            const [staleKeepAlive] = getIntervalHandles(keepAliveDelay);
            expect(staleKeepAlive).toBeDefined();
            expect(getActiveKeepAliveHandles()).toEqual([staleKeepAlive]);

            staleSocket.handlers.close();
            await flushMicrotasks();

            expect(getClearCount(staleKeepAlive)).toBe(1);
            expect(getActiveKeepAliveHandles()).toEqual([]);
            expect(renewListenKey).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(5000);
            await flushMicrotasks();

            expect(createListenKey).toHaveBeenCalledTimes(2);
            expect(connectUserDataStream).toHaveBeenCalledTimes(2);
            expect(connectUserDataStream).toHaveBeenNthCalledWith(2, listenKeys.active);
            expect(activeSocket.handlers.close).toEqual(expect.any(Function));

            const keepAliveHandles = getIntervalHandles(keepAliveDelay);
            expect(keepAliveHandles).toHaveLength(2);
            const [, activeKeepAlive] = keepAliveHandles;
            expect(activeKeepAlive).toBeDefined();
            expect(activeKeepAlive).not.toBe(staleKeepAlive);
            expect(getActiveKeepAliveHandles()).toEqual([activeKeepAlive]);

            const [marketWatchdog] = getIntervalHandles(marketWatchdogDelay);
            expect(getIntervalHandles(marketWatchdogDelay)).toHaveLength(1);
            expect(marketWatchdog).toBeDefined();
            clearInterval(marketWatchdog);
            expect(getClearCount(marketWatchdog)).toBe(1);

            const activeKeepAliveBoundary = Date.now() + keepAliveDelay;
            await vi.advanceTimersByTimeAsync(keepAliveDelay - 1);
            await flushMicrotasks();

            expect(Date.now()).toBe(activeKeepAliveBoundary - 1);
            expect(renewListenKey).not.toHaveBeenCalled();
            expect(getRenewalRequests()).toEqual([]);
            expect(getActiveKeepAliveHandles()).toEqual([activeKeepAlive]);
            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(moduleMocks.rendererConnection.close).not.toHaveBeenCalled();
            expect(getMarketStreamCalls()).toEqual([
                [{ stream: '!miniTicker@arr' }],
            ]);
            expect(getUserDataStreamCalls()).toEqual([
                [{ stream: listenKeys.stale }],
                [{ stream: listenKeys.active }],
            ]);

            await vi.advanceTimersByTimeAsync(1);
            await flushMicrotasks();

            expect(Date.now()).toBe(activeKeepAliveBoundary);
            expect(renewListenKey).toHaveBeenCalledOnce();
            expect(renewListenKey).toHaveBeenCalledWith(listenKeys.active);
            expect(renewListenKey).not.toHaveBeenCalledWith(listenKeys.stale);
            expect(getRenewalRequests()).toEqual([[
                '/api/v3/userDataStream',
                'PUT',
                { listenKey: listenKeys.active },
            ]]);
            expect(await renewListenKey.mock.results[0].value).toBe(renewalResponse);
            expect(getActiveKeepAliveHandles()).toEqual([activeKeepAlive]);
            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(moduleMocks.rendererConnection.close).not.toHaveBeenCalled();

            const rendererPayload = {
                e: 'outboundAccountPosition',
                u: Date.now(),
                B: [{ a: 'USDT', f: '105.00', l: '0.00' }],
            };
            const sendsBeforeRenewalMessage = moduleMocks.rendererConnection.sendUTF.mock.calls.length;
            activeSocket.handlers.message(JSON.stringify(rendererPayload));

            expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledTimes(
                sendsBeforeRenewalMessage + 1,
            );
            expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenLastCalledWith(
                JSON.stringify({ balance_update: rendererPayload }),
            );

            moduleMocks.rendererConnection.close();
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(getClearCount(activeKeepAlive)).toBe(1);
            expect(getActiveKeepAliveHandles()).toEqual([]);
            expect(activeSocket.disconnect).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(keepAliveDelay);
            await flushMicrotasks();

            expect(renewListenKey).toHaveBeenCalledOnce();
            expect(getRenewalRequests()).toHaveLength(1);
            expect(createListenKey).toHaveBeenCalledTimes(2);
            expect(connectUserDataStream).toHaveBeenCalledTimes(2);
            expect(getMarketStreamCalls()).toHaveLength(1);
            expect(getUserDataStreamCalls()).toHaveLength(2);
        } finally {
            clearIntervalSpy.mockRestore();
            setIntervalSpy.mockRestore();
        }
    });

    it('drops a rate-limited renewal after final renderer teardown', async () => {
        const listenKey = 'rate-limited-renewal-listen-key';
        const keepAliveDelay = 30 * 60 * 1000;
        const marketWatchdogDelay = 15 * 1000;
        const loadBalancePayload = vi.fn().mockResolvedValue({ balances: {} });
        const renewalResponse = { data: vi.fn().mockResolvedValue({}) };

        moduleMocks.sendRequest.mockImplementation(async (path, method) => {
            if (path === '/api/v3/time' && method === 'GET') {
                return {
                    data: vi.fn().mockResolvedValue({ serverTime: Date.now() }),
                };
            }

            if (path === '/api/v3/userDataStream' && method === 'POST') {
                return {
                    data: vi.fn().mockResolvedValue({ listenKey }),
                };
            }

            if (path === '/api/v3/userDataStream' && method === 'PUT') {
                return renewalResponse;
            }

            return { data: vi.fn().mockResolvedValue({}) };
        });

        vi.spyOn(
            SpotTradingAdapter.prototype,
            'getAccountRefreshOperations',
        ).mockReturnValue([{
            type: 'balances',
            weight: 10,
            loadPayload: loadBalancePayload,
        }]);

        const createListenKey = vi.spyOn(
            SpotTradingAdapter.prototype,
            'createUserDataStreamListenKey',
        );
        const connectUserDataStream = vi.spyOn(
            SpotTradingAdapter.prototype,
            'connectUserDataStream',
        );
        const renewListenKey = vi.spyOn(
            SpotTradingAdapter.prototype,
            'renewUserDataStreamListenKey',
        );
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
        const getIntervalHandles = (delay) => setIntervalSpy.mock.calls.flatMap(
            ([, intervalDelay], index) => (
                intervalDelay === delay
                    ? [setIntervalSpy.mock.results[index].value]
                    : []
            ),
        );
        const getClearCount = (handle) => clearIntervalSpy.mock.calls.filter(
            ([clearedHandle]) => Object.is(clearedHandle, handle),
        ).length;
        const getRenewalRequests = () => moduleMocks.sendRequest.mock.calls.filter(
            ([path, method]) => path === '/api/v3/userDataStream' && method === 'PUT',
        );

        try {
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
            expect(connectUserDataStream).toHaveBeenCalledOnce();
            expect(connectUserDataStream).toHaveBeenCalledWith(listenKey);
            expect(moduleMocks.userDataSocket.handlers.message).toEqual(expect.any(Function));

            const [keepAliveInterval] = getIntervalHandles(keepAliveDelay);
            const [marketWatchdog] = getIntervalHandles(marketWatchdogDelay);
            expect(getIntervalHandles(keepAliveDelay)).toHaveLength(1);
            expect(getIntervalHandles(marketWatchdogDelay)).toHaveLength(1);
            clearInterval(marketWatchdog);

            const renewalBoundary = Date.now() + keepAliveDelay;
            await vi.advanceTimersByTimeAsync(keepAliveDelay - 1);
            await flushMicrotasks();

            expect(Date.now()).toBe(renewalBoundary - 1);
            expect(loadBalancePayload).toHaveBeenCalledOnce();

            moduleMocks.userDataSocket.handlers.message(JSON.stringify({
                e: 'balanceUpdate',
                a: 'USDT',
                d: '1.00',
            }));
            await flushMicrotasks();

            expect(loadBalancePayload).toHaveBeenCalledTimes(2);
            expect(renewListenKey).not.toHaveBeenCalled();
            expect(getRenewalRequests()).toEqual([]);

            vi.advanceTimersByTime(1);
            await flushMicrotasks();

            expect(Date.now()).toBe(renewalBoundary);
            expect(renewListenKey).not.toHaveBeenCalled();
            expect(getRenewalRequests()).toEqual([]);
            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(setTimeoutSpy.mock.calls.filter(
                ([, delay]) => delay === 499,
            )).toHaveLength(1);

            moduleMocks.rendererConnection.close();
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(getClearCount(keepAliveInterval)).toBe(1);
            expect(moduleMocks.userDataSocket.disconnect).toHaveBeenCalledOnce();

            await vi.advanceTimersByTimeAsync(499);
            await flushMicrotasks();

            expect(renewListenKey).not.toHaveBeenCalled();
            expect(getRenewalRequests()).toEqual([]);

            await vi.advanceTimersByTimeAsync(keepAliveDelay);
            await flushMicrotasks();

            expect(renewListenKey).not.toHaveBeenCalled();
            expect(getRenewalRequests()).toEqual([]);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(connectUserDataStream).toHaveBeenCalledOnce();
            expect(moduleMocks.connect.mock.calls).toEqual([
                [{ stream: '!miniTicker@arr' }],
                [{ stream: listenKey }],
            ]);
        } finally {
            clearIntervalSpy.mockRestore();
            setIntervalSpy.mockRestore();
            setTimeoutSpy.mockRestore();
        }
    });

    it('drops a listen key created after final renderer teardown', async () => {
        const listenKey = 'late-listen-key-after-final-renderer-teardown';
        const keepAliveDelay = 30 * 60 * 1000;
        const reconnectDelay = 5 * 1000;
        let resolveListenKeyPayload;
        const listenKeyPayload = new Promise((resolve) => {
            resolveListenKeyPayload = resolve;
        });
        const readListenKeyPayload = vi.fn(() => listenKeyPayload);

        moduleMocks.sendRequest.mockImplementation(async (path, method) => {
            if (path === '/api/v3/time' && method === 'GET') {
                return {
                    data: vi.fn().mockResolvedValue({ serverTime: Date.now() }),
                };
            }

            if (path === '/api/v3/userDataStream' && method === 'POST') {
                return { data: readListenKeyPayload };
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
        );
        const renewListenKey = vi.spyOn(
            SpotTradingAdapter.prototype,
            'renewUserDataStreamListenKey',
        );
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        const getListenKeyRequests = () => moduleMocks.sendRequest.mock.calls.filter(
            ([path, method]) => path === '/api/v3/userDataStream' && method === 'POST',
        );
        const getRenewalRequests = () => moduleMocks.sendRequest.mock.calls.filter(
            ([path, method]) => path === '/api/v3/userDataStream' && method === 'PUT',
        );
        const getMarketStreamCalls = () => moduleMocks.connect.mock.calls.filter(
            ([{ stream }]) => stream === '!miniTicker@arr',
        );
        const getLateUserDataStreamCalls = () => moduleMocks.connect.mock.calls.filter(
            ([{ stream }]) => stream === listenKey,
        );
        const getUserDataIntervals = () => setIntervalSpy.mock.calls.filter(
            ([, delay]) => delay === keepAliveDelay,
        );
        const getReconnectSchedules = () => console.info.mock.calls.filter(
            ([message]) => message === 'Scheduling User Data Stream reconnection...',
        );

        try {
            setupBinanceConnection({
                localWebSocketAccess: { host: '127.0.0.1' },
            });

            const request = {
                origin: 'http://localhost:5174',
                accept: vi.fn(() => moduleMocks.rendererConnection),
            };
            moduleMocks.websocketServerHandlers.request(request);

            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);
            expect(readListenKeyPayload).toHaveBeenCalledOnce();
            expect(connectUserDataStream).not.toHaveBeenCalled();
            expect(getMarketStreamCalls()).toEqual([
                [{ stream: '!miniTicker@arr' }],
            ]);
            expect(getLateUserDataStreamCalls()).toEqual([]);
            expect(moduleMocks.userDataSocket.on).not.toHaveBeenCalled();
            expect(getUserDataIntervals()).toEqual([]);

            moduleMocks.rendererConnection.close();
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(moduleMocks.marketSocket.disconnect).toHaveBeenCalledOnce();

            resolveListenKeyPayload({ listenKey });
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(connectUserDataStream).not.toHaveBeenCalled();
            expect(getLateUserDataStreamCalls()).toEqual([]);
            expect(moduleMocks.userDataSocket.handlers.message).toBeUndefined();
            expect(moduleMocks.userDataSocket.handlers.error).toBeUndefined();
            expect(moduleMocks.userDataSocket.handlers.close).toBeUndefined();
            expect(getUserDataIntervals()).toEqual([]);
            expect(getReconnectSchedules()).toEqual([]);

            await vi.advanceTimersByTimeAsync(reconnectDelay);
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);
            expect(connectUserDataStream).not.toHaveBeenCalled();
            expect(getMarketStreamCalls()).toHaveLength(1);
            expect(getLateUserDataStreamCalls()).toEqual([]);
            expect(moduleMocks.userDataSocket.on).not.toHaveBeenCalled();
            expect(getUserDataIntervals()).toEqual([]);
            expect(getReconnectSchedules()).toEqual([]);

            await vi.advanceTimersByTimeAsync(keepAliveDelay);
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);
            expect(connectUserDataStream).not.toHaveBeenCalled();
            expect(renewListenKey).not.toHaveBeenCalled();
            expect(getRenewalRequests()).toEqual([]);
            expect(getMarketStreamCalls()).toHaveLength(1);
            expect(getLateUserDataStreamCalls()).toEqual([]);
            expect(moduleMocks.userDataSocket.on).not.toHaveBeenCalled();
            expect(getUserDataIntervals()).toEqual([]);
            expect(getReconnectSchedules()).toEqual([]);
        } finally {
            setIntervalSpy.mockRestore();
        }
    });

    it('disconnects an in-flight user-data socket that resolves after renderer teardown', async () => {
        let resolveUserDataConnection;
        const userDataConnection = new Promise((resolve) => {
            resolveUserDataConnection = resolve;
        });
        const orphanedSocket = moduleMocks.makeSocket();
        const createListenKey = vi.spyOn(
            SpotTradingAdapter.prototype,
            'createUserDataStreamListenKey',
        );
        const connectUserDataStream = vi.spyOn(
            SpotTradingAdapter.prototype,
            'connectUserDataStream',
        ).mockReturnValue(userDataConnection);
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

        try {
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
            expect(connectUserDataStream).toHaveBeenCalledOnce();
            expect(connectUserDataStream).toHaveBeenCalledWith('listen-key-123');
            expect(orphanedSocket.on).not.toHaveBeenCalled();

            moduleMocks.rendererConnection.close();
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);

            resolveUserDataConnection(orphanedSocket);
            await flushMicrotasks();

            expect(orphanedSocket.disconnect).toHaveBeenCalledOnce();
            expect(orphanedSocket.on).not.toHaveBeenCalled();
            expect(setIntervalSpy.mock.calls.filter(
                ([, delay]) => delay === 30 * 60 * 1000,
            )).toHaveLength(0);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(connectUserDataStream).toHaveBeenCalledOnce();
            expect(moduleMocks.connect).toHaveBeenCalledOnce();
            expect(moduleMocks.connect).toHaveBeenCalledWith({
                stream: '!miniTicker@arr',
            });
        } finally {
            setIntervalSpy.mockRestore();
        }
    });
});
