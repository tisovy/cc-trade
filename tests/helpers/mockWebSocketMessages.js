const DEFAULT_SYMBOL = 'BTCUSDT';
const DEFAULT_INTERVAL = '1h';

export const buildMockCandles = ({
    count = 12,
    basePrice = 50000,
    baseTime = Date.now(),
    intervalMs = 60_000,
} = {}) => {
    return Array.from({ length: count }, (_, index) => {
        const open = basePrice + index * 10;
        const close = open + 5;
        return {
            time: Math.floor((baseTime - (count - index - 1) * intervalMs) / 1000),
            open,
            high: open + 20,
            low: open - 20,
            close,
            volume: 10 + index,
            isFinal: true,
        };
    });
};

export const createMockMarketState = (overrides = {}) => {
    const symbol = overrides.symbol || DEFAULT_SYMBOL;
    const interval = overrides.interval || DEFAULT_INTERVAL;
    const chart = overrides.chart || buildMockCandles({ basePrice: overrides.basePrice });

    return {
        symbol,
        interval,
        balances: overrides.balances || {
            USDT: { available: '2000.00', onOrder: '0.00' },
            BTC: { available: '0.5', onOrder: '0.0' },
        },
        orders: overrides.orders || [],
        filters: overrides.filters || {
            [symbol]: {
                tickSize: '0.01',
                stepSize: '0.000001',
                minQty: '0.000001',
                minNotional: '10',
                quantityPrecision: 6,
            },
        },
        ticker: overrides.ticker || [
            {
                symbol,
                lastPrice: String(chart.at(-1)?.close ?? basePriceFor(overrides)),
                priceChangePercent: '1.5',
                quoteVolume: '100000000',
            },
        ],
        depth: overrides.depth || {
            bids: { '12345.00': '1.0', '12344.00': '2.0' },
            asks: { '12346.00': '1.0', '12347.00': '2.0' },
        },
        trades: overrides.trades || [
            {
                time: Date.now(),
                price: '50000.00',
                qty: '0.01',
                isBuyerMaker: false,
                symbol,
            },
        ],
        chart,
    };
};

export const attachMockWebSocketHandlers = (ws, marketState, handlers = {}) => {
    const state = {
        latestDetailChannelId: null,
        latestDetailSubscription: null,
        lastOrder: null,
    };

    const api = {
        sendJson: (payload) => sendJson(ws, payload),
        sendLegacySnapshot: () => sendLegacySnapshot(ws, marketState),
        sendLegacyChart: (request = {}) => sendLegacyChart(ws, marketState, request, state),
        sendLegacyDepth: () => sendLegacyDepth(ws, marketState),
        sendChannelSnapshot: (request = {}) => sendChannelSnapshot(ws, marketState, request, state),
        sendDepthViewSnapshot: (symbol = marketState.symbol) => sendDepthViewSnapshot(ws, marketState, state, symbol),
        getLastOrder: () => state.lastOrder,
        getLatestDetailChannelId: () => state.latestDetailChannelId,
    };

    api.sendLegacySnapshot();
    sendGlobalChannelSnapshot(ws, marketState);

    ws.on('message', (message) => {
        const payload = parseWsPayload(message);
        if (!payload) return;

        if (payload.action) {
            handleChannelProtocolMessage(payload, marketState, state, api, handlers);
            return;
        }

        if (payload.request === 'chart') {
            api.sendLegacyChart(payload.data || {});
            return;
        }

        if (payload.request === 'buyOrder' || payload.request === 'sellOrder') {
            state.lastOrder = payload.data;
            handlers.onLegacyOrder?.(payload, api);
            return;
        }

        if (payload.request === 'cancelOrder') {
            handlers.onLegacyCancel?.(payload, api);
            return;
        }

        handlers.onLegacyMessage?.(payload, api);
    });

    return api;
};

const basePriceFor = (overrides) => overrides.basePrice ?? 50000;

const parseWsPayload = (message) => {
    try {
        return JSON.parse(message.toString());
    } catch {
        return null;
    }
};

const sendJson = (ws, payload) => {
    ws.send(JSON.stringify(payload));
};

const normalizeOrders = (orders) => {
    return orders.map((order) => ({
        executedQty: '0',
        ...order,
    }));
};

