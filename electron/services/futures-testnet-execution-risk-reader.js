import { createHash } from 'node:crypto';
import {
    formatExactDecimal,
    parseCanonicalUnsignedInteger,
    parseNonNegativeExactDecimal,
    parsePositiveExactDecimal,
    parseSignedExactDecimal,
} from './futures-testnet-execution-decimal.js';
import { FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN } from './futures-testnet-execution-coordinator.js';

export const FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS = Object.freeze({
    serverTime: 1,
    exchangeInfo: 1,
    accountConfig: 5,
    symbolConfig: 5,
    positions: 5,
    balance: 5,
    regularOpenOrders: 1,
    algoOpenOrders: 1,
    markPrice: 1,
});

export const FUTURES_TESTNET_EXECUTION_RISK_READER_FRESHNESS = Object.freeze({
    staticMaxAgeMs: 300_000,
    configurationMaxAgeMs: 30_000,
    dynamicMaxAgeMs: 5_000,
    maximumServerRoundTripMs: 1_000,
    maximumFutureSkewMs: 1_000,
});

export const FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES = Object.freeze({
    INVALID_CONFIGURATION: 'FUTURES_EXECUTION_RISK_READER_INVALID_CONFIGURATION',
    INVALID_ARGUMENTS: 'FUTURES_EXECUTION_RISK_READER_INVALID_ARGUMENTS',
    MALFORMED_RESPONSE: 'FUTURES_EXECUTION_RISK_READER_MALFORMED_RESPONSE',
    IDENTITY_MISMATCH: 'FUTURES_EXECUTION_RISK_READER_IDENTITY_MISMATCH',
    DUPLICATE_IDENTITY: 'FUTURES_EXECUTION_RISK_READER_DUPLICATE_IDENTITY',
    STALE_DATA: 'FUTURES_EXECUTION_RISK_READER_STALE_DATA',
    OWNERSHIP_LOST: 'FUTURES_EXECUTION_RISK_READER_OWNERSHIP_LOST',
    ABORTED: 'FUTURES_EXECUTION_RISK_READER_ABORTED',
});

export class FuturesTestnetExecutionRiskReaderError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesTestnetExecutionRiskReaderError';
        this.code = code;
    }
}

const ENDPOINTS = Object.freeze({
    serverTime: Object.freeze({ path: '/fapi/v1/time', signed: false }),
    exchangeInfo: Object.freeze({ path: '/fapi/v1/exchangeInfo', signed: false }),
    accountConfig: Object.freeze({ path: '/fapi/v1/accountConfig', signed: true }),
    symbolConfig: Object.freeze({ path: '/fapi/v1/symbolConfig', signed: true }),
    positions: Object.freeze({ path: '/fapi/v3/positionRisk', signed: true }),
    balance: Object.freeze({ path: '/fapi/v3/balance', signed: true }),
    regularOpenOrders: Object.freeze({ path: '/fapi/v1/openOrders', signed: true }),
    algoOpenOrders: Object.freeze({ path: '/fapi/v1/openAlgoOrders', signed: true }),
    markPrice: Object.freeze({ path: '/fapi/v1/premiumIndex', signed: false }),
});

const MAX_SIGNED_INT64 = 9223372036854775807n;
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/;
const IDENTITY_PATTERN = /^[\x21-\x7e]{1,128}$/;

const fail = (code, message) => {
    throw new FuturesTestnetExecutionRiskReaderError(code, message);
};

const requireFunction = (value, name) => {
    if (typeof value !== 'function') {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.INVALID_CONFIGURATION,
            `${name} must be a function`,
        );
    }
    return value;
};

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const readDataProperty = (value, field, { optional = false } = {}) => {
    if (!isRecord(value)) {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            'Expected an ordinary response object',
        );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor) {
        if (optional) return undefined;
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `Missing response field ${field}`,
        );
    }
    if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `Response field ${field} must be an enumerable data property`,
        );
    }
    return descriptor.value;
};

