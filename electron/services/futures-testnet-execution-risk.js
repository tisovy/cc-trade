import {
    FuturesTestnetDecimalError,
    absoluteExactDecimal,
    compareBasisPointRatio,
    compareExactDecimals,
    isExactIncrement,
    isPositiveExactDecimal,
    maxExactDecimal,
    multiplyExactDecimals,
    parseCanonicalUnsignedInteger,
    parseNonNegativeExactDecimal,
    parsePositiveExactDecimal,
    parseSignedExactDecimal,
    subtractExactDecimals,
} from './futures-testnet-execution-decimal.js';
import {
    FUTURES_TESTNET_EXECUTION_ENVIRONMENT,
    FUTURES_TESTNET_EXECUTION_MARKET_TYPE,
    FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES,
    FUTURES_TESTNET_EXECUTION_SAFE_CODES,
    FuturesTestnetExecutionProtocolError,
    validateFuturesTestnetExecutionCommandObject,
} from './futures-testnet-execution-protocol.js';

export const FUTURES_TESTNET_EXECUTION_RISK_LIMITS = Object.freeze({
    MAX_STATIC_CONFIGURATION_AGE_MS: 300_000,
    MAX_ACCOUNT_CONFIGURATION_AGE_MS: 30_000,
    MAX_DYNAMIC_RISK_AGE_MS: 5_000,
    MAX_SERVER_TIME_ROUND_TRIP_MS: 1000,
    MAX_VALIDATION_TO_DISPATCH_AGE_MS: 1000,
    HARD_MAX_LEVERAGE: 3,
    HARD_MAX_NOTIONAL_USDT: '10000',
    MIN_LIQUIDATION_DISTANCE_BPS: '1000',
    MAX_LIQUIDATION_DISTANCE_BPS: '10000',
});

const OBSERVATION_MAXIMUM_AGES = Object.freeze({
    serverTime: FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_DYNAMIC_RISK_AGE_MS,
    exchangeInfo: FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_STATIC_CONFIGURATION_AGE_MS,
    markPrice: FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_DYNAMIC_RISK_AGE_MS,
    accountConfig: FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_ACCOUNT_CONFIGURATION_AGE_MS,
    symbolConfig: FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_ACCOUNT_CONFIGURATION_AGE_MS,
    positions: FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_DYNAMIC_RISK_AGE_MS,
    balance: FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_DYNAMIC_RISK_AGE_MS,
    regularOpenOrders: FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_DYNAMIC_RISK_AGE_MS,
    algoOpenOrders: FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_DYNAMIC_RISK_AGE_MS,
});

export const FUTURES_TESTNET_EXECUTION_RISK_REASONS = Object.freeze({
    INVALID_INPUT: 'INVALID_INPUT',
    INVALID_POLICY: 'INVALID_POLICY',
    SYMBOL_IDENTITY: 'SYMBOL_IDENTITY',
    STALE_OR_MIXED_DATA: 'STALE_OR_MIXED_DATA',
    EXCHANGE_CONTRACT: 'EXCHANGE_CONTRACT',
    FILTER_SCHEMA: 'FILTER_SCHEMA',
    ACCOUNT_PERMISSION: 'ACCOUNT_PERMISSION',
    POSITION_MODE: 'POSITION_MODE',
    POSITION_IDENTITY: 'POSITION_IDENTITY',
    POSITION_ZERO: 'POSITION_ZERO',
    MARGIN_STATE: 'MARGIN_STATE',
    LEVERAGE_STATE: 'LEVERAGE_STATE',
    REDUCE_ONLY_STATE: 'REDUCE_ONLY_STATE',
    PRICE_FILTER: 'PRICE_FILTER',
    PERCENT_PRICE: 'PERCENT_PRICE',
    QUANTITY_FILTER: 'QUANTITY_FILTER',
    NOTIONAL_LIMIT: 'NOTIONAL_LIMIT',
    LIQUIDATION_DISTANCE: 'LIQUIDATION_DISTANCE',
});

