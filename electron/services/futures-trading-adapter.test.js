// @vitest-environment node

import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FUTURES_REST_CONNECTION_POOL,
    FUTURES_REST_RESPONSE_MAX_BYTES,
    FUTURES_STREAM_ORIGIN,
    FuturesTradingAdapter,
    describeFuturesApiError,
    futuresUserDataStreamUrl,
    normalizeFuturesAlgoOrder,
    normalizeFuturesBalances,
    normalizeFuturesExecutionReport,
    normalizeFuturesHistoryOrder,
    normalizeFuturesHistoryTrade,
    normalizeFuturesIncomeRow,
    normalizeFuturesPositions,
    normalizeFuturesSymbolConfig,
    normalizeFuturesAccountUpdate,
    normalizeFuturesUserDataStreamEvent,
    FUTURES_USER_DATA_EVENTS_IGNORED,
    parseFuturesJson,
    parseFuturesExchangeFilters,
    parseFuturesUserStreamJson,
    readFuturesLeverageBracketTable,
    readFuturesMaxLeverage,
    readFuturesTradedSymbols,
    redactFuturesListenKey,
} from './futures-trading-adapter.js';
import { runWithBinancePhysicalAttemptContext } from './binance-physical-attempt-context.js';
import { RateLimiter } from './binance-connection.js';
import { walkFuturesSettledIncomeLanes } from './futures-settled-income-walk.js';

const requests = [];

const accountTrade = (overrides = {}) => ({
    id: '9',
    orderId: '2',
    symbol: 'BTCUSDT',
    side: 'SELL',
    positionSide: 'BOTH',
    price: '58500',
    qty: '0.004',
    quoteQty: '234',
    realizedPnl: '0',
    commission: '0',
    commissionAsset: null,
    marginAsset: 'USDT',
    maker: false,
    time: 7_000,
    ...overrides,
});

// Read per attempt, so a first attempt can fail on a connection the pool handed
// out and a second can be answered on one opened for it.
const perAttempt = (setting, attempt) => (
    typeof setting === 'function' ? setting(attempt) : setting
);

// The mock can answer with a status, refuse at the transport, time out, or fail
// after the answer has begun, so every outcome the retry rule turns on — and the
// three a mutating command must tell apart — are all reachable here.
vi.mock('node:https', () => ({
    default: {
        Agent: class MockHttpsAgent {
            constructor(options = {}) {
                this.options = options;
            }
        },
        request: (url, options, onResponse) => {
            const chunks = [];
            const listeners = {};
            const request = {
                reusedSocket: false,
                on: (event, handler) => {
                    listeners[event] = handler;
                    return request;
                },
                write: chunk => chunks.push(chunk),
                end: () => {
                    const attempt = requests.length;
                    const record = {
                        url: String(url),
                        options,
                        body: chunks.join(''),
                        at: Date.now(),
                    };
                    requests.push(record);
                    request.reusedSocket = perAttempt(
                        globalThis.__futuresTestReusedSocket,
                        attempt,
                    ) === true;
                    const transport = perAttempt(globalThis.__futuresTestTransport, attempt) ?? null;
                    if (transport === 'timeout') {
                        queueMicrotask(() => listeners.timeout?.());
                        return;
                    }
                    if (transport === 'in-flight') {
                        const abort = () => queueMicrotask(() => listeners.error?.(
                            Object.assign(new Error('The operation was aborted'), {
                                name: 'AbortError',
                                code: 'ABORT_ERR',
                            }),
                        ));
                        if (options.signal?.aborted) abort();
                        else options.signal?.addEventListener('abort', abort, { once: true });
                        return;
                    }
                    // The exchange has already said something and the connection
                    // then fails: it acted on the request, so nothing may send it
                    // again.
                    if (transport?.afterAnswerHasBegun) {
                        onResponse({
                            statusCode: perAttempt(globalThis.__futuresTestStatus, attempt) ?? 200,
                            headers: perAttempt(globalThis.__futuresTestHeaders, attempt) ?? {},
                            on: () => {},
                        });
                        queueMicrotask(() => listeners.error?.(transport.afterAnswerHasBegun));
                        return;
                    }
                    if (transport) {
                        queueMicrotask(() => listeners.error?.(transport));
                        return;
                    }
                    const handlers = {};
                    const response = {
                        statusCode: perAttempt(globalThis.__futuresTestStatus, attempt) ?? 200,
                        headers: perAttempt(globalThis.__futuresTestHeaders, attempt) ?? {},
                        on: (event, handler) => {
                            handlers[event] = handler;
                        },
                    };
                    onResponse(response);
                    queueMicrotask(() => {
                        const payload = record.respondWith
                            ?? perAttempt(globalThis.__futuresTestResponse, attempt)
                            ?? {};
                        const raw = globalThis.__futuresTestRawResponse;
                        const bodyChunks = Array.isArray(raw)
                            ? raw
                            : [typeof raw === 'string' || Buffer.isBuffer(raw)
                                ? raw
                                : JSON.stringify(payload)];
                        for (const bodyChunk of bodyChunks) {
                            handlers.data?.(Buffer.isBuffer(bodyChunk)
                                ? bodyChunk
                                : Buffer.from(bodyChunk));
                        }
                        handlers.end?.();
                    });
                },
                // Node emits `error` with the destroy reason, which is how the
                // timeout handler's own error reaches the caller.
                destroy: (error) => {
                    queueMicrotask(() => listeners.error?.(error));
                },
            };
            return request;
        },
    },
}));

const createAdapter = () => new FuturesTradingAdapter({
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    recvWindow: 60000,
});

afterEach(() => {
    requests.length = 0;
    delete globalThis.__futuresTestResponse;
    delete globalThis.__futuresTestRawResponse;
    delete globalThis.__futuresTestReusedSocket;
    delete globalThis.__futuresTestStatus;
    delete globalThis.__futuresTestHeaders;
    delete globalThis.__futuresTestTransport;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Futures REST physical response accounting', () => {
    const readWithObservations = async ({ status = 200, headers = {} } = {}) => {
        const observations = [];
        const admitted = [];
        globalThis.__futuresTestStatus = status;
        globalThis.__futuresTestHeaders = headers;
        globalThis.__futuresTestResponse = status >= 200 && status < 300
            ? []
            : { code: -1003, msg: 'Too many requests' };
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;

        const result = await runWithBinancePhysicalAttemptContext({
            admit: async weight => admitted.push(weight),
            observeResponse: observation => observations.push(observation),
        }, () => adapter.getTradeHistory({ symbol: 'BTCUSDT' })).catch(error => error);

        return { admitted, observations, result };
    };

    it('reports the highest authoritative used-weight header for reconciliation', async () => {
        const { admitted, observations, result } = await readWithObservations({
            headers: {
                'x-mbx-used-weight': '700',
                'x-mbx-used-weight-1m': ['719', '731'],
            },
        });

        expect(result).toEqual([]);
        expect(admitted).toHaveLength(1);
        expect(observations).toEqual([{ status: 200, usedWeight: 731 }]);
    });

    it('keeps a response without accounting headers observable without inventing weight', async () => {
        const { observations, result } = await readWithObservations();

        expect(result).toEqual([]);
        expect(observations).toEqual([{ status: 200 }]);
    });

    it('reports bounded Retry-After backpressure on a 429 response', async () => {
        const { observations, result } = await readWithObservations({
            status: 429,
            headers: {
                'retry-after': '2.5',
                'x-mbx-used-weight-1m': '2400',
            },
        });

        expect(result).toMatchObject({ name: 'FuturesApiError', status: 429 });
        expect(observations).toEqual([{
            status: 429,
            usedWeight: 2400,
            retryAfterMs: 2500,
        }]);
    });

    it('refuses an oversized declared response before retaining or parsing its body', async () => {
        const summaries = [];
        const limiter = new RateLimiter(100, 60_000, 0, {
            physicalAttempts: true,
            onOperation: summary => summaries.push(summary),
        });
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        const parseJson = vi.spyOn(JSON, 'parse');
        globalThis.__futuresTestHeaders = {
            'content-length': String(FUTURES_REST_RESPONSE_MAX_BYTES + 1),
        };
        globalThis.__futuresTestRawResponse = 'this body must never be parsed';

        const error = await limiter.execute(
            () => adapter.getTradeHistory({ symbol: 'BTCUSDT' }),
            5,
            0,
        ).catch(caught => caught);

        expect(error).toMatchObject({
            name: 'FuturesApiError',
            status: 200,
            code: 'RESPONSE_TOO_LARGE',
            indeterminate: false,
        });
        expect(requests).toHaveLength(1);
        expect(parseJson).not.toHaveBeenCalled();
        expect(summaries).toEqual([expect.objectContaining({
            attempts: 1,
            chargedWeight: 5,
            outcome: 'error',
            status: 200,
            code: 'RESPONSE_TOO_LARGE',
        })]);
    });

    it('stops a chunked mutation at the byte ceiling without parsing or replaying it', async () => {
        const summaries = [];
        const limiter = new RateLimiter(100, 60_000, 0, {
            physicalAttempts: true,
            onOperation: summary => summaries.push(summary),
        });
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        const parseJson = vi.spyOn(JSON, 'parse');
        globalThis.__futuresTestHeaders = { 'transfer-encoding': 'chunked' };
        globalThis.__futuresTestRawResponse = [
            Buffer.alloc(FUTURES_REST_RESPONSE_MAX_BYTES, 0x20),
            Buffer.from('x'),
        ];

        const error = await limiter.execute(() => adapter.adjustPositionMargin({
            symbol: 'BTCUSDT',
            positionSide: 'BOTH',
            direction: 'ADD',
            amount: '25',
        }), 5, 2).catch(caught => caught);

        expect(error).toMatchObject({
            name: 'FuturesApiError',
            status: 200,
            code: 'RESPONSE_TOO_LARGE',
            indeterminate: true,
        });
        expect(requests).toHaveLength(1);
        expect(requests[0].options.method).toBe('POST');
        expect(parseJson).not.toHaveBeenCalled();
        expect(summaries).toEqual([expect.objectContaining({
            attempts: 1,
            chargedWeight: 5,
            outcome: 'error',
            status: 200,
            code: 'RESPONSE_TOO_LARGE',
        })]);
    });

    it('aborts one admitted mutation in flight without refunding or retrying it', async () => {
        const summaries = [];
        const limiter = new RateLimiter(100, 60_000, 0, {
            physicalAttempts: true,
            onOperation: summary => summaries.push(summary),
        });
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        const controller = new AbortController();
        globalThis.__futuresTestTransport = 'in-flight';

        const pending = limiter.execute(() => adapter.adjustPositionMargin({
            symbol: 'BTCUSDT',
            positionSide: 'BOTH',
            direction: 'ADD',
            amount: '25',
        }), 5, 2, { signal: controller.signal });
        await vi.waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0].options.signal).toBe(controller.signal);
        expect(requests[0].options.method).toBe('POST');

        const rejection = expect(pending).rejects.toMatchObject({
            name: 'AbortError',
            code: 'ABORT_ERR',
        });
        controller.abort();
        await rejection;

        expect(requests).toHaveLength(1);
        expect(limiter.getCurrentWeight()).toBe(5);
        expect(summaries).toEqual([expect.objectContaining({
            attempts: 1,
            chargedWeight: 5,
            networkRetries: 0,
            outcome: 'aborted',
            code: 'ABORT_ERR',
        })]);
    });
});

