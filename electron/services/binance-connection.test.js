import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const moduleMocks = vi.hoisted(() => {
    const websocketServerHandlers = {};
    const rendererHandlers = {};

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

    const marketSocket = makeSocket();
    const userDataSocket = makeSocket();
    const httpServer = {
        listen: vi.fn((port, host, callback) => callback?.()),
        close: vi.fn(),
    };
    const websocketServer = {
        on: vi.fn((event, handler) => {
            websocketServerHandlers[event] = handler;
        }),
    };
    const createHttpServer = vi.fn(() => httpServer);
    const WebSocketServer = vi.fn(function MockWebSocketServer() {
        return websocketServer;
    });

    const sendRequest = vi.fn(async (path, method) => ({
        data: vi.fn().mockResolvedValue(
            path === '/api/v3/time' && method === 'GET'
                ? { serverTime: Date.now() }
                : path === '/api/v3/userDataStream' && method === 'POST'
                    ? { listenKey: 'listen-key-123' }
                    : {},
        ),
    }));
    const connect = vi.fn(({ stream }) => Promise.resolve(
        stream === '!miniTicker@arr' ? marketSocket : userDataSocket,
    ));
    const spotClient = {
        restAPI: {
            configuration: { baseOptions: { headers: {} } },
            axiosInstance: {
                interceptors: {
                    request: { use: vi.fn() },
                },
            },
            sendRequest,
            ticker24hr: vi.fn().mockResolvedValue({
                data: vi.fn().mockResolvedValue([]),
            }),
        },
        websocketStreams: { connect },
    };
    const Spot = vi.fn(function MockSpot() {
        return spotClient;
    });

    const rendererConnection = {
        connected: true,
        remoteAddress: '127.0.0.1',
        sendUTF: vi.fn(),
        on: vi.fn((event, handler) => {
            rendererHandlers[event] = handler;
        }),
    };

    return {
        Spot,
        WebSocketServer,
        connect,
        createHttpServer,
        httpServer,
        marketSocket,
        rendererConnection,
        rendererHandlers,
        sendRequest,
        spotClient,
        userDataSocket,
        websocketServer,
        websocketServerHandlers,
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

import { setupBinanceConnection } from './binance-connection.js';
import { SpotTradingAdapter } from './spot-trading-adapter.js';

const flushMicrotasks = async () => {
    for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
    }
};

describe('setupBinanceConnection user-data orchestration', () => {
    let originalConsoleLog;
    let originalStdoutWrite;
    let originalStderrWrite;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-09T10:00:00.000Z'));
        vi.stubEnv('BK', 'test-api-key');
        vi.stubEnv('BS', 'test-api-secret');
        vi.stubEnv('WS_PORT', '14477');
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
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        console.log = originalConsoleLog;
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    });

    it('connects live user data and coalesces adapter-owned balance catch-up', async () => {
        let resolveBalancePayload;
        const balancePayload = {
            balances: {
                USDT: { available: '100.00', onOrder: '5.00' },
            },
        };
        const balancePayloadPromise = new Promise((resolve) => {
            resolveBalancePayload = resolve;
        });
        const loadBalancePayload = vi.fn(() => balancePayloadPromise);
        const loadOpenOrdersPayload = vi.fn();
        const readBalanceWeight = vi.fn(() => 10);
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
        expect(moduleMocks.connect).toHaveBeenCalledWith({ stream: 'listen-key-123' });

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
        expect(readBalanceWeight).toHaveReturnedWith(10);
        expect(loadBalancePayload).toHaveBeenCalledOnce();
        expect(loadOpenOrdersPayload).not.toHaveBeenCalled();

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

        expect(getAccountRefreshOperations).toHaveBeenCalledOnce();
        expect(loadBalancePayload).toHaveBeenCalledOnce();
        expect(loadOpenOrdersPayload).not.toHaveBeenCalled();
        expect(moduleMocks.rendererConnection.sendUTF).not.toHaveBeenCalled();

        resolveBalancePayload(balancePayload);
        await flushMicrotasks();

        expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledOnce();
        expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledWith(
            JSON.stringify(balancePayload),
        );

        moduleMocks.rendererHandlers.close();
        await flushMicrotasks();
    });
});
