import { createHash, createHmac } from 'node:crypto';
import { FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN } from './futures-production-execution-config.js';
import {
    parseNonNegativeExactDecimal,
    parsePositiveExactDecimal,
} from './futures-production-execution-decimal.js';
import {
    FUTURES_PRODUCTION_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS,
    FUTURES_PRODUCTION_EXECUTION_RESPONSE_LIMITS,
    FuturesProductionExecutionIntegerToken,
    parseFuturesProductionExecutionJson,
    readFuturesProductionExecutionIntegerToken,
    readFuturesProductionExecutionResponseBody,
    validateFuturesProductionExecutionResponseHeaders,
} from './futures-production-execution-json.js';

const SIGNED_RECV_WINDOW = '5000';
const OPERATION_DEADLINE_MS = 10_000;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const MAX_SAFE_INTEGER = 9_007_199_254_740_991n;
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/;
const CLIENT_ID_PATTERN = /^cc7-[0-9a-f]{32}$/;
const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]{1,128}$/;
const LOSSLESS_ID_FIELDS = new Set(['orderId', 'algoId']);
const RATE_LIMITED_HTTP_STATUSES = new Set([418, 429]);
const RATE_LIMITED_BINANCE_CODES = new Set([-1003, -1015]);
const AUTH_REJECTED_HTTP_STATUSES = new Set([200, 400, 401, 403]);
const AUTH_REJECTED_BINANCE_CODES = new Set([-1002, -1021, -1022, -2015]);
const EXCHANGE_REJECTED_HTTP_STATUSES = new Set([200, 400]);
const EXCHANGE_REJECTED_BINANCE_CODES = new Set([
    -1100, -1101, -1102, -1103, -1104, -1105, -1106, -1108,
    -1111, -1112, -1114, -1115, -1116, -1117, -1118, -1119,
    -1120, -1121, -1125, -1127, -1128, -1130, -1136,
    -2010, -2018, -2019, -2020, -2021, -2022, -2023, -2024,
    -2025, -2026, -2027, -2028,
    -4002, -4004, -4005, -4013, -4014, -4015, -4016, -4023,
    -4024, -4028, -4031, -4046, -4047, -4048, -4060, -4061,
    -4062, -4118, -4120, -4140, -4141, -4164,
]);

export const FUTURES_PRODUCTION_EXECUTION_FACADE_LIMITS = Object.freeze({
    OPERATION_DEADLINE_MS,
    SIGNED_RECV_WINDOW,
    MAX_ALLOWED_SYMBOLS: 16,
});

export const FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS = Object.freeze({
    ARGUMENT: 'argument',
    AUTH_REJECTED: 'auth_rejected',
    EXCHANGE_REJECTED: 'exchange_rejected',
    RATE_LIMITED: 'rate_limited',
    NOT_FOUND: 'not_found',
    AMBIGUOUS: 'ambiguous',
});

export class FuturesProductionExecutionFacadeError extends Error {
    constructor({
        kind,
        operation = null,
        endpointId = null,
        status = null,
        binanceCode = null,
        rateLimitHeaders = null,
        bodyDigest = null,
    }) {
        super('Futures production execution request failed');
        this.name = 'FuturesProductionExecutionFacadeError';
        this.code = 'FUTURES_PRODUCTION_EXECUTION_REQUEST_FAILED';
        this.kind = kind;
        this.operation = operation;
        this.endpointId = endpointId;
        this.status = status;
        this.binanceCode = binanceCode;
        this.rateLimitHeaders = rateLimitHeaders;
        this.bodyDigest = bodyDigest;
    }
}

const argumentError = (operation = null) => new FuturesProductionExecutionFacadeError({
    kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.ARGUMENT,
    operation,
});

const readExactDataProperties = (value, expectedFields, operation = null) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw argumentError(operation);
    }
    let prototype;
    let keys;
    try {
        prototype = Object.getPrototypeOf(value);
        keys = Reflect.ownKeys(value);
    } catch {
        throw argumentError(operation);
    }
    const expected = new Set(expectedFields);
    if (prototype !== Object.prototype
        || keys.length !== expected.size
        || keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
        throw argumentError(operation);
    }
    const result = Object.create(null);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) {
            throw argumentError(operation);
        }
        result[key] = descriptor.value;
    }
    return result;
};

