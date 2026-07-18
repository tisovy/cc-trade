import {
    absoluteExactDecimal,
    addExactDecimals,
    compareBasisPointRatio,
    compareExactDecimals,
    formatExactDecimal,
    isExactIncrement,
    isPositiveExactDecimal,
    isZeroExactDecimal,
    maxExactDecimal,
    multiplyExactDecimals,
    parseNonNegativeExactDecimal,
    parsePositiveExactDecimal,
    parseSignedExactDecimal,
    subtractExactDecimals,
} from './futures-production-execution-decimal.js';
import {
    FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS,
    FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
} from './futures-production-execution-config.js';

export const FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS = Object.freeze({
    OPENING: 'opening',
    INCREASING: 'increasing',
    REDUCING: 'reducing',
});

export const FUTURES_PRODUCTION_EXECUTION_RISK_CODES = Object.freeze({
    INVALID_INPUT: 'FUTURES_PRODUCTION_RISK_INVALID_INPUT',
    POLICY_REJECTED: 'FUTURES_PRODUCTION_RISK_POLICY_REJECTED',
    IDENTITY_REJECTED: 'FUTURES_PRODUCTION_RISK_IDENTITY_REJECTED',
    SNAPSHOT_REJECTED: 'FUTURES_PRODUCTION_RISK_SNAPSHOT_REJECTED',
    ACCOUNT_REJECTED: 'FUTURES_PRODUCTION_RISK_ACCOUNT_REJECTED',
    SYMBOL_REJECTED: 'FUTURES_PRODUCTION_RISK_SYMBOL_REJECTED',
    LEVERAGE_REJECTED: 'FUTURES_PRODUCTION_RISK_LEVERAGE_REJECTED',
    ORDER_REJECTED: 'FUTURES_PRODUCTION_RISK_ORDER_REJECTED',
    CLASSIFICATION_REJECTED: 'FUTURES_PRODUCTION_RISK_CLASSIFICATION_REJECTED',
    KILL_SWITCH_BLOCKED: 'FUTURES_PRODUCTION_RISK_KILL_SWITCH_BLOCKED',
    ORDER_NOTIONAL_REJECTED: 'FUTURES_PRODUCTION_RISK_ORDER_NOTIONAL_REJECTED',
    DAILY_NOTIONAL_REJECTED: 'FUTURES_PRODUCTION_RISK_DAILY_NOTIONAL_REJECTED',
    BALANCE_REJECTED: 'FUTURES_PRODUCTION_RISK_BALANCE_REJECTED',
    LIQUIDATION_REJECTED: 'FUTURES_PRODUCTION_RISK_LIQUIDATION_REJECTED',
});

export const FUTURES_PRODUCTION_EXECUTION_RISK_REASONS = Object.freeze({
    INPUT_SCHEMA: 'INPUT_SCHEMA',
    POLICY_SCHEMA: 'POLICY_SCHEMA',
    IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
    SNAPSHOT_INCOMPLETE: 'SNAPSHOT_INCOMPLETE',
    ACCOUNT_STATE: 'ACCOUNT_STATE',
    SYMBOL_STATE: 'SYMBOL_STATE',
    LEVERAGE_STATE: 'LEVERAGE_STATE',
    ORDER_SCHEMA: 'ORDER_SCHEMA',
    PRICE_FILTER: 'PRICE_FILTER',
    QUANTITY_FILTER: 'QUANTITY_FILTER',
    OPEN_ORDER_LIMIT: 'OPEN_ORDER_LIMIT',
    EXPOSURE_AMBIGUOUS: 'EXPOSURE_AMBIGUOUS',
    KILL_SWITCH: 'KILL_SWITCH',
    MINIMUM_NOTIONAL: 'MINIMUM_NOTIONAL',
    MAXIMUM_ORDER_NOTIONAL: 'MAXIMUM_ORDER_NOTIONAL',
    MAXIMUM_DAILY_NOTIONAL: 'MAXIMUM_DAILY_NOTIONAL',
    AVAILABLE_BALANCE: 'AVAILABLE_BALANCE',
    LIQUIDATION_DISTANCE: 'LIQUIDATION_DISTANCE',
});

