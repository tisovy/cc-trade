import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
    createFuturesTestnetExecutionReadRequest,
} from './futures-testnet-execution-read-request.js';
import {
    FUTURES_TESTNET_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS,
    FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS,
} from './futures-testnet-execution-json.js';

const origin = 'https://demo-fapi.binance.com';
const response = body => new Response(body, { status: 200 });

const countJsonNodes = (value) => {
    if (Array.isArray(value)) {
        return 1 + value.reduce((total, entry) => total + countJsonNodes(entry), 0);
    }
    if (value !== null && typeof value === 'object') {
        return 1 + Object.values(value)
            .reduce((total, entry) => total + countJsonNodes(entry), 0);
    }
    return 1;
};

const makeRealisticExchangeInfoBody = () => JSON.stringify({
    timezone: 'UTC',
    serverTime: 1783814400000,
    futuresType: 'U_MARGINED',
    rateLimits: [{
        rateLimitType: 'REQUEST_WEIGHT', interval: 'MINUTE', intervalNum: 1, limit: 6000,
    }],
    exchangeFilters: [],
    assets: [{ asset: 'USDT', marginAvailable: true, autoAssetExchange: '-10000' }],
    symbols: Array.from({ length: 640 }, (_, index) => {
        const symbol = `T${String(index).padStart(4, '0')}USDT`;
        return {
            symbol,
            pair: symbol,
            contractType: 'PERPETUAL',
            deliveryDate: 4133404800000,
            onboardDate: 1609459200000,
            status: 'TRADING',
            maintMarginPercent: '2.5000',
            requiredMarginPercent: '5.0000',
            baseAsset: `T${String(index).padStart(4, '0')}`,
            quoteAsset: 'USDT',
            marginAsset: 'USDT',
            pricePrecision: 3,
            quantityPrecision: 3,
            baseAssetPrecision: 8,
            quotePrecision: 8,
            underlyingType: 'COIN',
            underlyingSubType: ['Layer-1'],
            settlePlan: 0,
            triggerProtect: '0.0500',
            liquidationFee: '0.010000',
            marketTakeBound: '0.05',
            filters: [
                {
                    filterType: 'PRICE_FILTER',
                    minPrice: '0.001',
                    maxPrice: '1000000',
                    tickSize: '0.001',
                },
                {
                    filterType: 'LOT_SIZE',
                    minQty: '0.001',
                    maxQty: '100000',
                    stepSize: '0.001',
                },
                { filterType: 'MIN_NOTIONAL', notional: '5' },
                { filterType: 'MAX_NUM_ORDERS', limit: 200 },
            ],
            orderTypes: ['LIMIT', 'MARKET', 'STOP', 'TAKE_PROFIT'],
            timeInForce: ['GTC', 'IOC', 'FOK', 'GTX'],
        };
    }),
});

const exchangeInfoRequest = transport => transport.request({
    origin,
    path: '/fapi/v1/exchangeInfo',
    method: 'GET',
    query: {},
    signed: false,
    redirect: 'error',
});

const createManualDeadline = () => {
    const handle = Object.freeze({ timer: 'deadline' });
    let callback = null;
    const setTimeoutFn = vi.fn((next, delay) => {
        callback = next;
        expect(delay).toBe(10_000);
        return handle;
    });
    const clearTimeoutFn = vi.fn();
    return {
        clearTimeoutFn,
        fire: () => callback(),
        handle,
        setTimeoutFn,
    };
};

