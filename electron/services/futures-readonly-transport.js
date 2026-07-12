import { createHmac } from 'node:crypto';
import WebSocket from 'ws';
import {
    FUTURES_READ_ONLY_MOCK_RESOURCES,
    FUTURES_READ_ONLY_MOCK_SCENARIOS,
    getFuturesReadOnlyMockFixture,
    isFuturesReadOnlyMockScenario,
} from './futures-readonly-fixtures.js';

export const FUTURES_TESTNET_REST_BASE_URL = 'https://demo-fapi.binance.com';
export const FUTURES_TESTNET_WEBSOCKET_BASE_URL = 'wss://demo-fstream.binance.com';
export const FUTURES_SIGNED_RECV_WINDOW = 5000;

export const FUTURES_READ_ONLY_TRANSPORT_MODES = Object.freeze({
    MOCK: 'mock',
    TESTNET: 'testnet',
});

export const FUTURES_READ_ONLY_REQUEST_WEIGHTS = Object.freeze({
    getExchangeInfo: 1,
    getMarkPrice: 1,
    getPositionRiskV3: 5,
    getBalanceV3: 5,
    getOpenOrders: 1,
    getOpenAlgoOrders: 1,
});

export const FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES = Object.freeze({
    INVALID_CONFIG: 'FUTURES_READ_ONLY_INVALID_CONFIG',
    INVALID_ARGUMENTS: 'FUTURES_READ_ONLY_INVALID_ARGUMENTS',
    INVALID_SYMBOL: 'FUTURES_READ_ONLY_INVALID_SYMBOL',
    INVALID_TIMESTAMP: 'FUTURES_READ_ONLY_INVALID_TIMESTAMP',
    UPSTREAM_RESPONSE: 'FUTURES_READ_ONLY_UPSTREAM_RESPONSE',
    INVALID_STREAM_EVENT: 'FUTURES_READ_ONLY_INVALID_STREAM_EVENT',
});

export class FuturesReadOnlyTransportConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FuturesReadOnlyTransportConfigError';
        this.code = FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_CONFIG;
    }
}

export class FuturesReadOnlyTransportArgumentError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesReadOnlyTransportArgumentError';
        this.code = code;
    }
}

export class FuturesReadOnlyUpstreamError extends Error {
    constructor({ operation, status = null, body = null, message } = {}) {
        const upstreamCode = isRecord(body) && Object.hasOwn(body, 'code')
            ? body.code
            : null;
        super(message || 'Futures read-only upstream request failed');
        this.name = 'FuturesReadOnlyUpstreamError';
        this.code = upstreamCode ?? FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.UPSTREAM_RESPONSE;
        this.upstreamCode = upstreamCode;
        this.status = status;
        this.body = body;
        this.operation = operation;
    }
}

export class FuturesReadOnlyStreamError extends Error {
    constructor(message, event = null) {
        super(message);
        this.name = 'FuturesReadOnlyStreamError';
        this.code = FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_STREAM_EVENT;
        this.event = event;
    }
}

const CONFIG_FIELDS = Object.freeze(['mode', 'apiKey', 'apiSecret', 'mockScenario']);
const DEPENDENCY_FIELDS = Object.freeze([
    'fetchImpl',
    'WebSocketImpl',
    'now',
    'queueMicrotaskImpl',
    'setTimeoutFn',
    'clearTimeoutFn',
]);
const STREAM_OPTION_FIELDS = Object.freeze([
    'symbol',
    'onMessage',
    'onError',
    'onClose',
    'onOpen',
]);

const isRecord = (value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
        || Object.getPrototypeOf(value) === null)
);

const isNonEmptyString = (value) => (
    typeof value === 'string'
    && value.length > 0
    && value.trim() === value
);

const isFuturesSymbol = (value) => (
    isNonEmptyString(value)
    && /^[A-Z0-9_]{1,64}$/.test(value)
);

const hasOnlyFields = (value, allowedFields) => (
    Reflect.ownKeys(value).every((key) => (
        typeof key === 'string'
        && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
        && allowedFields.includes(key)
    ))
);

const requireConfigRecord = (config) => {
    if (!isRecord(config) || !hasOnlyFields(config, CONFIG_FIELDS)) {
        throw new FuturesReadOnlyTransportConfigError(
            'Futures read-only transport config contains unsupported fields',
        );
    }
};