const TOP_LEVEL_FIELDS = Object.freeze([
    'policy',
    'identity',
    'snapshot',
    'draft',
    'killSwitchEngaged',
    'dailyNotionalUsed',
]);
const POLICY_FIELDS = Object.freeze([
    'allowedSymbols',
    'maxLeverage',
    'maxOrderNotionalUsdt',
    'maxDailyNotionalUsdt',
    'minAvailableBalanceUsdt',
    'minLiquidationDistanceBps',
    'killSwitchPolicy',
]);
const IDENTITY_FIELDS = Object.freeze([
    'environment',
    'accountAlias',
    'apiKeyFingerprint',
    'credentialBinding',
    'generation',
]);
const SNAPSHOT_FIELDS = Object.freeze([
    ...IDENTITY_FIELDS,
    'complete',
    'fresh',
    'clockRegressed',
    'accountConfig',
    'symbolConfig',
    'markPrice',
    'position',
    'balance',
    'exchangeInfo',
    'regularOpenOrderCount',
    'algoOpenOrderCount',
]);
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
const MARK_PRICE_FIELDS = Object.freeze(['symbol', 'markPrice']);
const POSITION_FIELDS = Object.freeze([
    'symbol',
    'positionSide',
    'positionAmt',
    'liquidationPrice',
    'marginAsset',
]);
const BALANCE_FIELDS = Object.freeze(['asset', 'availableBalance', 'marginAvailable']);
const EXCHANGE_INFO_FIELDS = Object.freeze([
    'symbol',
    'status',
    'contractType',
    'quoteAsset',
    'marginAsset',
    'supportedOrderTypes',
    'supportedTimeInForce',
    'priceFilter',
    'percentPriceFilter',
    'lotSizeFilter',
    'minNotionalUsdt',
    'maxOpenOrders',
]);
const PRICE_FILTER_FIELDS = Object.freeze(['minPrice', 'maxPrice', 'tickSize']);
const PERCENT_PRICE_FIELDS = Object.freeze(['multiplierUp', 'multiplierDown']);
const LOT_SIZE_FIELDS = Object.freeze(['minQty', 'maxQty', 'stepSize']);
const DRAFT_FIELDS = Object.freeze([
    'symbol',
    'side',
    'positionSide',
    'positionEffect',
    'type',
    'timeInForce',
    'quantity',
    'price',
]);

const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/;
const ACCOUNT_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const GENERATION_PATTERN = /^[\x21-\x7e]{1,128}$/;
const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const HARD_MAX_ORDER_NOTIONAL = parsePositiveExactDecimal(
    FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS.maxOrderNotionalUsdt,
);
const HARD_MAX_DAILY_NOTIONAL = parsePositiveExactDecimal(
    FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS.maxDailyNotionalUsdt,
);

class RiskInputError extends Error {}

const reject = (code, reason) => Object.freeze({ ok: false, code, reason });

const isSafeNonNegativeInteger = value => (
    typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0)
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
        || keys.length !== expected.size
        || keys.some(key => typeof key !== 'string' || !expected.has(key))) {
        throw new RiskInputError();
    }
    const result = Object.create(null);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) throw new RiskInputError();
        result[key] = descriptor.value;
    }
    return result;
};

const readExactStringArray = (value, pattern, maximumLength = 16) => {
    if (!Array.isArray(value)
        || Object.getPrototypeOf(value) !== Array.prototype
        || value.length < 1
        || value.length > maximumLength
        || Reflect.ownKeys(value).length !== value.length + 1) {
        throw new RiskInputError();
    }
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')
            || typeof descriptor.value !== 'string'
            || !pattern.test(descriptor.value)) throw new RiskInputError();
        result.push(descriptor.value);
    }
    if (new Set(result).size !== result.length) throw new RiskInputError();
    return result;
};

const parsePolicy = (value) => {
    const policy = readExactDataProperties(value, POLICY_FIELDS);
    const allowedSymbols = readExactStringArray(policy.allowedSymbols, SYMBOL_PATTERN);
    const maxOrderNotional = parsePositiveExactDecimal(policy.maxOrderNotionalUsdt);
    const maxDailyNotional = parsePositiveExactDecimal(policy.maxDailyNotionalUsdt);
    const minAvailableBalance = parsePositiveExactDecimal(policy.minAvailableBalanceUsdt);
    if (!Number.isSafeInteger(policy.maxLeverage)
        || policy.maxLeverage !== FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS.maxLeverage
        || compareExactDecimals(maxOrderNotional, HARD_MAX_ORDER_NOTIONAL) > 0
        || compareExactDecimals(maxDailyNotional, HARD_MAX_DAILY_NOTIONAL) > 0
        || typeof policy.minLiquidationDistanceBps !== 'string'
        || !/^[1-9][0-9]{3,4}$/.test(policy.minLiquidationDistanceBps)
        || BigInt(policy.minLiquidationDistanceBps) < 1000n
        || BigInt(policy.minLiquidationDistanceBps) > 10000n
        || policy.killSwitchPolicy !== FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY) {
        throw new RiskInputError();
    }
    return Object.freeze({
        allowedSymbols,
        maxLeverage: policy.maxLeverage,
        maxOrderNotional,
        maxDailyNotional,
        minAvailableBalance,
        minLiquidationDistanceBps: policy.minLiquidationDistanceBps,
    });
};

