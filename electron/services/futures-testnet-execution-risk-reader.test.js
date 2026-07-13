import { describe, expect, it, vi } from 'vitest';
import { evaluateFuturesTestnetExecutionRisk } from './futures-testnet-execution-risk.js';
import {
    FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS,
    FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN,
} from './futures-testnet-execution-coordinator.js';
import {
    FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES,
    FUTURES_TESTNET_EXECUTION_RISK_READER_FRESHNESS,
    FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS,
    FuturesTestnetExecutionRiskReader,
} from './futures-testnet-execution-risk-reader.js';
import { createFuturesTestnetExecutionReadRequest } from './futures-testnet-execution-read-request.js';

const SERVER_TIME = 1783814400000;
const REQUEST_ID = '0123456789abcdef0123456789abcdef';
const OWNERSHIP = Object.freeze({
    symbol: 'BTCUSDT',
    credentialIdentity: 'credential-1',
    connectionIdentity: 'connection-1',
    sessionIdentity: 'session-1',
    generation: 'generation-1',
});

const makeResponses = () => ({
    '/fapi/v1/time': {
        serverTime: SERVER_TIME,
    },
    '/fapi/v1/exchangeInfo': {
        timezone: 'UTC',
        symbols: [
            {
                symbol: 'ETHUSDT',
                ignored: true,
            },
            {
                symbol: 'BTCUSDT',
                status: 'TRADING',
                contractType: 'PERPETUAL',
                quoteAsset: 'USDT',
                marginAsset: 'USDT',
                orderTypes: ['LIMIT', 'MARKET'],
                timeInForce: ['GTC', 'IOC'],
                filters: [
                    {
                        filterType: 'PRICE_FILTER',
                        minPrice: '0',
                        maxPrice: '1000000.0',
                        tickSize: '0.1',
                    },
                    {
                        filterType: 'PERCENT_PRICE',
                        multiplierUp: '1.2',
                        multiplierDown: '0.8',
                        multiplierDecimal: 1,
                    },
                    {
                        filterType: 'LOT_SIZE',
                        minQty: '0.1',
                        maxQty: '10.0',
                        stepSize: '0.1',
                    },
                    {
                        filterType: 'MIN_NOTIONAL',
                        notional: '10.0',
                    },
                    {
                        filterType: 'MAX_NUM_ORDERS',
                        limit: 1,
                    },
                ],
            },
        ],
    },
    '/fapi/v1/accountConfig': {
        canTrade: true,
        dualSidePosition: false,
        multiAssetsMargin: false,
    },
    '/fapi/v1/symbolConfig': [{
        symbol: 'BTCUSDT',
        marginType: 'ISOLATED',
        isAutoAddMargin: 'false',
        leverage: 3,
        maxNotionalValue: '200.0',
    }],
    '/fapi/v3/positionRisk': [{
        symbol: 'BTCUSDT',
        positionSide: 'BOTH',
        positionAmt: '1.0',
        liquidationPrice: '90.0',
        marginAsset: 'USDT',
        notional: '100.0',
        isolatedWallet: '20.0',
        isolatedMargin: '20.0',
        initialMargin: '10.0',
        maintMargin: '1.0',
        positionInitialMargin: '10.0',
        openOrderInitialMargin: '0',
        updateTime: SERVER_TIME + 100,
    }],
    '/fapi/v3/balance': [
        {
            accountAlias: 'demo-account-1',
            asset: 'BNB',
            availableBalance: '2.0',
            marginAvailable: true,
            updateTime: SERVER_TIME + 100,
        },
        {
            accountAlias: 'demo-account-1',
            asset: 'USDT',
            availableBalance: '10.0',
            marginAvailable: true,
            updateTime: SERVER_TIME + 200,
        },
    ],
    '/fapi/v1/openOrders': [],
    '/fapi/v1/openAlgoOrders': [],
    '/fapi/v1/premiumIndex': {
        symbol: 'BTCUSDT',
        markPrice: '100.0',
        time: SERVER_TIME + 500,
    },
});

