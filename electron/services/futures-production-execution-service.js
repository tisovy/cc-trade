import {
    createHash,
    randomBytes as nodeRandomBytes,
    timingSafeEqual,
} from 'node:crypto';
import {
    evaluateFuturesProductionActivationGates,
} from './futures-production-execution-activation.js';
import {
    FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
} from './futures-production-execution-config.js';
import {
    addExactDecimals,
    absoluteExactDecimal,
    compareExactDecimals,
    formatExactDecimal,
    isZeroExactDecimal,
    parseNonNegativeExactDecimal,
    parsePositiveExactDecimal,
    parseSignedExactDecimal,
    subtractExactDecimals,
} from './futures-production-execution-decimal.js';
import {
    FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS,
} from './futures-production-execution-facade.js';
import {
    FuturesProductionExecutionIntegerToken,
    parseFuturesProductionExecutionJson,
    readFuturesProductionExecutionIntegerToken,
} from './futures-production-execution-json.js';
import {
    canonicalFuturesProductionUtcDay,
    createFuturesProductionExecutionCommandDigest,
} from './futures-production-execution-ledger.js';
import {
    FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS,
    FUTURES_PRODUCTION_EXECUTION_ACTIONS,
    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS,
    FUTURES_PRODUCTION_EXECUTION_STATES,
    createFuturesProductionExecutionStatus,
    parseFuturesProductionExecutionCommand,
} from './futures-production-execution-protocol.js';
import {
    FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS,
    evaluateFuturesProductionExecutionRisk,
} from './futures-production-execution-risk.js';
import {
    FUTURES_OPEN_ORDER_SYNC_STATES,
    applyFuturesAcceptedAmendProjection,
    applyFuturesAcceptedCreateProjection,
    applyFuturesAlgoUpdate,
    applyFuturesAuthoritativeOrderResult,
    applyFuturesOrderTradeUpdate,
    beginFuturesOpenOrdersSnapshot,
    completeFuturesOpenOrdersSnapshot,
    createFuturesOpenOrdersReconciliationState,
    failFuturesOpenOrdersPendingCancel,
    failFuturesOpenOrdersSnapshot,
    markFuturesOpenOrdersPendingCancel,
    removeFuturesOpenOrdersForSymbols,
} from './futures-production-open-orders-reconciler.js';

const INTENT_TTL_MS = 30_000;
const FAST_RECONCILIATION_DELAYS = Object.freeze([0, 1_000, 2_000, 5_000, 10_000, 30_000]);
const SLOW_RECONCILIATION_DELAY_MS = 5 * 60_000;
const OPEN_MONITOR_DELAY_MS = 60_000;
const MAX_RECOVERY_AGE_MS = 90 * 24 * 60 * 60_000;
const MAX_MARGIN_RECOVERY_AGE_MS = 30 * 24 * 60 * 60_000;
const UTC_DAY_MS = 24 * 60 * 60_000;
const UTC_ROLLOVER_GUARD_MS = 15_000;
const MAX_DISPATCH_START_DELAY_MS = 5_000;
const BOOTSTRAP_FINGERPRINT = '0'.repeat(64);
const MAX_PORTFOLIO_ITEMS = 2_048;
const MAX_PORTFOLIO_BYTES = 1_572_864;
const CLIENT_ORDER_ID_PATTERN = /^[.A-Z:/a-z0-9_-]{1,36}$/;
const EXCHANGE_SYMBOL_PATTERN = /^[\p{Lu}\p{Lt}\p{Lo}\p{N}]{2,64}(?:_[0-9]{6})?$/u;
const MAX_EXCHANGE_SYMBOL_BYTES = 256;
const USER_DATA_KEEPALIVE_MS = 30 * 60_000;
const USER_DATA_RECONNECT_DELAYS_MS = Object.freeze([1_000, 5_000, 15_000, 60_000]);
const ACCOUNT_STATE_RETRY_DELAY_MS = 2_000;
const IDENTITY_SNAPSHOT_REUSE_MS = 5_000;

export const FUTURES_PRODUCTION_EXECUTION_SAFE_CODES = Object.freeze({
    ENABLED: 'FUTURES_PRODUCTION_ENABLED',
    DISABLED: 'FUTURES_PRODUCTION_DISABLED',
    BUSY: 'FUTURES_PRODUCTION_OPERATION_BUSY',
    COMMAND_REJECTED: 'FUTURES_PRODUCTION_COMMAND_REJECTED',
    REVISION_REJECTED: 'FUTURES_PRODUCTION_REVISION_REJECTED',
    INTENT_REJECTED: 'FUTURES_PRODUCTION_INTENT_REJECTED',
    INTENT_EXPIRED: 'FUTURES_PRODUCTION_INTENT_EXPIRED',
    GATE_REJECTED: 'FUTURES_PRODUCTION_GATE_REJECTED',
    ORDER_REJECTED: 'FUTURES_PRODUCTION_ORDER_REJECTED',
    ORDER_DISPATCHED: 'FUTURES_PRODUCTION_ORDER_DISPATCHED',
    EXCHANGE_REJECTED: 'FUTURES_PRODUCTION_EXCHANGE_REJECTED',
    RESULT_UNKNOWN: 'FUTURES_PRODUCTION_RESULT_UNKNOWN',
    CONFIRMED_OPEN: 'FUTURES_PRODUCTION_CONFIRMED_OPEN',
    CONFIRMED_FILLED: 'FUTURES_PRODUCTION_CONFIRMED_FILLED',
    CONFIRMED_CANCELED: 'FUTURES_PRODUCTION_CONFIRMED_CANCELED',
    CONFIRMED_CLOSED: 'FUTURES_PRODUCTION_CONFIRMED_CLOSED',
    MARGIN_ADJUSTED: 'FUTURES_PRODUCTION_MARGIN_ADJUSTED',
    ORDER_AMENDED: 'FUTURES_PRODUCTION_ORDER_AMENDED',
    PARTIAL: 'FUTURES_PRODUCTION_PARTIAL',
    KILL_SWITCH_ENGAGED: 'FUTURES_PRODUCTION_KILL_SWITCH_ENGAGED',
    LIVE_ARMED: 'FUTURES_PRODUCTION_LIVE_ARMED',
    RECOVERY_REQUIRED: 'FUTURES_PRODUCTION_RECOVERY_REQUIRED',
    RECOVERY_UNAVAILABLE: 'FUTURES_PRODUCTION_RECOVERY_UNAVAILABLE',
    CREDENTIAL_ROTATION_BLOCKED: 'FUTURES_PRODUCTION_CREDENTIAL_ROTATION_BLOCKED',
    STORAGE_FAILED: 'FUTURES_PRODUCTION_STORAGE_FAILED',
    CANCEL_ALL_CONFIRMED: 'FUTURES_PRODUCTION_CANCEL_ALL_CONFIRMED',
    CLOSE_POSITIONS_CONFIRMED: 'FUTURES_PRODUCTION_CLOSE_POSITIONS_CONFIRMED',
});

const PREPARE_KIND_BY_ACTION = Object.freeze({
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_MARGIN_ADJUSTMENT_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ORDER_AMENDMENT_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CANCEL_ALL_OPEN_ORDERS_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_CLOSE_POSITIONS_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_ENGAGE_KILL_SWITCH_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PREPARE_DISENGAGE_KILL_SWITCH_INTENT]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH
    ),
});

const FINAL_KIND_BY_ACTION = Object.freeze({
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH
    ),
    [FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH]: (
        FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH
    ),
});

const OPERATIONAL_RECOVERY_ACTIONS = new Set([
    'reconcile',
    'engageKillSwitch',
    'disengageKillSwitch',
]);

const ENDPOINT_IDS = Object.freeze({
    serverTime: 'server-time',
    exchangeInfo: 'exchange-info',
    markPrice: 'mark-price',
    accountConfig: 'account-config',
    symbolConfig: 'symbol-config',
    allSymbolConfig: 'all-symbol-config',
    balance: 'balance-v3',
    positionRisk: 'position-risk',
    openOrders: 'open-orders',
    allOpenOrders: 'all-open-orders',
    userDataStreamStart: 'user-data-stream-start',
    userDataStreamKeepAlive: 'user-data-stream-keepalive',
    userDataStreamClose: 'user-data-stream-close',
    openAlgoOrders: 'open-algo-orders',
    allOpenAlgoOrders: 'all-open-algo-orders',
    positionMarginHistory: 'position-margin-history',
    modifyIsolatedPositionMargin: 'modify-isolated-position-margin',
    modifyLimitOrder: 'modify-limit-order',
    placeLimitGtcOrder: 'new-limit-gtc-order',
    placeHedgeMarketExitOrder: 'new-hedge-market-exit-order',
    queryOrder: 'query-order',
    cancelAllOpenOrders: 'cancel-all-open-orders',
    cancelAllAlgoOpenOrders: 'cancel-all-algo-open-orders',
});

const READ_WEIGHTS = Object.freeze({
    serverTime: 1,
    exchangeInfo: 1,
    markPrice: 1,
    accountConfig: 5,
    symbolConfig: 5,
    allSymbolConfig: 5,
    balance: 5,
    positionRisk: 5,
    openOrders: 1,
    allOpenOrders: 40,
    userDataStreamStart: 1,
    userDataStreamKeepAlive: 1,
    userDataStreamClose: 1,
    openAlgoOrders: 1,
    allOpenAlgoOrders: 40,
    positionMarginHistory: 1,
    queryOrder: 1,
});

const TERMINAL_ORDER_STATES = new Set([
    FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_ORDER_AMENDED,
    FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_OPEN,
    FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_FILLED,
    FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CANCELED,
    FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED,
    FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
]);

const requireSafeTime = (value) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid production clock');
    return value;
};

const createRequestId = (randomBytes) => {
    const bytes = randomBytes(16);
    if (!Buffer.isBuffer(bytes) || bytes.byteLength !== 16) {
        throw new Error('invalid production randomness');
    }
    return bytes.toString('hex');
};

const safeErrorCode = error => (
    typeof error?.code === 'string' && /^FUTURES_PRODUCTION_[A-Z0-9_]{1,96}$/.test(error.code)
        ? error.code
        : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN
);

const convertUserDataStreamValue = (value, field = '') => {
    if (value instanceof FuturesProductionExecutionIntegerToken) {
        const { parsed, token } = readFuturesProductionExecutionIntegerToken(value);
        if (field === 'i' || field === 'aid') return token;
        if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error('unsafe Futures user-data integer');
        }
        return Number(parsed);
    }
    if (Array.isArray(value)) {
        return value.map(entry => convertUserDataStreamValue(entry));
    }
    if (value !== null && typeof value === 'object') {
        const result = Object.create(null);
        for (const [key, entry] of Object.entries(value)) {
            result[key] = convertUserDataStreamValue(entry, key);
        }
        return result;
    }
    return value;
};

const findSymbolEntry = (value, symbol) => {
    const rows = Array.isArray(value) ? value : [value];
    return rows.find(row => row?.symbol === symbol) ?? null;
};

const findHedgePositionEntry = (value, symbol, positionSide) => {
    const rows = (Array.isArray(value) ? value : [value]).filter(row => (
        row?.symbol === symbol && row?.positionSide === positionSide
    ));
    return rows.length === 1 ? rows[0] : null;
};

const findFilter = (symbolInfo, filterType) => (
    Array.isArray(symbolInfo?.filters)
        ? symbolInfo.filters.find(filter => filter?.filterType === filterType) ?? null
        : null
);

const verifyProductionAccountIdentity = ({ accountAlias, accountConfig, balance }) => {
    if (accountConfig?.canTrade !== true
        || accountConfig?.dualSidePosition !== true
        || accountConfig?.multiAssetsMargin !== false
        || !Array.isArray(balance)) return null;
    const usdtBalances = balance.filter(entry => entry?.asset === 'USDT');
    if (usdtBalances.length !== 1) return null;
    const [usdtBalance] = usdtBalances;
    return usdtBalance.accountAlias === accountAlias
        && usdtBalance.marginAvailable === true
        ? usdtBalance
        : null;
};

const normalizeRiskSnapshot = ({ identity, symbol, positionSide, observations }) => {
    const symbolConfig = findSymbolEntry(observations.symbolConfig, symbol);
    const position = findHedgePositionEntry(observations.positionRisk, symbol, positionSide);
    const balance = verifyProductionAccountIdentity({
        accountAlias: identity?.accountAlias,
        accountConfig: observations.accountConfig,
        balance: observations.balance,
    });
    const symbolInfo = Array.isArray(observations.exchangeInfo?.symbols)
        ? observations.exchangeInfo.symbols.find(entry => entry?.symbol === symbol)
        : null;
    const priceFilter = findFilter(symbolInfo, 'PRICE_FILTER');
    const percentPriceFilter = findFilter(symbolInfo, 'PERCENT_PRICE');
    const lotSizeFilter = findFilter(symbolInfo, 'LOT_SIZE');
    const marketLotSizeFilter = findFilter(symbolInfo, 'MARKET_LOT_SIZE');
    const minNotionalFilter = findFilter(symbolInfo, 'MIN_NOTIONAL');
    const maxNumOrdersFilter = findFilter(symbolInfo, 'MAX_NUM_ORDERS');
    if (!balance) {
        throw new FuturesProductionExecutionServiceError(
            FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
        );
    }
    if (!symbolConfig || !position || !symbolInfo
        || !priceFilter || !percentPriceFilter || !lotSizeFilter || !marketLotSizeFilter
        || !minNotionalFilter || !maxNumOrdersFilter) {
        throw new Error('incomplete production preflight');
    }
    return {
        ...identity,
        complete: true,
        fresh: true,
        clockRegressed: false,
        accountConfig: {
            canTrade: observations.accountConfig?.canTrade,
            dualSidePosition: observations.accountConfig?.dualSidePosition,
            multiAssetsMargin: observations.accountConfig?.multiAssetsMargin,
        },
        symbolConfig: {
            symbol,
            marginType: symbolConfig.marginType,
            isAutoAddMargin: symbolConfig.isAutoAddMargin,
            leverage: symbolConfig.leverage,
            maxNotionalValue: symbolConfig.maxNotionalValue,
        },
        markPrice: {
            symbol,
            markPrice: observations.markPrice?.markPrice,
        },
        position: {
            symbol,
            positionSide: position.positionSide,
            positionAmt: position.positionAmt,
            liquidationPrice: position.liquidationPrice,
            marginAsset: position.marginAsset,
        },
        balance: {
            asset: 'USDT',
            availableBalance: balance.availableBalance,
            marginAvailable: balance.marginAvailable,
        },
        exchangeInfo: {
            symbol,
            status: symbolInfo.status,
            contractType: symbolInfo.contractType,
            quoteAsset: symbolInfo.quoteAsset,
            marginAsset: symbolInfo.marginAsset,
            supportedOrderTypes: symbolInfo.orderTypes,
            supportedTimeInForce: symbolInfo.timeInForce,
            priceFilter: {
                minPrice: priceFilter.minPrice,
                maxPrice: priceFilter.maxPrice,
                tickSize: priceFilter.tickSize,
            },
            percentPriceFilter: {
                multiplierUp: percentPriceFilter.multiplierUp,
                multiplierDown: percentPriceFilter.multiplierDown,
            },
            lotSizeFilter: {
                minQty: lotSizeFilter.minQty,
                maxQty: lotSizeFilter.maxQty,
                stepSize: lotSizeFilter.stepSize,
            },
            marketLotSizeFilter: {
                minQty: marketLotSizeFilter.minQty,
                maxQty: marketLotSizeFilter.maxQty,
                stepSize: marketLotSizeFilter.stepSize,
            },
            minNotionalUsdt: minNotionalFilter.notional,
            maxOpenOrders: maxNumOrdersFilter.limit,
        },
        regularOpenOrderCount: observations.openOrders.length,
        algoOpenOrderCount: observations.openAlgoOrders.length,
    };
};