describe('FuturesTradingAdapter signing', () => {
    it('signs order placement as an urlencoded body with HMAC-SHA256 and the API key header', async () => {
        globalThis.__futuresTestResponse = { serverTime: Date.now() };
        const adapter = createAdapter();
        adapter.getPositionMode = vi.fn().mockResolvedValue({ hedgeMode: false });
        await adapter.placeOrder({
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            numericQuantity: 0.01,
            numericPrice: 50000,
        });

        const orderRequest = requests.find(request => request.url.endsWith('/fapi/v1/order'));
        expect(orderRequest).toBeDefined();
        expect(orderRequest.options.method).toBe('POST');
        expect(orderRequest.options.headers['X-MBX-APIKEY']).toBe('test-key');
        expect(orderRequest.options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

        const body = orderRequest.body;
        const signature = new URLSearchParams(body).get('signature');
        const unsigned = body.slice(0, body.lastIndexOf('&signature='));
        expect(signature).toBe(
            createHmac('sha256', 'test-secret').update(unsigned).digest('hex'),
        );
        const params = new URLSearchParams(unsigned);
        expect(params.get('symbol')).toBe('BTCUSDT');
        expect(params.get('side')).toBe('BUY');
        expect(params.get('type')).toBe('LIMIT');
        expect(params.get('timeInForce')).toBe('GTC');
        expect(params.get('quantity')).toBe('0.01');
        expect(params.get('price')).toBe('50000');
        expect(params.get('positionSide')).toBe('BOTH');
        expect(params.get('recvWindow')).toBe('60000');
        expect(params.get('timestamp')).toMatch(/^\d+$/);
    });

    it('materializes each signed timestamp after admission through a -1021 recovery', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const summaries = [];
        const limiter = new RateLimiter(100, 60_000, 6_001, {
            physicalAttempts: true,
            onOperation: summary => summaries.push(summary),
        });
        const adapter = new FuturesTradingAdapter({
            apiKey: 'test-key',
            apiSecret: 'test-secret',
            recvWindow: 5_000,
        });
        globalThis.__futuresTestStatus = attempt => (attempt === 1 ? 400 : 200);
        globalThis.__futuresTestResponse = attempt => {
            if (attempt === 0 || attempt === 2) {
                return { serverTime: requests[attempt].at };
            }
            if (attempt === 1) {
                return { code: -1021, msg: 'Timestamp outside recvWindow' };
            }
            return { dualSidePosition: false };
        };

        const pending = limiter.execute(() => adapter.getPositionMode(), 30, 0);
        await vi.advanceTimersByTimeAsync(24_004);

        await expect(pending).resolves.toEqual({ hedgeMode: false });
        expect(requests.map(request => new URL(request.url).pathname)).toEqual([
            '/fapi/v1/time',
            '/fapi/v1/positionSide/dual',
            '/fapi/v1/time',
            '/fapi/v1/positionSide/dual',
        ]);
        const signedRequests = [requests[1], requests[3]];
        for (const request of signedRequests) {
            const query = new URL(request.url).search.slice(1);
            const unsigned = query.slice(0, query.lastIndexOf('&signature='));
            const params = new URLSearchParams(unsigned);
            expect(Number(params.get('timestamp'))).toBe(request.at);
            expect(Number(params.get('recvWindow'))).toBe(5_000);
            expect(new URLSearchParams(query).get('signature')).toBe(
                createHmac('sha256', 'test-secret').update(unsigned).digest('hex'),
            );
        }
        expect(signedRequests.map(request => request.at)).toEqual([12_002, 24_004]);
        expect(summaries).toEqual([
            expect.objectContaining({
                attempts: 4,
                chargedWeight: 62,
                timestampRetries: 1,
                outcome: 'ok',
            }),
        ]);
    });

    it('admits initial sync and -1021 recovery at their exact endpoint weights', async () => {
        const admitted = [];
        const retryCategories = [];
        const adapter = createAdapter();
        globalThis.__futuresTestStatus = attempt => (attempt === 1 ? 400 : 200);
        globalThis.__futuresTestResponse = attempt => {
            if (attempt === 0 || attempt === 2) return { serverTime: Date.now() };
            if (attempt === 1) {
                return { code: -1021, msg: 'Timestamp outside recvWindow' };
            }
            return { dualSidePosition: false };
        };

        await expect(runWithBinancePhysicalAttemptContext({
            admit: async weight => admitted.push(weight),
            noteRetry: category => retryCategories.push(category),
        }, () => adapter.getPositionMode())).resolves.toEqual({ hedgeMode: false });

        expect(requests.map(request => new URL(request.url).pathname)).toEqual([
            '/fapi/v1/time',
            '/fapi/v1/positionSide/dual',
            '/fapi/v1/time',
            '/fapi/v1/positionSide/dual',
        ]);
        expect(admitted).toEqual([1, 30, 1, 30]);
        expect(retryCategories).toEqual(['timestamp']);
    });

    it('amends a live order in place with a signed PUT instead of cancel and re-place', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        await adapter.modifyOrder({
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderId: 11,
            numericQuantity: 0.004,
            numericPrice: 58500,
        });

        expect(requests).toHaveLength(1);
        const [amendment] = requests;
        expect(amendment.options.method).toBe('PUT');
        expect(amendment.url.endsWith('/fapi/v1/order')).toBe(true);
        const params = new URLSearchParams(
            amendment.body.slice(0, amendment.body.lastIndexOf('&signature=')),
        );
        expect(params.get('symbol')).toBe('BTCUSDT');
        expect(params.get('side')).toBe('BUY');
        expect(params.get('orderId')).toBe('11');
        expect(params.get('quantity')).toBe('0.004');
        expect(params.get('price')).toBe('58500');
    });

    // A margin transfer is not an order: no side, no quantity, no notional —
    // only which position, which way, and how much.
    it('moves position margin with a signed POST and Binance own direction code', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = { amount: 250, code: 200, type: 1 };

        const added = await adapter.adjustPositionMargin({
            symbol: 'BTCUSDT', positionSide: 'LONG', direction: 'ADD', amount: '250',
        });
        expect(added).toEqual({
            symbol: 'BTCUSDT', positionSide: 'LONG', direction: 'ADD', amount: '250',
        });

        await adapter.adjustPositionMargin({
            symbol: 'BTCUSDT', positionSide: 'BOTH', direction: 'REMOVE', amount: '40',
        });

        const transfers = requests.filter(request => request.url.endsWith('/fapi/v1/positionMargin'));
        expect(transfers).toHaveLength(2);
        expect(transfers[0].options.method).toBe('POST');
        const [add, remove] = transfers.map(request => new URLSearchParams(
            request.body.slice(0, request.body.lastIndexOf('&signature=')),
        ));
        expect(add.get('symbol')).toBe('BTCUSDT');
        expect(add.get('positionSide')).toBe('LONG');
        expect(add.get('amount')).toBe('250');
        expect(add.get('type')).toBe('1');
        expect(add.get('quantity')).toBeNull();
        expect(remove.get('type')).toBe('2');
        expect(remove.get('amount')).toBe('40');
    });

    it('derives hedge-mode position sides from order intent', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        adapter.getPositionMode = vi.fn().mockResolvedValue({ hedgeMode: true });

        await adapter.placeOrder({
            symbol: 'BTCUSDT', side: 'BUY', orderType: 'MARKET', numericQuantity: 0.01,
        });
        await adapter.placeOrder({
            symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', numericQuantity: 0.01, reduceOnly: true,
        });

        const [entry, exit] = requests
            .filter(request => request.url.endsWith('/fapi/v1/order'))
            .map(request => new URLSearchParams(request.body));
        expect(entry.get('positionSide')).toBe('LONG');
        expect(entry.get('reduceOnly')).toBeNull();
        // Selling to reduce closes the LONG leg; hedge mode forbids reduceOnly.
        expect(exit.get('positionSide')).toBe('LONG');
        expect(exit.get('reduceOnly')).toBeNull();
    });

    it('keeps reduceOnly for one-way accounts', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        adapter.getPositionMode = vi.fn().mockResolvedValue({ hedgeMode: false });

        await adapter.placeOrder({
            symbol: 'BTCUSDT', side: 'SELL', orderType: 'MARKET', numericQuantity: 0.01, reduceOnly: true,
        });

        const params = new URLSearchParams(requests.at(-1).body);
        expect(params.get('positionSide')).toBe('BOTH');
        expect(params.get('reduceOnly')).toBe('true');
    });

    it('closes an explicit hedge leg from its identity rather than a forged quantity sign', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        adapter.getPositionMode = vi.fn().mockResolvedValue({ hedgeMode: true });

        // Quantity is an unsigned close amount at this boundary. Deliberately
        // give each leg the misleading sign to prove it cannot reverse the side.
        await adapter.closePosition({
            symbol: 'BTCUSDT', positionSide: 'LONG', quantity: '-0.4',
        });
        await adapter.closePosition({
            symbol: 'ETHUSDT', positionSide: 'short', quantity: '0.3',
        });

        const [longClose, shortClose] = requests
            .filter(request => request.url.endsWith('/fapi/v1/order'))
            .map(request => new URLSearchParams(request.body));
        expect(longClose.get('side')).toBe('SELL');
        expect(longClose.get('positionSide')).toBe('LONG');
        expect(longClose.get('quantity')).toBe('0.4');
        expect(shortClose.get('side')).toBe('BUY');
        expect(shortClose.get('positionSide')).toBe('SHORT');
        expect(shortClose.get('quantity')).toBe('0.3');
        // Hedge mode scopes the close by leg and forbids reduceOnly itself.
        expect(longClose.get('reduceOnly')).toBeNull();
        expect(shortClose.get('reduceOnly')).toBeNull();
    });

    // Two books, two cancellations: `/fapi/v1/allOpenOrders` does not touch the
    // conditional one.
    it('cancels each open-order book on its own route', async () => {
        globalThis.__futuresTestResponse = {};
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;

        await adapter.cancelAllOrders('BTCUSDT');
        await adapter.cancelAllAlgoOrders('BTCUSDT');

        const regular = new URL(requests.at(-2).url);
        const algo = new URL(requests.at(-1).url);
        expect(requests.at(-2).options.method).toBe('DELETE');
        expect(requests.at(-1).options.method).toBe('DELETE');
        expect(regular.pathname).toBe('/fapi/v1/allOpenOrders');
        expect(algo.pathname).toBe('/fapi/v1/algoOpenOrders');
        expect(algo.searchParams.get('symbol')).toBe('BTCUSDT');
        expect(algo.searchParams.has('signature')).toBe(true);
    });

    it('reads regular and ALGO orders account-wide with all-symbol weights', async () => {
        globalThis.__futuresTestResponse = [];
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        const operations = adapter.getAccountRefreshOperations();

        expect(operations.map(({ type, weight }) => ({ type, weight }))).toEqual([
            { type: 'balances', weight: 5 },
            { type: 'regularOrders', weight: 40 },
            { type: 'algoOrders', weight: 40 },
            { type: 'positions', weight: 5 },
        ]);

        await operations.find(operation => operation.type === 'regularOrders').loadPayload();
        await operations.find(operation => operation.type === 'algoOrders').loadPayload();

        const regularUrl = new URL(requests.at(-2).url);
        const algoUrl = new URL(requests.at(-1).url);
        expect(regularUrl.pathname).toBe('/fapi/v1/openOrders');
        expect(algoUrl.pathname).toBe('/fapi/v1/openAlgoOrders');
        expect(regularUrl.searchParams.has('symbol')).toBe(false);
        expect(algoUrl.searchParams.has('symbol')).toBe(false);
        expect(regularUrl.searchParams.has('signature')).toBe(true);
        expect(algoUrl.searchParams.has('signature')).toBe(true);
    });
});