const readDependencies = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        throw argumentError();
    }
    const allowed = new Set(['fetchImpl', 'now', 'setTimeoutFn', 'clearTimeoutFn']);
    const keys = Reflect.ownKeys(value);
    if (!keys.includes('fetchImpl')
        || keys.some((key) => typeof key !== 'string' || !allowed.has(key))) {
        throw argumentError();
    }
    const result = Object.create(null);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) throw argumentError();
        result[key] = descriptor.value;
    }
    return result;
};

const readDenseUniqueSymbols = (value) => {
    if (!Array.isArray(value)
        || Object.getPrototypeOf(value) !== Array.prototype
        || value.length < 1
        || value.length > FUTURES_PRODUCTION_EXECUTION_FACADE_LIMITS.MAX_ALLOWED_SYMBOLS) {
        throw argumentError();
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) throw argumentError();
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')
            || typeof descriptor.value !== 'string'
            || !SYMBOL_PATTERN.test(descriptor.value)) throw argumentError();
        result.push(descriptor.value);
    }
    if (new Set(result).size !== result.length) throw argumentError();
    return result;
};

const requireCredential = (value) => {
    if (typeof value !== 'string'
        || !VISIBLE_ASCII_PATTERN.test(value)
        || Buffer.byteLength(value, 'ascii') > 128) throw argumentError();
    return value;
};

const requireSafeTimestamp = (value) => {
    if (!Number.isSafeInteger(value) || value < 0) throw argumentError();
    return String(value);
};

const requireSymbol = (value, allowedSymbols, operation) => {
    if (typeof value !== 'string'
        || !SYMBOL_PATTERN.test(value)
        || !allowedSymbols.has(value)) throw argumentError(operation);
    return value;
};

const sign = (serialized, apiSecret) => (
    createHmac('sha256', apiSecret).update(serialized).digest('hex')
);

const appendSignedParameters = (entries, timestamp, apiSecret) => {
    const form = new URLSearchParams(entries);
    form.append('recvWindow', SIGNED_RECV_WINDOW);
    form.append('timestamp', timestamp);
    const unsigned = form.toString();
    form.append('signature', sign(unsigned, apiSecret));
    return form;
};

const assertFixedUrl = (url, pathname) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:'
        || parsed.origin !== FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN
        || parsed.pathname !== pathname
        || parsed.username
        || parsed.password
        || parsed.hash) throw argumentError();
};

const deepFreeze = (value) => {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Reflect.ownKeys(value).forEach(key => deepFreeze(value[key]));
        Object.freeze(value);
    }
    return value;
};

const convertWireValue = (value, field = '') => {
    if (value instanceof FuturesProductionExecutionIntegerToken) {
        const { parsed, token } = readFuturesProductionExecutionIntegerToken(value);
        if (LOSSLESS_ID_FIELDS.has(field)) {
            if (parsed <= 0n || parsed > MAX_SIGNED_INT64) {
                throw new Error('invalid lossless identity');
            }
            return token;
        }
        if (parsed < -MAX_SAFE_INTEGER || parsed > MAX_SAFE_INTEGER) {
            throw new Error('unsafe integer');
        }
        return Number(parsed);
    }
    if (Array.isArray(value)) return value.map(entry => convertWireValue(entry));
    if (value !== null && typeof value === 'object') {
        const result = Object.create(null);
        for (const [key, entry] of Object.entries(value)) {
            result[key] = convertWireValue(entry, key);
        }
        return result;
    }
    return value;
};

