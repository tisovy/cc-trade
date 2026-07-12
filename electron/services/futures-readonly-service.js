import {
    FUTURES_READ_ACTIONS,
    FUTURES_READ_RESPONSE_TYPES,
    createFuturesReadOnlyResponse,
    parseFuturesReadOnlyRequest,
} from '../../src/utils/futuresReadOnlyProtocol.js';

export const FUTURES_READONLY_WEIGHTS = Object.freeze({
    exchangeInfo: 1,
    market: 1,
    positions: 5,
    marginBalance: 5,
    openOrders: 1,
    algoOpenOrders: 1,
});

export const FUTURES_READONLY_TIMING = Object.freeze({
    currentPollMs: 15_000,
    metadataRetryMs: 15_000,
    readTimeoutMs: 10_000,
    rateLimitPauseMs: 120_000,
    staleAfterMs: 30_000,
    staleCheckMs: 5_000,
    streamConnectTimeoutMs: 10_000,
    streamSilenceTimeoutMs: 5_000,
    reconnectDelaysMs: Object.freeze([1_000, 2_000, 5_000]),
});

export const FUTURES_READONLY_RESOURCE_NAMES = Object.freeze([
    'exchangeInfo',
    'market',
    'positions',
    'marginBalance',
    'openOrders',
    'algoOpenOrders',
]);

export const FUTURES_READONLY_STATUSES = Object.freeze({
    LOADING: 'loading',
    READY: 'ready',
    EMPTY: 'empty',
    PARTIAL: 'partial',
    UNAVAILABLE: 'unavailable',
    STALE: 'stale',
    DISCONNECTED: 'disconnected',
    ERROR: 'error',
});

export const FUTURES_READONLY_SAFE_ERROR_CODES = Object.freeze({
    AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
    DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
    RATE_LIMITED: 'RATE_LIMITED',
    READ_TIMEOUT: 'READ_TIMEOUT',
    READ_FAILED: 'READ_FAILED',
    STREAM_DISCONNECTED: 'STREAM_DISCONNECTED',
    STREAM_PAYLOAD_INVALID: 'STREAM_PAYLOAD_INVALID',
    TRANSPORT_UNAVAILABLE: 'TRANSPORT_UNAVAILABLE',
});

const DYNAMIC_RESOURCE_NAMES = Object.freeze([
    'market',
    'positions',
    'marginBalance',
    'openOrders',
    'algoOpenOrders',
]);

const NETWORK_ERROR_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENETDOWN',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
]);

const AUTH_ERROR_CODES = new Set([-2015, -2014, 401, 403, '-2015', '-2014', '401', '403']);
const RATE_LIMIT_ERROR_CODES = new Set([
    -1003,
    418,
    429,
    '-1003',
    '418',
    '429',
]);

const createResourceRecord = () => ({
    status: FUTURES_READONLY_STATUSES.LOADING,
    data: null,
    lastUpdatedAt: null,
    errorCode: null,
});

const createResources = () => Object.fromEntries(
    FUTURES_READONLY_RESOURCE_NAMES.map(name => [name, createResourceRecord()]),
);

const isRecord = value => (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
);

const cloneValue = (value) => {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    );
};

const hasData = record => record.data !== null;

const safeClose = async (connection) => {
    if (!connection) return;
    try {
        if (typeof connection.close === 'function') {
            await connection.close();
            return;
        }
        if (typeof connection.disconnect === 'function') {
            await connection.disconnect();
            return;
        }
        if (typeof connection.unsubscribe === 'function') {
            await connection.unsubscribe();
        }
    } catch {
        // Teardown is deliberately best-effort and never starts another lifecycle.
    }
};

const isAbortError = (error, signal) => (
    signal?.aborted ||
    error?.name === 'AbortError' ||
    error?.code === 'ABORT_ERR'
);

const createAbortError = () => {
    const error = new Error('Futures read-only operation aborted');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    return error;
};

const createReadTimeoutError = (resourceName) => {
    const error = new Error(`Futures read-only ${resourceName} read timed out`);
    error.name = 'FuturesReadOnlyTimeoutError';
    error.code = FUTURES_READONLY_SAFE_ERROR_CODES.READ_TIMEOUT;
    return error;
};