describe('futures execution outcome classification', () => {
    // Binance is explicit that a 503 "Unknown error" may have succeeded. Showing
    // it as a plain failure is what makes an operator resubmit a live order.
    it('marks an exchange-side 5xx as indeterminate', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestStatus = 503;
        globalThis.__futuresTestResponse = { code: -1000, msg: 'Unknown error' };

        const error = await adapter.placeOrder({
            symbol: 'BTCUSDT', side: 'BUY', orderType: 'LIMIT', numericQuantity: 1, numericPrice: 10,
            positionSide: 'BOTH',
        }).catch(caught => caught);

        expect(error.name).toBe('FuturesApiError');
        expect(error.status).toBe(503);
        expect(error.indeterminate).toBe(true);
    });

    it('marks a request timeout as indeterminate', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestTransport = 'timeout';

        const error = await adapter.placeOrder({
            symbol: 'BTCUSDT', side: 'BUY', orderType: 'LIMIT', numericQuantity: 1, numericPrice: 10,
            positionSide: 'BOTH',
        }).catch(caught => caught);

        expect(error.code).toBe('ETIMEDOUT');
        expect(error.indeterminate).toBe(true);
    });

    it('keeps a business rejection determinate', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestStatus = 400;
        globalThis.__futuresTestResponse = { code: -2019, msg: 'Margin is insufficient.' };

        const error = await adapter.placeOrder({
            symbol: 'BTCUSDT', side: 'BUY', orderType: 'LIMIT', numericQuantity: 1, numericPrice: 10,
            positionSide: 'BOTH',
        }).catch(caught => caught);

        expect(error.code).toBe(-2019);
        expect(error.indeterminate).toBe(false);
    });

    it('keeps a connection that never opened determinate', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestTransport = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });

        const error = await adapter.placeOrder({
            symbol: 'BTCUSDT', side: 'BUY', orderType: 'LIMIT', numericQuantity: 1, numericPrice: 10,
            positionSide: 'BOTH',
        }).catch(caught => caught);

        expect(error.code).toBe('ECONNREFUSED');
        expect(error.indeterminate).toBe(false);
    });
});

describe('futures order lookup by identity', () => {
    it('reports an order that exists under the command identity', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = {
            orderId: 42, symbol: 'BTCUSDT', side: 'BUY', status: 'NEW', clientOrderId: 'f-1',
        };

        const outcome = await adapter.findOrder({ symbol: 'BTCUSDT', origClientOrderId: 'f-1' });

        expect(new URL(requests[0].url).pathname).toBe('/fapi/v1/order');
        expect(new URL(requests[0].url).searchParams.get('origClientOrderId')).toBe('f-1');
        expect(outcome.exists).toBe(true);
        expect(outcome.report.orderId).toBe('42');
    });

    it('reports the one answer that makes a resubmission safe', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestStatus = 400;
        globalThis.__futuresTestResponse = { code: -2013, msg: 'Order does not exist.' };

        await expect(adapter.findOrder({ symbol: 'BTCUSDT', origClientOrderId: 'f-1' }))
            .resolves.toEqual({ exists: false, report: null });
    });

    it('does not turn an unrelated failure into "no such order"', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestStatus = 503;
        globalThis.__futuresTestResponse = { code: -1000, msg: 'Unknown error' };

        await expect(adapter.findOrder({ symbol: 'BTCUSDT', origClientOrderId: 'f-1' }))
            .rejects.toMatchObject({ status: 503 });
    });
});