const latestCandle = (marketState) => marketState.chart.at(-1) || null;

const sendLegacySnapshot = (ws, marketState) => {
    sendJson(ws, { balances: marketState.balances });
    sendJson(ws, { orders: normalizeOrders(marketState.orders) });
    sendJson(ws, { filters: marketState.filters });
    sendJson(ws, { ticker: marketState.ticker });
    sendLegacyDepth(ws, marketState);
    sendLegacyChart(ws, marketState);
};

const sendLegacyDepth = (ws, marketState) => {
    sendJson(ws, {
        depth: marketState.depth,
        symbol: marketState.symbol,
    });
};

const sendLegacyChart = (ws, marketState, request = {}, state = {}) => {
    const symbol = request.selected || request.detailSymbol || request.symbol || marketState.symbol;
    const interval = request.interval || request.detailInterval || marketState.interval;
    const requestId = request.requestId;

    sendJson(ws, {
        chart: marketState.chart,
        last_tick: latestCandle(marketState),
        symbol,
        interval,
        ...(requestId ? { requestId } : {}),
    });

    if (requestId) {
        const channelId = `detail-${symbol}-${interval}-${requestId}`;
        sendChannelSnapshot(ws, marketState, {
            channelId,
            channelType: 'detail',
            symbol,
            interval,
        }, state);
    }
};

const sendGlobalChannelSnapshot = (ws, marketState) => {
    sendJson(ws, {
        channelId: 'global',
        type: 'ticker',
        payload: marketState.ticker,
    });
    sendJson(ws, {
        channelId: 'global',
        type: 'filters',
        payload: marketState.filters,
    });
};

const sendChannelSnapshot = (ws, marketState, request = {}, state = {}) => {
    const channelId = request.channelId;
    if (!channelId) return;

    const channelType = request.channelType || 'detail';
    const symbol = request.symbol || marketState.symbol;
    const interval = request.interval || marketState.interval;

    if (channelType === 'detail') {
        state.latestDetailChannelId = channelId;
        state.latestDetailSubscription = { symbol, interval };
    }

    sendJson(ws, {
        channelId,
        type: 'chart',
        symbol,
        interval,
        payload: marketState.chart,
        extra: latestCandle(marketState),
    });

    if (channelType !== 'detail') return;

    sendJson(ws, {
        channelId,
        type: 'balances',
        symbol,
        interval,
        payload: marketState.balances,
    });
    sendJson(ws, {
        channelId,
        type: 'orders',
        symbol,
        interval,
        payload: normalizeOrders(marketState.orders),
    });
    sendJson(ws, {
        channelId,
        type: 'depth',
        symbol,
        interval,
        payload: marketState.depth,
    });
    sendJson(ws, {
        channelId,
        type: 'trades',
        symbol,
        interval,
        payload: marketState.trades,
    });
};

const sendDepthViewSnapshot = (ws, marketState, state, symbol) => {
    const detail = state.latestDetailSubscription || {
        symbol: marketState.symbol,
        interval: marketState.interval,
    };
    const activeSymbol = symbol || detail.symbol;

    sendLegacyDepth(ws, { ...marketState, symbol: activeSymbol });

    if (!state.latestDetailChannelId) return;

    sendJson(ws, {
        channelId: state.latestDetailChannelId,
        type: 'depth',
        symbol: activeSymbol,
        interval: detail.interval,
        payload: marketState.depth,
    });
    sendJson(ws, {
        channelId: state.latestDetailChannelId,
        type: 'trades',
        symbol: activeSymbol,
        interval: detail.interval,
        payload: marketState.trades,
    });
};

const handleChannelProtocolMessage = (payload, marketState, state, api, handlers) => {
    switch (payload.action) {
        case 'subscribe':
            api.sendChannelSnapshot(payload);
            break;
        case 'enable_depth_view':
            api.sendDepthViewSnapshot(payload.symbol || marketState.symbol);
            break;
        case 'disable_depth_view':
            break;
        case 'order':
            state.lastOrder = payload.data || payload;
            handlers.onChannelOrder?.(payload, api);
            break;
        case 'cancelOrder':
            handlers.onChannelCancel?.(payload, api);
            break;
        default:
            handlers.onChannelMessage?.(payload, api);
            break;
    }
};
