import { createHmac } from 'node:crypto';
import {
    parseNonNegativeExactDecimal,
    parsePositiveExactDecimal,
} from './futures-testnet-execution-decimal.js';
import { FUTURES_TESTNET_EXECUTION_REST_ORIGIN } from './futures-testnet-execution-config.js';
import {
    FuturesTestnetExecutionJsonError,
    parseFuturesTestnetExecutionJson,
    readFuturesTestnetExecutionResponseBody,
    readIntegerToken,
    validateFuturesTestnetExecutionResponseHeaders,
} from './futures-testnet-execution-json.js';

const SIGNED_RECV_WINDOW = '5000';
const OPERATION_DEADLINE_MS = 10_000;
const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const MAX_SAFE_INTEGER = 9_007_199_254_740_991n;
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/;
const CLIENT_ID_PATTERN = /^cc6-[0-9a-f]{32}$/;
const INVALID_EXECUTION_CREDENTIAL_CHARACTER_PATTERN = /[^\x21-\x7e]/;
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

export const FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS = Object.freeze({
    ARGUMENT: 'argument',
    AUTH_REJECTED: 'auth_rejected',
    EXCHANGE_REJECTED: 'exchange_rejected',
    RATE_LIMITED: 'rate_limited',
    NOT_FOUND: 'not_found',
    AMBIGUOUS: 'ambiguous',
});

export class FuturesTestnetExecutionFacadeError extends Error {
    constructor({ kind, operation, status = null, binanceCode = null, headers = null, bodyDigest = null }) {
        super('Futures testnet execution request failed');
        this.name = 'FuturesTestnetExecutionFacadeError';
        this.code = 'FUTURES_TESTNET_EXECUTION_REQUEST_FAILED';
        this.kind = kind;
        this.operation = operation;
        this.status = status;
        this.binanceCode = binanceCode;
        this.headers = headers;
        this.bodyDigest = bodyDigest;
    }
}

const isPlainObject = (value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
);

const readExactArguments = (value, fields) => {
    if (!isPlainObject(value)) throw new FuturesTestnetExecutionFacadeError({ kind: 'argument' });
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length
        || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
        throw new FuturesTestnetExecutionFacadeError({ kind: 'argument' });
    }
    return value;
};

const requireSafeTimestamp = (value) => {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new FuturesTestnetExecutionFacadeError({ kind: 'argument' });
    }
    return String(value);
};

const requireExactText = (value) => {
    if (typeof value !== 'string'
        || value.length === 0
        || INVALID_EXECUTION_CREDENTIAL_CHARACTER_PATTERN.test(value)
        || Buffer.byteLength(value, 'utf8') > 128) {
        throw new FuturesTestnetExecutionFacadeError({ kind: 'argument' });
    }
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
    if (parsed.origin !== FUTURES_TESTNET_EXECUTION_REST_ORIGIN
        || parsed.pathname !== pathname
        || parsed.username
        || parsed.password
        || parsed.hash) {
        throw new FuturesTestnetExecutionFacadeError({ kind: 'argument' });
    }
};

const readBinanceError = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    try {
        const code = readIntegerToken(body.code, {
            minimum: -MAX_SAFE_INTEGER,
            maximum: MAX_SAFE_INTEGER,
        }).parsed;
        if (code >= 0n) return null;
        const keys = Reflect.ownKeys(body);
        return Object.freeze({
            code: Number(code),
            reviewed: keys.length === 2
                && keys.includes('code')
                && keys.includes('msg')
                && typeof body.msg === 'string'
                && body.msg.length > 0
                && Buffer.byteLength(body.msg, 'utf8') <= 256,
        });
    } catch {
        return null;
    }
};

const classifyFailure = ({ operation, status, binanceError, headers, bodyDigest }) => {
    const binanceCode = binanceError?.code ?? null;
    let kind = FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS;
    if (binanceError?.reviewed !== true) {
        kind = FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS;
    } else if (binanceCode === -2013
        && operation === 'queryOrder'
        && status === 400) {
        kind = FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND;
    } else if (RATE_LIMITED_HTTP_STATUSES.has(status)
        && RATE_LIMITED_BINANCE_CODES.has(binanceCode)) {
        kind = FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.RATE_LIMITED;
    } else if (AUTH_REJECTED_HTTP_STATUSES.has(status)
        && AUTH_REJECTED_BINANCE_CODES.has(binanceCode)) {
        kind = FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED;
    } else if (operation === 'placeOrder'
        && EXCHANGE_REJECTED_HTTP_STATUSES.has(status)
        && EXCHANGE_REJECTED_BINANCE_CODES.has(binanceCode)) {
        kind = FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED;
    }
    return new FuturesTestnetExecutionFacadeError({
        kind,
        operation,
        status,
        binanceCode,
        headers,
        bodyDigest,
    });
};

