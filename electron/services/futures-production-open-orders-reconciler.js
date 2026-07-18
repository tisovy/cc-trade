const EXECUTION_SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/;
const EXCHANGE_SYMBOL_PATTERN = /^[\p{Lu}\p{Lt}\p{Lo}\p{N}]{2,64}(?:_[0-9]{6})?$/u;
const MAX_EXCHANGE_SYMBOL_BYTES = 256;
const CLIENT_ORDER_ID_PATTERN = /^[.A-Z:/a-z0-9_-]{1,36}$/;
const APP_OWNED_CLIENT_ORDER_ID_PATTERN = /^cc7-[0-9a-f]{32}$/;
const ORDER_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const TIME_IN_FORCE_PATTERN = /^(?:GTC|IOC|FOK|GTX|GTD|GTE_GTC|RPI)$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const ORDER_ID_PATTERN = /^[1-9][0-9]{0,18}$/;
const OPEN_STATUSES = new Set(['NEW', 'PARTIALLY_FILLED']);
const OPEN_ALGO_STATUSES = new Set(['NEW', 'TRIGGERING']);
const TERMINAL_STATUSES = new Set([
    'FILLED',
    'CANCELED',
    'REJECTED',
    'EXPIRED',
    'EXPIRED_IN_MATCH',
]);
const TERMINAL_ALGO_STATUSES = new Set([
    'CANCELED',
    'TRIGGERED',
    'FINISHED',
    'REJECTED',
    'EXPIRED',
]);
const ORDER_KINDS = new Set(['REGULAR', 'ALGO']);
const POSITION_SIDES = new Set(['LONG', 'SHORT', 'BOTH']);
const SIDES = new Set(['BUY', 'SELL']);
const MAX_ORDERS = 2_048;
const MAX_TOMBSTONES = 2_048;
const MAX_BUFFERED_EVENTS = 2_048;
const MAX_CANCEL_SYMBOLS = 16;
const STATE_MARKER = Symbol('futures-open-orders-reconciliation-state');

export const FUTURES_OPEN_ORDER_SYNC_STATES = Object.freeze({
    IDLE: 'idle',
    SYNCING: 'syncing',
    RESYNCING: 'resyncing',
    LIVE: 'live',
    DEGRADED: 'degraded',
});

export class FuturesOpenOrdersReconciliationError extends Error {
    constructor(code) {
        super('Futures open-order reconciliation input was rejected');
        this.name = 'FuturesOpenOrdersReconciliationError';
        this.code = code;
    }
}

const fail = code => {
    throw new FuturesOpenOrdersReconciliationError(code);
};

const requireRecord = (value, code) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(code);
    return value;
};

const readDataField = (record, field, code, { optional = false } = {}) => {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    if (!descriptor) {
        if (optional) return undefined;
        fail(code);
    }
    if (!Object.hasOwn(descriptor, 'value')) fail(code);
    return descriptor.value;
};

const requireEnum = (value, allowed, code) => {
    if (typeof value !== 'string' || !allowed.has(value)) fail(code);
    return value;
};

const requirePattern = (value, pattern, code) => {
    if (typeof value !== 'string' || !pattern.test(value)) fail(code);
    return value;
};

const requireExchangeSymbol = (value, code) => {
    if (typeof value !== 'string'
        || Buffer.byteLength(value, 'utf8') > MAX_EXCHANGE_SYMBOL_BYTES
        || /[a-z]/.test(value)
        || !EXCHANGE_SYMBOL_PATTERN.test(value)) fail(code);
    return value;
};

const requireBoolean = (value, code, fallback = undefined) => {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'boolean') fail(code);
    return value;
};

const requireTimestamp = (value, code) => {
    if (!Number.isSafeInteger(value) || value < 0) fail(code);
    return value;
};

const readOptionalTimestamp = (record, field, code) => {
    const value = readDataField(record, field, code, { optional: true });
    return value === undefined || value === null ? null : requireTimestamp(value, code);
};

const requireOrderId = (value, code) => {
    let token;
    if (typeof value === 'string') token = value;
    else if (typeof value === 'bigint') token = value.toString();
    else if (Number.isSafeInteger(value)) token = String(value);
    else fail(code);
    if (!ORDER_ID_PATTERN.test(token)) fail(code);
    return token;
};

const requireDecimal = (value, code) => {
    if (typeof value !== 'string'
        || value.length > 64
        || !DECIMAL_PATTERN.test(value)) fail(code);
    return value;
};

const requireDenseArray = (value, maximum, code) => {
    if (!Array.isArray(value)
        || Object.getPrototypeOf(value) !== Array.prototype
        || value.length > maximum
        || Reflect.ownKeys(value).length !== value.length + 1) fail(code);
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(code);
    }
    return value;
};

const requireCancelOrderKeys = (value, selectedSymbols, code) => {
    const orderKeys = requireDenseArray(value, MAX_ORDERS, code);
    const selectedOrderKeys = new Set();
    for (const orderKey of orderKeys) {
        if (typeof orderKey !== 'string'
            || selectedOrderKeys.has(orderKey)
            || ![...selectedSymbols].some(symbol => {
                if (!orderKey.startsWith(`${symbol}:`)) return false;
                return /^(?:ALGO:)?[1-9][0-9]{0,18}$/.test(
                    orderKey.slice(symbol.length + 1),
                );
            })) fail(code);
        selectedOrderKeys.add(orderKey);
    }
    return selectedOrderKeys;
};

