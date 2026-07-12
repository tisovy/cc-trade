import {
    FuturesTestnetDecimalError,
    parseCanonicalUnsignedInteger,
    parseNonNegativeExactDecimal,
    parsePositiveExactDecimal,
} from './futures-testnet-execution-decimal.js';

export const FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION = 1;
export const FUTURES_TESTNET_EXECUTION_CHANNEL_ID = 'futures-execution';
export const FUTURES_TESTNET_EXECUTION_ACTION = 'futures.execution.placeOrder';
export const FUTURES_TESTNET_EXECUTION_ACK_ACTION = 'futures.execution.ack';
export const FUTURES_TESTNET_EXECUTION_MARKET_TYPE = 'futures';
export const FUTURES_TESTNET_EXECUTION_ENVIRONMENT = 'testnet';
export const FUTURES_TESTNET_EXECUTION_COMMAND_MAX_BYTES = 4096;

export const FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES = Object.freeze({
    INVALID_ENCODING: 'FUTURES_TESTNET_EXECUTION_INVALID_ENCODING',
    COMMAND_TOO_LARGE: 'FUTURES_TESTNET_EXECUTION_COMMAND_TOO_LARGE',
    INVALID_JSON: 'FUTURES_TESTNET_EXECUTION_INVALID_JSON',
    INVALID_MESSAGE: 'FUTURES_TESTNET_EXECUTION_INVALID_MESSAGE',
    INVALID_FIELDS: 'FUTURES_TESTNET_EXECUTION_INVALID_FIELDS',
    INVALID_ALLOWLIST: 'FUTURES_TESTNET_EXECUTION_INVALID_ALLOWLIST',
    INVALID_ACTION: 'FUTURES_TESTNET_EXECUTION_INVALID_ACTION',
    INVALID_VERSION: 'FUTURES_TESTNET_EXECUTION_INVALID_VERSION',
    INVALID_REQUEST_ID: 'FUTURES_TESTNET_EXECUTION_INVALID_REQUEST_ID',
    INVALID_MARKET_TYPE: 'FUTURES_TESTNET_EXECUTION_INVALID_MARKET_TYPE',
    INVALID_ENVIRONMENT: 'FUTURES_TESTNET_EXECUTION_INVALID_ENVIRONMENT',
    INVALID_SYMBOL: 'FUTURES_TESTNET_EXECUTION_INVALID_SYMBOL',
    INVALID_SIDE: 'FUTURES_TESTNET_EXECUTION_INVALID_SIDE',
    INVALID_ORDER_TYPE: 'FUTURES_TESTNET_EXECUTION_INVALID_ORDER_TYPE',
    INVALID_QUANTITY: 'FUTURES_TESTNET_EXECUTION_INVALID_QUANTITY',
    INVALID_PRICE: 'FUTURES_TESTNET_EXECUTION_INVALID_PRICE',
    INVALID_TIME_IN_FORCE: 'FUTURES_TESTNET_EXECUTION_INVALID_TIME_IN_FORCE',
    INVALID_POSITION_SIDE: 'FUTURES_TESTNET_EXECUTION_INVALID_POSITION_SIDE',
    INVALID_MARGIN_TYPE: 'FUTURES_TESTNET_EXECUTION_INVALID_MARGIN_TYPE',
    INVALID_LEVERAGE: 'FUTURES_TESTNET_EXECUTION_INVALID_LEVERAGE',
    INVALID_REDUCE_ONLY: 'FUTURES_TESTNET_EXECUTION_INVALID_REDUCE_ONLY',
    INVALID_WORKING_TYPE: 'FUTURES_TESTNET_EXECUTION_INVALID_WORKING_TYPE',
    INVALID_PRICE_PROTECT: 'FUTURES_TESTNET_EXECUTION_INVALID_PRICE_PROTECT',
    INVALID_CLIENT_ORDER_ID: 'FUTURES_TESTNET_EXECUTION_INVALID_CLIENT_ORDER_ID',
    INVALID_ACKNOWLEDGEMENT: 'FUTURES_TESTNET_EXECUTION_INVALID_ACKNOWLEDGEMENT',
});