const createStreamTimeoutError = (phase) => {
    const error = new Error(`Futures mark-price stream ${phase} watchdog expired`);
    error.name = 'FuturesReadOnlyStreamTimeoutError';
    error.code = 'ETIMEDOUT';
    return error;
};

const classifySafeError = (error) => {
    const code = error?.code;
    if (code === FUTURES_READONLY_SAFE_ERROR_CODES.READ_TIMEOUT) {
        return FUTURES_READONLY_SAFE_ERROR_CODES.READ_TIMEOUT;
    }
    if (AUTH_ERROR_CODES.has(code)) {
        return FUTURES_READONLY_SAFE_ERROR_CODES.AUTH_UNAVAILABLE;
    }
    if (RATE_LIMIT_ERROR_CODES.has(code) || error?.status === 418 || error?.status === 429) {
        return FUTURES_READONLY_SAFE_ERROR_CODES.RATE_LIMITED;
    }
    if (NETWORK_ERROR_CODES.has(code)) {
        return FUTURES_READONLY_SAFE_ERROR_CODES.TRANSPORT_UNAVAILABLE;
    }
    if (typeof code === 'string' && code.endsWith('_UNAVAILABLE')) {
        return FUTURES_READONLY_SAFE_ERROR_CODES.DATA_UNAVAILABLE;
    }
    return FUTURES_READONLY_SAFE_ERROR_CODES.READ_FAILED;
};

const isEmptyData = data => Array.isArray(data) && data.length === 0;

const normalizeStreamMarket = (event, symbol, previousMarket) => {
    if (
        !isRecord(event) ||
        event.e !== 'markPriceUpdate' ||
        event.s !== symbol ||
        typeof event.p !== 'string' || event.p.length === 0 ||
        typeof event.i !== 'string' || event.i.length === 0 ||
        typeof event.P !== 'string' || event.P.length === 0 ||
        typeof event.r !== 'string' || event.r.length === 0 ||
        !Number.isSafeInteger(event.E) || event.E < 0 ||
        !Number.isSafeInteger(event.T) || event.T < 0
    ) {
        const error = new Error('Invalid futures mark-price stream payload');
        error.code = FUTURES_READONLY_SAFE_ERROR_CODES.STREAM_PAYLOAD_INVALID;
        throw error;
    }

    const previousFundingState = previousMarket?.fundingState;
    return {
        markPrice: {
            marketType: 'futures',
            symbol,
            markPrice: event.p,
            indexPrice: event.i,
            estimatedSettlePrice: event.P,
            time: event.E,
        },
        fundingState: {
            marketType: 'futures',
            symbol,
            lastFundingRate: event.r,
            interestRate: previousFundingState?.interestRate ?? null,
            nextFundingTime: event.T,
            time: event.E,
        },
    };
};

const requireDependency = (condition, message) => {
    if (!condition) throw new TypeError(message);
};

const resolveParsedRequest = (result) => {
    if (result?.ok === false) {
        throw result.error || new TypeError('Invalid futures read-only request');
    }
    return result?.request || result?.value || result;
};

export class FuturesReadOnlyService {
    constructor({
        adapter,
        transport,
        executeRead,
        environment,
        marginAsset = 'USDT',
        onInternalError = () => {},
        now = () => Date.now(),
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout,
        setIntervalFn = setInterval,
        clearIntervalFn = clearInterval,
    }) {
        requireDependency(adapter && typeof adapter === 'object', 'adapter is required');
        requireDependency(
            transport && typeof transport.subscribeMarkPrice === 'function',
            'read-only transport.subscribeMarkPrice is required',
        );
        requireDependency(typeof executeRead === 'function', 'executeRead is required');
        requireDependency(
            environment === 'mock' || environment === 'testnet',
            'environment must be mock or testnet',
        );
        requireDependency(
            typeof marginAsset === 'string' && marginAsset.length > 0,
            'marginAsset must be a non-empty string',
        );
        requireDependency(typeof onInternalError === 'function', 'onInternalError must be a function');

        this.adapter = adapter;
        this.transport = transport;
        this.executeRead = executeRead;
        this.environment = environment;
        this.marginAsset = marginAsset;
        this.onInternalError = onInternalError;
        this.now = now;
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;
        this.setIntervalFn = setIntervalFn;
        this.clearIntervalFn = clearIntervalFn;
        this.generation = 0;
        this.session = null;
    }

