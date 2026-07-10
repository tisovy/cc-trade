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

export const FUTURES_ACCOUNT_BALANCE_ERROR_CODES = Object.freeze({
    INVALID_MARGIN_ASSET: 'INVALID_FUTURES_MARGIN_ASSET',
    MALFORMED_RESPONSE: 'MALFORMED_FUTURES_ACCOUNT_BALANCE',
    MARGIN_ASSET_UNAVAILABLE: 'FUTURES_MARGIN_ASSET_UNAVAILABLE',
});

export const FUTURES_OPEN_ORDERS_ERROR_CODES = Object.freeze({
    INVALID_SYMBOL: FUTURES_EXCHANGE_INFO_ERROR_CODES.INVALID_SYMBOL,
    MALFORMED_RESPONSE: 'MALFORMED_FUTURES_OPEN_ORDERS',
    SYMBOL_UNAVAILABLE: FUTURES_EXCHANGE_INFO_ERROR_CODES.SYMBOL_UNAVAILABLE,
});

export const FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES = Object.freeze({
    INVALID_SYMBOL: FUTURES_EXCHANGE_INFO_ERROR_CODES.INVALID_SYMBOL,
    MALFORMED_RESPONSE: 'MALFORMED_FUTURES_ALGO_OPEN_ORDERS',
    SYMBOL_UNAVAILABLE: FUTURES_EXCHANGE_INFO_ERROR_CODES.SYMBOL_UNAVAILABLE,
});

export const FUTURES_ALGO_ORDER_ERROR_CODES = Object.freeze({
    INVALID_SYMBOL: FUTURES_EXCHANGE_INFO_ERROR_CODES.INVALID_SYMBOL,
    INVALID_LOOKUP_IDENTITY: 'INVALID_FUTURES_ALGO_ORDER_LOOKUP_IDENTITY',
    LOOKUP_IDENTITY_MISMATCH: 'FUTURES_ALGO_ORDER_LOOKUP_IDENTITY_MISMATCH',
    MALFORMED_RESPONSE: 'MALFORMED_FUTURES_ALGO_ORDER',
    SYMBOL_UNAVAILABLE: FUTURES_EXCHANGE_INFO_ERROR_CODES.SYMBOL_UNAVAILABLE,
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

export class FuturesAccountBalanceError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesAccountBalanceError';
        this.code = code;
    }
}

export class FuturesOpenOrdersError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesOpenOrdersError';
        this.code = code;
    }
}

export class FuturesAlgoOpenOrdersError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesAlgoOpenOrdersError';
        this.code = code;
    }
}

export class FuturesAlgoOrderError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'FuturesAlgoOrderError';
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

const malformedAccountBalanceError = () => new FuturesAccountBalanceError(
    FUTURES_ACCOUNT_BALANCE_ERROR_CODES.MALFORMED_RESPONSE,
    'Malformed futures account-balance response',
);

const malformedOpenOrdersError = () => new FuturesOpenOrdersError(
    FUTURES_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
    'Malformed futures open-orders response',
);

const malformedAlgoOpenOrdersError = () => new FuturesAlgoOpenOrdersError(
    FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.MALFORMED_RESPONSE,
    'Malformed futures algo-open-orders response',
);

