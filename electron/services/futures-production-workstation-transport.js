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
    INDEX_KLINES: '/fapi/v1/indexPriceKlines',
    PREMIUM_INDEX: '/fapi/v1/premiumIndex',
    TICKER: '/fapi/v1/ticker/24hr',
});

export const FUTURES_PRODUCTION_WORKSTATION_WEIGHTS = Object.freeze({
    EXCHANGE_INFO: 1,
    // Binance charges depth by page. 5, 10, 20 and 50 all cost 2, so 50 is the
    // free maximum and there is never a reason to ask for less.
    DEPTH_50: 2,
    DEPTH_100: 5,
    DEPTH_500: 10,
    DEPTH_1000: 20,
    KLINES_99: 1,
    // Binance charges klines by page size: 100 → 1, 1000 → 5.
    KLINES_1000: 5,
    INDEX_KLINES_99: 1,
    PREMIUM_INDEX_SYMBOL: 1,
    TICKER_SYMBOL: 1,
});

// Deepest first is not the order they are climbed — this is the ladder, read
// from the cheapest rung. A contract is opened on the first one and only buys a
// deeper page when the rows on screen need range the current one does not prove.
export const FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES = Object.freeze([
    Object.freeze({ limit: 50, weight: 2 }),
    Object.freeze({ limit: 100, weight: 5 }),
    Object.freeze({ limit: 500, weight: 10 }),
    Object.freeze({ limit: 1_000, weight: 20 }),
]);

export const FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS = Object.freeze({
    DEPTH: 1_000,
    KLINES: 99,
    // Kept equal to the protocol's candle-history bound; the transport stays
    // self-contained, so the two are asserted against each other by test.
    CANDLE_HISTORY: 1_000,
});

export const FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_CACHE_TTL_MS = 5 * 60_000;
// After the TTL the cached catalog is still served immediately (contracts
// change rarely) while a background refresh revalidates it, up to this bound.
export const FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_STALE_SERVE_MS = 6 * 60 * 60_000;
export const FUTURES_PRODUCTION_WORKSTATION_BOOTSTRAP_CONCURRENCY = 5;
export const FUTURES_PRODUCTION_WORKSTATION_RESOURCE_RETRIES = 2;

// Binance answers USDⓈ-M public reads against 2400 weight per minute per
// address, of which the account reader claims at most 1700
// (`FUTURES_REST_ACCOUNT_WEIGHT_CEILING` in `binance-connection.js`; it was
// 800 until 2026-09-03). A quarter of the exchange's minute here leaves a
// hundred of it unspent with both readers at their ceilings — and the
// operator's trading commands are measured against the exchange's own
// number, not against either ceiling.
//
// Sized against what the desk costs rather than left at a bare default: one
// contract switch is 24 — a 1000-level book at 20 and four reads at 1 — and a
// single book-recovery round on a thin contract is up to 60. The 120 this
// started at was five switches, or two recoveries, for a whole minute.
export const FUTURES_PRODUCTION_WORKSTATION_READ_BUDGET = Object.freeze({
    MAXIMUM_WEIGHT: 600,
    WINDOW_MS: 60_000,
});

// A socket that stays open while delivering nothing is the failure mode this
// desk has already been bitten by: a route that answers the handshake and then
// says nothing raises no error and never closes, so every recovery that hangs
// off `close` is never entered. These are the bounds past which silence is
// treated as a disconnection, each set from a measurement rather than from the
// documentation — seven minutes on four sockets through the operator's proxy,
// 2026-08-13, on BTCUSDT and on BITOUSDT (1 583 trades in 24 hours, thinner
// than anything the rail carries).
export const FUTURES_PRODUCTION_WORKSTATION_SILENCE = Object.freeze({
    // `@markPrice@1s` is the one stream the exchange pushes whether or not
    // anything trades: 418 frames in 420 seconds on the thin contract, which
    // printed a single aggregate trade in the whole run. p50 1000ms, worst gap
    // 1511ms. Ten times that worst gap, and the same bound the account-side
    // mark feed already applies to the same stream
    // (`futures-mark-price-feed.js`). Only the socket carrying that stream is
    // judged this way.
    CADENCE_MS: 15_000,
    // The exchange pings every three minutes — measured 180002ms and 179965ms
    // on `/market`, 180264ms and 180003ms on `/public`. Two missed pings plus
    // forty seconds, against a quarter-second of observed jitter. This is the
    // bound every socket is held to, because it is the only one a stream with
    // no unconditional cadence can be held to at all: depth on the thin
    // contract went 12822ms between frames while perfectly alive.
    INACTIVITY_MS: 400_000,
    // A trade printing against the book is a change to the book, so depth
    // cannot be silent through one. Longest depth silence containing a print:
    // 1224ms on BTCUSDT with 42 prints in it, 177ms on BITOUSDT with one.
    // Twenty-five times the worst of them. This is what covers `/public`, which
    // is served separately from `/market` and can be retired without it.
    BOOK_THROUGH_TRADES_MS: 30_000,
    CHECK_MS: 1_000,
});

