// @vitest-environment node

import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FuturesTradingAdapter,
    buildFuturesMockOrderPlacementExecutionReport,
    normalizeFuturesBalances,
    normalizeFuturesExecutionReport,
    normalizeFuturesPositions,
    normalizeFuturesUserDataStreamEvent,
    parseFuturesExchangeFilters,
} from './futures-trading-adapter.js';

const requests = [];

vi.mock('node:https', () => ({
    default: {
        request: (url, options, onResponse) => {
            const chunks = [];
            const request = {
                on: vi.fn(),
                write: chunk => chunks.push(chunk),
                end: () => {
                    const record = { url: String(url), options, body: chunks.join('') };
                    requests.push(record);
                    const handlers = {};
                    const response = {
                        statusCode: 200,
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
                destroy: vi.fn(),
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

        expect(normalizeFuturesPositions([
            { symbol: 'BTCUSDT', positionAmt: '0.010', positionSide: 'LONG', entryPrice: '57000', markPrice: '58445', unRealizedProfit: '14.45', liquidationPrice: '29000', leverage: '2', marginType: 'isolated', isolatedMargin: '305', notional: '584' },
            { symbol: 'ETHUSDT', positionAmt: '0', positionSide: 'BOTH' },
        ])).toEqual([expect.objectContaining({
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            quantity: '0.010',
            marginType: 'ISOLATED',
        })]);
    });

    it('builds mock placement reports in the shared executionReport shape', () => {
        expect(buildFuturesMockOrderPlacementExecutionReport({
            symbol: 'BTCUSDT',
            side: 'BUY',
            priceValue: '58445.00',
            quantityValue: '0.004',
            positionSide: 'LONG',
            orderId: 7,
            eventTime: 1000,
        })).toMatchObject({
            e: 'executionReport',
            marketType: 'futures',
            symbol: 'BTCUSDT',
            status: 'NEW',
            price: '58445.00',
            origQty: '0.004',
            positionSide: 'LONG',
        });
    });
});