const positionEffectFor = (positionSide, side) => {
    if (positionSide === 'LONG') return side === 'BUY' ? 'ENTRY' : 'EXIT';
    if (positionSide === 'SHORT') return side === 'SELL' ? 'ENTRY' : 'EXIT';
    return null;
};

export const createFuturesOpenOrderKey = (
    symbolValue,
    orderIdValue,
    orderKindValue = 'REGULAR',
) => {
    const symbol = requireExchangeSymbol(symbolValue, 'INVALID_ORDER_IDENTITY');
    const orderId = requireOrderId(orderIdValue, 'INVALID_ORDER_IDENTITY');
    const orderKind = requireEnum(orderKindValue, ORDER_KINDS, 'INVALID_ORDER_IDENTITY');
    return orderKind === 'REGULAR' ? `${symbol}:${orderId}` : `${symbol}:ALGO:${orderId}`;
};

export const createFuturesClientOrderKey = (
    symbolValue,
    clientOrderIdValue,
    orderKindValue = 'REGULAR',
) => {
    const symbol = requireExchangeSymbol(symbolValue, 'INVALID_ORDER_IDENTITY');
    const clientOrderId = requirePattern(
        clientOrderIdValue,
        CLIENT_ORDER_ID_PATTERN,
        'INVALID_ORDER_IDENTITY',
    );
    const orderKind = requireEnum(orderKindValue, ORDER_KINDS, 'INVALID_ORDER_IDENTITY');
    return orderKind === 'REGULAR'
        ? `${symbol}:${clientOrderId}`
        : `${symbol}:ALGO:${clientOrderId}`;
};

const createNormalizedOrder = ({
    orderKind,
    symbol,
    orderId,
    clientOrderId,
    side,
    positionSide,
    type,
    timeInForce,
    price,
    originalQuantity,
    filledQuantity,
    status,
    reduceOnly,
    closePosition,
    updateTime,
    updateTimeSource,
    syncState = 'synced',
    reconciliationSequence = 0,
}) => Object.freeze({
    key: createFuturesOpenOrderKey(symbol, orderId, orderKind),
    clientKey: createFuturesClientOrderKey(symbol, clientOrderId, orderKind),
    orderKind,
    symbol,
    orderId,
    clientOrderId,
    side,
    positionSide,
    positionEffect: positionEffectFor(positionSide, side),
    type,
    timeInForce,
    price,
    originalQuantity,
    filledQuantity,
    status,
    reduceOnly,
    closePosition,
    isAppOwned: APP_OWNED_CLIENT_ORDER_ID_PATTERN.test(clientOrderId),
    updateTime,
    updateTimeSource,
    syncState,
    reconciliationSequence,
});

const normalizeSharedOrderFields = ({
    orderKind,
    field,
    updateTime,
    updateTimeSource,
    code,
}) => {
    const normalizedOrderKind = requireEnum(orderKind, ORDER_KINDS, code);
    const symbol = requireExchangeSymbol(field('symbol'), code);
    const orderId = requireOrderId(field('orderId'), code);
    const clientOrderId = requirePattern(field('clientOrderId'), CLIENT_ORDER_ID_PATTERN, code);
    const side = requireEnum(field('side'), SIDES, code);
    const positionSide = requireEnum(field('positionSide'), POSITION_SIDES, code);
    const status = requireEnum(
        field('status'),
        normalizedOrderKind === 'ALGO'
            ? new Set([...OPEN_ALGO_STATUSES, ...TERMINAL_ALGO_STATUSES])
            : new Set([...OPEN_STATUSES, ...TERMINAL_STATUSES]),
        code,
    );
    return createNormalizedOrder({
        orderKind: normalizedOrderKind,
        symbol,
        orderId,
        clientOrderId,
        side,
        positionSide,
        type: requirePattern(field('type'), ORDER_TYPE_PATTERN, code),
        timeInForce: requirePattern(field('timeInForce'), TIME_IN_FORCE_PATTERN, code),
        price: requireDecimal(field('price'), code),
        originalQuantity: requireDecimal(field('originalQuantity'), code),
        filledQuantity: requireDecimal(field('filledQuantity'), code),
        status,
        reduceOnly: requireBoolean(field('reduceOnly', true), code, false),
        closePosition: requireBoolean(field('closePosition', true), code, false),
        updateTime,
        updateTimeSource,
    });
};

