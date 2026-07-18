import {
    FuturesProductionDecimalError,
    compareExactDecimals,
    parseNonNegativeExactDecimal,
    parsePositiveExactDecimal,
    parseSignedExactDecimal,
} from './futures-production-execution-decimal.js';
import {
    FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS,
    FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
} from './futures-production-execution-config.js';

export const FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION = 3;
export const FUTURES_PRODUCTION_EXECUTION_CHANNEL_ID = 'futures-production-execution';
export const FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE = 'futures';
export const FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT = 'production';
export const FUTURES_PRODUCTION_EXECUTION_COMMAND_MAX_BYTES = 4096;
export const FUTURES_PRODUCTION_EXECUTION_STATUS_MAX_BYTES = 2 * 1024 * 1024;

export const FUTURES_PRODUCTION_EXECUTION_ACTIONS = Object.freeze({
    SUBSCRIBE_STATUS: 'futures.production.subscribeStatus',
    UNSUBSCRIBE_STATUS: 'futures.production.unsubscribeStatus',
    REFRESH_PORTFOLIO: 'futures.production.refreshPortfolio',
    PREPARE_MARGIN_ADJUSTMENT_INTENT: 'futures.production.prepareMarginAdjustmentIntent',
    ADJUST_ISOLATED_MARGIN: 'futures.production.adjustIsolatedMargin',
    PREPARE_ORDER_AMENDMENT_INTENT: 'futures.production.prepareOrderAmendmentIntent',
    AMEND_ORDER: 'futures.production.amendOrder',
    PREPARE_ORDER_INTENT: 'futures.production.prepareOrderIntent',
    PLACE_ORDER: 'futures.production.placeOrder',
    PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT: (
        'futures.production.prepareCancelAllOpenOrdersIntent'
    ),
    CANCEL_ALL_OPEN_ORDERS: 'futures.production.cancelAllOpenOrders',
    PREPARE_CLOSE_POSITIONS_INTENT: 'futures.production.prepareClosePositionsIntent',
    CLOSE_POSITIONS: 'futures.production.closePositions',
    PREPARE_ENGAGE_KILL_SWITCH_INTENT: (
        'futures.production.prepareEngageKillSwitchIntent'
    ),
    ENGAGE_KILL_SWITCH: 'futures.production.engageKillSwitch',
    PREPARE_DISENGAGE_KILL_SWITCH_INTENT: (
        'futures.production.prepareDisengageKillSwitchIntent'
    ),
    DISENGAGE_KILL_SWITCH: 'futures.production.disengageKillSwitch',
    STATUS: 'futures.production.status',
});

export const FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS = Object.freeze({
    ORDER: 'order',
    MARGIN_ADJUSTMENT: 'margin_adjustment',
    ORDER_AMENDMENT: 'order_amendment',
    CANCEL_ALL_OPEN_ORDERS: 'cancel_all_open_orders',
    CLOSE_POSITIONS: 'close_positions',
    ENGAGE_KILL_SWITCH: 'engage_kill_switch',
    DISENGAGE_KILL_SWITCH: 'disengage_kill_switch',
});

export const FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS = Object.freeze({
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER]: 'PLACE REAL FUTURES ORDER',
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN]: (
        'ADJUST REAL FUTURES ISOLATED MARGIN'
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER]: 'MOVE REAL FUTURES ORDER',
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS]: (
        'CANCEL ALL REAL FUTURES ORDERS'
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS]: (
        'CLOSE ALL REAL FUTURES POSITIONS'
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH]: (
        'ENGAGE REAL FUTURES KILL SWITCH'
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH]: (
        'ARM LIVE FUTURES HEDGE ISOLATED 2X 10 USDT 50 USDT DAILY'
    ),
});

export const FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS = Object.freeze({
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    UNKNOWN: 'unknown',
    PARTIAL: 'partial',
});

export const FUTURES_PRODUCTION_EXECUTION_STATES = Object.freeze({
    LOCALLY_REJECTED: 'locally_rejected',
    INTENT_ISSUED: 'intent_issued',
    QUEUED: 'queued',
    DISPATCHED: 'dispatched',
    EXCHANGE_REJECTED: 'exchange_rejected',
    EXCHANGE_ACCEPTED: 'exchange_accepted',
    RECONCILING: 'reconciling',
    RESULT_UNKNOWN: 'result_unknown',
    CONFIRMED_OPEN: 'confirmed_open',
    CONFIRMED_FILLED: 'confirmed_filled',
    CONFIRMED_CANCELED: 'confirmed_canceled',
    CONFIRMED_CLOSED: 'confirmed_closed',
    CONFIRMED_MARGIN_ADJUSTED: 'confirmed_margin_adjusted',
    CONFIRMED_ORDER_AMENDED: 'confirmed_order_amended',
    KILL_SWITCH_ENGAGED: 'kill_switch_engaged',
    KILL_SWITCH_DISENGAGED: 'kill_switch_disengaged',
    PARTIAL: 'partial',
    RECONCILIATION_UNAVAILABLE: 'reconciliation_unavailable',
    RECOVERY_REQUIRED: 'recovery_required',
    RECOVERING: 'recovering',
});

