export const FUTURES_ACCOUNT_STATE_VERSION = 1;
export const FUTURES_ACCOUNT_STATE_TYPE = 'futures_account_state';

export const FUTURES_ACCOUNT_RESOURCE_NAMES = Object.freeze([
    'balances',
    'positions',
    'regularOrders',
    'algoOrders',
    'userDataStream',
]);

export const FUTURES_ACCOUNT_RESOURCE_STATUS = Object.freeze({
    IDLE: 'idle',
    LOADING: 'loading',
    READY: 'ready',
    STALE: 'stale',
    ERROR: 'error',
});

const INITIAL_RESOURCE_DATA = Object.freeze({
    balances: null,
    positions: Object.freeze([]),
    regularOrders: Object.freeze([]),
    algoOrders: Object.freeze([]),
    userDataStream: null,
});

const NETWORK_ERROR_CODES = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPROTO',
    'ETIMEDOUT',
]);

const boundedErrorCode = value => {
    const normalized = String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
    return normalized || null;
};

export const sanitizeFuturesAccountError = (error) => {
    const exchangeCode = Number.isFinite(Number(error?.code))
        ? Number(error.code)
        : null;
    const transportCode = boundedErrorCode(error?.code);
    const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : null;

    if (exchangeCode === -2014 || exchangeCode === -2015 || status === 401 || status === 403) {
        return Object.freeze({
            code: 'FUTURES_PERMISSION_DENIED',
            category: 'permission',
            message: 'Binance rejected Futures account access. Verify API-key Futures permission and IP restrictions.',
            retryable: false,
        });
    }
    if (exchangeCode === -1021) {
        return Object.freeze({
            code: 'FUTURES_CLOCK_SKEW',
            category: 'clock',
            message: 'Binance rejected the signed timestamp. Synchronize the system clock and retry.',
            retryable: true,
        });
    }
    if (exchangeCode === -1003 || status === 429) {
        return Object.freeze({
            code: 'FUTURES_RATE_LIMITED',
            category: 'rate_limit',
            message: 'Binance rate-limited the Futures account refresh. Wait briefly and retry.',
            retryable: true,
        });
    }
    if (NETWORK_ERROR_CODES.has(transportCode)) {
        return Object.freeze({
            code: 'FUTURES_NETWORK_ERROR',
            category: 'network',
            message: 'The Futures account request could not reach Binance. Check network and proxy settings, then retry.',
            retryable: true,
        });
    }
    if (status !== null && status >= 500) {
        return Object.freeze({
            code: 'FUTURES_EXCHANGE_UNAVAILABLE',
            category: 'exchange',
            message: 'Binance Futures is temporarily unavailable. Retry the account refresh.',
            retryable: true,
        });
    }
    // A 4xx that is not a permission or rate-limit failure describes the request
    // itself — a wrong route, an unsupported parameter, a resource that is not
    // there. Repeating it byte for byte cannot succeed, and offering Retry for
    // it wastes the operator's attention on an action guaranteed to fail.
    if (status !== null && status >= 400 && status < 500) {
        return Object.freeze({
            code: 'FUTURES_REQUEST_REJECTED',
            category: 'exchange',
            message: 'Binance refused the Futures account request as sent. Retrying it unchanged cannot succeed.',
            retryable: false,
        });
    }
    return Object.freeze({
        code: 'FUTURES_ACCOUNT_REQUEST_FAILED',
        category: 'exchange',
        message: 'A Binance Futures account resource could not be synchronized. Retry and inspect the resource status.',
        retryable: true,
    });
};

const createResource = data => Object.freeze({
    status: FUTURES_ACCOUNT_RESOURCE_STATUS.IDLE,
    data,
    updatedAt: null,
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    error: null,
});

export const createInitialFuturesAccountResources = () => Object.freeze(
    Object.fromEntries(FUTURES_ACCOUNT_RESOURCE_NAMES.map(resource => (
        [resource, createResource(INITIAL_RESOURCE_DATA[resource])]
    ))),
);

const assertResourceName = resource => {
    if (!FUTURES_ACCOUNT_RESOURCE_NAMES.includes(resource)) {
        throw new TypeError(`Unsupported Futures account resource: ${resource}`);
    }
};

const replaceResource = (resources, resource, nextResource) => {
    assertResourceName(resource);
    return Object.freeze({
        ...resources,
        [resource]: Object.freeze(nextResource),
    });
};

export const markFuturesResourceLoading = (resources, resource, now = Date.now()) => {
    const previous = resources[resource];
    return replaceResource(resources, resource, {
        ...previous,
        status: FUTURES_ACCOUNT_RESOURCE_STATUS.LOADING,
        lastAttemptAt: now,
        error: null,
    });
};

export const markFuturesResourceIdle = (resources, resource) => {
    const previous = resources[resource];
    return replaceResource(resources, resource, {
        ...previous,
        status: FUTURES_ACCOUNT_RESOURCE_STATUS.IDLE,
        error: null,
    });
};

export const markFuturesResourceReady = (
    resources,
    resource,
    data,
    now = Date.now(),
) => replaceResource(resources, resource, {
    status: FUTURES_ACCOUNT_RESOURCE_STATUS.READY,
    data,
    updatedAt: now,
    lastAttemptAt: now,
    lastSuccessfulAt: now,
    error: null,
});