const readDenseArray = (value, name) => {
    if (!Array.isArray(value)
        || Object.getPrototypeOf(value) !== Array.prototype
        || Reflect.ownKeys(value).some((key) => {
            if (key === 'length') return false;
            const index = Number(key);
            return !Number.isSafeInteger(index)
                || index < 0
                || String(index) !== key
                || index >= value.length;
        })) {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `${name} must be a dense ordinary array`,
        );
    }
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
                `${name} contains a non-data entry`,
            );
        }
    }
    return value;
};

const requireString = (value, name, maximumLength = 128) => {
    if (typeof value !== 'string'
        || value.length === 0
        || value.length > maximumLength
        || value.trim() !== value) {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `${name} must be an exact bounded string`,
        );
    }
    return value;
};

const requireBoolean = (value, name) => {
    if (typeof value !== 'boolean') {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `${name} must be a boolean`,
        );
    }
    return value;
};

const normalizeBooleanText = (value, name) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    fail(
        FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
        `${name} must be a boolean or exact boolean text`,
    );
};

const requireSafeTimestamp = (value, name) => {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `${name} must be a non-negative safe integer timestamp`,
        );
    }
    return value;
};

const requirePositiveSafeInteger = (value, name) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `${name} must be a positive safe integer`,
        );
    }
    return value;
};

const normalizeUnsignedIntegerText = (value, name, maximumDigits = 19) => {
    let text;
    if (typeof value === 'string') {
        text = value;
    } else if (Number.isSafeInteger(value) && value >= 0) {
        text = String(value);
    } else {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `${name} must be a lossless unsigned integer`,
        );
    }
    try {
        parseCanonicalUnsignedInteger(text, { maxDigits: maximumDigits });
    } catch {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `${name} must be canonical unsigned integer text`,
        );
    }
    return text;
};

const normalizePositiveInt64 = (value, name) => {
    const text = normalizeUnsignedIntegerText(value, name);
    const integer = BigInt(text);
    if (integer <= 0n || integer > MAX_SIGNED_INT64) {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `${name} is outside positive signed-int64 range`,
        );
    }
    return text;
};

const normalizeDecimal = (value, parser, name) => {
    try {
        return formatExactDecimal(parser(value));
    } catch {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
            `${name} must be an exact decimal string`,
        );
    }
};

const nonNegativeDecimal = (value, name) => normalizeDecimal(
    value,
    parseNonNegativeExactDecimal,
    name,
);
const positiveDecimal = (value, name) => normalizeDecimal(
    value,
    parsePositiveExactDecimal,
    name,
);
const signedDecimal = (value, name) => normalizeDecimal(
    value,
    parseSignedExactDecimal,
    name,
);

const deepFreeze = (value) => {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Reflect.ownKeys(value).forEach(key => deepFreeze(value[key]));
        Object.freeze(value);
    }
    return value;
};

const requireSymbolIdentity = (value, symbol, name) => {
    if (value !== symbol) {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.IDENTITY_MISMATCH,
            `${name} did not match the requested symbol`,
        );
    }
    return value;
};

const normalizeServerTime = value => ({
    serverTime: requireSafeTimestamp(readDataProperty(value, 'serverTime'), 'serverTime'),
});

const normalizeStringArray = (value, name) => readDenseArray(value, name).map(
    entry => requireString(entry, name, 32),
);