export class FuturesTestnetExecutionProtocolError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesTestnetExecutionProtocolError';
        this.code = code;
    }
}

export const FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS = Object.freeze({
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    UNKNOWN: 'unknown',
});

export const FUTURES_TESTNET_EXECUTION_STATES = Object.freeze({
    LOCALLY_REJECTED: 'locally_rejected',
    QUEUED: 'queued',
    DISPATCHED: 'dispatched',
    EXCHANGE_REJECTED: 'exchange_rejected',
    EXCHANGE_ACCEPTED: 'exchange_accepted',
    RECONCILING: 'reconciling',
    RESULT_UNKNOWN: 'result_unknown',
    CONFIRMED_OPEN: 'confirmed_open',
    CONFIRMED_FILLED: 'confirmed_filled',
    CONFIRMED_CANCELED: 'confirmed_canceled',
    RECONCILIATION_UNAVAILABLE: 'reconciliation_unavailable',
});

export const FUTURES_TESTNET_EXECUTION_SAFE_CODES = Object.freeze({
    PENDING: 'FUTURES_EXECUTION_PENDING',
    CONFIRMED: 'FUTURES_EXECUTION_CONFIRMED',
    PROTOCOL_REJECTED: 'FUTURES_EXECUTION_PROTOCOL_REJECTED',
    DISABLED: 'FUTURES_EXECUTION_DISABLED',
    ENVIRONMENT_REJECTED: 'FUTURES_EXECUTION_ENVIRONMENT_REJECTED',
    CREDENTIALS_REJECTED: 'FUTURES_EXECUTION_CREDENTIALS_REJECTED',
    SESSION_REJECTED: 'FUTURES_EXECUTION_SESSION_REJECTED',
    SYMBOL_REJECTED: 'FUTURES_EXECUTION_SYMBOL_REJECTED',
    RISK_DATA_REJECTED: 'FUTURES_EXECUTION_RISK_DATA_REJECTED',
    FILTER_REJECTED: 'FUTURES_EXECUTION_FILTER_REJECTED',
    NOTIONAL_REJECTED: 'FUTURES_EXECUTION_NOTIONAL_REJECTED',
    LEVERAGE_REJECTED: 'FUTURES_EXECUTION_LEVERAGE_REJECTED',
    MARGIN_REJECTED: 'FUTURES_EXECUTION_MARGIN_REJECTED',
    POSITION_REJECTED: 'FUTURES_EXECUTION_POSITION_REJECTED',
    REDUCE_ONLY_REJECTED: 'FUTURES_EXECUTION_REDUCE_ONLY_REJECTED',
    LIQUIDATION_REJECTED: 'FUTURES_EXECUTION_LIQUIDATION_REJECTED',
    DUPLICATE_REJECTED: 'FUTURES_EXECUTION_DUPLICATE_REJECTED',
    INTERRUPTED_BEFORE_DISPATCH: 'FUTURES_EXECUTION_INTERRUPTED_BEFORE_DISPATCH',
    BUSY: 'FUTURES_EXECUTION_BUSY',
    RATE_LIMITED: 'FUTURES_EXECUTION_RATE_LIMITED',
    AUTH_REJECTED: 'FUTURES_EXECUTION_AUTH_REJECTED',
    EXCHANGE_REJECTED: 'FUTURES_EXECUTION_EXCHANGE_REJECTED',
    RESULT_UNKNOWN: 'FUTURES_EXECUTION_RESULT_UNKNOWN',
    RECONCILIATION_UNAVAILABLE: 'FUTURES_EXECUTION_RECONCILIATION_UNAVAILABLE',
});