describe('futures history reads', () => {
    it('requests bounded, signed order and trade history and returns newest first', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [
            { orderId: 1, symbol: 'BTCUSDT', side: 'BUY', status: 'FILLED', updateTime: 1_000 },
            { orderId: 2, symbol: 'BTCUSDT', side: 'SELL', status: 'CANCELED', updateTime: 5_000 },
        ];
        const orders = await adapter.getOrderHistory({ symbol: 'BTCUSDT', limit: 5000 });

        const [request] = requests;
        expect(request.options.method).toBe('GET');
        expect(request.url).toContain('/fapi/v1/allOrders');
        const params = new URLSearchParams(request.url.split('?')[1]);
        expect(params.get('symbol')).toBe('BTCUSDT');
        expect(params.get('limit')).toBe('500');
        expect(params.get('signature')).toMatch(/^[0-9a-f]{64}$/);
        expect(orders.map(order => order.orderId)).toEqual(['2', '1']);
    });

    // Reading the gap rather than the week: the exchange pages both endpoints
    // from an identity, and the desk holds the identity each contract is covered
    // up to.
    it('reads forward from the identity it already holds', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [];
        await adapter.getOrderHistory({ symbol: 'BTCUSDT', fromOrderId: '9223372036854775806' });
        await adapter.getTradeHistory({ symbol: 'BTCUSDT', fromTradeId: 4_311 });

        const orderParams = new URLSearchParams(requests[0].url.split('?')[1]);
        const tradeParams = new URLSearchParams(requests[1].url.split('?')[1]);
        // Carried as digits: an identity past what a double can count, rounded
        // into the query, asks for a row that does not exist.
        expect(orderParams.get('orderId')).toBe('9223372036854775806');
        expect(tradeParams.get('fromId')).toBe('4311');
    });

    it('never combines an identity cursor with account-trade time bounds', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [];

        await adapter.getTradeHistory({
            symbol: 'BTCUSDT',
            fromTradeId: '9223372036854775807',
            startTime: 1_000,
            endTime: 9_000,
        });
        await adapter.getTradeHistory({
            symbol: 'BTCUSDT',
            fromTradeId: 'not-an-identity',
            startTime: 1_000,
            endTime: 9_000,
        });

        const cursor = new URLSearchParams(requests[0].url.split('?')[1]);
        expect(cursor.get('fromId')).toBe('9223372036854775807');
        expect(cursor.has('startTime')).toBe(false);
        expect(cursor.has('endTime')).toBe(false);
        const bounded = new URLSearchParams(requests[1].url.split('?')[1]);
        expect(bounded.has('fromId')).toBe(false);
        expect(bounded.get('startTime')).toBe('1000');
        expect(bounded.get('endTime')).toBe('9000');
    });

    it('omits absent optional trade times and rejects malformed bounds before REST', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [];

        for (const value of [undefined, null, '', '   ']) {
            await adapter.getTradeHistory({
                symbol: 'BTCUSDT',
                startTime: value,
                endTime: value,
            });
        }
        for (const request of requests) {
            const params = new URLSearchParams(request.url.split('?')[1]);
            expect(params.has('startTime')).toBe(false);
            expect(params.has('endTime')).toBe(false);
        }

        const requestsBeforeFailures = requests.length;
        for (const bounds of [
            { startTime: false },
            { startTime: {} },
            { startTime: -1 },
            { startTime: 1.5 },
            { startTime: Number.MAX_SAFE_INTEGER + 1 },
            { startTime: ' '.repeat(17) },
            { startTime: '12345678901234567' },
            { startTime: 10, endTime: 9 },
        ]) {
            await expect(adapter.getTradeHistory({ symbol: 'BTCUSDT', ...bounds }))
                .rejects.toMatchObject({
                    code: bounds.endTime === 9
                        ? 'INVALID_TRADE_TIME_WINDOW'
                        : 'INVALID_TRADE_TIME_BOUND',
                });
        }
        expect(requests).toHaveLength(requestsBeforeFailures);
    });

    it('reads the newest page when it holds no identity to read from', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [];
        await adapter.getOrderHistory({ symbol: 'BTCUSDT' });
        await adapter.getTradeHistory({ symbol: 'BTCUSDT', fromTradeId: 'not-an-identity' });

        expect(requests[0].url).not.toContain('orderId=');
        expect(requests[1].url).not.toContain('fromId=');
    });

    it('carries the realized PnL and fee of every trade', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [
            {
                id: 9, orderId: 2, symbol: 'BTCUSDT', side: 'SELL', positionSide: 'BOTH',
                price: '58500', qty: '0.004',
                realizedPnl: '-96.74', commission: '0.0234', commissionAsset: 'USDT',
                marginAsset: 'usdt', time: 7_000,
            },
        ];
        const trades = await adapter.getTradeHistory({ symbol: 'BTCUSDT' });
        expect(requests[0].url).toContain('/fapi/v1/userTrades');
        expect(trades).toEqual([expect.objectContaining({
            id: '9',
            realizedPnl: '-96.74',
            commission: '0.0234',
            commissionAsset: 'USDT',
            marginAsset: 'USDT',
            time: 7_000,
        })]);
    });

    it.each([
        ['non-exact trade id', { id: '9e1' }, 'INVALID_TRADE_IDENTITY'],
        ['oversized order id', { orderId: '9'.repeat(21) }, 'INVALID_TRADE_IDENTITY'],
        ['foreign symbol', { symbol: 'ETHUSDT' }, 'FOREIGN_TRADE_SYMBOL'],
        ['invalid side', { side: 'HOLD' }, 'INVALID_TRADE_EVIDENCE'],
        ['invalid position side', { positionSide: 'OPEN' }, 'INVALID_TRADE_EVIDENCE'],
        ['missing price', { price: null }, 'INVALID_TRADE_EVIDENCE'],
        [
            'missing endpoint qty hidden by an auxiliary quantity',
            { qty: null, quantity: '0.004' },
            'INVALID_TRADE_EVIDENCE',
        ],
        ['scientific quantity', { qty: '4e-3' }, 'INVALID_TRADE_EVIDENCE'],
        ['numeric realized PnL', { realizedPnl: 10 }, 'INVALID_TRADE_EVIDENCE'],
        ['negative commission', { commission: '-0.1' }, 'INVALID_TRADE_EVIDENCE'],
        ['missing settlement asset', { marginAsset: null }, 'INVALID_TRADE_EVIDENCE'],
        [
            'missing nonzero-commission asset',
            { commission: '0.1', commissionAsset: null },
            'INVALID_TRADE_EVIDENCE',
        ],
        ['malformed present zero-commission asset', { commissionAsset: '' }, 'INVALID_TRADE_EVIDENCE'],
        ['missing time', { time: null }, 'INVALID_TRADE_TIME'],
    ])('rejects a whole user-trade page with %s', async (_case, malformed, code) => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [
            accountTrade({ id: '8', orderId: '1' }),
            accountTrade(malformed),
        ];

        await expect(adapter.getTradeHistory({
            symbol: 'BTCUSDT',
            startTime: 1_000,
            endTime: 9_000,
        })).rejects.toMatchObject({ code });
        expect(requests).toHaveLength(1);
    });

    it('accepts exact zero commission without an asset and enforces the requested page size', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [accountTrade({
            commission: '0.00000000',
            commissionAsset: null,
        })];
        await expect(adapter.getTradeHistory({ symbol: 'BTCUSDT', limit: 1 }))
            .resolves.toEqual([expect.objectContaining({ commissionAsset: null })]);

        globalThis.__futuresTestResponse = [
            accountTrade({ id: '10', orderId: '10' }),
            accountTrade({ id: '11', orderId: '11' }),
        ];
        await expect(adapter.getTradeHistory({ symbol: 'BTCUSDT', limit: 1 }))
            .rejects.toMatchObject({ code: 'INVALID_TRADE_PAGE_SIZE' });
    });

    it('projects history rows to display fields only', () => {
        expect(normalizeFuturesHistoryOrder({
            orderId: 3, symbol: 'BTCUSDT', side: 'BUY', origType: 'LIMIT', status: 'FILLED',
            price: '58000', avgPrice: '57999.9', origQty: '0.004', executedQty: '0.004',
            cumQuote: '232', reduceOnly: true, updateTime: 4_000, secret: 'never',
        })).toEqual({
            orderId: '3',
            clientOrderId: null,
            symbol: 'BTCUSDT',
            side: 'BUY',
            positionSide: 'BOTH',
            type: 'LIMIT',
            status: 'FILLED',
            price: '58000',
            averagePrice: '57999.9',
            origQty: '0.004',
            executedQty: '0.004',
            quoteQty: '232',
            reduceOnly: true,
            time: 4_000,
        });
        expect(normalizeFuturesHistoryTrade({})).toMatchObject({
            price: null,
            quantity: null,
            quoteQty: null,
            realizedPnl: null,
            commission: null,
            marginAsset: null,
            time: null,
        });
    });

    it('preserves the settlement asset reported by account trades', () => {
        expect(normalizeFuturesHistoryTrade({
            symbol: 'BTCUSDC',
            marginAsset: ' usdc ',
        })).toMatchObject({
            symbol: 'BTCUSDC',
            marginAsset: 'USDC',
        });
        expect(normalizeFuturesHistoryTrade({ marginAsset: '  ' }).marginAsset).toBeNull();
    });

    it('keeps absent trade times missing and bounds a huge money field before scanning it', () => {
        for (const time of [undefined, null, '', ' ', false, []]) {
            expect(normalizeFuturesHistoryTrade({ time }).time).toBeNull();
        }
        const huge = '9'.repeat(1_000_000);
        const startedAt = performance.now();
        expect(normalizeFuturesHistoryTrade({ price: huge }).price).toBeNull();
        expect(performance.now() - startedAt).toBeLessThan(100);
    });

    it('keeps string exchange identities exact and rejects numeric trade identities', () => {
        expect(normalizeFuturesHistoryOrder({ orderId: 42 }).orderId).toBe('42');
        expect(normalizeFuturesHistoryOrder({ orderId: '9223372036854775807' }).orderId)
            .toBe('9223372036854775807');
        expect(normalizeFuturesHistoryOrder({ orderId: Number.MAX_SAFE_INTEGER + 1 }).orderId)
            .toBeNull();
        expect(normalizeFuturesHistoryTrade({ id: 9, orderId: 42 })).toMatchObject({
            id: null, orderId: null,
        });
    });

    it('preserves numeric identifier tokens above 2^53 through REST and exported parsers', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestRawResponse = '[{"id":9223372036854775807,'
            + '"orderId":9223372036854775806,"symbol":"BTCUSDT",'
            + '"side":"BUY","positionSide":"BOTH","price":"100",'
            + '"qty":"1","realizedPnl":"0","commission":"0",'
            + '"marginAsset":"USDT","time":7000}]';

        const [fromRest] = await adapter.getTradeHistory({ symbol: 'BTCUSDT' });
        expect(fromRest).toMatchObject({
            id: '9223372036854775807',
            orderId: '9223372036854775806',
        });
        expect(parseFuturesJson(
            '{"id":9223372036854775807,"orderId":9223372036854775806,"time":7000}',
        )).toMatchObject({
            id: '9223372036854775807',
            orderId: '9223372036854775806',
            time: 7_000,
        });
        expect(parseFuturesUserStreamJson(
            '{"e":"ORDER_TRADE_UPDATE","E":7000,'
                + '"o":{"i":9223372036854775807,"t":9223372036854775806,'
                + '"aid":9223372036854775805,"ai":9223372036854775804,'
                + '"q":"1.25","T":6999}}',
        )).toMatchObject({
            E: 7_000,
            o: {
                i: '9223372036854775807',
                t: '9223372036854775806',
                aid: '9223372036854775805',
                ai: '9223372036854775804',
                q: '1.25',
                T: 6_999,
            },
        });
        expect(normalizeFuturesHistoryTrade({
            id: Number.MAX_SAFE_INTEGER + 1,
            orderId: Number.MAX_SAFE_INTEGER + 2,
        })).toMatchObject({ id: null, orderId: null });
    });
});