export const resolveFuturesReadOnlyTransportConfig = (config) => {
    requireConfigRecord(config);

    if (!Object.values(FUTURES_READ_ONLY_TRANSPORT_MODES).includes(config.mode)) {
        throw new FuturesReadOnlyTransportConfigError(
            'Futures read-only transport mode must be explicitly "mock" or "testnet"',
        );
    }

    if (config.mode === FUTURES_READ_ONLY_TRANSPORT_MODES.MOCK) {
        if (config.apiKey !== undefined || config.apiSecret !== undefined) {
            throw new FuturesReadOnlyTransportConfigError(
                'Mock futures read-only transport must not receive credentials',
            );
        }

        const mockScenario = config.mockScenario
            ?? FUTURES_READ_ONLY_MOCK_SCENARIOS.ONE_WAY;
        if (!isFuturesReadOnlyMockScenario(mockScenario)) {
            throw new FuturesReadOnlyTransportConfigError(
                'Unsupported futures read-only mock scenario',
            );
        }

        return Object.freeze({
            mode: FUTURES_READ_ONLY_TRANSPORT_MODES.MOCK,
            environment: FUTURES_READ_ONLY_TRANSPORT_MODES.MOCK,
            mockScenario,
        });
    }

    if (config.mockScenario !== undefined) {
        throw new FuturesReadOnlyTransportConfigError(
            'Testnet futures read-only transport must not receive a mock scenario',
        );
    }
    if (!isNonEmptyString(config.apiKey) || !isNonEmptyString(config.apiSecret)) {
        throw new FuturesReadOnlyTransportConfigError(
            'Testnet futures read-only transport requires explicit API credentials',
        );
    }

    return Object.freeze({
        mode: FUTURES_READ_ONLY_TRANSPORT_MODES.TESTNET,
        environment: FUTURES_READ_ONLY_TRANSPORT_MODES.TESTNET,
        restBaseUrl: FUTURES_TESTNET_REST_BASE_URL,
        websocketBaseUrl: FUTURES_TESTNET_WEBSOCKET_BASE_URL,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
    });
};

const requireDependencies = (dependencies) => {
    if (!isRecord(dependencies) || !hasOnlyFields(dependencies, DEPENDENCY_FIELDS)) {
        throw new FuturesReadOnlyTransportConfigError(
            'Futures read-only transport dependencies contain unsupported fields',
        );
    }
};

const isAbortSignal = signal => (
    signal !== null
    && typeof signal === 'object'
    && typeof signal.aborted === 'boolean'
    && typeof signal.addEventListener === 'function'
    && typeof signal.removeEventListener === 'function'
);

const requireSignal = (signal) => {
    if (!isAbortSignal(signal)) {
        throw new FuturesReadOnlyTransportArgumentError(
            FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_ARGUMENTS,
            'Futures read-only signal must be an AbortSignal',
        );
    }
    return signal;
};

const requireSignalOnlyOptions = (methodName, args) => {
    if (args.length === 0) return undefined;
    if (args.length !== 1
        || !isRecord(args[0])
        || Reflect.ownKeys(args[0]).length !== 1
        || !Object.hasOwn(args[0], 'signal')
        || Object.getOwnPropertyDescriptor(args[0], 'signal')?.enumerable !== true) {
        throw new FuturesReadOnlyTransportArgumentError(
            FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_ARGUMENTS,
            `${methodName} accepts only an internal abort signal`,
        );
    }
    return requireSignal(args[0].signal);
};

const requireSymbol = (symbol) => {
    if (!isFuturesSymbol(symbol)) {
        throw new FuturesReadOnlyTransportArgumentError(
            FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_SYMBOL,
            'Futures read-only symbol must be an exact uppercase futures symbol',
        );
    }
    return symbol;
};

const requireSymbolOptions = (methodName, args) => {
    if (args.length !== 1
        || !isRecord(args[0])
        || !Object.hasOwn(args[0], 'symbol')
        || Reflect.ownKeys(args[0]).some(key => key !== 'symbol' && key !== 'signal')
        || Reflect.ownKeys(args[0]).length > 2
        || Reflect.ownKeys(args[0]).some(
            key => Object.getOwnPropertyDescriptor(args[0], key)?.enumerable !== true,
        )) {
        throw new FuturesReadOnlyTransportArgumentError(
            FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_ARGUMENTS,
            `${methodName} accepts only an exact symbol option`,
        );
    }
    return {
        symbol: requireSymbol(args[0].symbol),
        signal: Object.hasOwn(args[0], 'signal')
            ? requireSignal(args[0].signal)
            : undefined,
    };
};

const throwIfAborted = (signal) => {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    const error = new Error('Futures read-only transport request aborted');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    throw error;
};

const createMockUpstreamError = (operation, failure) => (
    new FuturesReadOnlyUpstreamError({
        operation,
        status: failure.status,
        body: failure.body,
        message: failure.message,
    })
);

