import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FUTURES_PRODUCTION_LIVE_AUTHORIZED,
    createFuturesProductionExecutionRuntime,
    createFuturesProductionFakeTransportAuthorizationForTests,
} from './futures-production-execution-composition.js';
import {
    FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
} from './futures-production-execution-config.js';
import {
    createFuturesProductionExecutionLedger,
} from './futures-production-execution-ledger.js';
import {
    FUTURES_PRODUCTION_EXECUTION_ACTIONS,
    FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
} from './futures-production-execution-protocol.js';

const directories = [];
afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await Promise.all(directories.splice(0).map(directory => (
        fs.rm(directory, { recursive: true, force: true })
    )));
});

const coordinatorOptions = {
    spotCoordinator: { executeSpot: async operation => operation() },
    getSpotAvailableWeight: () => 800,
    productionExecutor: async operation => operation(),
    getProductionAvailableWeight: () => 800,
};

const disabledConfig = Object.freeze({
    environment: 'production',
    enabled: false,
    configured: false,
    liveAuthorized: false,
    code: 'FUTURES_PRODUCTION_EXECUTION_DISABLED',
    credentials: null,
    recoveryAuthorization: null,
    account: null,
    policy: null,
});

const enabledFakeConfig = Object.freeze({
    environment: 'production',
    enabled: true,
    configured: true,
    liveAuthorized: true,
    code: 'FUTURES_PRODUCTION_EXECUTION_ENABLED',
    credentials: Object.freeze({ apiKey: 'fake-api-key', apiSecret: 'fake-api-secret' }),
    recoveryAuthorization: 'r'.repeat(32),
    account: Object.freeze({ alias: 'fake-account', fingerprint: 'a'.repeat(64) }),
    policy: Object.freeze({
        allowedSymbols: Object.freeze(['BTCUSDT']),
        maxLeverage: 2,
        maxOrderNotionalUsdt: '10',
        maxDailyNotionalUsdt: '50',
        minAvailableBalanceUsdt: '10',
        minLiquidationDistanceBps: '1000',
        killSwitchPolicy: FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
    }),
});

