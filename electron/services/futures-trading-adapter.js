export const FUTURES_EXCHANGE_INFO_ERROR_CODES = Object.freeze({
    INVALID_SYMBOL: 'INVALID_FUTURES_SYMBOL',
    MALFORMED_RESPONSE: 'MALFORMED_FUTURES_EXCHANGE_INFO',
    SYMBOL_UNAVAILABLE: 'FUTURES_SYMBOL_UNAVAILABLE',
});

export const FUTURES_MARK_PRICE_ERROR_CODES = Object.freeze({
    INVALID_SYMBOL: FUTURES_EXCHANGE_INFO_ERROR_CODES.INVALID_SYMBOL,
    MALFORMED_RESPONSE: 'MALFORMED_FUTURES_MARK_PRICE',
    SYMBOL_UNAVAILABLE: FUTURES_EXCHANGE_INFO_ERROR_CODES.SYMBOL_UNAVAILABLE,
});

export const FUTURES_FUNDING_STATE_ERROR_CODES = Object.freeze({
    INVALID_SYMBOL: FUTURES_EXCHANGE_INFO_ERROR_CODES.INVALID_SYMBOL,
    MALFORMED_RESPONSE: 'MALFORMED_FUTURES_FUNDING_STATE',
    SYMBOL_UNAVAILABLE: FUTURES_EXCHANGE_INFO_ERROR_CODES.SYMBOL_UNAVAILABLE,
});

export const FUTURES_POSITION_RISK_ERROR_CODES = Object.freeze({
    INVALID_SYMBOL: FUTURES_EXCHANGE_INFO_ERROR_CODES.INVALID_SYMBOL,
    INVALID_POSITION_SIDE: 'INVALID_FUTURES_POSITION_SIDE',
    MALFORMED_RESPONSE: 'MALFORMED_FUTURES_POSITION_RISK',
    SYMBOL_UNAVAILABLE: FUTURES_EXCHANGE_INFO_ERROR_CODES.SYMBOL_UNAVAILABLE,
    POSITION_SIDE_UNAVAILABLE: 'FUTURES_POSITION_SIDE_UNAVAILABLE',
});

export class FuturesExchangeInfoError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesExchangeInfoError';
        this.code = code;
    }
}

export class FuturesMarkPriceError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesMarkPriceError';
        this.code = code;
    }
}

export class FuturesFundingStateError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesFundingStateError';
        this.code = code;
    }
}

export class FuturesPositionRiskError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesPositionRiskError';
        this.code = code;
    }
}

const isRecord = (value) => value !== null
    && typeof value === 'object'
    && !Array.isArray(value);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const malformedResponseError = () => new FuturesExchangeInfoError(
    FUTURES_EXCHANGE_INFO_ERROR_CODES.MALFORMED_RESPONSE,
    'Malformed futures exchange-info response',
);

const malformedMarkPriceError = () => new FuturesMarkPriceError(
    FUTURES_MARK_PRICE_ERROR_CODES.MALFORMED_RESPONSE,
    'Malformed futures mark-price response',
);

const malformedFundingStateError = () => new FuturesFundingStateError(
    FUTURES_FUNDING_STATE_ERROR_CODES.MALFORMED_RESPONSE,
    'Malformed futures funding-state response',
);

const malformedPositionRiskError = () => new FuturesPositionRiskError(
    FUTURES_POSITION_RISK_ERROR_CODES.MALFORMED_RESPONSE,
    'Malformed futures position-risk response',
);

const FUTURES_POSITION_SIDES = new Set(['BOTH', 'LONG', 'SHORT']);

const requireStringFields = (value, fields) => {
    if (!isRecord(value) || fields.some((field) => !isNonEmptyString(value[field]))) {
        throw malformedResponseError();
    }
};

const normalizeStringArray = (value) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
        throw malformedResponseError();
    }
    return [...value];
};

const normalizeRangeFilter = (filter, sourceFields) => {
    requireStringFields(filter, sourceFields);
    return {
        min: filter[sourceFields[0]],
        max: filter[sourceFields[1]],
        [sourceFields[2]]: filter[sourceFields[2]],
    };
};

const RECOGNIZED_FILTER_TYPES = new Set([
    'PRICE_FILTER',
    'LOT_SIZE',
    'MARKET_LOT_SIZE',
    'MIN_NOTIONAL',
]);