const TOP_LEVEL_FIELDS = Object.freeze(['command', 'policy', 'ownership', 'observations']);
const POLICY_FIELDS = Object.freeze([
    'allowedSymbols',
    'maxNotionalUsdt',
    'maxLeverage',
    'minAvailableBalanceUsdt',
    'minLiquidationDistanceBps',
]);
const OWNERSHIP_FIELDS = Object.freeze([
    'environment',
    'symbol',
    'credentialIdentity',
    'accountIdentity',
    'connectionIdentity',
    'generation',
    'selectedMetadataDigest',
    'currentMetadataDigest',
    'selectedMetadataVersion',
    'currentMetadataVersion',
    'selectedMetadataGeneration',
    'currentMetadataGeneration',
    'validationToDispatchAgeMs',
]);
const OBSERVATIONS_FIELDS = Object.freeze([
    'serverTime',
    'exchangeInfo',
    'markPrice',
    'accountConfig',
    'symbolConfig',
    'positions',
    'balance',
    'regularOpenOrders',
    'algoOpenOrders',
]);
const OBSERVATION_FIELDS = Object.freeze([
    'data',
    'complete',
    'connected',
    'environment',
    'symbol',
    'credentialIdentity',
    'accountIdentity',
    'connectionIdentity',
    'generation',
    'ageMs',
    'futureDated',
    'regressed',
]);

const SERVER_TIME_FIELDS = Object.freeze(['serverTime', 'roundTripMs']);
const EXCHANGE_INFO_FIELDS = Object.freeze([
    'symbol',
    'status',
    'contractType',
    'quoteAsset',
    'marginAsset',
    'supportedOrderTypes',
    'supportedTimeInForce',
    'filters',
    'metadataDigest',
    'metadataVersion',
    'metadataGeneration',
]);
const FILTER_FIELDS = Object.freeze([
    'price',
    'percentPrice',
    'lotSize',
    'minNotional',
    'maxNumOrders',
]);
const PRICE_FILTER_FIELDS = Object.freeze(['minPrice', 'maxPrice', 'tickSize']);
const PERCENT_PRICE_FILTER_FIELDS = Object.freeze([
    'multiplierUp',
    'multiplierDown',
    'multiplierDecimal',
]);
const LOT_SIZE_FILTER_FIELDS = Object.freeze(['minQty', 'maxQty', 'stepSize']);
const MIN_NOTIONAL_FILTER_FIELDS = Object.freeze(['notional']);
const MAX_NUM_ORDERS_FILTER_FIELDS = Object.freeze(['limit']);
const MARK_PRICE_FIELDS = Object.freeze(['symbol', 'markPrice']);
const ACCOUNT_CONFIG_FIELDS = Object.freeze([
    'canTrade',
    'dualSidePosition',
    'multiAssetsMargin',
]);
const SYMBOL_CONFIG_FIELDS = Object.freeze([
    'symbol',
    'marginType',
    'isAutoAddMargin',
    'leverage',
    'maxNotionalValue',
]);
const POSITIONS_FIELDS = Object.freeze(['positions']);
const POSITION_FIELDS = Object.freeze([
    'symbol',
    'positionSide',
    'positionAmt',
    'liquidationPrice',
    'marginAsset',
    'notional',
    'isolatedWallet',
    'isolatedMargin',
    'initialMargin',
    'maintMargin',
    'positionInitialMargin',
    'openOrderInitialMargin',
]);
const BALANCE_FIELDS = Object.freeze(['balances']);
const BALANCE_ROW_FIELDS = Object.freeze(['asset', 'availableBalance', 'marginAvailable']);
const ORDERS_FIELDS = Object.freeze(['orders']);
const MAX_SAFE_INTEGER = 9007199254740991;

class RiskInputError extends Error {}

const reject = (code, reason) => Object.freeze({ ok: false, code, reason });
const accept = () => Object.freeze({ ok: true });

const isSafeNonNegativeInteger = (value) => (
    typeof value === 'number'
    && value <= MAX_SAFE_INTEGER
    && value % 1 === 0
    && !Object.is(value, -0)
    && value >= 0
);

const isExactIdentity = (value) => (
    typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && value.trim() === value
);

