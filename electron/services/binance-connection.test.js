import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE,
    createFuturesProductionWorkstationSubscribeRequest,
} from '../../src/utils/futuresProductionWorkstationProtocol.js';

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
        state.futuresUserDataSockets = [];
        state.httpServer = {
            listen: vi.fn((port, host, callback) => callback?.()),
            close: vi.fn(),
        };
        state.websocketServer = {
            on: vi.fn((event, handler) => {
                state.websocketServerHandlers[event] = handler;
            }),
        };
        state.futuresAdapter = {
            syncServerTime: vi.fn().mockResolvedValue(1),
            getPositionMode: vi.fn().mockResolvedValue({ hedgeMode: false }),
            placeOrder: vi.fn().mockResolvedValue({
                e: 'executionReport', symbol: 'BTCUSDT', status: 'NEW', orderId: 1,
            }),
            cancelOrder: vi.fn().mockResolvedValue({
                e: 'executionReport', symbol: 'BTCUSDT', status: 'CANCELED', orderId: 1,
            }),
            cancelAllOrders: vi.fn().mockResolvedValue({}),
            cancelAllAlgoOrders: vi.fn().mockResolvedValue({}),
            adjustPositionMargin: vi.fn().mockResolvedValue({
                symbol: 'BTCUSDT', positionSide: 'BOTH', direction: 'ADD', amount: '250',
            }),
            modifyOrder: vi.fn().mockResolvedValue({
                e: 'executionReport', symbol: 'BTCUSDT', status: 'NEW', orderId: 1,
            }),
            findOrder: vi.fn().mockResolvedValue({ exists: false, report: null }),
            getOrderHistory: vi.fn().mockResolvedValue([{ orderId: 1, status: 'FILLED' }]),
            getTradeHistory: vi.fn().mockResolvedValue([{ id: 2, realizedPnl: '-96.74' }]),
            // Every USDⓈ-M history endpoint takes a symbol, so a review of the
            // account starts by asking which contracts it was traded on. The read
            // is paged: a full page means newer rows are still behind it.
            getTradedSymbolPage: vi.fn().mockResolvedValue({
                symbols: ['BTCUSDT'], full: false, lastTime: 5_000,
            }),
            getSymbolConfig: vi.fn().mockResolvedValue({
                symbol: 'BTCUSDT', leverage: 20, marginType: 'CROSSED', maxNotionalValue: '5000000',
            }),
            getMaxLeverage: vi.fn().mockResolvedValue(125),
            setLeverage: vi.fn().mockResolvedValue({ symbol: 'BTCUSDT', leverage: 20 }),
            setMarginType: vi.fn().mockResolvedValue({ code: 200, msg: 'success' }),
            getAccountRefreshOperations: vi.fn(() => []),
            createUserDataStreamListenKey: vi.fn().mockResolvedValue('futures-listen-key'),
            renewUserDataStreamListenKey: vi.fn().mockResolvedValue({}),
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
                newOrder: vi.fn().mockResolvedValue({
                    data: vi.fn().mockResolvedValue({
                        symbol: 'PAXUSDT', orderId: 41, status: 'NEW', side: 'BUY',
                    }),
                }),
                getOrder: vi.fn().mockResolvedValue({
                    data: vi.fn().mockResolvedValue({
                        symbol: 'PAXUSDT', orderId: 41, status: 'NEW', side: 'BUY',
                    }),
                }),
                getAccount: vi.fn().mockResolvedValue({
                    data: vi.fn().mockResolvedValue({ balances: [] }),
                }),
                getOpenOrders: vi.fn().mockResolvedValue({
                    data: vi.fn().mockResolvedValue([]),
                }),
                myTrades: vi.fn().mockResolvedValue({
                    data: vi.fn().mockResolvedValue([]),
                }),
            },
            websocketStreams: { connect: state.connect },
        };
        state.rendererConnection = {
            connected: true,
            remoteAddress: '127.0.0.1',
            sendUTF: vi.fn(),
            drop: vi.fn(),
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
    const FuturesTradingAdapter = vi.fn(function MockFuturesTradingAdapter() {
        return state.futuresAdapter;
    });

    reset();

    return {
        Spot,
        WebSocketServer,
        createHttpServer,
        FuturesTradingAdapter,
        makeSocket,
        reset,
        setUserDataConnection: (connection) => {
            state.userDataConnection = connection;
        },
        createFuturesUserDataSocket: () => {
            const socket = makeSocket();
            socket.close = vi.fn();
            state.futuresUserDataSockets.push(socket);
            return socket;
        },
        get connect() { return state.connect; },
        get httpServer() { return state.httpServer; },
        get marketSocket() { return state.marketSocket; },
        get futuresAdapter() { return state.futuresAdapter; },
        get futuresUserDataSockets() { return state.futuresUserDataSockets; },
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
    resolveLocalWebSocketPort: vi.fn((value) => value || 14477),
    validateLocalWebSocketRequest: vi.fn(() => ({ allowed: true })),
}));

vi.mock('./futures-trading-adapter.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        FuturesTradingAdapter: moduleMocks.FuturesTradingAdapter,
    };
});

vi.mock('ws', () => ({
    default: vi.fn(function MockFuturesUserDataSocket() {
        return moduleMocks.createFuturesUserDataSocket();
    }),
}));

const flushMicrotasks = async () => {
    for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
    }
};

// Activation is now a precondition for any market-scoped frame, and it answers
// with its own envelope. The acknowledgement is cleared here so each test still
// counts the frames it is actually about.
const activateSpotRuntime = async () => {
    await moduleMocks.rendererHandlers.message({
        type: 'utf8',
        utf8Data: JSON.stringify({
            action: 'activate_market',
            marketMode: 'spot',
        }),
    });
    await flushMicrotasks();
    moduleMocks.rendererConnection.sendUTF.mockClear();
};