export const FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES = Object.freeze({
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.PENDING]: 'Testnet reduce-only order is pending.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.CONFIRMED]: 'Testnet reduce-only order is confirmed.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.PROTOCOL_REJECTED]: 'Testnet reduce-only order command was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.DISABLED]: 'Testnet futures execution is disabled.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.ENVIRONMENT_REJECTED]: 'Testnet futures execution environment was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.CREDENTIALS_REJECTED]: 'Testnet futures execution credentials were rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.SESSION_REJECTED]: 'Testnet futures execution session was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED]: 'Testnet futures execution symbol was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED]: 'Testnet futures execution risk data was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED]: 'Testnet futures execution filters rejected the order.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED]: 'Testnet futures execution notional limits rejected the order.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.LEVERAGE_REJECTED]: 'Testnet futures execution leverage was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED]: 'Testnet futures execution margin state was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED]: 'Testnet futures execution position was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED]: 'Testnet futures execution reduce-only checks rejected the order.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.LIQUIDATION_REJECTED]: 'Testnet futures execution liquidation distance was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.DUPLICATE_REJECTED]: 'Testnet futures execution duplicate identity was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.INTERRUPTED_BEFORE_DISPATCH]: 'Testnet reduce-only order was interrupted before dispatch.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.BUSY]: 'Testnet futures execution is busy.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.RATE_LIMITED]: 'Testnet futures execution is rate limited.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.AUTH_REJECTED]: 'Testnet futures execution authentication was rejected.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED]: 'Testnet futures exchange rejected the order.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.RESULT_UNKNOWN]: 'Testnet reduce-only order result is unknown.',
    [FUTURES_TESTNET_EXECUTION_SAFE_CODES.RECONCILIATION_UNAVAILABLE]: 'Testnet reduce-only order reconciliation is unavailable.',
});

export const FUTURES_TESTNET_EXECUTION_ORDER_STATUSES = Object.freeze([
    'NEW',
    'PARTIALLY_FILLED',
    'FILLED',
    'CANCELED',
    'EXPIRED',
    'EXPIRED_IN_MATCH',
    'REJECTED',
]);

const COMMAND_FIELDS = Object.freeze([
    'action',
    'version',
    'requestId',
    'marketType',
    'environment',
    'symbol',
    'side',
    'orderType',
    'quantity',
    'price',
    'timeInForce',
    'positionSide',
    'marginType',
    'leverage',
    'reduceOnly',
    'workingType',
    'priceProtect',
    'clientOrderId',
]);

const ACK_FIELDS = Object.freeze([
    'channelId',
    'action',
    'version',
    'revision',
    'requestId',
    'marketType',
    'environment',
    'symbol',
    'clientOrderId',
    'acknowledgement',
    'state',
    'code',
    'message',
    'observedAt',
    'order',
]);

const ACK_CREATE_FIELDS = Object.freeze(
    ACK_FIELDS.filter((field) => field !== 'message'),
);

const ORDER_FIELDS = Object.freeze([
    'orderId',
    'status',
    'originalQuantity',
    'executedQuantity',
    'averagePrice',
    'updateTime',
]);

const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/;
const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_SIGNED_INT64 = 9223372036854775807n;
const MAX_SAFE_INTEGER = 9007199254740991;

const protocolError = (code, message) => (
    new FuturesTestnetExecutionProtocolError(code, message)
);

const isSafeIntegerValue = (value) => (
    typeof value === 'number'
    && value >= -MAX_SAFE_INTEGER
    && value <= MAX_SAFE_INTEGER
    && value % 1 === 0
    && !Object.is(value, -0)
);

const hasOnlyUnicodeScalars = (value) => {
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
            index += 1;
        } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            return false;
        }
    }
    return true;
};

