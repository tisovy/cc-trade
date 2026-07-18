import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES,
    FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS,
    FUTURES_PRODUCTION_EXECUTION_ENDPOINT_IDS,
    FUTURES_PRODUCTION_EXECUTION_ENDPOINT_WEIGHTS,
    FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
    FuturesProductionExecutionCoordinator,
    FuturesProductionExecutionOriginBucket,
    FuturesProductionExecutionOrderBucket,
} from './futures-production-execution-coordinator.js';

const dayOne = Date.UTC(2026, 6, 13, 23, 59, 59, 900);
const dayTwo = Date.UTC(2026, 6, 14, 0, 0, 0, 0);

const createHarness = (overrides = {}) => {
    let spotAvailable = 800;
    let productionAvailable = 800;
    const spotCoordinator = { executeSpot: vi.fn(async (...args) => args) };
    const productionExecutor = vi.fn(async operation => operation());
    const persistOrderReservation = vi.fn(async () => undefined);
    const persistRatePause = vi.fn(async () => undefined);
    const persistOriginWeightReservation = vi.fn(async () => undefined);
    const coordinator = new FuturesProductionExecutionCoordinator({
        spotCoordinator,
        getSpotAvailableWeight: () => spotAvailable,
        productionExecutor,
        getProductionAvailableWeight: () => productionAvailable,
        persistOrderReservation,
        persistRatePause,
        persistOriginWeightReservation: overrides.persistOriginWeightReservation
            ?? persistOriginWeightReservation,
        ...overrides,
    });
    return {
        coordinator,
        spotCoordinator,
        productionExecutor,
        persistOrderReservation,
        persistRatePause,
        persistOriginWeightReservation: overrides.persistOriginWeightReservation
            ?? persistOriginWeightReservation,
        setSpotAvailable: value => { spotAvailable = value; },
        setProductionAvailable: value => { productionAvailable = value; },
    };
};

afterEach(() => {
    vi.useRealTimers();
});

describe('FuturesProductionExecutionOriginBucket', () => {
    it('admits the exact 800-weight boundary and expires only at 60,000ms', () => {
        let current = 1_000;
        const bucket = new FuturesProductionExecutionOriginBucket({ now: () => current });
        const exact = bucket.prepareReservation(800);
        bucket.commitReservation(exact);
        expect(bucket.canReserve(1)).toBe(false);
        expect(() => bucket.prepareReservation(1)).toThrowError(expect.objectContaining({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.ORIGIN_WEIGHT_LIMITED,
        }));

        current += 59_999;
        expect(bucket.canReserve(1)).toBe(false);
        current += 1;
        expect(bucket.canReserve(800)).toBe(true);
        bucket.commitReservation(bucket.prepareReservation(800));
        expect(bucket.snapshot()).toMatchObject({
            originWeightReservations: [{ observedAt: current, requestWeight: 800 }],
            lastOriginWeightObservedAt: current,
            maximumOriginRequestWeight: 800,
            originWeightWindowMs: 60_000,
        });
    });

    it('fails closed on future, descending, incomplete, and regressed clocks', () => {
        let current = 100_000;
        expect(() => new FuturesProductionExecutionOriginBucket({
            now: () => current,
            initialOriginWeightReservations: [{ observedAt: current + 1, requestWeight: 1 }],
            initialLastOriginWeightObservedAt: current + 1,
        })).toThrowError(expect.objectContaining({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
        }));
        expect(() => new FuturesProductionExecutionOriginBucket({
            now: () => current,
            initialOriginWeightReservations: [
                { observedAt: current - 1, requestWeight: 1 },
                { observedAt: current - 2, requestWeight: 1 },
            ],
            initialLastOriginWeightObservedAt: current - 1,
        })).toThrowError(expect.objectContaining({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
        }));
        expect(() => new FuturesProductionExecutionOriginBucket({
            now: () => current,
            initialOriginWeightReservations: [{ observedAt: current, requestWeight: 1 }],
            initialLastOriginWeightObservedAt: null,
        })).toThrowError(expect.objectContaining({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
        }));

        const bucket = new FuturesProductionExecutionOriginBucket({ now: () => current });
        bucket.commitReservation(bucket.prepareReservation(1));
        current -= 1;
        expect(() => bucket.canReserve(1)).toThrowError(expect.objectContaining({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
        }));
    });
});

