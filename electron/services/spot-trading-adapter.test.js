import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    SpotTradingAdapter,
    normalizeSpotBalances,
    normalizeSpotExecutionReport,
    normalizeSpotUserDataStreamEvent,
    parseSpotExchangeFilters,
    runSpotAccountRefreshOperations,
} from './spot-trading-adapter.js';

const makeResponse = (data) => ({
    data: vi.fn().mockResolvedValue(data),
});

const makeClient = (overrides = {}) => ({
    restAPI: {
        exchangeInfo: vi.fn(),
        getAccount: vi.fn(),
        getOpenOrders: vi.fn(),
        myTrades: vi.fn(),
        sendRequest: vi.fn(),
        newOrder: vi.fn(),
        deleteOrder: vi.fn(),
        ...overrides,
    },
});

describe('SpotTradingAdapter', () => {
    it.each([null, {}, { symbol: 'BTCUSDT', orderId: 11, status: 'FILLED' },
        { symbol: 'BTCUSDT', orderId: 11, status: 'NEW' },
        { symbol: 'ETHUSDT', orderId: 11, status: 'CANCELED' },
    ])('treats an insufficient successful cancel as unknown without retrying: %j', async body => {
        const deleteOrder = vi.fn().mockResolvedValue(makeResponse(body));
        const adapter = new SpotTradingAdapter({ client: makeClient({ deleteOrder }) });
        await expect(adapter.cancelOrder({ symbol: 'BTCUSDT', orderId: 11 })).rejects.toMatchObject({ indeterminate: true });
        expect(deleteOrder).toHaveBeenCalledOnce();
    });
    it.each([null, {}, { symbol: 'ETHUSDT', orderId: 11, status: 'NEW' },
        { symbol: 'BTCUSDT', orderId: 12, status: 'NEW' },
    ])('rejects unusable or mismatching lookup identity: %j', async body => {
        const getOrder = vi.fn().mockResolvedValue(makeResponse(body));
        const adapter = new SpotTradingAdapter({ client: makeClient({ getOrder }) });
        await expect(adapter.findOrder({ symbol: 'BTCUSDT', orderId: 11 })).rejects.toMatchObject({ indeterminate: true });
        expect(getOrder).toHaveBeenCalledOnce();
    });
    it('rejects a successful placement with missing status without a second POST', async () => {
        const newOrder = vi.fn().mockResolvedValue(makeResponse({ symbol: 'BTCUSDT', orderId: 11, clientOrderId: 'intent' }));
        const adapter = new SpotTradingAdapter({ client: makeClient({ newOrder }) });
        await expect(adapter.placeOrder({ symbol: 'BTCUSDT', newClientOrderId: 'intent', numericQuantity: 1, numericPrice: 1 }))
            .rejects.toMatchObject({ indeterminate: true });
        expect(newOrder).toHaveBeenCalledOnce();
    });
    it('preserves both client identities and missing status in private order reports', () => {
        expect(normalizeSpotExecutionReport({ s: 'BTCUSDT', c: 'cancel-id', C: 'original-id', i: '9007199254740993' }))
            .toMatchObject({ symbol: 'BTCUSDT', clientOrderId: 'cancel-id', originalClientOrderId: 'original-id', orderId: '9007199254740993', status: 'UNKNOWN', X: 'UNKNOWN' });
    });

    it('does not invent accepted status for a query with missing evidence', async () => {
        const adapter = new SpotTradingAdapter({ client: makeClient({ getOrder: vi.fn().mockResolvedValue(makeResponse({ symbol: 'BTCUSDT', orderId: 11 })) }) });
        await expect(adapter.findOrder({ symbol: 'BTCUSDT', orderId: 11 }))
            .resolves.toMatchObject({ exists: true, report: { status: 'UNKNOWN', X: 'UNKNOWN' } });
    });
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-09T10:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('normalizes spot balances without changing the renderer balance shape', () => {
        expect(normalizeSpotBalances({
            balances: [
                { asset: 'BTC', free: '0.50000000', locked: '0.10000000' },
                { asset: 'ETH', free: '0.00000000', locked: '1.00000000' },
                { asset: 'BNB', free: '0.00000000', locked: '0.00000000' },
            ],
        })).toEqual({
            BTC: { available: '0.50000000', onOrder: '0.10000000' },
            ETH: { available: '0.00000000', onOrder: '1.00000000' },
        });
    });

    it('parses spot exchange filters into the existing filters payload shape', () => {
        expect(parseSpotExchangeFilters({
            symbols: [{
                status: 'TRADING',
                baseAsset: 'BTC',
                quoteAsset: 'USDT',
                baseAssetPrecision: 8,
                quoteAssetPrecision: 2,
                quotePrecision: 2,
                filters: [
                    { filterType: 'MIN_NOTIONAL', minNotional: '10.00000000' },
                    { filterType: 'PRICE_FILTER', minPrice: '0.01000000', maxPrice: '1000000.00000000', tickSize: '0.01000000' },
                    { filterType: 'LOT_SIZE', minQty: '0.00000100', maxQty: '9000.00000000', stepSize: '0.00000100' },
                ],
            }],
        })).toEqual({
            status: 'TRADING',
            baseAsset: 'BTC',
            quoteAsset: 'USDT',
            baseAssetPrecision: 8,
            quoteAssetPrecision: 2,
            quotePrecision: 2,
            minNotional: '10.00000000',
            minPrice: '0.01000000',
            maxPrice: '1000000.00000000',
            tickSize: '0.01000000',
            stepSize: '0.00000100',
            minQty: '0.00000100',
            maxQty: '9000.00000000',
        });
    });

    it('keeps spot account and order query params unchanged', async () => {
        const client = makeClient({
            getAccount: vi.fn().mockResolvedValue(makeResponse({
                balances: [{ asset: 'USDT', free: '100.00', locked: '0.00' }],
            })),
            getOpenOrders: vi.fn().mockResolvedValue(makeResponse([{ orderId: 123 }])),
            myTrades: vi.fn().mockResolvedValue(makeResponse([{ id: 456 }])),
        });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        await expect(adapter.getAccountState()).resolves.toEqual({
            USDT: { available: '100.00', onOrder: '0.00' },
        });
        await expect(adapter.getOpenOrders()).resolves.toEqual([{ orderId: 123 }]);
        await expect(adapter.getTradeHistory('BTCUSDT')).resolves.toEqual([{ id: 456 }]);

        expect(client.restAPI.getAccount).toHaveBeenCalledWith({ recvWindow: 60000 });
        expect(client.restAPI.getOpenOrders).toHaveBeenCalledWith({ recvWindow: 60000 });
        expect(client.restAPI.myTrades).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            limit: 500,
            recvWindow: 60000,
        });
    });

    it('reads spot server time through the existing REST contract', async () => {
        const client = makeClient({
            sendRequest: vi.fn()
                .mockResolvedValueOnce(makeResponse({ serverTime: 1783591200123 }))
                .mockResolvedValueOnce(makeResponse({})),
        });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        await expect(adapter.getServerTime()).resolves.toBe(1783591200123);
        await expect(adapter.getServerTime()).resolves.toBeUndefined();

        expect(client.restAPI.sendRequest).toHaveBeenNthCalledWith(1, '/api/v3/time', 'GET');
        expect(client.restAPI.sendRequest).toHaveBeenNthCalledWith(2, '/api/v3/time', 'GET');
    });

    it('builds account refresh operations with current scope-specific weights and renderer payload shapes', async () => {
        const client = makeClient({
            getAccount: vi.fn().mockResolvedValue(makeResponse({
                balances: [{ asset: 'USDT', free: '100.00', locked: '0.00' }],
            })),
            getOpenOrders: vi.fn().mockResolvedValue(makeResponse([{ orderId: 123 }])),
            myTrades: vi.fn().mockResolvedValue(makeResponse([{ id: 456 }])),
        });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        const operations = adapter.getAccountRefreshOperations('BTCUSDT');

        expect(operations.map(({ type, weight }) => ({ type, weight }))).toEqual([
            { type: 'balances', weight: 20 },
            { type: 'openOrders', weight: 80 },
            { type: 'tradeHistory', weight: 20 },
        ]);
        await expect(operations[0].loadPayload()).resolves.toEqual({
            balances: { USDT: { available: '100.00', onOrder: '0.00' } },
        });
        await expect(operations[1].loadPayload()).resolves.toEqual({
            orders: [{ orderId: 123 }],
        });
        await expect(operations[2].loadPayload()).resolves.toEqual({
            history: [{ id: 456 }],
        });

        expect(client.restAPI.getAccount).toHaveBeenCalledWith({ recvWindow: 60000 });
        expect(client.restAPI.getOpenOrders).toHaveBeenCalledWith({ recvWindow: 60000 });
        expect(client.restAPI.myTrades).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            limit: 500,
            recvWindow: 60000,
        });
    });

    it('keeps symbol-less account refresh scoped to balances and open orders', async () => {
        const client = makeClient({
            getAccount: vi.fn().mockResolvedValue(makeResponse({
                balances: [{ asset: 'BTC', free: '0.50', locked: '0.10' }],
            })),
            getOpenOrders: vi.fn().mockResolvedValue(makeResponse([])),
            myTrades: vi.fn(),
        });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        const operations = adapter.getAccountRefreshOperations();

        expect(operations.map(({ type, weight }) => ({ type, weight }))).toEqual([
            { type: 'balances', weight: 20 },
            { type: 'openOrders', weight: 80 },
        ]);
        await expect(operations[0].loadPayload()).resolves.toEqual({
            balances: { BTC: { available: '0.50', onOrder: '0.10' } },
        });
        await expect(operations[1].loadPayload()).resolves.toEqual({
            orders: [],
        });
        expect(client.restAPI.myTrades).not.toHaveBeenCalled();
    });

    it('runs spot account refresh operations sequentially and isolates failures', async () => {
        const operations = [
            { type: 'balances', weight: 20 },
            { type: 'openOrders', weight: 80 },
            { type: 'tradeHistory', weight: 20 },
        ];
        const balancesError = new Error('balances unavailable');
        const executionOrder = [];
        let activeOperations = 0;
        let maxActiveOperations = 0;
        const onOperationError = vi.fn();

        await runSpotAccountRefreshOperations({
            operations,
            executeOperation: async (operation) => {
                executionOrder.push(operation.type);
                activeOperations += 1;
                maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
                await Promise.resolve();
                activeOperations -= 1;
                if (operation.type === 'balances') throw balancesError;
            },
            onOperationError,
        });

        expect(executionOrder).toEqual(['balances', 'openOrders', 'tradeHistory']);
        expect(maxActiveOperations).toBe(1);
        expect(onOperationError).toHaveBeenCalledTimes(1);
        expect(onOperationError).toHaveBeenCalledWith({
            error: balancesError,
            errorLabel: 'Balances Fetch Error',
            operation: operations[0],
        });
    });

    it('builds detail account snapshot operations with current weights, labels, and payload shapes', async () => {
        const client = makeClient({
            getAccount: vi.fn().mockResolvedValue(makeResponse({
                balances: [{ asset: 'USDT', free: '25.00', locked: '5.00' }],
            })),
            getOpenOrders: vi.fn().mockResolvedValue(makeResponse([{ orderId: 789 }])),
            myTrades: vi.fn().mockResolvedValue(makeResponse([{ id: 321 }])),
        });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        const operations = adapter.getDetailAccountSnapshotOperations('ETHUSDT');

        expect(operations.map(({ type, weight, errorLabel }) => ({ type, weight, errorLabel }))).toEqual([
            { type: 'balances', weight: 20, errorLabel: 'Balances Fetch Error' },
            { type: 'openOrders', weight: 80, errorLabel: 'Open Orders Fetch Error' },
            { type: 'tradeHistory', weight: 20, errorLabel: 'Trade History Fetch Error' },
        ]);
        await expect(operations[0].loadPayload()).resolves.toEqual({
            balances: { USDT: { available: '25.00', onOrder: '5.00' } },
        });
        await expect(operations[1].loadPayload()).resolves.toEqual({
            orders: [{ orderId: 789 }],
        });
        await expect(operations[2].loadPayload()).resolves.toEqual({
            history: [{ id: 321 }],
        });

        expect(client.restAPI.getAccount).toHaveBeenCalledWith({ recvWindow: 60000 });
        expect(client.restAPI.getOpenOrders).toHaveBeenCalledWith({ recvWindow: 60000 });
        expect(client.restAPI.myTrades).toHaveBeenCalledWith({
            symbol: 'ETHUSDT',
            limit: 500,
            recvWindow: 60000,
        });
    });

    it('places LIMIT/GTC spot orders with the existing REST parameter contract', async () => {
        const client = makeClient({
            newOrder: vi.fn().mockResolvedValue(makeResponse({
                symbol: 'BTCUSDT',
                side: 'BUY',
                type: 'LIMIT',
                orderId: 987,
                status: 'NEW',
                price: '12346',
                origQty: '0.0999',
                executedQty: '0',
                transactTime: Date.parse('2026-07-09T10:00:01.000Z'),
            })),
        });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        await expect(adapter.placeOrder({
            symbol: 'BTCUSDT',
            side: 'BUY',
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            numericQuantity: 0.0999,
            numericPrice: 12346,
        })).resolves.toMatchObject({
            e: 'executionReport',
            s: 'BTCUSDT',
            S: 'BUY',
            o: 'LIMIT',
            x: 'NEW',
            X: 'NEW',
            i: 987,
            p: '12346',
            q: '0.0999',
            z: '0',
        });

        expect(client.restAPI.newOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            side: 'BUY',
            type: 'LIMIT',
            timeInForce: 'GTC',
            quantity: '0.0999',
            price: '12346',
            newOrderRespType: 'FULL',
            recvWindow: 60000,
        });
    });

    it('owns the current LIMIT/GTC defaults for validated spot order fields', async () => {
        const client = makeClient({
            newOrder: vi.fn().mockResolvedValue(makeResponse({
                symbol: 'BTCUSDT',
                side: 'BUY',
                type: 'LIMIT',
                orderId: 654,
                status: 'NEW',
                price: '25000',
                origQty: '0.5',
                executedQty: '0',
                transactTime: Date.parse('2026-07-09T10:00:01.000Z'),
            })),
        });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        await expect(adapter.placeOrder({
            symbol: 'BTCUSDT',
            side: 'BUY',
            numericQuantity: 0.5,
            numericPrice: 25000,
        })).resolves.toMatchObject({
            e: 'executionReport',
            s: 'BTCUSDT',
            S: 'BUY',
            o: 'LIMIT',
            x: 'NEW',
            X: 'NEW',
            i: 654,
            p: '25000',
            q: '0.5',
        });

        expect(client.restAPI.newOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            side: 'BUY',
            type: 'LIMIT',
            timeInForce: 'GTC',
            quantity: '0.5',
            price: '25000',
            newOrderRespType: 'FULL',
            recvWindow: 60000,
        });
    });

    it('cancels spot orders with the existing REST parameter contract', async () => {
        const client = makeClient({
            deleteOrder: vi.fn().mockResolvedValue(makeResponse({
                symbol: 'ETHUSDT',
                side: 'SELL',
                type: 'LIMIT',
                orderId: 123,
                price: '3000',
                status: 'CANCELED',
                origQty: '1',
                executedQty: '0',
                updateTime: Date.parse('2026-07-09T10:00:02.000Z'),
            })),
        });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        await expect(adapter.cancelOrder({
            symbol: 'ETHUSDT',
            orderId: '123',
            origClientOrderId: null,
            newClientOrderId: 'cancel-1',
        })).resolves.toMatchObject({
            e: 'executionReport',
            s: 'ETHUSDT',
            S: 'SELL',
            o: 'LIMIT',
            x: 'CANCELED',
            X: 'CANCELED',
            status: 'CANCELED',
            i: 123,
            p: '3000',
            q: '1',
        });

        expect(client.restAPI.deleteOrder).toHaveBeenCalledWith({
            symbol: 'ETHUSDT',
            recvWindow: 60000,
            orderId: '123',
            newClientOrderId: 'cancel-1',
        });
    });

    it('keeps execution report normalization compatible with stream payloads', () => {
        expect(normalizeSpotExecutionReport({
            e: 'executionReport',
            s: 'BTCUSDT',
            S: 'BUY',
            o: 'LIMIT',
            x: 'TRADE',
            X: 'FILLED',
            i: 42,
            p: '50000',
            q: '0.01',
            z: '0.01',
            T: Date.parse('2026-07-09T10:00:03.000Z'),
        })).toEqual({
            e: 'executionReport',
            s: 'BTCUSDT',
            symbol: 'BTCUSDT',
            S: 'BUY',
            side: 'BUY',
            o: 'LIMIT',
            type: 'LIMIT',
            x: 'TRADE',
            X: 'FILLED',
            status: 'FILLED',
            i: 42,
            orderId: 42,
            p: '50000',
            price: '50000',
            q: '0.01',
            origQty: '0.01',
            z: '0.01',
            l: '0',
            T: Date.parse('2026-07-09T10:00:03.000Z'),
            transactTime: Date.parse('2026-07-09T10:00:03.000Z'),
            time: Date.parse('2026-07-09T10:00:03.000Z'),
        });
    });

    it('normalizes executionReport stream events into the existing renderer payload shape', () => {
        const streamEvent = normalizeSpotUserDataStreamEvent({
            e: 'executionReport',
            s: 'BTCUSDT',
            S: 'BUY',
            o: 'LIMIT',
            x: 'TRADE',
            X: 'PARTIALLY_FILLED',
            i: 42,
            p: '50000',
            q: '0.01',
            z: '0.005',
            T: Date.parse('2026-07-09T10:00:04.000Z'),
        });

        expect(streamEvent).toMatchObject({
            type: 'executionReport',
            shouldRefreshBalances: true,
            rendererPayload: {
                execution_update: {
                    e: 'executionReport',
                    s: 'BTCUSDT',
                    symbol: 'BTCUSDT',
                    S: 'BUY',
                    side: 'BUY',
                    o: 'LIMIT',
                    type: 'LIMIT',
                    x: 'TRADE',
                    X: 'PARTIALLY_FILLED',
                    status: 'PARTIALLY_FILLED',
                    i: 42,
                    orderId: 42,
                    p: '50000',
                    price: '50000',
                    q: '0.01',
                    origQty: '0.01',
                    z: '0.005',
                    T: Date.parse('2026-07-09T10:00:04.000Z'),
                    transactTime: Date.parse('2026-07-09T10:00:04.000Z'),
                    time: Date.parse('2026-07-09T10:00:04.000Z'),
                },
            },
        });
        expect(streamEvent.executionReport).toBe(streamEvent.rendererPayload.execution_update);
    });

    it('keeps outboundAccountPosition stream events as balance_update payloads', () => {
        const payload = {
            e: 'outboundAccountPosition',
            u: Date.parse('2026-07-09T10:00:05.000Z'),
            B: [{ a: 'USDT', f: '100.00', l: '0.00' }],
        };

        expect(normalizeSpotUserDataStreamEvent(payload)).toEqual({
            type: 'outboundAccountPosition',
            balanceUpdate: payload,
            rendererPayload: { balance_update: payload },
            shouldRefreshBalances: false,
        });
    });

    it('normalizes balanceUpdate stream events as REST refresh triggers only', () => {
        const payload = {
            e: 'balanceUpdate',
            a: 'USDT',
            d: '25.00',
            T: Date.parse('2026-07-09T10:00:06.000Z'),
        };

        expect(normalizeSpotUserDataStreamEvent(payload)).toEqual({
            type: 'balanceUpdate',
            balanceUpdate: payload,
            rendererPayload: null,
            shouldRefreshBalances: true,
        });
    });

    it('ignores non-account spot stream events', () => {
        expect(normalizeSpotUserDataStreamEvent({ e: '24hrTicker', s: 'BTCUSDT' })).toBeNull();
        expect(normalizeSpotUserDataStreamEvent(null)).toBeNull();
    });

    it('exposes user-data stream normalization through the adapter instance', () => {
        const adapter = new SpotTradingAdapter({ client: makeClient(), recvWindow: 60000 });

        expect(adapter.normalizeUserDataStreamEvent({
            e: 'executionReport',
            s: 'ETHUSDT',
            S: 'SELL',
            X: 'NEW',
        })).toMatchObject({
            type: 'executionReport',
            shouldRefreshBalances: false,
            rendererPayload: {
                execution_update: {
                    e: 'executionReport',
                    s: 'ETHUSDT',
                    S: 'SELL',
                    X: 'NEW',
                    status: 'NEW',
                },
            },
        });
    });


    it('sends the command identity so a resubmission can be deduplicated', async () => {
        const newOrder = vi.fn().mockResolvedValue(makeResponse({
            symbol: 'BTCUSDT', side: 'BUY', status: 'NEW', orderId: 1, clientOrderId: 's-intent-1',
        }));
        const client = makeClient({ newOrder });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        await adapter.placeOrder({
            symbol: 'BTCUSDT',
            side: 'BUY',
            numericQuantity: 0.01,
            numericPrice: 50000,
            newClientOrderId: 's-intent-1',
        });

        expect(newOrder).toHaveBeenCalledWith(expect.objectContaining({
            newClientOrderId: 's-intent-1',
        }));
    });

    it('omits the identity when the command carries none', async () => {
        const newOrder = vi.fn().mockResolvedValue(makeResponse({
            symbol: 'BTCUSDT', side: 'BUY', status: 'NEW', orderId: 1,
        }));
        const client = makeClient({ newOrder });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        await adapter.placeOrder({
            symbol: 'BTCUSDT', side: 'BUY', numericQuantity: 0.01, numericPrice: 50000,
        });

        expect(Object.hasOwn(newOrder.mock.calls[0][0], 'newClientOrderId')).toBe(false);
    });

    it('answers what became of a command by its identity', async () => {
        const getOrder = vi.fn().mockResolvedValue(makeResponse({
            symbol: 'BTCUSDT', side: 'BUY', status: 'FILLED', orderId: 9, clientOrderId: 's-intent-1',
        }));
        const client = makeClient({ getOrder });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        const outcome = await adapter.findOrder({ symbol: 'BTCUSDT', origClientOrderId: 's-intent-1' });

        expect(getOrder).toHaveBeenCalledWith({
            symbol: 'BTCUSDT',
            origClientOrderId: 's-intent-1',
            recvWindow: 60000,
        });
        expect(outcome.exists).toBe(true);
        expect(outcome.report.orderId).toBe(9);
    });

    it('reports the one answer that makes a resubmission safe', async () => {
        const getOrder = vi.fn().mockRejectedValue(
            Object.assign(new Error('Order does not exist.'), { code: -2013 }),
        );
        const client = makeClient({ getOrder });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        await expect(adapter.findOrder({ symbol: 'BTCUSDT', origClientOrderId: 's-intent-1' }))
            .resolves.toEqual({ exists: false, report: null });
    });

    it('does not turn an unrelated failure into "no such order"', async () => {
        const getOrder = vi.fn().mockRejectedValue(
            Object.assign(new Error('Unknown error'), { status: 503 }),
        );
        const client = makeClient({ getOrder });
        const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });

        await expect(adapter.findOrder({ symbol: 'BTCUSDT', origClientOrderId: 's-intent-1' }))
            .rejects.toMatchObject({ status: 503 });
    });
});