    handleRequest(rawRequest, onResponse) {
        const request = resolveParsedRequest(parseFuturesReadOnlyRequest(rawRequest));
        if (request.action === FUTURES_READ_ACTIONS.SUBSCRIBE) {
            return this.startSubscription(request, onResponse);
        }
        if (request.action === FUTURES_READ_ACTIONS.UNSUBSCRIBE) {
            return this.stopSubscription(request);
        }
        throw new TypeError('Unsupported futures read-only action');
    }

    subscribe(rawRequest, onResponse) {
        const request = resolveParsedRequest(parseFuturesReadOnlyRequest(rawRequest));
        if (request.action !== FUTURES_READ_ACTIONS.SUBSCRIBE) {
            throw new TypeError('Expected a futures read-only subscribe request');
        }
        return this.startSubscription(request, onResponse);
    }

    startSubscription(request, onResponse) {
        requireDependency(typeof onResponse === 'function', 'onResponse must be a function');

        this.stop();
        const generation = ++this.generation;
        const session = {
            generation,
            requestId: request.requestId,
            symbol: request.symbol,
            onResponse,
            controller: new AbortController(),
            resources: createResources(),
            resourceRequestIds: Object.fromEntries(
                FUTURES_READONLY_RESOURCE_NAMES.map(name => [name, 0]),
            ),
            inFlightReads: new Map(),
            internalErrors: new Map(),
            connected: false,
            streamState: 'connecting',
            stream: null,
            streamAttemptId: 0,
            reconnectAttempt: 0,
            reconnectTimer: null,
            streamWatchdogTimer: null,
            pollTimer: null,
            metadataRetryTimer: null,
            staleTimer: null,
            pollingPausedUntil: 0,
            latestStreamEvent: null,
            closed: false,
        };
        this.session = session;

        this.emitSnapshot(session);
        this.startTimers(session);
        this.startInitialReads(session);
        void this.connectStream(session);

        const subscribedRequestId = request.requestId;
        const subscribedGeneration = generation;
        return () => {
            if (
                this.session?.requestId !== subscribedRequestId ||
                this.session?.generation !== subscribedGeneration
            ) {
                return false;
            }
            return this.stopSession(this.session);
        };
    }

    unsubscribe(rawRequest) {
        const request = resolveParsedRequest(parseFuturesReadOnlyRequest(rawRequest));
        if (request.action !== FUTURES_READ_ACTIONS.UNSUBSCRIBE) {
            throw new TypeError('Expected a futures read-only unsubscribe request');
        }
        return this.stopSubscription(request);
    }

    stopSubscription(request) {
        if (!this.session || this.session.requestId !== request.requestId) return false;
        return this.stopSession(this.session);
    }

    stop() {
        if (!this.session) return false;
        return this.stopSession(this.session);
    }

    stopSession(session) {
        if (session.closed) return false;
        session.closed = true;
        session.controller.abort();

        if (session.pollTimer !== null) {
            this.clearTimeoutFn(session.pollTimer);
            session.pollTimer = null;
        }
        if (session.metadataRetryTimer !== null) {
            this.clearTimeoutFn(session.metadataRetryTimer);
            session.metadataRetryTimer = null;
        }
        if (session.staleTimer !== null) {
            this.clearIntervalFn(session.staleTimer);
            session.staleTimer = null;
        }
        if (session.reconnectTimer !== null) {
            this.clearTimeoutFn(session.reconnectTimer);
            session.reconnectTimer = null;
        }
        this.clearStreamWatchdog(session);

        for (const read of session.inFlightReads.values()) {
            if (read.timeoutTimer !== null) this.clearTimeoutFn(read.timeoutTimer);
            read.controller.abort(createAbortError());
        }
        session.inFlightReads.clear();

        session.streamAttemptId += 1;
        const connection = session.stream;
        session.stream = null;
        if (this.session === session) this.session = null;
        void safeClose(connection);
        return true;
    }

    owns(session) {
        return (
            this.session === session &&
            !session.closed &&
            !session.controller.signal.aborted &&
            this.generation === session.generation &&
            this.session.requestId === session.requestId &&
            this.session.symbol === session.symbol
        );
    }

    ownsRead(session, resourceName, requestId) {
        return (
            this.owns(session) &&
            session.resourceRequestIds[resourceName] === requestId
        );
    }