export const FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES = Object.freeze({
    INVALID_ENCODING: 'FUTURES_PRODUCTION_EXECUTION_INVALID_ENCODING',
    MESSAGE_TOO_LARGE: 'FUTURES_PRODUCTION_EXECUTION_MESSAGE_TOO_LARGE',
    INVALID_JSON: 'FUTURES_PRODUCTION_EXECUTION_INVALID_JSON',
    INVALID_MESSAGE: 'FUTURES_PRODUCTION_EXECUTION_INVALID_MESSAGE',
    INVALID_FIELDS: 'FUTURES_PRODUCTION_EXECUTION_INVALID_FIELDS',
    INVALID_ACTION: 'FUTURES_PRODUCTION_EXECUTION_INVALID_ACTION',
    INVALID_VERSION: 'FUTURES_PRODUCTION_EXECUTION_INVALID_VERSION',
    INVALID_REVISION: 'FUTURES_PRODUCTION_EXECUTION_INVALID_REVISION',
    INVALID_IDENTITY: 'FUTURES_PRODUCTION_EXECUTION_INVALID_IDENTITY',
    INVALID_ORDER_DRAFT: 'FUTURES_PRODUCTION_EXECUTION_INVALID_ORDER_DRAFT',
    INVALID_INTENT: 'FUTURES_PRODUCTION_EXECUTION_INVALID_INTENT',
    INVALID_CONFIRMATION: 'FUTURES_PRODUCTION_EXECUTION_INVALID_CONFIRMATION',
    INVALID_STATUS: 'FUTURES_PRODUCTION_EXECUTION_INVALID_STATUS',
});

export class FuturesProductionExecutionProtocolError extends Error {
    constructor(code) {
        super('Production futures execution message was rejected');
        this.name = 'FuturesProductionExecutionProtocolError';
        this.code = code;
    }
}

const BASE_FIELDS = Object.freeze([
    'action',
    'version',
    'revision',
    'marketType',
    'environment',
    'accountFingerprint',
]);
const PREPARE_ORDER_FIELDS = Object.freeze([
    ...BASE_FIELDS,
    'symbol',
    'side',
    'quantity',
    'price',
    'positionSide',
    'positionEffect',
]);
const PREPARE_MARGIN_FIELDS = Object.freeze([
    ...BASE_FIELDS,
    'symbol',
    'positionSide',
    'marginAction',
    'amount',
]);
const PREPARE_AMEND_FIELDS = Object.freeze([
    ...BASE_FIELDS,
    'symbol',
    'positionSide',
    'clientOrderId',
    'price',
]);
const FINAL_COMMAND_FIELDS = Object.freeze([
    'action',
    'version',
    'revision',
    'requestId',
    'marketType',
    'environment',
    'accountFingerprint',
    'confirmation',
]);
const STATUS_FIELDS = Object.freeze([
    'channelId',
    'action',
    'version',
    'revision',
    'marketType',
    'environment',
    'mode',
    'liveAuthorized',
    'configured',
    'account',
    'caps',
    'killSwitch',
    'capabilities',
    'intent',
    'attempt',
    'reconciliation',
    'recovery',
    'portfolio',
]);
const ACCOUNT_FIELDS = Object.freeze(['alias', 'fingerprint']);
const CAPS_FIELDS = Object.freeze([
    'allowedSymbols',
    'symbolConfigurations',
    'maxLeverage',
    'maxOrderNotionalUsdt',
    'maxDailyNotionalUsdt',
    'minAvailableBalanceUsdt',
    'minLiquidationDistanceBps',
    'dailyUsedNotionalUsdt',
    'utcDay',
]);
const SYMBOL_CONFIGURATION_FIELDS = Object.freeze([
    'symbol',
    'marginType',
    'leverage',
    'isAutoAddMargin',
]);
const KILL_SWITCH_FIELDS = Object.freeze(['engaged', 'policy']);
const CAPABILITY_FIELDS = Object.freeze([
    'placeOrder',
    'adjustMargin',
    'amendOrder',
    'cancelAllOpenOrders',
    'closePositions',
    'engageKillSwitch',
    'disengageKillSwitch',
    'code',
]);
const INTENT_FIELDS = Object.freeze(['requestId', 'kind', 'revision', 'expiresAt']);
const ATTEMPT_FIELDS = Object.freeze([
    'requestId',
    'kind',
    'revision',
    'acknowledgement',
    'state',
    'code',
    'observedAt',
    'items',
]);
const ATTEMPT_ITEM_FIELDS = Object.freeze(['symbol', 'outcome', 'code']);
const RECONCILIATION_FIELDS = Object.freeze(['required', 'state', 'nextAttemptAt']);
const RECOVERY_FIELDS = Object.freeze(['required', 'state', 'code']);
const PORTFOLIO_FIELDS = Object.freeze([
    'state',
    'observedAt',
    'availableBalanceUsdt',
    'syncState',
    'syncCode',
    'positions',
    'openOrders',
]);
const POSITION_FIELDS = Object.freeze([
    'symbol',
    'positionSide',
    'quantity',
    'entryPrice',
    'markPrice',
    'notionalUsdt',
    'unrealizedPnlUsdt',
    'isolatedMarginUsdt',
    'liquidationPrice',
    'leverage',
    'marginType',
]);
const OPEN_ORDER_FIELDS = Object.freeze([
    'symbol',
    'orderKind',
    'orderId',
    'clientOrderId',
    'side',
    'positionSide',
    'positionEffect',
    'price',
    'originalQuantity',
    'executedQuantity',
    'status',
    'type',
    'timeInForce',
    'isAppOwned',
    'updateTime',
    'syncState',
]);

