import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS,
    FuturesTestnetExecutionFacadeError,
    createFuturesTestnetExecutionFacade,
} from './futures-testnet-execution-facade.js';
import {
    FuturesTestnetExecutionJsonError,
    parseFuturesTestnetExecutionJson,
} from './futures-testnet-execution-json.js';

const requestId = '0123456789abcdef0123456789abcdef';
const clientOrderId = `cc6-${requestId}`;
const config = {
    apiKey: 'demo-api-key',
    apiSecret: 'demo-api-secret',
    allowedSymbols: ['BTCUSDT'],
};
const placeArgs = {
    symbol: 'BTCUSDT',
    side: 'SELL',
    quantity: '0.0010',
    price: '70000.00',
    clientOrderId,
};

const makeResponse = (body, { status = 200, headers = {} } = {}) => new Response(body, {
    status,
    headers,
});

const makeAck = (orderId = '9007199254740992') => (
    `{"symbol":"BTCUSDT","orderId":${orderId},"clientOrderId":"${clientOrderId}","transactTime":1783814400123}`
);

const makeQuery = (orderId = '9223372036854775807', overrides = {}) => JSON.stringify({
    symbol: 'BTCUSDT',
    orderId: Number(orderId),
    clientOrderId,
    price: '70000.000',
    origQty: '0.00100',
    executedQty: '0.00050',
    avgPrice: '70000.00',
    status: 'PARTIALLY_FILLED',
    timeInForce: 'GTC',
    type: 'LIMIT',
    origType: 'LIMIT',
    reduceOnly: true,
    closePosition: false,
    side: 'SELL',
    positionSide: 'BOTH',
    workingType: 'CONTRACT_PRICE',
    priceProtect: false,
    updateTime: 1783814400123,
    ...overrides,
}).replace(`"orderId":${Number(orderId)}`, `"orderId":${orderId}`);