const decodeRawUtf8 = (raw, { maximumBytes = null } = {}) => {
    let bytes;
    let text;

    if (typeof raw === 'string') {
        if (maximumBytes !== null && raw.length > maximumBytes) {
            throw protocolError(
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.COMMAND_TOO_LARGE,
                'Futures testnet execution command exceeds 4096 UTF-8 bytes',
            );
        }
        if (!hasOnlyUnicodeScalars(raw)) {
            throw protocolError(
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENCODING,
                'Futures testnet execution message is not valid UTF-8 text',
            );
        }
        bytes = new TextEncoder().encode(raw);
        text = raw;
    } else if (raw instanceof Uint8Array) {
        if (maximumBytes !== null && raw.byteLength > maximumBytes) {
            throw protocolError(
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.COMMAND_TOO_LARGE,
                'Futures testnet execution command exceeds 4096 UTF-8 bytes',
            );
        }
        bytes = raw;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        } catch {
            throw protocolError(
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENCODING,
                'Futures testnet execution message is not valid UTF-8 text',
            );
        }
    } else {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MESSAGE,
            'Futures testnet execution raw message must be UTF-8 text',
        );
    }

    if (maximumBytes !== null && bytes.byteLength > maximumBytes) {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.COMMAND_TOO_LARGE,
            'Futures testnet execution command exceeds 4096 UTF-8 bytes',
        );
    }
    return text;
};

const parseDuplicateAwareJsonObject = (text, { maximumDepth }) => {
    let cursor = 0;

    const fail = () => {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON,
            'Futures testnet execution message must be strict JSON',
        );
    };

    const skipWhitespace = () => {
        while (cursor < text.length
            && (text[cursor] === ' '
                || text[cursor] === '\n'
                || text[cursor] === '\r'
                || text[cursor] === '\t')) {
            cursor += 1;
        }
    };

    const parseString = () => {
        if (text[cursor] !== '"') fail();
        const start = cursor;
        cursor += 1;
        let closed = false;

        while (cursor < text.length) {
            const codeUnit = text.charCodeAt(cursor);
            const character = text[cursor];
            if (character === '"') {
                cursor += 1;
                closed = true;
                break;
            }
            if (codeUnit < 0x20) fail();
            if (character === '\\') {
                cursor += 1;
                const escape = text[cursor];
                if (escape === 'u') {
                    for (let offset = 1; offset <= 4; offset += 1) {
                        if (!/[0-9A-Fa-f]/.test(text[cursor + offset] ?? '')) fail();
                    }
                    cursor += 5;
                    continue;
                }
                if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) fail();
                cursor += 1;
                continue;
            }
            cursor += 1;
        }

        if (!closed) fail();
        let value;
        try {
            value = JSON.parse(text.slice(start, cursor));
        } catch {
            fail();
        }
        if (!hasOnlyUnicodeScalars(value)) fail();
        return value;
    };

    const parseInteger = () => {
        const start = cursor;
        if (text[cursor] === '-') cursor += 1;
        if (text[cursor] === '0') {
            cursor += 1;
            if (text[cursor] >= '0' && text[cursor] <= '9') fail();
        } else {
            if (text[cursor] < '1' || text[cursor] > '9') fail();
            while (text[cursor] >= '0' && text[cursor] <= '9') cursor += 1;
        }
        if (text[cursor] === '.' || text[cursor] === 'e' || text[cursor] === 'E') fail();
        const token = text.slice(start, cursor);
        let value;
        try {
            value = JSON.parse(token);
        } catch {
            fail();
        }
        return value;
    };

    const parseLiteral = (literal, value) => {
        if (text.slice(cursor, cursor + literal.length) !== literal) fail();
        cursor += literal.length;
        return value;
    };

    const parseValue = (depth) => {
        skipWhitespace();
        if (text[cursor] === '"') return parseString();
        if (text[cursor] === '{') return parseObject(depth + 1);
        if (text[cursor] === '[') fail();
        if (text[cursor] === 't') return parseLiteral('true', true);
        if (text[cursor] === 'f') return parseLiteral('false', false);
        if (text[cursor] === 'n') return parseLiteral('null', null);
        return parseInteger();
    };

    const parseObject = (depth) => {
        if (depth > maximumDepth || text[cursor] !== '{') fail();
        cursor += 1;
        skipWhitespace();
        const entries = [];
        const keys = new Set();
        if (text[cursor] === '}') {
            cursor += 1;
            return {};
        }

        while (cursor < text.length) {
            const key = parseString();
            if (keys.has(key)) fail();
            keys.add(key);
            skipWhitespace();
            if (text[cursor] !== ':') fail();
            cursor += 1;
            const value = parseValue(depth);
            entries.push([key, value]);
            skipWhitespace();
            if (text[cursor] === '}') {
                cursor += 1;
                return Object.fromEntries(entries);
            }
            if (text[cursor] !== ',') fail();
            cursor += 1;
            skipWhitespace();
        }
        fail();
        return null;
    };

    skipWhitespace();
    const result = parseObject(1);
    skipWhitespace();
    if (cursor !== text.length) fail();
    return result;
};