const malformedAlgoOrderError = () => new FuturesAlgoOrderError(
    FUTURES_ALGO_ORDER_ERROR_CODES.MALFORMED_RESPONSE,
    'Malformed futures algo-order response',
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

/**
 * Normalize one USDⓈ-M V3 account-balance entry selected by margin asset.
 * Balance decimals remain exact strings and the update timestamp remains an integer.
 */
export const normalizeFuturesAccountBalance = (
    accountBalanceResponse,
    requestedMarginAsset,
) => {
    if (!isNonEmptyString(requestedMarginAsset)) {
        throw new FuturesAccountBalanceError(
            FUTURES_ACCOUNT_BALANCE_ERROR_CODES.INVALID_MARGIN_ASSET,
            'Futures margin asset must be a non-empty string',
        );
    }
    if (!Array.isArray(accountBalanceResponse)) throw malformedAccountBalanceError();
    if (accountBalanceResponse.some(
        (candidate) => !isRecord(candidate) || !isNonEmptyString(candidate.asset),
    )) {
        throw malformedAccountBalanceError();
    }

    const assetIdentities = new Set();
    accountBalanceResponse.forEach((candidate) => {
        if (assetIdentities.has(candidate.asset)) throw malformedAccountBalanceError();
        assetIdentities.add(candidate.asset);
    });

    const accountBalance = accountBalanceResponse.find(
        (candidate) => candidate.asset === requestedMarginAsset,
    );
    if (!accountBalance) {
        throw new FuturesAccountBalanceError(
            FUTURES_ACCOUNT_BALANCE_ERROR_CODES.MARGIN_ASSET_UNAVAILABLE,
            `Futures margin asset "${requestedMarginAsset}" is unavailable in account-balance response`,
        );
    }

    const decimalFields = [
        'balance',
        'crossWalletBalance',
        'crossUnPnl',
        'availableBalance',
        'maxWithdrawAmount',
    ];
    if (!isNonEmptyString(accountBalance.accountAlias)
        || decimalFields.some((field) => !isNonEmptyString(accountBalance[field]))
        || typeof accountBalance.marginAvailable !== 'boolean'
        || !Number.isSafeInteger(accountBalance.updateTime)
        || accountBalance.updateTime < 0) {
        throw malformedAccountBalanceError();
    }

    return {
        marketType: 'futures',
        accountAlias: accountBalance.accountAlias,
        asset: accountBalance.asset,
        balance: accountBalance.balance,
        crossWalletBalance: accountBalance.crossWalletBalance,
        crossUnPnl: accountBalance.crossUnPnl,
        availableBalance: accountBalance.availableBalance,
        maxWithdrawAmount: accountBalance.maxWithdrawAmount,
        marginAvailable: accountBalance.marginAvailable,
        updateTime: accountBalance.updateTime,
    };
};

const requireOpenOrdersSymbol = (requestedSymbol) => {
    if (!isNonEmptyString(requestedSymbol)) {
        throw new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.INVALID_SYMBOL,
            'Futures symbol must be a non-empty string',
        );
    }
};

/**
 * Normalize current regular USDⓈ-M open orders for one explicitly requested symbol.
 * Decimal values remain exact strings, source order is preserved, and no source entry
 * is returned or mutated. Algo open orders use a separate endpoint and contract.
 */