const normalizeExchangeInfo = (value, symbol, generation) => {
    const symbols = readDenseArray(readDataProperty(value, 'symbols'), 'exchange symbols');
    const symbolIdentities = new Set();
    const matches = symbols.filter((entry) => {
        const candidateSymbol = requireString(
            readDataProperty(entry, 'symbol'),
            'exchange symbol',
            20,
        );
        if (!SYMBOL_PATTERN.test(candidateSymbol)) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.IDENTITY_MISMATCH,
                'Exchange info contains a malformed symbol identity',
            );
        }
        if (symbolIdentities.has(candidateSymbol)) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY,
                'Exchange info contains a duplicate symbol identity',
            );
        }
        symbolIdentities.add(candidateSymbol);
        return candidateSymbol === symbol;
    });
    if (matches.length !== 1) {
        fail(
            matches.length > 1
                ? FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY
                : FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.IDENTITY_MISMATCH,
            'Exchange info must contain exactly one requested symbol',
        );
    }
    const source = matches[0];
    const filters = readDenseArray(readDataProperty(source, 'filters'), 'exchange filters');
    const filtersByType = new Map();
    filters.forEach((filter) => {
        const filterType = requireString(readDataProperty(filter, 'filterType'), 'filterType', 32);
        if (filtersByType.has(filterType)) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY,
                `Duplicate exchange filter ${filterType}`,
            );
        }
        filtersByType.set(filterType, filter);
    });
    const requireFilter = (filterType) => {
        const filter = filtersByType.get(filterType);
        if (!filter) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
                `Missing exchange filter ${filterType}`,
            );
        }
        return filter;
    };
    const price = requireFilter('PRICE_FILTER');
    const percentPrice = requireFilter('PERCENT_PRICE');
    const lotSize = requireFilter('LOT_SIZE');
    const minNotional = requireFilter('MIN_NOTIONAL');
    const maxNumOrders = requireFilter('MAX_NUM_ORDERS');
    const multiplierDecimal = normalizeUnsignedIntegerText(
        readDataProperty(percentPrice, 'multiplierDecimal'),
        'multiplierDecimal',
        2,
    );
    const normalized = {
        symbol,
        status: requireString(readDataProperty(source, 'status'), 'status', 32),
        contractType: requireString(
            readDataProperty(source, 'contractType'),
            'contractType',
            32,
        ),
        quoteAsset: requireString(readDataProperty(source, 'quoteAsset'), 'quoteAsset', 20),
        marginAsset: requireString(readDataProperty(source, 'marginAsset'), 'marginAsset', 20),
        supportedOrderTypes: normalizeStringArray(
            readDataProperty(source, 'orderTypes'),
            'orderTypes',
        ),
        supportedTimeInForce: normalizeStringArray(
            readDataProperty(source, 'timeInForce'),
            'timeInForce',
        ),
        filters: {
            price: {
                minPrice: nonNegativeDecimal(readDataProperty(price, 'minPrice'), 'minPrice'),
                maxPrice: nonNegativeDecimal(readDataProperty(price, 'maxPrice'), 'maxPrice'),
                tickSize: positiveDecimal(readDataProperty(price, 'tickSize'), 'tickSize'),
            },
            percentPrice: {
                multiplierUp: positiveDecimal(
                    readDataProperty(percentPrice, 'multiplierUp'),
                    'multiplierUp',
                ),
                multiplierDown: positiveDecimal(
                    readDataProperty(percentPrice, 'multiplierDown'),
                    'multiplierDown',
                ),
                multiplierDecimal,
            },
            lotSize: {
                minQty: positiveDecimal(readDataProperty(lotSize, 'minQty'), 'minQty'),
                maxQty: positiveDecimal(readDataProperty(lotSize, 'maxQty'), 'maxQty'),
                stepSize: positiveDecimal(readDataProperty(lotSize, 'stepSize'), 'stepSize'),
            },
            minNotional: {
                notional: positiveDecimal(
                    readDataProperty(minNotional, 'notional'),
                    'minimum notional',
                ),
            },
            maxNumOrders: {
                limit: requirePositiveSafeInteger(
                    readDataProperty(maxNumOrders, 'limit'),
                    'MAX_NUM_ORDERS limit',
                ),
            },
        },
    };
    const metadataDigest = createHash('sha256')
        .update(JSON.stringify(normalized), 'utf8')
        .digest('hex');
    return {
        ...normalized,
        metadataDigest,
        metadataVersion: `sha256:${metadataDigest}`,
        metadataGeneration: generation,
    };
};

const normalizeAccountConfig = value => ({
    canTrade: requireBoolean(readDataProperty(value, 'canTrade'), 'canTrade'),
    dualSidePosition: requireBoolean(
        readDataProperty(value, 'dualSidePosition'),
        'dualSidePosition',
    ),
    multiAssetsMargin: requireBoolean(
        readDataProperty(value, 'multiAssetsMargin'),
        'multiAssetsMargin',
    ),
});

