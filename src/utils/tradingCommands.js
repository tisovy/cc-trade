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
    ACCOUNT_HISTORY: 'account.history',
    SET_TRADING_PAUSED: 'trade.setTradingPaused',
    ADJUST_POSITION_MARGIN: 'trade.adjustPositionMargin',
});

export const POSITION_MARGIN_DIRECTIONS = Object.freeze({
    ADD: 'ADD',
    REMOVE: 'REMOVE',
});

export const DEFAULT_SPOT_ORDER_TYPE = 'LIMIT';
export const DEFAULT_SPOT_TIME_IN_FORCE = 'GTC';

const compactObject = (value) => Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null)
);

const toOptionalString = (value) => (
    value === undefined || value === null ? undefined : value.toString()
);

// Binance accepts a client order id of at most 36 characters from
// [.A-Za-z0-9:/_-]. The previous form spelled out the market, symbol and side
// and reached 37 characters for an 8-character symbol, so every order was
// refused by the exchange. The id now carries only what identifies it — which
// market, when it was minted, and enough randomness to stay unique — because
// the symbol and side are already on the order itself.
export const CLIENT_ORDER_ID_MAX_LENGTH = 36;
export const CLIENT_ORDER_ID_PATTERN = /^[.A-Za-z0-9:/_-]{1,36}$/;

const createClientOrderId = ({ marketType = SPOT_MARKET_TYPE } = {}) => {
    const market = marketType === FUTURES_MARKET_TYPE ? 'f' : 's';
    const timestamp = Date.now().toString(36);
    const suffix = Math.random().toString(36).slice(2, 10);
    return `${market}-${timestamp}-${suffix}`.slice(0, CLIENT_ORDER_ID_MAX_LENGTH);
};

// The base carries only what identifies the command. `symbol` and `side` belong
// to the order itself and are spread in by each creator, so they are
// deliberately absent here.
const buildBaseCommand = ({
    action,
    marketType = SPOT_MARKET_TYPE,
    accountId = DEFAULT_ACCOUNT_ID,
    clientOrderId,
} = {}) => compactObject({
    action,
    version: TRADE_COMMAND_VERSION,
    marketType,
    accountId,
    clientOrderId: clientOrderId || createClientOrderId({ marketType }),
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

// Moving a futures order is a single atomic amendment (Binance PUT /fapi/v1/order),
// never cancel + re-place: a failed re-place would leave the trader flat without
// the order they only meant to reprice.
export const createFuturesModifyOrderCommand = ({
    accountId,
    clientOrderId,
    symbol,
    side,
    orderId,
    origClientOrderId,
    price,
    quantity,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.REPLACE_ORDER,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
        symbol,
        side,
    }),
    symbol,
    side,
    orderType: DEFAULT_SPOT_ORDER_TYPE,
    price: toOptionalString(price),
    quantity: toOptionalString(quantity),
    ...compactObject({ orderId, origClientOrderId }),
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

// History is a read: it never touches the book, so it carries only the contract
// whose past the operator asked to see.
export const createFuturesAccountHistoryCommand = ({
    accountId,
    clientOrderId,
    symbol,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
        symbol,
    }),
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

// Moving margin in or out of one open position. It places no order and changes
// no notional: what it changes is how far that position is from liquidation.
export const createFuturesAdjustPositionMarginCommand = ({
    accountId,
    clientOrderId,
    symbol,
    positionSide,
    direction,
    amount,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.ADJUST_POSITION_MARGIN,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
        symbol,
    }),
    symbol,
    direction,
    amount: toOptionalString(amount),
    ...compactObject({ positionSide }),
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