const parseIdentity = (value) => {
    const identity = readExactDataProperties(value, IDENTITY_FIELDS);
    if (identity.environment !== 'production'
        || typeof identity.accountAlias !== 'string'
        || !ACCOUNT_ALIAS_PATTERN.test(identity.accountAlias)
        || typeof identity.apiKeyFingerprint !== 'string'
        || !DIGEST_PATTERN.test(identity.apiKeyFingerprint)
        || typeof identity.credentialBinding !== 'string'
        || !DIGEST_PATTERN.test(identity.credentialBinding)
        || typeof identity.generation !== 'string'
        || !GENERATION_PATTERN.test(identity.generation)) throw new RiskInputError();
    return identity;
};

const identitiesMatch = (identity, snapshot) => IDENTITY_FIELDS.every(
    field => identity[field] === snapshot[field],
);

const parseSnapshot = (value, identity) => {
    const snapshot = readExactDataProperties(value, SNAPSHOT_FIELDS);
    if (!identitiesMatch(identity, snapshot)
        || snapshot.complete !== true
        || snapshot.fresh !== true
        || snapshot.clockRegressed !== false
        || !isSafeNonNegativeInteger(snapshot.regularOpenOrderCount)
        || !isSafeNonNegativeInteger(snapshot.algoOpenOrderCount)) throw new RiskInputError();

    const accountConfig = readExactDataProperties(snapshot.accountConfig, ACCOUNT_CONFIG_FIELDS);
    const symbolConfig = readExactDataProperties(snapshot.symbolConfig, SYMBOL_CONFIG_FIELDS);
    const markPrice = readExactDataProperties(snapshot.markPrice, MARK_PRICE_FIELDS);
    const position = readExactDataProperties(snapshot.position, POSITION_FIELDS);
    const balance = readExactDataProperties(snapshot.balance, BALANCE_FIELDS);
    const exchangeInfo = readExactDataProperties(snapshot.exchangeInfo, EXCHANGE_INFO_FIELDS);
    const priceFilter = readExactDataProperties(exchangeInfo.priceFilter, PRICE_FILTER_FIELDS);
    const percentPriceFilter = readExactDataProperties(
        exchangeInfo.percentPriceFilter,
        PERCENT_PRICE_FIELDS,
    );
    const lotSizeFilter = readExactDataProperties(exchangeInfo.lotSizeFilter, LOT_SIZE_FIELDS);

    if (typeof accountConfig.canTrade !== 'boolean'
        || typeof accountConfig.dualSidePosition !== 'boolean'
        || typeof accountConfig.multiAssetsMargin !== 'boolean'
        || typeof symbolConfig.symbol !== 'string'
        || !SYMBOL_PATTERN.test(symbolConfig.symbol)
        || typeof symbolConfig.marginType !== 'string'
        || typeof symbolConfig.isAutoAddMargin !== 'boolean'
        || !Number.isSafeInteger(symbolConfig.leverage)
        || symbolConfig.leverage < 1
        || typeof markPrice.symbol !== 'string'
        || !SYMBOL_PATTERN.test(markPrice.symbol)
        || typeof position.symbol !== 'string'
        || !SYMBOL_PATTERN.test(position.symbol)
        || typeof position.positionSide !== 'string'
        || typeof position.marginAsset !== 'string'
        || typeof balance.asset !== 'string'
        || typeof balance.marginAvailable !== 'boolean'
        || typeof exchangeInfo.symbol !== 'string'
        || !SYMBOL_PATTERN.test(exchangeInfo.symbol)
        || typeof exchangeInfo.status !== 'string'
        || typeof exchangeInfo.contractType !== 'string'
        || typeof exchangeInfo.quoteAsset !== 'string'
        || typeof exchangeInfo.marginAsset !== 'string'
        || !Number.isSafeInteger(exchangeInfo.maxOpenOrders)
        || exchangeInfo.maxOpenOrders < 1) throw new RiskInputError();

    const supportedOrderTypes = readExactStringArray(
        exchangeInfo.supportedOrderTypes,
        /^[A-Z_]{1,32}$/,
        16,
    );
    const supportedTimeInForce = readExactStringArray(
        exchangeInfo.supportedTimeInForce,
        /^[A-Z_]{1,16}$/,
        16,
    );
    const parsed = {
        source: snapshot,
        accountConfig,
        symbolConfig: {
            ...symbolConfig,
            maxNotionalValue: parsePositiveExactDecimal(symbolConfig.maxNotionalValue),
        },
        markPrice: {
            ...markPrice,
            parsed: parsePositiveExactDecimal(markPrice.markPrice),
        },
        position: {
            ...position,
            amount: parseSignedExactDecimal(position.positionAmt),
            liquidationPrice: parseNonNegativeExactDecimal(position.liquidationPrice),
        },
        balance: {
            ...balance,
            availableBalance: parseNonNegativeExactDecimal(balance.availableBalance),
        },
        exchangeInfo: {
            ...exchangeInfo,
            supportedOrderTypes,
            supportedTimeInForce,
            minNotional: parsePositiveExactDecimal(exchangeInfo.minNotionalUsdt),
            priceFilter: {
                minPrice: parseNonNegativeExactDecimal(priceFilter.minPrice),
                maxPrice: parseNonNegativeExactDecimal(priceFilter.maxPrice),
                tickSize: parsePositiveExactDecimal(priceFilter.tickSize),
            },
            percentPriceFilter: {
                multiplierUp: parsePositiveExactDecimal(percentPriceFilter.multiplierUp),
                multiplierDown: parsePositiveExactDecimal(percentPriceFilter.multiplierDown),
            },
            lotSizeFilter: {
                minQty: parsePositiveExactDecimal(lotSizeFilter.minQty),
                maxQty: parsePositiveExactDecimal(lotSizeFilter.maxQty),
                stepSize: parsePositiveExactDecimal(lotSizeFilter.stepSize),
            },
        },
    };
    if (compareExactDecimals(
        parsed.exchangeInfo.percentPriceFilter.multiplierDown,
        parsed.exchangeInfo.percentPriceFilter.multiplierUp,
    ) > 0
        || compareExactDecimals(
            parsed.exchangeInfo.lotSizeFilter.minQty,
            parsed.exchangeInfo.lotSizeFilter.maxQty,
        ) > 0
        || (isPositiveExactDecimal(parsed.exchangeInfo.priceFilter.minPrice)
            && isPositiveExactDecimal(parsed.exchangeInfo.priceFilter.maxPrice)
            && compareExactDecimals(
                parsed.exchangeInfo.priceFilter.minPrice,
                parsed.exchangeInfo.priceFilter.maxPrice,
            ) > 0)) throw new RiskInputError();
    return parsed;
};

