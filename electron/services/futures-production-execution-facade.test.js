import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS,
    FuturesProductionExecutionFacadeError,
    createFuturesProductionExecutionFacade,
} from './futures-production-execution-facade.js';
import {
    FUTURES_PRODUCTION_EXECUTION_INVENTORY_RESPONSE_LIMITS,
    FUTURES_PRODUCTION_EXECUTION_RESPONSE_LIMITS,
    FuturesProductionExecutionJsonError,
    parseFuturesProductionExecutionJson,
    validateFuturesProductionExecutionResponseHeaders,
} from './futures-production-execution-json.js';

const clientOrderId = 'cc7-0123456789abcdef0123456789abcdef';
const config = Object.freeze({
    apiKey: 'production-api-key-fixture',
    apiSecret: 'production-api-secret-fixture',
    allowedSymbols: ['BTCUSDT'],
});
const limitOrder = Object.freeze({
    symbol: 'BTCUSDT',
    side: 'BUY',
    positionSide: 'LONG',
    positionEffect: 'ENTRY',
    quantity: '0.001',
    price: '70000.00',
    clientOrderId,
});

const makeResponse = (body, { status = 200, headers = {}, redirected = false } = {}) => {
    const response = new Response(body, { status, headers });
    if (redirected) Object.defineProperty(response, 'redirected', { value: true });
    return response;
};

const queryOrderBody = `{
    "symbol":"BTCUSDT",
    "orderId":9223372036854775807,
    "clientOrderId":"${clientOrderId}",
    "price":"70000.00",
    "origQty":"0.001",
    "executedQty":"0.000",
    "avgPrice":"0",
    "status":"NEW",
    "timeInForce":"GTC",
    "type":"LIMIT",
    "origType":"LIMIT",
    "reduceOnly":false,
    "closePosition":false,
    "side":"BUY",
    "positionSide":"LONG",
    "updateTime":1783814400000
}`;

const bodyFor = (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/fapi/v1/listenKey') {
        return options.method === 'DELETE'
            ? ''
            : '{"listenKey":"futures-listen-key-0123456789abcdef"}';
    }
    if (parsed.pathname === '/fapi/v1/time') return '{"serverTime":1783814400000}';
    if (parsed.pathname === '/fapi/v1/exchangeInfo') return '{"symbols":[]}';
    if (parsed.pathname === '/fapi/v1/premiumIndex') {
        return '{"symbol":"BTCUSDT","markPrice":"70000.00"}';
    }
    if (parsed.pathname === '/fapi/v1/accountConfig') return '{"canTrade":true}';
    if (parsed.pathname === '/fapi/v1/symbolConfig') return '[{"symbol":"BTCUSDT"}]';
    if (parsed.pathname === '/fapi/v3/balance') return '[]';
    if (parsed.pathname === '/fapi/v3/positionRisk') return '[]';
    if (parsed.pathname === '/fapi/v1/openOrders') return '[]';
    if (parsed.pathname === '/fapi/v1/openAlgoOrders') return '[]';
    if (parsed.pathname === '/fapi/v1/positionMargin/history') return '[]';
    if (parsed.pathname === '/fapi/v1/positionMargin' && options.method === 'POST') {
        return '{"amount":"1.5","code":200,"msg":"success","type":1}';
    }
    if (parsed.pathname === '/fapi/v1/order' && options.method === 'GET') {
        return queryOrderBody;
    }
    if (parsed.pathname === '/fapi/v1/order' && options.method === 'PUT') {
        return queryOrderBody;
    }
    if (parsed.pathname === '/fapi/v1/order' && options.method === 'POST') {
        return `{"symbol":"BTCUSDT","orderId":9007199254740993,"clientOrderId":"${clientOrderId}","transactTime":1783814400001}`;
    }
    if (options.method === 'DELETE') return '{"code":200,"msg":"acknowledged"}';
    throw new Error('unreviewed fake endpoint');
};