const readExactDataProperties = (value, expectedFields) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new RiskInputError();
    }
    let prototype;
    let keys;
    try {
        prototype = Object.getPrototypeOf(value);
        keys = Reflect.ownKeys(value);
    } catch {
        throw new RiskInputError();
    }
    const expected = new Set(expectedFields);
    if (prototype !== Object.prototype
        || keys.length !== expectedFields.length
        || keys.some((key) => typeof key !== 'string' || !expected.has(key))) {
        throw new RiskInputError();
    }

    const values = Object.create(null);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) {
            throw new RiskInputError();
        }
        values[key] = descriptor.value;
    }
    return values;
};

const readDenseArray = (value) => {
    if (!Array.isArray(value)) throw new RiskInputError();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) {
        throw new RiskInputError();
    }
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        if (!Object.hasOwn(value, key)) throw new RiskInputError();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) {
            throw new RiskInputError();
        }
        result.push(descriptor.value);
    }
    return result;
};

const readExactStringArray = (value) => {
    const values = readDenseArray(value);
    if (values.some((entry) => !isExactIdentity(entry))
        || new Set(values).size !== values.length) {
        throw new RiskInputError();
    }
    return values;
};

const parsePolicy = (value) => {
    const policy = readExactDataProperties(value, POLICY_FIELDS);
    const allowedSymbols = readExactStringArray(policy.allowedSymbols);
    if (allowedSymbols.length < 1
        || allowedSymbols.length > 16
        || allowedSymbols.some((symbol) => !/^[A-Z0-9]{2,20}$/.test(symbol))) {
        throw new RiskInputError();
    }
    const maxNotional = parsePositiveExactDecimal(policy.maxNotionalUsdt);
    const minAvailableBalance = parsePositiveExactDecimal(policy.minAvailableBalanceUsdt);
    const hardMaxNotional = parsePositiveExactDecimal(
        FUTURES_TESTNET_EXECUTION_RISK_LIMITS.HARD_MAX_NOTIONAL_USDT,
    );
    const minimumBps = parseCanonicalUnsignedInteger(
        policy.minLiquidationDistanceBps,
        { maxDigits: 5 },
    );
    const hardMinimumBps = parseCanonicalUnsignedInteger(
        FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MIN_LIQUIDATION_DISTANCE_BPS,
        { maxDigits: 5 },
    );
    const hardMaximumBps = parseCanonicalUnsignedInteger(
        FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_LIQUIDATION_DISTANCE_BPS,
        { maxDigits: 5 },
    );

    if (compareExactDecimals(maxNotional, hardMaxNotional) > 0
        || typeof policy.maxLeverage !== 'number'
        || !isSafeNonNegativeInteger(policy.maxLeverage)
        || policy.maxLeverage < 1
        || policy.maxLeverage > FUTURES_TESTNET_EXECUTION_RISK_LIMITS.HARD_MAX_LEVERAGE
        || minimumBps < hardMinimumBps
        || minimumBps > hardMaximumBps) {
        throw new RiskInputError();
    }
    return {
        allowedSymbols,
        maxNotional,
        maxLeverage: policy.maxLeverage,
        minAvailableBalance,
        minLiquidationDistanceBps: policy.minLiquidationDistanceBps,
    };
};

const parseOwnership = (value) => {
    const ownership = readExactDataProperties(value, OWNERSHIP_FIELDS);
    const identityFields = [
        'credentialIdentity',
        'accountIdentity',
        'connectionIdentity',
        'generation',
        'selectedMetadataDigest',
        'currentMetadataDigest',
        'selectedMetadataVersion',
        'currentMetadataVersion',
        'selectedMetadataGeneration',
        'currentMetadataGeneration',
    ];
    if (ownership.environment !== FUTURES_TESTNET_EXECUTION_ENVIRONMENT
        || typeof ownership.symbol !== 'string'
        || !/^[A-Z0-9]{2,20}$/.test(ownership.symbol)
        || identityFields.some((field) => !isExactIdentity(ownership[field]))
        || !isSafeNonNegativeInteger(ownership.validationToDispatchAgeMs)) {
        throw new RiskInputError();
    }
    return ownership;
};

