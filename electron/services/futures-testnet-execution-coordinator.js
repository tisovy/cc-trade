import {
    FUTURES_TESTNET_EXECUTION_REST_ORIGIN,
} from './futures-testnet-execution-config.js';

export const FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN = FUTURES_TESTNET_EXECUTION_REST_ORIGIN;

export const FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS = Object.freeze({
    spotHeadroomWeight: 23,
    preflightWeight: 25,
    preflightAdmissionMs: 1_000,
    admissionPollMs: 10,
    maxOrdersPerTenSeconds: 1,
    maxOrdersPerMinute: 5,
    tenSecondWindowMs: 10_000,
    minuteWindowMs: 60_000,
});

export const FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES = Object.freeze({
    INVALID_CONFIGURATION: 'FUTURES_EXECUTION_COORDINATOR_INVALID_CONFIGURATION',
    INVALID_ARGUMENTS: 'FUTURES_EXECUTION_COORDINATOR_INVALID_ARGUMENTS',
    PREFLIGHT_ADMISSION_TIMEOUT: 'FUTURES_EXECUTION_PREFLIGHT_ADMISSION_TIMEOUT',
    PREFLIGHT_LEASE_RELEASED: 'FUTURES_EXECUTION_PREFLIGHT_LEASE_RELEASED',
    PREFLIGHT_WEIGHT_EXCEEDED: 'FUTURES_EXECUTION_PREFLIGHT_WEIGHT_EXCEEDED',
    SPOT_PRIORITY: 'FUTURES_EXECUTION_SPOT_PRIORITY',
    ABORTED: 'FUTURES_EXECUTION_COORDINATOR_ABORTED',
    ORDER_COUNT_LIMITED: 'FUTURES_EXECUTION_ORDER_COUNT_LIMITED',
    RATE_PAUSED: 'FUTURES_EXECUTION_RATE_PAUSED',
    CLOCK_REGRESSED: 'FUTURES_EXECUTION_CLOCK_REGRESSED',
    RECOVERY_ADMISSION_REJECTED: 'FUTURES_EXECUTION_RECOVERY_ADMISSION_REJECTED',
});

export class FuturesTestnetExecutionCoordinatorError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesTestnetExecutionCoordinatorError';
        this.code = code;
    }
}

const fail = (code, message) => {
    throw new FuturesTestnetExecutionCoordinatorError(code, message);
};

const requireFunction = (value, name) => {
    if (typeof value !== 'function') {
        fail(
            FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
            `${name} must be a function`,
        );
    }
    return value;
};

const requirePositiveSafeInteger = (value, name) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail(
            FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
            `${name} must be a positive safe integer`,
        );
    }
    return value;
};

const requireNonNegativeSafeInteger = (value, name) => {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail(
            FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
            `${name} must be a non-negative safe integer`,
        );
    }
    return value;
};

const createAbortError = () => new FuturesTestnetExecutionCoordinatorError(
    FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.ABORTED,
    'Futures testnet execution admission was aborted',
);

const throwIfAborted = (signal) => {
    if (signal?.aborted) throw createAbortError();
};

const wait = ({ delay, signal, setTimeoutFn, clearTimeoutFn }) => {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener?.('abort', onAbort);
            callback(value);
        };
        const timer = setTimeoutFn(() => finish(resolve), delay);
        const onAbort = () => {
            clearTimeoutFn(timer);
            finish(reject, createAbortError());
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
};

const normalizeCapacity = (value) => (
    Number.isSafeInteger(value) && value >= 0 ? value : 0
);

const readCapacity = (read) => {
    try {
        return normalizeCapacity(read());
    } catch {
        return 0;
    }
};

const hasOnlyFields = (value, fields) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Reflect.ownKeys(value).every(key => fields.includes(key))
);