const PREPARE_ACTIONS = new Set([
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ENGAGE_KILL_SWITCH_INTENT,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_DISENGAGE_KILL_SWITCH_INTENT,
]);
const SESSION_ACTIONS = new Set([
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.UNSUBSCRIBE_STATUS,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO,
    ...PREPARE_ACTIONS,
]);
const FINAL_ACTIONS = new Set(Object.keys(FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS));
const ALL_COMMAND_ACTIONS = new Set([...SESSION_ACTIONS, ...FINAL_ACTIONS]);
const INTENT_KIND_SET = new Set(Object.values(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS));
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;
const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/;
const EXCHANGE_SYMBOL_PATTERN = /^[\p{Lu}\p{Lt}\p{Lo}\p{N}]{2,64}(?:_[0-9]{6})?$/u;
const MAX_EXCHANGE_SYMBOL_BYTES = 256;
const ORDER_ID_PATTERN = /^[1-9][0-9]{0,18}$/;
const CLIENT_ORDER_ID_PATTERN = /^[.A-Z:/a-z0-9_-]{1,36}$/;
const OWNED_CLIENT_ORDER_ID_PATTERN = /^cc7-[0-9a-f]{32}$/;
const ORDER_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const TIME_IN_FORCE_PATTERN = /^(?:GTC|IOC|FOK|GTX|GTD|GTE_GTC|RPI)$/;
const SAFE_CODE_PATTERN = /^FUTURES_PRODUCTION_[A-Z0-9_]{1,64}$/;
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SAFE_INTEGER = 9007199254740991;
const MAX_JSON_NODES = 40_000;
const MAX_JSON_STRING_BYTES = 512;
const MAX_PORTFOLIO_ITEMS = 2_048;

const fail = (code) => {
    throw new FuturesProductionExecutionProtocolError(code);
};

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

const decodeRawUtf8 = (raw, maximumBytes) => {
    let bytes;
    let text;
    if (typeof raw === 'string') {
        if (raw.length > maximumBytes || !hasOnlyUnicodeScalars(raw)) {
            fail(raw.length > maximumBytes
                ? FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE
                : FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENCODING);
        }
        bytes = new TextEncoder().encode(raw);
        text = raw;
    } else if (raw instanceof Uint8Array) {
        if (raw.byteLength > maximumBytes) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE);
        }
        bytes = raw;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        } catch {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ENCODING);
        }
    } else {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MESSAGE);
    }
    if (bytes.byteLength > maximumBytes) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.MESSAGE_TOO_LARGE);
    }
    return text;
};

const parseDuplicateAwareJson = (text, { maximumDepth = 6 } = {}) => {
    let cursor = 0;
    let nodeCount = 0;
    const invalid = () => fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_JSON);
    const countNode = () => {
        nodeCount += 1;
        if (nodeCount > MAX_JSON_NODES) invalid();
    };
    const skipWhitespace = () => {
        while ([' ', '\n', '\r', '\t'].includes(text[cursor])) cursor += 1;
    };
    const parseString = () => {
        if (text[cursor] !== '"') invalid();
        const start = cursor;
        cursor += 1;
        let closed = false;
        while (cursor < text.length) {
            const character = text[cursor];
            const codeUnit = text.charCodeAt(cursor);
            if (character === '"') {
                cursor += 1;
                closed = true;
                break;
            }
            if (codeUnit < 0x20) invalid();
            if (character === '\\') {
                cursor += 1;
                const escape = text[cursor];
                if (escape === 'u') {
                    for (let offset = 1; offset <= 4; offset += 1) {
                        if (!/[0-9A-Fa-f]/.test(text[cursor + offset] ?? '')) invalid();
                    }
                    cursor += 5;
                    continue;
                }
                if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) invalid();
                cursor += 1;
                continue;
            }
            cursor += 1;
        }
        if (!closed) invalid();
        let value;
        try {
            value = JSON.parse(text.slice(start, cursor));
        } catch {
            invalid();
        }
        if (!hasOnlyUnicodeScalars(value)
            || new TextEncoder().encode(value).byteLength > MAX_JSON_STRING_BYTES) invalid();
        return value;
    };
    const parseInteger = () => {
        const start = cursor;
        if (text[cursor] === '-') cursor += 1;
        if (text[cursor] === '0') {
            cursor += 1;
            if (/[0-9]/.test(text[cursor] ?? '')) invalid();
        } else {
            if (!/[1-9]/.test(text[cursor] ?? '')) invalid();
            while (/[0-9]/.test(text[cursor] ?? '')) cursor += 1;
        }
        if (['.', 'e', 'E'].includes(text[cursor])) invalid();
        const token = text.slice(start, cursor);
        const value = Number(token);
        if (!Number.isSafeInteger(value) || Object.is(value, -0)) invalid();
        return value;
    };
    const parseLiteral = (literal, value) => {
        if (text.slice(cursor, cursor + literal.length) !== literal) invalid();
        cursor += literal.length;
        return value;
    };
    const parseValue = (depth) => {
        countNode();
        skipWhitespace();
        if (text[cursor] === '"') return parseString();
        if (text[cursor] === '{') return parseObject(depth + 1);
        if (text[cursor] === '[') return parseArray(depth + 1);
        if (text[cursor] === 't') return parseLiteral('true', true);
        if (text[cursor] === 'f') return parseLiteral('false', false);
        if (text[cursor] === 'n') return parseLiteral('null', null);
        return parseInteger();
    };
    const parseObject = (depth) => {
        if (depth > maximumDepth || text[cursor] !== '{') invalid();
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
            if (keys.has(key)) invalid();
            keys.add(key);
            skipWhitespace();
            if (text[cursor] !== ':') invalid();
            cursor += 1;
            entries.push([key, parseValue(depth)]);
            skipWhitespace();
            if (text[cursor] === '}') {
                cursor += 1;
                return Object.fromEntries(entries);
            }
            if (text[cursor] !== ',') invalid();
            cursor += 1;
            skipWhitespace();
        }
        invalid();
        return null;
    };
    const parseArray = (depth) => {
        if (depth > maximumDepth || text[cursor] !== '[') invalid();
        cursor += 1;
        skipWhitespace();
        const values = [];
        if (text[cursor] === ']') {
            cursor += 1;
            return values;
        }
        while (cursor < text.length) {
            if (values.length >= 16) invalid();
            values.push(parseValue(depth));
            skipWhitespace();
            if (text[cursor] === ']') {
                cursor += 1;
                return values;
            }
            if (text[cursor] !== ',') invalid();
            cursor += 1;
            skipWhitespace();
        }
        invalid();
        return null;
    };
    skipWhitespace();
    countNode();
    const value = parseObject(1);
    skipWhitespace();
    if (cursor !== text.length) invalid();
    return value;
};

