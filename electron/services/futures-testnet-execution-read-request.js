import { createHmac } from 'node:crypto';
import { FUTURES_TESTNET_EXECUTION_REST_ORIGIN } from './futures-testnet-execution-config.js';
import {
    FUTURES_TESTNET_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS,
    FuturesTestnetExecutionIntegerToken,
    parseFuturesTestnetExecutionJson,
    readFuturesTestnetExecutionResponseBody,
    validateFuturesTestnetExecutionResponseHeaders,
} from './futures-testnet-execution-json.js';

const DEADLINE_MS = 10_000;
const MAX_SAFE = 9_007_199_254_740_991n;
const ENDPOINTS = Object.freeze({
    '/fapi/v1/time': Object.freeze({ signed: false, query: [] }),
    '/fapi/v1/exchangeInfo': Object.freeze({
        signed: false,
        query: [],
        responseLimits: FUTURES_TESTNET_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS,
    }),
    '/fapi/v1/accountConfig': Object.freeze({ signed: true, query: [] }),
    '/fapi/v1/symbolConfig': Object.freeze({ signed: true, query: ['symbol'] }),
    '/fapi/v3/positionRisk': Object.freeze({ signed: true, query: ['symbol'] }),
    '/fapi/v3/balance': Object.freeze({ signed: true, query: [] }),
    '/fapi/v1/openOrders': Object.freeze({ signed: true, query: ['symbol'] }),
    '/fapi/v1/openAlgoOrders': Object.freeze({ signed: true, query: ['symbol'] }),
    '/fapi/v1/premiumIndex': Object.freeze({ signed: false, query: ['symbol'] }),
});
const LOSSLESS_ID_FIELDS = new Set(['orderId', 'algoId']);

export class FuturesTestnetExecutionReadRequestError extends Error {
    constructor(code, status = null) {
        super('Futures testnet execution read failed');
        this.name = 'FuturesTestnetExecutionReadRequestError';
        this.code = code;
        this.status = status;
    }
}

const fail = (code, status = null) => {
    throw new FuturesTestnetExecutionReadRequestError(code, status);
};

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const isValidCredential = value => (
    typeof value === 'string' && /^[\x21-\x7e]{1,128}$/.test(value)
);

const convertWireValue = (value, field = '') => {
    if (value instanceof FuturesTestnetExecutionIntegerToken) {
        let integer;
        try {
            integer = BigInt(value.token);
        } catch {
            fail('INVALID_INTEGER');
        }
        if (LOSSLESS_ID_FIELDS.has(field)) {
            if (integer <= 0n || integer > 9_223_372_036_854_775_807n) fail('INVALID_IDENTITY');
            return value.token;
        }
        if (integer < -MAX_SAFE || integer > MAX_SAFE) fail('UNSAFE_INTEGER');
        return Number(integer);
    }
    if (Array.isArray(value)) return value.map(entry => convertWireValue(entry));
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, convertWireValue(entry, key)]),
        );
    }
    return value;
};

const requireQuery = (query, fields) => {
    if (!isRecord(query)) fail('INVALID_ARGUMENTS');
    const keys = Object.keys(query).sort();
    const expected = [...fields].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        fail('INVALID_ARGUMENTS');
    }
    for (const field of fields) {
        if (field === 'symbol'
            && (typeof query[field] !== 'string' || !/^[A-Z0-9]{2,20}$/.test(query[field]))) {
            fail('INVALID_ARGUMENTS');
        }
    }
};