const readExactDataProperties = (value, expectedFields) => {
    let prototype;
    let ownKeys;
    try {
        prototype = Object.getPrototypeOf(value);
        ownKeys = Reflect.ownKeys(value);
    } catch {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MESSAGE,
            'Futures testnet execution message must be an ordinary plain object',
        );
    }

    if (value === null
        || typeof value !== 'object'
        || Array.isArray(value)
        || prototype !== Object.prototype) {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MESSAGE,
            'Futures testnet execution message must be an ordinary plain object',
        );
    }

    const expected = new Set(expectedFields);
    if (ownKeys.length !== expectedFields.length
        || ownKeys.some((key) => typeof key !== 'string' || !expected.has(key))) {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
            'Futures testnet execution message has missing or unsupported fields',
        );
    }

    const values = Object.create(null);
    for (const key of ownKeys) {
        let descriptor;
        try {
            descriptor = Object.getOwnPropertyDescriptor(value, key);
        } catch {
            descriptor = null;
        }
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) {
            throw protocolError(
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
                'Futures testnet execution fields must be enumerable data properties',
            );
        }
        values[key] = descriptor.value;
    }
    return values;
};

const requireLiteral = (condition, code, message) => {
    if (!condition) throw protocolError(code, message);
};

const validateAllowedSymbols = (allowedSymbols) => {
    if (!Array.isArray(allowedSymbols)
        || Object.getPrototypeOf(allowedSymbols) !== Array.prototype
        || allowedSymbols.length < 1
        || allowedSymbols.length > 16) {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ALLOWLIST,
            'Futures testnet execution requires an exact symbol allowlist',
        );
    }

    const ownKeys = Reflect.ownKeys(allowedSymbols);
    if (ownKeys.length !== allowedSymbols.length + 1 || !ownKeys.includes('length')) {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ALLOWLIST,
            'Futures testnet execution requires an exact symbol allowlist',
        );
    }

    const unique = new Set();
    for (let index = 0; index < allowedSymbols.length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(allowedSymbols, key);
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')
            || typeof descriptor.value !== 'string'
            || !SYMBOL_PATTERN.test(descriptor.value)
            || unique.has(descriptor.value)) {
            throw protocolError(
                FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ALLOWLIST,
                'Futures testnet execution requires an exact symbol allowlist',
            );
        }
        unique.add(descriptor.value);
    }
    return unique;
};

