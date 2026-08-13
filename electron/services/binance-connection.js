import http from 'http';
import { server as WebSocketServer } from 'websocket';
import { Spot } from '@binance/spot';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { Buffer } from 'buffer';
import { ChannelManager, CHANNEL_TYPES } from './channel-manager.js';
import {
    LOCAL_WEBSOCKET_HOST,
    createLocalWebSocketAccess,
    resolveLocalWebSocketPort,
    validateLocalWebSocketRequest,
} from './local-websocket-access.js';
import {
    createCommandRejection,
    validateLegacyCancelCommand,
    validateLegacyOrderCommand,
    validateTypedTradingCommand,
} from './trading-command-validation.js';
import {
    SpotTradingAdapter,
    runSpotAccountRefreshOperations,
} from './spot-trading-adapter.js';
import {
    FUTURES_MARKET_TYPE,
    SPOT_MARKET_TYPE,
    TRADING_COMMAND_ACTIONS,
} from '../../src/utils/tradingCommands.js';
import {
    UNCONFIRMED_COMMAND_MESSAGE,
    UNRESOLVED_COMMAND_MESSAGE,
    createCommandResolved,
    createCommandUnresolved,
    isIndeterminateTradingFailure,
} from './trading-command-outcome.js';
import {
    createTradingCommandRegistry,
    isMutatingTradingCommand,
} from './trading-command-registry.js';
// The ceiling rule itself lives with the draft evaluator the renderer uses, so
// both sides measure an order the same way. This evaluation is still the main
// process's own: it runs on the command as received, never on a verdict the
// renderer supplied.
import {
    FUTURES_RISK_REASONS,
    evaluateFuturesOrderRisk,
} from '../../src/utils/futuresOrderDraft.js';
import { LOCAL_WEBSOCKET_AUTH_CLOSE_CODE } from '../../src/utils/localWebSocketAccess.js';
import {
    FUTURES_HISTORY_LIMIT,
    FUTURES_TRADE_HISTORY_LIMIT,
    FUTURES_STREAM_ORIGIN,
    FuturesTradingAdapter,
    describeFuturesApiError,
    normalizeFuturesUserDataStreamEvent,
} from './futures-trading-adapter.js';
import {
    createBinanceStartupEnvelope,
    evaluateBinanceCredentialPreflight,
} from './binance-credential-preflight.js';
import {
    createFuturesMarkPriceFeed,
} from './futures-mark-price-feed.js';
import {
    FuturesSettledOrderMemory,
    FuturesStreamedOrderMemory,
    createFuturesAccountStateEnvelope,
    createInitialFuturesAccountResources,
    foldFuturesWorkingOrder,
    markFuturesOrderResourcesStale,
    markFuturesResourceFailed,
    markFuturesResourceIdle,
    markFuturesResourceLoading,
    markFuturesResourceReady,
    reconcileFuturesWorkingOrderRead,
} from './futures-account-state.js';
import WebSocket from 'ws';
import {
    createFuturesProductionWorkstationRuntime,
} from './futures-production-workstation-composition.js';
import { DESK_DIAGNOSTICS_UNRECORDED } from './desk-diagnostic-record.js';
import { RENDERER_OUTBOX_LANES, createRendererOutbox } from './renderer-outbox.js';
import {
    isPotentialFuturesProductionWorkstationFrame,
} from '../../src/utils/futuresProductionWorkstationProtocol.js';
import { SPOT_CHART_HISTORY_PAGE_ROWS } from '../../src/utils/spotChartHistory.js';

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const activeLogLevel = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LOG_LEVELS.info;
const logger = {
    debug: (...args) => activeLogLevel >= LOG_LEVELS.debug && console.debug(...args),
    info: (...args) => activeLogLevel >= LOG_LEVELS.info && console.info(...args),
    warn: (...args) => activeLogLevel >= LOG_LEVELS.warn && console.warn(...args),
    error: (...args) => console.error(...args)
};

export const LOCAL_RENDERER_WS_MAX_FRAME_BYTES = 16 * 1024;
export const LOCAL_RENDERER_WS_MAX_MESSAGE_BYTES = 16 * 1024;
export const LOCAL_RENDERER_WS_MAX_ACTION_FIELDS = 32;
export const LOCAL_RENDERER_WS_MAX_CHANNELS = 64;

const CHANNEL_ACTIONS = new Set([
    'get_startup_status',
    'activate_market',
    'subscribe',
    'unsubscribe',
    'enable_depth_view',
    'disable_depth_view',
    'load_chart_history',
]);
// A market-scoped frame is only accepted while that market is the activated
// one. Before `activate_market` there is no activated market, and after a
// switch the market the operator left is not it — so neither can quietly keep
// the backend subscribing, refreshing or trading on their behalf.
export const MARKET_MODES = Object.freeze({
    SPOT: 'spot',
    FUTURES: 'futures-live',
    UNSELECTED: 'unselected',
});
const SPOT_CHANNEL_ACTIONS = new Set([
    'subscribe',
    'unsubscribe',
    'enable_depth_view',
    'disable_depth_view',
    'load_chart_history',
]);
const SPOT_LEGACY_REQUESTS = new Set(['chart', 'buyOrder', 'sellOrder', 'cancelOrder']);

const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CHANNEL_SYMBOL_PATTERN = /^[A-Z0-9_]{1,64}$/;
const CHANNEL_INTERVAL_PATTERN = /^[A-Za-z0-9]{1,16}$/;
const isMatchingString = (value, pattern) => typeof value === 'string' && pattern.test(value);

/**
 * Separates the market activation stamp from the frame it travels on.
 *
 * The stamp belongs to the transport envelope, not to any channel's protocol.
 * The workstation channel validates an exact key set, so a frame still carrying
 * the stamp is rejected as a malformed request — which is how a chart, a book
 * and a tape that were correct on both sides went dark between them.
 */
const splitMarketGenerationStamp = (rawFrame) => {
    let parsed;
    try {
        parsed = JSON.parse(rawFrame);
    } catch {
        return { frame: rawFrame, generation: null };
    }
    if (!parsed
        || typeof parsed !== 'object'
        || Array.isArray(parsed)
        || !Number.isSafeInteger(parsed.generation)) {
        return { frame: rawFrame, generation: null };
    }
    const { generation, ...request } = parsed;
    return { frame: JSON.stringify(request), generation };
};

const validateRendererActionEnvelope = (data, channelManager) => {
    if (typeof data.action !== 'string' || data.action.length < 1 || data.action.length > 64) {
        return { code: 'INVALID_ACTION_ENVELOPE', message: 'action must be a bounded string' };
    }
    if (Object.keys(data).length > LOCAL_RENDERER_WS_MAX_ACTION_FIELDS) {
        return { code: 'INVALID_ACTION_ENVELOPE', message: 'action envelope has too many fields' };
    }

    const isKnownAction = CHANNEL_ACTIONS.has(data.action)
        || Object.values(TRADING_COMMAND_ACTIONS).includes(data.action);
    if (!isKnownAction) {
        return { code: 'UNSUPPORTED_ACTION', message: 'action is not supported' };
    }

    if (!CHANNEL_ACTIONS.has(data.action)) return null;
    if (data.action === 'get_startup_status') return null;
    if (data.action === 'activate_market') {
        if (data.marketMode !== 'spot'
            && data.marketMode !== 'futures-live'
            && data.marketMode !== 'unselected') {
            return { code: 'INVALID_MARKET_MODE', message: 'marketMode is invalid' };
        }
        return null;
    }
    if (data.marketType !== undefined && data.marketType !== 'spot') {
        return { code: 'UNSUPPORTED_MARKET_TYPE', message: 'only spot channel actions are enabled' };
    }

    if (data.action === 'subscribe') {
        if (!isMatchingString(data.channelId, CHANNEL_ID_PATTERN)
            || !isMatchingString(data.symbol, CHANNEL_SYMBOL_PATTERN)
            || !isMatchingString(data.interval, CHANNEL_INTERVAL_PATTERN)
            || (data.channelType !== undefined
                && data.channelType !== CHANNEL_TYPES.DETAIL
                && data.channelType !== CHANNEL_TYPES.MINI)) {
            return { code: 'INVALID_CHANNEL_ACTION', message: 'subscribe fields are invalid' };
        }
        const channelType = data.channelType || CHANNEL_TYPES.DETAIL;
        const replacesDetail = channelType === CHANNEL_TYPES.DETAIL
            && channelManager.getDetailChannel()
            && !channelManager.hasChannel(data.channelId);
        if (!channelManager.hasChannel(data.channelId)
            && channelManager.getChannelCount() >= LOCAL_RENDERER_WS_MAX_CHANNELS
            && !replacesDetail) {
            return { code: 'CHANNEL_LIMIT_EXCEEDED', message: 'channel limit reached' };
        }
    } else if (data.action === 'unsubscribe') {
        if (!isMatchingString(data.channelId, CHANNEL_ID_PATTERN)) {
            return { code: 'INVALID_CHANNEL_ACTION', message: 'unsubscribe channelId is invalid' };
        }
    } else if (data.action === 'enable_depth_view') {
        if (!isMatchingString(data.symbol, CHANNEL_SYMBOL_PATTERN)) {
            return { code: 'INVALID_CHANNEL_ACTION', message: 'depth symbol is invalid' };
        }
    } else if (data.action === 'load_chart_history') {
        // The page size is bounded to what one klines read serves, so a renderer
        // cannot turn one scroll into an unbounded read at the exchange.
        if (!isMatchingString(data.symbol, CHANNEL_SYMBOL_PATTERN)
            || !isMatchingString(data.interval, CHANNEL_INTERVAL_PATTERN)
            || !Number.isSafeInteger(data.endTime) || data.endTime <= 0
            || !Number.isSafeInteger(data.limit)
            || data.limit < 1
            || data.limit > SPOT_CHART_HISTORY_PAGE_ROWS) {
            return { code: 'INVALID_CHANNEL_ACTION', message: 'chart history fields are invalid' };
        }
    }

    return null;
};

const normalizeBinanceCandle = (candle) => ({
    time: Math.floor(candle[0] / 1000), // Open time
    open: parseFloat(candle[1]),
    high: parseFloat(candle[2]),
    low: parseFloat(candle[3]),
    close: parseFloat(candle[4]),
    volume: parseFloat(candle[5]),
    isFinal: true, // REST klines are final
});

const normalizeStreamCandle = (kline) => ({
    time: Math.floor(kline.t / 1000),
    open: parseFloat(kline.o),
    high: parseFloat(kline.h),
    low: parseFloat(kline.l),
    close: parseFloat(kline.c),
    volume: parseFloat(kline.v),
    isFinal: kline.x,
});

const extractStreamPayload = (rawMessage) => {
    try {
        const parsed = JSON.parse(rawMessage);
        return parsed?.data ?? parsed;
    } catch (error) {
        logger.error("Failed to parse WebSocket payload:", error);
        return null;
    }
};

/**
 * Rate Limiter for Binance API calls
 * Binance limits: ~1200 weight per minute for REST API
 * We use a conservative limit to avoid hitting the cap
 * 
 * Key features:
 * - 500ms hard-coded delay before each request (prevents burst)
 * - Weight-based capacity check (800 weight per minute)
 * - Automatic retry on network errors (ECONNRESET, etc.)
 */
const createAbortError = () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    return error;
};

const throwIfAborted = (signal) => {
    if (signal?.aborted) throw createAbortError();
};

const waitForDelay = (delayMs, signal) => {
    if (!signal) return new Promise(resolve => setTimeout(resolve, delayMs));
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', handleAbort);
            resolve();
        }, delayMs);
        const handleAbort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', handleAbort);
            reject(createAbortError());
        };
        signal.addEventListener('abort', handleAbort, { once: true });
    });
};

const waitForPromise = (promise, signal) => {
    if (!signal) return promise;
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', handleAbort);
            callback(value);
        };
        const handleAbort = () => finish(reject, createAbortError());
        signal.addEventListener('abort', handleAbort, { once: true });
        Promise.resolve(promise).then(
            value => finish(resolve, value),
            error => finish(reject, error),
        );
    });
};

export class RateLimiter {
    constructor(maxWeight = 800, windowMs = 60000, requestDelayMs = 500) {
        this.maxWeight = maxWeight;        // Max weight per window (conservative)
        this.windowMs = windowMs;          // Window size in ms (1 minute)
        this.requestDelayMs = requestDelayMs; // Hard-coded delay before each request
        this.requests = [];                // Track { timestamp, weight }
        this.lastRequestTime = 0;          // Last request timestamp for spacing
        // Serialize only admission/reservation. Once admitted, operations remain
        // independent, so one slow read cannot suppress unrelated resources.
        this.admissionTail = Promise.resolve();
    }

    /**
     * Clean up old requests outside the window
     */
    cleanup() {
        const now = Date.now();
        this.requests = this.requests.filter(r => now - r.timestamp < this.windowMs);
    }

    /**
     * Get current weight used in the window
     */
    getCurrentWeight() {
        this.cleanup();
        return this.requests.reduce((sum, r) => sum + r.weight, 0);
    }

    /**
     * Wait until we have capacity for the given weight
     */
    async waitForCapacity(weight, signal) {
        throwIfAborted(signal);
        const currentWeight = this.getCurrentWeight();
        if (currentWeight + weight <= this.maxWeight) {
            return; // We have capacity
        }

        // Calculate wait time based on oldest request
        if (this.requests.length === 0) return;

        const oldestRequest = this.requests[0];
        const waitTime = this.windowMs - (Date.now() - oldestRequest.timestamp) + 100; // +100ms buffer

        if (waitTime > 0) {
            logger.debug(`Rate limiter: waiting ${waitTime}ms (current weight: ${currentWeight}/${this.maxWeight})`);
            await waitForDelay(waitTime, signal);
        }

        // Recursive check after waiting
        return this.waitForCapacity(weight, signal);
    }

    /**
     * Ensure minimum delay between requests
     */
    async enforceDelay(signal) {
        throwIfAborted(signal);
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < this.requestDelayMs) {
            await waitForDelay(this.requestDelayMs - elapsed, signal);
        }
        throwIfAborted(signal);
        this.lastRequestTime = Date.now();
    }

    /**
     * Atomically wait for capacity, apply spacing, and reserve request weight.
     */
    async reserve(weight, signal) {
        const previousAdmission = this.admissionTail;
        let releaseAdmission;
        const admissionGate = new Promise(resolve => {
            releaseAdmission = resolve;
        });
        this.admissionTail = previousAdmission.then(
            () => admissionGate,
            () => admissionGate,
        );

        try {
            await waitForPromise(previousAdmission, signal);
            await this.waitForCapacity(weight, signal);
            await this.enforceDelay(signal);
            throwIfAborted(signal);
            this.requests.push({ timestamp: Date.now(), weight });
        } finally {
            releaseAdmission();
        }
    }

    /**
     * Execute a function with rate limiting
     * @param {Function} fn - Async function to execute
     * @param {number} weight - Weight of this request (default 1)
     * @param {number} maxRetries - Max retries on network errors (default 2)
     */
    async execute(fn, weight = 1, maxRetries = 2, { signal } = {}) {
        await this.reserve(weight, signal);

        // Execute with retry on network errors
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                throwIfAborted(signal);
                return await fn();
            } catch (err) {
                lastError = err;
                if (err?.name === 'AbortError') throw err;
                if (signal?.aborted) throw createAbortError();
                const isNetworkError = err?.code === 'ECONNRESET' ||
                                       err?.code === 'ETIMEDOUT' ||
                                       err?.code === 'ENOTFOUND' ||
                                       err?.code === 'ECONNREFUSED' ||
                                       err?.message?.includes('socket disconnected') ||
                                       err?.message?.includes('network');
                // Binance -1021: the signed request's timestamp fell outside the
                // recvWindow (clock drift or a delayed send). A retry rebuilds the
                // request with a FRESH timestamp, so it usually succeeds. Safe even
                // for newOrder/deleteOrder: -1021 means the request was rejected
                // before any matching, so no duplicate order can result.
                const isTimestampError = err?.code === -1021 ||
                                       err?.message?.includes('recvWindow') ||
                                       err?.message?.includes('Timestamp for this request');

                if ((isNetworkError || isTimestampError) && attempt < maxRetries) {
                    const retryDelay = isTimestampError ? 250 : 1000 * (attempt + 1); // ts: quick retry; net: 1s,2s
                    const kind = isTimestampError ? 'timestamp/recvWindow' : 'network';
                    logger.warn(`${kind} error (${err.code || 'unknown'}), retrying in ${retryDelay}ms (attempt ${attempt + 1}/${maxRetries})`);
                    await waitForDelay(retryDelay, signal);
                    continue;
                }
                throw err;
            }
        }
        throw lastError;
    }
}

const legacySpotRateLimiter = new RateLimiter(800, 60000, 500);
const rateLimiter = {
    get maxWeight() {
        return legacySpotRateLimiter.maxWeight;
    },
    getCurrentWeight: () => legacySpotRateLimiter.getCurrentWeight(),
    execute: (...args) => legacySpotRateLimiter.execute(...args),
};

// recvWindow for SIGNED REST requests. The @binance/spot lib stamps the request
// timestamp from Date.now() at send time and does NOT set recvWindow, so it
// defaults to Binance's strict 5000ms — easily exceeded by modest clock drift or
// a send delayed behind a busy event loop, yielding -1021 "Timestamp ... outside
// of the recvWindow". 60000ms is the maximum Binance allows and absorbs latency
// and clock-behind drift. (A local clock running AHEAD by >1s is rejected
// regardless of recvWindow — see the startup clock-drift warning.)
const SIGNED_RECV_WINDOW = 60000;

// WebSocket connection throttle (500ms between new connections)
let lastWsConnectionTime = 0;
const WS_CONNECTION_MIN_INTERVAL = 500; // 500ms between new WS connections

const throttleWsConnection = async () => {
    const now = Date.now();
    const elapsed = now - lastWsConnectionTime;
    if (elapsed < WS_CONNECTION_MIN_INTERVAL) {
        await new Promise(resolve => setTimeout(resolve, WS_CONNECTION_MIN_INTERVAL - elapsed));
    }
    lastWsConnectionTime = Date.now();
};

const resolveProxyAgent = () => {
    const proxyUrl =
        process.env.https_proxy ||
        process.env.HTTPS_PROXY ||
        process.env.http_proxy ||
        process.env.HTTP_PROXY;

    if (!proxyUrl) return null;

    try {
        const protocol = new URL(proxyUrl).protocol.replace(':', '').toLowerCase();
        let agent;
        if (protocol.startsWith('socks')) {
            agent = new SocksProxyAgent(proxyUrl);
        } else if (protocol === 'http' || protocol === 'https') {
            agent = new HttpsProxyAgent(proxyUrl);
        }

        if (agent) {
            agent.toJSON = () => ({
                proxy: proxyUrl,
                protocol
            });
            return agent;
        }
        logger.warn(`Unsupported proxy protocol "${protocol}" for URL: ${proxyUrl}`);
    } catch (err) {
        logger.error("Failed to parse proxy URL:", proxyUrl, err);
    }
    return null;
};

const extractTickerFields = (source = {}) => ({
    symbol: source.symbol || source.s,
    lastPrice: source.lastPrice || source.c,
    priceChangePercent: source.priceChangePercent || source.P,
    highPrice: source.highPrice || source.h,
    lowPrice: source.lowPrice || source.l,
    quoteVolume: source.quoteVolume || source.q,
    closeTime: source.closeTime || source.C
});

const tickerCache = {
    entries: [],
    indexMap: new Map(),
    reset(entries = []) {
        this.entries = entries.map((entry, idx) => {
            const normalized = extractTickerFields(entry);
            this.indexMap.set(normalized.symbol, idx);
            return normalized;
        });
    },
    upsert(entry) {
        const normalized = extractTickerFields(entry);
        if (!normalized.symbol) return null;
        let index = this.indexMap.get(normalized.symbol);
        if (index === undefined) {
            index = this.entries.length;
            this.indexMap.set(normalized.symbol, index);
            this.entries.push(normalized);
        } else {
            this.entries[index] = { ...this.entries[index], ...normalized };
        }
        return { index, entry: this.entries[index] };
    }
};
let tickerSnapshotPromise = null;

