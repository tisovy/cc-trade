import {
    FUTURES_WORKSTATION_BODY_LIMITS,
    FUTURES_WORKSTATION_JSON_LIMITS,
    FuturesWorkstationIntegerToken,
    parseFuturesWorkstationJson,
    readFuturesWorkstationCount,
    readFuturesWorkstationIdentity,
    readFuturesWorkstationTimestamp,
} from './futures-workstation-json.js';
import {
    compareFuturesWorkstationDecimals,
    isNonNegativeFuturesWorkstationDecimal,
    isPositiveFuturesWorkstationDecimal,
    subtractFuturesWorkstationDecimals,
    toFuturesWorkstationPercent,
} from './futures-workstation-decimal.js';
import {
    FUTURES_WORKSTATION_DIFF_LEVELS_PER_SIDE,
    FUTURES_WORKSTATION_STREAM_MAX_NODES,
} from '../../src/utils/futuresWorkstationProtocolShared.js';

export const FUTURES_WORKSTATION_MARKET_LIMITS = Object.freeze({
    CATALOG_CONTRACTS: 1_024,
    CATALOG_FRAME_CONTRACTS: 8,
    // How many candles the live session keeps in memory. History is delivered
    // straight through to the renderer and never enters this cache.
    CANDLES: 500,
    // The largest klines response the contract will accept — one history page.
    KLINES_RESPONSE: 1_000,
    RENDERER_CANDLES: 80,
    TRADES: 512,
    RENDERER_TRADES: 32,
    DEPTH_LEVELS_PER_SIDE: 1_000,
});

export class FuturesWorkstationMarketContractError extends Error {
    constructor(code) {
        super('Futures workstation market-data contract was rejected');
        this.name = 'FuturesWorkstationMarketContractError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesWorkstationMarketContractError(code);
};

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => {
    if (!isRecord(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length
        && actual.every((key, index) => key === expected[index]);
};
const allowedKeys = (value, required, optional = []) => {
    if (!isRecord(value)) return false;
    const allowed = new Set([...required, ...optional]);
    return required.every(key => Object.hasOwn(value, key))
        && Object.keys(value).every(key => allowed.has(key));
};
const isBoundedString = (value, pattern, maximum = 64) => (
    typeof value === 'string' && value.length <= maximum && pattern.test(value)
);
const EXCHANGE_IDENTITY_MAX_BYTES = 64;
const EXCHANGE_IDENTITY_CHARACTERS = '[\\p{Lu}\\p{Lt}\\p{Lo}\\p{N}]';
const EXCHANGE_SYMBOL_PATTERN = new RegExp(
    `^(?:${EXCHANGE_IDENTITY_CHARACTERS}{1,20}|${EXCHANGE_IDENTITY_CHARACTERS}{1,13}_[0-9]{6})$`,
    'u',
);
const EXCHANGE_PAIR_PATTERN = new RegExp(`^${EXCHANGE_IDENTITY_CHARACTERS}{1,20}$`, 'u');
const ASCII_EXECUTION_SYMBOL_PATTERN = /^(?:[A-Z0-9]{1,20}|[A-Z0-9]{1,13}_[0-9]{6})$/;
const isStatus = value => isBoundedString(value, /^[A-Z0-9_]{1,32}$/, 32);
const isExchangeIdentity = (value, maximum, allowDeliverySuffix = false) => {
    if (typeof value !== 'string'
        || Array.from(value).length > maximum
        || Buffer.byteLength(value, 'utf8') > EXCHANGE_IDENTITY_MAX_BYTES) return false;
    const pattern = allowDeliverySuffix ? EXCHANGE_SYMBOL_PATTERN : EXCHANGE_PAIR_PATTERN;
    return pattern.test(value);
};
const isSymbol = value => isExchangeIdentity(value, 20, true);
const isPair = value => isExchangeIdentity(value, 20);
const isInterval = value => ['1m', '5m', '15m', '1h', '4h', '1d', '1w'].includes(value);
const cloneFrozen = (value) => {
    if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozen));
    if (isRecord(value)) {
        return Object.freeze(Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, cloneFrozen(entry)]),
        ));
    }
    return value;
};

const readDecimal = (value, { positive = false } = {}) => {
    try {
        const valid = positive
            ? isPositiveFuturesWorkstationDecimal(value)
            : isNonNegativeFuturesWorkstationDecimal(value);
        if (!valid) fail('INVALID_DECIMAL');
        return value;
    } catch (error) {
        if (error instanceof FuturesWorkstationMarketContractError) throw error;
        fail('INVALID_DECIMAL');
    }
};

