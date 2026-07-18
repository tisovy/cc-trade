import {
    addFuturesProductionExactDecimals,
    canonicalFuturesProductionUtcDay,
    compareFuturesProductionExactDecimals,
    normalizeFuturesProductionExactDecimal,
} from './futures-production-execution-ledger.js';
import {
    FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
} from './futures-production-execution-config.js';

export { FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN };

export const FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS = Object.freeze({
    spotHeadroomWeight: 23,
    preflightWeight: 40,
    preflightAdmissionMs: 1_000,
    admissionPollMs: 10,
    maximumTenSecondOrders: 1,
    maximumMinuteOrders: 5,
    tenSecondWindowMs: 10_000,
    minuteWindowMs: 60_000,
    maximumOriginRequestWeight: 800,
    originWeightWindowMs: 60_000,
});

export const FUTURES_PRODUCTION_EXECUTION_ENDPOINT_IDS = Object.freeze([
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

export const FUTURES_PRODUCTION_EXECUTION_ENDPOINT_WEIGHTS = Object.freeze({
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

const REVIEWED_ENDPOINT_IDS = new Set(FUTURES_PRODUCTION_EXECUTION_ENDPOINT_IDS);

export const FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES = Object.freeze({
    INVALID_CONFIGURATION: 'FUTURES_PRODUCTION_COORDINATOR_INVALID_CONFIGURATION',
    INVALID_ARGUMENTS: 'FUTURES_PRODUCTION_COORDINATOR_INVALID_ARGUMENTS',
    PREFLIGHT_ADMISSION_TIMEOUT: 'FUTURES_PRODUCTION_PREFLIGHT_ADMISSION_TIMEOUT',
    PREFLIGHT_LEASE_RELEASED: 'FUTURES_PRODUCTION_PREFLIGHT_LEASE_RELEASED',
    PREFLIGHT_WEIGHT_EXCEEDED: 'FUTURES_PRODUCTION_PREFLIGHT_WEIGHT_EXCEEDED',
    SPOT_PRIORITY: 'FUTURES_PRODUCTION_SPOT_PRIORITY',
    ABORTED: 'FUTURES_PRODUCTION_COORDINATOR_ABORTED',
    ORDER_COUNT_LIMITED: 'FUTURES_PRODUCTION_ORDER_COUNT_LIMITED',
    DAILY_NOTIONAL_EXCEEDED: 'FUTURES_PRODUCTION_DAILY_NOTIONAL_EXCEEDED',
    RATE_PAUSED: 'FUTURES_PRODUCTION_RATE_PAUSED',
    CLOCK_REGRESSED: 'FUTURES_PRODUCTION_CLOCK_REGRESSED',
    UTC_DAY_REGRESSED: 'FUTURES_PRODUCTION_UTC_DAY_REGRESSED',
    RECOVERY_ADMISSION_REJECTED: 'FUTURES_PRODUCTION_RECOVERY_ADMISSION_REJECTED',
    ORIGIN_WEIGHT_LIMITED: 'FUTURES_PRODUCTION_ORIGIN_WEIGHT_LIMITED',
    PERSISTENCE_FAILED: 'FUTURES_PRODUCTION_COORDINATOR_PERSISTENCE_FAILED',
});

export class FuturesProductionExecutionCoordinatorError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesProductionExecutionCoordinatorError';
        this.code = code;
    }
}

const fail = (code, message) => {
    throw new FuturesProductionExecutionCoordinatorError(code, message);
};

const requireFunction = (value, name) => {
    if (typeof value !== 'function') {
        fail(
            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
            `${name} must be a function`,
        );
    }
    return value;
};

const requirePositiveSafeInteger = (value, name) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail(
            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
            `${name} must be a positive safe integer`,
        );
    }
    return value;
};

const requireNonNegativeSafeInteger = (value, name, code = 'arguments') => {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail(
            code === 'configuration'
                ? FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION
                : FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
            `${name} must be a non-negative safe integer`,
        );
    }
    return value;
};

const requireReviewedEndpointId = (value) => {
    if (typeof value !== 'string' || !REVIEWED_ENDPOINT_IDS.has(value)) {
        fail(
            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
            'endpointId must identify an exact reviewed production endpoint',
        );
    }
    return value;
};

