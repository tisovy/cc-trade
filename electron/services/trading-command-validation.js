import {
    CLIENT_ORDER_ID_MAX_LENGTH,
    CLIENT_ORDER_ID_PATTERN,
    DEFAULT_ACCOUNT_ID,
    DEFAULT_SPOT_ORDER_TYPE,
    DEFAULT_SPOT_TIME_IN_FORCE,
    FUTURES_HISTORY_READ_REASONS,
    FUTURES_HISTORY_VIEW_VALUES,
    FUTURES_LEVERAGE_LIMITS,
    FUTURES_MARGIN_TYPES,
    FUTURES_MARKET_TYPE,
    POSITION_MARGIN_DIRECTIONS,
    SPOT_MARKET_TYPE,
    TRADE_COMMAND_VERSION,
    TRADING_COMMAND_ACTIONS,
    isTypedTradingAction,
} from '../../src/utils/tradingCommands.js';
import {
    normalizeFuturesFeeValuationMinutes,
    normalizeFuturesFeeValuationPair,
} from './futures-fee-valuation.js';
import { normalizeFuturesTradeHistorySymbol } from '../../src/utils/futuresTradeHistoryEvidence.js';

const SUPPORTED_MARKET_TYPES = new Set([SPOT_MARKET_TYPE, FUTURES_MARKET_TYPE]);
const FUTURES_ORDER_TYPES = new Set(['LIMIT', 'MARKET']);
const FUTURES_POSITION_SIDES = new Set(['BOTH', 'LONG', 'SHORT']);
const POSITION_MARGIN_DIRECTION_VALUES = new Set(Object.values(POSITION_MARGIN_DIRECTIONS));
const FUTURES_MARGIN_TYPE_VALUES = new Set(FUTURES_MARGIN_TYPES);
const FUTURES_HISTORY_COVERAGE_LIMIT = 24;

const isCommandPayloadObject = (payload) => (
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload)
);

const normalizeTextField = (value) => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toString();
    }
    return null;
};

const normalizeSide = (value) => {
    const side = normalizeTextField(value)?.toUpperCase();
    return side === 'BUY' || side === 'SELL' ? side : null;
};

const normalizePositiveNumber = (value) => {
    if (typeof value !== 'number' && typeof value !== 'string') {
        return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
        return null;
    }
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
};

const hasUsableValue = (value) => {
    if (value === null || value === undefined) return false;
    return typeof value !== 'string' || value.trim() !== '';
};

const firstUsableValue = (...values) => values.find(hasUsableValue);

const normalizeOrderId = (value) => {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value > 0 ? value : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return /^[1-9]\d*$/.test(trimmed) ? trimmed : null;
    }
    return null;
};

const normalizeFuturesHistoryCursor = (value) => {
    const cursor = typeof value === 'string' ? value.trim() : '';
    return /^\d{1,20}$/.test(cursor) ? cursor : null;
};

const normalizeFuturesHistoryTime = (value) => (
    Number.isSafeInteger(value) && value >= 0 ? value : null
);

const normalizeFuturesTradeCoverage = (value) => {
    if (!isCommandPayloadObject(value) || value.version !== 2) return null;
    const targetFrom = normalizeFuturesHistoryTime(value.targetFrom);
    const targetTo = normalizeFuturesHistoryTime(value.targetTo);
    const coveredFrom = normalizeFuturesHistoryTime(value.coveredFrom);
    const coveredTo = normalizeFuturesHistoryTime(value.coveredTo);
    return Object.freeze({
        version: 2,
        targetFrom,
        targetTo,
        coveredFrom,
        coveredTo,
        complete: value.complete === true
            && targetFrom !== null
            && targetTo !== null
            && coveredFrom !== null
            && coveredTo !== null
            && coveredFrom <= targetFrom
            && coveredTo >= targetTo,
        pageLimited: value.pageLimited === true,
        retentionLimited: value.retentionLimited === true,
        continuityComplete: value.continuityComplete === true,
    });
};