describe('futures contract configuration', () => {
    // /fapi/v3/positionRisk reports neither leverage nor margin mode any more, so
    // both are read from the endpoint Binance moved them to.
    it('reads the leverage and margin mode of one contract', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [
            { symbol: 'ETHUSDT', marginType: 'CROSSED', leverage: 10, maxNotionalValue: '1000000' },
            { symbol: 'BTCUSDT', marginType: 'ISOLATED', leverage: 20, maxNotionalValue: '5000000' },
        ];
        const config = await adapter.getSymbolConfig('BTCUSDT');
        const params = new URLSearchParams(requests[0].url.split('?')[1]);
        expect(requests[0].url).toContain('/fapi/v1/symbolConfig');
        expect(params.get('symbol')).toBe('BTCUSDT');
        expect(params.get('signature')).toMatch(/^[0-9a-f]{64}$/);
        // The right contract out of the reply, not the first one in it.
        expect(config).toEqual({
            symbol: 'BTCUSDT',
            leverage: 20,
            marginType: 'ISOLATED',
            maxNotionalValue: '5000000',
        });
    });

    it('reports a leverage the exchange did not state as absent rather than as 1×', () => {
        expect(normalizeFuturesSymbolConfig({ symbol: 'BTCUSDT', leverage: '0' }).leverage).toBeNull();
        expect(normalizeFuturesSymbolConfig({ symbol: 'BTCUSDT' }).leverage).toBeNull();
        expect(normalizeFuturesSymbolConfig({ leverage: 20 })).toBeNull();
    });

    // Bracket 1 is the lowest notional band and carries the highest multiple: that
    // is the ceiling the exchange refuses a higher setting against.
    it('takes the ceiling from the contract’s own leverage bracket', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [{
            symbol: 'BTCUSDT',
            brackets: [
                { bracket: 2, initialLeverage: 50, notionalCap: 500000 },
                { bracket: 1, initialLeverage: 125, notionalCap: 50000 },
            ],
        }];
        await expect(adapter.getMaxLeverage('BTCUSDT')).resolves.toBe(125);
        expect(requests[0].url).toContain('/fapi/v1/leverageBracket');
        expect(readFuturesMaxLeverage([])).toBeNull();
        expect(readFuturesMaxLeverage({ brackets: [{ initialLeverage: '0' }] })).toBeNull();
    });

    it('keeps every maintenance band from the same leverage-bracket answer', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [{
            symbol: 'BTCUSDT',
            brackets: [
                {
                    bracket: 2,
                    initialLeverage: 50,
                    notionalFloor: '50000',
                    notionalCap: '500000',
                    maintMarginRatio: '0.01',
                    cum: '250',
                },
                {
                    bracket: 1,
                    initialLeverage: 125,
                    notionalFloor: '0',
                    notionalCap: '50000',
                    maintMarginRatio: '0.005',
                    cum: '0',
                },
            ],
        }];

        const table = await adapter.getLeverageBracketTable('BTCUSDT');
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toContain('/fapi/v1/leverageBracket');
        expect(table).toEqual({
            symbol: 'BTCUSDT',
            maxLeverage: 125,
            brackets: [
                {
                    initialLeverage: 125,
                    notionalFloor: '0',
                    notionalCap: '50000',
                    maintMarginRatio: '0.005',
                    cum: '0',
                },
                {
                    initialLeverage: 50,
                    notionalFloor: '50000',
                    notionalCap: '500000',
                    maintMarginRatio: '0.01',
                    cum: '250',
                },
            ],
        });
        expect(Object.isFrozen(table)).toBe(true);
        expect(Object.isFrozen(table.brackets)).toBe(true);
        expect(readFuturesLeverageBracketTable(globalThis.__futuresTestResponse, 'ETHUSDT'))
            .toBeNull();
    });

    it('keeps the ceiling but marks adjusted or partial bracket tables unavailable to estimates', () => {
        const complete = {
            symbol: 'BTCUSDT',
            notionalCoef: '1.5',
            brackets: [{
                initialLeverage: 125,
                notionalFloor: '0',
                notionalCap: '50000',
                maintMarginRatio: '0.005',
                cum: '0',
            }],
        };
        expect(readFuturesLeverageBracketTable(complete, 'BTCUSDT')).toMatchObject({
            symbol: 'BTCUSDT',
            maxLeverage: 125,
            notionalCoef: '1.5',
            marginEstimatesAvailable: false,
        });

        const partial = readFuturesLeverageBracketTable({
            ...complete,
            notionalCoef: undefined,
            brackets: [complete.brackets[0], { initialLeverage: 50 }],
        }, 'BTCUSDT');
        expect(partial).toMatchObject({
            symbol: 'BTCUSDT',
            maxLeverage: 125,
            marginEstimatesAvailable: false,
        });
        expect(partial.brackets).toHaveLength(1);
    });

    it('reports the leverage the exchange applied, not the one that was asked for', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = { symbol: 'BTCUSDT', leverage: 20, maxNotionalValue: '5000000' };
        const applied = await adapter.setLeverage({ symbol: 'BTCUSDT', leverage: 50 });
        const request = requests.find(entry => entry.url.endsWith('/fapi/v1/leverage'));
        expect(request.options.method).toBe('POST');
        const params = new URLSearchParams(request.body);
        expect(params.get('symbol')).toBe('BTCUSDT');
        expect(params.get('leverage')).toBe('50');
        expect(applied).toMatchObject({ symbol: 'BTCUSDT', leverage: 20 });
    });

    it('sends the margin mode as the exchange spells it', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = { code: 200, msg: 'success' };
        await adapter.setMarginType({ symbol: 'EPICUSDT', marginType: 'isolated' });
        const request = requests.find(entry => entry.url.endsWith('/fapi/v1/marginType'));
        expect(request.options.method).toBe('POST');
        const params = new URLSearchParams(request.body);
        expect(params.get('symbol')).toBe('EPICUSDT');
        expect(params.get('marginType')).toBe('ISOLATED');
    });

    // Every USDⓈ-M history endpoint takes a symbol, so reviewing a whole session
    // has to start by asking which contracts it was traded on.
    it('discovers the contracts traded in a window, newest first', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [
            { symbol: 'BICOUSDT', incomeType: 'REALIZED_PNL', income: '78', time: 2_000 },
            { symbol: 'BTCUSDT', incomeType: 'REALIZED_PNL', income: '-96', time: 9_000 },
            { symbol: 'bicousdt', incomeType: 'REALIZED_PNL', income: '4', time: 1_000 },
            { incomeType: 'FUNDING_FEE', income: '-0.1', time: 3_000 },
        ];
        const page = await adapter.getTradedSymbolPage({ startTime: 1_000, limit: 5_000 });
        const params = new URLSearchParams(requests[0].url.split('?')[1]);
        expect(requests[0].url).toContain('/fapi/v1/income');
        expect(params.get('incomeType')).toBe('REALIZED_PNL');
        expect(params.get('startTime')).toBe('1000');
        expect(params.get('page')).toBe('1');
        expect(params.get('limit')).toBe('1000');
        expect(page.symbols).toEqual(['BTCUSDT', 'BICOUSDT']);
        expect(readFuturesTradedSymbols(null)).toEqual([]);
    });

    // Settled money is read with no `incomeType` at all. Binance's own note on
    // the endpoint — "if incomeType is not sent, all kinds of flow will be
    // returned" — is what makes one weight-30 read answer for realized PnL,
    // funding, commission, insurance clearance and the rebates together. Naming
    // them would have cost one read each, and the query is therefore the thing
    // this asserts, not only the shape of the reply.
    it('reads every kind of flow in one request, for every contract', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [
            {
                symbol: 'BEATUSDT', incomeType: 'REALIZED_PNL', income: '120.5',
                asset: 'USDT', time: 2_000, tranId: 77, tradeId: '4001',
            },
            {
                symbol: 'BEATUSDT', incomeType: 'COMMISSION', income: '-4.2',
                asset: 'USDT', time: 2_000, tranId: 77, tradeId: '4001',
            },
            {
                symbol: 'BEATUSDT', incomeType: 'FUNDING_FEE', income: '-7.1',
                asset: 'USDT', time: 2_500, tranId: 78,
            },
        ];
        const page = await adapter.getIncomePage({ startTime: 1_000, endTime: 9_000 });
        const params = new URLSearchParams(requests[0].url.split('?')[1]);
        expect(requests[0].url).toContain('/fapi/v1/income');
        expect(params.has('incomeType')).toBe(false);
        // No symbol either: a desk holding five positions pays for one read.
        expect(params.has('symbol')).toBe(false);
        expect(params.get('startTime')).toBe('1000');
        expect(params.get('endTime')).toBe('9000');
        expect(params.get('page')).toBe('1');
        expect(params.get('limit')).toBe('1000');
        expect(page.full).toBe(false);
        // The sign is the exchange's and is carried through untouched: an
        // outflow is already negative here, and normalizing it to a magnitude
        // would leave a fold no way to tell a charge from a credit.
        expect(page.rows[1]).toMatchObject({
            symbol: 'BEATUSDT',
            incomeType: 'COMMISSION',
            income: '-4.2',
            asset: 'USDT',
            tranId: '77',
            tradeId: '4001',
        });
        // Funding is not a trade, so it names none. The absence is what decides
        // whether a row can be attributed to a position leg at all.
        expect(page.rows[2].tradeId).toBeNull();
    });

    it('rejects an over-requested income page before reading or normalizing a row', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        let rowReads = 0;
        const unreadableRow = {};
        Object.defineProperty(unreadableRow, 'symbol', {
            enumerable: true,
            get: () => {
                rowReads += 1;
                throw new Error('row normalization must not run');
            },
        });
        vi.spyOn(JSON, 'parse').mockReturnValue([unreadableRow, unreadableRow]);
        globalThis.__futuresTestRawResponse = '[]';

        await expect(adapter.getIncomePage({
            startTime: 1_000,
            endTime: 9_000,
            incomeType: 'FUNDING_FEE',
            limit: 1,
        })).rejects.toMatchObject({ code: 'OVERSIZED_INCOME_PAGE' });

        expect(requests).toHaveLength(1);
        expect(new URL(requests[0].url).searchParams.get('limit')).toBe('1');
        expect(rowReads).toBe(0);
    });

    it('preserves missing income amount and time as invalid evidence', () => {
        expect(normalizeFuturesIncomeRow({
            symbol: 'BTCUSDT',
            incomeType: 'FUNDING_FEE',
            asset: 'USDT',
        })).toMatchObject({
            income: null,
            time: null,
        });
        expect(normalizeFuturesIncomeRow({ income: 0, time: 0 })).toMatchObject({
            income: '0',
            time: 0,
        });
        for (const time of [undefined, null, '', ' ', false, []]) {
            expect(normalizeFuturesIncomeRow({ time }).time).toBeNull();
        }
    });

    it.each([
        ['padded symbol', { symbol: ' BTCUSDT' }],
        ['lowercase symbol', { symbol: 'btcusdt' }],
        ['Unicode-foldable symbol', { symbol: 'BTCU\u017FDT' }],
        ['padded income type', { incomeType: ' FUNDING_FEE' }],
        ['lowercase income type', { incomeType: 'funding_fee' }],
        ['Unicode-foldable income type', { incomeType: '\u0131NSURANCE_CLEAR' }],
        ['padded asset', { asset: ' USDT' }],
        ['lowercase asset', { asset: 'usdt' }],
        ['Unicode-foldable asset', { asset: 'U\u017FDT' }],
        ['malformed transaction identity', { tranId: 'not-an-integer' }],
        ['malformed trade identity', { tradeId: '42.5' }],
    ])('preserves a %s until the canonical lane rejects the page', async (_label, override) => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        const raw = {
            symbol: 'BTCUSDT',
            incomeType: 'FUNDING_FEE',
            income: '-1.25',
            asset: 'USDT',
            time: 2_000,
            tranId: '700000000000000001',
            tradeId: null,
            ...override,
        };
        globalThis.__futuresTestResponse = [raw];

        const page = await adapter.getIncomePage({
            startTime: 1_000,
            endTime: 9_000,
            incomeType: 'FUNDING_FEE',
        });
        const [field, token] = Object.entries(override)[0];
        expect(page.rows[0][field]).toBe(token);

        const walked = await walkFuturesSettledIncomeLanes({
            readPage: async () => page,
            now: 9_000,
            windowFrom: 1_000,
            incomeTypes: ['FUNDING_FEE'],
        });
        expect(walked.failed).toBe(true);
        expect(walked.resource.lanes.FUNDING_FEE).toMatchObject({
            status: 'error',
            complete: false,
            error: { code: 'INVALID_INCOME_ROW' },
        });
    });

    it('rejects a non-array income endpoint answer before it can look empty', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = { rows: [] };

        await expect(adapter.getIncomePage({
            startTime: 1_000,
            endTime: 9_000,
            incomeType: 'FUNDING_FEE',
        })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    // The endpoint answers a start time with the *oldest* rows after it, so a page
    // that comes back full is a page with newer rows behind it. The numbered page
    // keeps the timestamp boundary inclusive while the caller walks forward.
    it('reports a full income page and sends the selected page number', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [
            { symbol: 'BICOUSDT', incomeType: 'REALIZED_PNL', income: '78', time: 2_000 },
            { symbol: 'BTCUSDT', incomeType: 'REALIZED_PNL', income: '-96', time: 9_000 },
        ];
        expect(await adapter.getTradedSymbolPage({ startTime: 1_000, limit: 2 }))
            .toMatchObject({ full: true, lastTime: 9_000 });
        expect(await adapter.getTradedSymbolPage({ startTime: 1_000, page: 3, limit: 3 }))
            .toMatchObject({ full: false, lastTime: 9_000 });
        const params = new URLSearchParams(requests[1].url.split('?')[1]);
        expect(params.get('page')).toBe('3');
    });

    // The fills are folded back into positions, so the read has to reach past the
    // start of the oldest position it reports rather than a screenful of rows.
    it('reads fills to the endpoint ceiling, far deeper than the order log', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [];
        await adapter.getTradeHistory({ symbol: 'BTCUSDT' });
        expect(new URLSearchParams(requests[0].url.split('?')[1]).get('limit')).toBe('1000');
    });
});

