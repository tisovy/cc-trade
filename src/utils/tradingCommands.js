export const TRADE_COMMAND_VERSION = 1;
export const DEFAULT_ACCOUNT_ID = 'default';
export const SPOT_MARKET_TYPE = 'spot';
export const FUTURES_MARKET_TYPE = 'futures';

export const TRADING_COMMAND_ACTIONS = Object.freeze({
    PLACE_ORDER: 'trade.placeOrder',
    CANCEL_ORDER: 'trade.cancelOrder',
    REPLACE_ORDER: 'trade.replaceOrder',
    CANCEL_ALL: 'trade.cancelAll',
    ACCOUNT_REFRESH: 'account.refresh',
    SET_TRADING_PAUSED: 'trade.setTradingPaused',
});

export const DEFAULT_SPOT_ORDER_TYPE = 'LIMIT';
export const DEFAULT_SPOT_TIME_IN_FORCE = 'GTC';

const compactObject = (value) => Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null)
);

const toOptionalString = (value) => (
    value === undefined || value === null ? undefined : value.toString()
);

const createClientOrderId = ({ marketType = SPOT_MARKET_TYPE, symbol = 'UNKNOWN', side = 'NA' } = {}) => {
    const timestamp = Date.now().toString(36);
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${marketType}-${symbol}-${side}-${timestamp}-${suffix}`;
};

const buildBaseCommand = ({
    action,
    marketType = SPOT_MARKET_TYPE,
    accountId = DEFAULT_ACCOUNT_ID,
    clientOrderId,
    symbol,
    side,
} = {}) => compactObject({
    action,
    version: TRADE_COMMAND_VERSION,
    marketType,
    accountId,
    clientOrderId: clientOrderId || createClientOrderId({ marketType, symbol, side }),
});

export const createSpotPlaceOrderCommand = ({
    accountId,
    clientOrderId,
    symbol,
    side,
    orderType = DEFAULT_SPOT_ORDER_TYPE,
    timeInForce = DEFAULT_SPOT_TIME_IN_FORCE,
    price,
    quantity,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
        accountId,
        clientOrderId,
        symbol,
        side,
    }),
    symbol,
    side,
    orderType,
    timeInForce,
    price: toOptionalString(price),
    quantity: toOptionalString(quantity),
});

export const createSpotCancelOrderCommand = ({
    accountId,
    clientOrderId,
    symbol,
    orderId,
    origClientOrderId,
    newClientOrderId,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
        accountId,
        clientOrderId,
        symbol,
    }),
    symbol,
    ...compactObject({
        orderId,
        origClientOrderId,
        newClientOrderId,
    }),
});

export const createSpotReplaceOrderCommand = ({
    accountId,
    clientOrderId,
    symbol,
    orderId,
    origClientOrderId,
    side,
    orderType = DEFAULT_SPOT_ORDER_TYPE,
    timeInForce = DEFAULT_SPOT_TIME_IN_FORCE,
    price,
    quantity,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
        accountId,
        clientOrderId,
        symbol,
        side,
    }),
    symbol,
    side,
    orderType,
    timeInForce,
    price: toOptionalString(price),
    quantity: toOptionalString(quantity),
    ...compactObject({
        orderId,
        origClientOrderId,
    }),
});

export const createSpotCancelAllCommand = ({
    accountId,
    clientOrderId,
    symbol,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.CANCEL_ALL,
        accountId,
        clientOrderId,
        symbol,
    }),
    symbol,
});

export const createAccountRefreshCommand = ({
    accountId,
    clientOrderId,
    marketType = SPOT_MARKET_TYPE,
    symbol,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH,
        marketType,
        accountId,
        clientOrderId,
        symbol,
    }),
    ...compactObject({ symbol }),
});

export const createFuturesPlaceOrderCommand = ({
    accountId,
    clientOrderId,
    symbol,
    side,
    orderType = DEFAULT_SPOT_ORDER_TYPE,
    timeInForce = DEFAULT_SPOT_TIME_IN_FORCE,
    price,
    quantity,
    positionSide,
    reduceOnly,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.PLACE_ORDER,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
        symbol,
        side,
    }),
    symbol,
    side,
    orderType,
    ...(orderType === 'LIMIT' ? { timeInForce, price: toOptionalString(price) } : {}),
    quantity: toOptionalString(quantity),
    ...compactObject({ positionSide }),
    ...(reduceOnly === true ? { reduceOnly: true } : {}),
});

export const createFuturesCancelOrderCommand = ({
    accountId,
    clientOrderId,
    symbol,
    orderId,
    origClientOrderId,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.CANCEL_ORDER,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
        symbol,
    }),
    symbol,
    ...compactObject({ orderId, origClientOrderId }),
});

export const createFuturesCancelAllCommand = ({
    accountId,
    clientOrderId,
    symbol,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.CANCEL_ALL,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
        symbol,
    }),
    symbol,
});

export const createFuturesAccountRefreshCommand = ({
    accountId,
    clientOrderId,
    symbol,
} = {}) => createAccountRefreshCommand({
    accountId,
    clientOrderId,
    marketType: FUTURES_MARKET_TYPE,
    symbol,
});

export const createFuturesSetTradingPausedCommand = ({
    accountId,
    clientOrderId,
    paused,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.SET_TRADING_PAUSED,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
    }),
    paused: paused === true,
});

export const isTypedTradingAction = (action) => (
    Object.values(TRADING_COMMAND_ACTIONS).includes(action)
);

export const toLegacyTradingRequest = (command) => {
    if (!command || command.marketType !== SPOT_MARKET_TYPE) {
        throw new Error('Only spot trading commands can be adapted to the legacy protocol');
    }

    if (command.action === TRADING_COMMAND_ACTIONS.PLACE_ORDER) {
        return {
            request: command.side === 'SELL' ? 'sellOrder' : 'buyOrder',
            data: {
                symbol: command.symbol,
                side: command.side,
                price: command.price,
                quantity: command.quantity,
            },
        };
    }

    if (command.action === TRADING_COMMAND_ACTIONS.CANCEL_ORDER) {
        return {
            request: 'cancelOrder',
            data: compactObject({
                symbol: command.symbol,
                orderId: command.orderId,
                id: command.orderId,
                origClientOrderId: command.origClientOrderId,
                clientOrderId: command.origClientOrderId,
                newClientOrderId: command.newClientOrderId,
            }),
        };
    }

    throw new Error(`${command.action} cannot be adapted to the legacy protocol`);
};
