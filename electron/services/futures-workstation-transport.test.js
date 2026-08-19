import { EventEmitter } from 'node:events';
import https from 'node:https';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FUTURES_PRODUCTION_WORKSTATION_FIXTURE } from './futures-production-workstation-fixtures.js';

const socketMock = vi.hoisted(() => ({ instances: [] }));

vi.mock('ws', () => {
    class FakeWebSocket {
        constructor(url, options) {
            this.url = url;
            this.options = options;
            this.listeners = new Map();
            this.close = vi.fn();
            this.removeAllListeners = vi.fn(() => this.listeners.clear());
            socketMock.instances.push(this);
        }

        on(name, callback) {
            this.listeners.set(name, callback);
        }

        once(name, callback) {
            this.listeners.set(name, callback);
        }

        emit(name, ...args) {
            this.listeners.get(name)?.(...args);
        }
    }
    return { default: FakeWebSocket };
});

import {
    FUTURES_PRODUCTION_WORKSTATION_BOOTSTRAP_CONCURRENCY,
    FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES,
    FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_CACHE_TTL_MS,
    FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_STALE_SERVE_MS,
    FUTURES_PRODUCTION_WORKSTATION_READ_BUDGET,
    FUTURES_PRODUCTION_WORKSTATION_REST_ORIGIN,
    FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS,
    FUTURES_PRODUCTION_WORKSTATION_ROUTES,
    FUTURES_PRODUCTION_WORKSTATION_SILENCE,
    FUTURES_PRODUCTION_WORKSTATION_WEIGHTS,
    FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN,
    createFuturesProductionWorkstationReviewedTransport,
} from './futures-production-workstation-transport.js';
import {
    FUTURES_WORKSTATION_CANDLE_HISTORY_LIMITS,
} from '../../src/utils/futuresWorkstationProtocolShared.js';

const originalFetch = globalThis.fetch;
const PROXY_ENVIRONMENT_KEYS = Object.freeze([
    'https_proxy',
    'HTTPS_PROXY',
    'http_proxy',
    'HTTP_PROXY',
]);
const originalProxyEnvironment = Object.freeze(Object.fromEntries(
    PROXY_ENVIRONMENT_KEYS.map(key => [key, process.env[key]]),
));
for (const key of PROXY_ENVIRONMENT_KEYS) delete process.env[key];

const restoreProxyEnvironment = () => {
    for (const key of PROXY_ENVIRONMENT_KEYS) {
        const original = originalProxyEnvironment[key];
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
    }
};

afterAll(restoreProxyEnvironment);

const responseFor = (url, fixture, overrides = {}) => {
    const parsed = new URL(url);
    let text;
    if (parsed.pathname === '/fapi/v1/exchangeInfo') text = fixture.catalog;
    else {
        const symbol = parsed.searchParams.get('symbol') ?? parsed.searchParams.get('pair');
        const selected = fixture.symbols[symbol];
        if (parsed.pathname === '/fapi/v1/depth') text = selected.depthSnapshot;
        else if (parsed.pathname === '/fapi/v1/klines') text = selected.contractKlines;
        else if (parsed.pathname === '/fapi/v1/markPriceKlines') text = selected.markKlines;
        else if (parsed.pathname === '/fapi/v1/indexPriceKlines') text = selected.indexKlines;
        else if (parsed.pathname === '/fapi/v1/premiumIndex') text = selected.premiumIndex;
        else if (parsed.pathname === '/fapi/v1/ticker/24hr') text = selected.ticker;
    }
    return {
        url,
        redirected: false,
        status: 200,
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => text,
        ...overrides,
    };
};

const installProxyRequest = ({
    body,
    statusCode = 200,
    headers = { 'content-type': 'application/json' },
} = {}) => {
    const calls = [];
    vi.spyOn(https, 'request').mockImplementation((url, options, onResponse) => {
        const request = new EventEmitter();
        const response = new EventEmitter();
        response.statusCode = statusCode;
        response.headers = headers;
        response.resume = vi.fn();
        response.destroy = vi.fn();
        request.end = vi.fn(() => {
            onResponse(response);
            queueMicrotask(() => {
                if (statusCode !== 200) return;
                response.emit('data', Buffer.from(body));
                response.emit('end');
            });
        });
        calls.push({ url, options, request, response });
        return request;
    });
    return calls;
};

const MARK_FRAME = Buffer.from('{"stream":"btcusdt@markPrice@1s","data":{}}');
const TRADE_FRAME = Buffer.from('{"stream":"btcusdt@aggTrade","data":{}}');
const DEPTH_FRAME = Buffer.from('{"stream":"btcusdt@depth@100ms","data":{}}');

// A connection only reaches its 24-hour rotation by having delivered for 24
// hours. Silence now ends one long before that, so time advanced against these
// transports has to carry traffic with it or the test is describing a dead feed
// rather than a live one.
const advanceWithTraffic = (totalMs, stepMs = 10_000) => {
    for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
        vi.advanceTimersByTime(stepMs);
        for (const socket of socketMock.instances) socket.emit('message', MARK_FRAME, false);
    }
};