export const normalizeFuturesOpenOrders = (openOrdersResponse, requestedSymbol) => {
    requireOpenOrdersSymbol(requestedSymbol);
    if (!Array.isArray(openOrdersResponse)) throw malformedOpenOrdersError();
    if (openOrdersResponse.length === 0) return [];
    if (openOrdersResponse.some(
        (candidate) => !isRecord(candidate) || !isNonEmptyString(candidate.symbol),
    )) {
        throw malformedOpenOrdersError();
    }

    const matchingOrders = openOrdersResponse.filter(
        (candidate) => candidate.symbol === requestedSymbol,
    );
    if (matchingOrders.length === 0) {
        throw new FuturesOpenOrdersError(
            FUTURES_OPEN_ORDERS_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in open-orders response`,
        );
    }
    if (matchingOrders.length !== openOrdersResponse.length) {
        throw malformedOpenOrdersError();
    }

    const decimalFields = [
        'avgPrice',
        'cumQuote',
        'executedQty',
        'origQty',
        'price',
        'stopPrice',
    ];
    const stringFields = [
        'clientOrderId',
        'origType',
        'side',
        'positionSide',
        'status',
        'timeInForce',
        'type',
        'workingType',
        'priceMatch',
        'selfTradePreventionMode',
    ];
    const integerFields = ['orderId', 'time', 'updateTime', 'goodTillDate'];
    const booleanFields = ['reduceOnly', 'closePosition', 'priceProtect'];
    const orderIds = new Set();
    const clientOrderIds = new Set();

    return matchingOrders.map((openOrder) => {
        if (decimalFields.some((field) => !isNonEmptyString(openOrder[field]))
            || stringFields.some((field) => !isNonEmptyString(openOrder[field]))
            || integerFields.some((field) => !Number.isSafeInteger(openOrder[field])
                || openOrder[field] < 0)
            || booleanFields.some((field) => typeof openOrder[field] !== 'boolean')
            || (openOrder.activatePrice !== undefined
                && !isNonEmptyString(openOrder.activatePrice))
            || (openOrder.priceRate !== undefined
                && !isNonEmptyString(openOrder.priceRate))) {
            throw malformedOpenOrdersError();
        }
        if (orderIds.has(openOrder.orderId)
            || clientOrderIds.has(openOrder.clientOrderId)) {
            throw malformedOpenOrdersError();
        }
        orderIds.add(openOrder.orderId);
        clientOrderIds.add(openOrder.clientOrderId);

        return {
            marketType: 'futures',
            avgPrice: openOrder.avgPrice,
            clientOrderId: openOrder.clientOrderId,
            cumQuote: openOrder.cumQuote,
            executedQty: openOrder.executedQty,
            orderId: openOrder.orderId,
            origQty: openOrder.origQty,
            origType: openOrder.origType,
            price: openOrder.price,
            reduceOnly: openOrder.reduceOnly,
            side: openOrder.side,
            positionSide: openOrder.positionSide,
            status: openOrder.status,
            stopPrice: openOrder.stopPrice,
            closePosition: openOrder.closePosition,
            symbol: openOrder.symbol,
            time: openOrder.time,
            timeInForce: openOrder.timeInForce,
            type: openOrder.type,
            activatePrice: openOrder.activatePrice ?? null,
            priceRate: openOrder.priceRate ?? null,
            updateTime: openOrder.updateTime,
            workingType: openOrder.workingType,
            priceProtect: openOrder.priceProtect,
            priceMatch: openOrder.priceMatch,
            selfTradePreventionMode: openOrder.selfTradePreventionMode,
            goodTillDate: openOrder.goodTillDate,
        };
    });
};

const requireAlgoOpenOrdersSymbol = (requestedSymbol) => {
    if (!isNonEmptyString(requestedSymbol)) {
        throw new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.INVALID_SYMBOL,
            'Futures symbol must be a non-empty string',
        );
    }
};

/**
 * Normalize current USDⓈ-M algo open orders for one explicitly requested symbol.
 * Decimal values, identifiers, nullable values, and source order remain exact while
 * regular open orders stay outside this endpoint-specific contract.
 */
export const normalizeFuturesAlgoOpenOrders = (
    algoOpenOrdersResponse,
    requestedSymbol,
) => {
    requireAlgoOpenOrdersSymbol(requestedSymbol);
    if (!Array.isArray(algoOpenOrdersResponse)) throw malformedAlgoOpenOrdersError();
    if (algoOpenOrdersResponse.length === 0) return [];
    if (algoOpenOrdersResponse.some(
        (candidate) => !isRecord(candidate) || !isNonEmptyString(candidate.symbol),
    )) {
        throw malformedAlgoOpenOrdersError();
    }

    const matchingOrders = algoOpenOrdersResponse.filter(
        (candidate) => candidate.symbol === requestedSymbol,
    );
    if (matchingOrders.length === 0) {
        throw new FuturesAlgoOpenOrdersError(
            FUTURES_ALGO_OPEN_ORDERS_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${requestedSymbol}" is unavailable in algo-open-orders response`,
        );
    }
    if (matchingOrders.length !== algoOpenOrdersResponse.length) {
        throw malformedAlgoOpenOrdersError();
    }

    const decimalFields = [
        'quantity',
        'actualPrice',
        'triggerPrice',
        'price',
        'tpTriggerPrice',
        'tpPrice',
        'slTriggerPrice',
        'slPrice',
    ];
    const nonEmptyStringFields = [
        'clientAlgoId',
        'algoType',
        'orderType',
        'side',
        'positionSide',
        'timeInForce',
        'algoStatus',
        'selfTradePreventionMode',
        'workingType',
        'priceMatch',
    ];
    const emptyStringAllowedFields = ['actualOrderId', 'tpOrderType'];
    const integerFields = [
        'algoId',
        'createTime',
        'updateTime',
        'triggerTime',
        'goodTillDate',
    ];
    const booleanFields = ['closePosition', 'priceProtect', 'reduceOnly'];
    const algoIds = new Set();
    const clientAlgoIds = new Set();

    return matchingOrders.map((algoOpenOrder) => {
        if (decimalFields.some((field) => !isNonEmptyString(algoOpenOrder[field]))
            || nonEmptyStringFields.some(
                (field) => !isNonEmptyString(algoOpenOrder[field]),
            )
            || emptyStringAllowedFields.some(
                (field) => typeof algoOpenOrder[field] !== 'string'
                    || (algoOpenOrder[field].length > 0
                        && algoOpenOrder[field].trim().length === 0),
            )
            || integerFields.some((field) => !Number.isSafeInteger(algoOpenOrder[field])
                || algoOpenOrder[field] < 0)
            || booleanFields.some(
                (field) => typeof algoOpenOrder[field] !== 'boolean',
            )
            || (algoOpenOrder.icebergQuantity !== null
                && !isNonEmptyString(algoOpenOrder.icebergQuantity))) {
            throw malformedAlgoOpenOrdersError();
        }
        if (algoIds.has(algoOpenOrder.algoId)
            || clientAlgoIds.has(algoOpenOrder.clientAlgoId)) {
            throw malformedAlgoOpenOrdersError();
        }
        algoIds.add(algoOpenOrder.algoId);
        clientAlgoIds.add(algoOpenOrder.clientAlgoId);

        return {
            marketType: 'futures',
            algoId: algoOpenOrder.algoId,
            clientAlgoId: algoOpenOrder.clientAlgoId,
            algoType: algoOpenOrder.algoType,
            orderType: algoOpenOrder.orderType,
            symbol: algoOpenOrder.symbol,
            side: algoOpenOrder.side,
            positionSide: algoOpenOrder.positionSide,
            timeInForce: algoOpenOrder.timeInForce,
            quantity: algoOpenOrder.quantity,
            algoStatus: algoOpenOrder.algoStatus,
            actualOrderId: algoOpenOrder.actualOrderId,
            actualPrice: algoOpenOrder.actualPrice,
            triggerPrice: algoOpenOrder.triggerPrice,
            price: algoOpenOrder.price,
            icebergQuantity: algoOpenOrder.icebergQuantity,
            tpTriggerPrice: algoOpenOrder.tpTriggerPrice,
            tpPrice: algoOpenOrder.tpPrice,
            slTriggerPrice: algoOpenOrder.slTriggerPrice,
            slPrice: algoOpenOrder.slPrice,
            tpOrderType: algoOpenOrder.tpOrderType,
            selfTradePreventionMode: algoOpenOrder.selfTradePreventionMode,
            workingType: algoOpenOrder.workingType,
            priceMatch: algoOpenOrder.priceMatch,
            closePosition: algoOpenOrder.closePosition,
            priceProtect: algoOpenOrder.priceProtect,
            reduceOnly: algoOpenOrder.reduceOnly,
            createTime: algoOpenOrder.createTime,
            updateTime: algoOpenOrder.updateTime,
            triggerTime: algoOpenOrder.triggerTime,
            goodTillDate: algoOpenOrder.goodTillDate,
        };
    });
};