describe('futures API error descriptions', () => {
    it('explains what to change for actionable Binance codes and keeps the rest verbatim', () => {
        expect(describeFuturesApiError({
            code: -2015,
            message: 'Invalid API-key, IP, or permissions for action',
        })).toContain('enable "Futures" on the key');
        // -4161 is the one an operator meets by doing the ordinary thing: putting
        // the multiple back down on a contract they are holding. Its bare wording
        // states the rule and not the way out of it.
        expect(describeFuturesApiError({
            code: -4161,
            message: 'Leverage reduction is not supported in Isolated Margin Mode with open positions',
        })).toContain('close the position, or raise it instead');
        expect(describeFuturesApiError({ code: -9999, message: 'Unknown failure' }))
            .toBe('Unknown failure');
        expect(describeFuturesApiError(undefined)).toBe('Binance futures request failed');
    });
});

describe('futures user data stream route', () => {
    it('builds the routed private path and asks for every event', () => {
        const url = futuresUserDataStreamUrl(FUTURES_STREAM_ORIGIN, 'abc123');
        expect(url).toBe('wss://fstream.binance.com/private/ws?listenKey=abc123');

        // The two things the migration made load-bearing, stated as themselves
        // rather than inferred from the string: the route is under `/private`,
        // and no `events` filter narrows what arrives. `/ws/<key>` parses to a
        // pathname of `/ws/abc123`, so this is the assertion that a return to
        // the decommissioned form cannot pass.
        const parsed = new URL(url);
        expect(parsed.pathname).toBe('/private/ws');
        expect(parsed.searchParams.get('listenKey')).toBe('abc123');
        expect(parsed.searchParams.has('events')).toBe(false);
        expect([...parsed.searchParams.keys()]).toEqual(['listenKey']);
    });

    it('carries the key as one parameter whatever the exchange puts in it', () => {
        // Binance's keys are alphanumeric today. Nothing promises that, and a
        // raw `&` or `#` in the key would silently truncate the parameter and
        // produce a socket that opens on a key the account does not own.
        const url = futuresUserDataStreamUrl(FUTURES_STREAM_ORIGIN, 'a&b#c d');
        expect(new URL(url).searchParams.get('listenKey')).toBe('a&b#c d');
    });

    it('keeps the listen key out of the record while leaving the route in it', () => {
        expect(redactFuturesListenKey(
            futuresUserDataStreamUrl(FUTURES_STREAM_ORIGIN, 'secret-key'),
        )).toBe('wss://fstream.binance.com/private/ws?listenKey=<redacted>');
        // The fallback shape 1.5 may have to try is redacted too, so switching
        // to it cannot start writing the key into logs the operator forwards.
        expect(redactFuturesListenKey('wss://fstream.binance.com/private/ws/secret-key'))
            .toBe('wss://fstream.binance.com/private/ws/<redacted>');
    });
});