beforeEach(() => {
    socketMock.instances.length = 0;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('reviewed environment-specific Futures workstation transports', () => {
    it.each([
        [
            'production',
            createFuturesProductionWorkstationReviewedTransport,
            FUTURES_PRODUCTION_WORKSTATION_REST_ORIGIN,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ],
    ])('pins every %s REST bootstrap request and rejects caller options', async (
        _label,
        createTransport,
        origin,
        fixture,
    ) => {
        const calls = [];
        globalThis.fetch = vi.fn(async (url, options) => {
            calls.push({ url: url.href, options });
            return responseFor(url.href, fixture);
        });
        const transport = createTransport();
        await transport.loadExchangeInfo({
            url: 'https://attacker.invalid',
            headers: { authorization: 'forbidden' },
            proxy: 'http://attacker.invalid',
        });
        const result = await transport.bootstrapIndependent({
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            interval: '1m',
            url: 'https://attacker.invalid',
            agent: {},
        });
        const depthSnapshot = await transport.readDepthSnapshot({
            symbol: 'BTCUSDT',
            url: 'https://attacker.invalid',
            agent: {},
        });
        expect(depthSnapshot).toBe(fixture.symbols.BTCUSDT.depthSnapshot);
        expect(Object.keys(result).sort()).toEqual([
            'contractKlines',
            'indexKlines',
            'premiumIndex',
            'ticker',
        ]);
        expect(calls).toHaveLength(6);
        expect(calls.every(call => new URL(call.url).origin === origin)).toBe(true);
        expect(calls.every(call => call.options.method === 'GET')).toBe(true);
        expect(calls.every(call => call.options.redirect === 'error')).toBe(true);
        expect(calls.every(call => Object.keys(call.options).sort().join(',') === 'method,redirect,signal'))
            .toBe(true);
        expect(calls.map(call => new URL(call.url).pathname).sort()).toEqual([
            '/fapi/v1/depth',
            '/fapi/v1/exchangeInfo',
            '/fapi/v1/indexPriceKlines',
            '/fapi/v1/klines',
            '/fapi/v1/premiumIndex',
            '/fapi/v1/ticker/24hr',
        ]);
        expect(new URL(calls.find(call => call.url.includes('/depth?')).url).searchParams.get('limit'))
            .toBe('1000');
        for (const path of ['/klines?', '/indexPriceKlines?']) {
            expect(new URL(calls.find(call => call.url.includes(path)).url).searchParams.get('limit'))
                .toBe('99');
        }
    });

    it('delivers completed bootstrap resources progressively with the same four REST reads', async () => {
        const deliveries = [];
        let resolveTicker;
        globalThis.fetch = vi.fn((url) => {
            if (url.pathname === FUTURES_PRODUCTION_WORKSTATION_ROUTES.TICKER) {
                return new Promise((resolve) => {
                    resolveTicker = () => resolve(responseFor(
                        url.href,
                        FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
                    ));
                });
            }
            return Promise.resolve(responseFor(
                url.href,
                FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
            ));
        });
        let settled = false;
        const pending = createFuturesProductionWorkstationReviewedTransport().bootstrapIndependent({
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            interval: '1m',
            onBootstrapResource: delivery => deliveries.push(delivery),
        });
        void pending.finally(() => { settled = true; });

        await vi.waitFor(() => {
            expect(resolveTicker).toBeTypeOf('function');
            expect(deliveries).toHaveLength(3);
        });
        expect(settled).toBe(false);
        expect(deliveries.map(delivery => delivery.resource)).not.toContain('ticker');
        expect(deliveries.every(Object.isFrozen)).toBe(true);

        resolveTicker();
        const aggregate = await pending;
        expect(Object.keys(aggregate).sort()).toEqual(
            deliveries.map(delivery => delivery.resource).sort(),
        );
        expect(new Set(deliveries.map(delivery => delivery.resource)).size).toBe(4);
        expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    });

    it('reads only the two visible candle snapshots for an interval-only bootstrap', async () => {
        const calls = [];
        globalThis.fetch = vi.fn(async (url) => {
            calls.push(url.href);
            return responseFor(url.href, FUTURES_PRODUCTION_WORKSTATION_FIXTURE);
        });
        const result = await createFuturesProductionWorkstationReviewedTransport()
            .bootstrapInterval({
                symbol: 'BTCUSDT',
                pair: 'BTCUSDT',
                interval: '5m',
            });

        expect(Object.keys(result).sort()).toEqual([
            'contractKlines',
            'indexKlines',
        ]);
        expect(calls).toHaveLength(2);
        expect(calls.map(url => new URL(url).pathname).sort()).toEqual([
            '/fapi/v1/indexPriceKlines',
            '/fapi/v1/klines',
        ]);
        expect(calls.every(url => new URL(url).searchParams.get('interval') === '5m')).toBe(true);
        expect(calls.some(url => /depth|premiumIndex|ticker\/24hr|exchangeInfo/.test(url)))
            .toBe(false);
    });

    it('routes weekly bootstrap, history and live candles while refusing an unreviewed interval', async () => {
        vi.useFakeTimers();
        const calls = [];
        globalThis.fetch = vi.fn(async (url) => {
            calls.push(url.href);
            return responseFor(url.href, FUTURES_PRODUCTION_WORKSTATION_FIXTURE);
        });
        const transport = createFuturesProductionWorkstationReviewedTransport();

        await transport.bootstrapInterval({
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            interval: '1w',
        });
        await transport.readCandleHistory({
            symbol: 'BTCUSDT',
            interval: '1w',
            endTime: 1_784_000_000_000,
            limit: 1_000,
        });
        const connection = transport.connect({
            symbol: 'BTCUSDT',
            interval: '1w',
            onMessage: () => {},
            onDisconnect: () => {},
            onCandleDisconnect: () => {},
        });

        const candleReads = calls.map(url => new URL(url)).filter(url => (
            url.pathname === '/fapi/v1/klines'
            || url.pathname === '/fapi/v1/indexPriceKlines'
        ));
        expect(candleReads).toHaveLength(3);
        expect(candleReads.every(url => url.searchParams.get('interval') === '1w')).toBe(true);
        expect(candleReads.find(url => url.searchParams.get('limit') === '1000')
            ?.searchParams.get('endTime')).toBe('1783999999999');
        expect(socketMock.instances[2].url).toBe(
            `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/market/stream?streams=btcusdt@kline_1w`,
        );

        globalThis.fetch.mockClear();
        await expect(transport.readCandleHistory({
            symbol: 'BTCUSDT',
            interval: '3m',
            endTime: 1_784_000_000_000,
            limit: 1_000,
        })).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
        expect(globalThis.fetch).not.toHaveBeenCalled();
        connection.close();
        transport.close();
    });

    it('accepts bounded Unicode identities only on the public workstation transport', async () => {
        const symbol = '测试测试USDT';
        globalThis.fetch = vi.fn();
        const transport = createFuturesProductionWorkstationReviewedTransport();
        const controller = new AbortController();
        controller.abort();

        await expect(transport.bootstrapIndependent({
            symbol,
            pair: symbol,
            interval: '1m',
            signal: controller.signal,
        })).rejects.toMatchObject({ code: 'READ_OPERATION_ABORTED' });
        expect(globalThis.fetch).not.toHaveBeenCalled();

        const connection = transport.connect({
            symbol,
            interval: '1m',
            onMessage: () => {},
            onDisconnect: () => {},
            onCandleDisconnect: () => {},
        });
        const lower = symbol.toLowerCase();
        expect(socketMock.instances.map(socket => socket.url)).toEqual([
            `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/public/stream?streams=${lower}@depth@100ms`,
            `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/market/stream?streams=${lower}@aggTrade/${lower}@markPrice@1s/${lower}@ticker`,
            `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/market/stream?streams=${lower}@kline_1m`,
        ]);
        connection.close();
        transport.close();
    });

    it.each([
        ['redirect flag', { redirected: true }, 'REDIRECT_REJECTED'],
        ['alternate final URL', { url: 'https://example.com/fapi/v1/exchangeInfo' }, 'REDIRECT_REJECTED'],
        ['HTTP failure', { status: 503, ok: false }, 'HTTP_REJECTED'],
        ['wrong content type', { headers: new Headers({ 'content-type': 'text/html' }) }, 'INVALID_CONTENT_TYPE'],
    ])('fails closed on production %s', async (_label, overrides, code) => {
        globalThis.fetch = vi.fn(async url => responseFor(
            url.href,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
            overrides,
        ));
        const transport = createFuturesProductionWorkstationReviewedTransport();
        await expect(transport.loadExchangeInfo()).rejects.toMatchObject({ code });
    });

    it('rejects alternate symbols and intervals before network or socket creation', async () => {
        globalThis.fetch = vi.fn();
        const transport = createFuturesProductionWorkstationReviewedTransport();
        await expect(transport.bootstrapIndependent({
            symbol: 'BTC/USDT',
            pair: 'BTCUSDT',
            interval: '1m',
        })).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
        await expect(transport.readDepthSnapshot({
            symbol: 'BTC/USDT',
        })).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
        expect(() => transport.connect({
            symbol: 'BTCUSDT',
            interval: '3m',
            onMessage: () => {},
            onDisconnect: () => {},
            onCandleDisconnect: () => {},
        })).toThrowError(expect.objectContaining({ code: 'INVALID_SELECTION' }));
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(socketMock.instances).toHaveLength(0);
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationReviewedTransport,
            FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN,
        ],
    ])('constructs exact routed %s WSS paths with fixed options', (_label, createTransport, origin) => {
        vi.useFakeTimers();
        const frames = [];
        const disconnects = [];
        const transport = createTransport();
        const connection = transport.connect({
            symbol: 'BTCUSDT',
            interval: '5m',
            host: 'wss://attacker.invalid',
            followRedirects: true,
            onMessage: frame => frames.push(frame),
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
        });
        expect(socketMock.instances).toHaveLength(3);
        expect(socketMock.instances[0].url).toBe(
            `${origin}/public/stream?streams=btcusdt@depth@100ms`,
        );
        expect(socketMock.instances[1].url).toBe(
            `${origin}/market/stream?streams=btcusdt@aggTrade/btcusdt@markPrice@1s/btcusdt@ticker`,
        );
        expect(socketMock.instances[2].url).toBe(
            `${origin}/market/stream?streams=btcusdt@kline_5m`,
        );
        for (const socket of socketMock.instances) {
            expect(socket.options).toEqual({
                followRedirects: false,
                handshakeTimeout: 10_000,
                maxPayload: 516_096,
                perMessageDeflate: false,
            });
        }
        socketMock.instances[0].emit('message', Buffer.from('{"stream":"x","data":{}}'), false);
        expect(frames).toEqual(['{"stream":"x","data":{}}']);
        socketMock.instances[1].emit('error', new Error('failure'));
        expect(disconnects).toEqual(['SOCKET_ERROR']);
        connection.close();
        expect(socketMock.instances.every(socket => socket.close.mock.calls.length === 1)).toBe(true);
    });

    // `ws` answers `close()` on a connection still in its handshake by raising
    // "WebSocket was closed before the connection was established". With the
    // listeners already removed nothing was listening, so the throw travelled out
    // of the abort listener and out of the teardown that called it — and the
    // teardown then skipped closing the other streams. One contract switch during
    // a handshake left the previous contract alive on the desk.
    it('closes a connection still in its handshake without raising', () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const transport = createFuturesProductionWorkstationReviewedTransport();
        const connection = transport.connect({
            symbol: 'BTCUSDT',
            interval: '5m',
            onMessage: () => {},
            onDisconnect: () => {},
            onCandleDisconnect: () => {},
            signal: controller.signal,
        });
        for (const socket of socketMock.instances) {
            socket.close = vi.fn(() => {
                throw new Error('WebSocket was closed before the connection was established');
            });
        }

        expect(() => controller.abort()).not.toThrow();
        // Every socket was still closed: the first failure cannot skip the rest.
        expect(socketMock.instances).toHaveLength(3);
        expect(socketMock.instances.every(socket => socket.close.mock.calls.length === 1)).toBe(true);
        expect(() => connection.close()).not.toThrow();
        vi.useRealTimers();
    });

    it('replaces only the official kline stream and rejects superseded interval sockets', async () => {
        vi.useFakeTimers();
        const frames = [];
        const candleDisconnects = [];
        const transport = createFuturesProductionWorkstationReviewedTransport();
        const connection = transport.connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: frame => frames.push(frame),
            onDisconnect: () => {},
            onCandleDisconnect: reason => candleDisconnects.push(reason),
        });
        socketMock.instances.slice(0, 3).forEach(socket => socket.emit('open'));
        await expect(connection.ready).resolves.toBe(true);
        const persistentSockets = socketMock.instances.slice(0, 2);
        const originalCandleSocket = socketMock.instances[2];

        const selected5m = connection.selectInterval({ interval: '5m' });
        expect(socketMock.instances).toHaveLength(4);
        expect(socketMock.instances[3].url).toBe(
            `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/market/stream?streams=btcusdt@kline_5m`,
        );
        expect(persistentSockets.every(socket => socket.close.mock.calls.length === 0)).toBe(true);
        expect(originalCandleSocket.close).toHaveBeenCalledOnce();
        socketMock.instances[3].emit('open');
        await expect(selected5m).resolves.toBe(true);

        const selected15m = connection.selectInterval({ interval: '15m' });
        const supersededSocket = socketMock.instances[4];
        const selected1h = connection.selectInterval({ interval: '1h' });
        const currentSocket = socketMock.instances[5];
        expect(supersededSocket.url).toBe(
            `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/market/stream?streams=btcusdt@kline_15m`,
        );
        expect(currentSocket.url).toBe(
            `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/market/stream?streams=btcusdt@kline_1h`,
        );
        await expect(selected15m).resolves.toBe(false);
        supersededSocket.emit('message', Buffer.from('stale'), false);
        expect(frames).toEqual([]);
        currentSocket.emit('open');
        await expect(selected1h).resolves.toBe(true);
        expect(persistentSockets.every(socket => socket.close.mock.calls.length === 0)).toBe(true);

        currentSocket.emit('close');
        currentSocket.emit('error', new Error('late duplicate'));
        expect(candleDisconnects).toEqual(['SOCKET_CLOSED']);
        expect(persistentSockets.every(socket => socket.close.mock.calls.length === 0)).toBe(true);

        const failed4h = connection.selectInterval({ interval: '4h' });
        const failedSocket = socketMock.instances[6];
        failedSocket.emit('error', new Error('candle handshake failed'));
        failedSocket.emit('close');
        await expect(failed4h).resolves.toBe(false);
        expect(candleDisconnects).toEqual(['SOCKET_CLOSED', 'SOCKET_ERROR']);
        expect(persistentSockets.every(socket => socket.close.mock.calls.length === 0)).toBe(true);

        connection.close();
        transport.close();
    });

    it.each([
        ['production', createFuturesProductionWorkstationReviewedTransport],
    ])('holds the %s connection readiness barrier until all three routed sockets open', async (
        _label,
        createTransport,
    ) => {
        vi.useFakeTimers();
        const connection = createTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: () => {},
            onCandleDisconnect: () => {},
        });
        let settled = false;
        void connection.ready.then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        socketMock.instances[0].emit('open');
        await Promise.resolve();
        expect(settled).toBe(false);
        socketMock.instances[1].emit('open');
        await Promise.resolve();
        expect(settled).toBe(false);
        socketMock.instances[2].emit('open');
        await expect(connection.ready).resolves.toBe(true);
        connection.close();
    });

    it.each([
        ['production', createFuturesProductionWorkstationReviewedTransport],
    ])('fails the %s readiness barrier closed when a socket errors before open', async (
        _label,
        createTransport,
    ) => {
        vi.useFakeTimers();
        const connection = createTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: () => {},
            onCandleDisconnect: () => {},
        });
        socketMock.instances[0].emit('error', new Error('handshake failed'));
        socketMock.instances[1].emit('open');
        socketMock.instances[2].emit('open');
        await expect(connection.ready).resolves.toBe(false);
        connection.close();
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationReviewedTransport,
            FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN,
        ],
    ])('constructs exact %s WSS paths for a dated delivery contract', (
        _label,
        createTransport,
        origin,
    ) => {
        vi.useFakeTimers();
        const connection = createTransport().connect({
            symbol: 'BTCUSDT_260925',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: () => {},
            onCandleDisconnect: () => {},
        });
        expect(socketMock.instances.map(socket => socket.url)).toEqual([
            `${origin}/public/stream?streams=btcusdt_260925@depth@100ms`,
            `${origin}/market/stream?streams=btcusdt_260925@aggTrade/btcusdt_260925@markPrice@1s/btcusdt_260925@ticker`,
            `${origin}/market/stream?streams=btcusdt_260925@kline_1m`,
        ]);
        connection.close();
    });

    it.each([
        ['production', createFuturesProductionWorkstationReviewedTransport],
    ])('rejects a delivery-shaped %s pair before REST dispatch', async (_label, createTransport) => {
        globalThis.fetch = vi.fn();
        await expect(createTransport().bootstrapIndependent({
            symbol: 'BTCUSDT_260925',
            pair: 'BTCUSDT_260925',
            interval: '1m',
        })).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationReviewedTransport,
            FUTURES_PRODUCTION_WORKSTATION_REST_ORIGIN,
            FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ],
    ])('routes %s REST and WSS through one backend-owned proxy agent', async (
        _label,
        createTransport,
        restOrigin,
        wssOrigin,
        fixture,
    ) => {
        process.env.https_proxy = 'http://127.0.0.1:1080';
        try {
            globalThis.fetch = vi.fn();
            const proxyCalls = installProxyRequest({ body: fixture.catalog });
            const transport = createTransport();
            await transport.loadExchangeInfo({
                proxy: 'http://attacker.invalid',
                dispatcher: {},
                agent: {},
            });
            const connection = transport.connect({
                symbol: 'BTCUSDT',
                interval: '1m',
                proxy: 'http://attacker.invalid',
                agent: {},
                onMessage: () => {},
                onDisconnect: () => {},
                onCandleDisconnect: () => {},
            });
            expect(globalThis.fetch).not.toHaveBeenCalled();
            expect(proxyCalls).toHaveLength(1);
            expect(proxyCalls[0].url.href).toBe(`${restOrigin}/fapi/v1/exchangeInfo`);
            expect(proxyCalls[0].options).toMatchObject({
                method: 'GET',
                maxHeaderSize: 16_384,
            });
            expect(proxyCalls[0].options.agent).toBeTruthy();
            expect(proxyCalls[0].options.agent).toMatchObject({
                keepAlive: true,
                maxSockets: 8,
                maxFreeSockets: 2,
            });
            expect(proxyCalls[0].options.signal).toBeInstanceOf(AbortSignal);
            expect(socketMock.instances).toHaveLength(3);
            expect(socketMock.instances.every(socket => new URL(socket.url).origin === wssOrigin))
                .toBe(true);
            expect(socketMock.instances.every(
                socket => socket.options.agent === proxyCalls[0].options.agent,
            )).toBe(true);
            expect(JSON.stringify(transport)).not.toContain('127.0.0.1');
            const destroy = vi.spyOn(proxyCalls[0].options.agent, 'destroy');
            connection.close();
            transport.close();
            expect(destroy).toHaveBeenCalledOnce();
        } finally {
            delete process.env.https_proxy;
        }
    });

    it.each([
        ['production', createFuturesProductionWorkstationReviewedTransport],
    ])('maps a %s REST deadline to an explicit terminal code', async (_label, createTransport) => {
        vi.useFakeTimers();
        globalThis.fetch = vi.fn((_url, { signal }) => new Promise((resolve, reject) => {
            const abort = () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            };
            if (signal.aborted) abort();
            else signal.addEventListener('abort', abort, { once: true });
        }));
        const pending = createTransport().loadExchangeInfo();
        const result = pending.catch(error => error);
        await vi.advanceTimersByTimeAsync(10_000);
        await expect(result).resolves.toMatchObject({ code: 'REQUEST_DEADLINE_EXCEEDED' });
    });

    it('keeps production bootstrap REST bounded and aborts sibling reads after failure', async () => {
        const failure = new Error('first bootstrap request failed');
        const calls = [];
        let failFirst;
        globalThis.fetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
            const call = { url: url.href, signal };
            calls.push(call);
            const abort = () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            };
            signal.addEventListener('abort', abort, { once: true });
            if (calls.length === 1) failFirst = () => reject(failure);
        }));
        const pending = createFuturesProductionWorkstationReviewedTransport().bootstrapIndependent({
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            interval: '1m',
        });
        await vi.waitFor(() => expect(calls).toHaveLength(4));
        failFirst();
        await expect(pending).rejects.toBe(failure);
        await Promise.resolve();
        expect(calls).toHaveLength(4);
        expect(calls.slice(1).every(call => call.signal.aborted)).toBe(true);
    });

    it('retries a stalled bootstrap read on a fresh connection before failing the batch', async () => {
        const stall = new Error('read ECONNRESET: network socket stalled');
        const calls = [];
        globalThis.fetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
            calls.push({
                url,
                signal,
                succeed: () => resolve(responseFor(url.href, FUTURES_PRODUCTION_WORKSTATION_FIXTURE)),
                stall: () => reject(stall),
            });
            const abort = () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            };
            signal.addEventListener('abort', abort, { once: true });
        }));
        const timings = [];
        const pending = createFuturesProductionWorkstationReviewedTransport({
            onTiming: timing => timings.push(timing),
        }).bootstrapIndependent({
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            interval: '1m',
        });

        await vi.waitFor(() => expect(calls).toHaveLength(4));
        calls[0].stall();
        // The stalled read is retried on a fresh request while its three
        // siblings stay alive.
        await vi.waitFor(() => expect(calls).toHaveLength(5));
        expect(calls.slice(1, 4).every(call => call.signal.aborted)).toBe(false);
        for (const call of calls.slice(1)) call.succeed();
        await expect(pending).resolves.toBeTruthy();
        expect(timings.some(timing => (
            timing.phase.endsWith('-retry') && timing.outcome === 'ok'
        ))).toBe(true);
    });

    it('aborts active and queued reads when a progressive resource observer rejects data', async () => {
        const observerFailure = new Error('bootstrap normalizer rejected data');
        const calls = [];
        let resolveFirst;
        globalThis.fetch = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
            calls.push({ url, signal });
            const abort = () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            };
            signal.addEventListener('abort', abort, { once: true });
            if (calls.length === 1) {
                resolveFirst = () => resolve(responseFor(
                    url.href,
                    FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
                ));
            }
        }));
        const observer = vi.fn(() => { throw observerFailure; });
        const pending = createFuturesProductionWorkstationReviewedTransport().bootstrapIndependent({
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            interval: '1m',
            onBootstrapResource: observer,
        });

        await vi.waitFor(() => expect(calls).toHaveLength(4));
        resolveFirst();
        await expect(pending).rejects.toBe(observerFailure);
        await Promise.resolve();
        expect(observer).toHaveBeenCalledOnce();
        expect(calls).toHaveLength(4);
        expect(calls[0].signal.aborted).toBe(false);
        expect(calls.slice(1).every(call => call.signal.aborted)).toBe(true);
    });

    it('deduplicates concurrent exchange-info reads and serves the warm production cache', async () => {
        const timings = [];
        globalThis.fetch = vi.fn(async url => responseFor(
            url.href,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ));
        const firstTransport = createFuturesProductionWorkstationReviewedTransport({
            onTiming: timing => timings.push(timing),
        });
        const secondTransport = createFuturesProductionWorkstationReviewedTransport({
            onTiming: timing => timings.push(timing),
        });

        const [first, shared] = await Promise.all([
            firstTransport.loadExchangeInfo(),
            secondTransport.loadExchangeInfo(),
        ]);
        const warm = await firstTransport.loadExchangeInfo();

        expect(first).toBe(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        expect(shared).toBe(first);
        expect(warm).toBe(first);
        expect(globalThis.fetch).toHaveBeenCalledOnce();
        expect(timings.map(timing => timing.cache).sort()).toEqual(['hit', 'miss', 'shared']);
        expect(timings.every(timing => Object.keys(timing).sort().join(',')
            === 'cache,code,durationMs,outcome,phase')).toBe(true);
        // Three reads that answered: none of them states a reason for failing.
        expect(timings.every(timing => timing.code === null)).toBe(true);
    });

    it('does not dispatch exchange-info for an already-aborted caller', async () => {
        const timings = [];
        globalThis.fetch = vi.fn(async url => responseFor(
            url.href,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ));
        const transport = createFuturesProductionWorkstationReviewedTransport({
            onTiming: timing => timings.push(timing),
        });
        const controller = new AbortController();
        controller.abort();

        await expect(transport.loadExchangeInfo({ signal: controller.signal }))
            .rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(timings).toHaveLength(1);
        expect(timings[0]).toMatchObject({
            phase: 'exchange-info',
            outcome: 'aborted',
            cache: null,
            code: 'REQUEST_ABORTED',
        });
        expect(timings[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    // The desk failed one exchange-info read on nearly every start for the six
    // days the record keeps, always in three to six milliseconds — far too fast
    // to be a round trip that failed, and the line would not say what refused.
    // There are three ways to end that fast and each now names itself.
    describe('why an exchange-info read ended in milliseconds', () => {
        it('records a superseded caller as aborted and lets its replacement succeed', async () => {
            const timings = [];
            let releaseFetch = null;
            globalThis.fetch = vi.fn(async url => new Promise((resolve) => {
                releaseFetch = () => resolve(responseFor(
                    url.href,
                    FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
                ));
            }));
            const transport = createFuturesProductionWorkstationReviewedTransport({
                onTiming: timing => timings.push(timing),
            });
            const controller = new AbortController();

            const pending = transport.loadExchangeInfo({ signal: controller.signal });
            await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
            controller.abort();
            const retry = transport.loadExchangeInfo();

            await expect(pending).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
            expect(timings[0]).toMatchObject({
                phase: 'exchange-info',
                outcome: 'aborted',
                cache: 'miss',
                code: 'REQUEST_ABORTED',
            });
            releaseFetch?.();
            await expect(retry).resolves.toBe(
                FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog,
            );
            expect(globalThis.fetch).toHaveBeenCalledOnce();
            expect(timings.at(-1)).toMatchObject({
                phase: 'exchange-info',
                outcome: 'ok',
                cache: 'shared',
                code: null,
            });
        });

        it('states the reason the read failed on the wire', async () => {
            const timings = [];
            globalThis.fetch = vi.fn().mockRejectedValue(
                Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1080'), {
                    code: 'ECONNREFUSED',
                }),
            );
            const transport = createFuturesProductionWorkstationReviewedTransport({
                onTiming: timing => timings.push(timing),
            });

            await expect(transport.loadExchangeInfo()).rejects.toMatchObject({
                code: 'ECONNREFUSED',
            });
            expect(timings.at(-1)).toMatchObject({
                phase: 'exchange-info',
                outcome: 'error',
                cache: 'miss',
                code: 'ECONNREFUSED',
            });
        });

        // This one used to leave no line at all: the read that never happened
        // was also the read nothing recorded.
        it('leaves a line when the read refused before it was issued', async () => {
            process.env.https_proxy = 'ftp://127.0.0.1:1080';
            try {
                const timings = [];
                globalThis.fetch = vi.fn();
                const transport = createFuturesProductionWorkstationReviewedTransport({
                    onTiming: timing => timings.push(timing),
                });

                await expect(transport.loadExchangeInfo()).rejects.toMatchObject({
                    code: 'INVALID_PROXY_CONFIGURATION',
                });
                expect(globalThis.fetch).not.toHaveBeenCalled();
                expect(timings).toEqual([expect.objectContaining({
                    phase: 'exchange-info',
                    outcome: 'error',
                    cache: null,
                    code: 'INVALID_PROXY_CONFIGURATION',
                })]);
            } finally {
                delete process.env.https_proxy;
            }
        });
    });

    it('reports a warm-cache caller abort without invalidating the shared value', async () => {
        const timings = [];
        globalThis.fetch = vi.fn(async url => responseFor(
            url.href,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ));
        const transport = createFuturesProductionWorkstationReviewedTransport({
            onTiming: timing => timings.push(timing),
        });
        await transport.loadExchangeInfo();
        const controller = new AbortController();
        const aborted = transport.loadExchangeInfo({ signal: controller.signal });
        controller.abort();

        await expect(aborted).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
        await expect(transport.loadExchangeInfo()).resolves.toBe(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog,
        );
        expect(globalThis.fetch).toHaveBeenCalledOnce();
        expect(timings.at(-2)).toMatchObject({ cache: 'hit', outcome: 'aborted' });
        expect(timings.at(-1)).toMatchObject({ cache: 'hit', outcome: 'ok' });
    });

    it('serves the bounded-stale catalog instantly and revalidates in the background', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
        globalThis.fetch = vi.fn(async url => responseFor(
            url.href,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ));
        const timings = [];
        const transport = createFuturesProductionWorkstationReviewedTransport({
            onTiming: timing => timings.push(timing),
        });

        await transport.loadExchangeInfo();
        await transport.loadExchangeInfo();
        expect(globalThis.fetch).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(
            FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_CACHE_TTL_MS + 1,
        );
        await transport.loadExchangeInfo();
        expect(timings.at(-1)).toMatchObject({ cache: 'stale', outcome: 'ok' });
        await vi.runAllTimersAsync();
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);

        // The background refresh restored a fresh TTL window.
        await transport.loadExchangeInfo();
        expect(timings.at(-1)).toMatchObject({ cache: 'hit', outcome: 'ok' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('blocks on a fresh catalog once the stale-serve bound is exceeded', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
        globalThis.fetch = vi.fn(async url => responseFor(
            url.href,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ));
        const timings = [];
        const transport = createFuturesProductionWorkstationReviewedTransport({
            onTiming: timing => timings.push(timing),
        });

        await transport.loadExchangeInfo();
        await vi.advanceTimersByTimeAsync(
            FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_CACHE_TTL_MS
            + FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_STALE_SERVE_MS
            + 1,
        );
        await transport.loadExchangeInfo();
        expect(timings.at(-1)).toMatchObject({ cache: 'miss', outcome: 'ok' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['production', createFuturesProductionWorkstationReviewedTransport],
    ])('fails closed before any %s dispatch when the backend proxy is invalid', async (
        _label,
        createTransport,
    ) => {
        process.env.https_proxy = 'ftp://127.0.0.1:1080';
        try {
            globalThis.fetch = vi.fn();
            const transport = createTransport();
            await expect(transport.loadExchangeInfo()).rejects.toMatchObject({
                code: 'INVALID_PROXY_CONFIGURATION',
            });
            expect(() => transport.connect({
                symbol: 'BTCUSDT',
                interval: '1m',
                onMessage: () => {},
                onDisconnect: () => {},
                onCandleDisconnect: () => {},
            })).toThrowError(expect.objectContaining({ code: 'INVALID_PROXY_CONFIGURATION' }));
            expect(globalThis.fetch).not.toHaveBeenCalled();
            expect(socketMock.instances).toHaveLength(0);
        } finally {
            delete process.env.https_proxy;
        }
    });

    it('rejects redirects and oversized bodies on the production proxy path', async () => {
        process.env.https_proxy = 'http://127.0.0.1:1080';
        try {
            globalThis.fetch = vi.fn();
            installProxyRequest({ body: '', statusCode: 302, headers: { location: 'https://example.com' } });
            await expect(createFuturesProductionWorkstationReviewedTransport().loadExchangeInfo())
                .rejects.toMatchObject({ code: 'REDIRECT_REJECTED' });

            vi.restoreAllMocks();
            installProxyRequest({ body: 'x'.repeat((2 * 1024 * 1024) + 1) });
            await expect(createFuturesProductionWorkstationReviewedTransport().loadExchangeInfo())
                .rejects.toMatchObject({ code: 'RESPONSE_BODY_TOO_LARGE' });
        } finally {
            delete process.env.https_proxy;
        }
    });

    it.each([
        ['production', createFuturesProductionWorkstationReviewedTransport],
    ])('rejects a binary %s market frame immediately', (_label, createTransport) => {
        vi.useFakeTimers();
        const disconnects = [];
        createTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
        });
        socketMock.instances[1].emit('message', Buffer.from([0xff]), true);
        expect(disconnects).toEqual(['BINARY_FRAME_REJECTED']);
        expect(socketMock.instances[1].close)
            .toHaveBeenCalledWith(1003, 'binary frame rejected');
    });

    // The market is what makes a frame big. Hanging up over one took depth,
    // tape, header and candles away at the moment they were needed most; the
    // frame is dropped instead, and the refusal is named to the session so the
    // desk can state it rather than going quiet about it.
    it('drops an oversized market frame and names the refusal rather than hanging up', () => {
        vi.useFakeTimers();
        const messages = [];
        const disconnects = [];
        const refusals = [];
        const timings = [];
        createFuturesProductionWorkstationReviewedTransport({
            onTiming: timing => timings.push(timing),
        }).connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: raw => messages.push(raw),
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
            onFrameRefused: reason => refusals.push(reason),
        });
        const oversized = `{"stream":"btcusdt@depth","data":"${'x'.repeat(516_096)}"}`;
        socketMock.instances[0].emit('message', Buffer.from(oversized), false);

        expect(messages).toEqual([]);
        expect(disconnects).toEqual([]);
        expect(refusals).toEqual(['STREAM_FRAME_REFUSED']);
        expect(socketMock.instances[0].close).not.toHaveBeenCalled();
        expect(timings.map(timing => timing.phase))
            .toContain(`oversized-frame:${Buffer.byteLength(oversized, 'utf8')}`);
    });

    // Two endings that used to read the same. Only one of them is the exchange.
    it('separates a connection the exchange dropped from one the desk retired', () => {
        vi.useFakeTimers();
        const disconnects = [];
        createFuturesProductionWorkstationReviewedTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
        });
        socketMock.instances[0].emit('close');
        advanceWithTraffic(86_400_000);
        socketMock.instances[1].emit('close');

        expect(disconnects).toEqual(['SOCKET_CLOSED', 'CONNECTION_ROTATED']);
    });

    it('closes a reviewed WSS connection at the fixed 24-hour lifetime', () => {
        vi.useFakeTimers();
        const transport = createFuturesProductionWorkstationReviewedTransport();
        transport.connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: () => {},
            onCandleDisconnect: () => {},
        });
        advanceWithTraffic(86_400_000);
        expect(socketMock.instances.every(socket => socket.close.mock.calls[0] === undefined
            || socket.close.mock.calls[0][1] === '24h connection rotation')).toBe(true);
    });

    // The failure this desk has already been bitten by: a route that answers the
    // handshake and then says nothing raises no error and never closes, so every
    // recovery that hangs off `close` is never entered. `@markPrice@1s` arrives
    // every second whether or not the contract trades — 418 frames in 420
    // seconds on a contract that printed one trade in the whole run — so
    // fifteen seconds without one is a feed that stopped delivering.
    it('treats a market stream that stops delivering as a disconnection', () => {
        vi.useFakeTimers();
        const disconnects = [];
        createFuturesProductionWorkstationReviewedTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
        });
        socketMock.instances[1].emit('open');
        vi.advanceTimersByTime(16_000);

        expect(disconnects).toEqual(['STREAM_SILENT_15S']);
        expect(socketMock.instances[1].close)
            .toHaveBeenCalledWith(1000, 'stream went silent');
    });

    // Guard. Passes against the transport before the watchdog existed, because
    // it asserts an absence; it is here so a bound set too tight cannot land
    // unnoticed.
    it('leaves a market stream that keeps delivering alone', () => {
        vi.useFakeTimers();
        const disconnects = [];
        createFuturesProductionWorkstationReviewedTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
        });
        for (let elapsed = 0; elapsed < 120_000; elapsed += 10_000) {
            vi.advanceTimersByTime(10_000);
            socketMock.instances[1].emit('message', MARK_FRAME, false);
        }

        expect(disconnects).toEqual([]);
    });

    // Depth on a thin contract went 12.8 seconds between frames while perfectly
    // alive, so a frame bound tight enough to be useful there would fire on a
    // market that is merely quiet. What is left is the exchange's own ping —
    // measured at 180.0s on both routes — and two missed ones end the socket.
    it('keeps a quiet stream alive on the exchange ping and ends one that stops pinging', () => {
        vi.useFakeTimers();
        const disconnects = [];
        const candleDisconnects = [];
        createFuturesProductionWorkstationReviewedTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: reason => candleDisconnects.push(reason),
        });
        const [publicSocket, marketSocket, candleSocket] = socketMock.instances;
        for (let elapsed = 0; elapsed < 1_200_000; elapsed += 10_000) {
            vi.advanceTimersByTime(10_000);
            marketSocket.emit('message', MARK_FRAME, false);
            if (elapsed % 180_000 === 0) {
                publicSocket.emit('ping');
                candleSocket.emit('ping');
            }
        }
        expect(disconnects).toEqual([]);
        expect(candleDisconnects).toEqual([]);

        for (let elapsed = 0; elapsed < 410_000; elapsed += 10_000) {
            vi.advanceTimersByTime(10_000);
            marketSocket.emit('message', MARK_FRAME, false);
        }

        // Every socket is held to this bound, and each one reports it down its
        // own path — the candle stream has a separate recovery from the rest.
        expect(disconnects).toEqual(['STREAM_INACTIVE_400S']);
        expect(candleDisconnects).toEqual(['STREAM_INACTIVE_400S']);
    });

    // Depth rides `/public` and the tape rides `/market` — two routes the
    // exchange serves separately and can retire separately. A trade printing
    // against the book is a change to the book, and the longest depth silence
    // measured through a print was 1.2 seconds on BTCUSDT.
    it('ends a book that says nothing while its own tape prints', () => {
        vi.useFakeTimers();
        const disconnects = [];
        createFuturesProductionWorkstationReviewedTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
        });
        const [publicSocket, marketSocket] = socketMock.instances;
        publicSocket.emit('message', DEPTH_FRAME, false);
        for (let elapsed = 0; elapsed < 40_000; elapsed += 5_000) {
            vi.advanceTimersByTime(5_000);
            marketSocket.emit('message', MARK_FRAME, false);
            marketSocket.emit('message', TRADE_FRAME, false);
        }

        expect(disconnects).toEqual(['BOOK_SILENT_THROUGH_TRADES_30S']);
        expect(publicSocket.close).toHaveBeenCalled();
    });

    // The witness is a record of what arrived, not a clock reading. Seeded with
    // one it claimed a trade had printed when none had — and the sockets of one
    // connection finish their handshakes milliseconds apart, so that claim could
    // outlive the book's own last frame and resynchronize the desk over a book
    // that was merely quiet.
    it('does not accuse a quiet book when no trade has printed at all', () => {
        vi.useFakeTimers();
        const disconnects = [];
        createFuturesProductionWorkstationReviewedTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
        });
        const [publicSocket, marketSocket] = socketMock.instances;
        publicSocket.emit('open');
        // The tape's socket finishes its handshake after the book's did.
        vi.advanceTimersByTime(200);
        marketSocket.emit('open');
        for (let elapsed = 0; elapsed < 60_000; elapsed += 5_000) {
            vi.advanceTimersByTime(5_000);
            marketSocket.emit('message', MARK_FRAME, false);
        }

        expect(disconnects).toEqual([]);
    });

    // Two routes going down together is one outage. Blaming the book for it as
    // well would resynchronize twice and name the wrong cause once.
    it('does not blame the book when the tape has stopped as well', () => {
        vi.useFakeTimers();
        const disconnects = [];
        createFuturesProductionWorkstationReviewedTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
        });
        const [publicSocket, marketSocket] = socketMock.instances;
        publicSocket.emit('message', DEPTH_FRAME, false);
        marketSocket.emit('message', TRADE_FRAME, false);
        vi.advanceTimersByTime(40_000);

        expect(disconnects).toEqual(['STREAM_SILENT_15S']);
    });

    // Guard. Both quiet is a quiet market, not a dead route, and the connection's
    // own traffic is what answers for it.
    it('says nothing about a book whose tape is not printing either', () => {
        vi.useFakeTimers();
        const disconnects = [];
        createFuturesProductionWorkstationReviewedTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
        });
        const marketSocket = socketMock.instances[1];
        for (let elapsed = 0; elapsed < 40_000; elapsed += 5_000) {
            vi.advanceTimersByTime(5_000);
            marketSocket.emit('message', MARK_FRAME, false);
        }

        expect(disconnects).toEqual([]);
    });

    // Guard. A released generation's watchdog reporting a disconnection would
    // resynchronize a session that no longer exists.
    it('reports nothing from the watchdogs of a released connection', () => {
        vi.useFakeTimers();
        const disconnects = [];
        const connection = createFuturesProductionWorkstationReviewedTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
            onCandleDisconnect: () => {},
        });
        connection.close();
        vi.advanceTimersByTime(500_000);

        expect(disconnects).toEqual([]);
    });

    it('freezes the measured silence bounds', () => {
        expect(FUTURES_PRODUCTION_WORKSTATION_SILENCE).toEqual({
            CADENCE_MS: 15_000,
            INACTIVITY_MS: 400_000,
            BOOK_THROUGH_TRADES_MS: 30_000,
            CHECK_MS: 1_000,
        });
        expect(Object.isFrozen(FUTURES_PRODUCTION_WORKSTATION_SILENCE)).toBe(true);
    });

    it('freezes the documented route and request-weight registries', () => {
        expect(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS).toEqual({
            EXCHANGE_INFO: 1,
            DEPTH_50: 2,
            DEPTH_100: 5,
            DEPTH_500: 10,
            DEPTH_1000: 20,
            KLINES_99: 1,
            KLINES_1000: 5,
            INDEX_KLINES_99: 1,
            PREMIUM_INDEX_SYMBOL: 1,
            TICKER_SYMBOL: 1,
        });
        // One contract switch at the cheapest page against one at the deepest.
        const switchAt = depth => depth + FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.KLINES_99
            + FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.INDEX_KLINES_99
            + FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.PREMIUM_INDEX_SYMBOL
            + FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.TICKER_SYMBOL;
        expect(switchAt(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.DEPTH_50)).toBe(6);
        expect(switchAt(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.DEPTH_1000)).toBe(24);
        // The ladder is read from the cheapest rung, and every rung is a page
        // the exchange actually prices — an unlisted limit is answered at the
        // next page up and charged for it.
        expect(FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES.map(page => [page.limit, page.weight]))
            .toEqual([[50, 2], [100, 5], [500, 10], [1_000, 20]]);
        expect(FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES.at(-1).limit)
            .toBe(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.DEPTH);
        expect(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS).toEqual({
            DEPTH: 1_000,
            KLINES: 99,
            CANDLE_HISTORY: 1_000,
        });
        // The transport's page bound and the protocol's must not drift apart.
        expect(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.CANDLE_HISTORY)
            .toBe(FUTURES_WORKSTATION_CANDLE_HISTORY_LIMITS.MAX_ROWS);
        expect(Object.isFrozen(FUTURES_PRODUCTION_WORKSTATION_ROUTES)).toBe(true);
        expect(Object.isFrozen(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS)).toBe(true);
        expect(FUTURES_PRODUCTION_WORKSTATION_BOOTSTRAP_CONCURRENCY).toBe(5);
    });

    // The ceiling is sized against what the desk costs. At 120 the operator ran
    // out of it by switching contracts five times in a minute.
    it('budgets a window against what a contract switch costs', () => {
        const {
            DEPTH_1000,
            KLINES_99,
            INDEX_KLINES_99,
            PREMIUM_INDEX_SYMBOL,
            TICKER_SYMBOL,
        } = FUTURES_PRODUCTION_WORKSTATION_WEIGHTS;
        // One switch: the book, the two candle series, the funding and the day.
        const contractSwitch = DEPTH_1000 + KLINES_99 + INDEX_KLINES_99
            + PREMIUM_INDEX_SYMBOL + TICKER_SYMBOL;
        expect(contractSwitch).toBe(24);
        expect(FUTURES_PRODUCTION_WORKSTATION_READ_BUDGET.WINDOW_MS).toBe(60_000);
        expect(Math.floor(
            FUTURES_PRODUCTION_WORKSTATION_READ_BUDGET.MAXIMUM_WEIGHT / contractSwitch,
        )).toBeGreaterThanOrEqual(20);
        // Binance answers USDⓈ-M public reads against 2400 weight a minute per
        // address; the account reader claims at most 800 of it. Both readers at
        // their ceilings must still leave the exchange's minute unspent.
        expect(FUTURES_PRODUCTION_WORKSTATION_READ_BUDGET.MAXIMUM_WEIGHT + 800)
            .toBeLessThan(2_400);
        expect(Object.isFrozen(FUTURES_PRODUCTION_WORKSTATION_READ_BUDGET)).toBe(true);
    });

    it('reports depth snapshot reads with a distinct retry phase', async () => {
        const timings = [];
        globalThis.fetch = vi.fn(async url => responseFor(
            url.href,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ));
        const transport = createFuturesProductionWorkstationReviewedTransport({
            onTiming: timing => timings.push(timing),
        });
        await transport.readDepthSnapshot({ symbol: 'BTCUSDT' });
        await transport.readDepthSnapshot({ symbol: 'BTCUSDT', retryAttempt: 1 });
        expect(timings.map(timing => timing.phase)).toEqual(['depth', 'depth-retry']);
        expect(timings.every(timing => timing.outcome === 'ok')).toBe(true);
        const depthCalls = globalThis.fetch.mock.calls.map(([url]) => new URL(url.href));
        expect(depthCalls.every(url => url.pathname === '/fapi/v1/depth'
            && url.searchParams.get('limit') === '1000')).toBe(true);
    });
});