export const normalizeFuturesRestOpenOrder = (value) => {
    const code = 'INVALID_REST_OPEN_ORDER';
    const source = requireRecord(value, code);
    const updateTime = requireTimestamp(readDataField(source, 'updateTime', code), code);
    const fieldNames = Object.freeze({
        symbol: 'symbol',
        orderId: 'orderId',
        clientOrderId: 'clientOrderId',
        side: 'side',
        positionSide: 'positionSide',
        type: 'type',
        timeInForce: 'timeInForce',
        price: 'price',
        originalQuantity: 'origQty',
        filledQuantity: 'executedQty',
        status: 'status',
        reduceOnly: 'reduceOnly',
        closePosition: 'closePosition',
    });
    return normalizeSharedOrderFields({
        orderKind: 'REGULAR',
        code,
        updateTime,
        updateTimeSource: 'rest.updateTime',
        field: (name, optional = false) => readDataField(
            source,
            fieldNames[name],
            code,
            { optional },
        ),
    });
};

export const normalizeFuturesOrderTradeUpdate = (value) => {
    const code = 'INVALID_ORDER_TRADE_UPDATE';
    const event = requireRecord(value, code);
    if (readDataField(event, 'e', code) !== 'ORDER_TRADE_UPDATE') fail(code);
    const order = requireRecord(readDataField(event, 'o', code), code);
    const innerOrderTime = readOptionalTimestamp(order, 'T', code);
    const transactionTime = readOptionalTimestamp(event, 'T', code);
    const eventTime = readOptionalTimestamp(event, 'E', code);
    const updateTime = innerOrderTime ?? transactionTime ?? eventTime;
    if (updateTime === null) fail(code);
    const updateTimeSource = innerOrderTime !== null
        ? 'order.T'
        : transactionTime !== null
            ? 'event.T'
            : 'event.E';
    const fieldNames = Object.freeze({
        symbol: 's',
        orderId: 'i',
        clientOrderId: 'c',
        side: 'S',
        positionSide: 'ps',
        type: 'o',
        timeInForce: 'f',
        price: 'p',
        originalQuantity: 'q',
        filledQuantity: 'z',
        status: 'X',
        reduceOnly: 'R',
        closePosition: 'cp',
    });
    return normalizeSharedOrderFields({
        orderKind: 'REGULAR',
        code,
        updateTime,
        updateTimeSource,
        field: (name, optional = false) => readDataField(
            order,
            fieldNames[name],
            code,
            { optional },
        ),
    });
};

const preferredAlgoPrice = (source, field, code) => {
    const price = readDataField(source, field, code, { optional: true });
    const triggerPrice = readDataField(source, 'triggerPrice', code, { optional: true });
    if (typeof price === 'string' && price !== '0') return price;
    if (typeof triggerPrice === 'string') return triggerPrice;
    return price ?? '0';
};

export const normalizeFuturesRestAlgoOpenOrder = (value) => {
    const code = 'INVALID_REST_ALGO_OPEN_ORDER';
    const source = requireRecord(value, code);
    const updateTime = requireTimestamp(readDataField(source, 'updateTime', code), code);
    return normalizeSharedOrderFields({
        orderKind: 'ALGO',
        code,
        updateTime,
        updateTimeSource: 'rest.updateTime',
        field: (name, optional = false) => {
            const names = Object.freeze({
                symbol: 'symbol',
                orderId: 'algoId',
                clientOrderId: 'clientAlgoId',
                side: 'side',
                positionSide: 'positionSide',
                type: 'orderType',
                timeInForce: 'timeInForce',
                originalQuantity: 'quantity',
                status: 'algoStatus',
                reduceOnly: 'reduceOnly',
                closePosition: 'closePosition',
            });
            if (name === 'price') return preferredAlgoPrice(source, 'price', code);
            if (name === 'filledQuantity') return '0';
            if (name === 'timeInForce') {
                return readDataField(source, 'timeInForce', code, { optional: true }) ?? 'GTC';
            }
            return readDataField(source, names[name], code, { optional });
        },
    });
};

export const normalizeFuturesAlgoUpdate = (value) => {
    const code = 'INVALID_ALGO_UPDATE';
    const event = requireRecord(value, code);
    if (readDataField(event, 'e', code) !== 'ALGO_UPDATE') fail(code);
    const order = requireRecord(readDataField(event, 'o', code), code);
    const transactionTime = readOptionalTimestamp(event, 'T', code);
    const eventTime = readOptionalTimestamp(event, 'E', code);
    const updateTime = transactionTime ?? eventTime;
    if (updateTime === null) fail(code);
    return normalizeSharedOrderFields({
        orderKind: 'ALGO',
        code,
        updateTime,
        updateTimeSource: transactionTime !== null ? 'event.T' : 'event.E',
        field: (name, optional = false) => {
            const names = Object.freeze({
                symbol: 's',
                orderId: 'aid',
                clientOrderId: 'caid',
                side: 'S',
                positionSide: 'ps',
                type: 'o',
                timeInForce: 'f',
                originalQuantity: 'q',
                filledQuantity: 'aq',
                status: 'X',
                reduceOnly: 'R',
                closePosition: 'cp',
            });
            if (name === 'price') {
                const price = readDataField(order, 'p', code, { optional: true });
                const triggerPrice = readDataField(order, 'tp', code, { optional: true });
                return typeof price === 'string' && price !== '0'
                    ? price
                    : triggerPrice ?? price ?? '0';
            }
            if (name === 'timeInForce') {
                return readDataField(order, 'f', code, { optional: true }) ?? 'GTC';
            }
            if (name === 'filledQuantity') {
                return readDataField(order, 'aq', code, { optional: true }) ?? '0';
            }
            return readDataField(order, names[name], code, { optional });
        },
    });
};