describe('setupBinanceConnection user-data orchestration', () => {
    let originalConsoleLog;
    let originalStdoutWrite;
    let originalStderrWrite;
    let setupBinanceConnection;
    let SpotTradingAdapter;
    let LOCAL_RENDERER_WS_MAX_FRAME_BYTES;
    let LOCAL_RENDERER_WS_MAX_MESSAGE_BYTES;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        moduleMocks.reset();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-09T10:00:00.000Z'));
        // Stubbed unconditionally so an operator shell that still exports real
        // credentials cannot leak them into a test run or into its output.
        vi.stubEnv('BK', 'test-api-key');
        vi.stubEnv('BS', 'test-api-secret');
        vi.stubEnv('BFK', 'test-futures-api-key');
        vi.stubEnv('BFS', 'test-futures-api-secret');
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

        ({
            setupBinanceConnection,
            LOCAL_RENDERER_WS_MAX_FRAME_BYTES,
            LOCAL_RENDERER_WS_MAX_MESSAGE_BYTES,
        } = await import('./binance-connection.js'));
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

    it('deduplicates controller close into a single shutdown promise', async () => {
        moduleMocks.httpServer.close.mockImplementation(callback => callback?.());
        const controller = setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });

        const firstClose = controller.close();
        expect(controller.close()).toBe(firstClose);
        await firstClose;
    });

    // A rejected handshake reaches the browser as an anonymous 1006, which is
    // why a renderer holding a token this process never issued retried it every
    // 500 ms for the whole session and filled the log with `invalid token`.
    it('closes a wrong token with a code the renderer can stop on, and registers nothing', async () => {
        const { validateLocalWebSocketRequest } = await import('./local-websocket-access.js');
        validateLocalWebSocketRequest.mockReturnValueOnce({
            allowed: false,
            status: 401,
            reason: 'invalid-token',
        });
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });

        const refused = { close: vi.fn() };
        const request = {
            origin: 'http://localhost:5174',
            accept: vi.fn(() => refused),
            reject: vi.fn(),
        };
        moduleMocks.websocketServerHandlers.request(request);

        expect(request.reject).not.toHaveBeenCalled();
        expect(refused.close).toHaveBeenCalledExactlyOnceWith(4401, 'invalid-token');
        // Accepted only in order to be closed: no message handler was attached
        // and nothing was ever sent on it.
        expect(refused.on).toBeUndefined();
        expect(moduleMocks.rendererConnection.sendUTF).not.toHaveBeenCalled();
    });

    it('still rejects an untrusted origin outright rather than accepting it', async () => {
        const { validateLocalWebSocketRequest } = await import('./local-websocket-access.js');
        validateLocalWebSocketRequest.mockReturnValueOnce({
            allowed: false,
            status: 403,
            reason: 'untrusted-origin',
        });
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });

        const request = {
            origin: 'https://evil.example',
            accept: vi.fn(),
            reject: vi.fn(),
        };
        moduleMocks.websocketServerHandlers.request(request);

        expect(request.accept).not.toHaveBeenCalled();
        expect(request.reject).toHaveBeenCalledWith(403, 'untrusted-origin');
    });

    it('starts only the local diagnostic transport and rejects market work without BK/BS', async () => {
        vi.stubEnv('BK', '');
        vi.stubEnv('BS', '');
        vi.stubEnv('BFK', '');
        vi.stubEnv('BFS', '');
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });

        expect(moduleMocks.Spot).not.toHaveBeenCalled();
        expect(moduleMocks.FuturesTradingAdapter).not.toHaveBeenCalled();
        expect(moduleMocks.connect).not.toHaveBeenCalled();

        const request = {
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
            reject: vi.fn(),
        };
        moduleMocks.websocketServerHandlers.request(request);
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'get_startup_status' }),
        });

        const startup = JSON.parse(moduleMocks.rendererConnection.sendUTF.mock.calls[0][0]);
        expect(startup).toMatchObject({
            type: 'startup_status',
            state: 'CONFIG_ERROR',
            code: 'MISSING_CREDENTIALS',
            ready: false,
            missingFields: ['BK', 'BS', 'BFK', 'BFS'],
        });
        expect(startup.markets).toMatchObject({
            spot: { ready: false, missingFields: ['BK', 'BS'] },
            futures: { ready: false, missingFields: ['BFK', 'BFS'] },
        });

        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'subscribe',
                channelId: 'detail-BTCUSDT-1m',
                symbol: 'BTCUSDT',
                interval: '1m',
            }),
        });
        const rejection = JSON.parse(moduleMocks.rendererConnection.sendUTF.mock.calls[1][0]);
        expect(rejection.command_rejected).toMatchObject({
            code: 'EXECUTION_NOT_CONFIGURED',
        });
        expect(moduleMocks.sendRequest).not.toHaveBeenCalled();
        expect(moduleMocks.connect).not.toHaveBeenCalled();
    });

    it('builds no Futures adapter and refuses Futures activation with Spot credentials only', async () => {
        vi.stubEnv('BFK', '');
        vi.stubEnv('BFS', '');
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });

        expect(moduleMocks.Spot).toHaveBeenCalledTimes(1);
        expect(moduleMocks.FuturesTradingAdapter).not.toHaveBeenCalled();

        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'activate_market',
                marketMode: 'futures-live',
            }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const payloads = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        expect(payloads.find(payload => payload.command_rejected)?.command_rejected)
            .toMatchObject({
                code: 'MARKET_NOT_CONFIGURED',
                details: { market: 'futures' },
            });
        expect(payloads.some(payload => payload.type === 'futures_account_state')).toBe(false);
        expect(moduleMocks.futuresUserDataSockets).toHaveLength(0);
    });

    it('builds no Spot client and refuses Spot activation with Futures credentials only', async () => {
        vi.stubEnv('BK', '');
        vi.stubEnv('BS', '');
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });

        expect(moduleMocks.Spot).not.toHaveBeenCalled();
        expect(moduleMocks.FuturesTradingAdapter).toHaveBeenCalledTimes(1);
        expect(moduleMocks.FuturesTradingAdapter.mock.calls[0][0]).toMatchObject({
            apiKey: 'test-futures-api-key',
            apiSecret: 'test-futures-api-secret',
        });

        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'spot' }),
        });
        await flushMicrotasks();

        const rejections = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.command_rejected);
        expect(rejections[0].command_rejected).toMatchObject({
            code: 'MARKET_NOT_CONFIGURED',
            details: { market: 'spot' },
        });
        expect(moduleMocks.connect).not.toHaveBeenCalled();
    });

    it('never signs Futures requests with the Spot credential pair', () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });

        expect(moduleMocks.FuturesTradingAdapter.mock.calls[0][0]).toMatchObject({
            apiKey: 'test-futures-api-key',
            apiSecret: 'test-futures-api-secret',
        });
        expect(moduleMocks.Spot.mock.calls[0][0].configurationRestAPI).toMatchObject({
            apiKey: 'test-api-key',
            apiSecret: 'test-api-secret',
        });
    });

    it('broadcasts independent Futures account resource transitions and retains partial success', async () => {
        const permissionError = Object.assign(new Error('permission denied'), { code: -2015 });
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([
            {
                type: 'balances',
                weight: 5,
                errorLabel: 'balances',
                loadPayload: vi.fn().mockResolvedValue({
                    futures_balances: { USDT: { available: '0', total: '0' } },
                }),
            },
            {
                type: 'regularOrders',
                weight: 40,
                errorLabel: 'regular orders',
                loadPayload: vi.fn().mockResolvedValue({
                    futures_regular_orders: [
                        { symbol: 'TUTUSDT', orderId: 1, orderKind: 'REGULAR', status: 'NEW' },
                        { symbol: 'BTCUSDT', orderId: 2, orderKind: 'REGULAR', status: 'NEW' },
                    ],
                }),
            },
            {
                type: 'algoOrders',
                weight: 40,
                errorLabel: 'algo orders',
                loadPayload: vi.fn().mockRejectedValue(permissionError),
            },
            {
                type: 'positions',
                weight: 5,
                errorLabel: 'positions',
                loadPayload: vi.fn().mockResolvedValue({ futures_positions: [] }),
            },
        ]);

        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });

        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'activate_market',
                marketMode: 'futures-live',
            }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const accountEnvelopes = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_account_state');
        expect(accountEnvelopes.length).toBeGreaterThanOrEqual(5);
        const initialAccountLoading = accountEnvelopes.find(payload => (
            payload.resources.balances.status === 'loading'
            && payload.resources.regularOrders.status === 'loading'
            && payload.resources.algoOrders.status === 'loading'
            && payload.resources.positions.status === 'loading'
        ));
        expect(initialAccountLoading.resources).toMatchObject({
            balances: { status: 'loading', data: null },
            regularOrders: { status: 'loading', data: [] },
            algoOrders: { status: 'loading', data: [] },
            positions: { status: 'loading', data: [] },
        });

        const latest = accountEnvelopes.at(-1);
        expect(latest.resources.balances).toMatchObject({
            status: 'ready',
            data: { USDT: { available: '0', total: '0' } },
            lastSuccessfulAt: expect.any(Number),
        });
        expect(latest.resources.regularOrders).toMatchObject({
            status: 'ready',
            data: [
                expect.objectContaining({ symbol: 'TUTUSDT', orderId: 1 }),
                expect.objectContaining({ symbol: 'BTCUSDT', orderId: 2 }),
            ],
        });
        expect(latest.resources.algoOrders).toMatchObject({
            status: 'error',
            data: [],
            error: {
                code: 'FUTURES_PERMISSION_DENIED',
                category: 'permission',
                retryable: false,
            },
        });
        expect(latest.resources.positions.status).toBe('ready');
        expect(JSON.stringify(latest)).not.toContain('test-api-secret');
    });

    // positionRisk is only re-read on an account event, so a position row is
    // worth what the exchange said minutes ago unless the public mark stream
    // reaches the renderer. This covers the whole path, not the feed alone.
    it('marks open Futures positions to the live mark price stream', async () => {
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([
            {
                type: 'positions',
                weight: 5,
                errorLabel: 'positions',
                loadPayload: vi.fn().mockResolvedValue({
                    futures_positions: [
                        {
                            symbol: 'BMTUSDT',
                            positionSide: 'BOTH',
                            quantity: '-446422',
                            entryPrice: '0.03140',
                            markPrice: '0.03398',
                            unrealizedPnl: '-1151.77',
                        },
                    ],
                }),
            },
        ]);

        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'activate_market',
                marketMode: 'futures-live',
            }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const { default: MockWebSocket } = await import('ws');
        const streamIndex = MockWebSocket.mock.calls
            .findIndex(([url]) => String(url).includes('@markPrice@1s'));
        expect(streamIndex).toBeGreaterThanOrEqual(0);
        // The routed prefix is part of the contract, not decoration: `/stream`
        // was decommissioned on 2026-04-23 and answers the handshake with a
        // socket that never delivers a frame.
        expect(MockWebSocket.mock.calls[streamIndex][0])
            .toBe('wss://fstream.binance.com/market/stream?streams=bmtusdt@markPrice@1s');

        const markSocket = MockWebSocket.mock.results[streamIndex].value;
        markSocket.handlers.message(JSON.stringify({
            stream: 'bmtusdt@markPrice@1s',
            data: { e: 'markPriceUpdate', E: 1_784_000_000_000, s: 'BMTUSDT', p: '0.03500' },
        }));
        await vi.advanceTimersByTimeAsync(1_000);

        const markEnvelopes = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_position_marks');
        expect(markEnvelopes.at(-1)).toMatchObject({
            version: 1,
            marks: { BMTUSDT: { markPrice: '0.03500', updatedAt: 1_784_000_000_000 } },
        });
    });

    it('retains account-wide orders as stale across Futures stream reconnect until REST recovery', async () => {
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([
            {
                type: 'regularOrders',
                weight: 1,
                errorLabel: 'regular orders',
                loadPayload: vi.fn().mockResolvedValue({
                    futures_regular_orders: [
                        { symbol: 'TUTUSDT', orderId: 11, orderKind: 'REGULAR', status: 'NEW' },
                    ],
                }),
            },
            {
                type: 'algoOrders',
                weight: 1,
                errorLabel: 'algo orders',
                loadPayload: vi.fn().mockResolvedValue({
                    futures_algo_orders: [
                        { symbol: 'TUTUSDT', orderId: 11, orderKind: 'ALGO', status: 'NEW' },
                    ],
                }),
            },
        ]);

        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'activate_market',
                marketMode: 'futures-live',
            }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const firstSocket = moduleMocks.futuresUserDataSockets[0];
        expect(firstSocket).toBeDefined();
        firstSocket.handlers.open();
        await vi.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();

        const readAccountEnvelopes = () => moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_account_state');
        expect(readAccountEnvelopes().at(-1).resources).toMatchObject({
            regularOrders: { status: 'ready', data: [expect.objectContaining({ orderKind: 'REGULAR' })] },
            algoOrders: { status: 'ready', data: [expect.objectContaining({ orderKind: 'ALGO' })] },
            userDataStream: { status: 'ready' },
        });

        firstSocket.handlers.close();
        await flushMicrotasks();
        expect(readAccountEnvelopes().at(-1).resources).toMatchObject({
            regularOrders: { status: 'stale', data: [expect.objectContaining({ orderKind: 'REGULAR' })] },
            algoOrders: { status: 'stale', data: [expect.objectContaining({ orderKind: 'ALGO' })] },
            userDataStream: { status: 'stale' },
        });

        await vi.advanceTimersByTimeAsync(6_000);
        await flushMicrotasks();
        const secondSocket = moduleMocks.futuresUserDataSockets[1];
        expect(secondSocket).toBeDefined();
        secondSocket.handlers.open();
        await vi.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();

        expect(readAccountEnvelopes().at(-1).resources).toMatchObject({
            regularOrders: { status: 'ready', data: [expect.objectContaining({ orderKind: 'REGULAR' })] },
            algoOrders: { status: 'ready', data: [expect.objectContaining({ orderKind: 'ALGO' })] },
            userDataStream: { status: 'ready' },
        });
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
        await activateSpotRuntime();

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
        await activateSpotRuntime();

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
            await activateSpotRuntime();

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
            await activateSpotRuntime();

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
            await activateSpotRuntime();

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
            await activateSpotRuntime();

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

    it('drops a rate-limited listen-key creation before its POST after final renderer teardown', async () => {
        const listenKeys = {
            initial: 'rate-limited-creation-initial-listen-key',
            late: 'rate-limited-creation-late-listen-key',
        };
        const reconnectDelay = 5 * 1000;
        const keepAliveDelay = 30 * 60 * 1000;
        const initialSocket = moduleMocks.userDataSocket;
        const lateSocket = moduleMocks.makeSocket();
        const orderedListenKeys = [listenKeys.initial, listenKeys.late];
        const loadBalancePayload = vi.fn().mockResolvedValue({ balances: {} });
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

            return { data: vi.fn().mockResolvedValue({}) };
        });

        moduleMocks.connect.mockImplementation(({ stream }) => {
            if (stream === '!miniTicker@arr') {
                return Promise.resolve(moduleMocks.marketSocket);
            }
            if (stream === listenKeys.initial) return Promise.resolve(initialSocket);
            if (stream === listenKeys.late) return Promise.resolve(lateSocket);
            return Promise.reject(new Error(`Unexpected Binance stream: ${stream}`));
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
        const getListenKeyRequests = () => moduleMocks.sendRequest.mock.calls.filter(
            ([path, method]) => path === '/api/v3/userDataStream' && method === 'POST',
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
        const getLateUserDataStreamCalls = () => moduleMocks.connect.mock.calls.filter(
            ([{ stream }]) => stream === listenKeys.late,
        );
        const getUserDataIntervals = () => setIntervalSpy.mock.calls.flatMap(
            ([, delay], index) => (
                delay === keepAliveDelay
                    ? [setIntervalSpy.mock.results[index].value]
                    : []
            ),
        );
        const getClearCount = (handle) => clearIntervalSpy.mock.calls.filter(
            ([clearedHandle]) => Object.is(clearedHandle, handle),
        ).length;
        const getReconnectSchedules = () => console.info.mock.calls.filter(
            ([message]) => message === 'Scheduling User Data Stream reconnection...',
        );
        const getStartLogs = () => console.info.mock.calls.filter(
            ([message]) => message === 'Starting User Data Stream setup...',
        );
        const getListenKeySuccessLogs = () => console.info.mock.calls.filter(
            ([message]) => message === 'Listen Key obtained successfully.',
        );
        const getListenKeyFailureLogs = () => console.error.mock.calls.filter(
            ([message]) => (
                message === 'Failed to obtain listenKey'
                || message === 'Failed to start User Data Stream:'
            ),
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
            await activateSpotRuntime();

            await flushMicrotasks();
            await vi.advanceTimersByTimeAsync(500);
            await flushMicrotasks();
            await vi.advanceTimersByTimeAsync(500);
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);
            expect(connectUserDataStream).toHaveBeenCalledOnce();
            expect(connectUserDataStream).toHaveBeenCalledWith(listenKeys.initial);
            expect(initialSocket.on).toHaveBeenCalledTimes(3);
            expect(initialSocket.handlers.message).toEqual(expect.any(Function));
            expect(initialSocket.handlers.error).toEqual(expect.any(Function));
            expect(initialSocket.handlers.close).toEqual(expect.any(Function));
            expect(lateSocket.on).not.toHaveBeenCalled();
            expect(getMarketStreamCalls()).toEqual([
                [{ stream: '!miniTicker@arr' }],
            ]);
            expect(getUserDataStreamCalls()).toEqual([
                [{ stream: listenKeys.initial }],
            ]);
            expect(loadBalancePayload).toHaveBeenCalledOnce();
            expect(getStartLogs()).toHaveLength(1);
            expect(getListenKeySuccessLogs()).toHaveLength(1);
            expect(getListenKeyFailureLogs()).toEqual([]);

            const [initialKeepAlive] = getUserDataIntervals();
            expect(initialKeepAlive).toBeDefined();
            expect(getUserDataIntervals()).toHaveLength(1);
            expect(getClearCount(initialKeepAlive)).toBe(0);

            const reconnectBoundary = Date.now() + reconnectDelay;
            initialSocket.handlers.close();
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(getReconnectSchedules()).toHaveLength(1);
            expect(getClearCount(initialKeepAlive)).toBe(1);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(reconnectDelay - 1);
            await flushMicrotasks();

            expect(Date.now()).toBe(reconnectBoundary - 1);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);

            initialSocket.handlers.message(JSON.stringify({
                e: 'balanceUpdate',
                a: 'USDT',
                d: '1.00',
            }));
            await flushMicrotasks();

            expect(loadBalancePayload).toHaveBeenCalledTimes(2);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);

            vi.advanceTimersByTime(1);
            await flushMicrotasks();

            expect(Date.now()).toBe(reconnectBoundary);
            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(getStartLogs()).toHaveLength(2);
            expect(getReconnectSchedules()).toHaveLength(1);
            expect(setTimeoutSpy.mock.calls.filter(
                ([, delay]) => delay === 499,
            )).toHaveLength(1);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);
            expect(connectUserDataStream).toHaveBeenCalledOnce();

            moduleMocks.rendererConnection.close();
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(moduleMocks.rendererConnection.close).toHaveBeenCalledOnce();
            expect(moduleMocks.marketSocket.disconnect).toHaveBeenCalledOnce();
            expect(getClearCount(initialKeepAlive)).toBe(1);

            await vi.advanceTimersByTimeAsync(499);
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);
            expect(connectUserDataStream).toHaveBeenCalledOnce();
            expect(connectUserDataStream).toHaveBeenCalledWith(listenKeys.initial);
            expect(getMarketStreamCalls()).toHaveLength(1);
            expect(getUserDataStreamCalls()).toEqual([
                [{ stream: listenKeys.initial }],
            ]);
            expect(getLateUserDataStreamCalls()).toEqual([]);
            expect(initialSocket.on).toHaveBeenCalledTimes(3);
            expect(lateSocket.on).not.toHaveBeenCalled();
            expect(getUserDataIntervals()).toHaveLength(1);
            expect(getClearCount(initialKeepAlive)).toBe(1);
            expect(renewListenKey).not.toHaveBeenCalled();
            expect(getRenewalRequests()).toEqual([]);
            expect(getReconnectSchedules()).toHaveLength(1);
            expect(getListenKeySuccessLogs()).toHaveLength(1);
            expect(getListenKeyFailureLogs()).toEqual([]);

            await vi.advanceTimersByTimeAsync(reconnectDelay);
            await flushMicrotasks();
            await vi.advanceTimersByTimeAsync(keepAliveDelay);
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);
            expect(connectUserDataStream).toHaveBeenCalledOnce();
            expect(getMarketStreamCalls()).toHaveLength(1);
            expect(getUserDataStreamCalls()).toHaveLength(1);
            expect(getLateUserDataStreamCalls()).toEqual([]);
            expect(initialSocket.on).toHaveBeenCalledTimes(3);
            expect(lateSocket.on).not.toHaveBeenCalled();
            expect(getUserDataIntervals()).toHaveLength(1);
            expect(renewListenKey).not.toHaveBeenCalled();
            expect(getRenewalRequests()).toEqual([]);
            expect(getReconnectSchedules()).toHaveLength(1);
            expect(getListenKeySuccessLogs()).toHaveLength(1);
            expect(getListenKeyFailureLogs()).toEqual([]);
        } finally {
            clearIntervalSpy.mockRestore();
            setIntervalSpy.mockRestore();
            setTimeoutSpy.mockRestore();
        }
    });

    it('drops a listen-key creation retry waiting in RateLimiter after final renderer teardown', async () => {
        const retryDelay = 1000;
        const reconnectDelay = 5 * 1000;
        const keepAliveDelay = 30 * 60 * 1000;
        const creationRendererStates = [];
        const retryableError = Object.assign(
            new Error('listen-key creation connection reset'),
            { code: 'ECONNRESET' },
        );

        moduleMocks.sendRequest.mockImplementation(async (path, method) => {
            if (path === '/api/v3/time' && method === 'GET') {
                return {
                    data: vi.fn().mockResolvedValue({ serverTime: Date.now() }),
                };
            }

            if (path === '/api/v3/userDataStream' && method === 'POST') {
                creationRendererStates.push(moduleMocks.rendererConnection.connected);
                throw retryableError;
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
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
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
        const getUserDataStreamCalls = () => moduleMocks.connect.mock.calls.filter(
            ([{ stream }]) => stream !== '!miniTicker@arr',
        );
        const getUserDataIntervals = () => setIntervalSpy.mock.calls.filter(
            ([, delay]) => delay === keepAliveDelay,
        );
        const getRateLimiterRetryTimers = () => setTimeoutSpy.mock.calls.filter(
            ([, delay]) => delay === retryDelay,
        );
        const getRateLimiterRetryWarnings = () => console.warn.mock.calls.filter(
            ([message]) => (
                message === 'network error (ECONNRESET), retrying in 1000ms (attempt 1/2)'
            ),
        );
        const getReconnectSchedules = () => console.info.mock.calls.filter(
            ([message]) => message === 'Scheduling User Data Stream reconnection...',
        );
        const getListenKeySuccessLogs = () => console.info.mock.calls.filter(
            ([message]) => message === 'Listen Key obtained successfully.',
        );
        const getListenKeyFailureLogs = () => console.error.mock.calls.filter(
            ([message]) => (
                message === 'Failed to obtain listenKey'
                || message === 'Failed to start User Data Stream:'
            ),
        );
        const expectNoUserDataState = () => {
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);
            expect(connectUserDataStream).not.toHaveBeenCalled();
            expect(getUserDataStreamCalls()).toEqual([]);
            expect(moduleMocks.userDataSocket.on).not.toHaveBeenCalled();
            expect(moduleMocks.userDataSocket.handlers.message).toBeUndefined();
            expect(moduleMocks.userDataSocket.handlers.error).toBeUndefined();
            expect(moduleMocks.userDataSocket.handlers.close).toBeUndefined();
            expect(getUserDataIntervals()).toEqual([]);
            expect(renewListenKey).not.toHaveBeenCalled();
            expect(getRenewalRequests()).toEqual([]);
            expect(getReconnectSchedules()).toEqual([]);
            expect(getListenKeySuccessLogs()).toEqual([]);
            expect(getListenKeyFailureLogs()).toEqual([]);
        };

        try {
            setupBinanceConnection({
                localWebSocketAccess: { host: '127.0.0.1' },
            });

            const request = {
                origin: 'http://localhost:5174',
                accept: vi.fn(() => moduleMocks.rendererConnection),
            };
            moduleMocks.websocketServerHandlers.request(request);
            await activateSpotRuntime();

            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(true);
            expect(creationRendererStates).toEqual([true]);
            expect(createListenKey).toHaveBeenCalledOnce();
            expect(getListenKeyRequests()).toHaveLength(1);
            expect(getRateLimiterRetryWarnings()).toHaveLength(1);
            expect(getRateLimiterRetryTimers()).toHaveLength(1);
            expect(getMarketStreamCalls()).toEqual([
                [{ stream: '!miniTicker@arr' }],
            ]);
            expectNoUserDataState();

            const retryBoundary = Date.now() + retryDelay;
            moduleMocks.rendererConnection.close();
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(moduleMocks.rendererConnection.close).toHaveBeenCalledOnce();
            expect(moduleMocks.marketSocket.disconnect).toHaveBeenCalledOnce();
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(retryDelay - 1);
            await flushMicrotasks();

            expect(Date.now()).toBe(retryBoundary - 1);
            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(vi.getTimerCount()).toBe(1);
            expectNoUserDataState();

            await vi.advanceTimersByTimeAsync(1);
            await flushMicrotasks();

            expect(Date.now()).toBe(retryBoundary);
            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(creationRendererStates).toEqual([true]);
            expect(vi.getTimerCount()).toBe(0);
            expect(getRateLimiterRetryWarnings()).toHaveLength(1);
            expectNoUserDataState();

            await vi.advanceTimersByTimeAsync(reconnectDelay);
            await flushMicrotasks();
            await vi.advanceTimersByTimeAsync(keepAliveDelay);
            await flushMicrotasks();

            expect(moduleMocks.rendererConnection.connected).toBe(false);
            expect(creationRendererStates).toEqual([true]);
            expect(getMarketStreamCalls()).toHaveLength(1);
            expect(getRateLimiterRetryWarnings()).toHaveLength(1);
            expectNoUserDataState();
        } finally {
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
            await activateSpotRuntime();

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
            await activateSpotRuntime();

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

    it('scrubs every retired Testnet and read-only environment value before renderer access', () => {
        vi.stubEnv('FUTURES_READ_MODE', 'testnet');
        vi.stubEnv('FUTURES_READ_ENVIRONMENT', 'testnet');
        vi.stubEnv('FUTURES_READ_MOCK_SCENARIO', 'one-way');
        vi.stubEnv('FUTURES_TESTNET_API_KEY', 'futures-testnet-key');
        vi.stubEnv('FUTURES_TESTNET_API_SECRET', 'futures-testnet-secret');
        vi.stubEnv('FUTURES_TESTNET_EXECUTION_ENABLED', 'true');

        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });

        expect(process.env.FUTURES_TESTNET_API_KEY).toBeUndefined();
        expect(process.env.FUTURES_TESTNET_API_SECRET).toBeUndefined();
        expect(process.env.FUTURES_TESTNET_EXECUTION_ENABLED).toBeUndefined();
        expect(process.env.FUTURES_READ_MODE).toBeUndefined();
        expect(process.env.FUTURES_READ_ENVIRONMENT).toBeUndefined();
        expect(process.env.FUTURES_READ_MOCK_SCENARIO).toBeUndefined();
        expect(process.env.BK).toBe('test-api-key');
        expect(process.env.BS).toBe('test-api-secret');
    });

    it('rejects outer-envelope legacy futures execution before any spot adapter call', async () => {
        const placeOrder = vi.spyOn(SpotTradingAdapter.prototype, 'placeOrder');
        const cancelOrder = vi.spyOn(SpotTradingAdapter.prototype, 'cancelOrder');

        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('spot');

        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                request: 'buyOrder',
                marketType: 'futures',
                data: {
                    marketType: 'spot',
                    symbol: 'BTCUSDT',
                    quantity: '0.01',
                    price: '50000',
                },
            }),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                request: 'cancelOrder',
                marketType: 'futures',
                data: {
                    marketType: 'spot',
                    symbol: 'BTCUSDT',
                    orderId: 12345,
                },
            }),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                request: 'sellOrder',
                marketType: 'futures',
                data: {
                    marketType: 'spot',
                    symbol: 'BTCUSDT',
                    quantity: '0.01',
                    price: '50000',
                },
            }),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'subscribe',
                marketType: 'futures',
                channelId: 'detail-BTCUSDT-1h-forged',
                channelType: 'detail',
                symbol: 'BTCUSDT',
                interval: '1h',
            }),
        });
        // The forged Spot frames above are refused while Spot is the activated
        // market; the typed Futures commands below need Futures to be, which is
        // the whole point of the gate. The refusals are read before switching.
        const forgedRejections = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.command_rejected?.code === 'UNSUPPORTED_MARKET_TYPE');
        await activateMarket('futures-live');
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'generic-futures-place',
                symbol: 'BTCUSDT',
                side: 'BUY',
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                price: '50000',
                quantity: '0.01',
            }),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.cancelOrder',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'generic-futures-cancel',
                symbol: 'BTCUSDT',
                orderId: '1',
            }),
        });

        expect(placeOrder).not.toHaveBeenCalled();
        expect(cancelOrder).not.toHaveBeenCalled();
        expect(forgedRejections).toHaveLength(4);
        expect(forgedRejections.map(payload => payload.command_rejected.request)).toEqual([
            'buyOrder',
            'cancelOrder',
            'sellOrder',
            'subscribe',
        ]);
        // Typed futures commands are first-class now and route to the futures adapter.
        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
        expect(moduleMocks.futuresAdapter.cancelOrder).toHaveBeenCalledOnce();
        const futuresUpdates = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_execution_update);
        expect(futuresUpdates.length).toBeGreaterThanOrEqual(2);
    });

    // Every history read is spaced by the futures limiter, so the handler only
    // completes as the clock moves: the fan-out is several admissions, not one.
    const runFuturesCommand = async (command) => {
        const pending = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                ...command,
            }),
        });
        await vi.advanceTimersByTimeAsync(5_000);
        await pending;
    };

    it('answers a futures history command without touching account resources', async () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-1',
            symbol: 'BTCUSDT',
        });

        expect(moduleMocks.futuresAdapter.getOrderHistory).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
        const [history] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_history);
        expect(history.futures_history).toMatchObject({
            symbol: 'BTCUSDT',
            symbols: ['BTCUSDT'],
            orders: [{ orderId: 1, status: 'FILLED' }],
            trades: [{ id: 2, realizedPnl: '-96.74' }],
            error: null,
        });
    });

    // A session spans the contracts it was traded on, not the one on screen. The
    // symbols come from income history, which is the only USDⓈ-M read that answers
    // the question without being told a contract first.
    it('reads the history of every contract the account traded lately', async () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockResolvedValueOnce({
            symbols: ['BICOUSDT', 'BTCUSDT', 'BEATUSDT'], full: false, lastTime: 9,
        });
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ symbol }) => (
            Promise.resolve([{ id: 2, symbol, realizedPnl: '1', time: symbol === 'BICOUSDT' ? 9 : 1 }])
        ));
        // One contract refusing must not blank the rest of the review.
        moduleMocks.futuresAdapter.getOrderHistory.mockImplementation(({ symbol }) => (
            symbol === 'BEATUSDT'
                ? Promise.reject(Object.assign(new Error('nope'), { code: -1121 }))
                : Promise.resolve([{ orderId: 1, symbol, status: 'FILLED', time: 1 }])
        ));

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-3',
            symbol: 'ETHUSDT',
        });

        const requested = moduleMocks.futuresAdapter.getTradeHistory.mock.calls
            .map(([{ symbol }]) => symbol);
        // The contract on screen leads the list, then what the account traded.
        expect(requested).toEqual(['ETHUSDT', 'BICOUSDT', 'BTCUSDT', 'BEATUSDT']);
        const [history] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_history);
        expect(history.futures_history.error).toBeNull();
        expect(history.futures_history.symbols).not.toContain('BEATUSDT');
        // Newest first across contracts, whichever contract they are on.
        expect(history.futures_history.trades[0].symbol).toBe('BICOUSDT');
        expect(history.futures_history.trades).toHaveLength(3);
    });

    // Income is answered oldest-first from the start time given, so a week that
    // overruns one page hands back the contracts traded a week ago and never
    // reaches this morning's. The walk goes forward until a page comes back short.
    it('walks income to the recent end and reports the contracts it could not read', async () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const older = ['A1USDT', 'A2USDT', 'A3USDT', 'A4USDT', 'A5USDT', 'A6USDT', 'A7USDT'];
        const newer = ['B1USDT', 'B2USDT', 'B3USDT', 'B4USDT', 'B5USDT', 'B6USDT'];
        moduleMocks.futuresAdapter.getTradedSymbolPage
            .mockResolvedValueOnce({ symbols: older, full: true, lastTime: 100 })
            .mockResolvedValueOnce({ symbols: newer, full: false, lastTime: 900 });

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-4',
            symbol: 'ETHUSDT',
        });

        const [, secondPage] = moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls;
        expect(secondPage[0].startTime).toBe(101);
        const [history] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_history);
        const { symbols, discovered } = history.futures_history;
        // Fourteen contracts are known and twelve are read: the contract on screen,
        // then everything from the newest page, then the oldest page until the cap.
        expect(discovered).toBe(14);
        expect(symbols).toHaveLength(12);
        expect(symbols.slice(0, 7)).toEqual(['ETHUSDT', ...newer]);
        expect(symbols).not.toContain('A6USDT');
        expect(symbols).not.toContain('A7USDT');
        // The walk ended because a page came back short, so the count above is
        // the whole set the fan-out was choosing from.
        expect(history.futures_history.discoveryComplete).toBe(true);
    });

    // The count of traded contracts is itself a read. When it fails halfway, the
    // pages already paid for still cover part of the session — and the review must
    // not report the contracts it found as though they were all of them.
    it('keeps the pages it already read when discovery fails, and says it is short', async () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.getTradedSymbolPage
            .mockResolvedValueOnce({ symbols: ['BICOUSDT'], full: true, lastTime: 100 })
            .mockRejectedValueOnce(Object.assign(new Error('gone'), { code: -1003 }));

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-5',
            symbol: 'ETHUSDT',
        });

        const [history] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_history);
        expect(history.futures_history.error).toBeNull();
        expect(history.futures_history.symbols).toContain('BICOUSDT');
        expect(history.futures_history.discoveryComplete).toBe(false);
    });

    // The position read reports neither leverage nor margin mode any more, so both
    // are asked for per contract and pushed to whoever is watching.
    it('answers a contract configuration read with the leverage and its ceiling', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');

        await runFuturesCommand({
            action: 'account.symbolConfig',
            clientOrderId: 'config-1',
            symbol: 'BTCUSDT',
        });

        expect(moduleMocks.futuresAdapter.getSymbolConfig).toHaveBeenCalledWith('BTCUSDT');
        expect(moduleMocks.futuresAdapter.getMaxLeverage).toHaveBeenCalledWith('BTCUSDT');
        const [configs] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_symbol_configs);
        expect(configs.futures_symbol_configs.BTCUSDT).toMatchObject({
            symbol: 'BTCUSDT',
            leverage: 20,
            maxLeverage: 125,
            marginType: 'CROSSED',
        });
    });

    // Leverage places no order, but it changes what every entry costs and where an
    // open position liquidates, so it re-reads both the config and the account.
    it('applies a leverage change and reports the leverage the exchange applied', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        // Binance lowers a setting a position is too large for rather than
        // refusing it, so the figure shown is the one it answered with.
        moduleMocks.futuresAdapter.getSymbolConfig.mockResolvedValue({
            symbol: 'BTCUSDT', leverage: 20, marginType: 'CROSSED', maxNotionalValue: '5000000',
        });

        await runFuturesCommand({
            action: 'trade.setLeverage',
            clientOrderId: 'leverage-1',
            symbol: 'BTCUSDT',
            leverage: 50,
        });

        expect(moduleMocks.futuresAdapter.setLeverage)
            .toHaveBeenCalledWith({ symbol: 'BTCUSDT', leverage: 50 });
        const payloads = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        const [configs] = payloads.filter(payload => payload.futures_symbol_configs);
        expect(configs.futures_symbol_configs.BTCUSDT.leverage).toBe(20);
        expect(payloads.some(payload => payload.command_rejected)).toBe(false);
    });

    // The same exposure the stale-working-order fix answered, in the read that
    // states the leverage: a configuration read that began before a mutation lands
    // after it, and nothing behind it corrects the record until the next refresh.
    it('drops a configuration read that a mutation overtook', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        let answerConfigRead;
        moduleMocks.futuresAdapter.getSymbolConfig.mockReturnValueOnce(new Promise((resolve) => {
            answerConfigRead = resolve;
        }));

        const configRead = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.symbolConfig',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'config-stale',
                symbol: 'BTCUSDT',
            }),
        });
        await vi.advanceTimersByTimeAsync(1_000);

        // A fill lands while that read is in flight, so the world it describes is
        // one the desk has already moved past.
        await runFuturesCommand({
            action: 'trade.placeOrder',
            clientOrderId: 'overtaking-order',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            price: '50000',
            quantity: '0.01',
        });
        answerConfigRead({ symbol: 'BTCUSDT', leverage: 5, marginType: 'CROSSED' });
        await vi.advanceTimersByTimeAsync(5_000);
        await configRead;

        const stale = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_symbol_configs)
            .filter(payload => payload.futures_symbol_configs.BTCUSDT?.leverage === 5);
        expect(stale).toEqual([]);
    });

    // Isolated caps a losing position at the margin behind it; cross stands the
    // whole wallet behind it. Like leverage, the mode changes what a position
    // liquidates at, so the account is re-read after it.
    it('applies a margin-mode change and re-reads the contract after it', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.getSymbolConfig.mockResolvedValue({
            symbol: 'EPICUSDT', leverage: 2, marginType: 'ISOLATED', maxNotionalValue: '500000',
        });

        const refreshesBefore = moduleMocks.futuresAdapter.getAccountRefreshOperations.mock.calls.length;
        await runFuturesCommand({
            action: 'trade.setMarginType',
            clientOrderId: 'margin-type-1',
            symbol: 'EPICUSDT',
            marginType: 'ISOLATED',
        });

        expect(moduleMocks.futuresAdapter.setMarginType)
            .toHaveBeenCalledWith({ symbol: 'EPICUSDT', marginType: 'ISOLATED' });
        expect(moduleMocks.futuresAdapter.getAccountRefreshOperations.mock.calls.length)
            .toBeGreaterThan(refreshesBefore);
        const payloads = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        const [configs] = payloads.filter(payload => payload.futures_symbol_configs);
        expect(configs.futures_symbol_configs.EPICUSDT.marginType).toBe('ISOLATED');
        expect(payloads.some(payload => payload.command_rejected)).toBe(false);
    });

    // Binance answers a mode the contract is already in with -4046. The desk
    // asked for a state and the state is held: reporting that as a failure would
    // put a red card in front of the operator every time the default confirmed
    // what was already true.
    it('treats an unchanged margin mode as the mode being held, not as a failure', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.setMarginType.mockRejectedValue(
            Object.assign(new Error('No need to change margin type.'), { code: -4046 }),
        );
        moduleMocks.futuresAdapter.getSymbolConfig.mockResolvedValue({
            symbol: 'EPICUSDT', leverage: 2, marginType: 'ISOLATED', maxNotionalValue: '500000',
        });

        const refreshesBefore = moduleMocks.futuresAdapter.getAccountRefreshOperations.mock.calls.length;
        await runFuturesCommand({
            action: 'trade.setMarginType',
            clientOrderId: 'margin-type-2',
            symbol: 'EPICUSDT',
            marginType: 'ISOLATED',
        });

        const payloads = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        expect(payloads.some(payload => payload.command_rejected)).toBe(false);
        // The reading is still corrected — -4046 says the desk's own record of
        // the mode was the stale one — but nothing moved, so nothing is re-read
        // at the price of a full account refresh.
        const [configs] = payloads.filter(payload => payload.futures_symbol_configs);
        expect(configs.futures_symbol_configs.EPICUSDT.marginType).toBe('ISOLATED');
        expect(moduleMocks.futuresAdapter.getAccountRefreshOperations.mock.calls.length)
            .toBe(refreshesBefore);
    });

    it('refuses a margin-mode change while trading is paused', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await runFuturesCommand({
            action: 'trade.setTradingPaused',
            clientOrderId: 'pause-margin-type',
            paused: true,
        });

        await runFuturesCommand({
            action: 'trade.setMarginType',
            clientOrderId: 'margin-type-3',
            symbol: 'EPICUSDT',
            marginType: 'ISOLATED',
        });

        expect(moduleMocks.futuresAdapter.setMarginType).not.toHaveBeenCalled();
        const [rejection] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.command_rejected);
        expect(rejection.command_rejected).toMatchObject({
            code: 'FUTURES_TRADING_PAUSED',
            request: 'trade.setMarginType',
        });
    });

    it('refuses a leverage change while trading is paused and reports the refusal', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await runFuturesCommand({
            action: 'trade.setTradingPaused',
            clientOrderId: 'pause-1',
            paused: true,
        });

        await runFuturesCommand({
            action: 'trade.setLeverage',
            clientOrderId: 'leverage-2',
            symbol: 'BTCUSDT',
            leverage: 50,
        });

        expect(moduleMocks.futuresAdapter.setLeverage).not.toHaveBeenCalled();
        const [rejection] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.command_rejected);
        expect(rejection.command_rejected).toMatchObject({
            code: 'FUTURES_TRADING_PAUSED',
            request: 'trade.setLeverage',
        });
    });

    it('reports a failed futures history read inside the history payload', async () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const refusal = Object.assign(new Error('Invalid API-key, IP, or permissions for action'), {
            code: -2015,
        });
        moduleMocks.futuresAdapter.getOrderHistory.mockRejectedValue(refusal);

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-2',
            symbol: 'BTCUSDT',
        });

        const payloads = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        const [history] = payloads.filter(payload => payload.futures_history);
        expect(history.futures_history.error).toMatchObject({
            code: 'FUTURES_API_ERROR',
            binanceCode: -2015,
        });
        expect(history.futures_history.error.message).toContain('Futures');
        // The failure stays inside history: no command rejection, no resync.
        expect(payloads.some(payload => payload.command_rejected)).toBe(false);
    });

    // The audit case: a submission whose outcome Binance never confirmed. The
    // old path called it a rejection, and resubmitting it created a second real
    // order. These tests pin the three answers reconciliation can give.
    // Nothing market-scoped is accepted before its market is activated, so a
    // renderer that wants to trade Futures says so first — exactly as the real
    // one does.
    const activateMarket = async (marketMode) => {
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode }),
        });
        moduleMocks.rendererConnection.sendUTF.mockClear();
    };

    const connectRenderer = async (marketMode = 'futures-live') => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        if (marketMode) await activateMarket(marketMode);
    };

    const placeFuturesOrder = (clientOrderId = 'ambiguous-1') => moduleMocks.rendererHandlers.message({
        type: 'utf8',
        utf8Data: JSON.stringify({
            action: 'trade.placeOrder',
            version: 1,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId,
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            price: '50000',
            quantity: '0.01',
        }),
    });

    const emitted = () => moduleMocks.rendererConnection.sendUTF.mock.calls
        .map(([message]) => JSON.parse(message));

    it('never resubmits an ambiguous placement whose order exists on the exchange', async () => {
        await connectRenderer();
        moduleMocks.futuresAdapter.placeOrder.mockRejectedValueOnce(
            Object.assign(new Error('Unknown error'), { status: 503, indeterminate: true }),
        );
        moduleMocks.futuresAdapter.findOrder.mockResolvedValueOnce({
            exists: true,
            report: { e: 'executionReport', symbol: 'BTCUSDT', status: 'NEW', orderId: 77 },
        });

        await placeFuturesOrder();

        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledTimes(1);
        expect(moduleMocks.futuresAdapter.findOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            orderId: undefined,
            origClientOrderId: 'ambiguous-1',
        });
        const payloads = emitted();
        // The operator is told it is unknown, never that it failed.
        expect(payloads.some(payload => payload.command_rejected)).toBe(false);
        expect(payloads.some(payload => payload.command_unresolved?.code === 'FUTURES_OUTCOME_PENDING')).toBe(true);
        // …and then told the truth: the order is live.
        expect(payloads.some(payload => payload.futures_execution_update?.orderId === 77)).toBe(true);
    });

    // Binance's order state is eventually consistent after an ambiguous
    // submission, so "no such order" is only believed once every attempt says so.
    it('reports an ambiguous placement the exchange never received as an ordinary refusal', async () => {
        await connectRenderer();
        moduleMocks.futuresAdapter.placeOrder.mockRejectedValueOnce(
            Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
        );
        moduleMocks.futuresAdapter.findOrder.mockResolvedValue({ exists: false, report: null });

        const pending = placeFuturesOrder('ambiguous-2');
        await vi.advanceTimersByTimeAsync(5_000);
        await pending;

        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledTimes(1);
        expect(moduleMocks.futuresAdapter.findOrder).toHaveBeenCalledTimes(3);
        const payloads = emitted();
        expect(payloads.some(payload => payload.command_rejected?.code === 'FUTURES_API_ERROR')).toBe(true);
        // The warning it raised is withdrawn by name, so it withdraws only its own.
        const resolved = payloads.find(payload => payload.command_resolved);
        expect(resolved.command_resolved.details).toMatchObject({
            marketType: 'futures',
            symbol: 'BTCUSDT',
            clientOrderId: 'ambiguous-2',
        });
    });

    // Spot has no per-order presentation to read an execution report as an
    // answer, so its unknown outcome is ended by name or not at all: the desk
    // stood at "outcome unconfirmed" over an order Binance had confirmed it
    // holds, and every envelope about it named no order to match on.
    it('answers a Spot unresolved outcome by the identity it was raised with', async () => {
        await connectRenderer('spot');
        moduleMocks.spotClient.restAPI.newOrder.mockRejectedValueOnce(
            Object.assign(new Error('Service unavailable'), { status: 503 }),
        );

        const pending = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder',
                version: 1,
                marketType: 'spot',
                accountId: 'default',
                clientOrderId: 'spot-ambiguous-1',
                symbol: 'PAXUSDT',
                side: 'BUY',
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                price: '0.9990',
                quantity: '20',
            }),
        });
        await vi.advanceTimersByTimeAsync(5_000);
        await pending;

        const payloads = emitted();
        expect(payloads.find(payload => payload.command_unresolved)?.command_unresolved.details)
            .toMatchObject({
                marketType: 'spot',
                symbol: 'PAXUSDT',
                clientOrderId: 'spot-ambiguous-1',
            });
        // The exchange holds it, so the warning is withdrawn — by name.
        expect(payloads.find(payload => payload.command_resolved)?.command_resolved.details)
            .toMatchObject({
                marketType: 'spot',
                symbol: 'PAXUSDT',
                clientOrderId: 'spot-ambiguous-1',
                reconciled: true,
            });
        expect(payloads.some(payload => payload.command_rejected)).toBe(false);
    });

    it('names the order in a Spot refusal, so the refusal can end the warning it raised', async () => {
        await connectRenderer('spot');
        moduleMocks.spotClient.restAPI.newOrder.mockRejectedValueOnce(
            Object.assign(new Error('Account has insufficient balance'), {
                status: 400,
                code: -2010,
            }),
        );

        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder',
                version: 1,
                marketType: 'spot',
                accountId: 'default',
                clientOrderId: 'spot-refused-1',
                symbol: 'PAXUSDT',
                side: 'BUY',
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                price: '0.9990',
                quantity: '20',
            }),
        });
        await flushMicrotasks();

        expect(emitted().find(payload => payload.command_rejected)?.command_rejected.details)
            .toMatchObject({
                marketType: 'spot',
                symbol: 'PAXUSDT',
                clientOrderId: 'spot-refused-1',
            });
    });

    it('does not conclude a placement is absent while the exchange is still catching up', async () => {
        await connectRenderer();
        moduleMocks.futuresAdapter.placeOrder.mockRejectedValueOnce(
            Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
        );
        moduleMocks.futuresAdapter.findOrder
            .mockResolvedValueOnce({ exists: false, report: null })
            .mockResolvedValueOnce({
                exists: true,
                report: { symbol: 'BTCUSDT', orderId: 991, clientOrderId: 'ambiguous-4', status: 'NEW' },
            });

        const pending = placeFuturesOrder('ambiguous-4');
        await vi.advanceTimersByTimeAsync(5_000);
        await pending;

        const payloads = emitted();
        expect(payloads.some(payload => payload.command_rejected)).toBe(false);
        expect(payloads.some(payload => (
            payload.futures_execution_update?.clientOrderId === 'ambiguous-4'
        ))).toBe(true);
    });

    it('leaves an unreconcilable outcome unresolved and offers no retry', async () => {
        await connectRenderer();
        moduleMocks.futuresAdapter.placeOrder.mockRejectedValueOnce(
            Object.assign(new Error('Unknown error'), { status: 500 }),
        );
        moduleMocks.futuresAdapter.findOrder.mockRejectedValue(
            Object.assign(new Error('Unknown error'), { status: 500 }),
        );

        // Reconciliation backs off between attempts, so the timers have to run
        // before the command settles.
        const pending = placeFuturesOrder('ambiguous-3');
        await vi.advanceTimersByTimeAsync(5_000);
        await pending;

        const payloads = emitted();
        expect(payloads.some(payload => payload.command_rejected)).toBe(false);
        const unknown = payloads.filter(p => p.command_unresolved?.code === 'FUTURES_OUTCOME_UNKNOWN');
        expect(unknown).toHaveLength(1);
        expect(unknown[0].command_unresolved.message).toMatch(/before acting on it/);
    });

    it('reports a determinate refusal without asking the exchange anything', async () => {
        await connectRenderer();
        moduleMocks.futuresAdapter.placeOrder.mockRejectedValueOnce(
            Object.assign(new Error('Margin is insufficient.'), { status: 400, code: -2019 }),
        );

        await placeFuturesOrder('determinate-1');

        expect(moduleMocks.futuresAdapter.findOrder).not.toHaveBeenCalled();
        const payloads = emitted();
        expect(payloads.some(payload => payload.command_unresolved)).toBe(false);
        expect(payloads.some(payload => payload.command_rejected?.details?.binanceCode === -2019)).toBe(true);
    });

    it('runs a reconciliation requested while one is in flight instead of dropping it', async () => {
        // The old code returned early when a refresh was already running, so the
        // read that follows a trade silently never happened and the panel kept
        // showing the pre-trade account until the operator pressed Ctrl+R.
        let releaseFirstPass;
        const firstPassGate = new Promise((resolve) => { releaseFirstPass = resolve; });
        let passes = 0;
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockImplementation(() => {
            passes += 1;
            const pass = passes;
            return [{
                type: 'balances',
                weight: 1,
                errorLabel: 'balances',
                loadPayload: async () => {
                    if (pass === 1) await firstPassGate;
                    return { futures_balances: { USDT: { available: String(pass), total: String(pass) } } };
                },
            }];
        });
        await connectRenderer();

        const refresh = clientOrderId => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.refresh',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId,
                symbol: 'BTCUSDT',
            }),
        });

        const first = refresh('refresh-1');
        await flushMicrotasks();
        const second = refresh('refresh-2');
        await flushMicrotasks();
        releaseFirstPass();
        // The limiter spaces admissions, so the second pass only runs once the
        // timers do.
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        await second;
        await first;

        expect(passes).toBe(2);
        const balances = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_account_state')
            .map(payload => payload.resources.balances.data?.USDT?.available)
            .filter(Boolean);
        expect(balances.at(-1)).toBe('2');
    });

    it('does not let a snapshot started before a trade overwrite the state that trade produced', async () => {
        let releaseSnapshot;
        const snapshotGate = new Promise((resolve) => { releaseSnapshot = resolve; });
        let passes = 0;
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockImplementation(() => {
            passes += 1;
            const pass = passes;
            return [{
                type: 'regularOrders',
                weight: 1,
                errorLabel: 'regular orders',
                loadPayload: async () => {
                    // The first read is the stale one: it began before the
                    // placement and describes an account with no orders.
                    if (pass === 1) await snapshotGate;
                    return {
                        futures_regular_orders: pass === 1
                            ? []
                            : [{ symbol: 'BTCUSDT', orderId: 77, orderKind: 'REGULAR', status: 'NEW' }],
                    };
                },
            }];
        });
        await connectRenderer();

        // Not awaited: this read is deliberately still in flight when the
        // placement lands.
        const staleRead = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.refresh',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'stale-refresh',
                symbol: 'BTCUSDT',
            }),
        });
        await flushMicrotasks();

        const placement = placeFuturesOrder('epoch-1');
        await flushMicrotasks();
        releaseSnapshot();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        await placement;
        await staleRead;

        const orderSnapshots = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_account_state')
            .filter(payload => payload.resources.regularOrders.status === 'ready')
            .map(payload => payload.resources.regularOrders.data);
        // The pre-trade snapshot is discarded rather than applied as an empty book.
        expect(orderSnapshots.every(orders => orders.length === 1)).toBe(true);
        expect(orderSnapshots.at(-1)[0]).toMatchObject({ orderId: 77 });
    });

    it('reports a failed Spot placement and cancellation to the operator, not only to the log', async () => {
        await connectRenderer('spot');
        moduleMocks.spotClient.restAPI.newOrder = vi.fn().mockRejectedValue(
            Object.assign(new Error('Filter failure: MIN_NOTIONAL'), { status: 400, code: -1013 }),
        );
        moduleMocks.spotClient.restAPI.deleteOrder = vi.fn().mockRejectedValue(
            Object.assign(new Error('Unknown order sent.'), { status: 400, code: -2011 }),
        );

        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder',
                version: 1,
                marketType: 'spot',
                accountId: 'default',
                clientOrderId: 'spot-fail-1',
                symbol: 'BTCUSDT',
                side: 'BUY',
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                price: '50000',
                quantity: '0.01',
            }),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.cancelOrder',
                version: 1,
                marketType: 'spot',
                accountId: 'default',
                clientOrderId: 'spot-fail-2',
                symbol: 'BTCUSDT',
                orderId: '5',
            }),
        });

        const rejections = emitted()
            .filter(payload => payload.command_rejected?.code === 'SPOT_API_ERROR');
        expect(rejections.map(payload => payload.command_rejected.request)).toEqual([
            'trade.placeOrder',
            'trade.cancelOrder',
        ]);
        expect(rejections[0].command_rejected.details.binanceCode).toBe(-1013);
    });

    it('pins local renderer frame/message bounds and rejects malformed or oversized messages', async () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1', port: 14477 },
        });

        expect(moduleMocks.WebSocketServer).toHaveBeenCalledWith(expect.objectContaining({
            autoAcceptConnections: false,
            maxReceivedFrameSize: LOCAL_RENDERER_WS_MAX_FRAME_BYTES,
            maxReceivedMessageSize: LOCAL_RENDERER_WS_MAX_MESSAGE_BYTES,
        }));

        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });

        await expect(moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: '{"action":',
        })).resolves.toBeUndefined();
        await expect(moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: '[]',
        })).resolves.toBeUndefined();
        await expect(moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: 'x'.repeat(LOCAL_RENDERER_WS_MAX_MESSAGE_BYTES + 1),
        })).resolves.toBeUndefined();

        expect(moduleMocks.rendererConnection.drop).toHaveBeenCalledWith(1009, 'message too large');
    });

    it('does not route retired Testnet/read-only protocols to Production or Spot', async () => {
        const spotPlaceOrder = vi.spyOn(SpotTradingAdapter.prototype, 'placeOrder');
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1', port: 14477 },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });

        const subscribeRaw = JSON.stringify({
            action: 'futures.execution.subscribeStatus',
            version: 1,
            revision: '0',
            marketType: 'futures',
            environment: 'testnet',
            symbol: 'BTCUSDT',
        });
        const duplicateKeyRaw = '{"action":"futures.execution.placeOrder","action":"futures.execution.placeOrder","version":1}';
        const escapedDuplicateRaw = '{"action":"futures.\\u0065xecution.placeOrder","action":"trade.placeOrder","version":1,"marketType":"spot","accountId":"default","clientOrderId":"smuggled-spot","symbol":"BTCUSDT","side":"BUY","orderType":"LIMIT","timeInForce":"GTC","price":"50000","quantity":"0.01"}';
        const readOnlySmuggleRaw = '{"action":"futures.read.subscribe","action":"trade.placeOrder","version":1,"marketType":"spot","accountId":"default","clientOrderId":"smuggled-read","symbol":"BTCUSDT","side":"BUY","orderType":"LIMIT","timeInForce":"GTC","price":"50000","quantity":"0.01"}';
        const escapedReadOnlySmuggleRaw = '{"action":"futures.\\u0072ead.subscribe","action":"trade.placeOrder","version":1,"marketType":"spot","accountId":"default","clientOrderId":"smuggled-escaped-read","symbol":"BTCUSDT","side":"BUY","orderType":"LIMIT","timeInForce":"GTC","price":"50000","quantity":"0.01"}';
        const testnetWorkstationSmuggleRaw = '{"action":"futures.testnet.workstation.subscribe","action":"trade.placeOrder","version":1,"marketType":"spot","accountId":"default","clientOrderId":"smuggled-testnet","symbol":"BTCUSDT","side":"BUY","orderType":"LIMIT","timeInForce":"GTC","price":"50000","quantity":"0.01"}';
        const retiredChannelSmuggleRaw = '{"channelId":"futures-testnet-workstation","action":"trade.placeOrder","version":1,"marketType":"spot","accountId":"default","clientOrderId":"smuggled-channel","symbol":"BTCUSDT","side":"BUY","orderType":"LIMIT","timeInForce":"GTC","price":"50000","quantity":"0.01"}';
        const preConversionOversizedRaw = JSON.stringify({
            action: 'futures.execution.placeOrder',
            padding: 'x'.repeat(4_096),
        });
        expect(Buffer.byteLength(preConversionOversizedRaw, 'utf8')).toBeGreaterThan(4_096);
        expect(Buffer.byteLength(preConversionOversizedRaw, 'utf8')).toBeLessThanOrEqual(
            LOCAL_RENDERER_WS_MAX_MESSAGE_BYTES,
        );
        for (const raw of [
            subscribeRaw,
            duplicateKeyRaw,
            escapedDuplicateRaw,
            readOnlySmuggleRaw,
            escapedReadOnlySmuggleRaw,
            testnetWorkstationSmuggleRaw,
            retiredChannelSmuggleRaw,
            preConversionOversizedRaw,
        ]) {
            await moduleMocks.rendererHandlers.message({ type: 'utf8', utf8Data: raw });
        }

        expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
        expect(spotPlaceOrder).not.toHaveBeenCalled();
    });

    it('pauses futures order placement in-memory while cancels stay allowed', async () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1', port: 14477 },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const sendTyped = payload => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ version: 1, marketType: 'futures', ...payload }),
        });

        await sendTyped({ action: 'trade.setTradingPaused', paused: true });
        await sendTyped({
            action: 'trade.placeOrder',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            price: '50000',
            quantity: '0.01',
        });
        await sendTyped({ action: 'trade.cancelOrder', symbol: 'BTCUSDT', orderId: '1' });

        expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
        expect(moduleMocks.futuresAdapter.cancelOrder).toHaveBeenCalledOnce();
        const messages = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        expect(messages.some(payload => payload.futures_trading_paused === true)).toBe(true);
        expect(messages.some(payload => (
            payload.command_rejected?.code === 'FUTURES_TRADING_PAUSED'
        ))).toBe(true);

        await sendTyped({ action: 'trade.setTradingPaused', paused: false });
        await sendTyped({
            action: 'trade.placeOrder',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            price: '50000',
            quantity: '0.01',
        });
        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
    });

    it('enforces FUTURES_MAX_ORDER_USDT on entries but never on reduce-only orders', async () => {
        vi.stubEnv('FUTURES_MAX_ORDER_USDT', '100');
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1', port: 14477 },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'activate_market',
                marketMode: 'futures-live',
            }),
        });
        const sendOrder = payload => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder',
                version: 1,
                marketType: 'futures',
                symbol: 'BTCUSDT',
                side: 'BUY',
                ...payload,
            }),
        });

        // 0.01 × 50000 = 500 USDT > 100 USDT cap → rejected before the adapter.
        await sendOrder({ orderType: 'LIMIT', timeInForce: 'GTC', price: '50000', quantity: '0.01' });
        expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
        const rejection = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .find(payload => payload.command_rejected?.code === 'FUTURES_ORDER_CAP_EXCEEDED');
        expect(rejection.command_rejected.details).toMatchObject({ capUsdt: 100 });
        expect(moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .some(payload => payload.futures_max_order_usdt === '100')).toBe(true);

        // 0.001 × 50000 = 50 USDT ≤ cap → placed.
        await sendOrder({ orderType: 'LIMIT', timeInForce: 'GTC', price: '50000', quantity: '0.001' });
        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();

        // Reduce-only market close is exempt regardless of size.
        await sendOrder({ side: 'SELL', orderType: 'MARKET', quantity: '10', positionSide: 'LONG', reduceOnly: true });
        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledTimes(2);
    });

    // The backend used to do market work for whichever market asked, including
    // one the operator had left and one they had not yet chosen.
    describe('the market activation gate', () => {
        const sendFuturesPlacement = () => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'ungated-1',
                symbol: 'BTCUSDT',
                side: 'BUY',
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                price: '50000',
                quantity: '0.01',
            }),
        });

        const sendSpotSubscribe = () => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'subscribe',
                channelId: 'detail-BTCUSDT-1h',
                channelType: 'detail',
                symbol: 'BTCUSDT',
                interval: '1h',
            }),
        });

        const refusals = () => emitted()
            .filter(payload => payload.command_rejected?.code === 'MARKET_NOT_ACTIVE');

        it('refuses a Futures command that arrives before any market is activated', async () => {
            await connectRenderer(null);

            await sendFuturesPlacement();

            expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
            expect(moduleMocks.futuresAdapter.getAccountRefreshOperations).not.toHaveBeenCalled();
            expect(refusals()[0].command_rejected.details).toMatchObject({
                marketType: 'futures',
                requiredMarketMode: 'futures-live',
                activeMarketMode: 'unselected',
            });
        });

        it('refuses a Futures command after the operator has switched to Spot', async () => {
            await connectRenderer('futures-live');
            await activateMarket('spot');

            await sendFuturesPlacement();

            expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
            expect(refusals()[0].command_rejected.details).toMatchObject({
                activeMarketMode: 'spot',
            });
        });

        // `subscribeChannel` used to activate Spot itself, so a stray subscribe
        // was enough to start market work nobody asked for.
        it('starts no Spot subscription before Spot is activated', async () => {
            await connectRenderer(null);

            await sendSpotSubscribe();

            expect(refusals()[0].command_rejected.details).toMatchObject({
                marketType: 'spot',
                requiredMarketMode: 'spot',
            });
            expect(moduleMocks.marketSocket.on).not.toHaveBeenCalled();
        });

        it('accepts the same commands once their market is the activated one', async () => {
            await connectRenderer('futures-live');

            await sendFuturesPlacement();

            expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
            expect(refusals()).toEqual([]);
        });

        // The market name is not enough: Spot → Futures → Spot leaves the name
        // equal to what a frame issued before the first switch carries.
        it('refuses a frame issued under a superseded activation of the same market', async () => {
            await connectRenderer('spot');
            await activateMarket('futures-live');
            await activateMarket('spot');

            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'subscribe',
                    channelId: 'detail-BTCUSDT-1h',
                    channelType: 'detail',
                    symbol: 'BTCUSDT',
                    interval: '1h',
                    generation: 1,
                }),
            });

            const superseded = emitted()
                .filter(payload => payload.command_rejected?.code === 'MARKET_ACTIVATION_SUPERSEDED');
            expect(superseded).toHaveLength(1);
            expect(superseded[0].command_rejected.details).toMatchObject({
                requiredMarketMode: 'spot',
                generation: 3,
            });
        });

        // The workstation channel accepts its own keys and nothing else, so a
        // frame that reached it still carrying the activation stamp was thrown
        // out as malformed: the chart, the book and the tape stayed empty while
        // each side was, on its own, correct.
        const sendWorkstationSubscribe = (overrides = {}) => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                ...createFuturesProductionWorkstationSubscribeRequest({
                    requestId: 'workstation-1',
                    symbol: 'BTCUSDT',
                    interval: '1m',
                }),
                ...overrides,
            }),
        });

        it('hands the workstation channel a request without the activation stamp', async () => {
            await connectRenderer('futures-live');

            await sendWorkstationSubscribe({ generation: 1 });
            await flushMicrotasks();

            expect(emitted().some(payload => (
                payload.type === FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE
            ))).toBe(true);
        });

        it('still refuses a workstation request issued under a superseded activation', async () => {
            await connectRenderer('futures-live');
            await activateMarket('spot');
            await activateMarket('futures-live');

            await sendWorkstationSubscribe({ generation: 1 });
            await flushMicrotasks();

            expect(emitted().some(payload => (
                payload.command_rejected?.code === 'MARKET_ACTIVATION_SUPERSEDED'
            ))).toBe(true);
            expect(emitted().some(payload => (
                payload.type === FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE
            ))).toBe(false);
        });

        it('accepts a frame carrying the activation that is current', async () => {
            await connectRenderer('spot');

            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'subscribe',
                    channelId: 'detail-BTCUSDT-1h',
                    channelType: 'detail',
                    symbol: 'BTCUSDT',
                    interval: '1h',
                    generation: 1,
                }),
            });

            expect(emitted().some(payload => (
                payload.command_rejected?.code === 'MARKET_ACTIVATION_SUPERSEDED'
            ))).toBe(false);
        });

        // Two activations used to run concurrently: the older one could finish
        // last and leave the backend on the market the operator left.
        it('settles on the last market requested when activations overlap', async () => {
            await connectRenderer(null);

            const first = moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'futures-live' }),
            });
            const second = moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'spot' }),
            });
            await Promise.all([first, second]);

            const activations = emitted().filter(payload => payload.type === 'market_activation');
            expect(activations.map(activation => activation.marketMode)).toEqual([
                'futures-live',
                'spot',
            ]);
            expect(activations.at(-1).generation).toBe(2);
        });

        it('acknowledges each activation with its own generation', async () => {
            await connectRenderer(null);

            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'futures-live' }),
            });
            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'spot' }),
            });

            const activations = emitted().filter(payload => payload.type === 'market_activation');
            expect(activations).toEqual([
                { type: 'market_activation', version: 1, marketMode: 'futures-live', generation: 1 },
                { type: 'market_activation', version: 1, marketMode: 'spot', generation: 2 },
            ]);
        });
    });

    // The audit's amendment case, checked where the renderer cannot be trusted
    // to have checked it: these frames are hand-built and never passed through
    // any renderer gate.
    describe('the order cap on amendments', () => {
        const amend = (overrides = {}) => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.replaceOrder',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'amend-1',
                symbol: 'BTCUSDT',
                side: 'BUY',
                orderId: 11,
                price: '40000',
                quantity: '0.004',
                ...overrides,
            }),
        });

        // The desk's own view of the book, so an exemption is a fact it read
        // rather than a claim the command carried.
        const loadWorkingOrders = async (orders) => {
            moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
                type: 'regularOrders',
                weight: 1,
                errorLabel: 'regular orders',
                loadPayload: async () => ({ futures_regular_orders: orders }),
            }]);
            // Fired, not awaited: the read is gated behind the rate limiter, so
            // the timers have to move before the message settles.
            const loaded = moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'account.refresh',
                    version: 1,
                    marketType: 'futures',
                    accountId: 'default',
                    clientOrderId: 'load-orders',
                    symbol: 'BTCUSDT',
                }),
            });
            await vi.advanceTimersByTimeAsync(1_000);
            await loaded;
        };

        it('refuses an amendment past the cap and issues no exchange request', async () => {
            vi.stubEnv('FUTURES_MAX_ORDER_USDT', '200');
            await connectRenderer();

            // 0.004 × 2 500 000 = 10 000 USDT against a 200 USDT ceiling.
            await amend({ price: '2500000' });

            expect(moduleMocks.futuresAdapter.modifyOrder).not.toHaveBeenCalled();
            const rejection = emitted()
                .find(payload => payload.command_rejected?.code === 'FUTURES_ORDER_CAP_EXCEEDED');
            expect(rejection.command_rejected.details).toMatchObject({
                marketType: 'futures',
                capUsdt: 200,
                notionalUsdt: '10000',
            });
            expect(rejection.command_rejected.message).toContain('FUTURES_MAX_ORDER_USDT');
        });

        it('lets an amendment inside the cap through unchanged', async () => {
            vi.stubEnv('FUTURES_MAX_ORDER_USDT', '200');
            await connectRenderer();

            // 0.004 × 40 000 = 160 USDT, the order the audit started from.
            await amend();

            expect(moduleMocks.futuresAdapter.modifyOrder).toHaveBeenCalledOnce();
            expect(emitted().some(payload => payload.command_rejected)).toBe(false);
        });

        it('exempts an amendment to an order the desk knows is reduce-only', async () => {
            vi.stubEnv('FUTURES_MAX_ORDER_USDT', '200');
            await connectRenderer();
            await loadWorkingOrders([{
                symbol: 'BTCUSDT',
                orderId: 11,
                clientOrderId: 'abc',
                orderKind: 'REGULAR',
                status: 'NEW',
                reduceOnly: true,
            }]);

            await amend({ price: '2500000' });

            expect(moduleMocks.futuresAdapter.modifyOrder).toHaveBeenCalledOnce();
        });

        it('caps an amendment to an order it cannot find rather than assuming an exit', async () => {
            vi.stubEnv('FUTURES_MAX_ORDER_USDT', '200');
            await connectRenderer();
            await loadWorkingOrders([{
                symbol: 'BTCUSDT',
                orderId: 99,
                clientOrderId: 'other',
                orderKind: 'REGULAR',
                status: 'NEW',
                reduceOnly: true,
            }]);

            await amend({ price: '2500000' });

            expect(moduleMocks.futuresAdapter.modifyOrder).not.toHaveBeenCalled();
        });

        it('leaves amendments alone when no cap is configured', async () => {
            await connectRenderer();

            await amend({ price: '2500000' });

            expect(moduleMocks.futuresAdapter.modifyOrder).toHaveBeenCalledOnce();
        });
    });

    // Margin moves between the wallet and one position. It places no order, so
    // the order ceiling has nothing to measure — but it is still a submission,
    // and travels the same gate, validation and outcome handling as one.
    describe('position margin adjustments', () => {
        const adjust = (overrides = {}) => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.adjustPositionMargin',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'margin-1',
                symbol: 'BTCUSDT',
                positionSide: 'BOTH',
                direction: 'ADD',
                amount: '250',
                ...overrides,
            }),
        });

        it('moves margin on the named position and re-reads the account', async () => {
            await connectRenderer();

            await adjust();

            expect(moduleMocks.futuresAdapter.adjustPositionMargin).toHaveBeenCalledExactlyOnceWith({
                symbol: 'BTCUSDT',
                positionSide: 'BOTH',
                direction: 'ADD',
                amount: '250',
            });
            expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
            expect(emitted().some(payload => payload.command_rejected)).toBe(false);
        });

        // The ceiling measures what an order puts at risk. Adding margin lowers
        // the risk on a position that already exists.
        it('does not measure a margin transfer against the order cap', async () => {
            vi.stubEnv('FUTURES_MAX_ORDER_USDT', '100');
            await connectRenderer();

            await adjust({ amount: '10000' });

            expect(moduleMocks.futuresAdapter.adjustPositionMargin).toHaveBeenCalledOnce();
            expect(emitted().some(payload => (
                payload.command_rejected?.code === 'FUTURES_ORDER_CAP_EXCEEDED'
            ))).toBe(false);
        });

        it('refuses to take margin out while trading is paused, but lets it in', async () => {
            await connectRenderer();
            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'trade.setTradingPaused',
                    version: 1,
                    marketType: 'futures',
                    paused: true,
                }),
            });

            await adjust({ direction: 'REMOVE', amount: '40' });
            expect(moduleMocks.futuresAdapter.adjustPositionMargin).not.toHaveBeenCalled();
            expect(emitted().some(payload => (
                payload.command_rejected?.code === 'FUTURES_TRADING_PAUSED'
            ))).toBe(true);

            await adjust();
            expect(moduleMocks.futuresAdapter.adjustPositionMargin).toHaveBeenCalledOnce();
        });

        it('refuses a margin adjustment while futures is not the active market', async () => {
            await connectRenderer('spot');

            await adjust();

            expect(moduleMocks.futuresAdapter.adjustPositionMargin).not.toHaveBeenCalled();
            expect(emitted().some(payload => (
                payload.command_rejected?.code === 'MARKET_NOT_ACTIVE'
            ))).toBe(true);
        });

        // A transfer carries no client id Binance would echo, so there is
        // nothing to reconcile by — and resending it would move the amount
        // twice. Unknown is stated as unknown.
        it('states an unanswered transfer as unresolved and never resends it', async () => {
            await connectRenderer();
            moduleMocks.futuresAdapter.adjustPositionMargin.mockRejectedValueOnce(
                Object.assign(new Error('socket hang up'), { status: 503, indeterminate: true }),
            );

            await adjust();

            expect(moduleMocks.futuresAdapter.adjustPositionMargin).toHaveBeenCalledOnce();
            const payloads = emitted();
            expect(payloads.some(payload => (
                payload.command_unresolved?.code === 'FUTURES_OUTCOME_UNKNOWN'
            ))).toBe(true);
            expect(payloads.some(payload => payload.command_rejected)).toBe(false);
        });

        it('reports a refused transfer with the exchange own code', async () => {
            await connectRenderer();
            moduleMocks.futuresAdapter.adjustPositionMargin.mockRejectedValueOnce(
                Object.assign(new Error('Add margin only supported for isolated'), { code: -4051 }),
            );

            await adjust();

            const rejection = emitted().find(payload => payload.command_rejected);
            expect(rejection.command_rejected).toMatchObject({
                request: 'trade.adjustPositionMargin',
                code: 'FUTURES_API_ERROR',
                details: { marketType: 'futures', binanceCode: -4051 },
            });
        });
    });

    it('rejects retired futures.production frames without touching any adapter', async () => {
        const spotPlaceOrder = vi.spyOn(SpotTradingAdapter.prototype, 'placeOrder');
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1', port: 14477 },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });

        for (const raw of [
            JSON.stringify({
                action: 'futures.production.subscribeStatus',
                version: 1,
                revision: '0',
                marketType: 'futures',
                environment: 'production',
                accountFingerprint: '0'.repeat(64),
            }),
            JSON.stringify({ action: 'futures.production.placeOrder', version: 1 }),
        ]) {
            await moduleMocks.rendererHandlers.message({ type: 'utf8', utf8Data: raw });
        }

        const rejections = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.command_rejected?.code === 'UNSUPPORTED_ACTION');
        expect(rejections).toHaveLength(2);
        expect(spotPlaceOrder).not.toHaveBeenCalled();
        expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
    });

    it('rejects removed hidden action aliases and bounded action/channel envelopes', async () => {
        const placeOrder = vi.spyOn(SpotTradingAdapter.prototype, 'placeOrder');
        const cancelOrder = vi.spyOn(SpotTradingAdapter.prototype, 'cancelOrder');

        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1', port: 14477 },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });

        await activateMarket('spot');

        for (const payload of [
            { action: 'order', symbol: 'BTCUSDT', side: 'BUY', quantity: '1', price: '1' },
            { action: 'cancelOrder', symbol: 'BTCUSDT', orderId: 1 },
            { action: 'subscribe', channelId: 'x'.repeat(129), channelType: 'mini', symbol: 'BTCUSDT', interval: '1h' },
            Object.fromEntries([
                ['action', 'subscribe'],
                ['channelId', 'mini-BTCUSDT-1h'],
                ['channelType', 'mini'],
                ['symbol', 'BTCUSDT'],
                ['interval', '1h'],
                ...Array.from({ length: 28 }, (_, index) => [`extra${index}`, index]),
            ]),
        ]) {
            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify(payload),
            });
        }

        for (let index = 0; index < 65; index += 1) {
            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'subscribe',
                    channelId: `mini-SYM${index}-1h`,
                    channelType: 'mini',
                    symbol: `SYM${index}`,
                    interval: '1h',
                }),
            });
        }

        expect(placeOrder).not.toHaveBeenCalled();
        expect(cancelOrder).not.toHaveBeenCalled();
        const rejectionCodes = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message).command_rejected?.code)
            .filter(Boolean);
        expect(rejectionCodes).toEqual(expect.arrayContaining([
            'UNSUPPORTED_ACTION',
            'INVALID_CHANNEL_ACTION',
            'INVALID_ACTION_ENVELOPE',
            'CHANNEL_LIMIT_EXCEEDED',
        ]));
    });

    it('runs positive typed Spot placement, cancellation, and refresh sequencing through main', async () => {
        const events = [];
        const makeResponse = (data) => ({ data: vi.fn().mockResolvedValue(data) });
        moduleMocks.spotClient.restAPI.newOrder = vi.fn(async (params) => {
            events.push('rest:newOrder');
            return makeResponse({
                symbol: params.symbol,
                side: params.side,
                type: params.type,
                status: 'NEW',
                orderId: 987,
                price: params.price,
                origQty: params.quantity,
                executedQty: '0',
                transactTime: Date.now(),
            });
        });
        moduleMocks.spotClient.restAPI.deleteOrder = vi.fn(async (params) => {
            events.push('rest:deleteOrder');
            return makeResponse({
                symbol: params.symbol,
                side: 'BUY',
                type: 'LIMIT',
                status: 'CANCELED',
                orderId: params.orderId,
                price: '12346',
                origQty: '99.9',
                executedQty: '0',
                updateTime: Date.now(),
            });
        });
        moduleMocks.spotClient.restAPI.getAccount = vi.fn(async () => {
            events.push('rest:balances');
            return makeResponse({ balances: [{ asset: 'USDT', free: '100', locked: '0' }] });
        });
        moduleMocks.spotClient.restAPI.getOpenOrders = vi.fn(async () => {
            events.push('rest:openOrders');
            return makeResponse([]);
        });
        moduleMocks.spotClient.restAPI.myTrades = vi.fn(async () => {
            events.push('rest:history');
            return makeResponse([]);
        });
        moduleMocks.rendererConnection.sendUTF.mockImplementation((message) => {
            const payload = JSON.parse(message);
            if (payload.execution_update) events.push(`emit:${payload.execution_update.X}`);
            if (payload.balances) events.push('emit:balances');
            if (payload.orders) events.push('emit:orders');
            if (payload.history) events.push('emit:history');
        });

        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1', port: 14477 },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('spot');
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();

        const sendCommand = async (payload) => {
            const pending = moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify(payload),
            });
            await flushMicrotasks();
            await vi.advanceTimersByTimeAsync(2_500);
            await pending;
            await flushMicrotasks();
        };

        events.length = 0;
        await sendCommand({
            action: 'trade.placeOrder',
            version: 1,
            marketType: 'spot',
            accountId: 'default',
            clientOrderId: 'spot-place-positive',
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            price: '12346',
            quantity: '99.9',
        });
        expect(moduleMocks.spotClient.restAPI.newOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            side: 'BUY',
            type: 'LIMIT',
            timeInForce: 'GTC',
            quantity: '99.9',
            price: '12346',
            newOrderRespType: 'FULL',
            recvWindow: 60000,
            // The command's own identity, so Binance can recognise a
            // resubmission of this intent instead of creating a second order.
            newClientOrderId: 'spot-place-positive',
        });
        expect(events).toEqual([
            'rest:newOrder',
            'emit:NEW',
            'rest:balances',
            'emit:balances',
            'rest:openOrders',
            'emit:orders',
            'rest:history',
            'emit:history',
        ]);

        events.length = 0;
        await sendCommand({
            action: 'trade.cancelOrder',
            version: 1,
            marketType: 'spot',
            accountId: 'default',
            clientOrderId: 'spot-cancel-positive',
            symbol: 'BTCUSDT',
            orderId: 987,
        });
        expect(moduleMocks.spotClient.restAPI.deleteOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            recvWindow: 60000,
            orderId: 987,
        });
        expect(events).toEqual([
            'rest:deleteOrder',
            'emit:CANCELED',
            'rest:balances',
            'emit:balances',
            'rest:openOrders',
            'emit:orders',
            'rest:history',
            'emit:history',
        ]);

        events.length = 0;
        await sendCommand({
            action: 'account.refresh',
            version: 1,
            marketType: 'spot',
            accountId: 'default',
            clientOrderId: 'spot-refresh-positive',
            symbol: 'BTCUSDT',
        });
        expect(events).toEqual([
            'rest:balances',
            'emit:balances',
            'rest:openOrders',
            'emit:orders',
            'rest:history',
            'emit:history',
        ]);
    });
    // The Spot chart used to end at the 500 candles the bootstrap delivers.
    // Depth behind that window is read on demand from the same reviewed public
    // klines route, and only for the selection the chart is actually showing.
    describe("the Spot chart's candle history", () => {
        const klinePage = (startMs, count) => Array.from({ length: count }, (_unused, index) => [
            startMs + index * 3_600_000,
            '10', '11', '9', '10.5', '100',
        ]);

        const openDetailChannel = async () => {
            await connectRenderer('spot');
            moduleMocks.spotClient.restAPI.klines = vi.fn(async () => ({
                data: vi.fn().mockResolvedValue(klinePage(1_700_000_000_000, 3)),
            }));
            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'subscribe',
                    channelId: 'detail-BTCUSDT-1h',
                    channelType: 'detail',
                    symbol: 'BTCUSDT',
                    interval: '1h',
                }),
            });
            await Promise.resolve();
            moduleMocks.spotClient.restAPI.klines.mockClear();
            moduleMocks.rendererConnection.sendUTF.mockClear();
        };

        const loadHistory = (overrides = {}) => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'load_chart_history',
                symbol: 'BTCUSDT',
                interval: '1h',
                endTime: 1_699_999_999_999,
                limit: 1000,
                ...overrides,
            }),
        });

        const historyEvents = () => emitted().filter(payload => payload.type === 'chart_history');

        // The shared Spot rate limiter spaces real requests 500ms apart, and the
        // bootstrap has five of them queued ahead of this one. Time is driven
        // rather than waited on, so the read is proven without the test taking
        // three seconds to prove it.
        it('reads the page behind the window and delivers it to the channel that asked', async () => {
            vi.useFakeTimers();
            try {
                await openDetailChannel();

                const pending = loadHistory();
                await vi.advanceTimersByTimeAsync(6000);
                await pending;
            } finally {
                vi.useRealTimers();
            }

            expect(moduleMocks.spotClient.restAPI.klines).toHaveBeenCalledWith({
                symbol: 'BTCUSDT',
                interval: '1h',
                limit: 1000,
                endTime: 1_699_999_999_999,
            });
            const [page] = historyEvents();
            expect(page.payload).toHaveLength(3);
            expect(page.payload[0]).toMatchObject({ time: 1_700_000_000, isFinal: true });
            // The read point travels back with the page: the renderer has to be
            // able to tell this answer from one it has already abandoned.
            expect(page.extra).toEqual({
                symbol: 'BTCUSDT',
                interval: '1h',
                endTime: 1_699_999_999_999,
                limit: 1000,
            });
        });

        // Found on live data on the Futures chart: a page answered for the
        // previous selection merged in front of the new one's tail and drew 15m
        // bars behind a 1h series.
        it('reads nothing for a selection the chart is no longer showing', async () => {
            await openDetailChannel();

            await loadHistory({ interval: '15m' });
            await loadHistory({ symbol: 'ETHUSDT' });

            expect(moduleMocks.spotClient.restAPI.klines).not.toHaveBeenCalled();
            expect(historyEvents()).toEqual([]);
        });

        it('refuses a page larger than one klines read serves, and a nonsense read point', async () => {
            await openDetailChannel();

            await loadHistory({ limit: 5000 });
            await loadHistory({ endTime: 0 });
            await loadHistory({ endTime: 1.5 });

            expect(moduleMocks.spotClient.restAPI.klines).not.toHaveBeenCalled();
            expect(emitted().map(payload => payload.command_rejected?.code).filter(Boolean))
                .toEqual(['INVALID_CHANNEL_ACTION', 'INVALID_CHANNEL_ACTION', 'INVALID_CHANNEL_ACTION']);
        });

        it('refuses the read outright while Spot is not the activated market', async () => {
            await connectRenderer('futures-live');
            moduleMocks.spotClient.restAPI.klines = vi.fn();

            await loadHistory();

            expect(moduleMocks.spotClient.restAPI.klines).not.toHaveBeenCalled();
            expect(emitted().some(payload => payload.command_rejected?.code === 'MARKET_NOT_ACTIVE'))
                .toBe(true);
        });
    });

    // The desk lists conditional orders in the same book as working ones, so a
    // cancel-all that cleared only `/fapi/v1/allOpenOrders` emptied the list on
    // screen while the stops stayed live on the exchange.
    const cancelAllFutures = () => moduleMocks.rendererHandlers.message({
        type: 'utf8',
        utf8Data: JSON.stringify({
            action: 'trade.cancelAll',
            version: 1,
            marketType: 'futures',
            accountId: 'default',
            clientOrderId: 'cancel-all-1',
            symbol: 'BTCUSDT',
        }),
    });

    it('cancels the conditional book as well as the working one', async () => {
        await connectRenderer();
        await cancelAllFutures();

        expect(moduleMocks.futuresAdapter.cancelAllOrders).toHaveBeenCalledWith('BTCUSDT');
        expect(moduleMocks.futuresAdapter.cancelAllAlgoOrders).toHaveBeenCalledWith('BTCUSDT');
        expect(emitted().some(payload => payload.command_rejected)).toBe(false);
    });

    it('says which orders may still be live when one book will not cancel', async () => {
        await connectRenderer();
        moduleMocks.futuresAdapter.cancelAllAlgoOrders.mockRejectedValueOnce(
            Object.assign(new Error('Unknown order sent.'), { status: 400, code: -2011 }),
        );

        await cancelAllFutures();

        const rejection = emitted().find(payload => payload.command_rejected)?.command_rejected;
        expect(rejection.message).toMatch(/conditional \(ALGO\) orders on BTCUSDT are still live/);
        expect(rejection.details.uncancelled).toEqual(['algo']);
    });

});
