import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE,
    FUTURES_PRODUCTION_WORKSTATION_HISTORY_OUTCOME_TYPE,
    createFuturesProductionWorkstationLoadCandleHistoryRequest,
    createFuturesProductionWorkstationSubscribeRequest,
} from '../../src/utils/futuresProductionWorkstationProtocol.js';
import { FUTURES_UNDERIVABLE_INCOME_TYPES } from '../../src/utils/futuresSettledMoney.js';
import {
    createFuturesSettledIncomeLane,
    createFuturesSettledIncomeResource,
} from '../../src/utils/futuresSettledIncomeResource.js';
import {
    DESK_DIAGNOSTICS_UNRECORDED,
    describeDeskDiagnosticEvent,
    readDeskDiagnosticCommandEvent,
    readDeskDiagnosticOutboundEvent,
} from './desk-diagnostic-record.js';
import { FUTURES_ACCOUNT_READ_REASONS } from './futures-account-state.js';

const ACCOUNT_FINGERPRINT = '0123456789abcdef';

const moduleMocks = vi.hoisted(() => {
    const state = {};
    const physicalMethodWeights = new Map([
        ['syncServerTime', 1],
        ['getPositionMode', 30],
        ['placeOrder', null],
        ['cancelOrder', null],
        ['cancelAllOrders', null],
        ['cancelAllAlgoOrders', null],
        ['adjustPositionMargin', null],
        ['modifyOrder', null],
        ['findOrder', null],
        ['getOrderHistory', null],
        ['getTradeHistory', null],
        ['getTradedSymbolPage', null],
        ['getSymbolConfig', null],
        ['getMaxLeverage', null],
        ['getLeverageBracketTable', null],
        ['setLeverage', null],
        ['setMarginType', null],
        ['getIncomePage', null],
        ['createUserDataStreamListenKey', null],
        ['renewUserDataStreamListenKey', null],
    ]);
    const directCommandMethods = new Set([
        'placeOrder',
        'cancelOrder',
        'cancelAllOrders',
        'cancelAllAlgoOrders',
        'adjustPositionMargin',
        'modifyOrder',
    ]);

    const createFuturesAdapterRuntime = (target) => {
        const wrapped = new Map();
        return new Proxy(target, {
            get(current, property, receiver) {
                if (property === 'getAccountRefreshOperations') {
                    if (!wrapped.has(property)) {
                        wrapped.set(property, (...args) => {
                            const operations = Reflect.apply(current[property], current, args);
                            return operations.map((operation) => {
                                const loadPayload = async (...loadArgs) => {
                                    await globalThis.__binanceConnectionTestAdmitPhysicalAttempt?.();
                                    return operation.loadPayload(...loadArgs);
                                };
                                return new Proxy(operation, {
                                    get(value, name, operationReceiver) {
                                        return name === 'loadPayload'
                                            ? loadPayload
                                            : Reflect.get(value, name, operationReceiver);
                                    },
                                });
                            });
                        });
                    }
                    return wrapped.get(property);
                }
                if (!physicalMethodWeights.has(property)) {
                    return Reflect.get(current, property, receiver);
                }
                if (!wrapped.has(property)) {
                    wrapped.set(property, async (...args) => {
                        await globalThis.__binanceConnectionTestAdmitPhysicalAttempt?.(
                            physicalMethodWeights.get(property),
                            { advanceClock: directCommandMethods.has(property) },
                        );
                        return Reflect.apply(current[property], current, args);
                    });
                }
                return wrapped.get(property);
            },
        });
    };

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
            getTradeHistory: vi.fn().mockResolvedValue([{
                id: '2', orderId: '2', symbol: 'BTCUSDT', side: 'SELL', positionSide: 'BOTH',
                price: '1', quantity: '1', realizedPnl: '-96.74', commission: '0',
                commissionAsset: null, marginAsset: 'USDT', time: 1,
            }]),
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
            getLeverageBracketTable: vi.fn().mockImplementation(async symbol => ({
                symbol,
                maxLeverage: 125,
                brackets: [{
                    initialLeverage: 125,
                    notionalFloor: '0',
                    notionalCap: '1000000000',
                    maintMarginRatio: '0.01',
                    cum: '0',
                }],
            })),
            setLeverage: vi.fn().mockResolvedValue({ symbol: 'BTCUSDT', leverage: 20 }),
            setMarginType: vi.fn().mockResolvedValue({ code: 200, msg: 'success' }),
            getAccountRefreshOperations: vi.fn(() => []),
            // What an open position has already settled. Absent from this mock
            // until 2026-08-20, which is how the desk shipped a read that asked
            // the exchange for every kind of flow there is with nothing in the
            // suite able to say so: the call threw, the walk caught it, and the
            // pass recorded a failure nobody was asserting on.
            getIncomePage: vi.fn().mockResolvedValue({ rows: [], full: false }),
            createUserDataStreamListenKey: vi.fn().mockResolvedValue('futures-listen-key'),
            renewUserDataStreamListenKey: vi.fn().mockResolvedValue({}),
        };
        state.futuresAdapterRuntime = createFuturesAdapterRuntime(state.futuresAdapter);
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
        return state.futuresAdapterRuntime;
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

const futuresHistoryTrade = ({
    id = '2',
    orderId = id,
    symbol = 'BTCUSDT',
    side = 'BUY',
    positionSide = 'BOTH',
    price = '1',
    quantity = '1',
    realizedPnl = '0',
    commission = '0',
    commissionAsset = null,
    marginAsset = 'USDT',
    time = 1,
    ...rest
} = {}) => ({
    id: String(id),
    orderId: String(orderId),
    symbol,
    side,
    positionSide,
    price,
    quantity,
    realizedPnl,
    commission,
    commissionAsset,
    marginAsset,
    time,
    ...rest,
});

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
    let FUTURES_REST_ADMISSION_SPACING_MS;

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

        const { admitBinancePhysicalAttempt } = await import(
            './binance-physical-attempt-context.js'
        );
        globalThis.__binanceConnectionTestAdmitPhysicalAttempt = async (weight, {
            advanceClock = false,
        } = {}) => {
            // Queue the urgent physical send before releasing an older spacing
            // timer. Advancing first lets another ordinary request take the
            // serialized slot and leaves the command waiting on a fake clock
            // its behavior test intentionally does not manage.
            const admission = admitBinancePhysicalAttempt(weight);
            // One spacing can finish the holder; the urgent command then needs
            // at most one spacing of its own.
            if (advanceClock) await vi.advanceTimersByTimeAsync(300);
            return admission;
        };
        ({
            setupBinanceConnection,
            LOCAL_RENDERER_WS_MAX_FRAME_BYTES,
            LOCAL_RENDERER_WS_MAX_MESSAGE_BYTES,
            FUTURES_REST_ADMISSION_SPACING_MS,
        } = await import('./binance-connection.js'));
        ({ SpotTradingAdapter } = await import('./spot-trading-adapter.js'));
    });

    afterEach(async () => {
        moduleMocks.rendererHandlers.close?.();
        await flushMicrotasks();
        vi.clearAllTimers();
        vi.useRealTimers();
        delete globalThis.__binanceConnectionTestAdmitPhysicalAttempt;
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

    it('retires an in-flight settled read and public mark feed on service close', async () => {
        let resolveIncomePage;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementationOnce(() => (
            new Promise((resolve) => { resolveIncomePage = resolve; })
        ));
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions',
            loadPayload: vi.fn().mockResolvedValue({
                futures_positions: [{
                    symbol: 'BMTUSDT', positionSide: 'BOTH', quantity: '-2',
                    entryPrice: '0.03', markPrice: '0.034', unrealizedPnl: '-0.008',
                }],
            }),
        }]);
        moduleMocks.httpServer.close.mockImplementation(callback => callback?.());
        const controller = setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'futures-live' }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const privateSocket = moduleMocks.futuresUserDataSockets
            .find(socket => socket.handlers.ping);
        privateSocket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        expect(resolveIncomePage).toBeTypeOf('function');
        expect(moduleMocks.futuresAdapter.getIncomePage).toHaveBeenCalledOnce();

        const { default: MockWebSocket } = await import('ws');
        const openedSockets = MockWebSocket.mock.calls.length;
        const markSocketIndex = MockWebSocket.mock.calls
            .findIndex(([url]) => String(url).includes('@markPrice@1s'));
        const markSocket = MockWebSocket.mock.results[markSocketIndex].value;
        moduleMocks.rendererConnection.sendUTF.mockClear();
        await controller.close();
        expect(privateSocket.disconnect).toHaveBeenCalled();
        expect(markSocket.close).toHaveBeenCalled();

        // The already admitted HTTP request may answer, but its retired
        // activation cannot publish, continue the multi-kind walk, or arm a
        // confirmation/reconnect timer after shutdown.
        resolveIncomePage({ rows: [], full: false });
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getIncomePage).toHaveBeenCalledOnce();
        expect(MockWebSocket.mock.calls).toHaveLength(openedSockets);
        expect(moduleMocks.rendererConnection.sendUTF).not.toHaveBeenCalled();
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

    // Spot paid the handshake on every request long after futures stopped. The
    // two legs get their own agents rather than sharing one, so neither can
    // exhaust the other's sockets, and the WebSocket callers keep the agent that
    // does not pool — a stream opens one connection and holds it, so pooling
    // would buy it nothing.
    it('gives the spot REST leg a pooling connection and leaves the stream agent alone', () => {
        vi.stubEnv('https_proxy', 'socks5://127.0.0.1:1080');
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });

        const [spotOptions] = moduleMocks.Spot.mock.calls[0];
        const restAgent = spotOptions.configurationRestAPI.httpsAgent;
        expect(restAgent.keepAlive).toBe(true);
        expect(restAgent.maxSockets).toBe(32);
        expect(restAgent.maxFreeSockets).toBe(4);
        // The flag beside it used to say the opposite while the agent decided
        // everything; the two now agree.
        expect(spotOptions.configurationRestAPI.keepAlive).toBe(true);

        // The stream keeps its own agent, and that one still does not pool.
        const streamAgent = spotOptions.configurationWebsocketStreams.agent;
        expect(streamAgent).not.toBe(restAgent);
        expect(streamAgent.keepAlive).toBeFalsy();

        // And the futures pool is a third agent, not this one.
        const [futuresOptions] = moduleMocks.FuturesTradingAdapter.mock.calls[0];
        expect(futuresOptions.proxyAgent).not.toBe(restAgent);
    });

    it('gives the futures leg a pooling connection and a fallback that cannot pool', () => {
        vi.stubEnv('https_proxy', 'socks5://127.0.0.1:1080');
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });

        const [options] = moduleMocks.FuturesTradingAdapter.mock.calls[0];
        // The option object, not the behaviour behind it: this is the whole of
        // what turns 630 ms per request into 325.
        expect(options.proxyAgent.keepAlive).toBe(true);
        expect(options.proxyAgent.maxSockets).toBe(72);
        expect(options.proxyAgent.maxFreeSockets).toBe(4);
        // The fallback exists to be the connection the pool is not.
        expect(options.proxyAgentWithoutReuse.keepAlive).toBe(false);
        expect(options.proxyAgentWithoutReuse).not.toBe(options.proxyAgent);
        expect(typeof options.recordEvent).toBe('function');
    });

    // A guard, and named as one: it cannot fail on today's numbers. It exists
    // because the two numbers live in two files and the coupling between them
    // was a paragraph in each, which is a form that rots. A request that finds
    // no free socket does not fail and does not queue where anyone is looking —
    // it waits inside the agent. Admission is serialized and execution is not,
    // so the desk can have one request in the air per spacing for as long as it
    // is willing to wait for an answer, and the pool has to be wider than that.
    it('keeps the bound on the pool above the bound this queue needs', async () => {
        const {
            FUTURES_REST_CONNECTION_POOL,
            FUTURES_REST_REQUEST_TIMEOUT_MS,
        } = await import('./futures-trading-adapter.js');

        const inFlightCeiling = Math.ceil(
            FUTURES_REST_REQUEST_TIMEOUT_MS / FUTURES_REST_ADMISSION_SPACING_MS,
        );

        expect(FUTURES_REST_CONNECTION_POOL.maxSockets)
            .toBeGreaterThanOrEqual(inFlightCeiling);
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
            .toBe('wss://fstream.binance.com/market/stream?streams='
                + 'bmtusdt@markPrice@1s');

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

    it('sends position marks only to renderers whose current market is Futures', async () => {
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions',
            weight: 5,
            errorLabel: 'positions',
            loadPayload: vi.fn().mockResolvedValue({
                futures_positions: [{
                    symbol: 'BMTUSDT', positionSide: 'BOTH', quantity: '-2',
                    entryPrice: '0.03', markPrice: '0.034', unrealizedPnl: '-0.008',
                }],
            }),
        }]);
        await connectRenderer('futures-live');
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const spotHandlers = {};
        const spotConnection = {
            connected: true,
            remoteAddress: '127.0.0.2',
            outputBufferFull: false,
            sendUTF: vi.fn(),
            close: vi.fn(),
            drop: vi.fn(),
            on: vi.fn((event, handler) => { spotHandlers[event] = handler; }),
        };
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => spotConnection),
        });
        await spotHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'spot' }),
        });
        await flushMicrotasks();
        moduleMocks.rendererConnection.sendUTF.mockClear();
        spotConnection.sendUTF.mockClear();

        const { default: MockWebSocket } = await import('ws');
        const markSocketIndex = MockWebSocket.mock.calls
            .findIndex(([url]) => String(url).includes('@markPrice@1s'));
        const markSocket = MockWebSocket.mock.results[markSocketIndex].value;
        markSocket.handlers.message(JSON.stringify({
            stream: 'bmtusdt@markPrice@1s',
            data: { e: 'markPriceUpdate', E: 2_000, s: 'BMTUSDT', p: '0.03500', T: 30_000 },
        }));
        await vi.advanceTimersByTimeAsync(200);

        expect(moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_position_marks')).toHaveLength(1);
        expect(spotConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_position_marks')).toEqual([]);
    });

    it('supersedes queued marks and drains account truth before the newest mark', async () => {
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions',
            weight: 5,
            errorLabel: 'positions',
            loadPayload: vi.fn().mockResolvedValue({
                futures_positions: [{
                    symbol: 'BMTUSDT', positionSide: 'BOTH', quantity: '-2',
                    entryPrice: '0.03', markPrice: '0.034', unrealizedPnl: '-0.008',
                }],
            }),
        }]);
        await connectRenderer('futures-live');
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const privateSocket = moduleMocks.futuresUserDataSockets
            .find(socket => socket.handlers.ping);
        privateSocket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const { default: MockWebSocket } = await import('ws');
        const markSocketIndex = MockWebSocket.mock.calls
            .findIndex(([url]) => String(url).includes('@markPrice@1s'));
        const markSocket = MockWebSocket.mock.results[markSocketIndex].value;
        moduleMocks.rendererConnection.sendUTF.mockClear();
        moduleMocks.rendererConnection.outputBufferFull = true;

        const sendMark = async (eventTime, price) => {
            markSocket.handlers.message(JSON.stringify({
                stream: 'bmtusdt@markPrice@1s',
                data: { e: 'markPriceUpdate', E: eventTime, s: 'BMTUSDT', p: price, T: 30_000 },
            }));
            await vi.advanceTimersByTimeAsync(200);
        };
        // Revision 1 fills the socket buffer. Revisions 2 and 3 are held by the
        // outbox, where the complete newer map replaces the older one.
        await sendMark(2_000, '0.03500');
        await sendMark(3_000, '0.03510');
        await sendMark(4_000, '0.03520');

        privateSocket.handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE', E: 4_100,
            o: {
                s: 'BMTUSDT', i: 44, X: 'NEW', S: 'BUY', o: 'LIMIT',
                p: '0.03', q: '1', z: '0', rp: '0', T: 4_100,
            },
        }));
        await flushMicrotasks();
        expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledTimes(1);

        moduleMocks.rendererConnection.outputBufferFull = false;
        moduleMocks.rendererHandlers.drain();
        await flushMicrotasks();

        const drained = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        const marks = drained.filter(payload => payload.type === 'futures_position_marks');
        expect(marks).toHaveLength(2);
        expect(marks.map(payload => payload.marks.BMTUSDT.markPrice)).toEqual([
            '0.03500',
            '0.03520',
        ]);
        const accountIndex = drained.findIndex(payload => payload.futures_execution_update);
        const newestMarkIndex = drained.findIndex(payload => (
            payload.type === 'futures_position_marks'
            && payload.marks.BMTUSDT.markPrice === '0.03520'
        ));
        expect(accountIndex).toBeGreaterThan(0);
        expect(accountIndex).toBeLessThan(newestMarkIndex);
    });

    it('discards a queued position mark before acknowledging a switch away from Futures', async () => {
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions',
            loadPayload: vi.fn().mockResolvedValue({
                futures_positions: [{
                    symbol: 'BMTUSDT', positionSide: 'BOTH', quantity: '-2',
                    entryPrice: '0.03', markPrice: '0.034', unrealizedPnl: '-0.008',
                }],
            }),
        }]);
        await connectRenderer('futures-live');
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const { default: MockWebSocket } = await import('ws');
        const markSocketIndex = MockWebSocket.mock.calls
            .findIndex(([url]) => String(url).includes('@markPrice@1s'));
        const markSocket = MockWebSocket.mock.results[markSocketIndex].value;
        moduleMocks.rendererConnection.sendUTF.mockClear();
        moduleMocks.rendererConnection.outputBufferFull = true;

        markSocket.handlers.message(JSON.stringify({
            stream: 'bmtusdt@markPrice@1s',
            data: { e: 'markPriceUpdate', E: 2_000, s: 'BMTUSDT', p: '0.03500', T: 30_000 },
        }));
        await vi.advanceTimersByTimeAsync(200);
        markSocket.handlers.message(JSON.stringify({
            stream: 'bmtusdt@markPrice@1s',
            data: { e: 'markPriceUpdate', E: 3_000, s: 'BMTUSDT', p: '0.03510', T: 30_000 },
        }));
        await vi.advanceTimersByTimeAsync(200);
        expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledTimes(1);

        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'spot' }),
        });
        moduleMocks.rendererConnection.outputBufferFull = false;
        moduleMocks.rendererHandlers.drain();
        await flushMicrotasks();

        const delivered = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        expect(delivered.filter(payload => payload.type === 'futures_position_marks'))
            .toHaveLength(1);
        expect(delivered.at(-1)).toMatchObject({
            type: 'market_activation', marketMode: 'spot',
        });
    });

    it('ignores buffered message and error callbacks from a retired Futures private socket', async () => {
        const balances = vi.fn().mockResolvedValue({
            futures_balances: { USDT: { available: '100', total: '100' } },
        });
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'balances', weight: 5, errorLabel: 'balances', loadPayload: balances,
        }]);
        await connectRenderer('futures-live');
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const firstSocket = moduleMocks.futuresUserDataSockets
            .find(socket => socket.handlers.ping);
        firstSocket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        await activateMarket('spot');
        await activateMarket('futures-live');
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const secondSocket = moduleMocks.futuresUserDataSockets
            .filter(socket => socket.handlers.ping)
            .at(-1);
        expect(secondSocket).not.toBe(firstSocket);
        expect(firstSocket.disconnect).toHaveBeenCalled();

        const balanceReads = balances.mock.calls.length;
        const incomeReads = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        moduleMocks.rendererConnection.sendUTF.mockClear();
        console.warn.mockClear();
        firstSocket.handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE', E: 5_000,
            o: {
                s: 'BTCUSDT', i: 77, X: 'FILLED', S: 'SELL', o: 'MARKET',
                p: '50000', q: '1', z: '1', rp: '12.5', T: 5_000,
            },
        }));
        firstSocket.handlers.error(Object.assign(new Error('late retired error'), {
            code: 'ECONNRESET',
        }));
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        expect(moduleMocks.rendererConnection.sendUTF).not.toHaveBeenCalled();
        expect(balances).toHaveBeenCalledTimes(balanceReads);
        expect(moduleMocks.futuresAdapter.getIncomePage).toHaveBeenCalledTimes(incomeReads);
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('retires queued and in-flight Futures listen-key renewals across reactivation', async () => {
        const keepAliveDelay = 30 * 60 * 1000;
        const diagnosticRecord = {
            directory: '/desk/diagnostics',
            record: vi.fn(() => true),
            observeOutbound: vi.fn(() => false),
            observeCommand: vi.fn(() => false),
            close: vi.fn(),
        };
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        const keepAliveCallbacks = () => setIntervalSpy.mock.calls.flatMap(
            ([callback, delay]) => (delay === keepAliveDelay ? [callback] : []),
        );

        try {
            setupBinanceConnection({
                localWebSocketAccess: { host: '127.0.0.1' },
                diagnosticRecord,
            });
            moduleMocks.websocketServerHandlers.request({
                origin: 'http://localhost:5174',
                accept: vi.fn(() => moduleMocks.rendererConnection),
            });
            await activateMarket('futures-live');
            await flushMicrotasks();

            const [retiredQueuedKeepAlive] = keepAliveCallbacks();
            expect(retiredQueuedKeepAlive).toBeTypeOf('function');

            // The listen-key POST has just occupied the limiter admission slot,
            // so this renewal is waiting on its spacing timer rather than having
            // reached the adapter yet.
            retiredQueuedKeepAlive();
            await flushMicrotasks();
            expect(moduleMocks.futuresAdapter.renewUserDataStreamListenKey)
                .not.toHaveBeenCalled();

            await activateMarket('spot');
            await activateMarket('futures-live');
            await vi.advanceTimersByTimeAsync(2_000);
            await flushMicrotasks();

            expect(moduleMocks.futuresAdapter.renewUserDataStreamListenKey)
                .not.toHaveBeenCalled();
            expect(keepAliveCallbacks()).toHaveLength(2);

            let rejectRetiredRenewal;
            moduleMocks.futuresAdapter.renewUserDataStreamListenKey.mockReturnValueOnce(
                new Promise((resolve, reject) => {
                    rejectRetiredRenewal = reject;
                }),
            );
            keepAliveCallbacks()[1]();
            await vi.advanceTimersByTimeAsync(FUTURES_REST_ADMISSION_SPACING_MS);
            await flushMicrotasks();
            expect(moduleMocks.futuresAdapter.renewUserDataStreamListenKey)
                .toHaveBeenCalledOnce();

            await activateMarket('spot');
            await activateMarket('futures-live');
            await vi.advanceTimersByTimeAsync(2_000);
            await flushMicrotasks();

            const currentSocket = moduleMocks.futuresUserDataSockets
                .filter(socket => socket.handlers.ping)
                .at(-1);
            currentSocket.handlers.open();
            await flushMicrotasks();
            expect(keepAliveCallbacks()).toHaveLength(3);

            diagnosticRecord.record.mockClear();
            moduleMocks.rendererConnection.sendUTF.mockClear();
            console.warn.mockClear();
            rejectRetiredRenewal(new Error('late retired renewal failure'));
            await flushMicrotasks();

            expect(diagnosticRecord.record.mock.calls.filter(
                ([kind]) => kind === 'fault',
            )).toEqual([]);
            expect(console.warn).not.toHaveBeenCalled();
            expect(moduleMocks.rendererConnection.sendUTF.mock.calls
                .map(([message]) => JSON.parse(message))
                .filter(payload => (
                    payload.type === 'futures_account_state'
                    && payload.resources?.userDataStream?.status === 'error'
                ))).toEqual([]);

            // A failure belonging to the current stream still takes the normal
            // error path; retirement guards must not hide live-stream faults.
            moduleMocks.futuresAdapter.renewUserDataStreamListenKey.mockRejectedValueOnce(
                new Error('active renewal failure'),
            );
            keepAliveCallbacks()[2]();
            await vi.advanceTimersByTimeAsync(FUTURES_REST_ADMISSION_SPACING_MS);
            await flushMicrotasks();

            expect(diagnosticRecord.record).toHaveBeenCalledWith('fault', {
                phase: 'futures-user-data',
                code: 'LISTEN_KEY_RENEWAL_FAILED',
            });
            expect(console.warn).toHaveBeenCalledWith(
                'Failed to renew futures listenKey:',
                'active renewal failure',
            );
        } finally {
            setIntervalSpy.mockRestore();
        }
    });

    it('cancels feed, settlement, and reconnect work when the final renderer closes', async () => {
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions',
            loadPayload: vi.fn().mockResolvedValue({
                futures_positions: [{
                    symbol: 'BMTUSDT', positionSide: 'BOTH', quantity: '-2',
                    entryPrice: '0.03', markPrice: '0.034', unrealizedPnl: '-0.008',
                }],
            }),
        }]);
        await connectRenderer('futures-live');
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const privateSocket = moduleMocks.futuresUserDataSockets
            .find(socket => socket.handlers.ping);
        privateSocket.handlers.open();

        const { default: MockWebSocket } = await import('ws');
        const markSocketIndex = MockWebSocket.mock.calls
            .findIndex(([url]) => String(url).includes('@markPrice@1s'));
        const markSocket = MockWebSocket.mock.results[markSocketIndex].value;
        markSocket.handlers.open();
        markSocket.handlers.message(JSON.stringify({
            stream: 'bmtusdt@markPrice@1s',
            data: { e: 'markPriceUpdate', E: 2_000, s: 'BMTUSDT', p: '0.03500', T: 30_000 },
        }));
        const openedSockets = MockWebSocket.mock.calls.length;
        const incomeReads = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        moduleMocks.rendererConnection.sendUTF.mockClear();

        // Close before either the mark batch or the stream-open settlement
        // debounce fires. Both timers belong to this final Futures consumer.
        moduleMocks.rendererConnection.close();
        await flushMicrotasks();
        expect(privateSocket.disconnect).toHaveBeenCalled();
        expect(markSocket.close).toHaveBeenCalled();

        // Late callbacks on the retired sockets are harmless, and no watchdog
        // or reconnect may rebuild either service for an empty consumer set.
        privateSocket.handlers.message(JSON.stringify({
            e: 'ACCOUNT_UPDATE', E: 3_000, T: 3_000,
            a: { m: 'FUNDING_FEE', B: [], P: [] },
        }));
        markSocket.handlers.close();
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        await flushMicrotasks();

        expect(moduleMocks.rendererConnection.sendUTF).not.toHaveBeenCalled();
        expect(moduleMocks.futuresAdapter.getIncomePage).toHaveBeenCalledTimes(incomeReads);
        expect(MockWebSocket.mock.calls).toHaveLength(openedSockets);
    });

    it('opens the Futures user-data stream on the routed private path', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
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
        const futuresUrls = MockWebSocket.mock.calls
            .map(([url]) => String(url))
            .filter(url => url.startsWith('wss://fstream.binance.com'));

        // The account's own event stream, on the prefix the exchange has served
        // since 2026-04-23, with no `events` filter narrowing it.
        expect(futuresUrls).toContain(
            'wss://fstream.binance.com/private/ws?listenKey=futures-listen-key',
        );

        // The half that stops this recurring. `/ws/<listenKey>` answers the
        // handshake and then delivers nothing, so no error, no reconnect and no
        // test that watches behaviour can catch it — only the path can. Stated
        // over every futures socket the session opens rather than over the one
        // this test came for, because the way the fault arrived was a socket
        // nobody had written a rule about.
        expect(futuresUrls.length).toBeGreaterThan(0);
        for (const url of futuresUrls) {
            expect(['/private/ws', '/market/stream', '/public/stream'])
                .toContain(new URL(url).pathname);
        }

        // The record has to name the route, or the next wrong prefix hides the
        // same way this one did — and it has to do that without carrying the
        // listen key, which is a bearer credential for the account's own
        // events.
        const lines = info.mock.calls.map(args => args.join(' '));
        expect(lines).toContain(
            '[futures-stream] connecting wss://fstream.binance.com/private/ws?listenKey=<redacted>',
        );
        expect(lines.some(line => line.includes('futures-listen-key'))).toBe(false);
        info.mockRestore();
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

    // A fill used to drag the whole account behind it: 90 weight a pass, of
    // which 80 was reading back the two order lists the exchange had just
    // reported on the stream. The wallet and the position are what a fill
    // actually moves — those are still read, at 5 each.
    it('keeps the working orders from the stream without reading them back', async () => {
        const loads = {
            balances: vi.fn().mockResolvedValue({
                futures_balances: {
                    USDT: { available: '100', total: '100', crossWallet: '100' },
                },
            }),
            regularOrders: vi.fn().mockResolvedValue({
                futures_regular_orders: [{
                    symbol: 'TUTUSDT', orderId: 11, orderKind: 'REGULAR', status: 'NEW', transactTime: 1_000,
                }],
            }),
            algoOrders: vi.fn().mockResolvedValue({ futures_algo_orders: [] }),
            positions: vi.fn().mockResolvedValue({ futures_positions: [] }),
        };
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue(
            ['balances', 'regularOrders', 'algoOrders', 'positions'].map(type => ({
                type,
                weight: 5,
                errorLabel: type,
                loadPayload: loads[type],
            })),
        );

        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'futures-live' }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const workingOrders = () => moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_account_state')
            .at(-1).resources.regularOrders.data;
        expect(workingOrders().map(order => order.orderId)).toEqual([11]);
        const afterSetup = Object.fromEntries(
            Object.entries(loads).map(([type, load]) => [type, load.mock.calls.length]),
        );

        // A second order opens.
        socket.handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 2_000,
            o: {
                s: 'TUTUSDT', i: 12, X: 'NEW', S: 'BUY', o: 'LIMIT', p: '1', q: '5', T: 2_000,
            },
        }));
        await flushMicrotasks();
        expect(workingOrders().map(order => order.orderId)).toEqual([11, '12']);

        // And fills.
        socket.handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 3_000,
            o: {
                s: 'TUTUSDT', i: 12, X: 'FILLED', S: 'BUY', o: 'LIMIT', p: '1', q: '5', z: '5', T: 3_000,
            },
        }));
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        expect(workingOrders().map(order => order.orderId)).toEqual([11]);

        // Neither order list was read for any of it. The wallet was, once: the
        // margin an order locks and releases is the one thing about it no stream
        // states. The position was not — no `ACCOUNT_UPDATE` said it moved, and
        // a fill is not a reason to go and ask.
        expect(loads.regularOrders).toHaveBeenCalledTimes(afterSetup.regularOrders);
        expect(loads.algoOrders).toHaveBeenCalledTimes(afterSetup.algoOrders);
        expect(loads.positions).toHaveBeenCalledTimes(afterSetup.positions);
        expect(loads.balances.mock.calls.length).toBeGreaterThan(afterSetup.balances);
    });

    const futuresAccountLoads = () => {
        const loads = {
            balances: vi.fn().mockResolvedValue({
                futures_balances: { USDT: { available: '100', total: '100' } },
            }),
            regularOrders: vi.fn().mockResolvedValue({ futures_regular_orders: [] }),
            algoOrders: vi.fn().mockResolvedValue({ futures_algo_orders: [] }),
            positions: vi.fn().mockResolvedValue({ futures_positions: [] }),
        };
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue(
            ['balances', 'regularOrders', 'algoOrders', 'positions'].map(type => ({
                type,
                weight: 5,
                errorLabel: type,
                loadPayload: loads[type],
            })),
        );
        return loads;
    };

    // The desk assumed the authenticated stream said nothing about algorithmic
    // orders and read them on a thirty-second beat because of it. Binance's own
    // page for the event says it is pushed when an algo is created or its status
    // changes, and `ai` is the regular order the algo spawned — the identity the
    // read goes and asks for.
    it('applies an algo update from the stream without reading the algo list', async () => {
        const loads = futuresAccountLoads();
        loads.algoOrders.mockResolvedValue({
            futures_algo_orders: [{
                orderKind: 'ALGO',
                orderId: 77,
                algoId: 77,
                symbol: 'TUTUSDT',
                side: 'SELL',
                status: 'NEW',
                triggerPrice: '9',
                actualOrderId: '',
            }],
        });
        await startFuturesDesk();
        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const algoOrders = () => moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_account_state')
            .at(-1).resources.algoOrders.data;
        expect(algoOrders().map(order => order.status)).toEqual(['NEW']);
        const reads = loads.algoOrders.mock.calls.length;

        socket.handlers.message(JSON.stringify({
            e: 'ALGO_UPDATE',
            E: 2_000,
            o: { s: 'TUTUSDT', aid: 77, X: 'TRIGGERED', ai: 4242, tp: '9' },
        }));
        await flushMicrotasks();
        expect(algoOrders()).toMatchObject([{ status: 'TRIGGERED', actualOrderId: '4242' }]);

        // And the exchange says it is finished.
        socket.handlers.message(JSON.stringify({
            e: 'ALGO_UPDATE',
            E: 3_000,
            o: { s: 'TUTUSDT', aid: 77, X: 'FINISHED', ai: 4242 },
        }));
        await flushMicrotasks();

        expect(algoOrders()).toEqual([]);
        expect(loads.algoOrders).toHaveBeenCalledTimes(reads);
    });

    // A liquidation price the desk draws is the desk's own reckoning. This is
    // the exchange raising its hand, and the two must not read the same.
    it('states a margin call the exchange sent, naming the position it is about', async () => {
        futuresAccountLoads();
        await startFuturesDesk();
        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        socket.handlers.message(JSON.stringify({
            e: 'MARGIN_CALL',
            E: 4_000,
            cw: '3.16812045',
            p: [{
                s: 'TUTUSDT',
                ps: 'LONG',
                pa: '1.327',
                mt: 'crossed',
                iw: '0',
                mp: '187.17127',
                up: '-1.166074',
                mm: '1.614445',
            }],
        }));
        await flushMicrotasks();

        const [call] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_margin_call);
        expect(call.futures_margin_call.positions.map(position => position.symbol))
            .toEqual(['TUTUSDT']);
        expect(call.futures_margin_call.positions[0].maintenanceMargin).toBe('1.614445');
    });

    // The one ending no read explains: at the next reconciliation the order is
    // simply gone, and these words are the only reason there will ever be.
    it('states the exchange reason a triggered conditional order was refused', async () => {
        futuresAccountLoads();
        await startFuturesDesk();
        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        socket.handlers.message(JSON.stringify({
            e: 'CONDITIONAL_ORDER_TRIGGER_REJECT',
            E: 5_000,
            T: 5_010,
            or: { s: 'TUTUSDT', i: 155618472834, r: 'Margin is insufficient.' },
        }));
        await flushMicrotasks();

        const [refusal] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_conditional_trigger_reject);
        expect(refusal.futures_conditional_trigger_reject).toEqual({
            symbol: 'TUTUSDT',
            orderId: '155618472834',
            reason: 'Margin is insufficient.',
        });
    });

    const startFuturesDesk = async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'futures-live' }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
    };

    // Not awaited before the clock moves: the account read this command may
    // queue waits on the limiter's own spacing timer, and awaiting the command
    // first would hold the clock that has to fire it.
    const sendFuturesPlacement = async () => {
        const handled = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1,
                marketType: 'futures',
                action: 'trade.placeOrder',
                accountId: 'default',
                symbol: 'TUTUSDT',
                side: 'BUY',
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                price: '1',
                quantity: '5',
            }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        await handled;
    };

    // What the operator hit on the live desk. Every command re-read the whole
    // account — ninety of the minute's eight hundred weight, four requests, and
    // every resource marked `loading` while they ran, which withdrew the desk's
    // own readiness and refused the next order. Past eight commands a minute the
    // budget was spent and the limiter held the next read for the rest of the
    // window. The stream reports the order; there is nothing to read back.
    it('reads nothing back after a command the stream reports', async () => {
        const loads = futuresAccountLoads();
        await startFuturesDesk();
        moduleMocks.futuresUserDataSockets[0].handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const afterSetup = Object.fromEntries(
            Object.entries(loads).map(([type, load]) => [type, load.mock.calls.length]),
        );

        await sendFuturesPlacement();

        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
        for (const [type, load] of Object.entries(loads)) {
            expect(load, type).toHaveBeenCalledTimes(afterSetup[type]);
        }
    });

    const heldPositions = () => moduleMocks.rendererConnection.sendUTF.mock.calls
        .map(([message]) => JSON.parse(message))
        .filter(payload => payload.type === 'futures_account_state')
        .at(-1).resources.positions.data;

    const accountUpdate = (account) => JSON.stringify({
        e: 'ACCOUNT_UPDATE', E: 5_000, T: 5_000, a: { m: 'ORDER', ...account },
    });

    const openFuturesStream = async (loads) => {
        await startFuturesDesk();
        moduleMocks.futuresUserDataSockets[0].handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        return Object.fromEntries(
            Object.entries(loads).map(([type, load]) => [type, load.mock.calls.length]),
        );
    };

    const captureUnhandledRejections = async (exercise) => {
        const rejections = [];
        const capture = reason => rejections.push(reason);
        process.on('unhandledRejection', capture);
        try {
            await exercise();
            await flushMicrotasks();
            await vi.advanceTimersByTimeAsync(0);
            return rejections;
        } finally {
            process.off('unhandledRejection', capture);
        }
    };

    it('settles a rejected detached bootstrap refresh with a bounded local reason', async () => {
        const rawError = Object.assign(new Error('signed-query=secret-bootstrap'), {
            code: -2015,
            response: { data: 'raw-bootstrap-response' },
        });
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockImplementationOnce(() => {
            throw rawError;
        });

        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        const unhandled = await captureUnhandledRejections(async () => {
            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'activate_market',
                    marketMode: 'futures-live',
                }),
            });
        });

        expect(console.error).toHaveBeenCalledWith(
            '[futures-account] detached refresh failed: reason=bootstrap'
            + ' code=FUTURES_PERMISSION_DENIED category=permission',
        );
        expect(console.error.mock.calls.flat().join(' ')).not.toContain('signed-query');
        expect(console.error.mock.calls.flat().join(' ')).not.toContain('raw-bootstrap-response');
        expect(unhandled).toEqual([]);
    });

    it('settles a rejected detached stream refresh with a bounded local reason', async () => {
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([]);
        await startFuturesDesk();
        const rawError = Object.assign(new Error('signed-query=secret-stream'), {
            code: 'ECONNRESET',
        });
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockImplementationOnce(() => {
            throw rawError;
        });

        const unhandled = await captureUnhandledRejections(async () => {
            moduleMocks.futuresUserDataSockets[0].handlers.open();
        });

        expect(console.error).toHaveBeenCalledWith(
            '[futures-account] detached refresh failed: reason=stream'
            + ' code=FUTURES_NETWORK_ERROR category=network',
        );
        expect(console.error.mock.calls.flat().join(' ')).not.toContain('signed-query');
        expect(unhandled).toEqual([]);
    });

    it('settles a rejected detached unstated refresh with a bounded local reason', async () => {
        futuresAccountLoads();
        await startFuturesDesk();
        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const rawError = Object.assign(new Error('signed-query=secret-unstated'), {
            status: 503,
        });
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockImplementationOnce(() => {
            throw rawError;
        });

        const unhandled = await captureUnhandledRejections(async () => {
            socket.handlers.message(accountUpdate({
                B: [{ a: 'USDT', wb: '1010.5', cw: '1010.5' }],
                P: [{ s: 'TUTUSDT', pa: '25', ep: '2.1', up: '3', mt: 'cross', iw: '0', ps: 'BOTH' }],
            }));
            await vi.advanceTimersByTimeAsync(400);
        });

        expect(console.error).toHaveBeenCalledWith(
            '[futures-account] detached refresh failed: reason=unstated'
            + ' code=FUTURES_EXCHANGE_UNAVAILABLE category=exchange',
        );
        expect(console.error.mock.calls.flat().join(' ')).not.toContain('signed-query');
        expect(unhandled).toEqual([]);
    });

    // The frame *is* the account change. Asking Binance for it back put the
    // position on screen a signed round trip after the exchange had already
    // stated it — 340–800 ms through the operator's proxy, on their own record.
    it('shows the position the frame states before any read answers for it', async () => {
        const loads = futuresAccountLoads();
        const afterSetup = await openFuturesStream(loads);

        moduleMocks.futuresUserDataSockets[0].handlers.message(accountUpdate({
            B: [{ a: 'USDT', wb: '1010.5', cw: '1010.5' }],
            P: [{ s: 'TUTUSDT', pa: '25', ep: '2.1', up: '3', mt: 'cross', iw: '0', ps: 'BOTH' }],
        }));
        await flushMicrotasks();

        // On screen already, and with no liquidation price — the frame carries
        // none, and a computed one would be there at once and sometimes wrong.
        expect(heldPositions()).toEqual([{
            symbol: 'TUTUSDT',
            positionSide: 'BOTH',
            quantity: '25',
            entryPrice: '2.1',
            unrealizedPnl: '3',
            marginType: 'CROSS',
            isolatedWallet: '0',
        }]);
        expect(loads.positions).toHaveBeenCalledTimes(afterSetup.positions);

        // And then the read for what the frame could not carry — those two
        // resources and no others.
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        expect(loads.positions).toHaveBeenCalledTimes(afterSetup.positions + 1);
        expect(loads.balances).toHaveBeenCalledTimes(afterSetup.balances + 1);
        expect(loads.regularOrders).toHaveBeenCalledTimes(afterSetup.regularOrders);
        expect(loads.algoOrders).toHaveBeenCalledTimes(afterSetup.algoOrders);
    });

    // A folded position set is a position set: the mark the contract is valued
    // at follows it exactly as it follows a read. Asserted before any read
    // answers, because a read would subscribe it anyway and prove nothing.
    it('marks a position the frame opened to the market at once', async () => {
        const loads = futuresAccountLoads();
        await openFuturesStream(loads);
        const { default: MockWebSocket } = await import('ws');
        const marksBefore = MockWebSocket.mock.calls.filter(
            ([url]) => String(url).includes('tutusdt@markPrice@1s'),
        ).length;

        moduleMocks.futuresUserDataSockets[0].handlers.message(accountUpdate({
            P: [{ s: 'TUTUSDT', pa: '25', ep: '2.1', up: '3', mt: 'cross', iw: '0', ps: 'BOTH' }],
        }));
        await flushMicrotasks();

        expect(MockWebSocket.mock.calls.filter(
            ([url]) => String(url).includes('tutusdt@markPrice@1s'),
        ).length).toBe(marksBefore + 1);
    });

    // Binance's REST view is eventually consistent with its own matching engine,
    // so the read issued *for* the liquidation price can answer from a replica
    // still describing the account before the frame that prompted it. Taking it
    // whole would show the exchange's figure and then revert it — the blink,
    // arriving by a new route.
    it('takes the liquidation price from the read and the size from the frame', async () => {
        const loads = futuresAccountLoads();
        loads.positions.mockResolvedValue({
            futures_positions: [{
                symbol: 'TUTUSDT', positionSide: 'BOTH',
                // What the replica still says, a fill behind.
                quantity: '10', entryPrice: '2',
                liquidationPrice: '1.5', leverage: '5',
            }],
        });
        await openFuturesStream(loads);

        moduleMocks.futuresUserDataSockets[0].handlers.message(accountUpdate({
            P: [{ s: 'TUTUSDT', pa: '25', ep: '2.1', up: '3', mt: 'cross', iw: '0', ps: 'BOTH' }],
        }));
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        expect(heldPositions()).toEqual([expect.objectContaining({
            symbol: 'TUTUSDT',
            quantity: '25',
            entryPrice: '2.1',
            liquidationPrice: '1.5',
            leverage: '5',
        })]);
    });

    it('reads no positions for a frame that only moves the wallet', async () => {
        const loads = futuresAccountLoads();
        const afterSetup = await openFuturesStream(loads);

        moduleMocks.futuresUserDataSockets[0].handlers.message(accountUpdate({
            B: [{ a: 'USDT', wb: '1010.5', cw: '1010.5' }],
            P: [],
        }));
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        expect(loads.balances).toHaveBeenCalledTimes(afterSetup.balances + 1);
        expect(loads.positions).toHaveBeenCalledTimes(afterSetup.positions);
    });

    // The frames arrive in bursts — the fills of one order, an amendment's
    // cancel and its replacement. One read between them says the same thing.
    it('collapses a burst of frames into one read', async () => {
        const loads = futuresAccountLoads();
        const afterSetup = await openFuturesStream(loads);
        const socket = moduleMocks.futuresUserDataSockets[0];

        for (const quantity of ['5', '12', '25']) {
            socket.handlers.message(accountUpdate({
                B: [{ a: 'USDT', wb: `10${quantity}`, cw: `10${quantity}` }],
                P: [{ s: 'TUTUSDT', pa: quantity, ep: '2', up: '0', mt: 'cross', iw: '0', ps: 'BOTH' }],
            }));
            // Spaced inside the window rather than delivered in one tick: a
            // desk that read per frame would have read three times by here, and
            // frames arriving in the same millisecond would not tell them apart.
            await vi.advanceTimersByTimeAsync(100);
            await flushMicrotasks();
        }
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        expect(heldPositions()[0].quantity).toBe('25');
        expect(loads.positions).toHaveBeenCalledTimes(afterSetup.positions + 1);
        expect(loads.balances).toHaveBeenCalledTimes(afterSetup.balances + 1);
    });

    it('reads nothing for a frame that states what the account already says', async () => {
        const loads = futuresAccountLoads();
        loads.balances.mockResolvedValue({
            futures_balances: {
                USDT: { available: '90', total: '100', crossWallet: '100' },
            },
        });
        const afterSetup = await openFuturesStream(loads);

        moduleMocks.futuresUserDataSockets[0].handlers.message(accountUpdate({
            B: [{ a: 'USDT', wb: '100', cw: '100' }],
            P: [],
        }));
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        for (const [type, load] of Object.entries(loads)) {
            expect(load, type).toHaveBeenCalledTimes(afterSetup[type]);
        }
    });

    // A read asked for by a frame may only state what the frame could not, and
    // carries the frame's own figures over the rest — which is right for that
    // read and wrong for every other one. The operator's refresh, a reconnect
    // and the periodic beat exist to correct a frame the desk never saw, and a
    // read that may not replace a position row cannot do it. Requests that queue
    // behind a running read collapse into one pass, so without a rule for the
    // reason, whichever asked last decided what the whole pass was allowed to
    // say.
    it('does not narrow a full read that a frame queued behind', async () => {
        const loads = futuresAccountLoads();
        await openFuturesStream(loads);
        const socket = moduleMocks.futuresUserDataSockets[0];

        // A position the desk holds only because a frame said so.
        socket.handlers.message(accountUpdate({
            P: [{ s: 'TUTUSDT', pa: '25', ep: '2.1', up: '3', mt: 'cross', iw: '0', ps: 'BOTH' }],
        }));
        await flushMicrotasks();
        expect(heldPositions()).toHaveLength(1);

        // It is gone at the exchange, and the frame that would have said so
        // never arrived — the case the operator's refresh is for.
        loads.positions.mockResolvedValue({ futures_positions: [] });
        // Hold the read the fold scheduled open, so what follows queues behind it.
        let releaseBalances = null;
        loads.balances.mockImplementationOnce(() => new Promise((resolve) => {
            releaseBalances = () => resolve({
                futures_balances: { USDT: { available: '100', total: '100' } },
            });
        }));
        await vi.advanceTimersByTimeAsync(1_000);
        expect(releaseBalances).not.toBeNull();

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-behind', symbol: 'TUTUSDT',
        });
        // And now a frame lands on top of the queued refresh.
        socket.handlers.message(accountUpdate({ B: [{ a: 'USDT', wb: '1020.5', cw: '1020.5' }] }));
        await vi.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();

        releaseBalances();
        // Long enough for the whole queue: the operator's refresh now asks for
        // the settled reading as well, and those admissions are spaced behind
        // the account read rather than instead of it.
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();

        expect(heldPositions()).toEqual([]);
    });

    // With no stream there is nothing else to learn it from, and the read is
    // the only way the desk finds out what its own command did.
    it('reads the account back after a command no stream can report', async () => {
        const loads = futuresAccountLoads();
        await startFuturesDesk();

        await sendFuturesPlacement();

        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
        for (const [type, load] of Object.entries(loads)) {
            expect(load.mock.calls.length, type).toBeGreaterThan(0);
        }
    });

    // The blink. Binance's REST services are eventually consistent with its
    // streams — the same property the ambiguous-outcome reconciliation is built
    // around — so a read of the working orders issued around a placement can
    // answer without the order the stream has already reported. Letting that
    // read remove it is what made a newly placed order flash on and off the
    // chart until a read caught up.
    it('keeps an order the stream reported while a read of the orders was in flight', async () => {
        let answerOrdersRead = null;
        const loads = {
            balances: vi.fn().mockResolvedValue({
                futures_balances: { USDT: { available: '100', total: '100' } },
            }),
            regularOrders: vi.fn().mockResolvedValue({
                futures_regular_orders: [{
                    symbol: 'TUTUSDT', orderId: 31, orderKind: 'REGULAR', status: 'NEW', transactTime: 1_000,
                }],
            }),
            algoOrders: vi.fn().mockResolvedValue({ futures_algo_orders: [] }),
            positions: vi.fn().mockResolvedValue({ futures_positions: [] }),
        };
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue(
            ['balances', 'regularOrders', 'algoOrders', 'positions'].map(type => ({
                type,
                weight: 5,
                errorLabel: type,
                loadPayload: loads[type],
            })),
        );

        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'futures-live' }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const workingOrders = () => moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_account_state')
            .at(-1).resources.regularOrders.data;
        expect(workingOrders().map(order => order.orderId)).toEqual([31]);

        // The next read is held open, exactly as one that left before the
        // placement would be.
        loads.regularOrders.mockImplementationOnce(() => new Promise((resolve) => {
            answerOrdersRead = resolve;
        }));
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        expect(answerOrdersRead).not.toBeNull();

        // The order is placed and the stream says so while that read is out.
        socket.handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 5_000,
            o: {
                s: 'TUTUSDT', i: 32, X: 'NEW', S: 'BUY', o: 'LIMIT', p: '1', q: '5', T: 5_000,
            },
        }));
        await flushMicrotasks();
        expect(workingOrders().map(order => order.orderId)).toEqual([31, '32']);

        // The read answers without it, because it left before the order existed.
        answerOrdersRead({
            futures_regular_orders: [{
                symbol: 'TUTUSDT', orderId: 31, orderKind: 'REGULAR', status: 'NEW', transactTime: 1_000,
            }],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        expect(workingOrders().map(order => order.orderId)).toEqual([31, '32']);
    });

    // A logical account read can physically leave more than once: clock recovery
    // and safe transport retries both admit a new request. Reconciliation must
    // date the payload from the attempt that actually produced it. Dating it
    // from the first attempt would preserve an order the final, much newer REST
    // answer authoritatively omitted.
    it('dates a retried account snapshot from its latest physical admission', async () => {
        const loads = {
            regularOrders: vi.fn().mockResolvedValue({
                futures_regular_orders: [{
                    symbol: 'TUTUSDT', orderId: 31, orderKind: 'REGULAR',
                    status: 'NEW', transactTime: 1_000,
                }],
            }),
        };
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'regularOrders',
            weight: 5,
            errorLabel: 'regular orders',
            loadPayload: loads.regularOrders,
        }]);

        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'futures-live' }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const workingOrders = () => moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_account_state')
            .at(-1).resources.regularOrders.data;
        expect(workingOrders().map(order => order.orderId)).toEqual([31]);

        let admitRetry = null;
        let markFirstAttempt = null;
        const firstAttempt = new Promise((resolve) => { markFirstAttempt = resolve; });
        const retryGate = new Promise((resolve) => { admitRetry = resolve; });
        loads.regularOrders.mockImplementationOnce(async () => {
            // The adapter seam has already admitted the first physical request
            // before entering this mock.
            markFirstAttempt();
            await retryGate;
            await globalThis.__binanceConnectionTestAdmitPhysicalAttempt?.();
            return { futures_regular_orders: [] };
        });

        const refresh = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.refresh',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'retried-account-snapshot',
                symbol: 'TUTUSDT',
            }),
        });
        await vi.advanceTimersByTimeAsync(500);
        await firstAttempt;

        // The stream speaks after attempt one. Once the eventual retry is more
        // than the consistency allowance newer, an empty answer may remove it.
        socket.handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 5_000,
            o: {
                s: 'TUTUSDT', i: 32, X: 'NEW', S: 'BUY', o: 'LIMIT',
                p: '1', q: '5', T: 5_000,
            },
        }));
        await flushMicrotasks();
        expect(workingOrders().map(order => order.orderId)).toEqual([31, '32']);

        await vi.advanceTimersByTimeAsync(3_001);
        admitRetry();
        await vi.advanceTimersByTimeAsync(500);
        await refresh;
        await flushMicrotasks();

        expect(workingOrders()).toEqual([]);
    });

    // The market lane has been timed since `time-the-frame-from-exchange-to-screen`
    // and the account lane never was, which is why an operator reporting a fill
    // drawn late could only be asked what and where. Every frame the exchange
    // causes carries the marks now — the report, the account envelope folded
    // from it, and the envelope a fired algorithmic order folds; nothing the
    // desk sends for a reason of its own does, because a mark invented for a
    // read would time the desk's own beat and call it a journey.
    it('marks every frame the private stream causes, and no frame a read causes', async () => {
        const loads = {
            balances: vi.fn().mockResolvedValue({
                futures_balances: { USDT: { available: '100', total: '100' } },
            }),
            regularOrders: vi.fn().mockResolvedValue({
                futures_regular_orders: [{
                    symbol: 'TUTUSDT', orderId: 41, orderKind: 'REGULAR', status: 'NEW', transactTime: 1_000,
                }],
            }),
            algoOrders: vi.fn().mockResolvedValue({
                futures_algo_orders: [{
                    symbol: 'TUTUSDT', algoId: 77, orderKind: 'ALGO', status: 'NEW',
                }],
            }),
            positions: vi.fn().mockResolvedValue({ futures_positions: [] }),
        };
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue(
            ['balances', 'regularOrders', 'algoOrders', 'positions'].map(type => ({
                type,
                weight: 5,
                errorLabel: type,
                loadPayload: loads[type],
            })),
        );

        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'futures-live' }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const framesOut = () => moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));

        // Everything sent so far was a read's doing: the bootstrap and the
        // account state the stream's own opening asked for.
        expect(framesOut().filter(frame => frame.type === 'futures_account_state')).not.toHaveLength(0);
        for (const frame of framesOut()) expect(frame.marks).toBeUndefined();

        moduleMocks.rendererConnection.sendUTF.mockClear();
        // The half fill: the order rests at part of what it was placed at, which
        // is the case the operator reports and the one nothing could time.
        socket.handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 5_000,
            o: {
                s: 'TUTUSDT', i: 41, X: 'PARTIALLY_FILLED', S: 'BUY', o: 'LIMIT',
                p: '1', q: '5', z: '2', T: 5_000,
            },
        }));
        await flushMicrotasks();

        const report = framesOut().find(frame => frame.futures_execution_update);
        const folded = framesOut().findLast(frame => frame.type === 'futures_account_state');
        // The exchange's own event time on both, so the leg that crosses two
        // clocks is measured from what Binance said rather than from when the
        // desk got round to it.
        expect(report.marks.exchangeAt).toBe(5_000);
        expect(folded.marks.exchangeAt).toBe(5_000);
        for (const frame of [report, folded]) {
            expect(Number.isSafeInteger(frame.marks.receivedAt)).toBe(true);
            expect(frame.marks.queuedAt).toBeGreaterThanOrEqual(frame.marks.receivedAt);
        }
        // The stamp belongs to the envelope: what the report says about the
        // order is untouched by having been measured.
        expect(report.futures_execution_update).toMatchObject({
            symbol: 'TUTUSDT', orderId: '41', status: 'PARTIALLY_FILLED', z: '2',
        });

        // The other frame the same socket folds. A fired stop is drawn on this
        // lane too, and until it was marked the desk could say when it heard one
        // and not when it showed it.
        moduleMocks.rendererConnection.sendUTF.mockClear();
        socket.handlers.message(JSON.stringify({
            e: 'ALGO_UPDATE',
            E: 6_000,
            o: { s: 'TUTUSDT', aid: 77, X: 'FINISHED' },
        }));
        await flushMicrotasks();
        const algoFrames = framesOut().filter(frame => frame.type === 'futures_account_state');
        // The fold has to have happened, or this asserts nothing: the algo is
        // read into the list above so that finishing it takes it out again.
        expect(algoFrames).not.toHaveLength(0);
        expect(algoFrames.at(-1).resources.algoOrders.data).toEqual([]);
        for (const frame of algoFrames) expect(frame.marks?.exchangeAt).toBe(6_000);

        // A frame the desk produced on its own beat states no journey.
        moduleMocks.rendererConnection.sendUTF.mockClear();
        await vi.advanceTimersByTimeAsync(31_000);
        await flushMicrotasks();
        const beat = framesOut().filter(frame => frame.type === 'futures_account_state');
        expect(beat).not.toHaveLength(0);
        for (const frame of beat) expect(frame.marks).toBeUndefined();
    });

    // Which orders the stream reported settled is what keeps a read that left
    // before the settle from putting one back. It is a memory of one account's
    // stream, and an account nobody is on has no stream — held across a market
    // put away and picked up again, it would silently hide a working order the
    // next read is right about.
    it('forgets which orders settled when the market is put away', async () => {
        const loads = {
            balances: vi.fn().mockResolvedValue({
                futures_balances: { USDT: { available: '100', total: '100' } },
            }),
            regularOrders: vi.fn().mockResolvedValue({
                futures_regular_orders: [{
                    symbol: 'TUTUSDT', orderId: 21, orderKind: 'REGULAR', status: 'NEW', transactTime: 1_000,
                }],
            }),
            algoOrders: vi.fn().mockResolvedValue({ futures_algo_orders: [] }),
            positions: vi.fn().mockResolvedValue({ futures_positions: [] }),
        };
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue(
            ['balances', 'regularOrders', 'algoOrders', 'positions'].map(type => ({
                type,
                weight: 5,
                errorLabel: type,
                loadPayload: loads[type],
            })),
        );
        const activate = async (marketMode) => {
            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({ action: 'activate_market', marketMode }),
            });
            await vi.advanceTimersByTimeAsync(2_000);
            await flushMicrotasks();
        };

        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activate('futures-live');
        moduleMocks.futuresUserDataSockets[0].handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const workingOrders = () => moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_account_state')
            .at(-1).resources.regularOrders.data;
        expect(workingOrders().map(order => order.orderId)).toEqual([21]);

        // The order settles on the stream: the read above is now older than the
        // exchange, and anything it says about order 21 is disbelieved.
        moduleMocks.futuresUserDataSockets[0].handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 3_000,
            o: {
                s: 'TUTUSDT', i: 21, X: 'FILLED', S: 'BUY', o: 'LIMIT', p: '1', q: '5', z: '5', T: 3_000,
            },
        }));
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        expect(workingOrders()).toEqual([]);

        await activate('spot');
        await activate('futures-live');
        moduleMocks.futuresUserDataSockets.at(-1).handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        // The same read, believed this time.
        expect(workingOrders().map(order => order.orderId)).toEqual([21]);
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
        // Advanced until the handler is done rather than for a fixed span. A
        // command's fan-out shares the admission queue with whatever else the
        // desk had already asked for — the settled read a stream's opening
        // schedules, for one — and a helper that advances a fixed five seconds
        // hangs on `pending` the moment the two together need six. It stops at
        // the first step where nothing is left, so a command that finishes
        // inside the first span moves the clock exactly as far as it always did.
        let settled = false;
        const done = () => { settled = true; };
        pending.then(done, done);
        for (let step = 0; step < 6 && !settled; step += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
        }
        await pending;
    };

    const startFuturesCommandWithoutAdvancing = command => (
        moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                ...command,
            }),
        })
    );

    const openFuturesHistoryStream = async () => {
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const socket = moduleMocks.futuresUserDataSockets.at(-1);
        expect(socket).toBeDefined();
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();
        return socket;
    };

    const futuresHistoryCoverage = (symbols) => {
        const readAt = Date.now();
        const targetFrom = readAt - (7 * 24 * 60 * 60 * 1000);
        return Object.fromEntries(symbols.map((symbol, index) => [symbol, {
            readAt,
            orderReadAt: readAt,
            tradeReadAt: readAt,
            orderCursor: String(100 + index),
            tradeCursor: String(200 + index),
            // The store exposes v2 evidence only after every retained trade has
            // marginAsset. Model that current, contiguous contract here; legacy
            // coverage deliberately belongs in the migration-specific cases.
            tradeCoverage: {
                version: 2,
                targetFrom,
                targetTo: readAt,
                coveredFrom: targetFrom,
                coveredTo: readAt,
                complete: true,
                pageLimited: false,
                retentionLimited: false,
                continuityComplete: true,
                aborted: false,
                requests: 1,
            },
            generation: 1,
        }]));
    };

    const futuresHistoryAnswers = () => moduleMocks.rendererConnection.sendUTF.mock.calls
        .map(([message]) => JSON.parse(message))
        .filter(payload => payload.futures_history)
        .map(payload => payload.futures_history);

    const startFuturesDeskForSettled = async ({
        settledIncomeStore = null,
        diagnosticRecord = undefined,
    } = {}) => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
            ...(settledIncomeStore === null ? {} : { settledIncomeStore }),
            ...(diagnosticRecord === undefined ? {} : { diagnosticRecord }),
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
    };

    const incomeKindsAsked = () => moduleMocks.futuresAdapter.getIncomePage.mock.calls
        .map(([request]) => request?.incomeType ?? null);

    const settledFrames = () => moduleMocks.rendererConnection.sendUTF.mock.calls
        .map(([message]) => JSON.parse(message))
        .filter(payload => payload.type === 'futures_settled_income');

    const SETTLED_CREDIT_INCOME_TYPES = Object.freeze([
        'COMMISSION_REBATE',
        'API_REBATE',
        'REFERRAL_KICKBACK',
        'FEE_RETURN',
    ]);
    const SETTLED_ALL_INCOME_TYPES = FUTURES_UNDERIVABLE_INCOME_TYPES;
    const terminalSettledIncomeRefusal = () => Object.assign(
        new Error('IP banned'),
        { code: '-1003', response: { status: 418 } },
    );

    // The one reason left that a clock can produce. A fill that realized
    // something asks for a settled read, and a busy afternoon is thousands of
    // them — where the operator's own refresh is a person looking at a number
    // and is never deferred.
    const sendExecutionFill = (socket, orderId, realizedPnl = '12.5') => {
        socket.handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 4_000 + orderId,
            o: {
                s: 'BTCUSDT', i: orderId, X: 'FILLED', x: 'TRADE', S: 'SELL', o: 'LIMIT',
                p: '100', q: '1', z: '1', l: '1', t: orderId + 10_000,
                rp: realizedPnl, T: 4_000 + orderId,
            },
        }));
    };

    const deliverRealizingFill = async (socket, orderId, realizedPnl = '12.5') => {
        sendExecutionFill(socket, orderId, realizedPnl);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
    };

    const sendFundingEvent = (socket, eventTime = 9_000) => {
        socket.handlers.message(JSON.stringify({
            e: 'ACCOUNT_UPDATE', E: eventTime, T: eventTime,
            a: {
                m: 'FUNDING_FEE',
                B: [{ a: 'USDT', wb: '990.5', cw: '990.5', bc: '-9.5' }],
                P: [],
            },
        }));
    };

    const sendInsuranceEvent = (socket) => {
        socket.handlers.message(JSON.stringify({
            e: 'MARGIN_CALL',
            E: Date.now(),
            cw: '3.16812045',
            p: [{
                s: 'TUTUSDT', ps: 'LONG', pa: '1.327', mt: 'crossed', iw: '0',
                mp: '187.17127', up: '-1.166074', mm: '1.614445',
            }],
        }));
    };

    it('bootstraps settled income on first Futures activation without a private stream open', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });

        await activateMarket('futures-live');
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
        const unopenedSocket = moduleMocks.futuresUserDataSockets.at(-1);
        expect(unopenedSocket).toBeDefined();
        // Deliberately never call `unopenedSocket.handlers.open()`.

        expect(new Set(incomeKindsAsked())).toEqual(new Set(SETTLED_ALL_INCOME_TYPES));
        const bootstraps = settledFrames().filter(frame => frame.reason === 'bootstrap');
        expect(bootstraps).toHaveLength(1);
        const bootstrap = bootstraps[0];
        expect(bootstrap).toMatchObject({ reason: 'bootstrap', status: 'ready', complete: true });
    });

    it('does not repeat the all-lane bootstrap when the private stream opens later', async () => {
        const loadBalances = vi.fn().mockResolvedValue({
            futures_balances: { USDT: { available: '1000', total: '1000' } },
        });
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'balances',
            weight: 5,
            errorLabel: 'balances',
            loadPayload: loadBalances,
        }]);

        await startFuturesDeskForSettled();
        const privateSocket = moduleMocks.futuresUserDataSockets.at(-1);
        const bootstrapReads = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        const accountReadsBeforeOpen = loadBalances.mock.calls.length;
        expect(bootstrapReads).toBe(SETTLED_ALL_INCOME_TYPES.length);

        // Finish the handshake well after the 1.2-second bootstrap debounce.
        // Before the fix this armed another six-lane pass solely because the
        // socket opened, despite carrying no new settlement evidence.
        privateSocket.handlers.open();
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();

        expect(loadBalances).toHaveBeenCalledTimes(accountReadsBeforeOpen + 1);
        expect(moduleMocks.futuresAdapter.getIncomePage).toHaveBeenCalledTimes(bootstrapReads);

        // Stream readiness still leaves event-specific reconciliation alive.
        sendFundingEvent(privateSocket);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getIncomePage).toHaveBeenCalledTimes(
            bootstrapReads + 1,
        );
        expect(incomeKindsAsked().at(-1)).toBe('FUNDING_FEE');
    });

    it('retires a settled-income page queued at physical admission across account switch', async () => {
        const settledIncomeStore = {
            loadResource: vi.fn(() => null),
            saveResource: vi.fn(),
        };
        await startFuturesDeskForSettled({ settledIncomeStore });
        const privateSocket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();

        const admitPhysicalAttempt = globalThis.__binanceConnectionTestAdmitPhysicalAttempt;
        let admissionHeld = false;
        let releaseAdmission = null;
        globalThis.__binanceConnectionTestAdmitPhysicalAttempt = async (weight, options) => {
            if (!admissionHeld && weight === null) {
                admissionHeld = true;
                await new Promise((resolve) => { releaseAdmission = resolve; });
            }
            return admitPhysicalAttempt(weight, options);
        };

        sendFundingEvent(privateSocket);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(releaseAdmission).toBeTypeOf('function');
        expect(moduleMocks.futuresAdapter.getIncomePage).not.toHaveBeenCalled();

        await activateMarket('spot');
        settledIncomeStore.saveResource.mockClear();
        console.warn.mockClear();
        releaseAdmission();
        await vi.advanceTimersByTimeAsync(FUTURES_REST_ADMISSION_SPACING_MS * 2);
        await flushMicrotasks();

        expect(moduleMocks.futuresAdapter.getIncomePage).not.toHaveBeenCalled();
        expect(settledIncomeStore.saveResource).not.toHaveBeenCalled();
        expect(settledFrames()).toEqual([]);
        expect(console.warn.mock.calls.some(([message]) => (
            String(message).startsWith('[futures-settled]')
        ))).toBe(false);

        await activateMarket('futures-live');
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();

        expect(moduleMocks.futuresAdapter.getIncomePage)
            .toHaveBeenCalledTimes(SETTLED_ALL_INCOME_TYPES.length);
        expect(settledFrames().at(-1)).toMatchObject({
            reason: 'bootstrap', status: 'ready', complete: true,
        });
    });

    it('sends a current settled snapshot to a later renderer despite global revision dedup', async () => {
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        await startFuturesDeskForSettled();
        const current = settledFrames().at(-1);
        expect(current).toMatchObject({
            reason: 'bootstrap',
            status: 'ready',
            accountFingerprint: ACCOUNT_FINGERPRINT,
        });
        const incomeReads = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        moduleMocks.rendererConnection.sendUTF.mockClear();

        const handlers = {};
        const laterRenderer = {
            connected: true,
            remoteAddress: '127.0.0.1',
            sendUTF: vi.fn(),
            drop: vi.fn(),
            on: vi.fn((event, handler) => { handlers[event] = handler; }),
        };
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => laterRenderer),
        });
        await handlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'futures-live' }),
        });
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();

        const laterFrames = laterRenderer.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        const activationIndex = laterFrames.findIndex(payload => (
            payload.type === 'market_activation'
            && payload.marketMode === 'futures-live'
        ));
        const accountIndex = laterFrames.findIndex(payload => (
            payload.type === 'futures_account_state'
        ));
        const snapshotIndex = laterFrames.findIndex(payload => (
            payload.type === 'futures_settled_income'
            && payload.reason === 'snapshot'
        ));
        expect([activationIndex, accountIndex, snapshotIndex]).toEqual([
            activationIndex,
            activationIndex + 1,
            activationIndex + 2,
        ]);
        expect(laterFrames[accountIndex]).toMatchObject({
            accountFingerprint: current.accountFingerprint,
        });
        const laterSettled = laterFrames
            .filter(payload => payload.type === 'futures_settled_income');
        expect(laterSettled).toHaveLength(1);
        expect(laterSettled[0]).toMatchObject({
            reason: 'snapshot',
            status: current.status,
            generation: current.generation,
            digest: current.digest,
            accountFingerprint: current.accountFingerprint,
        });
        expect(settledFrames()).toEqual([]);
        const originalAccountFrames = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_account_state');
        expect(originalAccountFrames).toEqual([]);
        expect(moduleMocks.futuresAdapter.getIncomePage).toHaveBeenCalledTimes(incomeReads);

        laterRenderer.connected = false;
        await handlers.close?.();
    });

    it('blocks automatic tick and event reads after HTTP 418', async () => {
        moduleMocks.futuresAdapter.getIncomePage.mockRejectedValue(
            terminalSettledIncomeRefusal(),
        );
        await startFuturesDeskForSettled();
        const afterTerminal = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        expect(afterTerminal).toBe(SETTLED_ALL_INCOME_TYPES.length);
        moduleMocks.futuresAdapter.getIncomePage.mockResolvedValue({ rows: [], full: false });

        await runFuturesCommand({
            action: 'account.refresh',
            clientOrderId: 'terminal-tick-blocked',
            symbol: 'BTCUSDT',
            periodic: true,
        });
        const socket = await openFuturesHistoryStream();
        sendFundingEvent(socket);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(moduleMocks.futuresAdapter.getIncomePage).toHaveBeenCalledTimes(afterTerminal);
        expect(settledFrames().at(-1)).toMatchObject({
            reason: 'confirm',
            complete: false,
            lanes: {
                FUNDING_FEE: {
                    status: 'stale',
                    complete: false,
                    confirmationNotBefore: expect.any(Number),
                },
            },
        });
        expect(moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_manual_refresh_outcome'))
            .toEqual([]);
    });

    it('lets hourly verification recover settled income after HTTP 418', async () => {
        moduleMocks.futuresAdapter.getIncomePage.mockRejectedValue(
            terminalSettledIncomeRefusal(),
        );
        await startFuturesDeskForSettled();
        const afterTerminal = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        moduleMocks.futuresAdapter.getIncomePage.mockResolvedValue({ rows: [], full: false });

        await vi.advanceTimersByTimeAsync(60 * 60_000);
        await flushMicrotasks();

        expect(moduleMocks.futuresAdapter.getIncomePage.mock.calls.length - afterTerminal)
            .toBe(SETTLED_ALL_INCOME_TYPES.length);
        expect(settledFrames().at(-1)).toMatchObject({
            reason: 'verification', status: 'ready', complete: true,
        });
    });

    it('keeps the HTTP 418 floor when a full recovery probe has an empty lane', async () => {
        moduleMocks.futuresAdapter.getIncomePage.mockRejectedValue(
            terminalSettledIncomeRefusal(),
        );
        await startFuturesDeskForSettled();
        const afterTerminal = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        let probeCall = 0;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(() => {
            probeCall += 1;
            return Promise.resolve(probeCall === 1 ? null : { rows: [], full: false });
        });

        await vi.advanceTimersByTimeAsync(60 * 60_000);
        await flushMicrotasks();
        const afterFailedProbe = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        expect(afterFailedProbe - afterTerminal).toBe(SETTLED_ALL_INCOME_TYPES.length);
        expect(settledFrames().at(-1)).toMatchObject({
            reason: 'verification', complete: false,
        });

        const socket = await openFuturesHistoryStream();
        sendFundingEvent(socket);
        await runFuturesCommand({
            action: 'account.refresh',
            clientOrderId: 'terminal-floor-still-active',
            symbol: 'BTCUSDT',
            periodic: true,
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(moduleMocks.futuresAdapter.getIncomePage)
            .toHaveBeenCalledTimes(afterFailedProbe);
    });

    it('publishes the newer successful observation time after healthy verification', async () => {
        await startFuturesDeskForSettled();
        const before = settledFrames().at(-1);
        expect(before).toMatchObject({ status: 'ready', complete: true });
        moduleMocks.rendererConnection.sendUTF.mockClear();

        await vi.advanceTimersByTimeAsync(60 * 60_000);
        await flushMicrotasks();

        const verifications = settledFrames().filter(frame => frame.reason === 'verification');
        expect(verifications).toHaveLength(1);
        const verified = verifications[0];
        expect(verified).toMatchObject({ status: 'ready', complete: true });
        expect(verified.attemptedAt).toBeGreaterThan(before.attemptedAt);
        expect(verified.successfulAt).toBeGreaterThan(before.successfulAt);
    });

    it('lets manual Refresh recover settled income before HTTP 418 backoff expires', async () => {
        moduleMocks.futuresAdapter.getIncomePage.mockRejectedValue(
            terminalSettledIncomeRefusal(),
        );
        await startFuturesDeskForSettled();
        const afterTerminal = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        moduleMocks.futuresAdapter.getIncomePage.mockResolvedValue({ rows: [], full: false });

        await runFuturesCommand({
            action: 'account.refresh',
            clientOrderId: 'terminal-manual-recovery',
            symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(moduleMocks.futuresAdapter.getIncomePage.mock.calls.length - afterTerminal)
            .toBe(SETTLED_ALL_INCOME_TYPES.length);
        expect(settledFrames().at(-1)).toMatchObject({
            reason: 'refresh', status: 'ready', complete: true,
        });
    });

    it('keeps one terminal rebate cooldown local while events and deliberate reads continue', async () => {
        const diagnostics = [];
        const diagnosticRecord = {
            ...DESK_DIAGNOSTICS_UNRECORDED,
            record: (kind, payload) => {
                diagnostics.push({ kind, ...payload });
                return true;
            },
        };
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => (
            incomeType === 'API_REBATE'
                ? Promise.reject(Object.assign(new Error('rebate permission refused'), {
                    code: '-1002',
                    response: { status: 403 },
                }))
                : Promise.resolve({ rows: [], full: false })
        ));

        await startFuturesDeskForSettled({ diagnosticRecord });
        expect(settledFrames().at(-1).lanes.API_REBATE).toMatchObject({
            status: 'error',
            complete: false,
            error: { code: '-1002', status: 403 },
        });
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        diagnostics.length = 0;
        sendFundingEvent(socket, Date.now());
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toEqual(['FUNDING_FEE']);
        expect(diagnostics.filter(entry => entry.kind === 'settled').at(-1))
            .toMatchObject({ reason: 'funding', types: 1, attempts: 1, chargedWeight: 30 });

        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        socket.handlers.message(JSON.stringify({
            e: 'MARGIN_CALL',
            E: Date.now(),
            cw: '3.16812045',
            p: [{
                s: 'TUTUSDT', ps: 'LONG', pa: '1.327', mt: 'crossed', iw: '0',
                mp: '187.17127', up: '-1.166074', mm: '1.614445',
            }],
        }));
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toEqual(['INSURANCE_CLEAR']);
        expect(diagnostics.filter(entry => entry.kind === 'settled').at(-1))
            .toMatchObject({ reason: 'insurance', types: 1, attempts: 1, chargedWeight: 30 });

        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        await runFuturesCommand({
            action: 'account.refresh',
            clientOrderId: 'rebate-cooldown-manual-bypass',
            symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(new Set(incomeKindsAsked())).toEqual(new Set(SETTLED_ALL_INCOME_TYPES));
        expect(diagnostics.filter(entry => (
            entry.kind === 'settled' && entry.reason === 'refresh'
        )).at(-1)).toMatchObject({
            types: SETTLED_ALL_INCOME_TYPES.length,
            attempts: SETTLED_ALL_INCOME_TYPES.length,
            chargedWeight: SETTLED_ALL_INCOME_TYPES.length * 30,
        });

        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        const diagnosticBoundary = diagnostics.length;
        await vi.advanceTimersByTimeAsync(60 * 60_000 + 30_000);
        await flushMicrotasks();
        const verification = diagnostics.slice(diagnosticBoundary).filter(entry => (
            entry.kind === 'settled' && entry.reason === 'verification'
        )).at(-1);
        expect(verification).toMatchObject({
            incomeTypes: SETTLED_ALL_INCOME_TYPES,
            types: SETTLED_ALL_INCOME_TYPES.length,
            attempts: SETTLED_ALL_INCOME_TYPES.length,
            chargedWeight: SETTLED_ALL_INCOME_TYPES.length * 30,
            outcome: 'failed',
            code: '-1002',
        });
        expect(incomeKindsAsked()).toContain('API_REBATE');
    });

    it('records cold-start and one-retry verification physical-weight budgets', async () => {
        const diagnostics = [];
        const diagnosticRecord = {
            ...DESK_DIAGNOSTICS_UNRECORDED,
            record: (kind, payload) => {
                diagnostics.push({ kind, ...payload });
                return true;
            },
        };

        await startFuturesDeskForSettled({ diagnosticRecord });
        expect(diagnostics.filter(entry => (
            entry.kind === 'settled' && entry.reason === 'bootstrap'
        )).at(-1)).toMatchObject({
            pages: SETTLED_ALL_INCOME_TYPES.length,
            reads: SETTLED_ALL_INCOME_TYPES.length,
            attempts: SETTLED_ALL_INCOME_TYPES.length,
            chargedWeight: SETTLED_ALL_INCOME_TYPES.length * 30,
            types: SETTLED_ALL_INCOME_TYPES.length,
            outcome: 'complete',
        });

        diagnostics.length = 0;
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        let fundingRetried = false;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => {
            if (incomeType === 'FUNDING_FEE' && !fundingRetried) {
                fundingRetried = true;
                return Promise.reject(Object.assign(new Error('pooled socket reset'), {
                    code: 'ECONNRESET',
                }));
            }
            return Promise.resolve({ rows: [], full: false });
        });

        await vi.advanceTimersByTimeAsync(60 * 60_000 + 30_000);
        await flushMicrotasks();

        expect(moduleMocks.futuresAdapter.getIncomePage)
            .toHaveBeenCalledTimes(SETTLED_ALL_INCOME_TYPES.length + 1);
        expect(diagnostics.filter(entry => (
            entry.kind === 'settled' && entry.reason === 'verification'
        )).at(-1)).toMatchObject({
            pages: SETTLED_ALL_INCOME_TYPES.length,
            reads: SETTLED_ALL_INCOME_TYPES.length,
            attempts: SETTLED_ALL_INCOME_TYPES.length + 1,
            chargedWeight: (SETTLED_ALL_INCOME_TYPES.length + 1) * 30,
            types: SETTLED_ALL_INCOME_TYPES.length,
            verified: 1,
            outcome: 'complete',
        });
    });

    it('records the immediate funding physical-weight budget', async () => {
        const diagnostics = [];
        const diagnosticRecord = {
            ...DESK_DIAGNOSTICS_UNRECORDED,
            record: (kind, payload) => {
                diagnostics.push({ kind, ...payload });
                return true;
            },
        };
        await startFuturesDeskForSettled({ diagnosticRecord });
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        diagnostics.length = 0;
        moduleMocks.futuresAdapter.getIncomePage.mockClear();

        sendFundingEvent(socket, Date.now());
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(incomeKindsAsked()).toEqual(['FUNDING_FEE']);
        expect(diagnostics.filter(entry => (
            entry.kind === 'settled' && entry.reason === 'funding'
        )).at(-1)).toMatchObject({
            pages: 1,
            reads: 1,
            attempts: 1,
            chargedWeight: 30,
            types: 1,
            outcome: 'partial',
        });
    });

    it('charges a pooled fallback inside one credit-confirmation budget', async () => {
        const diagnostics = [];
        const diagnosticRecord = {
            ...DESK_DIAGNOSTICS_UNRECORDED,
            record: (kind, payload) => {
                diagnostics.push({ kind, ...payload });
                return true;
            },
        };
        await startFuturesDeskForSettled({ diagnosticRecord });
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        diagnostics.length = 0;
        moduleMocks.futuresAdapter.getIncomePage.mockClear();

        let fallbackInjected = false;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(async ({ incomeType }) => {
            if (incomeType === 'API_REBATE' && !fallbackInjected) {
                fallbackInjected = true;
                // The runtime wrapper admitted the pooled send. Model the
                // adapter's replay-safe fresh-connection send in the same
                // physical context without adding another logical page.
                await globalThis.__binanceConnectionTestAdmitPhysicalAttempt?.();
            }
            return { rows: [], full: false };
        });

        sendExecutionFill(socket, 8_091);
        await vi.advanceTimersByTimeAsync(2 * 60_000 + 30_000);
        await flushMicrotasks();

        expect(incomeKindsAsked()).toHaveLength(SETTLED_CREDIT_INCOME_TYPES.length);
        expect(diagnostics.filter(entry => (
            entry.kind === 'settled' && entry.reason === 'credit-confirm'
        )).at(-1)).toMatchObject({
            pages: SETTLED_CREDIT_INCOME_TYPES.length,
            reads: SETTLED_CREDIT_INCOME_TYPES.length,
            attempts: SETTLED_CREDIT_INCOME_TYPES.length + 1,
            chargedWeight: (SETTLED_CREDIT_INCOME_TYPES.length + 1) * 30,
            types: SETTLED_CREDIT_INCOME_TYPES.length,
            outcome: 'partial',
        });
    });

    it('charges time sync and retry inside one insurance-confirmation budget', async () => {
        const diagnostics = [];
        const diagnosticRecord = {
            ...DESK_DIAGNOSTICS_UNRECORDED,
            record: (kind, payload) => {
                diagnostics.push({ kind, ...payload });
                return true;
            },
        };
        await startFuturesDeskForSettled({ diagnosticRecord });
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        diagnostics.length = 0;
        moduleMocks.futuresAdapter.getIncomePage.mockClear();

        let insuranceReads = 0;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(async ({ incomeType }) => {
            if (incomeType === 'INSURANCE_CLEAR') {
                insuranceReads += 1;
                if (insuranceReads === 2) {
                    // One public adapter call can perform three low-level sends
                    // after -1021: rejected income, weight-1 time sync, then the
                    // fresh signed weight-30 retry.
                    await globalThis.__binanceConnectionTestAdmitPhysicalAttempt?.(1);
                    await globalThis.__binanceConnectionTestAdmitPhysicalAttempt?.(30);
                }
            }
            return { rows: [], full: false };
        });

        socket.handlers.message(JSON.stringify({
            e: 'MARGIN_CALL',
            E: Date.now(),
            cw: '3.16812045',
            p: [{
                s: 'TUTUSDT', ps: 'LONG', pa: '1.327', mt: 'crossed', iw: '0',
                mp: '187.17127', up: '-1.166074', mm: '1.614445',
            }],
        }));
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(diagnostics.filter(entry => (
            entry.kind === 'settled' && entry.reason === 'insurance'
        )).at(-1)).toMatchObject({ attempts: 1, chargedWeight: 30 });

        diagnostics.length = 0;
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        await vi.advanceTimersByTimeAsync(90_000);
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(incomeKindsAsked()).toEqual(['INSURANCE_CLEAR']);
        expect(diagnostics.filter(entry => (
            entry.kind === 'settled' && entry.reason === 'insurance-confirm'
        )).at(-1)).toMatchObject({
            pages: 1,
            reads: 1,
            attempts: 3,
            chargedWeight: 61,
            types: 1,
            outcome: 'partial',
        });
    });

    // The read that cost the operator 60 weight a minute asked for nothing in
    // particular, and `/fapi/v1/income` says what that means: *"If incomeType is
    // not sent, all kinds of flow will be returned."* Thirteen thousand rows a
    // week on this account, of which forty-five were funding and the rest were
    // per-fill realized PnL and commission the desk already had from the trade
    // record.
    //
    // Asserted on what goes onto the wire, not on what comes back. A test that
    // only checks the rows passes unchanged against a read that still asks for
    // everything — which is exactly the test this file did not have.
    it('reads every required lane on refresh and publishes a plain v2 resource frame', async () => {
        await startFuturesDeskForSettled();

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'settled-narrow', symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        const kinds = incomeKindsAsked();
        expect(kinds.length).toBeGreaterThan(0);
        // Never the whole record.
        expect(kinds).not.toContain(null);
        expect(kinds).not.toContain(undefined);
        expect(new Set(kinds)).toEqual(new Set(SETTLED_ALL_INCOME_TYPES));
        // And what that table currently holds, written out. A guard, not a
        // measure of anything: it cannot fail against the reading before this
        // change. Its job is that adding a metered kind to the table is a
        // decision someone makes rather than one the assertion above absorbs.
        expect(new Set(FUTURES_UNDERIVABLE_INCOME_TYPES)).toEqual(new Set([
            'FUNDING_FEE',
            'INSURANCE_CLEAR',
            'COMMISSION_REBATE',
            'REFERRAL_KICKBACK',
            'API_REBATE',
            'FEE_RETURN',
        ]));
        // Gross commission and realized PnL both remain fill-derived.
        expect(kinds).not.toContain('COMMISSION');
        expect(kinds).not.toContain('REALIZED_PNL');

        const frames = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_settled_income');
        const frame = frames.at(-1);
        expect(frame).toMatchObject({
            version: 2,
            status: 'ready',
            complete: true,
            reason: 'refresh',
        });
        expect(frame.generation).toBeGreaterThan(0);
        expect(frame.digest).toMatch(/^[a-f0-9]{16}$/);
        expect(frame).not.toHaveProperty('rows');
        expect(new Set(Object.keys(frame.lanes))).toEqual(new Set(SETTLED_ALL_INCOME_TYPES));
        for (const lane of Object.values(frame.lanes)) {
            expect(Array.isArray(lane.rows)).toBe(true);
            expect(lane).toHaveProperty('coveredFrom');
            expect(lane).toHaveProperty('coveredTo');
            expect(lane).toHaveProperty('targetTo');
        }
    });

    // Funding settles six times a day on this account and the account tick fires
    // every thirty seconds while an order rests. Reading on the tick is 2 880
    // requests a day to observe six events, and it was most of what the settled
    // read cost.
    it('does not re-read a complete reading because a clock asked', async () => {
        await startFuturesDeskForSettled();

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'settled-first', symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        const afterFirst = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        expect(afterFirst).toBeGreaterThan(0);

        // And the thirty-second reconcile, which is the clock that actually
        // fires. It arrives as the same command a person sends and says so.
        for (const clientOrderId of ['tick-1', 'tick-2', 'tick-3']) {
            await runFuturesCommand({
                action: 'account.refresh', clientOrderId, symbol: 'BTCUSDT', periodic: true,
            });
            await vi.advanceTimersByTimeAsync(30_000);
            await flushMicrotasks();
        }

        expect(moduleMocks.futuresAdapter.getIncomePage.mock.calls.length).toBe(afterFirst);
    });

    it('publishes a zero-realized fill as non-exact and reads credit lanes only once later', async () => {
        await startFuturesDeskForSettled();
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();

        await deliverRealizingFill(socket, 74, '0');

        // The fill already carries gross commission. It invalidates the four
        // late-credit lanes synchronously, without spending one REST request.
        expect(incomeKindsAsked()).toEqual([]);
        const pending = settledFrames().at(-1);
        expect(pending.reason).toBe('credit-confirm');
        expect(pending.complete).toBe(false);
        for (const incomeType of SETTLED_CREDIT_INCOME_TYPES) {
            expect(pending.lanes[incomeType].status).toBe('stale');
            expect(pending.completeByType[incomeType]).toBe(false);
        }

        await vi.advanceTimersByTimeAsync(89_999);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        // The confirmation timer only schedules the pass; the ordinary read
        // debounce and admission still stand between the timer and Binance.
        expect(incomeKindsAsked()).toEqual([]);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toHaveLength(SETTLED_CREDIT_INCOME_TYPES.length);
        expect(new Set(incomeKindsAsked())).toEqual(new Set(SETTLED_CREDIT_INCOME_TYPES));
        const confirmed = settledFrames().at(-1);
        for (const incomeType of SETTLED_CREDIT_INCOME_TYPES) {
            expect(confirmed.lanes[incomeType].status).toBe('ready');
            expect(confirmed.completeByType[incomeType]).toBe(true);
        }

        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        await vi.advanceTimersByTimeAsync(3 * 60_000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getIncomePage).not.toHaveBeenCalled();
    });

    it('does not spend a periodic tick on lanes waiting for confirmation', async () => {
        await startFuturesDeskForSettled();
        const socket = await openFuturesHistoryStream();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();

        sendExecutionFill(socket, 75, '0');
        await vi.advanceTimersByTimeAsync(60_000);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toEqual([]);

        await runFuturesCommand({
            action: 'account.refresh',
            clientOrderId: 'confirmation-debt-tick',
            symbol: 'BTCUSDT',
            periodic: true,
        });
        await flushMicrotasks();

        // The four credit lanes have a known two-minute write-lag debt and the
        // other two lanes are already complete. A tick has nothing truthful to
        // learn yet, so it must not buy a six-lane pass before the narrow timer.
        expect(incomeKindsAsked()).toEqual([]);
        for (const incomeType of SETTLED_CREDIT_INCOME_TYPES) {
            expect(settledFrames().at(-1).lanes[incomeType]).toMatchObject({
                status: 'stale',
                complete: false,
                confirmationNotBefore: expect.any(Number),
            });
        }
    });

    it('uses a periodic tick only for the distinct incomplete lane', async () => {
        await startFuturesDeskForSettled();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        let refuseFeeReturn = true;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => {
            if (incomeType === 'FEE_RETURN' && refuseFeeReturn) {
                return Promise.reject(Object.assign(new Error('temporary gateway'), {
                    code: 'ETIMEDOUT',
                }));
            }
            return Promise.resolve({ rows: [], full: false });
        });

        await runFuturesCommand({
            action: 'account.refresh',
            clientOrderId: 'one-incomplete-lane',
            symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(settledFrames().at(-1).lanes.FEE_RETURN).toMatchObject({
            status: 'stale',
            complete: false,
        });

        refuseFeeReturn = false;
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        await vi.advanceTimersByTimeAsync(60_000);
        await runFuturesCommand({
            action: 'account.refresh',
            clientOrderId: 'one-incomplete-lane-tick',
            symbol: 'BTCUSDT',
            periodic: true,
        });
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();

        expect(incomeKindsAsked()).toEqual(['FEE_RETURN']);
        expect(settledFrames().at(-1).lanes.FEE_RETURN).toMatchObject({
            status: 'ready',
            complete: true,
        });
    });

    // The operator pressing for the account is not a clock, and on 2026-08-20
    // this desk treated it as one. They watched the 20:00 settlement land in the
    // Binance app, pressed refresh, and the desk answered with the reading it
    // already had — the journal has no `settled` line for the press at all,
    // because the ask never became a read. An hourly reconciliation is not
    // something a person can be told to wait for while looking at a wrong
    // number, and the refresh is the one read they can reach directly.
    it('reads on the operator asking, however lately it last read', async () => {
        await startFuturesDeskForSettled();

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'settled-first', symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        const afterFirst = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        expect(afterFirst).toBeGreaterThan(0);

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'operator-asked', symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(moduleMocks.futuresAdapter.getIncomePage.mock.calls.length)
            .toBeGreaterThan(afterFirst);
    });

    // Both witnesses fire at the instant of the charge, and the record is
    // written after it. Measured on the operator's account: the pass four
    // seconds after the 20:00 `ACCOUNT_UPDATE` came back with no row for it. So
    // the settlement is read twice — once for the timing, once for the row.
    it('asks again once the record has caught up with a settlement', async () => {
        await startFuturesDeskForSettled();
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();

        sendFundingEvent(socket);
        expect(settledFrames()).toHaveLength(1);
        const invalidated = settledFrames().at(-1);
        expect(invalidated.reason).toBe('confirm');
        expect(invalidated.lanes.FUNDING_FEE.status).toBe('stale');
        expect(invalidated.completeByType.FUNDING_FEE).toBe(false);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        const afterCharge = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        expect(incomeKindsAsked()).toEqual(['FUNDING_FEE']);
        expect(afterCharge).toBe(1);
        // A successful immediate answer may still predate the row Binance is
        // about to post, so it cannot restore exactness before confirmation.
        expect(settledFrames().at(-1).lanes.FUNDING_FEE.status).toBe('stale');
        expect(settledFrames().at(-1).completeByType.FUNDING_FEE).toBe(false);

        // Nothing asks in between: the confirming pass is one read, not a poll.
        await vi.advanceTimersByTimeAsync(60_000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getIncomePage.mock.calls.length).toBe(afterCharge);

        await vi.advanceTimersByTimeAsync(90_000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getIncomePage.mock.calls.length).toBe(afterCharge + 1);
        expect(incomeKindsAsked().at(-1)).toBe('FUNDING_FEE');
        const confirmed = settledFrames().at(-1);
        expect(confirmed.reason).toBe('confirm');
        expect(confirmed.lanes.FUNDING_FEE.status).toBe('ready');
        expect(confirmed.completeByType.FUNDING_FEE).toBe(true);
    });

    it('keeps event debt and re-arms confirmation when a lane is cooling down', async () => {
        const settledIncomeStore = keptReading();
        await startFuturesDeskForSettled({ settledIncomeStore });
        const socket = await openFuturesHistoryStream();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();
        settledIncomeStore.saveResource.mockClear();

        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => (
            incomeType === 'FUNDING_FEE'
                ? Promise.reject(Object.assign(new Error('terminal request'), {
                    code: '-1100',
                    response: { status: 400 },
                }))
                : Promise.resolve({ rows: [], full: false })
        ));

        sendFundingEvent(socket, 12_000);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toEqual(['FUNDING_FEE']);
        const firstDeadline = settledIncomeStore.saveResource.mock.calls
            .map(([{ resource }]) => resource.lanes.FUNDING_FEE.confirmationNotBefore)
            .filter(Number.isSafeInteger)
            .at(-1);
        expect(firstDeadline).toBeTypeOf('number');

        await vi.advanceTimersByTimeAsync(10_000);
        sendFundingEvent(socket, 13_000);
        await flushMicrotasks();
        const secondDeadline = settledIncomeStore.saveResource.mock.calls
            .map(([{ resource }]) => resource.lanes.FUNDING_FEE.confirmationNotBefore)
            .filter(Number.isSafeInteger)
            .at(-1);
        expect(secondDeadline).toBeGreaterThan(firstDeadline);
        expect(incomeKindsAsked()).toEqual(['FUNDING_FEE']);

        const timersBeforeDeadline = vi.getTimerCount();
        await vi.advanceTimersByTimeAsync(secondDeadline - Date.now() + 1);
        await flushMicrotasks();

        // The due timer cannot read through the terminal lane cooldown, but it
        // must replace itself for the eligibility boundary instead of silently
        // dropping the exchange event until an hourly/manual audit.
        expect(incomeKindsAsked()).toEqual(['FUNDING_FEE']);
        expect(vi.getTimerCount()).toBeGreaterThanOrEqual(timersBeforeDeadline);
        expect(settledFrames().at(-1).lanes.FUNDING_FEE).toMatchObject({
            status: 'stale',
            complete: false,
            confirmationNotBefore: expect.any(Number),
        });
        expect(settledIncomeStore.saveResource.mock.calls.at(-1)[0]
            .resource.lanes.FUNDING_FEE.confirmationNotBefore).toBe(secondDeadline);
    });

    it('keeps a coalesced event while dropping repaid confirmation through single-flight', async () => {
        await startFuturesDeskForSettled();
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();

        let fundingCalls = 0;
        let holdManualFunding = false;
        let resolveManualFunding;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => {
            if (incomeType !== 'FUNDING_FEE') {
                return Promise.resolve({ rows: [], full: false });
            }
            fundingCalls += 1;
            if (fundingCalls === 1) {
                return Promise.reject(Object.assign(new Error('funding lane refused'), {
                    code: '-1002',
                    response: { status: 403 },
                }));
            }
            if (holdManualFunding && resolveManualFunding === undefined) {
                return new Promise((resolve) => { resolveManualFunding = resolve; });
            }
            return Promise.resolve({ rows: [], full: false });
        });

        sendFundingEvent(socket, Date.now());
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        const failedAt = settledFrames().at(-1).lanes.FUNDING_FEE.attemptedAt;
        expect(settledFrames().at(-1).lanes.FUNDING_FEE.error).toMatchObject({
            status: 403,
        });

        // Let the ordinary two-minute timer discover the lane cooldown and
        // re-arm itself at that cooldown's one-hour boundary.
        await vi.advanceTimersByTimeAsync(2 * 60_000);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toEqual(['FUNDING_FEE']);

        const cooldownAt = failedAt + 60 * 60_000;
        await vi.advanceTimersByTimeAsync(Math.max(0, cooldownAt - Date.now() - 10_000));
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        holdManualFunding = true;
        const command = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                action: 'account.refresh',
                clientOrderId: 'manual-repays-queued-confirmation',
                manual: true,
                symbol: 'BTCUSDT',
            }),
        });
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
        expect(resolveManualFunding).toBeTypeOf('function');

        // The re-armed confirmation now fires and enters its debounce. A newer
        // insurance event joins that same pass before it queues behind the held
        // manual walk; unlike the old funding hint, this event remains authoritative.
        await vi.advanceTimersByTimeAsync(5_100);
        await flushMicrotasks();
        sendInsuranceEvent(moduleMocks.futuresUserDataSockets.at(-1));
        await flushMicrotasks();
        expect(settledFrames().at(-1).reason).toBe('insurance-confirm');
        expect(settledFrames().at(-1).lanes.INSURANCE_CLEAR.confirmationNotBefore)
            .toEqual(expect.any(Number));
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        resolveManualFunding({ rows: [], full: false });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        await command;

        // The manual pass itself reads all six lanes. Its successful funding
        // answer repays the debt, so the queued follow-up drops funding. The
        // insurance event happened after the manual pass started, however, and
        // its independently requested lane must survive the handoff.
        expect(incomeKindsAsked()).toHaveLength(
            SETTLED_ALL_INCOME_TYPES.length + 1,
        );
        expect(new Set(
            incomeKindsAsked().slice(0, SETTLED_ALL_INCOME_TYPES.length),
        )).toEqual(new Set(SETTLED_ALL_INCOME_TYPES));
        expect(new Set(
            incomeKindsAsked().slice(SETTLED_ALL_INCOME_TYPES.length),
        )).toEqual(new Set(['INSURANCE_CLEAR']));
        expect(settledFrames().at(-1).lanes.FUNDING_FEE.confirmationNotBefore).toBeNull();
        expect(settledFrames().at(-1).lanes.INSURANCE_CLEAR.confirmationNotBefore)
            .toEqual(expect.any(Number));
    });

    it('keeps a coalesced event when confirmation is repaid inside the debounce', async () => {
        await startFuturesDeskForSettled();
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();

        let fundingCalls = 0;
        let holdManualFunding = false;
        let resolveManualFunding;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => {
            if (incomeType !== 'FUNDING_FEE') {
                return Promise.resolve({ rows: [], full: false });
            }
            fundingCalls += 1;
            if (fundingCalls === 1) {
                return Promise.reject(Object.assign(new Error('funding lane refused'), {
                    code: '-1002',
                    response: { status: 403 },
                }));
            }
            if (holdManualFunding && resolveManualFunding === undefined) {
                return new Promise((resolve) => { resolveManualFunding = resolve; });
            }
            return Promise.resolve({ rows: [], full: false });
        });

        sendFundingEvent(socket, Date.now());
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        const failedAt = settledFrames().at(-1).lanes.FUNDING_FEE.attemptedAt;

        await vi.advanceTimersByTimeAsync(2 * 60_000);
        await flushMicrotasks();
        const cooldownAt = failedAt + 60 * 60_000;
        await vi.advanceTimersByTimeAsync(Math.max(0, cooldownAt - Date.now() - 10_000));
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        holdManualFunding = true;
        const command = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                action: 'account.refresh',
                clientOrderId: 'manual-repays-debounced-confirmation',
                manual: true,
                symbol: 'BTCUSDT',
            }),
        });
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
        expect(resolveManualFunding).toBeTypeOf('function');

        // The family timer fires five seconds later and schedules its 1.2s
        // debounce. A new insurance event joins the pending pass, then the
        // already-running manual pass repays only the older funding debt inside that gap.
        await vi.advanceTimersByTimeAsync(5_100);
        await flushMicrotasks();
        sendInsuranceEvent(moduleMocks.futuresUserDataSockets.at(-1));
        await flushMicrotasks();
        expect(settledFrames().at(-1).reason).toBe('insurance-confirm');
        expect(settledFrames().at(-1).lanes.INSURANCE_CLEAR.confirmationNotBefore)
            .toEqual(expect.any(Number));
        resolveManualFunding({ rows: [], full: false });
        await vi.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toHaveLength(SETTLED_ALL_INCOME_TYPES.length);

        await vi.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        await command;

        expect(incomeKindsAsked()).toHaveLength(
            SETTLED_ALL_INCOME_TYPES.length + 1,
        );
        expect(new Set(
            incomeKindsAsked().slice(0, SETTLED_ALL_INCOME_TYPES.length),
        )).toEqual(new Set(SETTLED_ALL_INCOME_TYPES));
        expect(new Set(
            incomeKindsAsked().slice(SETTLED_ALL_INCOME_TYPES.length),
        )).toEqual(new Set(['INSURANCE_CLEAR']));
        expect(settledFrames().at(-1).lanes.FUNDING_FEE.confirmationNotBefore).toBeNull();
        expect(settledFrames().at(-1).lanes.INSURANCE_CLEAR.confirmationNotBefore)
            .toEqual(expect.any(Number));
    });

    it('keeps a newer funding event pending when an older confirmation finishes', async () => {
        await startFuturesDeskForSettled();
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();

        let fundingReads = 0;
        let resolveOldConfirmation;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => {
            if (incomeType !== 'FUNDING_FEE') return Promise.resolve({ rows: [], full: false });
            fundingReads += 1;
            if (fundingReads === 2) {
                return new Promise((resolve) => { resolveOldConfirmation = resolve; });
            }
            return Promise.resolve({ rows: [], full: false });
        });

        sendFundingEvent(socket, 9_000);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(fundingReads).toBe(1);

        await vi.advanceTimersByTimeAsync(90_000);
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        expect(fundingReads).toBe(2);
        expect(resolveOldConfirmation).toBeTypeOf('function');

        // This event is newer than the confirmation currently in flight. Its
        // own two-minute deadline must survive that older answer.
        sendFundingEvent(socket, 10_000);
        resolveOldConfirmation({ rows: [], full: false });
        await flushMicrotasks();
        expect(settledFrames().at(-1).lanes.FUNDING_FEE.status).toBe('stale');
        expect(settledFrames().at(-1).completeByType.FUNDING_FEE).toBe(false);

        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(fundingReads).toBe(3);
        expect(settledFrames().at(-1).lanes.FUNDING_FEE.status).toBe('stale');

        await vi.advanceTimersByTimeAsync(90_000);
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(fundingReads).toBe(4);
        expect(settledFrames().at(-1).lanes.FUNDING_FEE.status).toBe('ready');
        expect(settledFrames().at(-1).completeByType.FUNDING_FEE).toBe(true);
    });

    it('retains confirmed rows and stays stale when delayed confirmation fails', async () => {
        const retainedId = '700000000000000777';
        const retainedRow = {
            symbol: 'BTCUSDT', incomeType: 'FUNDING_FEE', income: '-1.25',
            asset: 'USDT', time: Date.now() - 60_000, tranId: retainedId,
        };
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => (
            Promise.resolve({
                rows: incomeType === 'FUNDING_FEE' ? [retainedRow] : [],
                full: false,
            })
        ));
        await startFuturesDeskForSettled();
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(Object.values(settledFrames().at(-1).lanes)
            .some(lane => lane.rows.some(row => row.tranId === retainedId))).toBe(true);

        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();
        let fundingReads = 0;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => {
            if (incomeType !== 'FUNDING_FEE') return Promise.resolve({ rows: [], full: false });
            fundingReads += 1;
            return fundingReads >= 2
                ? Promise.reject(Object.assign(new Error('gateway'), { code: 'ETIMEDOUT' }))
                : Promise.resolve({ rows: [retainedRow], full: false });
        });

        sendFundingEvent(socket);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(fundingReads).toBe(1);
        await vi.advanceTimersByTimeAsync(90_000);
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(fundingReads).toBeGreaterThan(1);
        const failed = settledFrames().at(-1);
        expect(failed.reason).toBe('confirm');
        expect(Object.values(failed.lanes).some(
            lane => lane.rows.some(row => row.tranId === retainedId),
        )).toBe(true);
        expect(failed.lanes.FUNDING_FEE).toMatchObject({
            status: 'stale',
            complete: false,
        });
        expect(failed.completeByType.FUNDING_FEE).toBe(false);
        expect(failed.lanes.FUNDING_FEE.error).not.toBeNull();
    });

    it.each([
        { status: 408, disposition: 'transient', expectedReads: 5 },
        { status: 429, disposition: 'transient', expectedReads: 5 },
        { status: 503, disposition: 'transient', expectedReads: 5 },
        { status: 418, disposition: 'terminal', expectedReads: 2 },
        { status: 400, disposition: 'terminal', expectedReads: 2 },
    ])(
        'treats HTTP $status as $disposition and keeps confirmation retries bounded',
        async ({ status, expectedReads }) => {
            await startFuturesDeskForSettled();
            const socket = await openFuturesHistoryStream();
            await vi.advanceTimersByTimeAsync(30_000);
            await flushMicrotasks();
            moduleMocks.futuresAdapter.getIncomePage.mockClear();
            moduleMocks.rendererConnection.sendUTF.mockClear();

            let fundingReads = 0;
            moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => {
                if (incomeType !== 'FUNDING_FEE') {
                    return Promise.resolve({ rows: [], full: false });
                }
                fundingReads += 1;
                // Isolate the delayed confirmation policy: the event-triggered
                // read succeeds, then only confirmation attempts are refused.
                if (fundingReads === 1) return Promise.resolve({ rows: [], full: false });
                return Promise.reject(Object.assign(new Error('income refusal'), {
                    // -1003 is normally retryable. The HTTP status must win:
                    // 418/other 4xx stop, while 408/429/5xx retry.
                    code: '-1003',
                    response: { status },
                }));
            });

            sendFundingEvent(socket);
            // Covers the immediate read, the delayed confirmation and every
            // possible exponential retry. Transient failures get exactly the
            // configured three retries; terminal failures get none.
            for (const elapsed of [
                30_000,
                90_000, 30_000,
                60_000, 30_000,
                120_000, 30_000,
                240_000, 30_000,
                10 * 60_000,
            ]) {
                await vi.advanceTimersByTimeAsync(elapsed);
                await flushMicrotasks();
            }

            expect(incomeKindsAsked()).toHaveLength(expectedReads);
            expect(new Set(incomeKindsAsked())).toEqual(new Set(['FUNDING_FEE']));
            expect(settledFrames().at(-1).lanes.FUNDING_FEE.error).toMatchObject({
                code: '-1003',
                status,
            });
        },
    );

    // A guard, and named as one: it cannot fail on the reading before this
    // change, because that one read on everything. Its job is the other
    // direction — the cheap way to cut what a read costs is to defer it, and
    // deferring the event itself would leave the column stale for as long as
    // funding takes to settle again while every test about cost still passed.
    // The deferral is for a clock. The charge is not a clock.
    it('reads on the funding the exchange reports, whatever the clock says', async () => {
        await startFuturesDeskForSettled();

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'settled-before-funding', symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        const beforeFunding = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;

        const socket = moduleMocks.futuresUserDataSockets.at(-1);
        expect(socket).toBeDefined();
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        const beforeCharge = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;
        moduleMocks.futuresAdapter.getIncomePage.mockClear();

        socket.handlers.message(JSON.stringify({
            e: 'ACCOUNT_UPDATE', E: 9_000, T: 9_000,
            a: {
                m: 'FUNDING_FEE',
                B: [{ a: 'USDT', wb: '990.5', cw: '990.5', bc: '-9.5' }],
                P: [],
            },
        }));
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(beforeCharge).toBeGreaterThanOrEqual(beforeFunding);
        expect(incomeKindsAsked()).toEqual(['FUNDING_FEE']);
    });

    it('coalesces a burst of fills into one confirmation after its newest fill', async () => {
        await startFuturesDeskForSettled();
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();

        sendExecutionFill(socket, 81);
        await vi.advanceTimersByTimeAsync(60_000);
        sendExecutionFill(socket, 82);
        sendExecutionFill(socket, 83);
        await vi.advanceTimersByTimeAsync(119_999);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toEqual([]);
        // Repeated fills keep one pending resource frame while resetting the
        // deadline to the newest event.
        expect(settledFrames()).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toEqual([]);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(incomeKindsAsked()).toHaveLength(SETTLED_CREDIT_INCOME_TYPES.length);
        expect(new Set(incomeKindsAsked())).toEqual(new Set(SETTLED_CREDIT_INCOME_TYPES));
    });

    it('narrows a credit confirmation retry to the one lane still in debt', async () => {
        await startFuturesDeskForSettled();
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();

        let apiRebateFailed = false;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => {
            if (incomeType === 'API_REBATE' && !apiRebateFailed) {
                apiRebateFailed = true;
                return Promise.resolve(null);
            }
            return Promise.resolve({ rows: [], full: false });
        });
        sendExecutionFill(socket, 8_081);
        await vi.advanceTimersByTimeAsync(2 * 60_000 + 30_000);
        await flushMicrotasks();

        expect(new Set(incomeKindsAsked())).toEqual(new Set(SETTLED_CREDIT_INCOME_TYPES));
        expect(settledFrames().at(-1).lanes.API_REBATE).toMatchObject({
            status: 'stale',
            complete: false,
            confirmationNotBefore: expect.any(Number),
            error: { code: 'EMPTY_ANSWER' },
        });
        for (const incomeType of SETTLED_CREDIT_INCOME_TYPES) {
            if (incomeType === 'API_REBATE') continue;
            expect(settledFrames().at(-1).lanes[incomeType].confirmationNotBefore).toBeNull();
        }

        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        await vi.advanceTimersByTimeAsync(60_000 + 30_000);
        await flushMicrotasks();

        expect(incomeKindsAsked()).toEqual(['API_REBATE']);
    });

    it('reads only insurance clearance after a margin call', async () => {
        await startFuturesDeskForSettled();
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();

        socket.handlers.message(JSON.stringify({
            e: 'MARGIN_CALL',
            E: 4_000,
            cw: '3.16812045',
            p: [{
                s: 'TUTUSDT', ps: 'LONG', pa: '1.327', mt: 'crossed', iw: '0',
                mp: '187.17127', up: '-1.166074', mm: '1.614445',
            }],
        }));
        const invalidated = settledFrames().at(-1);
        expect(invalidated.reason).toBe('insurance-confirm');
        expect(invalidated.lanes.INSURANCE_CLEAR.status).toBe('stale');
        expect(invalidated.completeByType.INSURANCE_CLEAR).toBe(false);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(incomeKindsAsked()).toEqual(['INSURANCE_CLEAR']);
        expect(settledFrames().at(-1).lanes.INSURANCE_CLEAR.status).toBe('stale');
        expect(settledFrames().at(-1).completeByType.INSURANCE_CLEAR).toBe(false);

        await vi.advanceTimersByTimeAsync(90_000);
        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(incomeKindsAsked()).toEqual(['INSURANCE_CLEAR', 'INSURANCE_CLEAR']);
        const confirmed = settledFrames().at(-1);
        expect(confirmed.reason).toBe('insurance-confirm');
        expect(confirmed.lanes.INSURANCE_CLEAR.status).toBe('ready');
        expect(confirmed.completeByType.INSURANCE_CLEAR).toBe(true);
    });

    it('publishes manual income loading and starts it before account reads finish', async () => {
        await startFuturesDeskForSettled();
        moduleMocks.rendererConnection.sendUTF.mockClear();
        moduleMocks.futuresAdapter.getIncomePage.mockClear();

        let resolveAccount;
        let accountFinished = false;
        let incomeStartedWhileAccountPending = false;
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'balances',
            weight: 5,
            errorLabel: 'balances',
            loadPayload: vi.fn(() => new Promise((resolve) => { resolveAccount = resolve; })),
        }]);
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(() => {
            if (!accountFinished) incomeStartedWhileAccountPending = true;
            return Promise.resolve({ rows: [], full: false });
        });

        let commandFinished = false;
        const command = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                action: 'account.refresh',
                clientOrderId: 'manual-concurrent-income',
                manual: true,
                symbol: 'BTCUSDT',
            }),
        });
        command.then(() => { commandFinished = true; });
        await flushMicrotasks();

        const loading = settledFrames()[0];
        expect(settledFrames()).toHaveLength(1);
        expect(loading.reason).toBe('refresh');
        expect(loading.status).toBe('loading');
        expect(loading.complete).toBe(false);
        expect(Object.values(loading.lanes).every(lane => lane.status === 'loading')).toBe(true);
        expect(commandFinished).toBe(false);

        await vi.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();
        expect(resolveAccount).toBeTypeOf('function');
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(new Set(incomeKindsAsked())).toEqual(new Set(SETTLED_ALL_INCOME_TYPES));
        expect(incomeStartedWhileAccountPending).toBe(true);
        expect(commandFinished).toBe(false);

        accountFinished = true;
        resolveAccount({
            futures_balances: { USDT: { available: '100', total: '100' } },
        });
        await command;
        expect(commandFinished).toBe(true);
        const receipts = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_manual_refresh_outcome');
        expect(receipts).toEqual([expect.objectContaining({
            version: 1,
            status: 'accepted',
            request: 'manual-concurrent-income',
            requestedAt: expect.any(Number),
            accountFingerprint: null,
            account: { disposition: 'resource' },
            settledIncome: { disposition: 'resource' },
        })]);
        expect(receipts[0].settledIncome).not.toHaveProperty('status');
    });

    // The cold start the store exists to remove. Every save under `electron/**`
    // relaunches the desk, and the operator's journal for 2026-08-20 carries
    // twelve bootstraps and seven stream reads in ninety minutes — each buying
    // the identical week again.
    const settledResource = (rows, { windowFrom, now }) => {
        const coveredTo = now - 60_000;
        const lanes = Object.fromEntries(SETTLED_ALL_INCOME_TYPES.map(incomeType => [
            incomeType,
            createFuturesSettledIncomeLane(incomeType, {
                rows: rows.filter(row => row.incomeType === incomeType),
                coveredFrom: windowFrom,
                coveredTo,
                targetTo: coveredTo,
                status: 'ready',
                attemptedAt: coveredTo,
                successfulAt: coveredTo,
                complete: true,
            }),
        ]));
        return createFuturesSettledIncomeResource({ lanes, generation: 7 });
    };

    const keptReading = (rows = []) => ({
        loadResource: vi.fn(options => settledResource(rows, options)),
        saveResource: vi.fn(() => true),
    });

    it('keeps newer manual loading authoritative over an older single-flight walk', async () => {
        const settledIncomeStore = keptReading();
        let incomeCall = 0;
        let resolveOldWalk;
        let resolveManualWalk;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(() => {
            incomeCall += 1;
            if (incomeCall === 1) {
                return new Promise((resolve) => { resolveOldWalk = resolve; });
            }
            if (incomeCall === SETTLED_ALL_INCOME_TYPES.length + 1) {
                return new Promise((resolve) => { resolveManualWalk = resolve; });
            }
            return Promise.resolve({ rows: [], full: false });
        });

        await startFuturesDeskForSettled({ settledIncomeStore });
        expect(resolveOldWalk).toBeTypeOf('function');
        moduleMocks.rendererConnection.sendUTF.mockClear();
        settledIncomeStore.saveResource.mockClear();

        const command = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                action: 'account.refresh',
                clientOrderId: 'manual-over-old-walk',
                manual: true,
                symbol: 'BTCUSDT',
            }),
        });
        await flushMicrotasks();
        const loadingFrame = settledFrames().at(-1);
        expect(loadingFrame).toMatchObject({ reason: 'refresh', status: 'loading' });
        expect(Object.values(loadingFrame.lanes).every(
            lane => lane.status === 'loading',
        )).toBe(true);

        resolveOldWalk({ rows: [], full: false });
        await vi.advanceTimersByTimeAsync(10_000);
        await flushMicrotasks();
        expect(resolveManualWalk).toBeTypeOf('function');
        // Finishing the old bootstrap cannot flash ready/stale/error or persist
        // process-local loading while the requested pass waits at its first row.
        expect(settledFrames().at(-1).status).toBe('loading');
        expect(settledFrames().slice(1).every(frame => frame.status === 'loading')).toBe(true);
        expect(settledIncomeStore.saveResource).not.toHaveBeenCalled();

        resolveManualWalk({ rows: [], full: false });
        await vi.advanceTimersByTimeAsync(10_000);
        await flushMicrotasks();
        await command;

        expect(settledFrames().at(-1)).toMatchObject({
            reason: 'refresh',
            status: 'ready',
            complete: true,
        });
        expect(settledIncomeStore.saveResource).toHaveBeenCalled();
        expect(settledIncomeStore.saveResource.mock.calls.at(-1)[0].resource.status)
            .toBe('ready');
    });

    it('persists event debt without persisting process-local manual loading', async () => {
        const settledIncomeStore = keptReading();
        await startFuturesDeskForSettled({ settledIncomeStore });
        const socket = await openFuturesHistoryStream();
        moduleMocks.rendererConnection.sendUTF.mockClear();
        settledIncomeStore.saveResource.mockClear();

        let resolveManualLane;
        let heldManualLane = false;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(() => {
            if (!heldManualLane) {
                heldManualLane = true;
                return new Promise((resolve) => { resolveManualLane = resolve; });
            }
            return Promise.resolve({ rows: [], full: false });
        });
        const command = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                action: 'account.refresh',
                clientOrderId: 'manual-loading-event-debt',
                manual: true,
                symbol: 'BTCUSDT',
            }),
        });
        await flushMicrotasks();
        expect(settledFrames().at(-1).status).toBe('loading');

        sendFundingEvent(socket, Date.now());
        expect(settledIncomeStore.saveResource).toHaveBeenCalledTimes(1);
        const durable = settledIncomeStore.saveResource.mock.calls[0][0].resource;
        expect(durable.lanes.FUNDING_FEE).toMatchObject({
            status: 'stale',
            complete: false,
            confirmationNotBefore: expect.any(Number),
        });
        expect(Object.values(durable.lanes).every(lane => lane.status !== 'loading')).toBe(true);

        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
        expect(resolveManualLane).toBeTypeOf('function');
        resolveManualLane({ rows: [], full: false });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        await command;
    });

    it('does not extend an event-derived confirmation deadline when bootstrap advances target', async () => {
        let eventTarget = null;
        let eventDeadline = null;
        const settledIncomeStore = {
            loadResource: vi.fn((options) => {
                const kept = settledResource([], options);
                eventTarget = Math.ceil((options.now - 90_000) / 1_000) * 1_000;
                eventDeadline = eventTarget + 2 * 60_000;
                const lanes = {
                    ...kept.lanes,
                    FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                        ...kept.lanes.FUNDING_FEE,
                        targetTo: eventTarget,
                        status: 'stale',
                        complete: false,
                        confirmationNotBefore: eventDeadline,
                    }),
                };
                return createFuturesSettledIncomeResource({ lanes, generation: 8 });
            }),
            saveResource: vi.fn(() => true),
        };

        await startFuturesDeskForSettled({ settledIncomeStore });

        const written = settledIncomeStore.saveResource.mock.calls.at(-1)?.[0]
            ?.resource.lanes.FUNDING_FEE;
        expect(written).toBeDefined();
        expect(written.targetTo).toBeGreaterThan(eventTarget);
        expect(written.confirmationNotBefore).toBe(eventDeadline);
        expect(written.status).toBe('stale');
        expect(written.complete).toBe(false);
    });

    it('restores confirmation debt and waits for its deadline before confirming', async () => {
        let confirmationNotBefore = null;
        const settledIncomeStore = {
            loadResource: vi.fn((options) => {
                const kept = settledResource([], options);
                confirmationNotBefore = options.now + 2 * 60_000;
                const lanes = {
                    ...kept.lanes,
                    FUNDING_FEE: createFuturesSettledIncomeLane('FUNDING_FEE', {
                        ...kept.lanes.FUNDING_FEE,
                        status: 'stale',
                        complete: false,
                        confirmationNotBefore,
                    }),
                };
                return createFuturesSettledIncomeResource({ lanes, generation: 8 });
            }),
            saveResource: vi.fn(() => true),
        };

        await startFuturesDeskForSettled({ settledIncomeStore });

        expect(settledFrames().at(-1).lanes.FUNDING_FEE).toMatchObject({
            status: 'stale',
            complete: false,
        });
        const durableConfirmationNotBefore = settledIncomeStore.saveResource.mock.calls.at(-1)
            ?.[0]?.resource.lanes.FUNDING_FEE.confirmationNotBefore;
        // The live timer keeps the exact restored deadline. The durable copy is
        // rounded only upward, so a crash after another event in the same bucket
        // cannot restart early and miss that event's late exchange row.
        expect(durableConfirmationNotBefore).toBeGreaterThanOrEqual(confirmationNotBefore);
        expect(durableConfirmationNotBefore).toBeLessThan(confirmationNotBefore + 1_000);

        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        const remaining = confirmationNotBefore - Date.now();
        expect(remaining).toBeGreaterThan(0);
        await vi.advanceTimersByTimeAsync(remaining - 1);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getIncomePage).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        // The restored deadline re-arms the confirmation scheduler; its ordinary
        // read debounce still applies after that deadline expires.
        expect(moduleMocks.futuresAdapter.getIncomePage).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(incomeKindsAsked()).toEqual(['FUNDING_FEE']);
        expect(settledFrames().at(-1).lanes.FUNDING_FEE.status).toBe('ready');
        expect(settledIncomeStore.saveResource.mock.calls.at(-1)?.[0]
            ?.resource.lanes.FUNDING_FEE.confirmationNotBefore)
            .toBeNull();
    });

    it('does not rewrite the full resource for a duplicate same-deadline witness', async () => {
        const settledIncomeStore = keptReading();
        await startFuturesDeskForSettled({ settledIncomeStore });
        const socket = await openFuturesHistoryStream();
        settledIncomeStore.saveResource.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();

        // Fake time is unchanged between these two messages. The first one makes
        // credit confirmation durable; the second carries no newer deadline and
        // must not synchronously serialize the complete lane ledger again.
        sendExecutionFill(socket, 901);
        sendExecutionFill(socket, 902);

        expect(settledIncomeStore.saveResource).toHaveBeenCalledTimes(1);
        expect(settledFrames()).toHaveLength(1);
    });

    it('does not revisit dense retained rows for a same-bucket fill witness', async () => {
        const denseRows = SETTLED_CREDIT_INCOME_TYPES.flatMap((incomeType, typeIndex) => (
            Array.from({ length: 256 }, (_, index) => ({
                symbol: '',
                incomeType,
                income: '0.01',
                asset: 'USDT',
                time: Date.now() - 60 * 60_000 - index,
                tranId: String(10_000_000 + typeIndex * 1_000 + index),
            }))
        ));
        const settledIncomeStore = keptReading(denseRows);
        await startFuturesDeskForSettled({ settledIncomeStore });
        const socket = await openFuturesHistoryStream();
        settledIncomeStore.saveResource.mockClear();

        sendExecutionFill(socket, 9_001);
        expect(settledIncomeStore.saveResource).toHaveBeenCalledTimes(1);
        const persisted = settledIncomeStore.saveResource.mock.calls[0][0].resource;
        let retainedRowReads = 0;
        for (const incomeType of SETTLED_CREDIT_INCOME_TYPES) {
            const rows = persisted.lanes[incomeType].rows;
            expect(rows.size).toBe(256);
            for (const [identity, row] of rows) {
                rows.set(identity, new Proxy(row, {
                    get(target, property, receiver) {
                        retainedRowReads += 1;
                        return Reflect.get(target, property, receiver);
                    },
                }));
            }
        }

        // Same fake wall time means the durable target/deadline scalars are
        // already covered. The scheduler must return before lane construction,
        // which would read and canonicalize every proxied row again.
        sendExecutionFill(socket, 9_002);

        expect(retainedRowReads).toBe(0);
        expect(settledIncomeStore.saveResource).toHaveBeenCalledTimes(1);
    });

    it('coalesces one hundred distinct-millisecond fills into one restart-safe write', async () => {
        const settledIncomeStore = keptReading();
        await startFuturesDeskForSettled({ settledIncomeStore });
        const socket = await openFuturesHistoryStream();
        settledIncomeStore.saveResource.mockClear();

        // Keep every fill inside one durable second while preserving a distinct
        // wall-clock millisecond for each witness. The first write covers the
        // whole bucket; the following 99 only move the exact in-memory timer.
        const firstAt = Math.ceil(Date.now() / 1_000) * 1_000 + 100;
        for (let index = 0; index < 100; index += 1) {
            vi.setSystemTime(firstAt + index);
            sendExecutionFill(socket, 1_000 + index);
        }

        expect(settledIncomeStore.saveResource).toHaveBeenCalledTimes(1);
        const written = settledIncomeStore.saveResource.mock.calls[0][0].resource;
        const latestAt = firstAt + 99;
        const durableTarget = Math.ceil(firstAt / 1_000) * 1_000;
        for (const incomeType of SETTLED_CREDIT_INCOME_TYPES) {
            expect(written.lanes[incomeType]).toMatchObject({
                targetTo: durableTarget,
                confirmationNotBefore: durableTarget + 2 * 60_000,
                status: 'stale',
                complete: false,
            });
            expect(written.lanes[incomeType].confirmationNotBefore)
                .toBeGreaterThanOrEqual(latestAt + 2 * 60_000);
        }

        moduleMocks.futuresAdapter.getIncomePage.mockClear();
        await vi.advanceTimersByTimeAsync(2 * 60_000 - 1);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getIncomePage).not.toHaveBeenCalled();
    });

    it('finalizes an in-flight generation seven walk after newer event generations', async () => {
        const settledIncomeStore = keptReading();
        let resolveFirstLane;
        let heldFirstLane = true;
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(() => {
            if (!heldFirstLane) return Promise.resolve({ rows: [], full: false });
            heldFirstLane = false;
            return new Promise((resolve) => { resolveFirstLane = resolve; });
        });

        await startFuturesDeskForSettled({ settledIncomeStore });
        const socket = await openFuturesHistoryStream();
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(resolveFirstLane).toBeTypeOf('function');
        settledIncomeStore.saveResource.mockClear();

        const firstAt = Math.ceil(Date.now() / 1_000) * 1_000 + 100;
        vi.setSystemTime(firstAt);
        sendExecutionFill(socket, 2_001);
        vi.setSystemTime(firstAt + 1_000);
        sendExecutionFill(socket, 2_002);

        expect(settledIncomeStore.saveResource.mock.calls.map(
            ([{ resource }]) => resource.generation,
        )).toEqual([8, 9]);

        resolveFirstLane({ rows: [], full: false });
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();

        const saved = settledIncomeStore.saveResource.mock.calls.map(
            ([{ resource }]) => ({ generation: resource.generation, digest: resource.digest }),
        );
        expect(saved.at(-1).generation).toBeGreaterThan(9);
        expect(saved.every((entry, index) => (
            index === 0 || entry.generation >= saved[index - 1].generation
        ))).toBe(true);
        const digestsByGeneration = new Map();
        for (const { generation, digest } of saved) {
            const held = digestsByGeneration.get(generation);
            expect(held === undefined || held === digest).toBe(true);
            digestsByGeneration.set(generation, digest);
        }
        for (const incomeType of SETTLED_CREDIT_INCOME_TYPES) {
            expect(settledIncomeStore.saveResource.mock.calls.at(-1)[0]
                .resource.lanes[incomeType].confirmationNotBefore).not.toBeNull();
        }
    });

    it('reads only the tail when the last run left a reading', async () => {
        const settledIncomeStore = keptReading([{
            symbol: 'BEATUSDT', incomeType: 'FUNDING_FEE', income: '-1.5',
            asset: 'USDT', time: Date.now() - 3_600_000, tranId: '700000000000000010',
        }]);
        await startFuturesDeskForSettled({ settledIncomeStore });
        const beforeRefresh = moduleMocks.futuresAdapter.getIncomePage.mock.calls.length;

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'kept-tail', symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        expect(settledIncomeStore.loadResource).toHaveBeenCalled();
        // One page — six new reads, one per kind. The activation bootstrap has
        // already made its independent baseline pass.
        const asked = moduleMocks.futuresAdapter.getIncomePage.mock.calls.slice(beforeRefresh);
        expect(asked.length).toBe(SETTLED_ALL_INCOME_TYPES.length);
        // And it resumes near the kept edge rather than at the window's start.
        expect(asked[0][0].startTime).toBeGreaterThan(Date.now() - 7 * 24 * 60 * 60 * 1000);
        // What it ends up holding goes back to disk.
        expect(settledIncomeStore.saveResource).toHaveBeenCalled();
    });

    it('stores and broadcasts one same-count correction with exact unsafe identities', async () => {
        const observedAt = Date.now();
        const retainedRows = [
            {
                symbol: 'BEATUSDT', incomeType: 'FUNDING_FEE', income: '-1.5',
                asset: 'USDT', time: observedAt - 60 * 60_000,
                tranId: '90071992547409931234',
            },
            {
                symbol: 'BEATUSDT', incomeType: 'FUNDING_FEE', income: '-2.5',
                asset: 'USDT', time: observedAt - 61 * 60_000,
                tranId: '90071992547409931235',
            },
        ];
        const correctedRows = [
            { ...retainedRows[0], income: '-9.75' },
            { ...retainedRows[1], tranId: '90071992547409931236' },
        ];
        const settledIncomeStore = keptReading(retainedRows);
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;

        await startFuturesDeskForSettled({ settledIncomeStore });
        const before = settledFrames().at(-1);
        expect(before.lanes.FUNDING_FEE.rows).toHaveLength(2);
        settledIncomeStore.saveResource.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => (
            Promise.resolve({
                rows: incomeType === 'FUNDING_FEE'
                    ? [correctedRows[1], correctedRows[0], correctedRows[0]]
                    : [],
                full: false,
            })
        ));

        await vi.advanceTimersByTimeAsync(60 * 60_000);
        await flushMicrotasks();

        const verifications = settledFrames().filter(frame => frame.reason === 'verification');
        expect(verifications).toHaveLength(1);
        const corrected = verifications[0];
        expect(corrected).toMatchObject({
            accountFingerprint: ACCOUNT_FINGERPRINT,
            status: 'ready',
            complete: true,
        });
        expect(corrected.generation).toBeGreaterThan(before.generation);
        expect(corrected.digest).not.toBe(before.digest);
        expect(corrected.lanes.FUNDING_FEE.rows.map(row => ({
            tranId: row.tranId,
            income: row.income,
        }))).toEqual([
            { tranId: '90071992547409931236', income: '-2.5' },
            { tranId: '90071992547409931234', income: '-9.75' },
        ]);

        expect(settledIncomeStore.loadResource).toHaveBeenCalledWith(expect.objectContaining({
            fingerprint: ACCOUNT_FINGERPRINT,
        }));
        const saved = settledIncomeStore.saveResource.mock.calls.at(-1)?.[0];
        expect(saved?.fingerprint).toBe(ACCOUNT_FINGERPRINT);
        expect(saved?.resource).toMatchObject({
            generation: corrected.generation,
            digest: corrected.digest,
        });
        expect([...saved.resource.lanes.FUNDING_FEE.rows.values()].map(row => row.tranId))
            .toEqual(['90071992547409931236', '90071992547409931234']);
    });

    // A kept reading is only safe while it is checked. This is the check: the
    // window read from nothing, compared, and the exchange winning — because a
    // recomputed reading that is wrong is wrong until the next pass, while a
    // stored one is wrong until somebody notices.
    it('drops a kept row the exchange no longer states, and says how many', async () => {
        const settledIncomeStore = keptReading([{
            symbol: 'BEATUSDT', incomeType: 'FUNDING_FEE', income: '-1.5',
            asset: 'USDT', time: Date.now() - 5 * 60_000, tranId: '700000000000000001',
        }]);
        const kept = [];
        const diagnosticRecord = {
            ...DESK_DIAGNOSTICS_UNRECORDED,
            record: (kind, payload) => { kept.push({ kind, ...payload }); return true; },
        };
        await startFuturesDeskForSettled({ settledIncomeStore, diagnosticRecord });

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'kept-verify', symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        const settled = kept.filter(entry => entry.kind === 'settled');
        expect(settled.length).toBeGreaterThan(0);
        // The exchange answers with nothing, so the kept row is gone and the
        // desk says so rather than keeping it because it was once read.
        expect(settled.some(entry => entry.restored === 1)).toBe(true);
        const saved = settledIncomeStore.saveResource.mock.calls.at(-1)?.[0];
        expect([...saved.resource.rows.values()]
            .some(row => row.tranId === '700000000000000001')).toBe(false);
    });

    // The verification is the one pass that walks from nothing, so it is the one
    // pass where a refusal can cost the desk everything it holds. The walk keeps
    // its own rows through a refusal precisely because rows already held are
    // money the desk can account for; starting it from nothing defeats that
    // unless the refusal is caught on the way back out.
    it('keeps the kept reading when the hour\'s verification is refused', async () => {
        const keptRow = {
            symbol: 'BEATUSDT', incomeType: 'FUNDING_FEE', income: '-1.5',
            asset: 'USDT', time: Date.now() - 3_600_000, tranId: '700000000000000011',
        };
        const settledIncomeStore = keptReading([keptRow]);
        moduleMocks.futuresAdapter.getIncomePage.mockRejectedValue(
            Object.assign(new Error('gateway'), { code: 'ETIMEDOUT' }),
        );
        await startFuturesDeskForSettled({ settledIncomeStore });

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'verify-refused', symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        // The failed bootstrap is still spending physical retry weight when the
        // manual request arrives. Wait through the limiter window so the pass
        // authorized for that manual intent, rather than the older completion,
        // owns the terminal stale commit.
        await vi.advanceTimersByTimeAsync(90_000);
        await flushMicrotasks();

        // What reached the screen, first: this is the property, and the file is
        // only how it survives a restart.
        const frames = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_settled_income');
        expect(frames.length).toBeGreaterThan(0);
        expect(Object.values(frames.at(-1).lanes)
            .some(lane => lane.rows.some(entry => entry.symbol === 'BEATUSDT'))).toBe(true);

        const saved = settledIncomeStore.saveResource.mock.calls.at(-1)?.[0];
        expect(saved).toBeDefined();
        // The row is still money the desk can account for, and the coverage it
        // could vouch for is not narrowed by a request that never answered.
        expect([...saved.resource.rows.values()]
            .some(row => row.symbol === 'BEATUSDT')).toBe(true);
        expect(saved.resource.coveredFrom)
            .toBeLessThanOrEqual(Date.now() - 7 * 24 * 60 * 60 * 1000);
        expect(saved.resource.status).toBe('stale');
    });

    it('retains a confirmed lane when only that lane refresh is refused', async () => {
        const retainedId = '700000000000000099';
        const settledIncomeStore = keptReading([{
            symbol: 'BEATUSDT', incomeType: 'FEE_RETURN', income: '0.75',
            asset: 'USDT', time: Date.now() - 5 * 60_000, tranId: retainedId,
        }]);
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => (
            incomeType === 'FEE_RETURN'
                ? Promise.reject(Object.assign(new Error('gateway'), { code: 'ETIMEDOUT' }))
                : Promise.resolve({ rows: [] })
        ));
        await startFuturesDeskForSettled({ settledIncomeStore });

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'one-lane-refused', symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        const frame = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_settled_income')
            .at(-1);
        expect(frame.status).toBe('stale');
        expect(Object.values(frame.lanes)
            .some(lane => lane.rows.some(row => row.tranId === retainedId))).toBe(true);
        expect(frame.lanes.FEE_RETURN).toMatchObject({ status: 'stale', complete: false });
        expect(frame.completeByType.FEE_RETURN).toBe(false);
        expect(frame.lanes.FUNDING_FEE.status).toBe('ready');

        const saved = settledIncomeStore.saveResource.mock.calls.at(-1)?.[0]?.resource;
        expect([...saved.rows.values()].some(row => row.tranId === retainedId)).toBe(true);
        expect(saved.lanes.FEE_RETURN.successfulAt).not.toBeNull();
    });

    it('rejects a non-array income page without replacing retained evidence', async () => {
        const retainedId = '700000000000000199';
        const settledIncomeStore = keptReading([{
            symbol: 'BEATUSDT', incomeType: 'FEE_RETURN', income: '0.75',
            asset: 'USDT', time: Date.now() - 5 * 60_000, tranId: retainedId,
        }]);
        moduleMocks.futuresAdapter.getIncomePage.mockImplementation(({ incomeType }) => (
            incomeType === 'FEE_RETURN'
                ? Promise.resolve({ rows: 'not-an-array' })
                : Promise.resolve({ rows: [] })
        ));
        await startFuturesDeskForSettled({ settledIncomeStore });

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'non-array-income', symbol: 'BTCUSDT',
        });
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        const frame = settledFrames().at(-1);
        expect(frame.lanes.FEE_RETURN).toMatchObject({
            status: 'stale',
            complete: false,
            error: { code: 'INVALID_INCOME_PAGE' },
        });
        expect(frame.lanes.FEE_RETURN.rows
            .some(row => row.tranId === retainedId)).toBe(true);

        const saved = settledIncomeStore.saveResource.mock.calls.at(-1)?.[0]?.resource;
        expect([...saved.rows.values()].some(row => row.tranId === retainedId)).toBe(true);
        expect(saved.completeByType.FEE_RETURN).toBe(false);
    });

    it('never writes quoted request credentials from an income failure to logs', async () => {
        const refusal = Object.assign(new Error(
            'network headers={"Authorization":"Basic BASIC_SECRET",'
            + '"Proxy-Authorization":"Bearer PROXY_SECRET",'
            + '"X-MBX-APIKEY":"KEY_SECRET","signature":"SIGNATURE_SECRET"}',
        ), { code: 'ETIMEDOUT' });
        moduleMocks.futuresAdapter.getIncomePage.mockRejectedValue(refusal);
        const settledIncomeStore = keptReading();
        await startFuturesDeskForSettled({ settledIncomeStore });

        await vi.advanceTimersByTimeAsync(120_000);
        await flushMicrotasks();

        const frame = settledFrames().at(-1);
        const saved = settledIncomeStore.saveResource.mock.calls.at(-1)?.[0]?.resource;
        const exposed = JSON.stringify({
            warnings: console.warn.mock.calls,
            frame,
            saved: saved === undefined ? null : {
                ...saved,
                rows: [...saved.rows.values()],
                lanes: Object.fromEntries(Object.entries(saved.lanes).map(([type, lane]) => [
                    type,
                    { ...lane, rows: [...lane.rows.values()] },
                ])),
            },
        });
        for (const secret of [
            'BASIC_SECRET',
            'PROXY_SECRET',
            'KEY_SECRET',
            'SIGNATURE_SECRET',
            'Authorization',
            'Proxy-Authorization',
            'X-MBX-APIKEY',
            'signature',
        ]) expect(exposed).not.toContain(secret);
        expect(frame.error).toMatchObject({
            code: 'ETIMEDOUT',
            message: 'Income history read failed [credentials redacted]',
        });
        expect(saved.error).toEqual(frame.error);
    });

    it('answers a futures history command without touching account resources', async () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([futuresHistoryTrade({
            id: '2',
            symbol: 'BTCUSDT',
            realizedPnl: '-96.74',
            time: Date.now() - 1,
        })]);

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-1',
            symbol: 'BTCUSDT',
            basisOnly: true,
        });

        expect(moduleMocks.futuresAdapter.getOrderHistory).toHaveBeenCalledWith({ symbol: 'BTCUSDT' });
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledWith(
            expect.objectContaining({
                symbol: 'BTCUSDT',
                startTime: expect.any(Number),
                endTime: expect.any(Number),
                limit: 1000,
            }),
        );
        const [history] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_history);
        expect(history.futures_history).toMatchObject({
            accountFingerprint: ACCOUNT_FINGERPRINT,
            symbol: 'BTCUSDT',
            symbols: ['BTCUSDT'],
            readAt: expect.any(Number),
            basisOnly: true,
            merge: {
                BTCUSDT: { orders: false, trades: false },
            },
            orders: [{ orderId: 1, status: 'FILLED' }],
            trades: [{ id: '2', realizedPnl: '-96.74' }],
            error: null,
        });
        expect(Number.isSafeInteger(history.futures_history.readAt)).toBe(true);
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
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ symbol, endTime }) => (
            Promise.resolve([futuresHistoryTrade({
                id: '2',
                symbol,
                realizedPnl: '1',
                time: endTime - (symbol === 'BICOUSDT' ? 1 : 2),
            })])
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

    // Income is answered oldest-first from the start time given, so a walk across
    // the whole week spends its pages on last Tuesday and never reaches this
    // morning. The last day is therefore walked on its own and first; the rest of
    // the week follows only while the fan-out still has room for what it may find.
    it('walks the last day of income before the rest of the week', async () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const today = ['B1USDT', 'B2USDT'];
        const older = ['A1USDT', 'A2USDT'];
        moduleMocks.futuresAdapter.getTradedSymbolPage
            .mockResolvedValueOnce({ symbols: today, full: false, lastTime: 900 })
            .mockResolvedValueOnce({ symbols: older, full: false, lastTime: 100 });

        const before = Date.now();
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-4',
            symbol: 'ETHUSDT',
        });

        const day = 24 * 60 * 60 * 1000;
        const [[recentPage], [olderPage]] = moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls;
        // The first read freezes the newest day at the command's own instant.
        expect(recentPage.startTime).toBeGreaterThanOrEqual(before - day);
        expect(recentPage.endTime).toBe(before);
        // The second covers the rest of the week and stops where the first began.
        expect(olderPage.startTime).toBeLessThanOrEqual(before - (7 * day) + 5);
        expect(olderPage.endTime).toBe(recentPage.startTime - 1);
        const [history] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_history);
        // Today's contracts lead the list, behind only the one on screen.
        expect(history.futures_history.symbols).toEqual(['ETHUSDT', ...today, ...older]);
        expect(history.futures_history.discoveryComplete).toBe(true);
    });

    // The desk's own eyes against something the operator asked to read. A review
    // is two dozen admissions of the same queue, so a listen key that arrives
    // while one is queued waits out the whole fan-out — and everything the
    // stream would have carried in that window is read back instead.
    it('reopens the private stream ahead of a review already queued', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const socket = await openFuturesHistoryStream();

        // Every futures read the queue let out, in the order it let it out.
        const admitted = [];
        moduleMocks.futuresAdapter.getOrderHistory.mockImplementation(({ symbol }) => {
            admitted.push(`orders:${symbol}`);
            return Promise.resolve([]);
        });
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ symbol }) => {
            admitted.push(`trades:${symbol}`);
            return Promise.resolve([]);
        });
        moduleMocks.futuresAdapter.createUserDataStreamListenKey.mockImplementation(() => {
            admitted.push('listen-key');
            return Promise.resolve('futures-listen-key-restored');
        });
        const contracts = Array.from({ length: 10 }, (_, index) => `Q${index}USDT`);
        moduleMocks.futuresAdapter.getTradedSymbolPage
            .mockResolvedValue({ symbols: contracts, full: false, lastTime: 900 });

        socket.handlers.close();
        // The restore has 500 ms left to run when the review is asked for, which
        // is long enough for the fan-out to be queued and not yet read.
        await vi.advanceTimersByTimeAsync(4_500);
        const review = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                action: 'account.history',
                clientOrderId: 'history-behind-the-stream',
                symbol: 'ETHUSDT',
            }),
        });
        await vi.advanceTimersByTimeAsync(500);
        await vi.advanceTimersByTimeAsync(60_000);
        await review;

        const key = admitted.indexOf('listen-key');
        expect(key).toBeGreaterThanOrEqual(0);
        // What the queue still owed the review when the key went out. Admitted
        // in arrival order the key is last and this is zero: the stream stays
        // shut for the whole fan-out rather than for the backoff the desk
        // intends.
        expect(admitted.length - key - 1).toBeGreaterThanOrEqual(10);
        // And the review is not starved for it — every contract still read.
        expect(admitted.filter(entry => entry.startsWith('orders:'))).toHaveLength(11);
        // These are legacy, cursor-only callers. Their eleven forward reads are
        // followed by the ten contracts still in flight when reconnect changed
        // the authenticated stream proof; those need an explicit post-gap read.
        expect(admitted.filter(entry => entry.startsWith('trades:'))).toHaveLength(21);
    });

    it('keeps identical-timestamp income rows across a page boundary', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const recentEnd = Date.now();
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockImplementation(({
            endTime, page,
        }) => {
            if (endTime !== recentEnd) {
                return Promise.resolve({ symbols: [], full: false, lastTime: null });
            }
            return Promise.resolve(page === 1
                ? { symbols: ['SAMEAUSDT'], full: true, lastTime: 900 }
                : { symbols: ['SAMEBUSDT'], full: false, lastTime: 900 });
        });

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-same-time-page',
            symbol: 'ETHUSDT',
        });

        const recentCalls = moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls
            .map(([request]) => request)
            .filter(request => request.endTime === recentEnd);
        expect(recentCalls.map(request => request.page)).toEqual([1, 2]);
        expect(new Set(recentCalls.map(request => request.startTime)).size).toBe(1);
        const [history] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_history);
        expect(history.futures_history.symbols).toEqual(expect.arrayContaining([
            'SAMEAUSDT', 'SAMEBUSDT',
        ]));
        expect(history.futures_history.discoveryComplete).toBe(true);
    });

    // Measured 2026-08-23: four pages of per-fill REALIZED_PNL reached about two
    // days of the operator's week. The six contracts traded early in the week
    // never entered any read, and the review self-sustained at the contracts it
    // already knew. A Full read is the one place discovery claims the week, so
    // it is the one place the older half is allowed the pages the week costs —
    // and the fan-out cap must not then drop the contracts that walk just found.
    it('walks the older income half deep on a Full read and keeps the early-week contract', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const DAY_MS = 24 * 60 * 60 * 1000;
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockImplementation(({
            startTime, endTime, page,
        }) => {
            if (endTime - startTime < 2 * DAY_MS) {
                // The recent (last-day) half: one short page.
                return Promise.resolve({ symbols: ['RECENTUSDT'], full: false, lastTime: 900 });
            }
            // The older six days: eleven full pages that only restate contracts
            // already known, before the early-week contract surfaces on the
            // twelfth — the shape of a week of per-fill realized-PnL rows.
            return Promise.resolve(page < 12
                ? { symbols: ['RECENTUSDT'], full: true, lastTime: 900 }
                : { symbols: ['EARLYUSDT'], full: false, lastTime: 900 });
        });

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-shallow-walk',
            symbol: 'ETHUSDT',
            views: ['trades'],
        });
        const ordinary = futuresHistoryAnswers().at(-1);
        // The bounded ordinary walk stops at its four pages and says so.
        expect(ordinary.symbols).not.toContain('EARLYUSDT');
        expect(ordinary.discoveryComplete).toBe(false);

        // A new budget minute: the deep walk is an explicit press, not a bonus
        // spent from the same minute the shallow read already used.
        await vi.advanceTimersByTimeAsync(60_000);
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-deep-walk',
            symbol: 'ETHUSDT',
            full: true,
            views: ['trades'],
        });
        const deep = futuresHistoryAnswers().at(-1);
        expect(deep.symbols).toContain('EARLYUSDT');
        expect(deep.discoveryComplete).toBe(true);
    });

    // Walking income is the most expensive thing a review does — up to eight
    // pages at weight 30, against an 800-weight minute — and it answers a
    // question that only moves when a trade is made somewhere other than this
    // desk. Trades made here seed the fan-out directly.
    it('holds the contracts a walk found instead of walking on every refresh', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.getTradedSymbolPage
            .mockResolvedValue({ symbols: ['B1USDT'], full: false, lastTime: 900 });

        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-hold-1', symbol: 'ETHUSDT',
        });
        const afterFirst = moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls.length;
        expect(afterFirst).toBeGreaterThan(0);

        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-hold-2', symbol: 'ETHUSDT',
        });
        expect(moduleMocks.futuresAdapter.getTradedSymbolPage)
            .toHaveBeenCalledTimes(afterFirst);
        // Held, not dropped: the second review covers the same contracts.
        const reviews = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_history);
        expect(reviews.at(-1).futures_history.symbols).toEqual(['ETHUSDT', 'B1USDT']);

        // Past the hold, a trade made in Binance's own app is looked for again.
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-hold-3', symbol: 'ETHUSDT',
        });
        expect(moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls.length)
            .toBeGreaterThan(afterFirst);
    });

    it('reads a stream-dirty cursor gap, skips an idle contract, and reuses persisted discovery', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const stream = await openFuturesHistoryStream();
        const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
        const coverage = futuresHistoryCoverage(symbols);

        // The first read establishes stream proofs. Its fresh store coverage is
        // also the discovery answer, so income is not touched after a restart.
        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-gap-1', symbol: symbols[0], coverage,
        });
        expect(moduleMocks.futuresAdapter.getTradedSymbolPage).not.toHaveBeenCalled();

        moduleMocks.futuresAdapter.getOrderHistory.mockReset();
        moduleMocks.futuresAdapter.getOrderHistory.mockImplementation(({ symbol, fromOrderId }) => {
            if (symbol === 'BTCUSDT' && fromOrderId === '100') {
                return Promise.resolve(Array.from({ length: 100 }, (_, index) => ({
                    symbol,
                    orderId: String(100 + index),
                    status: 'FILLED',
                    // IDs, not a millisecond timestamp, decide which bounded
                    // rows are newest when a burst shares one exchange time.
                    time: 1,
                })));
            }
            if (symbol === 'BTCUSDT' && fromOrderId === '199') {
                return Promise.resolve([
                    { symbol, orderId: '199', status: 'FILLED', time: 1 },
                    { symbol, orderId: '200', status: 'FILLED', time: 1 },
                ]);
            }
            return Promise.resolve([{
                symbol,
                orderId: String(Number(fromOrderId) + 1),
                status: 'FILLED',
                time: 1,
            }]);
        });
        moduleMocks.futuresAdapter.getTradeHistory.mockReset();
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ symbol, fromTradeId }) => (
            Promise.resolve([futuresHistoryTrade({
                symbol,
                id: String(Number(fromTradeId) + 1),
                realizedPnl: '1',
                time: 1,
            })])
        ));

        sendExecutionFill(stream, 501, '0');
        await flushMicrotasks();
        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-gap-2', symbol: symbols[0], coverage,
        });

        const orderCalls = moduleMocks.futuresAdapter.getOrderHistory.mock.calls
            .map(([request]) => request);
        expect(orderCalls.filter(({ symbol }) => symbol === 'BTCUSDT')
            .map(({ fromOrderId }) => fromOrderId)).toEqual(['100', '199']);
        expect(new Set(orderCalls.map(({ symbol }) => symbol)).has('ETHUSDT')).toBe(true);
        expect(new Set(orderCalls.map(({ symbol }) => symbol)).has('SOLUSDT')).toBe(false);
        const answer = futuresHistoryAnswers().at(-1);
        expect(answer.readFrom).toMatchObject({
            BTCUSDT: { orderCursor: '100', tradeCursor: '200' },
            ETHUSDT: { orderCursor: '101', tradeCursor: '201' },
        });
        const btcOrders = answer.orders.filter(({ symbol }) => symbol === 'BTCUSDT');
        expect(btcOrders).toHaveLength(101);
        expect(new Set(btcOrders.map(({ orderId }) => orderId)).size).toBe(101);
        // The endpoint repeats the held cursor inclusively. Keeping it here is
        // safe because the renderer merges by identity, and avoids silently
        // trimming a bounded multi-page gap before that merge.
        expect(btcOrders.map(({ orderId }) => orderId)).toContain('100');
    });

    it('keeps a frozen trade proof through zero-fill lifecycle reports and dirties it for a fill', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const stream = await openFuturesHistoryStream();
        const coverage = futuresHistoryCoverage(['BTCUSDT']);
        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([]);

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-lifecycle-proof',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage,
            views: ['trades'],
        });
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledOnce();
        moduleMocks.futuresAdapter.getTradeHistory.mockClear();

        for (const [index, status] of ['NEW', 'CANCELED', 'EXPIRED'].entries()) {
            stream.handlers.message(JSON.stringify({
                e: 'ORDER_TRADE_UPDATE',
                E: Date.now() + index,
                o: {
                    s: 'BTCUSDT', i: 600 + index, X: status, x: status,
                    S: 'BUY', o: 'LIMIT', p: '1', q: '1',
                    z: '0', l: '0', T: Date.now() + index,
                },
            }));
        }
        await flushMicrotasks();
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-lifecycle-proof-held',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage,
            views: ['trades'],
        });
        expect(moduleMocks.futuresAdapter.getTradeHistory).not.toHaveBeenCalled();

        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([futuresHistoryTrade({
            id: '10677',
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'BOTH',
            price: '100',
            quantity: '1',
            realizedPnl: '0',
            commission: '0',
            commissionAsset: 'USDT',
            marginAsset: 'USDT',
            time: Date.now(),
        })]);
        sendExecutionFill(stream, 677, '0');
        await flushMicrotasks();
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-lifecycle-fill-dirty',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage,
            views: ['trades'],
        });
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledOnce();
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0])
            .toMatchObject({ symbol: 'BTCUSDT', fromTradeId: '200' });
    });

    it('bounds a multi-page order gap to its earliest contiguous chunk and resumes after it', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await openFuturesHistoryStream();
        const symbol = 'BTCUSDT';
        const coverage = {
            [symbol]: {
                readAt: Date.now(),
                orderCursor: '100',
                tradeCursor: '200',
            },
        };

        moduleMocks.futuresAdapter.getOrderHistory.mockImplementation(({ fromOrderId }) => {
            const first = Number(fromOrderId);
            return Promise.resolve(Array.from({ length: 100 }, (_, index) => ({
                symbol,
                orderId: String(first + index),
                status: 'FILLED',
                time: 1,
            })));
        });
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-bounded-gap-1',
            symbol,
            coverage,
            views: ['orders'],
        });

        expect(moduleMocks.futuresAdapter.getOrderHistory.mock.calls
            .map(([request]) => request.fromOrderId)).toEqual(['100', '199', '298']);
        const bounded = futuresHistoryAnswers().at(-1);
        const identities = bounded.orders.map(order => order.orderId);
        expect(identities).toHaveLength(200);
        expect(identities[0]).toBe('100');
        expect(identities.at(-1)).toBe('299');
        expect(identities).not.toContain('300');
        expect(identities).not.toContain('397');

        // The renderer can advance only through the contiguous chunk it was
        // actually given. Its next coverage cursor therefore resumes at 299,
        // rather than skipping the withheld 300..397 tail.
        moduleMocks.futuresAdapter.getOrderHistory.mockClear();
        moduleMocks.futuresAdapter.getOrderHistory.mockResolvedValue([
            { symbol, orderId: '299', status: 'FILLED', time: 1 },
            { symbol, orderId: '300', status: 'FILLED', time: 1 },
        ]);
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-bounded-gap-2',
            symbol,
            coverage: {
                [symbol]: { ...coverage[symbol], orderCursor: '299' },
            },
            views: ['orders'],
        });

        expect(moduleMocks.futuresAdapter.getOrderHistory).toHaveBeenCalledTimes(1);
        expect(moduleMocks.futuresAdapter.getOrderHistory).toHaveBeenCalledWith({
            symbol,
            fromOrderId: '299',
        });
        expect(futuresHistoryAnswers().at(-1).orders.map(order => order.orderId))
            .toEqual(['299', '300']);
    });

    it('does not let one renderer proof skip another renderer older cursor', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await openFuturesHistoryStream();
        const symbols = ['BTCUSDT', 'ETHUSDT'];
        const currentCoverage = futuresHistoryCoverage(symbols);
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-proof-cursor-1',
            symbol: symbols[0],
            coverage: currentCoverage,
        });
        // Spend the first rotation slot on BTC so the next stable slot is ETH.
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-proof-cursor-2',
            symbol: symbols[0],
            coverage: currentCoverage,
        });
        moduleMocks.futuresAdapter.getOrderHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        const olderCoverage = {
            ...currentCoverage,
            BTCUSDT: { ...currentCoverage.BTCUSDT, orderCursor: '99' },
        };

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-proof-cursor-3',
            symbol: symbols[0],
            coverage: olderCoverage,
        });

        expect(new Set(moduleMocks.futuresAdapter.getOrderHistory.mock.calls
            .map(([{ symbol }]) => symbol))).toEqual(new Set(symbols));
        expect(moduleMocks.futuresAdapter.getOrderHistory.mock.calls
            .find(([{ symbol }]) => symbol === 'BTCUSDT')[0])
            .toMatchObject({ fromOrderId: '99' });
    });

    it('keeps an in-flight history session owned by its renderer when another activates', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await openFuturesHistoryStream();
        const firstCoverage = futuresHistoryCoverage(['BTCUSDT']);
        let resolveFirstTradeRead;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ symbol }) => (
            symbol === 'BTCUSDT'
                ? new Promise((resolve) => { resolveFirstTradeRead = resolve; })
                : Promise.resolve([])
        ));

        const firstRead = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-renderer-session-a',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: firstCoverage,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(resolveFirstTradeRead).toBeTypeOf('function');

        const secondHandlers = {};
        const secondRenderer = {
            connected: true,
            remoteAddress: '127.0.0.1',
            sendUTF: vi.fn(),
            drop: vi.fn(),
            on: vi.fn((event, handler) => { secondHandlers[event] = handler; }),
        };
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => secondRenderer),
        });
        await secondHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'activate_market',
                marketMode: 'futures-live',
            }),
        });
        secondRenderer.sendUTF.mockClear();
        const secondRead = secondHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.history',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'history-renderer-session-b',
                symbol: 'ETHUSDT',
                basisOnly: true,
                coverage: futuresHistoryCoverage(['ETHUSDT']),
                views: ['trades'],
            }),
        });

        resolveFirstTradeRead([futuresHistoryTrade({
            id: '201',
            symbol: 'BTCUSDT',
            realizedPnl: '1',
            commission: '0',
            commissionAsset: 'USDT',
            marginAsset: 'USDT',
            time: Date.now(),
        })]);
        await vi.advanceTimersByTimeAsync(5_000);
        await Promise.all([firstRead, secondRead]);

        const firstAnswers = futuresHistoryAnswers();
        const secondAnswers = secondRenderer.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_history)
            .map(payload => payload.futures_history);
        expect(firstAnswers.some(answer => answer.symbol === 'BTCUSDT')).toBe(true);
        expect(secondAnswers.some(answer => answer.symbol === 'ETHUSDT')).toBe(true);
        expect(firstAnswers.some(answer => answer.symbol === 'ETHUSDT')).toBe(false);
        expect(secondAnswers.some(answer => answer.symbol === 'BTCUSDT')).toBe(false);

        secondRenderer.connected = false;
        await secondHandlers.close?.();
    });

    it('keeps the later shared discovery when two renderer answers cross', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;

        const secondHandlers = {};
        const secondRenderer = {
            connected: true,
            remoteAddress: '127.0.0.1',
            sendUTF: vi.fn(),
            drop: vi.fn(),
            on: vi.fn((event, handler) => { secondHandlers[event] = handler; }),
        };
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => secondRenderer),
        });
        await secondHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({ action: 'activate_market', marketMode: 'futures-live' }),
        });
        secondRenderer.sendUTF.mockClear();

        const discoveryResolvers = [];
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockImplementation(() => (
            new Promise((resolve) => { discoveryResolvers.push(resolve); })
        ));
        moduleMocks.futuresAdapter.getOrderHistory.mockResolvedValue([]);
        const historyCommand = (clientOrderId, symbol) => ({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.history',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId,
                symbol,
                views: ['orders'],
            }),
        });
        // Fifteen discovered contracts plus the selected seed fill the sixteen-
        // contract fan-out, so no older income page runs behind either answer.
        const olderSymbols = Array.from({ length: 15 }, (_, index) => (
            `OLD${String(index + 1).padStart(2, '0')}USDT`
        ));
        const newerSymbols = Array.from({ length: 15 }, (_, index) => (
            `NEW${String(index + 1).padStart(2, '0')}USDT`
        ));

        const olderRead = moduleMocks.rendererHandlers.message(
            historyCommand('history-crossed-discovery-old', 'AUSDT'),
        );
        for (let step = 0; step < 10 && discoveryResolvers.length < 1; step += 1) {
            await vi.advanceTimersByTimeAsync(FUTURES_REST_ADMISSION_SPACING_MS);
        }
        expect(discoveryResolvers).toHaveLength(1);
        const newerRead = secondHandlers.message(
            historyCommand('history-crossed-discovery-new', 'BUSDT'),
        );
        for (let step = 0; step < 10 && discoveryResolvers.length < 2; step += 1) {
            await vi.advanceTimersByTimeAsync(FUTURES_REST_ADMISSION_SPACING_MS);
        }
        expect(discoveryResolvers).toHaveLength(2);

        // The later-issued renderer finishes and commits first. Fifteen
        // discovered contracts plus its selected seed fill the fan-out, so no
        // older income page obscures which request owns each deferred answer.
        discoveryResolvers[1]({ symbols: newerSymbols, full: false, lastTime: 2_000 });
        await vi.advanceTimersByTimeAsync(10_000);
        await newerRead;
        discoveryResolvers[0]({ symbols: olderSymbols, full: false, lastTime: 1_000 });
        await vi.advanceTimersByTimeAsync(10_000);
        await olderRead;

        const firstRendererAnswer = futuresHistoryAnswers().find(answer => (
            answer.symbol === 'AUSDT'
        ));
        const secondRendererAnswer = secondRenderer.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .find(payload => payload.futures_history?.symbol === 'BUSDT')
            ?.futures_history;
        expect(firstRendererAnswer?.symbols).toEqual(['AUSDT', ...olderSymbols]);
        expect(secondRendererAnswer?.symbols).toEqual(['BUSDT', ...newerSymbols]);

        moduleMocks.futuresAdapter.getTradedSymbolPage.mockClear();
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-crossed-discovery-probe',
            symbol: 'PROBEUSDT',
            views: ['orders'],
        });
        expect(moduleMocks.futuresAdapter.getTradedSymbolPage).not.toHaveBeenCalled();
        expect(futuresHistoryAnswers().at(-1).symbols).toEqual([
            'PROBEUSDT', ...newerSymbols,
        ]);

        secondRenderer.connected = false;
        await secondHandlers.close?.();
    });

    it('invalidates every history proof when the authenticated stream disconnects', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const stream = await openFuturesHistoryStream();
        const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
        const coverage = futuresHistoryCoverage(symbols);
        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-reconnect-1', symbol: symbols[0], coverage,
        });
        moduleMocks.futuresAdapter.getOrderHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockClear();

        stream.handlers.close();
        await flushMicrotasks();
        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-reconnect-2', symbol: symbols[0], coverage,
        });

        expect(new Set(moduleMocks.futuresAdapter.getOrderHistory.mock.calls
            .map(([{ symbol }]) => symbol))).toEqual(new Set(symbols));
        expect(new Set(moduleMocks.futuresAdapter.getTradeHistory.mock.calls
            .map(([{ symbol }]) => symbol))).toEqual(new Set(symbols));
    });

    it('announces every authenticated stream reopen as a renderer reconcile generation', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        moduleMocks.rendererConnection.sendUTF.mockClear();
        const firstStream = await openFuturesHistoryStream();
        const reconciles = () => moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.type === 'futures_history_reconcile');
        expect(reconciles()).toEqual([
            expect.objectContaining({
                version: 1,
                generation: 1,
                accountFingerprint: ACCOUNT_FINGERPRINT,
            }),
        ]);

        moduleMocks.rendererConnection.sendUTF.mockClear();
        firstStream.handlers.close();
        await vi.advanceTimersByTimeAsync(6_000);
        await flushMicrotasks();
        const secondStream = moduleMocks.futuresUserDataSockets.at(-1);
        expect(secondStream).not.toBe(firstStream);
        secondStream.handlers.open();
        await flushMicrotasks();

        expect(reconciles()).toEqual([
            expect.objectContaining({
                version: 1,
                generation: 2,
                accountFingerprint: ACCOUNT_FINGERPRINT,
            }),
        ]);
    });

    it('drops held history discovery when the last renderer disconnects', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await openFuturesHistoryStream();
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockResolvedValue({
            symbols: ['OLDUSDT'], full: false, lastTime: 900,
        });
        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-renderer-1', symbol: 'BTCUSDT',
        });
        expect(moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls.length)
            .toBeGreaterThan(0);

        moduleMocks.rendererConnection.close();
        await flushMicrotasks();
        moduleMocks.rendererConnection.connected = true;
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockClear();
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockResolvedValue({
            symbols: ['NEWUSDT'], full: false, lastTime: 1_000,
        });

        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-renderer-2', symbol: 'BTCUSDT',
        });

        expect(moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls.length)
            .toBeGreaterThan(0);
        expect(futuresHistoryAnswers().at(-1).symbols).toContain('NEWUSDT');
        expect(futuresHistoryAnswers().at(-1).symbols).not.toContain('OLDUSDT');
    });

    it('cannot restore discovery from an income read that outlives the last renderer', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        let answerDetachedDiscovery;
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockReturnValueOnce(new Promise((resolve) => {
            answerDetachedDiscovery = resolve;
        }));
        const detachedRead = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.history',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'history-detached-1',
                symbol: 'BTCUSDT',
            }),
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(answerDetachedDiscovery).toEqual(expect.any(Function));

        moduleMocks.rendererConnection.close();
        answerDetachedDiscovery({ symbols: ['OLDUSDT'], full: false, lastTime: 900 });
        await vi.advanceTimersByTimeAsync(5_000);
        await detachedRead;
        expect(futuresHistoryAnswers()).toEqual([]);

        moduleMocks.rendererConnection.connected = true;
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockClear();
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockResolvedValue({
            symbols: ['NEWUSDT'], full: false, lastTime: 1_000,
        });

        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-detached-2', symbol: 'BTCUSDT',
        });

        expect(moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls.length)
            .toBeGreaterThan(0);
        expect(futuresHistoryAnswers().at(-1).symbols).toContain('NEWUSDT');
        expect(futuresHistoryAnswers().at(-1).symbols).not.toContain('OLDUSDT');
    });

    it('drops a history read and its discovery when market deactivation overtakes it', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        let answerOldDiscovery;
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockReturnValueOnce(new Promise((resolve) => {
            answerOldDiscovery = resolve;
        }));
        const obsoleteRead = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.history',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'history-obsolete-1',
                symbol: 'BTCUSDT',
            }),
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(answerOldDiscovery).toEqual(expect.any(Function));

        await activateMarket('spot');
        await activateMarket('futures-live');
        answerOldDiscovery({ symbols: ['OLDUSDT'], full: true, lastTime: 900 });
        await vi.advanceTimersByTimeAsync(5_000);
        await obsoleteRead;

        expect(futuresHistoryAnswers()).toEqual([]);
        expect(moduleMocks.futuresAdapter.getTradedSymbolPage).toHaveBeenCalledOnce();
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockReset();
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockResolvedValue({
            symbols: ['NEWUSDT'], full: false, lastTime: 1_000,
        });

        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-obsolete-2', symbol: 'BTCUSDT',
        });

        expect(moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls.length)
            .toBeGreaterThan(0);
        expect(futuresHistoryAnswers().at(-1).symbols).toContain('NEWUSDT');
        expect(futuresHistoryAnswers().at(-1).symbols).not.toContain('OLDUSDT');
    });

    it('keeps coverage learned after discovery cached in the reconnect fan-out', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const stream = await openFuturesHistoryStream();
        const initialCoverage = futuresHistoryCoverage(['BTCUSDT']);
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, endTime,
        }) => Promise.resolve([futuresHistoryTrade({
            id: '10601',
            symbol,
            side: 'BUY',
            positionSide: 'BOTH',
            price: '1',
            quantity: '1',
            realizedPnl: '0',
            commission: '0',
            commissionAsset: 'USDT',
            marginAsset: 'USDT',
            time: Number.isSafeInteger(endTime) ? endTime : Date.now(),
        })]));
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-late-coverage-1',
            symbol: 'BTCUSDT',
            coverage: initialCoverage,
        });

        // This contract did not exist when the ten-minute in-memory discovery
        // answer above was built. An actual fill names it and the resulting read
        // is what lets the renderer add it to persisted coverage; a zero-fill
        // order lifecycle event intentionally does not dirty trade history.
        stream.handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: Date.now(),
            o: {
                s: 'LATEUSDT', i: 601, X: 'FILLED', x: 'TRADE', S: 'BUY', o: 'LIMIT',
                p: '1', q: '1', z: '1', l: '1', t: 10_601, rp: '0', T: Date.now(),
            },
        }));
        await flushMicrotasks();
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-late-coverage-2',
            symbol: 'BTCUSDT',
            coverage: initialCoverage,
        });
        expect(futuresHistoryAnswers().at(-1).symbols).toContain('LATEUSDT');

        const expandedCoverage = {
            ...initialCoverage,
            LATEUSDT: {
                readAt: Date.now(),
                orderCursor: '601',
                tradeCursor: null,
            },
        };
        moduleMocks.futuresAdapter.getOrderHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([]);
        stream.handlers.close();
        await flushMicrotasks();
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-late-coverage-3',
            symbol: 'BTCUSDT',
            coverage: expandedCoverage,
        });

        expect(new Set(moduleMocks.futuresAdapter.getOrderHistory.mock.calls
            .map(([{ symbol }]) => symbol))).toEqual(new Set(['BTCUSDT', 'LATEUSDT']));
    });

    it('rotates one idle contract per refresh and proves all twelve within twelve refreshes', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await openFuturesHistoryStream();
        const symbols = Array.from({ length: 12 }, (_, index) => (
            `R${String(index + 1).padStart(2, '0')}USDT`
        ));
        const coverage = futuresHistoryCoverage(symbols);
        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-rotate-proof', symbol: symbols[0], coverage,
        });
        moduleMocks.futuresAdapter.getOrderHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        const answersBefore = futuresHistoryAnswers().length;

        for (let index = 0; index < symbols.length; index += 1) {
            await runFuturesCommand({
                action: 'account.history',
                clientOrderId: `history-rotate-${index}`,
                symbol: symbols[0],
                coverage,
            });
        }

        const rotated = moduleMocks.futuresAdapter.getOrderHistory.mock.calls
            .map(([{ symbol }]) => symbol);
        expect(rotated).toHaveLength(12);
        expect(new Set(rotated)).toEqual(new Set(symbols));
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(12);
        expect(futuresHistoryAnswers().slice(answersBefore)
            .every(answer => answer.symbols.length === 1)).toBe(true);
    });

    it('bypasses persisted and in-memory discovery for an explicit full-window read', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await openFuturesHistoryStream();
        const coverage = futuresHistoryCoverage(['BTCUSDT', 'ETHUSDT']);
        await runFuturesCommand({
            action: 'account.history', clientOrderId: 'history-full-cache', symbol: 'BTCUSDT', coverage,
        });
        expect(moduleMocks.futuresAdapter.getTradedSymbolPage).not.toHaveBeenCalled();
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockReset();
        moduleMocks.futuresAdapter.getTradedSymbolPage
            .mockResolvedValueOnce({ symbols: ['SOLUSDT'], full: false, lastTime: 900 })
            .mockResolvedValueOnce({ symbols: ['ETHUSDT'], full: false, lastTime: 100 });
        moduleMocks.futuresAdapter.getOrderHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([]);

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-full-read',
            symbol: 'BTCUSDT',
            coverage,
            full: true,
        });

        expect(moduleMocks.futuresAdapter.getTradedSymbolPage).toHaveBeenCalledTimes(2);
        expect(moduleMocks.futuresAdapter.getOrderHistory.mock.calls
            .map(([request]) => request)).toEqual([
            { symbol: 'BTCUSDT' },
            { symbol: 'SOLUSDT' },
            { symbol: 'ETHUSDT' },
        ]);
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls
            .every(([request]) => !Object.hasOwn(request, 'fromTradeId'))).toBe(true);
        const answer = futuresHistoryAnswers().at(-1);
        expect(answer).toMatchObject({ full: true, symbols: ['BTCUSDT', 'SOLUSDT', 'ETHUSDT'] });
        expect(Object.values(answer.readFrom)).toEqual([
            { orderCursor: null, tradeCursor: null },
            { orderCursor: null, tradeCursor: null },
            { orderCursor: null, tradeCursor: null },
        ]);
    });

    it('keeps a dense Full reacquisition additive until one complete replacement lands', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        let request = 0;
        const fullRequests = new Set([1, 2, 3, 6]);
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, startTime, endTime,
        }) => {
            request += 1;
            const size = fullRequests.has(request) ? 1_000 : request <= 8 ? 1 : 0;
            return Promise.resolve(Array.from({ length: size }, (_, index) => ({
                id: `${request}${String(index).padStart(4, '0')}`,
                orderId: `${request}${String(index).padStart(4, '0')}`,
                symbol,
                side: 'BUY',
                positionSide: 'BOTH',
                price: '1',
                quantity: '1',
                realizedPnl: '0',
                commission: '0',
                commissionAsset: 'USDT',
                marginAsset: 'USDT',
                time: Math.min(endTime, startTime + index),
            })));
        });

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-full-dense',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });

        const partial = futuresHistoryAnswers().at(-1);
        expect(partial.merge.BTCUSDT.trades).toBe(true);
        expect(partial.tradeCoverage.BTCUSDT).toMatchObject({
            complete: false,
            pageLimited: true,
            continuityComplete: true,
        });
        const acquiredIds = partial.trades.map(trade => trade.id);
        expect(acquiredIds.length).toBeGreaterThan(0);

        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();

        const answers = futuresHistoryAnswers();
        const completed = answers.find(answer => (
            answer.readAt > partial.readAt && answer.merge.BTCUSDT?.trades === false
        ));
        expect(answers.length).toBeGreaterThanOrEqual(2);
        expect(completed).toBeDefined();
        expect(completed.readFrom.BTCUSDT.tradeCursor).toBeNull();
        expect(completed.tradeCoverage.BTCUSDT.complete).toBe(true);
        expect(completed.trades.map(trade => trade.id)).toEqual(
            expect.arrayContaining(acquiredIds),
        );
        // The successful post-gap is folded into the one atomic replacement;
        // the final frame must not leave the renderer in additive repair mode.
        expect(answers.at(-1).merge.BTCUSDT.trades).toBe(false);
    });

    it('stops older reacquisition at one exact reverse-flat suffix boundary', async () => {
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const stream = await openFuturesHistoryStream();
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions',
            loadPayload: vi.fn().mockResolvedValue({
                futures_positions: [{
                    symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '1',
                    entryPrice: '1', markPrice: '1', unrealizedPnl: '0',
                }],
            }),
        }]);
        await runFuturesCommand({
            action: 'account.refresh',
            clientOrderId: 'history-reverse-flat-position',
            symbol: 'BTCUSDT',
        });
        stream.handlers.ping();
        let request = 0;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, startTime, endTime,
        }) => {
            request += 1;
            if (request === 2) {
                return Promise.resolve([futuresHistoryTrade({
                    id: '9000001',
                    symbol,
                    side: 'BUY',
                    quantity: '1',
                    time: startTime,
                })]);
            }
            return Promise.resolve(Array.from({ length: 1_000 }, (_, index) => (
                futuresHistoryTrade({
                    id: String((request * 10_000) + index),
                    symbol,
                    side: 'BUY',
                    quantity: '1',
                    time: Math.min(endTime, startTime),
                })
            )));
        });

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-reverse-flat-stop',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });

        const answer = futuresHistoryAnswers().at(-1);
        const evidence = answer.tradeCoverage.BTCUSDT;
        expect(answer.merge.BTCUSDT.trades).toBe(false);
        expect(answer.trades).toHaveLength(1);
        expect(evidence).toMatchObject({
            version: 2,
            complete: false,
            pageLimited: true,
            retentionLimited: false,
            continuityComplete: true,
            flatBoundary: expect.any(Number),
        });
        expect(evidence.flatBoundary).toBe(evidence.coveredFrom);
        expect(evidence.flatBoundary).toBeGreaterThan(evidence.targetFrom);
        const callsAtBoundary = moduleMocks.futuresAdapter.getTradeHistory.mock.calls.length;

        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(
            callsAtBoundary,
        );
    });

    it('clears a candidate reverse-flat edge and resumes the frozen target after reconnect', async () => {
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const stream = await openFuturesHistoryStream();
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions',
            loadPayload: vi.fn().mockResolvedValue({
                futures_positions: [{
                    symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '1',
                    entryPrice: '1', markPrice: '1', unrealizedPnl: '0',
                }],
            }),
        }]);
        await runFuturesCommand({
            action: 'account.refresh',
            clientOrderId: 'history-reverse-flat-race-position',
            symbol: 'BTCUSDT',
        });
        stream.handlers.ping();
        let request = 0;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, startTime, endTime,
        }) => {
            request += 1;
            if (request === 2) {
                stream.handlers.close();
                return Promise.resolve([futuresHistoryTrade({
                    id: '9000002', symbol, side: 'BUY', quantity: '1', time: startTime,
                })]);
            }
            return Promise.resolve(Array.from({ length: 1_000 }, (_, index) => (
                futuresHistoryTrade({
                    id: String((request * 10_000) + index),
                    symbol,
                    side: 'BUY',
                    quantity: '1',
                    time: Math.min(endTime, startTime),
                })
            )));
        });

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-reverse-flat-race',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });

        const answer = futuresHistoryAnswers().at(-1);
        const frozenRequest = moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0];
        expect(answer.merge.BTCUSDT.trades).toBe(true);
        expect(answer.tradeCoverage.BTCUSDT).toMatchObject({
            complete: false,
            flatBoundary: false,
            retentionLimited: false,
            targetFrom: frozenRequest.startTime,
            targetTo: frozenRequest.endTime,
        });
    });

    it.each([
        {
            name: 'a changed terminal snapshot',
            trigger: (stream) => stream.handlers.message(JSON.stringify({
                e: 'ACCOUNT_UPDATE',
                E: 20_001,
                T: 20_001,
                a: {
                    m: 'ORDER',
                    B: [],
                    P: [{
                        s: 'BTCUSDT', pa: '2', ep: '1', up: '0',
                        mt: 'cross', iw: '0', ps: 'BOTH',
                    }],
                },
            })),
        },
        {
            name: 'a streamed fill',
            trigger: (stream) => stream.handlers.message(JSON.stringify({
                e: 'ORDER_TRADE_UPDATE',
                E: 20_002,
                o: {
                    s: 'BTCUSDT', i: 900_003, X: 'FILLED', x: 'TRADE',
                    S: 'BUY', o: 'LIMIT', p: '1', q: '1', z: '1', l: '1',
                    t: 9_000_003, rp: '0', n: '0', N: null,
                    T: 20_002, ps: 'BOTH', ma: 'USDT',
                },
            })),
        },
    ])('rejects a candidate reverse-flat edge raced by $name without moving its frozen target', async ({ trigger }) => {
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const stream = await openFuturesHistoryStream();
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions',
            loadPayload: vi.fn().mockResolvedValue({
                futures_positions: [{
                    symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '1',
                    entryPrice: '1', markPrice: '1', unrealizedPnl: '0',
                }],
            }),
        }]);
        await runFuturesCommand({
            action: 'account.refresh',
            clientOrderId: 'history-reverse-flat-terminal-race-position',
            symbol: 'BTCUSDT',
        });
        stream.handlers.ping();
        moduleMocks.rendererConnection.sendUTF.mockClear();

        let request = 0;
        let resolveCandidate;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, startTime, endTime, fromTradeId,
        }) => {
            if (fromTradeId !== undefined) return Promise.resolve([]);
            request += 1;
            if (request === 2) {
                return new Promise((resolve) => {
                    resolveCandidate = () => resolve([futuresHistoryTrade({
                        id: '9000003', symbol, side: 'BUY', quantity: '1', time: startTime,
                    })]);
                });
            }
            return Promise.resolve(Array.from({ length: 1_000 }, (_, index) => (
                futuresHistoryTrade({
                    id: String((request * 10_000) + index),
                    symbol,
                    side: 'BUY',
                    quantity: '1',
                    time: Math.min(endTime, startTime),
                })
            )));
        });

        const pending = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-reverse-flat-terminal-race',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        for (let step = 0; step < 20 && resolveCandidate === undefined; step += 1) {
            await vi.advanceTimersByTimeAsync(250);
        }
        expect(resolveCandidate).toBeTypeOf('function');
        const frozenRequest = moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0];

        trigger(stream);
        await flushMicrotasks();
        resolveCandidate();
        let settled = false;
        pending.finally(() => { settled = true; });
        for (let step = 0; step < 20 && !settled; step += 1) {
            await vi.advanceTimersByTimeAsync(250);
        }
        await pending;

        const answer = futuresHistoryAnswers().at(-1);
        expect(answer.merge.BTCUSDT.trades).toBe(true);
        expect(answer.tradeCoverage.BTCUSDT).toMatchObject({
            complete: false,
            flatBoundary: false,
            retentionLimited: false,
            targetFrom: frozenRequest.startTime,
            targetTo: frozenRequest.endTime,
        });
    });

    it.each(['activation change', 'renderer cancellation'])(
        'publishes no candidate reverse-flat edge after %s',
        async (race) => {
            moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
            setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
            moduleMocks.websocketServerHandlers.request({
                origin: 'http://localhost:5174',
                accept: vi.fn(() => moduleMocks.rendererConnection),
            });
            await activateMarket('futures-live');
            const stream = await openFuturesHistoryStream();
            moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
                type: 'positions', weight: 5, errorLabel: 'positions',
                loadPayload: vi.fn().mockResolvedValue({
                    futures_positions: [{
                        symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '1',
                        entryPrice: '1', markPrice: '1', unrealizedPnl: '0',
                    }],
                }),
            }]);
            await runFuturesCommand({
                action: 'account.refresh',
                clientOrderId: 'history-reverse-flat-cancel-position',
                symbol: 'BTCUSDT',
            });
            stream.handlers.ping();
            moduleMocks.rendererConnection.sendUTF.mockClear();

            let request = 0;
            let resolveCandidate;
            moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
                symbol, startTime, endTime,
            }) => {
                request += 1;
                if (request === 2) {
                    return new Promise((resolve) => {
                        resolveCandidate = () => resolve([futuresHistoryTrade({
                            id: '9000004', symbol, side: 'BUY', quantity: '1', time: startTime,
                        })]);
                    });
                }
                return Promise.resolve(Array.from({ length: 1_000 }, (_, index) => (
                    futuresHistoryTrade({
                        id: String((request * 10_000) + index),
                        symbol,
                        side: 'BUY',
                        quantity: '1',
                        time: Math.min(endTime, startTime),
                    })
                )));
            });

            const pending = startFuturesCommandWithoutAdvancing({
                action: 'account.history',
                clientOrderId: 'history-reverse-flat-cancel',
                symbol: 'BTCUSDT',
                basisOnly: true,
                coverage: {},
                full: true,
                views: ['trades'],
            });
            for (let step = 0; step < 20 && resolveCandidate === undefined; step += 1) {
                await vi.advanceTimersByTimeAsync(250);
            }
            expect(resolveCandidate).toBeTypeOf('function');

            if (race === 'activation change') {
                await moduleMocks.rendererHandlers.message({
                    type: 'utf8',
                    utf8Data: JSON.stringify({
                        action: 'activate_market',
                        marketMode: 'spot',
                    }),
                });
            } else {
                moduleMocks.rendererConnection.close();
            }
            resolveCandidate();
            let settled = false;
            pending.finally(() => { settled = true; });
            for (let step = 0; step < 20 && !settled; step += 1) {
                await vi.advanceTimersByTimeAsync(250);
            }
            await pending;

            expect(futuresHistoryAnswers()).toEqual([]);
            expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(2);
        },
    );

    it('retries a failed Full continuation without spending its progress budget', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        let request = 0;
        const denseTrade = {
            id: '9007199254740993',
            orderId: '9007199254740993',
            symbol: 'BTCUSDT',
            side: 'BUY',
            positionSide: 'BOTH',
            price: '1',
            quantity: '1',
            realizedPnl: '0',
            commission: '0',
            commissionAsset: 'USDT',
            marginAsset: 'USDT',
        };
        const densePageAt = endTime => Array.from({ length: 1_000 }, (_, index) => ({
            ...denseTrade,
            id: String((BigInt(endTime) * 1_000n) + BigInt(index)),
            time: endTime,
        }));
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, endTime,
        }) => {
            request += 1;
            if (request === 2) {
                return Promise.resolve([{
                    ...denseTrade, id: '7', symbol, time: endTime,
                }]);
            }
            return Promise.resolve(densePageAt(endTime));
        });

        const initial = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-full-continuation-retry',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        // Stop before the five-second continuation timer: runFuturesCommand
        // intentionally advances in five-second chunks and would let the
        // continuation race ahead of the test's replacement adapter.
        await vi.advanceTimersByTimeAsync(2_000);
        await initial;
        const partial = futuresHistoryAnswers().at(-1);
        expect(partial.tradeCoverage.BTCUSDT).toMatchObject({
            passes: 1,
            stalledPasses: 0,
            complete: false,
            retentionLimited: false,
        });
        let continuationCalls = 0;
        let transientAttempts = 0;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(() => {
            continuationCalls += 1;
            if (transientAttempts < 3) {
                transientAttempts += 1;
                return Promise.reject(Object.assign(new Error('transient gap'), {
                    code: 'ETIMEDOUT',
                }));
            }
            return Promise.resolve([]);
        });

        let completed;
        for (let step = 0; step < 6 && completed === undefined; step += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
            await flushMicrotasks();
            completed = futuresHistoryAnswers().find(answer => (
                answer.readAt > partial.readAt
                && answer.merge.BTCUSDT?.trades === false
            ));
        }

        // The shared limiter absorbs this transient burst inside the same
        // continuation. It must not spend a history failure/retry attempt or
        // publish a false error frame when its own retry ultimately succeeds.
        expect(futuresHistoryAnswers().some(answer => answer.error)).toBe(false);
        expect(transientAttempts).toBe(3);
        expect(continuationCalls).toBeGreaterThanOrEqual(5);
        expect(completed).toBeDefined();
        expect(completed.tradeCoverage.BTCUSDT).toMatchObject({
            passes: 2,
            stalledPasses: 0,
            complete: true,
            retentionLimited: false,
        });
    });

    it('bounds a failed cold trade-history reacquisition to three attempts', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        moduleMocks.futuresAdapter.getTradeHistory.mockRejectedValue(
            Object.assign(new Error('cold history unavailable'), {
                code: 'COLD_HISTORY_TERMINAL',
                status: 400,
            }),
        );
        const legacyCoverage = {
            BTCUSDT: {
                readAt: Date.now(),
                tradeReadAt: Date.now(),
                tradeCursor: '20',
            },
        };

        const initial = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-cold-reacquisition-bounded',
            symbol: 'BTCUSDT',
            basisOnly: true,
            // Cursor-only coverage is intentionally legacy: it must enter the
            // transactional migration path instead of paging forward from 20.
            coverage: legacyCoverage,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await initial;
        for (let step = 0; step < 8; step += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
            await flushMicrotasks();
        }

        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(3);
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls
            .every(([request]) => !Object.hasOwn(request, 'fromTradeId'))).toBe(true);
        expect(futuresHistoryAnswers().filter(answer => (
            answer.error?.binanceCode === 'COLD_HISTORY_TERMINAL'
        ))).toHaveLength(3);
        const exhaustedTargetTo = moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0]
            .endTime;
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(3);

        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([]);
        const explicitRetry = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-cold-reacquisition-fresh',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: legacyCoverage,
            full: true,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await explicitRetry;

        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledOnce();
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0]).toMatchObject({
            symbol: 'BTCUSDT',
            startTime: expect.any(Number),
            endTime: expect.any(Number),
        });
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0].endTime)
            .toBeGreaterThan(exhaustedTargetTo);
    });

    it('vouches a frozen Full cursor only after its post-gap succeeds', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        const stream = await openFuturesHistoryStream();
        let initialRead = true;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, endTime,
        }) => {
            if (!initialRead) return Promise.resolve([]);
            initialRead = false;
            // The fill lands after the Full proof was captured but before the
            // frozen REST answer returns, forcing an explicit forward gap.
            sendExecutionFill(stream, 77, '0');
            return Promise.resolve([{
                id: '10077',
                orderId: '10077',
                symbol,
                side: 'SELL',
                positionSide: 'BOTH',
                price: '1',
                quantity: '1',
                realizedPnl: '0',
                commission: '0',
                commissionAsset: 'USDT',
                marginAsset: 'USDT',
                time: endTime,
            }]);
        });

        const initial = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-full-post-gap-proof',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await initial;
        const frozen = futuresHistoryAnswers().at(-1);
        expect(frozen.merge.BTCUSDT.trades).toBe(true);
        expect(frozen.tradeCoverage.BTCUSDT).toMatchObject({
            complete: false,
            postGapPending: true,
        });

        const claimedCompleteCoverage = {
            BTCUSDT: {
                readAt: frozen.readAt,
                orderReadAt: null,
                tradeReadAt: frozen.readAt,
                orderCursor: null,
                tradeCursor: '10077',
                tradeCoverage: {
                    ...frozen.tradeCoverage.BTCUSDT,
                    complete: true,
                    postGapPending: false,
                },
            },
        };
        const callsBeforeProbe = moduleMocks.futuresAdapter.getTradeHistory.mock.calls.length;
        moduleMocks.futuresAdapter.getTradeHistory.mockRejectedValue(
            Object.assign(new Error('post-gap unavailable'), {
                code: 'POST_GAP_UNAVAILABLE',
                status: 400,
            }),
        );
        const probe = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-full-post-gap-unvouched',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: claimedCompleteCoverage,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await probe;
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls.length)
            .toBe(callsBeforeProbe + 1);
        expect(futuresHistoryAnswers().at(-1).error).toMatchObject({
            code: 'FUTURES_API_ERROR',
            binanceCode: 'POST_GAP_UNAVAILABLE',
        });

        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([]);
        let replacement;
        for (let step = 0; step < 4 && replacement === undefined; step += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
            await flushMicrotasks();
            replacement = futuresHistoryAnswers().find(answer => (
                answer.readAt > frozen.readAt
                && answer.merge.BTCUSDT?.trades === false
                && answer.tradeCoverage.BTCUSDT?.postGapPending === false
            ));
        }
        expect(replacement).toBeDefined();
        expect(replacement.tradeCoverage.BTCUSDT.complete).toBe(true);
        expect(replacement.trades.map(trade => trade.id)).toContain('10077');

        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        const vouched = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-full-post-gap-vouched',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {
                BTCUSDT: {
                    readAt: replacement.readAt,
                    orderReadAt: null,
                    tradeReadAt: replacement.readAt,
                    orderCursor: null,
                    tradeCursor: '10077',
                    tradeCoverage: replacement.tradeCoverage.BTCUSDT,
                },
            },
            views: ['trades'],
        });
        await vouched;
        expect(moduleMocks.futuresAdapter.getTradeHistory).not.toHaveBeenCalled();
    });

    it('does not replace frozen trades before REST reaches the fill identity seen on stream', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        const stream = await openFuturesHistoryStream();
        let initialRead = true;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, endTime,
        }) => {
            if (!initialRead) return Promise.resolve([]);
            initialRead = false;
            // Binance can deliver trade 10077 on the stream before /userTrades
            // indexes it. The frozen window currently reaches only 10070.
            sendExecutionFill(stream, 77, '0');
            return Promise.resolve([{
                id: '10070',
                orderId: '10070',
                symbol,
                side: 'SELL',
                positionSide: 'BOTH',
                price: '1',
                quantity: '1',
                realizedPnl: '0',
                commission: '0',
                commissionAsset: 'USDT',
                marginAsset: 'USDT',
                time: endTime,
            }]);
        });

        const initial = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-post-gap-stream-identity',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await initial;
        const frozen = futuresHistoryAnswers().at(-1);
        expect(frozen).toMatchObject({
            merge: { BTCUSDT: { trades: true } },
            tradeCoverage: {
                BTCUSDT: { complete: false, postGapPending: true },
            },
        });

        // A successful but not-yet-indexed gap answer is still additive and
        // incomplete. In particular, it cannot delete the streamed 10077 row.
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
        const beforeObservedFill = futuresHistoryAnswers().filter(answer => (
            answer.readAt > frozen.readAt
        ));
        expect(beforeObservedFill).toHaveLength(1);
        expect(beforeObservedFill[0]).toMatchObject({
            merge: { BTCUSDT: { trades: true } },
            tradeCoverage: {
                BTCUSDT: { complete: false, postGapPending: true },
            },
        });

        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([{
            id: '10077',
            orderId: '10077',
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'BOTH',
            price: '1',
            quantity: '1',
            realizedPnl: '0',
            commission: '0',
            commissionAsset: 'USDT',
            marginAsset: 'USDT',
            time: Date.now(),
        }]);
        let replacement;
        for (let step = 0; step < 4 && replacement === undefined; step += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
            await flushMicrotasks();
            replacement = futuresHistoryAnswers().find(answer => (
                answer.readAt > beforeObservedFill[0].readAt
                && answer.merge.BTCUSDT?.trades === false
            ));
        }

        expect(replacement).toBeDefined();
        expect(replacement.tradeCoverage.BTCUSDT).toMatchObject({
            complete: true,
            postGapPending: false,
        });
        expect(replacement.trades.map(trade => trade.id))
            .toEqual(expect.arrayContaining(['10070', '10077']));
    });

    it('stops retrying a failed frozen Full post-gap after three attempts', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        const stream = await openFuturesHistoryStream();
        let initialRead = true;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, endTime,
        }) => {
            if (initialRead) {
                initialRead = false;
                // A post-gap exists only when the stream topology/activity
                // actually changes while the frozen window is being read.
                sendExecutionFill(stream, 31, '0');
            }
            return Promise.resolve([{
                id: '10031',
                orderId: '10031',
                symbol,
                side: 'SELL',
                positionSide: 'BOTH',
                price: '1',
                quantity: '1',
                realizedPnl: '0',
                commission: '0',
                commissionAsset: 'USDT',
                marginAsset: 'USDT',
                time: endTime,
            }]);
        });

        const initial = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-full-post-gap-bounded',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await initial;
        expect(futuresHistoryAnswers().at(-1).tradeCoverage.BTCUSDT).toMatchObject({
            complete: false,
            postGapPending: true,
        });

        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockRejectedValue(
            Object.assign(new Error('terminal post-gap failure'), {
                code: 'POST_GAP_TERMINAL',
                status: 400,
            }),
        );
        for (let step = 0; step < 8; step += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
            await flushMicrotasks();
        }

        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(3);
        expect(futuresHistoryAnswers().filter(answer => (
            answer.error?.binanceCode === 'POST_GAP_TERMINAL'
        ))).toHaveLength(3);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(3);

        const exhaustedTargetTo = futuresHistoryAnswers()
            .find(answer => answer.tradeCoverage.BTCUSDT?.targetTo !== undefined)
            .tradeCoverage.BTCUSDT.targetTo;
        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([]);
        const explicitRetry = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-full-post-gap-fresh',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await explicitRetry;

        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledOnce();
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0]).toMatchObject({
            symbol: 'BTCUSDT',
            startTime: expect.any(Number),
            endTime: expect.any(Number),
        });
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0])
            .not.toHaveProperty('fromTradeId');
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0].endTime)
            .toBeGreaterThan(exhaustedTargetTo);
    });

    it('evicts a post-gap checkpoint when successful REST never reaches the stream fill', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        const stream = await openFuturesHistoryStream();
        let frozenRead = true;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ symbol, endTime }) => {
            if (!frozenRead) return Promise.resolve([]);
            frozenRead = false;
            sendExecutionFill(stream, 77, '0');
            return Promise.resolve([{
                id: '10070',
                orderId: '10070',
                symbol,
                side: 'SELL',
                positionSide: 'BOTH',
                price: '1',
                quantity: '1',
                realizedPnl: '0',
                commission: '0',
                commissionAsset: 'USDT',
                marginAsset: 'USDT',
                time: endTime,
            }]);
        });

        const initial = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-post-gap-success-terminal',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await initial;
        const frozen = futuresHistoryAnswers().at(-1);
        expect(frozen.tradeCoverage.BTCUSDT).toMatchObject({
            complete: false,
            postGapPending: true,
        });

        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        for (let step = 0; step < 8; step += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
            await flushMicrotasks();
        }
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(3);
        const terminal = futuresHistoryAnswers().find(answer => (
            answer.readAt > frozen.readAt
            && answer.tradeCoverage.BTCUSDT?.postGapPending === false
        ));
        expect(terminal).toBeDefined();
        expect(terminal.tradeCoverage.BTCUSDT.complete).toBe(false);
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(3);

        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([]);
        const explicitRetry = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-post-gap-success-fresh',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await explicitRetry;
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledOnce();
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0])
            .not.toHaveProperty('fromTradeId');
    });

    it('persists stalled Full evidence and stops at the cumulative request bound', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        const denseTrade = {
            id: '9007199254740993',
            orderId: '9007199254740993',
            symbol: 'BTCUSDT',
            side: 'BUY',
            positionSide: 'BOTH',
            price: '1',
            quantity: '1',
            realizedPnl: '0',
            commission: '0',
            commissionAsset: 'USDT',
            marginAsset: 'USDT',
        };
        const densePageAt = endTime => Array.from({ length: 1_000 }, (_, index) => ({
            ...denseTrade,
            id: String((BigInt(endTime) * 1_000n) + BigInt(index)),
            time: endTime,
        }));
        let request = 0;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, endTime,
        }) => {
            request += 1;
            return request === 2
                ? Promise.resolve([{
                    ...denseTrade, id: '41', symbol, time: endTime,
                }])
                : Promise.resolve(densePageAt(endTime));
        });

        const initial = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-full-stalled-cap',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await initial;
        const partial = futuresHistoryAnswers().at(-1);
        expect(partial.error).toBeNull();
        expect(partial.tradeCoverage.BTCUSDT).toMatchObject({
            passes: 1,
            stalledPasses: 0,
            retentionLimited: false,
            requests: 8,
        });

        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ endTime }) => (
            Promise.resolve(densePageAt(endTime))
        ));
        for (let step = 0; step < 8; step += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
            await flushMicrotasks();
        }
        const coverages = futuresHistoryAnswers()
            .map(answer => answer.tradeCoverage.BTCUSDT)
            .filter(Boolean);
        expect(coverages).toEqual(expect.arrayContaining([
            expect.objectContaining({
                passes: 2,
                stalledPasses: 1,
                complete: false,
                retentionLimited: true,
                requests: 16,
            }),
        ]));
        const callsAtCap = moduleMocks.futuresAdapter.getTradeHistory.mock.calls.length;
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(callsAtCap);
    });

    it('caps advancing Full acquisition at sixteen cumulative pages and starts fresh later', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.credentialFingerprint = ACCOUNT_FINGERPRINT;
        const denseTrade = {
            id: '9007199254740993',
            orderId: '9007199254740993',
            symbol: 'BTCUSDT',
            side: 'BUY',
            positionSide: 'BOTH',
            price: '1',
            quantity: '1',
            realizedPnl: '0',
            commission: '0',
            commissionAsset: 'USDT',
            marginAsset: 'USDT',
        };
        const densePageAt = endTime => Array.from({ length: 1_000 }, (_, index) => ({
            ...denseTrade,
            id: String((BigInt(endTime) * 1_000n) + BigInt(index)),
            time: endTime,
        }));
        let request = 0;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, endTime,
        }) => {
            request += 1;
            return request === 2
                ? Promise.resolve([{
                    ...denseTrade, id: '51', symbol, time: endTime,
                }])
                : Promise.resolve(densePageAt(endTime));
        });

        const initial = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-full-pass-cap',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await initial;
        const partial = futuresHistoryAnswers().at(-1).tradeCoverage.BTCUSDT;
        const frozenTargetTo = partial.targetTo;
        expect(partial).toMatchObject({
            passes: 1,
            stalledPasses: 0,
            complete: false,
            retentionLimited: false,
            requests: 8,
        });

        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        let olderCalls = 0;
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({
            symbol, startTime, endTime,
        }) => {
            if (startTime === frozenTargetTo && endTime === frozenTargetTo) {
                return Promise.resolve([{
                    ...denseTrade, id: '52', symbol, time: endTime,
                }]);
            }
            olderCalls += 1;
            return olderCalls === 2
                ? Promise.resolve([{
                    ...denseTrade, id: '53', symbol, time: endTime,
                }])
                : Promise.resolve(densePageAt(endTime));
        });
        const answersBefore = futuresHistoryAnswers().length;
        for (let step = 0;
            step < 20 && futuresHistoryAnswers().length === answersBefore;
            step += 1) {
            await vi.advanceTimersByTimeAsync(500);
            await flushMicrotasks();
        }

        expect(futuresHistoryAnswers()).toHaveLength(answersBefore + 1);
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(8);
        expect(futuresHistoryAnswers().at(-1).tradeCoverage.BTCUSDT).toMatchObject({
            passes: 2,
            stalledPasses: 0,
            complete: false,
            retentionLimited: true,
            requests: 16,
        });
        const callsAtCap = moduleMocks.futuresAdapter.getTradeHistory.mock.calls.length;
        await vi.advanceTimersByTimeAsync(30_000);
        await flushMicrotasks();
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledTimes(callsAtCap);

        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([]);
        const explicitRetry = startFuturesCommandWithoutAdvancing({
            action: 'account.history',
            clientOrderId: 'history-full-request-budget-fresh',
            symbol: 'BTCUSDT',
            basisOnly: true,
            coverage: {},
            full: true,
            views: ['trades'],
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await explicitRetry;
        expect(moduleMocks.futuresAdapter.getTradeHistory).toHaveBeenCalledOnce();
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls[0][0].endTime)
            .toBeGreaterThan(frozenTargetTo);
    });

    it('states the idle refresh weight as one sixtieth of the bounded full read', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await openFuturesHistoryStream();
        const symbols = ['W01USDT', ...Array.from({ length: 11 }, (_, index) => (
            `W${String(index + 2).padStart(2, '0')}USDT`
        ))];
        const coverage = futuresHistoryCoverage(symbols);
        moduleMocks.futuresAdapter.getOrderHistory.mockImplementation(({ symbol }) => (
            Promise.resolve([{
                symbol,
                orderId: coverage[symbol].orderCursor,
                status: 'FILLED',
                time: 1,
            }])
        ));
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ symbol, endTime }) => (
            Promise.resolve([futuresHistoryTrade({
                symbol,
                id: coverage[symbol].tradeCursor,
                realizedPnl: '0',
                time: Number.isSafeInteger(endTime) ? endTime - 1 : Date.now() - 1,
            })])
        ));
        let incomePage = 0;
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockImplementation(({ startTime }) => {
            const pageSymbols = symbols.slice(1 + (incomePage * 2), 1 + ((incomePage + 1) * 2));
            incomePage += 1;
            return Promise.resolve({ symbols: pageSymbols, full: true, lastTime: startTime + 1 });
        });

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-weight-full',
            symbol: symbols[0],
            coverage,
            full: true,
        });
        const fullIncomeReads = moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls.length;
        const fullEndpointReads = moduleMocks.futuresAdapter.getOrderHistory.mock.calls.length
            + moduleMocks.futuresAdapter.getTradeHistory.mock.calls.length;
        const fullWeight = (fullIncomeReads * 30) + (fullEndpointReads * 5);
        // 2026-08-23: a Full read's older income half deepened to twelve pages
        // so early-week contracts are discoverable again — the bounded ceiling
        // rose with it, and it stays under one 800-weight minute.
        expect({ fullIncomeReads, fullEndpointReads, fullWeight }).toEqual({
            fullIncomeReads: 16,
            fullEndpointReads: 24,
            fullWeight: 600,
        });

        moduleMocks.futuresAdapter.getTradedSymbolPage.mockClear();
        moduleMocks.futuresAdapter.getOrderHistory.mockClear();
        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-weight-idle',
            symbol: symbols[0],
            coverage,
        });
        const idleIncomeReads = moduleMocks.futuresAdapter.getTradedSymbolPage.mock.calls.length;
        const idleEndpointReads = moduleMocks.futuresAdapter.getOrderHistory.mock.calls.length
            + moduleMocks.futuresAdapter.getTradeHistory.mock.calls.length;
        const idleWeight = (idleIncomeReads * 30) + (idleEndpointReads * 5);
        expect({ idleIncomeReads, idleEndpointReads, idleWeight }).toEqual({
            idleIncomeReads: 0,
            idleEndpointReads: 2,
            idleWeight: 10,
        });
        expect(fullWeight / idleWeight).toBe(60);
    });

    // Every USDⓈ-M history endpoint is read per contract, and the panel shows one
    // view at a time. Reading both is a second fan-out — one request per contract,
    // 150ms apart — answering a view nobody has open.
    it('reads the endpoint the view that asked needs, and the other when it is opened', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await openFuturesHistoryStream();
        const symbols = ['V01USDT', 'V02USDT', 'V03USDT'];
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockResolvedValue({
            symbols: symbols.slice(1), full: false, lastTime: 5_000,
        });
        moduleMocks.futuresAdapter.getOrderHistory.mockImplementation(({ symbol }) => (
            Promise.resolve([{ symbol, orderId: 7, status: 'FILLED', time: 1 }])
        ));
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ symbol, endTime }) => (
            Promise.resolve([futuresHistoryTrade({
                symbol,
                id: '9',
                realizedPnl: '0',
                time: Number.isSafeInteger(endTime) ? endTime - 1 : Date.now() - 1,
            })])
        ));

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-view-trades',
            symbol: symbols[0],
            views: ['trades'],
        });
        expect(moduleMocks.futuresAdapter.getOrderHistory).not.toHaveBeenCalled();
        expect(moduleMocks.futuresAdapter.getTradeHistory.mock.calls
            .map(([request]) => request.symbol)).toEqual(symbols);
        const closed = futuresHistoryAnswers().at(-1);
        expect(closed.views).toEqual(['trades']);
        expect(closed.trades).toHaveLength(3);
        expect(closed.orders).toEqual([]);
        // Only the endpoint that was read states where it was read from, so the
        // renderer keeps the order rows it is holding rather than emptying them.
        expect(closed.readFrom[symbols[0]]).toEqual({ tradeCursor: null });

        // The other view, opened. The contracts are proved for their fills and
        // not for their order logs, so the order log of each is read once.
        const coverage = Object.fromEntries(symbols.map(symbol => [symbol, {
            readAt: Date.now(), orderCursor: null, tradeCursor: '9',
        }]));
        moduleMocks.futuresAdapter.getTradeHistory.mockClear();
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-view-orders',
            symbol: symbols[0],
            coverage,
            views: ['orders'],
        });
        expect(moduleMocks.futuresAdapter.getTradeHistory).not.toHaveBeenCalled();
        expect(moduleMocks.futuresAdapter.getOrderHistory.mock.calls
            .map(([request]) => request.symbol)).toEqual(symbols);
        expect(futuresHistoryAnswers().at(-1).views).toEqual(['orders']);

        // And opening it again reads nothing but the rotation's one contract:
        // this view is now proved for the same contracts the other one was.
        const proved = Object.fromEntries(symbols.map(symbol => [symbol, {
            readAt: Date.now(), orderCursor: '7', tradeCursor: '9',
        }]));
        moduleMocks.futuresAdapter.getOrderHistory.mockClear();
        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-view-orders-again',
            symbol: symbols[0],
            coverage: proved,
            views: ['orders'],
        });
        expect(moduleMocks.futuresAdapter.getOrderHistory).toHaveBeenCalledOnce();
    });

    // A review is twenty-six admissions of the futures queue, spaced 150ms apart,
    // and the operator does not stop trading for it. Measured against this tree
    // on 2026-08-16: with the fan-out running, the wallet read that a fill asks
    // for waited 3 150ms — the desk showing the account as it was before the
    // trade for that long, while the operator acted on it.
    it('reads what a fill moved without waiting out a review in flight', async () => {
        const admitted = [];
        const loadFor = (type, key, value) => vi.fn(async () => {
            admitted.push({ label: `read:${type}`, at: Date.now() });
            return { [key]: value };
        });
        const loads = {
            balances: loadFor('balances', 'futures_balances', {
                USDT: { available: '100', total: '100' },
            }),
            positions: loadFor('positions', 'futures_positions', []),
            regularOrders: loadFor('regularOrders', 'futures_regular_orders', []),
            algoOrders: loadFor('algoOrders', 'futures_algo_orders', []),
        };
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue(
            ['balances', 'positions', 'regularOrders', 'algoOrders'].map(type => ({
                type, weight: 5, errorLabel: type, loadPayload: loads[type],
            })),
        );
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const socket = await openFuturesHistoryStream();

        const traded = Array.from({ length: 11 }, (_, index) => (
            `C${String(index + 1).padStart(2, '0')}USDT`
        ));
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockImplementation(({ startTime }) => (
            Promise.resolve({ symbols: traded, full: false, lastTime: startTime + 1 })
        ));
        moduleMocks.futuresAdapter.getOrderHistory.mockImplementation(({ symbol }) => {
            admitted.push({ label: 'history', at: Date.now() });
            return Promise.resolve([{ symbol, orderId: 1, status: 'FILLED', time: 1 }]);
        });
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ symbol, endTime }) => {
            admitted.push({ label: 'history', at: Date.now() });
            return Promise.resolve([futuresHistoryTrade({
                symbol,
                id: '2',
                price: '1',
                quantity: '1',
                realizedPnl: '0',
                commission: '0',
                commissionAsset: 'USDT',
                marginAsset: 'USDT',
                time: Number.isSafeInteger(endTime) ? endTime : Date.now(),
            })]);
        });
        // Anything the desk read while it was starting up is not this test's.
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
        admitted.length = 0;

        const review = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1, marketType: 'futures', accountId: 'default',
                action: 'account.history', clientOrderId: 'review-in-flight',
                symbol: 'SELUSDT', coverage: {},
            }),
        });
        // Far enough in that the fan-out owns the queue, and the operator trades.
        await vi.advanceTimersByTimeAsync(600);
        const order = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1, marketType: 'futures', accountId: 'default',
                action: 'order.place', clientOrderId: 'worked-over-a-review',
                order: {
                    symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.01',
                    newClientOrderId: 'worked-over-a-review',
                },
            }),
        });
        await flushMicrotasks();
        const filledAt = Date.now();
        socket.handlers.message(JSON.stringify({
            e: 'ORDER_TRADE_UPDATE',
            E: 3_000,
            o: {
                s: 'BTCUSDT', i: 99, X: 'FILLED', S: 'BUY', o: 'MARKET',
                p: '0', q: '0.01', z: '0.01', T: 3_000,
            },
        }));
        await vi.advanceTimersByTimeAsync(60_000);
        await Promise.all([review, order]);
        await flushMicrotasks();

        const wallet = admitted.findIndex(entry => entry.label === 'read:balances');
        expect(wallet).toBeGreaterThan(-1);
        // Ahead of the review's remaining requests, not behind them.
        expect(admitted.slice(wallet + 1).filter(entry => entry.label === 'history').length)
            .toBeGreaterThan(10);
        // The 400ms the desk itself holds a frame-driven read for, plus its turn.
        expect(admitted[wallet].at - filledAt).toBeLessThanOrEqual(1_000);
        // And the review still finished: overtaking is not starving.
        expect(admitted.filter(entry => entry.label === 'history')).toHaveLength(24);
    });

    // The wallet is not the only thing the operator waits for. The free-margin
    // estimate is all-or-nothing across every contract the account has money or
    // an order on, so a position opened on a contract whose leverage has never
    // been read takes the whole estimate away until that read lands. The frame
    // that opens the position asks for that read, and it was ordinary.
    it('reads the leverage a new position needs without waiting out a review in flight', async () => {
        const admitted = [];
        const loadFor = (type, key, value) => vi.fn(async () => {
            admitted.push({ label: `read:${type}`, at: Date.now() });
            return { [key]: value };
        });
        const loads = {
            balances: loadFor('balances', 'futures_balances', {
                USDT: { available: '100', total: '100' },
            }),
            positions: loadFor('positions', 'futures_positions', []),
            regularOrders: loadFor('regularOrders', 'futures_regular_orders', []),
            algoOrders: loadFor('algoOrders', 'futures_algo_orders', []),
        };
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue(
            ['balances', 'positions', 'regularOrders', 'algoOrders'].map(type => ({
                type, weight: 5, errorLabel: type, loadPayload: loads[type],
            })),
        );
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const socket = await openFuturesHistoryStream();

        const traded = Array.from({ length: 11 }, (_, index) => (
            `D${String(index + 1).padStart(2, '0')}USDT`
        ));
        moduleMocks.futuresAdapter.getTradedSymbolPage.mockImplementation(({ startTime }) => (
            Promise.resolve({ symbols: traded, full: false, lastTime: startTime + 1 })
        ));
        moduleMocks.futuresAdapter.getOrderHistory.mockImplementation(({ symbol }) => {
            admitted.push({ label: 'history', at: Date.now() });
            return Promise.resolve([{ symbol, orderId: 1, status: 'FILLED', time: 1 }]);
        });
        moduleMocks.futuresAdapter.getTradeHistory.mockImplementation(({ symbol, endTime }) => {
            admitted.push({ label: 'history', at: Date.now() });
            return Promise.resolve([futuresHistoryTrade({
                symbol,
                id: '2',
                price: '1',
                quantity: '1',
                realizedPnl: '0',
                commission: '0',
                commissionAsset: 'USDT',
                marginAsset: 'USDT',
                time: Number.isSafeInteger(endTime) ? endTime : Date.now(),
            })]);
        });
        moduleMocks.futuresAdapter.getSymbolConfig.mockImplementation(async (symbol) => {
            admitted.push({ label: `config:${symbol}`, at: Date.now() });
            return { symbol, leverage: 20, marginType: 'CROSSED', maxNotionalValue: '5000000' };
        });
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
        admitted.length = 0;

        const review = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                version: 1, marketType: 'futures', accountId: 'default',
                action: 'account.history', clientOrderId: 'review-under-a-position',
                symbol: 'SELUSDT', coverage: {},
            }),
        });
        await vi.advanceTimersByTimeAsync(600);
        const openedAt = Date.now();
        socket.handlers.message(JSON.stringify({
            e: 'ACCOUNT_UPDATE', E: 3_000, T: 3_000,
            a: {
                m: 'ORDER',
                B: [{ a: 'USDT', wb: '1010.5', cw: '1010.5' }],
                P: [{ s: 'NEWUSDT', pa: '25', ep: '2.1', up: '3', mt: 'cross', iw: '0', ps: 'BOTH' }],
            },
        }));
        await vi.advanceTimersByTimeAsync(60_000);
        await review;
        await flushMicrotasks();

        const config = admitted.findIndex(entry => entry.label === 'config:NEWUSDT');
        expect(config).toBeGreaterThan(-1);
        // Ahead of the review's remaining requests, not behind them.
        expect(admitted.slice(config + 1).filter(entry => entry.label === 'history').length)
            .toBeGreaterThan(10);
        expect(admitted[config].at - openedAt).toBeLessThanOrEqual(1_000);
        // And the review still finished.
        expect(admitted.filter(entry => entry.label === 'history')).toHaveLength(24);
    });

    // The fan-out reads sixteen contracts. Once the last day alone has named that
    // many, reading further back cannot add one — and the review must say that the
    // rest of the week went unlooked-at rather than report a complete discovery.
    it('stops discovering once the recent end has filled the fan-out, and says so', async () => {
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        const today = ['B1USDT', 'B2USDT', 'B3USDT', 'B4USDT', 'B5USDT', 'B6USDT',
            'B7USDT', 'B8USDT', 'B9USDT', 'B10USDT', 'B11USDT', 'B12USDT', 'B13USDT',
            'B14USDT', 'B15USDT', 'B16USDT', 'B17USDT'];
        moduleMocks.futuresAdapter.getTradedSymbolPage
            .mockResolvedValueOnce({ symbols: today, full: false, lastTime: 900 });

        await runFuturesCommand({
            action: 'account.history',
            clientOrderId: 'history-4b',
            symbol: 'ETHUSDT',
        });

        expect(moduleMocks.futuresAdapter.getTradedSymbolPage).toHaveBeenCalledOnce();
        const [history] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_history);
        const { symbols, discovered, discoveryComplete } = history.futures_history;
        expect(discovered).toBe(18);
        expect(symbols).toHaveLength(16);
        expect(symbols.slice(0, 7)).toEqual(['ETHUSDT', ...today.slice(0, 6)]);
        expect(discoveryComplete).toBe(false);
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
        moduleMocks.futuresAdapter.getTradeHistory.mockResolvedValue([]);

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
        expect(moduleMocks.futuresAdapter.getLeverageBracketTable)
            .toHaveBeenCalledWith('BTCUSDT');
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

    // A leverage set in Binance's own app is announced on the authenticated
    // stream. The desk held what it last read until the hold expired, and stated
    // a multiple the account was no longer carried at.
    it('takes a leverage set elsewhere from the stream instead of re-reading it', async () => {
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
        const reads = moduleMocks.futuresAdapter.getSymbolConfig.mock.calls.length;
        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        socket.handlers.message(JSON.stringify({
            e: 'ACCOUNT_CONFIG_UPDATE',
            E: 1611646737479,
            T: 1611646737476,
            ac: { s: 'BTCUSDT', l: 25 },
        }));
        await flushMicrotasks();

        const stated = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_symbol_configs?.BTCUSDT)
            .at(-1).futures_symbol_configs.BTCUSDT;
        // The ceiling and the margin mode are what the read said; the frame
        // carries neither, and inventing them is how a desk states what nobody
        // told it.
        expect(stated).toMatchObject({
            symbol: 'BTCUSDT',
            leverage: 25,
            maxLeverage: 125,
            marginType: 'CROSSED',
        });
        expect(moduleMocks.futuresAdapter.getSymbolConfig).toHaveBeenCalledTimes(reads);
    });

    // A contract the desk holds nothing for gets nothing invented for it.
    it('does not invent a contract configuration from a leverage frame alone', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        socket.handlers.message(JSON.stringify({
            e: 'ACCOUNT_CONFIG_UPDATE',
            ac: { s: 'NEVERREADUSDT', l: 40 },
        }));
        await flushMicrotasks();

        expect(moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_symbol_configs?.NEVERREADUSDT)).toEqual([]);
    });

    // A position's contract configuration was re-read on every account refresh —
    // up to eight contracts at weight 5, added to a pass that already costs 90,
    // against a bucket of 800 a minute. Leverage changes when somebody sets it,
    // and nothing on the stream reports it, so asking on every refresh is asking
    // the same question at whatever rate the account happens to be busy.
    const positionsRefreshOperation = symbols => ({
        type: 'positions',
        weight: 5,
        errorLabel: 'positions',
        loadPayload: vi.fn().mockResolvedValue({
            futures_positions: symbols.map(symbol => ({
                symbol,
                positionSide: 'BOTH',
                quantity: '100',
                entryPrice: '1',
                markPrice: '1',
                unrealizedPnl: '0',
            })),
        }),
    });

    const refreshAccountTwice = async (secondDelayMs = 0) => {
        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-1', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();
        if (secondDelayMs > 0) await vi.advanceTimersByTimeAsync(secondDelayMs);
        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-2', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();
    };

    const configuredSymbols = () => moduleMocks.futuresAdapter.getSymbolConfig.mock.calls
        .map(([symbol]) => symbol);

    it('reads a position contract configuration once, not on every refresh', async () => {
        moduleMocks.futuresAdapter.getSymbolConfig
            .mockImplementation(async symbol => ({
                symbol, leverage: 20, marginType: 'CROSSED', maxNotionalValue: '5000000',
            }));
        moduleMocks.futuresAdapter.getAccountRefreshOperations
            .mockReturnValue([positionsRefreshOperation(['BMTUSDT'])]);
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');

        await refreshAccountTwice();

        expect(configuredSymbols().filter(symbol => symbol === 'BMTUSDT')).toHaveLength(1);
        // Both refreshes still state the multiple: reusing a reading is not the
        // same as withholding it.
        const configs = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_symbol_configs)
            .filter(payload => payload.futures_symbol_configs.BMTUSDT?.leverage === 20);
        expect(configs.length).toBeGreaterThanOrEqual(2);
    });

    // Held, not forgotten about: a leverage changed in Binance's own app reaches
    // the desk on its own, without the operator knowing to press anything.
    it('reads it again once it is old enough to have changed elsewhere', async () => {
        moduleMocks.futuresAdapter.getSymbolConfig
            .mockImplementation(async symbol => ({
                symbol, leverage: 20, marginType: 'CROSSED', maxNotionalValue: '5000000',
            }));
        moduleMocks.futuresAdapter.getAccountRefreshOperations
            .mockReturnValue([positionsRefreshOperation(['BMTUSDT'])]);
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');

        await refreshAccountTwice(10 * 60 * 1000);

        expect(configuredSymbols().filter(symbol => symbol === 'BMTUSDT')).toHaveLength(2);
    });

    // The hold measures time since the desk last asked the exchange for the
    // whole configuration. A leverage frame carries one field of it, and used to
    // restart the hold anyway — which dated the margin mode beside it to a
    // moment nothing read it, and postponed the read that would have found a
    // mode changed in Binance's own app by up to another ten minutes.
    it('does not date a contract configuration by a frame that carries only its multiple', async () => {
        moduleMocks.futuresAdapter.getSymbolConfig
            .mockImplementation(async symbol => ({
                symbol, leverage: 20, marginType: 'CROSSED', maxNotionalValue: '5000000',
            }));
        moduleMocks.futuresAdapter.getAccountRefreshOperations
            .mockReturnValue([positionsRefreshOperation(['BMTUSDT'])]);
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-1', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();
        expect(configuredSymbols().filter(symbol => symbol === 'BMTUSDT')).toHaveLength(1);

        const socket = moduleMocks.futuresUserDataSockets[0];
        socket.handlers.open();
        // Nine minutes in: inside the hold, so nothing would be re-read yet.
        // Keep this exact private socket carrying while the clock advances; a
        // frame from the instance retired by the silence watchdog is correctly
        // ignored before it can mutate the held configuration.
        for (let beat = 0; beat < 3; beat += 1) {
            await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
            socket.handlers.ping();
            await flushMicrotasks();
        }
        socket.handlers.message(JSON.stringify({
            e: 'ACCOUNT_CONFIG_UPDATE',
            E: 1611646737479,
            T: 1611646737476,
            ac: { s: 'BMTUSDT', l: 25 },
        }));
        await flushMicrotasks();

        // The multiple still moves on the frame, without a read behind it.
        expect(moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_symbol_configs?.BMTUSDT)
            .at(-1).futures_symbol_configs.BMTUSDT.leverage).toBe(25);
        expect(configuredSymbols().filter(symbol => symbol === 'BMTUSDT')).toHaveLength(1);

        // Past ten minutes counted from the read, not from the frame.
        await vi.advanceTimersByTimeAsync(60 * 1000 + 1);
        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-2', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();
        expect(configuredSymbols().filter(symbol => symbol === 'BMTUSDT')).toHaveLength(2);
    });

    // The contract the desk starts on is read once, on selection, and under the
    // operator's own rule — nothing is retuned in Binance's app while the desk
    // runs — that read is the only reading of it the session gets. A read that
    // failed used to be the end of it: the desk went on trading a contract whose
    // leverage and margin mode it had never learned, and stated both as unknown
    // for as long as it stayed on that contract.
    it('asks again for a selected contract whose configuration read failed', async () => {
        moduleMocks.futuresAdapter.getSymbolConfig
            .mockRejectedValueOnce(new Error('symbolConfig read failed'))
            .mockImplementation(async symbol => ({
                symbol, leverage: 20, marginType: 'ISOLATED', maxNotionalValue: '5000000',
            }));
        moduleMocks.futuresAdapter.getAccountRefreshOperations
            .mockReturnValue([positionsRefreshOperation([])]);
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');

        const statedConfigs = () => moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_symbol_configs?.BTCUSDT);

        await runFuturesCommand({
            action: 'account.symbolConfig', clientOrderId: 'config-1', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();
        expect(configuredSymbols().filter(symbol => symbol === 'BTCUSDT')).toHaveLength(1);
        // A failed read states nothing. It must not state a default either.
        expect(statedConfigs()).toEqual([]);

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-1', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();
        expect(configuredSymbols().filter(symbol => symbol === 'BTCUSDT')).toHaveLength(2);
        expect(statedConfigs().at(-1).futures_symbol_configs.BTCUSDT).toMatchObject({
            symbol: 'BTCUSDT',
            leverage: 20,
            marginType: 'ISOLATED',
        });

        // And once it is read, the pass behind it re-states the reading rather
        // than buying it again: this is a retry, not a beat.
        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-2', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();
        expect(configuredSymbols().filter(symbol => symbol === 'BTCUSDT')).toHaveLength(2);
        expect(statedConfigs().at(-1).futures_symbol_configs.BTCUSDT.leverage).toBe(20);
    });

    // A resting order commits margin exactly as a position does, and the desk
    // cannot say what is spendable without knowing what every one of them
    // commits. The contract configuration was read for positions alone, so an
    // account working orders without holding a position knew the leverage of
    // nothing — and the free-margin estimate, which is all-or-nothing across the
    // whole account by design, could not be computed at all. Twenty-three passes
    // out of twenty-three on the operator's desk on 2026-08-14.
    it('reads the contract configuration of a contract it only has an order on', async () => {
        moduleMocks.futuresAdapter.getSymbolConfig
            .mockImplementation(async symbol => ({
                symbol, leverage: 20, marginType: 'CROSSED', maxNotionalValue: '5000000',
            }));
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([
            positionsRefreshOperation([]),
            {
                type: 'regularOrders',
                weight: 40,
                errorLabel: 'regular orders',
                loadPayload: vi.fn().mockResolvedValue({
                    futures_regular_orders: [{
                        symbol: 'ORDERONLYUSDT',
                        orderId: 77,
                        orderKind: 'REGULAR',
                        status: 'NEW',
                        side: 'BUY',
                        origQty: '10',
                        executedQty: '0',
                        price: '3',
                    }],
                }),
            },
        ]);
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-order-only', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();

        expect(configuredSymbols()).toContain('ORDERONLYUSDT');
        expect(moduleMocks.futuresAdapter.getLeverageBracketTable)
            .toHaveBeenCalledWith('ORDERONLYUSDT');
    });

    // The contracts the account has something riding on are named by three of a
    // pass's reads, and asking each of them separately asked the same question of
    // a half-answered account. Measured on 2026-08-15: a pass reading three lists
    // sent three identical `futures_symbol_configs` broadcasts where a pass
    // reading one sent one, and every one of them is a renderer state update.
    // What the pass can act on is the last answer either way.
    //
    // Stated per pass rather than per command, because a command can run more
    // than one: the pass is the unit that reads the account, so the pass is the
    // unit the configuration is read for.
    it('reads the contract configuration once a pass, not once a list', async () => {
        moduleMocks.futuresAdapter.getSymbolConfig
            .mockImplementation(async symbol => ({
                symbol, leverage: 20, marginType: 'CROSSED', maxNotionalValue: '5000000',
            }));
        const positionsOperation = positionsRefreshOperation(['BMTUSDT']);
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([
            positionsOperation,
            {
                type: 'regularOrders',
                weight: 40,
                errorLabel: 'regular orders',
                loadPayload: vi.fn().mockResolvedValue({
                    futures_regular_orders: [{
                        symbol: 'ORDERONLYUSDT', orderId: 77, orderKind: 'REGULAR',
                        status: 'NEW', side: 'BUY', origQty: '10', executedQty: '0', price: '3',
                    }],
                }),
            },
            {
                type: 'algoOrders',
                weight: 5,
                errorLabel: 'algo orders',
                loadPayload: vi.fn().mockResolvedValue({
                    futures_algo_orders: [{
                        symbol: 'ALGOONLYUSDT', orderId: 78, orderKind: 'ALGO',
                        status: 'NEW', side: 'SELL', origQty: '10', executedQty: '0',
                        stopPrice: '9',
                    }],
                }),
            },
        ]);
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');

        moduleMocks.rendererConnection.sendUTF.mockClear();
        positionsOperation.loadPayload.mockClear();
        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-three-lists', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();

        // Every pass reads the position list exactly once, so counting that read
        // counts the passes — including the follow-up a pass can queue behind it.
        const passes = positionsOperation.loadPayload.mock.calls.length;
        const broadcasts = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_symbol_configs)
            .length;
        expect(passes).toBeGreaterThan(0);
        expect(broadcasts).toBe(passes);
        // And it still reads every contract, which is what the pass is for.
        expect(configuredSymbols().sort())
            .toEqual(['ALGOONLYUSDT', 'BMTUSDT', 'ORDERONLYUSDT']);
    });

    it('reads only the contracts nothing is held for', async () => {
        moduleMocks.futuresAdapter.getSymbolConfig
            .mockImplementation(async symbol => ({
                symbol, leverage: 20, marginType: 'CROSSED', maxNotionalValue: '5000000',
            }));
        moduleMocks.futuresAdapter.getAccountRefreshOperations
            .mockReturnValue([positionsRefreshOperation(['BMTUSDT'])]);
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');

        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-1', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();
        moduleMocks.futuresAdapter.getAccountRefreshOperations
            .mockReturnValue([positionsRefreshOperation(['BMTUSDT', 'EPICUSDT'])]);
        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-2', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();

        expect(configuredSymbols()).toEqual(['BMTUSDT', 'EPICUSDT']);
        const [latest] = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_symbol_configs)
            .slice(-1);
        // The contract that was not read is still stated, from what is held.
        expect(Object.keys(latest.futures_symbol_configs).sort())
            .toEqual(['BMTUSDT', 'EPICUSDT']);
    });

    it('bounds missing held-position bracket reads to eight contracts', async () => {
        moduleMocks.futuresAdapter.getSymbolConfig
            .mockImplementation(async symbol => ({
                symbol, leverage: 20, marginType: 'CROSSED', maxNotionalValue: '5000000',
            }));
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');

        const symbols = Array.from({ length: 9 }, (_, index) => `HELD${index}USDT`);
        moduleMocks.futuresAdapter.getAccountRefreshOperations
            .mockReturnValue([positionsRefreshOperation(symbols)]);
        await runFuturesCommand({
            action: 'account.refresh', clientOrderId: 'refresh-brackets', symbol: 'BTCUSDT',
        });
        await flushMicrotasks();

        expect(moduleMocks.futuresAdapter.getLeverageBracketTable).toHaveBeenCalledTimes(8);
        expect(moduleMocks.futuresAdapter.getLeverageBracketTable.mock.calls.map(([symbol]) => symbol))
            .toEqual(symbols.slice(0, 8));
        expect(configuredSymbols()).toEqual(symbols.slice(0, 8));
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

    // The answer to a mode change is the mode and the contract's re-read
    // configuration. The account pass behind it prices consequences, and held
    // inside the answer it held the per-contract lane too: on 2026-08-23 the
    // operator's repeat toggles waited 45–57s behind a pass the desk's own
    // budget had deferred, while the exchange answered each POST in ~340ms.
    it('answers a margin-mode change and the next toggle while the account pass is still out', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.getSymbolConfig.mockResolvedValue({
            symbol: 'EPICUSDT', leverage: 2, marginType: 'CROSSED', maxNotionalValue: '500000',
        });
        // A pass that never answers inside the test, standing in for one the
        // read budget has deferred to the next minute.
        const heldPayload = vi.fn(() => new Promise(() => {}));
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions',
            loadPayload: heldPayload,
        }]);
        moduleMocks.futuresAdapter.setMarginType
            .mockResolvedValueOnce({ code: 200, msg: 'success' })
            .mockRejectedValueOnce(
                Object.assign(new Error('No need to change margin type.'), { code: -4046 }),
            );

        const first = startFuturesCommandWithoutAdvancing({
            action: 'trade.setMarginType',
            clientOrderId: 'margin-lane-1',
            symbol: 'EPICUSDT',
            marginType: 'CROSSED',
        });
        const second = startFuturesCommandWithoutAdvancing({
            action: 'trade.setMarginType',
            clientOrderId: 'margin-lane-2',
            symbol: 'EPICUSDT',
            marginType: 'CROSSED',
        });
        const both = Promise.all([first, second]);
        let settled = false;
        both.then(() => { settled = true; }, () => { settled = true; });
        for (let step = 0; step < 6 && !settled; step += 1) {
            await vi.advanceTimersByTimeAsync(5_000);
        }
        await both;

        expect(moduleMocks.futuresAdapter.setMarginType).toHaveBeenCalledTimes(2);
        // The pass really is in flight — the answers just did not wait for it.
        expect(heldPayload).toHaveBeenCalled();
        const payloads = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        expect(payloads.filter(payload => payload.futures_symbol_configs?.EPICUSDT).length)
            .toBeGreaterThanOrEqual(2);
        expect(payloads.some(payload => payload.command_rejected)).toBe(false);
    });

    it('answers a leverage change while the account pass behind it is still out', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.getSymbolConfig.mockResolvedValue({
            symbol: 'EPICUSDT', leverage: 3, marginType: 'CROSSED', maxNotionalValue: '500000',
        });
        const heldPayload = vi.fn(() => new Promise(() => {}));
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions',
            loadPayload: heldPayload,
        }]);

        await runFuturesCommand({
            action: 'trade.setLeverage',
            clientOrderId: 'leverage-lane-1',
            symbol: 'EPICUSDT',
            leverage: 3,
        });

        expect(heldPayload).toHaveBeenCalled();
        const payloads = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        const [configs] = payloads.filter(payload => payload.futures_symbol_configs);
        expect(configs.futures_symbol_configs.EPICUSDT.leverage).toBe(3);
        expect(payloads.some(payload => payload.command_rejected)).toBe(false);
    });

    // The ceiling is not a function of the mode. The re-read behind a mode
    // change asks for the contract alone, and the ceiling read when the
    // contract was selected survives the bracket-less answer.
    it('re-reads a margin-mode change without the bracket table and keeps the held ceiling', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.getSymbolConfig.mockResolvedValue({
            symbol: 'EPICUSDT', leverage: 2, marginType: 'ISOLATED', maxNotionalValue: '500000',
        });
        await runFuturesCommand({
            action: 'account.symbolConfig', clientOrderId: 'config-ceiling', symbol: 'EPICUSDT',
        });
        const bracketsBefore = moduleMocks.futuresAdapter.getLeverageBracketTable.mock.calls.length;
        expect(bracketsBefore).toBeGreaterThan(0);

        await runFuturesCommand({
            action: 'trade.setMarginType',
            clientOrderId: 'margin-ceiling',
            symbol: 'EPICUSDT',
            marginType: 'CROSSED',
        });

        expect(moduleMocks.futuresAdapter.getLeverageBracketTable.mock.calls.length)
            .toBe(bracketsBefore);
        const config = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.futures_symbol_configs?.EPICUSDT)
            .at(-1).futures_symbol_configs.EPICUSDT;
        expect(config.maxLeverage).toBe(125);
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

    // The contract is the whole identity of these two commands — they carry no
    // order id — so a refusal that does not name it leaves the record saying
    // that a leverage change was refused somewhere. On the operator's own desk
    // on 2026-08-21 that is exactly what it said: `symbol: null` beside
    // `exchangeCode: -4161`, on a day the desk had touched three contracts.
    it('names the contract on a refused leverage or margin-mode change', async () => {
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        moduleMocks.futuresAdapter.setLeverage.mockRejectedValueOnce(Object.assign(
            new Error('Leverage reduction is not supported in Isolated Margin Mode with open positions'),
            { code: -4161 },
        ));
        moduleMocks.futuresAdapter.setMarginType.mockRejectedValueOnce(Object.assign(
            new Error('Margin type cannot be changed if there exists position.'),
            { code: -4048 },
        ));

        await runFuturesCommand({
            action: 'trade.setLeverage',
            clientOrderId: 'leverage-4161',
            symbol: 'ONGUSDT',
            leverage: 1,
        });
        await runFuturesCommand({
            action: 'trade.setMarginType',
            clientOrderId: 'margin-type-4048',
            symbol: 'BEATUSDT',
            marginType: 'CROSSED',
        });

        const rejections = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.command_rejected?.code === 'FUTURES_API_ERROR')
            .map(payload => payload.command_rejected);
        expect(rejections.map(rejection => [
            rejection.request,
            rejection.details.symbol,
            rejection.details.binanceCode,
        ])).toEqual([
            ['trade.setLeverage', 'ONGUSDT', -4161],
            ['trade.setMarginType', 'BEATUSDT', -4048],
        ]);
        // And the exchange's bare code says nothing about what to do with it.
        expect(rejections[0].message).toContain('close the position, or raise it instead');
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

        const pending = placeFuturesOrder();
        await vi.advanceTimersByTimeAsync(1_000);
        await pending;

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

    it('charges an ambiguous mutation once and its reconciliation read separately', async () => {
        const diagnostics = [];
        const diagnosticRecord = {
            ...DESK_DIAGNOSTICS_UNRECORDED,
            record: (kind, payload) => {
                diagnostics.push({ kind, ...payload });
                return true;
            },
        };
        setupBinanceConnection({
            localWebSocketAccess: { host: '127.0.0.1' },
            diagnosticRecord,
        });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });
        await activateMarket('futures-live');
        await vi.advanceTimersByTimeAsync(5_000);
        await flushMicrotasks();
        diagnostics.length = 0;
        moduleMocks.futuresAdapter.placeOrder.mockRejectedValueOnce(
            Object.assign(new Error('Unknown error'), { status: 503, indeterminate: true }),
        );
        moduleMocks.futuresAdapter.findOrder.mockResolvedValueOnce({
            exists: true,
            report: { e: 'executionReport', symbol: 'BTCUSDT', status: 'NEW', orderId: 78 },
        });

        const pending = placeFuturesOrder('ambiguous-physical-accounting');
        await vi.advanceTimersByTimeAsync(1_000);
        await pending;

        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
        expect(moduleMocks.futuresAdapter.findOrder).toHaveBeenCalledOnce();
        expect(diagnostics.filter(entry => entry.kind === 'request')).toEqual([
            expect.objectContaining({
                standing: 'urgent',
                attempts: 1,
                chargedWeight: 1,
                networkRetries: 0,
                outcome: 'error',
                status: 503,
            }),
            expect.objectContaining({
                standing: 'urgent',
                attempts: 1,
                chargedWeight: 1,
                outcome: 'ok',
            }),
        ]);
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

    it('does not resolve ambiguous margin until its queued reconciliation drain succeeds', async () => {
        await connectRenderer();
        let releaseFirstPass;
        const firstPassGate = new Promise((resolve) => { releaseFirstPass = resolve; });
        let passes = 0;
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockImplementation(() => {
            passes += 1;
            if (passes === 1) {
                return [{
                    type: 'balances', weight: 1, errorLabel: 'balances',
                    loadPayload: async () => {
                        await firstPassGate;
                        return { futures_balances: {} };
                    },
                }];
            }
            return [{
                type: 'positions', weight: 1, errorLabel: 'positions',
                loadPayload: async () => ({ futures_positions: [] }),
            }, {
                type: 'balances', weight: 1, errorLabel: 'balances',
                loadPayload: async () => ({ futures_balances: {} }),
            }];
        });

        const first = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.refresh',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'held-account-refresh',
                symbol: 'BTCUSDT',
            }),
        });
        await flushMicrotasks();
        moduleMocks.futuresAdapter.adjustPositionMargin.mockRejectedValueOnce(
            Object.assign(new Error('socket hang up'), { status: 503, indeterminate: true }),
        );
        const adjustment = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.adjustPositionMargin',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'queued-margin-reconcile',
                symbol: 'BTCUSDT',
                positionSide: 'BOTH',
                direction: 'ADD',
                amount: '10',
            }),
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();
        expect(emitted().some(payload => (
            payload.command_unresolved?.code === 'FUTURES_OUTCOME_UNKNOWN'
        ))).toBe(true);
        expect(emitted().some(payload => (
            payload.command_resolved?.code === 'FUTURES_OUTCOME_RESYNCED'
        ))).toBe(false);

        releaseFirstPass();
        await vi.advanceTimersByTimeAsync(3_000);
        await Promise.all([first, adjustment]);

        expect(passes).toBe(2);
        expect(emitted().some(payload => (
            payload.command_resolved?.code === 'FUTURES_OUTCOME_RESYNCED'
        ))).toBe(true);
    });

    it('lets a later failed required read replace an earlier ready receipt', async () => {
        await connectRenderer();
        let releaseFirstBalance;
        const firstBalanceGate = new Promise((resolve) => { releaseFirstBalance = resolve; });
        let passes = 0;
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockImplementation(() => {
            passes += 1;
            const pass = passes;
            return [{
                type: 'positions', weight: 1, errorLabel: 'positions',
                loadPayload: async () => ({ futures_positions: [] }),
            }, {
                type: 'balances', weight: 1, errorLabel: 'balances',
                loadPayload: async () => {
                    if (pass === 1) {
                        await firstBalanceGate;
                        return { futures_balances: {} };
                    }
                    throw new Error('newer balance read failed');
                },
            }];
        });

        const first = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.refresh',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'earlier-ready-account-refresh',
                symbol: 'BTCUSDT',
            }),
        });
        await flushMicrotasks();
        moduleMocks.futuresAdapter.adjustPositionMargin.mockRejectedValueOnce(
            Object.assign(new Error('socket hang up'), { status: 503, indeterminate: true }),
        );
        const adjustment = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.adjustPositionMargin',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId: 'later-failed-margin-reconcile',
                symbol: 'BTCUSDT',
                positionSide: 'BOTH',
                direction: 'ADD',
                amount: '10',
            }),
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();
        expect(emitted().some(payload => (
            payload.command_unresolved?.code === 'FUTURES_OUTCOME_UNKNOWN'
        ))).toBe(true);

        releaseFirstBalance();
        await vi.advanceTimersByTimeAsync(10_000);
        await Promise.all([first, adjustment]);

        expect(passes).toBe(2);
        expect(emitted().some(payload => (
            payload.command_resolved?.code === 'FUTURES_OUTCOME_RESYNCED'
        ))).toBe(false);
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
        await vi.advanceTimersByTimeAsync(1_000);
        await placement;
        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
        releaseSnapshot();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
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

    it('enforces the cap on entries and exempts only current backend-proven reductions', async () => {
        vi.stubEnv('FUTURES_MAX_ORDER_USDT', '100');
        const positions = [{
            symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '10',
            entryPrice: '50000', markPrice: '50000', unrealizedPnl: '0',
        }, {
            symbol: 'ETHUSDT', positionSide: 'SHORT', quantity: '-8',
            entryPrice: '2500', markPrice: '2500', unrealizedPnl: '0',
        }, {
            symbol: 'BNBUSDT', positionSide: 'BOTH', quantity: '6',
            entryPrice: '600', markPrice: '600', unrealizedPnl: '0',
        }, {
            symbol: 'XRPUSDT', positionSide: 'BOTH', quantity: '-7',
            entryPrice: '1', markPrice: '1', unrealizedPnl: '0',
        }];
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions',
            weight: 5,
            errorLabel: 'positions',
            loadPayload: vi.fn().mockResolvedValue({ futures_positions: positions }),
        }]);
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
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        const privateSocket = moduleMocks.futuresUserDataSockets
            .find(socket => socket.handlers.ping);
        expect(privateSocket).toBeDefined();
        privateSocket.handlers.open();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        const sendOrder = payload => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder',
                version: 1,
                marketType: 'futures',
                symbol: 'BTCUSDT', side: 'BUY',
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

        // Each explicit leg is accepted only in its actual closing direction.
        // MARKET carries no price, so passing the active cap proves the backend
        // position snapshot — not a renderer flag — supplied the exemption.
        await sendOrder({
            symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '10',
            positionSide: 'LONG', reduceOnly: true,
        });
        await sendOrder({
            symbol: 'ETHUSDT', side: 'BUY', orderType: 'MARKET', quantity: '8',
            positionSide: 'SHORT', reduceOnly: true,
        });
        await sendOrder({
            symbol: 'BNBUSDT', side: 'SELL', orderType: 'MARKET', quantity: '6',
            positionSide: 'BOTH', reduceOnly: true,
        });
        await sendOrder({
            symbol: 'XRPUSDT', side: 'BUY', orderType: 'MARKET', quantity: '7',
            positionSide: 'BOTH', reduceOnly: true,
        });
        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledTimes(5);
        expect(moduleMocks.futuresAdapter.placeOrder.mock.calls.slice(1).map(([order]) => ({
            symbol: order.symbol,
            side: order.side,
            positionSide: order.positionSide,
            reduceOnly: order.reduceOnly,
        }))).toEqual([
            { symbol: 'BTCUSDT', side: 'SELL', positionSide: 'LONG', reduceOnly: true },
            { symbol: 'ETHUSDT', side: 'BUY', positionSide: 'SHORT', reduceOnly: true },
            { symbol: 'BNBUSDT', side: 'SELL', positionSide: 'BOTH', reduceOnly: true },
            { symbol: 'XRPUSDT', side: 'BUY', positionSide: 'BOTH', reduceOnly: true },
        ]);

        moduleMocks.futuresAdapter.placeOrder.mockClear();
        moduleMocks.rendererConnection.sendUTF.mockClear();
        // None of these claims is a reduction: the first omits the leg, the
        // second opens the held LONG, the third names a different leg, and the
        // fourth is larger than the position it claims to close.
        await sendOrder({
            symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '1',
            reduceOnly: true,
        });
        await sendOrder({
            symbol: 'BTCUSDT', side: 'BUY', orderType: 'MARKET', quantity: '1',
            positionSide: 'LONG', reduceOnly: true,
        });
        await sendOrder({
            symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '1',
            positionSide: 'SHORT', reduceOnly: true,
        });
        await sendOrder({
            symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '11',
            positionSide: 'LONG', reduceOnly: true,
        });
        await sendOrder({
            symbol: 'XRPUSDT', side: 'SELL', orderType: 'MARKET', quantity: '1',
            positionSide: 'BOTH', reduceOnly: true,
        });
        expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
        const unproved = moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter(payload => payload.command_rejected?.code === 'FUTURES_REDUCTION_NOT_CONFIRMED');
        expect(unproved).toHaveLength(5);
        expect(unproved[0].command_rejected.details.positionSide).toBeNull();
        // Each refusal names which condition failed. One code for five causes
        // is what made the 2026-08-24 episode a journal-archaeology exercise.
        expect(unproved.map(payload => payload.command_rejected.details.cause)).toEqual([
            'LEG_MISMATCH',
            'SIDE_MISMATCH',
            'LEG_MISMATCH',
            'QUANTITY_EXCEEDS_LEG',
            'SIDE_MISMATCH',
        ]);
    });

    // The 2026-08-24 episode, distilled: the desk displayed the position from
    // its own last successful reading while a fresh activation snapshot was
    // still loading, and the first market-close click bounced in 1 ms. The
    // retained reading is the same evidence the row on screen is drawn from,
    // so the close is proved against it and sent — a re-stamp in flight is not
    // a reason to refuse. The active cap plus a MARKET order (no price) proves
    // the exemption came from that retained backend reading, not the flag.
    it('sends a reduce-only close proved by the retained reading while the fresh snapshot loads', async () => {
        vi.stubEnv('FUTURES_MAX_ORDER_USDT', '100');
        let resolveReplacement;
        const replacement = new Promise((resolve) => { resolveReplacement = resolve; });
        const loadPositions = vi.fn()
            .mockResolvedValueOnce({
                futures_positions: [{
                    symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '2',
                    entryPrice: '50000', markPrice: '50000', unrealizedPnl: '0',
                }],
            })
            .mockImplementation(() => replacement);
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions', loadPayload: loadPositions,
        }]);
        setupBinanceConnection({ localWebSocketAccess: { host: '127.0.0.1' } });
        moduleMocks.websocketServerHandlers.request({
            origin: 'http://localhost:5174',
            accept: vi.fn(() => moduleMocks.rendererConnection),
        });

        await activateMarket('futures-live');
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
        await activateMarket('spot');
        await activateMarket('futures-live');
        await flushMicrotasks();

        const close = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder', version: 1, marketType: 'futures',
                symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '1',
                positionSide: 'LONG', reduceOnly: true,
            }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await close;

        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
        expect(moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message))
            .some(payload => (
                payload.command_rejected?.code === 'FUTURES_REDUCTION_NOT_CONFIRMED'
            ))).toBe(false);
        resolveReplacement({ futures_positions: [] });
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();
    });

    // The literal 2026-08-24 window, without the activation change the test
    // above adds: same activation, an account refresh mid-re-stamp (the pass
    // started 477 ms before the click), the resource sitting `loading`. The
    // click landed inside that window and bounced; it must send.
    it('sends a reduce-only close while an account refresh is re-stamping the reading', async () => {
        vi.stubEnv('FUTURES_MAX_ORDER_USDT', '100');
        const loadPositions = vi.fn()
            .mockResolvedValueOnce({
                futures_positions: [{
                    symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '2',
                    entryPrice: '50000', markPrice: '50000', unrealizedPnl: '0',
                }],
            })
            .mockImplementation(() => new Promise(() => {}));
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions', loadPayload: loadPositions,
        }]);
        await connectRenderer();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        // The operator's refresh: the second read hangs, holding the positions
        // resource mid-re-stamp exactly as the 18:09:41.481 pass did.
        const refresh = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'account.refresh', version: 1, marketType: 'futures',
            }),
        });
        await vi.advanceTimersByTimeAsync(100);
        await flushMicrotasks();

        const close = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder', version: 1, marketType: 'futures',
                symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '1',
                positionSide: 'LONG', reduceOnly: true,
            }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await close;

        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
        expect(emitted().some(payload => (
            payload.command_rejected?.code === 'FUTURES_REDUCTION_NOT_CONFIRMED'
        ))).toBe(false);
        void refresh;
    });

    // The operator's ruling of 2026-08-24: a close ordered while the desk has
    // no proof at all holds for the in-flight pass and fires at the first
    // reading that proves it — it is not bounced back for a retry.
    it('holds a reduce-only close with no reading yet and sends it at the first proof', async () => {
        vi.stubEnv('FUTURES_MAX_ORDER_USDT', '100');
        let resolvePositions;
        const firstReading = new Promise((resolve) => { resolvePositions = resolve; });
        const loadPositions = vi.fn().mockImplementation(() => firstReading);
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions', loadPayload: loadPositions,
        }]);
        await connectRenderer();

        const close = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder', version: 1, marketType: 'futures',
                symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '1',
                positionSide: 'LONG', reduceOnly: true,
            }),
        });
        await vi.advanceTimersByTimeAsync(300);
        resolvePositions({
            futures_positions: [{
                symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '2',
                entryPrice: '50000', markPrice: '50000', unrealizedPnl: '0',
            }],
        });
        await vi.advanceTimersByTimeAsync(500);
        await close;

        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
        expect(emitted().some(payload => (
            payload.command_rejected?.code === 'FUTURES_REDUCTION_NOT_CONFIRMED'
        ))).toBe(false);
    });

    // The pause gate runs before the hold, and the hold is the one await the
    // proof added between that gate and the wire. A pause thrown while the
    // close waits for its reading must still hold: nothing leaves a paused
    // desk. Resuming and clicking again sends — the refusal was the pause.
    it('refuses a held close that was paused mid-hold, and sends it after resume', async () => {
        vi.stubEnv('FUTURES_MAX_ORDER_USDT', '100');
        let resolvePositions;
        const firstReading = new Promise((resolve) => { resolvePositions = resolve; });
        const loadPositions = vi.fn().mockImplementation(() => firstReading);
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions', loadPayload: loadPositions,
        }]);
        await connectRenderer();

        const close = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder', version: 1, marketType: 'futures',
                symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '1',
                positionSide: 'LONG', reduceOnly: true,
            }),
        });
        await vi.advanceTimersByTimeAsync(100);
        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.setTradingPaused', version: 1, marketType: 'futures',
                paused: true,
            }),
        });
        resolvePositions({
            futures_positions: [{
                symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '2',
                entryPrice: '50000', markPrice: '50000', unrealizedPnl: '0',
            }],
        });
        await vi.advanceTimersByTimeAsync(500);
        await close;

        expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
        expect(emitted().some(payload => (
            payload.command_rejected?.code === 'FUTURES_TRADING_PAUSED'
        ))).toBe(true);
        expect(emitted().some(payload => (
            payload.command_rejected?.code === 'FUTURES_REDUCTION_NOT_CONFIRMED'
        ))).toBe(false);

        await moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.setTradingPaused', version: 1, marketType: 'futures',
                paused: false,
            }),
        });
        const retry = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder', version: 1, marketType: 'futures',
                symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '1',
                positionSide: 'LONG', reduceOnly: true,
            }),
        });
        await vi.advanceTimersByTimeAsync(500);
        await retry;
        expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
    });

    // No successful positions reading has ever existed and none arrives inside
    // the bounded hold: the refusal fires at the bound and names the condition.
    it('refuses a reduce-only order by name when the bounded hold ends without a reading', async () => {
        await connectRenderer();

        const close = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder', version: 1, marketType: 'futures',
                symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '1',
                positionSide: 'LONG', reduceOnly: true,
            }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await close;

        expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
        const refusal = emitted().find(payload => (
            payload.command_rejected?.code === 'FUTURES_REDUCTION_NOT_CONFIRMED'
        ));
        expect(refusal.command_rejected.details.cause).toBe('NO_READING');
        expect(refusal.command_rejected.message).toContain('positions reading');
    });

    // The reading exists but is older than the desk trusts for proof, and the
    // held command's fresh read never lands: the refusal names the staleness
    // instead of pretending the order itself was wrong.
    it('refuses by name when the only reading is stale beyond the bound and no fresh one lands', async () => {
        const loadPositions = vi.fn()
            .mockResolvedValueOnce({
                futures_positions: [{
                    symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '2',
                    entryPrice: '50000', markPrice: '50000', unrealizedPnl: '0',
                }],
            })
            .mockImplementation(() => new Promise(() => {}));
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
            type: 'positions', weight: 5, errorLabel: 'positions', loadPayload: loadPositions,
        }]);
        await connectRenderer();
        await vi.advanceTimersByTimeAsync(2_000);
        await flushMicrotasks();

        // Quiet holding, not a broken desk: the clock moves without a timer
        // firing, and the held reading ages past the proof bound.
        vi.setSystemTime(new Date(Date.now() + 16 * 60_000));

        const close = moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder', version: 1, marketType: 'futures',
                symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', quantity: '1',
                positionSide: 'LONG', reduceOnly: true,
            }),
        });
        await vi.advanceTimersByTimeAsync(2_000);
        await close;

        expect(moduleMocks.futuresAdapter.placeOrder).not.toHaveBeenCalled();
        const refusal = emitted().find(payload => (
            payload.command_rejected?.code === 'FUTURES_REDUCTION_NOT_CONFIRMED'
        ));
        expect(refusal.command_rejected.details.cause).toBe('STALE_READING');
    });

    // A record wired to nothing is the same failure the fault reporter already
    // had: the desk states everything, and none of it lands anywhere.
    describe('what reaches the desk record', () => {
        const kept = [];
        const record = {
            directory: '/desk/diagnostics',
            record: (kind, value) => kept.push({ kind, ...value }) > 0,
            // Both answer whether they wrote anything, exactly as the real
            // record does. A fake that answered `true` for a frame it kept
            // nothing for let the desk record an answer to a command that has no
            // line of its own to pair it with.
            observeOutbound: (payload) => {
                const event = readDeskDiagnosticOutboundEvent(payload);
                if (event === null) return false;
                kept.push(event);
                return true;
            },
            observeCommand: (command) => {
                const event = readDeskDiagnosticCommandEvent(command);
                if (event === null) return false;
                kept.push(event);
                return true;
            },
            close: () => {},
        };
        const held = kind => kept.filter(entry => entry.kind === kind);

        const connectRecordedRenderer = async (
            marketMode = 'futures-live',
            diagnosticRecord = record,
        ) => {
            kept.length = 0;
            setupBinanceConnection({
                localWebSocketAccess: { host: '127.0.0.1' },
                diagnosticRecord,
            });
            moduleMocks.websocketServerHandlers.request({
                origin: 'http://localhost:5174',
                accept: vi.fn(() => moduleMocks.rendererConnection),
            });
            if (marketMode) await activateMarket(marketMode);
        };

        it('keeps the command as issued and the outcome that answered it', async () => {
            await connectRecordedRenderer();
            moduleMocks.futuresAdapter.placeOrder.mockRejectedValueOnce(
                Object.assign(new Error('refused'), { code: -2019, msg: 'Margin is insufficient.' }),
            );

            await placeFuturesOrder('recorded-1');

            expect(held('command')).toContainEqual({
                kind: 'command',
                action: 'trade.placeOrder',
                market: 'futures',
                symbol: 'BTCUSDT',
                side: 'BUY',
                orderType: 'LIMIT',
                identity: 'recorded-1',
            });
            expect(held('outcome')[0]).toMatchObject({
                action: 'trade.placeOrder',
                result: 'rejected',
                market: 'futures',
                // The desk's own word for a refusal is the same for every
                // refusal there is; this is the exchange's.
                exchangeCode: '-2019',
            });
            // The price and the size the command carried are not in any of it,
            // and neither is the sentence the exchange wrote for a human.
            expect(JSON.stringify(kept)).not.toMatch(/50000|0\.01\b|Margin is insufficient/);
        });

        // One code stood for five causes on 2026-08-24 and the diagnosis had to
        // be assembled from the surrounding lines. The outcome line itself now
        // says which condition of the reduction proof failed.
        it('carries the named cause of a reduction refusal in the outcome line', async () => {
            moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([{
                type: 'positions',
                weight: 5,
                errorLabel: 'positions',
                loadPayload: vi.fn().mockResolvedValue({
                    futures_positions: [{
                        symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '2',
                        entryPrice: '50000', markPrice: '50000', unrealizedPnl: '0',
                    }],
                }),
            }]);
            await connectRecordedRenderer();
            await vi.advanceTimersByTimeAsync(2_000);
            await flushMicrotasks();

            // BUY does not close the held LONG: a genuinely wrong order, and
            // the reading that proves it is on hand — the refusal is immediate.
            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'trade.placeOrder', version: 1, marketType: 'futures',
                    symbol: 'BTCUSDT', side: 'BUY', orderType: 'MARKET', quantity: '1',
                    positionSide: 'LONG', reduceOnly: true,
                }),
            });

            expect(held('outcome')).toContainEqual(expect.objectContaining({
                action: 'trade.placeOrder',
                result: 'rejected',
                code: 'FUTURES_REDUCTION_NOT_CONFIRMED',
                cause: 'SIDE_MISMATCH',
            }));
        });

        // The renderer closes the only leg it can see. Accepted before the
        // credential gate and outside the market machinery, for the reason the
        // market lane's report already is: this reaches no exchange and moves no
        // order, and a diagnostic an unconfigured desk cannot file goes missing
        // exactly when the desk is worth asking about.
        it('keeps the order a frame was about and whether drawing it changed anything', async () => {
            await connectRecordedRenderer(null);

            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'report_frame_marks',
                    resource: 'orders',
                    symbol: 'TUTUSDT',
                    identity: 41,
                    status: 'PARTIALLY_FILLED',
                    code: 'DELIVERED',
                    upstreamMs: 210,
                    queuedMs: 0,
                    deliveredMs: 2,
                    committedMs: 9,
                    totalMs: 221,
                }),
            });

            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'report_frame_marks',
                    resource: 'orders',
                    symbol: 'TUTUSDT',
                    identity: 41,
                    status: 'FILLED',
                    code: 'UNCHANGED',
                    upstreamMs: null,
                    queuedMs: 0,
                    deliveredMs: 1,
                    committedMs: 3,
                    totalMs: 4,
                }),
            });

            // A word this desk does not use for a delivery is recorded as the
            // market lane's own answer rather than believed: the renderer is
            // ours, and this is still the one field on the line whose value a
            // caller chooses.
            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'report_frame_marks',
                    resource: 'orders',
                    symbol: 'TUTUSDT',
                    identity: 41,
                    status: 'NEW',
                    code: 'WHATEVER',
                    upstreamMs: null,
                    queuedMs: 0,
                    deliveredMs: 1,
                    committedMs: 1,
                    totalMs: 2,
                }),
            });

            expect(held('frame')).toEqual([
                expect.objectContaining({
                    resource: 'orders',
                    symbol: 'TUTUSDT',
                    identity: 41,
                    status: 'PARTIALLY_FILLED',
                    code: 'DELIVERED',
                    committedMs: 9,
                }),
                expect.objectContaining({
                    identity: 41,
                    status: 'FILLED',
                    // Arrived, and the screen already showed it. Not a fault,
                    // and told apart from the one that is.
                    code: 'UNCHANGED',
                }),
                expect.objectContaining({ status: 'NEW', code: 'DELIVERED' }),
            ]);
        });

        // The command's own line says when it was asked for and nothing said
        // when it was done. Without the pair, a desk that feels slow can only be
        // described, and the record cannot say whether the wait was the
        // exchange's or the desk's own.
        it('keeps how long the desk took to answer the command', async () => {
            await connectRecordedRenderer();

            await placeFuturesOrder('measured-1');

            const answer = held('answer')[0];
            expect(answer).toMatchObject({
                action: 'trade.placeOrder',
                market: 'futures',
                symbol: 'BTCUSDT',
                identity: 'measured-1',
                outcome: 'ok',
            });
            expect(Number.isSafeInteger(answer.durationMs)).toBe(true);
            // Paired with the command by the identity both carry.
            expect(held('command')[0].identity).toBe(answer.identity);
        });

        // Reads the desk asks for on its own beat are not commands and are not
        // recorded; their answers are not either, or the record would fill with
        // the desk's own housekeeping.
        it('keeps no answer for a read the record does not keep', async () => {
            futuresAccountLoads();
            await connectRecordedRenderer();
            await vi.advanceTimersByTimeAsync(2_000);

            const handled = moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    version: 1,
                    marketType: 'futures',
                    action: 'account.refresh',
                    accountId: 'default',
                }),
            });
            await vi.advanceTimersByTimeAsync(2_000);
            await handled;

            // The read itself happened — this is about the answer line, not
            // about whether the desk did the work.
            expect(held('read')).not.toEqual([]);
            expect(held('answer')).toEqual([]);
            expect(held('outcome').filter(entry => entry.code === 'UNSUPPORTED_ACTION')).toEqual([]);
        });

        // The desk has always been required to have a stated reason before it
        // reads the signed account. This is where the reason is kept, and it is
        // the only way to tell a desk that reads when it must from one that
        // reads on every frame that arrives.
        it('states why every account read went out and what it cost', async () => {
            futuresAccountLoads();
            await connectRecordedRenderer();
            await vi.advanceTimersByTimeAsync(2_000);

            // Not awaited before the clock moves: the read this command issues
            // waits on the limiter's own spacing timer, and awaiting the command
            // first would hold the clock that has to fire it.
            const handled = moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    version: 1,
                    marketType: 'futures',
                    action: 'account.refresh',
                    accountId: 'default',
                }),
            });
            await vi.advanceTimersByTimeAsync(2_000);
            await handled;

            const reads = held('read');
            expect(reads.length).toBeGreaterThan(0);
            expect(reads).toContainEqual(expect.objectContaining({ kind: 'read', reason: 'refresh' }));
            for (const read of reads) {
                expect(FUTURES_ACCOUNT_READ_REASONS).toContain(read.reason);
                expect(Number.isSafeInteger(read.resources)).toBe(true);
                expect(Number.isSafeInteger(read.weight)).toBe(true);
            }
        });

        it('keeps a successful bracket table after a failed refresh and records only distances', async () => {
            const loads = futuresAccountLoads();
            loads.balances.mockResolvedValue({
                futures_balances: {
                    USDT: {
                        available: '280', total: '200', crossWallet: '200', crossUnPnl: '0',
                    },
                },
            });
            loads.positions.mockResolvedValue({
                futures_positions: [{
                    symbol: 'BTCUSDT',
                    positionSide: 'LONG',
                    quantity: '10',
                    entryPrice: '100',
                    isolatedWallet: '0',
                    notional: '1200',
                    initialMargin: '120',
                    // What the exchange holds against this position alone. The
                    // broader `initialMargin` beside it also carries margin held
                    // by open orders, so comparing a position estimate against it
                    // is not like for like.
                    positionInitialMargin: '120',
                    maintenanceMargin: '12',
                    liquidationPrice: '80.8080808080808',
                }],
            });
            // Echoes the contract it was asked about. Answering every request
            // with BTCUSDT's configuration hid which contract the desk was
            // actually reading, and the bracket table — stored only when its
            // symbol matches the config's — was then dropped for every contract
            // but one.
            moduleMocks.futuresAdapter.getSymbolConfig.mockImplementation(async symbol => ({
                symbol, leverage: 10, marginType: 'CROSSED', maxNotionalValue: '5000000',
            }));

            await connectRecordedRenderer();
            await vi.advanceTimersByTimeAsync(5_000);
            await flushMicrotasks();
            expect(moduleMocks.futuresAdapter.getLeverageBracketTable).toHaveBeenCalledTimes(1);

            // The public feed already exists for this held position. Its own
            // map is the calculator's mark source; no REST request is added.
            const markSocket = moduleMocks.futuresUserDataSockets.at(-1);
            markSocket.handlers.message(JSON.stringify({
                data: {
                    e: 'markPriceUpdate', E: Date.now(), s: 'BTCUSDT', p: '120',
                },
            }));
            await flushMicrotasks();

            // Expire the shared config/table clock without running unrelated
            // interval timers, then let the table refresh fail once.
            vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
            moduleMocks.futuresAdapter.getLeverageBracketTable
                .mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'EUNAVAILABLE' }));
            await runFuturesCommand({
                action: 'account.refresh', clientOrderId: 'estimate-refresh-1', symbol: 'BTCUSDT',
            });
            await flushMicrotasks();
            expect(moduleMocks.futuresAdapter.getLeverageBracketTable).toHaveBeenCalledTimes(2);

            kept.length = 0;
            await runFuturesCommand({
                action: 'account.refresh', clientOrderId: 'estimate-refresh-2', symbol: 'BTCUSDT',
            });
            await flushMicrotasks();

            // The failed refresh did not erase the table, and the fresh config
            // clock means this pass makes no third bracket request.
            expect(moduleMocks.futuresAdapter.getLeverageBracketTable).toHaveBeenCalledTimes(2);
            const estimates = held('estimate');
            expect(estimates.map(entry => entry.value).sort()).toEqual([
                'free-margin',
                'initial-margin',
                'liquidation-price',
                'maintenance-margin',
                'notional',
            ]);
            for (const estimate of estimates) {
                expect(estimate).toEqual(expect.objectContaining({
                    kind: 'estimate', compared: 1, unavailable: 0, deviationBps: 0,
                }));
                expect(Object.keys(estimate).sort()).toEqual([
                    'compared', 'deviationBps', 'kind', 'symbol', 'unavailable', 'value',
                ]);
            }
            expect(JSON.stringify(estimates)).not.toMatch(/1200|80\.808|280|entryPrice|wallet/);

            // The renderer still receives only the exchange row.
            expect(heldPositions()[0].liquidationPrice).toBe('80.8080808080808');
        });

        // Deliberately kept in *this* file, which is not the one the fix lives
        // in. The fix — a resting order is valued at the price it names, and
        // wants a mark only when it names none — sits in `futures-account-margin.js`,
        // and on 2026-08-15 that file and its own test were held uncommitted by
        // another session from before the fix. A plain `git add` there would
        // revert a live defect with every test still green, because the test that
        // guards it would be reverted in the same breath. A guard that travels
        // with the code it guards is no guard at all.
        //
        // What it guards: free margin is all-or-nothing across the account, marks
        // are followed per position, and an entry order is by definition an order
        // on a contract holding no position. Demand a mark for such an order and
        // the whole answer disappears — measured on the operator's own desk that
        // day, unavailable on sixty-eight account passes out of sixty-eight.
        it('computes free margin with an order on a contract it holds no mark for', async () => {
            const loads = futuresAccountLoads();
            loads.balances.mockResolvedValue({
                futures_balances: {
                    USDT: {
                        available: '270', total: '200', crossWallet: '200', crossUnPnl: '200',
                    },
                },
            });
            loads.positions.mockResolvedValue({
                futures_positions: [{
                    symbol: 'BTCUSDT',
                    positionSide: 'LONG',
                    quantity: '10',
                    entryPrice: '100',
                    isolatedWallet: '0',
                    notional: '1200',
                    initialMargin: '120',
                    // What the exchange holds against this position alone. The
                    // broader `initialMargin` beside it also carries margin held
                    // by open orders, so comparing a position estimate against it
                    // is not like for like.
                    positionInitialMargin: '120',
                    maintenanceMargin: '12',
                    liquidationPrice: '80.8080808080808',
                }],
            });
            // The entry order: a contract the account has an order on and no
            // position in, so the mark feed — which follows positions — never
            // subscribes to it. It names its own price, which is all the sum needs.
            loads.regularOrders.mockResolvedValue({
                futures_regular_orders: [{
                    symbol: 'SOLUSDT',
                    orderId: 4242,
                    orderKind: 'REGULAR',
                    status: 'NEW',
                    side: 'BUY',
                    origQty: '4',
                    executedQty: '0',
                    price: '25',
                    reduceOnly: false,
                }],
            });
            moduleMocks.futuresAdapter.getSymbolConfig.mockImplementation(async symbol => ({
                symbol, leverage: 10, marginType: 'CROSSED', maxNotionalValue: '5000000',
            }));

            await connectRecordedRenderer();
            await vi.advanceTimersByTimeAsync(5_000);
            await flushMicrotasks();

            // A mark for the contract holding the position, and for nothing else.
            const markSocket = moduleMocks.futuresUserDataSockets.at(-1);
            markSocket.handlers.message(JSON.stringify({
                data: {
                    e: 'markPriceUpdate', E: Date.now(), s: 'BTCUSDT', p: '120',
                },
            }));
            await flushMicrotasks();

            kept.length = 0;
            await runFuturesCommand({
                action: 'account.refresh', clientOrderId: 'free-margin-no-mark', symbol: 'BTCUSDT',
            });
            await flushMicrotasks();

            const [freeMargin] = held('estimate').filter(entry => entry.value === 'free-margin');
            // Wallet 200, unrealized 200 on the position, 120 committed by it and
            // 10 by the order — 270, which is what the exchange itself reports as
            // available. The point is `unavailable: 0`: before the fix this row
            // was the whole account's answer going missing.
            expect(freeMargin).toEqual(expect.objectContaining({
                kind: 'estimate', compared: 1, unavailable: 0, deviationBps: 0,
            }));
        });

        it('delivers an accepted account read when estimate recording fails', async () => {
            const loads = futuresAccountLoads();
            const failingRecord = {
                ...record,
                record: (kind, value) => {
                    if (kind === 'estimate') {
                        throw Object.assign(new Error('diagnostic unavailable'), {
                            code: 'EDIAGNOSTIC',
                        });
                    }
                    return record.record(kind, value);
                },
            };

            await connectRecordedRenderer('futures-live', failingRecord);
            await vi.advanceTimersByTimeAsync(5_000);
            await flushMicrotasks();

            expect(loads.balances).toHaveBeenCalled();
            expect(loads.positions).toHaveBeenCalled();
            const latest = moduleMocks.rendererConnection.sendUTF.mock.calls
                .map(([message]) => JSON.parse(message))
                .filter(payload => payload.type === 'futures_account_state')
                .at(-1);
            expect(latest.resources).toMatchObject({
                balances: { status: 'ready', lastSuccessfulAt: expect.any(Number) },
                positions: { status: 'ready', lastSuccessfulAt: expect.any(Number) },
            });
        });

        // Spot travels the same road with its own code, which the Spot client
        // nests one level deeper than Futures does.
        it('keeps the code the exchange gave for a refused Spot order', async () => {
            await connectRecordedRenderer('spot');
            moduleMocks.spotClient.restAPI.newOrder.mockRejectedValueOnce(Object.assign(
                new Error('Filter failure: MIN_NOTIONAL'),
                { status: 400, response: { data: { code: -1013 } } },
            ));

            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'trade.placeOrder',
                    version: 1,
                    marketType: 'spot',
                    accountId: 'default',
                    clientOrderId: 'spot-recorded-1',
                    symbol: 'PAXUSDT',
                    side: 'BUY',
                    orderType: 'LIMIT',
                    timeInForce: 'GTC',
                    price: '0.9990',
                    quantity: '20',
                }),
            });

            expect(held('outcome')[0]).toMatchObject({
                action: 'trade.placeOrder',
                result: 'rejected',
                market: 'spot',
                identity: 'spot-recorded-1',
                exchangeCode: '-1013',
            });
            expect(JSON.stringify(kept)).not.toMatch(/0\.9990|MIN_NOTIONAL/);
        });

        // The workspace's status line is the only place a resynchronization
        // states its cause, and it goes to the renderer over its own emitter —
        // not through the one every other payload uses.
        it('keeps the state the workspace reported for a contract', async () => {
            await connectRecordedRenderer();

            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify(createFuturesProductionWorkstationSubscribeRequest({
                    requestId: 'recorded-workstation-1',
                    symbol: 'BTCUSDT',
                    interval: '1m',
                })),
            });
            await flushMicrotasks();

            expect(held('status').length).toBeGreaterThan(0);
            expect(held('status')[0]).toMatchObject({ kind: 'status', symbol: 'BTCUSDT' });
            // The book and the tape that arrived on the same emitter are not in it.
            expect(kept.every(entry => entry.kind !== 'book' && entry.kind !== 'tape')).toBe(true);
        });

        // Four ways an attempt on the private stream ends, and one thing they
        // used to have in common: the resource is marked loading at the top of
        // the attempt, three of the four paths out leave it there with nothing
        // scheduled, and none of them writes a line. A desk that spent a session
        // without its private stream could not be asked why — the record held
        // the beat it fell back to and no reason for it.
        describe('what ends an attempt on the private stream', () => {
            // `activateMarket` clears the frames the activation itself produced,
            // and the ending of the first attempt is one of them.
            const activateFuturesKeepingEnvelopes = async () => {
                await moduleMocks.rendererHandlers.message({
                    type: 'utf8',
                    utf8Data: JSON.stringify({
                        action: 'activate_market',
                        marketMode: 'futures-live',
                    }),
                });
                await vi.advanceTimersByTimeAsync(2_000);
                await flushMicrotasks();
            };

            const userDataStreamState = () => moduleMocks.rendererConnection.sendUTF.mock.calls
                .map(([message]) => JSON.parse(message))
                .filter(payload => payload.type === 'futures_account_state')
                .at(-1)?.resources?.userDataStream;

            const streamFaults = () => held('fault')
                .filter(entry => entry.phase === 'futures-user-data');

            const listenKeyAttempts = () => moduleMocks.futuresAdapter
                .createUserDataStreamListenKey.mock.calls.length;

            it('states a listen key the exchange did not give, and asks again', async () => {
                // The answer arrived; it had no key in it. Indistinguishable
                // today from the desk deciding not to ask.
                moduleMocks.futuresAdapter.createUserDataStreamListenKey
                    .mockResolvedValue(undefined);
                await connectRecordedRenderer(null);
                await activateFuturesKeepingEnvelopes();

                expect(streamFaults()[0]).toEqual({
                    kind: 'fault',
                    phase: 'futures-user-data',
                    code: 'LISTEN_KEY_MISSING',
                });
                // Failed with the cause named, rather than left loading — and
                // named as itself, not as the desk's word for every failed read
                // there is.
                expect(userDataStreamState()).toMatchObject({
                    status: 'error',
                    error: { code: 'FUTURES_LISTEN_KEY_MISSING', retryable: true },
                });

                const asked = listenKeyAttempts();
                await vi.advanceTimersByTimeAsync(3_000);
                await flushMicrotasks();
                expect(listenKeyAttempts()).toBeGreaterThan(asked);
            });

            // The other `undefined`: the desk decided not to ask, because the
            // window closed while the request was in flight. Nobody is waiting
            // for this stream, so nothing is retried and nothing is reported —
            // but the record still says the attempt ended, because "the desk
            // stopped trying" and "the desk never tried" read identically in a
            // record that says neither.
            it('states an attempt abandoned because nobody is watching, and retries nothing', async () => {
                let answerListenKey = null;
                moduleMocks.futuresAdapter.createUserDataStreamListenKey.mockImplementation(
                    () => new Promise((resolve) => { answerListenKey = resolve; }),
                );
                await connectRecordedRenderer(null);
                await activateFuturesKeepingEnvelopes();
                expect(answerListenKey).toBeTypeOf('function');

                moduleMocks.rendererHandlers.close();
                await flushMicrotasks();
                answerListenKey('futures-listen-key');
                await vi.advanceTimersByTimeAsync(30_000);
                await flushMicrotasks();

                expect(streamFaults()).toEqual([
                    { kind: 'fault', phase: 'futures-user-data', code: 'STREAM_ABANDONED' },
                ]);
                expect(moduleMocks.futuresUserDataSockets).toHaveLength(0);
                expect(listenKeyAttempts()).toBe(1);
                // An abandonment is not the exchange refusing anything, and the
                // operator who closed the window is owed no red state for it.
                expect(userDataStreamState()?.status).not.toBe('error');
            });

            it('states a refused key and stops, because another attempt cannot grant a permission', async () => {
                moduleMocks.futuresAdapter.createUserDataStreamListenKey.mockRejectedValue(
                    Object.assign(new Error('Invalid API-key, IP, or permissions'), { code: -2015 }),
                );
                await connectRecordedRenderer(null);
                await activateFuturesKeepingEnvelopes();

                expect(streamFaults()).toEqual([
                    { kind: 'fault', phase: 'futures-user-data', code: 'LISTEN_KEY_REFUSED' },
                ]);
                expect(userDataStreamState()).toMatchObject({
                    status: 'error',
                    error: { code: 'FUTURES_PERMISSION_DENIED', retryable: false },
                });

                await vi.advanceTimersByTimeAsync(60_000);
                await flushMicrotasks();
                expect(listenKeyAttempts()).toBe(1);
            });

            // 4.3: the session that never opened the stream. Every attempt it
            // made is in the record with what ended it, and the last line says
            // the desk gave up rather than trailing off.
            it('names every ending of a session in which the stream never opened', async () => {
                // Not a network code: the limiter retries those itself, three
                // times per attempt, and this test is about the desk's own
                // bound rather than the limiter's.
                moduleMocks.futuresAdapter.createUserDataStreamListenKey.mockRejectedValue(
                    Object.assign(new Error('listen key request failed'), {
                        code: 'FUTURES_API_ERROR',
                        status: 503,
                    }),
                );
                await connectRecordedRenderer(null);
                await activateFuturesKeepingEnvelopes();
                // The bound that already existed: five retries at 3s, 6s, 9s,
                // 12s and 15s after the first attempt.
                await vi.advanceTimersByTimeAsync(60_000);
                await flushMicrotasks();

                expect(listenKeyAttempts()).toBe(6);
                // The code the failure arrived with, where the record accepts
                // it, so five identical endings are not five blanks.
                expect(streamFaults().map(entry => entry.code)).toEqual([
                    'FUTURES_API_ERROR',
                    'FUTURES_API_ERROR',
                    'FUTURES_API_ERROR',
                    'FUTURES_API_ERROR',
                    'FUTURES_API_ERROR',
                    'RECONNECT_EXHAUSTED',
                ]);
                expect(userDataStreamState().status).toBe('error');
                // Nothing else in the record claims the leg ever carried: the
                // opening is a `read` with reason `stream`, and there is none.
                expect(held('read').some(entry => entry.reason === 'stream')).toBe(false);

                // 4.2: the record keeps a fault only in its own shape and drops
                // the whole line otherwise, so a code that says what happened
                // and a code the record will refuse are the same silence. Asked
                // of the record's own reader rather than a copy of its rule.
                for (const fault of streamFaults()) {
                    expect(describeDeskDiagnosticEvent('fault', fault)).not.toBeNull();
                }

                await vi.advanceTimersByTimeAsync(60_000);
                await flushMicrotasks();
                expect(listenKeyAttempts()).toBe(6);
            });

            // §2. An open socket is not a carrying one: the route that was
            // withdrawn on 2026-04-23 answered every handshake and delivered
            // nothing for four months, and `ready` said the socket opened.
            describe('an opened socket that stops carrying', () => {
                // The measured bound: the exchange pings an idle private socket
                // every 180s, so 420s is two missed pings.
                const SILENCE_MS = 420_000;

                const openStream = async () => {
                    await connectRecordedRenderer(null);
                    await activateFuturesKeepingEnvelopes();
                    const socket = moduleMocks.futuresUserDataSockets[0];
                    expect(socket).toBeDefined();
                    socket.handlers.open();
                    await flushMicrotasks();
                    return socket;
                };

                it('stops being counted as carrying, and is rebuilt', async () => {
                    const socket = await openStream();
                    expect(userDataStreamState().status).toBe('ready');

                    await vi.advanceTimersByTimeAsync(SILENCE_MS + 1_000);
                    await flushMicrotasks();

                    // Stated as what it is. A route that stopped carrying and a
                    // socket the exchange dropped look identical to an operator
                    // who is only told "disconnected".
                    expect(streamFaults().map(entry => entry.code)).toContain('STREAM_SILENT');
                    expect(userDataStreamState()).toMatchObject({
                        status: 'stale',
                        error: { code: 'FUTURES_STREAM_NOT_CARRYING' },
                    });
                    expect(socket.close).toHaveBeenCalled();

                    // Restored on the spacing a close already used, rather than
                    // rebuilt the instant it was found dead.
                    expect(moduleMocks.futuresUserDataSockets).toHaveLength(1);
                    await vi.advanceTimersByTimeAsync(5_000);
                    await flushMicrotasks();
                    expect(moduleMocks.futuresUserDataSockets).toHaveLength(2);
                });

                // The half that makes the bound usable at all: an account with
                // nothing happening on it is correctly told nothing by the
                // account, and a rule that watched account traffic would call
                // every quiet desk dead.
                it('stays carrying through a quiet account while the exchange keeps pinging', async () => {
                    const socket = await openStream();

                    // Twenty-one minutes, three times the bound, on the
                    // exchange's own keep-alive and no account event at all.
                    for (let beat = 0; beat < 7; beat += 1) {
                        await vi.advanceTimersByTimeAsync(180_000);
                        socket.handlers.ping();
                        await flushMicrotasks();
                    }

                    expect(streamFaults()).toEqual([]);
                    expect(userDataStreamState().status).toBe('ready');
                    expect(socket.close).not.toHaveBeenCalled();
                    expect(moduleMocks.futuresUserDataSockets).toHaveLength(1);
                });

                // 2.4 is about the answer, not the timer. A command that arrives
                // after the bound has run out but before the watchdog has fired
                // is exactly the case where `ready` and `carrying` differ, and it
                // is the case that costs an account read.
                it('reads the account for a command issued while the stream is not carrying', async () => {
                    moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([
                        {
                            type: 'balances',
                            weight: 5,
                            errorLabel: 'balances',
                            loadPayload: vi.fn().mockResolvedValue({ futures_balances: [] }),
                        },
                    ]);
                    await openStream();
                    kept.length = 0;

                    // The clock moves; the timers do not. The resource still
                    // says `ready`.
                    vi.setSystemTime(new Date(Date.now() + SILENCE_MS + 1_000));
                    expect(userDataStreamState().status).toBe('ready');

                    const placement = placeFuturesOrder('not-carrying-1');
                    await vi.advanceTimersByTimeAsync(5_000);
                    await placement;
                    await flushMicrotasks();

                    expect(held('read').map(entry => entry.reason)).toContain('command');
                });

                // 5.2, and the number this change is measured by. Task 0.2 timed
                // the same window on the desk as it was: a socket that opened at
                // 14:38:23 on 2026-08-13 stayed `ready` for 26 minutes and
                // suppressed all nine command-time reads issued in it, because
                // nothing there ever ends that belief but a close.
                //
                // The same twenty-seven minutes, one command every three, on a
                // socket the exchange never says anything on.
                it('believes a dead stream for the bound and not for the session', async () => {
                    moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([
                        {
                            type: 'balances',
                            weight: 5,
                            errorLabel: 'balances',
                            loadPayload: vi.fn().mockResolvedValue({ futures_balances: [] }),
                        },
                    ]);
                    await openStream();
                    kept.length = 0;

                    const skipped = [];
                    for (let command = 1; command <= 9; command += 1) {
                        await vi.advanceTimersByTimeAsync(180_000);
                        const before = held('read').filter(entry => entry.reason === 'command').length;
                        await placeFuturesOrder(`bounded-belief-${command}`);
                        await flushMicrotasks();
                        const after = held('read').filter(entry => entry.reason === 'command').length;
                        if (after === before) skipped.push(command * 180);
                    }

                    // Two: the commands at 180s and 360s, both inside the bound.
                    // Before this change the answer was all nine, and the window
                    // had no end at all.
                    expect(skipped).toEqual([180, 360]);
                });
            });
        });
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

        it('routes one typed owner-unavailable history outcome through the workstation path', async () => {
            await connectRenderer('futures-live');

            await moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    ...createFuturesProductionWorkstationLoadCandleHistoryRequest({
                        requestId: 'workstation-history-unowned-1',
                        symbol: 'BTCUSDT',
                        interval: '1m',
                        endTime: 1_784_000_000_000,
                        limit: 1_000,
                    }),
                    generation: 1,
                }),
            });
            await flushMicrotasks();

            const outcomes = emitted().filter(payload => (
                payload.type === FUTURES_PRODUCTION_WORKSTATION_HISTORY_OUTCOME_TYPE
            ));
            expect(outcomes).toHaveLength(1);
            expect(outcomes[0]).toMatchObject({
                action: 'futures.production.workstation.load-candle-history',
                requestId: 'workstation-history-unowned-1',
                symbol: 'BTCUSDT',
                interval: '1m',
                endTime: 1_784_000_000_000,
                outcome: 'unavailable',
                reasonCode: 'CANDLE_HISTORY_OWNER_UNAVAILABLE',
            });
            expect(outcomes[0]).not.toHaveProperty('generation');
            expect(outcomes[0]).not.toHaveProperty('revision');
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

    // Account traffic and market data used to leave here down one pipe in one
    // order: "the order was filled" is a few hundred bytes and it waited behind
    // every book the renderer had not drained.
    describe('the two lanes out of the main process', () => {
        const sendWorkstationSubscribe = () => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify(createFuturesProductionWorkstationSubscribeRequest({
                requestId: 'lanes-1',
                symbol: 'BTCUSDT',
                interval: '1m',
            })),
        });

        it('delivers a command outcome ahead of the market frames already queued', async () => {
            await connectRenderer('futures-live');
            // The socket takes the frame that fills it and buffers everything
            // after — which is exactly when the lanes matter.
            moduleMocks.rendererConnection.outputBufferFull = true;
            await sendWorkstationSubscribe();
            await flushMicrotasks();
            expect(moduleMocks.rendererConnection.sendUTF.mock.calls.length).toBeGreaterThan(0);

            const queuedBefore = moduleMocks.rendererConnection.sendUTF.mock.calls.length;
            await placeFuturesOrder('lane-order-1');
            await flushMicrotasks();
            expect(moduleMocks.rendererConnection.sendUTF).toHaveBeenCalledTimes(queuedBefore);

            moduleMocks.rendererConnection.outputBufferFull = false;
            moduleMocks.rendererHandlers.drain();

            const drained = emitted().slice(queuedBefore);
            const outcome = drained.findIndex(payload => payload.futures_execution_update);
            const marketFrame = drained.findIndex(payload => (
                payload.type === FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE
            ));
            expect(outcome).toBeGreaterThanOrEqual(0);
            expect(marketFrame).toBeGreaterThanOrEqual(0);
            expect(outcome).toBeLessThan(marketFrame);
        });

        // The string measured against the byte ceiling is the string that is
        // sent. It used to be measured, thrown away, and built again on the way
        // out — 0.15 ms a frame, ten frames a second, for a number the first one
        // already knew.
        it('serializes a workstation event once', async () => {
            const stringify = vi.spyOn(JSON, 'stringify');
            try {
                await connectRenderer('futures-live');
                stringify.mockClear();
                await sendWorkstationSubscribe();
                await flushMicrotasks();

                const serializations = stringify.mock.calls.filter(([value]) => (
                    value?.type === FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE
                ));
                const delivered = emitted().filter(payload => (
                    payload.type === FUTURES_PRODUCTION_WORKSTATION_EVENT_TYPE
                ));
                expect(delivered.length).toBeGreaterThan(0);
                expect(serializations).toHaveLength(delivered.length);
            } finally {
                stringify.mockRestore();
            }
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
            const amendment = amend({ price: '2500000' });
            await vi.advanceTimersByTimeAsync(1_000);
            await amendment;

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

            const amendment = amend({ price: '2500000' });
            await vi.advanceTimersByTimeAsync(1_000);
            await amendment;

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

            // A second intent, and therefore a second identity: the same one
            // twice is a redelivery of one command, which is answered from the
            // record rather than submitted again.
            await adjust({ clientOrderId: 'margin-2' });
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
            expect(payloads.some(payload => (
                payload.command_resolved?.code === 'FUTURES_OUTCOME_RESYNCED'
            ))).toBe(false);
            expect(payloads.some(payload => payload.command_rejected)).toBe(false);
        });

        it('does not call a margin outcome resynced when a required account read fails', async () => {
            await connectRenderer();
            moduleMocks.futuresAdapter.adjustPositionMargin.mockRejectedValueOnce(
                Object.assign(new Error('socket hang up'), { status: 503, indeterminate: true }),
            );
            moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([
                {
                    type: 'positions', weight: 1, errorLabel: 'positions',
                    loadPayload: vi.fn().mockResolvedValue({ futures_positions: [] }),
                },
                {
                    type: 'balances', weight: 1, errorLabel: 'balances',
                    loadPayload: vi.fn().mockRejectedValue(new Error('balance read failed')),
                },
            ]);

            const pending = adjust({ clientOrderId: 'margin-read-failed' });
            await vi.advanceTimersByTimeAsync(2_000);
            await pending;

            const payloads = emitted();
            expect(payloads.some(payload => (
                payload.command_unresolved?.code === 'FUTURES_OUTCOME_UNKNOWN'
            ))).toBe(true);
            expect(payloads.some(payload => (
                payload.command_resolved?.code === 'FUTURES_OUTCOME_RESYNCED'
            ))).toBe(false);
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

    // The renderer's socket handler is async and `ws` does not wait for it, so
    // two frames arriving back to back used to run against Binance at the same
    // time: one command submitted twice, and an amendment and a cancellation
    // that could reach the exchange in the order they were not sent in.
    describe('one command, one submission, in the order it was accepted', () => {
        const amendFuturesOrder = (clientOrderId, overrides = {}) => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.replaceOrder',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId,
                symbol: 'BTCUSDT',
                side: 'BUY',
                orderId: '1',
                price: '49000',
                quantity: '0.01',
                ...overrides,
            }),
        });

        const cancelFuturesOrder = (clientOrderId, overrides = {}) => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.cancelOrder',
                version: 1,
                marketType: 'futures',
                accountId: 'default',
                clientOrderId,
                symbol: 'BTCUSDT',
                orderId: '1',
                ...overrides,
            }),
        });

        // A command held at the exchange, so the next one has something to
        // queue behind.
        const holdAt = (method) => {
            let release;
            const reached = [];
            moduleMocks.futuresAdapter[method].mockImplementationOnce(async (...args) => {
                reached.push(args);
                await new Promise((resolve) => { release = resolve; });
                return { e: 'executionReport', symbol: 'BTCUSDT', status: 'NEW', orderId: 1 };
            });
            return { reached, release: () => release() };
        };

        it('places one order when the same frame is delivered twice at once', async () => {
            await connectRenderer();

            await Promise.all([
                placeFuturesOrder('redelivered-1'),
                placeFuturesOrder('redelivered-1'),
            ]);

            expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
            // Both copies are answered, and with the same answer: the second may
            // have arrived on a socket that was never told the first.
            const updates = emitted().filter(payload => payload.futures_execution_update);
            expect(updates).toHaveLength(2);
            expect(updates[0]).toEqual(updates[1]);
        });

        // The registry is keyed by market, so Spot has its own record and its
        // own lanes — and the same guarantee.
        it('places one Spot order when the same frame is delivered twice at once', async () => {
            await connectRenderer('spot');
            const placeSpot = () => moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'trade.placeOrder',
                    version: 1,
                    marketType: 'spot',
                    accountId: 'default',
                    clientOrderId: 'spot-redelivered',
                    symbol: 'BTCUSDT',
                    side: 'BUY',
                    orderType: 'LIMIT',
                    timeInForce: 'GTC',
                    price: '12346',
                    quantity: '99.9',
                }),
            });

            const first = placeSpot();
            const second = placeSpot();
            // The account read that follows a Spot placement is rate-limited, so
            // the command only finishes as the clock moves.
            await vi.advanceTimersByTimeAsync(5_000);
            await Promise.all([first, second]);

            expect(moduleMocks.spotClient.restAPI.newOrder).toHaveBeenCalledOnce();
            const updates = emitted().filter(payload => payload.execution_update);
            expect(updates).toHaveLength(2);
            expect(updates[0]).toEqual(updates[1]);
        });

        it('answers a command redelivered after it finished without asking Binance again', async () => {
            await connectRenderer();

            await placeFuturesOrder('redelivered-2');
            const answer = emitted().filter(payload => payload.futures_execution_update);
            expect(answer).toHaveLength(1);

            moduleMocks.rendererConnection.sendUTF.mockClear();
            await placeFuturesOrder('redelivered-2');

            expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledOnce();
            expect(emitted()).toEqual(answer);
        });

        it('sends the amendment before the cancellation that followed it', async () => {
            await connectRenderer();
            const amendment = holdAt('modifyOrder');

            const amend = amendFuturesOrder('amend-1');
            const cancel = cancelFuturesOrder('cancel-1');
            await vi.advanceTimersByTimeAsync(1_000);
            await flushMicrotasks();

            // The cancellation was accepted and has not reached Binance: the
            // amendment it followed is still in flight.
            expect(amendment.reached).toHaveLength(1);
            expect(moduleMocks.futuresAdapter.cancelOrder).not.toHaveBeenCalled();

            amendment.release();
            await Promise.all([amend, cancel]);

            expect(moduleMocks.futuresAdapter.cancelOrder).toHaveBeenCalledOnce();
        });

        it('lets a second contract through while the first is in flight', async () => {
            await connectRenderer();
            const held = holdAt('placeOrder');

            const btc = placeFuturesOrder('lane-btc');
            const eth = moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'trade.placeOrder',
                    version: 1,
                    marketType: 'futures',
                    accountId: 'default',
                    clientOrderId: 'lane-eth',
                    symbol: 'ETHUSDT',
                    side: 'BUY',
                    orderType: 'LIMIT',
                    timeInForce: 'GTC',
                    price: '2500',
                    quantity: '0.1',
                }),
            });
            await vi.advanceTimersByTimeAsync(1_000);
            await flushMicrotasks();

            // Two contracts have nothing to say to each other; only one book is
            // ever ordered against itself.
            expect(moduleMocks.futuresAdapter.placeOrder).toHaveBeenCalledTimes(2);

            held.release();
            await Promise.all([btc, eth]);
        });

        it('keeps reading the account while a mutating command holds its lane', async () => {
            await connectRenderer();
            const held = holdAt('placeOrder');

            const place = placeFuturesOrder('lane-read');
            const refresh = moduleMocks.rendererHandlers.message({
                type: 'utf8',
                utf8Data: JSON.stringify({
                    action: 'account.symbolConfig',
                    version: 1,
                    marketType: 'futures',
                    accountId: 'default',
                    clientOrderId: 'config-1',
                    symbol: 'BTCUSDT',
                }),
            });
            // The read is spaced by the futures limiter, so it only completes as
            // the clock moves; the placement is held by the test, not the clock.
            await vi.advanceTimersByTimeAsync(5_000);

            expect(moduleMocks.futuresAdapter.getSymbolConfig).toHaveBeenCalled();

            held.release();
            await Promise.all([place, refresh]);
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

    // What the operator was waiting on. Six spot commands measured on live data
    // 2026-08-16 cost 1696, 1882, 335, 3285, 1696 and 2169ms — and the 335 is
    // the one that arrived while an account pass was already in flight, skipped
    // the wait and so measured the exchange round trip alone. These two pin
    // which reads a command holds for and which it does not.
    describe('what a spot command waits for', () => {
        // Held open from the moment it is installed, so anything that waits on
        // this read cannot answer at all. Installed only after the desk has
        // opened: the startup snapshot reads the account too, and holding that
        // one would leave a pass in flight — which is the case where even the
        // old code did not wait, and the test would prove nothing.
        const holdTheAccountRead = () => {
            let release;
            const held = new Promise((resolve) => { release = resolve; });
            moduleMocks.spotClient.restAPI.getAccount = vi.fn(async () => {
                await held;
                return { data: vi.fn().mockResolvedValue({
                    balances: [{ asset: 'USDT', free: '100', locked: '0' }],
                }) };
            });
            return release;
        };

        const openSpotDesk = async () => {
            setupBinanceConnection({
                localWebSocketAccess: { host: '127.0.0.1', port: 14477 },
            });
            moduleMocks.websocketServerHandlers.request({
                origin: 'http://localhost:5174',
                accept: vi.fn(() => moduleMocks.rendererConnection),
            });
            await activateMarket('spot');
            await flushMicrotasks();
            await vi.advanceTimersByTimeAsync(2_500);
            await flushMicrotasks();
            // The startup read has answered and nothing is left in flight.
            expect(moduleMocks.spotClient.restAPI.getAccount).toHaveBeenCalled();
            moduleMocks.rendererConnection.sendUTF.mockClear();
        };

        const placeSpotOrder = (clientOrderId) => moduleMocks.rendererHandlers.message({
            type: 'utf8',
            utf8Data: JSON.stringify({
                action: 'trade.placeOrder',
                version: 1,
                marketType: 'spot',
                accountId: 'default',
                clientOrderId,
                symbol: 'BTCUSDT',
                side: 'BUY',
                orderType: 'LIMIT',
                timeInForce: 'GTC',
                price: '12346',
                quantity: '99.9',
            }),
        });

        const sent = () => moduleMocks.rendererConnection.sendUTF.mock.calls
            .map(([message]) => JSON.parse(message));
        const balancesReached = () => sent().some(payload => payload.balances);

        // Drives time forward until the command answers, bounded so a command
        // that never answers ends the test instead of hanging it.
        const driveUntilAnswered = async (answered) => {
            for (let step = 0; step < 20 && !answered(); step += 1) {
                await vi.advanceTimersByTimeAsync(500);
                await flushMicrotasks();
            }
        };

        it('answers an accepted placement without waiting for the account read it triggers', async () => {
            await openSpotDesk();
            const releaseAccountRead = holdTheAccountRead();

            const command = placeSpotOrder('spot-place-unstated');
            let answered = false;
            void command.then(() => { answered = true; });
            await driveUntilAnswered(() => answered);

            // The command is done although the read it asked for is not.
            expect(answered).toBe(true);
            expect(moduleMocks.spotClient.restAPI.newOrder).toHaveBeenCalledOnce();
            expect(sent().filter(payload => payload.execution_update)).toHaveLength(1);

            // And the read did go out — it is simply nobody's turnstile.
            await vi.advanceTimersByTimeAsync(2_000);
            await flushMicrotasks();
            expect(moduleMocks.spotClient.restAPI.getAccount).toHaveBeenCalledOnce();
            expect(balancesReached()).toBe(false);

            releaseAccountRead();
            await vi.advanceTimersByTimeAsync(2_000);
            await flushMicrotasks();
            expect(balancesReached()).toBe(true);
            await command;
        });

        // A guard: this is what a find-and-replace over the `await` would take
        // with it. It does not fail against the tree before the change — it
        // fails against the shortcut.
        it('guards the wait after a reconciled unknown outcome, which the screen is wrong without', async () => {
            await openSpotDesk();
            const releaseAccountRead = holdTheAccountRead();
            moduleMocks.spotClient.restAPI.newOrder = vi.fn()
                .mockRejectedValue(Object.assign(new Error('gateway timed out'), {
                    indeterminate: true,
                }));
            moduleMocks.spotClient.restAPI.getOrder = vi.fn(async () => ({
                data: vi.fn().mockResolvedValue({
                    symbol: 'BTCUSDT', orderId: 41, status: 'NEW', side: 'BUY',
                }),
            }));

            const command = placeSpotOrder('spot-place-unresolved');
            let answered = false;
            void command.then(() => { answered = true; });
            await driveUntilAnswered(() => answered);

            // Binance was asked what became of the order and said it holds it,
            // so the operator is about to be released from the warning — but
            // the panel still shows the account from before the order.
            expect(moduleMocks.spotClient.restAPI.getOrder).toHaveBeenCalledOnce();
            expect(sent().some(payload => (
                payload.command_resolved?.code === 'SPOT_OUTCOME_EXECUTED'
            ))).toBe(true);
            expect(moduleMocks.spotClient.restAPI.getAccount).toHaveBeenCalledOnce();
            expect(balancesReached()).toBe(false);
            expect(answered).toBe(false);

            releaseAccountRead();
            await vi.advanceTimersByTimeAsync(2_000);
            await flushMicrotasks();
            expect(balancesReached()).toBe(true);
            expect(answered).toBe(true);
            await command;
        });
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

        it('keeps a failed history answer behind account traffic after its channel disappeared', async () => {
            vi.useFakeTimers();
            try {
                await openDetailChannel();
                moduleMocks.spotClient.restAPI.klines = vi.fn()
                    .mockRejectedValue(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));

                const pending = loadHistory();
                let historySettled = false;
                void pending.then(() => { historySettled = true; });
                await moduleMocks.rendererHandlers.message({
                    type: 'utf8',
                    utf8Data: JSON.stringify({
                        action: 'unsubscribe',
                        channelId: 'detail-BTCUSDT-1h',
                    }),
                });

                // One accepted account frame fills the socket. Everything that
                // follows is now ordered by the outbox lanes rather than by the
                // order sendUTF happened to be called in.
                moduleMocks.rendererConnection.outputBufferFull = true;
                await moduleMocks.rendererHandlers.message({
                    type: 'utf8',
                    utf8Data: JSON.stringify({ action: 'get_startup_status' }),
                });
                moduleMocks.rendererConnection.sendUTF.mockClear();

                for (let step = 0; step < 20 && !historySettled; step += 1) {
                    vi.advanceTimersByTime(1000);
                    await flushMicrotasks();
                }
                expect(historySettled).toBe(true);
                await pending;
                expect(moduleMocks.spotClient.restAPI.klines).toHaveBeenCalledWith({
                    symbol: 'BTCUSDT',
                    interval: '1h',
                    endTime: 1_699_999_999_999,
                    limit: 1000,
                });

                await moduleMocks.rendererHandlers.message({
                    type: 'utf8',
                    utf8Data: JSON.stringify({ action: 'get_startup_status' }),
                });
                moduleMocks.rendererConnection.outputBufferFull = false;
                moduleMocks.rendererHandlers.drain();

                const drained = emitted();
                const accountIndex = drained.findIndex(payload => payload.type === 'startup_status');
                const failureIndex = drained.findIndex(payload => payload.chart_history_failed);
                expect(accountIndex).toBeGreaterThanOrEqual(0);
                expect(failureIndex).toBeGreaterThanOrEqual(0);
                expect(accountIndex).toBeLessThan(failureIndex);
            } finally {
                moduleMocks.rendererConnection.outputBufferFull = false;
                vi.useRealTimers();
            }
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
        const pending = cancelAllFutures();
        await vi.advanceTimersByTimeAsync(2_000);
        await pending;

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

    it('keeps ambiguous cancel-all unresolved when either order book cannot be re-read', async () => {
        await connectRenderer();
        moduleMocks.futuresAdapter.cancelAllAlgoOrders.mockRejectedValueOnce(
            Object.assign(new Error('socket hang up'), { status: 503, indeterminate: true }),
        );
        moduleMocks.futuresAdapter.getAccountRefreshOperations.mockReturnValue([
            {
                type: 'regularOrders', weight: 1, errorLabel: 'regular orders',
                loadPayload: vi.fn().mockResolvedValue({ futures_regular_orders: [] }),
            },
            {
                type: 'algoOrders', weight: 1, errorLabel: 'algo orders',
                loadPayload: vi.fn().mockRejectedValue(new Error('algo read failed')),
            },
        ]);

        const pending = cancelAllFutures();
        await vi.advanceTimersByTimeAsync(2_000);
        await pending;

        const payloads = emitted();
        expect(payloads.some(payload => (
            payload.command_unresolved?.code === 'FUTURES_OUTCOME_UNKNOWN'
        ))).toBe(true);
        expect(payloads.some(payload => (
            payload.command_resolved?.code === 'FUTURES_OUTCOME_RESYNCED'
        ))).toBe(false);
    });

});