const requireAlgoOrderExpectedSymbol = (expectedSymbol) => {
    if (!isNonEmptyString(expectedSymbol)) {
        throw new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.INVALID_SYMBOL,
            'Futures symbol must be a non-empty string',
        );
    }
};

const normalizeAlgoOrderLookupIdentity = (lookupIdentity) => {
    if (!isRecord(lookupIdentity)) {
        throw new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.INVALID_LOOKUP_IDENTITY,
            'Futures algo-order lookup must contain exactly one safe-integer algoId or non-empty clientAlgoId',
        );
    }

    const hasAlgoId = lookupIdentity.algoId !== undefined;
    const hasClientAlgoId = lookupIdentity.clientAlgoId !== undefined;
    const hasExactlyOneIdentity = hasAlgoId !== hasClientAlgoId;
    const hasValidAlgoId = !hasAlgoId
        || (Number.isSafeInteger(lookupIdentity.algoId) && lookupIdentity.algoId >= 0);
    const hasValidClientAlgoId = !hasClientAlgoId
        || isNonEmptyString(lookupIdentity.clientAlgoId);

    if (!hasExactlyOneIdentity || !hasValidAlgoId || !hasValidClientAlgoId) {
        throw new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.INVALID_LOOKUP_IDENTITY,
            'Futures algo-order lookup must contain exactly one safe-integer algoId or non-empty clientAlgoId',
        );
    }

    if (hasAlgoId) return { algoId: lookupIdentity.algoId };
    return { clientAlgoId: lookupIdentity.clientAlgoId };
};

