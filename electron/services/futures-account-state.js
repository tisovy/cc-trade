export const FUTURES_ACCOUNT_STATE_VERSION = 1;
export const FUTURES_ACCOUNT_STATE_TYPE = 'futures_account_state';

export const FUTURES_ACCOUNT_RESOURCE_NAMES = Object.freeze([
    'balances',
    'positions',
    'regularOrders',
    'algoOrders',
    'userDataStream',
]);

/**
 * Why the desk read the signed account.
 *
 * `futures-order-visibility` has always required an account read to be issued
 * only for a stated reason. This is that vocabulary, written down: the read
 * sites name one of these, the record keeps it, and the day's summary is what
 * lets the operator see whether the desk is reading for reasons they recognise
 * or on every frame that arrives.
 */
export const FUTURES_ACCOUNT_READ_REASONS = Object.freeze([
    // The first snapshot, when a renderer takes up futures trading.
    'bootstrap',
    // The authenticated stream connected or reconnected, so whatever it missed
    // while it was down has to be read back.
    'stream',
    // The operator asked, or the periodic beat asked on the same command.
    'refresh',
    // A stream frame stated a change and could not state everything it moved.
    'unstated',
    // A command whose effect no stream reports — the algorithmic orders, or
    // anything at all while no stream is up.
    'command',
    // An outcome the exchange left ambiguous, or a refusal whose effect on the
    // book has to be established by reading it.
    'unresolved',
    // Leverage or margin mode moved, which moves what stands behind a position.
    'setting',
    // A held reduce-only order is waiting on the positions it claims to close:
    // the desk has no reading it can prove the reduction against and asked for
    // one rather than refusing the operator's close on sight.
    'proof',
]);

/**
 * The reads the operator is waiting on, which are admitted ahead of ordinary
 * work when both are queued for the same rate-limited turn.
 *
 * Each of these follows something that just happened to the account — a command
 * the operator sent, a settlement the stream reported, an outcome the exchange
 * left open. What is on screen is wrong until they land, and the operator is
 * acting on it. The rest are maintenance: the first snapshot, a reconnect
 * catching up, the periodic beat. They are worth reading and worth waiting for.
 */
export const FUTURES_URGENT_ACCOUNT_READ_REASONS = Object.freeze(new Set([
    'unstated',
    'command',
    'unresolved',
    'setting',
    // A close is standing still until this read answers, and its hold is
    // bounded in the hundreds of milliseconds — the one read that must not
    // queue behind housekeeping.
    'proof',
]));

/**
 * Which reason a pass answering more than one request carries.
 *
 * Requests that arrive while a read is running collapse into one pass, and their
 * resources into the union of what they asked for — never into less. Their
 * reasons have to collapse the same way, and `unstated` is the one that cannot
 * simply win: it is the only reason that *narrows* what a read may say. A read
 * issued because a frame could not carry a liquidation price states that price
 * and carries the frame's own figures over everything else, which is exactly
 * right for the frame that asked for it and exactly wrong for a reconnect, the
 * periodic beat or the operator's refresh. Those reads exist to correct a frame
 * the desk never saw, and a read that may not replace a position row cannot do
 * it. So `unstated` yields to any other reason queued for the same pass.
 */