const readSignedDecimal = (value) => {
    if (typeof value !== 'string'
        || value.length > 64
        || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
        fail('INVALID_DECIMAL');
    }
    return value;
};

const readIntegerToken = (value) => {
    if (!(value instanceof FuturesWorkstationIntegerToken)) fail('INVALID_INTEGER_TOKEN');
    return value;
};

const readOrderedIdentityPair = (firstValue, lastValue, code) => {
    const first = readFuturesWorkstationIdentity(firstValue);
    const last = readFuturesWorkstationIdentity(lastValue);
    if (BigInt(first) > BigInt(last)) fail(code);
    return Object.freeze({ first, last });
};

// The snapshot's thousand per side is Binance's own depth; a diff carries every
// level that *changed*, which on a sharp move is more than the book is deep. The
// two are bounded separately, because bounding the diff by the snapshot is what
// made the desk refuse the market at the moment it moved.
const normalizeLevelArray = (levels, maximum = FUTURES_WORKSTATION_MARKET_LIMITS.DEPTH_LEVELS_PER_SIDE) => {
    if (!Array.isArray(levels) || levels.length > maximum) {
        fail('INVALID_DEPTH_LEVELS');
    }
    return Object.freeze(levels.map((level) => {
        if (!Array.isArray(level) || level.length !== 2) fail('INVALID_DEPTH_LEVEL');
        return Object.freeze([
            readDecimal(level[0], { positive: true }),
            readDecimal(level[1]),
        ]);
    }));
};

const normalizeRangeFilter = (filter, fields, stepKey, allowDisabled = false) => {
    if (!exactKeys(filter, ['filterType', ...fields])) fail('INVALID_EXCHANGE_FILTER');
    return Object.freeze({
        min: readDecimal(filter[fields[0]]),
        max: readDecimal(filter[fields[1]], { positive: !allowDisabled }),
        [stepKey]: readDecimal(filter[fields[2]], { positive: !allowDisabled }),
    });
};

const normalizeLimitFilter = (filter, allowZero = false) => {
    if (!exactKeys(filter, ['filterType', 'limit'])) fail('INVALID_EXCHANGE_FILTER');
    const limit = readFuturesWorkstationCount(filter.limit);
    if (!allowZero && limit === 0) fail('INVALID_EXCHANGE_FILTER');
    return limit;
};

const normalizePercentPriceFilter = (filter) => {
    if (!exactKeys(filter, [
        'filterType',
        'multiplierUp',
        'multiplierDown',
        'multiplierDecimal',
    ])) fail('INVALID_EXCHANGE_FILTER');
    let multiplierDecimal;
    if (typeof filter.multiplierDecimal === 'string') {
        if (!/^(?:0|[1-9][0-9]?)$/.test(filter.multiplierDecimal)) {
            fail('INVALID_EXCHANGE_FILTER');
        }
        multiplierDecimal = Number(filter.multiplierDecimal);
        if (multiplierDecimal > 18) fail('INVALID_EXCHANGE_FILTER');
    } else {
        multiplierDecimal = readFuturesWorkstationCount(filter.multiplierDecimal, 18);
    }
    return Object.freeze({
        multiplierUp: readDecimal(filter.multiplierUp, { positive: true }),
        multiplierDown: readDecimal(filter.multiplierDown, { positive: true }),
        multiplierDecimal,
    });
};