export const markFuturesResourceFailed = (
    resources,
    resource,
    error,
    now = Date.now(),
) => {
    const previous = resources[resource];
    return replaceResource(resources, resource, {
        ...previous,
        status: previous.lastSuccessfulAt === null
            ? FUTURES_ACCOUNT_RESOURCE_STATUS.ERROR
            : FUTURES_ACCOUNT_RESOURCE_STATUS.STALE,
        lastAttemptAt: now,
        error: sanitizeFuturesAccountError(error),
    });
};

export const markFuturesOrderResourcesStale = (
    resources,
    error,
    now = Date.now(),
) => ['regularOrders', 'algoOrders'].reduce((nextResources, resource) => (
    nextResources[resource].lastSuccessfulAt === null
        ? nextResources
        : markFuturesResourceFailed(nextResources, resource, error, now)
), resources);

// An order the exchange still holds. Everything else — filled, cancelled,
// expired, liquidation-issued — leaves the working list. Written as the set that
// stays rather than the set that goes, so a status nobody anticipated drops out
// instead of resting there forever.
const FUTURES_WORKING_ORDER_STATUSES = Object.freeze(new Set(['NEW', 'PARTIALLY_FILLED']));

export const futuresOrderIdentity = (order) => {
    const symbol = String(order?.symbol ?? order?.s ?? '');
    const orderId = String(order?.orderId ?? order?.i ?? '');
    return symbol === '' || orderId === '' ? null : `${symbol}:${orderId}`;
};

const orderStampOf = (order) => {
    const stamp = Number(order?.transactTime ?? order?.T ?? order?.updateTime);
    return Number.isFinite(stamp) ? stamp : null;
};

// Which orders the stream has already reported settled, and when. Two things
// need it: a late execution report must not put a settled order back, and a
// read that left before the settle must not either — the read describes a world
// the stream has already moved past. Bounded, because it is a memory of the
// recent past and not a ledger.
export class FuturesSettledOrderMemory {
    constructor({ maximum = 256 } = {}) {
        this.maximum = maximum;
        this.entries = new Map();
    }

    settle(identity, at) {
        if (identity === null) return;
        this.entries.delete(identity);
        this.entries.set(identity, Number.isFinite(at) ? at : Date.now());
        while (this.entries.size > this.maximum) {
            const [oldest] = this.entries.keys();
            this.entries.delete(oldest);
        }
    }

    // A row is allowed through when nothing settled it, or when it is newer than
    // what settled it — an order id is reused by nothing, but a stamp can be.
    allows(order) {
        const settledAt = this.entries.get(futuresOrderIdentity(order));
        if (settledAt === undefined) return true;
        const stamp = orderStampOf(order);
        return stamp !== null && stamp > settledAt;
    }

    filterRead(rows) {
        if (!Array.isArray(rows)) return rows;
        const kept = rows.filter(row => this.allows(row));
        return kept.length === rows.length ? rows : Object.freeze(kept);
    }

    forget() {
        this.entries.clear();
    }
}

/**
 * Folds one execution report into the held working orders.
 *
 * The exchange has just said what this order is, on a stream the desk is already
 * listening to. Reading the whole account back to learn the same thing cost
 * weight 40 twice — `/fapi/v1/openOrders` without a symbol, and the algo list
 * beside it — on every fill.
 *
 * Returns the resources unchanged when there is nothing to fold, so the caller
 * can broadcast only on a real change.
 */
export const foldFuturesWorkingOrder = (resources, report, { settled, now = Date.now() } = {}) => {
    const resource = resources?.regularOrders;
    // Nothing has been read yet. A list built from the one report that happened
    // to arrive would present a one-order account as the whole of it.
    if (!resource || resource.lastSuccessfulAt === null) return resources;
    const identity = futuresOrderIdentity(report);
    if (identity === null) return resources;
    if (String(report?.orderKind ?? 'REGULAR') !== 'REGULAR') return resources;
    const rows = Array.isArray(resource.data) ? resource.data : [];
    const held = rows.find(row => futuresOrderIdentity(row) === identity) ?? null;
    const reportedAt = orderStampOf(report);
    const heldAt = orderStampOf(held);
    // A report describing a state already replaced changes nothing.
    if (held !== null && reportedAt !== null && heldAt !== null && reportedAt < heldAt) {
        return resources;
    }
    const working = FUTURES_WORKING_ORDER_STATUSES.has(String(report?.status ?? report?.X ?? ''));
    // The stream updated the list; it did not prove it. Status and the time of
    // the last successful read are left as they are, so a set marked stale after
    // a reconnect stays stale until a read says otherwise.
    const withRows = rows => replaceResource(resources, 'regularOrders', {
        ...resource,
        data: Object.freeze(rows),
        updatedAt: now,
    });
    if (!working) {
        settled?.settle(identity, reportedAt ?? now);
        if (held === null) return resources;
        return withRows(rows.filter(row => futuresOrderIdentity(row) !== identity));
    }
    // Working, but already settled once: a report that arrived out of order.
    if (settled && !settled.allows(report)) return resources;
    return withRows(held === null
        ? [...rows, report]
        : rows.map(row => (futuresOrderIdentity(row) === identity ? report : row)));
};

export const createFuturesAccountStateEnvelope = (
    resources,
    now = Date.now(),
) => Object.freeze({
    version: FUTURES_ACCOUNT_STATE_VERSION,
    type: FUTURES_ACCOUNT_STATE_TYPE,
    marketType: 'futures',
    updatedAt: now,
    resources,
});
