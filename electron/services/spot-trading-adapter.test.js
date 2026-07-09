import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    SpotTradingAdapter,
    normalizeSpotBalances,
    normalizeSpotExecutionReport,
    normalizeSpotUserDataStreamEvent,
    parseSpotExchangeFilters,
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
        newOrder: vi.fn(),
        deleteOrder: vi.fn(),
        ...overrides,
    },
});

describe('SpotTradingAdapter', () => {
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

    it('builds account refresh operations with the existing weights and renderer payload shapes', async () => {
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
            { type: 'balances', weight: 10 },
            { type: 'openOrders', weight: 3 },
            { type: 'tradeHistory', weight: 10 },
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
            { type: 'balances', weight: 10 },
            { type: 'openOrders', weight: 3 },
        ]);
        await expect(operations[0].loadPayload()).resolves.toEqual({
            balances: { BTC: { available: '0.50', onOrder: '0.10' } },
        });
        await expect(operations[1].loadPayload()).resolves.toEqual({
            orders: [],
        });
        expect(client.restAPI.myTrades).not.toHaveBeenCalled();
    });

    it('builds detail account snapshot operations with existing weights, labels, and payload shapes', async () => {
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
            { type: 'balances', weight: 10, errorLabel: 'Balances Fetch Error' },
            { type: 'openOrders', weight: 3, errorLabel: 'Open Orders Fetch Error' },
            { type: 'tradeHistory', weight: 10, errorLabel: 'Trade History Fetch Error' },
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

    it('cancels spot orders with the existing REST parameter contract', async () => {
        const client = makeClient({
            deleteOrder: vi.fn().mockResolvedValue(makeResponse({
                symbol: 'ETHUSDT',
                side: 'SELL',
                type: 'LIMIT',
                orderId: 123,
                price: '3000',
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
});