const readBinanceError = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    try {
        const { parsed } = readFuturesProductionExecutionIntegerToken(body.code, {
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
        });
        if (parsed >= 0n) return null;
        const keys = Reflect.ownKeys(body);
        const reviewed = keys.length === 2
            && keys.includes('code')
            && keys.includes('msg')
            && typeof body.msg === 'string'
            && body.msg.length > 0
            && Buffer.byteLength(body.msg, 'utf8')
                <= FUTURES_PRODUCTION_EXECUTION_RESPONSE_LIMITS.MESSAGE_BYTES;
        return Object.freeze({ code: Number(parsed), reviewed });
    } catch {
        return null;
    }
};

const classifyFailure = ({
    operation,
    endpointId,
    status,
    binanceError,
    rateLimitHeaders,
    bodyDigest,
}) => {
    const binanceCode = binanceError?.code ?? null;
    let kind = FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS;
    if (binanceError?.reviewed !== true) {
        kind = FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS;
    } else if (operation === 'queryOrder'
        && status === 400
        && binanceCode === -2013) {
        kind = FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND;
    } else if (RATE_LIMITED_HTTP_STATUSES.has(status)
        && RATE_LIMITED_BINANCE_CODES.has(binanceCode)) {
        kind = FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.RATE_LIMITED;
    } else if (AUTH_REJECTED_HTTP_STATUSES.has(status)
        && AUTH_REJECTED_BINANCE_CODES.has(binanceCode)) {
        kind = FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED;
    } else if (EXCHANGE_REJECTED_HTTP_STATUSES.has(status)
        && EXCHANGE_REJECTED_BINANCE_CODES.has(binanceCode)) {
        kind = FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED;
    }
    return new FuturesProductionExecutionFacadeError({
        kind,
        operation,
        endpointId,
        status,
        binanceCode,
        rateLimitHeaders,
        bodyDigest,
    });
};

const requireResponseObject = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('invalid response object');
    }
    return body;
};

const normalizeServerTime = (body) => {
    const source = requireResponseObject(body);
    const { parsed } = readFuturesProductionExecutionIntegerToken(source.serverTime, {
        minimum: 0n,
        maximum: MAX_SAFE_INTEGER,
    });
    return Object.freeze({ serverTime: Number(parsed) });
};

const normalizeReadData = (body, { operation, symbol = null }) => {
    const converted = convertWireValue(body);
    if (operation === 'exchangeInfo') {
        if (!converted || typeof converted !== 'object' || !Array.isArray(converted.symbols)) {
            throw new Error('invalid exchange info');
        }
    } else if (operation === 'markPrice') {
        if (!converted || typeof converted !== 'object'
            || Array.isArray(converted)
            || converted.symbol !== symbol
            || typeof converted.markPrice !== 'string') {
            throw new Error('invalid mark price');
        }
        parsePositiveExactDecimal(converted.markPrice);
    } else if (operation === 'accountConfig') {
        if (!converted || typeof converted !== 'object' || Array.isArray(converted)) {
            throw new Error('invalid account config');
        }
    } else if (operation === 'symbolConfig') {
        const rows = Array.isArray(converted) ? converted : [converted];
        if (rows.length !== 1 || rows[0]?.symbol !== symbol) {
            throw new Error('invalid symbol config');
        }
    } else if (operation === 'balance') {
        if (!Array.isArray(converted)) throw new Error('invalid balance');
    } else if (operation === 'positionRisk'
        || operation === 'openOrders'
        || operation === 'openAlgoOrders') {
        if (!Array.isArray(converted)
            || converted.some(row => row?.symbol !== symbol)) {
            throw new Error('invalid symbol inventory');
        }
    }
    return deepFreeze(converted);
};

const normalizeOrderAck = (body, expected) => {
    const source = requireResponseObject(body);
    if (source.symbol !== expected.symbol
        || source.clientOrderId !== expected.clientOrderId) {
        throw new Error('invalid order acknowledgement identity');
    }
    const orderId = readFuturesProductionExecutionIntegerToken(source.orderId, {
        minimum: 1n,
        maximum: MAX_SIGNED_INT64,
    }).token;
    let transactTime = null;
    if (source.transactTime !== undefined) {
        transactTime = Number(readFuturesProductionExecutionIntegerToken(source.transactTime, {
            minimum: 0n,
            maximum: MAX_SAFE_INTEGER,
        }).parsed);
    }
    return Object.freeze({
        symbol: expected.symbol,
        clientOrderId: expected.clientOrderId,
        orderId,
        transactTime,
    });
};