const parseDraft = (value) => {
    const draft = readExactDataProperties(value, DRAFT_FIELDS);
    if (typeof draft.symbol !== 'string'
        || !SYMBOL_PATTERN.test(draft.symbol)
        || !['BUY', 'SELL'].includes(draft.side)
        || !['LONG', 'SHORT'].includes(draft.positionSide)
        || !['ENTRY', 'EXIT'].includes(draft.positionEffect)
        || (draft.positionSide === 'LONG'
            && draft.side !== (draft.positionEffect === 'ENTRY' ? 'BUY' : 'SELL'))
        || (draft.positionSide === 'SHORT'
            && draft.side !== (draft.positionEffect === 'ENTRY' ? 'SELL' : 'BUY'))
        || !['LIMIT', 'MARKET'].includes(draft.type)
    ) throw new RiskInputError();
    const quantity = parsePositiveExactDecimal(draft.quantity);
    let price = null;
    if (draft.type === 'LIMIT') {
        if (draft.timeInForce !== 'GTC' || draft.price === null) throw new RiskInputError();
        price = parsePositiveExactDecimal(draft.price);
    } else if (draft.timeInForce !== null
        || draft.price !== null
        || draft.positionEffect !== 'EXIT') {
        throw new RiskInputError();
    }
    return Object.freeze({ ...draft, quantity, parsedPrice: price });
};