const createHarness = ({
    responses = makeResponses(),
    requestMutation,
    owns = () => true,
    requestElapsedMs = 100,
} = {}) => {
    let monotonic = 1_000;
    const requests = [];
    const weights = [];
    const release = vi.fn();
    const request = vi.fn(async (options) => {
        requests.push(options);
        monotonic += typeof requestElapsedMs === 'function'
            ? requestElapsedMs(options)
            : requestElapsedMs;
        const replacement = requestMutation?.({ options, responses, requests, monotonic });
        if (replacement !== undefined) return replacement;
        return structuredClone(responses[options.path]);
    });
    const lease = {
        executeGet: vi.fn(async (operation, weight, options) => {
            weights.push({ weight, options });
            return operation();
        }),
        release,
    };
    const coordinator = {
        beginPreflight: vi.fn().mockResolvedValue(lease),
    };
    const reader = new FuturesTestnetExecutionRiskReader({
        request,
        coordinator,
        wallNow: () => SERVER_TIME - 50,
        monotonicNow: () => monotonic,
        owns,
    });
    return {
        coordinator,
        lease,
        reader,
        release,
        request,
        requests,
        weights,
        advanceMonotonic: value => { monotonic += value; },
    };
};

const makeCommand = () => ({
    action: 'futures.execution.placeOrder',
    version: 1,
    requestId: REQUEST_ID,
    marketType: 'futures',
    environment: 'testnet',
    symbol: 'BTCUSDT',
    side: 'SELL',
    orderType: 'LIMIT',
    quantity: '0.1',
    price: '100.0',
    timeInForce: 'GTC',
    positionSide: 'BOTH',
    marginType: 'ISOLATED',
    leverage: 3,
    reduceOnly: true,
    workingType: null,
    priceProtect: false,
    clientOrderId: `cc6-${REQUEST_ID}`,
});

const POLICY = Object.freeze({
    allowedSymbols: ['BTCUSDT'],
    maxNotionalUsdt: '100.0',
    maxLeverage: 3,
    minAvailableBalanceUsdt: '1.0',
    minLiquidationDistanceBps: '1000',
});