const isPlainObject = (value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
);

const readExactDataProperties = (value, expectedFields, code) => {
    if (!isPlainObject(value)) fail(code);
    let keys;
    try {
        keys = Reflect.ownKeys(value);
    } catch {
        fail(code);
    }
    const expected = new Set(expectedFields);
    if (keys.length !== expectedFields.length
        || keys.some((key) => typeof key !== 'string' || !expected.has(key))) fail(code);
    const result = Object.create(null);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) fail(code);
        result[key] = descriptor.value;
    }
    return result;
};

const requireRevision = (value, code = FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_REVISION) => {
    if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) fail(code);
    return value;
};

const requireTimestamp = (value, code) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_INTEGER) fail(code);
    return value;
};

const requireFingerprint = (value, code) => {
    if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) fail(code);
    return value;
};

const normalizeAllowedSymbols = (allowedSymbols) => {
    if (allowedSymbols === undefined) return null;
    if (!Array.isArray(allowedSymbols)
        || Object.getPrototypeOf(allowedSymbols) !== Array.prototype
        || allowedSymbols.length < 1
        || allowedSymbols.length > 16) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_IDENTITY);
    }
    const unique = new Set();
    for (const symbol of allowedSymbols) {
        if (typeof symbol !== 'string' || !SYMBOL_PATTERN.test(symbol) || unique.has(symbol)) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_IDENTITY);
        }
        unique.add(symbol);
    }
    return unique;
};

const normalizeCommonCommand = (command, { accountFingerprint } = {}) => {
    if (command.version !== FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_VERSION);
    }
    requireRevision(command.revision);
    requireFingerprint(
        command.accountFingerprint,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_IDENTITY,
    );
    if (accountFingerprint !== undefined && command.accountFingerprint !== accountFingerprint) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_IDENTITY);
    }
    if (command.marketType !== FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE
        || command.environment !== FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_IDENTITY);
    }
};

const freezeFields = (fields, value) => Object.freeze(Object.fromEntries(
    fields.map((field) => [field, value[field]]),
));

export const readFuturesProductionExecutionAction = (raw) => {
    const value = parseDuplicateAwareJson(decodeRawUtf8(
        raw,
        FUTURES_PRODUCTION_EXECUTION_COMMAND_MAX_BYTES,
    ), { maximumDepth: 3 });
    const descriptor = Object.getOwnPropertyDescriptor(value, 'action');
    return descriptor?.enumerable === true && typeof descriptor.value === 'string'
        ? descriptor.value
        : null;
};

export const isPotentialFuturesProductionExecutionFrame = (raw) => {
    if (typeof raw !== 'string') return false;
    const decodedEscapes = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_match, digits) => (
        String.fromCharCode(Number.parseInt(digits, 16))
    ));
    return raw.includes('futures.production.')
        || decodedEscapes.includes('futures.production.');
};

export const validateFuturesProductionExecutionCommandObject = (value, options = {}) => {
    if (!isPlainObject(value)) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_MESSAGE);
    }
    const actionDescriptor = Object.getOwnPropertyDescriptor(value, 'action');
    const action = actionDescriptor?.enumerable === true && Object.hasOwn(actionDescriptor, 'value')
        ? actionDescriptor.value
        : null;
    if (typeof action !== 'string' || !ALL_COMMAND_ACTIONS.has(action)) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ACTION);
    }

    const fields = FINAL_ACTIONS.has(action)
        ? FINAL_COMMAND_FIELDS
        : action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT
            ? PREPARE_ORDER_FIELDS
            : action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT
                ? PREPARE_MARGIN_FIELDS
                : action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT
                    ? PREPARE_AMEND_FIELDS
            : BASE_FIELDS;
    const command = readExactDataProperties(
        value,
        fields,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
    );
    normalizeCommonCommand(command, options);

    if (action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT) {
        const allowedSymbols = normalizeAllowedSymbols(options.allowedSymbols);
        if (typeof command.symbol !== 'string'
            || !SYMBOL_PATTERN.test(command.symbol)
            || (allowedSymbols !== null && !allowedSymbols.has(command.symbol))
            || !['BUY', 'SELL'].includes(command.side)
            || !['LONG', 'SHORT'].includes(command.positionSide)
            || !['ENTRY', 'EXIT'].includes(command.positionEffect)
            || (command.positionSide === 'LONG'
                && command.side !== (command.positionEffect === 'ENTRY' ? 'BUY' : 'SELL'))
            || (command.positionSide === 'SHORT'
                && command.side !== (command.positionEffect === 'ENTRY' ? 'SELL' : 'BUY'))) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT);
        }
        try {
            parsePositiveExactDecimal(command.quantity);
            parsePositiveExactDecimal(command.price);
        } catch (error) {
            if (!(error instanceof FuturesProductionDecimalError)) throw error;
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT);
        }
    }

    if (action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT) {
        const allowedSymbols = normalizeAllowedSymbols(options.allowedSymbols);
        if (typeof command.symbol !== 'string'
            || !SYMBOL_PATTERN.test(command.symbol)
            || (allowedSymbols !== null && !allowedSymbols.has(command.symbol))
            || !['LONG', 'SHORT'].includes(command.positionSide)
            || !['ADD', 'REDUCE'].includes(command.marginAction)) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT);
        }
        try {
            parsePositiveExactDecimal(command.amount);
        } catch (error) {
            if (!(error instanceof FuturesProductionDecimalError)) throw error;
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT);
        }
    }

    if (action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT) {
        const allowedSymbols = normalizeAllowedSymbols(options.allowedSymbols);
        if (typeof command.symbol !== 'string'
            || !SYMBOL_PATTERN.test(command.symbol)
            || (allowedSymbols !== null && !allowedSymbols.has(command.symbol))
            || !['LONG', 'SHORT'].includes(command.positionSide)
            || typeof command.clientOrderId !== 'string'
            || !CLIENT_ORDER_ID_PATTERN.test(command.clientOrderId)) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT);
        }
        try {
            parsePositiveExactDecimal(command.price);
        } catch (error) {
            if (!(error instanceof FuturesProductionDecimalError)) throw error;
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_ORDER_DRAFT);
        }
    }

    if (FINAL_ACTIONS.has(action)) {
        if (typeof command.requestId !== 'string' || !REQUEST_ID_PATTERN.test(command.requestId)) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_INTENT);
        }
        if (command.confirmation !== FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[action]) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_CONFIRMATION);
        }
    }
    return freezeFields(fields, command);
};

