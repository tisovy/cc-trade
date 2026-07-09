export const normalizeSpotBalances = (account = {}) => {
    const balances = {};
    account?.balances?.forEach((balance) => {
        if (parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0) {
            balances[balance.asset] = {
                available: balance.free,
                onOrder: balance.locked,
            };
        }
    });
    return balances;
};

export const parseSpotExchangeFilters = (exchangeInfo = {}) => {
    const symbolInfo = exchangeInfo?.symbols?.[0];
    if (!symbolInfo) return null;

    const parsedFilters = {
        status: symbolInfo.status,
        baseAsset: symbolInfo.baseAsset,
        quoteAsset: symbolInfo.quoteAsset,
        baseAssetPrecision: symbolInfo.baseAssetPrecision,
        quoteAssetPrecision: symbolInfo.quoteAssetPrecision,
        quotePrecision: symbolInfo.quotePrecision,
    };

    symbolInfo.filters.forEach((filter) => {
        if (filter.filterType === 'MIN_NOTIONAL') parsedFilters.minNotional = filter.minNotional;
        if (filter.filterType === 'PRICE_FILTER') {
            parsedFilters.minPrice = filter.minPrice;
            parsedFilters.maxPrice = filter.maxPrice;
            parsedFilters.tickSize = filter.tickSize;
        }
        if (filter.filterType === 'LOT_SIZE') {
            parsedFilters.stepSize = filter.stepSize;
            parsedFilters.minQty = filter.minQty;
            parsedFilters.maxQty = filter.maxQty;
        }
    });

    return parsedFilters;
};

export const normalizeSpotExecutionReport = (payload = {}, overrides = {}) => {
    const timestamp = payload.transactTime ?? payload.updateTime ?? payload.T ?? Date.now();
    const status = overrides.status || payload.status || payload.X || payload.orderStatus || 'NEW';
    return {
        e: 'executionReport',
        s: payload.symbol ?? payload.s,
        symbol: payload.symbol ?? payload.s,
        S: payload.side ?? payload.S,
        side: payload.side ?? payload.S,
        o: payload.type ?? payload.o,
        type: payload.type ?? payload.o,
        x: overrides.x || payload.x || payload.executionType || status,
        X: status,
        status,
        i: payload.orderId ?? payload.i,
        orderId: payload.orderId ?? payload.i,
        p: payload.price ?? payload.origPrice ?? payload.p ?? '0',
        price: payload.price ?? payload.origPrice ?? payload.p ?? '0',
        q: payload.origQty ?? payload.quantity ?? payload.q ?? '0',
        origQty: payload.origQty ?? payload.quantity ?? payload.q ?? '0',
        z: payload.executedQty ?? payload.cummulativeQuoteQty ?? payload.z ?? '0',
        l: payload.executedQty ?? payload.l ?? '0',
        T: timestamp,
        transactTime: timestamp,
        time: timestamp,
        ...overrides,
    };
};

export const normalizeSpotUserDataStreamEvent = (payload = {}) => {
    if (payload?.e === 'executionReport') {
        const executionReport = normalizeSpotExecutionReport(payload);
        return {
            type: 'executionReport',
            executionReport,
            rendererPayload: { execution_update: executionReport },
            shouldRefreshBalances: executionReport.status === 'FILLED'
                || executionReport.status === 'PARTIALLY_FILLED',
        };
    }

    if (payload?.e === 'outboundAccountPosition') {
        return {
            type: 'outboundAccountPosition',
            balanceUpdate: payload,
            rendererPayload: { balance_update: payload },
            shouldRefreshBalances: false,
        };
    }

    if (payload?.e === 'balanceUpdate') {
        return {
            type: 'balanceUpdate',
            balanceUpdate: payload,
            rendererPayload: null,
            shouldRefreshBalances: true,
        };
    }

    return null;
};

const readResponseData = async (response) => response.data();

const SPOT_ACCOUNT_REFRESH_WEIGHTS = {
    balances: 10,
    openOrders: 3,
    tradeHistory: 10,
};

const SPOT_ACCOUNT_REFRESH_ERROR_LABELS = {
    balances: 'Balances Fetch Error',
    openOrders: 'Open Orders Fetch Error',
    tradeHistory: 'Trade History Fetch Error',
};

const SPOT_USER_DATA_STREAM_PATH = '/api/v3/userDataStream';

export class SpotTradingAdapter {
    constructor({ client, recvWindow }) {
        this.client = client;
        this.recvWindow = recvWindow;
    }

