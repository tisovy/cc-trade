export const FUTURES_READ_PROTOCOL_VERSION = 1;
export const FUTURES_MARKET_TYPE = 'futures';
export const FUTURES_READ_CHANNEL_ID = 'futures-readonly';

export const FUTURES_READ_ACTIONS = Object.freeze({
    SUBSCRIBE: 'futures.read.subscribe',
    UNSUBSCRIBE: 'futures.read.unsubscribe',
});

export const FUTURES_READ_RESPONSE_TYPES = Object.freeze({
    SNAPSHOT: 'snapshot',
    REJECTION: 'rejection',
});

export const FUTURES_READ_ENVIRONMENTS = Object.freeze({
    MOCK: 'mock',
    TESTNET: 'testnet',
});

export const FUTURES_READ_PROTOCOL_ERROR_CODES = Object.freeze({
    INVALID_JSON: 'FUTURES_READ_INVALID_JSON',
    INVALID_MESSAGE: 'FUTURES_READ_INVALID_MESSAGE',
    INVALID_FIELDS: 'FUTURES_READ_INVALID_FIELDS',
    INVALID_ACTION: 'FUTURES_READ_INVALID_ACTION',
    INVALID_VERSION: 'FUTURES_READ_INVALID_VERSION',
    INVALID_MARKET_TYPE: 'FUTURES_READ_INVALID_MARKET_TYPE',
    INVALID_REQUEST_ID: 'FUTURES_READ_INVALID_REQUEST_ID',
    INVALID_SYMBOL: 'FUTURES_READ_INVALID_SYMBOL',
    INVALID_CHANNEL_ID: 'FUTURES_READ_INVALID_CHANNEL_ID',
    INVALID_RESPONSE_TYPE: 'FUTURES_READ_INVALID_RESPONSE_TYPE',
    INVALID_ENVIRONMENT: 'FUTURES_READ_INVALID_ENVIRONMENT',
    INVALID_PAYLOAD: 'FUTURES_READ_INVALID_PAYLOAD',
});

export class FuturesReadOnlyProtocolError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesReadOnlyProtocolError';
        this.code = code;
    }
}

const SUBSCRIBE_FIELDS = Object.freeze([
    'action',
    'version',
    'marketType',
    'requestId',
    'symbol',
]);
const UNSUBSCRIBE_FIELDS = Object.freeze([
    'action',
    'version',
    'marketType',
    'requestId',
]);
const RESPONSE_FIELDS = Object.freeze([
    'channelId',
    'version',
    'marketType',
    'requestId',
    'type',
    'symbol',
    'environment',
    'payload',
]);

const isRecord = (value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
        || Object.getPrototypeOf(value) === null)
);

const isNonEmptyString = (value) => (
    typeof value === 'string'
    && value.length > 0
    && value.trim() === value
);

const isFuturesSymbol = (value) => (
    isNonEmptyString(value)
    && /^[A-Z0-9_]{1,64}$/.test(value)
);

const protocolError = (code, message) => (
    new FuturesReadOnlyProtocolError(code, message)
);

const readRawMessage = (raw) => {
    if (typeof raw !== 'string') return raw;

    try {
        return JSON.parse(raw);
    } catch {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_JSON,
            'Futures read-only message must be valid JSON',
        );
    }
};

const hasExactFields = (value, expectedFields) => {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => (
        typeof key !== 'string'
        || Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true
    ))) {
        return false;
    }
    const keys = ownKeys.sort();
    const expected = [...expectedFields].sort();
    return keys.length === expected.length
        && keys.every((key, index) => key === expected[index]);
};

const requireRecord = (value) => {
    if (!isRecord(value)) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_MESSAGE,
            'Futures read-only message must be an object',
        );
    }
};

const requireExactFields = (value, expectedFields) => {
    if (!hasExactFields(value, expectedFields)) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
            'Futures read-only message contains missing or unsupported fields',
        );
    }
};

const requireVersionAndMarket = (message) => {
    if (message.version !== FUTURES_READ_PROTOCOL_VERSION) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_VERSION,
            `Futures read-only protocol version must be ${FUTURES_READ_PROTOCOL_VERSION}`,
        );
    }

    if (message.marketType !== FUTURES_MARKET_TYPE) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_MARKET_TYPE,
            `Futures read-only marketType must be "${FUTURES_MARKET_TYPE}"`,
        );
    }
};

const requireRequestId = (requestId) => {
    if (!isNonEmptyString(requestId)) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_REQUEST_ID,
            'Futures read-only requestId must be a non-empty exact string',
        );
    }
};

const requireSymbol = (symbol, { nullable = false } = {}) => {
    if (nullable && symbol === null) return;
    if (!isFuturesSymbol(symbol)) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_SYMBOL,
            'Futures read-only symbol must be an exact uppercase futures symbol',
        );
    }
};