// The combined-stream envelope names its stream first: `{"stream":"…","data":…}`.
// Read off the head rather than parsed, because the service parses every frame
// already and this only has to answer one question. A frame that does not match
// witnesses nothing, so an envelope this desk stops recognizing costs a missed
// detection rather than a false one.
const STREAM_ENVELOPE_NAME = /^\{"stream":"([^"]{1,64})"/;

const ROUTE_SET = new Set(Object.values(FUTURES_PRODUCTION_WORKSTATION_ROUTES));
const PUBLIC_READ_BUDGET = new FuturesWorkstationReadBudget({
    maximumWeight: FUTURES_PRODUCTION_WORKSTATION_READ_BUDGET.MAXIMUM_WEIGHT,
    windowMs: FUTURES_PRODUCTION_WORKSTATION_READ_BUDGET.WINDOW_MS,
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
const INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d', '1w']);
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

const CODE_SHAPE = /^[A-Z0-9_-]{1,96}$/;

/**
 * Why a phase ended badly, in the shape the record's `code` field accepts.
 *
 * Every rejection on these paths carries one already: this module's own errors,
 * the read budget's, and Node's socket and abort codes. The name is the fallback
 * because a `DOMException` numbers its code instead of naming it, and an
 * anonymous bucket is what this exists to stop — a failure line that will not
 * say what refused is the reason one `exchange-info` error per desk start went
 * six days without an explanation.
 */
const timingCode = (error) => {
    if (typeof error?.code === 'string' && CODE_SHAPE.test(error.code)) {
        return error.code.replace(/-/g, '_');
    }
    const named = typeof error?.name === 'string'
        ? error.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
        : '';
    return CODE_SHAPE.test(named) ? named : 'TRANSPORT_REJECTED';
};

const emitTiming = (onTiming, phase, startedAt, outcome, cache = null, code = null) => {
    const durationMs = Math.max(0, Date.now() - startedAt);
    try {
        onTiming(Object.freeze({ phase, durationMs, outcome, cache, code }));
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
                maxSockets: 8,
                maxFreeSockets: 2,
            })
            : new HttpsProxyAgent(proxyUrl, {
                keepAlive: true,
                maxSockets: 8,
                maxFreeSockets: 2,
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

const createSocket = (
    url,
    onMessage,
    onDisconnect,
    backendProxy,
    onOversizedFrame = () => {},
    { cadenceMs = null, witnessStream = null } = {},
) => {
    const parsed = new URL(url);
    if (parsed.origin !== FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN
        || !['/public/stream', '/market/stream'].includes(parsed.pathname)) {
        fail('WSS_ORIGIN_ESCAPE');
    }
    if (backendProxy.errorCode) fail(backendProxy.errorCode);
    const socket = new WebSocket(url, {
        followRedirects: false,
        handshakeTimeout: 10_000,
        maxPayload: FUTURES_WORKSTATION_JSON_LIMITS.WS_STREAM_FRAME_BYTES,
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
    // A connection this desk retires on its own schedule is not the exchange
    // going away, and the resync it causes says so.
    let rotated = false;
    const lifetime = setTimeout(() => {
        rotated = true;
        socket.close(1000, '24h connection rotation');
    }, 86_400_000);
    lifetime.unref?.();
    // The clock the silence bounds are read against. `lastFrameAt` is what the
    // exchange delivered; `lastActivityAt` also counts its protocol pings, which
    // are the only sign of life a stream with no unconditional cadence has.
    let lastFrameAt = Date.now();
    let lastActivityAt = lastFrameAt;
    // Null until a frame of the witnessed stream actually arrives. Seeding this
    // with a clock reading would have it claim a trade printed when none had —
    // and since the sockets of one connection open milliseconds apart, that
    // claim could outlive the book's last frame and accuse a book that was only
    // quiet.
    let lastWitnessAt = null;
    const silenceWatch = setInterval(() => {
        if (closed) return;
        const now = Date.now();
        const reason = cadenceMs !== null && now - lastFrameAt > cadenceMs
            ? `STREAM_SILENT_${Math.round(cadenceMs / 1000)}S`
            : (now - lastActivityAt > FUTURES_PRODUCTION_WORKSTATION_SILENCE.INACTIVITY_MS
                ? `STREAM_INACTIVE_${Math.round(
                    FUTURES_PRODUCTION_WORKSTATION_SILENCE.INACTIVITY_MS / 1000,
                )}S`
                : null);
        if (reason === null) return;
        closed = true;
        settleReady(false);
        clearTimeout(lifetime);
        clearInterval(silenceWatch);
        onDisconnect(reason, { closeCode: 1000, closedBy: 'desk' });
        try {
            socket.close(1000, 'stream went silent');
        } catch {
            // The connection is being abandoned either way.
        }
    }, FUTURES_PRODUCTION_WORKSTATION_SILENCE.CHECK_MS);
    silenceWatch.unref?.();
    socket.once('open', () => {
        // Start the clock where the stream did, not where the handshake did.
        // The witness is not started here: it is a record of what arrived, and
        // nothing has.
        lastFrameAt = Date.now();
        lastActivityAt = lastFrameAt;
        settleReady(true);
    });
    // A ping is the exchange saying the connection is alive without having
    // anything to send on it. It is not a frame, and a stream judged by its
    // frames must not be kept alive by one.
    socket.on('ping', () => {
        lastActivityAt = Date.now();
    });
    socket.on('message', (data, isBinary) => {
        if (closed) return;
        lastFrameAt = Date.now();
        lastActivityAt = lastFrameAt;
        if (isBinary) {
            closed = true;
            clearTimeout(lifetime);
            clearInterval(silenceWatch);
            onDisconnect('BINARY_FRAME_REJECTED');
            socket.close(1003, 'binary frame rejected');
            return;
        }
        const raw = typeof data === 'string' ? data : data.toString('utf8');
        if (witnessStream !== null && STREAM_ENVELOPE_NAME.exec(raw)?.[1] === witnessStream) {
            lastWitnessAt = lastFrameAt;
        }
        // A frame past the ceiling is dropped, not answered by hanging up. The
        // market is what makes a frame big, and closing the stream over one of
        // them took depth, tape, header and candles away at the moment the
        // operator needed them most.
        if (Buffer.byteLength(raw, 'utf8')
            > FUTURES_WORKSTATION_JSON_LIMITS.WS_STREAM_FRAME_BYTES) {
            onOversizedFrame(Buffer.byteLength(raw, 'utf8'));
            return;
        }
        onMessage(raw);
    });
    // Who ended the connection, and with what. The desk's own rotation and its
    // silence rule name themselves; a clean close code from the far side is the
    // exchange's; anything else — no code, an abnormal 1006, an error — is the
    // transport between them, which on this desk is a proxy.
    socket.once('close', (code) => {
        settleReady(false);
        clearInterval(silenceWatch);
        if (closed) return;
        closed = true;
        clearTimeout(lifetime);
        const closeCode = Number.isSafeInteger(code) && code >= 0 ? code : null;
        onDisconnect(rotated ? 'CONNECTION_ROTATED' : 'SOCKET_CLOSED', {
            closeCode,
            closedBy: rotated
                ? 'desk'
                : (closeCode === 1000 || closeCode === 1001 ? 'exchange' : 'transport'),
        });
    });
    socket.once('error', () => {
        settleReady(false);
        clearInterval(silenceWatch);
        if (!closed) onDisconnect('SOCKET_ERROR', { closeCode: null, closedBy: 'transport' });
    });
    return Object.freeze({
        ready,
        // What this socket last heard, for the rules that judge one stream
        // against another. `lastWitnessAt` answers `null` unless this socket was
        // asked to witness a stream.
        lastFrameAt: () => lastFrameAt,
        lastWitnessAt: () => lastWitnessAt,
        close: () => {
            if (closed) return;
            closed = true;
            settleReady(false);
            clearTimeout(lifetime);
            clearInterval(silenceWatch);
            socket.removeAllListeners();
            // A connection still in its handshake does not answer `close()` by
            // closing: `ws` aborts the handshake and *raises* "WebSocket was
            // closed before the connection was established". With every listener
            // just removed, nothing was listening, so Node threw it — out of the
            // abort listener, out of `AbortController.abort()`, and out of the
            // teardown that called it, which then skipped closing the streams and
            // clearing the timers. One contract switch during a handshake left
            // two contracts alive on the desk.
            socket.on('error', () => {});
            try {
                socket.close(1000, 'generation teardown');
            } catch {
                // The connection is being abandoned either way.
            }
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
        let code = null;
        try {
            return await weightedGet(...args);
        } catch (error) {
            outcome = 'error';
            code = timingCode(error);
            throw error;
        } finally {
            emitTiming(onTiming, phase, startedAt, outcome, null, code);
        }
    };
    // Three ways to end in milliseconds rather than in a round trip, and until
    // this said which, the record could not be asked. A configured proxy this
    // process refuses is the first, and it used to leave no line at all — the
    // read that never happened was also the read nothing recorded.
    const loadExchangeInfo = async ({ signal } = {}) => {
        const startedAt = Date.now();
        if (backendProxy.errorCode) {
            emitTiming(onTiming, 'exchange-info', startedAt, 'error', null, backendProxy.errorCode);
            fail(backendProxy.errorCode);
        }
        if (signal?.aborted) {
            emitTiming(onTiming, 'exchange-info', startedAt, 'aborted', null, 'REQUEST_ABORTED');
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
                // The other two: the caller's signal aborting while this waits
                // on the shared read, and the admission ladder refusing before
                // the request is issued. Both arrive here as an error carrying
                // its own reason, so the reason is taken from the error rather
                // than guessed from the site.
                const code = timingCode(error);
                // A superseded generation abandons only its own wait. The
                // shared read remains in flight for the replacement attempt,
                // so calling this an error made the normal loser of that race
                // indistinguishable from a read that actually failed.
                const outcome = code === 'REQUEST_ABORTED' ? 'aborted' : 'error';
                emitTiming(onTiming, 'exchange-info', startedAt, outcome, cache, code);
                throw error;
            },
        );
        const startExchangeInfoRefresh = () => {
            if (EXCHANGE_INFO_CACHE.inFlight !== null) return EXCHANGE_INFO_CACHE.inFlight;
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
            const settle = () => {
                if (EXCHANGE_INFO_CACHE.inFlight === pending) {
                    EXCHANGE_INFO_CACHE.inFlight = null;
                }
            };
            void pending.then(settle, settle);
            return pending;
        };

        if (EXCHANGE_INFO_CACHE.value !== null) {
            if (startedAt < EXCHANGE_INFO_CACHE.expiresAt) {
                return waitAndReport(
                    Promise.resolve(EXCHANGE_INFO_CACHE.value),
                    'hit',
                );
            }
            if (startedAt < EXCHANGE_INFO_CACHE.expiresAt
                + FUTURES_PRODUCTION_WORKSTATION_EXCHANGE_INFO_STALE_SERVE_MS) {
                // Serve the bounded-stale catalog immediately and revalidate in
                // the background; a refresh failure keeps the stale value.
                startExchangeInfoRefresh().catch(() => {});
                return waitAndReport(
                    Promise.resolve(EXCHANGE_INFO_CACHE.value),
                    'stale',
                );
            }
        }

        const cache = EXCHANGE_INFO_CACHE.inFlight === null ? 'miss' : 'shared';
        return waitAndReport(startExchangeInfoRefresh(), cache);
    };
    const readDepthSnapshot = async ({
        symbol,
        signal,
        retryAttempt = 0,
        limit = FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.DEPTH,
    } = {}) => {
        if (!isBoundedExchangeIdentity(symbol, SYMBOL_PATTERN)) fail('INVALID_SELECTION');
        // Only the pages the exchange prices are askable: an unlisted limit is
        // answered at the next page up and charged for it, which would put the
        // desk's own accounting out of step with what it is billed.
        const page = FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES
            .find(entry => entry.limit === limit);
        if (!page) fail('INVALID_SELECTION');
        return timedWeightedGet(
            retryAttempt > 0 ? 'depth-retry' : 'depth',
            page.weight,
            FUTURES_PRODUCTION_WORKSTATION_ROUTES.DEPTH,
            { symbol, limit: String(page.limit) },
            FUTURES_WORKSTATION_BODY_LIMITS.DEPTH,
            signal,
            backendProxy,
        );
    };
    // Candles behind the live window, read from the same reviewed public route
    // the bootstrap uses. `endTime` is exclusive: Binance answers with the
    // candles that closed before it, newest last.
    const readCandleHistory = async ({
        symbol,
        interval,
        endTime,
        limit = FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.CANDLE_HISTORY,
        signal,
    } = {}) => {
        assertSelection(symbol, interval);
        if (!Number.isSafeInteger(endTime)
            || endTime <= 0
            || !Number.isSafeInteger(limit)
            || limit <= 0
            || limit > FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.CANDLE_HISTORY) {
            fail('INVALID_SELECTION');
        }
        return timedWeightedGet(
            'candle-history',
            FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.KLINES_1000,
            FUTURES_PRODUCTION_WORKSTATION_ROUTES.KLINES,
            {
                symbol,
                interval,
                endTime: String(endTime - 1),
                limit: String(limit),
            },
            FUTURES_WORKSTATION_BODY_LIMITS.KLINES,
            signal,
            backendProxy,
        );
    };
    const readBootstrapResources = async ({
        symbol,
        pair,
        interval,
        signal,
        onBootstrapResource,
        includeHeaderResources,
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
        // A single stalled connection on a lossy network reaches the 10s
        // deadline while its remaining siblings finish in well under a second.
        // Retrying just that read on a fresh connection almost always succeeds
        // immediately, so only a deadline/network stall defers the batch abort
        // until its retries exhaust; every other failure aborts as before.
        const isRetryableReadFailure = error => (
            error?.code === 'REQUEST_DEADLINE_EXCEEDED'
            || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i.test(error?.message ?? '')
        );
        const readResource = async (
            resource,
            phase,
            weight,
            pathname,
            parameters,
            bodyLimit,
        ) => {
            for (let attempt = 0; ; attempt += 1) {
                try {
                    return await timedWeightedGet(
                        attempt > 0 ? `${phase}-retry` : phase,
                        weight,
                        pathname,
                        parameters,
                        bodyLimit,
                        batchController.signal,
                        backendProxy,
                        undefined,
                        value => deliver(resource, value),
                    );
                } catch (error) {
                    if (attempt >= FUTURES_PRODUCTION_WORKSTATION_RESOURCE_RETRIES
                        || batchController.signal.aborted
                        || !isRetryableReadFailure(error)) {
                        abortBatch(error);
                        throw error;
                    }
                }
            }
        };
        const resources = [
            ['contractKlines', 'contract-klines', FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.KLINES_99, FUTURES_PRODUCTION_WORKSTATION_ROUTES.KLINES, { symbol, interval, limit: String(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.KLINES) }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES],
            ['indexKlines', 'index-klines', FUTURES_PRODUCTION_WORKSTATION_WEIGHTS.INDEX_KLINES_99, FUTURES_PRODUCTION_WORKSTATION_ROUTES.INDEX_KLINES, { pair, interval, limit: String(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.KLINES) }, FUTURES_WORKSTATION_BODY_LIMITS.KLINES],
        ];
        if (includeHeaderResources) {
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
        readDepthSnapshot,
        readCandleHistory,
        // How much of the public read budget this minute has spent, for the
        // service's warmer to decide whether a parked contract can load now.
        // A reading and nothing else: the budget stays this module's own.
        readBudgetRoom: () => {
            const { usedWeight, maximumWeight } = PUBLIC_READ_BUDGET.snapshot();
            return Object.freeze({ usedWeight, maximumWeight });
        },
        bootstrapIndependent: options => readBootstrapResources({
            ...options,
            includeHeaderResources: true,
        }),
        bootstrapInterval: options => readBootstrapResources({
            ...options,
            includeHeaderResources: false,
        }),
        connect: ({
            symbol,
            interval,
            onMessage,
            onDisconnect,
            onCandleDisconnect,
            onFrameRefused = () => {},
            signal,
        } = {}) => {
            assertSelection(symbol, interval);
            if (typeof onMessage !== 'function'
                || typeof onDisconnect !== 'function'
                || typeof onCandleDisconnect !== 'function'
                || typeof onFrameRefused !== 'function') fail('INVALID_SUBSCRIBER');
            const lower = symbol.toLowerCase();
            const publicUrl = `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/public/stream?streams=${lower}@depth@100ms`;
            const marketUrl = `${FUTURES_PRODUCTION_WORKSTATION_WSS_ORIGIN}/market/stream?streams=${[
                `${lower}@aggTrade`,
                `${lower}@markPrice@1s`,
                `${lower}@ticker`,
            ].join('/')}`;
            // A dropped frame is a fact the operator's log should carry: it is
            // the difference between a market that went quiet and a desk that
            // refused what the market sent. The size goes to the timing line;
            // the refusal itself goes to the session, which is what puts it in
            // front of the operator under its own name.
            const reportOversizedFrame = (bytes) => {
                emitTiming(onTiming, `oversized-frame:${bytes}`, Date.now(), 'error', null, 'STREAM_FRAME_REFUSED');
                onFrameRefused('STREAM_FRAME_REFUSED');
            };
            const publicSocket = createSocket(
                publicUrl,
                onMessage,
                onDisconnect,
                backendProxy,
                reportOversizedFrame,
            );
            // The market socket is the only one with a heartbeat to be judged
            // against: `@markPrice@1s` arrives every second whether or not the
            // contract trades. It also witnesses the tape, which is what lets
            // the book's silence be told apart from a quiet market.
            const marketSocket = createSocket(
                marketUrl,
                onMessage,
                onDisconnect,
                backendProxy,
                reportOversizedFrame,
                {
                    cadenceMs: FUTURES_PRODUCTION_WORKSTATION_SILENCE.CADENCE_MS,
                    witnessStream: `${lower}@aggTrade`,
                },
            );
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
                    reportOversizedFrame,
                );
                return handle;
            };
            let candleSocket = createCandleSocket(interval, candleEpoch);
            const initialCandleSocket = candleSocket;
            const startedAt = Date.now();
            // Depth rides `/public` and the tape rides `/market` — two routes
            // the exchange serves separately and can retire separately. Depth
            // has no cadence of its own to be judged by (12.8s between frames on
            // a live thin contract), so the tape is what judges it: a trade
            // printed against the book is a change to the book, and depth cannot
            // be silent through one. Both quiet is a quiet market, and says
            // nothing.
            const bookWatch = setInterval(() => {
                if (closed) return;
                const now = Date.now();
                const bookAt = publicSocket.lastFrameAt();
                if (now - bookAt
                    <= FUTURES_PRODUCTION_WORKSTATION_SILENCE.BOOK_THROUGH_TRADES_MS) return;
                // A tape that has itself stopped is no witness to anything. Its
                // last print is then just the last thing that happened before
                // two routes went down together, and accusing the book of it
                // would resynchronize twice over one outage.
                if (now - marketSocket.lastFrameAt()
                    > FUTURES_PRODUCTION_WORKSTATION_SILENCE.CADENCE_MS) return;
                const witnessAt = marketSocket.lastWitnessAt();
                if (witnessAt === null || witnessAt <= bookAt) return;
                clearInterval(bookWatch);
                onDisconnect(`BOOK_SILENT_THROUGH_TRADES_${Math.round(
                    FUTURES_PRODUCTION_WORKSTATION_SILENCE.BOOK_THROUGH_TRADES_MS / 1000,
                )}S`);
                publicSocket.close();
            }, FUTURES_PRODUCTION_WORKSTATION_SILENCE.CHECK_MS);
            bookWatch.unref?.();
            const close = () => {
                if (closed) return;
                closed = true;
                candleEpoch += 1;
                clearInterval(bookWatch);
                publicSocket.close();
                marketSocket.close();
                candleSocket.close();
            };
            signal?.addEventListener?.('abort', close, { once: true });
            return Object.freeze({
                ready: Promise.all([publicSocket.ready, marketSocket.ready, initialCandleSocket.ready])
                    .then((results) => {
                        const ready = results.every(Boolean);
                        emitTiming(
                            onTiming,
                            'upstream-streams',
                            startedAt,
                            ready ? 'ok' : 'error',
                            null,
                            ready ? null : 'UPSTREAM_NOT_READY',
                        );
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