const normalizeSymbolConfig = (value, symbol) => {
    const entries = Array.isArray(value) ? readDenseArray(value, 'symbol config') : [value];
    if (entries.length !== 1) {
        fail(
            entries.length > 1
                ? FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY
                : FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.IDENTITY_MISMATCH,
            'Symbol config must contain exactly one row',
        );
    }
    const source = entries[0];
    requireSymbolIdentity(readDataProperty(source, 'symbol'), symbol, 'symbol config');
    return {
        symbol,
        marginType: requireString(readDataProperty(source, 'marginType'), 'marginType', 16),
        isAutoAddMargin: normalizeBooleanText(
            readDataProperty(source, 'isAutoAddMargin'),
            'isAutoAddMargin',
        ),
        leverage: requirePositiveSafeInteger(readDataProperty(source, 'leverage'), 'leverage'),
        maxNotionalValue: positiveDecimal(
            readDataProperty(source, 'maxNotionalValue'),
            'maxNotionalValue',
        ),
    };
};

const normalizePositions = (value, symbol) => {
    const entries = readDenseArray(value, 'positions');
    const identities = new Set();
    let latestUpdateTime = null;
    const positions = entries.map((source) => {
        requireSymbolIdentity(readDataProperty(source, 'symbol'), symbol, 'position');
        const positionSide = requireString(
            readDataProperty(source, 'positionSide'),
            'positionSide',
            8,
        );
        if (identities.has(positionSide)) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY,
                'Duplicate position identity',
            );
        }
        identities.add(positionSide);
        const updateTime = requireSafeTimestamp(
            readDataProperty(source, 'updateTime'),
            'position updateTime',
        );
        latestUpdateTime = latestUpdateTime === null
            ? updateTime
            : Math.max(latestUpdateTime, updateTime);
        return {
            symbol,
            positionSide,
            positionAmt: signedDecimal(readDataProperty(source, 'positionAmt'), 'positionAmt'),
            liquidationPrice: nonNegativeDecimal(
                readDataProperty(source, 'liquidationPrice'),
                'liquidationPrice',
            ),
            marginAsset: requireString(
                readDataProperty(source, 'marginAsset'),
                'position marginAsset',
                20,
            ),
            notional: signedDecimal(readDataProperty(source, 'notional'), 'position notional'),
            isolatedWallet: nonNegativeDecimal(
                readDataProperty(source, 'isolatedWallet'),
                'isolatedWallet',
            ),
            isolatedMargin: nonNegativeDecimal(
                readDataProperty(source, 'isolatedMargin'),
                'isolatedMargin',
            ),
            initialMargin: nonNegativeDecimal(
                readDataProperty(source, 'initialMargin'),
                'initialMargin',
            ),
            maintMargin: nonNegativeDecimal(
                readDataProperty(source, 'maintMargin'),
                'maintMargin',
            ),
            positionInitialMargin: nonNegativeDecimal(
                readDataProperty(source, 'positionInitialMargin'),
                'positionInitialMargin',
            ),
            openOrderInitialMargin: nonNegativeDecimal(
                readDataProperty(source, 'openOrderInitialMargin'),
                'openOrderInitialMargin',
            ),
        };
    });
    return { data: { positions }, sourceTime: latestUpdateTime };
};

const normalizeBalance = (value) => {
    const entries = readDenseArray(value, 'balance');
    const assetIdentities = new Set();
    let accountIdentity = null;
    const normalizedIdentities = entries.map((entry) => {
        const asset = requireString(readDataProperty(entry, 'asset'), 'balance asset', 20);
        const accountAlias = requireString(
            readDataProperty(entry, 'accountAlias'),
            'accountAlias',
            64,
        );
        if (assetIdentities.has(asset)) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY,
                'Balance contains a duplicate asset identity',
            );
        }
        assetIdentities.add(asset);
        if (accountIdentity !== null && accountAlias !== accountIdentity) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.IDENTITY_MISMATCH,
                'Balance contains mixed account identities',
            );
        }
        accountIdentity = accountAlias;
        return { asset, source: entry };
    });
    const matches = normalizedIdentities.filter(({ asset }) => asset === 'USDT');
    if (matches.length !== 1) {
        fail(
            matches.length > 1
                ? FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY
                : FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.IDENTITY_MISMATCH,
            'Balance must contain exactly one USDT row',
        );
    }
    const source = matches[0].source;
    return {
        data: {
            balances: [{
                asset: 'USDT',
                availableBalance: nonNegativeDecimal(
                    readDataProperty(source, 'availableBalance'),
                    'availableBalance',
                ),
                marginAvailable: requireBoolean(
                    readDataProperty(source, 'marginAvailable'),
                    'marginAvailable',
                ),
            }],
        },
        accountIdentity,
        sourceTime: requireSafeTimestamp(
            readDataProperty(source, 'updateTime'),
            'balance updateTime',
        ),
    };
};