const normalizeFilters = (filters) => {
    if (!Array.isArray(filters) || filters.length > 32) fail('INVALID_EXCHANGE_FILTERS');
    const reviewedTypes = new Set([
        'PRICE_FILTER',
        'LOT_SIZE',
        'MARKET_LOT_SIZE',
        'MAX_NUM_ORDERS',
        'MAX_NUM_ALGO_ORDERS',
        'PERCENT_PRICE',
        'MIN_NOTIONAL',
        'POSITION_RISK_CONTROL',
    ]);
    const byType = new Map();
    for (const filter of filters) {
        if (!isRecord(filter)
            || typeof filter.filterType !== 'string'
            || !reviewedTypes.has(filter.filterType)) fail('INVALID_EXCHANGE_FILTER');
        if (byType.has(filter.filterType)) fail('DUPLICATE_EXCHANGE_FILTER');
        byType.set(filter.filterType, filter);
    }
    const price = byType.get('PRICE_FILTER');
    const quantity = byType.get('LOT_SIZE');
    const marketQuantity = byType.get('MARKET_LOT_SIZE');
    const maximumOrders = byType.get('MAX_NUM_ORDERS');
    const maximumAlgoOrders = byType.get('MAX_NUM_ALGO_ORDERS');
    const percentPrice = byType.get('PERCENT_PRICE');
    const minimumNotional = byType.get('MIN_NOTIONAL');
    const positionRiskControl = byType.get('POSITION_RISK_CONTROL');
    if (!price || !quantity || !marketQuantity || !maximumOrders
        || !percentPrice || !minimumNotional) {
        fail('MISSING_EXCHANGE_FILTER');
    }
    if (!exactKeys(minimumNotional, ['filterType', 'notional'])) {
        fail('INVALID_EXCHANGE_FILTER');
    }
    if (positionRiskControl
        && (!exactKeys(positionRiskControl, ['filterType', 'positionControlSide'])
            || !isStatus(positionRiskControl.positionControlSide))) {
        fail('INVALID_EXCHANGE_FILTER');
    }
    return Object.freeze({
        price: normalizeRangeFilter(
            price,
            ['minPrice', 'maxPrice', 'tickSize'],
            'tickSize',
            true,
        ),
        quantity: normalizeRangeFilter(
            quantity,
            ['minQty', 'maxQty', 'stepSize'],
            'stepSize',
        ),
        marketQuantity: normalizeRangeFilter(
            marketQuantity,
            ['minQty', 'maxQty', 'stepSize'],
            'stepSize',
        ),
        percentPrice: normalizePercentPriceFilter(percentPrice),
        maximumOrders: normalizeLimitFilter(maximumOrders, true),
        maximumAlgoOrders: maximumAlgoOrders
            ? normalizeLimitFilter(maximumAlgoOrders)
            : null,
        minimumNotional: readDecimal(minimumNotional.notional),
    });
};

const EXCHANGE_TOP_LEVEL_KEYS = Object.freeze([
    'timezone',
    'serverTime',
    'futuresType',
    'rateLimits',
    'exchangeFilters',
    'assets',
    'symbols',
]);

const EXCHANGE_SYMBOL_REQUIRED_KEYS = Object.freeze([
    'symbol',
    'pair',
    'contractType',
    'status',
    'baseAsset',
    'quoteAsset',
    'marginAsset',
    'filters',
]);

const EXCHANGE_SYMBOL_OPTIONAL_KEYS = Object.freeze([
    'deliveryDate',
    'onboardDate',
    'maintMarginPercent',
    'requiredMarginPercent',
    'pricePrecision',
    'quantityPrecision',
    'baseAssetPrecision',
    'quotePrecision',
    'underlyingType',
    'underlyingSubType',
    'settlePlan',
    'triggerProtect',
    'liquidationFee',
    'marketTakeBound',
    'maxMoveOrderLimit',
    'orderTypes',
    'timeInForce',
    'permissionSets',
]);

const EXCHANGE_CONTRACT_TYPES = new Set([
    'PERPETUAL',
    'CURRENT_MONTH',
    'NEXT_MONTH',
    'CURRENT_QUARTER',
    'NEXT_QUARTER',
    'PERPETUAL_DELIVERING',
    'CURRENT_WEEK',
    'NEXT_WEEK',
    'TRADIFI_PERPETUAL',
    'CURRENT_QUARTER DELIVERING',
]);