export const validateFuturesTestnetExecutionCommandObject = (
    value,
    { allowedSymbols } = {},
) => {
    const allowedSymbolSet = validateAllowedSymbols(allowedSymbols);
    const command = readExactDataProperties(value, COMMAND_FIELDS);

    requireLiteral(
        command.action === FUTURES_TESTNET_EXECUTION_ACTION,
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACTION,
        'Unsupported futures testnet execution action',
    );
    requireLiteral(
        command.version === FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_VERSION,
        'Futures testnet execution protocol version must be 1',
    );
    requireLiteral(
        typeof command.requestId === 'string' && REQUEST_ID_PATTERN.test(command.requestId),
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_REQUEST_ID,
        'Futures testnet execution requestId must be 32 lowercase hexadecimal characters',
    );
    requireLiteral(
        command.marketType === FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MARKET_TYPE,
        'Futures testnet execution marketType must be futures',
    );
    requireLiteral(
        command.environment === FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENVIRONMENT,
        'Futures testnet execution environment must be testnet',
    );
    requireLiteral(
        typeof command.symbol === 'string'
            && SYMBOL_PATTERN.test(command.symbol)
            && allowedSymbolSet.has(command.symbol),
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SYMBOL,
        'Futures testnet execution symbol must be exactly allowlisted',
    );
    requireLiteral(
        command.side === 'BUY' || command.side === 'SELL',
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SIDE,
        'Futures testnet execution side must be BUY or SELL',
    );
    requireLiteral(
        command.orderType === 'LIMIT',
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_TYPE,
        'Futures testnet execution orderType must be LIMIT',
    );
    try {
        parsePositiveExactDecimal(command.quantity);
    } catch (error) {
        if (!(error instanceof FuturesTestnetDecimalError)) throw error;
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_QUANTITY,
            'Futures testnet execution quantity must be an exact positive decimal string',
        );
    }
    try {
        parsePositiveExactDecimal(command.price);
    } catch (error) {
        if (!(error instanceof FuturesTestnetDecimalError)) throw error;
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_PRICE,
            'Futures testnet execution price must be an exact positive decimal string',
        );
    }
    requireLiteral(
        command.timeInForce === 'GTC',
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_TIME_IN_FORCE,
        'Futures testnet execution timeInForce must be GTC',
    );
    requireLiteral(
        command.positionSide === 'BOTH',
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_POSITION_SIDE,
        'Futures testnet execution positionSide must be BOTH',
    );
    requireLiteral(
        command.marginType === 'ISOLATED',
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MARGIN_TYPE,
        'Futures testnet execution marginType must be ISOLATED',
    );
    requireLiteral(
        typeof command.leverage === 'number'
            && isSafeIntegerValue(command.leverage)
            && command.leverage > 0,
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_LEVERAGE,
        'Futures testnet execution leverage must be a positive safe integer',
    );
    requireLiteral(
        command.reduceOnly === true,
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_REDUCE_ONLY,
        'Futures testnet execution reduceOnly must be true',
    );
    requireLiteral(
        command.workingType === null,
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_WORKING_TYPE,
        'Futures testnet execution workingType must be null',
    );
    requireLiteral(
        command.priceProtect === false,
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_PRICE_PROTECT,
        'Futures testnet execution priceProtect must be false',
    );
    requireLiteral(
        command.clientOrderId === `cc6-${command.requestId}`,
        FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_CLIENT_ORDER_ID,
        'Futures testnet execution clientOrderId must match the requestId',
    );

    return Object.freeze(Object.fromEntries(
        COMMAND_FIELDS.map((field) => [field, command[field]]),
    ));
};

export const parseFuturesTestnetExecutionCommand = (raw, options) => {
    const text = decodeRawUtf8(raw, {
        maximumBytes: FUTURES_TESTNET_EXECUTION_COMMAND_MAX_BYTES,
    });
    const value = parseDuplicateAwareJsonObject(text, { maximumDepth: 1 });
    return validateFuturesTestnetExecutionCommandObject(value, options);
};

const requireSafeTimestamp = (value) => (
    typeof value === 'number'
    && isSafeIntegerValue(value)
    && value >= 0
    && value <= MAX_SAFE_INTEGER
);