    getExchangeInfo(symbol) {
        return this.client.restAPI.exchangeInfo({ symbol })
            .then(readResponseData)
            .then(parseSpotExchangeFilters);
    }

    getAccountState() {
        return this.client.restAPI.getAccount({ recvWindow: this.recvWindow })
            .then(readResponseData)
            .then(normalizeSpotBalances);
    }

    getAccountStatePayload() {
        return this.getAccountState().then((balances) => ({ balances }));
    }

    getOpenOrders(symbol) {
        const params = { recvWindow: this.recvWindow };
        if (symbol) {
            params.symbol = symbol;
        }
        return this.client.restAPI.getOpenOrders(params).then(readResponseData);
    }

    getOpenOrdersPayload(symbol) {
        return this.getOpenOrders(symbol).then((orders) => ({ orders }));
    }

    getTradeHistory(symbol) {
        return this.client.restAPI.myTrades({
            symbol,
            limit: 500,
            recvWindow: this.recvWindow,
        }).then(readResponseData);
    }

    getTradeHistoryPayload(symbol) {
        return this.getTradeHistory(symbol).then((history) => ({ history }));
    }

    getAccountRefreshOperations(symbol) {
        const operations = [
            {
                type: 'balances',
                weight: SPOT_ACCOUNT_REFRESH_WEIGHTS.balances,
                loadPayload: () => this.getAccountStatePayload(),
            },
            {
                type: 'openOrders',
                weight: SPOT_ACCOUNT_REFRESH_WEIGHTS.openOrders,
                loadPayload: () => this.getOpenOrdersPayload(),
            },
        ];

        if (symbol) {
            operations.push({
                type: 'tradeHistory',
                weight: SPOT_ACCOUNT_REFRESH_WEIGHTS.tradeHistory,
                loadPayload: () => this.getTradeHistoryPayload(symbol),
            });
        }

        return operations;
    }

    getDetailAccountSnapshotOperations(symbol) {
        return this.getAccountRefreshOperations(symbol).map((operation) => ({
            ...operation,
            errorLabel: SPOT_ACCOUNT_REFRESH_ERROR_LABELS[operation.type],
        }));
    }

    normalizeUserDataStreamEvent(payload) {
        return normalizeSpotUserDataStreamEvent(payload);
    }

    async createUserDataStreamListenKey() {
        const response = await this.client.restAPI.sendRequest(SPOT_USER_DATA_STREAM_PATH, 'POST');
        const data = await response.data();
        return data?.listenKey;
    }

    renewUserDataStreamListenKey(listenKey) {
        return this.client.restAPI.sendRequest(SPOT_USER_DATA_STREAM_PATH, 'PUT', { listenKey });
    }

    async placeOrder(command) {
        const response = await this.client.restAPI.newOrder({
            symbol: command.symbol,
            side: command.side,
            type: command.orderType || 'LIMIT',
            timeInForce: command.timeInForce || 'GTC',
            quantity: command.numericQuantity.toString(),
            price: command.numericPrice.toString(),
            newOrderRespType: 'FULL',
            recvWindow: this.recvWindow,
        });
        const data = await response.data();
        return normalizeSpotExecutionReport(data, { x: 'NEW' });
    }

    async cancelOrder(command) {
        const cancelParams = {
            symbol: command.symbol,
            recvWindow: this.recvWindow,
        };
        if (command.orderId) {
            cancelParams.orderId = command.orderId;
        } else if (command.origClientOrderId) {
            cancelParams.origClientOrderId = command.origClientOrderId;
        }
        if (command.newClientOrderId) {
            cancelParams.newClientOrderId = command.newClientOrderId;
        }

        const response = await this.client.restAPI.deleteOrder(cancelParams);
        const data = await response.data();
        return normalizeSpotExecutionReport(data, {
            x: 'CANCELED',
            status: 'CANCELED',
            X: 'CANCELED',
        });
    }
}

export const buildSpotMockOrderPlacementExecutionReport = ({
    symbol,
    side,
    priceValue,
    quantityValue,
    orderId = Date.now(),
    eventTime = Date.now(),
}) => ({
    e: 'executionReport',
    s: symbol,
    S: side,
    o: 'LIMIT',
    x: 'NEW',
    X: 'NEW',
    i: orderId,
    p: priceValue,
    q: quantityValue,
    z: '0.0',
    T: eventTime,
});