export const normalizeFuturesWorkstationExchangeInfo = (text) => {
    const payload = parseFuturesWorkstationJson(text, {
        maxBytes: FUTURES_WORKSTATION_BODY_LIMITS.EXCHANGE_INFO,
        maxDepth: 12,
        maxNodes: 160_000,
    });
    if (!allowedKeys(payload, ['symbols'], EXCHANGE_TOP_LEVEL_KEYS.filter(key => key !== 'symbols'))
        || !Array.isArray(payload.symbols)
        || payload.symbols.length > FUTURES_WORKSTATION_MARKET_LIMITS.CATALOG_CONTRACTS) {
        fail('INVALID_EXCHANGE_INFO');
    }
    const seen = new Set();
    const contracts = [];
    for (const symbol of payload.symbols) {
        if (!allowedKeys(symbol, EXCHANGE_SYMBOL_REQUIRED_KEYS, EXCHANGE_SYMBOL_OPTIONAL_KEYS)
            || !isExchangeIdentity(symbol.symbol, 20, true)
            || !isExchangeIdentity(symbol.pair, 20)
            || !isStatus(symbol.status)
            || !EXCHANGE_CONTRACT_TYPES.has(symbol.contractType)
            || !isExchangeIdentity(symbol.baseAsset, 16)
            || !isExchangeIdentity(symbol.quoteAsset, 16)
            || !isExchangeIdentity(symbol.marginAsset, 16)) {
            fail('INVALID_EXCHANGE_INFO_SYMBOL');
        }
        if (Object.hasOwn(symbol, 'maxMoveOrderLimit')) {
            readFuturesWorkstationCount(symbol.maxMoveOrderLimit);
        }
        if (seen.has(symbol.symbol)) fail('DUPLICATE_EXCHANGE_SYMBOL');
        seen.add(symbol.symbol);
        if (symbol.marginAsset !== 'USDT' || symbol.quoteAsset !== 'USDT') continue;
        const filters = normalizeFilters(symbol.filters);
        contracts.push(Object.freeze({
            symbol: symbol.symbol,
            pair: symbol.pair,
            contractType: symbol.contractType,
            status: symbol.status,
            baseAsset: symbol.baseAsset,
            quoteAsset: symbol.quoteAsset,
            marginAsset: symbol.marginAsset,
            tradable: ASCII_EXECUTION_SYMBOL_PATTERN.test(symbol.symbol)
                && symbol.status === 'TRADING'
                && symbol.contractType === 'PERPETUAL',
            filters,
        }));
    }
    if (contracts.length === 0) fail('EMPTY_USD_M_CATALOG');
    return Object.freeze(contracts.sort((left, right) => left.symbol.localeCompare(right.symbol)));
};

export const normalizeFuturesWorkstationDepthSnapshot = (text, expectedSymbol) => {
    if (!isSymbol(expectedSymbol)) fail('INVALID_EXPECTED_SYMBOL');
    const payload = parseFuturesWorkstationJson(text, {
        maxBytes: FUTURES_WORKSTATION_BODY_LIMITS.DEPTH,
        maxNodes: 8_192,
    });
    if (!exactKeys(payload, ['lastUpdateId', 'E', 'T', 'bids', 'asks'])) {
        fail('INVALID_DEPTH_SNAPSHOT');
    }
    readFuturesWorkstationTimestamp(payload.E);
    readFuturesWorkstationTimestamp(payload.T);
    return Object.freeze({
        lastUpdateId: readFuturesWorkstationIdentity(payload.lastUpdateId),
        bids: normalizeLevelArray(payload.bids),
        asks: normalizeLevelArray(payload.asks),
    });
};

const normalizeKlineTuple = (tuple) => {
    if (!Array.isArray(tuple) || tuple.length !== 12) fail('INVALID_KLINE_TUPLE');
    const openTime = readFuturesWorkstationTimestamp(tuple[0]);
    const closeTime = readFuturesWorkstationTimestamp(tuple[6]);
    if (closeTime < openTime) fail('INVALID_KLINE_TIME');
    readIntegerToken(tuple[8]);
    readFuturesWorkstationCount(tuple[8]);
    readDecimal(tuple[7]);
    readDecimal(tuple[9]);
    readDecimal(tuple[10]);
    readDecimal(tuple[11]);
    const open = readDecimal(tuple[1], { positive: true });
    const high = readDecimal(tuple[2], { positive: true });
    const low = readDecimal(tuple[3], { positive: true });
    const close = readDecimal(tuple[4], { positive: true });
    if (compareFuturesWorkstationDecimals(high, low) < 0
        || compareFuturesWorkstationDecimals(high, open) < 0
        || compareFuturesWorkstationDecimals(high, close) < 0
        || compareFuturesWorkstationDecimals(low, open) > 0
        || compareFuturesWorkstationDecimals(low, close) > 0) {
        fail('INVALID_KLINE_PRICE_RANGE');
    }
    return Object.freeze({
        openTime,
        closeTime,
        open,
        high,
        low,
        close,
        volume: readDecimal(tuple[5]),
        closed: true,
    });
};

export const normalizeFuturesWorkstationKlines = (text) => {
    const payload = parseFuturesWorkstationJson(text, {
        maxBytes: FUTURES_WORKSTATION_BODY_LIMITS.KLINES,
        maxNodes: 16_384,
    });
    if (!Array.isArray(payload)
        || payload.length > FUTURES_WORKSTATION_MARKET_LIMITS.KLINES_RESPONSE) {
        fail('INVALID_KLINES');
    }
    const seen = new Set();
    const rows = payload.map((tuple) => {
        const row = normalizeKlineTuple(tuple);
        if (seen.has(row.openTime)) fail('DUPLICATE_KLINE');
        seen.add(row.openTime);
        return row;
    });
    rows.sort((left, right) => left.openTime - right.openTime);
    return Object.freeze(rows);
};