const classifyExposure = (draft, positionAmount) => {
    const positionIsZero = isZeroExactDecimal(positionAmount);
    const signMatchesLeg = positionIsZero
        || (draft.positionSide === 'LONG'
            ? positionAmount.coefficient > 0n
            : positionAmount.coefficient < 0n);
    if (!signMatchesLeg) return null;
    if (draft.positionEffect === 'EXIT') {
        if (positionIsZero) return null;
        if (compareExactDecimals(draft.quantity, absoluteExactDecimal(positionAmount)) > 0) {
            return null;
        }
        return FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.REDUCING;
    }
    if (positionIsZero) return FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.OPENING;
    return FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.INCREASING;
};

const hasRequiredSymbolState = (policy, snapshot, draft) => {
    const symbol = draft.symbol;
    const exchange = snapshot.exchangeInfo;
    return policy.allowedSymbols.includes(symbol)
        && snapshot.symbolConfig.symbol === symbol
        && snapshot.markPrice.symbol === symbol
        && snapshot.position.symbol === symbol
        && exchange.symbol === symbol
        && exchange.status === 'TRADING'
        && exchange.contractType === 'PERPETUAL'
        && exchange.quoteAsset === 'USDT'
        && exchange.marginAsset === 'USDT'
        && snapshot.position.marginAsset === 'USDT'
        && snapshot.position.positionSide === draft.positionSide
        && snapshot.symbolConfig.marginType === 'ISOLATED'
        && snapshot.symbolConfig.isAutoAddMargin === false
        && exchange.supportedOrderTypes.includes('LIMIT')
        && exchange.supportedOrderTypes.includes('MARKET')
        && exchange.supportedTimeInForce.includes('GTC');
};

const validatePriceAndQuantity = (snapshot, draft) => {
    const { exchangeInfo, markPrice } = snapshot;
    const { lotSizeFilter, priceFilter, percentPriceFilter } = exchangeInfo;
    if (compareExactDecimals(draft.quantity, lotSizeFilter.minQty) < 0
        || compareExactDecimals(draft.quantity, lotSizeFilter.maxQty) > 0
        || !isExactIncrement(draft.quantity, lotSizeFilter.stepSize, lotSizeFilter.minQty)) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.QUANTITY_FILTER,
        );
    }
    if (draft.type === 'MARKET') return null;
    if ((isPositiveExactDecimal(priceFilter.minPrice)
            && compareExactDecimals(draft.parsedPrice, priceFilter.minPrice) < 0)
        || (isPositiveExactDecimal(priceFilter.maxPrice)
            && compareExactDecimals(draft.parsedPrice, priceFilter.maxPrice) > 0)
        || !isExactIncrement(draft.parsedPrice, priceFilter.tickSize)) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.PRICE_FILTER,
        );
    }
    const lower = multiplyExactDecimals(markPrice.parsed, percentPriceFilter.multiplierDown);
    const upper = multiplyExactDecimals(markPrice.parsed, percentPriceFilter.multiplierUp);
    if (compareExactDecimals(draft.parsedPrice, lower) < 0
        || compareExactDecimals(draft.parsedPrice, upper) > 0) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.PRICE_FILTER,
        );
    }
    return null;
};