const normalizeFuturesFilters = (filters) => {
    if (filters === undefined || filters === null) {
        return {
            price: null,
            quantity: null,
            marketQuantity: null,
            minimumNotional: null,
        };
    }
    if (!Array.isArray(filters)) throw malformedResponseError();

    const filtersByType = new Map();
    filters.forEach((filter) => {
        if (!isRecord(filter) || !isNonEmptyString(filter.filterType)) {
            throw malformedResponseError();
        }
        if (!RECOGNIZED_FILTER_TYPES.has(filter.filterType)) return;
        if (filtersByType.has(filter.filterType)) throw malformedResponseError();
        filtersByType.set(filter.filterType, filter);
    });

    const priceFilter = filtersByType.get('PRICE_FILTER');
    const quantityFilter = filtersByType.get('LOT_SIZE');
    const marketQuantityFilter = filtersByType.get('MARKET_LOT_SIZE');
    const minimumNotionalFilter = filtersByType.get('MIN_NOTIONAL');

    if (minimumNotionalFilter) {
        requireStringFields(minimumNotionalFilter, ['notional']);
    }

    return {
        price: priceFilter
            ? normalizeRangeFilter(priceFilter, ['minPrice', 'maxPrice', 'tickSize'])
            : null,
        quantity: quantityFilter
            ? normalizeRangeFilter(quantityFilter, ['minQty', 'maxQty', 'stepSize'])
            : null,
        marketQuantity: marketQuantityFilter
            ? normalizeRangeFilter(marketQuantityFilter, ['minQty', 'maxQty', 'stepSize'])
            : null,
        minimumNotional: minimumNotionalFilter?.notional ?? null,
    };
};

/**
 * Normalize one USDⓈ-M futures symbol into the read-only futures instrument contract.
 * Decimal constraints remain exact strings and no input object is mutated.
 */
export const normalizeFuturesExchangeInfo = (exchangeInfo, requestedSymbol) => {
    if (!isNonEmptyString(requestedSymbol)) {
        throw new FuturesExchangeInfoError(
            FUTURES_EXCHANGE_INFO_ERROR_CODES.INVALID_SYMBOL,
            'Futures symbol must be a non-empty string',
        );
    }
    if (!isRecord(exchangeInfo) || !Array.isArray(exchangeInfo.symbols)) {
        throw malformedResponseError();
    }
    if (exchangeInfo.symbols.some(
        (candidate) => !isRecord(candidate) || !isNonEmptyString(candidate.symbol),
    )) {
        throw malformedResponseError();
    }

    const symbolInfo = exchangeInfo.symbols.find(
        (candidate) => candidate.symbol === requestedSymbol,
    );
    if (!symbolInfo) {
        throw new FuturesExchangeInfoError(
            FUTURES_EXCHANGE_INFO_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in exchange info`,
        );
    }

    requireStringFields(symbolInfo, [
        'symbol',
        'pair',
        'contractType',
        'status',
        'baseAsset',
        'quoteAsset',
        'marginAsset',
    ]);

    return {
        marketType: 'futures',
        symbol: symbolInfo.symbol,
        pair: symbolInfo.pair,
        contractType: symbolInfo.contractType,
        status: symbolInfo.status,
        assets: {
            base: symbolInfo.baseAsset,
            quote: symbolInfo.quoteAsset,
            margin: symbolInfo.marginAsset,
        },
        filters: normalizeFuturesFilters(symbolInfo.filters),
        supportedOrderTypes: normalizeStringArray(symbolInfo.orderTypes),
        supportedTimeInForce: normalizeStringArray(symbolInfo.timeInForce),
    };
};

/**
 * Normalize one USDⓈ-M futures mark-price observation for a requested symbol.
 * Price decimals remain exact strings and funding fields stay outside this checkpoint.
 */
export const normalizeFuturesMarkPrice = (markPriceResponse, requestedSymbol) => {
    if (!isNonEmptyString(requestedSymbol)) {
        throw new FuturesMarkPriceError(
            FUTURES_MARK_PRICE_ERROR_CODES.INVALID_SYMBOL,
            'Futures symbol must be a non-empty string',
        );
    }

    const candidates = Array.isArray(markPriceResponse)
        ? markPriceResponse
        : [markPriceResponse];

    if (candidates.some(
        (candidate) => !isRecord(candidate) || !isNonEmptyString(candidate.symbol),
    )) {
        throw malformedMarkPriceError();
    }

    const matchingCandidates = candidates.filter(
        (candidate) => candidate.symbol === requestedSymbol,
    );
    if (matchingCandidates.length === 0) {
        throw new FuturesMarkPriceError(
            FUTURES_MARK_PRICE_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in mark-price response`,
        );
    }
    if (matchingCandidates.length > 1) throw malformedMarkPriceError();

    const markPrice = matchingCandidates[0];
    const decimalFields = ['markPrice', 'indexPrice', 'estimatedSettlePrice'];
    if (decimalFields.some((field) => !isNonEmptyString(markPrice[field]))
        || !Number.isSafeInteger(markPrice.time)
        || markPrice.time < 0) {
        throw malformedMarkPriceError();
    }

    return {
        marketType: 'futures',
        symbol: markPrice.symbol,
        markPrice: markPrice.markPrice,
        indexPrice: markPrice.indexPrice,
        estimatedSettlePrice: markPrice.estimatedSettlePrice,
        time: markPrice.time,
    };
};