export const normalizeFuturesWorkstationPremiumIndex = (text, expectedSymbol) => {
    const payload = parseFuturesWorkstationJson(text, {
        maxBytes: FUTURES_WORKSTATION_BODY_LIMITS.HEADER,
        maxNodes: 64,
    });
    if (!exactKeys(payload, [
        'symbol',
        'markPrice',
        'indexPrice',
        'estimatedSettlePrice',
        'lastFundingRate',
        'interestRate',
        'nextFundingTime',
        'time',
    ])
        || payload.symbol !== expectedSymbol) fail('INVALID_PREMIUM_INDEX');
    readDecimal(payload.estimatedSettlePrice);
    readSignedDecimal(payload.interestRate);
    return Object.freeze({
        markPrice: readDecimal(payload.markPrice, { positive: true }),
        indexPrice: readDecimal(payload.indexPrice, { positive: true }),
        fundingRate: readSignedDecimal(payload.lastFundingRate),
        nextFundingTime: readFuturesWorkstationTimestamp(payload.nextFundingTime),
        eventTime: readFuturesWorkstationTimestamp(payload.time),
    });
};

export const normalizeFuturesWorkstationTicker = (text, expectedSymbol) => {
    const payload = parseFuturesWorkstationJson(text, {
        maxBytes: FUTURES_WORKSTATION_BODY_LIMITS.HEADER,
        maxNodes: 64,
    });
    if (!exactKeys(payload, [
        'symbol',
        'priceChange',
        'priceChangePercent',
        'weightedAvgPrice',
        'lastPrice',
        'lastQty',
        'openPrice',
        'highPrice',
        'lowPrice',
        'volume',
        'quoteVolume',
        'openTime',
        'closeTime',
        'firstId',
        'lastId',
        'count',
    ])
        || payload.symbol !== expectedSymbol) fail('INVALID_TICKER');
    const openTime = readFuturesWorkstationTimestamp(payload.openTime);
    const closeTime = readFuturesWorkstationTimestamp(payload.closeTime);
    if (closeTime < openTime) fail('INVALID_TICKER_TIME');
    readDecimal(payload.weightedAvgPrice, { positive: true });
    readDecimal(payload.openPrice, { positive: true });
    readOrderedIdentityPair(payload.firstId, payload.lastId, 'INVALID_TICKER_ID_RANGE');
    readFuturesWorkstationCount(payload.count);
    return Object.freeze({
        lastPrice: readDecimal(payload.lastPrice, { positive: true }),
        lastQuantity: readDecimal(payload.lastQty),
        priceChange: readSignedDecimal(payload.priceChange),
        priceChangePercent: readSignedDecimal(payload.priceChangePercent),
        highPrice: readDecimal(payload.highPrice, { positive: true }),
        lowPrice: readDecimal(payload.lowPrice, { positive: true }),
        volume: readDecimal(payload.volume),
        quoteVolume: readDecimal(payload.quoteVolume),
        eventTime: closeTime,
    });
};

export const createFuturesWorkstationHeader = ({ premium, ticker, contractStatus }) => {
    if (!isStatus(contractStatus)) fail('INVALID_CONTRACT_STATUS');
    return Object.freeze({
        lastPrice: ticker.lastPrice,
        markPrice: premium.markPrice,
        indexPrice: premium.indexPrice,
        basis: subtractFuturesWorkstationDecimals(premium.markPrice, premium.indexPrice),
        priceChange: ticker.priceChange,
        priceChangePercent: ticker.priceChangePercent,
        highPrice: ticker.highPrice,
        lowPrice: ticker.lowPrice,
        volume: ticker.volume,
        quoteVolume: ticker.quoteVolume,
        lastQuantity: ticker.lastQuantity,
        fundingRate: premium.fundingRate,
        fundingRatePercent: toFuturesWorkstationPercent(premium.fundingRate),
        nextFundingTime: premium.nextFundingTime,
        eventTime: Math.max(premium.eventTime, ticker.eventTime),
        contractStatus,
    });
};

const validateUsdMStreamIdentity = (payload, expectedSymbol, expectedPair) => {
    if (payload.s !== expectedSymbol) fail('WRONG_STREAM_SYMBOL');
    if (Object.hasOwn(payload, 'st')) {
        if (!(payload.st instanceof FuturesWorkstationIntegerToken)
            || payload.st.token !== '1') fail('WRONG_STREAM_MARKET_TYPE');
    }
    if (Object.hasOwn(payload, 'ps') && payload.ps !== expectedPair) {
        fail('WRONG_STREAM_PAIR');
    }
};

