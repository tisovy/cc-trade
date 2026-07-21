import { createHmac } from 'node:crypto';
import https from 'node:https';

export const FUTURES_REST_ORIGIN = 'https://fapi.binance.com';
export const FUTURES_STREAM_ORIGIN = 'wss://fstream.binance.com';

const DEFAULT_RECV_WINDOW = 5000;
const REQUEST_TIMEOUT_MS = 10000;

export class FuturesApiError extends Error {
    constructor(message, { status, code, body } = {}) {
        super(message);
        this.name = 'FuturesApiError';
        this.status = status;
        this.code = code;
        this.body = body;
    }
}

const toQueryString = (params = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        search.append(key, String(value));
    }
    return search.toString();
};

const httpsJsonRequest = ({ url, method, headers, body, agent }) => (
    new Promise((resolve, reject) => {
        const request = https.request(url, {
            method,
            headers,
            agent,
            timeout: REQUEST_TIMEOUT_MS,
        }, (response) => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let parsed = null;
                try {
                    parsed = text.length > 0 ? JSON.parse(text) : null;
                } catch {
                    parsed = null;
                }
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(parsed);
                    return;
                }
                reject(new FuturesApiError(
                    parsed?.msg || `Futures REST ${method} failed (${response.statusCode})`,
                    { status: response.statusCode, code: parsed?.code, body: parsed ?? text },
                ));
            });
        });
        request.on('timeout', () => request.destroy(new Error('Futures REST request timed out')));
        request.on('error', reject);
        if (body) request.write(body);
        request.end();
    })
);

// Maps a Binance USDⓈ-M REST order payload or ORDER_TRADE_UPDATE event to the
// executionReport shape the renderer already consumes for spot updates.
export const normalizeFuturesExecutionReport = (payload = {}, overrides = {}) => {
    const order = payload?.e === 'ORDER_TRADE_UPDATE' ? payload.o : payload;
    const timestamp = order.updateTime ?? order.T ?? payload.T ?? payload.E ?? Date.now();
    const status = overrides.status || order.status || order.X || 'NEW';
    const price = order.price ?? order.p ?? '0';
    const avgPrice = order.avgPrice ?? order.ap;
    return {
        e: 'executionReport',
        marketType: 'futures',
        s: order.symbol ?? order.s,
        symbol: order.symbol ?? order.s,
        S: order.side ?? order.S,
        side: order.side ?? order.S,
        o: order.type ?? order.o ?? 'LIMIT',
        type: order.type ?? order.o ?? 'LIMIT',
        x: overrides.x || order.x || status,
        X: status,
        status,
        i: order.orderId ?? order.i,
        orderId: order.orderId ?? order.i,
        c: order.clientOrderId ?? order.c,
        clientOrderId: order.clientOrderId ?? order.c,
        p: price,
        price,
        q: order.origQty ?? order.q ?? '0',
        origQty: order.origQty ?? order.q ?? '0',
        z: order.executedQty ?? order.z ?? '0',
        l: order.lastFilledQty ?? order.l ?? '0',
        positionSide: order.positionSide ?? order.ps ?? 'BOTH',
        reduceOnly: order.reduceOnly ?? order.R ?? false,
        ...(avgPrice !== undefined ? { avgPrice } : {}),
        T: timestamp,
        transactTime: timestamp,
        time: timestamp,
        ...overrides,
    };
};