const normalizeFuturesHistoryCoverage = (value) => {
    if (!isCommandPayloadObject(value)) return Object.freeze({});
    const entries = [];
    for (const [rawSymbol, rawCoverage] of Object.entries(value)) {
        if (entries.length >= FUTURES_HISTORY_COVERAGE_LIMIT) break;
        // The coverage the renderer already holds is keyed by the exchange's
        // own spelling — a narrower alphabet here silently discarded 龙虾USDT's
        // entry and made every history command re-read the pair from scratch.
        const symbol = normalizeFuturesTradeHistorySymbol(rawSymbol);
        if (!symbol) continue;
        if (!isCommandPayloadObject(rawCoverage)) continue;
        if (!Number.isSafeInteger(rawCoverage.readAt) || rawCoverage.readAt < 0) continue;
        const tradeCoverage = normalizeFuturesTradeCoverage(rawCoverage.tradeCoverage);
        entries.push([symbol, Object.freeze({
            readAt: rawCoverage.readAt,
            orderCursor: normalizeFuturesHistoryCursor(rawCoverage.orderCursor),
            tradeCursor: normalizeFuturesHistoryCursor(rawCoverage.tradeCursor),
            ...(tradeCoverage === null ? {} : { tradeCoverage }),
        })]);
    }
    return Object.freeze(Object.fromEntries(entries));
};

// Which endpoints the read is for. `null` is "the caller did not say", which is
// read as both — an unrecognised name is dropped rather than refused, so a
// renderer asking for something this desk does not have still gets its review.
const normalizeFuturesHistoryViews = (value) => {
    if (!Array.isArray(value)) return null;
    const views = FUTURES_HISTORY_VIEW_VALUES.filter(view => value.includes(view));
    return views.length > 0 ? Object.freeze(views) : null;
};

export const createCommandRejection = (request, code, message, details = {}) => ({
    command_rejected: {
        request,
        code,
        message,
        details,
        timestamp: Date.now(),
    },
});

const createTypedCommandRejection = (payload, code, message, details = {}) => {
    const request = isCommandPayloadObject(payload) && normalizeTextField(payload.action)
        ? normalizeTextField(payload.action)
        : 'trade.command';
    return createCommandRejection(request, code, message, details);
};

const validateTypedCommandBase = (payload) => {
    if (!isCommandPayloadObject(payload)) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_COMMAND_PAYLOAD',
                'typed trading command must be an object',
                { field: 'data' },
            ),
        };
    }

    const action = normalizeTextField(payload.action);
    if (!isTypedTradingAction(action)) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'UNSUPPORTED_TYPED_COMMAND_ACTION',
                'typed trading command action is not supported',
                { field: 'action', value: payload.action },
            ),
        };
    }

    if (payload.version !== TRADE_COMMAND_VERSION) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_COMMAND_VERSION',
                `typed trading command version must be ${TRADE_COMMAND_VERSION}`,
                { field: 'version', value: payload.version },
            ),
        };
    }

    const marketType = normalizeTextField(payload.marketType) || SPOT_MARKET_TYPE;
    if (!SUPPORTED_MARKET_TYPES.has(marketType)) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'UNSUPPORTED_MARKET_TYPE',
                'only spot and futures typed trading commands are enabled',
                { field: 'marketType', value: payload.marketType },
            ),
        };
    }

    // The exchange refuses a client order id longer than 36 characters or built
    // from characters outside its alphabet. Refusing it here means a malformed
    // id is a local rejection with a named field, not an order the operator
    // watches Binance reject.
    const clientOrderId = normalizeTextField(payload.clientOrderId);
    if (clientOrderId !== null && !CLIENT_ORDER_ID_PATTERN.test(clientOrderId)) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_CLIENT_ORDER_ID',
                `clientOrderId must be at most ${CLIENT_ORDER_ID_MAX_LENGTH} characters from [.A-Za-z0-9:/_-]`,
                { field: 'clientOrderId', length: clientOrderId.length },
            ),
        };
    }

    return {
        ok: true,
        command: {
            action,
            version: TRADE_COMMAND_VERSION,
            marketType,
            accountId: normalizeTextField(payload.accountId) || DEFAULT_ACCOUNT_ID,
            clientOrderId,
        },
    };
};

