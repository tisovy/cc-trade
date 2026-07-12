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
    buildSpotMockOrderPlacementExecutionReport,
    runSpotAccountRefreshOperations,
} from './spot-trading-adapter.js';
import { FuturesTradingAdapter } from './futures-trading-adapter.js';
import { createFuturesReadOnlyService } from './futures-readonly-service.js';
import {
    createFuturesReadOnlyTransport,
    resolveFuturesReadOnlyTransportConfig,
} from './futures-readonly-transport.js';
import {
    FUTURES_READ_RESPONSE_TYPES,
    createFuturesReadOnlyResponse,
    isFuturesReadOnlyAction,
} from '../../src/utils/futuresReadOnlyProtocol.js';
import { TRADING_COMMAND_ACTIONS } from '../../src/utils/tradingCommands.js';

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const activeLogLevel = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LOG_LEVELS.info;
const logger = {
    debug: (...args) => activeLogLevel >= LOG_LEVELS.debug && console.debug(...args),
    info: (...args) => activeLogLevel >= LOG_LEVELS.info && console.info(...args),
    warn: (...args) => activeLogLevel >= LOG_LEVELS.warn && console.warn(...args),
    error: (...args) => console.error(...args)
};

// Mock Data Generators (Preserved)
const generateTrade = () => ({
    time: Date.now(),
    price: (45000 + Math.random() * 100).toFixed(2),
    qty: (Math.random() * 2).toFixed(4),
    isBuyerMaker: Math.random() > 0.5
});

const generateTicker = () => ([
    { symbol: 'BTCUSDT', lastPrice: (45000 + Math.random() * 100).toFixed(2), priceChangePercent: '2.5', highPrice: '46000.00', lowPrice: '44000.00', quoteVolume: '100000000', closeTime: Date.now() },
    { symbol: 'ETHUSDT', lastPrice: (3000 + Math.random() * 50).toFixed(2), priceChangePercent: '1.2', highPrice: '3100.00', lowPrice: '2900.00', quoteVolume: '50000000', closeTime: Date.now() }
]);

const generateDepth = () => {
    const bids = {};
    const asks = {};
    for (let i = 0; i < 10; i++) {
        bids[(44900 + i * 10).toFixed(2)] = (Math.random() * 2).toFixed(2);
        asks[(45100 + i * 10).toFixed(2)] = (Math.random() * 2).toFixed(2);
    }
    return { bids, asks };
};

const buildMockCandle = (timestamp, open, high, low, close, volume) => ({
    time: Math.floor(timestamp / 1000),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    isFinal: true,
});