const requireReviewedEndpointWeight = (endpointId, requestWeight) => {
    const reviewedEndpointId = requireReviewedEndpointId(endpointId);
    if (FUTURES_PRODUCTION_EXECUTION_ENDPOINT_WEIGHTS[reviewedEndpointId] !== requestWeight) {
        fail(
            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
            'requestWeight must exactly match the reviewed production endpoint',
        );
    }
    return reviewedEndpointId;
};

const hasOnlyFields = (value, fields) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).every((key) => {
        if (typeof key !== 'string' || !fields.includes(key)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && Object.hasOwn(descriptor, 'value');
    })
);

const isPlainDataObject = value => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).every((key) => {
        if (typeof key !== 'string') return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && Object.hasOwn(descriptor, 'value');
    })
);

const readCapacity = (read) => {
    try {
        const value = read();
        return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } catch {
        return 0;
    }
};

const createAbortError = () => new FuturesProductionExecutionCoordinatorError(
    FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.ABORTED,
    'Futures production execution admission was aborted',
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

const normalizeDailyReservations = (value) => {
    if (!isPlainDataObject(value)) {
        fail(
            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
            'Persisted daily reservations must be a plain data object',
        );
    }
    const entries = Object.entries(value);
    if (entries.length > 100_000) {
        fail(
            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
            'Persisted daily reservations are unbounded',
        );
    }
    const normalized = new Map();
    try {
        for (const [day, notional] of entries) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day)
                || canonicalFuturesProductionUtcDay(Date.parse(`${day}T00:00:00.000Z`)) !== day) {
                throw new Error('invalid day');
            }
            const normalizedNotional = normalizeFuturesProductionExactDecimal(notional);
            if (compareFuturesProductionExactDecimals(normalizedNotional, '0') <= 0) {
                throw new Error('invalid notional');
            }
            normalized.set(day, normalizedNotional);
        }
    } catch {
        fail(
            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
            'Persisted daily reservations are invalid',
        );
    }
    return normalized;
};

const normalizeOriginWeightReservations = (value, maximumOriginRequestWeight) => {
    if (!Array.isArray(value) || value.length > maximumOriginRequestWeight) {
        fail(
            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
            'Persisted production-origin weight reservations are invalid or unbounded',
        );
    }
    let previousObservedAt = null;
    let totalWeight = 0;
    const normalized = value.map((reservation) => {
        if (!hasOnlyFields(reservation, ['observedAt', 'requestWeight'])) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Persisted production-origin weight reservation has unknown fields',
            );
        }
        const observedAt = requireNonNegativeSafeInteger(
            reservation.observedAt,
            'origin reservation observedAt',
            'configuration',
        );
        const requestWeight = requirePositiveSafeInteger(
            reservation.requestWeight,
            'origin reservation requestWeight',
        );
        if (requestWeight > maximumOriginRequestWeight
            || (previousObservedAt !== null && observedAt < previousObservedAt)) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Persisted production-origin weight reservations are not monotonic',
            );
        }
        totalWeight += requestWeight;
        if (!Number.isSafeInteger(totalWeight)) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Persisted production-origin request weight overflowed',
            );
        }
        previousObservedAt = observedAt;
        return Object.freeze({ observedAt, requestWeight });
    });
    return Object.freeze(normalized);
};

export class FuturesProductionExecutionOriginBucket {
    constructor({
        now = Date.now,
        initialOriginWeightReservations = [],
        initialLastOriginWeightObservedAt = null,
        maximumOriginRequestWeight = FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS
            .maximumOriginRequestWeight,
        originWeightWindowMs = FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS
            .originWeightWindowMs,
    } = {}) {
        this.now = requireFunction(now, 'now');
        this.maximumOriginRequestWeight = requirePositiveSafeInteger(
            maximumOriginRequestWeight,
            'maximumOriginRequestWeight',
        );
        this.originWeightWindowMs = requirePositiveSafeInteger(
            originWeightWindowMs,
            'originWeightWindowMs',
        );
        this.reservations = [];
        this.lastOriginWeightObservedAt = null;
        this.lastObservedNow = 0;
        this.version = 0;
        this.restore({
            originWeightReservations: initialOriginWeightReservations,
            lastOriginWeightObservedAt: initialLastOriginWeightObservedAt,
        });
    }