const validateTypedPlaceOrderCommand = (payload, baseCommand, { selectedSymbol } = {}) => {
    const symbol = normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol);
    if (!symbol) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_ORDER_SYMBOL',
                'trade.placeOrder requires a symbol',
                { field: 'symbol' },
            ),
        };
    }

    const side = normalizeSide(payload.side);
    if (!side) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_ORDER_SIDE',
                'trade.placeOrder side must be BUY or SELL',
                { field: 'side', value: payload.side },
            ),
        };
    }

    const isFutures = baseCommand.marketType === FUTURES_MARKET_TYPE;
    const orderType = normalizeTextField(payload.orderType)?.toUpperCase() || DEFAULT_SPOT_ORDER_TYPE;
    if (isFutures ? !FUTURES_ORDER_TYPES.has(orderType) : orderType !== DEFAULT_SPOT_ORDER_TYPE) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'UNSUPPORTED_TYPED_ORDER_TYPE',
                isFutures
                    ? 'only LIMIT and MARKET typed futures orders are enabled'
                    : 'only LIMIT typed spot orders are enabled',
                { field: 'orderType', value: payload.orderType },
            ),
        };
    }

    const timeInForce = normalizeTextField(payload.timeInForce)?.toUpperCase() || DEFAULT_SPOT_TIME_IN_FORCE;
    if (orderType === 'LIMIT' && timeInForce !== DEFAULT_SPOT_TIME_IN_FORCE) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'UNSUPPORTED_TYPED_TIME_IN_FORCE',
                'only GTC typed limit orders are enabled',
                { field: 'timeInForce', value: payload.timeInForce },
            ),
        };
    }

    const positionSide = normalizeTextField(payload.positionSide)?.toUpperCase() ?? null;
    if (isFutures && positionSide !== null && !FUTURES_POSITION_SIDES.has(positionSide)) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_ORDER_POSITION_SIDE',
                'trade.placeOrder positionSide must be BOTH, LONG, or SHORT',
                { field: 'positionSide', value: payload.positionSide },
            ),
        };
    }
    if (isFutures && payload.reduceOnly !== undefined && typeof payload.reduceOnly !== 'boolean') {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_ORDER_REDUCE_ONLY',
                'trade.placeOrder reduceOnly must be a boolean',
                { field: 'reduceOnly', value: payload.reduceOnly },
            ),
        };
    }

    const quantityValue = payload.quantity ?? payload.qty;
    const numericQuantity = normalizePositiveNumber(quantityValue);
    if (numericQuantity === null) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_ORDER_QUANTITY',
                'trade.placeOrder quantity must be a positive finite number',
                { field: payload.quantity === undefined ? 'qty' : 'quantity', value: quantityValue },
            ),
        };
    }

    const priceValue = payload.price ?? payload.p;
    const numericPrice = normalizePositiveNumber(priceValue);
    if (numericPrice === null && !(isFutures && orderType === 'MARKET')) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_ORDER_PRICE',
                'trade.placeOrder price must be a positive finite number',
                { field: payload.price === undefined ? 'p' : 'price', value: priceValue },
            ),
        };
    }

    return {
        ok: true,
        command: {
            ...baseCommand,
            symbol,
            side,
            orderType,
            timeInForce,
            quantityValue,
            priceValue,
            numericQuantity,
            numericPrice,
            requestType: side === 'SELL' ? 'sellOrder' : 'buyOrder',
            orderPayload: {
                symbol,
                side,
                quantity: quantityValue,
                price: priceValue,
                newClientOrderId: baseCommand.clientOrderId ?? undefined,
            },
            ...(isFutures ? {
                futuresOrderPayload: {
                    symbol,
                    side,
                    orderType,
                    timeInForce,
                    numericQuantity,
                    numericPrice,
                    positionSide,
                    reduceOnly: payload.reduceOnly === true,
                    newClientOrderId: baseCommand.clientOrderId ?? undefined,
                },
            } : {}),
        },
    };
};