const normalizeOrder = (value) => {
    const order = readExactDataProperties(value, ORDER_FIELDS);
    let orderId;
    try {
        orderId = parseCanonicalUnsignedInteger(order.orderId, { maxDigits: 19 });
    } catch (error) {
        if (!(error instanceof FuturesTestnetDecimalError)) throw error;
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            'Futures testnet execution acknowledgement orderId is invalid',
        );
    }
    if (orderId <= 0n || orderId > MAX_SIGNED_INT64) {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            'Futures testnet execution acknowledgement orderId is out of range',
        );
    }
    if (!FUTURES_TESTNET_EXECUTION_ORDER_STATUSES.includes(order.status)) {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            'Futures testnet execution acknowledgement order status is invalid',
        );
    }
    try {
        parsePositiveExactDecimal(order.originalQuantity);
        parseNonNegativeExactDecimal(order.executedQuantity);
        parseNonNegativeExactDecimal(order.averagePrice);
    } catch (error) {
        if (!(error instanceof FuturesTestnetDecimalError)) throw error;
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            'Futures testnet execution acknowledgement order decimals are invalid',
        );
    }
    if (!requireSafeTimestamp(order.updateTime)) {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            'Futures testnet execution acknowledgement order timestamp is invalid',
        );
    }
    return Object.freeze(Object.fromEntries(
        ORDER_FIELDS.map((field) => [field, order[field]]),
    ));
};

const LOCAL_REJECTION_CODES = new Set([
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.PROTOCOL_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.DISABLED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.ENVIRONMENT_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.CREDENTIALS_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.SESSION_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.LEVERAGE_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.LIQUIDATION_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.DUPLICATE_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.INTERRUPTED_BEFORE_DISPATCH,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.BUSY,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.RATE_LIMITED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.AUTH_REJECTED,
]);

const EXCHANGE_REJECTION_CODES = new Set([
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.RATE_LIMITED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.AUTH_REJECTED,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
]);

const nonRejectedOrder = (order) => order === null || order.status !== 'REJECTED';