    readNow() {
        const current = this.now();
        if (!Number.isSafeInteger(current) || current < 0) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'now must return a non-negative safe integer',
            );
        }
        if (current < this.lastObservedNow) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
                'Production-origin request-weight clock regressed',
            );
        }
        this.lastObservedNow = current;
        return current;
    }

    activeReservations(current) {
        return this.reservations.filter(
            reservation => current - reservation.observedAt < this.originWeightWindowMs,
        );
    }

    restore({ originWeightReservations, lastOriginWeightObservedAt }) {
        const normalized = normalizeOriginWeightReservations(
            originWeightReservations,
            this.maximumOriginRequestWeight,
        );
        if (lastOriginWeightObservedAt !== null) {
            requireNonNegativeSafeInteger(
                lastOriginWeightObservedAt,
                'lastOriginWeightObservedAt',
                'configuration',
            );
        }
        const latestReservation = normalized.at(-1)?.observedAt ?? null;
        if ((latestReservation !== null && lastOriginWeightObservedAt === null)
            || (latestReservation !== null && latestReservation > lastOriginWeightObservedAt)
            || (this.lastOriginWeightObservedAt !== null
                && (lastOriginWeightObservedAt === null
                    || lastOriginWeightObservedAt < this.lastOriginWeightObservedAt))) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
                'Persisted production-origin weight clock is incomplete or regressed',
            );
        }
        const current = this.readNow();
        if (lastOriginWeightObservedAt !== null && lastOriginWeightObservedAt > current) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
                'Persisted production-origin weight clock is ahead of the local clock',
            );
        }
        const active = normalized.filter(
            reservation => current - reservation.observedAt < this.originWeightWindowMs,
        );
        const activeWeight = active.reduce(
            (sum, reservation) => sum + reservation.requestWeight,
            0,
        );
        if (activeWeight > this.maximumOriginRequestWeight) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Persisted production-origin request weight exceeds the reviewed maximum',
            );
        }
        this.reservations = [...active];
        this.lastOriginWeightObservedAt = lastOriginWeightObservedAt;
        this.version += 1;
        return this.snapshot();
    }

    canReserve(requestWeight) {
        requirePositiveSafeInteger(requestWeight, 'requestWeight');
        const current = this.readNow();
        const usedWeight = this.activeReservations(current).reduce(
            (sum, reservation) => sum + reservation.requestWeight,
            0,
        );
        return usedWeight + requestWeight <= this.maximumOriginRequestWeight;
    }

    prepareReservation(requestWeight) {
        requirePositiveSafeInteger(requestWeight, 'requestWeight');
        const observedAt = this.readNow();
        const active = this.activeReservations(observedAt);
        const usedWeight = active.reduce(
            (sum, reservation) => sum + reservation.requestWeight,
            0,
        );
        if (requestWeight > this.maximumOriginRequestWeight
            || usedWeight + requestWeight > this.maximumOriginRequestWeight) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.ORIGIN_WEIGHT_LIMITED,
                'Durable production-origin request-weight policy rejected dispatch',
            );
        }
        return Object.freeze({
            version: this.version,
            active: Object.freeze([...active]),
            observedAt,
            requestWeight,
        });
    }

    commitReservation(prepared) {
        if (!prepared || prepared.version !== this.version) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.PERSISTENCE_FAILED,
                'Persisted production-origin weight reservation became stale',
            );
        }
        this.reservations = [
            ...prepared.active,
            Object.freeze({
                observedAt: prepared.observedAt,
                requestWeight: prepared.requestWeight,
            }),
        ];
        this.lastOriginWeightObservedAt = prepared.observedAt;
        this.version += 1;
        return this.snapshot();
    }

    snapshot() {
        return Object.freeze({
            originWeightReservations: Object.freeze(this.reservations.map(
                reservation => Object.freeze({ ...reservation }),
            )),
            lastOriginWeightObservedAt: this.lastOriginWeightObservedAt,
            lastObservedNow: this.lastObservedNow,
            maximumOriginRequestWeight: this.maximumOriginRequestWeight,
            originWeightWindowMs: this.originWeightWindowMs,
        });
    }
}