/**
 * Normalize one identifier-scoped USDⓈ-M algo-order query response.
 * The expected symbol remains a local identity guard because the official query
 * transport accepts only one algo identifier, not a symbol.
 */
export const normalizeFuturesAlgoOrder = (
    algoOrderResponse,
    expectedSymbol,
    lookupIdentity,
) => {
    requireAlgoOrderExpectedSymbol(expectedSymbol);
    const normalizedLookupIdentity = normalizeAlgoOrderLookupIdentity(lookupIdentity);

    if (!isRecord(algoOrderResponse)
        || !isNonEmptyString(algoOrderResponse.symbol)
        || !Number.isSafeInteger(algoOrderResponse.algoId)
        || algoOrderResponse.algoId < 0
        || !isNonEmptyString(algoOrderResponse.clientAlgoId)) {
        throw malformedAlgoOrderError();
    }
    if (algoOrderResponse.symbol !== expectedSymbol) {
        throw new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.SYMBOL_UNAVAILABLE,
            `Futures symbol "${expectedSymbol}" is unavailable in algo-order response`,
        );
    }

    const [lookupField, lookupValue] = Object.entries(normalizedLookupIdentity)[0];
    if (algoOrderResponse[lookupField] !== lookupValue) {
        throw new FuturesAlgoOrderError(
            FUTURES_ALGO_ORDER_ERROR_CODES.LOOKUP_IDENTITY_MISMATCH,
            'Futures algo-order response does not match the requested lookup identity',
        );
    }

    const decimalFields = ['quantity', 'actualPrice', 'triggerPrice', 'price'];
    const nonEmptyStringFields = [
        'algoType',
        'orderType',
        'side',
        'positionSide',
        'timeInForce',
        'algoStatus',
        'selfTradePreventionMode',
        'workingType',
        'priceMatch',
    ];
    const emptyStringAllowedFields = ['actualOrderId', 'tpOrderType'];
    const timestampFields = ['createTime', 'updateTime', 'triggerTime', 'goodTillDate'];
    const booleanFields = ['closePosition', 'priceProtect', 'reduceOnly'];
    const hasActualType = algoOrderResponse.actualType !== undefined;
    const hasActualQty = algoOrderResponse.actualQty !== undefined;

    if (decimalFields.some((field) => !isNonEmptyString(algoOrderResponse[field]))
        || nonEmptyStringFields.some(
            (field) => !isNonEmptyString(algoOrderResponse[field]),
        )
        || emptyStringAllowedFields.some(
            (field) => typeof algoOrderResponse[field] !== 'string'
                || (algoOrderResponse[field].length > 0
                    && algoOrderResponse[field].trim().length === 0),
        )
        || timestampFields.some(
            (field) => !Number.isSafeInteger(algoOrderResponse[field])
                || algoOrderResponse[field] < 0,
        )
        || booleanFields.some(
            (field) => typeof algoOrderResponse[field] !== 'boolean',
        )
        || (algoOrderResponse.icebergQuantity !== null
            && !isNonEmptyString(algoOrderResponse.icebergQuantity))
        || (hasActualType && !isNonEmptyString(algoOrderResponse.actualType))
        || (hasActualQty && !isNonEmptyString(algoOrderResponse.actualQty))) {
        throw malformedAlgoOrderError();
    }

    return {
        marketType: 'futures',
        algoId: algoOrderResponse.algoId,
        clientAlgoId: algoOrderResponse.clientAlgoId,
        algoType: algoOrderResponse.algoType,
        orderType: algoOrderResponse.orderType,
        symbol: algoOrderResponse.symbol,
        side: algoOrderResponse.side,
        positionSide: algoOrderResponse.positionSide,
        timeInForce: algoOrderResponse.timeInForce,
        quantity: algoOrderResponse.quantity,
        algoStatus: algoOrderResponse.algoStatus,
        actualOrderId: algoOrderResponse.actualOrderId,
        actualPrice: algoOrderResponse.actualPrice,
        ...(hasActualType ? { actualType: algoOrderResponse.actualType } : {}),
        ...(hasActualQty ? { actualQty: algoOrderResponse.actualQty } : {}),
        triggerPrice: algoOrderResponse.triggerPrice,
        price: algoOrderResponse.price,
        icebergQuantity: algoOrderResponse.icebergQuantity,
        tpOrderType: algoOrderResponse.tpOrderType,
        selfTradePreventionMode: algoOrderResponse.selfTradePreventionMode,
        workingType: algoOrderResponse.workingType,
        priceMatch: algoOrderResponse.priceMatch,
        closePosition: algoOrderResponse.closePosition,
        priceProtect: algoOrderResponse.priceProtect,
        reduceOnly: algoOrderResponse.reduceOnly,
        createTime: algoOrderResponse.createTime,
        updateTime: algoOrderResponse.updateTime,
        triggerTime: algoOrderResponse.triggerTime,
        goodTillDate: algoOrderResponse.goodTillDate,
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

const readAccountBalanceData = async (response) => {
    if (typeof response?.data === 'function') return response.data();
    return response;
};

const readOpenOrdersData = async (response) => {
    if (typeof response?.data === 'function') return response.data();
    return response;
};

const readAlgoOpenOrdersData = async (response) => {
    if (typeof response?.data === 'function') return response.data();
    return response;
};

const readAlgoOrderData = async (response) => {
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

    async getAccountBalance(marginAsset) {
        const response = await this.transport.getBalanceV3();
        const accountBalance = await readAccountBalanceData(response);
        return normalizeFuturesAccountBalance(accountBalance, marginAsset);
    }

    async getOpenOrders(symbol) {
        requireOpenOrdersSymbol(symbol);
        const response = await this.transport.getOpenOrders({ symbol });
        const openOrders = await readOpenOrdersData(response);
        return normalizeFuturesOpenOrders(openOrders, symbol);
    }

    async getAlgoOpenOrders(symbol) {
        requireAlgoOpenOrdersSymbol(symbol);
        const response = await this.transport.getOpenAlgoOrders({ symbol });
        const algoOpenOrders = await readAlgoOpenOrdersData(response);
        return normalizeFuturesAlgoOpenOrders(algoOpenOrders, symbol);
    }

    async getAlgoOrder(expectedSymbol, lookupIdentity) {
        requireAlgoOrderExpectedSymbol(expectedSymbol);
        const normalizedLookupIdentity = normalizeAlgoOrderLookupIdentity(lookupIdentity);
        const response = await this.transport.queryAlgoOrder(normalizedLookupIdentity);
        const algoOrder = await readAlgoOrderData(response);
        return normalizeFuturesAlgoOrder(
            algoOrder,
            expectedSymbol,
            normalizedLookupIdentity,
        );
    }
}