export const parseFuturesExchangeFilters = (exchangeInfo = {}, symbol) => {
    const symbolInfo = exchangeInfo?.symbols?.find(entry => entry.symbol === symbol)
        ?? exchangeInfo?.symbols?.[0];
    if (!symbolInfo) return null;

    const parsedFilters = {
        symbol: symbolInfo.symbol,
        status: symbolInfo.status,
        contractType: symbolInfo.contractType,
        baseAsset: symbolInfo.baseAsset,
        quoteAsset: symbolInfo.quoteAsset,
        pricePrecision: symbolInfo.pricePrecision,
        quantityPrecision: symbolInfo.quantityPrecision,
    };
    symbolInfo.filters?.forEach((filter) => {
        if (filter.filterType === 'MIN_NOTIONAL') parsedFilters.minNotional = filter.notional;
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

export const normalizeFuturesBalances = (balanceEntries = []) => {
    const balances = {};
    for (const entry of Array.isArray(balanceEntries) ? balanceEntries : []) {
        if (parseFloat(entry.balance) > 0 || parseFloat(entry.availableBalance) > 0) {
            balances[entry.asset] = {
                available: entry.availableBalance,
                total: entry.balance,
                crossUnPnl: entry.crossUnPnl,
            };
        }
    }
    return balances;
};

export const normalizeFuturesPositions = (positionEntries = []) => (
    (Array.isArray(positionEntries) ? positionEntries : [])
        .filter(entry => parseFloat(entry.positionAmt) !== 0)
        .map(entry => ({
            symbol: entry.symbol,
            positionSide: entry.positionSide ?? 'BOTH',
            quantity: entry.positionAmt,
            entryPrice: entry.entryPrice,
            markPrice: entry.markPrice,
            unrealizedPnl: entry.unRealizedProfit,
            liquidationPrice: entry.liquidationPrice,
            leverage: entry.leverage,
            marginType: (entry.marginType ?? '').toUpperCase() || undefined,
            isolatedMargin: entry.isolatedMargin,
            notional: entry.notional,
        }))
);

export const normalizeFuturesUserDataStreamEvent = (payload = {}) => {
    if (payload?.e === 'ORDER_TRADE_UPDATE') {
        const executionReport = normalizeFuturesExecutionReport(payload);
        return {
            type: 'executionReport',
            executionReport,
            rendererPayload: { futures_execution_update: executionReport },
            shouldRefreshAccount: executionReport.status === 'FILLED'
                || executionReport.status === 'PARTIALLY_FILLED',
        };
    }
    if (payload?.e === 'ACCOUNT_UPDATE') {
        return {
            type: 'accountUpdate',
            rendererPayload: null,
            shouldRefreshAccount: true,
        };
    }
    if (payload?.e === 'listenKeyExpired') {
        return {
            type: 'listenKeyExpired',
            rendererPayload: null,
            shouldRefreshAccount: false,
        };
    }
    return null;
};

const FUTURES_ACCOUNT_REFRESH_WEIGHTS = {
    balances: 5,
    openOrders: 3,
    positions: 5,
};

const FUTURES_ACCOUNT_REFRESH_ERROR_LABELS = {
    balances: 'Futures Balances Fetch Error',
    openOrders: 'Futures Open Orders Fetch Error',
    positions: 'Futures Positions Fetch Error',
};

export class FuturesTradingAdapter {
    constructor({
        apiKey,
        apiSecret,
        recvWindow = DEFAULT_RECV_WINDOW,
        proxyAgent = null,
        restOrigin = FUTURES_REST_ORIGIN,
    }) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.recvWindow = recvWindow;
        this.proxyAgent = proxyAgent;
        this.restOrigin = restOrigin;
        this.serverTimeOffsetMs = null;
        this.positionModePromise = null;
    }

    #request(method, path, params = {}, { signed = false } = {}) {
        const query = signed
            ? toQueryString({
                ...params,
                recvWindow: this.recvWindow,
                timestamp: Date.now() + (this.serverTimeOffsetMs ?? 0),
            })
            : toQueryString(params);
        const signature = signed
            ? createHmac('sha256', this.apiSecret).update(query).digest('hex')
            : null;
        const finalQuery = signed ? `${query}&signature=${signature}` : query;
        const useBody = signed && (method === 'POST' || method === 'PUT');
        const url = `${this.restOrigin}${path}${!useBody && finalQuery ? `?${finalQuery}` : ''}`;
        return httpsJsonRequest({
            url,
            method,
            agent: this.proxyAgent ?? undefined,
            headers: {
                ...(this.apiKey ? { 'X-MBX-APIKEY': this.apiKey } : {}),
                ...(useBody ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
            },
            body: useBody ? finalQuery : null,
        });
    }

    async syncServerTime() {
        const data = await this.#request('GET', '/fapi/v1/time');
        if (typeof data?.serverTime === 'number') {
            this.serverTimeOffsetMs = data.serverTime - Date.now();
        }
        return data?.serverTime;
    }

    async #signedRequest(method, path, params = {}) {
        if (this.serverTimeOffsetMs === null) {
            try {
                await this.syncServerTime();
            } catch {
                this.serverTimeOffsetMs = 0;
            }
        }
        try {
            return await this.#request(method, path, params, { signed: true });
        } catch (error) {
            // -1021: timestamp outside recvWindow — resync once and retry.
            if (error?.code === -1021) {
                await this.syncServerTime();
                return this.#request(method, path, params, { signed: true });
            }
            throw error;
        }
    }

    getExchangeInfo(symbol) {
        return this.#request('GET', '/fapi/v1/exchangeInfo')
            .then(info => parseFuturesExchangeFilters(info, symbol));
    }

    // One-way accounts use positionSide BOTH; hedge accounts require LONG/SHORT.
    getPositionMode() {
        if (!this.positionModePromise) {
            this.positionModePromise = this.#signedRequest('GET', '/fapi/v1/positionSide/dual')
                .then(data => ({ hedgeMode: data?.dualSidePosition === true }))
                .catch((error) => {
                    this.positionModePromise = null;
                    throw error;
                });
        }
        return this.positionModePromise;
    }

    getBalances() {
        return this.#signedRequest('GET', '/fapi/v3/balance').then(normalizeFuturesBalances);
    }

    getBalancesPayload() {
        return this.getBalances().then(balances => ({ futures_balances: balances }));
    }

    getPositions() {
        return this.#signedRequest('GET', '/fapi/v3/positionRisk')
            .then(normalizeFuturesPositions);
    }

    getPositionsPayload() {
        return this.getPositions().then(positions => ({ futures_positions: positions }));
    }

    getOpenOrders(symbol) {
        const params = {};
        if (symbol) params.symbol = symbol;
        return this.#signedRequest('GET', '/fapi/v1/openOrders', params);
    }

    getOpenOrdersPayload(symbol) {
        return this.getOpenOrders(symbol)
            .then(orders => ({ futures_orders: orders.map(order => normalizeFuturesExecutionReport(order)) }));
    }

    getAccountRefreshOperations(symbol) {
        return [
            {
                type: 'balances',
                weight: FUTURES_ACCOUNT_REFRESH_WEIGHTS.balances,
                errorLabel: FUTURES_ACCOUNT_REFRESH_ERROR_LABELS.balances,
                loadPayload: () => this.getBalancesPayload(),
            },
            {
                type: 'openOrders',
                weight: FUTURES_ACCOUNT_REFRESH_WEIGHTS.openOrders,
                errorLabel: FUTURES_ACCOUNT_REFRESH_ERROR_LABELS.openOrders,
                loadPayload: () => this.getOpenOrdersPayload(symbol),
            },
            {
                type: 'positions',
                weight: FUTURES_ACCOUNT_REFRESH_WEIGHTS.positions,
                errorLabel: FUTURES_ACCOUNT_REFRESH_ERROR_LABELS.positions,
                loadPayload: () => this.getPositionsPayload(),
            },
        ];
    }

    async #resolvePositionSide(side, { reduceOnly = false, positionSide } = {}) {
        if (positionSide) return positionSide;
        const { hedgeMode } = await this.getPositionMode();
        if (!hedgeMode) return 'BOTH';
        // Hedge mode: entries open the side matching the order direction;
        // reduce orders target the opposite leg.
        if (reduceOnly) return side === 'SELL' ? 'LONG' : 'SHORT';
        return side === 'BUY' ? 'LONG' : 'SHORT';
    }

    async placeOrder(command) {
        const positionSide = await this.#resolvePositionSide(command.side, command);
        const { hedgeMode } = await this.getPositionMode();
        const params = {
            symbol: command.symbol,
            side: command.side,
            positionSide,
            type: command.orderType || 'LIMIT',
            quantity: String(command.numericQuantity ?? command.quantity),
            newOrderRespType: 'RESULT',
        };
        if (params.type === 'LIMIT') {
            params.timeInForce = command.timeInForce || 'GTC';
            params.price = String(command.numericPrice ?? command.price);
        }
        // reduceOnly is invalid in hedge mode (positionSide already scopes it).
        if (command.reduceOnly && !hedgeMode) params.reduceOnly = 'true';
        if (command.newClientOrderId) params.newClientOrderId = command.newClientOrderId;
        const data = await this.#signedRequest('POST', '/fapi/v1/order', params);
        return normalizeFuturesExecutionReport(data, { x: 'NEW' });
    }

    async cancelOrder(command) {
        const params = { symbol: command.symbol };
        if (command.orderId) params.orderId = command.orderId;
        else if (command.origClientOrderId) params.origClientOrderId = command.origClientOrderId;
        const data = await this.#signedRequest('DELETE', '/fapi/v1/order', params);
        return normalizeFuturesExecutionReport(data, {
            x: 'CANCELED',
            status: 'CANCELED',
            X: 'CANCELED',
        });
    }

    async cancelAllOrders(symbol) {
        return this.#signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol });
    }

    // Closes (part of) a position with a MARKET order on the opposite side.
    async closePosition({ symbol, positionSide = 'BOTH', quantity }) {
        const side = parseFloat(quantity) > 0 ? 'SELL' : 'BUY';
        const { hedgeMode } = await this.getPositionMode();
        const params = {
            symbol,
            side,
            positionSide: hedgeMode ? positionSide : 'BOTH',
            type: 'MARKET',
            quantity: String(Math.abs(parseFloat(quantity))),
            newOrderRespType: 'RESULT',
        };
        if (!hedgeMode) params.reduceOnly = 'true';
        const data = await this.#signedRequest('POST', '/fapi/v1/order', params);
        return normalizeFuturesExecutionReport(data, { x: 'NEW' });
    }

    async createUserDataStreamListenKey() {
        const data = await this.#request('POST', '/fapi/v1/listenKey');
        return data?.listenKey;
    }

    renewUserDataStreamListenKey() {
        return this.#request('PUT', '/fapi/v1/listenKey');
    }
}

export const buildFuturesMockOrderPlacementExecutionReport = ({
    symbol,
    side,
    priceValue,
    quantityValue,
    positionSide = 'BOTH',
    orderId = Date.now(),
    eventTime = Date.now(),
}) => normalizeFuturesExecutionReport({
    symbol,
    side,
    type: 'LIMIT',
    status: 'NEW',
    orderId,
    price: priceValue,
    origQty: quantityValue,
    executedQty: '0',
    positionSide,
    updateTime: eventTime,
});
