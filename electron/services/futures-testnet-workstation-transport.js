import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import WebSocket from 'ws';
import {
    FUTURES_WORKSTATION_BODY_LIMITS,
    FUTURES_WORKSTATION_JSON_LIMITS,
    readFuturesWorkstationResponseBody,
    validateFuturesWorkstationResponseHeaders,
} from './futures-workstation-json.js';
import { FuturesWorkstationReadBudget } from './futures-workstation-read-budget.js';

export const FUTURES_TESTNET_WORKSTATION_REST_ORIGIN = 'https://demo-fapi.binance.com';
export const FUTURES_TESTNET_WORKSTATION_WSS_ORIGIN = 'wss://demo-fstream.binance.com';

export const FUTURES_TESTNET_WORKSTATION_ROUTES = Object.freeze({
    EXCHANGE_INFO: '/fapi/v1/exchangeInfo',
    DEPTH: '/fapi/v1/depth',
    KLINES: '/fapi/v1/klines',
    MARK_KLINES: '/fapi/v1/markPriceKlines',
    INDEX_KLINES: '/fapi/v1/indexPriceKlines',
    PREMIUM_INDEX: '/fapi/v1/premiumIndex',
    TICKER: '/fapi/v1/ticker/24hr',
});

export const FUTURES_TESTNET_WORKSTATION_WEIGHTS = Object.freeze({
    EXCHANGE_INFO: 1,
    DEPTH_1000: 20,
    KLINES_500: 5,
    MARK_KLINES_500: 5,
    INDEX_KLINES_500: 5,
    PREMIUM_INDEX_SYMBOL: 1,
    TICKER_SYMBOL: 1,
});

const ROUTE_SET = new Set(Object.values(FUTURES_TESTNET_WORKSTATION_ROUTES));
const PUBLIC_READ_BUDGET = new FuturesWorkstationReadBudget();
const SYMBOL_PATTERN = /^(?:[A-Z0-9]{1,20}|[A-Z0-9]{1,13}_[0-9]{6})$/;
const PAIR_PATTERN = /^[A-Z0-9]{1,20}$/;
const INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);

export class FuturesTestnetWorkstationTransportError extends Error {
    constructor(code) {
        super('Futures Testnet workstation transport failed');
        this.name = 'FuturesTestnetWorkstationTransportError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesTestnetWorkstationTransportError(code);
};

const resolveTestnetBackendProxy = () => {
    const proxyUrl = process.env.https_proxy
        || process.env.HTTPS_PROXY
        || process.env.http_proxy
        || process.env.HTTP_PROXY;
    if (!proxyUrl) return Object.freeze({ proxyAgent: null, errorCode: null });
    try {
        const parsed = new URL(proxyUrl);
        if (!PROXY_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) {
            return Object.freeze({ proxyAgent: null, errorCode: 'INVALID_PROXY_CONFIGURATION' });
        }
        const agent = parsed.protocol.startsWith('socks')
            ? new SocksProxyAgent(proxyUrl, { keepAlive: false })
            : new HttpsProxyAgent(proxyUrl, { keepAlive: false });
        return Object.freeze({ proxyAgent: agent, errorCode: null });
    } catch {
        return Object.freeze({ proxyAgent: null, errorCode: 'INVALID_PROXY_CONFIGURATION' });
    }
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
    const url = new URL(pathname, FUTURES_TESTNET_WORKSTATION_REST_ORIGIN);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    if (url.origin !== FUTURES_TESTNET_WORKSTATION_REST_ORIGIN || url.pathname !== pathname) {
        fail('ORIGIN_ESCAPE');
    }
    return url;
};

const readTestnetProxyResponseBody = (response, bodyLimit) => new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
    };
    response.on('data', (chunk) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.byteLength;
        if (total > bodyLimit) {
            response.destroy();
            rejectOnce(new FuturesTestnetWorkstationTransportError('RESPONSE_BODY_TOO_LARGE'));
            return;
        }
        chunks.push(bytes);
    });
    response.once('aborted', () => {
        rejectOnce(new FuturesTestnetWorkstationTransportError('RESPONSE_ABORTED'));
    });
    response.once('error', rejectOnce);
    response.once('end', () => {
        if (settled) return;
        try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
            settled = true;
            resolve(text);
        } catch {
            rejectOnce(new FuturesTestnetWorkstationTransportError('INVALID_JSON_ENCODING'));
        }
    });
});

const publicGetThroughTestnetProxy = (url, bodyLimit, signal, proxyAgent) => new Promise((resolve, reject) => {
    const request = https.request(url, {
        method: 'GET',
        agent: proxyAgent,
        signal,
        maxHeaderSize: FUTURES_WORKSTATION_JSON_LIMITS.HEADER_AGGREGATE_BYTES,
    }, (response) => {
        try {
            if (response.statusCode >= 300 && response.statusCode < 400) fail('REDIRECT_REJECTED');
            if (response.statusCode !== 200) fail('HTTP_REJECTED');
            const headers = new Headers(response.headers);
            validateFuturesWorkstationResponseHeaders(headers);
            const contentType = headers.get('content-type') ?? '';
            if (!contentType.toLowerCase().startsWith('application/json')) fail('INVALID_CONTENT_TYPE');
        } catch (error) {
            response.resume();
            reject(error);
            return;
        }
        readTestnetProxyResponseBody(response, bodyLimit).then(resolve, reject);
    });
    request.once('error', reject);
    request.end();
});