const validateTypedCancelOrderCommand = (payload, baseCommand, { selectedSymbol } = {}) => {
    const symbol = normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol);
    if (!symbol) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_CANCEL_SYMBOL',
                'trade.cancelOrder requires a symbol',
                { field: 'symbol' },
            ),
        };
    }

    const rawOrderId = firstUsableValue(payload.orderId, payload.id);
    const rawOrigClientOrderId = firstUsableValue(payload.origClientOrderId);
    const orderId = rawOrderId === undefined ? null : normalizeOrderId(rawOrderId);
    const origClientOrderId = rawOrigClientOrderId === undefined ? null : normalizeTextField(rawOrigClientOrderId);
    if (rawOrderId !== undefined && orderId === null) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_CANCEL_ORDER_ID',
                'trade.cancelOrder orderId must be a positive integer',
                { field: payload.orderId === undefined ? 'id' : 'orderId', value: rawOrderId },
            ),
        };
    }
    if (!orderId && !origClientOrderId) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_CANCEL_TARGET',
                'trade.cancelOrder requires orderId or origClientOrderId',
                { fields: ['orderId', 'id', 'origClientOrderId'] },
            ),
        };
    }

    const newClientOrderId = hasUsableValue(payload.newClientOrderId)
        ? normalizeTextField(payload.newClientOrderId)
        : null;
    if (hasUsableValue(payload.newClientOrderId) && !newClientOrderId) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_CANCEL_NEW_CLIENT_ORDER_ID',
                'trade.cancelOrder newClientOrderId must be a non-empty string',
                { field: 'newClientOrderId', value: payload.newClientOrderId },
            ),
        };
    }

    return {
        ok: true,
        command: {
            ...baseCommand,
            symbol,
            orderId,
            origClientOrderId,
            newClientOrderId,
            cancelPayload: {
                symbol,
                orderId,
                origClientOrderId,
                newClientOrderId,
            },
        },
    };
};

// trade.replaceOrder is enabled for futures only: Binance USDⓈ-M exposes a native
// amendment, so a reprice never has to pass through a cancel that could succeed
// while the replacement fails.
const validateTypedFuturesModifyOrderCommand = (payload, baseCommand, { selectedSymbol } = {}) => {
    const symbol = normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol);
    if (!symbol) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MODIFY_SYMBOL',
                'trade.replaceOrder requires a symbol',
                { field: 'symbol' },
            ),
        };
    }

    const side = normalizeSide(payload.side);
    if (!side) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MODIFY_SIDE',
                'trade.replaceOrder side must be BUY or SELL',
                { field: 'side', value: payload.side },
            ),
        };
    }

    const rawOrderId = firstUsableValue(payload.orderId, payload.id);
    const rawOrigClientOrderId = firstUsableValue(payload.origClientOrderId);
    const orderId = rawOrderId === undefined ? null : normalizeOrderId(rawOrderId);
    const origClientOrderId = rawOrigClientOrderId === undefined
        ? null
        : normalizeTextField(rawOrigClientOrderId);
    if (rawOrderId !== undefined && orderId === null) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MODIFY_ORDER_ID',
                'trade.replaceOrder orderId must be a positive integer',
                { field: payload.orderId === undefined ? 'id' : 'orderId', value: rawOrderId },
            ),
        };
    }
    if (!orderId && !origClientOrderId) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MODIFY_TARGET',
                'trade.replaceOrder requires orderId or origClientOrderId',
                { fields: ['orderId', 'id', 'origClientOrderId'] },
            ),
        };
    }

    const quantityValue = payload.quantity ?? payload.qty;
    const numericQuantity = normalizePositiveNumber(quantityValue);
    if (numericQuantity === null) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MODIFY_QUANTITY',
                'trade.replaceOrder quantity must be a positive finite number',
                { field: payload.quantity === undefined ? 'qty' : 'quantity', value: quantityValue },
            ),
        };
    }

    const priceValue = payload.price ?? payload.p;
    const numericPrice = normalizePositiveNumber(priceValue);
    if (numericPrice === null) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MODIFY_PRICE',
                'trade.replaceOrder price must be a positive finite number',
                { field: payload.price === undefined ? 'p' : 'price', value: priceValue },
            ),
        };
    }

    return {
        ok: true,
        command: {
            ...baseCommand,
            symbol,
            side,
            orderId,
            origClientOrderId,
            quantityValue,
            priceValue,
            numericQuantity,
            numericPrice,
            futuresModifyPayload: {
                symbol,
                side,
                orderId,
                origClientOrderId,
                quantity: quantityValue,
                price: priceValue,
                numericQuantity,
                numericPrice,
            },
        },
    };
};