const stateFromOrder = (order) => {
    if (order.status === 'FILLED') return FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_FILLED;
    if (['CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(order.status)) {
        return FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CANCELED;
    }
    if (['NEW', 'PARTIALLY_FILLED'].includes(order.status)) {
        return FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_OPEN;
    }
    if (order.status === 'REJECTED') {
        return FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED;
    }
    return FUTURES_PRODUCTION_EXECUTION_STATES.RESULT_UNKNOWN;
};

const exactDecimalEqual = (left, right, { allowZero = false } = {}) => {
    try {
        const parse = allowZero ? parseNonNegativeExactDecimal : parsePositiveExactDecimal;
        return compareExactDecimals(parse(left), parse(right)) === 0;
    } catch {
        return false;
    }
};

const isExchangeSymbol = value => (
    typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= MAX_EXCHANGE_SYMBOL_BYTES
    && !/[a-z]/.test(value)
    && EXCHANGE_SYMBOL_PATTERN.test(value)
);

const normalizePortfolioSnapshot = ({
    availableBalanceUsdt,
    observedAt,
    positionRisk,
    orderReconciliation,
    state = 'live',
    syncCode = null,
}) => {
    if (!Array.isArray(positionRisk)
        || !Array.isArray(orderReconciliation?.orders)
        || !Object.values(FUTURES_OPEN_ORDER_SYNC_STATES).includes(orderReconciliation.syncState)
        || !['live', 'stale'].includes(state)
        || (availableBalanceUsdt !== null && typeof availableBalanceUsdt !== 'string')
        || !Number.isSafeInteger(observedAt)
        || observedAt < 0) {
        throw new Error('invalid production portfolio snapshot');
    }
    if (availableBalanceUsdt !== null) parseNonNegativeExactDecimal(availableBalanceUsdt);
    const positions = [];
    const positionKeys = new Set();
    for (const row of positionRisk) {
        if (!isExchangeSymbol(row?.symbol)
            || !['LONG', 'SHORT'].includes(row.positionSide)) {
            throw new Error('invalid production hedge position');
        }
        const signedQuantity = parseSignedExactDecimal(row.positionAmt);
        if (isZeroExactDecimal(signedQuantity)) continue;
        const leverage = Number(row.leverage);
        const marginToken = String(row.marginType).toUpperCase();
        const marginType = marginToken === 'ISOLATED'
            ? 'ISOLATED'
            : ['CROSS', 'CROSSED'].includes(marginToken) ? 'CROSSED' : null;
        if ((row.positionSide === 'LONG' && signedQuantity.coefficient < 0n)
            || (row.positionSide === 'SHORT' && signedQuantity.coefficient > 0n)
            || !Number.isSafeInteger(leverage)
            || leverage < 1
            || leverage > 125
            || marginType === null) {
            throw new Error('invalid production hedge position configuration');
        }
        const key = `${row.symbol}:${row.positionSide}`;
        if (positionKeys.has(key)) throw new Error('duplicate production hedge position');
        positionKeys.add(key);
        const quantity = formatExactDecimal(absoluteExactDecimal(signedQuantity));
        const notional = formatExactDecimal(absoluteExactDecimal(
            parseSignedExactDecimal(row.notional),
        ));
        parsePositiveExactDecimal(row.entryPrice);
        parsePositiveExactDecimal(row.markPrice);
        parsePositiveExactDecimal(notional);
        parseSignedExactDecimal(row.unRealizedProfit);
        parseNonNegativeExactDecimal(row.isolatedMargin);
        parseNonNegativeExactDecimal(row.liquidationPrice);
        positions.push({
            symbol: row.symbol,
            positionSide: row.positionSide,
            quantity,
            entryPrice: row.entryPrice,
            markPrice: row.markPrice,
            notionalUsdt: notional,
            unrealizedPnlUsdt: row.unRealizedProfit,
            isolatedMarginUsdt: row.isolatedMargin,
            liquidationPrice: row.liquidationPrice,
            leverage,
            marginType,
        });
    }

    const normalizedOrders = [];
    const orderIds = new Set();
    const clientOrderIds = new Set();
    for (const row of orderReconciliation.orders) {
        const orderKey = `${row.symbol}:${row.orderKind}:${row.orderId}`;
        const clientOrderKey = `${row.symbol}:${row.orderKind}:${row.clientOrderId}`;
        if (orderIds.has(orderKey) || clientOrderIds.has(clientOrderKey)) {
            throw new Error('duplicate production order');
        }
        orderIds.add(orderKey);
        clientOrderIds.add(clientOrderKey);
        normalizedOrders.push({
            symbol: row.symbol,
            orderKind: row.orderKind,
            orderId: row.orderId,
            clientOrderId: row.clientOrderId,
            side: row.side,
            positionSide: row.positionSide,
            positionEffect: row.positionEffect,
            price: row.price,
            originalQuantity: row.originalQuantity,
            executedQuantity: row.filledQuantity,
            status: row.status,
            type: row.type,
            timeInForce: row.timeInForce,
            isAppOwned: row.isAppOwned,
            updateTime: row.updateTime,
            syncState: row.syncState,
        });
    }

    positions.sort((left, right) => (
        `${left.symbol}:${left.positionSide}`.localeCompare(`${right.symbol}:${right.positionSide}`)
    ));
    normalizedOrders.sort((left, right) => (
        `${left.symbol}:${left.orderKind}:${left.orderId}`.localeCompare(
            `${right.symbol}:${right.orderKind}:${right.orderId}`,
        )
    ));
    const exceedsBounds = positions.length > MAX_PORTFOLIO_ITEMS
        || normalizedOrders.length > MAX_PORTFOLIO_ITEMS
        || Buffer.byteLength(JSON.stringify({ positions, openOrders: normalizedOrders }), 'utf8')
            > MAX_PORTFOLIO_BYTES;
    const projectedSyncCode = syncCode === null
        ? null
        : syncCode.startsWith('ACCOUNT_')
            ? `FUTURES_PRODUCTION_${syncCode}`
            : `FUTURES_PRODUCTION_OPEN_ORDERS_${syncCode}`;
    return exceedsBounds
        ? {
            state: 'truncated',
            observedAt,
            availableBalanceUsdt,
            syncState: orderReconciliation.syncState,
            syncCode: projectedSyncCode,
            positions: [],
            openOrders: [],
        }
        : {
            state,
            observedAt,
            availableBalanceUsdt,
            syncState: orderReconciliation.syncState,
            syncCode: projectedSyncCode,
            positions,
            openOrders: normalizedOrders,
        };
};

const durableOrderFields = draft => ({
    symbol: draft.symbol,
    side: draft.side,
    positionSide: draft.positionSide,
    positionEffect: draft.positionEffect,
    orderType: draft.type,
    timeInForce: draft.timeInForce,
    quantity: draft.quantity,
    price: draft.price,
});

const durableMarginFields = draft => ({
    symbol: draft.symbol,
    positionSide: draft.positionSide,
    marginAction: draft.marginAction,
    amount: draft.amount,
    marginBefore: draft.marginBefore,
});

const acknowledgementForState = state => {
    if ([
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_FILLED,
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CANCELED,
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_OPEN,
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CLOSED,
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_MARGIN_ADJUSTED,
        FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_ORDER_AMENDED,
        FUTURES_PRODUCTION_EXECUTION_STATES.KILL_SWITCH_ENGAGED,
        FUTURES_PRODUCTION_EXECUTION_STATES.KILL_SWITCH_DISENGAGED,
    ].includes(state)) return FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.ACCEPTED;
    if ([
        FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
        FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED,
    ].includes(state)) return FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.REJECTED;
    if (state === FUTURES_PRODUCTION_EXECUTION_STATES.PARTIAL) {
        return FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.PARTIAL;
    }
    if ([
        FUTURES_PRODUCTION_EXECUTION_STATES.RESULT_UNKNOWN,
        FUTURES_PRODUCTION_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE,
        FUTURES_PRODUCTION_EXECUTION_STATES.RECOVERY_REQUIRED,
    ].includes(state)) return FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN;
    return FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.PENDING;
};

export class FuturesProductionExecutionServiceError extends Error {
    constructor(code) {
        super('Futures production execution service is unavailable');
        this.name = 'FuturesProductionExecutionServiceError';
        this.code = code;
    }
}

export const createFuturesProductionExecutionService = ({
    config,
    credentialBinding = null,
    ledger,
    facade = null,
    coordinator = null,
    evaluateRisk = evaluateFuturesProductionExecutionRisk,
    randomBytes = nodeRandomBytes,
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onInternalError = () => {},
} = {}) => {
    if (!config || !ledger || typeof ledger.append !== 'function'
        || typeof evaluateRisk !== 'function' || typeof randomBytes !== 'function'
        || typeof now !== 'function') {
        throw new FuturesProductionExecutionServiceError('INVALID_COMPOSITION');
    }

    const sessions = new Map();
    const timers = new Set();
    const backgroundTasks = new Set();
    const inFlightOperations = new Set();
    const finalCommandExecutions = new Map();
    const generation = createRequestId(randomBytes);
    let revision = '0';
    let started = false;
    let shuttingDown = false;
    let storageHealthy = false;
    let recoveryHealthy = true;
    let failedClosed = false;
    let identityValid = false;
    let killSwitchEngaged = true;
    let activeIntent = null;
    let currentAttempt = null;
    let portfolio = {
        state: 'unavailable',
        observedAt: null,
        availableBalanceUsdt: null,
        syncState: FUTURES_OPEN_ORDER_SYNC_STATES.IDLE,
        syncCode: 'FUTURES_PRODUCTION_ACCOUNT_UNAVAILABLE',
        positions: [],
        openOrders: [],
    };
    let openOrdersReconciliation = createFuturesOpenOrdersReconciliationState();
    let latestPositionRisk = [];
    let latestAvailableBalanceUsdt = null;
    let latestAccountConfig = null;
    let latestSymbolConfigurations = [];
    let identityBootstrapSnapshot = null;
    let portfolioRefreshPromise = null;
    let portfolioRetryTimer = null;
    let identityRetryTimer = null;
    let identityRetryAttempt = 0;
    let userDataStreamGeneration = 0;
    let userDataStreamHandle = null;
    let userDataStreamLive = false;
    let userDataListenKey = null;
    let userDataKeepAliveTimer = null;
    let userDataReconnectTimer = null;
    let userDataReconnectAttempt = 0;
    let lastOwnedPortfolioSnapshotGeneration = null;
    let accountUpdateRefreshTimer = null;
    let accountStateRefreshPromise = null;
    let accountUpdateRefreshPending = false;
    let accountUpdateNeedsConfigurationRefresh = false;
    let reconciliation = null;
    let recovery = {
        required: false,
        state: 'healthy',
        code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED,
    };
    let activation = {
        enabled: false,
        code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.DISABLED,
        failedGate: 'operatorConfigured',
    };
    let mutex = false;
    let transitionTail = Promise.resolve();
    let activeOperation = null;
    let lastServerTime = null;
    let ratePauseRefreshAt = null;
    let operationalRecoveryInProgress = false;
    let deferredReconciliation = null;
    let shutdownCompletion = null;

    const readNow = () => requireSafeTime(now());
    const advanceRevision = () => {
        revision = String(BigInt(revision) + 1n);
        return revision;
    };
    const account = config.configured && config.account
        ? { alias: config.account.alias, fingerprint: config.account.fingerprint }
        : null;
    const policy = config.configured ? config.policy : null;
    const identity = account && credentialBinding ? {
        environment: 'production',
        accountAlias: account.alias,
        apiKeyFingerprint: account.fingerprint,
        credentialBinding,
        generation,
    } : null;

    const reportInternal = (phase, error) => {
        try {
            onInternalError({ phase, code: safeErrorCode(error) });
        } catch {
            // Diagnostics cannot affect the authorization boundary.
        }
    };

    const trackInFlight = (operation) => {
        const tracked = Promise.resolve(operation)
            .finally(() => inFlightOperations.delete(tracked));
        inFlightOperations.add(tracked);
        return tracked;
    };

    const schedule = (callback, delay) => {
        if (shuttingDown) return null;
        const timer = setTimeoutFn(() => {
            timers.delete(timer);
            const task = Promise.resolve()
                .then(callback)
                .catch(error => reportInternal('scheduled-task', error))
                .finally(() => backgroundTasks.delete(task));
            backgroundTasks.add(task);
        }, delay);
        timers.add(timer);
        return timer;
    };

    const cancelScheduled = (timer) => {
        if (timer === null) return;
        clearTimeoutFn(timer);
        timers.delete(timer);
    };

    const runBackground = (phase, operation) => {
        const task = Promise.resolve()
            .then(operation)
            .catch(error => reportInternal(phase, error))
            .finally(() => backgroundTasks.delete(task));
        backgroundTasks.add(task);
        return task;
    };

    const getDailyState = () => {
        const snapshot = coordinator?.getOrderAdmissionSnapshot?.()
            ?? ledger.getOrderRateState?.()
            ?? {};
        const timestamp = lastServerTime ?? readNow();
        const utcDay = canonicalFuturesProductionUtcDay(timestamp);
        return {
            utcDay,
            used: snapshot.dailyReservations?.[utcDay] ?? '0',
        };
    };

    const getCaps = () => {
        if (!policy) return null;
        const daily = getDailyState();
        const symbolConfigurations = policy.allowedSymbols.map(symbol => {
            const configuration = findSymbolEntry(latestSymbolConfigurations, symbol);
            if (!configuration) return null;
            const marginToken = String(configuration.marginType).toUpperCase();
            const marginType = marginToken === 'ISOLATED'
                ? 'ISOLATED'
                : ['CROSS', 'CROSSED'].includes(marginToken) ? 'CROSSED' : null;
            const leverage = Number(configuration.leverage);
            if (marginType === null
                || !Number.isSafeInteger(leverage)
                || leverage < 1
                || leverage > 125
                || typeof configuration.isAutoAddMargin !== 'boolean') return null;
            return {
                symbol,
                marginType,
                leverage,
                isAutoAddMargin: configuration.isAutoAddMargin,
            };
        }).filter(Boolean);
        return {
            allowedSymbols: [...policy.allowedSymbols],
            symbolConfigurations,
            maxLeverage: policy.maxLeverage,
            maxOrderNotionalUsdt: policy.maxOrderNotionalUsdt,
            maxDailyNotionalUsdt: policy.maxDailyNotionalUsdt,
            minAvailableBalanceUsdt: policy.minAvailableBalanceUsdt,
            minLiquidationDistanceBps: policy.minLiquidationDistanceBps,
            dailyUsedNotionalUsdt: daily.used,
            utcDay: daily.utcDay,
        };
    };

    const capabilitySnapshot = (session) => {
        const operational = started
            && !shuttingDown
            && !failedClosed
            && activation.enabled
            && recovery.required === false
            && !mutex
            && activeOperation === null;
        const canPrepare = operational && activeIntent === null;
        const ownsIntent = operational
            && activeIntent !== null
            && session !== null
            && session !== undefined
            && activeIntent.connectionId === session.connectionId
            && activeIntent.expiresAt > readNow();
        const canFinalize = kind => ownsIntent && activeIntent.kind === kind;
        const placeOrder = canPrepare || canFinalize(
            FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER,
        );
        const adjustMargin = (canPrepare
            && portfolio.state === 'live'
            && portfolio.positions.length > 0)
            || canFinalize(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT);
        const amendOrder = (canPrepare
            && portfolio.state === 'live'
            && portfolio.syncState === FUTURES_OPEN_ORDER_SYNC_STATES.LIVE
            && portfolio.openOrders.length > 0)
            || canFinalize(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT);
        const cancelAllOpenOrders = canPrepare || canFinalize(
            FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS,
        );
        const closePositions = canPrepare || canFinalize(
            FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
        );
        const engageKillSwitch = (canPrepare && !killSwitchEngaged) || canFinalize(
            FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH,
        );
        const disengageKillSwitch = (canPrepare && killSwitchEngaged) || canFinalize(
            FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH,
        );
        const anyCapability = placeOrder
            || adjustMargin
            || amendOrder
            || cancelAllOpenOrders
            || closePositions
            || engageKillSwitch
            || disengageKillSwitch;
        return {
            placeOrder,
            adjustMargin,
            amendOrder,
            cancelAllOpenOrders,
            closePositions,
            engageKillSwitch,
            disengageKillSwitch,
            code: anyCapability ? activation.code : (
                mutex ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.BUSY : activation.code
            ),
        };
    };

    const statusFor = (session) => createFuturesProductionExecutionStatus({
        revision,
        liveAuthorized: config.liveAuthorized === true,
        configured: config.configured === true,
        account,
        caps: getCaps(),
        killSwitch: {
            engaged: killSwitchEngaged,
            policy: FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
        },
        capabilities: capabilitySnapshot(session),
        intent: activeIntent !== null
            && session !== null
            && session !== undefined
            && activeIntent.connectionId === session.connectionId
            && activeIntent.expiresAt > readNow()
            ? {
                requestId: activeIntent.requestId,
                kind: activeIntent.kind,
                revision: activeIntent.revision,
                expiresAt: activeIntent.expiresAt,
            }
            : null,
        attempt: currentAttempt,
        reconciliation,
        recovery,
        portfolio,
    });

    const emitStatus = (session) => {
        if (!session?.subscribed || typeof session.emit !== 'function') return null;
        const status = statusFor(session);
        session.emit(status);
        return status;
    };

    const broadcastStatus = () => {
        for (const session of sessions.values()) emitStatus(session);
    };

    const poison = (phase, error) => {
        failedClosed = true;
        storageHealthy = false;
        recoveryHealthy = false;
        recovery = {
            required: true,
            state: 'blocked',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.STORAGE_FAILED,
        };
        activation = {
            enabled: false,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.STORAGE_FAILED,
            failedGate: 'storageHealthy',
        };
        reportInternal(phase, error);
        broadcastStatus();
    };

    const blockRecovery = ({
        code = FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
        reconciliationState = 'unavailable',
    } = {}) => {
        recoveryHealthy = false;
        reconciliation = { required: true, state: reconciliationState, nextAttemptAt: null };
        recovery = { required: true, state: 'blocked', code };
        activation = { enabled: false, code, failedGate: 'recoveryHealthy' };
        advanceRevision();
        broadcastStatus();
        return false;
    };

    const appendAuditNow = async (fields) => {
        const entry = await ledger.append({
            observedAt: readNow(),
            accountAlias: account?.alias ?? null,
            accountFingerprint: account?.fingerprint ?? null,
            credentialBinding,
            ...fields,
        });
        return entry;
    };

    const appendAudit = (fields) => {
        const operation = transitionTail.then(() => appendAuditNow(fields));
        transitionTail = operation.catch(error => poison('persistence', error));
        return operation;
    };

    const setAttempt = async ({
        requestId,
        kind,
        state,
        code,
        items = [],
        eventType = 'acknowledgement',
        category = 'command',
        outcome = 'pending',
        audit = {},
    }) => {
        await appendAudit({
            eventType,
            category,
            outcome,
            requestId,
            operationId: requestId,
            state,
            code,
            ...audit,
        });
        advanceRevision();
        currentAttempt = {
            requestId,
            kind,
            revision,
            acknowledgement: acknowledgementForState(state),
            state,
            code,
            observedAt: readNow(),
            items,
        };
        broadcastStatus();
        return currentAttempt;
    };

    const auditExchangeResponse = async ({
        receipt = null,
        error = null,
        outcome,
        audit = {},
    }) => {
        const endpointId = receipt?.endpointId ?? error?.endpointId ?? 'unknown-endpoint';
        const detailDigest = receipt?.bodyDigest ?? error?.bodyDigest ?? null;
        await appendAudit({
            ...audit,
            eventType: 'exchange_response',
            category: 'exchange',
            outcome,
            endpointId,
            detailDigest,
            code: error ? safeErrorCode(error) : 'FUTURES_PRODUCTION_EXCHANGE_RESPONSE',
        });
    };

    const invokeExchange = async ({ endpointId, execute, operation, audit = {} }) => {
        await appendAudit({
            ...audit,
            eventType: 'exchange_request',
            category: 'exchange',
            outcome: 'pending',
            endpointId,
            code: 'FUTURES_PRODUCTION_EXCHANGE_REQUEST',
        });
        try {
            const result = await execute(operation);
            await auditExchangeResponse({
                receipt: result.receipt,
                outcome: 'accepted',
                audit,
            });
            return result.data;
        } catch (error) {
            const rejected = error?.kind
                === FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED
                || error?.kind === FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED;
            await auditExchangeResponse({
                error,
                outcome: rejected ? 'rejected' : 'unknown',
                audit,
            }).catch(() => {});
            if (error?.kind === FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.RATE_LIMITED) {
                const pauseUntil = readNow() + (error.status === 418 ? 3 * 24 * 60 * 60_000 : 120_000);
                try {
                    await coordinator?.setOrderPauseUntil?.(pauseUntil, {
                        eventType: 'rate_pause',
                        category: 'rate',
                        outcome: 'accepted',
                        code: 'FUTURES_PRODUCTION_RATE_PAUSED',
                    });
                    await refreshActivation();
                } catch (rateError) {
                    poison('rate-pause', rateError);
                }
            }
            throw error;
        }
    };

    const executeRead = ({ lease = null, endpointId, weight, operation, audit = {} }) => (
        invokeExchange({
            endpointId,
            operation,
            audit,
            execute: callback => (lease
                ? lease.executeGet(callback, weight, { endpointId })
                : coordinator.executeGet(callback, weight, { endpointId })),
        })
    );

    const executeProduction = ({ endpointId, weight = 1, operation, audit = {} }) => (
        invokeExchange({
            endpointId,
            operation,
            audit,
            execute: callback => coordinator.executeProduction(callback, weight, {
                endpointId,
                priority: 'low',
            }),
        })
    );

    const projectCurrentPortfolio = ({ state = 'stale', syncCode = null } = {}) => {
        const observedAt = Math.max(
            portfolio.observedAt ?? 0,
            openOrdersReconciliation.observedAt ?? 0,
            openOrdersReconciliation.snapshotStartedAt ?? 0,
        );
        portfolio = normalizePortfolioSnapshot({
            allowedSymbols: policy?.allowedSymbols ?? [],
            availableBalanceUsdt: latestAvailableBalanceUsdt,
            observedAt,
            positionRisk: latestPositionRisk,
            orderReconciliation: openOrdersReconciliation,
            state,
            syncCode: syncCode ?? (
                openOrdersReconciliation.syncState === FUTURES_OPEN_ORDER_SYNC_STATES.LIVE
                    ? null
                    : openOrdersReconciliation.errorCode ?? 'SNAPSHOT_UNAVAILABLE'
            ),
        });
        return portfolio;
    };

    const schedulePortfolioRetry = () => {
        if (shuttingDown || !identityValid || portfolioRetryTimer !== null) return;
        portfolioRetryTimer = schedule(async () => {
            portfolioRetryTimer = null;
            await refreshPortfolio();
        }, 2_000);
    };

    const refreshPortfolioNow = async () => {
        if (!identityValid || !policy || !facade || !coordinator) {
            portfolio = {
                state: 'unavailable',
                observedAt: null,
                availableBalanceUsdt: null,
                syncState: openOrdersReconciliation.syncState,
                syncCode: 'FUTURES_PRODUCTION_ACCOUNT_UNAVAILABLE',
                positions: [],
                openOrders: [],
            };
            return portfolio;
        }
        const snapshotStreamGeneration = userDataStreamGeneration;
        const snapshotStartedWithLiveStream = userDataStreamLive;
        openOrdersReconciliation = beginFuturesOpenOrdersSnapshot(
            openOrdersReconciliation,
            { startedAt: readNow() },
        );
        projectCurrentPortfolio({
            state: portfolio.state === 'live' ? 'live' : 'stale',
        });
        advanceRevision();
        broadcastStatus();
        const snapshotId = openOrdersReconciliation.activeSnapshotId;
        let lease = null;
        let accountIdentityRejected = false;
        try {
            lease = await coordinator.beginPreflight();
            const cachedIdentity = identityBootstrapSnapshot !== null
                && readNow() - identityBootstrapSnapshot.observedAt <= IDENTITY_SNAPSHOT_REUSE_MS
                ? identityBootstrapSnapshot
                : null;
            identityBootstrapSnapshot = null;
            const serverTime = cachedIdentity === null
                ? await executeRead({
                    lease,
                    endpointId: ENDPOINT_IDS.serverTime,
                    weight: READ_WEIGHTS.serverTime,
                    operation: () => facade.getServerTime(),
                })
                : { serverTime: cachedIdentity.serverTime };
            if (lastServerTime !== null && serverTime.serverTime < lastServerTime) {
                throw new FuturesProductionExecutionServiceError(
                    'FUTURES_PRODUCTION_SERVER_CLOCK_REGRESSED',
                );
            }
            const accountConfig = cachedIdentity === null
                ? await executeRead({
                    lease,
                    endpointId: ENDPOINT_IDS.accountConfig,
                    weight: READ_WEIGHTS.accountConfig,
                    operation: () => facade.getAccountConfig(),
                })
                : cachedIdentity.accountConfig;
            const balance = cachedIdentity === null
                ? await executeRead({
                    lease,
                    endpointId: ENDPOINT_IDS.balance,
                    weight: READ_WEIGHTS.balance,
                    operation: () => facade.getBalance(),
                })
                : null;
            const positionRisk = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.positionRisk,
                weight: READ_WEIGHTS.positionRisk,
                operation: () => facade.getAllPositionRisk(),
            });
            const symbolConfigurations = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.allSymbolConfig,
                weight: READ_WEIGHTS.allSymbolConfig,
                operation: () => facade.getAllSymbolConfig(),
            });
            lease.release();
            lease = null;
            const openOrders = await executeRead({
                endpointId: ENDPOINT_IDS.allOpenOrders,
                weight: READ_WEIGHTS.allOpenOrders,
                operation: () => facade.getAllOpenOrders(),
            });
            const openAlgoOrders = await executeRead({
                endpointId: ENDPOINT_IDS.allOpenAlgoOrders,
                weight: READ_WEIGHTS.allOpenAlgoOrders,
                operation: () => facade.getAllOpenAlgoOrders(),
            });
            const verifiedBalance = cachedIdentity === null
                ? verifyProductionAccountIdentity({
                    accountAlias: identity?.accountAlias,
                    accountConfig,
                    balance,
                })
                : { availableBalance: cachedIdentity.availableBalanceUsdt };
            if (!verifiedBalance) {
                accountIdentityRejected = true;
                throw new FuturesProductionExecutionServiceError(
                    FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
                );
            }
            lastServerTime = serverTime.serverTime;
            openOrdersReconciliation = completeFuturesOpenOrdersSnapshot(
                openOrdersReconciliation,
                {
                    snapshotId,
                    rows: [...openOrders, ...openAlgoOrders],
                    completedAt: serverTime.serverTime,
                },
            );
            latestPositionRisk = positionRisk;
            latestAvailableBalanceUsdt = verifiedBalance.availableBalance;
            latestAccountConfig = accountConfig;
            latestSymbolConfigurations = symbolConfigurations;
            const snapshotOwnsLiveStream = snapshotStartedWithLiveStream
                && userDataStreamLive
                && snapshotStreamGeneration === userDataStreamGeneration;
            if (!snapshotOwnsLiveStream) {
                openOrdersReconciliation = beginFuturesOpenOrdersSnapshot(
                    openOrdersReconciliation,
                    { startedAt: serverTime.serverTime },
                );
                openOrdersReconciliation = failFuturesOpenOrdersSnapshot(
                    openOrdersReconciliation,
                    {
                        snapshotId: openOrdersReconciliation.activeSnapshotId,
                        errorCode: 'ACCOUNT_STREAM_UNAVAILABLE',
                    },
                );
            }
            portfolio = normalizePortfolioSnapshot({
                allowedSymbols: policy.allowedSymbols,
                availableBalanceUsdt: latestAvailableBalanceUsdt,
                observedAt: serverTime.serverTime,
                positionRisk,
                orderReconciliation: openOrdersReconciliation,
                state: snapshotOwnsLiveStream ? 'live' : 'stale',
                syncCode: snapshotOwnsLiveStream ? null : 'ACCOUNT_STREAM_UNAVAILABLE',
            });
            if (snapshotOwnsLiveStream) {
                lastOwnedPortfolioSnapshotGeneration = snapshotStreamGeneration;
            }
            cancelScheduled(portfolioRetryTimer);
            portfolioRetryTimer = null;
            advanceRevision();
            broadcastStatus();
            return portfolio;
        } catch (error) {
            const identityRejected = accountIdentityRejected
                || error?.kind === FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED;
            const snapshotErrorCode = identityRejected
                ? 'ACCOUNT_IDENTITY_REJECTED'
                : 'SNAPSHOT_UNAVAILABLE';
            openOrdersReconciliation = failFuturesOpenOrdersSnapshot(
                openOrdersReconciliation,
                { snapshotId, errorCode: snapshotErrorCode },
            );
            projectCurrentPortfolio({ state: 'stale', syncCode: snapshotErrorCode });
            reportInternal('portfolio-refresh', error);
            if (identityRejected) {
                identityValid = false;
                identityBootstrapSnapshot = null;
                latestAccountConfig = null;
                userDataStreamLive = false;
                userDataStreamGeneration += 1;
                cancelScheduled(userDataKeepAliveTimer);
                userDataKeepAliveTimer = null;
                cancelScheduled(userDataReconnectTimer);
                userDataReconnectTimer = null;
                closeCurrentUserDataSocket();
                userDataListenKey = null;
                await refreshActivation({ audit: false });
                scheduleIdentityRetry();
            }
            advanceRevision();
            broadcastStatus();
            schedulePortfolioRetry();
            return portfolio;
        } finally {
            lease?.release();
        }
    };

    const refreshPortfolio = () => {
        if (portfolioRefreshPromise !== null) return portfolioRefreshPromise;
        portfolioRefreshPromise = (async () => {
            const activeAccountStateRefresh = accountStateRefreshPromise;
            if (activeAccountStateRefresh !== null) await activeAccountStateRefresh;
            return refreshPortfolioNow();
        })()
            .finally(() => {
                portfolioRefreshPromise = null;
            });
        return portfolioRefreshPromise;
    };

    const closeCurrentUserDataSocket = () => {
        const handle = userDataStreamHandle;
        userDataStreamHandle = null;
        handle?.close();
    };

    const refreshAccountStateNow = async ({ refreshConfiguration = false } = {}) => {
        if (!identityValid || !policy || !facade || !coordinator) return false;
        let lease = null;
        let accountIdentityRejected = false;
        try {
            lease = await coordinator.beginPreflight();
            const serverTime = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.serverTime,
                weight: READ_WEIGHTS.serverTime,
                operation: () => facade.getServerTime(),
            });
            if (lastServerTime !== null && serverTime.serverTime < lastServerTime) {
                throw new FuturesProductionExecutionServiceError(
                    'FUTURES_PRODUCTION_SERVER_CLOCK_REGRESSED',
                );
            }
            const requiresConfiguration = refreshConfiguration
                || latestAccountConfig === null
                || latestSymbolConfigurations.length === 0;
            const accountConfig = requiresConfiguration
                ? await executeRead({
                    lease,
                    endpointId: ENDPOINT_IDS.accountConfig,
                    weight: READ_WEIGHTS.accountConfig,
                    operation: () => facade.getAccountConfig(),
                })
                : latestAccountConfig;
            const balance = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.balance,
                weight: READ_WEIGHTS.balance,
                operation: () => facade.getBalance(),
            });
            const positionRisk = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.positionRisk,
                weight: READ_WEIGHTS.positionRisk,
                operation: () => facade.getAllPositionRisk(),
            });
            const symbolConfigurations = requiresConfiguration
                ? await executeRead({
                    lease,
                    endpointId: ENDPOINT_IDS.allSymbolConfig,
                    weight: READ_WEIGHTS.allSymbolConfig,
                    operation: () => facade.getAllSymbolConfig(),
                })
                : latestSymbolConfigurations;
            const verifiedBalance = verifyProductionAccountIdentity({
                accountAlias: identity?.accountAlias,
                accountConfig,
                balance,
            });
            if (!verifiedBalance) {
                accountIdentityRejected = true;
                throw new FuturesProductionExecutionServiceError(
                    FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
                );
            }
            lastServerTime = serverTime.serverTime;
            latestAccountConfig = accountConfig;
            latestAvailableBalanceUsdt = verifiedBalance.availableBalance;
            latestPositionRisk = positionRisk;
            latestSymbolConfigurations = symbolConfigurations;
            projectCurrentPortfolio({
                state: userDataStreamLive ? 'live' : 'stale',
                syncCode: userDataStreamLive ? null : 'ACCOUNT_STREAM_UNAVAILABLE',
            });
            advanceRevision();
            broadcastStatus();
            return true;
        } catch (error) {
            const identityRejected = accountIdentityRejected
                || error?.kind === FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.AUTH_REJECTED;
            const refreshCode = identityRejected
                ? 'ACCOUNT_IDENTITY_REJECTED'
                : 'ACCOUNT_STATE_REFRESH_UNAVAILABLE';
            reportInternal('account-state-refresh', error);
            projectCurrentPortfolio({ state: 'stale', syncCode: refreshCode });
            if (identityRejected) {
                identityValid = false;
                identityBootstrapSnapshot = null;
                latestAccountConfig = null;
                userDataStreamLive = false;
                userDataStreamGeneration += 1;
                cancelScheduled(userDataKeepAliveTimer);
                userDataKeepAliveTimer = null;
                cancelScheduled(userDataReconnectTimer);
                userDataReconnectTimer = null;
                closeCurrentUserDataSocket();
                userDataListenKey = null;
                await refreshActivation({ audit: false });
                scheduleIdentityRetry();
            }
            advanceRevision();
            broadcastStatus();
            return false;
        } finally {
            lease?.release();
        }
    };

    const flushAccountStateRefresh = () => {
        if (accountStateRefreshPromise !== null) return accountStateRefreshPromise;
        accountStateRefreshPromise = (async () => {
            const activePortfolioRefresh = portfolioRefreshPromise;
            if (activePortfolioRefresh !== null) await activePortfolioRefresh;
            while (!shuttingDown && identityValid && accountUpdateRefreshPending) {
                const refreshConfiguration = accountUpdateNeedsConfigurationRefresh;
                accountUpdateRefreshPending = false;
                accountUpdateNeedsConfigurationRefresh = false;
                const refreshed = await refreshAccountStateNow({ refreshConfiguration });
                if (!refreshed && identityValid && !shuttingDown) {
                    accountUpdateRefreshPending = true;
                    accountUpdateNeedsConfigurationRefresh ||= refreshConfiguration;
                    if (accountUpdateRefreshTimer === null) {
                        accountUpdateRefreshTimer = schedule(async () => {
                            accountUpdateRefreshTimer = null;
                            await flushAccountStateRefresh();
                        }, ACCOUNT_STATE_RETRY_DELAY_MS);
                    }
                    break;
                }
            }
            if (!identityValid) {
                accountUpdateRefreshPending = false;
                accountUpdateNeedsConfigurationRefresh = false;
            }
        })().finally(() => {
            accountStateRefreshPromise = null;
        });
        return accountStateRefreshPromise;
    };

    const markAccountStreamDegraded = (code = 'ACCOUNT_STREAM_UNAVAILABLE') => {
        userDataStreamLive = false;
        if (openOrdersReconciliation.activeSnapshotId === null) {
            openOrdersReconciliation = beginFuturesOpenOrdersSnapshot(
                openOrdersReconciliation,
                { startedAt: readNow() },
            );
        }
        openOrdersReconciliation = failFuturesOpenOrdersSnapshot(
            openOrdersReconciliation,
            {
                snapshotId: openOrdersReconciliation.activeSnapshotId,
                errorCode: code,
            },
        );
        projectCurrentPortfolio({ state: 'stale', syncCode: code });
        advanceRevision();
        broadcastStatus();
    };

    const scheduleUserDataReconnect = (
        code = 'ACCOUNT_STREAM_UNAVAILABLE',
        expectedGeneration = userDataStreamGeneration,
    ) => {
        if (shuttingDown || expectedGeneration !== userDataStreamGeneration) return;
        cancelScheduled(userDataKeepAliveTimer);
        userDataKeepAliveTimer = null;
        closeCurrentUserDataSocket();
        markAccountStreamDegraded(code);
        if (userDataReconnectTimer !== null) return;
        const delay = USER_DATA_RECONNECT_DELAYS_MS[Math.min(
            userDataReconnectAttempt,
            USER_DATA_RECONNECT_DELAYS_MS.length - 1,
        )];
        userDataReconnectAttempt += 1;
        userDataReconnectTimer = schedule(async () => {
            userDataReconnectTimer = null;
            await startUserDataStream();
        }, delay);
    };

    const scheduleUserDataKeepAlive = (expectedGeneration) => {
        cancelScheduled(userDataKeepAliveTimer);
        userDataKeepAliveTimer = schedule(async () => {
            userDataKeepAliveTimer = null;
            if (shuttingDown || expectedGeneration !== userDataStreamGeneration) return;
            try {
                const renewedStream = await executeRead({
                    endpointId: ENDPOINT_IDS.userDataStreamKeepAlive,
                    weight: READ_WEIGHTS.userDataStreamKeepAlive,
                    operation: () => facade.keepAliveUserDataStream(),
                });
                if (renewedStream.listenKey !== userDataListenKey) {
                    throw new FuturesProductionExecutionServiceError(
                        'FUTURES_PRODUCTION_ACCOUNT_STREAM_KEY_MISMATCH',
                    );
                }
                scheduleUserDataKeepAlive(expectedGeneration);
            } catch (error) {
                reportInternal('account-stream-keepalive', error);
                scheduleUserDataReconnect('ACCOUNT_STREAM_UNAVAILABLE', expectedGeneration);
            }
        }, USER_DATA_KEEPALIVE_MS);
    };

    const handleUserDataStreamMessage = (raw, expectedGeneration) => {
        if (shuttingDown || expectedGeneration !== userDataStreamGeneration) return;
        let event;
        try {
            event = convertUserDataStreamValue(parseFuturesProductionExecutionJson(raw));
        } catch (error) {
            reportInternal('account-stream-frame', error);
            scheduleUserDataReconnect('ACCOUNT_STREAM_INVALID_EVENT', expectedGeneration);
            return;
        }
        if (event?.e === 'ORDER_TRADE_UPDATE') {
            try {
                openOrdersReconciliation = applyFuturesOrderTradeUpdate(
                    openOrdersReconciliation,
                    event,
                );
                projectCurrentPortfolio({
                    state: portfolio.state === 'live' ? 'live' : 'stale',
                });
                advanceRevision();
                broadcastStatus();
            } catch (error) {
                reportInternal('account-stream-order', error);
                scheduleUserDataReconnect('ACCOUNT_STREAM_INVALID_EVENT', expectedGeneration);
            }
            return;
        }
        if (event?.e === 'ALGO_UPDATE') {
            try {
                openOrdersReconciliation = applyFuturesAlgoUpdate(
                    openOrdersReconciliation,
                    event,
                );
                projectCurrentPortfolio({
                    state: portfolio.state === 'live' ? 'live' : 'stale',
                });
                advanceRevision();
                broadcastStatus();
            } catch (error) {
                reportInternal('account-stream-algo-order', error);
                scheduleUserDataReconnect('ACCOUNT_STREAM_INVALID_EVENT', expectedGeneration);
            }
            return;
        }
        if (event?.e === 'ACCOUNT_UPDATE' || event?.e === 'ACCOUNT_CONFIG_UPDATE') {
            accountUpdateRefreshPending = true;
            if (event.e === 'ACCOUNT_CONFIG_UPDATE') {
                accountUpdateNeedsConfigurationRefresh = true;
            }
            if (accountUpdateRefreshTimer !== null || accountStateRefreshPromise !== null) return;
            accountUpdateRefreshTimer = schedule(async () => {
                accountUpdateRefreshTimer = null;
                await flushAccountStateRefresh();
            }, 100);
            return;
        }
        if (event?.e === 'listenKeyExpired') {
            scheduleUserDataReconnect('ACCOUNT_STREAM_EXPIRED', expectedGeneration);
        }
    };

    const startUserDataStream = async () => {
        if (shuttingDown || !identityValid || !facade || !coordinator) return false;
        cancelScheduled(userDataReconnectTimer);
        userDataReconnectTimer = null;
        const streamGeneration = userDataStreamGeneration + 1;
        userDataStreamGeneration = streamGeneration;
        userDataStreamLive = false;
        closeCurrentUserDataSocket();
        try {
            const startedStream = await executeRead({
                endpointId: ENDPOINT_IDS.userDataStreamStart,
                weight: READ_WEIGHTS.userDataStreamStart,
                operation: () => facade.startUserDataStream(),
            });
            if (shuttingDown) {
                userDataListenKey = startedStream.listenKey;
                return false;
            }
            if (streamGeneration !== userDataStreamGeneration) return false;
            userDataListenKey = startedStream.listenKey;
            const handle = facade.connectUserDataStream({
                listenKey: userDataListenKey,
                onMessage: raw => handleUserDataStreamMessage(raw, streamGeneration),
                onDisconnect: () => scheduleUserDataReconnect(
                    'ACCOUNT_STREAM_UNAVAILABLE',
                    streamGeneration,
                ),
            });
            userDataStreamHandle = handle;
            await handle.ready;
            if (shuttingDown || streamGeneration !== userDataStreamGeneration) {
                handle.close();
                return false;
            }
            userDataStreamLive = true;
            userDataReconnectAttempt = 0;
            scheduleUserDataKeepAlive(streamGeneration);
            const snapshotStartedBeforeStreamReady = portfolioRefreshPromise;
            if (snapshotStartedBeforeStreamReady !== null) {
                await snapshotStartedBeforeStreamReady;
            }
            if (shuttingDown
                || streamGeneration !== userDataStreamGeneration
                || !userDataStreamLive) return false;
            if (lastOwnedPortfolioSnapshotGeneration !== streamGeneration) {
                await refreshPortfolio();
            }
            return !shuttingDown
                && streamGeneration === userDataStreamGeneration
                && userDataStreamLive;
        } catch (error) {
            if (shuttingDown || streamGeneration !== userDataStreamGeneration) return false;
            reportInternal('account-stream-connect', error);
            scheduleUserDataReconnect('ACCOUNT_STREAM_UNAVAILABLE', streamGeneration);
            await refreshPortfolio();
            return false;
        }
    };

    const readFullPreflight = async (symbol, positionSide, audit = {}) => {
        if (!['LONG', 'SHORT'].includes(positionSide)) {
            throw new FuturesProductionExecutionServiceError(
                FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
            );
        }
        const lease = await coordinator.beginPreflight();
        try {
            const serverTime = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.serverTime,
                weight: READ_WEIGHTS.serverTime,
                audit,
                operation: () => facade.getServerTime(),
            });
            if (lastServerTime !== null && serverTime.serverTime < lastServerTime) {
                throw new FuturesProductionExecutionServiceError('FUTURES_PRODUCTION_CLOCK_REGRESSED');
            }
            lastServerTime = serverTime.serverTime;
            const exchangeInfo = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.exchangeInfo,
                weight: READ_WEIGHTS.exchangeInfo,
                audit,
                operation: () => facade.getExchangeInfo(),
            });
            const markPrice = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.markPrice,
                weight: READ_WEIGHTS.markPrice,
                audit,
                operation: () => facade.getMarkPrice(symbol),
            });
            const accountConfig = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.accountConfig,
                weight: READ_WEIGHTS.accountConfig,
                audit,
                operation: () => facade.getAccountConfig(),
            });
            const symbolConfig = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.symbolConfig,
                weight: READ_WEIGHTS.symbolConfig,
                audit,
                operation: () => facade.getSymbolConfig(symbol),
            });
            const balance = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.balance,
                weight: READ_WEIGHTS.balance,
                audit,
                operation: () => facade.getBalance(),
            });
            const positionRisk = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.positionRisk,
                weight: READ_WEIGHTS.positionRisk,
                audit,
                operation: () => facade.getPositionRisk(symbol),
            });
            const openOrders = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.openOrders,
                weight: READ_WEIGHTS.openOrders,
                audit,
                operation: () => facade.getOpenOrders(symbol),
            });
            const openAlgoOrders = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.openAlgoOrders,
                weight: READ_WEIGHTS.openAlgoOrders,
                audit,
                operation: () => facade.getOpenAlgoOrders(symbol),
            });
            const dispatchTime = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.serverTime,
                weight: READ_WEIGHTS.serverTime,
                audit,
                operation: () => facade.getServerTime(),
            });
            if (dispatchTime.serverTime < serverTime.serverTime
                || (lastServerTime !== null && dispatchTime.serverTime < lastServerTime)) {
                throw new FuturesProductionExecutionServiceError(
                    'FUTURES_PRODUCTION_SERVER_CLOCK_REGRESSED',
                );
            }
            const millisecondsIntoUtcDay = dispatchTime.serverTime % UTC_DAY_MS;
            if (UTC_DAY_MS - millisecondsIntoUtcDay <= UTC_ROLLOVER_GUARD_MS) {
                throw new FuturesProductionExecutionServiceError(
                    'FUTURES_PRODUCTION_UTC_ROLLOVER_GUARD',
                );
            }
            lastServerTime = dispatchTime.serverTime;
            return {
                serverTime: dispatchTime.serverTime,
                snapshot: normalizeRiskSnapshot({
                    identity,
                    symbol,
                    positionSide,
                    observations: {
                        exchangeInfo,
                        markPrice,
                        accountConfig,
                        symbolConfig,
                        balance,
                        positionRisk,
                        openOrders,
                        openAlgoOrders,
                    },
                }),
            };
        } finally {
            lease.release();
        }
    };

    const readMarginPreflight = async (draft, audit = {}) => {
        const amount = parsePositiveExactDecimal(draft.amount);
        if (!policy.allowedSymbols.includes(draft.symbol)
            || !['LONG', 'SHORT'].includes(draft.positionSide)
            || !['ADD', 'REDUCE'].includes(draft.marginAction)
            || compareExactDecimals(
                amount,
                parsePositiveExactDecimal(policy.maxOrderNotionalUsdt),
            ) > 0) {
            throw new FuturesProductionExecutionServiceError(
                FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
            );
        }
        const lease = await coordinator.beginPreflight();
        try {
            const initialTime = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.serverTime,
                weight: READ_WEIGHTS.serverTime,
                audit,
                operation: () => facade.getServerTime(),
            });
            if (lastServerTime !== null && initialTime.serverTime < lastServerTime) {
                throw new FuturesProductionExecutionServiceError(
                    'FUTURES_PRODUCTION_SERVER_CLOCK_REGRESSED',
                );
            }
            const accountConfig = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.accountConfig,
                weight: READ_WEIGHTS.accountConfig,
                audit,
                operation: () => facade.getAccountConfig(),
            });
            const symbolConfig = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.symbolConfig,
                weight: READ_WEIGHTS.symbolConfig,
                audit,
                operation: () => facade.getSymbolConfig(draft.symbol),
            });
            const balance = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.balance,
                weight: READ_WEIGHTS.balance,
                audit,
                operation: () => facade.getBalance(),
            });
            const positionRisk = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.positionRisk,
                weight: READ_WEIGHTS.positionRisk,
                audit,
                operation: () => facade.getPositionRisk(draft.symbol),
            });
            const dispatchTime = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.serverTime,
                weight: READ_WEIGHTS.serverTime,
                audit,
                operation: () => facade.getServerTime(),
            });
            if (dispatchTime.serverTime < initialTime.serverTime
                || (lastServerTime !== null && dispatchTime.serverTime < lastServerTime)) {
                throw new FuturesProductionExecutionServiceError(
                    'FUTURES_PRODUCTION_SERVER_CLOCK_REGRESSED',
                );
            }
            const accountBalance = verifyProductionAccountIdentity({
                accountAlias: identity?.accountAlias,
                accountConfig,
                balance,
            });
            const symbolEntry = findSymbolEntry(symbolConfig, draft.symbol);
            const position = findHedgePositionEntry(
                positionRisk,
                draft.symbol,
                draft.positionSide,
            );
            if (!accountBalance
                || !symbolEntry
                || symbolEntry.marginType !== 'ISOLATED'
                || symbolEntry.isAutoAddMargin !== false
                || symbolEntry.leverage !== 2
                || !position
                || position.marginAsset !== 'USDT') {
                throw new FuturesProductionExecutionServiceError(
                    FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
                );
            }
            const positionAmount = parseSignedExactDecimal(position.positionAmt);
            if (isZeroExactDecimal(positionAmount)
                || (draft.positionSide === 'LONG' && position.positionAmt.startsWith('-'))
                || (draft.positionSide === 'SHORT' && !position.positionAmt.startsWith('-'))) {
                throw new FuturesProductionExecutionServiceError(
                    FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
                );
            }
            const marginBefore = parseNonNegativeExactDecimal(position.isolatedMargin);
            if (draft.marginAction === 'ADD') {
                const requiredBalance = addExactDecimals(
                    amount,
                    parsePositiveExactDecimal(policy.minAvailableBalanceUsdt),
                );
                if (compareExactDecimals(
                    parseNonNegativeExactDecimal(accountBalance.availableBalance),
                    requiredBalance,
                ) < 0) {
                    throw new FuturesProductionExecutionServiceError(
                        FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
                    );
                }
            } else if (compareExactDecimals(marginBefore, amount) <= 0) {
                throw new FuturesProductionExecutionServiceError(
                    FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
                );
            }
            lastServerTime = dispatchTime.serverTime;
            return {
                serverTime: dispatchTime.serverTime,
                marginBefore: formatExactDecimal(marginBefore),
            };
        } finally {
            lease.release();
        }
    };

    const evaluateOrder = async (draft, audit = {}) => {
        const preflight = await readFullPreflight(draft.symbol, draft.positionSide, audit);
        const utcDay = canonicalFuturesProductionUtcDay(preflight.serverTime);
        const dailyState = coordinator.getOrderAdmissionSnapshot();
        const result = evaluateRisk({
            policy,
            identity,
            snapshot: preflight.snapshot,
            draft,
            killSwitchEngaged,
            dailyNotionalUsed: dailyState.dailyReservations?.[utcDay] ?? '0',
        });
        return { result, serverTime: preflight.serverTime, utcDay, snapshot: preflight.snapshot };
    };

    const evaluateOrderAmendment = async ({
        symbol,
        positionSide,
        clientOrderId,
        price,
    }, audit = {}) => {
        if (!policy.allowedSymbols.includes(symbol)
            || !['LONG', 'SHORT'].includes(positionSide)
            || typeof clientOrderId !== 'string'
            || !CLIENT_ORDER_ID_PATTERN.test(clientOrderId)) {
            throw new FuturesProductionExecutionServiceError(
                FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
            );
        }
        parsePositiveExactDecimal(price);
        const current = await executeRead({
            endpointId: ENDPOINT_IDS.queryOrder,
            weight: READ_WEIGHTS.queryOrder,
            audit,
            operation: () => facade.queryOrderByOriginalClientOrderId({
                symbol,
                positionSide,
                originalClientOrderId: clientOrderId,
            }),
        });
        const originalQuantity = parsePositiveExactDecimal(current.originalQuantity);
        const executedQuantity = parseNonNegativeExactDecimal(current.executedQuantity);
        if (current.symbol !== symbol
            || current.clientOrderId !== clientOrderId
            || current.positionSide !== positionSide
            || !['BUY', 'SELL'].includes(current.side)
            || !['NEW', 'PARTIALLY_FILLED'].includes(current.status)
            || current.type !== 'LIMIT'
            || current.originalType !== 'LIMIT'
            || current.timeInForce !== 'GTC'
            || current.reduceOnly !== false
            || current.closePosition !== false
            || compareExactDecimals(originalQuantity, executedQuantity) <= 0
            || exactDecimalEqual(current.price, price)) {
            throw new FuturesProductionExecutionServiceError(
                FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
            );
        }
        const positionEffect = positionSide === 'LONG'
            ? (current.side === 'BUY' ? 'ENTRY' : 'EXIT')
            : (current.side === 'SELL' ? 'ENTRY' : 'EXIT');
        const remainingQuantity = subtractExactDecimals(
            originalQuantity,
            executedQuantity,
        );
        const draft = {
            symbol,
            side: current.side,
            positionSide,
            positionEffect,
            type: 'LIMIT',
            timeInForce: 'GTC',
            quantity: current.originalQuantity,
            price,
        };
        const riskDraft = {
            ...draft,
            riskQuantity: formatExactDecimal(remainingQuantity),
        };
        const preflight = await readFullPreflight(symbol, positionSide, audit);
        const utcDay = canonicalFuturesProductionUtcDay(preflight.serverTime);
        const dailyState = coordinator.getOrderAdmissionSnapshot();
        const snapshot = {
            ...preflight.snapshot,
            regularOpenOrderCount: Math.max(
                0,
                preflight.snapshot.regularOpenOrderCount - 1,
            ),
        };
        const result = evaluateRisk({
            policy,
            identity,
            snapshot,
            draft: riskDraft,
            killSwitchEngaged,
            dailyNotionalUsed: dailyState.dailyReservations?.[utcDay] ?? '0',
        });
        return {
            current,
            draft,
            result,
            serverTime: preflight.serverTime,
            utcDay,
            snapshot,
        };
    };

    const validateIdentity = async () => {
        if (!config.enabled || !facade || !coordinator || !identity) return false;
        const lease = await coordinator.beginPreflight();
        try {
            const time = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.serverTime,
                weight: READ_WEIGHTS.serverTime,
                operation: () => facade.getServerTime(),
            });
            if (lastServerTime !== null && time.serverTime < lastServerTime) {
                throw new FuturesProductionExecutionServiceError(
                    'FUTURES_PRODUCTION_SERVER_CLOCK_REGRESSED',
                );
            }
            const accountConfig = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.accountConfig,
                weight: READ_WEIGHTS.accountConfig,
                operation: () => facade.getAccountConfig(),
            });
            const balance = await executeRead({
                lease,
                endpointId: ENDPOINT_IDS.balance,
                weight: READ_WEIGHTS.balance,
                operation: () => facade.getBalance(),
            });
            lastServerTime = time.serverTime;
            const verifiedBalance = verifyProductionAccountIdentity({
                accountAlias: identity.accountAlias,
                accountConfig,
                balance,
            });
            if (verifiedBalance === null) return false;
            latestAvailableBalanceUsdt = verifiedBalance.availableBalance;
            identityBootstrapSnapshot = {
                serverTime: time.serverTime,
                availableBalanceUsdt: verifiedBalance.availableBalance,
                accountConfig,
                observedAt: readNow(),
            };
            return true;
        } finally {
            lease.release();
        }
    };

    const refreshActivation = async ({ audit = true } = {}) => {
        const activeOperations = ledger.getActiveOperations?.() ?? [];
        const admission = coordinator?.getOrderAdmissionSnapshot?.()
            ?? ledger.getOrderRateState?.()
            ?? {};
        const pauseUntil = Number.isSafeInteger(admission.pauseUntil)
            ? admission.pauseUntil
            : Number.MAX_SAFE_INTEGER;
        const activationNow = readNow();
        const noActiveRatePause = pauseUntil <= activationNow;
        if (!noActiveRatePause && ratePauseRefreshAt !== pauseUntil) {
            ratePauseRefreshAt = pauseUntil;
            schedule(async () => {
                if (ratePauseRefreshAt !== pauseUntil) return;
                ratePauseRefreshAt = null;
                await refreshActivation();
            }, Math.min(pauseUntil - activationNow, 2_147_000_000));
        } else if (noActiveRatePause) {
            ratePauseRefreshAt = null;
        }
        const persistedBindings = new Set(activeOperations
            .map(record => record.credentialBinding)
            .filter(Boolean));
        const credentialBindingValid = persistedBindings.size === 0
            || (persistedBindings.size === 1 && persistedBindings.has(credentialBinding));
        const gates = {
            operatorConfigured: config.configured === true,
            liveAuthorized: config.liveAuthorized === true && config.enabled === true,
            accountIdentityValid: identityValid,
            limitsComplete: policy !== null,
            storageHealthy,
            recoveryHealthy,
            killSwitchPolicyActive: policy?.killSwitchPolicy
                === FUTURES_PRODUCTION_EXECUTION_KILL_SWITCH_POLICY,
            credentialBindingValid,
            noBlockingOperation: activeOperations.length === 0 && activeOperation === null,
            noActiveRatePause,
        };
        activation = evaluateFuturesProductionActivationGates(gates);
        if (audit) {
            for (const [gate, allowed] of Object.entries(gates)) {
                await appendAudit({
                    eventType: 'gate_decision',
                    category: 'gate',
                    outcome: allowed ? 'allowed' : 'blocked',
                    gate,
                    state: allowed ? 'allowed' : 'blocked',
                    code: allowed ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED : activation.code,
                });
            }
        }
        advanceRevision();
        broadcastStatus();
        return activation;
    };

    const rejectCommand = async ({
        requestId = null,
        kind = FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER,
        code = FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.COMMAND_REJECTED,
    } = {}) => {
        const safeRequestId = /^[0-9a-f]{32}$/.test(requestId ?? '')
            ? requestId
            : createRequestId(randomBytes);
        await setAttempt({
            requestId: safeRequestId,
            kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
            code,
            eventType: 'terminal_transition',
            category: 'command',
            outcome: 'rejected',
        });
        return false;
    };

    const rejectFinalCommandWithoutStateMutation = async (command, context, code) => {
        await appendAudit({
            eventType: 'gate_decision',
            category: 'command',
            outcome: 'rejected',
            requestId: command.requestId,
            action: command.action,
            commandDigest: createFuturesProductionExecutionCommandDigest(command),
            gate: 'finalCommandIdentity',
            state: 'rejected',
            code,
        });
        emitStatus(sessions.get(context.connectionId));
        return false;
    };

    const issueIntent = async ({ command, connectionId, kind, draft = null }) => {
        const requestId = createRequestId(randomBytes);
        const expiresAt = readNow() + INTENT_TTL_MS;
        const commandDigest = createFuturesProductionExecutionCommandDigest(command);
        await appendAudit({
            eventType: 'intent_issued',
            category: 'intent',
            outcome: 'allowed',
            requestId,
            operationId: requestId,
            intentId: requestId,
            action: command.action,
            commandDigest,
            state: 'intent_issued',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED,
        });
        advanceRevision();
        activeIntent = {
            requestId,
            connectionId,
            kind,
            draft,
            commandDigest,
            revision,
            expiresAt,
        };
        const issuedIntent = activeIntent;
        schedule(async () => {
            if (activeIntent !== issuedIntent) return;
            activeIntent = null;
            await appendAudit({
                eventType: 'intent_expired',
                category: 'intent',
                outcome: 'expired',
                requestId: issuedIntent.requestId,
                operationId: issuedIntent.requestId,
                intentId: issuedIntent.requestId,
                state: 'expired',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.INTENT_EXPIRED,
            });
            advanceRevision();
            broadcastStatus();
        }, INTENT_TTL_MS);
        broadcastStatus();
        return true;
    };

    const prepareIntent = async (command, context) => {
        const kind = PREPARE_KIND_BY_ACTION[command.action];
        if (!kind || command.revision !== revision || activeIntent || mutex
            || !activation.enabled || recovery.required) {
            return rejectCommand({
                kind: kind ?? FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER,
                code: command.revision !== revision
                    ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.REVISION_REJECTED
                    : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
            });
        }
        if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH
            && killSwitchEngaged) {
            return rejectCommand({ kind, code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED });
        }
        if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER
            && killSwitchEngaged
            && command.positionEffect !== 'EXIT') {
            return rejectCommand({ kind, code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED });
        }
        if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT
            && (portfolio.state !== 'live'
                || !portfolio.positions.some(position => (
                    position.symbol === command.symbol
                    && position.positionSide === command.positionSide
                ))
                || (killSwitchEngaged && command.marginAction === 'REDUCE'))) {
            return rejectCommand({ kind, code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED });
        }
        if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT
            && (portfolio.state !== 'live'
                || portfolio.syncState !== FUTURES_OPEN_ORDER_SYNC_STATES.LIVE
                || !portfolio.openOrders.some(order => (
                    order.symbol === command.symbol
                    && order.positionSide === command.positionSide
                    && order.clientOrderId === command.clientOrderId
                )))) {
            return rejectCommand({ kind, code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED });
        }
        if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH
            && !killSwitchEngaged) {
            return rejectCommand({ kind, code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED });
        }
        mutex = true;
        broadcastStatus();
        try {
            let draft = null;
            if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER) {
                draft = {
                    symbol: command.symbol,
                    side: command.side,
                    positionSide: command.positionSide,
                    positionEffect: command.positionEffect,
                    type: 'LIMIT',
                    timeInForce: 'GTC',
                    quantity: command.quantity,
                    price: command.price,
                };
                const evaluated = await evaluateOrder(draft, {
                    action: command.action,
                    commandDigest: createFuturesProductionExecutionCommandDigest(command),
                    symbol: draft.symbol,
                });
                if (!evaluated.result.ok) {
                    return rejectCommand({ requestId: null, kind, code: evaluated.result.code });
                }
            } else if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT) {
                draft = {
                    symbol: command.symbol,
                    positionSide: command.positionSide,
                    marginAction: command.marginAction,
                    amount: command.amount,
                };
                await readMarginPreflight(draft, {
                    action: command.action,
                    commandDigest: createFuturesProductionExecutionCommandDigest(command),
                    symbol: draft.symbol,
                    positionSide: draft.positionSide,
                    marginAction: draft.marginAction,
                    amount: draft.amount,
                });
            } else if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT) {
                const evaluated = await evaluateOrderAmendment({
                    symbol: command.symbol,
                    positionSide: command.positionSide,
                    clientOrderId: command.clientOrderId,
                    price: command.price,
                }, {
                    action: command.action,
                    commandDigest: createFuturesProductionExecutionCommandDigest(command),
                    symbol: command.symbol,
                    clientOrderId: command.clientOrderId,
                });
                if (!evaluated.result.ok) {
                    return rejectCommand({ requestId: null, kind, code: evaluated.result.code });
                }
                draft = {
                    ...evaluated.draft,
                    clientOrderId: command.clientOrderId,
                    exchangeOrderId: evaluated.current.orderId,
                };
            }
            return issueIntent({
                command,
                connectionId: context.connectionId,
                kind,
                draft,
            });
        } catch (error) {
            reportInternal('prepare', error);
            return rejectCommand({ kind, code: safeErrorCode(error) });
        } finally {
            mutex = false;
            advanceRevision();
            broadcastStatus();
        }
    };

    const updateAttemptWithoutAudit = ({ requestId, kind, state, code, items = [] }) => {
        advanceRevision();
        currentAttempt = {
            requestId,
            kind,
            revision,
            acknowledgement: acknowledgementForState(state),
            state,
            code,
            observedAt: readNow(),
            items,
        };
        broadcastStatus();
    };

    const scheduleReconciliation = (operation, { index = 0, monitoring = false, slow = false } = {}) => {
        if (shuttingDown || !operation || activeOperation !== operation) return;
        let delay;
        let nextIndex = index;
        if (monitoring) {
            delay = OPEN_MONITOR_DELAY_MS;
        } else if (slow) {
            delay = SLOW_RECONCILIATION_DELAY_MS;
        } else {
            nextIndex = Math.min(index + 1, FAST_RECONCILIATION_DELAYS.length - 1);
            delay = FAST_RECONCILIATION_DELAYS[nextIndex]
                - FAST_RECONCILIATION_DELAYS[index];
        }
        const nextAttemptAt = readNow() + delay;
        reconciliation = { required: true, state: 'scheduled', nextAttemptAt };
        recovery = {
            required: true,
            state: 'recovering',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
        };
        advanceRevision();
        broadcastStatus();
        schedule(
            () => reconcileOrder(operation, { index: nextIndex, monitoring, slow }),
            delay,
        );
    };

    const deferReconciliationUntilOperationalRecoveryCompletes = (operation, options) => {
        if (shuttingDown || !operation || activeOperation !== operation) return;
        deferredReconciliation = { operation, options };
        reconciliation = { required: true, state: 'scheduled', nextAttemptAt: null };
        recovery = {
            required: true,
            state: 'recovering',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
        };
        advanceRevision();
        broadcastStatus();
    };

    const resumeDeferredReconciliation = () => {
        const deferred = deferredReconciliation;
        deferredReconciliation = null;
        if (shuttingDown || !deferred || activeOperation !== deferred.operation) return;
        const nextAttemptAt = readNow();
        reconciliation = { required: true, state: 'scheduled', nextAttemptAt };
        recovery = {
            required: true,
            state: 'recovering',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
        };
        advanceRevision();
        broadcastStatus();
        schedule(
            () => reconcileOrder(deferred.operation, deferred.options),
            0,
        );
    };

    const completeOperation = async () => {
        activeOperation = null;
        reconciliation = { required: false, state: 'confirmed', nextAttemptAt: null };
        recovery = {
            required: false,
            state: 'healthy',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED,
        };
        recoveryHealthy = true;
        advanceRevision();
        await refreshActivation({ audit: false });
    };

    const reconcileOrder = async (operation, {
        index = 0,
        monitoring = false,
        slow = false,
        allowDuringOperationalRecovery = false,
    } = {}) => {
        const reconciliationOptions = { index, monitoring, slow };
        if (shuttingDown || !operation || activeOperation !== operation) return null;
        if (operationalRecoveryInProgress && !allowDuringOperationalRecovery) {
            deferReconciliationUntilOperationalRecoveryCompletes(
                operation,
                reconciliationOptions,
            );
            return null;
        }
        const age = readNow() - operation.dispatchAt;
        if (age < 0 || age > MAX_RECOVERY_AGE_MS || operation.credentialBinding !== credentialBinding) {
            reconciliation = { required: true, state: 'unavailable', nextAttemptAt: null };
            recovery = {
                required: true,
                state: 'blocked',
                code: operation.credentialBinding !== credentialBinding
                    ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CREDENTIAL_ROTATION_BLOCKED
                    : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
            };
            await setAttempt({
                requestId: operation.requestId,
                kind: operation.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE,
                code: recovery.code,
                eventType: 'reconciliation_result',
                category: 'reconciliation',
                outcome: 'unknown',
                audit: {
                    clientOrderId: operation.clientOrderId,
                    commandDigest: operation.commandDigest,
                    ...durableOrderFields(operation.draft),
                },
            });
            return null;
        }
        reconciliation = { required: true, state: 'querying', nextAttemptAt: null };
        broadcastStatus();
        try {
            const order = await invokeExchange({
                endpointId: ENDPOINT_IDS.queryOrder,
                audit: {
                    requestId: operation.requestId,
                    operationId: operation.requestId,
                    action: operation.action
                        ?? FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER,
                    clientOrderId: operation.clientOrderId,
                    commandDigest: operation.commandDigest,
                    symbol: operation.symbol,
                    ...durableOrderFields(operation.draft),
                },
                operation: () => facade.queryOrderByOriginalClientOrderId({
                    symbol: operation.symbol,
                    positionSide: operation.draft.positionSide,
                    originalClientOrderId: operation.clientOrderId,
                }),
                execute: callback => coordinator.executeRecoveryQuery(callback, {
                    endpointId: ENDPOINT_IDS.queryOrder,
                }),
            });
            if (shuttingDown || activeOperation !== operation) return null;
            if (operationalRecoveryInProgress && !allowDuringOperationalRecovery) {
                deferReconciliationUntilOperationalRecoveryCompletes(
                    operation,
                    reconciliationOptions,
                );
                return null;
            }
            if (order.symbol !== operation.symbol
                || order.clientOrderId !== operation.clientOrderId
                || order.side !== operation.draft.side
                || order.positionSide !== operation.draft.positionSide
                || order.reduceOnly !== false
                || !exactDecimalEqual(order.originalQuantity, operation.draft.quantity)
                || (operation.exchangeOrderId && order.orderId !== operation.exchangeOrderId)
                || (operation.draft.type === 'LIMIT'
                    && (order.originalType !== 'LIMIT'
                        || order.timeInForce !== 'GTC'
                        || !exactDecimalEqual(order.price, operation.draft.price)))
                || (operation.draft.type === 'MARKET' && order.originalType !== 'MARKET')) {
                throw new FuturesProductionExecutionServiceError(
                    'FUTURES_PRODUCTION_RECONCILIATION_IDENTITY_REJECTED',
                );
            }
            const observedState = stateFromOrder(order);
            const state = operation.kind
                    === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT
                && observedState === FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_OPEN
                ? FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_ORDER_AMENDED
                : observedState;
            const digest = createHash('sha256')
                .update(JSON.stringify({
                    orderId: order.orderId,
                    status: order.status,
                    executedQuantity: order.executedQuantity,
                    averagePrice: order.averagePrice,
                    updateTime: order.updateTime,
                }))
                .digest('hex');
            operation.lastOrderDigest = digest;
            openOrdersReconciliation = applyFuturesAuthoritativeOrderResult(
                openOrdersReconciliation,
                order,
            );
            projectCurrentPortfolio({
                state: portfolio.state === 'live' ? 'live' : 'stale',
            });
            const code = state === FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_FILLED
                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CONFIRMED_FILLED
                : state === FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CANCELED
                    ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CONFIRMED_CANCELED
                    : state === FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_OPEN
                        ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CONFIRMED_OPEN
                        : state === FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_ORDER_AMENDED
                            ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_AMENDED
                            : state === FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED
                                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED
                                : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN;
            await setAttempt({
                requestId: operation.requestId,
                kind: operation.kind,
                state,
                code,
                items: [{
                    symbol: operation.symbol,
                    outcome: state === FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_FILLED
                        ? 'accepted'
                        : state === FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CANCELED
                            ? 'canceled'
                            : state === FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_OPEN
                                ? 'open'
                                : state
                                    === FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_ORDER_AMENDED
                                    ? 'amended'
                                    : state
                                        === FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED
                                        ? 'rejected'
                                        : 'unknown',
                    code,
                }],
                eventType: monitoring ? 'monitor_result' : 'reconciliation_result',
                category: 'reconciliation',
                outcome: state === FUTURES_PRODUCTION_EXECUTION_STATES.RESULT_UNKNOWN
                    ? 'unknown'
                    : state === FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED
                        ? 'rejected'
                        : 'confirmed',
                audit: {
                    clientOrderId: operation.clientOrderId,
                    commandDigest: operation.commandDigest,
                    exchangeOrderId: order.orderId,
                    ...durableOrderFields(operation.draft),
                    detailDigest: operation.lastOrderDigest,
                },
            });
            if (TERMINAL_ORDER_STATES.has(state)) {
                await completeOperation();
            } else {
                scheduleReconciliation(operation, { slow: true });
            }
            return order;
        } catch (error) {
            if (shuttingDown || activeOperation !== operation) return null;
            if (operationalRecoveryInProgress && !allowDuringOperationalRecovery) {
                deferReconciliationUntilOperationalRecoveryCompletes(
                    operation,
                    reconciliationOptions,
                );
                return null;
            }
            reportInternal('reconciliation', error);
            if (!monitoring || currentAttempt?.state !== FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_OPEN) {
                await setAttempt({
                    requestId: operation.requestId,
                    kind: operation.kind,
                    state: FUTURES_PRODUCTION_EXECUTION_STATES.RESULT_UNKNOWN,
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                    items: [{
                        symbol: operation.symbol,
                        outcome: 'unknown',
                        code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                    }],
                    eventType: 'reconciliation_result',
                    category: 'reconciliation',
                    outcome: 'unknown',
                    audit: {
                        clientOrderId: operation.clientOrderId,
                        commandDigest: operation.commandDigest,
                        ...durableOrderFields(operation.draft),
                    },
                });
            }
            if (!slow && index + 1 < FAST_RECONCILIATION_DELAYS.length) {
                scheduleReconciliation(operation, { index });
            } else {
                scheduleReconciliation(operation, { slow: true });
            }
            return null;
        }
    };

    const consumeIntent = async (command, context) => {
        const kind = FINAL_KIND_BY_ACTION[command.action];
        const intent = activeIntent;
        if (!kind || !intent
            || intent.requestId !== command.requestId
            || intent.kind !== kind
            || intent.connectionId !== context.connectionId
            || intent.revision !== command.revision
            || intent.expiresAt <= readNow()) {
            if (intent?.expiresAt <= readNow()) {
                activeIntent = null;
                await appendAudit({
                    eventType: 'intent_expired',
                    category: 'intent',
                    outcome: 'expired',
                    requestId: command.requestId,
                    operationId: command.requestId,
                    intentId: command.requestId,
                    state: 'expired',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.INTENT_EXPIRED,
                });
            }
            return null;
        }
        activeIntent = null;
        const commandDigest = createFuturesProductionExecutionCommandDigest(command);
        await appendAudit({
            eventType: 'intent_consumed',
            category: 'intent',
            outcome: 'accepted',
            requestId: command.requestId,
            operationId: command.requestId,
            intentId: command.requestId,
            action: command.action,
            commandDigest,
            state: 'consumed',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED,
        });
        return { ...intent, commandDigest };
    };

    const placeOrder = async (command, intent) => {
        const { draft } = intent;
        const clientOrderId = `cc7-${command.requestId}`;
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.QUEUED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            eventType: 'queued',
            category: 'dispatch',
            outcome: 'pending',
            audit: {
                action: command.action,
                clientOrderId,
                commandDigest: intent.commandDigest,
                ...durableOrderFields(draft),
            },
        });

        let evaluated;
        try {
            evaluated = await evaluateOrder(draft, {
                requestId: command.requestId,
                operationId: command.requestId,
                action: command.action,
                clientOrderId,
                commandDigest: intent.commandDigest,
                symbol: draft.symbol,
            });
        } catch (error) {
            reportInternal('order-preflight', error);
            return setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: safeErrorCode(error),
                eventType: 'terminal_transition',
                category: 'gate',
                outcome: 'rejected',
                audit: {
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    ...durableOrderFields(draft),
                },
            });
        }
        if (!evaluated.result.ok) {
            return setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: evaluated.result.code,
                eventType: 'terminal_transition',
                category: 'gate',
                outcome: 'rejected',
                audit: {
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    ...durableOrderFields(draft),
                },
            });
        }

        let reservation;
        try {
            reservation = await coordinator.reserveOrderDispatch({
                exactNotional: evaluated.result.classification
                    === FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.REDUCING
                    ? '0'
                    : evaluated.result.notionalUsdt,
                utcDay: evaluated.utcDay,
                serverTime: evaluated.serverTime,
                maximumDailyNotional: policy.maxDailyNotionalUsdt,
                audit: {
                    requestId: command.requestId,
                    operationId: command.requestId,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    action: command.action,
                    credentialBinding,
                    state: 'dispatched',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
                    ...durableOrderFields(draft),
                },
            });
        } catch (error) {
            reportInternal('dispatch-reservation', error);
            return setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: safeErrorCode(error),
                eventType: 'terminal_transition',
                category: 'rate',
                outcome: 'rejected',
                audit: {
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    ...durableOrderFields(draft),
                },
            });
        }

        const operation = {
            requestId: command.requestId,
            kind: intent.kind,
            action: command.action,
            commandDigest: intent.commandDigest,
            clientOrderId,
            symbol: draft.symbol,
            draft,
            dispatchAt: reservation.dispatchAt,
            credentialBinding,
            exchangeOrderId: null,
            lastOrderDigest: null,
        };
        activeOperation = operation;
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.DISPATCHED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            items: [{
                symbol: draft.symbol,
                outcome: 'pending',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            }],
            eventType: 'dispatch_intent',
            category: 'dispatch',
            outcome: 'pending',
            audit: {
                action: command.action,
                clientOrderId,
                commandDigest: intent.commandDigest,
                dispatchAt: operation.dispatchAt,
                ...durableOrderFields(draft),
            },
        });
        const dispatchAge = readNow() - operation.dispatchAt;
        if (dispatchAge < 0 || dispatchAge > MAX_DISPATCH_START_DELAY_MS) {
            await setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: 'FUTURES_PRODUCTION_DISPATCH_DEADLINE_EXCEEDED',
                eventType: 'terminal_transition',
                category: 'dispatch',
                outcome: 'rejected',
                audit: {
                    action: command.action,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    dispatchAt: operation.dispatchAt,
                    ...durableOrderFields(draft),
                },
            });
            await completeOperation();
            return currentAttempt;
        }
        try {
            const acknowledgement = await executeProduction({
                endpointId: ENDPOINT_IDS.placeLimitGtcOrder,
                audit: {
                    requestId: command.requestId,
                    operationId: command.requestId,
                    action: command.action,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    symbol: draft.symbol,
                    ...durableOrderFields(draft),
                },
                operation: () => facade.placeLimitGtcOrder({
                    symbol: draft.symbol,
                    side: draft.side,
                    positionSide: draft.positionSide,
                    positionEffect: draft.positionEffect,
                    quantity: draft.quantity,
                    price: draft.price,
                    clientOrderId,
                }),
            });
            operation.exchangeOrderId = acknowledgement.orderId;
            if (acknowledgement.symbol === draft.symbol
                && acknowledgement.clientOrderId === clientOrderId
                && Number.isSafeInteger(acknowledgement.transactTime)
                && acknowledgement.transactTime >= 0) {
                try {
                    openOrdersReconciliation = applyFuturesAcceptedCreateProjection(
                        openOrdersReconciliation,
                        {
                            symbol: acknowledgement.symbol,
                            clientOrderId: acknowledgement.clientOrderId,
                            orderId: acknowledgement.orderId,
                            side: draft.side,
                            positionSide: draft.positionSide,
                            type: 'LIMIT',
                            timeInForce: 'GTC',
                            status: 'NEW',
                            originalQuantity: draft.quantity,
                            executedQuantity: '0',
                            price: draft.price,
                            reduceOnly: false,
                            closePosition: false,
                            updateTime: acknowledgement.transactTime,
                        },
                    );
                    projectCurrentPortfolio({
                        state: portfolio.state === 'live' ? 'live' : 'stale',
                    });
                } catch (projectionError) {
                    reportInternal('order-create-projection', projectionError);
                }
            }
            await setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.RECONCILING,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
                items: [{
                    symbol: draft.symbol,
                    outcome: 'accepted',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
                }],
                eventType: 'response_classified',
                category: 'exchange',
                outcome: 'accepted',
                audit: {
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    exchangeOrderId: acknowledgement.orderId,
                    ...durableOrderFields(draft),
                },
            });
        } catch (error) {
            if (error?.kind === FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED) {
                await setAttempt({
                    requestId: command.requestId,
                    kind: intent.kind,
                    state: FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED,
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
                    items: [{
                        symbol: draft.symbol,
                        outcome: 'rejected',
                        code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
                    }],
                    eventType: 'terminal_transition',
                    category: 'exchange',
                    outcome: 'rejected',
                    audit: {
                        clientOrderId,
                        commandDigest: intent.commandDigest,
                        ...durableOrderFields(draft),
                    },
                });
                await completeOperation();
                return currentAttempt;
            }
            await setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.RESULT_UNKNOWN,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                items: [{
                    symbol: draft.symbol,
                    outcome: 'unknown',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                }],
                eventType: 'response_classified',
                category: 'exchange',
                outcome: 'unknown',
                audit: {
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    ...durableOrderFields(draft),
                },
            });
        }
        await reconcileOrder(operation);
        return currentAttempt;
    };

    const amendOrder = async (command, intent) => {
        const preparedDraft = intent.draft;
        const clientOrderId = preparedDraft.clientOrderId;
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.QUEUED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            eventType: 'queued',
            category: 'dispatch',
            outcome: 'pending',
            audit: {
                action: command.action,
                clientOrderId,
                commandDigest: intent.commandDigest,
                ...durableOrderFields(preparedDraft),
            },
        });

        let evaluated;
        try {
            evaluated = await evaluateOrderAmendment({
                symbol: preparedDraft.symbol,
                positionSide: preparedDraft.positionSide,
                clientOrderId,
                price: preparedDraft.price,
            }, {
                requestId: command.requestId,
                operationId: command.requestId,
                action: command.action,
                clientOrderId,
                commandDigest: intent.commandDigest,
                symbol: preparedDraft.symbol,
            });
        } catch (error) {
            reportInternal('order-amendment-preflight', error);
            return setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: safeErrorCode(error),
                eventType: 'terminal_transition',
                category: 'gate',
                outcome: 'rejected',
                audit: {
                    action: command.action,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    ...durableOrderFields(preparedDraft),
                },
            });
        }
        const { draft } = evaluated;
        if (!evaluated.result.ok
            || evaluated.current.orderId !== preparedDraft.exchangeOrderId
            || evaluated.current.side !== preparedDraft.side
            || !exactDecimalEqual(evaluated.current.originalQuantity, preparedDraft.quantity)
            || draft.positionEffect !== preparedDraft.positionEffect) {
            return setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: evaluated.result.ok
                    ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED
                    : evaluated.result.code,
                eventType: 'terminal_transition',
                category: 'gate',
                outcome: 'rejected',
                audit: {
                    action: command.action,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    ...durableOrderFields(draft),
                },
            });
        }

        let reservation;
        try {
            reservation = await coordinator.reserveOrderDispatch({
                exactNotional: evaluated.result.classification
                    === FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.REDUCING
                    ? '0'
                    : evaluated.result.notionalUsdt,
                utcDay: evaluated.utcDay,
                serverTime: evaluated.serverTime,
                maximumDailyNotional: policy.maxDailyNotionalUsdt,
                audit: {
                    requestId: command.requestId,
                    operationId: command.requestId,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    action: command.action,
                    credentialBinding,
                    exchangeOrderId: evaluated.current.orderId,
                    state: 'dispatched',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
                    ...durableOrderFields(draft),
                },
            });
        } catch (error) {
            reportInternal('order-amendment-reservation', error);
            return setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: safeErrorCode(error),
                eventType: 'terminal_transition',
                category: 'rate',
                outcome: 'rejected',
                audit: {
                    action: command.action,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    ...durableOrderFields(draft),
                },
            });
        }

        const operation = {
            requestId: command.requestId,
            kind: intent.kind,
            action: command.action,
            commandDigest: intent.commandDigest,
            clientOrderId,
            symbol: draft.symbol,
            draft,
            dispatchAt: reservation.dispatchAt,
            credentialBinding,
            exchangeOrderId: evaluated.current.orderId,
            lastOrderDigest: null,
        };
        activeOperation = operation;
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.DISPATCHED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            items: [{
                symbol: draft.symbol,
                outcome: 'pending',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            }],
            eventType: 'dispatch_intent',
            category: 'dispatch',
            outcome: 'pending',
            audit: {
                action: command.action,
                clientOrderId,
                commandDigest: intent.commandDigest,
                exchangeOrderId: operation.exchangeOrderId,
                dispatchAt: operation.dispatchAt,
                ...durableOrderFields(draft),
            },
        });
        const dispatchAge = readNow() - operation.dispatchAt;
        if (dispatchAge < 0 || dispatchAge > MAX_DISPATCH_START_DELAY_MS) {
            await setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: 'FUTURES_PRODUCTION_DISPATCH_DEADLINE_EXCEEDED',
                eventType: 'terminal_transition',
                category: 'dispatch',
                outcome: 'rejected',
                audit: {
                    action: command.action,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    dispatchAt: operation.dispatchAt,
                    ...durableOrderFields(draft),
                },
            });
            await completeOperation();
            return currentAttempt;
        }
        try {
            const acknowledgement = await executeProduction({
                endpointId: ENDPOINT_IDS.modifyLimitOrder,
                audit: {
                    requestId: command.requestId,
                    operationId: command.requestId,
                    action: command.action,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    symbol: draft.symbol,
                    exchangeOrderId: operation.exchangeOrderId,
                    ...durableOrderFields(draft),
                },
                operation: () => facade.modifyLimitOrder({
                    symbol: draft.symbol,
                    side: draft.side,
                    positionSide: draft.positionSide,
                    quantity: draft.quantity,
                    price: draft.price,
                    clientOrderId,
                }),
            });
            if (acknowledgement.symbol !== draft.symbol
                || acknowledgement.clientOrderId !== clientOrderId
                || acknowledgement.orderId !== operation.exchangeOrderId
                || acknowledgement.side !== draft.side
                || acknowledgement.positionSide !== draft.positionSide
                || acknowledgement.reduceOnly !== false
                || acknowledgement.closePosition !== false
                || acknowledgement.originalType !== 'LIMIT'
                || acknowledgement.timeInForce !== 'GTC'
                || !exactDecimalEqual(acknowledgement.originalQuantity, draft.quantity)
                || !exactDecimalEqual(acknowledgement.price, draft.price)) {
                throw new FuturesProductionExecutionServiceError(
                    FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                );
            }
            try {
                openOrdersReconciliation = applyFuturesAcceptedAmendProjection(
                    openOrdersReconciliation,
                    acknowledgement,
                );
                projectCurrentPortfolio({
                    state: portfolio.state === 'live' ? 'live' : 'stale',
                });
            } catch (projectionError) {
                reportInternal('order-amend-projection', projectionError);
            }
            await setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.RECONCILING,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
                items: [{
                    symbol: draft.symbol,
                    outcome: 'accepted',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
                }],
                eventType: 'response_classified',
                category: 'exchange',
                outcome: 'accepted',
                audit: {
                    action: command.action,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    exchangeOrderId: acknowledgement.orderId,
                    ...durableOrderFields(draft),
                },
            });
        } catch (error) {
            if (error?.kind === FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED) {
                await setAttempt({
                    requestId: command.requestId,
                    kind: intent.kind,
                    state: FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED,
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
                    items: [{
                        symbol: draft.symbol,
                        outcome: 'rejected',
                        code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
                    }],
                    eventType: 'terminal_transition',
                    category: 'exchange',
                    outcome: 'rejected',
                    audit: {
                        action: command.action,
                        clientOrderId,
                        commandDigest: intent.commandDigest,
                        ...durableOrderFields(draft),
                    },
                });
                await completeOperation();
                return currentAttempt;
            }
            await setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.RESULT_UNKNOWN,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                items: [{
                    symbol: draft.symbol,
                    outcome: 'unknown',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                }],
                eventType: 'response_classified',
                category: 'exchange',
                outcome: 'unknown',
                audit: {
                    action: command.action,
                    clientOrderId,
                    commandDigest: intent.commandDigest,
                    ...durableOrderFields(draft),
                },
            });
        }
        await reconcileOrder(operation);
        return currentAttempt;
    };

    const readSymbolInventories = async (symbol, audit = {}) => {
        const serverTime = await executeRead({
            endpointId: ENDPOINT_IDS.serverTime,
            weight: READ_WEIGHTS.serverTime,
            audit,
            operation: () => facade.getServerTime(),
        });
        if (lastServerTime !== null && serverTime.serverTime < lastServerTime) {
            throw new FuturesProductionExecutionServiceError(
                'FUTURES_PRODUCTION_SERVER_CLOCK_REGRESSED',
            );
        }
        lastServerTime = serverTime.serverTime;
        const regular = await executeRead({
            endpointId: ENDPOINT_IDS.openOrders,
            weight: READ_WEIGHTS.openOrders,
            audit,
            operation: () => facade.getOpenOrders(symbol),
        });
        const algo = await executeRead({
            endpointId: ENDPOINT_IDS.openAlgoOrders,
            weight: READ_WEIGHTS.openAlgoOrders,
            audit,
            operation: () => facade.getOpenAlgoOrders(symbol),
        });
        return { regular, algo, observedAt: serverTime.serverTime };
    };

    const cancelAllOpenOrders = async (command, intent) => {
        activeOperation = {
            requestId: command.requestId,
            kind: intent.kind,
            action: command.action,
            credentialBinding,
            dispatchAt: readNow(),
        };
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.QUEUED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            eventType: 'cancel_all_parent',
            category: 'safety',
            outcome: 'pending',
            audit: { action: command.action, commandDigest: intent.commandDigest },
        });
        const items = [];
        for (const symbol of policy.allowedSymbols) {
            const cancelTargetOrderKeys = [...new Set([
                ...openOrdersReconciliation.orders,
                ...openOrdersReconciliation.bufferedEvents.map(entry => entry.order),
            ].filter(order => order.symbol === symbol).map(order => order.key))];
            const childAudit = {
                requestId: command.requestId,
                operationId: `${command.requestId}:${symbol}`,
                parentOperationId: command.requestId,
                action: command.action,
                commandDigest: intent.commandDigest,
                symbol,
            };
            let deletesAcknowledged = true;
            for (const [endpointId, operation] of [
                [ENDPOINT_IDS.cancelAllOpenOrders, () => facade.cancelAllOpenOrders({ symbol })],
                [ENDPOINT_IDS.cancelAllAlgoOpenOrders, () => facade.cancelAllAlgoOpenOrders({ symbol })],
            ]) {
                try {
                    await executeProduction({ endpointId, operation, audit: childAudit });
                } catch (error) {
                    deletesAcknowledged = false;
                    reportInternal('cancel-all-delete', error);
                }
            }
            let cancelProjectionRequestedAt = null;
            if (deletesAcknowledged) {
                cancelProjectionRequestedAt = readNow();
                const projected = markFuturesOpenOrdersPendingCancel(
                    openOrdersReconciliation,
                    {
                        symbol,
                        orderKeys: cancelTargetOrderKeys,
                        requestedAt: cancelProjectionRequestedAt,
                    },
                );
                if (projected !== openOrdersReconciliation) {
                    openOrdersReconciliation = projected;
                    projectCurrentPortfolio({
                        state: portfolio.state === 'live' ? 'live' : 'stale',
                        syncCode: userDataStreamLive ? null : 'ACCOUNT_STREAM_UNAVAILABLE',
                    });
                    advanceRevision();
                    broadcastStatus();
                }
            }
            let confirmedEmpty = false;
            let reconciliationObservedAt = null;
            try {
                const inventories = await readSymbolInventories(symbol, childAudit);
                confirmedEmpty = inventories.regular.length === 0 && inventories.algo.length === 0;
                reconciliationObservedAt = inventories.observedAt;
            } catch (error) {
                reportInternal('cancel-all-reconcile', error);
            }
            const projectionObservedAt = reconciliationObservedAt ?? readNow();
            const projected = confirmedEmpty
                ? removeFuturesOpenOrdersForSymbols(openOrdersReconciliation, {
                    symbols: [symbol],
                    orderKeys: cancelTargetOrderKeys,
                    confirmedAt: projectionObservedAt,
                })
                : cancelProjectionRequestedAt === null
                    ? openOrdersReconciliation
                    : failFuturesOpenOrdersPendingCancel(openOrdersReconciliation, {
                        symbol,
                        orderKeys: cancelTargetOrderKeys,
                        failedAt: projectionObservedAt,
                    });
            if (projected !== openOrdersReconciliation) {
                openOrdersReconciliation = projected;
                projectCurrentPortfolio({
                    state: confirmedEmpty && userDataStreamLive ? 'live' : 'stale',
                    syncCode: userDataStreamLive ? null : 'ACCOUNT_STREAM_UNAVAILABLE',
                });
                advanceRevision();
                broadcastStatus();
            }
            const outcome = confirmedEmpty ? 'canceled' : 'unknown';
            const code = confirmedEmpty
                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CANCEL_ALL_CONFIRMED
                : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN;
            items.push({ symbol, outcome, code });
            await appendAudit({
                eventType: 'cancel_all_child',
                category: 'safety',
                outcome: confirmedEmpty ? 'confirmed' : 'unknown',
                requestId: command.requestId,
                operationId: `${command.requestId}:${symbol}`,
                parentOperationId: command.requestId,
                action: command.action,
                commandDigest: intent.commandDigest,
                symbol,
                state: confirmedEmpty ? 'confirmed_empty' : 'recovery_required',
                code,
                safeDetail: deletesAcknowledged ? 'delete-acknowledged' : 'delete-outcome-unknown',
            });
        }
        const allConfirmed = items.every(item => item.outcome === 'canceled');
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: allConfirmed
                ? FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CANCELED
                : FUTURES_PRODUCTION_EXECUTION_STATES.PARTIAL,
            code: allConfirmed
                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CANCEL_ALL_CONFIRMED
                : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.PARTIAL,
            items,
            eventType: 'cancel_all_parent',
            category: 'safety',
            outcome: allConfirmed ? 'confirmed' : 'partial',
            audit: { action: command.action, commandDigest: intent.commandDigest },
        });
        if (allConfirmed) {
            await completeOperation();
        } else {
            recoveryHealthy = false;
            reconciliation = { required: true, state: 'unknown', nextAttemptAt: null };
            recovery = {
                required: true,
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            };
            activation = {
                enabled: false,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
                failedGate: 'recoveryHealthy',
            };
            broadcastStatus();
        }
        return currentAttempt;
    };

    const queryCloseChild = async ({ operation, expectedExchangeOrderId = null }) => {
        const audit = {
            requestId: operation.requestId,
            operationId: operation.requestId,
            parentOperationId: operation.parentOperationId ?? null,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
            clientOrderId: operation.clientOrderId,
            commandDigest: operation.commandDigest,
            symbol: operation.symbol,
            ...durableOrderFields(operation.draft),
        };
        const order = await invokeExchange({
            endpointId: ENDPOINT_IDS.queryOrder,
            audit,
            operation: () => facade.queryOrderByOriginalClientOrderId({
                symbol: operation.symbol,
                positionSide: operation.draft.positionSide,
                originalClientOrderId: operation.clientOrderId,
            }),
            execute: callback => coordinator.executeRecoveryQuery(callback, {
                endpointId: ENDPOINT_IDS.queryOrder,
            }),
        });
        if (order.symbol !== operation.symbol
            || order.clientOrderId !== operation.clientOrderId
            || order.side !== operation.draft.side
            || order.positionSide !== operation.draft.positionSide
            || order.originalType !== 'MARKET'
            || order.reduceOnly !== false
            || !exactDecimalEqual(order.originalQuantity, operation.draft.quantity)
            || (expectedExchangeOrderId && order.orderId !== expectedExchangeOrderId)) {
            throw new FuturesProductionExecutionServiceError(
                'FUTURES_PRODUCTION_RECONCILIATION_IDENTITY_REJECTED',
            );
        }
        if (order.status !== 'FILLED') return false;
        const positions = await executeRead({
            endpointId: ENDPOINT_IDS.positionRisk,
            weight: READ_WEIGHTS.positionRisk,
            audit,
            operation: () => facade.getPositionRisk(operation.symbol),
        });
        const position = findHedgePositionEntry(
            positions,
            operation.symbol,
            operation.draft.positionSide,
        );
        const confirmedFlat = position !== null
            && isZeroExactDecimal(parseSignedExactDecimal(position.positionAmt));
        if (confirmedFlat) {
            latestPositionRisk = [
                ...latestPositionRisk.filter(row => row?.symbol !== operation.symbol),
                ...positions,
            ];
            projectCurrentPortfolio({
                state: portfolio.state === 'live' ? 'live' : 'stale',
            });
        }
        return confirmedFlat;
    };

    const closePositionLeg = async ({ command, intent, symbol, positionSide }) => {
        const parentAudit = {
            requestId: command.requestId,
            operationId: command.requestId,
            action: command.action,
            commandDigest: intent.commandDigest,
            symbol,
            positionSide,
        };
        let evaluated;
        let draft;
        try {
            const preflight = await readFullPreflight(symbol, positionSide, parentAudit);
            const amount = parseSignedExactDecimal(preflight.snapshot.position.positionAmt);
            if (isZeroExactDecimal(amount)) {
                await appendAudit({
                    eventType: 'close_positions_child',
                    category: 'safety',
                    outcome: 'confirmed',
                    requestId: command.requestId,
                    operationId: `${command.requestId}:${symbol}:${positionSide}`,
                    parentOperationId: command.requestId,
                    action: command.action,
                    commandDigest: intent.commandDigest,
                    symbol,
                    positionSide,
                    positionEffect: 'EXIT',
                    state: 'confirmed_closed',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CLOSE_POSITIONS_CONFIRMED,
                    safeDetail: 'already-flat',
                });
                return { outcome: 'closed', code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CLOSE_POSITIONS_CONFIRMED };
            }
            draft = {
                symbol,
                side: positionSide === 'LONG' ? 'SELL' : 'BUY',
                positionSide,
                positionEffect: 'EXIT',
                type: 'MARKET',
                timeInForce: null,
                quantity: formatExactDecimal(absoluteExactDecimal(amount)),
                price: null,
            };
            const utcDay = canonicalFuturesProductionUtcDay(preflight.serverTime);
            const dailyState = coordinator.getOrderAdmissionSnapshot();
            const result = evaluateRisk({
                policy,
                identity,
                snapshot: preflight.snapshot,
                draft,
                killSwitchEngaged,
                dailyNotionalUsed: dailyState.dailyReservations?.[utcDay] ?? '0',
            });
            evaluated = { result, serverTime: preflight.serverTime, utcDay };
            if (!result.ok) throw new FuturesProductionExecutionServiceError(result.code);
        } catch (error) {
            const code = safeErrorCode(error);
            await appendAudit({
                eventType: 'close_positions_child',
                category: 'safety',
                outcome: 'rejected',
                requestId: command.requestId,
                operationId: `${command.requestId}:${symbol}:${positionSide}`,
                parentOperationId: command.requestId,
                action: command.action,
                commandDigest: intent.commandDigest,
                symbol,
                positionSide,
                positionEffect: 'EXIT',
                state: 'locally_rejected',
                code,
            });
            return { outcome: 'rejected', code };
        }

        const childRequestId = createRequestId(randomBytes);
        const clientOrderId = `cc7-${childRequestId}`;
        const childDigest = createFuturesProductionExecutionCommandDigest({
            parentRequestId: command.requestId,
            childRequestId,
            draft,
        });
        let reservation;
        try {
            reservation = await coordinator.reserveOrderDispatch({
                exactNotional: evaluated.result.classification
                    === FUTURES_PRODUCTION_EXECUTION_RISK_CLASSIFICATIONS.REDUCING
                    ? '0'
                    : evaluated.result.notionalUsdt,
                utcDay: evaluated.utcDay,
                serverTime: evaluated.serverTime,
                maximumDailyNotional: policy.maxDailyNotionalUsdt,
                audit: {
                    requestId: childRequestId,
                    operationId: childRequestId,
                    parentOperationId: command.requestId,
                    clientOrderId,
                    commandDigest: childDigest,
                    action: command.action,
                    credentialBinding,
                    state: 'dispatched',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
                    ...durableOrderFields(draft),
                },
            });
        } catch (error) {
            const code = safeErrorCode(error);
            await appendAudit({
                eventType: 'close_positions_child',
                category: 'safety',
                outcome: 'rejected',
                requestId: childRequestId,
                operationId: childRequestId,
                parentOperationId: command.requestId,
                clientOrderId,
                commandDigest: childDigest,
                action: command.action,
                state: 'locally_rejected',
                code,
                ...durableOrderFields(draft),
            });
            return { outcome: 'rejected', code };
        }

        const operation = {
            requestId: childRequestId,
            kind: intent.kind,
            action: command.action,
            parentOperationId: command.requestId,
            symbol,
            clientOrderId,
            commandDigest: childDigest,
            draft,
            dispatchAt: reservation.dispatchAt,
        };
        await appendAudit({
            eventType: 'dispatch_intent',
            category: 'dispatch',
            outcome: 'pending',
            requestId: childRequestId,
            operationId: childRequestId,
            parentOperationId: command.requestId,
            clientOrderId,
            commandDigest: childDigest,
            action: command.action,
            state: 'dispatched',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            dispatchAt: operation.dispatchAt,
            ...durableOrderFields(draft),
        });
        const dispatchAge = readNow() - operation.dispatchAt;
        if (dispatchAge < 0 || dispatchAge > MAX_DISPATCH_START_DELAY_MS) {
            const code = 'FUTURES_PRODUCTION_DISPATCH_DEADLINE_EXCEEDED';
            await appendAudit({
                eventType: 'close_positions_child',
                category: 'safety',
                outcome: 'rejected',
                requestId: childRequestId,
                operationId: childRequestId,
                parentOperationId: command.requestId,
                clientOrderId,
                commandDigest: childDigest,
                action: command.action,
                state: 'locally_rejected',
                code,
                dispatchAt: operation.dispatchAt,
                ...durableOrderFields(draft),
            });
            return { outcome: 'rejected', code };
        }

        let exchangeOrderId = null;
        try {
            const acknowledgement = await executeProduction({
                endpointId: ENDPOINT_IDS.placeHedgeMarketExitOrder,
                audit: {
                    requestId: childRequestId,
                    operationId: childRequestId,
                    parentOperationId: command.requestId,
                    action: command.action,
                    clientOrderId,
                    commandDigest: childDigest,
                    dispatchAt: reservation.dispatchAt,
                    ...durableOrderFields(draft),
                },
                operation: () => facade.placeHedgeMarketExitOrder({
                    symbol,
                    side: draft.side,
                    positionSide,
                    quantity: draft.quantity,
                    clientOrderId,
                }),
            });
            exchangeOrderId = acknowledgement.orderId;
        } catch (error) {
            if (error?.kind === FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED) {
                const code = FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED;
                await appendAudit({
                    eventType: 'close_positions_child',
                    category: 'safety',
                    outcome: 'rejected',
                    requestId: childRequestId,
                    operationId: childRequestId,
                    parentOperationId: command.requestId,
                    clientOrderId,
                    commandDigest: childDigest,
                    action: command.action,
                    state: 'exchange_rejected',
                    code,
                    ...durableOrderFields(draft),
                });
                return { outcome: 'rejected', code };
            }
        }
        let closed = false;
        try {
            closed = await queryCloseChild({ operation, expectedExchangeOrderId: exchangeOrderId });
        } catch (error) {
            reportInternal('close-position-reconcile', error);
        }
        const outcome = closed ? 'closed' : 'unknown';
        const code = closed
            ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CLOSE_POSITIONS_CONFIRMED
            : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN;
        await appendAudit({
            eventType: 'close_positions_child',
            category: 'safety',
            outcome: closed ? 'confirmed' : 'unknown',
            requestId: childRequestId,
            operationId: childRequestId,
            parentOperationId: command.requestId,
            clientOrderId,
            commandDigest: childDigest,
            action: command.action,
            state: closed ? 'confirmed_closed' : 'recovery_required',
            code,
            exchangeOrderId,
            ...durableOrderFields(draft),
        });
        return { outcome, code };
    };

    const closePositions = async (command, intent) => {
        activeOperation = {
            requestId: command.requestId,
            kind: intent.kind,
            action: command.action,
            credentialBinding,
            dispatchAt: readNow(),
        };
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.QUEUED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            eventType: 'close_positions_parent',
            category: 'safety',
            outcome: 'pending',
            audit: { action: command.action, commandDigest: intent.commandDigest },
        });
        const items = [];
        for (const symbol of policy.allowedSymbols) {
            const legResults = [];
            for (const positionSide of ['LONG', 'SHORT']) {
                legResults.push(await closePositionLeg({
                    command,
                    intent,
                    symbol,
                    positionSide,
                }));
            }
            const outcome = legResults.every(result => result.outcome === 'closed')
                ? 'closed'
                : legResults.some(result => result.outcome === 'unknown') ? 'unknown' : 'rejected';
            const code = outcome === 'closed'
                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CLOSE_POSITIONS_CONFIRMED
                : outcome === 'unknown'
                    ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN
                    : legResults.find(result => result.outcome === 'rejected')?.code
                        ?? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_REJECTED;
            items.push({ symbol, outcome, code });
        }

        const allClosed = items.length === policy.allowedSymbols.length
            && items.every(item => item.outcome === 'closed');
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: allClosed
                ? FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CLOSED
                : FUTURES_PRODUCTION_EXECUTION_STATES.PARTIAL,
            code: allClosed
                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CLOSE_POSITIONS_CONFIRMED
                : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.PARTIAL,
            items,
            eventType: 'close_positions_parent',
            category: 'safety',
            outcome: allClosed ? 'confirmed' : 'partial',
            audit: { action: command.action, commandDigest: intent.commandDigest },
        });
        if (allClosed) {
            await completeOperation();
        } else {
            recoveryHealthy = false;
            reconciliation = { required: true, state: 'unknown', nextAttemptAt: null };
            recovery = {
                required: true,
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            };
            activation = {
                enabled: false,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
                failedGate: 'recoveryHealthy',
            };
            broadcastStatus();
        }
        return currentAttempt;
    };

    const engageKillSwitch = async (command, intent) => {
        await ledger.setKillSwitch({
            engaged: true,
            requestId: command.requestId,
            operationId: command.requestId,
            intentId: command.requestId,
            action: command.action,
            commandDigest: intent.commandDigest,
            accountAlias: account.alias,
            accountFingerprint: account.fingerprint,
            credentialBinding,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.KILL_SWITCH_ENGAGED,
        });
        killSwitchEngaged = true;
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.KILL_SWITCH_ENGAGED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.KILL_SWITCH_ENGAGED,
            eventType: 'acknowledgement',
            category: 'safety',
            outcome: 'accepted',
            audit: { action: command.action, commandDigest: intent.commandDigest },
        });
        return currentAttempt;
    };

    const disengageKillSwitch = async (command, intent) => {
        const blockingOperations = (ledger.getActiveOperations?.() ?? []).filter(record => (
            (record.operationId ?? record.requestId) !== command.requestId
        ));
        if (!killSwitchEngaged || !recoveryHealthy || blockingOperations.length > 0) {
            throw new FuturesProductionExecutionServiceError(
                FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
            );
        }
        await ledger.setKillSwitch({
            engaged: false,
            requestId: command.requestId,
            operationId: command.requestId,
            intentId: command.requestId,
            action: command.action,
            commandDigest: intent.commandDigest,
            accountAlias: account.alias,
            accountFingerprint: account.fingerprint,
            credentialBinding,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.LIVE_ARMED,
        });
        killSwitchEngaged = false;
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.KILL_SWITCH_DISENGAGED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.LIVE_ARMED,
            eventType: 'acknowledgement',
            category: 'safety',
            outcome: 'accepted',
            audit: { action: command.action, commandDigest: intent.commandDigest },
        });
        return currentAttempt;
    };

    const scheduleMarginReconciliation = (operation, index) => {
        const nextIndex = Math.min(index + 1, FAST_RECONCILIATION_DELAYS.length - 1);
        const delay = FAST_RECONCILIATION_DELAYS[nextIndex]
            - FAST_RECONCILIATION_DELAYS[index];
        reconciliation = {
            required: true,
            state: 'scheduled',
            nextAttemptAt: readNow() + delay,
        };
        recovery = {
            required: true,
            state: 'recovering',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
        };
        advanceRevision();
        broadcastStatus();
        schedule(() => reconcileMarginAdjustment(operation, { index: nextIndex }), delay);
    };

    const reconcileMarginAdjustment = async (operation, {
        index = 0,
        allowDuringOperationalRecovery = false,
    } = {}) => {
        if (shuttingDown || !operation || activeOperation !== operation) return null;
        if (operationalRecoveryInProgress && !allowDuringOperationalRecovery) {
            scheduleMarginReconciliation(operation, index);
            return null;
        }
        const age = readNow() - operation.dispatchAt;
        if (age < 0
            || age > MAX_MARGIN_RECOVERY_AGE_MS
            || operation.credentialBinding !== credentialBinding) {
            reconciliation = { required: true, state: 'unavailable', nextAttemptAt: null };
            recovery = {
                required: true,
                state: 'blocked',
                code: operation.credentialBinding !== credentialBinding
                    ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CREDENTIAL_ROTATION_BLOCKED
                    : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
            };
            await setAttempt({
                requestId: operation.requestId,
                kind: operation.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE,
                code: recovery.code,
                eventType: 'reconciliation_result',
                category: 'reconciliation',
                outcome: 'unknown',
                audit: {
                    action: operation.action,
                    commandDigest: operation.commandDigest,
                    ...durableMarginFields(operation.draft),
                },
            });
            return null;
        }
        reconciliation = { required: true, state: 'querying', nextAttemptAt: null };
        broadcastStatus();
        let confirmed = false;
        try {
            const audit = {
                requestId: operation.requestId,
                operationId: operation.requestId,
                action: operation.action,
                commandDigest: operation.commandDigest,
                ...durableMarginFields(operation.draft),
            };
            const history = await invokeExchange({
                endpointId: ENDPOINT_IDS.positionMarginHistory,
                audit,
                operation: () => facade.getPositionMarginHistory({
                    symbol: operation.draft.symbol,
                    positionSide: operation.draft.positionSide,
                    marginAction: operation.draft.marginAction,
                    startTime: operation.serverTime,
                }),
                execute: callback => coordinator.executeRecoveryQuery(callback, {
                    endpointId: ENDPOINT_IDS.positionMarginHistory,
                }),
            });
            const positions = await executeRead({
                endpointId: ENDPOINT_IDS.positionRisk,
                weight: READ_WEIGHTS.positionRisk,
                audit,
                operation: () => facade.getPositionRisk(operation.draft.symbol),
            });
            const position = findHedgePositionEntry(
                positions,
                operation.draft.symbol,
                operation.draft.positionSide,
            );
            const expectedType = operation.draft.marginAction === 'ADD' ? 1 : 2;
            const exactHistory = history.filter(row => (
                row.symbol === operation.draft.symbol
                && row.positionSide === operation.draft.positionSide
                && row.type === expectedType
                && row.asset === 'USDT'
                && row.time >= operation.serverTime
                && exactDecimalEqual(row.amount, operation.draft.amount)
            ));
            const before = parseNonNegativeExactDecimal(operation.draft.marginBefore);
            const amount = parsePositiveExactDecimal(operation.draft.amount);
            const expectedMargin = operation.draft.marginAction === 'ADD'
                ? addExactDecimals(before, amount)
                : subtractExactDecimals(before, amount);
            confirmed = exactHistory.length === 1
                && position !== null
                && exactDecimalEqual(
                    position.isolatedMargin,
                    formatExactDecimal(expectedMargin),
                    { allowZero: true },
                );
            if (confirmed) {
                const refreshedPositions = new Map(positions.map(candidate => ([
                    `${candidate?.symbol}:${candidate?.positionSide}`,
                    candidate,
                ])));
                latestPositionRisk = latestPositionRisk.map((candidate) => {
                    const key = `${candidate?.symbol}:${candidate?.positionSide}`;
                    const refreshed = refreshedPositions.get(key);
                    if (!refreshed) return candidate;
                    refreshedPositions.delete(key);
                    return { ...candidate, ...refreshed };
                });
                latestPositionRisk.push(...refreshedPositions.values());
                try {
                    projectCurrentPortfolio({
                        state: portfolio.state === 'live' ? 'live' : 'stale',
                    });
                    portfolio = {
                        ...portfolio,
                        observedAt: Math.max(
                            portfolio.observedAt ?? 0,
                            exactHistory[0].time,
                        ),
                    };
                } catch (error) {
                    reportInternal('margin-portfolio-projection', error);
                }
                await setAttempt({
                    requestId: operation.requestId,
                    kind: operation.kind,
                    state: FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_MARGIN_ADJUSTED,
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.MARGIN_ADJUSTED,
                    items: [{
                        symbol: operation.draft.symbol,
                        outcome: 'adjusted',
                        code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.MARGIN_ADJUSTED,
                    }],
                    eventType: 'reconciliation_result',
                    category: 'reconciliation',
                    outcome: 'confirmed',
                    audit,
                });
                await completeOperation();
                return currentAttempt;
            }
        } catch (error) {
            reportInternal('margin-reconciliation', error);
        }
        await setAttempt({
            requestId: operation.requestId,
            kind: operation.kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.RESULT_UNKNOWN,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
            items: [{
                symbol: operation.draft.symbol,
                outcome: 'unknown',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
            }],
            eventType: 'reconciliation_result',
            category: 'reconciliation',
            outcome: 'unknown',
            audit: {
                action: operation.action,
                commandDigest: operation.commandDigest,
                ...durableMarginFields(operation.draft),
            },
        });
        if (index < FAST_RECONCILIATION_DELAYS.length - 1) {
            scheduleMarginReconciliation(operation, index);
        } else {
            reconciliation = { required: true, state: 'unavailable', nextAttemptAt: null };
            recovery = {
                required: true,
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            };
            advanceRevision();
            broadcastStatus();
        }
        return null;
    };

    const adjustIsolatedMargin = async (command, intent) => {
        const preflight = await readMarginPreflight(intent.draft, {
            requestId: command.requestId,
            operationId: command.requestId,
            action: command.action,
            commandDigest: intent.commandDigest,
            symbol: intent.draft.symbol,
            positionSide: intent.draft.positionSide,
            marginAction: intent.draft.marginAction,
            amount: intent.draft.amount,
        });
        const draft = {
            ...intent.draft,
            marginBefore: preflight.marginBefore,
        };
        const dispatchAt = readNow();
        const operation = {
            requestId: command.requestId,
            kind: intent.kind,
            action: command.action,
            commandDigest: intent.commandDigest,
            credentialBinding,
            dispatchAt,
            serverTime: preflight.serverTime,
            draft,
        };
        activeOperation = operation;
        await setAttempt({
            requestId: command.requestId,
            kind: intent.kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.QUEUED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            eventType: 'queued',
            category: 'dispatch',
            outcome: 'pending',
            audit: {
                action: command.action,
                commandDigest: intent.commandDigest,
                ...durableMarginFields(draft),
            },
        });
        await appendAudit({
            eventType: 'dispatch_intent',
            category: 'dispatch',
            outcome: 'pending',
            requestId: command.requestId,
            operationId: command.requestId,
            action: command.action,
            commandDigest: intent.commandDigest,
            dispatchAt,
            serverTime: preflight.serverTime,
            state: 'dispatched',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
            ...durableMarginFields(draft),
        });
        try {
            const acknowledgement = await executeProduction({
                endpointId: ENDPOINT_IDS.modifyIsolatedPositionMargin,
                audit: {
                    requestId: command.requestId,
                    operationId: command.requestId,
                    action: command.action,
                    commandDigest: intent.commandDigest,
                    ...durableMarginFields(draft),
                },
                operation: () => facade.modifyIsolatedPositionMargin({
                    symbol: draft.symbol,
                    positionSide: draft.positionSide,
                    marginAction: draft.marginAction,
                    amount: draft.amount,
                }),
            });
            const expectedType = draft.marginAction === 'ADD' ? 1 : 2;
            if (acknowledgement.acknowledged !== true
                || acknowledgement.code !== 200
                || acknowledgement.type !== expectedType
                || !exactDecimalEqual(acknowledgement.amount, draft.amount)) {
                throw new FuturesProductionExecutionServiceError(
                    FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                );
            }
            await setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.RECONCILING,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ORDER_DISPATCHED,
                eventType: 'response_classified',
                category: 'exchange',
                outcome: 'accepted',
                audit: {
                    action: command.action,
                    commandDigest: intent.commandDigest,
                    ...durableMarginFields(draft),
                },
            });
        } catch (error) {
            if (error?.kind === FUTURES_PRODUCTION_EXECUTION_FACADE_ERROR_KINDS.EXCHANGE_REJECTED) {
                await setAttempt({
                    requestId: command.requestId,
                    kind: intent.kind,
                    state: FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED,
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
                    items: [{
                        symbol: draft.symbol,
                        outcome: 'rejected',
                        code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
                    }],
                    eventType: 'terminal_transition',
                    category: 'exchange',
                    outcome: 'rejected',
                    audit: {
                        action: command.action,
                        commandDigest: intent.commandDigest,
                        ...durableMarginFields(draft),
                    },
                });
                await completeOperation();
                return currentAttempt;
            }
            await setAttempt({
                requestId: command.requestId,
                kind: intent.kind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.RESULT_UNKNOWN,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                items: [{
                    symbol: draft.symbol,
                    outcome: 'unknown',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN,
                }],
                eventType: 'response_classified',
                category: 'exchange',
                outcome: 'unknown',
                audit: {
                    action: command.action,
                    commandDigest: intent.commandDigest,
                    ...durableMarginFields(draft),
                },
            });
        }
        await reconcileMarginAdjustment(operation);
        return currentAttempt;
    };

    const executeFinal = async (command, context) => {
        const kind = FINAL_KIND_BY_ACTION[command.action];
        const commandDigest = createFuturesProductionExecutionCommandDigest(command);
        const existing = finalCommandExecutions.get(command.requestId);
        if (existing) {
            if (existing.connectionId !== context.connectionId
                || existing.action !== command.action
                || existing.commandDigest !== commandDigest) {
                return rejectFinalCommandWithoutStateMutation(
                    command,
                    context,
                    FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.INTENT_REJECTED,
                );
            }
            const outcome = await existing.completion;
            emitStatus(sessions.get(context.connectionId));
            return outcome;
        }
        if (!kind || mutex || command.revision !== activeIntent?.revision) {
            return rejectFinalCommandWithoutStateMutation(
                command,
                context,
                mutex
                    ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.BUSY
                    : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.INTENT_REJECTED,
            );
        }
        let settleExecution;
        const execution = {
            connectionId: context.connectionId,
            action: command.action,
            commandDigest,
            completed: false,
            completion: new Promise(resolve => { settleExecution = resolve; }),
        };
        finalCommandExecutions.set(command.requestId, execution);
        mutex = true;
        broadcastStatus();
        let outcome = false;
        try {
            const intent = await consumeIntent(command, context);
            if (!intent) {
                await rejectFinalCommandWithoutStateMutation(
                    command,
                    context,
                    FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.INTENT_REJECTED,
                );
                return false;
            }
            let result;
            if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER) {
                result = await placeOrder(command, intent);
            } else if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT) {
                result = await adjustIsolatedMargin(command, intent);
            } else if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT) {
                result = await amendOrder(command, intent);
            } else if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS) {
                result = await cancelAllOpenOrders(command, intent);
            } else if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS) {
                result = await closePositions(command, intent);
            } else if (kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH) {
                result = await engageKillSwitch(command, intent);
            } else {
                result = await disengageKillSwitch(command, intent);
            }
            outcome = Boolean(result);
        } catch (error) {
            reportInternal('final-command', error);
            if (!failedClosed) {
                await rejectCommand({
                    requestId: command.requestId,
                    kind,
                    code: safeErrorCode(error),
                }).catch(() => {});
            }
        } finally {
            execution.completed = true;
            settleExecution(outcome);
            if (finalCommandExecutions.size > 64) {
                for (const [requestId, candidate] of finalCommandExecutions) {
                    if (finalCommandExecutions.size <= 64) break;
                    if (candidate.completed) finalCommandExecutions.delete(requestId);
                }
            }
            mutex = false;
            advanceRevision();
            broadcastStatus();
        }
        return outcome;
    };

    const draftFromRecord = record => ({
        symbol: record.symbol,
        side: record.side,
        positionSide: record.positionSide,
        positionEffect: record.positionEffect,
        type: record.orderType,
        timeInForce: record.timeInForce,
        quantity: record.quantity,
        price: record.price,
    });

    const hasDefinitiveRejectedPostEvidence = ({
        operationId,
        endpointId,
        dispatchAt,
    }) => {
        const records = ledger.getRecords?.() ?? [];
        let dispatchPersisted = false;
        let requestPersisted = false;
        for (const record of records) {
            if ((record.operationId ?? record.requestId) !== operationId) continue;
            if (['daily_notional_reserved', 'dispatch_intent'].includes(record.eventType)
                && (dispatchAt == null || record.dispatchAt === dispatchAt)) {
                dispatchPersisted = true;
            }
            if (dispatchPersisted
                && record.eventType === 'exchange_request'
                && record.endpointId === endpointId
                && record.outcome === 'pending') {
                requestPersisted = true;
            }
            if (requestPersisted
                && record.eventType === 'exchange_response'
                && record.endpointId === endpointId
                && record.outcome === 'rejected') {
                return true;
            }
        }
        return false;
    };

    const terminalizeDefinitivelyRejectedOrder = async (record, kind) => {
        const draft = draftFromRecord(record);
        await setAttempt({
            requestId: record.requestId,
            kind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
            eventType: 'restart_recovery',
            category: 'recovery',
            outcome: 'rejected',
            audit: {
                action: record.action,
                parentOperationId: record.parentOperationId,
                clientOrderId: record.clientOrderId,
                commandDigest: record.commandDigest,
                exchangeOrderId: record.exchangeOrderId,
                dispatchAt: record.dispatchAt,
                ...durableOrderFields(draft),
            },
        });
    };

    const recoverEngagedKillSwitch = async (records) => {
        if (records.length !== 1) return blockRecovery();
        const [record] = records;
        if (!killSwitchEngaged) {
            await ledger.setKillSwitch({
                engaged: true,
                requestId: record.requestId,
                operationId: record.operationId ?? record.requestId,
                intentId: record.intentId ?? record.requestId,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
                commandDigest: record.commandDigest,
                accountAlias: account?.alias ?? null,
                accountFingerprint: account?.fingerprint ?? null,
                credentialBinding,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.KILL_SWITCH_ENGAGED,
            });
            killSwitchEngaged = true;
        }
        await setAttempt({
            requestId: record.requestId,
            kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.KILL_SWITCH_ENGAGED,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.KILL_SWITCH_ENGAGED,
            eventType: 'restart_recovery',
            category: 'recovery',
            outcome: 'confirmed',
            audit: {
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH,
                commandDigest: record.commandDigest,
                intentId: record.intentId ?? record.requestId,
            },
        });
        if ((ledger.getActiveOperations?.().length ?? 0) !== 0) return blockRecovery();
        await completeOperation();
        return true;
    };

    const recoverDisengagedKillSwitch = async (records) => {
        if (records.length !== 1) return blockRecovery();
        const [record] = records;
        const operationId = record.operationId ?? record.requestId;
        const transitions = (ledger.getRecords?.() ?? []).filter(candidate => (
            candidate.eventType === 'kill_switch_transition'
            && (candidate.operationId ?? candidate.requestId) === operationId
            && candidate.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH
        ));
        if (transitions.length > 1) return blockRecovery();
        const transition = transitions[0] ?? null;
        if (transition === null) {
            if (!killSwitchEngaged) return blockRecovery();
            await setAttempt({
                requestId: record.requestId,
                kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.COMMAND_REJECTED,
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: 'rejected',
                audit: {
                    action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
                    commandDigest: record.commandDigest,
                    intentId: record.intentId ?? record.requestId,
                },
            });
        } else {
            if (transition.state !== 'disengaged'
                || transition.outcome !== 'disengaged'
                || transition.commandDigest !== record.commandDigest) {
                return blockRecovery();
            }
            if (killSwitchEngaged) return blockRecovery();
            await setAttempt({
                requestId: record.requestId,
                kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.KILL_SWITCH_DISENGAGED,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.LIVE_ARMED,
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: 'confirmed',
                audit: {
                    action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH,
                    commandDigest: record.commandDigest,
                    intentId: record.intentId ?? record.requestId,
                },
            });
        }
        if ((ledger.getActiveOperations?.().length ?? 0) !== 0) return blockRecovery();
        await completeOperation();
        return true;
    };

    const recoverCancelAll = async (records) => {
        const parent = records.find(record => record.parentOperationId === null)
            ?? records[0];
        const requestId = parent.parentOperationId ?? parent.requestId;
        const items = [];
        for (const symbol of policy.allowedSymbols) {
            let confirmed = false;
            try {
                const inventories = await readSymbolInventories(symbol, {
                    requestId,
                    operationId: `${requestId}:${symbol}`,
                    parentOperationId: requestId,
                    action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
                    symbol,
                });
                confirmed = inventories.regular.length === 0 && inventories.algo.length === 0;
            } catch (error) {
                reportInternal('restart-cancel-reconcile', error);
            }
            const code = confirmed
                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CANCEL_ALL_CONFIRMED
                : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN;
            items.push({ symbol, outcome: confirmed ? 'canceled' : 'unknown', code });
            await appendAudit({
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: confirmed ? 'confirmed' : 'unknown',
                requestId,
                operationId: `${requestId}:${symbol}`,
                parentOperationId: requestId,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS,
                symbol,
                state: confirmed ? 'confirmed_empty' : 'recovery_required',
                code,
            });
        }
        const complete = items.every(item => item.outcome === 'canceled');
        await setAttempt({
            requestId,
            kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS,
            state: complete
                ? FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CANCELED
                : FUTURES_PRODUCTION_EXECUTION_STATES.PARTIAL,
            code: complete
                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CANCEL_ALL_CONFIRMED
                : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.PARTIAL,
            items,
            eventType: 'restart_recovery',
            category: 'recovery',
            outcome: complete ? 'confirmed' : 'partial',
            audit: { action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS },
        });
        const recovered = complete && (ledger.getActiveOperations?.().length ?? 0) === 0;
        if (recovered) {
            await completeOperation();
        } else {
            recoveryHealthy = false;
            reconciliation = { required: true, state: 'unknown', nextAttemptAt: null };
            recovery = {
                required: true,
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            };
            advanceRevision();
            broadcastStatus();
        }
        return recovered;
    };

    const recoverClosePositions = async (records) => {
        const parent = records.find(record => record.parentOperationId === null)
            ?? records[0];
        const requestId = parent.parentOperationId ?? parent.requestId;
        const definitivelyRejectedLegs = new Set();
        for (const record of records) {
            if (!record.clientOrderId || !record.symbol || record.orderType !== 'MARKET') continue;
            if (hasDefinitiveRejectedPostEvidence({
                operationId: record.operationId ?? record.requestId,
                endpointId: ENDPOINT_IDS.placeHedgeMarketExitOrder,
                dispatchAt: record.dispatchAt,
            })) {
                await terminalizeDefinitivelyRejectedOrder(
                    record,
                    FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
                );
                definitivelyRejectedLegs.add(`${record.symbol}:${record.positionSide}`);
                continue;
            }
            try {
                await queryCloseChild({
                    operation: {
                        requestId: record.requestId,
                        parentOperationId: requestId,
                        symbol: record.symbol,
                        clientOrderId: record.clientOrderId,
                        commandDigest: record.commandDigest,
                        draft: draftFromRecord(record),
                    },
                    expectedExchangeOrderId: record.exchangeOrderId,
                });
            } catch (error) {
                reportInternal('restart-close-query', error);
            }
        }
        const items = [];
        for (const symbol of policy.allowedSymbols) {
            let flat = false;
            let positions = null;
            try {
                positions = await executeRead({
                    endpointId: ENDPOINT_IDS.positionRisk,
                    weight: READ_WEIGHTS.positionRisk,
                    audit: {
                        requestId,
                        operationId: requestId,
                        action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
                        symbol,
                    },
                    operation: () => facade.getPositionRisk(symbol),
                });
                flat = ['LONG', 'SHORT'].every((positionSide) => {
                    const position = findHedgePositionEntry(positions, symbol, positionSide);
                    return position !== null
                        && isZeroExactDecimal(parseSignedExactDecimal(position.positionAmt));
                });
            } catch (error) {
                reportInternal('restart-close-position', error);
            }
            const symbolHasDefinitiveRejection = ['LONG', 'SHORT'].some(positionSide => (
                definitivelyRejectedLegs.has(`${symbol}:${positionSide}`)
            ));
            const code = flat
                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CLOSE_POSITIONS_CONFIRMED
                : symbolHasDefinitiveRejection
                    ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED
                    : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RESULT_UNKNOWN;
            items.push({
                symbol,
                outcome: flat
                    ? 'closed'
                    : symbolHasDefinitiveRejection ? 'rejected' : 'unknown',
                code,
            });
            if (flat) {
                for (const record of records.filter(item => (
                    item.symbol === symbol
                    && item.clientOrderId
                    && item.orderType === 'MARKET'
                ))) {
                    await appendAudit({
                        eventType: 'restart_recovery',
                        category: 'recovery',
                        outcome: 'confirmed',
                        requestId: record.requestId,
                        operationId: record.operationId ?? record.requestId,
                        parentOperationId: requestId,
                        clientOrderId: record.clientOrderId,
                        commandDigest: record.commandDigest,
                        action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS,
                        symbol,
                        state: 'confirmed_closed',
                        code,
                        exchangeOrderId: record.exchangeOrderId,
                        ...durableOrderFields(draftFromRecord(record)),
                    });
                }
            }
        }
        const complete = items.every(item => item.outcome === 'closed');
        await setAttempt({
            requestId,
            kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
            state: complete
                ? FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CLOSED
                : FUTURES_PRODUCTION_EXECUTION_STATES.PARTIAL,
            code: complete
                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CLOSE_POSITIONS_CONFIRMED
                : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.PARTIAL,
            items,
            eventType: 'restart_recovery',
            category: 'recovery',
            outcome: complete ? 'confirmed' : 'partial',
            audit: { action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS },
        });
        const recovered = complete && (ledger.getActiveOperations?.().length ?? 0) === 0;
        if (recovered) {
            await completeOperation();
        } else {
            recoveryHealthy = false;
            reconciliation = { required: true, state: 'unknown', nextAttemptAt: null };
            recovery = {
                required: true,
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            };
            advanceRevision();
            broadcastStatus();
        }
        return recovered;
    };

    const recoverMarginAdjustment = async (records) => {
        const record = records.at(-1);
        if (!record
            || !record.symbol
            || !['LONG', 'SHORT'].includes(record.positionSide)
            || !['ADD', 'REDUCE'].includes(record.marginAction)
            || typeof record.amount !== 'string'
            || typeof record.marginBefore !== 'string') {
            await appendAudit({
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: 'blocked',
                requestId: record?.requestId ?? null,
                operationId: record?.operationId ?? record?.requestId ?? null,
                action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN,
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
                safeDetail: 'invalid-durable-margin-contract',
            });
            return blockRecovery({
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
            });
        }
        const draft = {
            symbol: record.symbol,
            positionSide: record.positionSide,
            marginAction: record.marginAction,
            amount: record.amount,
            marginBefore: record.marginBefore,
        };
        try {
            parsePositiveExactDecimal(draft.amount);
            parseNonNegativeExactDecimal(draft.marginBefore);
        } catch {
            return blockRecovery({
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
            });
        }
        if (record.dispatchAt == null) {
            await setAttempt({
                requestId: record.requestId,
                kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.COMMAND_REJECTED,
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: 'rejected',
                audit: {
                    action: record.action,
                    commandDigest: record.commandDigest,
                    ...durableMarginFields(draft),
                },
            });
            await completeOperation();
            return true;
        }
        if (!Number.isSafeInteger(record.serverTime)) {
            return blockRecovery({
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
            });
        }
        if (hasDefinitiveRejectedPostEvidence({
            operationId: record.operationId ?? record.requestId,
            endpointId: ENDPOINT_IDS.modifyIsolatedPositionMargin,
            dispatchAt: record.dispatchAt,
        })) {
            await setAttempt({
                requestId: record.requestId,
                kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.EXCHANGE_REJECTED,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
                items: [{
                    symbol: record.symbol,
                    outcome: 'rejected',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.EXCHANGE_REJECTED,
                }],
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: 'rejected',
                audit: {
                    action: record.action,
                    commandDigest: record.commandDigest,
                    ...durableMarginFields(draft),
                },
            });
            await completeOperation();
            return true;
        }
        activeOperation = {
            requestId: record.requestId,
            kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT,
            action: FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN,
            commandDigest: record.commandDigest,
            credentialBinding: record.credentialBinding,
            dispatchAt: record.dispatchAt,
            serverTime: record.serverTime,
            draft,
        };
        recoveryHealthy = false;
        recovery = {
            required: true,
            state: 'recovering',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
        };
        updateAttemptWithoutAudit({
            requestId: record.requestId,
            kind: FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.RECOVERING,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            items: [{
                symbol: record.symbol,
                outcome: 'unknown',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            }],
        });
        await appendAudit({
            eventType: 'restart_recovery',
            category: 'recovery',
            outcome: 'pending',
            requestId: record.requestId,
            operationId: record.operationId ?? record.requestId,
            action: record.action,
            commandDigest: record.commandDigest,
            state: 'recovering',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            dispatchAt: record.dispatchAt,
            serverTime: record.serverTime,
            ...durableMarginFields(draft),
        });
        await reconcileMarginAdjustment(activeOperation, {
            allowDuringOperationalRecovery: true,
        });
        return activeOperation === null;
    };

    const recoverPersistedOperations = async ({ allowDuringOperationalRecovery = false } = {}) => {
        let active = ledger.getActiveOperations?.() ?? [];
        if (active.length === 0) return true;
        const bindings = new Set(active.map(record => record.credentialBinding).filter(Boolean));
        if (bindings.size !== 1 || !bindings.has(credentialBinding)) {
            recovery = {
                required: true,
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CREDENTIAL_ROTATION_BLOCKED,
            };
            recoveryHealthy = false;
            await appendAudit({
                eventType: 'credential_mismatch',
                category: 'recovery',
                outcome: 'blocked',
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CREDENTIAL_ROTATION_BLOCKED,
            });
            return false;
        }
        const prepareActions = new Set(Object.keys(PREPARE_KIND_BY_ACTION));
        for (const record of active.filter(item => prepareActions.has(item.action))) {
            await appendAudit({
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: 'expired',
                requestId: record.requestId,
                operationId: record.operationId ?? record.requestId,
                intentId: record.intentId ?? record.requestId,
                action: record.action,
                commandDigest: record.commandDigest,
                state: 'expired',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.INTENT_EXPIRED,
            });
        }
        active = ledger.getActiveOperations?.() ?? [];
        if (active.length === 0) return true;
        const killSwitchRecords = active.filter(record => (
            record.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH
        ));
        if (killSwitchRecords.length > 0) return recoverEngagedKillSwitch(killSwitchRecords);
        const liveArmRecords = active.filter(record => (
            record.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH
        ));
        if (liveArmRecords.length > 0) return recoverDisengagedKillSwitch(liveArmRecords);
        const marginRecords = active.filter(record => (
            record.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN
        ));
        if (marginRecords.length > 0) return recoverMarginAdjustment(marginRecords);
        const cancelRecords = active.filter(record => (
            record.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS
        ));
        if (cancelRecords.length > 0) return recoverCancelAll(cancelRecords);
        const closeRecords = active.filter(record => (
            record.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS
        ));
        if (closeRecords.length > 0) return recoverClosePositions(closeRecords);

        const record = active.find(item => (
            item.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
            || item.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER
        ));
        if (!record) {
            await appendAudit({
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: 'blocked',
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
                safeDetail: 'unsupported-durable-operation',
            });
            return blockRecovery({
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
            });
        }
        const isAmendment = record.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER;
        const orderKind = isAmendment
            ? FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT
            : FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER;
        const productionEndpointId = isAmendment
            ? ENDPOINT_IDS.modifyLimitOrder
            : ENDPOINT_IDS.placeLimitGtcOrder;
        if (record.dispatchAt == null) {
            const draft = draftFromRecord(record);
            await setAttempt({
                requestId: record.requestId,
                kind: orderKind,
                state: FUTURES_PRODUCTION_EXECUTION_STATES.LOCALLY_REJECTED,
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.COMMAND_REJECTED,
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: 'rejected',
                audit: {
                    action: record.action,
                    clientOrderId: record.clientOrderId,
                    commandDigest: record.commandDigest,
                    ...durableOrderFields(draft),
                },
            });
            return true;
        }
        const draft = draftFromRecord(record);
        if (!draft.symbol || !draft.side || !draft.positionSide || !draft.positionEffect
            || !draft.type || !draft.quantity || !record.clientOrderId
            || (isAmendment && !record.exchangeOrderId)) {
            await appendAudit({
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: 'blocked',
                requestId: record.requestId,
                operationId: record.operationId ?? record.requestId,
                action: record.action,
                clientOrderId: record.clientOrderId,
                commandDigest: record.commandDigest,
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
                safeDetail: 'invalid-durable-order-contract',
            });
            return blockRecovery({
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
            });
        }
        if (hasDefinitiveRejectedPostEvidence({
            operationId: record.operationId ?? record.requestId,
            endpointId: productionEndpointId,
            dispatchAt: record.dispatchAt,
        })) {
            await terminalizeDefinitivelyRejectedOrder(
                record,
                orderKind,
            );
            if ((ledger.getActiveOperations?.().length ?? 0) !== 0) return blockRecovery();
            await completeOperation();
            return true;
        }
        activeOperation = {
            requestId: record.requestId,
            kind: orderKind,
            action: record.action,
            commandDigest: record.commandDigest,
            clientOrderId: record.clientOrderId,
            symbol: record.symbol,
            draft,
            dispatchAt: record.dispatchAt,
            credentialBinding: record.credentialBinding,
            exchangeOrderId: record.exchangeOrderId,
            lastOrderDigest: null,
        };
        recoveryHealthy = false;
        recovery = {
            required: true,
            state: 'recovering',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
        };
        updateAttemptWithoutAudit({
            requestId: record.requestId,
            kind: orderKind,
            state: FUTURES_PRODUCTION_EXECUTION_STATES.RECOVERING,
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            items: [{
                symbol: record.symbol,
                outcome: 'unknown',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            }],
        });
        await appendAudit({
            eventType: 'restart_recovery',
            category: 'recovery',
            outcome: 'pending',
            requestId: record.requestId,
            operationId: record.requestId,
            action: record.action,
            clientOrderId: record.clientOrderId,
            commandDigest: record.commandDigest,
            state: 'recovering',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            ...durableOrderFields(draft),
        });
        await reconcileOrder(activeOperation, { allowDuringOperationalRecovery });
        return activeOperation === null;
    };

    const scheduleIdentityRetry = () => {
        if (shuttingDown || !config.enabled || identityRetryTimer !== null) return;
        const delay = USER_DATA_RECONNECT_DELAYS_MS[Math.min(
            identityRetryAttempt,
            USER_DATA_RECONNECT_DELAYS_MS.length - 1,
        )];
        identityRetryAttempt += 1;
        identityRetryTimer = schedule(async () => {
            identityRetryTimer = null;
            await initializePrivateAccount();
        }, delay);
    };

    const initializePrivateAccount = async () => {
        if (shuttingDown || !storageHealthy || !config.enabled) return false;
        const active = ledger.getActiveOperations?.() ?? [];
        const bindings = new Set(active.map(record => record.credentialBinding).filter(Boolean));
        const bindingMatches = bindings.size === 0
            || (bindings.size === 1 && bindings.has(credentialBinding));
        if (!bindingMatches) {
            identityValid = false;
            recoveryHealthy = false;
            recovery = {
                required: true,
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.CREDENTIAL_ROTATION_BLOCKED,
            };
            await refreshActivation({ audit: false });
            return false;
        }
        try {
            identityValid = await validateIdentity();
            if (!identityValid) {
                throw new FuturesProductionExecutionServiceError(
                    FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
                );
            }
            cancelScheduled(identityRetryTimer);
            identityRetryTimer = null;
            identityRetryAttempt = 0;
            if (active.length > 0) {
                recoveryHealthy = await recoverPersistedOperations();
            } else {
                recoveryHealthy = true;
                recovery = {
                    required: false,
                    state: 'healthy',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED,
                };
            }
            await refreshActivation({ audit: false });
            if (recoveryHealthy) {
                runBackground('account-stream-bootstrap', startUserDataStream);
            }
            return recoveryHealthy;
        } catch (error) {
            identityValid = false;
            identityBootstrapSnapshot = null;
            if (active.length > 0) {
                recoveryHealthy = false;
                recovery = {
                    required: true,
                    state: 'blocked',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
                };
            } else {
                recoveryHealthy = true;
                recovery = {
                    required: false,
                    state: 'healthy',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED,
                };
            }
            reportInternal('private-account-bootstrap', error);
            await refreshActivation({ audit: false });
            scheduleIdentityRetry();
            return false;
        }
    };

    const start = async () => {
        if (started) return statusFor(null);
        try {
            await ledger.open();
            storageHealthy = ledger.getHealth?.().healthy !== false;
            const replay = ledger.getReplaySnapshot?.() ?? {};
            killSwitchEngaged = replay.killSwitchEngaged !== false;
            const persistedRateState = ledger.getOrderRateState?.() ?? {
                dispatchTimes: [],
                originWeightReservations: [],
                lastOriginWeightObservedAt: null,
                pauseUntil: 0,
                dailyReservations: {},
                lastUtcDay: null,
                lastServerTime: null,
            };
            coordinator?.restoreOrderState?.({
                dispatchTimes: persistedRateState.dispatchTimes ?? [],
                pauseUntil: persistedRateState.pauseUntil ?? 0,
                dailyReservations: persistedRateState.dailyReservations ?? {},
                lastUtcDay: persistedRateState.lastUtcDay ?? null,
                lastServerTime: persistedRateState.lastServerTime ?? null,
            });
            coordinator?.restoreOriginWeightState?.({
                originWeightReservations: persistedRateState.originWeightReservations ?? [],
                lastOriginWeightObservedAt: persistedRateState.lastOriginWeightObservedAt ?? null,
            });
            lastServerTime = replay.lastServerTime ?? null;
            await ledger.assertHealthy?.();
            await appendAudit({
                eventType: 'storage_health',
                category: 'storage',
                outcome: 'healthy',
                state: 'healthy',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED,
            });
        } catch (error) {
            poison('startup-storage', error);
        }

        if (storageHealthy && !config.enabled
            && (ledger.getActiveOperations?.().length ?? 0) > 0) {
            await appendAudit({
                eventType: 'restart_recovery',
                category: 'recovery',
                outcome: 'blocked',
                state: 'blocked',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
                safeDetail: 'production-runtime-disabled',
            });
            blockRecovery({
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_UNAVAILABLE,
            });
        }
        started = true;
        await refreshActivation({ audit: storageHealthy });
        if (storageHealthy && config.enabled) {
            await initializePrivateAccount();
        }
        return statusFor(null);
    };

    const handleRequestNow = async (raw, context = {}) => {
        if (!started || shuttingDown
            || typeof context.connectionId !== 'string'
            || !/^[0-9a-f]{32}$/.test(context.connectionId)
            || typeof context.emit !== 'function') return false;
        let command;
        try {
            command = parseFuturesProductionExecutionCommand(raw, {
                allowedSymbols: policy?.allowedSymbols,
            });
        } catch {
            await appendAudit({
                eventType: 'received_command',
                category: 'command',
                outcome: 'rejected',
                state: 'rejected',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.COMMAND_REJECTED,
            }).catch(() => {});
            emitStatus(sessions.get(context.connectionId));
            return false;
        }
        const isSubscription = [
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS,
            FUTURES_PRODUCTION_EXECUTION_ACTIONS.UNSUBSCRIBE_STATUS,
        ].includes(command.action);
        const commandDigest = createFuturesProductionExecutionCommandDigest(command);
        await appendAudit({
            eventType: 'received_command',
            category: 'command',
            outcome: 'received',
            action: command.action,
            requestId: command.requestId ?? null,
            operationId: command.requestId ?? null,
            commandDigest,
            state: 'received',
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED,
        });
        if ((isSubscription && command.accountFingerprint !== BOOTSTRAP_FINGERPRINT)
            || (!isSubscription && command.accountFingerprint !== account?.fingerprint)) {
            await appendAudit({
                eventType: 'gate_decision',
                category: 'command',
                outcome: 'rejected',
                action: command.action,
                requestId: command.requestId ?? null,
                commandDigest,
                gate: 'accountFingerprint',
                state: 'rejected',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.COMMAND_REJECTED,
            });
            emitStatus(sessions.get(context.connectionId));
            return false;
        }

        if (command.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.SUBSCRIBE_STATUS) {
            const session = {
                connectionId: context.connectionId,
                emit: context.emit,
                subscribed: true,
            };
            sessions.set(context.connectionId, session);
            emitStatus(session);
            return true;
        }
        if (command.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.UNSUBSCRIBE_STATUS) {
            const session = sessions.get(context.connectionId);
            if (session) session.subscribed = false;
            return true;
        }
        const session = sessions.get(context.connectionId);
        if (!session?.subscribed) return rejectCommand({
            requestId: command.requestId,
            kind: PREPARE_KIND_BY_ACTION[command.action] ?? FINAL_KIND_BY_ACTION[command.action],
            code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.GATE_REJECTED,
        });
        if (command.action === FUTURES_PRODUCTION_EXECUTION_ACTIONS.REFRESH_PORTFOLIO) {
            await refreshPortfolio();
            advanceRevision();
            broadcastStatus();
            return true;
        }
        if (PREPARE_KIND_BY_ACTION[command.action]) return prepareIntent(command, context);
        return executeFinal(command, context);
    };

    const handleRequest = (raw, context = {}) => trackInFlight(
        handleRequestNow(raw, context),
    );

    const disconnect = (connectionId) => {
        const removed = sessions.delete(connectionId);
        if (activeIntent?.connectionId === connectionId) {
            const expired = activeIntent;
            activeIntent = null;
            const task = appendAudit({
                eventType: 'intent_expired',
                category: 'intent',
                outcome: 'expired',
                requestId: expired.requestId,
                operationId: expired.requestId,
                intentId: expired.requestId,
                state: 'expired',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.INTENT_EXPIRED,
            }).then(() => {
                advanceRevision();
                broadcastStatus();
            }).catch(() => {})
                .finally(() => backgroundTasks.delete(task));
            backgroundTasks.add(task);
        }
        return removed;
    };

    const authorizeRecovery = (authorization) => {
        const expected = config.recoveryAuthorization;
        if (typeof authorization !== 'string' || typeof expected !== 'string') return false;
        const left = Buffer.from(authorization, 'utf8');
        const right = Buffer.from(expected, 'utf8');
        return left.byteLength === right.byteLength && timingSafeEqual(left, right);
    };

    const recoverOperationallyNow = async ({ authorization, action } = {}) => {
        const authorized = authorizeRecovery(authorization);
        const recognized = OPERATIONAL_RECOVERY_ACTIONS.has(action);
        const safeAction = recognized
            ? `backend.futuresProduction.${action}`
            : 'backend.futuresProduction.invalidAction';
        const recoveryOperationId = createRequestId(randomBytes);
        if (!authorized || !recognized || mutex || shuttingDown || !storageHealthy
            || backgroundTasks.size > 0) {
            const code = !authorized || !recognized
                ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.COMMAND_REJECTED
                : !storageHealthy
                    ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.STORAGE_FAILED
                    : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.BUSY;
            if (storageHealthy && !shuttingDown) {
                await appendAudit({
                    eventType: 'operator_recovery',
                    category: 'recovery',
                    outcome: !authorized || !recognized ? 'rejected' : 'blocked',
                    operationId: recoveryOperationId,
                    action: safeAction,
                    state: 'blocked',
                    code,
                }).catch(() => {});
            }
            return false;
        }
        operationalRecoveryInProgress = true;
        mutex = true;
        broadcastStatus();
        try {
            await appendAudit({
                eventType: 'operator_recovery',
                category: 'recovery',
                outcome: 'pending',
                operationId: recoveryOperationId,
                action: safeAction,
                state: 'pending',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
            });
            if (action === 'reconcile') {
                recoveryHealthy = await recoverPersistedOperations({
                    allowDuringOperationalRecovery: true,
                });
                if (!recoveryHealthy) {
                    await appendAudit({
                        eventType: 'operator_recovery',
                        category: 'recovery',
                        outcome: 'blocked',
                        operationId: recoveryOperationId,
                        action: safeAction,
                        state: 'blocked',
                        code: recovery.code,
                    });
                    advanceRevision();
                    await refreshActivation({ audit: false });
                    return false;
                }
            } else {
                const engaged = action === 'engageKillSwitch';
                if (!engaged && (ledger.getActiveOperations?.().length > 0 || !recoveryHealthy)) {
                    await appendAudit({
                        eventType: 'operator_recovery',
                        category: 'recovery',
                        outcome: 'blocked',
                        operationId: recoveryOperationId,
                        action: safeAction,
                        state: 'blocked',
                        code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.RECOVERY_REQUIRED,
                    });
                    return false;
                }
                await ledger.setKillSwitch({
                    engaged,
                    action: safeAction,
                    code: engaged
                        ? FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.KILL_SWITCH_ENGAGED
                        : FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED,
                });
                killSwitchEngaged = engaged;
            }
            await appendAudit({
                eventType: 'operator_recovery',
                category: 'recovery',
                outcome: 'confirmed',
                operationId: recoveryOperationId,
                action: safeAction,
                state: 'confirmed',
                code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.ENABLED,
            });
            advanceRevision();
            await refreshActivation({ audit: false });
            return true;
        } catch (error) {
            reportInternal('operator-recovery', error);
            recoveryHealthy = false;
            recovery = {
                required: true,
                state: 'blocked',
                code: safeErrorCode(error),
            };
            await appendAudit({
                eventType: 'operator_recovery',
                category: 'recovery',
                outcome: 'failed',
                operationId: recoveryOperationId,
                action: safeAction,
                state: 'blocked',
                code: recovery.code,
            }).catch(() => {});
            advanceRevision();
            await refreshActivation({ audit: false }).catch(() => {});
            return false;
        } finally {
            operationalRecoveryInProgress = false;
            mutex = false;
            advanceRevision();
            broadcastStatus();
            resumeDeferredReconciliation();
        }
    };

    const recoverOperationally = options => trackInFlight(
        recoverOperationallyNow(options),
    );

    const shutdown = () => {
        if (shutdownCompletion) return shutdownCompletion;
        shutdownCompletion = (async () => {
            shuttingDown = true;
            deferredReconciliation = null;
            userDataStreamGeneration += 1;
            closeCurrentUserDataSocket();
            identityRetryTimer = null;
            portfolioRetryTimer = null;
            userDataKeepAliveTimer = null;
            userDataReconnectTimer = null;
            accountUpdateRefreshTimer = null;
            accountUpdateRefreshPending = false;
            accountUpdateNeedsConfigurationRefresh = false;
            for (const timer of timers) clearTimeoutFn(timer);
            timers.clear();
            while (inFlightOperations.size > 0) {
                await Promise.allSettled([...inFlightOperations]);
            }
            if (activeIntent) {
                const expired = activeIntent;
                activeIntent = null;
                await appendAudit({
                    eventType: 'intent_expired',
                    category: 'intent',
                    outcome: 'expired',
                    requestId: expired.requestId,
                    operationId: expired.requestId,
                    intentId: expired.requestId,
                    state: 'expired',
                    code: FUTURES_PRODUCTION_EXECUTION_SAFE_CODES.INTENT_EXPIRED,
                    safeDetail: 'service-shutdown',
                }).catch(() => {});
            }
            while (backgroundTasks.size > 0) {
                await Promise.allSettled([...backgroundTasks]);
            }
            if (userDataListenKey !== null
                && typeof facade?.closeUserDataStream === 'function') {
                await executeRead({
                    endpointId: ENDPOINT_IDS.userDataStreamClose,
                    weight: READ_WEIGHTS.userDataStreamClose,
                    operation: () => facade.closeUserDataStream(),
                }).catch(error => reportInternal('account-stream-close', error));
                userDataListenKey = null;
            }
            await transitionTail;
            sessions.clear();
            await ledger.close();
        })();
        return shutdownCompletion;
    };

    return Object.freeze({
        start,
        shutdown,
        disconnect,
        handleRequest,
        handleFrame: handleRequest,
        recoverOperationally,
        getStatus: () => statusFor(null),
        getCurrentAttempt: () => currentAttempt,
        getActiveOperation: () => activeOperation,
    });
};
