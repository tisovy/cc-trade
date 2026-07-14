import WebSocket from 'ws';
import {
    FUTURES_WORKSTATION_BODY_LIMITS,
    FUTURES_WORKSTATION_JSON_LIMITS,
    readFuturesWorkstationResponseBody,
    validateFuturesWorkstationResponseHeaders,
} from './futures-workstation-json.js';
import { FuturesWorkstationReadBudget } from './futures-workstation-read-budget.js';

export const FUTURES_PRODUCTION_WORKSTATION_REST_ORIGIN = 'https://fapi.binance.com';
export const FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN = 'wss://fstream.binance.com';

export const FUTURES_PRODUCTION_WORKSTATION_ROUTES = Object.freeze({
    EXCHANGE_INFO: '/fapi/v1/exchangeInfo',
    DEPTH: '/fapi/v1/depth',
    KLINES: '/fapi/v1/klines',
    MARK_KLINES: '/fapi/v1/markPriceKlines',
    INDEX_KLINES: '/fapi/v1/indexPriceKlines',
    PREMIUM_INDEX: '/fapi/v1/premiumIndex',
    TICKER: '/fapi/v1/ticker/24hr',
});

export const FUTURES_PRODUCTION_WORKSTATION_WEIGHTS = Object.freeze({
    EXCHANGE_INFO: 1,
    DEPTH_1000: 20,
    KLINES_500: 5,
    MARK_KLINES_500: 5,
    INDEX_KLINES_500: 5,
    PREMIUM_INDEX_SYMBOL: 1,
    TICKER_SYMBOL: 1,
});

const ROUTE_SET = new Set(Object.values(FUTURES_PRODUCTION_WORKSTATION_ROUTES));
const PUBLIC_READ_BUDGET = new FuturesWorkstationReadBudget();
const SYMBOL_PATTERN = /^[A-Z0-9]{1,20}$/;
const INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);

export class FuturesProductionWorkstationTransportError extends Error {
    constructor(code) {
        super('Futures production workstation transport failed');
        this.name = 'FuturesProductionWorkstationTransportError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesProductionWorkstationTransportError(code);
};

const assertSelection = (symbol, interval) => {
    if (!SYMBOL_PATTERN.test(symbol) || !INTERVALS.has(interval)) fail('INVALID_SELECTION');
};

const withDeadline = (parentSignal, timeoutMs = 10_000) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    parentSignal?.addEventListener?.('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    timer.unref?.();
    return Object.freeze({
        signal: controller.signal,
        release: () => {
            clearTimeout(timer);
            parentSignal?.removeEventListener?.('abort', abort);
        },
    });
};

const buildUrl = (pathname, parameters = {}) => {
    if (!ROUTE_SET.has(pathname)) fail('UNREVIEWED_ROUTE');
    const url = new URL(pathname, FUTURES_PRODUCTION_WORKSTATION_REST_ORIGIN);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    if (url.origin !== FUTURES_PRODUCTION_WORKSTATION_REST_ORIGIN || url.pathname !== pathname) {
        fail('ORIGIN_ESCAPE');
    }
    return url;
};

const publicGet = async (pathname, parameters, bodyLimit, parentSignal) => {
    const url = buildUrl(pathname, parameters);
    const deadline = withDeadline(parentSignal);
    try {
        const response = await globalThis.fetch(url, {
            method: 'GET',
            redirect: 'error',
            signal: deadline.signal,
        });
        if (response?.redirected === true || response?.url !== url.href) fail('REDIRECT_REJECTED');
        if (response?.status !== 200 || response?.ok !== true) fail('HTTP_REJECTED');
        validateFuturesWorkstationResponseHeaders(response.headers);
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().startsWith('application/json')) fail('INVALID_CONTENT_TYPE');
        return await readFuturesWorkstationResponseBody(response, bodyLimit, deadline.signal);
    } finally {
        deadline.release();
    }
};

const weightedGet = (weight, pathname, parameters, bodyLimit, signal) => (
    PUBLIC_READ_BUDGET.execute(
        weight,
        () => publicGet(pathname, parameters, bodyLimit, signal),
        { signal },
    )
);