const cloneProtocolValue = (value, seen = new Set()) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            throw protocolError(
                FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_PAYLOAD,
                'Futures read-only payload numbers must be safe integers',
            );
        }
        return value;
    }

    if (typeof value !== 'object' || seen.has(value)) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_PAYLOAD,
            'Futures read-only payload must contain only acyclic JSON-safe values',
        );
    }

    seen.add(value);
    let clone;

    if (Array.isArray(value)) {
        const ownKeys = Reflect.ownKeys(value);
        const isDenseJsonArray = ownKeys.length === value.length + 1
            && ownKeys.includes('length')
            && Array.from({ length: value.length }, (_, index) => index)
                .every((index) => Object.hasOwn(value, index));
        if (!isDenseJsonArray) {
            throw protocolError(
                FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_PAYLOAD,
                'Futures read-only payload arrays must be dense JSON arrays',
            );
        }
        clone = Array.from(
            { length: value.length },
            (_, index) => cloneProtocolValue(value[index], seen),
        );
    } else if (isRecord(value)) {
        const ownKeys = Reflect.ownKeys(value);
        const entries = ownKeys.map((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (typeof key !== 'string'
                || descriptor?.enumerable !== true
                || !Object.hasOwn(descriptor, 'value')
                || descriptor.value === undefined) {
                throw protocolError(
                    FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_PAYLOAD,
                    'Futures read-only payload objects must contain enumerable JSON values',
                );
            }
            return [key, cloneProtocolValue(descriptor.value, seen)];
        });
        clone = Object.fromEntries(entries);
    } else {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_PAYLOAD,
            'Futures read-only payload must contain only plain objects and arrays',
        );
    }

    seen.delete(value);
    return clone;
};

const requireSnapshotPayload = (payload) => {
    if (!isRecord(payload)) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_PAYLOAD,
            'Futures read-only snapshot payload must be an object',
        );
    }
};

const requireRejectionPayload = (payload) => {
    if (!isRecord(payload)
        || !hasExactFields(payload, ['code', 'message'])
        || !isNonEmptyString(payload.code)
        || !isNonEmptyString(payload.message)) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_PAYLOAD,
            'Futures read-only rejection payload must contain exact code and message strings',
        );
    }
};

export const isFuturesReadOnlyAction = (action) => (
    Object.values(FUTURES_READ_ACTIONS).includes(action)
);

export const parseFuturesReadOnlyRequest = (raw) => {
    const message = readRawMessage(raw);
    requireRecord(message);

    if (!isFuturesReadOnlyAction(message.action)) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_ACTION,
            'Unsupported futures read-only action',
        );
    }

    const expectedFields = message.action === FUTURES_READ_ACTIONS.SUBSCRIBE
        ? SUBSCRIBE_FIELDS
        : UNSUBSCRIBE_FIELDS;
    requireExactFields(message, expectedFields);
    requireVersionAndMarket(message);
    requireRequestId(message.requestId);

    if (message.action === FUTURES_READ_ACTIONS.SUBSCRIBE) {
        requireSymbol(message.symbol);
        return {
            action: message.action,
            version: message.version,
            marketType: message.marketType,
            requestId: message.requestId,
            symbol: message.symbol,
        };
    }

    return {
        action: message.action,
        version: message.version,
        marketType: message.marketType,
        requestId: message.requestId,
    };
};

export const createFuturesReadSubscribeRequest = ({ symbol, requestId } = {}) => (
    parseFuturesReadOnlyRequest({
        action: FUTURES_READ_ACTIONS.SUBSCRIBE,
        version: FUTURES_READ_PROTOCOL_VERSION,
        marketType: FUTURES_MARKET_TYPE,
        requestId,
        symbol,
    })
);

export const createFuturesReadUnsubscribeRequest = ({ requestId } = {}) => (
    parseFuturesReadOnlyRequest({
        action: FUTURES_READ_ACTIONS.UNSUBSCRIBE,
        version: FUTURES_READ_PROTOCOL_VERSION,
        marketType: FUTURES_MARKET_TYPE,
        requestId,
    })
);

export const parseFuturesReadOnlyResponse = (raw) => {
    const message = readRawMessage(raw);
    requireRecord(message);
    requireExactFields(message, RESPONSE_FIELDS);

    if (message.channelId !== FUTURES_READ_CHANNEL_ID) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_CHANNEL_ID,
            `Futures read-only channelId must be "${FUTURES_READ_CHANNEL_ID}"`,
        );
    }

    requireVersionAndMarket(message);
    requireRequestId(message.requestId);

    if (!Object.values(FUTURES_READ_RESPONSE_TYPES).includes(message.type)) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_RESPONSE_TYPE,
            'Unsupported futures read-only response type',
        );
    }

    if (!Object.values(FUTURES_READ_ENVIRONMENTS).includes(message.environment)) {
        throw protocolError(
            FUTURES_READ_PROTOCOL_ERROR_CODES.INVALID_ENVIRONMENT,
            'Unsupported futures read-only environment',
        );
    }

    requireSymbol(message.symbol, {
        nullable: message.type === FUTURES_READ_RESPONSE_TYPES.REJECTION,
    });

    if (message.type === FUTURES_READ_RESPONSE_TYPES.SNAPSHOT) {
        requireSnapshotPayload(message.payload);
    } else {
        requireRejectionPayload(message.payload);
    }

    return {
        channelId: message.channelId,
        version: message.version,
        marketType: message.marketType,
        requestId: message.requestId,
        type: message.type,
        symbol: message.symbol,
        environment: message.environment,
        payload: cloneProtocolValue(message.payload),
    };
};

export const createFuturesReadOnlyResponse = ({
    requestId,
    type,
    symbol,
    environment,
    payload,
} = {}) => parseFuturesReadOnlyResponse({
    channelId: FUTURES_READ_CHANNEL_ID,
    version: FUTURES_READ_PROTOCOL_VERSION,
    marketType: FUTURES_MARKET_TYPE,
    requestId,
    type,
    symbol,
    environment,
    payload,
});

export const parseFuturesReadMessage = parseFuturesReadOnlyResponse;