const normalizeStreamDepth = (payload) => {
    if (!allowedKeys(payload, ['e', 'E', 'T', 's', 'U', 'u', 'pu', 'b', 'a'], ['ps', 'st'])
        || payload.e !== 'depthUpdate') fail('INVALID_DEPTH_STREAM');
    const eventTime = readFuturesWorkstationTimestamp(payload.E);
    readFuturesWorkstationTimestamp(payload.T);
    return Object.freeze({
        kind: 'depth',
        firstUpdateId: readFuturesWorkstationIdentity(payload.U),
        finalUpdateId: readFuturesWorkstationIdentity(payload.u),
        previousFinalUpdateId: readFuturesWorkstationIdentity(payload.pu),
        bids: normalizeLevelArray(payload.b, FUTURES_WORKSTATION_DIFF_LEVELS_PER_SIDE),
        asks: normalizeLevelArray(payload.a, FUTURES_WORKSTATION_DIFF_LEVELS_PER_SIDE),
        eventTime,
    });
};

const normalizeStreamTrade = (payload) => {
    if (!allowedKeys(payload, [
        'e', 'E', 's', 'a', 'p', 'q', 'nq', 'f', 'l', 'T', 'm',
    ], ['st'])
        || payload.e !== 'aggTrade'
        || typeof payload.m !== 'boolean') fail('INVALID_TRADE_STREAM');
    readFuturesWorkstationTimestamp(payload.E);
    const tradeIds = readOrderedIdentityPair(payload.f, payload.l, 'INVALID_TRADE_ID_RANGE');
    return Object.freeze({
        kind: 'trade',
        row: Object.freeze({
            aggregateTradeId: readFuturesWorkstationIdentity(payload.a),
            price: readDecimal(payload.p, { positive: true }),
            quantity: readDecimal(payload.q),
            normalQuantity: readDecimal(payload.nq),
            firstTradeId: tradeIds.first,
            lastTradeId: tradeIds.last,
            tradeTime: readFuturesWorkstationTimestamp(payload.T),
            buyerMaker: payload.m,
        }),
    });
};

const normalizeStreamKline = (payload, expectedInterval) => {
    if (!exactKeys(payload, ['e', 'E', 's', 'k']) || payload.e !== 'kline') {
        fail('INVALID_KLINE_STREAM');
    }
    readFuturesWorkstationTimestamp(payload.E);
    const kline = payload.k;
    if (!exactKeys(kline, [
        't', 'T', 's', 'i', 'f', 'L', 'o', 'c', 'h', 'l', 'v', 'n', 'x', 'q', 'V', 'Q', 'B',
    ])
        || kline.s !== payload.s
        || kline.i !== expectedInterval
        || typeof kline.x !== 'boolean') fail('INVALID_KLINE_STREAM');
    readOrderedIdentityPair(kline.f, kline.L, 'INVALID_KLINE_ID_RANGE');
    readFuturesWorkstationCount(kline.n);
    readDecimal(kline.q);
    readDecimal(kline.V);
    readDecimal(kline.Q);
    readDecimal(kline.B);
    const openTime = readFuturesWorkstationTimestamp(kline.t);
    const closeTime = readFuturesWorkstationTimestamp(kline.T);
    if (closeTime < openTime) fail('INVALID_KLINE_TIME');
    const open = readDecimal(kline.o, { positive: true });
    const high = readDecimal(kline.h, { positive: true });
    const low = readDecimal(kline.l, { positive: true });
    const close = readDecimal(kline.c, { positive: true });
    if (compareFuturesWorkstationDecimals(high, low) < 0
        || compareFuturesWorkstationDecimals(high, open) < 0
        || compareFuturesWorkstationDecimals(high, close) < 0
        || compareFuturesWorkstationDecimals(low, open) > 0
        || compareFuturesWorkstationDecimals(low, close) > 0) {
        fail('INVALID_KLINE_PRICE_RANGE');
    }
    return Object.freeze({
        kind: 'kline',
        row: Object.freeze({
            openTime,
            closeTime,
            open,
            high,
            low,
            close,
            volume: readDecimal(kline.v),
            closed: kline.x,
        }),
    });
};