describe('FuturesTestnetExecutionRiskReader fixed transport', () => {
    it('reads the exact nine demo endpoints in order with mark last exactly once', async () => {
        const harness = createHarness();
        const bundle = await harness.reader.readPreflight(OWNERSHIP);

        expect(harness.requests.map(({ path }) => path)).toEqual([
            '/fapi/v1/time',
            '/fapi/v1/exchangeInfo',
            '/fapi/v1/accountConfig',
            '/fapi/v1/symbolConfig',
            '/fapi/v3/positionRisk',
            '/fapi/v3/balance',
            '/fapi/v1/openOrders',
            '/fapi/v1/openAlgoOrders',
            '/fapi/v1/premiumIndex',
        ]);
        expect(harness.requests.filter(
            ({ path }) => path === '/fapi/v1/premiumIndex',
        )).toHaveLength(1);
        expect(harness.requests.every(({ origin, method, redirect }) => (
            origin === FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN
            && method === 'GET'
            && redirect === 'error'
        ))).toBe(true);
        expect(harness.requests.map(({ signed }) => signed)).toEqual([
            false,
            false,
            true,
            true,
            true,
            true,
            true,
            true,
            false,
        ]);
        expect(harness.requests.map(({ query }) => query)).toEqual([
            {},
            {},
            {},
            { symbol: 'BTCUSDT' },
            { symbol: 'BTCUSDT' },
            {},
            { symbol: 'BTCUSDT' },
            { symbol: 'BTCUSDT' },
            { symbol: 'BTCUSDT' },
        ]);
        expect(harness.weights.map(({ weight }) => weight)).toEqual([
            FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS.serverTime,
            FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS.exchangeInfo,
            FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS.accountConfig,
            FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS.symbolConfig,
            FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS.positions,
            FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS.balance,
            FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS.regularOpenOrders,
            FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS.algoOpenOrders,
            FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS.markPrice,
        ]);
        expect(harness.weights.reduce((sum, { weight }) => sum + weight, 0)).toBe(
            FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS.preflightWeight,
        );
        expect(harness.release).toHaveBeenCalledOnce();
        expect(bundle.origin).toBe(FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN);
    });

    it('produces an evaluator-compatible exact risk bundle', async () => {
        const bundle = await createHarness().reader.readPreflight(OWNERSHIP);

        expect(evaluateFuturesTestnetExecutionRisk({
            command: makeCommand(),
            policy: POLICY,
            ownership: bundle.riskOwnership,
            observations: bundle.observations,
        })).toEqual({ ok: true });
        expect(bundle.observations.exchangeInfo.data).toMatchObject({
            symbol: 'BTCUSDT',
            metadataDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
            metadataVersion: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            metadataGeneration: 'generation-1',
        });
        expect(bundle.observations.exchangeInfo.data.filters.percentPrice)
            .toMatchObject({ multiplierDecimal: '1' });
    });

    it('binds every observation to the exact account, connection, and generation', async () => {
        const bundle = await createHarness().reader.readPreflight(OWNERSHIP);

        expect(bundle.session).toEqual({
            connectionIdentity: 'connection-1',
            sessionIdentity: 'session-1',
            generation: 'generation-1',
            credentialIdentity: 'credential-1',
            accountIdentity: 'demo-account-1',
        });
        Object.values(bundle.observations).forEach((observation) => {
            expect(observation).toMatchObject({
                complete: true,
                connected: true,
                environment: 'testnet',
                symbol: 'BTCUSDT',
                credentialIdentity: 'credential-1',
                accountIdentity: 'demo-account-1',
                connectionIdentity: 'connection-1',
                generation: 'generation-1',
                futureDated: false,
                regressed: false,
            });
        });
        expect(Object.isFrozen(bundle)).toBe(true);
        expect(Object.isFrozen(bundle.observations.positions.data.positions)).toBe(true);
    });

    it('computes the exact midpoint server clock and exposes tiered freshness', async () => {
        const bundle = await createHarness().reader.readPreflight(OWNERSHIP);

        expect(bundle.serverClock).toEqual({
            sampledServerTime: SERVER_TIME,
            localMidpoint: SERVER_TIME,
            roundTripMs: 100,
            offsetMs: 0,
            adjustedNow: SERVER_TIME + 850,
        });
        expect(bundle.freshness).toEqual({
            static: {
                maximumAgeMs: FUTURES_TESTNET_EXECUTION_RISK_READER_FRESHNESS.staticMaxAgeMs,
                resources: ['exchangeInfo'],
            },
            configuration: {
                maximumAgeMs: FUTURES_TESTNET_EXECUTION_RISK_READER_FRESHNESS
                    .configurationMaxAgeMs,
                resources: ['accountConfig', 'symbolConfig'],
            },
            dynamic: {
                maximumAgeMs: FUTURES_TESTNET_EXECUTION_RISK_READER_FRESHNESS.dynamicMaxAgeMs,
                resources: [
                    'serverTime',
                    'positions',
                    'balance',
                    'regularOpenOrders',
                    'algoOpenOrders',
                    'markPrice',
                ],
            },
        });
        expect(bundle.observations.serverTime.ageMs).toBe(800);
        expect(bundle.observations.markPrice.ageMs).toBe(0);
    });

    it('measures the final validation-to-dispatch age on the same monotonic clock', async () => {
        const harness = createHarness();
        const bundle = await harness.reader.readPreflight(OWNERSHIP);
        expect(harness.reader.getValidationToDispatchAgeMs(bundle)).toBe(0);
        harness.advanceMonotonic(1_001);
        expect(harness.reader.getValidationToDispatchAgeMs(bundle)).toBe(1_001);
    });

    it('rejects a server-time round trip above the exact one-second boundary', async () => {
        const harness = createHarness({
            requestElapsedMs: ({ path }) => path === '/fapi/v1/time' ? 1_001 : 0,
        });

        await expect(harness.reader.readPreflight(OWNERSHIP)).rejects.toMatchObject({
            code: FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.STALE_DATA,
        });
        expect(harness.requests).toHaveLength(1);
        expect(harness.release).toHaveBeenCalledOnce();
    });

    it('accepts the exact one-second server-time round-trip boundary', async () => {
        const harness = createHarness({
            requestElapsedMs: ({ path }) => path === '/fapi/v1/time' ? 1_000 : 0,
        });

        await expect(harness.reader.readPreflight(OWNERSHIP)).resolves.toMatchObject({
            serverClock: { roundTripMs: 1_000 },
        });
        expect(harness.requests).toHaveLength(9);
        expect(harness.requests[0].path).toBe('/fapi/v1/time');
    });
});