const readMockFixture = (scenario, resource, operation) => {
    const fixture = getFuturesReadOnlyMockFixture({ scenario, resource });
    if (isRecord(fixture) && isRecord(fixture.failure)) {
        throw createMockUpstreamError(operation, fixture.failure);
    }
    return fixture;
};

const appendParameters = (url, parameters) => {
    Object.entries(parameters).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
    });
};

const isBinanceErrorBody = (body) => (
    isRecord(body)
    && typeof body.code === 'number'
    && body.code < 0
    && typeof body.msg === 'string'
);

const readFetchResponse = async (response, operation) => {
    const body = await response.json();
    if (response.ok !== true || isBinanceErrorBody(body)) {
        throw new FuturesReadOnlyUpstreamError({
            operation,
            status: Number.isSafeInteger(response.status) ? response.status : null,
            body,
        });
    }
    return body;
};

const requireTimestamp = (timestamp) => {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new FuturesReadOnlyTransportArgumentError(
            FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_TIMESTAMP,
            'Futures read-only signing timestamp must be a non-negative safe integer',
        );
    }
    return timestamp;
};

const cloneStreamValue = (value) => {
    if (Array.isArray(value)) return value.map(cloneStreamValue);
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, cloneStreamValue(entry)]),
        );
    }
    return value;
};

const decodeStreamData = (message) => {
    const data = message !== null
        && typeof message === 'object'
        && 'data' in message
        ? message.data
        : message;
    if (typeof data === 'string') return JSON.parse(data);
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
        return JSON.parse(data.toString('utf8'));
    }
    if (data instanceof ArrayBuffer) {
        return JSON.parse(new TextDecoder().decode(data));
    }
    if (ArrayBuffer.isView(data)) {
        return JSON.parse(new TextDecoder().decode(data));
    }
    if (isRecord(data)) return cloneStreamValue(data);
    throw new FuturesReadOnlyStreamError('Unsupported futures mark-price stream message');
};

const requireMarkPriceStreamEvent = (event, symbol) => {
    if (!isRecord(event)
        || event.e !== 'markPriceUpdate'
        || event.s !== symbol
        || !Number.isSafeInteger(event.E)
        || event.E < 0
        || !Number.isSafeInteger(event.T)
        || event.T < 0
        || !isNonEmptyString(event.p)
        || !isNonEmptyString(event.i)
        || !isNonEmptyString(event.P)
        || !isNonEmptyString(event.r)) {
        throw new FuturesReadOnlyStreamError(
            'Malformed futures mark-price stream event',
            event,
        );
    }
    return event;
};

const addSocketListener = (socket, eventName, handler) => {
    if (typeof socket.on === 'function') {
        socket.on(eventName, handler);
        return () => socket.off?.(eventName, handler);
    }
    if (typeof socket.addEventListener === 'function') {
        socket.addEventListener(eventName, handler);
        return () => socket.removeEventListener?.(eventName, handler);
    }

    const propertyName = `on${eventName}`;
    socket[propertyName] = handler;
    return () => {
        if (socket[propertyName] === handler) socket[propertyName] = null;
    };
};

const requireStreamOptions = (options) => {
    if (!isRecord(options) || !hasOnlyFields(options, STREAM_OPTION_FIELDS)) {
        throw new FuturesReadOnlyTransportArgumentError(
            FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_ARGUMENTS,
            'subscribeMarkPrice received unsupported options',
        );
    }

    const symbol = requireSymbol(options.symbol);
    if (typeof options.onMessage !== 'function') {
        throw new FuturesReadOnlyTransportArgumentError(
            FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_ARGUMENTS,
            'subscribeMarkPrice requires an onMessage callback',
        );
    }
    ['onError', 'onClose', 'onOpen'].forEach((callbackName) => {
        if (options[callbackName] !== undefined
            && typeof options[callbackName] !== 'function') {
            throw new FuturesReadOnlyTransportArgumentError(
                FUTURES_READ_ONLY_TRANSPORT_ERROR_CODES.INVALID_ARGUMENTS,
                `${callbackName} must be a function when supplied`,
            );
        }
    });

    return { ...options, symbol };
};

