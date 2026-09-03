import { AsyncLocalStorage } from 'node:async_hooks';

// The request adapter sits below the rate limiter, while retries that create
// additional HTTP requests sit inside the adapter. Async-local state connects
// those two layers without putting admission callbacks on every public adapter
// method or sharing mutable state between concurrent logical operations.
const attemptContext = new AsyncLocalStorage();

const NO_PHYSICAL_ATTEMPT_CONTEXT = Object.freeze({
    signal: null,
    observeResponse: () => {},
});

const RETRY_CATEGORIES = new Set([
    'connection-fallback',
    'network',
    'rate-limit',
    'timestamp',
]);

const MAX_RETRY_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

const sanitizeResponseObservation = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return Object.freeze({});
    }

    const observation = {};
    if (Number.isSafeInteger(value.status) && value.status >= 100 && value.status <= 599) {
        observation.status = value.status;
    }
    if (Number.isSafeInteger(value.usedWeight) && value.usedWeight >= 0) {
        observation.usedWeight = value.usedWeight;
    }
    if (Number.isSafeInteger(value.retryAfterMs) && value.retryAfterMs >= 0) {
        observation.retryAfterMs = Math.min(value.retryAfterMs, MAX_RETRY_AFTER_MS);
    }
    return Object.freeze(observation);
};

export const runWithBinancePhysicalAttemptContext = (context, operation) => {
    if (typeof operation !== 'function') {
        throw new TypeError('A physical-attempt operation must be a function');
    }
    return attemptContext.run(context, operation);
};

// Called immediately before one low-level HTTP send. Outside the Futures
// limiter's physical mode it is deliberately a no-op: isolated adapter callers
// and the legacy Spot path keep their existing behavior.
export const admitBinancePhysicalAttempt = async (weight = null, route = null) => {
    const context = attemptContext.getStore();
    if (typeof context?.admit !== 'function') return NO_PHYSICAL_ATTEMPT_CONTEXT;

    // The route rides beside the weight only when the adapter named one; a
    // caller that states none keeps the one-argument admission it always had.
    const admission = route === null || route === undefined
        ? await context.admit(weight)
        : await context.admit(weight, route);
    return Object.freeze({
        signal: context.signal ?? null,
        // Response observations are accounting hints, never part of whether the
        // exchange payload succeeds. A diagnostics failure cannot turn a valid
        // Binance answer into a failed request.
        observeResponse: (observation) => {
            try {
                context.observeResponse?.(
                    sanitizeResponseObservation(observation),
                    admission,
                );
            } catch {
                // Observational only.
            }
        },
    });
};

export const noteBinancePhysicalRetry = (category) => {
    if (!RETRY_CATEGORIES.has(category)) return false;
    const context = attemptContext.getStore();
    if (typeof context?.noteRetry !== 'function') return false;
    try {
        context.noteRetry(category);
        return true;
    } catch {
        return false;
    }
};
