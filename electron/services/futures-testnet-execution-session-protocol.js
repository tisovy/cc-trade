import {
    FUTURES_TESTNET_EXECUTION_CHANNEL_ID,
    FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
    FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
    FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
    parseFuturesTestnetExecutionAcknowledgement,
} from './futures-testnet-execution-protocol.js';
import {
    FuturesTestnetExecutionIntegerToken,
    parseFuturesTestnetExecutionJson,
    readIntegerToken,
} from './futures-testnet-execution-json.js';

export const FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS = Object.freeze({
    SUBSCRIBE_STATUS: 'futures.execution.subscribeStatus',
    UNSUBSCRIBE_STATUS: 'futures.execution.unsubscribeStatus',
    PREPARE_INTENT: 'futures.execution.prepareIntent',
    STATUS: 'futures.execution.status',
});

export const FUTURES_TESTNET_EXECUTION_SESSION_MAX_BYTES = 4096;

export class FuturesTestnetExecutionSessionProtocolError extends Error {
    constructor(code) {
        super('Futures testnet execution session message was rejected');
        this.name = 'FuturesTestnetExecutionSessionProtocolError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesTestnetExecutionSessionProtocolError(code);
};

const isRecord = (value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype)
);

const requireExactKeys = (value, expected) => {
    if (!isRecord(value)) fail('INVALID_SESSION_MESSAGE');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length
        || keys.some((key) => typeof key !== 'string' || !expected.includes(key))) {
        fail('INVALID_SESSION_FIELDS');
    }
    return value;
};

const readRawObject = (raw) => {
    if (typeof raw !== 'string'
        || Buffer.byteLength(raw, 'utf8') > FUTURES_TESTNET_EXECUTION_SESSION_MAX_BYTES) {
        fail('SESSION_MESSAGE_TOO_LARGE');
    }
    try {
        const value = parseFuturesTestnetExecutionJson(raw);
        if (!isRecord(value)) fail('INVALID_SESSION_MESSAGE');
        return value;
    } catch (error) {
        if (error instanceof FuturesTestnetExecutionSessionProtocolError) throw error;
        fail('INVALID_SESSION_MESSAGE');
    }
};

export const readFuturesTestnetExecutionAction = (raw) => {
    const value = readRawObject(raw);
    return typeof value.action === 'string' ? value.action : null;
};

export const isPotentialFuturesTestnetExecutionFrame = (raw) => (
    typeof raw === 'string'
    && (
        raw.includes('futures.execution.')
        || raw.replace(/\\u([0-9a-fA-F]{4})/g, (_match, digits) => (
            String.fromCharCode(Number.parseInt(digits, 16))
        )).includes('futures.execution.')
    )
);

export const parseFuturesTestnetExecutionSessionRequest = (raw) => {
    const request = requireExactKeys(readRawObject(raw), [
        'action', 'version', 'revision', 'marketType', 'environment', 'symbol',
    ]);
    if (!Object.values(FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS).slice(0, 3).includes(request.action)) {
        fail('INVALID_SESSION_ACTION');
    }
    if (!(request.version instanceof FuturesTestnetExecutionIntegerToken)
        || readIntegerToken(request.version).token !== '1') {
        fail('INVALID_SESSION_VERSION');
    }
    if (typeof request.revision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(request.revision)) {
        fail('INVALID_SESSION_REVISION');
    }
    const revision = request.revision;
    if (request.marketType !== FUTURES_TESTNET_EXECUTION_MARKET_TYPE
        || request.environment !== FUTURES_TESTNET_EXECUTION_ENVIRONMENT
        || typeof request.symbol !== 'string'
        || !/^[A-Z0-9]{2,20}$/.test(request.symbol)) {
        fail('INVALID_SESSION_IDENTITY');
    }
    return Object.freeze({
        action: request.action,
        version: FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
        revision,
        marketType: request.marketType,
        environment: request.environment,
        symbol: request.symbol,
    });
};

const normalizeCapability = (value) => {
    const capability = requireExactKeys(value, ['enabled', 'code']);
    if (typeof capability.enabled !== 'boolean'
        || typeof capability.code !== 'string'
        || !/^FUTURES_EXECUTION_[A-Z0-9_]{1,64}$/.test(capability.code)) {
        fail('INVALID_STATUS_CAPABILITY');
    }
    return Object.freeze({ enabled: capability.enabled, code: capability.code });
};

const normalizeIntent = (value, symbol) => {
    if (value === null) return null;
    const intent = requireExactKeys(value, [
        'requestId', 'clientOrderId', 'symbol', 'side', 'leverage', 'expiresAt',
    ]);
    if (!/^[0-9a-f]{32}$/.test(intent.requestId ?? '')
        || intent.clientOrderId !== `cc6-${intent.requestId}`
        || intent.symbol !== symbol
        || !['BUY', 'SELL'].includes(intent.side)
        || !Number.isSafeInteger(intent.leverage)
        || intent.leverage < 1
        || intent.leverage > 3
        || !Number.isSafeInteger(intent.expiresAt)
        || intent.expiresAt < 0) {
        fail('INVALID_STATUS_INTENT');
    }
    return Object.freeze({
        requestId: intent.requestId,
        clientOrderId: intent.clientOrderId,
        symbol: intent.symbol,
        side: intent.side,
        leverage: intent.leverage,
        expiresAt: intent.expiresAt,
    });
};

export const createFuturesTestnetExecutionStatus = ({
    revision,
    symbol,
    capability,
    intent = null,
    attempt = null,
} = {}) => {
    if (!/^(0|[1-9][0-9]*)$/.test(revision ?? '')
        || typeof symbol !== 'string'
        || !/^[A-Z0-9]{2,20}$/.test(symbol)) {
        fail('INVALID_STATUS_IDENTITY');
    }
    const normalizedAttempt = attempt === null
        ? null
        : parseFuturesTestnetExecutionAcknowledgement(attempt);
    if (normalizedAttempt !== null
        && normalizedAttempt.symbol !== null
        && normalizedAttempt.symbol !== symbol) {
        fail('INVALID_STATUS_ATTEMPT');
    }
    return Object.freeze({
        channelId: FUTURES_TESTNET_EXECUTION_CHANNEL_ID,
        action: FUTURES_TESTNET_EXECUTION_SESSION_ACTIONS.STATUS,
        version: FUTURES_TESTNET_EXECUTION_PROTOCOL_VERSION,
        revision,
        marketType: FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
        environment: FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
        symbol,
        capability: normalizeCapability(capability),
        intent: normalizeIntent(intent, symbol),
        attempt: normalizedAttempt,
    });
};
