// @vitest-environment node

import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FuturesTradingAdapter,
    describeFuturesApiError,
    normalizeFuturesAlgoOrder,
    normalizeFuturesBalances,
    normalizeFuturesExecutionReport,
    normalizeFuturesHistoryOrder,
    normalizeFuturesHistoryTrade,
    normalizeFuturesPositions,
    normalizeFuturesSymbolConfig,
    normalizeFuturesUserDataStreamEvent,
    parseFuturesExchangeFilters,
    readFuturesMaxLeverage,
    readFuturesTradedSymbols,
} from './futures-trading-adapter.js';

const requests = [];

// The mock can answer with a status, refuse at the transport, or time out, so
// the three outcomes a mutating command must tell apart are all reachable here.
vi.mock('node:https', () => ({
    default: {
        request: (url, options, onResponse) => {
            const chunks = [];
            const listeners = {};
            const request = {
                on: (event, handler) => {
                    listeners[event] = handler;
                    return request;
                },
                write: chunk => chunks.push(chunk),
                end: () => {
                    const record = { url: String(url), options, body: chunks.join('') };
                    requests.push(record);
                    const transport = globalThis.__futuresTestTransport ?? null;
                    if (transport === 'timeout') {
                        queueMicrotask(() => listeners.timeout?.());
                        return;
                    }
                    if (transport) {
                        queueMicrotask(() => listeners.error?.(transport));
                        return;
                    }
                    const handlers = {};
                    const response = {
                        statusCode: globalThis.__futuresTestStatus ?? 200,
                        on: (event, handler) => {
                            handlers[event] = handler;
                        },
                    };
                    onResponse(response);
                    queueMicrotask(() => {
                        const payload = record.respondWith ?? globalThis.__futuresTestResponse ?? {};
                        handlers.data?.(Buffer.from(JSON.stringify(payload)));
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
    delete globalThis.__futuresTestStatus;
    delete globalThis.__futuresTestTransport;
    vi.restoreAllMocks();
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
        expect(outcome.report.orderId).toBe(42);
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
                id: 9, orderId: 2, symbol: 'BTCUSDT', side: 'SELL', price: '58500', qty: '0.004',
                realizedPnl: '-96.74', commission: '0.0234', commissionAsset: 'USDT', time: 7_000,
            },
        ];
        const trades = await adapter.getTradeHistory({ symbol: 'BTCUSDT' });
        expect(requests[0].url).toContain('/fapi/v1/userTrades');
        expect(trades).toEqual([expect.objectContaining({
            id: '9',
            realizedPnl: '-96.74',
            commission: '0.0234',
            commissionAsset: 'USDT',
            time: 7_000,
        })]);
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
        expect(normalizeFuturesHistoryTrade({}).realizedPnl).toBe('0');
    });

    it('keeps safe and string exchange identities exact and drops rounded numbers', () => {
        expect(normalizeFuturesHistoryOrder({ orderId: 42 }).orderId).toBe('42');
        expect(normalizeFuturesHistoryOrder({ orderId: '9223372036854775807' }).orderId)
            .toBe('9223372036854775807');
        expect(normalizeFuturesHistoryOrder({ orderId: Number.MAX_SAFE_INTEGER + 1 }).orderId)
            .toBeNull();
        expect(normalizeFuturesHistoryTrade({ id: 9, orderId: 42 })).toMatchObject({
            id: '9', orderId: '42',
        });
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
        expect(params.get('limit')).toBe('1000');
        expect(page.symbols).toEqual(['BTCUSDT', 'BICOUSDT']);
        expect(readFuturesTradedSymbols(null)).toEqual([]);
    });

    // The endpoint answers a start time with the *oldest* rows after it, so a page
    // that comes back full is a page with newer rows behind it. Saying so is what
    // lets the caller walk to the recent end instead of reviewing last Tuesday.
    it('reports a full income page and where it ended, so the walk can continue', async () => {
        const adapter = createAdapter();
        adapter.serverTimeOffsetMs = 0;
        globalThis.__futuresTestResponse = [
            { symbol: 'BICOUSDT', incomeType: 'REALIZED_PNL', income: '78', time: 2_000 },
            { symbol: 'BTCUSDT', incomeType: 'REALIZED_PNL', income: '-96', time: 9_000 },
        ];
        expect(await adapter.getTradedSymbolPage({ startTime: 1_000, limit: 2 }))
            .toMatchObject({ full: true, lastTime: 9_000 });
        expect(await adapter.getTradedSymbolPage({ startTime: 1_000, limit: 3 }))
            .toMatchObject({ full: false, lastTime: 9_000 });
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
        expect(describeFuturesApiError({ code: -9999, message: 'Unknown failure' }))
            .toBe('Unknown failure');
        expect(describeFuturesApiError(undefined)).toBe('Binance futures request failed');
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
            updateTime: 1000,
        });
        const fromStream = normalizeFuturesExecutionReport({
            e: 'ORDER_TRADE_UPDATE',
            E: 1000,
            o: {
                s: 'BTCUSDT', S: 'BUY', o: 'LIMIT', X: 'NEW', i: 42, c: 'abc',
                p: '50000', q: '0.01', z: '0', ps: 'LONG', T: 1000,
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

    it('classifies user data stream events and refresh triggers', () => {
        expect(normalizeFuturesUserDataStreamEvent({
            e: 'ORDER_TRADE_UPDATE',
            o: { s: 'BTCUSDT', S: 'BUY', X: 'FILLED', i: 1, q: '1', z: '1', p: '1' },
        })).toMatchObject({ type: 'executionReport', shouldRefreshAccount: true });
        expect(normalizeFuturesUserDataStreamEvent({ e: 'ACCOUNT_UPDATE' }))
            .toMatchObject({ type: 'accountUpdate', shouldRefreshAccount: true });
        expect(normalizeFuturesUserDataStreamEvent({ e: 'listenKeyExpired' }))
            .toMatchObject({ type: 'listenKeyExpired' });
        expect(normalizeFuturesUserDataStreamEvent({ e: 'MARGIN_CALL' })).toBeNull();
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
            { asset: 'USDT', balance: '100', availableBalance: '90', crossUnPnl: '0' },
            { asset: 'BNB', balance: '0', availableBalance: '0', crossUnPnl: '0' },
        ])).toEqual({
            USDT: { available: '90', total: '100', crossUnPnl: '0' },
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
            { symbol: 'BEATUSDT', positionAmt: '-2873', positionSide: 'BOTH', entryPrice: '3.3449999999999998', markPrice: '3.37867363', unRealizedProfit: '-96.74', liquidationPrice: '4.71896804', isolatedMargin: '0', notional: '-9707', initialMargin: '960.5', maintMargin: '38.8' },
        ])).toEqual([expect.objectContaining({
            symbol: 'BEATUSDT',
            leverage: undefined,
            marginType: undefined,
            initialMargin: '960.5',
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