/**
 * Normalize current USDⓈ-M funding state from a premium-index response.
 * Rate decimals remain exact strings and funding/observation timestamps remain integers.
 */
export const normalizeFuturesFundingState = (fundingStateResponse, requestedSymbol) => {
    if (!isNonEmptyString(requestedSymbol)) {
        throw new FuturesFundingStateError(
            FUTURES_FUNDING_STATE_ERROR_CODES.INVALID_SYMBOL,
            'Futures symbol must be a non-empty string',
        );
    }

    const candidates = Array.isArray(fundingStateResponse)
        ? fundingStateResponse
        : [fundingStateResponse];

    if (candidates.some(
        (candidate) => !isRecord(candidate) || !isNonEmptyString(candidate.symbol),
    )) {
        throw malformedFundingStateError();
    }

    const matchingCandidates = candidates.filter(
        (candidate) => candidate.symbol === requestedSymbol,
    );
    if (matchingCandidates.length === 0) {
        throw new FuturesFundingStateError(
            FUTURES_FUNDING_STATE_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in funding-state response`,
        );
    }
    if (matchingCandidates.length > 1) throw malformedFundingStateError();

    const fundingState = matchingCandidates[0];
    const decimalFields = ['lastFundingRate', 'interestRate'];
    const timestampFields = ['nextFundingTime', 'time'];
    if (decimalFields.some((field) => !isNonEmptyString(fundingState[field]))
        || timestampFields.some((field) => !Number.isSafeInteger(fundingState[field])
            || fundingState[field] < 0)) {
        throw malformedFundingStateError();
    }

    return {
        marketType: 'futures',
        symbol: fundingState.symbol,
        lastFundingRate: fundingState.lastFundingRate,
        interestRate: fundingState.interestRate,
        nextFundingTime: fundingState.nextFundingTime,
        time: fundingState.time,
    };
};

/**
 * Normalize one USDⓈ-M V3 position-risk entry selected by symbol and position side.
 * BOTH identifies one-way mode; LONG and SHORT identify independent hedge-mode positions.
 * Decimal values remain exact strings and integer risk/timestamp fields remain integers.
 */
export const normalizeFuturesPositionRisk = (
    positionRiskResponse,
    requestedSymbol,
    requestedPositionSide,
) => {
    if (!isNonEmptyString(requestedSymbol)) {
        throw new FuturesPositionRiskError(
            FUTURES_POSITION_RISK_ERROR_CODES.INVALID_SYMBOL,
            'Futures symbol must be a non-empty string',
        );
    }
    if (!FUTURES_POSITION_SIDES.has(requestedPositionSide)) {
        throw new FuturesPositionRiskError(
            FUTURES_POSITION_RISK_ERROR_CODES.INVALID_POSITION_SIDE,
            'Futures position side must be one of BOTH, LONG, or SHORT',
        );
    }
    if (!Array.isArray(positionRiskResponse)) throw malformedPositionRiskError();
    if (positionRiskResponse.some(
        (candidate) => !isRecord(candidate)
            || !isNonEmptyString(candidate.symbol)
            || !FUTURES_POSITION_SIDES.has(candidate.positionSide),
    )) {
        throw malformedPositionRiskError();
    }

    const identityKeys = new Set();
    const positionModes = new Set();
    positionRiskResponse.forEach((candidate) => {
        const identityKey = JSON.stringify([candidate.symbol, candidate.positionSide]);
        if (identityKeys.has(identityKey)) throw malformedPositionRiskError();
        identityKeys.add(identityKey);
        positionModes.add(candidate.positionSide === 'BOTH' ? 'one-way' : 'hedge');
    });
    if (positionModes.size > 1) throw malformedPositionRiskError();

    const symbolCandidates = positionRiskResponse.filter(
        (candidate) => candidate.symbol === requestedSymbol,
    );
    if (symbolCandidates.length === 0) {
        throw new FuturesPositionRiskError(
            FUTURES_POSITION_RISK_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in position-risk response`,
        );
    }

    const matchingCandidates = symbolCandidates.filter(
        (candidate) => candidate.positionSide === requestedPositionSide,
    );
    if (matchingCandidates.length === 0) {
        throw new FuturesPositionRiskError(
            FUTURES_POSITION_RISK_ERROR_CODES.POSITION_SIDE_UNAVAILABLE,
            `Futures position side "${requestedPositionSide}" is unavailable for symbol "${requestedSymbol}" in position-risk response`,
        );
    }
    if (matchingCandidates.length > 1) throw malformedPositionRiskError();

    const positionRisk = matchingCandidates[0];
    const decimalFields = [
        'positionAmt',
        'entryPrice',
        'breakEvenPrice',
        'markPrice',
        'unRealizedProfit',
        'liquidationPrice',
        'isolatedMargin',
        'notional',
        'isolatedWallet',
        'initialMargin',
        'maintMargin',
        'positionInitialMargin',
        'openOrderInitialMargin',
    ];
    if (decimalFields.some((field) => !isNonEmptyString(positionRisk[field]))
        || !isNonEmptyString(positionRisk.marginAsset)
        || !Number.isSafeInteger(positionRisk.adl)
        || positionRisk.adl < 0
        || !Number.isSafeInteger(positionRisk.updateTime)
        || positionRisk.updateTime < 0) {
        throw malformedPositionRiskError();
    }

    return {
        marketType: 'futures',
        symbol: positionRisk.symbol,
        positionSide: positionRisk.positionSide,
        positionAmt: positionRisk.positionAmt,
        entryPrice: positionRisk.entryPrice,
        breakEvenPrice: positionRisk.breakEvenPrice,
        markPrice: positionRisk.markPrice,
        unRealizedProfit: positionRisk.unRealizedProfit,
        liquidationPrice: positionRisk.liquidationPrice,
        isolatedMargin: positionRisk.isolatedMargin,
        notional: positionRisk.notional,
        marginAsset: positionRisk.marginAsset,
        isolatedWallet: positionRisk.isolatedWallet,
        initialMargin: positionRisk.initialMargin,
        maintMargin: positionRisk.maintMargin,
        positionInitialMargin: positionRisk.positionInitialMargin,
        openOrderInitialMargin: positionRisk.openOrderInitialMargin,
        adl: positionRisk.adl,
        updateTime: positionRisk.updateTime,
    };
};