const applyLogMasking = (() => {
    let applied = false;
    return (secrets) => {
        if (applied) return;
        const needles = secrets.filter((value) => typeof value === 'string' && value.length > 0);
        if (!needles.length) return;
        const sanitizeChunk = (chunk) => {
            let output;
            if (typeof chunk === 'string') {
                output = chunk;
            } else if (Buffer.isBuffer(chunk)) {
                output = chunk.toString('utf8');
            } else {
                return chunk;
            }
            needles.forEach((secret) => {
                output = output.split(secret).join('SECURED');
            });
            if (typeof chunk === 'string') return output;
            if (Buffer.isBuffer(chunk)) return Buffer.from(output, 'utf8');
            return chunk;
        };
        const wrapStream = (stream) => {
            const originalWrite = stream.write.bind(stream);
            stream.write = (chunk, encoding, callback) => {
                try {
                    const sanitizedChunk = sanitizeChunk(chunk);
                    return originalWrite(sanitizedChunk, encoding, callback);
                } catch {
                    return originalWrite(chunk, encoding, callback);
                }
            };
        };
        wrapStream(process.stdout);
        wrapStream(process.stderr);
        applied = true;
    };
})();

// Which lane a frame leaves on is stated where it is sent, by the code that
// knows what the frame is — not derived at the far end from its shape, and not
// guessed here. Account traffic is the default: mistaking market data for
// account traffic costs the desk an optimization, mistaking account traffic for
// market data costs the operator a fill.
const ACCOUNT_FRAME = Object.freeze({ lane: RENDERER_OUTBOX_LANES.ACCOUNT });
const marketFrame = (resource, symbol = null, { supersede = false, variant = null } = {}) => (
    Object.freeze({
        lane: RENDERER_OUTBOX_LANES.MARKET,
        resource,
        symbol,
        variant,
        supersede,
    })
);

// A book, a header, a tape and a candle series each state the whole of what they
// are, so a newer frame says everything an undelivered older one said and may
// stand in its place. The three left out cannot: a catalog arrives in pages a
// renderer assembles by offset, a history page is the answer to one request, and
// a status line names a cause that the next line does not repeat.
const SUPERSEDABLE_WORKSTATION_RESOURCES = new Set(['depth', 'header', 'candles', 'trades']);

// The whole workstation is market data — its account traffic goes out on the
// futures envelopes, not on this channel. Kept in one lane and in one order, so
// a status line still arrives after the book it describes.
const workstationFrameDelivery = payload => marketFrame(
    typeof payload?.resource === 'string' ? payload.resource : null,
    typeof payload?.symbol === 'string' ? payload.symbol : null,
    {
        supersede: SUPERSEDABLE_WORKSTATION_RESOURCES.has(payload?.resource),
        // The contract's own series and the index series replace themselves
        // independently; one is not a newer statement of the other.
        variant: typeof payload?.payload?.series === 'string' ? payload.payload.series : null,
    },
);

// Every renderer connection carries one of these from the moment it is accepted.
// Held beside the connection rather than on it, so nothing this desk sends can
// collide with a property the WebSocket library owns.
const rendererOutboxes = new WeakMap();

const sendFrameText = (connection, text, delivery = ACCOUNT_FRAME) => {
    const outbox = rendererOutboxes.get(connection);
    if (outbox) return outbox.send(text, delivery);
    if (connection && connection.connected) {
        connection.sendUTF(text);
        return true;
    }
    return false;
};

const sendJSON = (connection, payload, delivery = ACCOUNT_FRAME) => {
    if (!connection || !connection.connected) return false;
    return sendFrameText(connection, JSON.stringify(payload), delivery);
};

// Simple Depth Cache to maintain order book state
class DepthCache {
    constructor() {
        this.bids = {};
        this.asks = {};
        this.lastUpdateId = 0;
    }

    snapshot(depth) {
        this.lastUpdateId = depth.lastUpdateId;
        this.bids = {};
        this.asks = {};
        depth.bids.forEach(([price, qty]) => {
            if (parseFloat(qty) > 0) this.bids[price] = qty;
        });
        depth.asks.forEach(([price, qty]) => {
            if (parseFloat(qty) > 0) this.asks[price] = qty;
        });
    }

    update(depthUpdate) {
        if (depthUpdate.u <= this.lastUpdateId) return;

        depthUpdate.b.forEach(([price, qty]) => {
            if (parseFloat(qty) === 0) delete this.bids[price];
            else this.bids[price] = qty;
        });
        depthUpdate.a.forEach(([price, qty]) => {
            if (parseFloat(qty) === 0) delete this.asks[price];
            else this.asks[price] = qty;
        });
        this.lastUpdateId = depthUpdate.u;
    }

    getFormatted() {
        const formatSide = (book, comparator) => {
            const sorted = Object.keys(book).sort((a, b) => comparator(parseFloat(a), parseFloat(b)));
            return sorted.reduce((acc, price) => {
                acc[price] = book[price];
                return acc;
            }, {});
        };

        return {
            bids: formatSide(this.bids, (a, b) => b - a),
            asks: formatSide(this.asks, (a, b) => a - b)
        };
    }
}

const safeDisconnect = async (socket, label) => {
    if (!socket) return;
    const closer =
        typeof socket.disconnect === 'function'
            ? socket.disconnect.bind(socket)
            : typeof socket.close === 'function'
                ? socket.close.bind(socket)
                : null;
    if (!closer) return;
    try {
        await closer();
    } catch (err) {
        logger.warn(`Failed to close ${label}:`, err);
    }
};