const publicGet = async (pathname, parameters, bodyLimit, parentSignal, backendProxy) => {
    const url = buildUrl(pathname, parameters);
    const deadline = withDeadline(parentSignal);
    try {
        if (backendProxy.errorCode) fail(backendProxy.errorCode);
        if (backendProxy.proxyAgent) {
            return await publicGetThroughTestnetProxy(
                url,
                bodyLimit,
                deadline.signal,
                backendProxy.proxyAgent,
            );
        }
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

const weightedGet = (weight, pathname, parameters, bodyLimit, signal, backendProxy) => (
    PUBLIC_READ_BUDGET.execute(
        weight,
        () => publicGet(pathname, parameters, bodyLimit, signal, backendProxy),
        { signal },
    )
);

const createSocket = (url, onMessage, onDisconnect, backendProxy) => {
    const parsed = new URL(url);
    if (parsed.origin !== FUTURES_TESTNET_WORKSTATION_WSS_ORIGIN
        || !['/public/stream', '/market/stream'].includes(parsed.pathname)) {
        fail('WSS_ORIGIN_ESCAPE');
    }
    if (backendProxy.errorCode) fail(backendProxy.errorCode);
    const socket = new WebSocket(url, {
        followRedirects: false,
        handshakeTimeout: 10_000,
        maxPayload: FUTURES_WORKSTATION_JSON_LIMITS.WS_FRAME_BYTES,
        perMessageDeflate: false,
        ...(backendProxy.proxyAgent ? { agent: backendProxy.proxyAgent } : {}),
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

export const createFuturesTestnetWorkstationReviewedTransport = () => {
    const backendProxy = resolveTestnetBackendProxy();
    return Object.freeze({
        kind: 'reviewed-testnet-public-read',
        now: () => Date.now(),
        loadExchangeInfo: ({ signal } = {}) => weightedGet(
            FUTURES_TESTNET_WORKSTATION_WEIGHTS.EXCHANGE_INFO,
            FUTURES_TESTNET_WORKSTATION_ROUTES.EXCHANGE_INFO,
            {},
            FUTURES_WORKSTATION_BODY_LIMITS.EXCHANGE_INFO,
            signal,
            backendProxy,
        ),
        bootstrap: async ({ symbol, pair, interval, signal } = {}) => {
            assertSelection(symbol, interval);
            if (!PAIR_PATTERN.test(pair)) fail('INVALID_SELECTION');
            const [
                depthSnapshot,
                contractKlines,
                markKlines,
                indexKlines,
                premiumIndex,
                ticker,
            ] = await Promise.all([
                weightedGet(FUTURES_TESTNET_WORKSTATION_WEIGHTS.DEPTH_1000, FUTURES_TESTNET_WORKSTATION_ROUTES.DEPTH, { symbol, limit: '1000' }, FUTURES_WORKSTATION_BODY_LIMITS.DEPTH, signal, backendProxy),
                weightedGet(FUTURES_TESTNET_WORKSTATION_WEIGHTS.KLINES_500, FUTURES_TESTNET_WORKSTATION_ROUTES.KLINES, { symbol, interval, limit: '500' }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES, signal, backendProxy),
                weightedGet(FUTURES_TESTNET_WORKSTATION_WEIGHTS.MARK_KLINES_500, FUTURES_TESTNET_WORKSTATION_ROUTES.MARK_KLINES, { symbol, interval, limit: '500' }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES, signal, backendProxy),
                weightedGet(FUTURES_TESTNET_WORKSTATION_WEIGHTS.INDEX_KLINES_500, FUTURES_TESTNET_WORKSTATION_ROUTES.INDEX_KLINES, { pair, interval, limit: '500' }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES, signal, backendProxy),
                weightedGet(FUTURES_TESTNET_WORKSTATION_WEIGHTS.PREMIUM_INDEX_SYMBOL, FUTURES_TESTNET_WORKSTATION_ROUTES.PREMIUM_INDEX, { symbol }, FUTURES_WORKSTATION_BODY_LIMITS.HEADER, signal, backendProxy),
                weightedGet(FUTURES_TESTNET_WORKSTATION_WEIGHTS.TICKER_SYMBOL, FUTURES_TESTNET_WORKSTATION_ROUTES.TICKER, { symbol }, FUTURES_WORKSTATION_BODY_LIMITS.HEADER, signal, backendProxy),
            ]);
            return Object.freeze({ depthSnapshot, contractKlines, markKlines, indexKlines, premiumIndex, ticker });
        },
        connect: ({ symbol, interval, onMessage, onDisconnect, signal } = {}) => {
            assertSelection(symbol, interval);
            if (typeof onMessage !== 'function' || typeof onDisconnect !== 'function') fail('INVALID_SUBSCRIBER');
            const lower = symbol.toLowerCase();
            const publicUrl = `${FUTURES_TESTNET_WORKSTATION_WSS_ORIGIN}/public/stream?streams=${lower}@depth@100ms`;
            const marketUrl = `${FUTURES_TESTNET_WORKSTATION_WSS_ORIGIN}/market/stream?streams=${[
                `${lower}@aggTrade`,
                `${lower}@kline_${interval}`,
                `${lower}@markPrice@1s`,
                `${lower}@ticker`,
            ].join('/')}`;
            const publicSocket = createSocket(publicUrl, onMessage, onDisconnect, backendProxy);
            const marketSocket = createSocket(marketUrl, onMessage, onDisconnect, backendProxy);
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
        close: () => backendProxy.proxyAgent?.destroy?.(),
    });
};