describe('futures normalization', () => {
    it('normalizes REST order payloads and ORDER_TRADE_UPDATE events identically', () => {
        const fromRest = normalizeFuturesExecutionReport({
            symbol: 'BTCUSDT',
            side: 'BUY',
            type: 'LIMIT',
            status: 'NEW',
            orderId: 42,
            clientOrderId: 'abc',
            price: '50000',
            origQty: '0.01',
            executedQty: '0',
            positionSide: 'LONG',
            marginAsset: ' usdt ',
            updateTime: 1000,
        });
        const fromStream = normalizeFuturesExecutionReport({
            e: 'ORDER_TRADE_UPDATE',
            E: 1000,
            o: {
                s: 'BTCUSDT', S: 'BUY', o: 'LIMIT', X: 'NEW', i: 42, c: 'abc',
                p: '50000', q: '0.01', z: '0', ps: 'LONG', ma: 'usdt', T: 1000,
            },
        });
        for (const report of [fromRest, fromStream]) {
            expect(report).toMatchObject({
                e: 'executionReport',
                marketType: 'futures',
                symbol: 'BTCUSDT',
                side: 'BUY',
                status: 'NEW',
                orderId: 42,
                clientOrderId: 'abc',
                price: '50000',
                origQty: '0.01',
                positionSide: 'LONG',
                marginAsset: 'USDT',
            });
        }
    });

    it('carries the trigger of a regular stop, which rests at no limit price', () => {
        // Binance sends `price: '0'` for the market-triggered kinds, so an order
        // read without its trigger is priced at nothing on every surface that
        // shows one — the row, its size, and the total of the working orders.
        const fromRest = normalizeFuturesExecutionReport({
            symbol: 'BTCUSDT',
            side: 'SELL',
            type: 'STOP_MARKET',
            status: 'NEW',
            orderId: 7,
            price: '0',
            stopPrice: '58000',
            origQty: '0.5',
            updateTime: 1000,
        });
        const fromStream = normalizeFuturesExecutionReport({
            e: 'ORDER_TRADE_UPDATE',
            E: 1000,
            o: { s: 'BTCUSDT', S: 'SELL', o: 'STOP_MARKET', X: 'NEW', i: 7, p: '0', sp: '58000', q: '0.5', T: 1000 },
        });
        for (const report of [fromRest, fromStream]) {
            expect(report).toMatchObject({ price: '0', triggerPrice: '58000' });
        }

        // A plain limit order has no trigger, and the field is absent rather
        // than a zero that would be read as a price.
        expect(normalizeFuturesExecutionReport({
            symbol: 'BTCUSDT', orderId: 8, price: '50000', stopPrice: '0', origQty: '1',
        })).not.toHaveProperty('triggerPrice');
    });

    it('keeps ALGO identity and trigger semantics in a separate namespace', () => {
        const algoOrder = normalizeFuturesAlgoOrder({
            symbol: 'TUTUSDT',
            algoId: 42,
            clientAlgoId: 'algo-client-42',
            algoType: 'CONDITIONAL',
            orderType: 'STOP_MARKET',
            side: 'SELL',
            positionSide: 'LONG',
            algoStatus: 'NEW',
            quantity: '100',
            triggerPrice: '0.0123',
            closePosition: true,
            updateTime: 1000,
        });

        expect(algoOrder).toMatchObject({
            symbol: 'TUTUSDT',
            orderId: 42,
            sourceOrderId: 42,
            algoId: 42,
            clientOrderId: 'algo-client-42',
            orderKind: 'ALGO',
            orderSource: 'ALGO',
            type: 'STOP_MARKET',
            status: 'NEW',
            triggerPrice: '0.0123',
            closePosition: true,
        });
        expect(normalizeFuturesExecutionReport({
            symbol: 'TUTUSDT', orderId: 42, status: 'NEW', price: '0.01', origQty: '1',
        })).toMatchObject({
            orderId: 42,
            orderKind: 'REGULAR',
            orderSource: 'REGULAR',
        });
    });

    // Without the spawned identity the desk cannot connect the execution report
    // for order X to the algo parent whose X it is, and goes on drawing a stop
    // that has already fired as resting at its trigger price.
    it('carries the regular order an algo spawned, and the empty value when it has not', () => {
        const base = {
            symbol: 'TUTUSDT',
            algoId: 42,
            clientAlgoId: 'algo-client-42',
            algoType: 'CONDITIONAL',
            orderType: 'STOP_MARKET',
            side: 'SELL',
            algoStatus: 'NEW',
            quantity: '100',
            triggerPrice: '0.0123',
            updateTime: 1000,
        };

        expect(normalizeFuturesAlgoOrder({
            ...base,
            actualOrderId: '990281234',
            actualPrice: '0.0121',
        })).toMatchObject({
            algoId: 42,
            actualOrderId: '990281234',
            actualPrice: '0.0121',
            // The spawned order lives in the regular namespace; naming it here
            // must not move the parent out of the ALGO one.
            orderKind: 'ALGO',
            orderId: 42,
            triggerPrice: '0.0123',
        });

        // Binance states "has not fired" as an empty string. A null or a zero
        // here would read as an order that fired at nothing, which is the
        // opposite of what the exchange said.
        const resting = normalizeFuturesAlgoOrder({
            ...base,
            actualOrderId: '',
            actualPrice: '',
        });
        expect(resting.actualOrderId).toBe('');
        expect(resting.actualPrice).toBe('');

        // A response that never mentioned the fields says nothing either way.
        const unmentioned = normalizeFuturesAlgoOrder(base);
        expect(unmentioned).not.toHaveProperty('actualOrderId');
        expect(unmentioned).not.toHaveProperty('actualPrice');
    });

    it('classifies user data stream events', () => {
        expect(normalizeFuturesUserDataStreamEvent({
            e: 'ORDER_TRADE_UPDATE',
            o: { s: 'BTCUSDT', S: 'BUY', X: 'FILLED', i: 1, q: '1', z: '1', p: '1' },
        })).toMatchObject({ type: 'executionReport' });
        expect(normalizeFuturesUserDataStreamEvent({ e: 'ACCOUNT_UPDATE', a: {} }))
            .toMatchObject({ type: 'accountUpdate' });
        expect(normalizeFuturesUserDataStreamEvent({ e: 'listenKeyExpired' }))
            .toMatchObject({ type: 'listenKeyExpired' });
        expect(normalizeFuturesUserDataStreamEvent({ e: 'WHAT_IS_THIS' })).toBeNull();
    });

    // Binance's own payload, from the Margin Call event's page. Guidance, in its
    // own words — and in a fast market the position may already be gone by the
    // time it arrives, which is why it is carried as the exchange's statement
    // rather than folded into the desk's own liquidation reckoning.
    it('reads the positions a margin call names', () => {
        const event = normalizeFuturesUserDataStreamEvent({
            e: 'MARGIN_CALL',
            E: 1587727187525,
            cw: '3.16812045',
            p: [{
                s: 'ETHUSDT',
                ps: 'LONG',
                pa: '1.327',
                mt: 'crossed',
                iw: '0',
                mp: '187.17127',
                up: '-1.166074',
                mm: '1.614445',
            }],
        });

        expect(event).toMatchObject({ type: 'marginCall' });
        expect(event.marginCall).toEqual({
            crossWallet: '3.16812045',
            positions: [{
                symbol: 'ETHUSDT',
                positionSide: 'LONG',
                quantity: '1.327',
                marginType: 'CROSSED',
                isolatedWallet: '0',
                markPrice: '187.17127',
                unrealizedPnl: '-1.166074',
                maintenanceMargin: '1.614445',
            }],
        });
        expect(event.rendererPayload).toEqual({ futures_margin_call: event.marginCall });
        // A call that names nothing is not a call.
        expect(normalizeFuturesUserDataStreamEvent({ e: 'MARGIN_CALL', p: [] })).toBeNull();
    });

    // The frame carries a pair's leverage and the account-wide Multi-Assets
    // switch, and no per-contract margin mode at all.
    it('reads the leverage an account configuration update states, and no margin mode', () => {
        const event = normalizeFuturesUserDataStreamEvent({
            e: 'ACCOUNT_CONFIG_UPDATE',
            E: 1611646737479,
            T: 1611646737476,
            ac: { s: 'BTCUSDT', l: 25 },
        });

        expect(event).toMatchObject({ type: 'accountConfigUpdate' });
        expect(event.accountConfigUpdate)
            .toEqual({ symbol: 'BTCUSDT', leverage: 25, multiAssetsMargin: null });
        expect(event.accountConfigUpdate).not.toHaveProperty('marginType');
        expect(event.rendererPayload).toBeNull();

        expect(normalizeFuturesUserDataStreamEvent({
            e: 'ACCOUNT_CONFIG_UPDATE',
            ai: { j: true },
        }).accountConfigUpdate)
            .toEqual({ symbol: null, leverage: null, multiAssetsMargin: true });
        // A frame that states neither states nothing.
        expect(normalizeFuturesUserDataStreamEvent({ e: 'ACCOUNT_CONFIG_UPDATE' })).toBeNull();
    });

    // `ai` is the regular order the algo spawned — the same identity the
    // reconciliation beat reads as `actualOrderId`, arriving on the frame that
    // caused it instead of up to thirty seconds later.
    it('reads what an algo update states, including the order it spawned', () => {
        const event = normalizeFuturesUserDataStreamEvent({
            e: 'ALGO_UPDATE',
            T: 1750515742297,
            E: 1750515742303,
            o: {
                caid: 'Q5xaq5EGKgXXa0fD7fs0Ip',
                aid: 2148719,
                at: 'CONDITIONAL',
                o: 'TAKE_PROFIT',
                s: 'BNBUSDT',
                S: 'SELL',
                ps: 'BOTH',
                f: 'GTC',
                q: '0.01',
                X: 'CANCELED',
                ai: '',
                ap: '0.00000',
                aq: '0.00000',
                tp: '750',
                p: '750',
                wt: 'CONTRACT_PRICE',
                cp: false,
                pP: false,
                R: false,
                rm: 'Reduce Only reject',
                ia: false,
            },
        });

        expect(event).toMatchObject({ type: 'algoUpdate' });
        expect(event.algoUpdate).toMatchObject({
            symbol: 'BNBUSDT',
            algoId: 2148719,
            clientAlgoId: 'Q5xaq5EGKgXXa0fD7fs0Ip',
            algoType: 'CONDITIONAL',
            orderType: 'TAKE_PROFIT',
            side: 'SELL',
            status: 'CANCELED',
            triggerPrice: '750',
            // The documented "has not fired" value, carried as the exchange sent
            // it rather than coerced to a null or a zero.
            actualOrderId: '',
            failureReason: 'Reduce Only reject',
            activated: false,
        });
        expect(normalizeFuturesUserDataStreamEvent({ e: 'ALGO_UPDATE', o: {} })).toBeNull();
    });

    // The one ending no read explains: the stop triggered and the engine refused
    // it, so at the next reconciliation the order is simply gone.
    it('reads the reason a triggered conditional order was refused', () => {
        const event = normalizeFuturesUserDataStreamEvent({
            e: 'CONDITIONAL_ORDER_TRIGGER_REJECT',
            E: 1685517224945,
            T: 1685517224955,
            or: {
                s: 'ETHUSDT',
                i: 155618472834,
                r: 'Due to the order could not be filled immediately, the FOK order has been rejected.',
            },
        });

        expect(event).toMatchObject({ type: 'conditionalTriggerReject' });
        expect(event.triggerReject).toEqual({
            symbol: 'ETHUSDT',
            orderId: 155618472834,
            reason: 'Due to the order could not be filled immediately, the FOK order has been rejected.',
        });
        expect(event.rendererPayload)
            .toEqual({ futures_conditional_trigger_reject: event.triggerReject });
    });

    // Guard. These three answer `null` before this change and after it; what is
    // new is that the decision is written down instead of being an absence.
    it('names the events it is sent and deliberately does not act on', () => {
        expect(Object.keys(FUTURES_USER_DATA_EVENTS_IGNORED))
            .toEqual(['TRADE_LITE', 'STRATEGY_UPDATE', 'GRID_UPDATE']);
        for (const event of Object.keys(FUTURES_USER_DATA_EVENTS_IGNORED)) {
            expect(normalizeFuturesUserDataStreamEvent({ e: event })).toBeNull();
        }
    });

    // The frame is the account change, not a signal that one happened. Reading
    // it back over REST put the position on screen a signed round trip after the
    // exchange had already stated it.
    it('reads what an account update states about the wallet and the positions', () => {
        expect(normalizeFuturesAccountUpdate({
            e: 'ACCOUNT_UPDATE',
            a: {
                m: 'ORDER',
                B: [
                    { a: 'USDT', wb: '1200.5', cw: '1200.5', bc: '-0.4' },
                    { b: 'no asset named' },
                ],
                P: [
                    {
                        s: 'BTCUSDT', pa: '0.5', ep: '60000', up: '12.5',
                        mt: 'isolated', iw: '300', ps: 'BOTH',
                    },
                    // Zero is how the frame says a position closed. A read simply
                    // stops listing it, so this one has to survive normalization.
                    { s: 'ETHUSDT', pa: '0', ep: '0.0', up: '0', mt: 'cross', iw: '0', ps: 'BOTH' },
                ],
            },
        })).toEqual({
            cause: 'ORDER',
            balances: [{ asset: 'USDT', walletBalance: '1200.5', crossWallet: '1200.5' }],
            positions: [
                {
                    symbol: 'BTCUSDT', positionSide: 'BOTH', quantity: '0.5',
                    entryPrice: '60000', unrealizedPnl: '12.5',
                    marginType: 'ISOLATED', isolatedWallet: '300',
                },
                {
                    symbol: 'ETHUSDT', positionSide: 'BOTH', quantity: '0',
                    entryPrice: '0.0', unrealizedPnl: '0',
                    marginType: 'CROSS', isolatedWallet: '0',
                },
            ],
        });
        expect(normalizeFuturesAccountUpdate({ e: 'ORDER_TRADE_UPDATE' })).toBeNull();
        expect(normalizeFuturesAccountUpdate({ e: 'ACCOUNT_UPDATE' }))
            .toEqual({ cause: null, balances: [], positions: [] });
    });

    it('extracts filters, balances, and open positions', () => {
        expect(parseFuturesExchangeFilters({
            symbols: [{
                symbol: 'BTCUSDT',
                status: 'TRADING',
                contractType: 'PERPETUAL',
                baseAsset: 'BTC',
                quoteAsset: 'USDT',
                pricePrecision: 2,
                quantityPrecision: 3,
                filters: [
                    { filterType: 'PRICE_FILTER', minPrice: '0.1', maxPrice: '1000000', tickSize: '0.1' },
                    { filterType: 'LOT_SIZE', minQty: '0.001', maxQty: '1000', stepSize: '0.001' },
                    { filterType: 'MIN_NOTIONAL', notional: '100' },
                ],
            }],
        }, 'BTCUSDT')).toMatchObject({
            symbol: 'BTCUSDT',
            tickSize: '0.1',
            stepSize: '0.001',
            minNotional: '100',
        });

        expect(normalizeFuturesBalances([
            {
                asset: 'USDT', balance: '100', crossWalletBalance: '95',
                availableBalance: '90', crossUnPnl: '0',
            },
            { asset: 'BNB', balance: '0', availableBalance: '0', crossUnPnl: '0' },
        ])).toEqual({
            USDT: { available: '90', total: '100', crossWallet: '95', crossUnPnl: '0' },
        });

        expect(normalizeFuturesBalances([
            { asset: 'USDT', balance: '0', availableBalance: '0', crossUnPnl: '0' },
        ])).toEqual({
            USDT: { available: '0', total: '0', crossUnPnl: '0' },
        });

        expect(normalizeFuturesPositions([
            { symbol: 'BTCUSDT', positionAmt: '0.010', positionSide: 'LONG', entryPrice: '57000', markPrice: '58445', unRealizedProfit: '14.45', liquidationPrice: '29000', leverage: '2', marginType: 'isolated', isolatedMargin: '305', notional: '584' },
            { symbol: 'ETHUSDT', positionAmt: '0', positionSide: 'BOTH' },
        ])).toEqual([expect.objectContaining({
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            quantity: '0.010',
            marginType: 'ISOLATED',
        })]);

        // /fapi/v3/positionRisk answers without leverage or margin mode; the
        // committed margin it does report is what ROE is computed from.
        expect(normalizeFuturesPositions([
            { symbol: 'BEATUSDT', positionAmt: '-2873', positionSide: 'BOTH', entryPrice: '3.3449999999999998', markPrice: '3.37867363', unRealizedProfit: '-96.74', liquidationPrice: '4.71896804', isolatedMargin: '0', notional: '-9707', initialMargin: '960.5', positionInitialMargin: '950.5', openOrderInitialMargin: '10', maintMargin: '38.8' },
        ])).toEqual([expect.objectContaining({
            symbol: 'BEATUSDT',
            leverage: undefined,
            marginType: undefined,
            initialMargin: '960.5',
            positionInitialMargin: '950.5',
            maintenanceMargin: '38.8',
        })]);

        // The isolated wallet is what the read still carries once marginType is
        // gone, and it is the amount actually at stake behind the position.
        expect(normalizeFuturesPositions([
            { symbol: 'BLUAIUSDT', positionAmt: '700000', positionSide: 'BOTH', entryPrice: '0.015384', markPrice: '0.015349', unRealizedProfit: '-24.45', isolatedMargin: '512.4', isolatedWallet: '537.9', initialMargin: '480' },
        ])).toEqual([expect.objectContaining({
            symbol: 'BLUAIUSDT',
            isolatedWallet: '537.9',
            isolatedMargin: '512.4',
        })]);
    });

});