const parseObservations = (value, ownership) => {
    const collection = readExactDataProperties(value, OBSERVATIONS_FIELDS);
    const observations = Object.create(null);

    for (const name of OBSERVATIONS_FIELDS) {
        const observation = readExactDataProperties(collection[name], OBSERVATION_FIELDS);
        if (observation.complete !== true
            || observation.connected !== true
            || observation.environment !== ownership.environment
            || observation.credentialIdentity !== ownership.credentialIdentity
            || observation.accountIdentity !== ownership.accountIdentity
            || observation.connectionIdentity !== ownership.connectionIdentity
            || observation.generation !== ownership.generation
            || !isSafeNonNegativeInteger(observation.ageMs)
            || observation.ageMs > OBSERVATION_MAXIMUM_AGES[name]
            || observation.futureDated !== false
            || observation.regressed !== false) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
            );
        }
        if (observation.symbol !== ownership.symbol) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.SYMBOL_IDENTITY,
            );
        }
        observations[name] = observation.data;
    }
    return observations;
};

const parseFilterMetadata = (value) => {
    const filters = readExactDataProperties(value, FILTER_FIELDS);
    const price = readExactDataProperties(filters.price, PRICE_FILTER_FIELDS);
    const percentPrice = readExactDataProperties(
        filters.percentPrice,
        PERCENT_PRICE_FILTER_FIELDS,
    );
    const lotSize = readExactDataProperties(filters.lotSize, LOT_SIZE_FILTER_FIELDS);
    const minNotional = readExactDataProperties(
        filters.minNotional,
        MIN_NOTIONAL_FILTER_FIELDS,
    );
    const maxNumOrders = readExactDataProperties(
        filters.maxNumOrders,
        MAX_NUM_ORDERS_FILTER_FIELDS,
    );

    const minPrice = parseNonNegativeExactDecimal(price.minPrice);
    const maxPrice = parseNonNegativeExactDecimal(price.maxPrice);
    const tickSize = parsePositiveExactDecimal(price.tickSize);
    const multiplierUp = parsePositiveExactDecimal(percentPrice.multiplierUp);
    const multiplierDown = parsePositiveExactDecimal(percentPrice.multiplierDown);
    const multiplierDecimal = parseCanonicalUnsignedInteger(
        percentPrice.multiplierDecimal,
        { maxDigits: 2 },
    );
    const minQty = parsePositiveExactDecimal(lotSize.minQty);
    const maxQty = parsePositiveExactDecimal(lotSize.maxQty);
    const stepSize = parsePositiveExactDecimal(lotSize.stepSize);
    const minimumNotional = parsePositiveExactDecimal(minNotional.notional);

    if (multiplierDecimal > 18n
        || BigInt(multiplierUp.scale) !== multiplierDecimal
        || BigInt(multiplierDown.scale) !== multiplierDecimal
        || compareExactDecimals(multiplierDown, multiplierUp) > 0
        || (isPositiveExactDecimal(minPrice)
            && isPositiveExactDecimal(maxPrice)
            && compareExactDecimals(minPrice, maxPrice) > 0)
        || compareExactDecimals(minQty, maxQty) > 0
        || !isExactIncrement(maxQty, stepSize, minQty)
        || typeof maxNumOrders.limit !== 'number'
        || !isSafeNonNegativeInteger(maxNumOrders.limit)
        || maxNumOrders.limit < 1) {
        throw new RiskInputError();
    }

    return {
        minPrice,
        maxPrice,
        tickSize,
        multiplierUp,
        multiplierDown,
        minQty,
        maxQty,
        stepSize,
        minimumNotional,
        maxNumOrders: maxNumOrders.limit,
    };
};