describe('FuturesTestnetExecutionFacade', () => {
    afterEach(() => vi.useRealTimers());

    it.each([
        ['empty API key', { apiKey: '' }],
        ['empty API secret', { apiSecret: '' }],
        ['leading space', { apiKey: ' demo-key' }],
        ['embedded space', { apiSecret: 'demo secret' }],
        ['trailing space', { apiKey: 'demo-key ' }],
        ['tab', { apiSecret: 'demo\tsecret' }],
        ['newline', { apiKey: 'demo\nkey' }],
        ['trailing newline', { apiSecret: 'demo-secret\n' }],
        ['trailing carriage return', { apiKey: 'demo-key\r' }],
        ['NUL', { apiSecret: 'demo\0secret' }],
        ['DEL', { apiKey: 'demo\x7fkey' }],
        ['non-ASCII', { apiSecret: 'd\u00e9mo-secret' }],
        ['129-byte API key', { apiKey: 'k'.repeat(129) }],
        ['129-byte API secret', { apiSecret: 's'.repeat(129) }],
    ])('rejects %s without exposing credential material', (_label, override) => {
        const invalidConfig = { ...config, ...override };
        let error;
        try {
            createFuturesTestnetExecutionFacade(invalidConfig, { fetchImpl: vi.fn() });
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(FuturesTestnetExecutionFacadeError);
        expect(error).toMatchObject({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.ARGUMENT,
            message: 'Futures testnet execution request failed',
        });
        const rejectedCredential = override.apiKey ?? override.apiSecret;
        if (rejectedCredential) {
            expect(JSON.stringify(error)).not.toContain(rejectedCredential);
        }
    });

    it('accepts exact one-byte and 128-byte visible-ASCII credential boundaries', () => {
        expect(() => createFuturesTestnetExecutionFacade({
            ...config,
            apiKey: '!',
            apiSecret: '~',
        }, { fetchImpl: vi.fn() })).not.toThrow();
        expect(() => createFuturesTestnetExecutionFacade({
            ...config,
            apiKey: 'k'.repeat(128),
            apiSecret: 's'.repeat(128),
        }, { fetchImpl: vi.fn() })).not.toThrow();
    });

    it('exposes exactly two methods and sends the canonical signed POST once', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(makeAck()));
        const facade = createFuturesTestnetExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });

        expect(Object.keys(facade)).toEqual([
            'placeReduceOnlyLimitGtcOrder',
            'queryOrderByOriginalClientOrderId',
        ]);
        await expect(facade.placeReduceOnlyLimitGtcOrder(placeArgs)).resolves.toEqual({
            symbol: 'BTCUSDT',
            clientOrderId,
            orderId: '9007199254740992',
            transactTime: 1783814400123,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://demo-fapi.binance.com/fapi/v1/order');
        expect(options).toMatchObject({
            method: 'POST',
            redirect: 'error',
            headers: {
                'X-MBX-APIKEY': 'demo-api-key',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        const unsigned = [
            'symbol=BTCUSDT',
            'side=SELL',
            'type=LIMIT',
            'timeInForce=GTC',
            'quantity=0.0010',
            'price=70000.00',
            'positionSide=BOTH',
            'reduceOnly=true',
            `newClientOrderId=${clientOrderId}`,
            'newOrderRespType=ACK',
            'recvWindow=5000',
            'timestamp=1783814400000',
        ].join('&');
        const signature = createHmac('sha256', 'demo-api-secret').update(unsigned).digest('hex');
        expect(options.body).toBe(`${unsigned}&signature=${signature}`);
    });

    it('queries by exact original client id and retains signed-int64 identity losslessly', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(makeQuery()));
        const facade = createFuturesTestnetExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });
        const order = await facade.queryOrderByOriginalClientOrderId({
            symbol: 'BTCUSDT',
            originalClientOrderId: clientOrderId,
        });
        expect(order).toMatchObject({
            orderId: '9223372036854775807',
            originalQuantity: '0.00100',
            executedQuantity: '0.00050',
            averagePrice: '70000.00',
            updateTime: 1783814400123,
        });
        const [url, options] = fetchImpl.mock.calls[0];
        const parsed = new URL(url);
        expect(parsed.origin).toBe('https://demo-fapi.binance.com');
        expect(parsed.pathname).toBe('/fapi/v1/order');
        expect([...parsed.searchParams.keys()]).toEqual([
            'symbol', 'origClientOrderId', 'recvWindow', 'timestamp', 'signature',
        ]);
        expect(options).not.toHaveProperty('body');
        expect(options.redirect).toBe('error');
    });

    it.each([
        ['network loss', () => Promise.reject(new Error('secret-bearing network object'))],
        ['redirect', () => Promise.resolve(makeResponse('{}', { status: 302, headers: { location: 'https://example.invalid' } }))],
        ['timeout status', () => Promise.resolve(makeResponse('{"code":-1007,"msg":"timeout"}', { status: 408 }))],
        ['ambiguous 503', () => Promise.resolve(makeResponse('{"code":-1000,"msg":"unknown"}', { status: 503 }))],
        ['malformed success', () => Promise.resolve(makeResponse('{"symbol":'))],
        ['duplicate response key', () => Promise.resolve(makeResponse(`{"symbol":"BTCUSDT","symbol":"BTCUSDT","orderId":1,"clientOrderId":"${clientOrderId}"}`))],
    ])('never retries the POST after %s', async (_label, responseFactory) => {
        const fetchImpl = vi.fn().mockImplementation(responseFactory);
        const facade = createFuturesTestnetExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });
        await expect(facade.placeReduceOnlyLimitGtcOrder(placeArgs)).rejects.toMatchObject({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it.each([
        [429, -1003, FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.RATE_LIMITED],
        [418, -1003, FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.RATE_LIMITED],
        [429, -1015, FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.RATE_LIMITED],
        [401, -2015, FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED],
        [403, -2015, FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED],
        [400, -1021, FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED],
        [400, -1111, FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED],
        [200, -2022, FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED],
        [400, -4116, FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS],
    ])('classifies HTTP %i / Binance %i without a retry', async (status, code, kind) => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(
            `{"code":${code},"msg":"bounded"}`,
            { status, headers: { 'retry-after': '120' } },
        ));
        const facade = createFuturesTestnetExecutionFacade(config, { fetchImpl, now: () => 1 });
        await expect(facade.placeReduceOnlyLimitGtcOrder(placeArgs)).rejects.toMatchObject({
            kind,
            status,
            binanceCode: code,
            headers: expect.objectContaining({ 'retry-after': '120' }),
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it.each([
        ['empty 401 body', 401, ''],
        ['non-error 401 body', 401, '{}'],
        ['missing-message 401 body', 401, '{"code":-2015}'],
        ['empty-message 401 body', 401, '{"code":-2015,"msg":""}'],
        ['extra-field 401 body', 401, '{"code":-2015,"msg":"denied","extra":true}'],
        ['string-code 401 body', 401, '{"code":"-2015","msg":"denied"}'],
        ['wrong-message 403 body', 403, '{"code":-2015,"msg":null}'],
        ['unknown 401 code', 401, '{"code":-2999,"msg":"unknown"}'],
        ['exchange code under 403', 403, '{"code":-1111,"msg":"wrong status"}'],
        ['unreviewed auth code', 401, '{"code":-2014,"msg":"not allowlisted"}'],
        ['unknown 400 code', 400, '{"code":-2999,"msg":"unknown"}'],
        ['allowlisted code under 409', 409, '{"code":-1111,"msg":"wrong status"}'],
        ['allowlisted code under 422', 422, '{"code":-2022,"msg":"wrong status"}'],
        ['allowlisted code under 500', 500, '{"code":-1111,"msg":"server failure"}'],
        ['auth code under 503', 503, '{"code":-2015,"msg":"server failure"}'],
        ['allowlisted code under 408', 408, '{"code":-1111,"msg":"timeout"}'],
        ['unknown success error', 200, '{"code":-2999,"msg":"unknown"}'],
        ['malformed success error', 200, '{"code":-1111}'],
        ['allowlisted error under unreviewed success status', 201, '{"code":-1111,"msg":"wrong status"}'],
        ['unknown 418 rate code', 418, '{"code":-2999,"msg":"unknown"}'],
        ['auth code under 429', 429, '{"code":-2015,"msg":"wrong class"}'],
        ['rate code under 400', 400, '{"code":-1003,"msg":"wrong status"}'],
    ])('keeps %s ambiguous and never retries', async (_label, status, body) => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(body, { status }));
        const facade = createFuturesTestnetExecutionFacade(config, { fetchImpl, now: () => 1 });
        await expect(facade.placeReduceOnlyLimitGtcOrder(placeArgs)).rejects.toMatchObject({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            status,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it.each([
        ['missing message', '{"code":-1003}'],
        ['extra field', '{"code":-1003,"msg":"bounded","extra":true}'],
        ['wrong code type', '{"code":"-1003","msg":"bounded"}'],
    ])('keeps an unreviewed 429 %s ambiguous', async (_label, body) => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(body, {
            status: 429,
            headers: { 'retry-after': '120' },
        }));
        const facade = createFuturesTestnetExecutionFacade(config, { fetchImpl, now: () => 1 });
        await expect(facade.placeReduceOnlyLimitGtcOrder(placeArgs)).rejects.toMatchObject({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('classifies Query Order -2013 only as not found', async () => {
        const facade = createFuturesTestnetExecutionFacade(config, {
            fetchImpl: vi.fn().mockResolvedValue(makeResponse(
                '{"code":-2013,"msg":"Order does not exist."}',
                { status: 400 },
            )),
            now: () => 1,
        });
        await expect(facade.queryOrderByOriginalClientOrderId({
            symbol: 'BTCUSDT',
            originalClientOrderId: clientOrderId,
        })).rejects.toMatchObject({ kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND });
    });

    it.each([
        ['extra field', 400, '{"code":-2013,"msg":"Order does not exist.","extra":true}'],
        ['missing message', 400, '{"code":-2013}'],
        ['success status', 200, '{"code":-2013,"msg":"Order does not exist."}'],
        ['unknown status', 404, '{"code":-2013,"msg":"Order does not exist."}'],
    ])('does not treat malformed or status-mismatched Query Order %s as not found', async (
        _label,
        status,
        body,
    ) => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(body, { status }));
        const facade = createFuturesTestnetExecutionFacade(config, { fetchImpl, now: () => 1 });
        await expect(facade.queryOrderByOriginalClientOrderId({
            symbol: 'BTCUSDT',
            originalClientOrderId: clientOrderId,
        })).rejects.toMatchObject({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            status,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('enforces the whole-operation deadline and exposes no raw cause', async () => {
        vi.useFakeTimers();
        let signal;
        const fetchImpl = vi.fn((_url, options) => {
            signal = options.signal;
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(new Error('raw-secret')), { once: true });
            });
        });
        const facade = createFuturesTestnetExecutionFacade(config, { fetchImpl, now: () => 1 });
        const pending = facade.placeReduceOnlyLimitGtcOrder(placeArgs);
        const observed = pending.catch((error) => error);
        await vi.advanceTimersByTimeAsync(10_000);
        const error = await observed;
        expect(error).toBeInstanceOf(FuturesTestnetExecutionFacadeError);
        expect(signal.aborted).toBe(true);
        expect(error).not.toHaveProperty('cause');
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('settles at the owned deadline when fetch ignores AbortSignal forever', async () => {
        vi.useFakeTimers();
        let signal;
        const fetchImpl = vi.fn((_url, options) => {
            signal = options.signal;
            return new Promise(() => {});
        });
        const facade = createFuturesTestnetExecutionFacade(config, { fetchImpl, now: () => 1 });
        const observed = facade.placeReduceOnlyLimitGtcOrder(placeArgs).catch((error) => error);
        await vi.advanceTimersByTimeAsync(10_000);
        const error = await observed;
        expect(error).toBeInstanceOf(FuturesTestnetExecutionFacadeError);
        expect(error).toMatchObject({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeOrder',
        });
        expect(signal.aborted).toBe(true);
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('never accepts a valid POST acknowledgement arriving after the deadline', async () => {
        vi.useFakeTimers();
        let signal;
        const fetchImpl = vi.fn((_url, options) => {
            signal = options.signal;
            return new Promise((resolve) => {
                setTimeout(() => resolve(makeResponse(makeAck())), 10_001);
            });
        });
        const facade = createFuturesTestnetExecutionFacade(config, { fetchImpl, now: () => 1 });
        const observed = facade.placeReduceOnlyLimitGtcOrder(placeArgs).then(
            (value) => ({ value }),
            (error) => ({ error }),
        );
        await vi.advanceTimersByTimeAsync(10_001);
        const result = await observed;
        expect(result).not.toHaveProperty('value');
        expect(result.error).toMatchObject({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeOrder',
        });
        expect(signal.aborted).toBe(true);
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('fails closed on body and header resource overflow', async () => {
        const oversizedBody = 'x'.repeat(65_537);
        const bodyFacade = createFuturesTestnetExecutionFacade(config, {
            fetchImpl: vi.fn().mockResolvedValue(makeResponse(oversizedBody)),
            now: () => 1,
        });
        await expect(bodyFacade.placeReduceOnlyLimitGtcOrder(placeArgs)).rejects.toMatchObject({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
        });

        const headers = Object.fromEntries(
            Array.from({ length: 65 }, (_, index) => [`x-test-${index}`, '1']),
        );
        const headerFacade = createFuturesTestnetExecutionFacade(config, {
            fetchImpl: vi.fn().mockResolvedValue(makeResponse(makeAck(), { headers })),
            now: () => 1,
        });
        await expect(headerFacade.placeReduceOnlyLimitGtcOrder(placeArgs)).rejects.toMatchObject({
            kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
        });
    });

    it('rejects argument expansion before transport', async () => {
        const fetchImpl = vi.fn();
        const facade = createFuturesTestnetExecutionFacade(config, { fetchImpl, now: () => 1 });
        await expect(facade.placeReduceOnlyLimitGtcOrder({
            ...placeArgs,
            url: 'https://example.invalid',
        })).rejects.toMatchObject({ kind: FUTURES_TESTNET_EXECUTION_FACADE_ERROR_KINDS.ARGUMENT });
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('bounded duplicate-aware execution JSON', () => {
    it('retains integer tokens beyond Number precision', () => {
        const parsed = parseFuturesTestnetExecutionJson('{"orderId":9223372036854775807}');
        expect(parsed.orderId.token).toBe('9223372036854775807');
    });

    it('rejects decoded duplicate keys, floats, and oversized strings', () => {
        expect(() => parseFuturesTestnetExecutionJson('{"a":1,"\\u0061":2}'))
            .toThrow(FuturesTestnetExecutionJsonError);
        expect(() => parseFuturesTestnetExecutionJson('{"a":1.5}'))
            .toThrow(FuturesTestnetExecutionJsonError);
        expect(() => parseFuturesTestnetExecutionJson(`{"msg":"${'x'.repeat(4097)}"}`))
            .toThrow(FuturesTestnetExecutionJsonError);
    });
});