describe('futures testnet execution read request', () => {
    it('uses only fixed endpoints, exact signing, and zero redirect following', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response('{"serverTime":1783814400000}'))
            .mockResolvedValueOnce(response('{"canTrade":true}'));
        let clock = 1783814399900;
        const transport = createFuturesTestnetExecutionReadRequest({
            apiKey: 'key', apiSecret: 'secret', fetchImpl, wallNow: () => clock,
        });
        const signal = new AbortController().signal;
        await transport.request({
            origin, path: '/fapi/v1/time', method: 'GET', query: {}, signed: false,
            redirect: 'error', signal,
        });
        clock = 1783814400010;
        await transport.request({
            origin, path: '/fapi/v1/accountConfig', method: 'GET', query: {}, signed: true,
            redirect: 'error', signal,
        });
        const [url, options] = fetchImpl.mock.calls[1];
        const parsed = new URL(url);
        expect(parsed.origin).toBe(origin);
        expect(parsed.pathname).toBe('/fapi/v1/accountConfig');
        expect([...parsed.searchParams.keys()]).toEqual(['recvWindow', 'timestamp', 'signature']);
        const unsigned = `recvWindow=5000&timestamp=${parsed.searchParams.get('timestamp')}`;
        expect(parsed.searchParams.get('signature')).toBe(
            createHmac('sha256', 'secret').update(unsigned).digest('hex'),
        );
        expect(options).toMatchObject({
            method: 'GET', redirect: 'error', headers: { 'X-MBX-APIKEY': 'key' },
        });
    });

    it('preserves int64 order identities while requiring other integers to be safe', async () => {
        const transport = createFuturesTestnetExecutionReadRequest({
            apiKey: 'key',
            apiSecret: 'secret',
            fetchImpl: vi.fn().mockResolvedValue(response(
                '[{"symbol":"BTCUSDT","orderId":9223372036854775807,"updateTime":1783814400000}]',
            )),
            wallNow: () => 1783814400000,
        });
        await expect(transport.request({
            origin,
            path: '/fapi/v1/openOrders',
            method: 'GET',
            query: { symbol: 'BTCUSDT' },
            signed: true,
            redirect: 'error',
        })).resolves.toEqual([{
            symbol: 'BTCUSDT',
            orderId: '9223372036854775807',
            updateTime: 1783814400000,
        }]);
    });

    it('rejects caller-selected hosts, paths, query fields, and redirects before fetch', async () => {
        const fetchImpl = vi.fn();
        const transport = createFuturesTestnetExecutionReadRequest({
            apiKey: 'key', apiSecret: 'secret', fetchImpl, wallNow: () => 1,
        });
        for (const value of [
            { origin: 'https://example.invalid', path: '/fapi/v1/time', method: 'GET', query: {}, signed: false, redirect: 'error' },
            { origin, path: '/fapi/v1/order', method: 'GET', query: {}, signed: true, redirect: 'error' },
            { origin, path: '/fapi/v1/time', method: 'GET', query: { symbol: 'BTCUSDT' }, signed: false, redirect: 'error' },
            { origin, path: '/fapi/v1/time', method: 'GET', query: {}, signed: false, redirect: 'follow' },
        ]) {
            await expect(transport.request(value)).rejects.toMatchObject({
                name: 'FuturesTestnetExecutionReadRequestError',
            });
        }
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
        ['newline', 'credential\nvalue'],
        ['non-ASCII', 'credential-é'],
        ['space', 'credential value'],
        ['129 bytes', 'x'.repeat(129)],
    ])('rejects %s credentials before fetch', (_name, invalidCredential) => {
        const fetchImpl = vi.fn();
        for (const field of ['apiKey', 'apiSecret']) {
            const credentials = { apiKey: 'key', apiSecret: 'secret' };
            credentials[field] = invalidCredential;
            expect(() => createFuturesTestnetExecutionReadRequest({
                ...credentials,
                fetchImpl,
                wallNow: () => 1,
            })).toThrow(expect.objectContaining({
                name: 'FuturesTestnetExecutionReadRequestError',
                code: 'INVALID_CONFIG',
            }));
        }
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('owns the ten-second deadline when fetch never settles or observes AbortSignal', async () => {
        const deadline = createManualDeadline();
        let receivedSignal;
        const fetchImpl = vi.fn((_url, options) => {
            receivedSignal = options.signal;
            return new Promise(() => {});
        });
        const transport = createFuturesTestnetExecutionReadRequest({
            apiKey: 'key',
            apiSecret: 'secret',
            fetchImpl,
            wallNow: () => 1_000,
            setTimeoutFn: deadline.setTimeoutFn,
            clearTimeoutFn: deadline.clearTimeoutFn,
        });
        const pending = transport.request({
            origin,
            path: '/fapi/v1/time',
            method: 'GET',
            query: {},
            signed: false,
            redirect: 'error',
        });
        expect(fetchImpl).toHaveBeenCalledOnce();

        deadline.fire();

        await expect(pending).rejects.toMatchObject({
            name: 'FuturesTestnetExecutionReadRequestError',
            code: 'DEADLINE_OR_ABORT',
        });
        expect(receivedSignal.aborted).toBe(true);
        expect(deadline.clearTimeoutFn).toHaveBeenCalledWith(deadline.handle);
    });

    it('never accepts a valid response body that settles after its deadline', async () => {
        const deadline = createManualDeadline();
        let resolveBody;
        let bodyStarted;
        const started = new Promise((resolve) => { bodyStarted = resolve; });
        const body = new Promise((resolve) => { resolveBody = resolve; });
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: {},
            text: () => {
                bodyStarted();
                return body;
            },
        });
        const transport = createFuturesTestnetExecutionReadRequest({
            apiKey: 'key',
            apiSecret: 'secret',
            fetchImpl,
            wallNow: () => 1_000,
            setTimeoutFn: deadline.setTimeoutFn,
            clearTimeoutFn: deadline.clearTimeoutFn,
        });
        const pending = transport.request({
            origin,
            path: '/fapi/v1/time',
            method: 'GET',
            query: {},
            signed: false,
            redirect: 'error',
        });
        await started;

        deadline.fire();
        await expect(pending).rejects.toMatchObject({ code: 'DEADLINE_OR_ABORT' });
        resolveBody('{"serverTime":2000}');
        await Promise.resolve();
        await Promise.resolve();

        await expect(pending).rejects.toMatchObject({ code: 'DEADLINE_OR_ABORT' });
        expect(transport.adjustedNow()).toBe(1_000);
        expect(deadline.clearTimeoutFn).toHaveBeenCalledWith(deadline.handle);
    });

    it('expands body and node bounds only for the exact exchangeInfo endpoint', async () => {
        const body = makeRealisticExchangeInfoBody();
        const decoded = JSON.parse(body);
        expect(Buffer.byteLength(body, 'utf8'))
            .toBeGreaterThan(FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS.BODY_BYTES);
        expect(countJsonNodes(decoded))
            .toBeGreaterThan(FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS.JSON_NODES);
        expect(Buffer.byteLength(body, 'utf8'))
            .toBeLessThanOrEqual(FUTURES_TESTNET_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS.BODY_BYTES);
        expect(countJsonNodes(decoded))
            .toBeLessThanOrEqual(FUTURES_TESTNET_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS.JSON_NODES);

        const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(response(body)));
        const transport = createFuturesTestnetExecutionReadRequest({
            apiKey: 'key', apiSecret: 'secret', fetchImpl, wallNow: () => 1783814400000,
        });
        const exchangeInfo = await exchangeInfoRequest(transport);
        expect(exchangeInfo.symbols).toHaveLength(640);
        expect(exchangeInfo.symbols[639]).toMatchObject({
            symbol: 'T0639USDT',
            filters: expect.arrayContaining([
                expect.objectContaining({ filterType: 'PRICE_FILTER', tickSize: '0.001' }),
            ]),
        });

        await expect(transport.request({
            origin,
            path: '/fapi/v1/accountConfig',
            method: 'GET',
            query: {},
            signed: true,
            redirect: 'error',
        })).rejects.toMatchObject({
            name: 'FuturesTestnetExecutionReadRequestError',
            code: 'NETWORK_ERROR',
        });
    });

    it('rejects exchangeInfo above its exact body and node bounds without relaxing headers', async () => {
        const bodyOverflow = ' '.repeat(
            FUTURES_TESTNET_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS.BODY_BYTES + 1,
        );
        const nodeOverflow = `[0${',0'.repeat(
            FUTURES_TESTNET_EXECUTION_EXCHANGE_INFO_RESPONSE_LIMITS.JSON_NODES - 1,
        )}]`;
        const excessiveHeaders = Object.fromEntries(
            Array.from(
                { length: FUTURES_TESTNET_EXECUTION_RESPONSE_LIMITS.HEADER_COUNT + 1 },
                (_, index) => [`x-test-${index}`, 'bounded'],
            ),
        );
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response(bodyOverflow))
            .mockResolvedValueOnce(response(nodeOverflow))
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: excessiveHeaders,
                text: async () => '{}',
            });
        const transport = createFuturesTestnetExecutionReadRequest({
            apiKey: 'key', apiSecret: 'secret', fetchImpl, wallNow: () => 1783814400000,
        });

        await expect(exchangeInfoRequest(transport)).rejects.toMatchObject({
            name: 'FuturesTestnetExecutionReadRequestError',
            code: 'NETWORK_ERROR',
        });
        await expect(exchangeInfoRequest(transport)).rejects.toMatchObject({
            name: 'FuturesTestnetExecutionReadRequestError',
            code: 'MALFORMED_RESPONSE',
        });
        await expect(exchangeInfoRequest(transport)).rejects.toMatchObject({
            name: 'FuturesTestnetExecutionReadRequestError',
            code: 'NETWORK_ERROR',
        });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });
});