const validateStateMatrix = ({ acknowledgement, state, code, order }) => {
    const acks = FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS;
    const states = FUTURES_TESTNET_EXECUTION_STATES;
    const codes = FUTURES_TESTNET_EXECUTION_SAFE_CODES;

    if (state === states.LOCALLY_REJECTED) {
        return acknowledgement === acks.REJECTED
            && LOCAL_REJECTION_CODES.has(code)
            && order === null;
    }
    if (state === states.EXCHANGE_REJECTED) {
        return acknowledgement === acks.REJECTED
            && EXCHANGE_REJECTION_CODES.has(code)
            && order === null;
    }
    if (state === states.QUEUED || state === states.DISPATCHED) {
        return acknowledgement === acks.PENDING && code === codes.PENDING && order === null;
    }
    if (state === states.RECONCILING) {
        return acknowledgement === acks.PENDING
            && code === codes.PENDING
            && nonRejectedOrder(order);
    }
    if (state === states.EXCHANGE_ACCEPTED) {
        return acknowledgement === acks.ACCEPTED
            && code === codes.CONFIRMED
            && order !== null
            && order.status !== 'REJECTED';
    }
    if (state === states.CONFIRMED_OPEN) {
        return acknowledgement === acks.ACCEPTED
            && code === codes.CONFIRMED
            && order !== null
            && (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED');
    }
    if (state === states.CONFIRMED_FILLED) {
        return acknowledgement === acks.ACCEPTED
            && code === codes.CONFIRMED
            && order?.status === 'FILLED';
    }
    if (state === states.CONFIRMED_CANCELED) {
        return acknowledgement === acks.ACCEPTED
            && code === codes.CONFIRMED
            && order !== null
            && ['CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(order.status);
    }
    if (state === states.RESULT_UNKNOWN) {
        return acknowledgement === acks.UNKNOWN
            && code === codes.RESULT_UNKNOWN
            && nonRejectedOrder(order);
    }
    if (state === states.RECONCILIATION_UNAVAILABLE) {
        return acknowledgement === acks.UNKNOWN
            && code === codes.RECONCILIATION_UNAVAILABLE
            && nonRejectedOrder(order);
    }
    return false;
};

const normalizeAcknowledgementObject = (value) => {
    const message = readExactDataProperties(value, ACK_FIELDS);
    const codeMessage = FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES[message.code];
    let order = null;
    if (message.order !== null) order = normalizeOrder(message.order);

    const protocolRejection = message.code === FUTURES_TESTNET_EXECUTION_SAFE_CODES.PROTOCOL_REJECTED;
    const identitiesAreNull = message.requestId === null
        && message.symbol === null
        && message.clientOrderId === null;
    const identitiesAreValid = typeof message.requestId === 'string'
        && REQUEST_ID_PATTERN.test(message.requestId)
        && typeof message.symbol === 'string'
        && SYMBOL_PATTERN.test(message.symbol)
        && message.clientOrderId === `cc6-${message.requestId}`;

    if (message.channelId !== FUTURES_TESTNET_EXECUTION_CHANNEL_ID
        || message.action !== FUTURES_TESTNET_EXECUTION_ACK_ACTION
        || message.version !== FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION
        || message.marketType !== FUTURES_TESTNET_EXECUTION_MARKET_TYPE
        || message.environment !== FUTURES_TESTNET_EXECUTION_ENVIRONMENT
        || typeof message.revision !== 'string'
        || !REVISION_PATTERN.test(message.revision)
        || !requireSafeTimestamp(message.observedAt)
        || typeof codeMessage !== 'string'
        || message.message !== codeMessage
        || (protocolRejection ? !identitiesAreNull : !identitiesAreValid)
        || !validateStateMatrix({
            acknowledgement: message.acknowledgement,
            state: message.state,
            code: message.code,
            order,
        })) {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            'Futures testnet execution acknowledgement is invalid',
        );
    }

    return Object.freeze({
        channelId: message.channelId,
        action: message.action,
        version: message.version,
        revision: message.revision,
        requestId: message.requestId,
        marketType: message.marketType,
        environment: message.environment,
        symbol: message.symbol,
        clientOrderId: message.clientOrderId,
        acknowledgement: message.acknowledgement,
        state: message.state,
        code: message.code,
        message: message.message,
        observedAt: message.observedAt,
        order,
    });
};

export const parseFuturesTestnetExecutionAcknowledgement = (rawOrObject) => {
    if (typeof rawOrObject === 'string' || rawOrObject instanceof Uint8Array) {
        const text = decodeRawUtf8(rawOrObject);
        return normalizeAcknowledgementObject(
            parseDuplicateAwareJsonObject(text, { maximumDepth: 2 }),
        );
    }
    return normalizeAcknowledgementObject(rawOrObject);
};

export const createFuturesTestnetExecutionAcknowledgement = (value) => {
    const fields = readExactDataProperties(value, ACK_CREATE_FIELDS);
    const message = FUTURES_TESTNET_EXECUTION_SAFE_MESSAGES[fields.code];
    if (typeof message !== 'string') {
        throw protocolError(
            FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACKNOWLEDGEMENT,
            'Futures testnet execution acknowledgement code is invalid',
        );
    }
    return normalizeAcknowledgementObject({
        channelId: fields.channelId,
        action: fields.action,
        version: fields.version,
        revision: fields.revision,
        requestId: fields.requestId,
        marketType: fields.marketType,
        environment: fields.environment,
        symbol: fields.symbol,
        clientOrderId: fields.clientOrderId,
        acknowledgement: fields.acknowledgement,
        state: fields.state,
        code: fields.code,
        message,
        observedAt: fields.observedAt,
        order: fields.order,
    });
};

export const createFuturesTestnetExecutionProtocolRejection = ({
    revision,
    observedAt,
} = {}) => createFuturesTestnetExecutionAcknowledgement({
    channelId: FUTURES_TESTNET_EXECUTION_CHANNEL_ID,
    action: FUTURES_TESTNET_EXECUTION_ACK_ACTION,
    version: FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
    revision,
    requestId: null,
    marketType: FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
    environment: FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
    symbol: null,
    clientOrderId: null,
    acknowledgement: FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.REJECTED,
    state: FUTURES_TESTNET_EXECUTION_STATES.LOCALLY_REJECTED,
    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.PROTOCOL_REJECTED,
    observedAt,
    order: null,
});
