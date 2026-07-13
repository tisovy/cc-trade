import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES,
    FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN,
    FuturesTestnetExecutionCoordinator,
    FuturesTestnetExecutionOrderBucket,
} from './futures-testnet-execution-coordinator.js';

const createHarness = (overrides = {}) => {
    let spotAvailable = 800;
    let futuresAvailable = 800;
    const legacySpotExecutor = vi.fn(async (...args) => args);
    const futuresTestnetExecutor = vi.fn(async operation => operation());
    const coordinator = new FuturesTestnetExecutionCoordinator({
        legacySpotExecutor,
        getLegacySpotAvailableWeight: () => spotAvailable,
        futuresTestnetExecutor,
        getFuturesTestnetAvailableWeight: () => futuresAvailable,
        ...overrides,
    });
    return {
        coordinator,
        legacySpotExecutor,
        futuresTestnetExecutor,
        setSpotAvailable: value => { spotAvailable = value; },
        setFuturesAvailable: value => { futuresAvailable = value; },
    };
};

afterEach(() => {
    vi.useRealTimers();
});

describe('FuturesTestnetExecutionCoordinator', () => {
    it('forwards legacy Spot execution arguments unchanged', async () => {
        const harness = createHarness();
        const operation = vi.fn();
        const options = { signal: new AbortController().signal, legacy: true };

        await expect(harness.coordinator.executeSpot(operation, 23, 2, options))
            .resolves.toEqual([operation, 23, 2, options]);
        expect(harness.legacySpotExecutor).toHaveBeenCalledExactlyOnceWith(
            operation,
            23,
            2,
            options,
        );
        expect(harness.futuresTestnetExecutor).not.toHaveBeenCalled();
    });

    it('uses the separate demo bucket and forces zero retries for every GET', async () => {
        const harness = createHarness();
        const lease = await harness.coordinator.beginPreflight();
        const operation = vi.fn().mockResolvedValue('ok');

        await expect(lease.executeGet(operation, 5)).resolves.toBe('ok');
        expect(harness.futuresTestnetExecutor).toHaveBeenCalledExactlyOnceWith(
            operation,
            5,
            0,
            {
                signal: undefined,
                origin: FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN,
                priority: 'low',
            },
        );
        expect(harness.legacySpotExecutor).not.toHaveBeenCalled();
        expect(lease.getUsedWeight()).toBe(5);
        expect(lease.release()).toBe(true);
        expect(lease.release()).toBe(false);
    });

    it('requires Spot headroom and demo preflight capacity', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const harness = createHarness();
        harness.setSpotAvailable(22);
        harness.setFuturesAvailable(24);

        const pending = harness.coordinator.beginPreflight();
        const rejected = expect(pending).rejects.toMatchObject({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES
                .PREFLIGHT_ADMISSION_TIMEOUT,
        });
        await vi.advanceTimersByTimeAsync(999);
        expect(harness.futuresTestnetExecutor).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
    });

    it('admits as soon as exact Spot headroom and demo capacity become available', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
        const harness = createHarness();
        harness.setSpotAvailable(22);
        harness.setFuturesAvailable(24);

        const pending = harness.coordinator.beginPreflight();
        await vi.advanceTimersByTimeAsync(990);
        harness.setSpotAvailable(23);
        harness.setFuturesAvailable(25);
        await vi.advanceTimersByTimeAsync(10);

        const lease = await pending;
        expect(lease.origin).toBe(FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN);
        lease.release();
    });

    it('lets a Spot waiter preempt an admitted low-priority preflight', async () => {
        let resolveSpot;
        const spotResult = new Promise(resolve => { resolveSpot = resolve; });
        const harness = createHarness({
            legacySpotExecutor: vi.fn(() => spotResult),
        });
        const lease = await harness.coordinator.beginPreflight();
        const spot = harness.coordinator.executeSpot('spot-operation');

        await expect(lease.executeGet(() => 'forbidden', 1)).rejects.toMatchObject({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.SPOT_PRIORITY,
        });
        expect(harness.futuresTestnetExecutor).not.toHaveBeenCalled();
        resolveSpot('spot-complete');
        await expect(spot).resolves.toBe('spot-complete');
        lease.release();
    });

    it('serializes preflight leases and enforces the reviewed 25-weight ceiling', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(20_000);
        const harness = createHarness();
        const first = await harness.coordinator.beginPreflight();
        const secondPending = harness.coordinator.beginPreflight();

        await first.executeGet(() => 'first', 25);
        await expect(first.executeGet(() => 'overflow', 1)).rejects.toMatchObject({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES
                .PREFLIGHT_WEIGHT_EXCEEDED,
        });
        first.release();
        await vi.advanceTimersByTimeAsync(10);
        const second = await secondPending;
        second.release();
    });

    it('aborts queued admission without touching either origin executor', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(30_000);
        const harness = createHarness();
        harness.setSpotAvailable(0);
        const controller = new AbortController();
        const pending = harness.coordinator.beginPreflight({ signal: controller.signal });
        await vi.advanceTimersByTimeAsync(100);
        controller.abort();

        await expect(pending).rejects.toMatchObject({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.ABORTED,
        });
        expect(harness.legacySpotExecutor).not.toHaveBeenCalled();
        expect(harness.futuresTestnetExecutor).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('restores persisted order state and coordinates Query Order under Spot priority', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const harness = createHarness();
        expect(harness.coordinator.restoreOrderState({
            dispatchTimes: [95_000],
            pauseUntil: 105_000,
        })).toMatchObject({
            dispatchTimes: [95_000],
            pauseUntil: 105_000,
        });
        const operation = vi.fn().mockResolvedValue('order');
        await expect(harness.coordinator.executeRecoveryQuery(operation)).rejects.toMatchObject({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.RATE_PAUSED,
        });

        vi.setSystemTime(105_000);
        await expect(harness.coordinator.executeRecoveryQuery(operation)).resolves.toBe('order');
        expect(harness.futuresTestnetExecutor).toHaveBeenLastCalledWith(
            operation,
            1,
            0,
            {
                signal: undefined,
                origin: FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN,
                priority: 'low',
            },
        );
    });

    it('fails closed when restored dispatch counters are ahead of the clock', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100_000);
        const harness = createHarness();
        expect(() => harness.coordinator.restoreOrderState({
            dispatchTimes: [100_001],
            pauseUntil: 0,
        })).toThrowError(expect.objectContaining({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
        }));
    });
});

