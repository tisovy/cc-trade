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
    KLINES_99: 1,
    MARK_KLINES_99: 1,
    INDEX_KLINES_99: 1,
    PREMIUM_INDEX_SYMBOL: 1,
    TICKER_SYMBOL: 1,
});

export const FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS = Object.freeze({
    DEPTH: 1_000,
    KLINES: 99,
});

export const FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_CACHE_TTL_MS = 5 * 60_000;
export const FUTURES_PRODUCTION_WORKSTATION_BOOTSTRAP_CONCURRENCY = 3;

const ROUTE_SET = new Set(Object.values(FUTURES_PRODUCTION_WORKSTATION_ROUTES));
const PUBLIC_READ_BUDGET = new FuturesWorkstationReadBudget({
    maximumConcurrent: FUTURES_PRODUCTION_WORKSTATION_BOOTSTRAP_CONCURRENCY,
});
const EXCHANGE_INFO_CACHE = {
    fetchIdentity: null,
    value: null,
    expiresAt: 0,
    inFlight: null,
};
const SYMBOL_PATTERN = /^(?:[\p{Lu}\p{Lt}\p{Lo}\p{N}]{1,20}|[\p{Lu}\p{Lt}\p{Lo}\p{N}]{1,13}_[0-9]{6})$/u;
const PAIR_PATTERN = /^[\p{Lu}\p{Lt}\p{Lo}\p{N}]{1,20}$/u;
const EXCHANGE_IDENTITY_MAX_BYTES = 64;
const INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']);

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

const emitTiming = (onTiming, phase, startedAt, outcome, cache = null) => {
    const durationMs = Math.max(0, Date.now() - startedAt);
    try {
        onTiming(Object.freeze({ phase, durationMs, outcome, cache }));
    } catch {
        // Diagnostics are observational and cannot affect market-data delivery.
    }
};

const waitForSharedExchangeInfo = (promise, signal) => {
    if (!signal) return promise;
    if (signal.aborted) {
        return Promise.reject(new FuturesProductionWorkstationTransportError('REQUEST_ABORTED'));
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener?.('abort', abort);
            callback(value);
        };
        const abort = () => finish(
            reject,
            new FuturesProductionWorkstationTransportError('REQUEST_ABORTED'),
        );
        signal.addEventListener?.('abort', abort, { once: true });
        promise.then(
            value => finish(resolve, value),
            error => finish(reject, error),
        );
    });
};

const resolveProductionBackendProxy = () => {
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
            ? new SocksProxyAgent(proxyUrl, {
                keepAlive: true,
                maxSockets: 2,
                maxFreeSockets: 1,
            })
            : new HttpsProxyAgent(proxyUrl, {
                keepAlive: true,
                maxSockets: 2,
                maxFreeSockets: 1,
            });
        return Object.freeze({ proxyAgent: agent, errorCode: null });
    } catch {
        return Object.freeze({ proxyAgent: null, errorCode: 'INVALID_PROXY_CONFIGURATION' });
    }
};

const isBoundedExchangeIdentity = (value, pattern) => (
    typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= EXCHANGE_IDENTITY_MAX_BYTES
    && pattern.test(value)
);

const assertSelection = (symbol, interval) => {
    if (!isBoundedExchangeIdentity(symbol, SYMBOL_PATTERN)
        || !INTERVALS.has(interval)) fail('INVALID_SELECTION');
};

const withDeadline = (parentSignal, timeoutMs = 10_000) => {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort();
    const expire = () => {
        if (controller.signal.aborted) return;
        timedOut = true;
        controller.abort();
    };
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
    const timer = setTimeout(expire, timeoutMs);
    timer.unref?.();
    return Object.freeze({
        signal: controller.signal,
        didTimeout: () => timedOut,
        release: () => {
            clearTimeout(timer);
            parentSignal?.removeEventListener?.('abort', abortFromParent);
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

const readProductionProxyResponseBody = (response, bodyLimit) => new Promise((resolve, reject) => {
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
            rejectOnce(new FuturesProductionWorkstationTransportError('RESPONSE_BODY_TOO_LARGE'));
            return;
        }
        chunks.push(bytes);
    });
    response.once('aborted', () => {
        rejectOnce(new FuturesProductionWorkstationTransportError('RESPONSE_ABORTED'));
    });
    response.once('error', rejectOnce);
    response.once('end', () => {
        if (settled) return;
        try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
            settled = true;
            resolve(text);
        } catch {
            rejectOnce(new FuturesProductionWorkstationTransportError('INVALID_JSON_ENCODING'));
        }
    });
});