const createMockMarkPriceSubscription = ({
    scenario,
    options,
    queueMicrotaskImpl,
    now,
    setTimeoutFn,
    clearTimeoutFn,
}) => {
    let active = true;
    let deliveryTimer = null;
    const fundingIntervalMs = 8 * 60 * 60 * 1000;
    const clearDeliveryTimer = () => {
        if (deliveryTimer === null) return;
        clearTimeoutFn(deliveryTimer);
        deliveryTimer = null;
    };
    const stop = () => {
        if (!active) return false;
        active = false;
        clearDeliveryTimer();
        return true;
    };
    const connection = Object.freeze({
        close() {
            stop();
        },
    });

    const deliver = () => {
        if (!active) return;
        let event;
        try {
            event = readMockFixture(
                scenario,
                FUTURES_READ_ONLY_MOCK_RESOURCES.MARK_PRICE_STREAM,
                'subscribeMarkPrice',
            );
            const eventTime = requireTimestamp(now());
            event = {
                ...event,
                E: eventTime,
                T: (Math.floor(eventTime / fundingIntervalMs) + 1) * fundingIntervalMs,
            };
            event = requireMarkPriceStreamEvent(event, options.symbol);
        } catch (error) {
            if (!active) return;
            options.onError?.(error);
            if (!active) return;
            stop();
            options.onClose?.(1011, 'Deterministic mock stream failure');
            return;
        }

        if (!active) return;
        options.onMessage(event);
        if (!active) return;
        deliveryTimer = setTimeoutFn(() => {
            deliveryTimer = null;
            deliver();
        }, 1_000);
    };

    queueMicrotaskImpl(() => {
        if (!active) return;
        options.onOpen?.({ environment: FUTURES_READ_ONLY_TRANSPORT_MODES.MOCK });
        deliver();
    });

    return connection;
};

const createTestnetMarkPriceSubscription = ({
    websocketBaseUrl,
    WebSocketImpl,
    options,
}) => {
    const streamName = `${options.symbol.toLowerCase()}@markPrice@1s`;
    const url = `${websocketBaseUrl}/ws/${streamName}`;
    const socket = new WebSocketImpl(url);
    let active = true;
    const removeListeners = [];
    const cleanupListeners = () => {
        removeListeners.forEach((removeListener) => removeListener());
    };

    const forwardError = (error) => {
        if (active) options.onError?.(error);
    };

    removeListeners.push(addSocketListener(socket, 'open', (event) => {
        if (active) options.onOpen?.(event);
    }));
    removeListeners.push(addSocketListener(socket, 'message', (message) => {
        if (!active) return;
        let event;
        try {
            event = requireMarkPriceStreamEvent(
                decodeStreamData(message),
                options.symbol,
            );
        } catch (error) {
            forwardError(error);
            return;
        }
        if (active) options.onMessage(event);
    }));
    removeListeners.push(addSocketListener(socket, 'error', forwardError));
    removeListeners.push(addSocketListener(socket, 'close', (...args) => {
        const shouldNotify = active;
        active = false;
        try {
            if (shouldNotify) options.onClose?.(...args);
        } finally {
            cleanupListeners();
        }
    }));

    return Object.freeze({
        close() {
            if (!active) return;
            active = false;
            try {
                // Keep the inert error/close listeners until the close event. The
                // ws implementation can emit an error while aborting CONNECTING.
                socket.close();
            } catch (error) {
                cleanupListeners();
                throw error;
            }
        },
    });
};