const readExchangeInfoData = async (response) => {
    if (typeof response?.data === 'function') return response.data();
    return response;
};

const readMarkPriceData = async (response) => {
    if (typeof response?.data === 'function') return response.data();
    return response;
};

const readFundingStateData = async (response) => {
    if (typeof response?.data === 'function') return response.data();
    return response;
};

const readPositionRiskData = async (response) => {
    if (typeof response?.data === 'function') return response.data();
    return response;
};

export class FuturesTradingAdapter {
    constructor({ transport }) {
        this.transport = transport;
    }

    async getExchangeInfo(symbol) {
        const response = await this.transport.getExchangeInfo();
        const exchangeInfo = await readExchangeInfoData(response);
        return normalizeFuturesExchangeInfo(exchangeInfo, symbol);
    }

    async getMarkPrice(symbol) {
        const response = await this.transport.getMarkPrice({ symbol });
        const markPrice = await readMarkPriceData(response);
        return normalizeFuturesMarkPrice(markPrice, symbol);
    }

    async getFundingState(symbol) {
        const response = await this.transport.getMarkPrice({ symbol });
        const fundingState = await readFundingStateData(response);
        return normalizeFuturesFundingState(fundingState, symbol);
    }

    async getPositionRisk(symbol, positionSide) {
        const response = await this.transport.getPositionRiskV3({ symbol });
        const positionRisk = await readPositionRiskData(response);
        return normalizeFuturesPositionRisk(positionRisk, symbol, positionSide);
    }
}