export const createFuturesTestnetExecutionReadRequest = ({
    apiKey,
    apiSecret,
    fetchImpl = globalThis.fetch,
    wallNow = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
} = {}) => {
    if (!isValidCredential(apiKey)
        || !isValidCredential(apiSecret)
        || typeof fetchImpl !== 'function' || typeof wallNow !== 'function') {
        fail('INVALID_CONFIG');
    }
    let offsetMs = 0;

    const adjustedNow = () => {
        const current = wallNow() + offsetMs;
        if (!Number.isSafeInteger(current) || current < 0) fail('INVALID_CLOCK');
        return current;
    };

    const request = async (options) => {
        if (!isRecord(options)
            || Reflect.ownKeys(options).some(key => ![
                'origin', 'path', 'method', 'query', 'signed', 'redirect', 'signal',
            ].includes(key))
            || options.origin !== FUTURES_TESTNET_EXECUTION_REST_ORIGIN
            || options.method !== 'GET'
            || options.redirect !== 'error') {
            fail('INVALID_ARGUMENTS');
        }
        const endpoint = ENDPOINTS[options.path];
        if (!endpoint || endpoint.signed !== options.signed) fail('INVALID_ENDPOINT');
        requireQuery(options.query, endpoint.query);
        const url = new URL(options.path, FUTURES_TESTNET_EXECUTION_REST_ORIGIN);
        for (const field of endpoint.query) url.searchParams.append(field, options.query[field]);
        if (endpoint.signed) {
            url.searchParams.append('recvWindow', '5000');
            url.searchParams.append('timestamp', String(adjustedNow()));
            const signature = createHmac('sha256', apiSecret)
                .update(url.searchParams.toString())
                .digest('hex');
            url.searchParams.append('signature', signature);
        }
        if (url.origin !== FUTURES_TESTNET_EXECUTION_REST_ORIGIN
            || url.pathname !== options.path
            || url.username
            || url.password) {
            fail('INVALID_ENDPOINT');
        }

        const controller = new AbortController();
        const externalSignal = options.signal;
        let rejectCancellation;
        let cancellationSettled = false;
        const cancellation = new Promise((_, reject) => {
            rejectCancellation = reject;
        });
        const abort = () => {
            if (cancellationSettled) return;
            cancellationSettled = true;
            controller.abort();
            rejectCancellation(new FuturesTestnetExecutionReadRequestError('DEADLINE_OR_ABORT'));
        };
        externalSignal?.addEventListener?.('abort', abort, { once: true });
        if (externalSignal?.aborted) abort();
        const timer = setTimeoutFn(abort, DEADLINE_MS);
        const sentAt = wallNow();
        try {
            if (controller.signal.aborted) await cancellation;
            const response = await Promise.race([
                fetchImpl(url.toString(), {
                    method: 'GET',
                    headers: endpoint.signed ? { 'X-MBX-APIKEY': apiKey } : {},
                    redirect: 'error',
                    signal: controller.signal,
                }),
                cancellation,
            ]);
            validateFuturesTestnetExecutionResponseHeaders(response?.headers);
            const { text } = await Promise.race([
                readFuturesTestnetExecutionResponseBody(response, endpoint.responseLimits),
                cancellation,
            ]);
            let parsed;
            try {
                parsed = convertWireValue(parseFuturesTestnetExecutionJson(
                    text,
                    endpoint.responseLimits,
                ));
            } catch {
                fail('MALFORMED_RESPONSE', response?.status ?? null);
            }
            if (response?.ok !== true) fail('UPSTREAM_REJECTED', response?.status ?? null);
            if (isRecord(parsed) && typeof parsed.code === 'number' && parsed.code < 0) {
                fail('UPSTREAM_REJECTED', response?.status ?? null);
            }
            if (options.path === '/fapi/v1/time') {
                if (!Number.isSafeInteger(parsed?.serverTime) || parsed.serverTime < 0) {
                    fail('MALFORMED_RESPONSE', response?.status ?? null);
                }
                const receivedAt = wallNow();
                const midpoint = sentAt + Math.floor((receivedAt - sentAt) / 2);
                const nextOffset = parsed.serverTime - midpoint;
                if (!Number.isSafeInteger(nextOffset)) fail('INVALID_CLOCK');
                offsetMs = nextOffset;
            }
            return parsed;
        } catch (error) {
            if (error instanceof FuturesTestnetExecutionReadRequestError) throw error;
            fail(controller.signal.aborted ? 'DEADLINE_OR_ABORT' : 'NETWORK_ERROR');
        } finally {
            clearTimeoutFn(timer);
            externalSignal?.removeEventListener?.('abort', abort);
        }
    };

    return Object.freeze({ request, adjustedNow });
};