describe('FuturesTestnetExecutionRiskReader identity and resource safety', () => {
    it.each([
        ['mixed position symbol', (responses) => {
            responses['/fapi/v3/positionRisk'].push({
                ...responses['/fapi/v3/positionRisk'][0],
                symbol: 'ETHUSDT',
                positionSide: 'LONG',
            });
        }, FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.IDENTITY_MISMATCH],
        ['duplicate position side', (responses) => {
            responses['/fapi/v3/positionRisk'].push({
                ...responses['/fapi/v3/positionRisk'][0],
            });
        }, FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY],
        ['case-mismatched symbol config', (responses) => {
            responses['/fapi/v1/symbolConfig'][0].symbol = 'btcusdt';
        }, FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.IDENTITY_MISMATCH],
        ['duplicate USDT balance', (responses) => {
            responses['/fapi/v3/balance'].push({
                ...responses['/fapi/v3/balance'][1],
            });
        }, FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY],
        ['case-mismatched balance asset', (responses) => {
            responses['/fapi/v3/balance'][1].asset = 'usdt';
        }, FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.IDENTITY_MISMATCH],
        ['duplicate exchange symbol', (responses) => {
            responses['/fapi/v1/exchangeInfo'].symbols.push(structuredClone(
                responses['/fapi/v1/exchangeInfo'].symbols[1],
            ));
        }, FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY],
        ['duplicate mark identity', (responses) => {
            responses['/fapi/v1/premiumIndex'] = [
                responses['/fapi/v1/premiumIndex'],
                { ...responses['/fapi/v1/premiumIndex'] },
            ];
        }, FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY],
    ])('rejects %s', async (_name, mutate, code) => {
        const responses = makeResponses();
        mutate(responses);
        const harness = createHarness({ responses });

        await expect(harness.reader.readPreflight(OWNERSHIP)).rejects.toMatchObject({ code });
        expect(harness.release).toHaveBeenCalledOnce();
    });

    it('preserves signed-int64 open-order identity as text', async () => {
        const responses = makeResponses();
        responses['/fapi/v1/openOrders'] = [{
            symbol: 'BTCUSDT',
            orderId: '9223372036854775807',
            clientOrderId: 'cc6-existing-order',
            updateTime: SERVER_TIME + 300,
        }];
        const bundle = await createHarness({ responses }).reader.readPreflight(OWNERSHIP);

        expect(bundle.observations.regularOpenOrders.data.orders).toEqual([{
            symbol: 'BTCUSDT',
            orderId: '9223372036854775807',
            clientOrderId: 'cc6-existing-order',
            updateTime: SERVER_TIME + 300,
        }]);
    });

    it('rejects an unsafe numeric order identity before conversion', async () => {
        const responses = makeResponses();
        responses['/fapi/v1/openOrders'] = [{
            symbol: 'BTCUSDT',
            orderId: 9007199254740992,
            clientOrderId: 'unsafe-order-id',
            updateTime: SERVER_TIME + 300,
        }];

        await expect(createHarness({ responses }).reader.readPreflight(OWNERSHIP))
            .rejects.toMatchObject({
                code: FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            });
    });

    it('rejects a numeric JSON clientAlgoId as an opaque algo-order identity', async () => {
        const responses = makeResponses();
        responses['/fapi/v1/openAlgoOrders'] = [{
            symbol: 'BTCUSDT',
            algoId: '9223372036854775807',
            clientAlgoId: 123,
            updateTime: SERVER_TIME + 300,
        }];
        const fetchImpl = vi.fn(async (url) => {
            const path = new URL(url).pathname;
            return new Response(JSON.stringify(responses[path]), { status: 200 });
        });
        const request = createFuturesTestnetExecutionReadRequest({
            apiKey: 'key',
            apiSecret: 'secret',
            fetchImpl,
            wallNow: () => SERVER_TIME,
        }).request;
        const release = vi.fn();
        const coordinator = {
            beginPreflight: vi.fn().mockResolvedValue({
                executeGet: vi.fn(async operation => operation()),
                release,
            }),
        };
        const reader = new FuturesTestnetExecutionRiskReader({
            request,
            coordinator,
            wallNow: () => SERVER_TIME,
            monotonicNow: () => 1_000,
            owns: () => true,
        });

        await expect(reader.readPreflight(OWNERSHIP)).rejects.toMatchObject({
            code: FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
        });
        expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname))
            .toContain('/fapi/v1/openAlgoOrders');
        expect(release).toHaveBeenCalledOnce();
    });

    it('rejects malformed decimal text without converting through Number', async () => {
        const responses = makeResponses();
        responses['/fapi/v3/positionRisk'][0].positionAmt = '1e0';

        await expect(createHarness({ responses }).reader.readPreflight(OWNERSHIP))
            .rejects.toMatchObject({
                code: FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            });
    });

    it('rejects accessors without invoking them', async () => {
        const responses = makeResponses();
        let calls = 0;
        Object.defineProperty(responses['/fapi/v1/accountConfig'], 'canTrade', {
            enumerable: true,
            get() {
                calls += 1;
                return true;
            },
        });
        const harness = createHarness({
            responses,
            requestMutation: ({ options }) => (
                options.path === '/fapi/v1/accountConfig'
                    ? responses['/fapi/v1/accountConfig']
                    : undefined
            ),
        });

        await expect(harness.reader.readPreflight(OWNERSHIP)).rejects.toBeDefined();
        expect(calls).toBe(0);
    });
});