export const widenFuturesAccountReadReason = (held, reason) => {
    const asked = reason ?? null;
    if (held === null || held === undefined) return asked;
    if (held === asked) return held;
    return held === 'unstated' ? asked : held;
};

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
    // The private stream's own beginning, and the only failure here that is not
    // a read: the exchange answered the listen-key request without a key in it.
    // Named, because "a Futures account resource could not be synchronized" is
    // what the desk says about a read of the account, and this is the account's
    // event stream failing to start — a different thing to be told.
    // An open socket that stopped delivering. Named apart from a disconnect
    // because they look identical to the operator and are not: a route that was
    // withdrawn holds the handshake open and says nothing, which is how one
    // wrong prefix cost four months.
    if (transportCode === 'STREAM_SILENT') {
        return Object.freeze({
            code: 'FUTURES_STREAM_NOT_CARRYING',
            category: 'stream',
            message: 'The Futures private stream stopped carrying — the exchange sent nothing on it, not even its own keep-alive. The desk is reading the account on its own beat and rebuilding the stream.',
            retryable: true,
        });
    }
    if (transportCode === 'LISTEN_KEY_MISSING') {
        return Object.freeze({
            code: 'FUTURES_LISTEN_KEY_MISSING',
            category: 'stream',
            message: 'Binance answered the Futures listen-key request without a key, so the private stream cannot start. The desk keeps reading the account on its own beat and will try again.',
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

// When the stream last said each order is working, on the desk's own clock.
//
// The mirror image of the settled memory, and it exists for the mirror-image
// reason: Binance's REST services are eventually consistent with its streams, so
// a read of `/fapi/v1/openOrders` issued moments after a placement can answer
// without the order the stream has already reported. Left alone, that read
// removes the order and the next one puts it back — the order blinking on and
// off the chart after it is placed.
//
// Local time rather than the exchange's, because the comparison is against the
// moment *this process* issued the read. Mixing the two clocks would make the
// protection depend on how far apart they drift.
export class FuturesStreamedOrderMemory {
    constructor({ maximum = 256 } = {}) {
        this.maximum = maximum;
        this.entries = new Map();
    }

    note(identity, at) {
        if (identity === null) return;
        this.entries.delete(identity);
        this.entries.set(identity, Number.isFinite(at) ? at : Date.now());
        while (this.entries.size > this.maximum) {
            const [oldest] = this.entries.keys();
            this.entries.delete(oldest);
        }
    }

    // One order, because the stream said it settled. Named apart from `forget`
    // so it cannot be confused with the settled memory's `forget()`, which
    // clears everything — calling that one by mistake here would have deleted
    // nothing and read like a reset.
    drop(identity) {
        if (identity === null || identity === undefined) return;
        this.entries.delete(identity);
    }

    // Did the stream speak about this order recently enough that the read's
    // silence about it is uninformed rather than authoritative?
    notedSince(identity, since) {
        const notedAt = this.entries.get(identity);
        return notedAt !== undefined && Number.isFinite(since) && notedAt >= since;
    }

    forget() {
        this.entries.clear();
    }
}

/**
 * How far a read may trail the stream and still be believed about an order it
 * leaves out.
 *
 * When the read left is not the whole test, because Binance's REST view is
 * eventually consistent with its own matching engine: a read issued *after* the
 * stream reported an order working can still answer without it. That is the
 * order of events after a placement — the exchange accepts, the stream says NEW,
 * the desk asks for the account it has just changed, and the read that comes
 * back has not caught up yet. Believing it made the order vanish for as long as
 * the next read took to arrive, which is the blink on and off the chart the
 * operator sees after placing an order.
 *
 * There is no such window in the other direction: an order the stream settled is
 * refused by comparing the exchange's own stamps, and a stale row simply carries
 * an older one. Absence carries no stamp to compare, so this is measured in
 * time — long enough to cover the exchange's own lag, short enough that an order
 * that really is gone clears on the next read past the window.
 */
export const FUTURES_WORKING_ORDER_READ_LAG_MS = 3_000;

/**
 * What a read of the working orders is allowed to say.
 *
 * Two things the read cannot know about, in the two directions: an order the
 * stream reported settled after the read left, which the settled memory refuses,
 * and an order the stream reported working that the read simply does not
 * contain. The second is put back here.
 *
 * `since` is when the read was issued, on the same clock the stream reports are
 * noted on, and `lag` is how far the exchange's own answer may trail it.
 */
export const reconcileFuturesWorkingOrderRead = (
    resources,
    rows,
    {
        settled = null,
        streamed = null,
        since = null,
        lag = FUTURES_WORKING_ORDER_READ_LAG_MS,
    } = {},
) => {
    const filtered = settled === null ? rows : settled.filterRead(rows);
    if (streamed === null || !Number.isFinite(since)) return filtered;
    const vouchedSince = since - (Number.isFinite(lag) ? Math.max(0, lag) : 0);
    const held = Array.isArray(resources?.regularOrders?.data)
        ? resources.regularOrders.data
        : [];
    if (held.length === 0) return filtered;
    const read = Array.isArray(filtered) ? filtered : [];
    const listed = new Set(read.map(row => futuresOrderIdentity(row)));
    const missing = held.filter((row) => {
        const identity = futuresOrderIdentity(row);
        if (identity === null || listed.has(identity)) return false;
        if (!FUTURES_WORKING_ORDER_STATUSES.has(String(row?.status ?? row?.X ?? ''))) return false;
        if (settled !== null && !settled.allows(row)) return false;
        return streamed.notedSince(identity, vouchedSince);
    });
    return missing.length === 0 ? filtered : Object.freeze([...read, ...missing]);
};

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
export const foldFuturesWorkingOrder = (
    resources,
    report,
    { settled, streamed = null, now = Date.now() } = {},
) => {
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
        streamed?.drop(identity);
        if (held === null) return resources;
        return withRows(rows.filter(row => futuresOrderIdentity(row) !== identity));
    }
    // Working, but already settled once: a report that arrived out of order.
    if (settled && !settled.allows(report)) return resources;
    // Noted on the local clock: a read already in flight cannot have seen this,
    // so its silence about the order must not remove it.
    streamed?.note(identity, now);
    return withRows(held === null
        ? [...rows, report]
        : rows.map(row => (futuresOrderIdentity(row) === identity ? report : row)));
};

// The statuses that leave an algorithmic order on the desk. Everything else —
// `CANCELED`, `FINISHED`, `REJECTED`, `EXPIRED` — is the exchange saying it is
// gone, and Binance names all seven on the event's own page.
const FUTURES_WORKING_ALGO_STATUSES = Object.freeze(new Set(['NEW', 'TRIGGERING', 'TRIGGERED']));

/**
 * Apply what an `ALGO_UPDATE` states to the listed algorithmic orders.
 *
 * The desk lists and cancels algorithmic orders but cannot place them, so it
 * reads them on a thirty-second beat. This is the exchange stating the same
 * thing as it happens, and the beat stays exactly where it is: an algo the desk
 * has not listed is left to it, because one appearing out of nowhere was made
 * elsewhere and the read is what puts it on the desk whole.
 */
export const foldFuturesAlgoUpdate = (resources, update, { now = Date.now() } = {}) => {
    const resource = resources?.algoOrders;
    // Nothing has been read yet, so there is no list for this to be part of.
    if (!resource || resource.lastSuccessfulAt === null) return resources;
    const algoId = update?.algoId;
    if (algoId === null || algoId === undefined || algoId === '') return resources;
    const rows = Array.isArray(resource.data) ? resource.data : [];
    const index = rows.findIndex(row => String(row?.algoId ?? '') === String(algoId));
    if (index === -1) return resources;
    const withRows = next => replaceResource(resources, 'algoOrders', {
        ...resource,
        data: Object.freeze(next),
        updatedAt: now,
    });
    if (!FUTURES_WORKING_ALGO_STATUSES.has(String(update?.status ?? ''))) {
        return withRows(rows.filter((_, position) => position !== index));
    }
    const held = rows[index];
    // Only what the frame states. A field the frame does not carry does not
    // un-know what the read did.
    const folded = Object.freeze({
        ...held,
        status: update.status,
        ...(update.actualOrderId === undefined ? {} : { actualOrderId: update.actualOrderId }),
        ...(update.actualPrice === undefined ? {} : { actualPrice: update.actualPrice }),
        ...(update.triggerPrice === undefined ? {} : { triggerPrice: update.triggerPrice }),
    });
    if (held.status === folded.status
        && held.actualOrderId === folded.actualOrderId
        && held.actualPrice === folded.actualPrice
        && held.triggerPrice === folded.triggerPrice) return resources;
    return withRows(rows.map((row, position) => (position === index ? folded : row)));
};

// Where a position is held: one contract may carry two of them on a hedged
// account, and folding a LONG onto a SHORT would state the wrong exposure.
const futuresPositionKey = position => (
    `${String(position?.symbol ?? '')}:${String(position?.positionSide ?? 'BOTH')}`
);

const foldFuturesWalletBalances = (resources, balances, now) => {
    const resource = resources.balances;
    // Nothing read yet. A wallet built from the one asset a frame happened to
    // move would present it as the whole account.
    if (resource.lastSuccessfulAt === null || balances.length === 0) return resources;
    const held = resource.data && typeof resource.data === 'object' ? resource.data : {};
    let changed = false;
    const next = { ...held };
    for (const balance of balances) {
        if (typeof balance.walletBalance !== 'string') continue;
        const previous = next[balance.asset] ?? null;
        const crossWallet = typeof balance.crossWallet === 'string'
            ? balance.crossWallet
            : previous?.crossWallet;
        if (previous !== null
            && previous.total === balance.walletBalance
            && previous.crossWallet === crossWallet) continue;
        // The frame states the wallet, never the free margin — that is what the
        // read this fold asks for is for. What was last read stands until it
        // answers, rather than being invented from the wallet.
        next[balance.asset] = Object.freeze({
            ...(previous ?? { available: null, crossUnPnl: null }),
            total: balance.walletBalance,
            ...(crossWallet === undefined ? {} : { crossWallet }),
        });
        changed = true;
    }
    if (!changed) return resources;
    return replaceResource(resources, 'balances', {
        ...resource,
        data: Object.freeze(next),
        updatedAt: now,
    });
};

// What the frame states about a position, and nothing else. The liquidation
// price, the margins and the notional are absent from `ACCOUNT_UPDATE`
// altogether; on a position the desk already holds they are carried over, and on
// one it does not they are simply not there yet.
const foldedFuturesPosition = (held, position) => Object.freeze({
    ...(held ?? {}),
    symbol: position.symbol,
    positionSide: position.positionSide,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    unrealizedPnl: position.unrealizedPnl,
    ...(position.marginType === undefined ? {} : { marginType: position.marginType }),
    isolatedWallet: position.isolatedWallet,
});

const sameFuturesPosition = (held, folded) => held !== null && [
    'quantity',
    'entryPrice',
    'unrealizedPnl',
    'marginType',
    'isolatedWallet',
].every(field => held[field] === folded[field]);

const foldFuturesPositions = (resources, positions, now) => {
    const resource = resources.positions;
    if (resource.lastSuccessfulAt === null || positions.length === 0) return resources;
    const rows = Array.isArray(resource.data) ? resource.data : [];
    const byKey = new Map(rows.map(row => [futuresPositionKey(row), row]));
    let changed = false;
    for (const position of positions) {
        const key = futuresPositionKey(position);
        const held = byKey.get(key) ?? null;
        const quantity = Number(position.quantity);
        if (!Number.isFinite(quantity)) continue;
        // Zero is how the frame says a position closed. A read simply stops
        // listing it; the stream has to say so, and this is how.
        if (quantity === 0) {
            if (held === null) continue;
            byKey.delete(key);
            changed = true;
            continue;
        }
        const folded = foldedFuturesPosition(held, position);
        if (sameFuturesPosition(held, folded)) continue;
        byKey.set(key, folded);
        changed = true;
    }
    if (!changed) return resources;
    return replaceResource(resources, 'positions', {
        ...resource,
        data: Object.freeze([...byKey.values()]),
        updatedAt: now,
    });
};

// What the stream states, and the read therefore may not take back. A read
// issued to fetch a liquidation price answers from a replica that can still be
// describing the account before the frame that prompted it — the same eventual
// consistency the working orders are already guarded against. Letting it replace
// the row wholesale would show the exchange's own figure and then revert it,
// which is the blink, arriving by a new route.
const FUTURES_STREAM_STATED_POSITION_FIELDS = Object.freeze([
    'quantity',
    'entryPrice',
    'unrealizedPnl',
    'marginType',
    'isolatedWallet',
]);

const carriedOver = (row, fields) => Object.fromEntries(
    fields.filter(field => row[field] !== undefined).map(field => [field, row[field]]),
);

/**
 * What a read issued only for the values a stream cannot carry may change.
 *
 * Exactly those values. The size, the entry, the margin mode and the isolated
 * wallet are the stream's to state, and a held row keeps them. Membership is the
 * held set's too: the frame says a position closed by reporting it at zero, and
 * a read that has not caught up with that must not put it back. A contract the
 * read knows about and the desk does not is added — the desk missed something,
 * and showing it is better than hiding it.
 *
 * A full read — the first snapshot, a reconnect, the periodic beat, the
 * operator's refresh — is not this and replaces everything, which is what
 * corrects a frame the desk never saw.
 */
export const reconcileFuturesUnstatedPositionRead = (resources, rows) => {
    const held = Array.isArray(resources?.positions?.data) ? resources.positions.data : [];
    if (held.length === 0) return rows;
    const answered = new Map(
        (Array.isArray(rows) ? rows : []).map(row => [futuresPositionKey(row), row]),
    );
    const merged = held.map((row) => {
        const key = futuresPositionKey(row);
        const read = answered.get(key);
        if (read === undefined) return row;
        answered.delete(key);
        return Object.freeze({
            ...read,
            ...carriedOver(row, FUTURES_STREAM_STATED_POSITION_FIELDS),
        });
    });
    return Object.freeze([...merged, ...answered.values()]);
};

/**
 * The same rule for the wallet: the free margin is the read's to state, the
 * balance itself is the stream's.
 */
export const reconcileFuturesUnstatedBalanceRead = (resources, balances) => {
    const held = resources?.balances?.data;
    if (!held || typeof held !== 'object') return balances;
    if (!balances || typeof balances !== 'object') return balances;
    const merged = { ...balances };
    for (const [asset, reading] of Object.entries(balances)) {
        const stated = held[asset];
        if (stated?.total === undefined && stated?.crossWallet === undefined) continue;
        merged[asset] = Object.freeze({
            ...reading,
            ...(stated.total === undefined ? {} : { total: stated.total }),
            ...(stated.crossWallet === undefined ? {} : { crossWallet: stated.crossWallet }),
        });
    }
    return Object.freeze(merged);
};

/**
 * Folds one `ACCOUNT_UPDATE` into the held wallet and positions.
 *
 * The exchange has just stated the change, on a stream the desk is already
 * listening to. Asking for it back over REST put the position on screen a signed
 * round trip after the frame that carried it — 340–800 ms through the operator's
 * proxy, measured — and cost weight 10 for every fill, twice, because the
 * execution report for the same fill asked as well.
 *
 * Answers the resources and `unstated`: the resources holding values the frame
 * cannot carry — the liquidation price, the margin a position commits, the free
 * margin an order is sized against — that the fold has just moved. The caller
 * reads exactly those back and nothing else. When the fold changed nothing,
 * `unstated` is empty and there is nothing to read.
 */
export const foldFuturesAccountUpdate = (
    resources,
    update,
    { now = Date.now() } = {},
) => {
    const balances = Array.isArray(update?.balances) ? update.balances : [];
    const positions = Array.isArray(update?.positions) ? update.positions : [];
    const withWallet = foldFuturesWalletBalances(resources, balances, now);
    const folded = foldFuturesPositions(withWallet, positions, now);
    const unstated = [];
    // A position that moved changed where it liquidates and what it commits.
    if (folded.positions !== resources.positions) unstated.push('positions');
    // A wallet that moved changed the free margin — and so did a position,
    // whose margin comes out of the same wallet.
    if (folded.balances !== resources.balances || folded.positions !== resources.positions) {
        unstated.push('balances');
    }
    return { resources: folded, unstated: Object.freeze(unstated) };
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