describe('FuturesTestnetExecutionOrderBucket', () => {
    it('enforces one dispatch per ten seconds and five per minute', () => {
        let current = 0;
        const bucket = new FuturesTestnetExecutionOrderBucket({ now: () => current });

        expect(bucket.reserveDispatch().dispatchTimes).toEqual([0]);
        expect(() => bucket.reserveDispatch()).toThrowError(expect.objectContaining({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.ORDER_COUNT_LIMITED,
        }));

        for (const time of [10_000, 20_000, 30_000, 40_000]) {
            current = time;
            bucket.reserveDispatch();
        }
        current = 50_000;
        expect(() => bucket.reserveDispatch()).toThrowError(expect.objectContaining({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.ORDER_COUNT_LIMITED,
        }));
        current = 60_000;
        expect(bucket.reserveDispatch().dispatchTimes).toEqual([
            10_000,
            20_000,
            30_000,
            40_000,
            60_000,
        ]);
    });

    it('persists the later pause and fails closed on clock rollback', () => {
        let current = 100_000;
        const bucket = new FuturesTestnetExecutionOrderBucket({ now: () => current });
        bucket.setPauseUntil(110_000);
        bucket.setPauseUntil(105_000);
        expect(bucket.snapshot().pauseUntil).toBe(110_000);
        expect(() => bucket.reserveDispatch()).toThrowError(expect.objectContaining({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.RATE_PAUSED,
        }));

        current = 110_000;
        bucket.reserveDispatch();
        current = 109_999;
        expect(() => bucket.reserveDispatch()).toThrowError(expect.objectContaining({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
        }));
    });

    it('reconstructs durable counters and pause state from injected state', () => {
        let current = 70_000;
        const bucket = new FuturesTestnetExecutionOrderBucket({
            now: () => current,
            initialDispatchTimes: [20_000, 60_000],
            initialPauseUntil: 75_000,
        });
        expect(bucket.snapshot()).toMatchObject({
            dispatchTimes: [20_000, 60_000],
            pauseUntil: 75_000,
        });
        expect(() => bucket.reserveDispatch()).toThrowError(expect.objectContaining({
            code: FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.RATE_PAUSED,
        }));
        current = 75_000;
        expect(bucket.reserveDispatch().dispatchTimes).toEqual([20_000, 60_000, 75_000]);
    });
});