describe('FuturesTestnetExecutionRiskReader lifecycle ownership', () => {
    it('stops after ownership changes and always releases the preflight lease', async () => {
        let owned = true;
        const harness = createHarness({
            owns: () => owned,
            requestMutation: ({ options }) => {
                if (options.path === '/fapi/v1/accountConfig') owned = false;
            },
        });

        await expect(harness.reader.readPreflight(OWNERSHIP)).rejects.toMatchObject({
            code: FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.OWNERSHIP_LOST,
        });
        expect(harness.requests.map(({ path }) => path)).toEqual([
            '/fapi/v1/time',
            '/fapi/v1/exchangeInfo',
            '/fapi/v1/accountConfig',
        ]);
        expect(harness.release).toHaveBeenCalledOnce();
    });

    it('marks a regressing exchange timestamp on the same owned generation', async () => {
        const responses = makeResponses();
        const harness = createHarness({ responses });
        const first = await harness.reader.readPreflight(OWNERSHIP);
        expect(first.observations.markPrice.regressed).toBe(false);

        responses['/fapi/v1/premiumIndex'].time -= 1;
        const second = await harness.reader.readPreflight(OWNERSHIP);
        expect(second.observations.markPrice.regressed).toBe(true);
    });

    it('rejects hostile ownership and never acquires preflight admission', async () => {
        const harness = createHarness();

        await expect(harness.reader.readPreflight({
            ...OWNERSHIP,
            symbol: 'btcusdt',
        })).rejects.toMatchObject({
            code: FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.INVALID_ARGUMENTS,
        });
        expect(harness.coordinator.beginPreflight).not.toHaveBeenCalled();
    });
});