export const createFuturesReadOnlyTransport = (config, dependencies = {}) => {
    const resolvedConfig = resolveFuturesReadOnlyTransportConfig(config);
    requireDependencies(dependencies);

    const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
    const WebSocketImpl = dependencies.WebSocketImpl ?? WebSocket;
    const now = dependencies.now ?? Date.now;
    const queueMicrotaskImpl = dependencies.queueMicrotaskImpl ?? globalThis.queueMicrotask;
    const setTimeoutFn = dependencies.setTimeoutFn ?? setTimeout;
    const clearTimeoutFn = dependencies.clearTimeoutFn ?? clearTimeout;

    if (resolvedConfig.mode === FUTURES_READ_ONLY_TRANSPORT_MODES.TESTNET
        && (typeof fetchImpl !== 'function' || typeof WebSocketImpl !== 'function')) {
        throw new FuturesReadOnlyTransportConfigError(
            'Testnet futures read-only transport requires fetch and WebSocket implementations',
        );
    }
    if (typeof now !== 'function'
        || typeof queueMicrotaskImpl !== 'function'
        || typeof setTimeoutFn !== 'function'
        || typeof clearTimeoutFn !== 'function') {
        throw new FuturesReadOnlyTransportConfigError(
            'Futures read-only transport lifecycle dependencies must be functions',
        );
    }

    const publicGet = async (operation, path, parameters = {}, signal) => {
        throwIfAborted(signal);
        const url = new URL(path, resolvedConfig.restBaseUrl);
        appendParameters(url, parameters);
        const response = await fetchImpl(url.toString(), {
            method: 'GET',
            ...(signal === undefined ? {} : { signal }),
        });
        return readFetchResponse(response, operation);
    };

    const signedGet = async (operation, path, parameters = {}, signal) => {
        throwIfAborted(signal);
        const url = new URL(path, resolvedConfig.restBaseUrl);
        appendParameters(url, parameters);
        url.searchParams.append('recvWindow', String(FUTURES_SIGNED_RECV_WINDOW));
        url.searchParams.append('timestamp', String(requireTimestamp(now())));
        const signature = createHmac('sha256', resolvedConfig.apiSecret)
            .update(url.searchParams.toString())
            .digest('hex');
        url.searchParams.append('signature', signature);
        const response = await fetchImpl(url.toString(), {
            method: 'GET',
            headers: {
                'X-MBX-APIKEY': resolvedConfig.apiKey,
            },
            ...(signal === undefined ? {} : { signal }),
        });
        return readFetchResponse(response, operation);
    };

    const read = (operation, resource, signal, liveRead) => {
        return Promise.resolve().then(() => {
            throwIfAborted(signal);
            if (resolvedConfig.mode === FUTURES_READ_ONLY_TRANSPORT_MODES.MOCK) {
                return readMockFixture(
                    resolvedConfig.mockScenario,
                    resource,
                    operation,
                );
            }
            return liveRead();
        });
    };

    return Object.freeze({
        getExchangeInfo(...args) {
            const signal = requireSignalOnlyOptions('getExchangeInfo', args);
            return read(
                'getExchangeInfo',
                FUTURES_READ_ONLY_MOCK_RESOURCES.EXCHANGE_INFO,
                signal,
                () => publicGet('getExchangeInfo', '/fapi/v1/exchangeInfo', {}, signal),
            );
        },
        getMarkPrice(...args) {
            const { symbol, signal } = requireSymbolOptions('getMarkPrice', args);
            return read(
                'getMarkPrice',
                FUTURES_READ_ONLY_MOCK_RESOURCES.MARK_PRICE,
                signal,
                () => publicGet('getMarkPrice', '/fapi/v1/premiumIndex', { symbol }, signal),
            );
        },
        getPositionRiskV3(...args) {
            const { symbol, signal } = requireSymbolOptions('getPositionRiskV3', args);
            return read(
                'getPositionRiskV3',
                FUTURES_READ_ONLY_MOCK_RESOURCES.POSITION_RISK_V3,
                signal,
                () => signedGet(
                    'getPositionRiskV3',
                    '/fapi/v3/positionRisk',
                    { symbol },
                    signal,
                ),
            );
        },
        getBalanceV3(...args) {
            const signal = requireSignalOnlyOptions('getBalanceV3', args);
            return read(
                'getBalanceV3',
                FUTURES_READ_ONLY_MOCK_RESOURCES.BALANCE_V3,
                signal,
                () => signedGet('getBalanceV3', '/fapi/v3/balance', {}, signal),
            );
        },
        getOpenOrders(...args) {
            const { symbol, signal } = requireSymbolOptions('getOpenOrders', args);
            return read(
                'getOpenOrders',
                FUTURES_READ_ONLY_MOCK_RESOURCES.OPEN_ORDERS,
                signal,
                () => signedGet('getOpenOrders', '/fapi/v1/openOrders', { symbol }, signal),
            );
        },
        getOpenAlgoOrders(...args) {
            const { symbol, signal } = requireSymbolOptions('getOpenAlgoOrders', args);
            return read(
                'getOpenAlgoOrders',
                FUTURES_READ_ONLY_MOCK_RESOURCES.OPEN_ALGO_ORDERS,
                signal,
                () => signedGet(
                    'getOpenAlgoOrders',
                    '/fapi/v1/openAlgoOrders',
                    { symbol },
                    signal,
                ),
            );
        },
        subscribeMarkPrice(options) {
            const validatedOptions = requireStreamOptions(options);
            if (resolvedConfig.mode === FUTURES_READ_ONLY_TRANSPORT_MODES.MOCK) {
                return createMockMarkPriceSubscription({
                    scenario: resolvedConfig.mockScenario,
                    options: validatedOptions,
                    queueMicrotaskImpl,
                    now,
                    setTimeoutFn,
                    clearTimeoutFn,
                });
            }
            return createTestnetMarkPriceSubscription({
                websocketBaseUrl: resolvedConfig.websocketBaseUrl,
                WebSocketImpl,
                options: validatedOptions,
            });
        },
    });
};