const normalizeQueryOrder = (body, expected) => {
    const source = requireResponseObject(body);
    if (source.symbol !== expected.symbol
        || source.clientOrderId !== expected.originalClientOrderId
        || source.positionSide !== 'BOTH'
        || typeof source.reduceOnly !== 'boolean'
        || (source.closePosition !== undefined && source.closePosition !== false)) {
        throw new Error('invalid query order identity');
    }
    const orderId = readFuturesProductionExecutionIntegerToken(source.orderId, {
        minimum: 1n,
        maximum: MAX_SIGNED_INT64,
    }).token;
    const updateTime = Number(readFuturesProductionExecutionIntegerToken(source.updateTime, {
        minimum: 0n,
        maximum: MAX_SAFE_INTEGER,
    }).parsed);
    const stringFields = [
        'side', 'type', 'origType', 'timeInForce', 'status',
        'origQty', 'executedQty', 'avgPrice', 'price',
    ];
    if (stringFields.some(field => typeof source[field] !== 'string')) {
        throw new Error('invalid query order fields');
    }
    parsePositiveExactDecimal(source.origQty);
    parseNonNegativeExactDecimal(source.executedQty);
    parseNonNegativeExactDecimal(source.avgPrice);
    parseNonNegativeExactDecimal(source.price);
    return Object.freeze({
        symbol: source.symbol,
        clientOrderId: source.clientOrderId,
        orderId,
        side: source.side,
        positionSide: source.positionSide,
        type: source.type,
        originalType: source.origType,
        timeInForce: source.timeInForce,
        status: source.status,
        originalQuantity: source.origQty,
        executedQuantity: source.executedQty,
        averagePrice: source.avgPrice,
        price: source.price,
        reduceOnly: source.reduceOnly,
        closePosition: source.closePosition ?? false,
        updateTime,
    });
};

const normalizeCancelAcknowledgement = (body) => {
    const source = requireResponseObject(body);
    const keys = Reflect.ownKeys(source);
    const code = readFuturesProductionExecutionIntegerToken(source.code, {
        minimum: 200n,
        maximum: 200n,
    }).parsed;
    if (keys.length !== 2
        || !keys.includes('code')
        || !keys.includes('msg')
        || typeof source.msg !== 'string'
        || source.msg.length === 0
        || Buffer.byteLength(source.msg, 'utf8')
            > FUTURES_PRODUCTION_EXECUTION_RESPONSE_LIMITS.MESSAGE_BYTES) {
        throw new Error('invalid cancellation acknowledgement');
    }
    return Object.freeze({
        acknowledged: true,
        code: Number(code),
        messageDigest: createHash('sha256').update(source.msg, 'utf8').digest('hex'),
    });
};

const createReceipt = ({ operation, endpointId, status, bodyDigest, rateLimitHeaders }) => (
    Object.freeze({ operation, endpointId, status, bodyDigest, rateLimitHeaders })
);