export function setupBinanceConnection({
    localWebSocketAccess = createLocalWebSocketAccess(),
    // Where the desk's own diagnostics are kept. Absent, the desk behaves
    // exactly as it did before there was a record at all.
    diagnosticRecord = DESK_DIAGNOSTICS_UNRECORDED,
} = {}) {
    const credentialPreflight = evaluateBinanceCredentialPreflight(process.env);
    const startupEnvelope = createBinanceStartupEnvelope(credentialPreflight);
    // Spot and Futures authenticate with independent pairs. Every construction
    // gate below reads one of these two flags — never credentialPreflight.ready,
    // which only answers "may any workspace start at all".
    const spotCredentialsReady = credentialPreflight.markets.spot.ready;
    const futuresCredentialsReady = credentialPreflight.markets.futures.ready;
    const APIKEY = spotCredentialsReady ? process.env.BK : null;
    const APISECRET = spotCredentialsReady ? process.env.BS : null;
    const FUTURES_APIKEY = futuresCredentialsReady ? process.env.BFK : null;
    const FUTURES_APISECRET = futuresCredentialsReady ? process.env.BFS : null;
    // The guarded Futures production subsystem is retired: scrub its legacy
    // environment surface so stale launcher values cannot linger in-process.
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('FUTURES_TESTNET_')
            || key.startsWith('FUTURES_READ_')
            || key.startsWith('FUTURES_PRODUCTION_')) {
            delete process.env[key];
        }
    }

    // Futures REST account reads use their own quota bucket so they cannot
    // contend with Spot admission (Binance meters fapi.* separately anyway).
    // fapi allows 2400 weight/min, so 150ms spacing at our tiny read weights
    // stays far inside the quota while keeping READY latency low.
    const futuresRestLimiter = new RateLimiter(800, 60000, 150);

    // Optional fat-finger guard: FUTURES_MAX_ORDER_USDT caps the notional of
    // every exposure-increasing futures order. Unset or invalid = no cap.
    const rawFuturesOrderCap = process.env.FUTURES_MAX_ORDER_USDT;
    const futuresMaxOrderUsdt = (() => {
        if (rawFuturesOrderCap === undefined || rawFuturesOrderCap === '') return null;
        const parsed = Number(rawFuturesOrderCap);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            logger.warn(`Ignoring invalid FUTURES_MAX_ORDER_USDT value: ${rawFuturesOrderCap}`);
            return null;
        }
        return parsed;
    })();
    if (futuresMaxOrderUsdt !== null) {
        logger.info(`Futures order cap active: ${futuresMaxOrderUsdt} USDT per order`);
    }

    const sharedProxyAgent = credentialPreflight.ready ? resolveProxyAgent() : null;
    applyLogMasking([
        APIKEY,
        APISECRET,
        FUTURES_APIKEY,
        FUTURES_APISECRET,
    ]);

    logger.info(`Starting Binance Service. Startup state: ${credentialPreflight.state}`);
    for (const market of [credentialPreflight.markets.spot, credentialPreflight.markets.futures]) {
        if (market.ready) {
            logger.info(`[startup] ${market.label}: READY`);
        } else {
            logger.error(`[startup] ${market.label}: ${market.code}: ${market.message}`);
        }
    }

    let client;
    let spotTradingAdapter = null;
    let futuresTradingAdapter = null;

    const ensureTickerSnapshot = async () => {
        if (!client) return [];
        if (tickerCache.entries.length) {
            return tickerCache.entries;
        }
        if (tickerSnapshotPromise) {
            await tickerSnapshotPromise;
            return tickerCache.entries;
        }

        tickerSnapshotPromise = (async () => {
            const tickerResponse = await client.restAPI.ticker24hr();
            const tickerData = await tickerResponse.data();
            const normalizedTicker = Array.isArray(tickerData) ? tickerData : [tickerData];
            tickerCache.reset(normalizedTicker);
        })();

        try {
            await tickerSnapshotPromise;
            return tickerCache.entries;
        } finally {
            tickerSnapshotPromise = null;
        }
    };

    if (futuresCredentialsReady) {
        futuresTradingAdapter = new FuturesTradingAdapter({
            apiKey: FUTURES_APIKEY,
            apiSecret: FUTURES_APISECRET,
            recvWindow: SIGNED_RECV_WINDOW,
            proxyAgent: sharedProxyAgent,
        });
    }

    if (spotCredentialsReady) {
        const restConfig = {
            apiKey: APIKEY,
            apiSecret: APISECRET,
            keepAlive: false,  // Disable keepAlive to avoid axios agent issues
            compression: false, // Disable compression headers
            timeout: 10000      // Increase timeout to 10 seconds
        };

        if (sharedProxyAgent) {
            restConfig.httpsAgent = sharedProxyAgent;
        }

        client = new Spot({
            configurationRestAPI: restConfig,
            configurationWebsocketStreams: sharedProxyAgent ? { agent: sharedProxyAgent } : {}
        });
        spotTradingAdapter = new SpotTradingAdapter({
            client,
            recvWindow: SIGNED_RECV_WINDOW,
        });

        const restBaseOptions = client?.restAPI?.configuration?.baseOptions;
        if (restBaseOptions) {
            restBaseOptions.proxy = false;
            if (sharedProxyAgent) {
                restBaseOptions.httpsAgent = sharedProxyAgent;
            }
            if (!restBaseOptions.headers) {
                restBaseOptions.headers = {};
            }
            delete restBaseOptions.headers['Content-Type'];
        }

        // Suppress verbose axios logging from @binance/spot library
        // The library logs "Axios Request Args" on every request - intercept and silence
        const axiosInstance = client?.restAPI?.axiosInstance;
        if (axiosInstance?.interceptors) {
            axiosInstance.interceptors.request.use(
                (config) => config, // Just pass through, don't log
                (error) => Promise.reject(error)
            );
        }
    }

    // Suppress @binance/spot verbose console output globally
    // This library logs every axios request args to console
    const originalConsoleLog = console.log;
    console.log = (...args) => {
        // Filter out "Axios Request Args" and similar verbose library output
        const firstArg = args[0];
        if (typeof firstArg === 'string' && 
            (firstArg.includes('Axios Request Args') || 
             firstArg.includes('Axios Response Data'))) {
            return; // Suppress this log
        }
        originalConsoleLog.apply(console, args);
    };

    // One-time clock-drift diagnostic. Signed requests fail with -1021 when the
    // local clock differs from Binance server time beyond the recvWindow. We can't
    // override the library's Date.now()-based timestamp, so surface a clear,
    // actionable warning (recvWindow already absorbs latency / clock-behind drift,
    // but a clock running AHEAD by >1s is rejected regardless).
    const checkClockDrift = async () => {
        if (!spotCredentialsReady || !client) return;
        try {
            const sentAt = Date.now();
            const serverTime = Number(await spotTradingAdapter.getServerTime());
            if (!Number.isFinite(serverTime)) return;
            // Compare server time to the request's midpoint to cancel out round-trip.
            const localMid = sentAt + (Date.now() - sentAt) / 2;
            const drift = Math.round(localMid - serverTime); // +ve = local ahead
            if (Math.abs(drift) > 1000) {
                logger.warn(`[clock] Local clock is ${Math.abs(drift)}ms ${drift > 0 ? 'AHEAD of' : 'BEHIND'} Binance server time. Signed requests use recvWindow=${SIGNED_RECV_WINDOW}ms; a clock running AHEAD by >1s causes -1021 "Timestamp ... outside of the recvWindow" errors that recvWindow cannot fix — sync your system clock (e.g. enable NTP).`);
            } else {
                logger.info(`[clock] Clock drift vs Binance server time: ${drift}ms (within tolerance).`);
            }
        } catch (err) {
            logger.debug('[clock] Could not check Binance server time:', err?.code || err?.message);
        }
    };
    void checkClockDrift();

    const websocketServerPort = resolveLocalWebSocketPort(localWebSocketAccess.port);
    const websocketServerHost = localWebSocketAccess.host || LOCAL_WEBSOCKET_HOST;
    const server = http.createServer((request, response) => {
        response.writeHead(404);
        response.end();
    });

    server.listen(websocketServerPort, websocketServerHost, () => {
        logger.info(`Websocket is listening on ${websocketServerHost}:${websocketServerPort}`);
    });

    const wsServer = new WebSocketServer({
        httpServer: server,
        autoAcceptConnections: false,
        maxReceivedFrameSize: LOCAL_RENDERER_WS_MAX_FRAME_BYTES,
        maxReceivedMessageSize: LOCAL_RENDERER_WS_MAX_MESSAGE_BYTES,
    });

    // ============================================================
    // SHARED state across all renderer connections
    // These Binance sockets are created ONCE and shared by all renderers
    // ============================================================
    let globalWsConnection = null;      // Ticker stream (!ticker@arr)
    let userDataWsConnection = null;    // User data stream (orders/balances)
    let keepAliveInterval = null;
    let tickerStallInterval = null;     // Watchdog interval for the ticker stream
    let globalSocketsInitialized = false;
    const rendererConnections = new Set();  // Track all connected renderers
    const spotRendererConnections = new Set();
    const futuresRendererConnections = new Set();

    // Broadcast to all connected renderers
    const broadcastToRenderers = (payload, delivery = ACCOUNT_FRAME) => {
        const message = JSON.stringify(payload);
        for (const conn of rendererConnections) {
            sendFrameText(conn, message, delivery);
        }
    };

    const stopSharedSpotConnections = async () => {
        globalSocketsInitialized = false;
        if (tickerStallInterval) {
            clearInterval(tickerStallInterval);
            tickerStallInterval = null;
        }
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
            keepAliveInterval = null;
        }
        const staleGlobal = globalWsConnection;
        const staleUserData = userDataWsConnection;
        globalWsConnection = null;
        userDataWsConnection = null;
        await Promise.all([
            safeDisconnect(staleGlobal, 'global stream'),
            safeDisconnect(staleUserData, 'user data stream'),
        ]);
    };

    // Shared balance refresh - fetches via REST and broadcasts to all renderers
    // Deduplicated by in-flight guard to avoid duplicate calls from rapid events
    let _balanceRefreshInFlight = false;
    const fetchAndBroadcastBalances = async () => {
        if (!spotTradingAdapter) return;
        if (_balanceRefreshInFlight) return;
        _balanceRefreshInFlight = true;
        try {
            const balanceOperation = spotTradingAdapter.getAccountRefreshOperations()
                .find(({ type }) => type === 'balances');
            await rateLimiter.execute(async () => {
                const payload = await balanceOperation.loadPayload();
                broadcastToRenderers(payload);
            }, balanceOperation.weight);
        } catch (error) {
            logger.error("Broadcast balance fetch error:", error);
        } finally {
            _balanceRefreshInFlight = false;
        }
    };

    // ============================================================
    // Futures trading (spot-parity path, separate BFK/BFS credentials)
    // ============================================================
    // In-memory pause toggle: blocks new futures orders (cancels stay allowed)
    // until the operator resumes. Deliberately not persisted anywhere.
    let futuresTradingPaused = false;
    const broadcastFuturesTradingPaused = () => {
        broadcastToRenderers({
            futures_trading_paused: futuresTradingPaused,
            futures_max_order_usdt: futuresMaxOrderUsdt === null
                ? null
                : String(futuresMaxOrderUsdt),
        });
    };

    // How far back "which contracts did this account trade" reaches. Income
    // history is the only read that answers it without naming a symbol first;
    // every other history endpoint on USDⓈ-M requires one.
    const FUTURES_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    // The part of that window a session review is actually about, walked first
    // and on its own. Income is paged from the *oldest* end of whatever range it
    // is given — Binance offers no other direction — so a single walk across the
    // week spends its page budget on last Tuesday and never reaches this
    // morning. An account that realizes more than four thousand times a week
    // therefore discovered no contract it traded today, and the review covered
    // only what the account still holds a position or an order on.
    const FUTURES_HISTORY_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
    // Each contract costs two signed reads at weight 5. Twelve is a session's worth
    // of contracts against a 800/minute budget — eight was not: the contract on
    // screen, the contracts holding positions and the contracts holding working
    // orders are seeded first, and a desk in three positions with four resting
    // orders had spent seven of the eight before the traded-symbol read was
    // consulted at all. What is still dropped is reported in the payload, not only
    // logged, because a bounded list that does not say so reads as a complete one.
    const FUTURES_HISTORY_MAX_SYMBOLS = 12;
    // Leverage per open position is a different read with a different budget; it
    // is bounded on its own so that widening the history fan-out does not widen it.
    const FUTURES_POSITION_CONFIG_MAX_SYMBOLS = 8;
    // How long a contract's leverage and margin mode are held before an
    // automatic refresh reads them again. Long enough that a busy minute pays
    // nothing for them, short enough that a leverage changed in Binance's own
    // app appears on its own — selecting the contract still reads it at once.
    const FUTURES_SYMBOL_CONFIG_HOLD_MS = 10 * 60 * 1000;
    // Income is paged forward from the oldest end of the window. The pages are
    // bounded: this walks to the recent end of a busy week, it does not download it.
    const FUTURES_INCOME_MAX_PAGES = 4;
    // How long the contracts an income walk found are held before it is walked
    // again. The walk costs up to eight pages at weight 30 — the most expensive
    // thing a review does — and it answers a question that only moves when a
    // trade is made somewhere other than this desk. Trades made here seed the
    // fan-out directly and need no walk at all.
    const FUTURES_HISTORY_DISCOVERY_HOLD_MS = 10 * 60 * 1000;
    const FUTURES_HISTORY_READ_WEIGHT = 5;
    const FUTURES_INCOME_READ_WEIGHT = 30;
    const FUTURES_SYMBOL_CONFIG_WEIGHT = 5;
    const FUTURES_LEVERAGE_BRACKET_WEIGHT = 1;
    // "No need to change margin type" — Binance's answer when the contract is
    // already in the requested mode. The state asked for is the state held.
    const FUTURES_MARGIN_TYPE_UNCHANGED_CODE = -4046;

    let _futuresAccountRefreshInFlight = false;
    let futuresAccountResources = createInitialFuturesAccountResources();
    // Which orders the stream has reported settled. It keeps a late report from
    // putting one back, and keeps a read that left before the settle from doing
    // the same — now that a fill no longer drags an account-wide read behind it,
    // that read can be older than the stream.
    const futuresSettledOrders = new FuturesSettledOrderMemory();
    // The other half of the same guard: what the stream has reported *working*,
    // and when, so a read that left before that report does not remove it.
    const futuresStreamedOrders = new FuturesStreamedOrderMemory();
    // Leverage and margin mode per contract. /fapi/v3/positionRisk reports neither
    // any more, so without this read nothing on the desk can state the leverage a
    // position is carried at — or set it.
    const futuresSymbolConfigs = new Map();
    // When each of them was read. Leverage and margin mode change when somebody
    // sets them — this desk, which reads them straight back, or the operator in
    // Binance's own app, which no stream reports. Re-reading every position's
    // contract on every automatic refresh spent up to 40 weight of an
    // 800-weight minute re-asking a question whose answer changes a few times a
    // day. What is held is reused until it is old enough that a change made
    // elsewhere is worth looking for — the renderer's 30-second beat and the
    // operator's refresh are the same command, so time held is what separates
    // "read again" from "read every time".
    const futuresSymbolConfigReadAt = new Map();
    const futuresAccountPayloadKeys = Object.freeze({
        balances: 'futures_balances',
        positions: 'futures_positions',
        regularOrders: 'futures_regular_orders',
        algoOrders: 'futures_algo_orders',
    });
    const broadcastFuturesAccountState = () => {
        // Versioned renderer contract: futures_account_state.
        broadcastToRenderers(createFuturesAccountStateEnvelope(futuresAccountResources));
    };

    // Sent per contract rather than as one map: the reads arrive one symbol at a
    // time — the contract on screen, then each open position — and a renderer that
    // merges them keeps the answers it already has.
    const broadcastFuturesSymbolConfigs = (configs) => {
        const entries = configs.filter(config => config !== null);
        if (entries.length === 0) return;
        broadcastToRenderers({
            futures_symbol_configs: Object.fromEntries(entries.map(config => [config.symbol, config])),
        });
    };

    // What the account is set to for one contract: the leverage, its ceiling and
    // the margin mode. The ceiling comes from the contract's own leverage bracket,
    // which is what Binance refuses a higher setting against.
    // Guarded by the same epoch as every other account read: a read that began
    // before a leverage change lands after it carrying the multiple the contract
    // used to be set at, and there is nothing behind it to correct the record until
    // the next refresh. A read that outlived its market activation is dropped for
    // the same reason.
    const heldFuturesSymbolConfig = (symbol) => {
        const key = String(symbol ?? '').toUpperCase();
        const readAt = futuresSymbolConfigReadAt.get(key);
        if (!Number.isFinite(readAt)
            || Date.now() - readAt >= FUTURES_SYMBOL_CONFIG_HOLD_MS) return null;
        return futuresSymbolConfigs.get(key) ?? null;
    };

    const forgetFuturesSymbolConfigs = () => {
        futuresSymbolConfigs.clear();
        futuresSymbolConfigReadAt.clear();
    };

    const readFuturesSymbolConfig = async (symbol, { withCeiling = false } = {}) => {
        if (!futuresTradingAdapter || !symbol) return null;
        const epoch = futuresMutationEpoch;
        const activation = futuresActivationGeneration;
        const superseded = () => epoch !== futuresMutationEpoch
            || activation !== futuresActivationGeneration;
        try {
            const config = await futuresRestLimiter.execute(
                () => futuresTradingAdapter.getSymbolConfig(symbol),
                FUTURES_SYMBOL_CONFIG_WEIGHT,
            );
            if (config === null || superseded()) return null;
            const ceiling = withCeiling
                ? await futuresRestLimiter.execute(
                    () => futuresTradingAdapter.getMaxLeverage(symbol),
                    FUTURES_LEVERAGE_BRACKET_WEIGHT,
                ).catch(() => null)
                : futuresSymbolConfigs.get(config.symbol)?.maxLeverage ?? null;
            if (superseded()) return null;
            // A bracket read that failed does not un-know a ceiling that was read
            // before it: the panel would silently offer the whole 1–125 range.
            const entry = {
                ...config,
                maxLeverage: ceiling ?? futuresSymbolConfigs.get(config.symbol)?.maxLeverage ?? null,
            };
            futuresSymbolConfigs.set(entry.symbol, entry);
            futuresSymbolConfigReadAt.set(entry.symbol, Date.now());
            return entry;
        } catch (error) {
            logger.warn(`[futures-config] ${symbol} configuration read failed:`, error?.code || error?.message);
            return null;
        }
    };

    // positionRisk is only re-read on an account event, so without this the
    // desk's mark, size and uPnL would stand still while the chart moves. The
    // stream is public: no credentials, no REST weight, no account writes.
    const futuresMarkPriceFeed = futuresCredentialsReady
        ? createFuturesMarkPriceFeed({
            streamOrigin: FUTURES_STREAM_ORIGIN,
            createSocket: url => new WebSocket(url, {
                agent: sharedProxyAgent ?? undefined,
                handshakeTimeout: 10_000,
            }),
            broadcast: broadcastToRenderers,
            logger,
        })
        : null;

    // Bumped once per confirmed mutating command. A snapshot carries the epoch
    // it began under, so a read that started before a place, amend or cancel can
    // be recognised as describing a world that no longer exists and dropped,
    // instead of restoring the state that command just replaced.
    let futuresMutationEpoch = 0;
    // Bumped whenever the Futures market is deactivated, so a read that began
    // under an earlier activation cannot land on a desk that has moved on.
    let futuresActivationGeneration = 0;
    // The contracts the last income walk found, and when it found them.
    let futuresHistoryDiscovery = null;
    // A contract can be skipped only when one uninterrupted authenticated
    // stream interval has vouched for it since a successful REST reading. The
    // epoch invalidates every proof at once; revisions make a stream event that
    // races a REST read impossible to clear accidentally.
    let futuresHistoryStreamConnected = false;
    let futuresHistoryStreamEpoch = 0;
    let futuresHistoryActivityRevision = 0;
    let futuresHistoryRotationOffset = 0;
    const futuresHistoryActivityBySymbol = new Map();
    const futuresHistoryProofBySymbol = new Map();

    const normalizeFuturesHistoryCursor = (value) => {
        const cursor = typeof value === 'string' ? value.trim() : '';
        return /^\d{1,20}$/.test(cursor) ? cursor : null;
    };

    const normalizeFuturesHistoryIdentity = (value) => {
        if (typeof value === 'string') return normalizeFuturesHistoryCursor(value);
        return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    };

    const invalidateFuturesHistoryStream = () => {
        futuresHistoryStreamConnected = false;
        futuresHistoryStreamEpoch += 1;
    };

    const noteFuturesHistoryActivity = (value) => {
        const symbol = String(value ?? '').trim().toUpperCase();
        if (!symbol) return;
        futuresHistoryActivityRevision += 1;
        futuresHistoryActivityBySymbol.set(symbol, futuresHistoryActivityRevision);
    };

    const futuresHistoryActivityOf = symbol => (
        futuresHistoryActivityBySymbol.get(symbol) ?? 0
    );

    const captureFuturesHistoryProof = symbol => ({
        connected: futuresHistoryStreamConnected,
        epoch: futuresHistoryStreamEpoch,
        activity: futuresHistoryActivityOf(symbol),
    });

    const retainFuturesHistoryProof = (symbol, captured, cursors) => {
        if (!captured.connected
            || !futuresHistoryStreamConnected
            || captured.epoch !== futuresHistoryStreamEpoch
            || captured.activity !== futuresHistoryActivityOf(symbol)) return;
        futuresHistoryProofBySymbol.set(symbol, Object.freeze({
            epoch: captured.epoch,
            activity: captured.activity,
            orderCursor: cursors.orderCursor,
            tradeCursor: cursors.tradeCursor,
        }));
    };

    const futuresHistoryIsVouched = (symbol, held) => {
        if (!futuresHistoryStreamConnected) return false;
        const proof = futuresHistoryProofBySymbol.get(symbol);
        return proof?.epoch === futuresHistoryStreamEpoch
            && proof.activity === futuresHistoryActivityOf(symbol)
            && proof.orderCursor === normalizeFuturesHistoryCursor(held?.orderCursor)
            && proof.tradeCursor === normalizeFuturesHistoryCursor(held?.tradeCursor);
    };

    const forgetFuturesHistoryState = () => {
        invalidateFuturesHistoryStream();
        futuresHistoryActivityBySymbol.clear();
        futuresHistoryProofBySymbol.clear();
        futuresHistoryRotationOffset = 0;
        futuresHistoryDiscovery = null;
    };
    const noteFuturesMutation = () => {
        futuresMutationEpoch += 1;
    };

    // One registry for the whole main process, deliberately outside the
    // per-connection closure: a renderer that drops its socket and reconnects
    // resends the command it believes never left, and the copy arrives on a
    // connection that has no memory of the first. The registry does, and answers
    // the new socket from what the old one was told.
    const tradingCommandRegistry = createTradingCommandRegistry();

    // The leverage of every contract the account is actually holding. Bounded:
    // an account in eight positions is eight reads at weight 5, and a ninth row
    // states no leverage rather than spending the minute's budget on it. The
    // bound applies to what is actually read, so reusing what is held cannot
    // silently widen it.
    const refreshFuturesPositionConfigs = async (positions) => {
        const symbols = [...new Set((Array.isArray(positions) ? positions : [])
            .filter(position => Number(position?.quantity) !== 0)
            .map(position => String(position?.symbol ?? '').toUpperCase())
            .filter(Boolean))];
        if (symbols.length === 0) return;
        // Asked once per symbol: the hold is measured against the clock, so
        // asking twice could put the same contract in both lists on the
        // millisecond it expires.
        const holdings = symbols.map(symbol => [symbol, heldFuturesSymbolConfig(symbol)]);
        const held = holdings
            .filter(([, config]) => config !== null)
            .map(([, config]) => config);
        const unread = holdings
            .filter(([, config]) => config === null)
            .map(([symbol]) => symbol)
            .slice(0, FUTURES_POSITION_CONFIG_MAX_SYMBOLS);
        const configs = await Promise.all(unread.map(symbol => readFuturesSymbolConfig(symbol)));
        broadcastFuturesSymbolConfigs([...held, ...configs]);
    };

    // `resources` names which of them this pass is for; `null` is all four. A
    // fill asks for the wallet and the position it moved — the working orders
    // arrive on the stream that reported the fill, and reading them back cost 80
    // of the pass's 90.
    const runFuturesAccountRefreshPass = async (resources = null) => {
        const requested = resources === null ? null : new Set(resources);
        const operations = futuresTradingAdapter.getAccountRefreshOperations()
            .filter(operation => requested === null || requested.has(operation.type));
        if (operations.length === 0) return;
        const epoch = futuresMutationEpoch;
        const activation = futuresActivationGeneration;

        for (const operation of operations) {
            futuresAccountResources = markFuturesResourceLoading(
                futuresAccountResources,
                operation.type,
            );
        }
        broadcastFuturesAccountState();

        // The signed reads run concurrently: the limiter still spaces their
        // admissions, but the round-trips overlap, so the ticket reaches
        // READY in roughly one round-trip instead of serial endpoint latency.
        await Promise.all(operations.map(operation => futuresRestLimiter.execute(async () => {
            // When this read actually leaves, not when the pass was asked for:
            // anything the stream reports from here on is news the read cannot
            // carry, and that is what the reconciliation below compares against.
            const issuedAt = Date.now();
            const payload = await operation.loadPayload();
            const payloadKey = futuresAccountPayloadKeys[operation.type];
            if (!payloadKey || !Object.hasOwn(payload, payloadKey)) {
                const error = new Error('Invalid Futures account resource payload');
                error.code = 'INVALID_RESOURCE_PAYLOAD';
                throw error;
            }
            // A mutating command landed while this read was in flight. The read
            // predates it, so applying it would undo it. The command queued its
            // own refresh, so nothing is lost by dropping this one. The same
            // goes for a read that outlived the activation it was started under.
            if (epoch !== futuresMutationEpoch || activation !== futuresActivationGeneration) return;
            futuresAccountResources = markFuturesResourceReady(
                futuresAccountResources,
                operation.type,
                // A read that left before the stream spoke describes a world
                // already moved past — in both directions. The settled memory
                // refuses what it lists and should not, the streamed memory
                // restores what it omits and should not.
                operation.type === 'regularOrders'
                    ? reconcileFuturesWorkingOrderRead(
                        futuresAccountResources,
                        payload[payloadKey],
                        {
                            settled: futuresSettledOrders,
                            streamed: futuresStreamedOrders,
                            since: issuedAt,
                        },
                    )
                    : payload[payloadKey],
            );
            if (operation.type === 'positions') {
                futuresMarkPriceFeed?.track(payload[payloadKey]);
                // Every open position's leverage, so the dock can state what each
                // one is carried at. Not awaited: the account state is already
                // correct without it, and this only adds a reading to it.
                void refreshFuturesPositionConfigs(payload[payloadKey]);
            }
            broadcastFuturesAccountState();
        }, operation.weight).catch((error) => {
                if (epoch !== futuresMutationEpoch || activation !== futuresActivationGeneration) return;
                futuresAccountResources = markFuturesResourceFailed(
                    futuresAccountResources,
                    operation.type,
                    error,
                );
                broadcastFuturesAccountState();
                logger.error(`${operation.errorLabel}:`, error?.code || error?.message);
            })));
    };

    // A refresh asked for while one is running used to be discarded outright, so
    // the reconciliation that follows a trade silently never happened and the
    // panel kept showing the pre-trade account until the operator pressed
    // Ctrl+R. It is queued instead: at most one follow-up is pending, because
    // any number of requests collapse into "read the account again once this
    // read finishes".
    // Passes asked for while one runs collapse into the union of what they
    // asked for, never into less: a fill's two resources queued behind a full
    // read must not turn that read into a partial one, and vice versa.
    let _futuresAccountRefreshQueued = false;
    let _futuresAccountRefreshQueuedResources = null;
    const queueFuturesAccountRefresh = (resources) => {
        _futuresAccountRefreshQueued = true;
        if (resources === null || _futuresAccountRefreshQueuedResources === null) {
            _futuresAccountRefreshQueuedResources = null;
            return;
        }
        _futuresAccountRefreshQueuedResources = [
            ...new Set([..._futuresAccountRefreshQueuedResources, ...resources]),
        ];
    };
    const refreshFuturesAccountState = async ({ resources = null } = {}) => {
        broadcastFuturesTradingPaused();
        if (!futuresTradingAdapter) return;
        if (_futuresAccountRefreshInFlight) {
            queueFuturesAccountRefresh(resources);
            return;
        }
        _futuresAccountRefreshInFlight = true;
        try {
            let requested = resources;
            for (;;) {
                _futuresAccountRefreshQueued = false;
                _futuresAccountRefreshQueuedResources = [];
                await runFuturesAccountRefreshPass(requested);
                if (!_futuresAccountRefreshQueued) break;
                requested = _futuresAccountRefreshQueuedResources;
            }
        } finally {
            _futuresAccountRefreshInFlight = false;
            _futuresAccountRefreshQueued = false;
            _futuresAccountRefreshQueuedResources = null;
        }
    };

    // Lazily started the first time the renderer touches futures trading, so
    // spot-only usage (or a key without futures permission) stays quiet.
    let futuresUserDataWs = null;
    let futuresKeepAliveInterval = null;
    let futuresUserDataReconnecting = false;
    let futuresUserDataRequested = false;
    let futuresUserDataGeneration = 0;

    const markFuturesUserDataLoading = () => {
        invalidateFuturesHistoryStream();
        futuresAccountResources = markFuturesResourceLoading(
            futuresAccountResources,
            'userDataStream',
        );
        broadcastFuturesAccountState();
    };
    const markFuturesUserDataReady = () => {
        futuresHistoryStreamConnected = true;
        futuresAccountResources = markFuturesResourceReady(
            futuresAccountResources,
            'userDataStream',
            { connected: true },
        );
        broadcastFuturesAccountState();
    };
    const markFuturesUserDataFailed = (error) => {
        invalidateFuturesHistoryStream();
        futuresAccountResources = markFuturesOrderResourcesStale(
            futuresAccountResources,
            error,
        );
        futuresAccountResources = markFuturesResourceFailed(
            futuresAccountResources,
            'userDataStream',
            error,
        );
        broadcastFuturesAccountState();
    };

    const stopSharedFuturesConnections = async () => {
        // Every Futures read already in flight belongs to an activation that is
        // over. Its result describes a market nobody is on, so it is dropped
        // rather than applied over the state the switch produced.
        futuresActivationGeneration += 1;
        futuresUserDataGeneration += 1;
        futuresUserDataRequested = false;
        futuresUserDataReconnecting = false;
        // A leverage held for an account nobody is on is not a reading, it is a
        // memory. The next activation reads its own. The same goes for which
        // contracts that account traded, and for which of its orders the stream
        // reported settled — that one guards reads against a stream this
        // account no longer has.
        forgetFuturesSymbolConfigs();
        forgetFuturesHistoryState();
        futuresSettledOrders.forget();
        futuresStreamedOrders.forget();
        // No Futures renderer is watching: nothing to mark to market.
        futuresMarkPriceFeed?.track([]);
        if (futuresKeepAliveInterval) {
            clearInterval(futuresKeepAliveInterval);
            futuresKeepAliveInterval = null;
        }
        const staleFuturesUserData = futuresUserDataWs;
        futuresUserDataWs = null;
        await safeDisconnect(staleFuturesUserData, 'futures user data stream');
        futuresAccountResources = markFuturesResourceIdle(
            futuresAccountResources,
            'userDataStream',
        );
        broadcastFuturesAccountState();
    };

    const startFuturesUserDataStream = async (
        retryCount = 0,
        generation = futuresUserDataGeneration,
    ) => {
        const MAX_RETRIES = 5;
        if (!futuresTradingAdapter) return;
        if (generation !== futuresUserDataGeneration) return;
        if (futuresRendererConnections.size === 0) return;
        if (futuresUserDataReconnecting && retryCount === 0) return;
        futuresUserDataReconnecting = true;
        markFuturesUserDataLoading();
        try {
            const listenKey = await futuresRestLimiter.execute(
                () => (generation !== futuresUserDataGeneration
                    || futuresRendererConnections.size === 0
                    ? undefined
                    : futuresTradingAdapter.createUserDataStreamListenKey()),
                1,
            );
            if (!listenKey) {
                futuresUserDataReconnecting = false;
                return;
            }

            await throttleWsConnection();
            if (futuresUserDataWs) {
                const previous = futuresUserDataWs;
                futuresUserDataWs = null;
                if (futuresKeepAliveInterval) {
                    clearInterval(futuresKeepAliveInterval);
                    futuresKeepAliveInterval = null;
                }
                await safeDisconnect(previous, 'previous futures user data stream');
            }
            if (generation !== futuresUserDataGeneration
                || futuresRendererConnections.size === 0) {
                futuresUserDataReconnecting = false;
                return;
            }

            const socket = new WebSocket(`${FUTURES_STREAM_ORIGIN}/ws/${listenKey}`, {
                agent: sharedProxyAgent ?? undefined,
                handshakeTimeout: 10_000,
            });
            futuresUserDataWs = socket;
            futuresUserDataReconnecting = false;

            socket.on('open', () => {
                if (generation !== futuresUserDataGeneration
                    || futuresUserDataWs !== socket) return;
                markFuturesUserDataReady();
                logger.info('Futures user data stream connected.');
                void refreshFuturesAccountState();
            });

            socket.on('message', (data) => {
                const payload = extractStreamPayload(data);
                if (!payload) return;
                const streamEvent = normalizeFuturesUserDataStreamEvent(payload);
                if (!streamEvent) return;
                if (streamEvent.type === 'executionReport') {
                    const report = streamEvent.executionReport;
                    noteFuturesHistoryActivity(report.symbol);
                    logger.info(`[futures-stream] ${report.symbol} ${report.side} ${report.status}`);
                    // The exchange has just said what this order is. Folding it
                    // into the held set is what the account-wide read used to be
                    // for, at weight 40 twice on every fill.
                    const folded = foldFuturesWorkingOrder(futuresAccountResources, report, {
                        settled: futuresSettledOrders,
                        streamed: futuresStreamedOrders,
                    });
                    if (folded !== futuresAccountResources) {
                        futuresAccountResources = folded;
                        broadcastFuturesAccountState();
                    }
                    broadcastToRenderers(streamEvent.rendererPayload);
                }
                if (streamEvent.type === 'listenKeyExpired') {
                    const error = new Error('Futures listen key expired');
                    error.code = 'LISTEN_KEY_EXPIRED';
                    markFuturesUserDataFailed(error);
                    socket.close();
                    return;
                }
                if (streamEvent.shouldRefreshAccount) {
                    void refreshFuturesAccountState({
                        resources: streamEvent.refreshResources ?? null,
                    });
                }
            });
            socket.on('error', (err) => {
                markFuturesUserDataFailed(err);
                logger.warn('Futures user data stream error:', err?.code || err?.message);
            });
            socket.on('close', () => {
                if (futuresUserDataWs !== socket) return;
                futuresUserDataWs = null;
                const error = new Error('Futures user data stream disconnected');
                error.code = 'ECONNRESET';
                markFuturesUserDataFailed(error);
                if (futuresKeepAliveInterval) {
                    clearInterval(futuresKeepAliveInterval);
                    futuresKeepAliveInterval = null;
                }
                if (generation === futuresUserDataGeneration
                    && futuresRendererConnections.size > 0
                    && !futuresUserDataReconnecting) {
                    logger.info('Scheduling futures user data stream reconnection...');
                    setTimeout(() => startFuturesUserDataStream(0, generation), 5000);
                }
            });

            futuresKeepAliveInterval = setInterval(() => {
                if (generation !== futuresUserDataGeneration
                    || futuresRendererConnections.size === 0
                    || futuresUserDataWs !== socket) return;
                void futuresRestLimiter.execute(
                    () => futuresTradingAdapter.renewUserDataStreamListenKey(),
                    1,
                ).catch((err) => {
                    markFuturesUserDataFailed(err);
                    logger.warn('Failed to renew futures listenKey:', err?.code || err?.message);
                });
            }, 30 * 60 * 1000);
        } catch (err) {
            futuresUserDataReconnecting = false;
            markFuturesUserDataFailed(err);
            if (err?.code === -2015 || err?.status === 401) {
                logger.error('Futures listenKey rejected — enable Futures permission on this API key.');
                return;
            }
            if (generation === futuresUserDataGeneration
                && retryCount < MAX_RETRIES
                && futuresRendererConnections.size > 0) {
                const delay = 3000 * (retryCount + 1);
                logger.warn(`Futures user data stream failed (${err?.code || err?.message}), retrying in ${delay}ms`);
                setTimeout(() => startFuturesUserDataStream(retryCount + 1, generation), delay);
            } else {
                logger.error('Failed to start futures user data stream:', err?.code || err?.message);
            }
        }
    };

    const ensureFuturesUserDataStream = () => {
        if (futuresUserDataRequested
            && (futuresUserDataWs || futuresUserDataReconnecting)) return;
        futuresUserDataRequested = true;
        void startFuturesUserDataStream();
    };

    const readFuturesHistoryGap = async ({ cursor, limit, identityOf, load }) => {
        const origin = normalizeFuturesHistoryCursor(cursor);
        if (origin === null) return load(null);

        const rows = [];
        const identities = new Set();
        const newestIdentityFirst = (left, right) => {
            const leftIdentity = normalizeFuturesHistoryIdentity(identityOf(left));
            const rightIdentity = normalizeFuturesHistoryIdentity(identityOf(right));
            if (leftIdentity !== null && rightIdentity !== null) {
                if (leftIdentity === rightIdentity) return 0;
                return BigInt(leftIdentity) > BigInt(rightIdentity) ? -1 : 1;
            }
            if (leftIdentity !== null) return -1;
            if (rightIdentity !== null) return 1;
            return Number(right?.time ?? 0) - Number(left?.time ?? 0);
        };
        let next = origin;
        for (;;) {
            const page = await load(next);
            const entries = Array.isArray(page) ? page : [];
            let furthest = null;
            for (const entry of entries) {
                const identity = normalizeFuturesHistoryIdentity(identityOf(entry));
                if (identity === null) {
                    rows.push(entry);
                    continue;
                }
                if (!identities.has(identity)) {
                    identities.add(identity);
                    rows.push(entry);
                }
                if (furthest === null || BigInt(identity) > BigInt(furthest)) {
                    furthest = identity;
                }
            }
            rows.sort(newestIdentityFirst);
            if (rows.length > limit) rows.length = limit;
            identities.clear();
            for (const entry of rows) {
                const identity = normalizeFuturesHistoryIdentity(identityOf(entry));
                if (identity !== null) identities.add(identity);
            }
            if (entries.length < limit
                || furthest === null
                || BigInt(furthest) <= BigInt(next)) break;
            next = furthest;
        }
        return rows.sort((left, right) => Number(right?.time ?? 0) - Number(left?.time ?? 0));
    };

    const futuresHistoryCursorAfter = (origin, rows, identityOf) => {
        let cursor = normalizeFuturesHistoryCursor(origin);
        for (const row of rows) {
            const identity = normalizeFuturesHistoryIdentity(identityOf(row));
            if (identity !== null
                && (cursor === null || BigInt(identity) > BigInt(cursor))) cursor = identity;
        }
        return cursor;
    };

    const chooseFuturesHistoryReadSymbols = (symbols, coverage, { full = false } = {}) => {
        if (full) return [...symbols];
        const required = new Set(symbols.filter(symbol => (
            !Object.hasOwn(coverage, symbol)
            || !futuresHistoryIsVouched(symbol, coverage[symbol])
        )));
        if (symbols.length === 0 || required.size === symbols.length) {
            return symbols.filter(symbol => required.has(symbol));
        }

        // One skipped contract is proved again on each ordinary refresh. Scan
        // past already-dirty contracts so their mandatory reads do not consume
        // the rotation slot.
        for (let step = 0; step < symbols.length; step += 1) {
            const index = (futuresHistoryRotationOffset + step) % symbols.length;
            const candidate = symbols[index];
            if (required.has(candidate)) continue;
            required.add(candidate);
            futuresHistoryRotationOffset = (index + 1) % symbols.length;
            break;
        }
        return symbols.filter(symbol => required.has(symbol));
    };

    wsServer.on("request", (request) => {
        logger.info("Connection from origin " + request.origin + ".");
        const accessCheck = validateLocalWebSocketRequest(request, localWebSocketAccess);
        if (!accessCheck.allowed) {
            logger.warn(`Rejected local WebSocket request: ${accessCheck.reason}`);
            // A rejected handshake reaches the browser as an anonymous 1006,
            // which is indistinguishable from "the backend has not started
            // yet" — so a renderer holding a token this process will never
            // accept retried it every 500 ms for the whole session. An
            // authentication failure is accepted only to be closed with its own
            // code, which the renderer can read and stop on. Nothing is
            // registered and nothing is ever sent on it.
            if (accessCheck.status === 401) {
                const refused = request.accept(null, request.origin);
                refused.close(LOCAL_WEBSOCKET_AUTH_CLOSE_CODE, 'invalid-token');
                return;
            }
            request.reject(accessCheck.status, accessCheck.reason);
            return;
        }

        const connection = request.accept(null, request.origin);
        logger.info("Connection accepted.");
        
        // Track this renderer connection
        rendererConnections.add(connection);

        // Two lanes out of here from this point on: account traffic ahead of
        // market data, and market data replaced rather than stacked when this
        // renderer is behind. What was replaced is stated to the record when the
        // backlog clears; a renderer that will not take its account traffic at
        // all is closed rather than served a hole in it.
        rendererOutboxes.set(connection, createRendererOutbox(connection, {
            onBacklog: entry => diagnosticRecord.record('backlog', entry),
            onOverflow: () => logger.warn(
                '[renderer-outbox] Closing a renderer that stopped draining its account traffic',
            ),
        }));

        let panelSettings = {};
        let activeRequestId = null;

        // The market this renderer has activated, and the generation that
        // activation belongs to. Work started under an older generation is
        // discarded rather than applied: a switch back to Spot must not be
        // undone by a Futures read that was already in flight.
        let activeMarketMode = MARKET_MODES.UNSELECTED;
        let marketActivationGeneration = 0;

        const marketScopeOf = (data) => {
            if (typeof data?.action === 'string') {
                if (SPOT_CHANNEL_ACTIONS.has(data.action)) return MARKET_MODES.SPOT;
                if (Object.values(TRADING_COMMAND_ACTIONS).includes(data.action)) {
                    return data.marketType === FUTURES_MARKET_TYPE
                        ? MARKET_MODES.FUTURES
                        : MARKET_MODES.SPOT;
                }
                return null;
            }
            return SPOT_LEGACY_REQUESTS.has(data?.request) ? MARKET_MODES.SPOT : null;
        };

        const describeMarketMode = mode => (mode === MARKET_MODES.FUTURES ? 'Futures' : 'Spot');

        // Returns true when the frame was refused, so the caller stops.
        //
        // The market name alone is not enough. Spot → Futures → Spot leaves the
        // mode string equal to what a frame issued before the first switch
        // carries, so that frame passed the gate and acted on a selection the
        // operator had already left twice. Each activation mints a generation and
        // every market-scoped frame carries the one it was issued under.
        const refuseUnlessMarketActive = (label, requiredMode, requestGeneration = null) => {
            if (requiredMode === null) return false;
            if (activeMarketMode === requiredMode) {
                if (requestGeneration === null
                    || requestGeneration === marketActivationGeneration) return false;
                logger.warn(`[market-gate] Refused ${label}: generation ${requestGeneration} is superseded by ${marketActivationGeneration}`);
                emit(createCommandRejection(
                    label,
                    'MARKET_ACTIVATION_SUPERSEDED',
                    'This was issued for an earlier activation of the market — it is no longer current.',
                    {
                        marketType: requiredMode === MARKET_MODES.FUTURES
                            ? FUTURES_MARKET_TYPE
                            : SPOT_MARKET_TYPE,
                        requiredMarketMode: requiredMode,
                        activeMarketMode,
                        generation: marketActivationGeneration,
                    },
                ));
                return true;
            }
            logger.warn(`[market-gate] Refused ${label}: ${requiredMode} is not the activated market`);
            emit(createCommandRejection(
                label,
                'MARKET_NOT_ACTIVE',
                activeMarketMode === MARKET_MODES.UNSELECTED
                    ? `${describeMarketMode(requiredMode)} is not activated yet — activate the market before sending this.`
                    : `${describeMarketMode(requiredMode)} is not the activated market — the operator switched away.`,
                {
                    marketType: requiredMode === MARKET_MODES.FUTURES
                        ? FUTURES_MARKET_TYPE
                        : SPOT_MARKET_TYPE,
                    requiredMarketMode: requiredMode,
                    activeMarketMode,
                },
            ));
            return true;
        };

        const applyMarketActivation = (marketMode) => {
            activeMarketMode = marketMode;
            marketActivationGeneration += 1;
            sendJSON(connection, {
                type: 'market_activation',
                version: 1,
                marketMode: activeMarketMode,
                generation: marketActivationGeneration,
            });
        };

        // Activations run one at a time. Each one tears the other market down
        // before starting its own, and two overlapping runs could interleave
        // those steps and leave the backend on the market the operator left —
        // the older request finishing last and winning.
        let marketActivationChain = Promise.resolve();
        const serializeMarketActivation = (run) => {
            const next = marketActivationChain.then(run, run);
            // A failed activation must not poison the chain for the next one.
            marketActivationChain = next.catch(() => {});
            return next;
        };

        // Channel manager for this connection (each renderer has its own channels)
        const channelManager = new ChannelManager(logger);
        const marketStreamManager = channelManager.getMarketStreamManager();
        const futuresProductionWorkstationRuntime = futuresCredentialsReady
            ? createFuturesProductionWorkstationRuntime({
                onTiming: ({ phase, durationMs, outcome, cache }) => {
                    logger.info(
                        `[futures-production-workstation:timing] ${phase} ${durationMs}ms ${outcome}`
                        + (cache === null ? '' : ` cache=${cache}`),
                    );
                    diagnosticRecord.record('timing', { phase, durationMs, outcome, cache });
                },
                // The faults the desk absorbs without telling the operator: a
                // book that could not bridge, a recovery, a rejected frame, a
                // history read that failed. A timing line says a phase ended
                // badly; only this says what was wrong with it.
                onInternalError: ({ phase, code }) => {
                    logger.warn(`[futures-production-workstation:fault] ${phase} ${code}`);
                    diagnosticRecord.record('fault', { phase, code });
                },
            })
            : null;

        // Spot's counterpart of the Futures mutation epoch. A snapshot that began
        // before a placement or cancellation describes a world that command has
        // already replaced, so emitting it would move the panel backwards.
        let spotMutationEpoch = 0;
        const noteSpotMutation = () => {
            spotMutationEpoch += 1;
        };

        const emitSpotRefreshOperation = async (operation, epoch) => {
            const payload = await operation.loadPayload();
            if (epoch !== spotMutationEpoch) return;
            emit(payload);
        };

        const enqueueSpotRefreshOperation = (operation) => {
            const epoch = spotMutationEpoch;
            return rateLimiter.execute(() => emitSpotRefreshOperation(operation, epoch), operation.weight)
                .catch((err) => logger.error(operation.errorLabel || 'Account Refresh Fetch Error:', err));
        };

        let _spotAccountRefreshInFlight = false;
        let _spotAccountRefreshQueued = null;
        const runSpotAccountRefreshPass = async (symbol) => {
            const epoch = spotMutationEpoch;
            await runSpotAccountRefreshOperations({
                operations: spotTradingAdapter.getAccountRefreshOperations(symbol),
                executeOperation: (operation) => (
                    rateLimiter.execute(() => emitSpotRefreshOperation(operation, epoch), operation.weight)
                ),
                onOperationError: ({ error, errorLabel }) => logger.error(`${errorLabel}:`, error),
            });
        };

        // Queued rather than dropped, for the same reason as Futures: the read
        // that follows a trade is the one that proves what the trade did.
        const refreshAccountState = async (symbol) => {
            if (!spotTradingAdapter) return;
            if (_spotAccountRefreshInFlight) {
                _spotAccountRefreshQueued = { symbol };
                return;
            }
            _spotAccountRefreshInFlight = true;
            try {
                let pending = { symbol };
                while (pending) {
                    _spotAccountRefreshQueued = null;
                    await runSpotAccountRefreshPass(pending.symbol);
                    pending = _spotAccountRefreshQueued;
                }
            } finally {
                _spotAccountRefreshInFlight = false;
                _spotAccountRefreshQueued = null;
            }
        };

        const RECONCILE_ATTEMPTS = 3;
        const RECONCILE_BACKOFF_MS = 500;
        const pause = ms => new Promise((resolve) => { setTimeout(resolve, ms); });

        const describeSpotError = error => (
            error?.response?.data?.msg
            || error?.message
            || 'The Binance Spot request failed.'
        );

        const spotBinanceCode = error => (
            error?.code ?? error?.response?.data?.code ?? null
        );

        /**
         * Spot failures used to reach only the application log, so a refused
         * placement or cancellation was invisible at the desk. They now travel
         * the same road as Futures: a determinate failure is a rejection, an
         * ambiguous one is reconciled against the exchange and never presented
         * as a refusal.
         */
        const reportSpotCommandFailure = async ({
            action,
            label,
            error,
            symbol,
            orderId,
            origClientOrderId,
        }) => {
            logger.error(`${label} error:`, error?.code || error?.message);
            if (error?.response?.data) {
                logger.error(`${label} response:`, error.response.data);
            }

            // The identity travels with every envelope about this command, so a
            // renderer holding an unknown outcome can tell this command's answer
            // from another order's traffic — the rejection that concludes the
            // reconciliation included.
            const identity = {
                symbol: symbol ?? null,
                orderId: orderId ?? null,
                clientOrderId: origClientOrderId ?? null,
            };
            const emitRejection = () => emit(createCommandRejection(
                action,
                'SPOT_API_ERROR',
                describeSpotError(error),
                { marketType: SPOT_MARKET_TYPE, ...identity, binanceCode: spotBinanceCode(error) },
            ));

            if (!isIndeterminateTradingFailure(error)) {
                emitRejection();
                return;
            }
            if (!symbol || !(orderId || origClientOrderId)) {
                emit(createCommandUnresolved(
                    action,
                    'SPOT_OUTCOME_UNKNOWN',
                    UNCONFIRMED_COMMAND_MESSAGE,
                    { marketType: SPOT_MARKET_TYPE, ...identity, reconciled: false },
                ));
                return;
            }

            emit(createCommandUnresolved(
                action,
                'SPOT_OUTCOME_PENDING',
                UNRESOLVED_COMMAND_MESSAGE,
                {
                    marketType: SPOT_MARKET_TYPE,
                    ...identity,
                    binanceCode: spotBinanceCode(error),
                    reconciled: false,
                },
            ));

            for (let attempt = 1; attempt <= RECONCILE_ATTEMPTS; attempt += 1) {
                try {
                    const outcome = await spotTradingAdapter.findOrder({
                        symbol,
                        orderId,
                        origClientOrderId,
                    });
                    if (outcome.exists) {
                        noteSpotMutation();
                        emit({ execution_update: outcome.report });
                        // Spot has no per-order presentation to read the report
                        // as an answer, so the warning is withdrawn by name —
                        // otherwise "outcome unconfirmed" stood over an order
                        // the exchange had just confirmed it holds.
                        emit(createCommandResolved(
                            action,
                            'SPOT_OUTCOME_EXECUTED',
                            'Binance holds this order — it was accepted.',
                            { marketType: SPOT_MARKET_TYPE, ...identity, reconciled: true },
                        ));
                        await refreshAccountState(symbol);
                        return;
                    }
                    // An order the exchange has not caught up to yet is not an
                    // order that was never accepted. Only the last attempt is
                    // allowed to conclude the placement never happened.
                    if (attempt < RECONCILE_ATTEMPTS) {
                        await pause(RECONCILE_BACKOFF_MS * attempt);
                        continue;
                    }
                    emitRejection();
                    return;
                } catch (lookupError) {
                    if (attempt === RECONCILE_ATTEMPTS) {
                        logger.error(`${label} could not be reconciled:`, lookupError?.code || lookupError?.message);
                        emit(createCommandUnresolved(
                            action,
                            'SPOT_OUTCOME_UNKNOWN',
                            UNCONFIRMED_COMMAND_MESSAGE,
                            {
                                marketType: SPOT_MARKET_TYPE,
                                ...identity,
                                binanceCode: spotBinanceCode(error),
                                reconciled: false,
                            },
                        ));
                        return;
                    }
                    await pause(RECONCILE_BACKOFF_MS * attempt);
                }
            }
        };

        const handleOrderPlacement = async (
            payload,
            requestType = 'buyOrder',
            declaredMarketType,
        ) => {
            const validation = validateLegacyOrderCommand(payload, {
                requestType,
                selectedSymbol: panelSettings?.selected,
                declaredMarketType,
            });
            if (!validation.ok) {
                logger.warn(`[orders] Rejected ${requestType}:`, validation.rejection.command_rejected);
                emit(validation.rejection);
                return;
            }

            const {
                symbol,
                side: resolvedSide,
                numericQuantity,
                numericPrice,
                newClientOrderId,
            } = validation.command;

            if (!spotTradingAdapter) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.PLACE_ORDER,
                    'EXECUTION_NOT_CONFIGURED',
                    'Binance Spot execution is unavailable. Configure BK and BS, then restart.',
                    { marketType: 'spot' },
                ));
                return;
            }

            try {
                logger.info(`[orders] ${resolvedSide} ${symbol} qty=${numericQuantity} price=${numericPrice}`);
                const executionReport = await spotTradingAdapter.placeOrder({
                    symbol,
                    side: resolvedSide,
                    numericQuantity,
                    numericPrice,
                    newClientOrderId,
                });
                noteSpotMutation();
                emit({ execution_update: executionReport });
                await refreshAccountState(symbol);
            } catch (error) {
                await reportSpotCommandFailure({
                    action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
                    label: 'Order placement',
                    error,
                    symbol,
                    origClientOrderId: newClientOrderId,
                });
            }
        };

        const handleCancelOrder = async (payload, declaredMarketType) => {
            const validation = validateLegacyCancelCommand(payload, {
                selectedSymbol: panelSettings?.selected,
                declaredMarketType,
            });
            if (!validation.ok) {
                logger.warn('[orders] Rejected cancelOrder:', validation.rejection.command_rejected);
                emit(validation.rejection);
                return;
            }
            if (!spotTradingAdapter) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
                    'EXECUTION_NOT_CONFIGURED',
                    'Binance Spot execution is unavailable. Configure BK and BS, then restart.',
                    { marketType: 'spot' },
                ));
                return;
            }

            const {
                symbol: targetSymbol,
                orderId,
                origClientOrderId,
                newClientOrderId,
            } = validation.command;

            try {
                logger.info(`[orders] Cancel ${targetSymbol} orderId=${orderId ?? origClientOrderId}`);
                const executionReport = await spotTradingAdapter.cancelOrder({
                    symbol: targetSymbol,
                    orderId,
                    origClientOrderId,
                    newClientOrderId,
                });
                noteSpotMutation();
                emit({ execution_update: executionReport });
                await refreshAccountState(targetSymbol);
            } catch (error) {
                await reportSpotCommandFailure({
                    action: TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
                    label: 'Cancel order',
                    error,
                    symbol: targetSymbol,
                    orderId,
                    origClientOrderId,
                });
            }
        };

        // `identity` names the order the refusal is about. Without it a renderer
        // waiting on one command's answer cannot tell it from another's, and a
        // drag waiting on a cancellation would sit through a refusal it was
        // supposed to act on.
        const emitFuturesApiRejection = (action, error, identity = {}) => {
            logger.error(`[futures-orders] ${action} failed:`, error?.code || error?.message);
            emit(createCommandRejection(
                action,
                'FUTURES_API_ERROR',
                describeFuturesApiError(error),
                {
                    marketType: FUTURES_MARKET_TYPE,
                    binanceCode: error?.code ?? null,
                    ...identity,
                },
            ));
        };

        /**
         * Answers an ambiguous submission by asking Binance what it actually did.
         *
         * The operator sees an unresolved outcome immediately — never a
         * rejection, because a rejection invites the retry that would create the
         * second order — and the reconciliation replaces it with the truth.
         * `onAbsent` differs per command: an absent order means a placement never
         * happened, and means a cancellation has nothing left to cancel.
         */
        const reconcileAmbiguousFuturesCommand = async ({
            action,
            symbol,
            orderId,
            origClientOrderId,
            error,
            onAbsent,
        }) => {
            // The identity of the command, carried on every envelope about it.
            // Without it the renderer cannot tell this command's answer from any
            // other order's traffic, and used to drop the warning on the first
            // update that arrived — for a different contract as readily as for
            // this one.
            const identity = {
                symbol: symbol ?? null,
                orderId: orderId ?? null,
                clientOrderId: origClientOrderId ?? null,
            };
            const identified = Boolean(symbol) && Boolean(orderId || origClientOrderId);
            if (!identified) {
                emit(createCommandUnresolved(
                    action,
                    'FUTURES_OUTCOME_UNKNOWN',
                    UNCONFIRMED_COMMAND_MESSAGE,
                    { marketType: FUTURES_MARKET_TYPE, ...identity, reconciled: false },
                ));
                return;
            }
            emit(createCommandUnresolved(
                action,
                'FUTURES_OUTCOME_PENDING',
                UNRESOLVED_COMMAND_MESSAGE,
                {
                    marketType: FUTURES_MARKET_TYPE,
                    ...identity,
                    binanceCode: error?.code ?? null,
                    reconciled: false,
                },
            ));

            for (let attempt = 1; attempt <= RECONCILE_ATTEMPTS; attempt += 1) {
                try {
                    const outcome = await futuresTradingAdapter.findOrder({
                        symbol,
                        orderId,
                        origClientOrderId,
                    });
                    if (outcome.exists) {
                        logger.info(`[futures-orders] ${action} resolved by reconciliation: order exists`);
                        noteFuturesMutation();
                        emit({ futures_execution_update: outcome.report });
                        await refreshFuturesAccountState();
                        return;
                    }
                    // "No such order" is provisional. Binance's order state is
                    // eventually consistent after an ambiguous submission, so an
                    // order accepted a moment ago can be missing from the first
                    // read. Concluding absence here is what told the operator it
                    // was safe to send the order a second time.
                    if (attempt < RECONCILE_ATTEMPTS) {
                        logger.info(`[futures-orders] ${action} not yet visible; asking again`);
                        await pause(RECONCILE_BACKOFF_MS * attempt);
                        continue;
                    }
                    logger.info(`[futures-orders] ${action} resolved by reconciliation: no such order`);
                    await onAbsent();
                    // The outcome is known now, so the warning it raised is
                    // withdrawn — by name, so it withdraws only its own.
                    emit(createCommandResolved(
                        action,
                        'FUTURES_OUTCOME_ABSENT',
                        'Binance does not have this order — nothing was executed.',
                        { marketType: FUTURES_MARKET_TYPE, ...identity, reconciled: true },
                    ));
                    return;
                } catch (lookupError) {
                    if (attempt === RECONCILE_ATTEMPTS) {
                        logger.error(
                            `[futures-orders] ${action} could not be reconciled:`,
                            lookupError?.code || lookupError?.message,
                        );
                        emit(createCommandUnresolved(
                            action,
                            'FUTURES_OUTCOME_UNKNOWN',
                            UNCONFIRMED_COMMAND_MESSAGE,
                            {
                                marketType: FUTURES_MARKET_TYPE,
                                ...identity,
                                binanceCode: error?.code ?? null,
                                reconciled: false,
                            },
                        ));
                        return;
                    }
                    await pause(RECONCILE_BACKOFF_MS * attempt);
                }
            }
        };

        // Every mutating Futures command routes its failure through here, so a
        // timeout or a 5xx can never again be shown as a plain refusal.
        const reportFuturesCommandFailure = async ({
            action,
            error,
            symbol,
            orderId,
            origClientOrderId,
            onAbsent,
        }) => {
            if (!isIndeterminateTradingFailure(error)) {
                await onAbsent();
                return;
            }
            await reconcileAmbiguousFuturesCommand({
                action,
                symbol,
                orderId,
                origClientOrderId,
                error,
                onAbsent,
            });
        };

        // Whether an amendment is an exit is decided from the desk's own view of
        // the book, never from a claim travelling with the command. An order the
        // desk cannot find is treated as exposure-increasing: the safe answer
        // when the ceiling is active and the facts are missing.
        const isReduceOnlyWorkingOrder = ({ symbol, orderId, origClientOrderId }) => {
            const workingOrders = futuresAccountResources.regularOrders?.data;
            if (!Array.isArray(workingOrders)) return false;
            const match = workingOrders.find(order => order.symbol === symbol
                && ((orderId != null && String(order.orderId) === String(orderId))
                    || (origClientOrderId != null && order.clientOrderId === origClientOrderId)));
            return match?.reduceOnly === true;
        };

        // FUTURES_MAX_ORDER_USDT, applied here to every exposure-increasing
        // command the main process receives — placement and amendment alike.
        // Returns true when the command was refused.
        const refuseOverCapFuturesCommand = (action, { quantity, price, exposureIncreasing }) => {
            const risk = evaluateFuturesOrderRisk({
                quantity,
                price,
                maxOrderNotionalUsdt: futuresMaxOrderUsdt,
                exposureIncreasing,
            });
            if (risk.ok) return false;
            emit(createCommandRejection(
                action,
                'FUTURES_ORDER_CAP_EXCEEDED',
                risk.reason === FUTURES_RISK_REASONS.UNPRICEABLE_ORDER
                    ? `Order cap ${futuresMaxOrderUsdt} USDT is active — an order without a usable price cannot be verified against it.`
                    : `Order notional ${risk.notionalUsdt} USDT exceeds the FUTURES_MAX_ORDER_USDT cap of ${futuresMaxOrderUsdt} USDT.`,
                {
                    marketType: FUTURES_MARKET_TYPE,
                    capUsdt: futuresMaxOrderUsdt,
                    notionalUsdt: risk.notionalUsdt,
                },
            ));
            return true;
        };

        const handleFuturesOrderPlacement = async (command) => {
            const order = command.futuresOrderPayload;
            if (futuresTradingPaused) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.PLACE_ORDER,
                    'FUTURES_TRADING_PAUSED',
                    'Futures trading is paused — resume to place orders.',
                    { marketType: FUTURES_MARKET_TYPE },
                ));
                return;
            }
            // The cap guards new exposure only; reduce-only orders always pass
            // so a position can be closed regardless of the cap. A limit close
            // sent without reduce-only is new exposure as far as the exchange is
            // concerned, and is capped like any other entry.
            if (refuseOverCapFuturesCommand(TRADING_COMMAND_ACTIONS.PLACE_ORDER, {
                quantity: order.numericQuantity,
                price: order.numericPrice,
                exposureIncreasing: order.reduceOnly !== true,
            })) return;
            ensureFuturesUserDataStream();
            if (!futuresTradingAdapter) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.PLACE_ORDER,
                    'EXECUTION_NOT_CONFIGURED',
                    'Binance Futures execution is unavailable. Configure BFK and BFS, then restart.',
                    { marketType: FUTURES_MARKET_TYPE },
                ));
                return;
            }
            try {
                logger.info(`[futures-orders] ${order.side} ${order.symbol} ${order.orderType} qty=${order.numericQuantity}${order.numericPrice ? ` price=${order.numericPrice}` : ''}`);
                const report = await futuresTradingAdapter.placeOrder(order);
                noteFuturesMutation();
                emit({ futures_execution_update: report });
                await refreshFuturesAccountState();
            } catch (error) {
                await reportFuturesCommandFailure({
                    action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
                    error,
                    symbol: order.symbol,
                    origClientOrderId: order.newClientOrderId,
                    // Binance says no such order: the placement never happened,
                    // so this is an ordinary refusal the operator may act on.
                    onAbsent: async () => {
                        emitFuturesApiRejection(TRADING_COMMAND_ACTIONS.PLACE_ORDER, error, {
                            symbol: order.symbol,
                            clientOrderId: order.newClientOrderId ?? null,
                        });
                    },
                });
            }
        };

        // Which contracts this account traded lately. On USDⓈ-M every history
        // endpoint takes a symbol, so a review of the session has to be told where
        // to look: income history is the one read that answers without being asked
        // about a contract first. The contract on screen and everything the account
        // is currently in lead the list — those are the rows the operator came for.
        const collectFuturesHistorySymbols = async (
            selectedSymbol,
            { coverage = {}, full = false, isObsolete = () => false } = {},
        ) => {
            const activation = futuresActivationGeneration;
            const isCurrent = () => (
                activation === futuresActivationGeneration && !isObsolete()
            );
            const symbols = [];
            const remember = (value) => {
                const symbol = String(value ?? '').toUpperCase();
                if (symbol && !symbols.includes(symbol)) symbols.push(symbol);
            };
            remember(selectedSymbol);
            for (const position of futuresAccountResources.positions?.data ?? []) {
                remember(position?.symbol);
            }
            for (const resource of ['regularOrders', 'algoOrders']) {
                for (const order of futuresAccountResources[resource]?.data ?? []) {
                    remember(order?.symbol);
                }
            }
            // An event for a contract that is no longer open still names history
            // the operator may need. Once a successful REST read proves that
            // revision, persisted coverage or the held discovery keeps naming it.
            for (const [activitySymbol, revision] of futuresHistoryActivityBySymbol) {
                const proof = futuresHistoryProofBySymbol.get(activitySymbol);
                if (proof?.epoch !== futuresHistoryStreamEpoch
                    || proof.activity !== revision) remember(activitySymbol);
            }
            // What the account seeds on its own, this time. Held discovery is
            // remembered apart from it, so a contract stays on the list because
            // it was traded rather than because it was once held.
            const seeded = new Set(symbols);
            // Walked from the oldest end of the range to the newest. Each full page
            // means there is another numbered page behind it; the pages are then
            // read back to front, so the contract traded most recently leads the
            // list and the cap below drops the stalest rather than the newest. The
            // time bounds stay fixed across pages: advancing past a page's last
            // timestamp can skip income rows that share that millisecond.
            //
            // A page that fails is caught where it happens rather than around the
            // walk: the pages already in hand are contracts the review can cover,
            // and throwing them away because the third read timed out would drop
            // history the desk had already paid for.
            const walkIncome = async (from, until) => {
                const pages = [];
                let complete = true;
                for (let page = 0; page < FUTURES_INCOME_MAX_PAGES; page += 1) {
                    if (!isCurrent()) {
                        complete = false;
                        break;
                    }
                    let traded = null;
                    try {
                        traded = await futuresRestLimiter.execute(
                            () => (isCurrent()
                                ? futuresTradingAdapter.getTradedSymbolPage({
                                    startTime: from,
                                    endTime: until,
                                    page: page + 1,
                                })
                                : null),
                            FUTURES_INCOME_READ_WEIGHT,
                        );
                    } catch (error) {
                        // The fan-out still covers what the desk already knows about;
                        // only contracts closed and switched away from go unlisted.
                        logger.warn('[futures-history] traded-symbol discovery failed:', error?.code || error?.message);
                        complete = false;
                        break;
                    }
                    if (!isCurrent()) {
                        complete = false;
                        break;
                    }
                    pages.push(traded?.symbols ?? []);
                    if (!traded?.full) break;
                    // The last page still came back full: there are contracts behind it
                    // this walk will not reach, and the review must not imply otherwise.
                    if (page === FUTURES_INCOME_MAX_PAGES - 1) complete = false;
                }
                return { pages, complete };
            };
            // Today first, and the rest of the week only if there is still room to
            // read a contract it might find. A page budget spent on the far end of
            // the window is how a review of *this* session came back covering none
            // of it.
            const rememberPages = (pages) => {
                for (const page of [...pages].reverse()) {
                    for (const symbol of page) remember(symbol);
                }
            };
            const now = Date.now();
            const persisted = full ? [] : Object.entries(coverage)
                .filter(([, entry]) => Number.isSafeInteger(entry?.readAt)
                    && entry.readAt >= now - FUTURES_HISTORY_WINDOW_MS
                    && entry.readAt <= now)
                .sort(([, left], [, right]) => right.readAt - left.readAt);
            // Walking income is the most expensive thing a review does: up to
            // eight pages at weight 30, against an 800-weight minute. What it
            // answers — which contracts the account traded this week — changes
            // when a trade is made, and a trade made on this desk is already in
            // the seeds above. So the walk is for trades made somewhere else,
            // and asking for those on every press of refresh is asking far more
            // often than the answer moves.
            if (!full
                && futuresHistoryDiscovery !== null
                && now - futuresHistoryDiscovery.at < FUTURES_HISTORY_DISCOVERY_HOLD_MS) {
                for (const symbol of futuresHistoryDiscovery.symbols) remember(symbol);
                // Coverage can grow after this in-memory answer was created (for
                // example when a stream event names a newly closed contract).
                // Keep every fresh covered contract eligible for reconnect and
                // rotation reads instead of hiding it until the hold expires.
                for (const [persistedSymbol] of persisted) remember(persistedSymbol);
                return {
                    symbols: symbols.slice(0, FUTURES_HISTORY_MAX_SYMBOLS),
                    discovered: symbols.length,
                    discoveryComplete: futuresHistoryDiscovery.complete,
                };
            }
            // The renderer's store is the persisted discovery cache. A fresh
            // empty contract is still useful here: it proves where the prior
            // review looked even though it has no row to contribute.
            if (persisted.length > 0) {
                for (const [persistedSymbol] of persisted) remember(persistedSymbol);
                futuresHistoryDiscovery = Object.freeze({
                    at: now,
                    symbols: Object.freeze(symbols.filter(entry => !seeded.has(entry))),
                    // A bounded local store names what it has seen; it cannot
                    // claim this is every contract traded at the exchange.
                    complete: false,
                });
                return {
                    symbols: symbols.slice(0, FUTURES_HISTORY_MAX_SYMBOLS),
                    discovered: symbols.length,
                    discoveryComplete: false,
                };
            }
            const recentFrom = now - FUTURES_HISTORY_RECENT_WINDOW_MS;
            const recent = await walkIncome(recentFrom, null);
            if (!isCurrent()) {
                return { symbols: [], discovered: 0, discoveryComplete: false };
            }
            let complete = recent.complete;
            rememberPages(recent.pages);
            if (full || symbols.length < FUTURES_HISTORY_MAX_SYMBOLS) {
                const older = await walkIncome(now - FUTURES_HISTORY_WINDOW_MS, recentFrom - 1);
                if (!isCurrent()) {
                    return { symbols: [], discovered: 0, discoveryComplete: false };
                }
                complete = complete && older.complete;
                rememberPages(older.pages);
            } else {
                // The read is already at its ceiling, so the older end of the week
                // was not looked at. Saying the discovery was complete would claim
                // a look that did not happen.
                complete = false;
            }
            if (symbols.length > FUTURES_HISTORY_MAX_SYMBOLS) {
                logger.info(`[futures-history] ${symbols.length} contracts traded; reading the ${FUTURES_HISTORY_MAX_SYMBOLS} most relevant: ${symbols.slice(0, FUTURES_HISTORY_MAX_SYMBOLS).join(', ')}`);
            }
            // Held as what the walk found, not as what the fan-out chose: the
            // seeds are re-read from the account each time, and folding them in
            // here would let a contract the desk merely held a position on
            // outlive the position.
            futuresHistoryDiscovery = Object.freeze({
                at: now,
                symbols: Object.freeze(symbols.filter(symbol => !seeded.has(symbol))),
                complete,
            });
            return {
                symbols: symbols.slice(0, FUTURES_HISTORY_MAX_SYMBOLS),
                discovered: symbols.length,
                // Whether the desk knows the whole set it is choosing from. A
                // discovery that failed or ran out of pages leaves a review that
                // covers everything it found — and cannot say that is everything.
                discoveryComplete: complete,
            };
        };

        // A history read must never disturb trading state: a failure is reported
        // inside the history payload itself, not as an account resource error.
        //
        // It spans the account rather than one contract, because that is what a
        // session is: the operator reviews the trades they made, and half of them
        // were on pairs they have since switched away from. One contract failing
        // does not blank the others — only a total failure is reported as an error.
        const handleFuturesHistory = async (command) => {
            const {
                symbol,
                coverage = {},
                full = false,
            } = command;
            const activation = futuresActivationGeneration;
            const rendererActivation = marketActivationGeneration;
            const isObsolete = () => (
                activation !== futuresActivationGeneration
                || rendererActivation !== marketActivationGeneration
                || activeMarketMode !== MARKET_MODES.FUTURES
            );
            const {
                symbols, discovered, discoveryComplete,
            } = await collectFuturesHistorySymbols(symbol, { coverage, full, isObsolete });
            if (isObsolete()) return;
            const readSymbols = chooseFuturesHistoryReadSymbols(symbols, coverage, { full });
            const orders = [];
            const trades = [];
            const unavailable = [];
            const failures = [];
            const readFrom = {};
            await Promise.all(readSymbols.map(async (historySymbol) => {
                const held = coverage[historySymbol] ?? {};
                const orderCursor = full
                    ? null
                    : normalizeFuturesHistoryCursor(held.orderCursor);
                const tradeCursor = full
                    ? null
                    : normalizeFuturesHistoryCursor(held.tradeCursor);
                const proof = captureFuturesHistoryProof(historySymbol);
                try {
                    const [symbolOrders, symbolTrades] = await Promise.all([
                        readFuturesHistoryGap({
                            cursor: orderCursor,
                            limit: FUTURES_HISTORY_LIMIT,
                            identityOf: order => order?.orderId,
                            load: from => futuresRestLimiter.execute(
                                () => (isObsolete()
                                    ? []
                                    : futuresTradingAdapter.getOrderHistory({
                                        symbol: historySymbol,
                                        ...(from === null ? {} : { fromOrderId: from }),
                                    })),
                                FUTURES_HISTORY_READ_WEIGHT,
                            ),
                        }),
                        readFuturesHistoryGap({
                            cursor: tradeCursor,
                            limit: FUTURES_TRADE_HISTORY_LIMIT,
                            identityOf: trade => trade?.id,
                            load: from => futuresRestLimiter.execute(
                                () => (isObsolete()
                                    ? []
                                    : futuresTradingAdapter.getTradeHistory({
                                        symbol: historySymbol,
                                        ...(from === null ? {} : { fromTradeId: from }),
                                    })),
                                FUTURES_HISTORY_READ_WEIGHT,
                            ),
                        }),
                    ]);
                    orders.push(...symbolOrders);
                    trades.push(...symbolTrades);
                    readFrom[historySymbol] = { orderCursor, tradeCursor };
                    retainFuturesHistoryProof(historySymbol, proof, {
                        orderCursor: futuresHistoryCursorAfter(
                            orderCursor,
                            symbolOrders,
                            order => order?.orderId,
                        ),
                        tradeCursor: futuresHistoryCursorAfter(
                            tradeCursor,
                            symbolTrades,
                            trade => trade?.id,
                        ),
                    });
                } catch (error) {
                    unavailable.push(historySymbol);
                    failures.push(error);
                    logger.error(`[futures-history] ${historySymbol} request failed:`, error?.code || error?.message);
                }
            }));
            if (isObsolete()) return;
            if (readSymbols.length > 0 && unavailable.length === readSymbols.length) {
                const [failure] = failures;
                emit({
                    futures_history: {
                        symbol,
                        symbols: readSymbols,
                        discovered,
                        discoveryComplete,
                        readFrom: {},
                        full: full === true,
                        orders: [],
                        trades: [],
                        error: {
                            code: 'FUTURES_API_ERROR',
                            binanceCode: failure?.code ?? null,
                            message: describeFuturesApiError(failure),
                        },
                    },
                });
                return;
            }
            emit({
                futures_history: {
                    symbol,
                    symbols: readSymbols.filter(entry => !unavailable.includes(entry)),
                    // How many contracts the account actually traded in the window,
                    // against how many were read. The review surface states the
                    // difference: an operator who cannot see yesterday's losses must
                    // be told the list is bounded, not left to conclude there were none.
                    discovered,
                    discoveryComplete,
                    readFrom,
                    full: full === true,
                    orders: orders.sort((left, right) => right.time - left.time),
                    trades: trades.sort((left, right) => right.time - left.time),
                    error: null,
                },
            });
        };

        // The leverage of one contract, on demand: sent whenever the desk changes
        // contract, and again after a leverage change, so what is on screen is what
        // the exchange holds rather than what was asked for.
        const handleFuturesSymbolConfig = async (command) => {
            const config = await readFuturesSymbolConfig(command.symbol, { withCeiling: true });
            broadcastFuturesSymbolConfigs([config]);
        };

        // Leverage places no order, but it is not a read either: it changes what
        // every future entry on this contract costs in margin and, on a position
        // already open, the price the exchange closes it at. Pausing trading stops
        // it for the same reason it stops taking margin out — both raise risk.
        const handleFuturesSetLeverage = async (command) => {
            const { symbol, leverage } = command.leveragePayload;
            if (futuresTradingPaused) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.SET_LEVERAGE,
                    'FUTURES_TRADING_PAUSED',
                    'Futures trading is paused — resume to change leverage.',
                    { marketType: FUTURES_MARKET_TYPE },
                ));
                return;
            }
            try {
                logger.info(`[futures-leverage] ${symbol} → ${leverage}x`);
                await futuresRestLimiter.execute(
                    () => futuresTradingAdapter.setLeverage({ symbol, leverage }),
                    1,
                );
                noteFuturesMutation();
                // The exchange's figure, not the requested one: Binance lowers a
                // setting a position is too large for rather than refusing it.
                const config = await readFuturesSymbolConfig(symbol, { withCeiling: true });
                broadcastFuturesSymbolConfigs([config]);
                // Margin requirements and the liquidation price both moved.
                await refreshFuturesAccountState();
            } catch (error) {
                emitFuturesApiRejection(TRADING_COMMAND_ACTIONS.SET_LEVERAGE, error);
            }
        };

        // The margin mode decides what a losing position can cost: isolated caps
        // it at the margin behind that position, cross stands the whole wallet
        // behind it. It is stopped by a pause for the same reason leverage is.
        //
        // Binance answers a mode the contract is already in with -4046. That is
        // the desired state, not a failure, and reporting it as one would put a
        // red card on the desk every time the default confirmed what was already
        // true.
        const handleFuturesSetMarginType = async (command) => {
            const { symbol, marginType } = command.marginTypePayload;
            if (futuresTradingPaused) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.SET_MARGIN_TYPE,
                    'FUTURES_TRADING_PAUSED',
                    'Futures trading is paused — resume to change the margin mode.',
                    { marketType: FUTURES_MARKET_TYPE },
                ));
                return;
            }
            let changed = true;
            try {
                logger.info(`[futures-margin-type] ${symbol} → ${marginType}`);
                await futuresRestLimiter.execute(
                    () => futuresTradingAdapter.setMarginType({ symbol, marginType }),
                    1,
                );
                noteFuturesMutation();
            } catch (error) {
                if (Number(error?.code) !== FUTURES_MARGIN_TYPE_UNCHANGED_CODE) {
                    emitFuturesApiRejection(TRADING_COMMAND_ACTIONS.SET_MARGIN_TYPE, error);
                    return;
                }
                logger.info(`[futures-margin-type] ${symbol} already ${marginType}`);
                changed = false;
            }
            // What the exchange holds now, not what was asked for. Read even
            // where nothing changed: -4046 means the desk's own reading of the
            // mode was the stale one, and that is worth correcting.
            const config = await readFuturesSymbolConfig(symbol, { withCeiling: true });
            broadcastFuturesSymbolConfigs([config]);
            // The account only where the mode actually moved — it changes what
            // stands behind a position, and therefore where it liquidates. A
            // contract that was already in the mode moved nothing, and an
            // account read is not free.
            if (changed) await refreshFuturesAccountState();
        };

        const handleFuturesModifyOrder = async (command) => {
            const amendment = command.futuresModifyPayload;
            if (futuresTradingPaused) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
                    'FUTURES_TRADING_PAUSED',
                    'Futures trading is paused — resume to move orders.',
                    { marketType: FUTURES_MARKET_TYPE },
                ));
                return;
            }
            // The audit's case: a 160 USDT order edited to 10 000 under a 200
            // USDT cap reached Binance because only placement was checked. An
            // amendment is measured against the notional it will leave working.
            if (refuseOverCapFuturesCommand(TRADING_COMMAND_ACTIONS.REPLACE_ORDER, {
                quantity: amendment.quantity,
                price: amendment.price,
                exposureIncreasing: !isReduceOnlyWorkingOrder(amendment),
            })) return;
            ensureFuturesUserDataStream();
            if (!futuresTradingAdapter) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
                    'EXECUTION_NOT_CONFIGURED',
                    'Binance Futures execution is unavailable. Configure BFK and BFS, then restart.',
                    { marketType: FUTURES_MARKET_TYPE },
                ));
                return;
            }
            try {
                logger.info(`[futures-orders] Amend ${amendment.symbol} orderId=${amendment.orderId ?? amendment.origClientOrderId} price=${amendment.numericPrice}`);
                const report = await futuresTradingAdapter.modifyOrder(amendment);
                noteFuturesMutation();
                emit({ futures_execution_update: report });
                await refreshFuturesAccountState();
            } catch (error) {
                await reportFuturesCommandFailure({
                    action: TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
                    error,
                    symbol: amendment.symbol,
                    orderId: amendment.orderId,
                    origClientOrderId: amendment.origClientOrderId,
                    onAbsent: async () => {
                        emitFuturesApiRejection(TRADING_COMMAND_ACTIONS.REPLACE_ORDER, error);
                        // The order survives a rejected amendment; resync so the
                        // chart snaps the line back to the price Binance holds.
                        await refreshFuturesAccountState();
                    },
                });
            }
        };

        const handleFuturesCancelOrder = async (command) => {
            ensureFuturesUserDataStream();
            if (!futuresTradingAdapter) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
                    'EXECUTION_NOT_CONFIGURED',
                    'Binance Futures execution is unavailable. Configure BFK and BFS, then restart.',
                    { marketType: FUTURES_MARKET_TYPE },
                ));
                return;
            }
            try {
                const report = await futuresTradingAdapter.cancelOrder(command);
                noteFuturesMutation();
                emit({ futures_execution_update: report });
                await refreshFuturesAccountState();
            } catch (error) {
                await reportFuturesCommandFailure({
                    action: TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
                    error,
                    symbol: command.symbol,
                    orderId: command.orderId,
                    origClientOrderId: command.origClientOrderId,
                    onAbsent: async () => {
                        // An order Binance does not have cannot be cancelled and
                        // needs no rejection: the book already matches intent.
                        // Only a determinate failure is a refusal to report.
                        if (isIndeterminateTradingFailure(error)) {
                            await refreshFuturesAccountState();
                            return;
                        }
                        emitFuturesApiRejection(TRADING_COMMAND_ACTIONS.CANCEL_ORDER, error, {
                            symbol: command.symbol,
                            orderId: command.orderId ?? null,
                            clientOrderId: command.origClientOrderId ?? null,
                        });
                    },
                });
            }
        };

        const handleFuturesCancelAll = async (command) => {
            ensureFuturesUserDataStream();
            if (!futuresTradingAdapter) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.CANCEL_ALL,
                    'EXECUTION_NOT_CONFIGURED',
                    'Binance Futures execution is unavailable. Configure BFK and BFS, then restart.',
                    { marketType: FUTURES_MARKET_TYPE },
                ));
                return;
            }
            // The desk lists regular and conditional orders in one book, so
            // "Cancel all" is read as covering both. Binance keeps them in two,
            // and cancelling only the regular one left stops and take-profits
            // live under an empty list. Both are cancelled, and each is settled
            // on its own: a failure of one may not be reported as success of the
            // other.
            const cancellations = [
                {
                    kind: 'regular',
                    label: 'working orders',
                    run: () => futuresTradingAdapter.cancelAllOrders(command.symbol),
                },
                {
                    kind: 'algo',
                    label: 'conditional (ALGO) orders',
                    run: () => futuresTradingAdapter.cancelAllAlgoOrders(command.symbol),
                },
            ];
            const outcomes = await Promise.all(cancellations.map(async (cancellation) => {
                try {
                    await cancellation.run();
                    return { ...cancellation, ok: true, error: null };
                } catch (error) {
                    return { ...cancellation, ok: false, error };
                }
            }));
            const failures = outcomes.filter(outcome => !outcome.ok);
            if (failures.length === 0) {
                noteFuturesMutation();
                await refreshFuturesAccountState();
                return;
            }
            // Whatever did cancel, cancelled: the account read below is what the
            // operator will act on either way.
            if (failures.length < outcomes.length) noteFuturesMutation();
            const error = failures[0].error;
            const stillLive = failures.map(failure => failure.label).join(' and ');
            logger.error(
                `[futures-orders] Cancel all ${command.symbol}: ${stillLive} not cancelled:`,
                error?.code || error?.message,
            );
            // Cancel-all names no single order, so there is nothing to look up.
            // An ambiguous outcome is stated as unknown and the account is
            // re-read, which is what actually settles it.
            if (failures.some(failure => isIndeterminateTradingFailure(failure.error))) {
                emit(createCommandUnresolved(
                    TRADING_COMMAND_ACTIONS.CANCEL_ALL,
                    'FUTURES_OUTCOME_UNKNOWN',
                    `${UNCONFIRMED_COMMAND_MESSAGE} The ${stillLive} on ${command.symbol} may still be live.`,
                    { marketType: FUTURES_MARKET_TYPE, symbol: command.symbol, reconciled: false },
                ));
                await refreshFuturesAccountState();
                // The re-read is what settles a cancel-all: it names no single
                // order, so the book itself is the answer.
                emit(createCommandResolved(
                    TRADING_COMMAND_ACTIONS.CANCEL_ALL,
                    'FUTURES_OUTCOME_RESYNCED',
                    'The open orders were re-read from Binance — the list on screen is what it holds.',
                    { marketType: FUTURES_MARKET_TYPE, symbol: command.symbol, reconciled: true },
                ));
                return;
            }
            emit(createCommandRejection(
                TRADING_COMMAND_ACTIONS.CANCEL_ALL,
                'FUTURES_API_ERROR',
                `${describeFuturesApiError(error)} The ${stillLive} on ${command.symbol} are still live.`,
                {
                    marketType: FUTURES_MARKET_TYPE,
                    symbol: command.symbol,
                    binanceCode: error?.code ?? null,
                    uncancelled: failures.map(failure => failure.kind),
                },
            ));
            // The books that did cancel changed; show what is actually left.
            await refreshFuturesAccountState();
        };

        // Margin moves between the wallet and one open position. It places no
        // order, so the order ceiling has nothing to measure: adding margin
        // lowers the risk on a position that already exists, and capping that
        // could block the top-up that would have prevented a liquidation.
        const handleFuturesAdjustPositionMargin = async (command) => {
            const adjustment = command.marginPayload;
            // Pausing exists to stop risk being taken. Taking margin out of a
            // position takes risk; putting it in is the same class of action as
            // cancelling, and stays available.
            if (futuresTradingPaused && adjustment.direction === 'REMOVE') {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
                    'FUTURES_TRADING_PAUSED',
                    'Futures trading is paused — resume to take margin out of a position.',
                    { marketType: FUTURES_MARKET_TYPE },
                ));
                return;
            }
            ensureFuturesUserDataStream();
            if (!futuresTradingAdapter) {
                emit(createCommandRejection(
                    TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
                    'EXECUTION_NOT_CONFIGURED',
                    'Binance Futures execution is unavailable. Configure BFK and BFS, then restart.',
                    { marketType: FUTURES_MARKET_TYPE },
                ));
                return;
            }
            try {
                logger.info(`[futures-margin] ${adjustment.direction} ${adjustment.amount} USDT ${adjustment.symbol} ${adjustment.positionSide}`);
                await futuresTradingAdapter.adjustPositionMargin(adjustment);
                noteFuturesMutation();
                // The row shows the exchange's figure, not the requested one.
                await refreshFuturesAccountState();
            } catch (error) {
                // A margin transfer carries no client id Binance would echo, so
                // there is nothing to reconcile by: re-reading the account is
                // what settles it. It is never resent — a repeated transfer
                // moves the amount twice.
                if (isIndeterminateTradingFailure(error)) {
                    emit(createCommandUnresolved(
                        TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
                        'FUTURES_OUTCOME_UNKNOWN',
                        UNCONFIRMED_COMMAND_MESSAGE,
                        {
                            marketType: FUTURES_MARKET_TYPE,
                            symbol: adjustment.symbol,
                            reconciled: false,
                        },
                    ));
                    await refreshFuturesAccountState();
                    // The position's own margin, re-read, is the answer here.
                    emit(createCommandResolved(
                        TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
                        'FUTURES_OUTCOME_RESYNCED',
                        'The position was re-read from Binance — the margin on screen is what it holds.',
                        {
                            marketType: FUTURES_MARKET_TYPE,
                            symbol: adjustment.symbol,
                            reconciled: true,
                        },
                    ));
                    return;
                }
                emitFuturesApiRejection(TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN, error);
            }
        };

        const handleTypedTradingCommand = async (payload) => {
            const validation = validateTypedTradingCommand(payload, {
                selectedSymbol: panelSettings?.selected,
            });
            if (!validation.ok) {
                logger.warn(`[orders] Rejected ${payload?.action || 'typed command'}:`, validation.rejection.command_rejected);
                emit(validation.rejection);
                return;
            }

            const command = validation.command;
            // What the desk was told to do, before anything is sent: the outcome
            // envelopes say how a command ended but never what it was.
            diagnosticRecord.observeCommand(command);
            const authenticatedAdapter = command.marketType === FUTURES_MARKET_TYPE
                ? futuresTradingAdapter
                : spotTradingAdapter;
            if (!authenticatedAdapter) {
                emit(createCommandRejection(
                    command.action,
                    'EXECUTION_NOT_CONFIGURED',
                    command.marketType === FUTURES_MARKET_TYPE
                        ? credentialPreflight.markets.futures.message
                        : credentialPreflight.markets.spot.message,
                    { marketType: command.marketType },
                ));
                return;
            }
            // A mutating command goes through the registry: once per identity,
            // and one at a time per contract. A read does not — an account
            // refresh may be asked for as often as the desk likes, and the
            // history fan-out depends on staying concurrent.
            if (isMutatingTradingCommand(command)) {
                await tradingCommandRegistry.submit(command, {
                    emit,
                    execute: () => dispatchTypedTradingCommand(command),
                });
                return;
            }
            await dispatchTypedTradingCommand(command);
        };

        const dispatchTypedTradingCommand = async (command) => {
            if (command.marketType === FUTURES_MARKET_TYPE) {
                switch (command.action) {
                    case TRADING_COMMAND_ACTIONS.PLACE_ORDER:
                        await handleFuturesOrderPlacement(command);
                        break;
                    case TRADING_COMMAND_ACTIONS.CANCEL_ORDER:
                        await handleFuturesCancelOrder(command);
                        break;
                    case TRADING_COMMAND_ACTIONS.REPLACE_ORDER:
                        await handleFuturesModifyOrder(command);
                        break;
                    case TRADING_COMMAND_ACTIONS.CANCEL_ALL:
                        await handleFuturesCancelAll(command);
                        break;
                    case TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN:
                        await handleFuturesAdjustPositionMargin(command);
                        break;
                    case TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH:
                        ensureFuturesUserDataStream();
                        // Warm the cached position mode (and the server-time
                        // offset its signed request syncs) so the first order
                        // pays no extra round-trips.
                        void futuresTradingAdapter?.getPositionMode().catch(() => {});
                        await refreshFuturesAccountState();
                        break;
                    case TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY:
                        await handleFuturesHistory(command);
                        break;
                    case TRADING_COMMAND_ACTIONS.ACCOUNT_SYMBOL_CONFIG:
                        await handleFuturesSymbolConfig(command);
                        break;
                    case TRADING_COMMAND_ACTIONS.SET_LEVERAGE:
                        await handleFuturesSetLeverage(command);
                        break;
                    case TRADING_COMMAND_ACTIONS.SET_MARGIN_TYPE:
                        await handleFuturesSetMarginType(command);
                        break;
                    case TRADING_COMMAND_ACTIONS.SET_TRADING_PAUSED:
                        futuresTradingPaused = command.paused;
                        logger.info(`Futures trading ${futuresTradingPaused ? 'paused' : 'resumed'} by operator`);
                        broadcastFuturesTradingPaused();
                        break;
                }
                return;
            }

            switch (command.action) {
                case TRADING_COMMAND_ACTIONS.PLACE_ORDER:
                    await handleOrderPlacement(command.orderPayload, command.requestType);
                    break;
                case TRADING_COMMAND_ACTIONS.CANCEL_ORDER:
                    await handleCancelOrder(command.cancelPayload);
                    break;
                case TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH:
                    await refreshAccountState(command.symbol);
                    break;
            }
        };

        // Legacy emit for backward compatibility
        const emit = (payload, overrideRequestId) => {
            // How a trading command ended reaches the operator here and nowhere
            // else; the record recognizes those envelopes and ignores the rest.
            diagnosticRecord.observeOutbound(payload);
            // And the registry keeps the same envelopes against the command that
            // caused them, so a second copy of that command can be answered
            // without asking Binance again. Outside a command this does nothing.
            tradingCommandRegistry.recordOutcome(payload);
            const reqId = overrideRequestId ?? activeRequestId;
            if (reqId) {
                sendJSON(connection, { requestId: reqId, ...payload });
            } else {
                sendJSON(connection, payload);
            }
        };

        /**
         * Channel-aware emit - sends messages with channel metadata
         * @param {string} channelId - Channel ID
         * @param {string} type - Message type (chart, depth, trades, etc.)
         * @param {any} payload - Message payload
         * @param {any} extra - Optional extra data (e.g., last_tick for chart)
         */
        const emitToChannel = (channelId, type, payload, extra = null) => {
            const channel = channelManager.getChannel(channelId);
            if (!channel) {
                // Fallback to legacy emit for global messages
                emit({ [type]: payload, ...(extra && { extra }) });
                return;
            }

            const message = {
                channelId,
                type,
                symbol: channel.symbol,
                interval: channel.interval,
                payload,
                // Also include legacy fields for backward compat
                requestId: activeRequestId
            };

            if (extra !== null) {
                message.extra = extra;
            }

            // Also include legacy format fields for smooth migration
            if (type === 'chart') {
                message.chart = payload;
                message.last_tick = extra;
            }

            // Market data, but not superseded: what a legacy channel frame
            // carries — a chart page, a trade batch — is not always the whole of
            // what it describes, and only a frame that repeats everything the
            // last one said may replace it.
            sendJSON(connection, message, marketFrame(type, channel.symbol));
        };

        /**
         * Emit to global channel (ticker, filters)
         */
        const emitGlobal = (type, payload) => {
            sendJSON(connection, {
                channelId: 'global',
                type,
                payload,
                // Legacy format
                [type]: payload
            });
        };

        let spotDataInitialized = false;
        let futuresDataInitialized = false;
        const initializeSpotData = () => {
            if (!spotCredentialsReady) return;
            spotRendererConnections.add(connection);
            if (spotDataInitialized) return;
            spotDataInitialized = true;

            // Real Data Logic using @binance/spot

            const sendInitialTicker = async () => {
                try {
                    const snapshot = await ensureTickerSnapshot();
                    if (snapshot?.length) {
                        const payload = snapshot.map((entry) => ({ ...entry }));
                        sendJSON(connection, { ticker: payload }, marketFrame('ticker'));
                    }
                } catch (err) {
                    logger.error("Ticker24 Error:", err);
                    if (err?.message) {
                        logger.error("Ticker24 Error Message:", err.message);
                    }
                }
            };
            void sendInitialTicker();

            // Initialize shared global sockets (ticker + user data) - ONLY ONCE
            if (!globalSocketsInitialized) {
                globalSocketsInitialized = true;
                
                // Subscribe to All Tickers Stream (shared by all renderers)
                let globalWsReconnecting = false;
                // Liveness tracking for the high-volume !ticker@arr stream. If it
                // goes silent the renderer is stuck on its initial REST snapshot
                // (Balances Sum / P&L / Activity freeze) while charts keep moving on
                // the separate kline socket. The watchdog below reconnects on stall.
                let lastTickerMessageAt = Date.now();
                const subscribeGlobal = async (retryCount = 0) => {
                    const MAX_RETRIES = 5;
                    const RETRY_DELAY_BASE = 3000;
                    
                    if (globalWsReconnecting && retryCount === 0) return;
                    globalWsReconnecting = true;
                    
                    try {
                        await throttleWsConnection();
                        // Tear down any previous miniTicker socket before opening a
                        // new one. Reconnect triggers (close handler, watchdog, retry)
                        // can otherwise overlap and leave an orphaned-but-subscribed
                        // socket alive whose message handler keeps broadcasting — that
                        // is what multiplied the per-tick fan-out over a long session.
                        if (globalWsConnection) {
                            const previous = globalWsConnection;
                            globalWsConnection = null;
                            // disconnect() while still connected sets the library's
                            // closeInitiated, so it won't self-revive this base; the
                            // close handler's identity guard ignores its close event.
                            await safeDisconnect(previous, 'previous global stream');
                        }
                        // NOTE: '!ticker@arr' is deprecated and Binance no longer
                        // pushes data on it (connects but stays silent), which froze
                        // every 24h-ticker consumer (Balances Sum, P&L, Activity).
                        // '!miniTicker@arr' is the live equivalent (c/o/h/l/q every ~1s).
                        globalWsConnection = await client.websocketStreams.connect({
                            stream: '!miniTicker@arr'
                        });
                        globalWsReconnecting = false;
                        const conn = globalWsConnection; // capture for the close guard below

                        globalWsConnection.on('message', (data) => {
                            lastTickerMessageAt = Date.now();
                            const payload = extractStreamPayload(data);
                            if (!payload) return;
                            const tickerArray = Array.isArray(payload)
                                ? payload
                                : (payload?.e === '24hrMiniTicker' || payload?.e === '24hrTicker')
                                    ? [payload]
                                    : [];
                            if (!tickerArray.length) return;
                            // Coalesce the whole push into ONE frame. miniTicker@arr
                            // delivers hundreds of symbols ~once/sec; emitting one frame
                            // per symbol caused hundreds of separate setTicker() renders
                            // per second on the renderer (the UI freeze). One batched
                            // frame = one renderer render per push.
                            const batch = [];
                            tickerArray.forEach(ticker => {
                                if (ticker?.s && (ticker.s.includes("BTC") || ticker.s.includes("USDT"))) {
                                    // miniTicker carries c/o/h/l/q but no 24h %change (P),
                                    // so derive it from open (o) and close (c) to keep the
                                    // field intact for any consumer. Full ticker still has P.
                                    const open = parseFloat(ticker.o);
                                    const close = parseFloat(ticker.c);
                                    const pct = ticker.P !== undefined
                                        ? ticker.P
                                        : (Number.isFinite(open) && open > 0 && Number.isFinite(close)
                                            ? (((close - open) / open) * 100).toFixed(3)
                                            : undefined);
                                    const update = {
                                        symbol: ticker.s,
                                        lastPrice: ticker.c,
                                        priceChangePercent: pct,
                                        highPrice: ticker.h,
                                        lowPrice: ticker.l,
                                        quoteVolume: ticker.q,
                                        closeTime: ticker.C ?? ticker.E
                                    };
                                    const upserted = tickerCache.upsert(update);
                                    if (upserted) {
                                        batch.push({ index: upserted.index, entry: upserted.entry });
                                    }
                                }
                            });
                            if (batch.length) {
                                // Broadcast a single coalesced frame to ALL renderers.
                                // A batch states what changed, not what is, so a
                                // newer one cannot stand in for it.
                                broadcastToRenderers({ ticker_batch: batch }, marketFrame('ticker'));
                            }
                        });
                        globalWsConnection.on('error', (err) => {
                            const isNetworkError = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' || 
                                                   err?.message?.includes('socket disconnected');
                            if (isNetworkError) {
                                logger.warn(`Global WS network error (${err?.code}), will reconnect...`);
                            } else {
                                logger.error("Global WS Connection Error:", err?.code || err?.message);
                            }
                        });
                        globalWsConnection.on('close', (code, reason) => {
                            const readableReason = typeof reason === 'string' ? reason : reason?.toString() ?? 'no reason';
                            logger.warn(`Global WS closed (${code}): ${readableReason}`);
                            // Only the CURRENT socket drives reconnect. A superseded
                            // socket (teardown) or a library-revived zombie base must not
                            // null the live ref or schedule a reconnect — that double
                            // path is what spawned competing sockets and churn.
                            if (globalWsConnection !== conn) return;
                            globalWsConnection = null;
                            // Auto-reconnect on abnormal close if any renderer is connected
                            if (code !== 1000 && spotRendererConnections.size > 0 && !globalWsReconnecting) {
                                logger.info('Scheduling global WS reconnection...');
                                setTimeout(() => subscribeGlobal(), 5000);
                            }
                        });
                    } catch (err) {
                        globalWsReconnecting = false;
                        const isNetworkError = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' ||
                                               err?.code === 'ENOTFOUND' || err?.message?.includes('TLS');
                        
                        if (isNetworkError && retryCount < MAX_RETRIES && spotRendererConnections.size > 0) {
                            const delay = RETRY_DELAY_BASE * (retryCount + 1);
                            logger.warn(`Global WS connection failed (${err?.code}), retrying in ${delay}ms (${retryCount + 1}/${MAX_RETRIES})`);
                            setTimeout(() => subscribeGlobal(retryCount + 1), delay);
                        } else {
                            logger.error("Global WS Connection Error:", err?.code || err?.message);
                        }
                    }
                };
                subscribeGlobal();

                // Watchdog: the !ticker@arr stream pushes every ~1s, so a long
                // silence means the socket stalled without firing error/close.
                // Force a reconnect so 24h-ticker consumers (Balances Sum, P&L,
                // Activity) resume updating. Created once for the global sockets.
                const TICKER_STALL_MS = 30000;
                // Track the handle so the all-renderers-disconnected cleanup can
                // clear it. Previously this interval was never cleared, so every
                // renderer reconnect (which re-runs this init block) spawned another
                // watchdog while the old ones kept running — each independently
                // reconnecting the ticker socket and multiplying the fan-out flood.
                if (tickerStallInterval) clearInterval(tickerStallInterval);
                tickerStallInterval = setInterval(() => {
                    if (spotRendererConnections.size === 0) return;
                    if (Date.now() - lastTickerMessageAt <= TICKER_STALL_MS) return;
                    logger.warn(`[ticker-stream] No !ticker@arr data for >${TICKER_STALL_MS / 1000}s — forcing reconnect`);
                    lastTickerMessageAt = Date.now(); // reset to avoid a tight reconnect loop
                    // subscribeGlobal() tears down the existing socket itself (and the
                    // superseded socket's close handler no-ops via its identity guard),
                    // so just trigger it — no second reconnect is scheduled.
                    subscribeGlobal();
                }, 15000);

                // Subscribe to User Data Stream (shared by all renderers)
                let userDataReconnecting = false;
                const startUserDataStream = async (retryCount = 0) => {
                    const MAX_RETRIES = 5;
                    const RETRY_DELAY_BASE = 3000;

                    // Close/retry timers and awaited setup stages can outlive the
                    // renderer session that started them. Do not resurrect shared
                    // user-data state after the last renderer tears global sockets down.
                    if (spotRendererConnections.size === 0) return;
                    
                    if (userDataReconnecting && retryCount === 0) return;
                    userDataReconnecting = true;
                    
                    try {
                        logger.info("Starting User Data Stream setup...");

                        let listenKeyCreationSkipped = false;
                        const listenKey = await rateLimiter.execute(
                            () => {
                                // A reconnect can lose its final renderer while waiting
                                // for rate-limiter spacing. Recheck ownership immediately
                                // before issuing the POST so teardown cannot create a
                                // renderer-less listen key.
                                if (spotRendererConnections.size === 0) {
                                    listenKeyCreationSkipped = true;
                                    return undefined;
                                }
                                return spotTradingAdapter.createUserDataStreamListenKey();
                            },
                            1
                        );
                        if (listenKeyCreationSkipped) {
                            userDataReconnecting = false;
                            return;
                        }
                        if (!listenKey) {
                            logger.error("Failed to obtain listenKey");
                            userDataReconnecting = false;
                            return;
                        }
                        logger.info("Listen Key obtained successfully.");

                    await throttleWsConnection();
                    // Tear down any previous user-data socket first so we never run
                    // two in parallel (which would duplicate executionReport /
                    // outboundAccountPosition events and leak the old base's timers).
                    if (userDataWsConnection) {
                        const previousUserData = userDataWsConnection;
                        userDataWsConnection = null;
                        // Drop the old socket's keep-alive (a fresh one is created
                        // below); its close handler's identity guard will no-op.
                        if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
                        await safeDisconnect(previousUserData, 'previous user data stream');
                    }
                    if (spotRendererConnections.size === 0) {
                        userDataReconnecting = false;
                        return;
                    }

                    const nextUserDataConnection = await spotTradingAdapter.connectUserDataStream(listenKey);
                    if (spotRendererConnections.size === 0) {
                        userDataReconnecting = false;
                        await safeDisconnect(nextUserDataConnection, 'orphaned user data stream');
                        return;
                    }
                    userDataWsConnection = nextUserDataConnection;
                    userDataReconnecting = false;
                    const udConn = userDataWsConnection; // capture for the close guard

                    logger.info("User Data Stream connected.");

                    // Catch up on any balance changes missed during reconnection gap
                    fetchAndBroadcastBalances();

                    userDataWsConnection.on('message', (data) => {
                        const payload = extractStreamPayload(data);
                        if (!payload) return;

                        const streamEvent = spotTradingAdapter.normalizeUserDataStreamEvent(payload);
                        if (!streamEvent) return;

                        if (streamEvent.type === 'executionReport') {
                            const report = streamEvent.executionReport;
                            logger.info(`[stream] Execution Report: ${report.symbol} ${report.side} ${report.status}`);
                            // Broadcast to ALL connected renderers
                            broadcastToRenderers(streamEvent.rendererPayload);

                            // Refresh balances via REST for fill events as a fallback
                            // in case outboundAccountPosition is missed
                            if (streamEvent.shouldRefreshBalances) {
                                fetchAndBroadcastBalances();
                            }
                        } else if (streamEvent.type === 'outboundAccountPosition') {
                            // Fast incremental balance update from WebSocket
                            broadcastToRenderers(streamEvent.rendererPayload);
                        } else if (streamEvent.type === 'balanceUpdate') {
                            // Deposit/withdrawal event - fetch fresh balances via REST
                            logger.info(`[stream] Balance Update (deposit/withdrawal): asset=${streamEvent.balanceUpdate.a} delta=${streamEvent.balanceUpdate.d}`);
                            fetchAndBroadcastBalances();
                        }
                    });

                    userDataWsConnection.on('error', (err) => {
                        const isNetworkError = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' ||
                                               err?.message?.includes('socket disconnected');
                        if (isNetworkError) {
                            logger.warn(`User Data Stream network error (${err?.code}), will reconnect...`);
                        } else {
                            logger.error("User Data Stream Error:", err?.code || err?.message);
                        }
                    });

                    udConn.on('close', () => {
                        logger.warn("User Data Stream closed");
                        // Only the CURRENT socket manages the shared keep-alive and
                        // reconnect; ignore closes from a superseded/zombie socket so
                        // it can't kill the live keep-alive or duplicate the stream.
                        if (userDataWsConnection !== udConn) return;
                        if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
                        userDataWsConnection = null;
                        // Auto-reconnect on unexpected close if any renderer connected
                        if (spotRendererConnections.size > 0 && !userDataReconnecting) {
                            logger.info('Scheduling User Data Stream reconnection...');
                            setTimeout(() => startUserDataStream(), 5000);
                        }
                    });

                    // Keep-alive every 30 minutes
                    keepAliveInterval = setInterval(async () => {
                        try {
                            const renewed = await rateLimiter.execute(
                                async () => {
                                    // The interval can be cleared while an already-fired
                                    // callback is waiting for rate-limiter spacing. Recheck
                                    // ownership immediately before issuing the PUT so a
                                    // superseded or renderer-less stream cannot renew.
                                    if (spotRendererConnections.size === 0 || userDataWsConnection !== udConn) {
                                        return false;
                                    }
                                    await spotTradingAdapter.renewUserDataStreamListenKey(listenKey);
                                    return true;
                                },
                                1
                            );
                            if (renewed) logger.debug("Renewed listenKey");
                        } catch (err) {
                            logger.warn("Failed to renew listenKey:", err?.code || err?.message);
                        }
                    }, 30 * 60 * 1000);

                } catch (err) {
                    userDataReconnecting = false;
                    const isNetworkError = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' ||
                                           err?.code === 'ENOTFOUND' || err?.message?.includes('TLS');
                    
                    if (isNetworkError && retryCount < MAX_RETRIES && spotRendererConnections.size > 0) {
                        const delay = RETRY_DELAY_BASE * (retryCount + 1);
                        logger.warn(`User Data Stream connection failed (${err?.code}), retrying in ${delay}ms (${retryCount + 1}/${MAX_RETRIES})`);
                        setTimeout(() => startUserDataStream(retryCount + 1), delay);
                    } else {
                        logger.error("Failed to start User Data Stream:", err?.code || err?.message);
                    }
                }
                };
                startUserDataStream();
            } // End of globalSocketsInitialized block

            // Initialize MarketStreamManager for consolidated WebSocket connections
            marketStreamManager.setConnectFunction(async (params) => {
                await throttleWsConnection();
                return client.websocketStreams.connect(params);
            });

            // Set up single message handler for all market data (klines + trades + depth)
            marketStreamManager.setMessageHandler((data) => {
                const payload = extractStreamPayload(data);
                if (!payload || typeof payload !== 'object') return;

                const eventType = payload.e;

                // Handle kline events - route to appropriate channels
                if (eventType === 'kline') {
                    const kline = payload.k;
                    if (!kline) return;

                    const symbol = kline.s;
                    const interval = kline.i;
                    const streamName = marketStreamManager.getKlineStreamName(symbol, interval);

                    // Find all channels subscribed to this stream
                    const subscribers = marketStreamManager.klineStreams.get(streamName);
                    if (subscribers && subscribers.size > 0) {
                        const normalized = normalizeStreamCandle(kline);
                        for (const channelId of subscribers) {
                            const channel = channelManager.getChannel(channelId);
                            if (channel && channel.symbol === symbol && channel.interval === interval) {
                                emitToChannel(channelId, 'chart', [normalized], normalized);
                            }
                        }
                    }
                    return;
                }

                // Handle trade/depth events - route to detail channel
                const detailChannel = channelManager.getDetailChannel();
                if (!detailChannel) return;

                const symbol = detailChannel.symbol;

                if (eventType === 'trade' && payload.s === symbol) {
                    const trade = {
                        time: payload.T,
                        price: payload.p,
                        qty: payload.q,
                        p: payload.p,
                        q: payload.q,
                        isBuyerMaker: payload.m,
                        s: payload.s
                    };
                    emitToChannel(detailChannel.id, 'trades', trade);
                }

                if (eventType === 'depthUpdate' && payload.s === symbol) {
                    detailChannel.depthCache.update(payload);
                    emitToChannel(detailChannel.id, 'depth', detailChannel.depthCache.getFormatted());
                }
            });
        };

        const deactivateSpotData = async () => {
            spotDataInitialized = false;
            spotRendererConnections.delete(connection);
            marketStreamManager.disableDepthView();
            await channelManager.cleanup(safeDisconnect);
            if (spotRendererConnections.size === 0) {
                await stopSharedSpotConnections();
            }
        };

        const initializeFuturesData = () => {
            if (!futuresCredentialsReady || futuresDataInitialized) return;
            futuresDataInitialized = true;
            futuresRendererConnections.add(connection);
            ensureFuturesUserDataStream();
            void refreshFuturesAccountState();
        };

        const deactivateFuturesData = async () => {
            const wasInitialized = futuresDataInitialized
                || futuresRendererConnections.has(connection);
            futuresDataInitialized = false;
            futuresRendererConnections.delete(connection);
            if (wasInitialized && futuresRendererConnections.size === 0) {
                await stopSharedFuturesConnections();
            }
        };

        /**
         * Subscribe to a channel (detail or mini)
         * Uses consolidated WebSocket connections:
         * - Klines: Single socket for all kline streams
         * - Trade+Depth: Single socket for the active detail symbol
         * 
         * @param {string} channelId 
         * @param {string} channelType 
         * @param {string} symbol 
         * @param {string} interval 
         */
        const subscribeChannel = async (channelId, channelType, symbol, interval) => {
            initializeSpotData();
            const isDetail = channelType === CHANNEL_TYPES.DETAIL;

            // For detail channels, cleanup any existing detail channel first
            if (isDetail) {
                const existingDetail = channelManager.getDetailChannel();
                if (existingDetail && existingDetail.id !== channelId) {
                    // Remove old detail channel kline streams
                    marketStreamManager.removeChannelStreams(existingDetail.id);
                    await channelManager.removeChannel(existingDetail.id, null);
                }
            }

            // Create the channel
            const channel = channelManager.createChannel(channelId, channelType, symbol, interval);
            channel.depthCache = new DepthCache();

            // Rate-limited Data Fetching
            // Binance API weights: exchangeInfo=10, depth=5-50, klines=1-5, trades=1, account=10
            const fetchPromises = [];

            // Exchange Info (Filters) - for detail channels (weight ~10)
            if (isDetail && channel.state.initChart) {
                fetchPromises.push(rateLimiter.execute(async () => {
                    const parsedFilters = await spotTradingAdapter.getExchangeInfo(symbol);
                    if (parsedFilters) {
                        emitGlobal('filters', { [symbol]: parsedFilters });
                        channel.state.initChart = false;
                    }
                }, 10).catch(err => logger.error("Exchange Info Fetch Error:", err)));
            }

            // Account State - for detail channels only
            if (isDetail && spotTradingAdapter) {
                for (const operation of spotTradingAdapter.getDetailAccountSnapshotOperations(symbol)) {
                    fetchPromises.push(enqueueSpotRefreshOperation(operation));
                }
            }

            // Recent Trades - for detail channels (weight ~1)
            if (isDetail) {
                fetchPromises.push(rateLimiter.execute(async () => {
                    const res = await client.restAPI.getTrades({ symbol, limit: 100 });
                    const recentTrades = await res.data();
                    const parsedTrades = Array.isArray(recentTrades)
                        ? recentTrades.map(t => ({
                            time: t.time,
                            price: t.price,
                            qty: t.qty,
                            isBuyerMaker: t.isBuyerMaker
                        }))
                        : [];
                    emitToChannel(channelId, 'trades', parsedTrades);
                }, 1).catch(err => logger.error("Recent Trades Fetch Error:", err)));
            }

            // Depth Snapshot - for detail channels (weight ~5 for limit 100)
            if (isDetail) {
                fetchPromises.push(rateLimiter.execute(async () => {
                    const res = await client.restAPI.depth({ symbol, limit: 100 });
                    const depthSnapshot = await res.data();
                    channel.depthCache.snapshot(depthSnapshot);
                    emitToChannel(channelId, 'depth', channel.depthCache.getFormatted());
                }, 5).catch(err => logger.error("Depth Snapshot Fetch Error:", err)));
            }

            // Klines (Chart History) - for all channel types (weight ~2 for limit 500)
            fetchPromises.push(rateLimiter.execute(async () => {
                const res = await client.restAPI.klines({ symbol, interval, limit: 500 });
                const klines = await res.data();
                const parsedKlines = Array.isArray(klines) ? klines.map(normalizeBinanceCandle) : [];
                if (parsedKlines.length) {
                    emitToChannel(channelId, 'chart', parsedKlines, parsedKlines[parsedKlines.length - 1]);
                }
            }, 2).catch(err => logger.error("Klines Fetch Error:", err)));

            // Execute REST fetches concurrently (rate-limited)
            Promise.allSettled(fetchPromises);

            // Subscribe to consolidated WebSocket Streams (all in ONE socket)
            // Add kline stream for this channel
            marketStreamManager.addKlineStream(channelId, symbol, interval);

            // For detail channels, set the detail symbol (kline tracking only)
            // NOTE: Trade + depth streams are NOT auto-subscribed!
            // Frontend must explicitly call enable_depth_view when entering DepthView
            if (isDetail) {
                marketStreamManager.setDetailSymbol(symbol);
            }
        };

        /**
         * Unsubscribe from a channel
         * @param {string} channelId 
         */
        const unsubscribeChannel = async (channelId) => {
            const channel = channelManager.getChannel(channelId);
            if (channel) {
                // Remove kline stream subscription
                marketStreamManager.removeKlineStream(channelId, channel.symbol, channel.interval);
                
                // If this was a detail channel, clear detail symbol
                if (channel.type === CHANNEL_TYPES.DETAIL) {
                    marketStreamManager.clearDetailSymbol();
                }
            }
            
            // Remove channel from manager
            await channelManager.removeChannel(channelId, null);
        };

        /**
         * Read one page of closed candles behind the chart's live window.
         *
         * The page is served to the detail channel that asked for it and only
         * while that channel still holds the pair and interval in the request.
         * A page answered after the operator moved on would arrive as one
         * market's candles drawn under another's tail — which is how the same
         * defect was found on the Futures chart on live data.
         */
        const loadChartHistory = async ({ symbol, interval, endTime, limit }) => {
            const channel = channelManager.getDetailChannel();
            if (!channel || channel.symbol !== symbol || channel.interval !== interval) {
                logger.warn(`Ignored chart history request for an inactive selection: ${symbol} ${interval}`);
                return;
            }
            const channelId = channel.id;
            await rateLimiter.execute(async () => {
                const res = await client.restAPI.klines({ symbol, interval, limit, endTime });
                const rows = await res.data();
                const parsedKlines = Array.isArray(rows) ? rows.map(normalizeBinanceCandle) : [];
                const current = channelManager.getChannel(channelId);
                if (!current || current.symbol !== symbol || current.interval !== interval) return;
                // `endTime` and `limit` travel back with the page: the renderer
                // has to be able to tell the answer to the request it is holding
                // from the answer to one it already abandoned, and a page shorter
                // than the limit is the exchange saying there is nothing older.
                emitToChannel(channelId, 'chart_history', parsedKlines, { symbol, interval, endTime, limit });
            }, 2).catch((err) => {
                logger.error('Chart History Fetch Error:', err);
                // A read that answers nothing leaves the renderer holding a
                // request forever, and one network failure disabled scrolling
                // left for the rest of the session. The failure answers the
                // request it belongs to, so the lock is released and the next
                // scroll can ask again.
                emitToChannel(channelId, 'chart_history_failed', {
                    code: err?.code ?? 'CHART_HISTORY_READ_FAILED',
                    message: 'Older candles could not be loaded.',
                }, { symbol, interval, endTime, limit });
            });
        };

        connection.on("message", async (message) => {
            if (message.type !== "utf8" || typeof message.utf8Data !== 'string') return;
            const rawUtf8Frame = message.utf8Data;
            const rawFrameBytes = Buffer.byteLength(rawUtf8Frame, 'utf8');
            if (rawFrameBytes > LOCAL_RENDERER_WS_MAX_MESSAGE_BYTES) {
                logger.warn('Rejected oversized renderer WebSocket message');
                connection.drop?.(1009, 'message too large');
                return;
            }

            const decodedRoutingEscapes = rawUtf8Frame.replace(
                /\\u([0-9a-fA-F]{4})/g,
                (_match, digits) => String.fromCharCode(Number.parseInt(digits, 16)),
            );
            if (decodedRoutingEscapes.includes('futures.execution.')
                || decodedRoutingEscapes.includes('futures.read.')
                || decodedRoutingEscapes.includes('futures.testnet.')
                || decodedRoutingEscapes.includes('futures-testnet-workstation')) {
                logger.warn('Rejected retired Futures Testnet/read-only renderer protocol');
                return;
            }

            // The production public-read workstation is routed before the broader
            // production execution prefix detector. It contains no execution action.
            if (isPotentialFuturesProductionWorkstationFrame(rawUtf8Frame)) {
                // The frame is routed before it is parsed, so the activation
                // stamp is read from the raw text here — a workstation request
                // is as market-scoped as any other — and taken back off before
                // the channel sees it, because the channel accepts its own keys
                // and nothing else.
                const {
                    frame: workstationFrame,
                    generation: workstationGeneration,
                } = splitMarketGenerationStamp(rawUtf8Frame);
                if (refuseUnlessMarketActive(
                    'futures.production.workstation',
                    MARKET_MODES.FUTURES,
                    workstationGeneration,
                )) return;
                if (!futuresCredentialsReady) {
                    sendJSON(connection, createCommandRejection(
                        'futures.production.workstation',
                        'EXECUTION_NOT_CONFIGURED',
                        credentialPreflight.markets.futures.message,
                        {
                            market: FUTURES_MARKET_TYPE,
                            startupCode: credentialPreflight.markets.futures.code,
                        },
                    ));
                    return;
                }
                try {
                    await futuresProductionWorkstationRuntime.service.handleRequest(
                        workstationFrame,
                        {
                            // The workspace's status line is the only place a
                            // resynchronization names its cause.
                            emit: (payload, frame) => {
                                diagnosticRecord.observeOutbound(payload);
                                sendFrameText(
                                    connection,
                                    frame ?? JSON.stringify(payload),
                                    workstationFrameDelivery(payload),
                                );
                            },
                        },
                    );
                } catch (error) {
                    logger.warn(`[futures-production-workstation] request rejected (${error?.code || error?.name || 'unknown'})`);
                }
                return;
            }

            let data;
            try {
                data = JSON.parse(rawUtf8Frame);
            } catch {
                logger.warn('Rejected malformed renderer WebSocket JSON');
                return;
            }
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                logger.warn('Rejected non-object renderer WebSocket message');
                return;
            }

            if (data.action === 'get_startup_status') {
                sendJSON(connection, startupEnvelope);
                return;
            }
            if (!credentialPreflight.ready) {
                emit(createCommandRejection(
                    typeof data.action === 'string' ? data.action : data.request || 'startup',
                    'EXECUTION_NOT_CONFIGURED',
                    credentialPreflight.message,
                    { startupCode: credentialPreflight.code },
                ));
                return;
            }

            // New channel protocol
            if (data.action !== undefined) {
                const envelopeError = validateRendererActionEnvelope(data, channelManager);
                if (envelopeError) {
                    emit(createCommandRejection(
                        typeof data.action === 'string' && data.action.length <= 64
                            ? data.action
                            : 'action',
                        envelopeError.code,
                        envelopeError.message,
                    ));
                    return;
                }
                // Nothing market-scoped runs before its market is the activated
                // one. `subscribeChannel` used to activate Spot implicitly, so
                // a stray subscribe was enough to start market work the
                // operator never asked for.
                if (refuseUnlessMarketActive(
                    data.action,
                    marketScopeOf(data),
                    Number.isSafeInteger(data.generation) ? data.generation : null,
                )) return;
                switch (data.action) {
                    case 'get_startup_status':
                        sendJSON(connection, startupEnvelope);
                        break;
                    case 'activate_market':
                        await serializeMarketActivation(async () => {
                            if (data.marketMode === 'spot') {
                                if (!spotCredentialsReady) {
                                    emit(createCommandRejection(
                                        'activate_market',
                                        'MARKET_NOT_CONFIGURED',
                                        credentialPreflight.markets.spot.message,
                                        {
                                            market: 'spot',
                                            startupCode: credentialPreflight.markets.spot.code,
                                        },
                                    ));
                                    return;
                                }
                                await deactivateFuturesData();
                                applyMarketActivation(MARKET_MODES.SPOT);
                                initializeSpotData();
                            } else if (data.marketMode === 'futures-live') {
                                if (!futuresCredentialsReady) {
                                    emit(createCommandRejection(
                                        'activate_market',
                                        'MARKET_NOT_CONFIGURED',
                                        credentialPreflight.markets.futures.message,
                                        {
                                            market: FUTURES_MARKET_TYPE,
                                            startupCode: credentialPreflight.markets.futures.code,
                                        },
                                    ));
                                    return;
                                }
                                await deactivateSpotData();
                                applyMarketActivation(MARKET_MODES.FUTURES);
                                initializeFuturesData();
                            } else {
                                await Promise.all([
                                    deactivateSpotData(),
                                    deactivateFuturesData(),
                                ]);
                                applyMarketActivation(MARKET_MODES.UNSELECTED);
                            }
                        });
                        break;
                    case 'subscribe': {
                        const { channelId, channelType, symbol, interval } = data;
                        if (!channelId || !symbol || !interval) {
                            logger.warn('Invalid subscribe request:', data);
                            return;
                        }
                        await subscribeChannel(channelId, channelType || CHANNEL_TYPES.DETAIL, symbol, interval);
                        break;
                    }
                    case 'unsubscribe': {
                        const { channelId } = data;
                        if (!channelId) {
                            logger.warn('Invalid unsubscribe request:', data);
                            return;
                        }
                        await unsubscribeChannel(channelId);
                        break;
                    }
                    case 'enable_depth_view': {
                        // Enable trade + depth streams for DepthView
                        // Only call this when user actually opens DepthView
                        const { symbol } = data;
                        if (!symbol) {
                            logger.warn('Invalid enable_depth_view request: missing symbol');
                            return;
                        }
                        logger.info(`[DepthView] Enabling trade + depth streams for: ${symbol}`);
                        marketStreamManager.enableDepthView(symbol);
                        break;
                    }
                    case 'disable_depth_view': {
                        // Disable trade + depth streams when leaving DepthView
                        logger.info('[DepthView] Disabling trade + depth streams');
                        marketStreamManager.disableDepthView();
                        break;
                    }
                    case 'load_chart_history': {
                        await loadChartHistory(data);
                        break;
                    }
                    case TRADING_COMMAND_ACTIONS.PLACE_ORDER:
                    case TRADING_COMMAND_ACTIONS.CANCEL_ORDER:
                    case TRADING_COMMAND_ACTIONS.REPLACE_ORDER:
                    case TRADING_COMMAND_ACTIONS.CANCEL_ALL:
                    case TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH:
                    case TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY:
                    case TRADING_COMMAND_ACTIONS.SET_TRADING_PAUSED:
                    case TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN:
                    case TRADING_COMMAND_ACTIONS.ACCOUNT_SYMBOL_CONFIG:
                    case TRADING_COMMAND_ACTIONS.SET_LEVERAGE:
                    case TRADING_COMMAND_ACTIONS.SET_MARGIN_TYPE:
                        await handleTypedTradingCommand(data);
                        break;
                }
                return;
            }

            // Legacy protocol (backward compatibility)
            if (refuseUnlessMarketActive(
                typeof data.request === 'string' ? data.request : 'request',
                marketScopeOf(data),
                Number.isSafeInteger(data.generation) ? data.generation : null,
            )) return;
            switch (data.request) {
                case 'chart': {
                    const requestData = data.data;
                    const requestId = requestData.requestId || `req-${Date.now()}`;
                    activeRequestId = requestId;
                    const nextPanelSettings = { ...requestData, requestId };

                    const previousSelected = panelSettings?.selected;
                    const previousInterval = panelSettings?.interval;
                    panelSettings = nextPanelSettings;

                    const selectedSymbol = nextPanelSettings.selected;
                    const selectedInterval = nextPanelSettings.interval;
                    const symbolChanged = !previousSelected || previousSelected !== selectedSymbol;
                    const intervalChanged = !!previousInterval && previousInterval !== selectedInterval;

                    if (symbolChanged || intervalChanged) {
                        // Convert legacy request to channel subscription
                        // Use a consistent channel ID format for the detail channel
                        const channelId = `detail-${selectedSymbol}-${selectedInterval}-${requestId}`;
                        await subscribeChannel(channelId, CHANNEL_TYPES.DETAIL, selectedSymbol, selectedInterval);
                    }
                    break;
                }
                case 'buyOrder':
                case 'sellOrder':
                    await handleOrderPlacement(data.data, data.request, data.marketType);
                    break;
                case 'cancelOrder':
                    await handleCancelOrder(data.data, data.marketType);
                    break;
                default:
                    break;
            }
        });

        connection.on("error", (err) => {
            logger.error("Renderer websocket error:", err);
        });

        connection.on("close", () => {
            logger.info("Peer " + connection.remoteAddress + " disconnected.");

            // Remove this renderer from tracking
            rendererOutboxes.get(connection)?.dispose();
            rendererOutboxes.delete(connection);
            rendererConnections.delete(connection);
            spotRendererConnections.delete(connection);
            futuresRendererConnections.delete(connection);

            // Invalidate production Futures ownership before asynchronous teardown
            // can resolve. This stops reconnects, sockets, and late delivery.
            futuresProductionWorkstationRuntime?.close();

            // Cleanup this renderer's channels (market socket per-renderer)
            void channelManager.cleanup(safeDisconnect);

            // Only cleanup shared global sockets when ALL renderers disconnect
            if (rendererConnections.size === 0) {
                logger.info("All renderers disconnected, cleaning up shared sockets...");
                globalSocketsInitialized = false;

                // Stop the ticker watchdog so it can't keep resurrecting the global
                // socket after teardown. The sockets' close handlers no-op here
                // because we null the refs before their close events fire (identity
                // guard) and because rendererConnections is empty.
                if (tickerStallInterval) {
                    clearInterval(tickerStallInterval);
                    tickerStallInterval = null;
                }
                if (globalWsConnection) {
                    const staleGlobal = globalWsConnection;
                    globalWsConnection = null;
                    void safeDisconnect(staleGlobal, 'global stream');
                }
                if (userDataWsConnection) {
                    const staleUserData = userDataWsConnection;
                    userDataWsConnection = null;
                    void safeDisconnect(staleUserData, 'user data stream');
                }
                if (keepAliveInterval) {
                    clearInterval(keepAliveInterval);
                    keepAliveInterval = null;
                }
                if (futuresUserDataWs) {
                    const staleFutures = futuresUserDataWs;
                    futuresUserDataWs = null;
                    void safeDisconnect(staleFutures, 'futures user data stream');
                }
                if (futuresKeepAliveInterval) {
                    clearInterval(futuresKeepAliveInterval);
                    futuresKeepAliveInterval = null;
                }
                futuresUserDataRequested = false;
                // This branch performs the shared teardown inline instead of
                // calling stopSharedFuturesConnections. Advance the same activation
                // guard before any in-flight account/history read can settle.
                futuresActivationGeneration += 1;
                futuresUserDataGeneration += 1;
                // Nulling the socket before disconnecting makes its close handler
                // intentionally ignore the stale instance. End history trust here
                // explicitly as part of the same physical disconnect.
                forgetFuturesHistoryState();
            } else {
                if (spotRendererConnections.size === 0) {
                    void stopSharedSpotConnections();
                }
                if (futuresRendererConnections.size === 0) {
                    void stopSharedFuturesConnections();
                }
            }
        });
    });

    let closePromise = null;
    const close = () => {
        if (closePromise) return closePromise;
        closePromise = (async () => {
            globalSocketsInitialized = false;
            if (tickerStallInterval) {
                clearInterval(tickerStallInterval);
                tickerStallInterval = null;
            }
            if (keepAliveInterval) {
                clearInterval(keepAliveInterval);
                keepAliveInterval = null;
            }
            if (futuresKeepAliveInterval) {
                clearInterval(futuresKeepAliveInterval);
                futuresKeepAliveInterval = null;
            }
            for (const connection of [...rendererConnections]) {
                try {
                    connection.drop?.(1001, 'main process shutdown');
                } catch {
                    connection.close?.();
                }
            }
            rendererConnections.clear();
            spotRendererConnections.clear();
            futuresRendererConnections.clear();
            futuresMarkPriceFeed?.stop();
            futuresUserDataGeneration += 1;
            const staleGlobal = globalWsConnection;
            const staleUserData = userDataWsConnection;
            const staleFuturesUserData = futuresUserDataWs;
            globalWsConnection = null;
            userDataWsConnection = null;
            futuresUserDataWs = null;
            await Promise.all([
                safeDisconnect(staleGlobal, 'global stream'),
                safeDisconnect(staleUserData, 'user data stream'),
                safeDisconnect(staleFuturesUserData, 'futures user data stream'),
            ]);
            wsServer.shutDown?.();
            await new Promise((resolve) => {
                let settled = false;
                const done = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    resolve();
                };
                const timeout = setTimeout(done, 5_000);
                timeout.unref?.();
                try {
                    server.close(done);
                    server.closeAllConnections?.();
                } catch {
                    done();
                }
            });
        })();
        return closePromise;
    };

    return Object.freeze({
        close,
    });
}