const publicGetThroughProductionProxy = (url, bodyLimit, signal, proxyAgent) => new Promise((resolve, reject) => {
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
        readProductionProxyResponseBody(response, bodyLimit).then(resolve, reject);
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
            return await publicGetThroughProductionProxy(
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
    } catch (error) {
        if (deadline.didTimeout()) {
            throw new FuturesProductionWorkstationTransportError('REQUEST_DEADLINE_EXCEEDED');
        }
        throw error;
    } finally {
        deadline.release();
    }
};

const weightedGet = (
    weight,
    pathname,
    parameters,
    bodyLimit,
    signal,
    backendProxy,
    onFailure,
    onSuccess,
) => (
    PUBLIC_READ_BUDGET.execute(
        weight,
        () => publicGet(pathname, parameters, bodyLimit, signal, backendProxy)
            .then(value => (onSuccess ? onSuccess(value) : value))
            .catch((error) => {
                onFailure?.(error);
                throw error;
            }),
        { signal },
    )
);

const createSocket = (url, onMessage, onDisconnect, backendProxy) => {
    const parsed = new URL(url);
    if (parsed.origin !== FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN
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
    let readySettled = false;
    let settleReady;
    const ready = new Promise((resolve) => {
        settleReady = (value) => {
            if (readySettled) return;
            readySettled = true;
            resolve(value);
        };
    });
    const lifetime = setTimeout(() => socket.close(1000, '24h connection rotation'), 86_400_000);
    lifetime.unref?.();
    socket.once('open', () => settleReady(true));
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
        settleReady(false);
        if (closed) return;
        closed = true;
        clearTimeout(lifetime);
        onDisconnect('SOCKET_CLOSED');
    });
    socket.once('error', () => {
        settleReady(false);
        if (!closed) onDisconnect('SOCKET_ERROR');
    });
    return Object.freeze({
        ready,
        close: () => {
            if (closed) return;
            closed = true;
            settleReady(false);
            clearTimeout(lifetime);
            socket.removeAllListeners();
            socket.close(1000, 'generation teardown');
        },
    });
};