const normalizeAck = (body, expected) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || body.symbol !== expected.symbol
        || body.clientOrderId !== expected.clientOrderId) {
        throw new FuturesTestnetExecutionJsonError('INVALID_ORDER_ACK');
    }
    const orderId = readIntegerToken(body.orderId, { minimum: 1n, maximum: MAX_SIGNED_INT64 }).token;
    let transactTime = null;
    if (body.transactTime !== undefined) {
        transactTime = Number(readIntegerToken(body.transactTime, {
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
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || body.symbol !== expected.symbol
        || body.clientOrderId !== expected.originalClientOrderId) {
        throw new FuturesTestnetExecutionJsonError('INVALID_QUERY_IDENTITY');
    }
    const orderId = readIntegerToken(body.orderId, { minimum: 1n, maximum: MAX_SIGNED_INT64 }).token;
    const updateTime = Number(readIntegerToken(body.updateTime, {
        minimum: 0n,
        maximum: MAX_SAFE_INTEGER,
    }).parsed);
    const stringFields = [
        'side', 'positionSide', 'type', 'origType', 'timeInForce', 'status',
        'origQty', 'executedQty', 'avgPrice', 'price', 'workingType',
    ];
    if (stringFields.some((field) => typeof body[field] !== 'string')
        || body.reduceOnly !== true
        || body.closePosition !== false
        || body.priceProtect !== false) {
        throw new FuturesTestnetExecutionJsonError('INVALID_QUERY_ORDER');
    }
    parsePositiveExactDecimal(body.origQty);
    parsePositiveExactDecimal(body.price);
    parseNonNegativeExactDecimal(body.executedQty);
    parseNonNegativeExactDecimal(body.avgPrice);
    return Object.freeze({
        symbol: body.symbol,
        clientOrderId: body.clientOrderId,
        orderId,
        side: body.side,
        positionSide: body.positionSide,
        type: body.type,
        origType: body.origType,
        timeInForce: body.timeInForce,
        status: body.status,
        originalQuantity: body.origQty,
        executedQuantity: body.executedQty,
        averagePrice: body.avgPrice,
        price: body.price,
        workingType: body.workingType,
        reduceOnly: body.reduceOnly,
        closePosition: body.closePosition,
        priceProtect: body.priceProtect,
        updateTime,
    });
};

export const createFuturesTestnetExecutionFacade = (config, dependencies = {}) => {
    const source = readExactArguments(config, ['apiKey', 'apiSecret', 'allowedSymbols']);
    const apiKey = requireExactText(source.apiKey);
    const apiSecret = requireExactText(source.apiSecret);
    if (!Array.isArray(source.allowedSymbols)
        || source.allowedSymbols.length < 1
        || source.allowedSymbols.some((symbol) => typeof symbol !== 'string' || !SYMBOL_PATTERN.test(symbol))
        || new Set(source.allowedSymbols).size !== source.allowedSymbols.length) {
        throw new FuturesTestnetExecutionFacadeError({ kind: 'argument' });
    }
    const allowedSymbols = new Set(source.allowedSymbols);
    const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
    const now = dependencies.now ?? Date.now;
    const setTimeoutFn = dependencies.setTimeoutFn ?? setTimeout;
    const clearTimeoutFn = dependencies.clearTimeoutFn ?? clearTimeout;
    if (typeof fetchImpl !== 'function' || typeof now !== 'function') {
        throw new FuturesTestnetExecutionFacadeError({ kind: 'argument' });
    }

    const execute = async ({ operation, pathname, method, form, expected, normalize }) => {
        const base = `${FUTURES_TESTNET_EXECUTION_REST_ORIGIN}${pathname}`;
        const url = method === 'GET' ? `${base}?${form.toString()}` : base;
        assertFixedUrl(url, pathname);
        const controller = new AbortController();
        let timedOut = false;
        let rejectDeadline;
        const deadline = new Promise((_resolve, reject) => {
            rejectDeadline = reject;
        });
        const timer = setTimeoutFn(() => {
            timedOut = true;
            controller.abort();
            rejectDeadline(new FuturesTestnetExecutionFacadeError({
                kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                operation,
            }));
        }, OPERATION_DEADLINE_MS);
        try {
            const response = await Promise.race([
                fetchImpl(url, {
                    method,
                    headers: {
                        'X-MBX-APIKEY': apiKey,
                        ...(method === 'POST'
                            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
                            : {}),
                    },
                    ...(method === 'POST' ? { body: form.toString() } : {}),
                    redirect: 'error',
                    signal: controller.signal,
                }),
                deadline,
            ]);
            const status = Number.isSafeInteger(response?.status) ? response.status : 0;
            const headers = validateFuturesTestnetExecutionResponseHeaders(response?.headers);
            const { text, digest } = await Promise.race([
                readFuturesTestnetExecutionResponseBody(response),
                deadline,
            ]);
            let body;
            try {
                body = parseFuturesTestnetExecutionJson(text);
            } catch {
                throw new FuturesTestnetExecutionFacadeError({
                    kind: 'ambiguous', operation, status, headers, bodyDigest: digest,
                });
            }
            const binanceError = readBinanceError(body);
            if (status < 200 || status >= 300 || binanceError !== null) {
                throw classifyFailure({ operation, status, binanceError, headers, bodyDigest: digest });
            }
            try {
                return normalize(body, expected);
            } catch {
                throw new FuturesTestnetExecutionFacadeError({
                    kind: 'ambiguous', operation, status, headers, bodyDigest: digest,
                });
            }
        } catch (error) {
            if (error instanceof FuturesTestnetExecutionFacadeError) throw error;
            throw new FuturesTestnetExecutionFacadeError({
                kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
                operation,
            });
        } finally {
            clearTimeoutFn(timer);
            if (timedOut) controller.abort();
        }
    };

    const placeReduceOnlyLimitGtcOrder = async (value) => {
        const args = readExactArguments(value, [
            'symbol', 'side', 'quantity', 'price', 'clientOrderId',
        ]);
        if (!allowedSymbols.has(args.symbol)
            || !['BUY', 'SELL'].includes(args.side)
            || !CLIENT_ID_PATTERN.test(args.clientOrderId ?? '')) {
            throw new FuturesTestnetExecutionFacadeError({ kind: 'argument' });
        }
        parsePositiveExactDecimal(args.quantity);
        parsePositiveExactDecimal(args.price);
        const timestamp = requireSafeTimestamp(now());
        const form = appendSignedParameters([
            ['symbol', args.symbol],
            ['side', args.side],
            ['type', 'LIMIT'],
            ['timeInForce', 'GTC'],
            ['quantity', args.quantity],
            ['price', args.price],
            ['positionSide', 'BOTH'],
            ['reduceOnly', 'true'],
            ['newClientOrderId', args.clientOrderId],
            ['newOrderRespType', 'ACK'],
        ], timestamp, apiSecret);
        return execute({
            operation: 'placeOrder',
            pathname: '/fapi/v1/order',
            method: 'POST',
            form,
            expected: args,
            normalize: normalizeAck,
        });
    };

    const queryOrderByOriginalClientOrderId = async (value) => {
        const args = readExactArguments(value, ['symbol', 'originalClientOrderId']);
        if (!allowedSymbols.has(args.symbol)
            || !CLIENT_ID_PATTERN.test(args.originalClientOrderId ?? '')) {
            throw new FuturesTestnetExecutionFacadeError({ kind: 'argument' });
        }
        const timestamp = requireSafeTimestamp(now());
        const form = appendSignedParameters([
            ['symbol', args.symbol],
            ['origClientOrderId', args.originalClientOrderId],
        ], timestamp, apiSecret);
        return execute({
            operation: 'queryOrder',
            pathname: '/fapi/v1/order',
            method: 'GET',
            form,
            expected: args,
            normalize: normalizeQueryOrder,
        });
    };

    return Object.freeze({
        placeReduceOnlyLimitGtcOrder,
        queryOrderByOriginalClientOrderId,
    });
};