describe('a connection the desk already has', () => {
    const pooledConnection = { name: 'taken from the pool' };
    const ownConnection = { name: 'opened for this request' };

    const createPooledAdapter = (recordEvent = null) => {
        const adapter = new FuturesTradingAdapter({
            apiKey: 'test-key',
            apiSecret: 'test-secret',
            recvWindow: 60000,
            proxyAgent: pooledConnection,
            proxyAgentWithoutReuse: ownConnection,
            recordEvent,
        });
        adapter.serverTimeOffsetMs = 0;
        // So the requests counted below are the order's own and nothing else.
        adapter.getPositionMode = vi.fn().mockResolvedValue({ hedgeMode: false });
        return adapter;
    };

    const connectionLost = (code = 'ECONNRESET') => Object.assign(
        new Error('socket hang up'),
        { code },
    );

    const placeOne = adapter => adapter.placeOrder({
        symbol: 'BTCUSDT',
        side: 'BUY',
        orderType: 'LIMIT',
        numericQuantity: 1,
        numericPrice: 10,
        positionSide: 'BOTH',
    });

    const readOne = adapter => adapter.getTradeHistory({ symbol: 'BTCUSDT' });

    it('holds the pool to the bounds it was measured against', () => {
        expect(FUTURES_REST_CONNECTION_POOL).toEqual({
            keepAlive: true,
            // Above the 67 the desk's own admission spacing and request timeout
            // allow in flight, so the agent can never become a second queue.
            maxSockets: 72,
            // The account beat's own width, so a beat pays for no openings.
            maxFreeSockets: 4,
        });
        expect(Object.isFrozen(FUTURES_REST_CONNECTION_POOL)).toBe(true);
    });

    it('sends a replay-safe GET again on a connection of its own when a pooled one is lost', async () => {
        const recorded = [];
        const adapter = createPooledAdapter((kind, value) => recorded.push({ kind, value }));
        globalThis.__futuresTestReusedSocket = attempt => attempt === 0;
        globalThis.__futuresTestTransport = attempt => (attempt === 0 ? connectionLost() : null);
        globalThis.__futuresTestResponse = [];

        const rows = await readOne(adapter);

        expect(requests).toHaveLength(2);
        expect(requests[0].options.agent).toBe(pooledConnection);
        expect(requests[1].options.agent).toBe(ownConnection);
        const firstUrl = new URL(requests[0].url);
        const fallbackUrl = new URL(requests[1].url);
        expect(fallbackUrl.pathname).toBe(firstUrl.pathname);
        expect(fallbackUrl.searchParams.get('symbol')).toBe(firstUrl.searchParams.get('symbol'));
        expect(fallbackUrl.searchParams.get('recvWindow')).toBe(
            firstUrl.searchParams.get('recvWindow'),
        );
        expect(rows).toEqual([]);
        // The fallback, and then the cost of the connection it had to open —
        // which is the whole of what the record owes the operator here.
        expect(recorded).toEqual([
            { kind: 'fault', value: { phase: 'futures-rest', code: 'CONNECTION_REUSE_FALLBACK' } },
            {
                kind: 'timing',
                value: expect.objectContaining({
                    phase: 'futures-rest-unpooled',
                    outcome: 'ok',
                    cache: 'miss',
                }),
            },
        ]);
    });

    it('materializes and charges a safe signed GET after each over-recvWindow admission', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const summaries = [];
        const adapter = new FuturesTradingAdapter({
            apiKey: 'test-key',
            apiSecret: 'test-secret',
            recvWindow: 5_000,
            proxyAgent: pooledConnection,
            proxyAgentWithoutReuse: ownConnection,
        });
        adapter.serverTimeOffsetMs = 0;
        const limiter = new RateLimiter(100, 60_000, 6_001, {
            physicalAttempts: true,
            onOperation: summary => summaries.push(summary),
        });
        globalThis.__futuresTestReusedSocket = attempt => attempt === 0;
        globalThis.__futuresTestTransport = attempt => (
            attempt === 0 ? connectionLost() : null
        );
        globalThis.__futuresTestResponse = [];

        const pending = limiter.execute(() => readOne(adapter), 5, 0);
        await vi.advanceTimersByTimeAsync(12_002);

        await expect(pending).resolves.toEqual([]);
        expect(requests).toHaveLength(2);
        expect(requests.map(request => request.at)).toEqual([6_001, 12_002]);
        for (const request of requests) {
            const query = new URL(request.url).search.slice(1);
            const unsigned = query.slice(0, query.lastIndexOf('&signature='));
            const params = new URLSearchParams(unsigned);
            expect(Number(params.get('timestamp'))).toBe(request.at);
            expect(Number(params.get('recvWindow'))).toBe(5_000);
            expect(new URLSearchParams(query).get('signature')).toBe(
                createHmac('sha256', 'test-secret').update(unsigned).digest('hex'),
            );
        }
        expect(summaries).toEqual([
            expect.objectContaining({
                attempts: 2,
                chargedWeight: 10,
                connectionRetries: 1,
                outcome: 'ok',
            }),
        ]);
    });

    it('replays a safe GET when the pooled connection broke under the write', async () => {
        const adapter = createPooledAdapter();
        globalThis.__futuresTestReusedSocket = attempt => attempt === 0;
        globalThis.__futuresTestTransport = attempt => (attempt === 0 ? connectionLost('EPIPE') : null);
        globalThis.__futuresTestResponse = [];

        const rows = await readOne(adapter);

        expect(requests).toHaveLength(2);
        expect(requests[1].options.agent).toBe(ownConnection);
        expect(rows).toEqual([]);
    });

    it.each(['ECONNRESET', 'EPIPE'])(
        'does not replay a position-margin POST after pooled %s',
        async (code) => {
            const adapter = createPooledAdapter();
            globalThis.__futuresTestReusedSocket = true;
            globalThis.__futuresTestTransport = connectionLost(code);

            const error = await adapter.adjustPositionMargin({
                symbol: 'BTCUSDT',
                positionSide: 'BOTH',
                direction: 'ADD',
                amount: '25',
            }).catch(caught => caught);

            expect(requests).toHaveLength(1);
            expect(error).toMatchObject({
                name: 'FuturesApiError',
                code,
                indeterminate: true,
            });
        },
    );

    it('does not send again when the request opened the connection itself', async () => {
        const recorded = [];
        const adapter = createPooledAdapter((kind, value) => recorded.push({ kind, value }));
        globalThis.__futuresTestReusedSocket = false;
        globalThis.__futuresTestTransport = connectionLost();

        const error = await readOne(adapter).catch(caught => caught);

        expect(requests).toHaveLength(1);
        expect(error.name).toBe('FuturesApiError');
        expect(error.code).toBe('ECONNRESET');
        expect(recorded.filter(event => event.kind === 'fault')).toEqual([]);
    });

    it('does not send again once the exchange has begun answering', async () => {
        const adapter = createPooledAdapter();
        globalThis.__futuresTestReusedSocket = true;
        globalThis.__futuresTestTransport = { afterAnswerHasBegun: connectionLost() };

        const error = await placeOne(adapter).catch(caught => caught);

        expect(requests).toHaveLength(1);
        expect(error.name).toBe('FuturesApiError');
    });

    it('does not send a timed-out request again', async () => {
        const adapter = createPooledAdapter();
        globalThis.__futuresTestReusedSocket = true;
        globalThis.__futuresTestTransport = 'timeout';

        const error = await placeOne(adapter).catch(caught => caught);

        expect(requests).toHaveLength(1);
        expect(error.code).toBe('ETIMEDOUT');
        expect(error.indeterminate).toBe(true);
    });

    it('does not send a request the exchange answered with a server error again', async () => {
        const adapter = createPooledAdapter();
        globalThis.__futuresTestReusedSocket = true;
        globalThis.__futuresTestStatus = 503;
        globalThis.__futuresTestResponse = { code: -1000, msg: 'Unknown error' };

        const error = await placeOne(adapter).catch(caught => caught);

        expect(requests).toHaveLength(1);
        expect(error.status).toBe(503);
        expect(error.indeterminate).toBe(true);
    });

    it('fails with what ended the request, not with what caused the retry', async () => {
        const recorded = [];
        const adapter = createPooledAdapter((kind, value) => recorded.push({ kind, value }));
        globalThis.__futuresTestReusedSocket = attempt => attempt === 0;
        globalThis.__futuresTestTransport = attempt => (
            attempt === 0 ? connectionLost() : connectionLost('ENOTFOUND')
        );

        const error = await readOne(adapter).catch(caught => caught);

        expect(requests).toHaveLength(2);
        expect(error.code).toBe('ENOTFOUND');
        expect(recorded.filter(event => event.kind === 'fault').map(event => event.value.code)).toEqual([
            'CONNECTION_REUSE_FALLBACK',
            'CONNECTION_REUSE_FALLBACK_FAILED',
        ]);
    });
});

describe('what the record says about connections', () => {
    const createRecordingAdapter = (recorded) => {
        const adapter = new FuturesTradingAdapter({
            apiKey: 'test-key',
            apiSecret: 'test-secret',
            recvWindow: 60000,
            proxyAgent: { name: 'taken from the pool' },
            proxyAgentWithoutReuse: { name: 'opened for this request' },
            recordEvent: (kind, value) => recorded.push({ kind, value }),
        });
        adapter.serverTimeOffsetMs = 0;
        return adapter;
    };

    it('says what a request that had to open a connection cost', async () => {
        const recorded = [];
        const adapter = createRecordingAdapter(recorded);
        globalThis.__futuresTestReusedSocket = false;
        globalThis.__futuresTestResponse = { serverTime: 1 };

        await adapter.syncServerTime();

        expect(recorded).toHaveLength(1);
        expect(recorded[0].kind).toBe('timing');
        expect(recorded[0].value).toMatchObject({
            phase: 'futures-rest-unpooled',
            outcome: 'ok',
            cache: 'miss',
        });
        expect(typeof recorded[0].value.durationMs).toBe('number');
    });

    it('says nothing at all for a request served from the pool', async () => {
        const recorded = [];
        const adapter = createRecordingAdapter(recorded);
        globalThis.__futuresTestReusedSocket = true;
        globalThis.__futuresTestResponse = { serverTime: 1 };

        await adapter.syncServerTime();

        expect(requests).toHaveLength(1);
        expect(recorded).toEqual([]);
    });

    it('says an opening that failed was an opening', async () => {
        const recorded = [];
        const adapter = createRecordingAdapter(recorded);
        globalThis.__futuresTestReusedSocket = false;
        globalThis.__futuresTestStatus = 400;
        globalThis.__futuresTestResponse = { code: -1121, msg: 'Invalid symbol' };

        await adapter.syncServerTime().catch(() => {});

        expect(recorded).toHaveLength(1);
        expect(recorded[0].value).toMatchObject({
            phase: 'futures-rest-unpooled',
            outcome: 'error',
            cache: 'miss',
        });
    });
});