describe('FuturesProductionExecutionComposition', () => {
    it('cannot issue fake transport authority from a production process', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('VITEST', 'false');
        const productionComposition = await import(
            './futures-production-execution-composition.js?production-authorization-denied'
        );
        expect(() => (
            productionComposition.createFuturesProductionFakeTransportAuthorizationForTests(
                vi.fn(),
            )
        )).toThrow('available only to tests');
    });

    it('authorizes reviewed live composition while disabled config still cannot dispatch', async () => {
        expect(FUTURES_PRODUCTION_LIVE_AUTHORIZED).toBe(true);
        const fetchImpl = vi.fn(() => {
            throw new Error('network must remain unreachable');
        });
        const runtime = await createFuturesProductionExecutionRuntime({
            config: disabledConfig,
            ...coordinatorOptions,
            fetchImpl,
        });
        expect(runtime).toMatchObject({ durable: false, fakeBacked: false });
        expect(runtime.service.getStatus()).toMatchObject({
            mode: 'production',
            liveAuthorized: false,
            configured: false,
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
            },
        });
        expect(fetchImpl).not.toHaveBeenCalled();
        await runtime.service.shutdown();
    });

    it('rejects caller-supplied live transports and accepts only process-global fetch', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-trade-prod-live-gate-'));
        directories.push(directory);
        const identityResponse = async (input) => {
            const url = new URL(input);
            expect(url.origin).toBe('https://fapi.binance.com');
            if (url.pathname === '/fapi/v1/time') {
                return new Response(JSON.stringify({ serverTime: 1_768_435_200_000 }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (url.pathname === '/fapi/v1/accountConfig') {
                return new Response(JSON.stringify({
                    canTrade: true,
                    dualSidePosition: true,
                    multiAssetsMargin: false,
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (url.pathname === '/fapi/v3/balance') {
                return new Response(JSON.stringify([{
                    accountAlias: 'fake-account',
                    asset: 'USDT',
                    availableBalance: '1000',
                    marginAvailable: true,
                }]), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            throw new Error('unreviewed deterministic route');
        };
        const keyProtection = {
            generate: () => Buffer.alloc(32, 6),
            seal: key => Buffer.from(key),
            open: sealed => Buffer.from(sealed),
        };
        const callerFetch = vi.fn(identityResponse);
        const rejected = await createFuturesProductionExecutionRuntime({
            config: enabledFakeConfig,
            storageDirectory: directory,
            ...coordinatorOptions,
            keyProtection,
            fetchImpl: callerFetch,
        });
        expect(rejected).toMatchObject({ durable: false, fakeBacked: false });
        expect(rejected.service.getStatus()).toMatchObject({
            liveAuthorized: false,
            configured: true,
        });
        expect(callerFetch).not.toHaveBeenCalled();
        await rejected.service.shutdown();

        const processGlobalFetch = vi.fn(identityResponse);
        vi.stubGlobal('fetch', processGlobalFetch);
        const live = await createFuturesProductionExecutionRuntime({
            config: enabledFakeConfig,
            storageDirectory: directory,
            ...coordinatorOptions,
            keyProtection,
            fetchImpl: globalThis.fetch,
        });
        expect(live).toMatchObject({ durable: true, fakeBacked: false });
        expect(live.service.getStatus()).toMatchObject({
            liveAuthorized: true,
            configured: true,
            account: { alias: 'fake-account', fingerprint: 'a'.repeat(64) },
            killSwitch: { engaged: true },
        });
        expect(processGlobalFetch).toHaveBeenCalledTimes(3);
        await live.service.shutdown();
    });

    it('surfaces a durable-runtime startup failure as blocked recovery', async () => {
        const runtime = await createFuturesProductionExecutionRuntime({
            config: disabledConfig,
            ...coordinatorOptions,
            startupFailureCode: 'FUTURES_PRODUCTION_DURABLE_RUNTIME_FAILED',
        });
        expect(runtime).toMatchObject({ durable: false, fakeBacked: false });
        expect(runtime.service.getStatus()).toMatchObject({
            recovery: {
                required: true,
                state: 'blocked',
                code: 'FUTURES_PRODUCTION_STORAGE_FAILED',
            },
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
            },
        });
        await runtime.service.shutdown();
    });

    it('rejects global, forged, mutated, and substituted fake transport authority', async () => {
        const deterministicFetch = vi.fn(async () => {
            throw new Error('disabled composition must not dispatch');
        });
        expect(() => (
            createFuturesProductionFakeTransportAuthorizationForTests(globalThis.fetch)
        )).toThrow('process-global fetch');

        const authorization = createFuturesProductionFakeTransportAuthorizationForTests(
            deterministicFetch,
        );
        expect(Object.isFrozen(authorization)).toBe(true);
        expect(Object.getPrototypeOf(authorization)).toBe(null);
        expect(Reflect.ownKeys(authorization)).toEqual([]);
        expect(Reflect.set(authorization, 'fetchImpl', globalThis.fetch)).toBe(false);

        const forgedRuntime = await createFuturesProductionExecutionRuntime({
            config: enabledFakeConfig,
            ...coordinatorOptions,
            fakeTransportAuthorization: Object.freeze({
                kind: 'futures-production-deterministic-backend-fake-v1',
                fetchImpl: deterministicFetch,
            }),
        });
        expect(forgedRuntime).toMatchObject({ durable: false, fakeBacked: false });
        expect(forgedRuntime.service.getStatus()).toMatchObject({
            liveAuthorized: false,
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
            },
        });
        await forgedRuntime.service.shutdown();

        const substitutedGlobalFetch = vi.fn(async () => {
            throw new Error('global transport must remain unreachable');
        });
        vi.stubGlobal('fetch', substitutedGlobalFetch);
        const substitutedRuntime = await createFuturesProductionExecutionRuntime({
            config: Object.freeze({ ...enabledFakeConfig, liveAuthorized: false }),
            ...coordinatorOptions,
            fetchImpl: substitutedGlobalFetch,
            fakeTransportAuthorization: authorization,
        });
        expect(substitutedRuntime).toMatchObject({ durable: false, fakeBacked: false });
        expect(substitutedRuntime.service.getStatus()).toMatchObject({
            liveAuthorized: false,
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
            },
        });
        expect(deterministicFetch).not.toHaveBeenCalled();
        expect(substitutedGlobalFetch).not.toHaveBeenCalled();
        await substitutedRuntime.service.shutdown();
    });

    it('keeps explicit deterministic fake authorization available only to tests', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-trade-prod-fake-'));
        directories.push(directory);
        const fetchImpl = vi.fn(async (input) => {
            const url = new URL(input);
            expect(url.origin).toBe('https://fapi.binance.com');
            if (url.pathname === '/fapi/v1/time') {
                return new Response(JSON.stringify({ serverTime: 1_768_435_200_000 }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (url.pathname === '/fapi/v1/accountConfig') {
                return new Response(JSON.stringify({
                    canTrade: true,
                    dualSidePosition: true,
                    multiAssetsMargin: false,
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (url.pathname === '/fapi/v3/balance') {
                return new Response(JSON.stringify([{
                    accountAlias: 'fake-account',
                    asset: 'USDT',
                    availableBalance: '1000',
                    marginAvailable: true,
                }]), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            throw new Error('unreviewed fake route');
        });
        const runtime = await createFuturesProductionExecutionRuntime({
            config: enabledFakeConfig,
            storageDirectory: directory,
            ...coordinatorOptions,
            keyProtection: {
                generate: () => Buffer.alloc(32, 7),
                seal: key => Buffer.from(key),
                open: sealed => Buffer.from(sealed),
            },
            fetchImpl,
            fakeTransportAuthorization: (
                createFuturesProductionFakeTransportAuthorizationForTests(fetchImpl)
            ),
        });
        expect(runtime).toMatchObject({ durable: true, fakeBacked: true });
        expect(runtime.service.getStatus()).toMatchObject({
            liveAuthorized: true,
            configured: true,
            account: { alias: 'fake-account', fingerprint: 'a'.repeat(64) },
            killSwitch: { engaged: true },
        });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        await runtime.service.shutdown();
    });

    it('executes one complete Hedge LONG exit through the real fake-backed composition', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-trade-prod-composed-'));
        directories.push(directory);
        const integrityKey = Buffer.alloc(32, 11);
        const keyProtection = {
            generate: () => Buffer.from(integrityKey),
            seal: key => Buffer.from(key),
            open: sealed => Buffer.from(sealed),
        };
        const serverTime = Date.UTC(2026, 6, 13, 12, 0, 0, 0);
        const calls = [];
        const respond = body => new Response(
            typeof body === 'string' ? body : JSON.stringify(body),
            { status: 200, headers: { 'content-type': 'application/json' } },
        );
        const fetchImpl = vi.fn(async (input, options) => {
            const url = new URL(input);
            calls.push({ pathname: url.pathname, method: options.method });
            if (url.pathname === '/fapi/v1/time') {
                return respond({ serverTime });
            }
            if (url.pathname === '/fapi/v1/exchangeInfo') {
                return respond({
                    symbols: [{
                        symbol: 'BTCUSDT',
                        status: 'TRADING',
                        contractType: 'PERPETUAL',
                        quoteAsset: 'USDT',
                        marginAsset: 'USDT',
                        orderTypes: ['LIMIT', 'MARKET'],
                        timeInForce: ['GTC'],
                        filters: [
                            {
                                filterType: 'PRICE_FILTER',
                                minPrice: '1',
                                maxPrice: '1000000',
                                tickSize: '0.1',
                            },
                            {
                                filterType: 'PERCENT_PRICE',
                                multiplierUp: '2',
                                multiplierDown: '0.5',
                            },
                            {
                                filterType: 'LOT_SIZE',
                                minQty: '0.001',
                                maxQty: '100',
                                stepSize: '0.001',
                            },
                            { filterType: 'MIN_NOTIONAL', notional: '5' },
                            { filterType: 'MAX_NUM_ORDERS', limit: 20 },
                        ],
                    }],
                });
            }
            if (url.pathname === '/fapi/v1/premiumIndex') {
                return respond({ symbol: 'BTCUSDT', markPrice: '7000' });
            }
            if (url.pathname === '/fapi/v1/accountConfig') {
                return respond({
                    canTrade: true,
                    dualSidePosition: true,
                    multiAssetsMargin: false,
                });
            }
            if (url.pathname === '/fapi/v1/symbolConfig') {
                return respond([{
                    symbol: 'BTCUSDT',
                    marginType: 'ISOLATED',
                    isAutoAddMargin: false,
                    leverage: 2,
                    maxNotionalValue: '1000000',
                }]);
            }
            if (url.pathname === '/fapi/v3/balance') {
                return respond([{
                    accountAlias: 'fake-account',
                    asset: 'USDT',
                    availableBalance: '1000',
                    marginAvailable: true,
                }]);
            }
            if (url.pathname === '/fapi/v3/positionRisk') {
                return respond([{
                    symbol: 'BTCUSDT',
                    positionSide: 'LONG',
                    positionAmt: '1',
                    liquidationPrice: '5000',
                    marginAsset: 'USDT',
                }]);
            }
            if (url.pathname === '/fapi/v1/openOrders'
                || url.pathname === '/fapi/v1/openAlgoOrders') {
                return respond([]);
            }
            if (url.pathname === '/fapi/v1/order' && options.method === 'POST') {
                const clientOrderId = new URLSearchParams(options.body).get('newClientOrderId');
                return respond(`{"symbol":"BTCUSDT","orderId":9223372036854775807,`
                    + `"clientOrderId":"${clientOrderId}","transactTime":${serverTime + 1}}`);
            }
            if (url.pathname === '/fapi/v1/order' && options.method === 'GET') {
                const clientOrderId = url.searchParams.get('origClientOrderId');
                return respond(`{"symbol":"BTCUSDT","orderId":9223372036854775807,`
                    + `"clientOrderId":"${clientOrderId}","price":"7000.0",`
                    + '"origQty":"0.0010","executedQty":"0.001","avgPrice":"7000",'
                    + '"status":"FILLED","timeInForce":"GTC","type":"LIMIT",'
                    + '"origType":"LIMIT","reduceOnly":false,"closePosition":false,'
                    + `"side":"SELL","positionSide":"LONG","updateTime":${serverTime + 2}}`);
            }
            throw new Error(`unreviewed fake route: ${options.method} ${url.pathname}`);
        });
        const productionEscape = vi.fn(() => {
            throw new Error('production network escape');
        });
        vi.stubGlobal('fetch', productionEscape);
        const runtime = await createFuturesProductionExecutionRuntime({
            config: enabledFakeConfig,
            storageDirectory: directory,
            ...coordinatorOptions,
            keyProtection,
            fetchImpl,
            fakeTransportAuthorization: (
                createFuturesProductionFakeTransportAuthorizationForTests(fetchImpl)
            ),
        });
        const connectionId = 'e'.repeat(32);
        const emitted = [];
        const context = { connectionId, emit: value => emitted.push(value) };
        await runtime.service.handleRequest(JSON.stringify({
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
            version: 2,
            revision: '0',
            marketType: 'futures',
            environment: 'production',
            accountFingerprint: '0'.repeat(64),
        }), context);
        await runtime.service.handleRequest(JSON.stringify({
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
            version: 2,
            revision: emitted.at(-1).revision,
            marketType: 'futures',
            environment: 'production',
            accountFingerprint: enabledFakeConfig.account.fingerprint,
            symbol: 'BTCUSDT',
            side: 'SELL',
            positionSide: 'LONG',
            positionEffect: 'EXIT',
            quantity: '0.001',
            price: '7000.0',
        }), context);
        const intent = emitted.at(-1).intent;
        expect(intent).toMatchObject({ kind: 'order' });
        await expect(runtime.service.handleRequest(JSON.stringify({
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
            version: 2,
            revision: intent.revision,
            marketType: 'futures',
            environment: 'production',
            accountFingerprint: enabledFakeConfig.account.fingerprint,
            requestId: intent.requestId,
            confirmation: FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
                FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
            ],
        }), context)).resolves.toBe(true);
        expect(runtime.service.getCurrentAttempt()).toMatchObject({
            state: 'confirmed_filled',
            acknowledgement: 'accepted',
        });
        expect(calls.filter(call => (
            call.pathname === '/fapi/v1/order' && call.method === 'POST'
        ))).toHaveLength(1);
        expect(calls.filter(call => (
            call.pathname === '/fapi/v1/order' && call.method === 'GET'
        ))).toHaveLength(1);
        expect(productionEscape).not.toHaveBeenCalled();
        await runtime.service.shutdown();

        const ledger = createFuturesProductionExecutionLedger({
            directory,
            integrityKey,
        });
        await ledger.open();
        const records = ledger.getRecords();
        expect(records.filter(record => record.eventType === 'exchange_request')
            .map(record => record.endpointId)).toEqual(
                records.filter(record => record.eventType === 'rate_counter')
                    .map(record => record.endpointId),
            );
        expect(records).toContainEqual(expect.objectContaining({
            eventType: 'daily_notional_reserved',
            exactNotional: '7',
        }));
        expect(records).toContainEqual(expect.objectContaining({
            eventType: 'dispatch_intent',
            state: 'dispatched',
        }));
        expect(records).toContainEqual(expect.objectContaining({
            eventType: 'reconciliation_result',
            state: 'confirmed_filled',
        }));
        expect(ledger.getActiveOperations()).toEqual([]);
        expect(JSON.stringify(records)).not.toContain(enabledFakeConfig.credentials.apiKey);
        expect(JSON.stringify(records)).not.toContain(enabledFakeConfig.credentials.apiSecret);
        await ledger.close();
    });

    it('restores the durable origin-weight window before any restart network read', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-trade-prod-rate-restart-'));
        directories.push(directory);
        const keyProtection = {
            generate: () => Buffer.alloc(32, 9),
            seal: key => Buffer.from(key),
            open: sealed => Buffer.from(sealed),
        };
        const createFakeFetch = () => vi.fn(async (input) => {
            const url = new URL(input);
            if (url.pathname === '/fapi/v1/time') {
                return new Response(JSON.stringify({ serverTime: 1_768_435_200_000 }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (url.pathname === '/fapi/v1/accountConfig') {
                return new Response(JSON.stringify({
                    canTrade: true,
                    dualSidePosition: true,
                    multiAssetsMargin: false,
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (url.pathname === '/fapi/v3/balance') {
                return new Response(JSON.stringify([{
                    accountAlias: 'fake-account',
                    asset: 'USDT',
                    availableBalance: '1000',
                    marginAvailable: true,
                }]), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            throw new Error('unreviewed fake route');
        });
        const firstFetch = createFakeFetch();
        const first = await createFuturesProductionExecutionRuntime({
            config: enabledFakeConfig,
            storageDirectory: directory,
            ...coordinatorOptions,
            keyProtection,
            fetchImpl: firstFetch,
            fakeTransportAuthorization: (
                createFuturesProductionFakeTransportAuthorizationForTests(firstFetch)
            ),
        });
        expect(firstFetch).toHaveBeenCalledTimes(3);

        for (let index = 0; index < 152; index += 1) {
            await first.coordinator.executeGet(
                async () => true,
                5,
                { endpointId: 'account-config' },
            );
        }
        for (let index = 0; index < 4; index += 1) {
            await first.coordinator.executeGet(
                async () => true,
                1,
                { endpointId: 'server-time' },
            );
        }
        const firstSnapshot = first.coordinator.getOriginWeightAdmissionSnapshot();
        expect(firstSnapshot.originWeightReservations.reduce(
            (sum, reservation) => sum + reservation.requestWeight,
            0,
        )).toBe(775);
        await first.service.shutdown();

        const restartFetch = createFakeFetch();
        const restarted = await createFuturesProductionExecutionRuntime({
            config: enabledFakeConfig,
            storageDirectory: directory,
            ...coordinatorOptions,
            keyProtection,
            fetchImpl: restartFetch,
            fakeTransportAuthorization: (
                createFuturesProductionFakeTransportAuthorizationForTests(restartFetch)
            ),
        });
        expect(restarted.coordinator.getOriginWeightAdmissionSnapshot()
            .originWeightReservations.reduce(
                (sum, reservation) => sum + reservation.requestWeight,
                0,
            )).toBe(775);
        expect(restartFetch).not.toHaveBeenCalled();
        expect(restarted.service.getStatus()).toMatchObject({
            capabilities: {
                placeOrder: false,
                cancelAllOpenOrders: false,
                closePositions: false,
            },
        });
        await restarted.service.shutdown();
    }, 10_000);
});