    ownsStream(session, attemptId) {
        return this.owns(session) && session.streamAttemptId === attemptId;
    }

    reportInternalError(session, resourceName, error) {
        session.internalErrors.set(resourceName, error);
        try {
            this.onInternalError({
                resource: resourceName,
                error,
                generation: session.generation,
                requestId: session.requestId,
                symbol: session.symbol,
            });
        } catch {
            // Diagnostics must never alter lifecycle ownership or renderer delivery.
        }
    }

    startTimers(session) {
        this.scheduleCurrentPoll(session, FUTURES_READONLY_TIMING.currentPollMs);

        session.staleTimer = this.setIntervalFn(() => {
            if (!this.owns(session)) return;
            this.markStaleResources(session);
        }, FUTURES_READONLY_TIMING.staleCheckMs);
    }

    startInitialReads(session) {
        this.readResource(
            session,
            'exchangeInfo',
            FUTURES_READONLY_WEIGHTS.exchangeInfo,
            signal => this.adapter.getExchangeInfo(session.symbol, signal),
        );
        this.readResource(
            session,
            'market',
            FUTURES_READONLY_WEIGHTS.market,
            signal => this.adapter.getCurrentMarketState(session.symbol, signal),
        );
        this.startCurrentReads(session);
    }

    startCurrentReads(session) {
        if (!this.owns(session) || this.now() < session.pollingPausedUntil) return;
        this.readResource(
            session,
            'positions',
            FUTURES_READONLY_WEIGHTS.positions,
            signal => this.adapter.getPositionRisks(session.symbol, signal),
        );
        this.readResource(
            session,
            'marginBalance',
            FUTURES_READONLY_WEIGHTS.marginBalance,
            signal => this.adapter.getAccountBalance(this.marginAsset, signal),
        );
        this.readResource(
            session,
            'openOrders',
            FUTURES_READONLY_WEIGHTS.openOrders,
            signal => this.adapter.getOpenOrders(session.symbol, signal),
        );
        this.readResource(
            session,
            'algoOpenOrders',
            FUTURES_READONLY_WEIGHTS.algoOpenOrders,
            signal => this.adapter.getAlgoOpenOrders(session.symbol, signal),
        );
    }

    scheduleCurrentPoll(session, requestedDelay) {
        if (!this.owns(session) || session.pollTimer !== null) return;
        const pauseDelay = Math.max(0, session.pollingPausedUntil - this.now());
        const delay = Math.max(requestedDelay, pauseDelay);
        session.pollTimer = this.setTimeoutFn(() => {
            session.pollTimer = null;
            if (!this.owns(session)) return;
            if (this.now() >= session.pollingPausedUntil) this.startCurrentReads(session);
            this.scheduleCurrentPoll(session, FUTURES_READONLY_TIMING.currentPollMs);
        }, delay);
    }

    scheduleMetadataRetry(session) {
        if (!this.owns(session) || session.metadataRetryTimer !== null) return;
        if (session.resources.exchangeInfo.status === FUTURES_READONLY_STATUSES.READY) return;
        const pauseDelay = Math.max(0, session.pollingPausedUntil - this.now());
        const delay = Math.max(FUTURES_READONLY_TIMING.metadataRetryMs, pauseDelay);
        session.metadataRetryTimer = this.setTimeoutFn(() => {
            session.metadataRetryTimer = null;
            if (!this.owns(session)) return;
            if (session.resources.exchangeInfo.status === FUTURES_READONLY_STATUSES.READY) return;
            if (this.now() < session.pollingPausedUntil) {
                this.scheduleMetadataRetry(session);
                return;
            }
            this.readResource(
                session,
                'exchangeInfo',
                FUTURES_READONLY_WEIGHTS.exchangeInfo,
                signal => this.adapter.getExchangeInfo(session.symbol, signal),
            );
        }, delay);
    }

    pausePollingForRateLimit(session) {
        session.pollingPausedUntil = Math.max(
            session.pollingPausedUntil,
            this.now() + FUTURES_READONLY_TIMING.rateLimitPauseMs,
        );
    }