const normalizeFuturesAuthoritativeOrderResult = (value) => {
    const code = 'INVALID_AUTHORITATIVE_ORDER_RESULT';
    const source = requireRecord(value, code);
    const updateTime = requireTimestamp(readDataField(source, 'updateTime', code), code);
    const fieldNames = Object.freeze({
        symbol: 'symbol',
        orderId: 'orderId',
        clientOrderId: 'clientOrderId',
        side: 'side',
        positionSide: 'positionSide',
        type: 'type',
        timeInForce: 'timeInForce',
        price: 'price',
        originalQuantity: 'originalQuantity',
        filledQuantity: 'executedQuantity',
        status: 'status',
        reduceOnly: 'reduceOnly',
        closePosition: 'closePosition',
    });
    return normalizeSharedOrderFields({
        orderKind: 'REGULAR',
        code,
        updateTime,
        updateTimeSource: 'query.updateTime',
        field: (name, optional = false) => readDataField(
            source,
            fieldNames[name],
            code,
            { optional },
        ),
    });
};

const orderSignature = order => [
    order.key,
    order.orderKind,
    order.clientKey,
    order.side,
    order.positionSide,
    order.type,
    order.timeInForce,
    order.price,
    order.originalQuantity,
    order.filledQuantity,
    order.status,
    order.reduceOnly,
    order.closePosition,
    order.updateTime,
].join('|');

const withOrderState = (order, syncState, reconciliationSequence) => Object.freeze({
    ...order,
    syncState,
    reconciliationSequence,
});

const createTombstone = (order, sequence) => Object.freeze({
    key: order.key,
    clientKey: order.clientKey,
    symbol: order.symbol,
    orderId: order.orderId,
    clientOrderId: order.clientOrderId,
    status: order.status,
    updateTime: order.updateTime,
    updateTimeSource: order.updateTimeSource,
    reconciliationSequence: sequence,
});

const freezeState = ({
    syncState,
    snapshotGeneration,
    activeSnapshotId,
    snapshotStartedAt,
    observedAt,
    orders,
    tombstones,
    bufferedEvents,
    nextSequence,
    errorCode = null,
}) => Object.freeze({
    [STATE_MARKER]: true,
    syncState,
    snapshotGeneration,
    activeSnapshotId,
    snapshotStartedAt,
    observedAt,
    orders: Object.freeze([...orders]),
    tombstones: Object.freeze([...tombstones]),
    bufferedEvents: Object.freeze([...bufferedEvents]),
    nextSequence,
    errorCode,
});

const requireState = value => {
    if (!value || value[STATE_MARKER] !== true || !Object.isFrozen(value)) {
        fail('INVALID_RECONCILIATION_STATE');
    }
    return value;
};

export const createFuturesOpenOrdersReconciliationState = () => freezeState({
    syncState: FUTURES_OPEN_ORDER_SYNC_STATES.IDLE,
    snapshotGeneration: 0,
    activeSnapshotId: null,
    snapshotStartedAt: null,
    observedAt: null,
    orders: [],
    tombstones: [],
    bufferedEvents: [],
    nextSequence: 1,
});

export const beginFuturesOpenOrdersSnapshot = (stateValue, { startedAt } = {}) => {
    const state = requireState(stateValue);
    requireTimestamp(startedAt, 'INVALID_SNAPSHOT_BOUNDARY');
    const snapshotId = state.snapshotGeneration + 1;
    if (!Number.isSafeInteger(snapshotId)) fail('INVALID_SNAPSHOT_BOUNDARY');
    return freezeState({
        ...state,
        syncState: state.orders.length === 0
            ? FUTURES_OPEN_ORDER_SYNC_STATES.SYNCING
            : FUTURES_OPEN_ORDER_SYNC_STATES.RESYNCING,
        snapshotGeneration: snapshotId,
        activeSnapshotId: snapshotId,
        snapshotStartedAt: startedAt,
        orders: state.orders.map(order => withOrderState(
            order,
            order.syncState === 'pending' ? 'pending' : 'stale',
            order.reconciliationSequence,
        )),
        bufferedEvents: [],
        errorCode: null,
    });
};

const latestEntryForKey = (state, key) => {
    const candidates = [];
    const order = state.orders.find(candidate => candidate.key === key);
    if (order) candidates.push({ order, terminal: false, sequence: order.reconciliationSequence });
    const tombstone = state.tombstones.find(candidate => candidate.key === key);
    if (tombstone) candidates.push({ order: tombstone, terminal: true, sequence: tombstone.reconciliationSequence });
    for (const entry of state.bufferedEvents) {
        if (entry.order.key === key) candidates.push(entry);
    }
    return candidates.sort((left, right) => (
        right.order.updateTime - left.order.updateTime
        || Number(right.terminal) - Number(left.terminal)
        || right.sequence - left.sequence
    ))[0] ?? null;
};