// Moving margin names one position and no other. Unlike every other command
// here, the symbol has no fallback to the selected contract: a margin transfer
// whose symbol went missing would otherwise land on whichever position the
// operator happened to be watching, which is not the one they clicked.
const validateTypedAdjustPositionMarginCommand = (payload, baseCommand) => {
    const symbol = normalizeTextField(payload.symbol);
    if (!symbol) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MARGIN_SYMBOL',
                'trade.adjustPositionMargin requires the symbol of the position',
                { field: 'symbol' },
            ),
        };
    }

    const positionSide = normalizeTextField(payload.positionSide)?.toUpperCase() ?? 'BOTH';
    if (!FUTURES_POSITION_SIDES.has(positionSide)) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MARGIN_POSITION_SIDE',
                'trade.adjustPositionMargin positionSide must be BOTH, LONG, or SHORT',
                { field: 'positionSide', value: payload.positionSide },
            ),
        };
    }

    const direction = normalizeTextField(payload.direction)?.toUpperCase() ?? null;
    if (direction === null || !POSITION_MARGIN_DIRECTION_VALUES.has(direction)) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MARGIN_DIRECTION',
                'trade.adjustPositionMargin direction must be ADD or REMOVE',
                { field: 'direction', value: payload.direction },
            ),
        };
    }

    const amount = normalizePositiveNumber(payload.amount);
    if (amount === null) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MARGIN_AMOUNT',
                'trade.adjustPositionMargin amount must be a positive number',
                { field: 'amount', value: payload.amount },
            ),
        };
    }

    return {
        ok: true,
        command: {
            ...baseCommand,
            symbol: symbol.toUpperCase(),
            marginPayload: {
                symbol: symbol.toUpperCase(),
                positionSide,
                direction,
                amount: String(amount),
            },
        },
    };
};

// Setting leverage names one contract and one whole number. The symbol has no
// fallback to the selected contract for the same reason a margin transfer has
// none: leverage applied to the wrong contract reprices every position on it.
const validateTypedSetLeverageCommand = (payload, baseCommand) => {
    const symbol = normalizeTextField(payload.symbol);
    if (!symbol) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_LEVERAGE_SYMBOL',
                'trade.setLeverage requires the symbol of the contract',
                { field: 'symbol' },
            ),
        };
    }

    // Leverage is a whole multiple, and the exchange refuses anything else. A
    // fractional or out-of-range value is refused here rather than spending a
    // signed request to be told so.
    const leverage = Number(payload.leverage);
    if (!Number.isSafeInteger(leverage)
        || leverage < FUTURES_LEVERAGE_LIMITS.min
        || leverage > FUTURES_LEVERAGE_LIMITS.max) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_LEVERAGE_VALUE',
                `trade.setLeverage leverage must be a whole number between ${FUTURES_LEVERAGE_LIMITS.min} and ${FUTURES_LEVERAGE_LIMITS.max}`,
                { field: 'leverage', value: payload.leverage },
            ),
        };
    }

    return {
        ok: true,
        command: {
            ...baseCommand,
            symbol: symbol.toUpperCase(),
            leveragePayload: { symbol: symbol.toUpperCase(), leverage },
        },
    };
};

// The margin mode names its contract on the same terms as the leverage: it
// decides whether a losing position is capped at its own margin or stands
// behind the whole wallet, so it may not fall back to the contract on screen.
const validateTypedSetMarginTypeCommand = (payload, baseCommand) => {
    const symbol = normalizeTextField(payload.symbol);
    if (!symbol) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MARGIN_TYPE_SYMBOL',
                'trade.setMarginType requires the symbol of the contract',
                { field: 'symbol' },
            ),
        };
    }

    const marginType = (normalizeTextField(payload.marginType) || '').toUpperCase();
    if (!FUTURES_MARGIN_TYPE_VALUES.has(marginType)) {
        return {
            ok: false,
            rejection: createTypedCommandRejection(
                payload,
                'INVALID_TYPED_MARGIN_TYPE_VALUE',
                `trade.setMarginType marginType must be one of ${FUTURES_MARGIN_TYPES.join(', ')}`,
                { field: 'marginType', value: payload.marginType },
            ),
        };
    }

    return {
        ok: true,
        command: {
            ...baseCommand,
            symbol: symbol.toUpperCase(),
            marginTypePayload: { symbol: symbol.toUpperCase(), marginType },
        },
    };
};

const rejectDefinedButDisabledCommand = (payload, baseCommand) => ({
    ok: false,
    rejection: createTypedCommandRejection(
        payload,
        'TYPED_COMMAND_NOT_ENABLED',
        `${baseCommand.action} is defined but not enabled yet`,
        { action: baseCommand.action },
    ),
});