export class FuturesProductionExecutionOrderBucket {
    constructor({
        now = Date.now,
        initialDispatchTimes = [],
        initialPauseUntil = 0,
        initialDailyReservations = {},
        initialLastUtcDay = null,
        initialLastServerTime = null,
        maximumTenSecondOrders = FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS
            .maximumTenSecondOrders,
        maximumMinuteOrders = FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS
            .maximumMinuteOrders,
        tenSecondWindowMs = FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS.tenSecondWindowMs,
        minuteWindowMs = FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS.minuteWindowMs,
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
        this.tenSecondWindowMs = requirePositiveSafeInteger(tenSecondWindowMs, 'tenSecondWindowMs');
        this.minuteWindowMs = requirePositiveSafeInteger(minuteWindowMs, 'minuteWindowMs');
        if (this.tenSecondWindowMs > this.minuteWindowMs
            || this.maximumTenSecondOrders > this.maximumMinuteOrders) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Order-count windows are inconsistent',
            );
        }
        this.dispatchTimes = [];
        this.pauseUntil = 0;
        this.dailyReservations = new Map();
        this.lastUtcDay = null;
        this.lastServerTime = null;
        this.lastObservedNow = 0;
        this.version = 0;
        this.restore({
            dispatchTimes: initialDispatchTimes,
            pauseUntil: initialPauseUntil,
            dailyReservations: initialDailyReservations,
            lastUtcDay: initialLastUtcDay,
            lastServerTime: initialLastServerTime,
        });
    }

    readNow() {
        const current = this.now();
        if (!Number.isSafeInteger(current) || current < 0) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'now must return a non-negative safe integer',
            );
        }
        if (current < this.lastObservedNow) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
                'Production order-count clock regressed',
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

    restore({
        dispatchTimes,
        pauseUntil,
        dailyReservations,
        lastUtcDay,
        lastServerTime,
    }) {
        if (!Array.isArray(dispatchTimes)
            || dispatchTimes.some(value => !Number.isSafeInteger(value) || value < 0)) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Persisted dispatch times are invalid',
            );
        }
        requireNonNegativeSafeInteger(pauseUntil, 'pauseUntil', 'configuration');
        const normalizedDaily = normalizeDailyReservations(dailyReservations);
        if (lastUtcDay !== null
            && (!/^\d{4}-\d{2}-\d{2}$/.test(lastUtcDay)
                || !normalizedDaily.has(lastUtcDay))) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Persisted UTC day is invalid',
            );
        }
        if (lastServerTime !== null
            && (!Number.isSafeInteger(lastServerTime)
                || lastServerTime < 0
                || canonicalFuturesProductionUtcDay(lastServerTime) !== lastUtcDay)) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Persisted server clock is invalid',
            );
        }
        if ((lastUtcDay === null) !== (lastServerTime === null)
            || (normalizedDaily.size > 0
                && [...normalizedDaily.keys()].sort().at(-1) !== lastUtcDay)) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Persisted daily clock state is incomplete',
            );
        }
        const current = this.readNow();
        if (dispatchTimes.some(value => value > current)) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
                'Persisted dispatch time is ahead of the local clock',
            );
        }
        this.dispatchTimes = [...dispatchTimes].sort((left, right) => left - right);
        this.pauseUntil = pauseUntil;
        this.dailyReservations = normalizedDaily;
        this.lastUtcDay = lastUtcDay;
        this.lastServerTime = lastServerTime;
        this.cleanup(current);
        this.version += 1;
        return this.snapshot();
    }

    prepareReservation({
        exactNotional,
        utcDay,
        serverTime,
        maximumDailyNotional,
        positionEffect = null,
    }) {
        let increment;
        let maximum;
        try {
            increment = normalizeFuturesProductionExactDecimal(exactNotional);
            maximum = normalizeFuturesProductionExactDecimal(maximumDailyNotional);
        } catch {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'Exact daily notional arguments are invalid',
            );
        }
        const incrementComparison = compareFuturesProductionExactDecimals(increment, '0');
        if (incrementComparison < 0
            || (incrementComparison === 0 && positionEffect !== 'EXIT')
            || compareFuturesProductionExactDecimals(maximum, '0') <= 0) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'Exact daily notional must be positive except for a verified reducing exit',
            );
        }
        let canonicalDay;
        try {
            canonicalDay = canonicalFuturesProductionUtcDay(serverTime);
        } catch {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'Production server time is invalid',
            );
        }
        if (utcDay !== canonicalDay) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'UTC day does not match production server time',
            );
        }
        if (this.lastServerTime !== null && serverTime < this.lastServerTime) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.CLOCK_REGRESSED,
                'Production server clock regressed',
            );
        }
        if (this.lastUtcDay !== null && utcDay < this.lastUtcDay) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.UTC_DAY_REGRESSED,
                'Production UTC day regressed',
            );
        }
        const dispatchAt = this.readNow();
        this.cleanup(dispatchAt);
        if (dispatchAt < this.pauseUntil) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.RATE_PAUSED,
                'Futures production execution is rate paused',
            );
        }
        const tenSecondCount = this.dispatchTimes.filter(
            dispatchTime => dispatchAt - dispatchTime < this.tenSecondWindowMs,
        ).length;
        if (tenSecondCount >= this.maximumTenSecondOrders
            || this.dispatchTimes.length >= this.maximumMinuteOrders) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.ORDER_COUNT_LIMITED,
                'Futures production order-count policy rejected dispatch',
            );
        }
        const prior = this.dailyReservations.get(utcDay) ?? '0';
        const next = addFuturesProductionExactDecimals(prior, increment);
        if (compareFuturesProductionExactDecimals(next, maximum) > 0) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.DAILY_NOTIONAL_EXCEEDED,
                'Futures production daily-notional policy rejected dispatch',
            );
        }
        return Object.freeze({
            version: this.version,
            dispatchAt,
            serverTime,
            utcDay,
            exactNotional: increment,
            maximumDailyNotional: maximum,
            nextDailyNotional: next,
        });
    }

    commitReservation(prepared) {
        if (!prepared || prepared.version !== this.version) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.PERSISTENCE_FAILED,
                'Persisted production reservation became stale',
            );
        }
        this.dispatchTimes.push(prepared.dispatchAt);
        this.dailyReservations.set(prepared.utcDay, prepared.nextDailyNotional);
        this.lastUtcDay = prepared.utcDay;
        this.lastServerTime = prepared.serverTime;
        this.version += 1;
        return this.snapshot();
    }

    preparePause(pauseUntil) {
        requireNonNegativeSafeInteger(pauseUntil, 'pauseUntil');
        const observedAt = this.readNow();
        return Object.freeze({
            version: this.version,
            observedAt,
            pauseUntil: Math.max(this.pauseUntil, pauseUntil),
        });
    }

    commitPause(prepared) {
        if (!prepared || prepared.version !== this.version) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.PERSISTENCE_FAILED,
                'Persisted production pause became stale',
            );
        }
        this.pauseUntil = prepared.pauseUntil;
        this.version += 1;
        return this.snapshot();
    }

    assertRecoveryAvailable() {
        const current = this.readNow();
        this.cleanup(current);
        if (current < this.pauseUntil) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.RATE_PAUSED,
                'Futures production recovery is rate paused',
            );
        }
        return current;
    }

    snapshot() {
        return Object.freeze({
            dispatchTimes: Object.freeze([...this.dispatchTimes]),
            pauseUntil: this.pauseUntil,
            dailyReservations: Object.freeze(Object.fromEntries(
                [...this.dailyReservations.entries()]
                    .sort(([left], [right]) => left.localeCompare(right)),
            )),
            lastUtcDay: this.lastUtcDay,
            lastServerTime: this.lastServerTime,
            lastObservedNow: this.lastObservedNow,
        });
    }
}