    readResource(session, resourceName, weight, load) {
        if (!this.owns(session) || session.inFlightReads.has(resourceName)) return false;
        const requestId = ++session.resourceRequestIds[resourceName];
        const controller = new AbortController();
        const signal = controller.signal;
        const abortFromSession = () => controller.abort(createAbortError());
        session.controller.signal.addEventListener('abort', abortFromSession, { once: true });
        let rejectOnAbort;
        const abortPromise = new Promise((resolve, reject) => {
            void resolve;
            rejectOnAbort = () => reject(signal.reason ?? createAbortError());
            signal.addEventListener('abort', rejectOnAbort, { once: true });
        });
        let rejectOnTimeout;
        const timeoutPromise = new Promise((resolve, reject) => {
            void resolve;
            rejectOnTimeout = reject;
        });
        const read = {
            controller,
            requestId,
            timeoutTimer: this.setTimeoutFn(() => {
                const error = createReadTimeoutError(resourceName);
                controller.abort(error);
                rejectOnTimeout(error);
            }, FUTURES_READONLY_TIMING.readTimeoutMs),
        };
        session.inFlightReads.set(resourceName, read);

        void (async () => {
            try {
                const readPromise = Promise.resolve(this.executeRead(
                    async () => {
                        if (!this.ownsRead(session, resourceName, requestId)) return undefined;
                        return load(signal);
                    },
                    weight,
                    { signal, maxRetries: 0 },
                ));
                const data = await Promise.race([readPromise, timeoutPromise, abortPromise]);
                if (!this.ownsRead(session, resourceName, requestId)) return;
                let resolvedData = data;
                if (
                    resourceName === 'market' &&
                    session.latestStreamEvent &&
                    session.latestStreamEvent.E >= data?.markPrice?.time
                ) {
                    resolvedData = normalizeStreamMarket(
                        session.latestStreamEvent,
                        session.symbol,
                        data,
                    );
                }
                session.internalErrors.delete(resourceName);
                session.resources[resourceName] = {
                    status: isEmptyData(resolvedData)
                        ? FUTURES_READONLY_STATUSES.EMPTY
                        : FUTURES_READONLY_STATUSES.READY,
                    data: cloneValue(resolvedData),
                    lastUpdatedAt: this.now(),
                    errorCode: null,
                };
                this.emitSnapshot(session);
            } catch (error) {
                if (!this.ownsRead(session, resourceName, requestId)
                    || (isAbortError(error, signal)
                        && error?.code !== FUTURES_READONLY_SAFE_ERROR_CODES.READ_TIMEOUT)) {
                    return;
                }
                this.reportInternalError(session, resourceName, error);
                const safeErrorCode = classifySafeError(error);
                if (safeErrorCode === FUTURES_READONLY_SAFE_ERROR_CODES.RATE_LIMITED) {
                    this.pausePollingForRateLimit(session);
                }
                const previous = session.resources[resourceName];
                if (resourceName === 'market' && session.connected && hasData(previous)) {
                    return;
                }
                session.resources[resourceName] = {
                    ...previous,
                    status: safeErrorCode === FUTURES_READONLY_SAFE_ERROR_CODES.DATA_UNAVAILABLE
                        ? FUTURES_READONLY_STATUSES.UNAVAILABLE
                        : FUTURES_READONLY_STATUSES.ERROR,
                    errorCode: safeErrorCode,
                };
                this.emitSnapshot(session);
            } finally {
                signal.removeEventListener('abort', rejectOnAbort);
                session.controller.signal.removeEventListener('abort', abortFromSession);
                if (read.timeoutTimer !== null) {
                    this.clearTimeoutFn(read.timeoutTimer);
                    read.timeoutTimer = null;
                }
                if (session.inFlightReads.get(resourceName) === read) {
                    session.inFlightReads.delete(resourceName);
                }
                if (resourceName === 'exchangeInfo'
                    && this.owns(session)
                    && session.resources.exchangeInfo.status !== FUTURES_READONLY_STATUSES.READY) {
                    this.scheduleMetadataRetry(session);
                }
            }
        })();
        return true;
    }