const rejectUnsupportedLegacyMarket = (payload, requestType, declaredMarketType) => {
    const marketDeclarations = [
        { field: 'marketType', value: payload.marketType },
        { field: 'envelope.marketType', value: declaredMarketType },
    ].filter(({ value }) => value !== undefined);
    const unsupported = marketDeclarations.find(({ value }) => (
        (normalizeTextField(value) || SPOT_MARKET_TYPE) !== SPOT_MARKET_TYPE
    ));
    if (!unsupported) return null;
    return {
        ok: false,
        rejection: createCommandRejection(
            requestType,
            'UNSUPPORTED_MARKET_TYPE',
            'only spot legacy trading commands are enabled',
            unsupported,
        ),
    };
};

export const validateTypedTradingCommand = (payload, { selectedSymbol } = {}) => {
    const baseValidation = validateTypedCommandBase(payload);
    if (!baseValidation.ok) return baseValidation;

    const baseCommand = baseValidation.command;
    switch (baseCommand.action) {
        case TRADING_COMMAND_ACTIONS.PLACE_ORDER:
            return validateTypedPlaceOrderCommand(payload, baseCommand, { selectedSymbol });
        case TRADING_COMMAND_ACTIONS.CANCEL_ORDER:
            return validateTypedCancelOrderCommand(payload, baseCommand, { selectedSymbol });
        case TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH:
            return {
                ok: true,
                command: {
                    ...baseCommand,
                    symbol: normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol),
                    // Whether a timer asked or a person did. Only ever true when
                    // the caller says so: an ask that lost the marking is read
                    // as a person, which costs a read rather than a stale figure.
                    periodic: payload.periodic === true,
                    // Only the renderer's operator-facing Futures button may
                    // request the compound receipt. Startup and background
                    // account reads deliberately omit this intent bit.
                    ...(baseCommand.marketType === FUTURES_MARKET_TYPE
                        && payload.manual === true
                        ? { manual: true }
                        : {}),
                },
            };
        case TRADING_COMMAND_ACTIONS.CANCEL_ALL: {
            if (baseCommand.marketType !== FUTURES_MARKET_TYPE) {
                return rejectDefinedButDisabledCommand(payload, baseCommand);
            }
            const symbol = normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol);
            if (!symbol) {
                return {
                    ok: false,
                    rejection: createTypedCommandRejection(
                        payload,
                        'INVALID_TYPED_CANCEL_ALL_SYMBOL',
                        'trade.cancelAll requires a symbol',
                        { field: 'symbol' },
                    ),
                };
            }
            return { ok: true, command: { ...baseCommand, symbol } };
        }
        case TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY: {
            if (baseCommand.marketType !== FUTURES_MARKET_TYPE) {
                return rejectDefinedButDisabledCommand(payload, baseCommand);
            }
            const symbol = normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol);
            if (!symbol) {
                return {
                    ok: false,
                    rejection: createTypedCommandRejection(
                        payload,
                        'INVALID_TYPED_HISTORY_SYMBOL',
                        'account.history requires a symbol',
                        { field: 'symbol' },
                    ),
                };
            }
            const coverage = normalizeFuturesHistoryCoverage(payload.coverage);
            const views = normalizeFuturesHistoryViews(payload.views);
            return {
                ok: true,
                command: {
                    ...baseCommand,
                    symbol,
                    ...(payload.basisOnly === true ? { basisOnly: true } : {}),
                    ...(Object.keys(coverage).length > 0 ? { coverage } : {}),
                    ...(payload.full === true ? { full: true } : {}),
                    // Carried only from the closed set; anything else is a
                    // read that did not say, and is recorded as such.
                    ...(FUTURES_HISTORY_READ_REASONS.includes(payload.reason)
                        ? { reason: payload.reason }
                        : {}),
                    ...(views === null ? {} : { views }),
                },
            };
        }
        case TRADING_COMMAND_ACTIONS.ACCOUNT_FEE_VALUATION: {
            if (baseCommand.marketType !== FUTURES_MARKET_TYPE) {
                return rejectDefinedButDisabledCommand(payload, baseCommand);
            }
            // The pair and the minutes are re-bounded by the price source; this
            // boundary refuses shapes, not budgets, so a malformed ask never
            // reaches the code that spends weight.
            const pair = normalizeFuturesFeeValuationPair(payload.pair);
            if (pair === null) {
                return {
                    ok: false,
                    rejection: createTypedCommandRejection(
                        payload,
                        'INVALID_TYPED_FEE_VALUATION_PAIR',
                        'account.feeValuation requires a canonical pair symbol',
                        { field: 'pair', value: payload.pair },
                    ),
                };
            }
            const minutes = normalizeFuturesFeeValuationMinutes(payload.minutes);
            if (minutes.length === 0) {
                return {
                    ok: false,
                    rejection: createTypedCommandRejection(
                        payload,
                        'INVALID_TYPED_FEE_VALUATION_MINUTES',
                        'account.feeValuation requires at least one valid minute',
                        { field: 'minutes' },
                    ),
                };
            }
            return { ok: true, command: { ...baseCommand, pair, minutes } };
        }
        case TRADING_COMMAND_ACTIONS.SET_TRADING_PAUSED: {
            if (baseCommand.marketType !== FUTURES_MARKET_TYPE) {
                return rejectDefinedButDisabledCommand(payload, baseCommand);
            }
            if (typeof payload.paused !== 'boolean') {
                return {
                    ok: false,
                    rejection: createTypedCommandRejection(
                        payload,
                        'INVALID_TYPED_PAUSE_FLAG',
                        'trade.setTradingPaused paused must be a boolean',
                        { field: 'paused', value: payload.paused },
                    ),
                };
            }
            return { ok: true, command: { ...baseCommand, paused: payload.paused } };
        }
        case TRADING_COMMAND_ACTIONS.ACCOUNT_SYMBOL_CONFIG: {
            if (baseCommand.marketType !== FUTURES_MARKET_TYPE) {
                return rejectDefinedButDisabledCommand(payload, baseCommand);
            }
            const symbol = normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol);
            if (!symbol) {
                return {
                    ok: false,
                    rejection: createTypedCommandRejection(
                        payload,
                        'INVALID_TYPED_SYMBOL_CONFIG_SYMBOL',
                        'account.symbolConfig requires a symbol',
                        { field: 'symbol' },
                    ),
                };
            }
            return { ok: true, command: { ...baseCommand, symbol: symbol.toUpperCase() } };
        }
        case TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN:
            if (baseCommand.marketType !== FUTURES_MARKET_TYPE) {
                return rejectDefinedButDisabledCommand(payload, baseCommand);
            }
            return validateTypedAdjustPositionMarginCommand(payload, baseCommand);
        case TRADING_COMMAND_ACTIONS.SET_LEVERAGE:
            if (baseCommand.marketType !== FUTURES_MARKET_TYPE) {
                return rejectDefinedButDisabledCommand(payload, baseCommand);
            }
            return validateTypedSetLeverageCommand(payload, baseCommand);
        case TRADING_COMMAND_ACTIONS.SET_MARGIN_TYPE:
            if (baseCommand.marketType !== FUTURES_MARKET_TYPE) {
                return rejectDefinedButDisabledCommand(payload, baseCommand);
            }
            return validateTypedSetMarginTypeCommand(payload, baseCommand);
        case TRADING_COMMAND_ACTIONS.REPLACE_ORDER:
            if (baseCommand.marketType !== FUTURES_MARKET_TYPE) {
                return rejectDefinedButDisabledCommand(payload, baseCommand);
            }
            return validateTypedFuturesModifyOrderCommand(payload, baseCommand, { selectedSymbol });
        default:
            return {
                ok: false,
                rejection: createTypedCommandRejection(
                    payload,
                    'UNSUPPORTED_TYPED_COMMAND_ACTION',
                    'typed trading command action is not supported',
                    { field: 'action', value: payload.action },
                ),
            };
    }
};