export class FuturesProductionExecutionCoordinator {
    constructor({
        spotCoordinator,
        getSpotAvailableWeight,
        productionExecutor,
        getProductionAvailableWeight,
        persistOrderReservation,
        persistRatePause,
        persistOriginWeightReservation,
        orderBucket = new FuturesProductionExecutionOrderBucket(),
        originBucket,
        now = Date.now,
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout,
        spotHeadroomWeight = FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS.spotHeadroomWeight,
        preflightWeight = FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS.preflightWeight,
        preflightAdmissionMs = FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS
            .preflightAdmissionMs,
        admissionPollMs = FUTURES_PRODUCTION_EXECUTION_COORDINATOR_LIMITS.admissionPollMs,
    } = {}) {
        if (!spotCoordinator || typeof spotCoordinator.executeSpot !== 'function') {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'spotCoordinator.executeSpot must be a function',
            );
        }
        this.spotCoordinator = spotCoordinator;
        this.getSpotAvailableWeight = requireFunction(
            getSpotAvailableWeight,
            'getSpotAvailableWeight',
        );
        this.productionExecutor = requireFunction(productionExecutor, 'productionExecutor');
        this.getProductionAvailableWeight = requireFunction(
            getProductionAvailableWeight,
            'getProductionAvailableWeight',
        );
        this.persistOrderReservation = requireFunction(
            persistOrderReservation,
            'persistOrderReservation',
        );
        this.persistRatePause = requireFunction(persistRatePause, 'persistRatePause');
        this.persistOriginWeightReservation = requireFunction(
            persistOriginWeightReservation,
            'persistOriginWeightReservation',
        );
        if (!(orderBucket instanceof FuturesProductionExecutionOrderBucket)) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'orderBucket must be a FuturesProductionExecutionOrderBucket',
            );
        }
        this.orderBucket = orderBucket;
        this.now = requireFunction(now, 'now');
        this.originBucket = originBucket === undefined
            ? new FuturesProductionExecutionOriginBucket({ now: this.now })
            : originBucket;
        if (!(this.originBucket instanceof FuturesProductionExecutionOriginBucket)) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'originBucket must be a FuturesProductionExecutionOriginBucket',
            );
        }
        this.setTimeoutFn = requireFunction(setTimeoutFn, 'setTimeoutFn');
        this.clearTimeoutFn = requireFunction(clearTimeoutFn, 'clearTimeoutFn');
        this.spotHeadroomWeight = requirePositiveSafeInteger(spotHeadroomWeight, 'spotHeadroomWeight');
        this.preflightWeight = requirePositiveSafeInteger(preflightWeight, 'preflightWeight');
        this.preflightAdmissionMs = requirePositiveSafeInteger(
            preflightAdmissionMs,
            'preflightAdmissionMs',
        );
        this.admissionPollMs = requirePositiveSafeInteger(admissionPollMs, 'admissionPollMs');
        this.spotWaiters = 0;
        this.activePreflight = null;
        this.nextLeaseId = 0;
        this.persistenceTail = Promise.resolve();
        this.originPersistenceTail = Promise.resolve();
    }

    async executeSpot(...args) {
        this.spotWaiters += 1;
        try {
            return await this.spotCoordinator.executeSpot(...args);
        } finally {
            this.spotWaiters -= 1;
        }
    }

    canAdmitPreflight() {
        return this.activePreflight === null
            && this.spotWaiters === 0
            && readCapacity(this.getSpotAvailableWeight) >= this.spotHeadroomWeight
            && readCapacity(this.getProductionAvailableWeight) >= this.preflightWeight
            && this.originBucket.canReserve(this.preflightWeight);
    }

    reserveOriginWeight({ requestWeight, endpointId }) {
        const operation = this.originPersistenceTail.then(async () => {
            const prepared = this.originBucket.prepareReservation(requestWeight);
            try {
                await this.persistOriginWeightReservation(Object.freeze({
                    observedAt: prepared.observedAt,
                    requestWeight: prepared.requestWeight,
                    endpointId,
                }));
            } catch {
                fail(
                    FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.PERSISTENCE_FAILED,
                    'Production-origin request weight was not durably persisted',
                );
            }
            this.originBucket.commitReservation(prepared);
            return Object.freeze({
                observedAt: prepared.observedAt,
                requestWeight: prepared.requestWeight,
                endpointId,
            });
        });
        this.originPersistenceTail = operation.catch(() => {});
        return operation;
    }

    async beginPreflight(options = {}) {
        if (!hasOnlyFields(options, ['signal'])) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'beginPreflight accepts only an optional signal',
            );
        }
        const { signal } = options;
        const startedAt = this.now();
        if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'now must return a non-negative safe integer',
            );
        }
        const deadline = startedAt + this.preflightAdmissionMs;
        if (!Number.isSafeInteger(deadline)) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_CONFIGURATION,
                'Preflight admission deadline overflowed',
            );
        }
        while (!this.canAdmitPreflight()) {
            throwIfAborted(signal);
            const current = this.now();
            if (!Number.isSafeInteger(current) || current < startedAt || current >= deadline) {
                fail(
                    FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES
                        .PREFLIGHT_ADMISSION_TIMEOUT,
                    'Low-priority production preflight admission timed out',
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
            executionTail: Promise.resolve(),
        };
        this.activePreflight = leaseState;

        const assertActive = () => {
            if (!leaseState.active || this.activePreflight !== leaseState) {
                fail(
                    FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES
                        .PREFLIGHT_LEASE_RELEASED,
                    'Production preflight lease is no longer active',
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
            origin: FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
            executeGet: (operation, weight, getOptions = {}) => {
                const execute = async () => {
                    assertActive();
                    requireFunction(operation, 'operation');
                    requirePositiveSafeInteger(weight, 'weight');
                    if (!hasOnlyFields(getOptions, ['signal', 'endpointId'])) {
                        fail(
                            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                            'executeGet accepts only a reviewed endpointId and optional signal',
                        );
                    }
                    const endpointId = requireReviewedEndpointWeight(
                        getOptions.endpointId,
                        weight,
                    );
                    throwIfAborted(getOptions.signal);
                    if (this.spotWaiters > 0
                        || readCapacity(this.getSpotAvailableWeight) < this.spotHeadroomWeight) {
                        fail(
                            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.SPOT_PRIORITY,
                            'Spot work took priority over production preflight',
                        );
                    }
                    if (readCapacity(this.getProductionAvailableWeight) < weight) {
                        fail(
                            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.SPOT_PRIORITY,
                            'Production-origin capacity is unavailable',
                        );
                    }
                    if (leaseState.usedWeight + weight > this.preflightWeight) {
                        fail(
                            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES
                                .PREFLIGHT_WEIGHT_EXCEEDED,
                            'Production preflight exceeded its reviewed weight',
                        );
                    }
                    await this.reserveOriginWeight({ requestWeight: weight, endpointId });
                    leaseState.usedWeight += weight;
                    assertActive();
                    throwIfAborted(getOptions.signal);
                    if (this.spotWaiters > 0
                        || readCapacity(this.getSpotAvailableWeight) < this.spotHeadroomWeight
                        || readCapacity(this.getProductionAvailableWeight) < weight) {
                        fail(
                            FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.SPOT_PRIORITY,
                            'Spot or volatile origin quota took priority after durable admission',
                        );
                    }
                    return this.productionExecutor(operation, weight, 0, {
                        signal: getOptions.signal,
                        origin: FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
                        priority: 'low',
                    });
                };
                const attempt = leaseState.executionTail.then(execute);
                leaseState.executionTail = attempt.catch(() => {});
                return attempt;
            },
            getUsedWeight: () => leaseState.usedWeight,
            release,
        });
    }

    async executeGet(operation, weight, options = {}) {
        if (!hasOnlyFields(options, ['signal', 'endpointId'])) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'executeGet accepts only a reviewed endpointId and optional signal',
            );
        }
        requireReviewedEndpointWeight(options.endpointId, weight);
        const lease = await this.beginPreflight({ signal: options.signal });
        try {
            return await lease.executeGet(operation, weight, options);
        } finally {
            lease.release();
        }
    }

    async executeProduction(operation, weight, options = {}) {
        requireFunction(operation, 'operation');
        requirePositiveSafeInteger(weight, 'weight');
        if (!hasOnlyFields(options, ['signal', 'priority', 'endpointId'])
            || (options.priority !== undefined && options.priority !== 'low')) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'executeProduction accepts only a reviewed endpointId, optional signal, and low priority',
            );
        }
        const endpointId = requireReviewedEndpointWeight(options.endpointId, weight);
        throwIfAborted(options.signal);
        if (this.spotWaiters > 0
            || readCapacity(this.getSpotAvailableWeight) < this.spotHeadroomWeight
            || readCapacity(this.getProductionAvailableWeight) < weight) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.SPOT_PRIORITY,
                'Spot or production-origin quota took priority over production write',
            );
        }
        await this.reserveOriginWeight({ requestWeight: weight, endpointId });
        throwIfAborted(options.signal);
        if (this.spotWaiters > 0
            || readCapacity(this.getSpotAvailableWeight) < this.spotHeadroomWeight
            || readCapacity(this.getProductionAvailableWeight) < weight) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.SPOT_PRIORITY,
                'Spot or volatile origin quota took priority after durable admission',
            );
        }
        return this.productionExecutor(operation, weight, 0, {
            signal: options.signal,
            origin: FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
            priority: 'low',
        });
    }

    reserveOrderDispatch(options = {}) {
        if (!hasOnlyFields(options, [
            'exactNotional', 'utcDay', 'serverTime', 'maximumDailyNotional', 'audit',
        ]) || (options.audit !== undefined && !isPlainDataObject(options.audit))) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'reserveOrderDispatch received unknown fields',
            );
        }
        const operation = this.persistenceTail.then(async () => {
            const prepared = this.orderBucket.prepareReservation({
                ...options,
                positionEffect: options.audit?.positionEffect ?? null,
            });
            try {
                await this.persistOrderReservation(Object.freeze({
                    ...(options.audit ?? {}),
                    utcDay: prepared.utcDay,
                    serverTime: prepared.serverTime,
                    exactNotional: prepared.exactNotional,
                    maximumDailyNotional: prepared.maximumDailyNotional,
                    dispatchAt: prepared.dispatchAt,
                }));
            } catch {
                fail(
                    FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.PERSISTENCE_FAILED,
                    'Production order reservation was not durably persisted',
                );
            }
            this.orderBucket.commitReservation(prepared);
            return Object.freeze({
                dispatchAt: prepared.dispatchAt,
                serverTime: prepared.serverTime,
                utcDay: prepared.utcDay,
                exactNotional: prepared.exactNotional,
            });
        });
        this.persistenceTail = operation.catch(() => {});
        return operation;
    }

    setOrderPauseUntil(pauseUntil, audit = {}) {
        if (!isPlainDataObject(audit)) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'Rate-pause audit metadata must be a plain data object',
            );
        }
        const operation = this.persistenceTail.then(async () => {
            const prepared = this.orderBucket.preparePause(pauseUntil);
            try {
                await this.persistRatePause(Object.freeze({
                    ...audit,
                    observedAt: prepared.observedAt,
                    pauseUntil: prepared.pauseUntil,
                }));
            } catch {
                fail(
                    FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.PERSISTENCE_FAILED,
                    'Production rate pause was not durably persisted',
                );
            }
            return this.orderBucket.commitPause(prepared);
        });
        this.persistenceTail = operation.catch(() => {});
        return operation;
    }

    restoreOrderState(state) {
        if (!hasOnlyFields(state, [
            'dispatchTimes', 'pauseUntil', 'dailyReservations', 'lastUtcDay', 'lastServerTime',
        ])) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'Persisted production order state has unknown fields',
            );
        }
        return this.orderBucket.restore(state);
    }

    restoreOriginWeightState(state) {
        if (!hasOnlyFields(state, [
            'originWeightReservations', 'lastOriginWeightObservedAt',
        ])) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'Persisted production-origin weight state has unknown fields',
            );
        }
        return this.originBucket.restore(state);
    }

    async executeRecoveryQuery(operation, options = {}) {
        requireFunction(operation, 'operation');
        if (!hasOnlyFields(options, ['signal', 'endpointId'])) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES.INVALID_ARGUMENTS,
                'executeRecoveryQuery accepts only a reviewed endpointId and optional signal',
            );
        }
        const endpointId = requireReviewedEndpointWeight(options.endpointId, 1);
        throwIfAborted(options.signal);
        this.orderBucket.assertRecoveryAvailable();
        if (this.spotWaiters > 0
            || readCapacity(this.getSpotAvailableWeight) < this.spotHeadroomWeight
            || readCapacity(this.getProductionAvailableWeight) < 1) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES
                    .RECOVERY_ADMISSION_REJECTED,
                'Spot or production-origin quota took priority over recovery',
            );
        }
        await this.reserveOriginWeight({ requestWeight: 1, endpointId });
        throwIfAborted(options.signal);
        this.orderBucket.assertRecoveryAvailable();
        if (this.spotWaiters > 0
            || readCapacity(this.getSpotAvailableWeight) < this.spotHeadroomWeight
            || readCapacity(this.getProductionAvailableWeight) < 1) {
            fail(
                FUTURES_PRODUCTION_EXECUTION_COORDINATOR_ERROR_CODES
                    .RECOVERY_ADMISSION_REJECTED,
                'Spot or volatile origin quota took priority after durable recovery admission',
            );
        }
        return this.productionExecutor(operation, 1, 0, {
            signal: options.signal,
            origin: FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
            priority: 'low',
        });
    }

    getOrderAdmissionSnapshot() {
        return this.orderBucket.snapshot();
    }

    getOriginWeightAdmissionSnapshot() {
        return this.originBucket.snapshot();
    }
}

export const createFuturesProductionExecutionCoordinator = options => (
    new FuturesProductionExecutionCoordinator(options)
);