const normalizeOrders = (value, symbol, { algo }) => {
    const entries = readDenseArray(value, algo ? 'algo open orders' : 'regular open orders');
    const orderIdentities = new Set();
    const clientIdentities = new Set();
    let latestUpdateTime = null;
    const orders = entries.map((source) => {
        requireSymbolIdentity(readDataProperty(source, 'symbol'), symbol, 'open order');
        const idField = algo ? 'algoId' : 'orderId';
        const clientField = algo ? 'clientAlgoId' : 'clientOrderId';
        const orderId = normalizePositiveInt64(readDataProperty(source, idField), idField);
        const clientOrderId = requireString(
            readDataProperty(source, clientField),
            clientField,
            36,
        );
        if (orderIdentities.has(orderId) || clientIdentities.has(clientOrderId)) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY,
                'Duplicate open-order identity',
            );
        }
        orderIdentities.add(orderId);
        clientIdentities.add(clientOrderId);
        const updateTime = requireSafeTimestamp(
            readDataProperty(source, 'updateTime'),
            'open-order updateTime',
        );
        latestUpdateTime = latestUpdateTime === null
            ? updateTime
            : Math.max(latestUpdateTime, updateTime);
        return {
            symbol,
            [idField]: orderId,
            [clientField]: clientOrderId,
            updateTime,
        };
    });
    return { data: { orders }, sourceTime: latestUpdateTime };
};

const normalizeMarkPrice = (value, symbol) => {
    const entries = Array.isArray(value) ? readDenseArray(value, 'mark price') : [value];
    if (entries.length !== 1) {
        fail(
            entries.length > 1
                ? FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.DUPLICATE_IDENTITY
                : FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.IDENTITY_MISMATCH,
            'Mark-price response must contain exactly one row',
        );
    }
    const source = entries[0];
    requireSymbolIdentity(readDataProperty(source, 'symbol'), symbol, 'mark price');
    return {
        data: {
            symbol,
            markPrice: positiveDecimal(readDataProperty(source, 'markPrice'), 'markPrice'),
        },
        sourceTime: requireSafeTimestamp(readDataProperty(source, 'time'), 'mark time'),
    };
};

const validateOwnership = (value) => {
    if (!isRecord(value)
        || Reflect.ownKeys(value).some(
            key => ![
                'symbol',
                'credentialIdentity',
                'connectionIdentity',
                'sessionIdentity',
                'generation',
                'signal',
            ].includes(key),
        )
        || !SYMBOL_PATTERN.test(value.symbol)
        || !IDENTITY_PATTERN.test(value.credentialIdentity)
        || !IDENTITY_PATTERN.test(value.connectionIdentity)
        || !IDENTITY_PATTERN.test(value.sessionIdentity)
        || !IDENTITY_PATTERN.test(value.generation)) {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.INVALID_ARGUMENTS,
            'Risk reader ownership is malformed',
        );
    }
    return value;
};

const throwIfAborted = (signal) => {
    if (signal?.aborted) {
        fail(
            FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.ABORTED,
            'Futures execution risk read was aborted',
        );
    }
};