export const validateLegacyOrderCommand = (
    payload,
    { requestType = 'buyOrder', selectedSymbol, declaredMarketType } = {},
) => {
    if (!isCommandPayloadObject(payload)) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_PAYLOAD',
                `${requestType} payload must be an object`,
                { field: 'data' },
            ),
        };
    }

    const marketRejection = rejectUnsupportedLegacyMarket(
        payload,
        requestType,
        declaredMarketType,
    );
    if (marketRejection) return marketRejection;

    const symbol = normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol);
    if (!symbol) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_SYMBOL',
                `${requestType} requires a symbol`,
                { field: 'symbol' },
            ),
        };
    }

    const defaultSide = requestType === 'sellOrder' ? 'SELL' : 'BUY';
    const sideSource = hasUsableValue(payload.side) ? payload.side : defaultSide;
    const side = normalizeSide(sideSource);
    if (!side) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_SIDE',
                `${requestType} side must be BUY or SELL`,
                { field: 'side', value: payload.side },
            ),
        };
    }

    const quantityValue = payload.quantity ?? payload.qty;
    const numericQuantity = normalizePositiveNumber(quantityValue);
    if (numericQuantity === null) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_QUANTITY',
                `${requestType} quantity must be a positive finite number`,
                { field: payload.quantity === undefined ? 'qty' : 'quantity', value: quantityValue },
            ),
        };
    }

    const priceValue = payload.price ?? payload.p;
    const numericPrice = normalizePositiveNumber(priceValue);
    if (numericPrice === null) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_PRICE',
                `${requestType} price must be a positive finite number`,
                { field: payload.price === undefined ? 'p' : 'price', value: priceValue },
            ),
        };
    }

    // Carried through so Spot placement can send the identity the operator's
    // intent was minted with, exactly as Futures already does. Without it the
    // exchange cannot deduplicate a resubmission of the same intent.
    const newClientOrderId = normalizeTextField(payload.newClientOrderId);
    if (newClientOrderId !== null && !CLIENT_ORDER_ID_PATTERN.test(newClientOrderId)) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_ORDER_CLIENT_ID',
                `newClientOrderId must be at most ${CLIENT_ORDER_ID_MAX_LENGTH} characters from [.A-Za-z0-9:/_-]`,
                { field: 'newClientOrderId', length: newClientOrderId.length },
            ),
        };
    }

    return {
        ok: true,
        command: {
            symbol,
            side,
            quantityValue,
            priceValue,
            numericQuantity,
            numericPrice,
            newClientOrderId,
        },
    };
};