export class FuturesTestnetExecutionOrderBucket {
    constructor({
        now = Date.now,
        initialDispatchTimes = [],
        initialPauseUntil = 0,
        maximumTenSecondOrders = FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS
            .maxOrdersPerTenSeconds,
        maximumMinuteOrders = FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS
            .maxOrdersPerMinute,
        tenSecondWindowMs = FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS.tenSecondWindowMs,
        minuteWindowMs = FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS.minuteWindowMs,
    } = {}) {
        this.now = requireFunction(now, 'now');
        this.maximumTenSecondOrders = requirePositiveSafeInteger(
            maximumTenSecondOrders,
            'maximumTenSecondOrders',
        );
        this.maximumMinuteOrders = requirePositiveSafeInteger(
            maximumMinuteOrders,
            'maximumMinuteOrders',
        );
        this.tenSecondWindowMs = requirePositiveSafeInteger(
            tenSecondWindowMs,
            'tenSecondWindowMs',
        );
        this.minuteWindowMs = requirePositiveSafeInteger(minuteWindowMs, 'minuteWindowMs');
        if (this.tenSecondWindowMs > this.minuteWindowMs
            || this.maximumTenSecondOrders > this.maximumMinuteOrders) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Order-count windows are inconsistent',
            );
        }
        if (!Array.isArray(initialDispatchTimes)
            || initialDispatchTimes.some(value => !Number.isSafeInteger(value) || value < 0)) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'initialDispatchTimes must contain only non-negative safe integers',
            );
        }
        if (!Number.isSafeInteger(initialPauseUntil) || initialPauseUntil < 0) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'initialPauseUntil must be a non-negative safe integer',
            );
        }

        this.dispatchTimes = [...initialDispatchTimes].sort((left, right) => left - right);
        this.pauseUntil = initialPauseUntil;
        this.lastObservedNow = 0;
    }

    readNow() {
        const current = this.now();
        if (!Number.isSafeInteger(current) || current < 0) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'now must return a non-negative safe integer',
            );
        }
        if (current < this.lastObservedNow) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
                'Execution order-count clock regressed',
            );
        }
        this.lastObservedNow = current;
        return current;
    }

    cleanup(current) {
        this.dispatchTimes = this.dispatchTimes.filter(
            dispatchTime => current - dispatchTime < this.minuteWindowMs,
        );
    }

    setPauseUntil(pauseUntil) {
        requireNonNegativeSafeInteger(pauseUntil, 'pauseUntil');
        this.pauseUntil = Math.max(this.pauseUntil, pauseUntil);
        return this.snapshot();
    }

    restore({ dispatchTimes, pauseUntil }) {
        if (!Array.isArray(dispatchTimes)
            || dispatchTimes.some(value => !Number.isSafeInteger(value) || value < 0)
            || !Number.isSafeInteger(pauseUntil)
            || pauseUntil < 0) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Persisted order-count state is invalid',
            );
        }
        const current = this.readNow();
        if (dispatchTimes.some(value => value > current)) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
                'Persisted dispatch time is ahead of the current clock',
            );
        }
        this.dispatchTimes = [...dispatchTimes].sort((left, right) => left - right);
        this.pauseUntil = pauseUntil;
        this.cleanup(current);
        return this.snapshot();
    }

    assertRecoveryAvailable() {
        const current = this.readNow();
        this.cleanup(current);
        if (current < this.pauseUntil) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.RATE_PAUSED,
                'Futures testnet recovery is rate paused',
            );
        }
        return current;
    }

    reserveDispatch() {
        const current = this.readNow();
        this.cleanup(current);
        if (current < this.pauseUntil) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.RATE_PAUSED,
                'Futures testnet execution is rate paused',
            );
        }

        const tenSecondCount = this.dispatchTimes.filter(
            dispatchTime => current - dispatchTime < this.tenSecondWindowMs,
        ).length;
        if (tenSecondCount >= this.maximumTenSecondOrders
            || this.dispatchTimes.length >= this.maximumMinuteOrders) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.ORDER_COUNT_LIMITED,
                'Futures testnet execution order-count policy rejected dispatch',
            );
        }

        this.dispatchTimes.push(current);
        return this.snapshot();
    }

    snapshot() {
        return Object.freeze({
            dispatchTimes: Object.freeze([...this.dispatchTimes]),
            pauseUntil: this.pauseUntil,
            lastObservedNow: this.lastObservedNow,
        });
    }
}