export const createFuturesProductionExecutionFacade = (config, dependencies) => {
    const source = readExactDataProperties(config, ['apiKey', 'apiSecret', 'allowedSymbols']);
    const apiKey = requireCredential(source.apiKey);
    const apiSecret = requireCredential(source.apiSecret);
    const allowedSymbols = new Set(readDenseUniqueSymbols(source.allowedSymbols));
    const injected = readDependencies(dependencies);
    const fetchImpl = injected.fetchImpl;
    const now = injected.now ?? Date.now;
    const setTimeoutFn = injected.setTimeoutFn ?? setTimeout;
    const clearTimeoutFn = injected.clearTimeoutFn ?? clearTimeout;
    if (typeof fetchImpl !== 'function'
        || typeof now !== 'function'
        || typeof setTimeoutFn !== 'function'
        || typeof clearTimeoutFn !== 'function') throw argumentError();

    let serverTimeOffsetMs = 0;
    const adjustedTimestamp = () => requireSafeTimestamp(now() + serverTimeOffsetMs);

    const execute = async ({
        operation,
        endpointId,
        pathname,
        method,
        entries = [],
        signed,
        expected = null,
        responseLimits = FUTURES_PRODUCTION_EXECUTION_RESPONSE_LIMITS,
        normalize,
    }) => {
        const form = signed
            ? appendSignedParameters(entries, adjustedTimestamp(), apiSecret)
            : new URLSearchParams(entries);
        const usesBody = method === 'POST';
        const base = `${FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN}${pathname}`;
        const url = usesBody || form.size === 0 ? base : `${base}?${form.toString()}`;
        assertFixedUrl(url, pathname);

        const controller = new AbortController();
        let rejectDeadline;
        let timedOut = false;
        const deadline = new Promise((_resolve, reject) => {
            rejectDeadline = reject;
        });
        const timer = setTimeoutFn(() => {
            timedOut = true;
            controller.abort();
            rejectDeadline(new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                operation,
                endpointId,
            }));
        }, OPERATION_DEADLINE_MS);

        try {
            const request = {
                method,
                headers: {
                    ...(signed ? { 'X-MBX-APIKEY': apiKey } : {}),
                    ...(usesBody
                        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
                        : {}),
                },
                ...(usesBody ? { body: form.toString() } : {}),
                redirect: 'error',
                signal: controller.signal,
            };
            const response = await Promise.race([fetchImpl(url, request), deadline]);
            if (response?.redirected === true) {
                throw new FuturesProductionExecutionFacadeError({
                    kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                    operation,
                    endpointId,
                });
            }
            const status = Number.isSafeInteger(response?.status) ? response.status : 0;
            const rateLimitHeaders = validateFuturesProductionExecutionResponseHeaders(
                response?.headers,
            );
            const { text, digest } = await Promise.race([
                readFuturesProductionExecutionResponseBody(
                    response,
                    responseLimits,
                    controller.signal,
                ),
                deadline,
            ]);
            let body;
            try {
                body = parseFuturesProductionExecutionJson(text, responseLimits);
            } catch {
                throw new FuturesProductionExecutionFacadeError({
                    kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                    operation,
                    endpointId,
                    status,
                    rateLimitHeaders,
                    bodyDigest: digest,
                });
            }
            const binanceError = readBinanceError(body);
            if (status < 200 || status >= 300 || binanceError !== null) {
                throw classifyFailure({
                    operation,
                    endpointId,
                    status,
                    binanceError,
                    rateLimitHeaders,
                    bodyDigest: digest,
                });
            }
            let data;
            try {
                data = normalize(body, expected);
            } catch {
                throw new FuturesProductionExecutionFacadeError({
                    kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                    operation,
                    endpointId,
                    status,
                    rateLimitHeaders,
                    bodyDigest: digest,
                });
            }
            return Object.freeze({
                data,
                receipt: createReceipt({
                    operation,
                    endpointId,
                    status,
                    bodyDigest: digest,
                    rateLimitHeaders,
                }),
            });
        } catch (error) {
            if (error instanceof FuturesProductionExecutionFacadeError) throw error;
            throw new FuturesProductionExecutionFacadeError({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                operation,
                endpointId,
            });
        } finally {
            clearTimeoutFn(timer);
            if (timedOut) controller.abort();
        }
    };

    const getServerTime = async () => {
        const sentAt = now();
        requireSafeTimestamp(sentAt);
        const result = await execute({
            operation: 'serverTime',
            endpointId: 'server-time',
            pathname: '/fapi/v1/time',
            method: 'GET',
            signed: false,
            normalize: normalizeServerTime,
        });
        const receivedAt = now();
        requireSafeTimestamp(receivedAt);
        const roundTripMs = receivedAt - sentAt;
        if (!Number.isSafeInteger(roundTripMs) || roundTripMs < 0) throw argumentError('serverTime');
        const midpoint = sentAt + Math.floor(roundTripMs / 2);
        const nextOffset = result.data.serverTime - midpoint;
        if (!Number.isSafeInteger(nextOffset)) throw argumentError('serverTime');
        serverTimeOffsetMs = nextOffset;
        return Object.freeze({
            data: Object.freeze({ ...result.data, sentAt, receivedAt, roundTripMs }),
            receipt: result.receipt,
        });
    };

    const getExchangeInfo = () => execute({
        operation: 'exchangeInfo',
        endpointId: 'exchange-info',
        pathname: '/fapi/v1/exchangeInfo',
        method: 'GET',
        signed: false,
        responseLimits: FUTURES_PRODUCTION_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS,
        normalize: body => normalizeReadData(body, { operation: 'exchangeInfo' }),
    });

    const getMarkPrice = (symbolValue) => {
        const symbol = requireSymbol(symbolValue, allowedSymbols, 'markPrice');
        return execute({
            operation: 'markPrice',
            endpointId: 'mark-price',
            pathname: '/fapi/v1/premiumIndex',
            method: 'GET',
            entries: [['symbol', symbol]],
            signed: false,
            expected: { symbol },
            normalize: body => normalizeReadData(body, { operation: 'markPrice', symbol }),
        });
    };

    const getAccountConfig = () => execute({
        operation: 'accountConfig',
        endpointId: 'account-config',
        pathname: '/fapi/v1/accountConfig',
        method: 'GET',
        signed: true,
        normalize: body => normalizeReadData(body, { operation: 'accountConfig' }),
    });

    const signedSymbolRead = ({ operation, endpointId, pathname, symbolValue }) => {
        const symbol = requireSymbol(symbolValue, allowedSymbols, operation);
        return execute({
            operation,
            endpointId,
            pathname,
            method: 'GET',
            entries: [['symbol', symbol]],
            signed: true,
            expected: { symbol },
            normalize: body => normalizeReadData(body, { operation, symbol }),
        });
    };

    const getSymbolConfig = symbol => signedSymbolRead({
        operation: 'symbolConfig',
        endpointId: 'symbol-config',
        pathname: '/fapi/v1/symbolConfig',
        symbolValue: symbol,
    });
    const getPositionRisk = symbol => signedSymbolRead({
        operation: 'positionRisk',
        endpointId: 'position-risk',
        pathname: '/fapi/v3/positionRisk',
        symbolValue: symbol,
    });
    const getOpenOrders = symbol => signedSymbolRead({
        operation: 'openOrders',
        endpointId: 'open-orders',
        pathname: '/fapi/v1/openOrders',
        symbolValue: symbol,
    });
    const getOpenAlgoOrders = symbol => signedSymbolRead({
        operation: 'openAlgoOrders',
        endpointId: 'open-algo-orders',
        pathname: '/fapi/v1/openAlgoOrders',
        symbolValue: symbol,
    });

    const getBalance = () => execute({
        operation: 'balance',
        endpointId: 'balance-v3',
        pathname: '/fapi/v3/balance',
        method: 'GET',
        signed: true,
        normalize: body => normalizeReadData(body, { operation: 'balance' }),
    });

    const placeLimitGtcOrder = (value) => {
        const operation = 'placeLimitGtcOrder';
        const args = readExactDataProperties(value, [
            'symbol', 'side', 'quantity', 'price', 'reduceOnly', 'clientOrderId',
        ], operation);
        const symbol = requireSymbol(args.symbol, allowedSymbols, operation);
        if (!['BUY', 'SELL'].includes(args.side)
            || typeof args.reduceOnly !== 'boolean'
            || typeof args.clientOrderId !== 'string'
            || !CLIENT_ID_PATTERN.test(args.clientOrderId)) throw argumentError(operation);
        parsePositiveExactDecimal(args.quantity);
        parsePositiveExactDecimal(args.price);
        return execute({
            operation,
            endpointId: 'new-limit-gtc-order',
            pathname: '/fapi/v1/order',
            method: 'POST',
            signed: true,
            entries: [
                ['symbol', symbol],
                ['side', args.side],
                ['type', 'LIMIT'],
                ['timeInForce', 'GTC'],
                ['quantity', args.quantity],
                ['price', args.price],
                ['positionSide', 'BOTH'],
                ['reduceOnly', String(args.reduceOnly)],
                ['newClientOrderId', args.clientOrderId],
                ['newOrderRespType', 'ACK'],
            ],
            expected: { symbol, clientOrderId: args.clientOrderId },
            normalize: normalizeOrderAck,
        });
    };

    const placeReduceOnlyMarketOrder = (value) => {
        const operation = 'placeReduceOnlyMarketOrder';
        const args = readExactDataProperties(value, [
            'symbol', 'side', 'quantity', 'clientOrderId',
        ], operation);
        const symbol = requireSymbol(args.symbol, allowedSymbols, operation);
        if (!['BUY', 'SELL'].includes(args.side)
            || typeof args.clientOrderId !== 'string'
            || !CLIENT_ID_PATTERN.test(args.clientOrderId)) throw argumentError(operation);
        parsePositiveExactDecimal(args.quantity);
        return execute({
            operation,
            endpointId: 'new-reduce-only-market-order',
            pathname: '/fapi/v1/order',
            method: 'POST',
            signed: true,
            entries: [
                ['symbol', symbol],
                ['side', args.side],
                ['type', 'MARKET'],
                ['quantity', args.quantity],
                ['positionSide', 'BOTH'],
                ['reduceOnly', 'true'],
                ['newClientOrderId', args.clientOrderId],
                ['newOrderRespType', 'ACK'],
            ],
            expected: { symbol, clientOrderId: args.clientOrderId },
            normalize: normalizeOrderAck,
        });
    };

    const queryOrderByOriginalClientOrderId = (value) => {
        const operation = 'queryOrder';
        const args = readExactDataProperties(value, [
            'symbol', 'originalClientOrderId',
        ], operation);
        const symbol = requireSymbol(args.symbol, allowedSymbols, operation);
        if (typeof args.originalClientOrderId !== 'string'
            || !CLIENT_ID_PATTERN.test(args.originalClientOrderId)) {
            throw argumentError(operation);
        }
        return execute({
            operation,
            endpointId: 'query-order',
            pathname: '/fapi/v1/order',
            method: 'GET',
            signed: true,
            entries: [
                ['symbol', symbol],
                ['origClientOrderId', args.originalClientOrderId],
            ],
            expected: { symbol, originalClientOrderId: args.originalClientOrderId },
            normalize: normalizeQueryOrder,
        });
    };

    const cancel = (value, { operation, endpointId, pathname }) => {
        const args = readExactDataProperties(value, ['symbol'], operation);
        const symbol = requireSymbol(args.symbol, allowedSymbols, operation);
        return execute({
            operation,
            endpointId,
            pathname,
            method: 'DELETE',
            signed: true,
            entries: [['symbol', symbol]],
            expected: { symbol },
            normalize: normalizeCancelAcknowledgement,
        });
    };

    const cancelAllOpenOrders = value => cancel(value, {
        operation: 'cancelAllOpenOrders',
        endpointId: 'cancel-all-open-orders',
        pathname: '/fapi/v1/allOpenOrders',
    });
    const cancelAllAlgoOpenOrders = value => cancel(value, {
        operation: 'cancelAllAlgoOpenOrders',
        endpointId: 'cancel-all-algo-open-orders',
        pathname: '/fapi/v1/algoOpenOrders',
    });

    return Object.freeze({
        getServerTime,
        getExchangeInfo,
        getMarkPrice,
        getAccountConfig,
        getSymbolConfig,
        getBalance,
        getPositionRisk,
        getOpenOrders,
        getOpenAlgoOrders,
        placeLimitGtcOrder,
        placeReduceOnlyMarketOrder,
        queryOrderByOriginalClientOrderId,
        cancelAllOpenOrders,
        cancelAllAlgoOpenOrders,
    });
};