export const validateLegacyCancelCommand = (
    payload,
    { selectedSymbol, declaredMarketType } = {},
) => {
    const requestType = 'cancelOrder';
    if (!isCommandPayloadObject(payload)) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_CANCEL_PAYLOAD',
                'cancelOrder payload must be an object',
                { field: 'data' },
            ),
        };
    }

    const marketRejection = rejectUnsupportedLegacyMarket(
        payload,
        requestType,
        declaredMarketType,
    );
    if (marketRejection) return marketRejection;

    const symbol = normalizeTextField(payload.symbol) || normalizeTextField(selectedSymbol);
    if (!symbol) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_CANCEL_SYMBOL',
                'cancelOrder requires a symbol',
                { field: 'symbol' },
            ),
        };
    }

    const rawOrderId = firstUsableValue(payload.orderId, payload.id);
    const rawOrigClientOrderId = firstUsableValue(payload.origClientOrderId, payload.clientOrderId);
    const orderId = rawOrderId === undefined ? null : normalizeOrderId(rawOrderId);
    const origClientOrderId = rawOrigClientOrderId === undefined ? null : normalizeTextField(rawOrigClientOrderId);
    if (rawOrderId !== undefined && orderId === null) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_CANCEL_ORDER_ID',
                'cancelOrder orderId must be a positive integer',
                { field: payload.orderId === undefined ? 'id' : 'orderId', value: rawOrderId },
            ),
        };
    }
    if (!orderId && !origClientOrderId) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_CANCEL_TARGET',
                'cancelOrder requires orderId or origClientOrderId',
                { fields: ['orderId', 'id', 'origClientOrderId', 'clientOrderId'] },
            ),
        };
    }

    const newClientOrderId = hasUsableValue(payload.newClientOrderId)
        ? normalizeTextField(payload.newClientOrderId)
        : null;
    if (hasUsableValue(payload.newClientOrderId) && !newClientOrderId) {
        return {
            ok: false,
            rejection: createCommandRejection(
                requestType,
                'INVALID_CANCEL_NEW_CLIENT_ORDER_ID',
                'cancelOrder newClientOrderId must be a non-empty string',
                { field: 'newClientOrderId', value: payload.newClientOrderId },
            ),
        };
    }

    return {
        ok: true,
        command: {
            symbol,
            orderId,
            origClientOrderId,
            newClientOrderId,
        },
    };
};
