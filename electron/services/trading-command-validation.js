import {
    DEFAULT_ACCOUNT_ID,
    DEFAULT_SPOT_ORDER_TYPE,
    DEFAULT_SPOT_TIME_IN_FORCE,
    FUTURES_MARKET_TYPE,
    SPOT_MARKET_TYPE,
    TRADE_COMMAND_VERSION,
    TRADING_COMMAND_ACTIONS,
    isTypedTradingAction,
} from '../../src/utils/tradingCommands.js';

const SUPPORTED_MARKET_TYPES = new Set([SPOT_MARKET_TYPE, FUTURES_MARKET_TYPE]);
const FUTURES_ORDER_TYPES = new Set(['LIMIT', 'MARKET']);
const FUTURES_POSITION_SIDES = new Set(['BOTH', 'LONG', 'SHORT']);

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

    return {
        ok: true,
        command: {
            action,
            version: TRADE_COMMAND_VERSION,
            marketType,
            accountId: normalizeTextField(payload.accountId) || DEFAULT_ACCOUNT_ID,
            clientOrderId: normalizeTextField(payload.clientOrderId),
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
        case TRADING_COMMAND_ACTIONS.REPLACE_ORDER:
            return rejectDefinedButDisabledCommand(payload, baseCommand);
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

    return {
        ok: true,
        command: {
            symbol,
            side,
            quantityValue,
            priceValue,
            numericQuantity,
            numericPrice,
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