describe('FuturesProductionExecutionFacade', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('requires an injected transport and rejects caller network expansion', () => {
        const productionTripwire = vi.fn(() => {
            throw new Error('production network tripwire');
        });
        vi.stubGlobal('fetch', productionTripwire);

        expect(() => createFuturesProductionExecutionFacade(config)).toThrow(
            FuturesProductionExecutionFacadeError,
        );
        expect(() => createFuturesProductionExecutionFacade(
            { ...config, host: 'https://example.invalid' },
            { fetchImpl: vi.fn() },
        )).toThrow(FuturesProductionExecutionFacadeError);
        expect(() => createFuturesProductionExecutionFacade(config, {
            fetchImpl: vi.fn(),
            dispatcher: {},
        })).toThrow(FuturesProductionExecutionFacadeError);
        expect(productionTripwire).not.toHaveBeenCalled();
    });

    it('exposes only the reviewed explicit methods and exact production endpoints', async () => {
        const fetchImpl = vi.fn((url, options) => Promise.resolve(makeResponse(
            bodyFor(url, options),
            { headers: { 'x-mbx-used-weight-1m': '1' } },
        )));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });
        expect(Object.keys(facade)).toEqual([
            'getServerTime',
            'startUserDataStream',
            'keepAliveUserDataStream',
            'closeUserDataStream',
            'connectUserDataStream',
            'getExchangeInfo',
            'getMarkPrice',
            'getAccountConfig',
            'getSymbolConfig',
            'getAllSymbolConfig',
            'getBalance',
            'getPositionRisk',
            'getAllPositionRisk',
            'getOpenOrders',
            'getAllOpenOrders',
            'getOpenAlgoOrders',
            'getAllOpenAlgoOrders',
            'getPositionMarginHistory',
            'modifyIsolatedPositionMargin',
            'placeLimitGtcOrder',
            'placeHedgeMarketExitOrder',
            'modifyLimitOrder',
            'queryOrderByOriginalClientOrderId',
            'cancelAllOpenOrders',
            'cancelAllAlgoOpenOrders',
        ]);

        await facade.getServerTime();
        await facade.startUserDataStream();
        await facade.keepAliveUserDataStream();
        await facade.closeUserDataStream();
        await facade.getExchangeInfo();
        await facade.getMarkPrice('BTCUSDT');
        await facade.getAccountConfig();
        await facade.getSymbolConfig('BTCUSDT');
        await facade.getAllSymbolConfig();
        await facade.getBalance();
        await facade.getPositionRisk('BTCUSDT');
        await facade.getAllPositionRisk();
        await facade.getOpenOrders('BTCUSDT');
        await facade.getAllOpenOrders();
        await facade.getOpenAlgoOrders('BTCUSDT');
        await facade.getAllOpenAlgoOrders();
        await facade.getPositionMarginHistory({
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            marginAction: 'ADD',
            startTime: 1783814400000,
        });
        await facade.modifyIsolatedPositionMargin({
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            marginAction: 'ADD',
            amount: '1.5',
        });
        const limit = await facade.placeLimitGtcOrder(limitOrder);
        await facade.placeHedgeMarketExitOrder({
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            quantity: '0.001',
            clientOrderId,
        });
        await facade.modifyLimitOrder({
            symbol: 'BTCUSDT',
            side: 'BUY',
            positionSide: 'LONG',
            quantity: '0.001',
            price: '70000.00',
            clientOrderId,
        });
        const query = await facade.queryOrderByOriginalClientOrderId({
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            originalClientOrderId: clientOrderId,
        });
        const regularCancel = await facade.cancelAllOpenOrders({ symbol: 'BTCUSDT' });
        await facade.cancelAllAlgoOpenOrders({ symbol: 'BTCUSDT' });

        expect(limit.data.orderId).toBe('9007199254740993');
        expect(query.data.orderId).toBe('9223372036854775807');
        expect(regularCancel.data).toMatchObject({ acknowledged: true, code: 200 });
        expect(limit.receipt).toEqual(expect.objectContaining({
            endpointId: 'new-limit-gtc-order',
            status: 200,
            bodyDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
            rateLimitHeaders: expect.objectContaining({ 'x-mbx-used-weight-1m': '1' }),
        }));

        const paths = fetchImpl.mock.calls.map(([url]) => new URL(url).pathname);
        expect(paths).toEqual([
            '/fapi/v1/time',
            '/fapi/v1/listenKey',
            '/fapi/v1/listenKey',
            '/fapi/v1/listenKey',
            '/fapi/v1/exchangeInfo',
            '/fapi/v1/premiumIndex',
            '/fapi/v1/accountConfig',
            '/fapi/v1/symbolConfig',
            '/fapi/v1/symbolConfig',
            '/fapi/v3/balance',
            '/fapi/v3/positionRisk',
            '/fapi/v3/positionRisk',
            '/fapi/v1/openOrders',
            '/fapi/v1/openOrders',
            '/fapi/v1/openAlgoOrders',
            '/fapi/v1/openAlgoOrders',
            '/fapi/v1/positionMargin/history',
            '/fapi/v1/positionMargin',
            '/fapi/v1/order',
            '/fapi/v1/order',
            '/fapi/v1/order',
            '/fapi/v1/order',
            '/fapi/v1/allOpenOrders',
            '/fapi/v1/algoOpenOrders',
        ]);
        expect(new URL(fetchImpl.mock.calls[7][0]).searchParams.get('symbol')).toBe('BTCUSDT');
        expect(new URL(fetchImpl.mock.calls[8][0]).searchParams.has('symbol')).toBe(false);
        expect(new URL(fetchImpl.mock.calls[10][0]).searchParams.get('symbol')).toBe('BTCUSDT');
        expect(new URL(fetchImpl.mock.calls[11][0]).searchParams.has('symbol')).toBe(false);
        expect(new URL(fetchImpl.mock.calls[12][0]).searchParams.get('symbol')).toBe('BTCUSDT');
        expect(new URL(fetchImpl.mock.calls[13][0]).searchParams.has('symbol')).toBe(false);
        expect(new URL(fetchImpl.mock.calls[14][0]).searchParams.get('symbol')).toBe('BTCUSDT');
        expect(new URL(fetchImpl.mock.calls[15][0]).searchParams.has('symbol')).toBe(false);
        for (const [url, options] of fetchImpl.mock.calls) {
            expect(new URL(url).origin).toBe('https://fapi.binance.com');
            expect(options.redirect).toBe('error');
            expect(Object.keys(options).sort()).toEqual(expect.arrayContaining([
                'headers', 'method', 'redirect', 'signal',
            ]));
        }
    });

    it('signs and normalizes each all-symbol inventory without a symbol query', async () => {
        const responses = new Map([
            ['/fapi/v1/symbolConfig', JSON.stringify([{
                symbol: 'BTCUSDT',
                marginType: 'ISOLATED',
                leverage: 2,
                isAutoAddMargin: 'false',
            }])],
            ['/fapi/v1/openOrders', `[{"symbol":"BTCUSDT","orderId":9223372036854775807,"clientOrderId":"external-order"}]`],
            ['/fapi/v1/openAlgoOrders', `[{"symbol":"BTCUSDT","algoId":9223372036854775806,"clientAlgoId":"external-algo"}]`],
        ]);
        const fetchImpl = vi.fn(async (url) => makeResponse(
            responses.get(new URL(url).pathname),
        ));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });

        const results = await Promise.all([
            facade.getAllSymbolConfig(),
            facade.getAllOpenOrders(),
            facade.getAllOpenAlgoOrders(),
        ]);

        expect(results[0].data).toEqual([{
            symbol: 'BTCUSDT',
            marginType: 'ISOLATED',
            leverage: 2,
            isAutoAddMargin: 'false',
        }]);
        expect(results[1].data[0].orderId).toBe('9223372036854775807');
        expect(results[2].data[0].algoId).toBe('9223372036854775806');
        expect(results.map(result => result.receipt.endpointId)).toEqual([
            'all-symbol-config',
            'all-open-orders',
            'all-open-algo-orders',
        ]);
        for (const result of results) {
            expect(Object.isFrozen(result.data)).toBe(true);
            expect(Object.isFrozen(result.data[0])).toBe(true);
        }
        const unsigned = 'recvWindow=5000&timestamp=1783814400000';
        const signature = createHmac('sha256', config.apiSecret).update(unsigned).digest('hex');
        expect(fetchImpl.mock.calls.map(([url, options]) => ({
            pathname: new URL(url).pathname,
            search: new URL(url).search.slice(1),
            method: options.method,
        }))).toEqual([
            {
                pathname: '/fapi/v1/symbolConfig',
                search: `${unsigned}&signature=${signature}`,
                method: 'GET',
            },
            {
                pathname: '/fapi/v1/openOrders',
                search: `${unsigned}&signature=${signature}`,
                method: 'GET',
            },
            {
                pathname: '/fapi/v1/openAlgoOrders',
                search: `${unsigned}&signature=${signature}`,
                method: 'GET',
            },
        ]);
        for (const [url] of fetchImpl.mock.calls) {
            expect(new URL(url).searchParams.has('symbol')).toBe(false);
        }
    });

    it('accepts bounded Unicode and delivery symbols only on exchange inventory ingress', async () => {
        const rows = [
            { symbol: 'BTCUSDT', orderId: '1' },
            { symbol: '币安人生USDT', orderId: '2' },
            { symbol: 'BTCUSDT_250926', orderId: '3' },
        ];
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(JSON.stringify(rows)));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });

        await expect(facade.getAllOpenOrders()).resolves.toMatchObject({ data: rows });
        expect(() => facade.getOpenOrders('币安人生USDT')).toThrow(
            FuturesProductionExecutionFacadeError,
        );
        expect(() => facade.getOpenOrders('BTCUSDT_250926')).toThrow(
            FuturesProductionExecutionFacadeError,
        );
        expect(fetchImpl).toHaveBeenCalledOnce();

        const lowercaseFacade = createFuturesProductionExecutionFacade(config, {
            fetchImpl: vi.fn().mockResolvedValue(makeResponse(
                '[{"symbol":"биткоинUSDT","orderId":4}]',
            )),
            now: () => 1783814400000,
        });
        await expect(lowercaseFacade.getAllOpenOrders()).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
        });
    });

    it.each([
        ['symbol configuration', 'getAllSymbolConfig', 'all-symbol-config', '[{"symbol":"btcusdt"}]'],
        ['regular orders', 'getAllOpenOrders', 'all-open-orders', '[{"orderId":1}]'],
        ['algo orders', 'getAllOpenAlgoOrders', 'all-open-algo-orders', '{}'],
    ])('rejects malformed all-symbol %s inventory', async (
        _label,
        method,
        endpointId,
        body,
    ) => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(body));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });
        await expect(facade[method]()).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            endpointId,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('uses API-key-only listenKey requests without HMAC signing', async () => {
        const fetchImpl = vi.fn((url, options) => Promise.resolve(makeResponse(
            bodyFor(url, options),
        )));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });

        await expect(facade.startUserDataStream()).resolves.toMatchObject({
            data: { listenKey: 'futures-listen-key-0123456789abcdef' },
        });
        await expect(facade.keepAliveUserDataStream()).resolves.toMatchObject({
            data: { listenKey: 'futures-listen-key-0123456789abcdef' },
        });
        await expect(facade.closeUserDataStream()).resolves.toMatchObject({
            data: { acknowledged: true },
        });

        expect(fetchImpl.mock.calls.map(([, options]) => options.method))
            .toEqual(['POST', 'PUT', 'DELETE']);
        for (const [url, options] of fetchImpl.mock.calls) {
            expect(url).toBe('https://fapi.binance.com/fapi/v1/listenKey');
            expect(options.headers['X-MBX-APIKEY']).toBe(config.apiKey);
            expect(`${url}\n${options.body ?? ''}`).not.toMatch(/signature|timestamp|recvWindow/);
        }
    });

    it('accepts only an exact empty 2xx body for the listenKey close endpoint', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(makeResponse(''))
            .mockResolvedValueOnce(makeResponse(''))
            .mockResolvedValueOnce(makeResponse(' '))
            .mockResolvedValueOnce(makeResponse('', { status: 400 }));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });

        await expect(facade.keepAliveUserDataStream()).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            endpointId: 'user-data-stream-keepalive',
        });
        await expect(facade.closeUserDataStream()).resolves.toMatchObject({
            data: { acknowledged: true },
        });
        await expect(facade.closeUserDataStream()).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            endpointId: 'user-data-stream-close',
        });
        await expect(facade.closeUserDataStream()).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            endpointId: 'user-data-stream-close',
            status: 400,
        });
    });

    it.each([
        ['symbol configuration', 'getAllSymbolConfig', index => ({
            symbol: `S${index}USDT`,
            marginType: 'ISOLATED',
            leverage: 2,
            isAutoAddMargin: 'false',
        })],
        ['position risk', 'getAllPositionRisk', index => ({
            symbol: `S${index}USDT`,
            positionSide: 'BOTH',
            positionAmt: '0.000',
            entryPrice: '0.00000000',
            breakEvenPrice: '0.00000000',
            markPrice: '70000.00000000',
            unrealizedProfit: '0.00000000',
            liquidationPrice: '0',
            isolatedMargin: '0',
            notional: '0',
            marginAsset: 'USDT',
            isolatedWallet: '0',
            initialMargin: '0',
            maintMargin: '0',
            positionInitialMargin: '0',
            openOrderInitialMargin: '0',
            adl: 0,
            bidNotional: '0',
            askNotional: '0',
            updateTime: 1783814400000,
        })],
        ['regular open orders', 'getAllOpenOrders', index => ({
            symbol: `S${index}USDT`,
            orderId: index + 1,
            clientOrderId: `external-${index}`,
            price: '70000.00',
            origQty: '0.001',
            executedQty: '0.000',
            status: 'NEW',
            timeInForce: 'GTC',
            type: 'LIMIT',
            side: 'BUY',
            positionSide: 'LONG',
            updateTime: 1783814400000,
        })],
        ['algo open orders', 'getAllOpenAlgoOrders', index => ({
            symbol: `S${index}USDT`,
            algoId: index + 1,
            clientAlgoId: `external-algo-${index}`,
            algoStatus: 'NEW',
            orderType: 'STOP_MARKET',
            quantity: '0.001',
            triggerPrice: '69000.00',
            side: 'SELL',
            positionSide: 'LONG',
            createTime: 1783814400000,
            updateTime: 1783814400000,
        })],
    ])('accepts a realistic >64 KiB all-symbol %s inventory', async (
        _label,
        method,
        createRow,
    ) => {
        const rows = Array.from({ length: 1_000 }, (_, index) => createRow(index));
        const body = JSON.stringify(rows);
        expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(
            FUTURES_PRODUCTION_EXECUTION_RESPONSE_LIMITS.BODY_BYTES,
        );
        expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(
            FUTURES_PRODUCTION_EXECUTION_INVENTORY_RESPONSE_LIMITS.BODY_BYTES,
        );
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(body));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });

        const result = await facade[method]();
        expect(result.data).toHaveLength(rows.length);
        expect(result.data[999].symbol).toBe('S999USDT');
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('signs the fixed LIMIT/GTC body in reviewed parameter order', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(
            `{"symbol":"BTCUSDT","orderId":1,"clientOrderId":"${clientOrderId}"}`,
        ));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });
        await facade.placeLimitGtcOrder(limitOrder);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://fapi.binance.com/fapi/v1/order');
        const unsigned = [
            'symbol=BTCUSDT',
            'side=BUY',
            'type=LIMIT',
            'timeInForce=GTC',
            'quantity=0.001',
            'price=70000.00',
            'positionSide=LONG',
            `newClientOrderId=${clientOrderId}`,
            'newOrderRespType=ACK',
            'recvWindow=5000',
            'timestamp=1783814400000',
        ].join('&');
        const signature = createHmac('sha256', config.apiSecret)
            .update(unsigned)
            .digest('hex');
        expect(options).toMatchObject({
            method: 'POST',
            redirect: 'error',
            headers: {
                'X-MBX-APIKEY': config.apiKey,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `${unsigned}&signature=${signature}`,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('sends one exact Hedge isolated-margin POST with no retry or caller URL expansion', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(
            '{"amount":5.25,"code":200,"msg":"success","type":2}',
        ));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });
        const response = await facade.modifyIsolatedPositionMargin({
            symbol: 'BTCUSDT',
            positionSide: 'SHORT',
            marginAction: 'REDUCE',
            amount: '5.25',
        });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://fapi.binance.com/fapi/v1/positionMargin');
        expect(options.method).toBe('POST');
        const body = new URLSearchParams(options.body);
        expect([...body.keys()]).toEqual([
            'symbol', 'amount', 'type', 'positionSide', 'recvWindow', 'timestamp', 'signature',
        ]);
        expect(Object.fromEntries(body)).toMatchObject({
            symbol: 'BTCUSDT',
            amount: '5.25',
            type: '2',
            positionSide: 'SHORT',
            recvWindow: '5000',
            timestamp: '1783814400000',
        });
        expect(response.data).toMatchObject({
            acknowledged: true,
            type: 2,
            amount: '5.25',
        });
    });

    it('sends one exact owned LIMIT amendment PUT and preserves immutable identity', async () => {
        const modifiedBody = queryOrderBody
            .replaceAll('70000.00', '70100.10')
            .replace('    "avgPrice":"0",\n', '');
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(modifiedBody));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });
        const response = await facade.modifyLimitOrder({
            symbol: 'BTCUSDT',
            side: 'BUY',
            positionSide: 'LONG',
            quantity: '0.001',
            price: '70100.10',
            clientOrderId,
        });

        expect(fetchImpl).toHaveBeenCalledOnce();
        const [url, options] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://fapi.binance.com/fapi/v1/order');
        expect(options.method).toBe('PUT');
        expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
        const body = new URLSearchParams(options.body);
        expect([...body.keys()]).toEqual([
            'symbol', 'side', 'quantity', 'price', 'origClientOrderId',
            'recvWindow', 'timestamp', 'signature',
        ]);
        expect(Object.fromEntries(body)).toMatchObject({
            symbol: 'BTCUSDT',
            side: 'BUY',
            quantity: '0.001',
            price: '70100.10',
            origClientOrderId: clientOrderId,
            recvWindow: '5000',
            timestamp: '1783814400000',
        });
        expect(response.data).toMatchObject({
            orderId: '9223372036854775807',
            clientOrderId,
            price: '70100.10',
            originalQuantity: '0.001',
            positionSide: 'LONG',
        });
    });

    it('amends and queries a pre-existing external Binance order by client ID', async () => {
        const externalClientOrderId = 'external-order-20260718';
        const queriedExternalOrderBody = queryOrderBody
            .replaceAll(clientOrderId, externalClientOrderId)
            .replaceAll('70000.00', '70100.10');
        const modifiedExternalOrderBody = queriedExternalOrderBody
            .replace('    "avgPrice":"0",\n', '');
        const fetchImpl = vi.fn().mockImplementation(async (_url, options) => makeResponse(
            options.method === 'PUT' ? modifiedExternalOrderBody : queriedExternalOrderBody,
        ));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });

        await facade.modifyLimitOrder({
            symbol: 'BTCUSDT',
            side: 'BUY',
            positionSide: 'LONG',
            quantity: '0.001',
            price: '70100.10',
            clientOrderId: externalClientOrderId,
        });
        await facade.queryOrderByOriginalClientOrderId({
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            originalClientOrderId: externalClientOrderId,
        });

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(new URLSearchParams(fetchImpl.mock.calls[0][1].body).get('origClientOrderId'))
            .toBe(externalClientOrderId);
        expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get('origClientOrderId'))
            .toBe(externalClientOrderId);
    });

    it('sends a distinct Hedge LONG exit MARKET child without forbidden reduceOnly', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(
            `{"symbol":"BTCUSDT","orderId":1,"clientOrderId":"${clientOrderId}"}`,
        ));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });
        await facade.placeHedgeMarketExitOrder({
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            quantity: '0.001',
            clientOrderId,
        });
        const unsigned = [
            'symbol=BTCUSDT',
            'side=SELL',
            'type=MARKET',
            'quantity=0.001',
            'positionSide=LONG',
            `newClientOrderId=${clientOrderId}`,
            'newOrderRespType=ACK',
            'recvWindow=5000',
            'timestamp=1783814400000',
        ].join('&');
        const signature = '627c765b8a367c2046a71999c7d646ebfc6abf6be67037883e78df3849ca7af1';
        expect(fetchImpl.mock.calls[0]).toEqual([
            'https://fapi.binance.com/fapi/v1/order',
            {
                method: 'POST',
                headers: {
                    'X-MBX-APIKEY': config.apiKey,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `${unsigned}&signature=${signature}`,
                redirect: 'error',
                signal: expect.any(AbortSignal),
            },
        ]);
        expect(createHmac('sha256', config.apiSecret).update(unsigned).digest('hex'))
            .toBe(signature);
        const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
        expect(body.has('price')).toBe(false);
        expect(body.has('timeInForce')).toBe(false);
        expect(body.has('reduceOnly')).toBe(false);
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it.each([
        {
            label: 'Query Order',
            invoke: facade => facade.queryOrderByOriginalClientOrderId({
                symbol: 'BTCUSDT',
                positionSide: 'LONG',
                originalClientOrderId: clientOrderId,
            }),
            pathname: '/fapi/v1/order',
            unsigned: `symbol=BTCUSDT&origClientOrderId=${clientOrderId}&recvWindow=5000&timestamp=1783814400000`,
            signature: 'ed700b6e08e9239e622beed850e264bb20a38e62710720a2c0bc659e5c2c0036',
            response: queryOrderBody,
        },
        {
            label: 'cancel all regular orders',
            invoke: facade => facade.cancelAllOpenOrders({ symbol: 'BTCUSDT' }),
            pathname: '/fapi/v1/allOpenOrders',
            unsigned: 'symbol=BTCUSDT&recvWindow=5000&timestamp=1783814400000',
            signature: '911404f81b11d3d78d69f151428e35860f9981c132dba881367b3567c6879bc7',
            response: '{"code":200,"msg":"acknowledged"}',
        },
        {
            label: 'cancel all algo orders',
            invoke: facade => facade.cancelAllAlgoOpenOrders({ symbol: 'BTCUSDT' }),
            pathname: '/fapi/v1/algoOpenOrders',
            unsigned: 'symbol=BTCUSDT&recvWindow=5000&timestamp=1783814400000',
            signature: '911404f81b11d3d78d69f151428e35860f9981c132dba881367b3567c6879bc7',
            response: '{"code":200,"msg":"acknowledged"}',
        },
    ])('transmits the exact signed $label GET/DELETE vector once', async ({
        invoke,
        pathname,
        unsigned,
        signature,
        response,
    }) => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(response));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });
        await invoke(facade);
        expect(createHmac('sha256', config.apiSecret).update(unsigned).digest('hex'))
            .toBe(signature);
        expect(fetchImpl.mock.calls[0]).toEqual([
            `https://fapi.binance.com${pathname}?${unsigned}&signature=${signature}`,
            {
                method: pathname === '/fapi/v1/order' ? 'GET' : 'DELETE',
                headers: { 'X-MBX-APIKEY': config.apiKey },
                redirect: 'error',
                signal: expect.any(AbortSignal),
            },
        ]);
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it.each([
        ['Hedge MARKET exit POST', facade => facade.placeHedgeMarketExitOrder({
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            quantity: '0.001',
            clientOrderId,
        })],
        ['Query Order GET', facade => facade.queryOrderByOriginalClientOrderId({
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            originalClientOrderId: clientOrderId,
        })],
        ['cancel-all regular DELETE', facade => facade.cancelAllOpenOrders({
            symbol: 'BTCUSDT',
        })],
        ['cancel-all algo DELETE', facade => facade.cancelAllAlgoOpenOrders({
            symbol: 'BTCUSDT',
        })],
    ])('does not retry a failed %s', async (_label, invoke) => {
        const fetchImpl = vi.fn().mockResolvedValue(makeResponse(
            '{"code":-1000,"msg":"unknown"}',
            { status: 503 },
        ));
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1783814400000,
        });
        await expect(invoke(facade)).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it.each([
        ['network loss', () => Promise.reject(new Error('secret-bearing cause'))],
        ['redirect', () => Promise.resolve(makeResponse('{}', { status: 302 }))],
        ['redirected response', () => Promise.resolve(makeResponse('{}', { redirected: true }))],
        ['408', () => Promise.resolve(makeResponse('{"code":-1007,"msg":"timeout"}', { status: 408 }))],
        ['503', () => Promise.resolve(makeResponse('{"code":-1000,"msg":"unknown"}', { status: 503 }))],
        ['malformed success', () => Promise.resolve(makeResponse('{"symbol":'))],
        ['duplicate key', () => Promise.resolve(makeResponse('{"orderId":1,"orderId":2}'))],
    ])('never retries an order POST after %s', async (_label, outcome) => {
        const fetchImpl = vi.fn().mockImplementation(outcome);
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1,
        });
        await expect(facade.placeLimitGtcOrder(limitOrder)).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('classifies only reviewed error pairs and keeps -2013 as Query Order not-found', async () => {
        const rateFetch = vi.fn().mockResolvedValue(makeResponse(
            '{"code":-1003,"msg":"bounded"}',
            { status: 429, headers: { 'retry-after': '10' } },
        ));
        const rateFacade = createFuturesProductionExecutionFacade(config, {
            fetchImpl: rateFetch,
            now: () => 1,
        });
        await expect(rateFacade.placeLimitGtcOrder(limitOrder)).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.RATE_LIMITED,
            status: 429,
            binanceCode: -1003,
            rateLimitHeaders: expect.objectContaining({ 'retry-after': '10' }),
        });

        const queryFacade = createFuturesProductionExecutionFacade(config, {
            fetchImpl: vi.fn().mockResolvedValue(makeResponse(
                '{"code":-2013,"msg":"Order does not exist."}',
                { status: 400 },
            )),
            now: () => 1,
        });
        await expect(queryFacade.queryOrderByOriginalClientOrderId({
            symbol: 'BTCUSDT',
            positionSide: 'LONG',
            originalClientOrderId: clientOrderId,
        })).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.NOT_FOUND,
        });

        const rejectedFacade = createFuturesProductionExecutionFacade(config, {
            fetchImpl: vi.fn().mockResolvedValue(makeResponse(
                '{"code":-4131,"msg":"The counterparty best price does not meet the PERCENT_PRICE filter limit."}',
                { status: 400 },
            )),
            now: () => 1,
        });
        await expect(rejectedFacade.placeLimitGtcOrder(limitOrder)).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED,
            binanceCode: -4131,
        });

        const ambiguousFacade = createFuturesProductionExecutionFacade(config, {
            fetchImpl: vi.fn().mockResolvedValue(makeResponse(
                '{"code":-1006,"msg":"An unexpected response was received from the message bus."}',
                { status: 400 },
            )),
            now: () => 1,
        });
        await expect(ambiguousFacade.placeLimitGtcOrder(limitOrder)).rejects.toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            binanceCode: -1006,
        });
    });

    it('enforces the ten-second whole-operation deadline', async () => {
        vi.useFakeTimers();
        let signal;
        const fetchImpl = vi.fn((_url, options) => {
            signal = options.signal;
            return new Promise(() => {});
        });
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1,
        });
        const observed = facade.placeLimitGtcOrder(limitOrder).catch(error => error);
        await vi.advanceTimersByTimeAsync(10_000);
        const error = await observed;
        expect(error).toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeLimitGtcOrder',
        });
        expect(signal.aborted).toBe(true);
        expect(error).not.toHaveProperty('cause');
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('aborts and cancels a stalled streaming body within the whole-operation deadline', async () => {
        vi.useFakeTimers();
        const read = vi.fn(() => new Promise(() => {}));
        const cancel = vi.fn().mockResolvedValue(undefined);
        let signal;
        const fetchImpl = vi.fn((_url, options) => {
            signal = options.signal;
            return Promise.resolve({
                status: 200,
                redirected: false,
                headers: new Headers({ 'x-mbx-used-weight-1m': '1' }),
                body: {
                    getReader: () => ({ read, cancel }),
                },
            });
        });
        const facade = createFuturesProductionExecutionFacade(config, {
            fetchImpl,
            now: () => 1,
        });
        const observed = facade.placeLimitGtcOrder(limitOrder).catch(error => error);
        await vi.advanceTimersByTimeAsync(9_999);
        expect(read).toHaveBeenCalledOnce();
        expect(cancel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        const error = await observed;
        expect(error).toMatchObject({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            operation: 'placeLimitGtcOrder',
        });
        expect(signal.aborted).toBe(true);
        expect(cancel).toHaveBeenCalledOnce();
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('fails closed on body, header, message, and tree resource overflow', async () => {
        const cases = [
            makeResponse('x'.repeat(65_537)),
            makeResponse(
                `{"code":-1003,"msg":"${'x'.repeat(513)}"}`,
                { status: 429 },
            ),
            makeResponse(`[${Array.from({ length: 1_025 }, () => '0').join(',')}]`),
            makeResponse('{}', {
                headers: Object.fromEntries(
                    Array.from({ length: 65 }, (_, index) => [`x-${index}`, '1']),
                ),
            }),
        ];
        for (const response of cases) {
            const facade = createFuturesProductionExecutionFacade(config, {
                fetchImpl: vi.fn().mockResolvedValue(response),
                now: () => 1,
            });
            await expect(facade.placeLimitGtcOrder(limitOrder)).rejects.toMatchObject({
                kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AMBIGUOUS,
            });
        }
    });

    it('rejects expanded or malformed write arguments before transport', () => {
        const fetchImpl = vi.fn();
        const facade = createFuturesProductionExecutionFacade(config, { fetchImpl });
        expect(() => facade.placeLimitGtcOrder({
            ...limitOrder,
            host: 'https://example.invalid',
        })).toThrow(expect.objectContaining({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.ARGUMENT,
        }));
        expect(() => facade.cancelAllOpenOrders({
            symbol: 'ETHUSDT',
        })).toThrow(expect.objectContaining({
            kind: FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.ARGUMENT,
        }));
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('bounded production execution JSON', () => {
    it('retains signed-int64 tokens without Number coercion', () => {
        const parsed = parseFuturesProductionExecutionJson(
            '{"orderId":9223372036854775807}',
        );
        expect(parsed.orderId.token).toBe('9223372036854775807');
    });

    it.each([
        '{"a":1,"\\u0061":2}',
        '{"value":1.5}',
        '{"value":1e3}',
        `{"value":"${'x'.repeat(4_097)}"}`,
    ])('rejects duplicate, non-integer, or oversized JSON %s', (body) => {
        expect(() => parseFuturesProductionExecutionJson(body))
            .toThrow(FuturesProductionExecutionJsonError);
    });

    it.each([
        `{"value":"${'x'.repeat(
            FUTURES_PRODUCTION_EXECUTION_INVENTORY_RESPONSE_LIMITS.BODY_BYTES,
        )}"}`,
        `[${Array.from(
            { length: FUTURES_PRODUCTION_EXECUTION_INVENTORY_RESPONSE_LIMITS.JSON_NODES },
            () => '0',
        ).join(',')}]`,
        '[[[[[[[[[[0]]]]]]]]]]',
        `{"value":"${'x'.repeat(4_097)}"}`,
    ])('retains body, node, depth, and string caps in the inventory profile', (body) => {
        expect(() => parseFuturesProductionExecutionJson(
            body,
            FUTURES_PRODUCTION_EXECUTION_INVENTORY_RESPONSE_LIMITS,
        )).toThrow(FuturesProductionExecutionJsonError);
    });

    it('accepts the exact response-header bounds', () => {
        expect(() => validateFuturesProductionExecutionResponseHeaders(
            Object.fromEntries(Array.from(
                { length: FUTURES_PRODUCTION_EXECUTION_RESPONSE_LIMITS.HEADER_COUNT },
                (_, index) => [`x-${index}`, '1'],
            )),
        )).not.toThrow();
        expect(() => validateFuturesProductionExecutionResponseHeaders({
            exact: 'x'.repeat(
                FUTURES_PRODUCTION_EXECUTION_RESPONSE_LIMITS.HEADER_VALUE_BYTES,
            ),
        })).not.toThrow();
        expect(() => validateFuturesProductionExecutionResponseHeaders(
            Object.fromEntries(Array.from(
                { length: 8 },
                (_, index) => [
                    String(index),
                    'x'.repeat(4_095),
                ],
            )),
        )).not.toThrow();
    });

    it('stops a finite 65-item response-header iterator at item 65', () => {
        let nextCalls = 0;
        const headers = {
            entries: () => ({
                next: () => {
                    nextCalls += 1;
                    return nextCalls <= 65
                        ? { done: false, value: [`x-${nextCalls}`, '1'] }
                        : { done: true };
                },
            }),
        };

        expect(() => validateFuturesProductionExecutionResponseHeaders(headers))
            .toThrow(expect.objectContaining({ code: 'RESPONSE_HEADERS_TOO_LARGE' }));
        expect(nextCalls).toBe(65);
    });

    it('never exhausts an effectively infinite response-header iterator', () => {
        let nextCalls = 0;
        const headers = {
            entries: () => ({
                next: () => {
                    nextCalls += 1;
                    return { done: false, value: [`x-${nextCalls}`, '1'] };
                },
            }),
        };

        expect(() => validateFuturesProductionExecutionResponseHeaders(headers))
            .toThrow(expect.objectContaining({ code: 'RESPONSE_HEADERS_TOO_LARGE' }));
        expect(nextCalls).toBeLessThanOrEqual(65);
    });

    it.each([
        [() => null],
        [() => ({ next: () => null })],
        [() => ({ next: () => ({ done: 'no', value: ['x', '1'] }) })],
        [() => ({ next: () => ({ done: false, value: ['x'] }) })],
    ])('rejects malformed response-header iterator protocol', (entries) => {
        expect(() => validateFuturesProductionExecutionResponseHeaders({ entries }))
            .toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE_HEADERS' }));
    });
});