const shouldIgnoreIncoming = (existing, incoming, terminal) => {
    if (!existing) return false;
    if (existing.terminal && !terminal) {
        return incoming.updateTime <= existing.order.updateTime;
    }
    if (incoming.updateTime < existing.order.updateTime) return true;
    if (terminal && !existing.terminal) return false;
    if (incoming.updateTime > existing.order.updateTime) return false;
    if (existing.terminal && terminal) return existing.order.status === incoming.status;
    if (existing.order.syncState === 'pending') return false;
    return orderSignature(existing.order) === orderSignature(incoming);
};

const applyEntry = (ordersValue, tombstonesValue, entry, syncState = 'synced') => {
    const orders = new Map(ordersValue.map(order => [order.key, order]));
    const tombstones = new Map(tombstonesValue.map(item => [item.key, item]));
    const existingTombstone = tombstones.get(entry.order.key);
    if (existingTombstone && !entry.terminal) {
        if (entry.order.updateTime <= existingTombstone.updateTime) {
            return { orders, tombstones, changed: false };
        }
        tombstones.delete(entry.order.key);
    }

    if (entry.terminal) {
        orders.delete(entry.order.key);
        const current = tombstones.get(entry.order.key);
        if (!current
            || entry.order.updateTime > current.updateTime
            || (entry.order.updateTime === current.updateTime
                && entry.sequence > current.reconciliationSequence)) {
            tombstones.set(entry.order.key, createTombstone(entry.order, entry.sequence));
        }
        return { orders, tombstones, changed: true };
    }

    const existing = orders.get(entry.order.key);
    const confirmsPending = existing?.syncState === 'pending' && syncState !== 'pending';
    if (existing && (entry.order.updateTime < existing.updateTime
        || (entry.order.updateTime === existing.updateTime
            && orderSignature(entry.order) === orderSignature(existing)
            && !confirmsPending))) {
        return { orders, tombstones, changed: false };
    }
    orders.set(entry.order.key, withOrderState(entry.order, syncState, entry.sequence));
    return { orders, tombstones, changed: true };
};

const boundedTombstones = tombstones => [...tombstones]
    .sort((left, right) => (
        right.updateTime - left.updateTime
        || right.reconciliationSequence - left.reconciliationSequence
        || left.key.localeCompare(right.key)
    ))
    .slice(0, MAX_TOMBSTONES);

export const applyFuturesOrderTradeUpdate = (stateValue, payload) => {
    const state = requireState(stateValue);
    const order = normalizeFuturesOrderTradeUpdate(payload);
    const terminal = TERMINAL_STATUSES.has(order.status);
    const existing = latestEntryForKey(state, order.key);
    if (shouldIgnoreIncoming(existing, order, terminal)) return state;
    const sequence = state.nextSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1) fail('INVALID_RECONCILIATION_STATE');
    const entry = Object.freeze({ order, terminal, sequence });
    if (state.activeSnapshotId !== null) {
        if (state.bufferedEvents.length >= MAX_BUFFERED_EVENTS) {
            fail('ORDER_EVENT_BUFFER_EXHAUSTED');
        }
        return freezeState({
            ...state,
            bufferedEvents: [...state.bufferedEvents, entry],
            nextSequence: sequence + 1,
        });
    }

    const applied = applyEntry(state.orders, state.tombstones, entry);
    if (!applied.changed) return state;
    return freezeState({
        ...state,
        syncState: state.syncState === FUTURES_OPEN_ORDER_SYNC_STATES.IDLE
            ? FUTURES_OPEN_ORDER_SYNC_STATES.DEGRADED
            : state.syncState,
        observedAt: Math.max(state.observedAt ?? 0, order.updateTime),
        orders: [...applied.orders.values()].sort((left, right) => left.key.localeCompare(right.key)),
        tombstones: boundedTombstones(applied.tombstones.values()),
        nextSequence: sequence + 1,
    });
};

export const applyFuturesAlgoUpdate = (stateValue, payload) => {
    const state = requireState(stateValue);
    const order = normalizeFuturesAlgoUpdate(payload);
    const terminal = TERMINAL_ALGO_STATUSES.has(order.status);
    const existing = latestEntryForKey(state, order.key);
    if (shouldIgnoreIncoming(existing, order, terminal)) return state;
    const sequence = state.nextSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1) fail('INVALID_RECONCILIATION_STATE');
    const entry = Object.freeze({ order, terminal, sequence });
    if (state.activeSnapshotId !== null) {
        if (state.bufferedEvents.length >= MAX_BUFFERED_EVENTS) {
            fail('ORDER_EVENT_BUFFER_EXHAUSTED');
        }
        return freezeState({
            ...state,
            bufferedEvents: [...state.bufferedEvents, entry],
            nextSequence: sequence + 1,
        });
    }
    const applied = applyEntry(state.orders, state.tombstones, entry);
    if (!applied.changed) return state;
    return freezeState({
        ...state,
        syncState: state.syncState === FUTURES_OPEN_ORDER_SYNC_STATES.IDLE
            ? FUTURES_OPEN_ORDER_SYNC_STATES.DEGRADED
            : state.syncState,
        observedAt: Math.max(state.observedAt ?? 0, order.updateTime),
        orders: [...applied.orders.values()].sort((left, right) => left.key.localeCompare(right.key)),
        tombstones: boundedTombstones(applied.tombstones.values()),
        nextSequence: sequence + 1,
    });
};

