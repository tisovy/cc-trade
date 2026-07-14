import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FUTURES_TESTNET_WORKSTATION_FIXTURE } from './futures-testnet-workstation-fixtures.js';
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
    FUTURES_TESTNET_WORKSTATION_REST_ORIGIN,
    FUTURES_TESTNET_WORKSTATION_ROUTES,
    FUTURES_TESTNET_WORKSTATION_WEIGHTS,
    FUTURES_TESTNET_WORKSTATION_WSS_ORIGIN,
    createFuturesTestnetWorkstationReviewedTransport,
} from './futures-testnet-workstation-transport.js';
import {
    FUTURES_PRODUCTION_WORKSTATION_REST_ORIGIN,
    FUTURES_PRODUCTION_WORKSTATION_ROUTES,
    FUTURES_PRODUCTION_WORKSTATION_WEIGHTS,
    FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN,
    createFuturesProductionWorkstationReviewedTransport,
} from './futures-production-workstation-transport.js';

const originalFetch = globalThis.fetch;

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
            'Testnet',
            createFuturesTestnetWorkstationReviewedTransport,
            FUTURES_TESTNET_WORKSTATION_REST_ORIGIN,
            FUTURES_TESTNET_WORKSTATION_FIXTURE,
        ],
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
        const result = await transport.bootstrap({
            symbol: 'BTCUSDT',
            pair: 'BTCUSDT',
            interval: '1m',
            url: 'https://attacker.invalid',
            agent: {},
        });
        expect(Object.keys(result).sort()).toEqual([
            'contractKlines',
            'depthSnapshot',
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
                .toBe('500');
        }
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
        await expect(transport.bootstrap({
            symbol: 'BTC/USDT',
            pair: 'BTCUSDT',
            interval: '1m',
        })).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
        expect(() => transport.connect({
            symbol: 'BTCUSDT',
            interval: '3m',
            onMessage: () => {},
            onDisconnect: () => {},
        })).toThrowError(expect.objectContaining({ code: 'INVALID_SELECTION' }));
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(socketMock.instances).toHaveLength(0);
    });

    it.each([
        [
            'Testnet',
            createFuturesTestnetWorkstationReviewedTransport,
            FUTURES_TESTNET_WORKSTATION_WSS_ORIGIN,
        ],
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
        });
        expect(socketMock.instances).toHaveLength(2);
        expect(socketMock.instances[0].url).toBe(
            `${origin}/public/stream?streams=btcusdt@depth@100ms`,
        );
        expect(socketMock.instances[1].url).toBe(
            `${origin}/market/stream?streams=btcusdt@aggTrade/btcusdt@kline_5m/btcusdt@markPrice@1s/btcusdt@ticker`,
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

    it.each([
        ['Testnet', createFuturesTestnetWorkstationReviewedTransport],
        ['production', createFuturesProductionWorkstationReviewedTransport],
    ])('rejects a binary %s market frame immediately', (_label, createTransport) => {
        vi.useFakeTimers();
        const disconnects = [];
        createTransport().connect({
            symbol: 'BTCUSDT',
            interval: '1m',
            onMessage: () => {},
            onDisconnect: reason => disconnects.push(reason),
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
        });
        vi.advanceTimersByTime(86_400_000);
        expect(socketMock.instances.every(socket => socket.close.mock.calls[0] === undefined
            || socket.close.mock.calls[0][1] === '24h connection rotation')).toBe(true);
    });

    it('freezes the documented route and request-weight registries', () => {
        expect(FUTURES_TESTNET_WORKSTATION_ROUTES).toEqual(FUTURES_PRODUCTION_WORKSTATION_ROUTES);
        expect(FUTURES_TESTNET_WORKSTATION_WEIGHTS).toEqual(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS);
        expect(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS).toEqual({
            EXCHANGE_INFO: 1,
            DEPTH_1000: 20,
            KLINES_500: 5,
            MARK_KLINES_500: 5,
            INDEX_KLINES_500: 5,
            PREMIUM_INDEX_SYMBOL: 1,
            TICKER_SYMBOL: 1,
        });
        expect(Object.isFrozen(FUTURES_PRODUCTION_WORKSTATION_ROUTES)).toBe(true);
    });
});
