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
    ACCOUNT_SYMBOL_CONFIG: 'account.symbolConfig',
    SET_LEVERAGE: 'trade.setLeverage',
    SET_MARGIN_TYPE: 'trade.setMarginType',
    ACCOUNT_FEE_VALUATION: 'account.feeValuation',
});

// The most minutes one fee-valuation ask may carry. The backend bounds itself
// the same way; this is the renderer refusing to compose an oversized ask in
// the first place.
export const FUTURES_FEE_VALUATION_COMMAND_MAX_MINUTES = 360;

// Binance allows 1–125 depending on the contract and the bracket; the contract's
// own ceiling is read from its leverage bracket and is always the lower of the
// two. This is only the outer bound a command is refused past.
export const FUTURES_LEVERAGE_LIMITS = Object.freeze({ min: 1, max: 125 });

// Binance says CROSSED where its own screen says Cross; both words are its own,
// and these two are the whole set — a mode outside them is refused rather than
// forwarded and rejected by the exchange.
export const FUTURES_MARGIN_TYPES = Object.freeze(['ISOLATED', 'CROSSED']);

// What the desk holds a contract at unless the operator says otherwise. A
// contract the desk has never traded carries whatever the exchange's
// account-wide setting left on it — 20× on a contract sized in USDT liquidates
// on a 5% move — so the desk states its own default rather than inheriting one.
//
// There is no default margin mode beside it, and the absence is the decision:
// the desk states which mode a contract is in and offers the control to change
// it, but the mode is the operator's to choose. A default here would overwrite
// that choice on the next restart, which is exactly what it used to do.
export const FUTURES_DEFAULT_LEVERAGE = 1;

export const POSITION_MARGIN_DIRECTIONS = Object.freeze({
    ADD: 'ADD',
    REMOVE: 'REMOVE',
});

// The two endpoints an account review reads, named for what the panel shows out
// of them: the order log behind the order history, the fills behind the closed
// positions. Every USDⓈ-M history endpoint is read per contract, so reading both
// for a panel showing one costs a whole fan-out answering a view nobody has open.
export const FUTURES_HISTORY_VIEWS = Object.freeze({
    ORDERS: 'orders',
    TRADES: 'trades',
});
export const FUTURES_HISTORY_VIEW_VALUES = Object.freeze([
    FUTURES_HISTORY_VIEWS.ORDERS,
    FUTURES_HISTORY_VIEWS.TRADES,
]);

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

// `periodic` says a timer asked, not a person.
//
// The desk cannot otherwise tell them apart, and on 2026-08-20 that cost it
// both ways at once: deferring the operator's press left them pressing at a
// number that would not move, and then reading on every ask turned the
// thirty-second reconcile into six requests every thirty seconds. The two asks
// want different things — the timer wants the orders and positions it polls
// for, the person wants everything the desk can find out — and only the caller
// knows which one it is.
//
// Absent means a person. An ask that lost its marking should read too much
// rather than leave somebody looking at a figure that will not move.
export const createAccountRefreshCommand = ({
    accountId,
    clientOrderId,
    marketType = SPOT_MARKET_TYPE,
    symbol,
    periodic = false,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.ACCOUNT_REFRESH,
        marketType,
        accountId,
        clientOrderId,
        symbol,
    }),
    ...compactObject({ symbol }),
    ...(periodic === true ? { periodic: true } : {}),
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

// Binance's single atomic amendment (PUT /fapi/v1/order). One call, so a
// rejection leaves the order exactly where it was — which is why the amend panel
// reprices by typing through this and not through a cancellation.
//
// The chart drag deliberately does not: picking an order up cancels it, and the
// drop places its replacement. That trade is stated where it is made
// (`useFuturesOrderDrag`), and the window it opens is the operator's choice.
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
    manual = false,
    symbol,
    periodic = false,
} = {}) => ({
    ...createAccountRefreshCommand({
        accountId,
        clientOrderId,
        marketType: FUTURES_MARKET_TYPE,
        symbol,
        periodic,
    }),
    ...(manual === true ? { manual: true } : {}),
});

// History is a read: it never touches the book. The renderer carries the
// per-contract identities it already holds so Electron can ask only for the
// gap; the command boundary validates and bounds them before they are used.
// `views` names which endpoints this read is for. Absent means both, which is
// what a caller that does not know what is on screen is asking for.
export const createFuturesAccountHistoryCommand = ({
    accountId,
    basisOnly = false,
    clientOrderId,
    coverage = {},
    full = false,
    symbol,
    views = null,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.ACCOUNT_HISTORY,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
        symbol,
    }),
    coverage,
    ...(basisOnly === true ? { basisOnly: true } : {}),
    full: full === true,
    symbol,
    ...(Array.isArray(views) && views.length > 0 ? { views: [...views] } : {}),
});

// A read for the settlement-asset price of a foreign fee asset, one minute at
// a time: "value X BNB at time T in USDT" needs the BNBUSDT kline of T's own
// minute, and this asks for exactly the minutes the held rounds could not
// value. The answer arrives as a `futures_fee_valuation` price table; a
// minute the backend cannot answer finally simply stays out of it.
export const createFuturesFeeValuationCommand = ({
    accountId,
    clientOrderId,
    pair,
    minutes = [],
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.ACCOUNT_FEE_VALUATION,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
    }),
    pair,
    minutes: (Array.isArray(minutes) ? minutes : [])
        .slice(0, FUTURES_FEE_VALUATION_COMMAND_MAX_MINUTES),
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

// What leverage a contract is set to, and the ceiling it may be set to.
// `/fapi/v3/positionRisk` reports neither any more, so nothing on the desk can
// state the leverage a trade is entered at without asking for it.
export const createFuturesSymbolConfigCommand = ({
    accountId,
    clientOrderId,
    symbol,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.ACCOUNT_SYMBOL_CONFIG,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
        symbol,
    }),
    symbol,
});

// Leverage is the one property of a contract the operator sets outside an order.
// It places nothing: what it changes is the margin every future entry costs and,
// on an open isolated position, how far that position stands from liquidation.
export const createFuturesSetLeverageCommand = ({
    accountId,
    clientOrderId,
    symbol,
    leverage,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.SET_LEVERAGE,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
        symbol,
    }),
    symbol,
    leverage,
});

// The other property of a contract set outside an order. Isolated caps a losing
// position at the margin behind it; cross puts the whole wallet behind it, which
// is why the mode belongs to the operator and not to whatever the account
// happened to be left on.
export const createFuturesSetMarginTypeCommand = ({
    accountId,
    clientOrderId,
    symbol,
    marginType,
} = {}) => ({
    ...buildBaseCommand({
        action: TRADING_COMMAND_ACTIONS.SET_MARGIN_TYPE,
        marketType: FUTURES_MARKET_TYPE,
        accountId,
        clientOrderId,
        symbol,
    }),
    symbol,
    marginType,
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