export const evaluateFuturesProductionExecutionRisk = (value) => {
    let input;
    try {
        input = readExactDataProperties(value, TOP_LEVEL_FIELDS);
    } catch {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.INVALID_INPUT,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.INPUT_SCHEMA,
        );
    }

    let policy;
    try {
        policy = parsePolicy(input.policy);
    } catch {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.POLICY_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.POLICY_SCHEMA,
        );
    }

    let identity;
    try {
        identity = parseIdentity(input.identity);
    } catch {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.IDENTITY_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.IDENTITY_MISMATCH,
        );
    }

    let snapshot;
    try {
        snapshot = parseSnapshot(input.snapshot, identity);
    } catch {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.SNAPSHOT_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.SNAPSHOT_INCOMPLETE,
        );
    }

    let draft;
    let dailyNotionalUsed;
    try {
        draft = parseDraft(input.draft);
        dailyNotionalUsed = parseNonNegativeExactDecimal(input.dailyNotionalUsed);
        if (typeof input.killSwitchEngaged !== 'boolean') throw new RiskInputError();
    } catch {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.ORDER_SCHEMA,
        );
    }

    if (snapshot.accountConfig.canTrade !== true
        || snapshot.accountConfig.dualSidePosition !== true
        || snapshot.accountConfig.multiAssetsMargin !== false
        || snapshot.balance.asset !== 'USDT'
        || snapshot.balance.marginAvailable !== true) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ACCOUNT_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.ACCOUNT_STATE,
        );
    }
    if (!hasRequiredSymbolState(policy, snapshot, draft)) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.SYMBOL_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.SYMBOL_STATE,
        );
    }
    if (snapshot.symbolConfig.leverage !== policy.maxLeverage
        || snapshot.symbolConfig.leverage
            !== FUTURES_PRODUCTION_EXECUTION_COMPILED_CEILINGS.maxLeverage) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.LEVERAGE_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.LEVERAGE_STATE,
        );
    }

    const filterRejection = validatePriceAndQuantity(snapshot, draft);
    if (filterRejection) return filterRejection;
    if (draft.type === 'LIMIT'
        && snapshot.source.regularOpenOrderCount >= snapshot.exchangeInfo.maxOpenOrders) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.OPEN_ORDER_LIMIT,
        );
    }

    const classification = classifyExposure(draft, snapshot.position.amount);
    if (classification === null) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.CLASSIFICATION_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.EXPOSURE_AMBIGUOUS,
        );
    }
    if (input.killSwitchEngaged
        && classification !== FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.REDUCING) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.KILL_SWITCH_BLOCKED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.KILL_SWITCH,
        );
    }

    const conservativePrice = draft.type === 'LIMIT'
        ? maxExactDecimal(draft.parsedPrice, snapshot.markPrice.parsed)
        : snapshot.markPrice.parsed;
    const notional = multiplyExactDecimals(draft.quantity, conservativePrice);
    if (compareExactDecimals(notional, snapshot.exchangeInfo.minNotional) < 0) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_NOTIONAL_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.MINIMUM_NOTIONAL,
        );
    }
    if (compareExactDecimals(notional, policy.maxOrderNotional) > 0
        || compareExactDecimals(notional, snapshot.symbolConfig.maxNotionalValue) > 0) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.ORDER_NOTIONAL_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.MAXIMUM_ORDER_NOTIONAL,
        );
    }
    const nextDailyNotional = addExactDecimals(dailyNotionalUsed, notional);
    if (compareExactDecimals(nextDailyNotional, policy.maxDailyNotional) > 0) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.DAILY_NOTIONAL_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.MAXIMUM_DAILY_NOTIONAL,
        );
    }
    if (compareExactDecimals(
        snapshot.balance.availableBalance,
        policy.minAvailableBalance,
    ) < 0) {
        return reject(
            FUTURES_PRODUCTION_EXECUTION_RISK_CODES.BALANCE_REJECTED,
            FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.AVAILABLE_BALANCE,
        );
    }

    if (!isZeroExactDecimal(snapshot.position.amount)) {
        const positionIsLong = snapshot.position.amount.coefficient > 0n;
        const liquidationComparison = compareExactDecimals(
            snapshot.position.liquidationPrice,
            snapshot.markPrice.parsed,
        );
        if (!isPositiveExactDecimal(snapshot.position.liquidationPrice)
            || (positionIsLong && liquidationComparison >= 0)
            || (!positionIsLong && liquidationComparison <= 0)) {
            return reject(
                FUTURES_PRODUCTION_EXECUTION_RISK_CODES.LIQUIDATION_REJECTED,
                FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.LIQUIDATION_DISTANCE,
            );
        }
        const distance = absoluteExactDecimal(subtractExactDecimals(
            snapshot.markPrice.parsed,
            snapshot.position.liquidationPrice,
        ));
        if (compareBasisPointRatio(
            distance,
            snapshot.markPrice.parsed,
            policy.minLiquidationDistanceBps,
        ) < 0) {
            return reject(
                FUTURES_PRODUCTION_EXECUTION_RISK_CODES.LIQUIDATION_REJECTED,
                FUTURES_PRODUCTION_EXECUTION_RISK_REASONS.LIQUIDATION_DISTANCE,
            );
        }
    }

    return Object.freeze({
        ok: true,
        classification,
        notionalUsdt: formatExactDecimal(notional),
        conservativePrice: formatExactDecimal(conservativePrice),
        dailyNotionalBeforeUsdt: formatExactDecimal(dailyNotionalUsed),
        dailyNotionalAfterUsdt: formatExactDecimal(nextDailyNotional),
        observedLeverage: snapshot.symbolConfig.leverage,
    });
};