const normalizeStreamMark = (payload) => {
    if (!allowedKeys(payload, ['e', 'E', 's', 'p', 'i', 'P', 'r', 'ap', 'T'], ['st'])
        || payload.e !== 'markPriceUpdate') fail('INVALID_MARK_STREAM');
    readDecimal(payload.P);
    readDecimal(payload.ap);
    return Object.freeze({
        kind: 'mark',
        markPrice: readDecimal(payload.p, { positive: true }),
        indexPrice: readDecimal(payload.i, { positive: true }),
        fundingRate: readSignedDecimal(payload.r),
        nextFundingTime: readFuturesWorkstationTimestamp(payload.T),
        eventTime: readFuturesWorkstationTimestamp(payload.E),
    });
};

const normalizeStreamTicker = (payload) => {
    if (!allowedKeys(payload, [
        'e', 'E', 's', 'p', 'P', 'w', 'c', 'Q', 'o', 'h', 'l', 'v', 'q', 'O', 'C', 'F', 'L', 'n',
    ], ['ps', 'st'])
        || payload.e !== '24hrTicker') fail('INVALID_TICKER_STREAM');
    const openTime = readFuturesWorkstationTimestamp(payload.O);
    const closeTime = readFuturesWorkstationTimestamp(payload.C);
    if (closeTime < openTime) fail('INVALID_TICKER_TIME');
    readOrderedIdentityPair(payload.F, payload.L, 'INVALID_TICKER_ID_RANGE');
    readFuturesWorkstationCount(payload.n);
    readDecimal(payload.w, { positive: true });
    readDecimal(payload.o, { positive: true });
    return Object.freeze({
        kind: 'ticker',
        lastPrice: readDecimal(payload.c, { positive: true }),
        lastQuantity: readDecimal(payload.Q),
        priceChange: readSignedDecimal(payload.p),
        priceChangePercent: readSignedDecimal(payload.P),
        highPrice: readDecimal(payload.h, { positive: true }),
        lowPrice: readDecimal(payload.l, { positive: true }),
        volume: readDecimal(payload.v),
        quoteVolume: readDecimal(payload.q),
        eventTime: Math.max(
            readFuturesWorkstationTimestamp(payload.E),
            closeTime,
        ),
    });
};

export const normalizeFuturesWorkstationStreamFrame = (
    raw,
    { symbol, pair, interval },
) => {
    if (!isSymbol(symbol) || !isPair(pair) || !isInterval(interval)) {
        fail('INVALID_STREAM_EXPECTATION');
    }
    const frameBytes = Buffer.byteLength(raw, 'utf8');
    // Both bounds are the book's, not a flat number under it: a depth diff may
    // restate every level the desk retains, and a frame the payload rules accept
    // but the parser refuses is a feed that simply stops.
    const envelope = parseFuturesWorkstationJson(raw, {
        maxBytes: FUTURES_WORKSTATION_JSON_LIMITS.WS_STREAM_FRAME_BYTES,
        maxNodes: FUTURES_WORKSTATION_STREAM_MAX_NODES,
    });
    if (!exactKeys(envelope, ['stream', 'data']) || typeof envelope.stream !== 'string') {
        fail('INVALID_STREAM_ENVELOPE');
    }
    const lower = symbol.toLowerCase();
    const expectedStreams = new Set([
        `${lower}@depth@100ms`,
        `${lower}@aggTrade`,
        `${lower}@kline_${interval}`,
        `${lower}@markPrice@1s`,
        `${lower}@ticker`,
    ]);
    if (!expectedStreams.has(envelope.stream) || !isRecord(envelope.data)) {
        fail('UNEXPECTED_STREAM');
    }
    validateUsdMStreamIdentity(envelope.data, symbol, pair);
    let event;
    if (envelope.stream.endsWith('@depth@100ms')) event = normalizeStreamDepth(envelope.data);
    else if (envelope.stream.endsWith('@aggTrade')) event = normalizeStreamTrade(envelope.data);
    else if (envelope.stream.includes('@kline_')) event = normalizeStreamKline(envelope.data, interval);
    else if (envelope.stream.endsWith('@markPrice@1s')) event = normalizeStreamMark(envelope.data);
    else event = normalizeStreamTicker(envelope.data);
    // The exchange's own event time, kept beside the reading rather than inside
    // it. Every USDⓈ-M stream frame states `E` and every normalizer above reads
    // it — but they keep it differently, because they keep what each resource
    // means by "when": a trade's time is the trade's, a kline's is its close,
    // and a ticker's is the later of two. All of those are right for the
    // resource and none of them is "when Binance sent this frame", which is the
    // only thing a latency mark can be measured from.
    //
    // Read through `readFuturesWorkstationTimestamp` and not as a number, because
    // on this side of the desk it is not one. The upstream parser answers every
    // integer as a token holding its exact digits — that is what keeps a uint64
    // depth sequence from being rounded to one Binance never sent — so
    // `envelope.data.E` is a `FuturesWorkstationIntegerToken` and comparing it to
    // a number silently yields nothing.
    //
    // Caught rather than propagated: this is a diagnostic on a frame that has
    // already passed every rule that matters, so a missing or malformed `E`
    // costs the mark and never the frame.
    let exchangeAt = null;
    try {
        exchangeAt = readFuturesWorkstationTimestamp(envelope.data?.E);
    } catch {
        exchangeAt = null;
    }
    return Object.freeze({ ...event, frameBytes, exchangeAt });
};