export class FuturesTestnetExecutionRiskReader {
    constructor({
        request,
        coordinator,
        wallNow = Date.now,
        monotonicNow = () => Math.floor(performance.now()),
        owns = () => true,
    }) {
        this.request = requireFunction(request, 'request');
        if (!coordinator || typeof coordinator.beginPreflight !== 'function') {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.INVALID_CONFIGURATION,
                'coordinator.beginPreflight is required',
            );
        }
        this.coordinator = coordinator;
        this.wallNow = requireFunction(wallNow, 'wallNow');
        this.monotonicNow = requireFunction(monotonicNow, 'monotonicNow');
        this.owns = requireFunction(owns, 'owns');
        this.lastSourceTimes = new Map();
    }

    requireOwnership(ownership) {
        throwIfAborted(ownership.signal);
        if (this.owns(ownership) !== true) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.OWNERSHIP_LOST,
                'Futures execution risk ownership was lost',
            );
        }
    }

    readClock(clock, name) {
        const value = clock();
        if (!Number.isSafeInteger(value) || value < 0) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.INVALID_CONFIGURATION,
                `${name} must return a non-negative safe integer`,
            );
        }
        return value;
    }

    getValidationToDispatchAgeMs(bundle) {
        const completedAt = bundle?.validationCompletedAt;
        if (!Number.isSafeInteger(completedAt) || completedAt < 0) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.INVALID_ARGUMENTS,
                'Preflight validation timestamp is invalid',
            );
        }
        const current = this.readClock(this.monotonicNow, 'monotonicNow');
        if (current < completedAt) {
            fail(
                FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.STALE_DATA,
                'Preflight validation clock regressed',
            );
        }
        return current - completedAt;
    }

    async readEndpoint(lease, ownership, resourceName, query = {}) {
        this.requireOwnership(ownership);
        const endpoint = ENDPOINTS[resourceName];
        const requestOptions = Object.freeze({
            origin: FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN,
            path: endpoint.path,
            method: 'GET',
            query: Object.freeze({ ...query }),
            signed: endpoint.signed,
            redirect: 'error',
            signal: ownership.signal,
        });
        const data = await lease.executeGet(
            () => this.request(requestOptions),
            FUTURES_TESTNET_EXECUTION_RISK_READER_WEIGHTS[resourceName],
            { signal: ownership.signal },
        );
        this.requireOwnership(ownership);
        return {
            data,
            completedAt: this.readClock(this.monotonicNow, 'monotonicNow'),
        };
    }

    sourceState({ ownershipKey, resourceName, sourceTime, serverNow }) {
        if (sourceTime === null || sourceTime === undefined) {
            return { futureDated: false, regressed: false };
        }
        const key = `${ownershipKey}\0${resourceName}`;
        const previous = this.lastSourceTimes.get(key);
        const state = {
            futureDated: sourceTime
                > serverNow + FUTURES_TESTNET_EXECUTION_RISK_READER_FRESHNESS
                    .maximumFutureSkewMs,
            regressed: previous !== undefined && sourceTime < previous,
        };
        if (previous === undefined || sourceTime > previous) {
            this.lastSourceTimes.set(key, sourceTime);
        }
        return state;
    }

    async readPreflight(rawOwnership) {
        const ownership = validateOwnership(rawOwnership);
        this.requireOwnership(ownership);
        const lease = await this.coordinator.beginPreflight({ signal: ownership.signal });
        const monotonicStart = this.readClock(this.monotonicNow, 'monotonicNow');
        const wallStart = this.readClock(this.wallNow, 'wallNow');
        try {
            const serverRead = await this.readEndpoint(lease, ownership, 'serverTime');
            const server = normalizeServerTime(serverRead.data);
            const serverRoundTripMs = serverRead.completedAt - monotonicStart;
            if (serverRoundTripMs < 0
                || serverRoundTripMs
                    > FUTURES_TESTNET_EXECUTION_RISK_READER_FRESHNESS
                        .maximumServerRoundTripMs) {
                fail(
                    FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.STALE_DATA,
                    'Server-time round trip exceeded its freshness limit',
                );
            }
            const localMidpoint = wallStart + Math.floor(serverRoundTripMs / 2);
            const serverOffsetMs = server.serverTime - localMidpoint;
            if (!Number.isSafeInteger(serverOffsetMs)) {
                fail(
                    FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.MALFORMED_RESPONSE,
                    'Server-time offset is not a safe integer',
                );
            }
            const serverNowAt = (monotonicValue) => {
                const adjusted = wallStart
                    + (monotonicValue - monotonicStart)
                    + serverOffsetMs;
                if (!Number.isSafeInteger(adjusted) || adjusted < 0) {
                    fail(
                        FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES
                            .MALFORMED_RESPONSE,
                        'Adjusted server clock is outside safe integer range',
                    );
                }
                return adjusted;
            };

            const exchangeRead = await this.readEndpoint(lease, ownership, 'exchangeInfo');
            const accountRead = await this.readEndpoint(lease, ownership, 'accountConfig');
            const symbolRead = await this.readEndpoint(
                lease,
                ownership,
                'symbolConfig',
                { symbol: ownership.symbol },
            );
            const positionsRead = await this.readEndpoint(
                lease,
                ownership,
                'positions',
                { symbol: ownership.symbol },
            );
            const balanceRead = await this.readEndpoint(lease, ownership, 'balance');
            const regularOrdersRead = await this.readEndpoint(
                lease,
                ownership,
                'regularOpenOrders',
                { symbol: ownership.symbol },
            );
            const algoOrdersRead = await this.readEndpoint(
                lease,
                ownership,
                'algoOpenOrders',
                { symbol: ownership.symbol },
            );
            const markRead = await this.readEndpoint(
                lease,
                ownership,
                'markPrice',
                { symbol: ownership.symbol },
            );

            const exchangeInfo = normalizeExchangeInfo(
                exchangeRead.data,
                ownership.symbol,
                ownership.generation,
            );
            const accountConfig = normalizeAccountConfig(accountRead.data);
            const symbolConfig = normalizeSymbolConfig(symbolRead.data, ownership.symbol);
            const positions = normalizePositions(positionsRead.data, ownership.symbol);
            const balance = normalizeBalance(balanceRead.data);
            const regularOpenOrders = normalizeOrders(
                regularOrdersRead.data,
                ownership.symbol,
                { algo: false },
            );
            const algoOpenOrders = normalizeOrders(
                algoOrdersRead.data,
                ownership.symbol,
                { algo: true },
            );
            const markPrice = normalizeMarkPrice(markRead.data, ownership.symbol);
            const completedAt = this.readClock(this.monotonicNow, 'monotonicNow');
            const accountIdentity = balance.accountIdentity;
            const ownershipKey = [
                ownership.credentialIdentity,
                accountIdentity,
                ownership.connectionIdentity,
                ownership.sessionIdentity,
                ownership.generation,
                ownership.symbol,
            ].join('\0');
            const commonObservation = {
                complete: true,
                connected: true,
                environment: 'testnet',
                symbol: ownership.symbol,
                credentialIdentity: ownership.credentialIdentity,
                accountIdentity,
                connectionIdentity: ownership.connectionIdentity,
                generation: ownership.generation,
            };
            const makeObservation = ({
                data,
                read,
                sourceTime = null,
                maximumAgeMs,
                resourceName,
            }) => {
                const ageMs = completedAt - read.completedAt;
                if (ageMs < 0 || ageMs > maximumAgeMs) {
                    fail(
                        FUTURES_TESTNET_EXECUTION_RISK_READER_ERROR_CODES.STALE_DATA,
                        `${resourceName} exceeded its freshness tier`,
                    );
                }
                return {
                    data,
                    ...commonObservation,
                    ageMs,
                    ...this.sourceState({
                        ownershipKey,
                        resourceName,
                        sourceTime,
                        serverNow: serverNowAt(completedAt),
                    }),
                };
            };
            const freshness = FUTURES_TESTNET_EXECUTION_RISK_READER_FRESHNESS;
            const observations = {
                serverTime: makeObservation({
                    data: { serverTime: server.serverTime, roundTripMs: serverRoundTripMs },
                    read: serverRead,
                    sourceTime: server.serverTime,
                    maximumAgeMs: freshness.dynamicMaxAgeMs,
                    resourceName: 'serverTime',
                }),
                exchangeInfo: makeObservation({
                    data: exchangeInfo,
                    read: exchangeRead,
                    maximumAgeMs: freshness.staticMaxAgeMs,
                    resourceName: 'exchangeInfo',
                }),
                markPrice: makeObservation({
                    data: markPrice.data,
                    read: markRead,
                    sourceTime: markPrice.sourceTime,
                    maximumAgeMs: freshness.dynamicMaxAgeMs,
                    resourceName: 'markPrice',
                }),
                accountConfig: makeObservation({
                    data: accountConfig,
                    read: accountRead,
                    maximumAgeMs: freshness.configurationMaxAgeMs,
                    resourceName: 'accountConfig',
                }),
                symbolConfig: makeObservation({
                    data: symbolConfig,
                    read: symbolRead,
                    maximumAgeMs: freshness.configurationMaxAgeMs,
                    resourceName: 'symbolConfig',
                }),
                positions: makeObservation({
                    data: positions.data,
                    read: positionsRead,
                    sourceTime: positions.sourceTime,
                    maximumAgeMs: freshness.dynamicMaxAgeMs,
                    resourceName: 'positions',
                }),
                balance: makeObservation({
                    data: balance.data,
                    read: balanceRead,
                    sourceTime: balance.sourceTime,
                    maximumAgeMs: freshness.dynamicMaxAgeMs,
                    resourceName: 'balance',
                }),
                regularOpenOrders: makeObservation({
                    data: regularOpenOrders.data,
                    read: regularOrdersRead,
                    sourceTime: regularOpenOrders.sourceTime,
                    maximumAgeMs: freshness.dynamicMaxAgeMs,
                    resourceName: 'regularOpenOrders',
                }),
                algoOpenOrders: makeObservation({
                    data: algoOpenOrders.data,
                    read: algoOrdersRead,
                    sourceTime: algoOpenOrders.sourceTime,
                    maximumAgeMs: freshness.dynamicMaxAgeMs,
                    resourceName: 'algoOpenOrders',
                }),
            };
            const riskOwnership = {
                environment: 'testnet',
                symbol: ownership.symbol,
                credentialIdentity: ownership.credentialIdentity,
                accountIdentity,
                connectionIdentity: ownership.connectionIdentity,
                generation: ownership.generation,
                selectedMetadataDigest: exchangeInfo.metadataDigest,
                currentMetadataDigest: exchangeInfo.metadataDigest,
                selectedMetadataVersion: exchangeInfo.metadataVersion,
                currentMetadataVersion: exchangeInfo.metadataVersion,
                selectedMetadataGeneration: exchangeInfo.metadataGeneration,
                currentMetadataGeneration: exchangeInfo.metadataGeneration,
                validationToDispatchAgeMs: 0,
            };
            return deepFreeze({
                environment: 'testnet',
                origin: FUTURES_TESTNET_EXECUTION_DEMO_ORIGIN,
                symbol: ownership.symbol,
                validationCompletedAt: completedAt,
                session: {
                    connectionIdentity: ownership.connectionIdentity,
                    sessionIdentity: ownership.sessionIdentity,
                    generation: ownership.generation,
                    credentialIdentity: ownership.credentialIdentity,
                    accountIdentity,
                },
                serverClock: {
                    sampledServerTime: server.serverTime,
                    localMidpoint,
                    roundTripMs: serverRoundTripMs,
                    offsetMs: serverOffsetMs,
                    adjustedNow: serverNowAt(completedAt),
                },
                freshness: {
                    static: {
                        maximumAgeMs: freshness.staticMaxAgeMs,
                        resources: ['exchangeInfo'],
                    },
                    configuration: {
                        maximumAgeMs: freshness.configurationMaxAgeMs,
                        resources: ['accountConfig', 'symbolConfig'],
                    },
                    dynamic: {
                        maximumAgeMs: freshness.dynamicMaxAgeMs,
                        resources: [
                            'serverTime',
                            'positions',
                            'balance',
                            'regularOpenOrders',
                            'algoOpenOrders',
                            'markPrice',
                        ],
                    },
                },
                riskOwnership,
                observations,
            });
        } finally {
            lease.release();
        }
    }
}

export const createFuturesTestnetExecutionRiskReader = options => (
    new FuturesTestnetExecutionRiskReader(options)
);