    markStaleResources(session) {
        let changed = false;
        const now = this.now();
        for (const resourceName of DYNAMIC_RESOURCE_NAMES) {
            const record = session.resources[resourceName];
            if (
                !hasData(record) ||
                record.lastUpdatedAt === null ||
                now - record.lastUpdatedAt <= FUTURES_READONLY_TIMING.staleAfterMs ||
                record.status === FUTURES_READONLY_STATUSES.DISCONNECTED ||
                record.status === FUTURES_READONLY_STATUSES.STALE
            ) {
                continue;
            }
            session.resources[resourceName] = {
                ...record,
                status: FUTURES_READONLY_STATUSES.STALE,
            };
            changed = true;
        }
        if (changed) this.emitSnapshot(session);
    }

    async connectStream(session) {
        if (!this.owns(session)) return;
        if (session.reconnectTimer !== null) {
            this.clearTimeoutFn(session.reconnectTimer);
            session.reconnectTimer = null;
        }

        const attemptId = ++session.streamAttemptId;
        this.armStreamWatchdog(
            session,
            attemptId,
            'connect',
            FUTURES_READONLY_TIMING.streamConnectTimeoutMs,
        );
        let attemptFailed = false;
        try {
            const connection = await this.transport.subscribeMarkPrice({
                symbol: session.symbol,
                onOpen: () => {
                    if (!this.ownsStream(session, attemptId)) return;
                    this.handleStreamOpen(session, attemptId);
                },
                onMessage: event => {
                    if (!this.ownsStream(session, attemptId)) return;
                    this.handleStreamMessage(session, attemptId, event);
                },
                onError: error => {
                    if (!this.ownsStream(session, attemptId)) return;
                    attemptFailed = true;
                    this.handleStreamFailure(session, attemptId, error);
                },
                onClose: () => {
                    if (!this.ownsStream(session, attemptId)) return;
                    attemptFailed = true;
                    this.handleStreamClose(session, attemptId);
                },
            });

            if (!this.ownsStream(session, attemptId) || attemptFailed) {
                await safeClose(connection);
                return;
            }
            const previous = session.stream;
            session.stream = connection;
            if (previous && previous !== connection) await safeClose(previous);
        } catch (error) {
            if (!this.ownsStream(session, attemptId) || isAbortError(error, session.controller.signal)) {
                return;
            }
            this.handleStreamFailure(session, attemptId, error);
        }
    }

    clearStreamWatchdog(session) {
        if (session.streamWatchdogTimer === null) return;
        this.clearTimeoutFn(session.streamWatchdogTimer);
        session.streamWatchdogTimer = null;
    }

    armStreamWatchdog(session, attemptId, phase, delay) {
        if (!this.ownsStream(session, attemptId)) return;
        this.clearStreamWatchdog(session);
        session.streamWatchdogTimer = this.setTimeoutFn(() => {
            session.streamWatchdogTimer = null;
            if (!this.ownsStream(session, attemptId)) return;
            this.handleStreamFailure(
                session,
                attemptId,
                createStreamTimeoutError(phase),
            );
        }, delay);
    }

    handleStreamOpen(session, attemptId) {
        if (!this.ownsStream(session, attemptId)) return;
        session.connected = true;
        session.streamState = 'connected';
        this.armStreamWatchdog(
            session,
            attemptId,
            'silence',
            FUTURES_READONLY_TIMING.streamSilenceTimeoutMs,
        );
        // An open handshake is not a fresh market observation. Retain any stale,
        // disconnected, or error marker until a valid owned event arrives.
        this.emitSnapshot(session);
    }

    handleStreamMessage(session, attemptId, event) {
        if (!this.ownsStream(session, attemptId)) return;
        const current = session.resources.market;
        try {
            const market = normalizeStreamMarket(event, session.symbol, current.data);
            const currentObservationTime = current.data?.markPrice?.time;
            if (
                Number.isSafeInteger(currentObservationTime) &&
                market.markPrice.time < currentObservationTime
            ) {
                return;
            }
            session.latestStreamEvent = cloneValue(event);
            session.internalErrors.delete('marketStream');
            session.connected = true;
            session.streamState = 'connected';
            session.reconnectAttempt = 0;
            this.armStreamWatchdog(
                session,
                attemptId,
                'silence',
                FUTURES_READONLY_TIMING.streamSilenceTimeoutMs,
            );
            session.resources.market = {
                status: FUTURES_READONLY_STATUSES.READY,
                data: market,
                lastUpdatedAt: this.now(),
                errorCode: null,
            };
            this.emitSnapshot(session);
        } catch (error) {
            this.reportInternalError(session, 'marketStream', error);
            session.resources.market = {
                ...current,
                status: FUTURES_READONLY_STATUSES.ERROR,
                errorCode: FUTURES_READONLY_SAFE_ERROR_CODES.STREAM_PAYLOAD_INVALID,
            };
            this.emitSnapshot(session);
        }
    }