const buildMockChartPayload = () => {
    const base = Date.now();
    const candles = [
        buildMockCandle(base - 60000, 45000, 45100, 44900, 45050, 1000),
        buildMockCandle(base, 45050, 45150, 45000, 45100, 1200),
    ];
    return {
        chart: candles,
        last_tick: candles[candles.length - 1],
    };
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

// Global rate limiter instance: 800 weight/min, 500ms delay between requests
const rateLimiter = new RateLimiter(800, 60000, 500);

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

const sendJSON = (connection, payload) => {
    if (connection && connection.connected) {
        connection.sendUTF(JSON.stringify(payload));
    }
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

export function setupBinanceConnection({ localWebSocketAccess = createLocalWebSocketAccess() } = {}) {
    const APIKEY = process.env.BK;
    const APISECRET = process.env.BS;
    const futuresMode = (process.env.FUTURES_READ_MODE || 'mock').trim().toLowerCase();
    const futuresApiKey = process.env.FUTURES_TESTNET_API_KEY;
    const futuresApiSecret = process.env.FUTURES_TESTNET_API_SECRET;
    const futuresMockScenario = process.env.FUTURES_READ_MOCK_SCENARIO?.trim();
    const futuresTransportConfig = futuresMode === 'mock'
        ? {
            mode: 'mock',
            ...(futuresMockScenario ? { mockScenario: futuresMockScenario } : {}),
        }
        : {
            mode: futuresMode,
            apiKey: futuresApiKey,
            apiSecret: futuresApiSecret,
        };
    const resolvedFuturesTransportConfig = resolveFuturesReadOnlyTransportConfig(
        futuresTransportConfig,
    );
    // This non-secret renderer-visible value drives truthful MOCK/TESTNET status
    // before the first snapshot or while the local socket is disconnected.
    process.env.FUTURES_READ_ENVIRONMENT = resolvedFuturesTransportConfig.environment;

    // Electron currently enables Node integration in the renderer. Consume the
    // futures-only credentials before any BrowserWindow is created, retain them
    // only in this main-process closure, and never expose them through protocol data.
    delete process.env.FUTURES_TESTNET_API_KEY;
    delete process.env.FUTURES_TESTNET_API_SECRET;

    const USE_MOCK = !APIKEY;
    const sharedProxyAgent = resolveProxyAgent();
    applyLogMasking([APIKEY, APISECRET, futuresApiKey, futuresApiSecret]);

    logger.info(`Starting Binance Service. Mock Mode: ${USE_MOCK}`);
    logger.info(`Starting Futures Read-Only Service. Environment: ${resolvedFuturesTransportConfig.environment}`);

    let client;
    let spotTradingAdapter = null;

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

    if (!USE_MOCK) {
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
        if (USE_MOCK || !client) return;
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

    const parsedPort = parseInt(process.env.WS_PORT || process.env.WEBSOCKET_PORT || process.env.VITE_WS_PORT || '14477', 10);
    const websocketServerPort = Number.isFinite(parsedPort) ? parsedPort : 14477;
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
        autoAcceptConnections: false
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

    // Broadcast to all connected renderers
    const broadcastToRenderers = (payload) => {
        const message = JSON.stringify(payload);
        for (const conn of rendererConnections) {
            if (conn.connected) {
                conn.sendUTF(message);
            }
        }
    };

    // Shared balance refresh - fetches via REST and broadcasts to all renderers
    // Deduplicated by in-flight guard to avoid duplicate calls from rapid events
    let _balanceRefreshInFlight = false;
    const fetchAndBroadcastBalances = async () => {
        if (!spotTradingAdapter || USE_MOCK) return;
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

    wsServer.on("request", (request) => {
        logger.info("Connection from origin " + request.origin + ".");
        const accessCheck = validateLocalWebSocketRequest(request, localWebSocketAccess);
        if (!accessCheck.allowed) {
            logger.warn(`Rejected local WebSocket request: ${accessCheck.reason}`);
            request.reject(accessCheck.status, accessCheck.reason);
            return;
        }

        const connection = request.accept(null, request.origin);
        logger.info("Connection accepted.");
        
        // Track this renderer connection
        rendererConnections.add(connection);

        let panelSettings = {};
        let activeRequestId = null;

        // Channel manager for this connection (each renderer has its own channels)
        const channelManager = new ChannelManager(logger);
        const marketStreamManager = channelManager.getMarketStreamManager();
        const futuresReadOnlyTransport = createFuturesReadOnlyTransport(
            futuresTransportConfig,
        );
        const futuresReadOnlyAdapter = new FuturesTradingAdapter({
            transport: futuresReadOnlyTransport,
        });
        const futuresReadOnlyService = createFuturesReadOnlyService({
            adapter: futuresReadOnlyAdapter,
            transport: futuresReadOnlyTransport,
            environment: resolvedFuturesTransportConfig.environment,
            executeRead: (operation, weight, { signal, maxRetries = 0 } = {}) => (
                rateLimiter.execute(operation, weight, maxRetries, { signal })
            ),
            onInternalError: ({ resource, error }) => {
                const safeCode = error?.code ?? error?.status ?? error?.name ?? 'unknown';
                logger.warn(`[futures-read] ${resource} failed (${safeCode})`);
            },
        });

        const emitFuturesReadOnlyRejection = (data, error) => {
            const trimmedRequestId = typeof data?.requestId === 'string'
                ? data.requestId.trim()
                : '';
            const requestId = trimmedRequestId
                ? trimmedRequestId
                : 'invalid-futures-read-request';
            const symbol = typeof data?.symbol === 'string'
                && /^[A-Z0-9_]{1,64}$/.test(data.symbol)
                ? data.symbol
                : null;
            const code = typeof error?.code === 'string'
                ? error.code
                : 'FUTURES_READ_REQUEST_REJECTED';
            const rejection = createFuturesReadOnlyResponse({
                requestId,
                type: FUTURES_READ_RESPONSE_TYPES.REJECTION,
                symbol,
                environment: resolvedFuturesTransportConfig.environment,
                payload: {
                    code,
                    message: 'Futures read-only request rejected',
                },
            });
            sendJSON(connection, rejection);
        };

        const emitSpotRefreshOperation = async (operation) => {
            const payload = await operation.loadPayload();
            emit(payload);
        };

        const enqueueSpotRefreshOperation = (operation) => (
            rateLimiter.execute(() => emitSpotRefreshOperation(operation), operation.weight)
                .catch((err) => logger.error(operation.errorLabel || 'Account Refresh Fetch Error:', err))
        );

        const refreshAccountState = async (symbol) => {
            if (!spotTradingAdapter) return;
            await runSpotAccountRefreshOperations({
                operations: spotTradingAdapter.getAccountRefreshOperations(symbol),
                executeOperation: (operation) => (
                    rateLimiter.execute(() => emitSpotRefreshOperation(operation), operation.weight)
                ),
                onOperationError: ({ error, errorLabel }) => logger.error(`${errorLabel}:`, error),
            });
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
                quantityValue,
                priceValue,
                numericQuantity,
                numericPrice,
            } = validation.command;

            if (USE_MOCK) {
                logger.info(`[MOCK] Order Placed: ${requestType}`, payload);
                emit({
                    execution_update: buildSpotMockOrderPlacementExecutionReport({
                        symbol,
                        side: resolvedSide,
                        priceValue,
                        quantityValue,
                    }),
                });
                return;
            }
            if (!spotTradingAdapter) return;

            try {
                logger.info(`[orders] ${resolvedSide} ${symbol} qty=${numericQuantity} price=${numericPrice}`);
                const executionReport = await spotTradingAdapter.placeOrder({
                    symbol,
                    side: resolvedSide,
                    numericQuantity,
                    numericPrice,
                });
                emit({ execution_update: executionReport });
                await refreshAccountState(symbol);
            } catch (error) {
                logger.error("Order placement error:", error);
                if (error?.response?.data) {
                    logger.error("Order placement response:", error.response.data);
                }
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
            if (!spotTradingAdapter) return;

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
                emit({ execution_update: executionReport });
                await refreshAccountState(targetSymbol);
            } catch (error) {
                logger.error("Cancel order error:", error);
                if (error?.response?.data) {
                    logger.error("Cancel order response:", error.response.data);
                }
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

            switch (validation.command.action) {
                case TRADING_COMMAND_ACTIONS.PLACE_ORDER:
                    await handleOrderPlacement(validation.command.orderPayload, validation.command.requestType);
                    break;
                case TRADING_COMMAND_ACTIONS.CANCEL_ORDER:
                    await handleCancelOrder(validation.command.cancelPayload);
                    break;
                case TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH:
                    await refreshAccountState(validation.command.symbol);
                    break;
            }
        };

        // Legacy emit for backward compatibility
        const emit = (payload, overrideRequestId) => {
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

            sendJSON(connection, message);
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

        if (USE_MOCK) {
            // Mock Logic - send initial global data
            emitGlobal('filters', {
                'BTCUSDT': { tickSize: '0.01', stepSize: '0.000001', minQty: '0.000001', minNotional: '10', maxQty: '9000', maxPrice: '1000000', minPrice: '0.01', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', baseAssetPrecision: 8, quoteAssetPrecision: 2, quotePrecision: 2 },
                'ETHUSDT': { tickSize: '0.01', stepSize: '0.0001', minQty: '0.0001', minNotional: '10', maxQty: '9000', maxPrice: '1000000', minPrice: '0.01', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT', baseAssetPrecision: 8, quoteAssetPrecision: 2, quotePrecision: 2 }
            });
            emitGlobal('balances', { 'USDT': { available: '1000.00', onOrder: '0.00' }, 'BTC': { available: '0.5', onOrder: '0.1' } });
            emitGlobal('orders', []);
            emitGlobal('ticker', generateTicker());

            // Mock interval for streaming data
            const mockInterval = setInterval(() => {
                if (!connection.connected) {
                    clearInterval(mockInterval);
                    return;
                }

                // Emit to active detail channel if exists
                const detailChannel = channelManager.getDetailChannel();
                if (detailChannel) {
                    const mockPayload = buildMockChartPayload();
                    emitToChannel(detailChannel.id, 'trades', [generateTrade()]);
                    emitToChannel(detailChannel.id, 'depth', generateDepth());
                    emitToChannel(detailChannel.id, 'chart', mockPayload.chart, mockPayload.last_tick);
                }

                // Emit ticker updates globally
                emitGlobal('ticker', generateTicker());
            }, 1000);
        } else {
            // Real Data Logic using @binance/spot

            const sendInitialTicker = async () => {
                try {
                    const snapshot = await ensureTickerSnapshot();
                    if (snapshot?.length) {
                        const payload = snapshot.map((entry) => ({ ...entry }));
                        sendJSON(connection, { ticker: payload });
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
                                broadcastToRenderers({ ticker_batch: batch });
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
                            if (code !== 1000 && rendererConnections.size > 0 && !globalWsReconnecting) {
                                logger.info('Scheduling global WS reconnection...');
                                setTimeout(() => subscribeGlobal(), 5000);
                            }
                        });
                    } catch (err) {
                        globalWsReconnecting = false;
                        const isNetworkError = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' ||
                                               err?.code === 'ENOTFOUND' || err?.message?.includes('TLS');
                        
                        if (isNetworkError && retryCount < MAX_RETRIES && rendererConnections.size > 0) {
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
                    if (rendererConnections.size === 0) return;
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
                    if (rendererConnections.size === 0) return;
                    
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
                                if (rendererConnections.size === 0) {
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
                    if (rendererConnections.size === 0) {
                        userDataReconnecting = false;
                        return;
                    }

                    const nextUserDataConnection = await spotTradingAdapter.connectUserDataStream(listenKey);
                    if (rendererConnections.size === 0) {
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
                        if (rendererConnections.size > 0 && !userDataReconnecting) {
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
                                    if (rendererConnections.size === 0 || userDataWsConnection !== udConn) {
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
                    
                    if (isNetworkError && retryCount < MAX_RETRIES && rendererConnections.size > 0) {
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
        }

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

            if (USE_MOCK) {
                // Mock mode - emit mock data for the channel
                const mockPayload = buildMockChartPayload();
                emitToChannel(channelId, 'chart', mockPayload.chart, mockPayload.last_tick);
                return;
            }

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

        connection.on("message", async (message) => {
            if (message.type !== "utf8") return;
            const data = JSON.parse(message.utf8Data);

            // New channel protocol
            if (data.action) {
                if (isFuturesReadOnlyAction(data.action)) {
                    try {
                        futuresReadOnlyService.handleRequest(
                            data,
                            (response) => sendJSON(connection, response),
                        );
                    } catch (error) {
                        emitFuturesReadOnlyRejection(data, error);
                    }
                    return;
                }
                if (
                    ['subscribe', 'unsubscribe', 'enable_depth_view', 'disable_depth_view']
                        .includes(data.action)
                    && data.marketType !== undefined
                    && data.marketType !== 'spot'
                ) {
                    emit(createCommandRejection(
                        data.action,
                        'UNSUPPORTED_MARKET_TYPE',
                        'only spot market-data channel actions are enabled',
                        { field: 'marketType', value: data.marketType },
                    ));
                    return;
                }
                switch (data.action) {
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
                    case TRADING_COMMAND_ACTIONS.PLACE_ORDER:
                    case TRADING_COMMAND_ACTIONS.CANCEL_ORDER:
                    case TRADING_COMMAND_ACTIONS.REPLACE_ORDER:
                    case TRADING_COMMAND_ACTIONS.CANCEL_ALL:
                    case TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH:
                        await handleTypedTradingCommand(data);
                        break;
                    case 'order': {
                        // Order with channel context
                        const orderType = data.type === 'sell' ? 'sellOrder' : 'buyOrder';
                        await handleOrderPlacement(data, orderType);
                        break;
                    }
                    case 'cancelOrder': {
                        await handleCancelOrder(data);
                        break;
                    }
                }
                return;
            }

            // Legacy protocol (backward compatibility)
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
            rendererConnections.delete(connection);

            // Invalidate futures ownership before any asynchronous teardown can
            // resolve. This stops polling, stale checks, reconnects, sockets, and
            // late delivery for this renderer generation.
            futuresReadOnlyService.stop();

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
            }
        });
    });
}