export const updateFuturesWorkstationCandles = (current, row) => {
    if (!Array.isArray(current)) fail('INVALID_CANDLE_CACHE');
    const next = [...current];
    const index = next.findIndex(entry => entry.openTime === row.openTime);
    if (index >= 0) next[index] = row;
    else {
        next.push(row);
        next.sort((left, right) => left.openTime - right.openTime);
    }
    return Object.freeze(next.slice(-FUTURES_WORKSTATION_MARKET_LIMITS.CANDLES));
};

export const appendFuturesWorkstationTrade = (current, row) => {
    if (!Array.isArray(current)) fail('INVALID_TRADE_CACHE');
    if (current.some(entry => entry.aggregateTradeId === row.aggregateTradeId)) {
        return Object.freeze([...current]);
    }
    return Object.freeze([row, ...current]
        .sort((left, right) => right.tradeTime - left.tradeTime)
        .slice(0, FUTURES_WORKSTATION_MARKET_LIMITS.TRADES));
};

export const updateFuturesWorkstationHeader = (current, event) => {
    if (!isRecord(current) || !isRecord(event)) fail('INVALID_HEADER_UPDATE');
    if (event.kind === 'mark') {
        return cloneFrozen({
            ...current,
            markPrice: event.markPrice,
            indexPrice: event.indexPrice,
            basis: subtractFuturesWorkstationDecimals(event.markPrice, event.indexPrice),
            fundingRate: event.fundingRate,
            fundingRatePercent: toFuturesWorkstationPercent(event.fundingRate),
            nextFundingTime: event.nextFundingTime,
            eventTime: Math.max(current.eventTime, event.eventTime),
        });
    }
    // A print *is* the last traded price. It arrives ahead of the ticker that
    // states the same number, and no display setting stands between it and the
    // header — the tape's minimum notional filters what the tape shows, never
    // what the contract last traded at.
    if (event.kind === 'trade') {
        return cloneFrozen({
            ...current,
            lastPrice: event.row.price,
            lastQuantity: event.row.quantity,
            eventTime: Math.max(current.eventTime, event.row.tradeTime),
        });
    }
    if (event.kind === 'ticker') {
        return cloneFrozen({
            ...current,
            lastPrice: event.lastPrice,
            lastQuantity: event.lastQuantity,
            priceChange: event.priceChange,
            priceChangePercent: event.priceChangePercent,
            highPrice: event.highPrice,
            lowPrice: event.lowPrice,
            volume: event.volume,
            quoteVolume: event.quoteVolume,
            eventTime: Math.max(current.eventTime, event.eventTime),
        });
    }
    fail('INVALID_HEADER_UPDATE_KIND');
};

export const createFuturesWorkstationCatalogFrames = (contracts) => {
    if (!Array.isArray(contracts)
        || contracts.length > FUTURES_WORKSTATION_MARKET_LIMITS.CATALOG_CONTRACTS) {
        fail('INVALID_CATALOG_CACHE');
    }
    const frames = [];
    for (let offset = 0; offset < contracts.length; offset += FUTURES_WORKSTATION_MARKET_LIMITS.CATALOG_FRAME_CONTRACTS) {
        const rows = contracts.slice(
            offset,
            offset + FUTURES_WORKSTATION_MARKET_LIMITS.CATALOG_FRAME_CONTRACTS,
        );
        frames.push(Object.freeze({
            offset,
            total: contracts.length,
            complete: offset + rows.length === contracts.length,
            contracts: Object.freeze(rows),
        }));
    }
    return Object.freeze(frames);
};

export const toRendererCandleRows = rows => Object.freeze(
    rows.slice(-FUTURES_WORKSTATION_MARKET_LIMITS.RENDERER_CANDLES),
);

export const toRendererTradeRows = rows => Object.freeze(
    rows.slice(0, FUTURES_WORKSTATION_MARKET_LIMITS.RENDERER_TRADES),
);