    handleStreamFailure(session, attemptId, error) {
        if (!this.ownsStream(session, attemptId)) return;
        this.clearStreamWatchdog(session);
        this.reportInternalError(session, 'marketStream', error);
        session.streamAttemptId += 1;
        session.connected = false;
        session.streamState = 'disconnected';
        const connection = session.stream;
        session.stream = null;
        void safeClose(connection);
        session.resources.market = {
            ...session.resources.market,
            status: FUTURES_READONLY_STATUSES.ERROR,
            errorCode: classifySafeError(error),
        };
        this.emitSnapshot(session);
        this.scheduleReconnect(session);
    }

    handleStreamClose(session, attemptId) {
        if (!this.ownsStream(session, attemptId)) return;
        this.clearStreamWatchdog(session);
        session.streamAttemptId += 1;
        session.connected = false;
        session.streamState = 'disconnected';
        const connection = session.stream;
        session.stream = null;
        void safeClose(connection);
        session.resources.market = {
            ...session.resources.market,
            status: FUTURES_READONLY_STATUSES.DISCONNECTED,
            errorCode: FUTURES_READONLY_SAFE_ERROR_CODES.STREAM_DISCONNECTED,
        };
        this.emitSnapshot(session);
        this.scheduleReconnect(session);
    }

    scheduleReconnect(session) {
        if (!this.owns(session) || session.reconnectTimer !== null) return;
        const delays = FUTURES_READONLY_TIMING.reconnectDelaysMs;
        const delay = delays[Math.min(session.reconnectAttempt, delays.length - 1)];
        session.reconnectAttempt += 1;
        session.reconnectTimer = this.setTimeoutFn(() => {
            session.reconnectTimer = null;
            if (!this.owns(session)) return;
            session.streamState = 'connecting';
            void this.connectStream(session);
        }, delay);
    }

    getOverallStatus(session) {
        const records = Object.values(session.resources);
        const statuses = records.map(record => record.status);
        if (statuses.every(status => status === FUTURES_READONLY_STATUSES.LOADING)) {
            return FUTURES_READONLY_STATUSES.LOADING;
        }
        if (statuses.includes(FUTURES_READONLY_STATUSES.LOADING)) {
            return FUTURES_READONLY_STATUSES.LOADING;
        }
        if (session.streamState === 'disconnected') {
            return FUTURES_READONLY_STATUSES.DISCONNECTED;
        }
        if (statuses.includes(FUTURES_READONLY_STATUSES.STALE)) {
            return FUTURES_READONLY_STATUSES.STALE;
        }
        if (session.streamState === 'connecting') {
            return FUTURES_READONLY_STATUSES.LOADING;
        }

        const successful = statuses.filter(status => (
            status === FUTURES_READONLY_STATUSES.READY ||
            status === FUTURES_READONLY_STATUSES.EMPTY
        )).length;
        if (successful === records.length) return FUTURES_READONLY_STATUSES.READY;
        if (successful > 0) return FUTURES_READONLY_STATUSES.PARTIAL;
        if (statuses.every(status => status === FUTURES_READONLY_STATUSES.UNAVAILABLE)) {
            return FUTURES_READONLY_STATUSES.UNAVAILABLE;
        }
        return FUTURES_READONLY_STATUSES.ERROR;
    }

    emitSnapshot(session) {
        if (!this.owns(session)) return;
        const payload = {
            status: this.getOverallStatus(session),
            environment: this.environment,
            symbol: session.symbol,
            connected: session.connected,
            resources: cloneValue(session.resources),
        };
        try {
            const response = createFuturesReadOnlyResponse({
                requestId: session.requestId,
                type: FUTURES_READ_RESPONSE_TYPES.SNAPSHOT,
                symbol: session.symbol,
                environment: this.environment,
                payload,
            });
            session.onResponse(response);
        } catch (error) {
            this.reportInternalError(session, 'delivery', error);
        }
    }
}

export const createFuturesReadOnlyService = options => new FuturesReadOnlyService(options);