export const applyFuturesAuthoritativeOrderResult = (stateValue, payload) => {
    const state = requireState(stateValue);
    const order = normalizeFuturesAuthoritativeOrderResult(payload);
    const terminal = TERMINAL_STATUSES.has(order.status);
    const existing = latestEntryForKey(state, order.key);
    if (shouldIgnoreIncoming(existing, order, terminal)) return state;
    const sequence = state.nextSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1) fail('INVALID_RECONCILIATION_STATE');
    const entry = Object.freeze({ order, terminal, sequence });
    if (state.activeSnapshotId !== null) {
        if (state.bufferedEvents.length >= MAX_BUFFERED_EVENTS) {
            fail('ORDER_EVENT_BUFFER_EXHAUSTED');
        }
        return freezeState({
            ...state,
            bufferedEvents: [...state.bufferedEvents, entry],
            nextSequence: sequence + 1,
        });
    }
    const applied = applyEntry(state.orders, state.tombstones, entry);
    if (!applied.changed) return state;
    return freezeState({
        ...state,
        syncState: state.syncState === FUTURES_OPEN_ORDER_SYNC_STATES.IDLE
            ? FUTURES_OPEN_ORDER_SYNC_STATES.DEGRADED
            : state.syncState,
        observedAt: Math.max(state.observedAt ?? 0, order.updateTime),
        orders: [...applied.orders.values()].sort((left, right) => (
            left.key.localeCompare(right.key)
        )),
        tombstones: boundedTombstones(applied.tombstones.values()),
        nextSequence: sequence + 1,
    });
};

const applyAcceptedOrderProjection = (
    stateValue,
    payload,
    { requireExisting, updateTimeSource },
) => {
    const state = requireState(stateValue);
    const normalized = normalizeFuturesAuthoritativeOrderResult(payload);
    if (!OPEN_STATUSES.has(normalized.status)
        || normalized.type !== 'LIMIT'
        || normalized.timeInForce !== 'GTC'
        || normalized.reduceOnly !== false
        || normalized.closePosition !== false) {
        fail('INVALID_ACCEPTED_ORDER_PROJECTION');
    }
    const order = Object.freeze({ ...normalized, updateTimeSource });
    const existingOrder = state.orders.find(candidate => candidate.key === order.key) ?? null;
    if (requireExisting && (!existingOrder
        || existingOrder.orderKind !== 'REGULAR'
        || existingOrder.clientKey !== order.clientKey)) {
        fail('INVALID_ACCEPTED_ORDER_PROJECTION');
    }
    const conflictingClientIdentity = [
        ...state.orders,
        ...state.tombstones,
        ...state.bufferedEvents.map(entry => entry.order),
    ].find(candidate => candidate.clientKey === order.clientKey && candidate.key !== order.key);
    if (conflictingClientIdentity) fail('INVALID_ACCEPTED_ORDER_PROJECTION');

    const existing = latestEntryForKey(state, order.key);
    if (shouldIgnoreIncoming(existing, order, false)) return state;
    const sequence = state.nextSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1) fail('INVALID_RECONCILIATION_STATE');
    const entry = Object.freeze({ order, terminal: false, sequence, syncState: 'pending' });
    if (state.activeSnapshotId !== null) {
        if (state.bufferedEvents.length >= MAX_BUFFERED_EVENTS) {
            fail('ORDER_EVENT_BUFFER_EXHAUSTED');
        }
        return freezeState({
            ...state,
            bufferedEvents: [...state.bufferedEvents, entry],
            nextSequence: sequence + 1,
        });
    }
    const applied = applyEntry(state.orders, state.tombstones, entry, 'pending');
    if (!applied.changed) return state;
    return freezeState({
        ...state,
        syncState: state.syncState === FUTURES_OPEN_ORDER_SYNC_STATES.IDLE
            ? FUTURES_OPEN_ORDER_SYNC_STATES.DEGRADED
            : state.syncState,
        observedAt: Math.max(state.observedAt ?? 0, order.updateTime),
        orders: [...applied.orders.values()].sort((left, right) => (
            left.key.localeCompare(right.key)
        )),
        tombstones: boundedTombstones(applied.tombstones.values()),
        nextSequence: sequence + 1,
    });
};

export const applyFuturesAcceptedCreateProjection = (stateValue, payload) => {
    const source = requireRecord(payload, 'INVALID_ACCEPTED_ORDER_PROJECTION');
    if (readDataField(source, 'status', 'INVALID_ACCEPTED_ORDER_PROJECTION') !== 'NEW'
        || readDataField(source, 'executedQuantity', 'INVALID_ACCEPTED_ORDER_PROJECTION')
            !== '0') {
        fail('INVALID_ACCEPTED_ORDER_PROJECTION');
    }
    return applyAcceptedOrderProjection(stateValue, source, {
        requireExisting: false,
        updateTimeSource: 'ack.transactTime',
    });
};

