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
    FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_CACHE_TTL_MS,
    FUTURES_PRODUCTION_WORKSTATION_REST_ORIGIN,
    FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS,
    FUTURES_PRODUCTION_WORKSTATION_ROUTES,
    FUTURES_PRODUCTION_WORKSTATION_WEIGHTS,
    FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN,
    createFuturesProductionWorkstationReviewedTransport,
} from './futures-production-workstation-transport.js';

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
            'markKlines',
            'premiumIndex',
            'ticker',
        ]);
        expect(calls).toHaveLength(7);
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
            '/fapi/v1/markPriceKlines',
            '/fapi/v1/premiumIndex',
            '/fapi/v1/ticker/24hr',
        ]);
        expect(new URL(calls.find(call => call.url.includes('/depth?')).url).searchParams.get('limit'))
            .toBe('1000');
        for (const path of ['/klines?', '/markPriceKlines?', '/indexPriceKlines?']) {
            expect(new URL(calls.find(call => call.url.includes(path)).url).searchParams.get('limit'))
                .toBe('99');
        }
    });

    it('delivers completed bootstrap resources progressively with the same five REST reads', async () => {
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
            expect(deliveries).toHaveLength(4);
        });
        expect(settled).toBe(false);
        expect(deliveries.map(delivery => delivery.resource)).not.toContain('ticker');
        expect(deliveries.every(Object.isFrozen)).toBe(true);

        resolveTicker();
        const aggregate = await pending;
        expect(Object.keys(aggregate).sort()).toEqual(
            deliveries.map(delivery => delivery.resource).sort(),
        );
        expect(new Set(deliveries.map(delivery => delivery.resource)).size).toBe(5);
        expect(globalThis.fetch).toHaveBeenCalledTimes(5);
    });

    it('reads only the three candle snapshots for an interval-only bootstrap', async () => {
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
            'markKlines',
        ]);
        expect(calls).toHaveLength(3);
        expect(calls.map(url => new URL(url).pathname).sort()).toEqual([
            '/fapi/v1/indexPriceKlines',
            '/fapi/v1/klines',
            '/fapi/v1/markPriceKlines',
        ]);
        expect(calls.every(url => new URL(url).searchParams.get('interval') === '5m')).toBe(true);
        expect(calls.some(url => /depth|premiumIndex|ticker\/24hr|exchangeInfo/.test(url)))
            .toBe(false);
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
                maxPayload: 65_536,
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
        await vi.waitFor(() => expect(calls).toHaveLength(5));
        failFirst();
        await expect(pending).rejects.toBe(failure);
        await Promise.resolve();
        expect(calls).toHaveLength(5);
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

        await vi.waitFor(() => expect(calls).toHaveLength(5));
        calls[0].stall();
        // The stalled read is retried on a fresh request while its four
        // siblings stay alive.
        await vi.waitFor(() => expect(calls).toHaveLength(6));
        expect(calls.slice(1, 5).every(call => call.signal.aborted)).toBe(false);
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

        await vi.waitFor(() => expect(calls).toHaveLength(5));
        resolveFirst();
        await expect(pending).rejects.toBe(observerFailure);
        await Promise.resolve();
        expect(observer).toHaveBeenCalledOnce();
        expect(calls).toHaveLength(5);
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
            === 'cache,durationMs,outcome,phase')).toBe(true);
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
            outcome: 'error',
            cache: null,
        });
        expect(timings[0].durationMs).toBeGreaterThanOrEqual(0);
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
        expect(timings.at(-2)).toMatchObject({ cache: 'hit', outcome: 'error' });
        expect(timings.at(-1)).toMatchObject({ cache: 'hit', outcome: 'ok' });
    });

    it('refreshes exchange-info after the bounded production cache TTL', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
        globalThis.fetch = vi.fn(async url => responseFor(
            url.href,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ));
        const transport = createFuturesProductionWorkstationReviewedTransport();

        await transport.loadExchangeInfo();
        await transport.loadExchangeInfo();
        expect(globalThis.fetch).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(
            FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_CACHE_TTL_MS + 1,
        );
        await transport.loadExchangeInfo();
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
        vi.advanceTimersByTime(86_400_000);
        expect(socketMock.instances.every(socket => socket.close.mock.calls[0] === undefined
            || socket.close.mock.calls[0][1] === '24h connection rotation')).toBe(true);
    });

    it('freezes the documented route and request-weight registries', () => {
        expect(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS).toEqual({
            EXCHANGE_INFO: 1,
            DEPTH_1000: 20,
            KLINES_99: 1,
            MARK_KLINES_99: 1,
            INDEX_KLINES_99: 1,
            PREMIUM_INDEX_SYMBOL: 1,
            TICKER_SYMBOL: 1,
        });
        expect(Object.values(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS)
            .reduce((total, weight) => total + weight, 0)).toBe(26);
        expect(Object.entries(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS)
            .filter(([name]) => name !== 'EXCHANGE_INFO')
            .reduce((total, [, weight]) => total + weight, 0)).toBe(25);
        expect(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS).toEqual({
            DEPTH: 1_000,
            KLINES: 99,
        });
        expect(Object.isFrozen(FUTURES_PRODUCTION_WORKSTATION_ROUTES)).toBe(true);
        expect(Object.isFrozen(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS)).toBe(true);
        expect(FUTURES_PRODUCTION_WORKSTATION_BOOTSTRAP_CONCURRENCY).toBe(6);
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