export const parseFuturesProductionExecutionCommand = (raw, options) => (
    validateFuturesProductionExecutionCommandObject(
        parseDuplicateAwareJson(decodeRawUtf8(
            raw,
            FUTURES_PRODUCTION_EXECUTION_COMMAND_MAX_BYTES,
        ), { maximumDepth: 3 }),
        options,
    )
);

export const parseFuturesProductionExecutionRequest = parseFuturesProductionExecutionCommand;

export const compareFuturesProductionExecutionRevisions = (left, right) => {
    requireRevision(left, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    requireRevision(right, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    if (left.length !== right.length) return left.length < right.length ? -1 : 1;
    if (left === right) return 0;
    return left < right ? -1 : 1;
};

const normalizeAccount = (value) => {
    if (value === null) return null;
    const account = readExactDataProperties(
        value,
        ACCOUNT_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    if (typeof account.alias !== 'string'
        || Buffer.byteLength(account.alias, 'utf8') > 64
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(account.alias)) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    requireFingerprint(
        account.fingerprint,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    return Object.freeze({ alias: account.alias, fingerprint: account.fingerprint });
};

const isCanonicalUtcDay = (value) => {
    if (typeof value !== 'string' || !UTC_DAY_PATTERN.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const normalizeCapSymbols = (value) => {
    if (!Array.isArray(value)
        || Object.getPrototypeOf(value) !== Array.prototype
        || value.length < 1
        || value.length > 16) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    const symbols = [];
    const unique = new Set();
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')
            || typeof descriptor.value !== 'string'
            || !SYMBOL_PATTERN.test(descriptor.value)
            || unique.has(descriptor.value)) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        }
        unique.add(descriptor.value);
        symbols.push(descriptor.value);
    }
    if (Reflect.ownKeys(value).length !== symbols.length + 1) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    return Object.freeze(symbols);
};

const normalizeSymbolConfigurations = (value, allowedSymbols) => {
    if (!Array.isArray(value)
        || Object.getPrototypeOf(value) !== Array.prototype
        || value.length > 16) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    const allowed = new Set(allowedSymbols);
    const unique = new Set();
    const configurations = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        }
        const configuration = readExactDataProperties(
            descriptor.value,
            SYMBOL_CONFIGURATION_FIELDS,
            FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
        );
        if (typeof configuration.symbol !== 'string'
            || !allowed.has(configuration.symbol)
            || unique.has(configuration.symbol)
            || !['ISOLATED', 'CROSSED'].includes(configuration.marginType)
            || !Number.isSafeInteger(configuration.leverage)
            || configuration.leverage < 1
            || configuration.leverage > 125
            || typeof configuration.isAutoAddMargin !== 'boolean') {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        }
        unique.add(configuration.symbol);
        configurations.push(freezeFields(SYMBOL_CONFIGURATION_FIELDS, configuration));
    }
    if (Reflect.ownKeys(value).length !== configurations.length + 1) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    return Object.freeze(configurations);
};

const normalizeCaps = (value) => {
    if (value === null) return null;
    const caps = readExactDataProperties(
        value,
        CAPS_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    const allowedSymbols = normalizeCapSymbols(caps.allowedSymbols);
    const symbolConfigurations = normalizeSymbolConfigurations(
        caps.symbolConfigurations,
        allowedSymbols,
    );
    if (!Number.isSafeInteger(caps.maxLeverage)
        || caps.maxLeverage !== FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS.maxLeverage
        || typeof caps.minLiquidationDistanceBps !== 'string'
        || !/^[1-9][0-9]{3,4}$/.test(caps.minLiquidationDistanceBps)
        || BigInt(caps.minLiquidationDistanceBps) < 1000n
        || BigInt(caps.minLiquidationDistanceBps) > 10000n
        || !isCanonicalUtcDay(caps.utcDay)) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    try {
        const order = parsePositiveExactDecimal(caps.maxOrderNotionalUsdt);
        const daily = parsePositiveExactDecimal(caps.maxDailyNotionalUsdt);
        parsePositiveExactDecimal(caps.minAvailableBalanceUsdt);
        const used = parseNonNegativeExactDecimal(caps.dailyUsedNotionalUsdt);
        if (compareExactDecimals(
            order,
            parsePositiveExactDecimal(
                FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS.maxOrderNotionalUsdt,
            ),
        ) > 0
            || compareExactDecimals(
                daily,
                parsePositiveExactDecimal(
                    FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS.maxDailyNotionalUsdt,
                ),
            ) > 0
            || compareExactDecimals(used, daily) > 0
            || compareExactDecimals(order, daily) > 0) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        }
    } catch (error) {
        if (error instanceof FuturesProductionExecutionProtocolError) throw error;
        if (!(error instanceof FuturesProductionDecimalError)) throw error;
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    return freezeFields(CAPS_FIELDS, { ...caps, allowedSymbols, symbolConfigurations });
};

const normalizeKillSwitch = (value) => {
    const killSwitch = readExactDataProperties(
        value,
        KILL_SWITCH_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    if (typeof killSwitch.engaged !== 'boolean'
        || killSwitch.policy !== FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    return Object.freeze({
        engaged: killSwitch.engaged,
        policy: killSwitch.policy,
    });
};

const normalizeCapabilities = (value) => {
    const capabilities = readExactDataProperties(
        value,
        CAPABILITY_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    if (CAPABILITY_FIELDS.slice(0, -1).some((field) => typeof capabilities[field] !== 'boolean')
        || typeof capabilities.code !== 'string'
        || !SAFE_CODE_PATTERN.test(capabilities.code)) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    return freezeFields(CAPABILITY_FIELDS, capabilities);
};

const normalizeIntent = (value) => {
    if (value === null) return null;
    const intent = readExactDataProperties(
        value,
        INTENT_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    if (typeof intent.requestId !== 'string'
        || !REQUEST_ID_PATTERN.test(intent.requestId)
        || !INTENT_KIND_SET.has(intent.kind)) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    requireRevision(intent.revision, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    requireTimestamp(intent.expiresAt, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    return freezeFields(INTENT_FIELDS, intent);
};

const normalizeAttemptItems = (value) => {
    if (!Array.isArray(value)
        || Object.getPrototypeOf(value) !== Array.prototype
        || value.length > 16) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    const outcomes = new Set([
        'pending', 'accepted', 'rejected', 'unknown', 'open', 'canceled', 'closed', 'adjusted',
        'amended',
    ]);
    const symbols = new Set();
    return Object.freeze(value.map((item) => {
        const fields = readExactDataProperties(
            item,
            ATTEMPT_ITEM_FIELDS,
            FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
        );
        if ((fields.symbol !== null
                && (typeof fields.symbol !== 'string'
                    || !SYMBOL_PATTERN.test(fields.symbol)
                    || symbols.has(fields.symbol)))
            || !outcomes.has(fields.outcome)
            || typeof fields.code !== 'string'
            || !SAFE_CODE_PATTERN.test(fields.code)) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        }
        if (fields.symbol !== null) symbols.add(fields.symbol);
        return freezeFields(ATTEMPT_ITEM_FIELDS, fields);
    }));
};

const validateAttemptMatrix = (acknowledgement, state) => {
    const acks = FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS;
    const states = FUTURES_PRODUCTION_EXECUTION_STATES;
    const pendingStates = new Set([
        states.INTENT_ISSUED,
        states.QUEUED,
        states.DISPATCHED,
        states.RECONCILING,
        states.RECOVERING,
    ]);
    const acceptedStates = new Set([
        states.EXCHANGE_ACCEPTED,
        states.CONFIRMED_OPEN,
        states.CONFIRMED_FILLED,
        states.CONFIRMED_CANCELED,
        states.CONFIRMED_CLOSED,
        states.CONFIRMED_MARGIN_ADJUSTED,
        states.CONFIRMED_ORDER_AMENDED,
        states.KILL_SWITCH_ENGAGED,
        states.KILL_SWITCH_DISENGAGED,
    ]);
    const unknownStates = new Set([
        states.RESULT_UNKNOWN,
        states.RECONCILIATION_UNAVAILABLE,
        states.RECOVERY_REQUIRED,
    ]);
    return (acknowledgement === acks.PENDING && pendingStates.has(state))
        || (acknowledgement === acks.ACCEPTED && acceptedStates.has(state))
        || (acknowledgement === acks.REJECTED
            && [states.LOCALLY_REJECTED, states.EXCHANGE_REJECTED].includes(state))
        || (acknowledgement === acks.UNKNOWN && unknownStates.has(state))
        || (acknowledgement === acks.PARTIAL && state === states.PARTIAL);
};

const normalizeAttempt = (value) => {
    if (value === null) return null;
    const attempt = readExactDataProperties(
        value,
        ATTEMPT_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    if (typeof attempt.requestId !== 'string'
        || !REQUEST_ID_PATTERN.test(attempt.requestId)
        || !INTENT_KIND_SET.has(attempt.kind)
        || typeof attempt.code !== 'string'
        || !SAFE_CODE_PATTERN.test(attempt.code)
        || !validateAttemptMatrix(attempt.acknowledgement, attempt.state)) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    requireRevision(attempt.revision, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    requireTimestamp(attempt.observedAt, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    return Object.freeze({
        ...freezeFields(ATTEMPT_FIELDS.slice(0, -1), attempt),
        items: normalizeAttemptItems(attempt.items),
    });
};

const normalizeReconciliation = (value) => {
    if (value === null) return null;
    const reconciliation = readExactDataProperties(
        value,
        RECONCILIATION_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    const states = new Set(['idle', 'scheduled', 'querying', 'confirmed', 'unknown', 'unavailable']);
    if (typeof reconciliation.required !== 'boolean'
        || !states.has(reconciliation.state)
        || (reconciliation.nextAttemptAt !== null
            && (!Number.isSafeInteger(reconciliation.nextAttemptAt)
                || reconciliation.nextAttemptAt < 0))) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    if (reconciliation.required === false && reconciliation.nextAttemptAt !== null) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    return freezeFields(RECONCILIATION_FIELDS, reconciliation);
};

const normalizeRecovery = (value) => {
    const recovery = readExactDataProperties(
        value,
        RECOVERY_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    if (typeof recovery.required !== 'boolean'
        || !['healthy', 'blocked', 'recovering'].includes(recovery.state)
        || typeof recovery.code !== 'string'
        || !SAFE_CODE_PATTERN.test(recovery.code)
        || (recovery.required === false && recovery.state !== 'healthy')
        || (recovery.required === true && recovery.state === 'healthy')) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    return freezeFields(RECOVERY_FIELDS, recovery);
};

const normalizeDensePortfolioArray = (value, normalizeItem) => {
    if (!Array.isArray(value)
        || Object.getPrototypeOf(value) !== Array.prototype
        || value.length > MAX_PORTFOLIO_ITEMS
        || Reflect.ownKeys(value).length !== value.length + 1) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) {
            fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
        }
        items.push(normalizeItem(descriptor.value));
    }
    return Object.freeze(items);
};

const requirePortfolioDecimal = (value, parse) => {
    if (typeof value !== 'string') {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    try {
        parse(value);
    } catch (error) {
        if (!(error instanceof FuturesProductionDecimalError)) throw error;
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    return value;
};

const isExchangeSymbol = value => (
    typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= MAX_EXCHANGE_SYMBOL_BYTES
    && !/[a-z]/.test(value)
    && EXCHANGE_SYMBOL_PATTERN.test(value)
);

const normalizePortfolioPosition = (value) => {
    const position = readExactDataProperties(
        value,
        POSITION_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    if (!isExchangeSymbol(position.symbol)
        || !['LONG', 'SHORT'].includes(position.positionSide)
        || !Number.isSafeInteger(position.leverage)
        || position.leverage < 1
        || position.leverage > 125
        || !['ISOLATED', 'CROSSED'].includes(position.marginType)) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    requirePortfolioDecimal(position.quantity, parsePositiveExactDecimal);
    requirePortfolioDecimal(position.entryPrice, parsePositiveExactDecimal);
    requirePortfolioDecimal(position.markPrice, parsePositiveExactDecimal);
    requirePortfolioDecimal(position.notionalUsdt, parsePositiveExactDecimal);
    requirePortfolioDecimal(position.unrealizedPnlUsdt, parseSignedExactDecimal);
    requirePortfolioDecimal(position.isolatedMarginUsdt, parseNonNegativeExactDecimal);
    requirePortfolioDecimal(position.liquidationPrice, parseNonNegativeExactDecimal);
    return freezeFields(POSITION_FIELDS, position);
};

const normalizePortfolioOrder = (value) => {
    const order = readExactDataProperties(
        value,
        OPEN_ORDER_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    const expectedEffect = order.positionSide === 'LONG'
        ? (order.side === 'BUY' ? 'ENTRY' : 'EXIT')
        : (order.side === 'SELL' ? 'ENTRY' : 'EXIT');
    const validStatuses = order.orderKind === 'REGULAR'
        ? ['NEW', 'PARTIALLY_FILLED']
        : ['NEW', 'TRIGGERING'];
    if (!isExchangeSymbol(order.symbol)
        || !['REGULAR', 'ALGO'].includes(order.orderKind)
        || typeof order.orderId !== 'string'
        || !ORDER_ID_PATTERN.test(order.orderId)
        || typeof order.clientOrderId !== 'string'
        || !CLIENT_ORDER_ID_PATTERN.test(order.clientOrderId)
        || !['BUY', 'SELL'].includes(order.side)
        || !['LONG', 'SHORT'].includes(order.positionSide)
        || order.positionEffect !== expectedEffect
        || !validStatuses.includes(order.status)
        || typeof order.type !== 'string'
        || !ORDER_TYPE_PATTERN.test(order.type)
        || typeof order.timeInForce !== 'string'
        || !TIME_IN_FORCE_PATTERN.test(order.timeInForce)
        || typeof order.isAppOwned !== 'boolean'
        || order.isAppOwned !== OWNED_CLIENT_ORDER_ID_PATTERN.test(order.clientOrderId)
        || !Number.isSafeInteger(order.updateTime)
        || order.updateTime < 0
        || !['synced', 'stale', 'pending'].includes(order.syncState)) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    requirePortfolioDecimal(order.price, parseNonNegativeExactDecimal);
    requirePortfolioDecimal(order.originalQuantity, parseNonNegativeExactDecimal);
    requirePortfolioDecimal(order.executedQuantity, parseNonNegativeExactDecimal);
    return freezeFields(OPEN_ORDER_FIELDS, order);
};

const normalizePortfolio = (value) => {
    const portfolio = readExactDataProperties(
        value,
        PORTFOLIO_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    if (!['live', 'stale', 'unavailable', 'truncated'].includes(portfolio.state)
        || (portfolio.observedAt !== null
            && (!Number.isSafeInteger(portfolio.observedAt) || portfolio.observedAt < 0))
        || (portfolio.availableBalanceUsdt !== null
            && typeof portfolio.availableBalanceUsdt !== 'string')
        || !['idle', 'syncing', 'resyncing', 'live', 'degraded'].includes(portfolio.syncState)
        || (portfolio.syncCode !== null
            && (typeof portfolio.syncCode !== 'string'
                || !SAFE_CODE_PATTERN.test(portfolio.syncCode)))) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    if (portfolio.availableBalanceUsdt !== null) {
        requirePortfolioDecimal(portfolio.availableBalanceUsdt, parseNonNegativeExactDecimal);
    }
    const positions = normalizeDensePortfolioArray(
        portfolio.positions,
        normalizePortfolioPosition,
    );
    const openOrders = normalizeDensePortfolioArray(
        portfolio.openOrders,
        normalizePortfolioOrder,
    );
    const positionKeys = new Set(positions.map(position => (
        `${position.symbol}:${position.positionSide}`
    )));
    const orderIds = new Set(openOrders.map(order => (
        `${order.symbol}:${order.orderKind}:${order.orderId}`
    )));
    const clientOrderIds = new Set(openOrders.map(order => (
        `${order.symbol}:${order.orderKind}:${order.clientOrderId}`
    )));
    if (positionKeys.size !== positions.length
        || orderIds.size !== openOrders.length
        || clientOrderIds.size !== openOrders.length
        || (portfolio.state === 'live'
            && (portfolio.observedAt === null || portfolio.availableBalanceUsdt === null))
        || (portfolio.state === 'unavailable'
            && (portfolio.observedAt !== null
                || portfolio.availableBalanceUsdt !== null
                || positions.length !== 0
                || openOrders.length !== 0))) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    return Object.freeze({
        state: portfolio.state,
        observedAt: portfolio.observedAt,
        availableBalanceUsdt: portfolio.availableBalanceUsdt,
        syncState: portfolio.syncState,
        syncCode: portfolio.syncCode,
        positions,
        openOrders,
    });
};

const normalizeStatusObject = (value) => {
    const status = readExactDataProperties(
        value,
        STATUS_FIELDS,
        FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS,
    );
    if (status.channelId !== FUTURES_PRODUCTION_EXECUTION_CHANNEL_ID
        || status.action !== FUTURES_PRODUCTION_EXECUTION_ACTIONS.STATUS
        || status.version !== FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION
        || status.marketType !== FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE
        || status.environment !== FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT
        || status.mode !== 'production'
        || typeof status.liveAuthorized !== 'boolean'
        || typeof status.configured !== 'boolean') {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    requireRevision(status.revision, FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    const account = normalizeAccount(status.account);
    const caps = normalizeCaps(status.caps);
    const killSwitch = normalizeKillSwitch(status.killSwitch);
    const capabilities = normalizeCapabilities(status.capabilities);
    const intent = normalizeIntent(status.intent);
    const attempt = normalizeAttempt(status.attempt);
    const reconciliation = normalizeReconciliation(status.reconciliation);
    const recovery = normalizeRecovery(status.recovery);
    const portfolio = normalizePortfolio(status.portfolio);
    const anyCapability = CAPABILITY_FIELDS.slice(0, -1).some((field) => capabilities[field]);
    if ((status.configured && (account === null || caps === null))
        || (!status.configured && (account !== null || caps !== null))
        || (anyCapability && (!status.liveAuthorized
            || !status.configured
            || recovery.required
            || account === null
            || caps === null))
        || (capabilities.engageKillSwitch && killSwitch.engaged)
        || (capabilities.disengageKillSwitch && !killSwitch.engaged)
        || (intent !== null
            && compareFuturesProductionExecutionRevisions(intent.revision, status.revision) > 0)
        || (attempt !== null
            && compareFuturesProductionExecutionRevisions(attempt.revision, status.revision) > 0)
        || (intent !== null && attempt !== null && intent.requestId === attempt.requestId)) {
        fail(FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_STATUS);
    }
    return Object.freeze({
        channelId: status.channelId,
        action: status.action,
        version: status.version,
        revision: status.revision,
        marketType: status.marketType,
        environment: status.environment,
        mode: status.mode,
        liveAuthorized: status.liveAuthorized,
        configured: status.configured,
        account,
        caps,
        killSwitch,
        capabilities,
        intent,
        attempt,
        reconciliation,
        recovery,
        portfolio,
    });
};

export const parseFuturesProductionExecutionStatus = (rawOrObject) => {
    if (typeof rawOrObject === 'string' || rawOrObject instanceof Uint8Array) {
        return normalizeStatusObject(parseDuplicateAwareJson(decodeRawUtf8(
            rawOrObject,
            FUTURES_PRODUCTION_EXECUTION_STATUS_MAX_BYTES,
        )));
    }
    return normalizeStatusObject(rawOrObject);
};

export const createFuturesProductionExecutionStatus = ({
    revision,
    liveAuthorized,
    configured,
    account = null,
    caps = null,
    killSwitch,
    capabilities,
    intent = null,
    attempt = null,
    reconciliation = null,
    recovery,
    portfolio,
} = {}) => normalizeStatusObject({
    channelId: FUTURES_PRODUCTION_EXECUTION_CHANNEL_ID,
    action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.STATUS,
    version: FUTURES_PRODUCTION_EXECUTION_PROTOCOL_VERSION,
    revision,
    marketType: FUTURES_PRODUCTION_EXECUTION_MARKET_TYPE,
    environment: FUTURES_PRODUCTION_EXECUTION_ENVIRONMENT,
    mode: 'production',
    liveAuthorized,
    configured,
    account,
    caps,
    killSwitch,
    capabilities,
    intent,
    attempt,
    reconciliation,
    recovery,
    portfolio,
});

export const hasExactFuturesProductionExecutionSessionRequestFields = (value) => {
    try {
        readExactDataProperties(
            value,
            value?.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT
                ? PREPARE_ORDER_FIELDS
                : value?.action
                    === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT
                    ? PREPARE_MARGIN_FIELDS
                    : value?.action
                        === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT
                        ? PREPARE_AMEND_FIELDS
                : BASE_FIELDS,
            FUTURES_PRODUCTION_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_FIELDS,
        );
        return true;
    } catch {
        return false;
    }
};