export const applyFuturesAcceptedAmendProjection = (stateValue, payload) => (
    applyAcceptedOrderProjection(stateValue, payload, {
        requireExisting: true,
        updateTimeSource: 'ack.updateTime',
    })
);

const normalizeSnapshotRows = rowsValue => {
    const rows = requireDenseArray(rowsValue, MAX_ORDERS, 'INVALID_OPEN_ORDERS_SNAPSHOT');
    const orders = new Map();
    for (const row of rows) {
        const source = requireRecord(row, 'INVALID_OPEN_ORDERS_SNAPSHOT');
        const isAlgo = Object.hasOwn(source, 'algoId');
        const order = isAlgo
            ? normalizeFuturesRestAlgoOpenOrder(source)
            : normalizeFuturesRestOpenOrder(source);
        const openStatuses = isAlgo ? OPEN_ALGO_STATUSES : OPEN_STATUSES;
        if (!openStatuses.has(order.status)) fail('INVALID_OPEN_ORDERS_SNAPSHOT');
        const existing = orders.get(order.key);
        if (!existing || order.updateTime > existing.updateTime) {
            orders.set(order.key, order);
        } else if (order.updateTime === existing.updateTime
            && orderSignature(order) !== orderSignature(existing)) {
            fail('CONFLICTING_OPEN_ORDERS_SNAPSHOT');
        }
    }
    return orders;
};

export const completeFuturesOpenOrdersSnapshot = (
    stateValue,
    { snapshotId, rows, completedAt } = {},
) => {
    const state = requireState(stateValue);
    if (!Number.isSafeInteger(snapshotId) || snapshotId < 1) fail('INVALID_SNAPSHOT_BOUNDARY');
    requireTimestamp(completedAt, 'INVALID_SNAPSHOT_BOUNDARY');
    if (snapshotId !== state.activeSnapshotId) return state;

    const snapshotOrders = normalizeSnapshotRows(rows);
    const tombstones = new Map(state.tombstones.map(item => [item.key, item]));
    for (const key of tombstones.keys()) snapshotOrders.delete(key);

    let nextSequence = state.nextSequence;
    for (const existingOrder of state.orders) {
        const snapshotOrder = snapshotOrders.get(existingOrder.key);
        if (snapshotOrder) {
            if (existingOrder.updateTime > snapshotOrder.updateTime) {
                snapshotOrders.set(existingOrder.key, existingOrder);
            }
            continue;
        }
        if (existingOrder.syncState === 'pending'
            || existingOrder.updateTime > completedAt) {
            snapshotOrders.set(existingOrder.key, existingOrder);
            continue;
        }
        tombstones.set(existingOrder.key, createTombstone({
            ...existingOrder,
            status: 'CANCELED',
            updateTime: completedAt,
            updateTimeSource: 'snapshot.absent',
        }, nextSequence));
        nextSequence += 1;
    }

    let reconciledOrders = snapshotOrders;
    let reconciledTombstones = tombstones;
    for (const entry of state.bufferedEvents) {
        const applied = applyEntry(
            [...reconciledOrders.values()],
            [...reconciledTombstones.values()],
            entry,
            entry.syncState ?? 'synced',
        );
        reconciledOrders = applied.orders;
        reconciledTombstones = applied.tombstones;
    }
    return freezeState({
        ...state,
        syncState: FUTURES_OPEN_ORDER_SYNC_STATES.LIVE,
        activeSnapshotId: null,
        snapshotStartedAt: null,
        observedAt: completedAt,
        orders: [...reconciledOrders.values()]
            .map(order => withOrderState(
                order,
                order.syncState === 'pending' ? 'pending' : 'synced',
                order.reconciliationSequence,
            ))
            .sort((left, right) => left.key.localeCompare(right.key)),
        tombstones: boundedTombstones(reconciledTombstones.values()),
        bufferedEvents: [],
        nextSequence,
        errorCode: null,
    });
};

export const failFuturesOpenOrdersSnapshot = (
    stateValue,
    { snapshotId, errorCode = 'SNAPSHOT_UNAVAILABLE' } = {},
) => {
    const state = requireState(stateValue);
    if (!Number.isSafeInteger(snapshotId) || snapshotId < 1
        || typeof errorCode !== 'string'
        || !/^[A-Z0-9_]{1,64}$/.test(errorCode)) fail('INVALID_SNAPSHOT_BOUNDARY');
    if (snapshotId !== state.activeSnapshotId) return state;
    let orders = new Map(state.orders.map(order => [order.key, order]));
    let tombstones = new Map(state.tombstones.map(item => [item.key, item]));
    for (const entry of state.bufferedEvents) {
        const applied = applyEntry(
            [...orders.values()],
            [...tombstones.values()],
            entry,
            entry.syncState ?? 'stale',
        );
        orders = applied.orders;
        tombstones = applied.tombstones;
    }
    return freezeState({
        ...state,
        syncState: FUTURES_OPEN_ORDER_SYNC_STATES.DEGRADED,
        activeSnapshotId: null,
        snapshotStartedAt: null,
        orders: [...orders.values()]
            .map(order => withOrderState(
                order,
                order.syncState === 'pending' ? 'pending' : 'stale',
                order.reconciliationSequence,
            ))
            .sort((left, right) => left.key.localeCompare(right.key)),
        tombstones: boundedTombstones(tombstones.values()),
        bufferedEvents: [],
        errorCode,
    });
};