export const createFuturesProductionWorkstationReviewedTransport = ({
    onTiming = () => {},
} = {}) => {
    if (typeof onTiming !== 'function') fail('INVALID_TIMING_REPORTER');
    const backendProxy = resolveProductionBackendProxy();
    const timedWeightedGet = async (phase, ...args) => {
        const startedAt = Date.now();
        let outcome = 'ok';
        try {
            return await weightedGet(...args);
        } catch (error) {
            outcome = 'error';
            throw error;
        } finally {
            emitTiming(onTiming, phase, startedAt, outcome);
        }
    };
    const loadExchangeInfo = async ({ signal } = {}) => {
        if (backendProxy.errorCode) fail(backendProxy.errorCode);
        const startedAt = Date.now();
        if (signal?.aborted) {
            emitTiming(onTiming, 'exchange-info', startedAt, 'error');
            throw new FuturesProductionWorkstationTransportError('REQUEST_ABORTED');
        }
        const fetchIdentity = globalThis.fetch;
        if (EXCHANGE_INFO_CACHE.fetchIdentity !== fetchIdentity) {
            EXCHANGE_INFO_CACHE.fetchIdentity = fetchIdentity;
            EXCHANGE_INFO_CACHE.value = null;
            EXCHANGE_INFO_CACHE.expiresAt = 0;
            EXCHANGE_INFO_CACHE.inFlight = null;
        }
        const waitAndReport = (promise, cache) => waitForSharedExchangeInfo(
            promise,
            signal,
        ).then(
            (value) => {
                emitTiming(onTiming, 'exchange-info', startedAt, 'ok', cache);
                return value;
            },
            (error) => {
                emitTiming(onTiming, 'exchange-info', startedAt, 'error', cache);
                throw error;
            },
        );
        if (EXCHANGE_INFO_CACHE.value !== null
            && startedAt < EXCHANGE_INFO_CACHE.expiresAt) {
            return waitAndReport(
                Promise.resolve(EXCHANGE_INFO_CACHE.value),
                'hit',
            );
        }

        let cache = 'shared';
        if (EXCHANGE_INFO_CACHE.inFlight === null) {
            cache = 'miss';
            const pending = weightedGet(
                FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.EXCHANGE_INFO,
                FUTURES_PRODUCTION_WORKSTATION_ROUTES.EXCHANGE_INFO,
                {},
                FUTURES_WORKSTATION_BODY_LIMITS.EXCHANGE_INFO,
                undefined,
                backendProxy,
            ).then((value) => {
                if (EXCHANGE_INFO_CACHE.fetchIdentity === fetchIdentity) {
                    EXCHANGE_INFO_CACHE.value = value;
                    EXCHANGE_INFO_CACHE.expiresAt = Date.now()
                        + FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_CACHE_TTL_MS;
                }
                return value;
            });
            EXCHANGE_INFO_CACHE.inFlight = pending;
            void pending.then(
                () => {
                    if (EXCHANGE_INFO_CACHE.inFlight === pending) {
                        EXCHANGE_INFO_CACHE.inFlight = null;
                    }
                },
                () => {
                    if (EXCHANGE_INFO_CACHE.inFlight === pending) {
                        EXCHANGE_INFO_CACHE.inFlight = null;
                    }
                },
            );
        }
        return waitAndReport(EXCHANGE_INFO_CACHE.inFlight, cache);
    };
    const readBootstrapResources = async ({
        symbol,
        pair,
        interval,
        signal,
        onBootstrapResource,
        includeInvariantResources,
    } = {}) => {
        assertSelection(symbol, interval);
        if (!isBoundedExchangeIdentity(pair, PAIR_PATTERN)) fail('INVALID_SELECTION');
        if (onBootstrapResource !== undefined
            && typeof onBootstrapResource !== 'function') fail('INVALID_BOOTSTRAP_OBSERVER');
        const batchController = new AbortController();
        let batchFailure = null;
        const abortBatch = (error) => {
            if (error instanceof Error && batchFailure === null) batchFailure = error;
            batchController.abort();
        };
        const abortFromParent = () => abortBatch();
        if (signal?.aborted) abortBatch();
        else signal?.addEventListener?.('abort', abortFromParent, { once: true });
        const deliver = (resource, value) => {
            if (onBootstrapResource) {
                onBootstrapResource(Object.freeze({ resource, value }));
            }
            return value;
        };
        const readResource = (
            resource,
            phase,
            weight,
            pathname,
            parameters,
            bodyLimit,
        ) => timedWeightedGet(
            phase,
            weight,
            pathname,
            parameters,
            bodyLimit,
            batchController.signal,
            backendProxy,
            abortBatch,
            value => deliver(resource, value),
        );
        const resources = [
            ['contractKlines', 'contract-klines', FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.KLINES_99, FUTURES_PRODUCTION_WORKSTATION_ROUTES.KLINES, { symbol, interval, limit: String(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.KLINES) }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES],
            ['markKlines', 'mark-klines', FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.MARK_KLINES_99, FUTURES_PRODUCTION_WORKSTATION_ROUTES.MARK_KLINES, { symbol, interval, limit: String(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.KLINES) }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES],
            ['indexKlines', 'index-klines', FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.INDEX_KLINES_99, FUTURES_PRODUCTION_WORKSTATION_ROUTES.INDEX_KLINES, { pair, interval, limit: String(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.KLINES) }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES],
        ];
        if (includeInvariantResources) {
            resources.unshift(
                ['depthSnapshot', 'depth', FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.DEPTH_1000, FUTURES_PRODUCTION_WORKSTATION_ROUTES.DEPTH, { symbol, limit: String(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.DEPTH) }, FUTURES_WORKSTATION_BODY_LIMITS.DEPTH],
            );
            resources.push(
                ['premiumIndex', 'premium-index', FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.PREMIUM_INDEX_SYMBOL, FUTURES_PRODUCTION_WORKSTATION_ROUTES.PREMIUM_INDEX, { symbol }, FUTURES_WORKSTATION_BODY_LIMITS.HEADER],
                ['ticker', 'ticker', FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.TICKER_SYMBOL, FUTURES_PRODUCTION_WORKSTATION_ROUTES.TICKER, { symbol }, FUTURES_WORKSTATION_BODY_LIMITS.HEADER],
            );
        }
        try {
            const values = await Promise.all(resources.map(([
                resource,
                phase,
                weight,
                pathname,
                parameters,
                bodyLimit,
            ]) => readResource(resource, phase, weight, pathname, parameters, bodyLimit)));
            return Object.freeze(Object.fromEntries(
                resources.map(([resource], index) => [resource, values[index]]),
            ));
        } catch (error) {
            abortBatch();
            throw batchFailure ?? error;
        } finally {
            signal?.removeEventListener?.('abort', abortFromParent);
        }
    };
    return Object.freeze({
        kind: 'reviewed-production-public-read',
        now: () => Date.now(),
        loadExchangeInfo,
        bootstrap: options => readBootstrapResources({
            ...options,
            includeInvariantResources: true,
        }),
        bootstrapInterval: options => readBootstrapResources({
            ...options,
            includeInvariantResources: false,
        }),
        connect: ({
            symbol,
            interval,
            onMessage,
            onDisconnect,
            onCandleDisconnect,
            signal,
        } = {}) => {
            assertSelection(symbol, interval);
            if (typeof onMessage !== 'function'
                || typeof onDisconnect !== 'function'
                || typeof onCandleDisconnect !== 'function') fail('INVALID_SUBSCRIBER');
            const lower = symbol.toLowerCase();
            const publicUrl = `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/public/stream?streams=${lower}@depth@100ms`;
            const marketUrl = `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/market/stream?streams=${[
                `${lower}@aggTrade`,
                `${lower}@markPrice@1s`,
                `${lower}@ticker`,
            ].join('/')}`;
            const publicSocket = createSocket(publicUrl, onMessage, onDisconnect, backendProxy);
            const marketSocket = createSocket(marketUrl, onMessage, onDisconnect, backendProxy);
            let closed = false;
            let candleEpoch = 0;
            const createCandleSocket = (selectedInterval, epoch) => {
                let disconnectReported = false;
                let handle = null;
                handle = createSocket(
                    `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/market/stream?streams=${lower}@kline_${selectedInterval}`,
                    raw => {
                        if (!closed && candleEpoch === epoch) onMessage(raw);
                    },
                    (reason) => {
                        if (closed || candleEpoch !== epoch || disconnectReported) return;
                        disconnectReported = true;
                        candleEpoch += 1;
                        handle?.close();
                        onCandleDisconnect(reason);
                    },
                    backendProxy,
                );
                return handle;
            };
            let candleSocket = createCandleSocket(interval, candleEpoch);
            const initialCandleSocket = candleSocket;
            const startedAt = Date.now();
            const close = () => {
                if (closed) return;
                closed = true;
                candleEpoch += 1;
                publicSocket.close();
                marketSocket.close();
                candleSocket.close();
            };
            signal?.addEventListener?.('abort', close, { once: true });
            return Object.freeze({
                ready: Promise.all([publicSocket.ready, marketSocket.ready, initialCandleSocket.ready])
                    .then((results) => {
                        const ready = results.every(Boolean);
                        emitTiming(onTiming, 'upstream-streams', startedAt, ready ? 'ok' : 'error');
                        return ready;
                    }),
                selectInterval: async ({ interval: selectedInterval, signal: selectionSignal } = {}) => {
                    assertSelection(symbol, selectedInterval);
                    if (closed || signal?.aborted || selectionSignal?.aborted) return false;
                    candleEpoch += 1;
                    const selectedEpoch = candleEpoch;
                    candleSocket.close();
                    const selectedSocket = createCandleSocket(selectedInterval, selectedEpoch);
                    candleSocket = selectedSocket;
                    const selectionStartedAt = Date.now();
                    const abortSelection = () => {
                        if (candleEpoch === selectedEpoch) {
                            candleEpoch += 1;
                            selectedSocket.close();
                        }
                    };
                    selectionSignal?.addEventListener?.('abort', abortSelection, { once: true });
                    try {
                        const ready = await selectedSocket.ready;
                        const accepted = ready === true
                            && !closed
                            && candleEpoch === selectedEpoch
                            && !selectionSignal?.aborted;
                        emitTiming(
                            onTiming,
                            'interval-stream',
                            selectionStartedAt,
                            accepted ? 'ok' : 'error',
                        );
                        return accepted;
                    } finally {
                        selectionSignal?.removeEventListener?.('abort', abortSelection);
                    }
                },
                close: () => {
                    signal?.removeEventListener?.('abort', close);
                    close();
                },
            });
        },
        close: () => backendProxy.proxyAgent?.destroy?.(),
    });
};