const parseExchangeInfo = (value, ownership) => {
    const exchange = readExactDataProperties(value, EXCHANGE_INFO_FIELDS);
    const supportedOrderTypes = readExactStringArray(exchange.supportedOrderTypes);
    const supportedTimeInForce = readExactStringArray(exchange.supportedTimeInForce);
    if (exchange.symbol !== ownership.symbol) {
        return reject(
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.SYMBOL_IDENTITY,
        );
    }
    if (exchange.metadataDigest !== ownership.selectedMetadataDigest
        || exchange.metadataVersion !== ownership.selectedMetadataVersion
        || exchange.metadataGeneration !== ownership.selectedMetadataGeneration) {
        return reject(
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
        );
    }
    if (exchange.status !== 'TRADING'
        || exchange.contractType !== 'PERPETUAL'
        || exchange.quoteAsset !== 'USDT'
        || exchange.marginAsset !== 'USDT'
        || !supportedOrderTypes.includes('LIMIT')
        || !supportedTimeInForce.includes('GTC')) {
        return reject(
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.EXCHANGE_CONTRACT,
        );
    }
    try {
        return parseFilterMetadata(exchange.filters);
    } catch (error) {
        if (!(error instanceof RiskInputError)
            && !(error instanceof FuturesTestnetDecimalError)) throw error;
        return reject(
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.FILTER_SCHEMA,
        );
    }
};

const validatePriceAndQuantityFilters = ({ command, price, quantity, markPrice, filters }) => {
    if ((isPositiveExactDecimal(filters.minPrice)
            && compareExactDecimals(price, filters.minPrice) < 0)
        || (isPositiveExactDecimal(filters.maxPrice)
            && compareExactDecimals(price, filters.maxPrice) > 0)
        || !isExactIncrement(price, filters.tickSize, filters.minPrice)) {
        return reject(
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.PRICE_FILTER,
        );
    }

    const percentUpper = multiplyExactDecimals(markPrice, filters.multiplierUp);
    const percentLower = multiplyExactDecimals(markPrice, filters.multiplierDown);
    const percentRejected = command.side === 'BUY'
        ? compareExactDecimals(price, percentUpper) > 0
            || compareExactDecimals(price, percentLower) < 0
        : compareExactDecimals(price, percentLower) < 0
            || compareExactDecimals(price, percentUpper) > 0;
    if (percentRejected) {
        return reject(
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.PERCENT_PRICE,
        );
    }

    if (compareExactDecimals(quantity, filters.minQty) < 0
        || compareExactDecimals(quantity, filters.maxQty) > 0
        || !isExactIncrement(quantity, filters.stepSize, filters.minQty)) {
        return reject(
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.QUANTITY_FILTER,
        );
    }
    return null;
};

const validateNotional = ({ price, quantity, markPrice, filters, policy, symbolMaximum }) => {
    const limitNotional = multiplyExactDecimals(price, quantity);
    const conservativeNotional = multiplyExactDecimals(
        maxExactDecimal(price, markPrice),
        quantity,
    );
    if (compareExactDecimals(limitNotional, filters.minimumNotional) < 0
        || compareExactDecimals(conservativeNotional, policy.maxNotional) > 0
        || compareExactDecimals(conservativeNotional, symbolMaximum) > 0) {
        return reject(
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.NOTIONAL_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.NOTIONAL_LIMIT,
        );
    }
    return null;
};