const createSocket = (url, onMessage, onDisconnect) => {
    const parsed = new URL(url);
    if (parsed.origin !== FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN
        || !['/public/stream', '/market/stream'].includes(parsed.pathname)) {
        fail('WSS_ORIGIN_ESCAPE');
    }
    const socket = new WebSocket(url, {
        followRedirects: false,
        handshakeTimeout: 10_000,
        maxPayload: FUTURES_WORKSTATION_JSON_LIMITS.WS_FRAME_BYTES,
        perMessageDeflate: false,
    });
    let closed = false;
    const lifetime = setTimeout(() => socket.close(1000, '24h connection rotation'), 86_400_000);
    lifetime.unref?.();
    socket.on('message', (data, isBinary) => {
        if (closed) return;
        if (isBinary) {
            closed = true;
            clearTimeout(lifetime);
            onDisconnect('BINARY_FRAME_REJECTED');
            socket.close(1003, 'binary frame rejected');
            return;
        }
        const raw = typeof data === 'string' ? data : data.toString('utf8');
        if (Buffer.byteLength(raw, 'utf8') > FUTURES_WORKSTATION_JSON_LIMITS.WS_FRAME_BYTES) {
            socket.close(1009, 'frame too large');
            return;
        }
        onMessage(raw);
    });
    socket.once('close', () => {
        if (closed) return;
        closed = true;
        clearTimeout(lifetime);
        onDisconnect('SOCKET_CLOSED');
    });
    socket.once('error', () => {
        if (!closed) onDisconnect('SOCKET_ERROR');
    });
    return Object.freeze({
        close: () => {
            if (closed) return;
            closed = true;
            clearTimeout(lifetime);
            socket.removeAllListeners();
            socket.close(1000, 'generation teardown');
        },
    });
};

export const createFuturesProductionWorkstationReviewedTransport = () => Object.freeze({
    kind: 'reviewed-production-public-read',
    now: () => Date.now(),
    loadExchangeInfo: ({ signal } = {}) => weightedGet(
        FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.EXCHANGE_INFO,
        FUTURES_PRODUCTION_WORKSTATION_ROUTES.EXCHANGE_INFO,
        {},
        FUTURES_WORKSTATION_BODY_LIMITS.EXCHANGE_INFO,
        signal,
    ),
    bootstrap: async ({ symbol, pair, interval, signal } = {}) => {
        assertSelection(symbol, interval);
        if (!SYMBOL_PATTERN.test(pair)) fail('INVALID_SELECTION');
        const [
            depthSnapshot,
            contractKlines,
            markKlines,
            indexKlines,
            premiumIndex,
            ticker,
        ] = await Promise.all([
            weightedGet(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.DEPTH_1000, FUTURES_PRODUCTION_WORKSTATION_ROUTES.DEPTH, { symbol, limit: '1000' }, FUTURES_WORKSTATION_BODY_LIMITS.DEPTH, signal),
            weightedGet(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.KLINES_500, FUTURES_PRODUCTION_WORKSTATION_ROUTES.KLINES, { symbol, interval, limit: '500' }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES, signal),
            weightedGet(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.MARK_KLINES_500, FUTURES_PRODUCTION_WORKSTATION_ROUTES.MARK_KLINES, { symbol, interval, limit: '500' }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES, signal),
            weightedGet(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.INDEX_KLINES_500, FUTURES_PRODUCTION_WORKSTATION_ROUTES.INDEX_KLINES, { pair, interval, limit: '500' }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES, signal),
            weightedGet(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.PREMIUM_INDEX_SYMBOL, FUTURES_PRODUCTION_WORKSTATION_ROUTES.PREMIUM_INDEX, { symbol }, FUTURES_WORKSTATION_BODY_LIMITS.HEADER, signal),
            weightedGet(FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.TICKER_SYMBOL, FUTURES_PRODUCTION_WORKSTATION_ROUTES.TICKER, { symbol }, FUTURES_WORKSTATION_BODY_LIMITS.HEADER, signal),
        ]);
        return Object.freeze({ depthSnapshot, contractKlines, markKlines, indexKlines, premiumIndex, ticker });
    },
    connect: ({ symbol, interval, onMessage, onDisconnect, signal } = {}) => {
        assertSelection(symbol, interval);
        if (typeof onMessage !== 'function' || typeof onDisconnect !== 'function') fail('INVALID_SUBSCRIBER');
        const lower = symbol.toLowerCase();
        const publicUrl = `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/public/stream?streams=${lower}@depth@100ms`;
        const marketUrl = `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/market/stream?streams=${[
            `${lower}@aggTrade`,
            `${lower}@kline_${interval}`,
            `${lower}@markPrice@1s`,
            `${lower}@ticker`,
        ].join('/')}`;
        const publicSocket = createSocket(publicUrl, onMessage, onDisconnect);
        const marketSocket = createSocket(marketUrl, onMessage, onDisconnect);
        const close = () => {
            publicSocket.close();
            marketSocket.close();
        };
        signal?.addEventListener?.('abort', close, { once: true });
        return Object.freeze({
            close: () => {
                signal?.removeEventListener?.('abort', close);
                close();
            },
        });
    },
    close: () => {},
});