const updateSymbolPendingState = (
    stateValue,
    { symbol: symbolValue, orderKeys, observedAt, from, to },
) => {
    const state = requireState(stateValue);
    const symbol = requirePattern(
        symbolValue,
        EXECUTION_SYMBOL_PATTERN,
        'INVALID_CANCEL_PROJECTION',
    );
    const selectedOrderKeys = requireCancelOrderKeys(
        orderKeys,
        new Set([symbol]),
        'INVALID_CANCEL_PROJECTION',
    );
    requireTimestamp(observedAt, 'INVALID_CANCEL_PROJECTION');
    const sourceStates = new Set(from);
    let nextSequence = state.nextSequence;
    let changed = false;
    const orders = state.orders.map((order) => {
        if (order.symbol !== symbol
            || !selectedOrderKeys.has(order.key)
            || !sourceStates.has(order.syncState)) return order;
        if (!Number.isSafeInteger(nextSequence) || nextSequence < 1) {
            fail('INVALID_RECONCILIATION_STATE');
        }
        const updated = withOrderState(order, to, nextSequence);
        nextSequence += 1;
        changed = true;
        return updated;
    });
    if (!changed) return state;
    return freezeState({
        ...state,
        observedAt: Math.max(state.observedAt ?? 0, observedAt),
        orders,
        nextSequence,
    });
};

export const markFuturesOpenOrdersPendingCancel = (
    stateValue,
    { symbol, orderKeys, requestedAt } = {},
) => updateSymbolPendingState(stateValue, {
    symbol,
    orderKeys,
    observedAt: requestedAt,
    from: ['synced', 'stale'],
    to: 'pending',
});

export const failFuturesOpenOrdersPendingCancel = (
    stateValue,
    { symbol, orderKeys, failedAt } = {},
) => updateSymbolPendingState(stateValue, {
    symbol,
    orderKeys,
    observedAt: failedAt,
    from: ['pending'],
    to: 'stale',
});

export const removeFuturesOpenOrdersForSymbols = (
    stateValue,
    { symbols: symbolsValue, orderKeys: orderKeysValue, confirmedAt } = {},
) => {
    const state = requireState(stateValue);
    const symbols = requireDenseArray(
        symbolsValue,
        MAX_CANCEL_SYMBOLS,
        'INVALID_CANCEL_CONFIRMATION',
    );
    if (symbols.length === 0) fail('INVALID_CANCEL_CONFIRMATION');
    requireTimestamp(confirmedAt, 'INVALID_CANCEL_CONFIRMATION');
    const selected = new Set();
    for (const symbolValue of symbols) {
        const symbol = requirePattern(
            symbolValue,
            EXECUTION_SYMBOL_PATTERN,
            'INVALID_CANCEL_CONFIRMATION',
        );
        if (selected.has(symbol)) fail('INVALID_CANCEL_CONFIRMATION');
        selected.add(symbol);
    }

    const selectedOrderKeys = requireCancelOrderKeys(
        orderKeysValue,
        selected,
        'INVALID_CANCEL_CONFIRMATION',
    );

    const canceled = new Map();
    const rememberCanceled = (order) => {
        if (!selectedOrderKeys.has(order.key) || order.updateTime > confirmedAt) return;
        const existing = canceled.get(order.key);
        if (!existing || order.updateTime > existing.updateTime) canceled.set(order.key, order);
    };
    state.orders.forEach(rememberCanceled);
    state.bufferedEvents.forEach(entry => rememberCanceled(entry.order));

    const tombstones = new Map(state.tombstones.map(item => [item.key, item]));
    let nextSequence = state.nextSequence;
    for (const order of canceled.values()) {
        const existing = tombstones.get(order.key);
        if (existing && existing.updateTime > confirmedAt) continue;
        tombstones.set(order.key, createTombstone({
            ...order,
            status: 'CANCELED',
            updateTime: confirmedAt,
            updateTimeSource: 'cancel.confirmed',
        }, nextSequence));
        nextSequence += 1;
    }

    return freezeState({
        ...state,
        observedAt: Math.max(state.observedAt ?? 0, confirmedAt),
        orders: state.orders.filter(order => (
            !selectedOrderKeys.has(order.key) || order.updateTime > confirmedAt
        )),
        tombstones: boundedTombstones(tombstones.values()),
        bufferedEvents: state.bufferedEvents.filter(entry => (
            !selectedOrderKeys.has(entry.order.key) || entry.order.updateTime > confirmedAt
        )),
        nextSequence,
    });
};

export const isFuturesOpenOrderTerminalStatus = status => (
    TERMINAL_STATUSES.has(status) || TERMINAL_ALGO_STATUSES.has(status)
);