export const evaluateFuturesTestnetExecutionRisk = (input) => {
    try {
        const root = readExactDataProperties(input, TOP_LEVEL_FIELDS);
        let policy;
        try {
            policy = parsePolicy(root.policy);
        } catch (error) {
            if (!(error instanceof RiskInputError)
                && !(error instanceof FuturesTestnetDecimalError)) throw error;
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_POLICY,
            );
        }
        const ownership = parseOwnership(root.ownership);
        let command;
        try {
            command = validateFuturesTestnetExecutionCommandObject(root.command, {
                allowedSymbols: policy.allowedSymbols,
            });
        } catch (error) {
            if (!(error instanceof FuturesTestnetExecutionProtocolError)) throw error;
            if (error.code === FUTURES_TESTNET_EXECUTION_PROTOCOL_ERROR_CODES.INVALID_SYMBOL) {
                return reject(
                    FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED,
                    FUTURES_TESTNET_EXECUTION_RISK_REASONS.SYMBOL_IDENTITY,
                );
            }
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_INPUT,
            );
        }

        if (command.marketType !== FUTURES_TESTNET_EXECUTION_MARKET_TYPE
            || command.environment !== ownership.environment
            || command.symbol !== ownership.symbol
            || !policy.allowedSymbols.includes(command.symbol)) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.SYMBOL_IDENTITY,
            );
        }
        if (ownership.selectedMetadataDigest !== ownership.currentMetadataDigest
            || ownership.selectedMetadataVersion !== ownership.currentMetadataVersion
            || ownership.selectedMetadataGeneration !== ownership.currentMetadataGeneration
            || ownership.selectedMetadataGeneration !== ownership.generation
            || ownership.validationToDispatchAgeMs
                > FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_VALIDATION_TO_DISPATCH_AGE_MS) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
            );
        }

        const observations = parseObservations(root.observations, ownership);
        if (observations.ok === false) return observations;

        const serverTime = readExactDataProperties(observations.serverTime, SERVER_TIME_FIELDS);
        if (!isSafeNonNegativeInteger(serverTime.serverTime)
            || serverTime.serverTime === 0
            || !isSafeNonNegativeInteger(serverTime.roundTripMs)
            || serverTime.roundTripMs
                > FUTURES_TESTNET_EXECUTION_RISK_LIMITS.MAX_SERVER_TIME_ROUND_TRIP_MS) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.STALE_OR_MIXED_DATA,
            );
        }

        const filters = parseExchangeInfo(observations.exchangeInfo, ownership);
        if (filters.ok === false) return filters;

        const mark = readExactDataProperties(observations.markPrice, MARK_PRICE_FIELDS);
        if (mark.symbol !== command.symbol) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.SYMBOL_IDENTITY,
            );
        }
        const markPrice = parsePositiveExactDecimal(mark.markPrice);
        const price = parsePositiveExactDecimal(command.price);
        const quantity = parsePositiveExactDecimal(command.quantity);

        const account = readExactDataProperties(observations.accountConfig, ACCOUNT_CONFIG_FIELDS);
        if (account.canTrade !== true) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.ACCOUNT_PERMISSION,
            );
        }
        if (account.dualSidePosition !== false) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_MODE,
            );
        }
        if (account.multiAssetsMargin !== false) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
            );
        }

        const symbolConfig = readExactDataProperties(
            observations.symbolConfig,
            SYMBOL_CONFIG_FIELDS,
        );
        if (symbolConfig.symbol !== command.symbol) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.SYMBOL_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.SYMBOL_IDENTITY,
            );
        }
        if (symbolConfig.marginType !== 'ISOLATED'
            || symbolConfig.marginType !== command.marginType
            || symbolConfig.isAutoAddMargin !== false) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
            );
        }
        if (typeof symbolConfig.leverage !== 'number'
            || !isSafeNonNegativeInteger(symbolConfig.leverage)
            || symbolConfig.leverage !== command.leverage
            || symbolConfig.leverage > policy.maxLeverage
            || symbolConfig.leverage
                > FUTURES_TESTNET_EXECUTION_RISK_LIMITS.HARD_MAX_LEVERAGE) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.LEVERAGE_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.LEVERAGE_STATE,
            );
        }
        const symbolMaximum = parsePositiveExactDecimal(symbolConfig.maxNotionalValue);

        const positionsData = readExactDataProperties(observations.positions, POSITIONS_FIELDS);
        const positionRows = readDenseArray(positionsData.positions);
        if (positionRows.length !== 1) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_IDENTITY,
            );
        }
        const position = readExactDataProperties(positionRows[0], POSITION_FIELDS);
        if (position.symbol !== command.symbol || position.positionSide !== 'BOTH') {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_IDENTITY,
            );
        }
        let positionAmount;
        try {
            positionAmount = parseSignedExactDecimal(position.positionAmt);
        } catch (error) {
            if (!(error instanceof FuturesTestnetDecimalError)) throw error;
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_IDENTITY,
            );
        }
        if (!isPositiveExactDecimal(absoluteExactDecimal(positionAmount))) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.POSITION_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.POSITION_ZERO,
            );
        }
        if (position.marginAsset !== 'USDT') {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
            );
        }
        parseSignedExactDecimal(position.notional);
        let liquidationPrice;
        try {
            liquidationPrice = parseNonNegativeExactDecimal(position.liquidationPrice);
        } catch (error) {
            if (!(error instanceof FuturesTestnetDecimalError)) throw error;
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.LIQUIDATION_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.LIQUIDATION_DISTANCE,
            );
        }
        try {
            for (const field of [
                'isolatedWallet',
                'isolatedMargin',
                'initialMargin',
                'maintMargin',
                'positionInitialMargin',
                'openOrderInitialMargin',
            ]) {
                parseNonNegativeExactDecimal(position[field]);
            }
        } catch (error) {
            if (!(error instanceof FuturesTestnetDecimalError)) throw error;
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
            );
        }

        const balanceData = readExactDataProperties(observations.balance, BALANCE_FIELDS);
        const balanceRows = readDenseArray(balanceData.balances).map((row) => (
            readExactDataProperties(row, BALANCE_ROW_FIELDS)
        ));
        if (balanceRows.length !== 1 || balanceRows[0].asset !== 'USDT') {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
            );
        }
        try {
            for (const row of balanceRows) {
                if (!isExactIdentity(row.asset)) throw new RiskInputError();
                parseSignedExactDecimal(row.availableBalance);
                if (typeof row.marginAvailable !== 'boolean') throw new RiskInputError();
            }
        } catch (error) {
            if (!(error instanceof RiskInputError)
                && !(error instanceof FuturesTestnetDecimalError)) throw error;
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
            );
        }
        const usdtBalance = balanceRows[0];
        let availableBalance;
        try {
            availableBalance = parseNonNegativeExactDecimal(usdtBalance.availableBalance);
        } catch (error) {
            if (!(error instanceof FuturesTestnetDecimalError)) throw error;
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
            );
        }
        if (usdtBalance.marginAvailable !== true
            || compareExactDecimals(availableBalance, policy.minAvailableBalance) < 0) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.MARGIN_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.MARGIN_STATE,
            );
        }

        const regularOrders = readExactDataProperties(
            observations.regularOpenOrders,
            ORDERS_FIELDS,
        );
        const algoOrders = readExactDataProperties(observations.algoOpenOrders, ORDERS_FIELDS);
        if (readDenseArray(regularOrders.orders).length !== 0
            || readDenseArray(algoOrders.orders).length !== 0) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.REDUCE_ONLY_STATE,
            );
        }
        if (filters.maxNumOrders < 1) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.FILTER_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.FILTER_SCHEMA,
            );
        }

        const longPosition = positionAmount.coefficient > 0n;
        const expectedSide = longPosition ? 'SELL' : 'BUY';
        if (command.side !== expectedSide
            || compareExactDecimals(quantity, absoluteExactDecimal(positionAmount)) > 0) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.REDUCE_ONLY_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.REDUCE_ONLY_STATE,
            );
        }

        const filterRejection = validatePriceAndQuantityFilters({
            command,
            price,
            quantity,
            markPrice,
            filters,
        });
        if (filterRejection) return filterRejection;

        const notionalRejection = validateNotional({
            price,
            quantity,
            markPrice,
            filters,
            policy,
            symbolMaximum,
        });
        if (notionalRejection) return notionalRejection;

        const liquidationNumerator = longPosition
            ? subtractExactDecimals(markPrice, liquidationPrice)
            : subtractExactDecimals(liquidationPrice, markPrice);
        if (!isPositiveExactDecimal(liquidationPrice)
            || !isPositiveExactDecimal(liquidationNumerator)
            || compareBasisPointRatio(
                liquidationNumerator,
                markPrice,
                policy.minLiquidationDistanceBps,
            ) < 0) {
            return reject(
                FUTURES_TESTNET_EXECUTION_SAFE_CODES.LIQUIDATION_REJECTED,
                FUTURES_TESTNET_EXECUTION_RISK_REASONS.LIQUIDATION_DISTANCE,
            );
        }

        return accept();
    } catch (error) {
        if (!(error instanceof RiskInputError)
            && !(error instanceof FuturesTestnetDecimalError)
            && !(error instanceof FuturesTestnetExecutionProtocolError)) {
            throw error;
        }
        return reject(
            FUTURES_TESTNET_EXECUTION_SAFE_CODES.RISK_DATA_REJECTED,
            FUTURES_TESTNET_EXECUTION_RISK_REASONS.INVALID_INPUT,
        );
    }
};