describe('FuturesProductionExecutionCoordinator', () => {
    it('delegates Spot arguments unchanged through the existing coordinator', async () => {
        const harness = createHarness();
        const operation = vi.fn();
        const options = { signal: new AbortController().signal, legacy: true };
        await expect(harness.coordinator.executeSpot(operation, 23, 2, options))
            .resolves.toEqual([operation, 23, 2, options]);
        expect(harness.spotCoordinator.executeSpot).toHaveBeenCalledExactlyOnceWith(
            operation,
            23,
            2,
            options,
        );
        expect(harness.productionExecutor).not.toHaveBeenCalled();
    });

    it('uses only the fixed production origin and forces zero retries for GETs', async () => {
        const harness = createHarness();
        const operation = vi.fn().mockResolvedValue('ok');
        await expect(harness.coordinator.executeGet(operation, 5, {
            endpointId: 'account-config',
        })).resolves.toBe('ok');
        expect(harness.productionExecutor).toHaveBeenCalledExactlyOnceWith(
            operation,
            5,
            0,
            {
                signal: undefined,
                origin: FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
                priority: 'low',
            },
        );
        expect(harness.persistOriginWeightReservation).toHaveBeenCalledExactlyOnceWith({
            endpointId: 'account-config',
            observedAt: expect.any(Number),
            requestWeight: 5,
        });
        expect(FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN).toBe('https://fapi.binance.com');
    });

    it('admits the exact all-symbol inventory weight without expanding the reviewed ceiling', async () => {
        const harness = createHarness();
        await expect(harness.coordinator.executeGet(() => 'all orders', 40, {
            endpointId: 'all-open-orders',
        })).resolves.toBe('all orders');
        expect(FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS.preflightWeight).toBe(40);
        expect(harness.persistOriginWeightReservation).toHaveBeenCalledExactlyOnceWith({
            endpointId: 'all-open-orders',
            observedAt: expect.any(Number),
            requestWeight: 40,
        });
        await expect(harness.coordinator.executeGet(() => 'forbidden', 41, {
            endpointId: 'all-open-orders',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
        });
    });

    it('accepts only the exact reviewed endpoint identifiers', async () => {
        expect(FUTURES_PRODUCTION_EXECUTION_ENDPOINT_IDS).toEqual([
            'server-time',
            'exchange-info',
            'mark-price',
            'account-config',
            'symbol-config',
            'all-symbol-config',
            'balance-v3',
            'position-risk',
            'open-orders',
            'all-open-orders',
            'user-data-stream-start',
            'user-data-stream-keepalive',
            'user-data-stream-close',
            'open-algo-orders',
            'all-open-algo-orders',
            'position-margin-history',
            'modify-isolated-position-margin',
            'modify-limit-order',
            'new-limit-gtc-order',
            'new-hedge-market-exit-order',
            'query-order',
            'cancel-all-open-orders',
            'cancel-all-algo-open-orders',
        ]);
        expect(FUTURES_PRODUCTION_EXECUTION_ENDPOINT_WEIGHTS).toEqual({
            'server-time': 1,
            'exchange-info': 1,
            'mark-price': 1,
            'account-config': 5,
            'symbol-config': 5,
            'all-symbol-config': 5,
            'balance-v3': 5,
            'position-risk': 5,
            'open-orders': 1,
            'all-open-orders': 40,
            'user-data-stream-start': 1,
            'user-data-stream-keepalive': 1,
            'user-data-stream-close': 1,
            'open-algo-orders': 1,
            'all-open-algo-orders': 40,
            'position-margin-history': 1,
            'modify-isolated-position-margin': 1,
            'modify-limit-order': 1,
            'new-limit-gtc-order': 1,
            'new-hedge-market-exit-order': 1,
            'query-order': 1,
            'cancel-all-open-orders': 1,
            'cancel-all-algo-open-orders': 1,
        });
        expect(Object.isFrozen(FUTURES_PRODUCTION_EXECUTION_ENDPOINT_WEIGHTS)).toBe(true);
        const harness = createHarness();
        await expect(harness.coordinator.executeProduction(() => 'forbidden', 1, {
            endpointId: 'https://fapi.binance.com/fapi/v1/order',
            priority: 'low',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
        });
        await expect(harness.coordinator.executeRecoveryQuery(() => 'forbidden'))
            .rejects.toMatchObject({
                code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
            });
        expect(harness.persistOriginWeightReservation).not.toHaveBeenCalled();
        expect(harness.productionExecutor).not.toHaveBeenCalled();
    });

    it('rejects every reviewed endpoint and weight mismatch before persistence', async () => {
        const harness = createHarness();
        await expect(harness.coordinator.executeGet(() => 'forbidden', 5, {
            endpointId: 'server-time',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
        });
        await expect(harness.coordinator.executeProduction(() => 'forbidden', 5, {
            endpointId: 'new-limit-gtc-order',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
        });
        await expect(harness.coordinator.executeRecoveryQuery(() => 'forbidden', {
            endpointId: 'account-config',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
        });
        const lease = await harness.coordinator.beginPreflight();
        await expect(lease.executeGet(() => 'forbidden', 1, {
            endpointId: 'position-risk',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
        });
        lease.release();
        expect(harness.persistOriginWeightReservation).not.toHaveBeenCalled();
        expect(harness.productionExecutor).not.toHaveBeenCalled();
    });

    it('serializes durable origin reservations before each network attempt', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
        const events = [];
        let releaseFirst;
        const firstPersistence = new Promise(resolve => { releaseFirst = resolve; });
        const persistOriginWeightReservation = vi.fn(async (reservation) => {
            events.push(`persist-start:${reservation.endpointId}`);
            if (reservation.endpointId === 'new-limit-gtc-order') await firstPersistence;
            events.push(`persist-end:${reservation.endpointId}`);
        });
        const harness = createHarness({ persistOriginWeightReservation });
        const first = harness.coordinator.executeProduction(
            () => { events.push('network:new-limit-gtc-order'); return 'one'; },
            1,
            { endpointId: 'new-limit-gtc-order', priority: 'low' },
        );
        const second = harness.coordinator.executeProduction(
            () => { events.push('network:cancel-all-open-orders'); return 'two'; },
            1,
            { endpointId: 'cancel-all-open-orders', priority: 'low' },
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(persistOriginWeightReservation).toHaveBeenCalledTimes(1);
        expect(harness.productionExecutor).not.toHaveBeenCalled();
        releaseFirst();
        await expect(Promise.all([first, second])).resolves.toEqual(['one', 'two']);
        expect(persistOriginWeightReservation.mock.calls.map(([value]) => value)).toEqual([
            { observedAt: 10_000, requestWeight: 1, endpointId: 'new-limit-gtc-order' },
            { observedAt: 10_000, requestWeight: 1, endpointId: 'cancel-all-open-orders' },
        ]);
        expect(events.indexOf('persist-end:new-limit-gtc-order'))
            .toBeLessThan(events.indexOf('network:new-limit-gtc-order'));
        expect(events.indexOf('persist-end:cancel-all-open-orders'))
            .toBeLessThan(events.indexOf('network:cancel-all-open-orders'));
        expect(harness.coordinator.getOriginWeightAdmissionSnapshot())
            .toMatchObject({
                originWeightReservations: [
                    { observedAt: 10_000, requestWeight: 1 },
                    { observedAt: 10_000, requestWeight: 1 },
                ],
                lastOriginWeightObservedAt: 10_000,
            });
    });

    it('never refunds durable weight after abort, Spot preemption, or transport failure', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(20_000);
        const abortController = new AbortController();
        const aborted = createHarness({
            persistOriginWeightReservation: vi.fn(async () => abortController.abort()),
        });
        await expect(aborted.coordinator.executeProduction(() => 'forbidden', 1, {
            endpointId: 'new-limit-gtc-order',
            signal: abortController.signal,
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.ABORTED,
        });
        expect(aborted.productionExecutor).not.toHaveBeenCalled();
        expect(aborted.coordinator.getOriginWeightAdmissionSnapshot()
            .originWeightReservations).toEqual([{ observedAt: 20_000, requestWeight: 1 }]);

        let spotAvailable = 800;
        const preempted = createHarness({
            getSpotAvailableWeight: () => spotAvailable,
            persistOriginWeightReservation: vi.fn(async () => { spotAvailable = 0; }),
        });
        await expect(preempted.coordinator.executeProduction(() => 'forbidden', 1, {
            endpointId: 'cancel-all-open-orders',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.SPOT_PRIORITY,
        });
        expect(preempted.productionExecutor).not.toHaveBeenCalled();
        expect(preempted.coordinator.getOriginWeightAdmissionSnapshot()
            .originWeightReservations).toEqual([{ observedAt: 20_000, requestWeight: 1 }]);

        const failedTransport = createHarness({
            productionExecutor: vi.fn(async () => { throw new Error('redacted transport'); }),
        });
        await expect(failedTransport.coordinator.executeRecoveryQuery(
            () => 'never returned',
            { endpointId: 'query-order' },
        )).rejects.toThrow('redacted transport');
        expect(failedTransport.coordinator.getOriginWeightAdmissionSnapshot()
            .originWeightReservations).toEqual([{ observedAt: 20_000, requestWeight: 1 }]);
    });

    it('does not dispatch or commit weight when durable origin persistence fails', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(30_000);
        const harness = createHarness({
            persistOriginWeightReservation: vi.fn(async () => {
                throw new Error('private disk details');
            }),
        });
        await expect(harness.coordinator.executeProduction(() => 'forbidden', 1, {
            endpointId: 'new-limit-gtc-order',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.PERSISTENCE_FAILED,
        });
        expect(harness.productionExecutor).not.toHaveBeenCalled();
        expect(harness.coordinator.getOriginWeightAdmissionSnapshot())
            .toMatchObject({
                originWeightReservations: [],
                lastOriginWeightObservedAt: null,
            });
    });

    it('lets a queued Spot operation preempt every admitted production read', async () => {
        let resolveSpot;
        const spotResult = new Promise(resolve => { resolveSpot = resolve; });
        const harness = createHarness({
            spotCoordinator: { executeSpot: vi.fn(() => spotResult) },
        });
        const lease = await harness.coordinator.beginPreflight();
        const spot = harness.coordinator.executeSpot('spot');
        await expect(lease.executeGet(() => 'forbidden', 1, {
            endpointId: 'server-time',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.SPOT_PRIORITY,
        });
        expect(harness.productionExecutor).not.toHaveBeenCalled();
        resolveSpot('done');
        await expect(spot).resolves.toBe('done');
        lease.release();
    });

    it('admits bounded production writes with zero retry and keeps Spot first', async () => {
        const harness = createHarness();
        const operation = vi.fn().mockResolvedValue('written');
        await expect(harness.coordinator.executeProduction(operation, 1, {
            endpointId: 'new-limit-gtc-order',
            priority: 'low',
        }))
            .resolves.toBe('written');
        expect(harness.productionExecutor).toHaveBeenLastCalledWith(
            operation,
            1,
            0,
            {
                signal: undefined,
                origin: FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
                priority: 'low',
            },
        );

        let resolveSpot;
        const spotResult = new Promise(resolve => { resolveSpot = resolve; });
        const blocked = createHarness({
            spotCoordinator: { executeSpot: vi.fn(() => spotResult) },
        });
        const spot = blocked.coordinator.executeSpot('spot');
        await expect(blocked.coordinator.executeProduction(() => 'forbidden', 1, {
            endpointId: 'new-limit-gtc-order',
        }))
            .rejects.toMatchObject({
                code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.SPOT_PRIORITY,
            });
        resolveSpot('done');
        await spot;
        expect(blocked.productionExecutor).not.toHaveBeenCalled();
    });

    it('requires separate Spot headroom and production-origin quota at admission', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const harness = createHarness();
        harness.setSpotAvailable(22);
        harness.setProductionAvailable(24);
        const pending = harness.coordinator.beginPreflight();
        const rejection = expect(pending).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES
                .PREFLIGHT_ADMISSION_TIMEOUT,
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await rejection;
    });

    it('requires both durable and volatile origin quota for preflight admission', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(40_000);
        const blocked = createHarness({
            originBucket: new FuturesProductionExecutionOriginBucket({
                now: Date.now,
                initialOriginWeightReservations: [{ observedAt: 40_000, requestWeight: 761 }],
                initialLastOriginWeightObservedAt: 40_000,
            }),
        });
        const pending = blocked.coordinator.beginPreflight();
        const rejection = expect(pending).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES
                .PREFLIGHT_ADMISSION_TIMEOUT,
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await rejection;

        vi.setSystemTime(50_000);
        const exact = createHarness({
            originBucket: new FuturesProductionExecutionOriginBucket({
                now: Date.now,
                initialOriginWeightReservations: [{ observedAt: 50_000, requestWeight: 760 }],
                initialLastOriginWeightObservedAt: 50_000,
            }),
        });
        const lease = await exact.coordinator.beginPreflight();
        expect(lease.release()).toBe(true);
    });

    it('keeps a persisted lease reservation when teardown releases the lease', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(60_000);
        let releasePersistence;
        let markPersistenceStarted;
        const persisted = new Promise(resolve => { releasePersistence = resolve; });
        const persistenceStarted = new Promise(resolve => { markPersistenceStarted = resolve; });
        const harness = createHarness({
            persistOriginWeightReservation: vi.fn(() => {
                markPersistenceStarted();
                return persisted;
            }),
        });
        const lease = await harness.coordinator.beginPreflight();
        const pending = lease.executeGet(() => 'forbidden', 1, {
            endpointId: 'server-time',
        });
        await persistenceStarted;
        expect(harness.persistOriginWeightReservation).toHaveBeenCalledTimes(1);
        expect(lease.release()).toBe(true);
        releasePersistence();
        await expect(pending).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES
                .PREFLIGHT_LEASE_RELEASED,
        });
        expect(harness.productionExecutor).not.toHaveBeenCalled();
        expect(harness.coordinator.getOriginWeightAdmissionSnapshot()
            .originWeightReservations).toEqual([{ observedAt: 60_000, requestWeight: 1 }]);
    });

    it('restores the bounded ledger origin-weight shape and rejects unknown state', () => {
        vi.useFakeTimers();
        vi.setSystemTime(70_000);
        const harness = createHarness();
        expect(harness.coordinator.restoreOriginWeightState({
            originWeightReservations: [
                { observedAt: 69_000, requestWeight: 400 },
                { observedAt: 70_000, requestWeight: 400 },
            ],
            lastOriginWeightObservedAt: 70_000,
        })).toMatchObject({
            originWeightReservations: [
                { observedAt: 69_000, requestWeight: 400 },
                { observedAt: 70_000, requestWeight: 400 },
            ],
            lastOriginWeightObservedAt: 70_000,
        });
        expect(() => harness.coordinator.restoreOriginWeightState({
            originWeightReservations: [],
            lastOriginWeightObservedAt: null,
            host: 'caller-controlled.invalid',
        })).toThrowError(expect.objectContaining({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
        }));
    });

    it('serializes and persists exact daily reservations before committing counters', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(dayOne);
        const harness = createHarness();
        const settled = await Promise.allSettled([
            harness.coordinator.reserveOrderDispatch({
                exactNotional: '60', utcDay: '2026-07-13', serverTime: dayOne,
                maximumDailyNotional: '100', audit: { requestId: 'one' },
            }),
            harness.coordinator.reserveOrderDispatch({
                exactNotional: '60', utcDay: '2026-07-13', serverTime: dayOne,
                maximumDailyNotional: '100', audit: { requestId: 'two' },
            }),
        ]);
        expect(settled.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(harness.persistOrderReservation).toHaveBeenCalledTimes(1);
        expect(harness.persistOrderReservation).toHaveBeenCalledWith(expect.objectContaining({
            exactNotional: '60',
            maximumDailyNotional: '100',
            utcDay: '2026-07-13',
            requestId: 'one',
        }));
        expect(harness.coordinator.getOrderAdmissionSnapshot()).toMatchObject({
            dispatchTimes: [dayOne],
            dailyReservations: { '2026-07-13': '60' },
        });
    });

    it('counts a verified reducing exit for order-rate admission without consuming daily notional', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(dayOne);
        const harness = createHarness();
        await harness.coordinator.reserveOrderDispatch({
            exactNotional: '0',
            utcDay: '2026-07-13',
            serverTime: dayOne,
            maximumDailyNotional: '100',
            audit: { requestId: 'exit-one', positionEffect: 'EXIT' },
        });

        expect(harness.persistOrderReservation).toHaveBeenCalledWith(expect.objectContaining({
            exactNotional: '0',
            positionEffect: 'EXIT',
        }));
        expect(harness.coordinator.getOrderAdmissionSnapshot()).toMatchObject({
            dispatchTimes: [dayOne],
            dailyReservations: { '2026-07-13': '0' },
        });
        await expect(harness.coordinator.reserveOrderDispatch({
            exactNotional: '0',
            utcDay: '2026-07-13',
            serverTime: dayOne,
            maximumDailyNotional: '100',
            audit: { requestId: 'not-an-exit', positionEffect: 'ENTRY' },
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
        });
    });

    it('passes exact equality, rolls over at UTC midnight, and blocks server regression', async () => {
        let current = dayOne;
        const harness = createHarness({
            orderBucket: new FuturesProductionExecutionOrderBucket({
                now: () => current,
                maximumTenSecondOrders: 2,
                maximumMinuteOrders: 3,
            }),
        });
        await harness.coordinator.reserveOrderDispatch({
            exactNotional: '100.00000000', utcDay: '2026-07-13', serverTime: dayOne,
            maximumDailyNotional: '100',
        });
        current = dayTwo;
        await harness.coordinator.reserveOrderDispatch({
            exactNotional: '100', utcDay: '2026-07-14', serverTime: dayTwo,
            maximumDailyNotional: '100.00000000',
        });
        expect(harness.coordinator.getOrderAdmissionSnapshot().dailyReservations).toEqual({
            '2026-07-13': '100',
            '2026-07-14': '100',
        });
        current += 10_000;
        await expect(harness.coordinator.reserveOrderDispatch({
            exactNotional: '1', utcDay: '2026-07-13', serverTime: dayOne,
            maximumDailyNotional: '101',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
        });
    });

    it('does not mutate admission state if durable reservation persistence fails', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(dayOne);
        const harness = createHarness({
            persistOrderReservation: vi.fn(async () => { throw new Error('disk details'); }),
        });
        await expect(harness.coordinator.reserveOrderDispatch({
            exactNotional: '1', utcDay: '2026-07-13', serverTime: dayOne,
            maximumDailyNotional: '10',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.PERSISTENCE_FAILED,
        });
        expect(harness.coordinator.getOrderAdmissionSnapshot()).toMatchObject({
            dispatchTimes: [],
            dailyReservations: {},
        });
    });

    it('persists rate pauses and restores exact counters for recovery admission', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(dayTwo);
        const harness = createHarness();
        harness.coordinator.restoreOrderState({
            dispatchTimes: [dayTwo - 10_000],
            pauseUntil: dayTwo,
            dailyReservations: { '2026-07-13': '50' },
            lastUtcDay: '2026-07-13',
            lastServerTime: dayOne,
        });
        await harness.coordinator.setOrderPauseUntil(dayTwo + 5_000, { code: 'RATE_LIMIT' });
        expect(harness.persistRatePause).toHaveBeenCalledWith({
            code: 'RATE_LIMIT',
            observedAt: dayTwo,
            pauseUntil: dayTwo + 5_000,
        });
        await expect(harness.coordinator.executeRecoveryQuery(() => 'query', {
            endpointId: 'query-order',
        })).rejects.toMatchObject({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.RATE_PAUSED,
        });
        vi.setSystemTime(dayTwo + 5_000);
        await expect(harness.coordinator.executeRecoveryQuery(() => 'query', {
            endpointId: 'query-order',
        })).resolves.toBe('query');
        expect(harness.productionExecutor).toHaveBeenLastCalledWith(
            expect.any(Function),
            1,
            0,
            {
                signal: undefined,
                origin: FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
                priority: 'low',
            },
        );
    });

    it('rejects restored future counters and malformed persisted daily state', () => {
        vi.useFakeTimers();
        vi.setSystemTime(dayTwo);
        const harness = createHarness();
        expect(() => harness.coordinator.restoreOrderState({
            dispatchTimes: [dayTwo + 1],
            pauseUntil: 0,
            dailyReservations: {},
            lastUtcDay: null,
            lastServerTime: null,
        })).toThrowError(expect.objectContaining({
            code: FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
        }));
        expect(() => harness.coordinator.restoreOrderState({
            dispatchTimes: [],
            pauseUntil: 0,
            dailyReservations: { '2026-02-30': '1' },
            lastUtcDay: '2026-02-30',
            lastServerTime: dayTwo,
        })).toThrow();
    });
});