export class FuturesTestnetExecutionCoordinator {
    constructor({
        legacySpotExecutor,
        getLegacySpotAvailableWeight,
        futuresTestnetExecutor,
        getFuturesTestnetAvailableWeight,
        orderBucket = new FuturesTestnetExecutionOrderBucket(),
        now = Date.now,
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout,
        spotHeadroomWeight = FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS.spotHeadroomWeight,
        preflightWeight = FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS.preflightWeight,
        preflightAdmissionMs = FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS
            .preflightAdmissionMs,
        admissionPollMs = FUTURES_TESTNET_EXECUTION_COORDINATOR_LIMITS.admissionPollMs,
    }) {
        this.legacySpotExecutor = requireFunction(legacySpotExecutor, 'legacySpotExecutor');
        this.getLegacySpotAvailableWeight = requireFunction(
            getLegacySpotAvailableWeight,
            'getLegacySpotAvailableWeight',
        );
        this.futuresTestnetExecutor = requireFunction(
            futuresTestnetExecutor,
            'futuresTestnetExecutor',
        );
        this.getFuturesTestnetAvailableWeight = requireFunction(
            getFuturesTestnetAvailableWeight,
            'getFuturesTestnetAvailableWeight',
        );
        if (!(orderBucket instanceof FuturesTestnetExecutionOrderBucket)) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'orderBucket must be a FuturesTestnetExecutionOrderBucket',
            );
        }
        this.orderBucket = orderBucket;
        this.now = requireFunction(now, 'now');
        this.setTimeoutFn = requireFunction(setTimeoutFn, 'setTimeoutFn');
        this.clearTimeoutFn = requireFunction(clearTimeoutFn, 'clearTimeoutFn');
        this.spotHeadroomWeight = requirePositiveSafeInteger(
            spotHeadroomWeight,
            'spotHeadroomWeight',
        );
        this.preflightWeight = requirePositiveSafeInteger(preflightWeight, 'preflightWeight');
        this.preflightAdmissionMs = requirePositiveSafeInteger(
            preflightAdmissionMs,
            'preflightAdmissionMs',
        );
        this.admissionPollMs = requirePositiveSafeInteger(admissionPollMs, 'admissionPollMs');
        this.spotWaiters = 0;
        this.activePreflight = null;
        this.nextLeaseId = 0;
    }

    async executeSpot(...args) {
        this.spotWaiters += 1;
        try {
            return await this.legacySpotExecutor(...args);
        } finally {
            this.spotWaiters -= 1;
        }
    }

    canAdmitPreflight() {
        return this.activePreflight === null
            && this.spotWaiters === 0
            && readCapacity(this.getLegacySpotAvailableWeight)
                >= this.spotHeadroomWeight
            && readCapacity(this.getFuturesTestnetAvailableWeight)
                >= this.preflightWeight;
    }

    async beginPreflight(options = {}) {
        if (!hasOnlyFields(options, ['signal'])) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'beginPreflight accepts only an optional signal',
            );
        }
        const { signal } = options;
        const startedAt = this.now();
        if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'now must return a non-negative safe integer',
            );
        }
        const deadline = startedAt + this.preflightAdmissionMs;
        if (!Number.isSafeInteger(deadline)) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Preflight admission deadline overflowed',
            );
        }

        while (!this.canAdmitPreflight()) {
            throwIfAborted(signal);
            const current = this.now();
            if (!Number.isSafeInteger(current) || current < startedAt || current >= deadline) {
                fail(
                    FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES
                        .PREFLIGHT_ADMISSION_TIMEOUT,
                    'Low-priority futures preflight admission timed out',
                );
            }
            await wait({
                delay: Math.min(this.admissionPollMs, deadline - current),
                signal,
                setTimeoutFn: this.setTimeoutFn,
                clearTimeoutFn: this.clearTimeoutFn,
            });
        }

        throwIfAborted(signal);
        const leaseState = {
            id: ++this.nextLeaseId,
            active: true,
            usedWeight: 0,
        };
        this.activePreflight = leaseState;

        const assertActive = () => {
            if (!leaseState.active || this.activePreflight !== leaseState) {
                fail(
                    FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES
                        .PREFLIGHT_LEASE_RELEASED,
                    'Futures preflight lease is no longer active',
                );
            }
        };
        const release = () => {
            if (!leaseState.active) return false;
            leaseState.active = false;
            if (this.activePreflight === leaseState) this.activePreflight = null;
            return true;
        };

        return Object.freeze({
            origin: FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN,
            executeGet: async (operation, weight, getOptions = {}) => {
                assertActive();
                requireFunction(operation, 'operation');
                requirePositiveSafeInteger(weight, 'weight');
                if (!hasOnlyFields(getOptions, ['signal'])) {
                    fail(
                        FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                        'executeGet accepts only an optional signal',
                    );
                }
                throwIfAborted(getOptions.signal);
                if (this.spotWaiters > 0
                    || readCapacity(this.getLegacySpotAvailableWeight)
                        < this.spotHeadroomWeight) {
                    fail(
                        FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.SPOT_PRIORITY,
                        'Spot work took priority over futures preflight',
                    );
                }
                if (leaseState.usedWeight + weight > this.preflightWeight) {
                    fail(
                        FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES
                            .PREFLIGHT_WEIGHT_EXCEEDED,
                        'Futures preflight exceeded its reviewed weight',
                    );
                }
                leaseState.usedWeight += weight;
                return this.futuresTestnetExecutor(operation, weight, 0, {
                    signal: getOptions.signal,
                    origin: FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN,
                    priority: 'low',
                });
            },
            getUsedWeight: () => leaseState.usedWeight,
            release,
        });
    }

    reserveOrderDispatch() {
        return this.orderBucket.reserveDispatch();
    }

    setOrderPauseUntil(pauseUntil) {
        return this.orderBucket.setPauseUntil(pauseUntil);
    }

    restoreOrderState(state) {
        return this.orderBucket.restore(state);
    }

    async executeRecoveryQuery(operation, options = {}) {
        requireFunction(operation, 'operation');
        if (!hasOnlyFields(options, ['signal'])) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'executeRecoveryQuery accepts only an optional signal',
            );
        }
        throwIfAborted(options.signal);
        this.orderBucket.assertRecoveryAvailable();
        if (this.spotWaiters > 0
            || readCapacity(this.getLegacySpotAvailableWeight) < this.spotHeadroomWeight
            || readCapacity(this.getFuturesTestnetAvailableWeight) < 1) {
            fail(
                FUTURES_TESTNET_EXECUTION_COORDINATOR_ERROR_CODES.RECOVERY_ADMISSION_REJECTED,
                'Spot or demo-origin quota took priority over recovery',
            );
        }
        return this.futuresTestnetExecutor(operation, 1, 0, {
            signal: options.signal,
            origin: FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN,
            priority: 'low',
        });
    }

    getOrderAdmissionSnapshot() {
        return this.orderBucket.snapshot();
    }
}

export const createFuturesTestnetExecutionCoordinator = options => (
    new FuturesTestnetExecutionCoordinator(options)
);
