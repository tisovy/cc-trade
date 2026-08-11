import { createHmac } from 'node:crypto';
import https from 'node:https';
import { isIndeterminateTradingFailure } from './trading-command-outcome.js';

export const FUTURES_REST_ORIGIN = 'https://fapi.binance.com';
export const FUTURES_STREAM_ORIGIN = 'wss://fstream.binance.com';

const DEFAULT_RECV_WINDOW = 5000;
const REQUEST_TIMEOUT_MS = 10000;

export class FuturesApiError extends Error {
    constructor(message, { status, code, body, indeterminate = false } = {}) {
        super(message);
        this.name = 'FuturesApiError';
        this.status = status;
        this.code = code;
        this.body = body;
        // Set when the request may have executed despite failing. Only mutating
        // callers read it; see trading-command-outcome.js.
        this.indeterminate = indeterminate;
    }
}

// Binance's "Order does not exist" — the one answer that proves a submission
// never reached the book, and therefore the only one that makes a resubmission
// safe.
export const FUTURES_ORDER_NOT_FOUND_CODE = -2013;

// Binance error codes whose bare message hides what the trader has to change.
// Only codes we can act on are listed; anything else keeps the exchange wording.
const FUTURES_API_ERROR_HINTS = new Map([
    [-2015, 'the BFK/BFS key is refused for trading: enable "Futures" on the key in Binance API Management, and if the key is IP-restricted add this machine\'s address. Reads can keep working while trading stays blocked.'],
    [-2011, 'the order is already gone (filled or cancelled) — refresh open orders.'],
    [-2019, 'insufficient margin for this order.'],
    [-1021, 'local clock drifted outside recvWindow — sync system time.'],
    [-1111, 'price or quantity has more precision than the symbol filters allow.'],
    [-1013, 'price or quantity violates a symbol filter (tick size, step size, or minimum notional).'],
    [-4164, 'notional is below the exchange minimum (5 USDT) — increase the size.'],
    [-4400, 'futures trading is restricted for this account or region.'],
]);

export const describeFuturesApiError = (error) => {
    const message = error?.message || 'Binance futures request failed';
    const hint = FUTURES_API_ERROR_HINTS.get(Number(error?.code));
    return hint ? `${message} — ${hint}` : message;
};

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
                // A 5xx from Binance means the execution status is unknown, not
                // that the request failed: the order may already be on the book.
                reject(new FuturesApiError(
                    parsed?.msg || `Futures REST ${method} failed (${response.statusCode})`,
                    {
                        status: response.statusCode,
                        code: parsed?.code,
                        body: parsed ?? text,
                        indeterminate: response.statusCode >= 500,
                    },
                ));
            });
        });
        // The request was already written when the timeout fires, so Binance may
        // have processed it. That is indeterminate, not failed.
        request.on('timeout', () => request.destroy(new FuturesApiError(
            'Futures REST request timed out',
            { code: 'ETIMEDOUT', indeterminate: true },
        )));
        request.on('error', error => reject(
            error instanceof FuturesApiError
                ? error
                : new FuturesApiError(error?.message || 'Futures REST transport failed', {
                    code: error?.code,
                    indeterminate: isIndeterminateTradingFailure(error),
                }),
        ));
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
    const orderKind = overrides.orderKind ?? order.orderKind ?? 'REGULAR';
    // A stop or take-profit rests at its trigger. The market-triggered kinds
    // carry `price` as `0`, so an order read without this one is priced at
    // nothing everywhere it is shown — in the list, in its size, in its total.
    // Algo orders state their own trigger through the overrides below.
    const stopPrice = order.stopPrice ?? order.sp;
    // What the fill *was*, not just that the order moved. The stream carries the
    // trade on the same message — its id, the price it printed at, what it
    // realized and what it cost — and the desk dropped all four, so the account
    // review had to be re-read from Binance to show a fill it had already been
    // told about.
    const tradeId = order.tradeId ?? order.t;
    const lastFilledPrice = order.lastFilledPrice ?? order.L;
    const realizedPnl = order.realizedPnl ?? order.rp;
    const commission = order.commission ?? order.n;
    const commissionAsset = order.commissionAsset ?? order.N;
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
        orderKind,
        orderSource: orderKind,
        sourceOrderId: order.orderId ?? order.i,
        ...(avgPrice !== undefined ? { avgPrice } : {}),
        ...(Number(stopPrice) > 0 ? { triggerPrice: stopPrice } : {}),
        ...(tradeId === undefined || tradeId === null ? {} : { tradeId }),
        ...(lastFilledPrice === undefined ? {} : { lastFilledPrice }),
        ...(realizedPnl === undefined ? {} : { realizedPnl }),
        ...(commission === undefined ? {} : { commission }),
        ...(commissionAsset === undefined ? {} : { commissionAsset }),
        T: timestamp,
        transactTime: timestamp,
        time: timestamp,
        ...overrides,
    };
};

export const FUTURES_HISTORY_LIMIT = 100;
// Fills are read far deeper than orders, because they are not read as a list.
// They are folded back into the positions they formed, and a fold that starts in
// the middle of a position reports a round it cannot state the entry of — while
// everything older than the cut is simply not there. A hundred fills is an hour
// on a contract that closes in five, which is how a whole day of closed positions
// went missing from the review. This is the endpoint's own ceiling, and the read
// costs the same weight at any depth.
export const FUTURES_TRADE_HISTORY_LIMIT = 1000;
// One income row per realizing fill: a week of them overruns a single page, and
// Binance answers a `startTime` with the *oldest* rows after it.
export const FUTURES_INCOME_PAGE_LIMIT = 1000;

const historyNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

// An exchange identity a history read may page from. Carried as digits rather
// than as a number: an `orderId` outgrows a double, and one rounded on the way
// into the query asks for a row that does not exist.
const pagingIdentity = (value) => {
    const identity = String(value ?? '').trim();
    return /^\d{1,20}$/.test(identity) ? identity : null;
};

// History rows are read-only and never re-enter the execution path, so they are
// projected to exactly the fields the review surface renders.
export const normalizeFuturesHistoryOrder = (order = {}) => Object.freeze({
    orderId: order.orderId ?? null,
    clientOrderId: order.clientOrderId ?? null,
    symbol: order.symbol ?? null,
    side: order.side ?? null,
    positionSide: order.positionSide ?? 'BOTH',
    type: order.origType ?? order.type ?? null,
    status: order.status ?? null,
    price: order.price ?? '0',
    averagePrice: order.avgPrice ?? '0',
    origQty: order.origQty ?? '0',
    executedQty: order.executedQty ?? '0',
    quoteQty: order.cumQuote ?? '0',
    reduceOnly: order.reduceOnly === true,
    time: historyNumber(order.updateTime ?? order.time) ?? 0,
});

export const normalizeFuturesHistoryTrade = (trade = {}) => Object.freeze({
    id: trade.id ?? null,
    orderId: trade.orderId ?? null,
    symbol: trade.symbol ?? null,
    side: trade.side ?? null,
    positionSide: trade.positionSide ?? 'BOTH',
    price: trade.price ?? '0',
    quantity: trade.qty ?? '0',
    quoteQty: trade.quoteQty ?? '0',
    realizedPnl: trade.realizedPnl ?? '0',
    commission: trade.commission ?? '0',
    commissionAsset: trade.commissionAsset ?? null,
    maker: trade.maker === true,
    time: historyNumber(trade.time) ?? 0,
});

// What the account is configured to for one contract. `/fapi/v3/positionRisk`
// stopped reporting leverage and margin mode, and `/fapi/v1/symbolConfig` is where
// Binance moved both: without this read the desk cannot state the leverage a
// position is carried at, let alone set it.
export const normalizeFuturesSymbolConfig = (entry = {}) => {
    const symbol = typeof entry.symbol === 'string' ? entry.symbol.toUpperCase() : null;
    if (symbol === null) return null;
    const leverage = historyNumber(entry.leverage);
    const marginType = String(entry.marginType ?? '').toUpperCase() || null;
    return Object.freeze({
        symbol,
        // Never a confident default: a leverage the exchange did not report is
        // absent, and 1× would read as an account trading unlevered.
        leverage: leverage !== null && leverage >= 1 ? Math.floor(leverage) : null,
        marginType,
        maxNotionalValue: entry.maxNotionalValue ?? null,
    });
};

// The highest leverage this contract allows. Bracket 1 is the lowest notional
// band and carries the highest multiple, which is the ceiling Binance refuses a
// higher setting against.
export const readFuturesMaxLeverage = (payload) => {
    const entries = Array.isArray(payload) ? payload : [payload];
    let ceiling = null;
    for (const entry of entries) {
        for (const bracket of Array.isArray(entry?.brackets) ? entry.brackets : []) {
            const leverage = historyNumber(bracket?.initialLeverage);
            if (leverage === null || leverage < 1) continue;
            if (ceiling === null || leverage > ceiling) ceiling = Math.floor(leverage);
        }
    }
    return ceiling;
};

// Which contracts this account traded, newest first. Income history is the only
// USDⓈ-M read that answers that without being told a symbol first — every trade
// and order history endpoint requires one — so it is what a review of the whole
// session has to start from.
export const readFuturesTradedSymbols = (income) => {
    const rows = (Array.isArray(income) ? income : [])
        .filter(row => typeof row?.symbol === 'string' && row.symbol !== '')
        .sort((left, right) => (historyNumber(right?.time) ?? 0) - (historyNumber(left?.time) ?? 0));
    const symbols = [];
    for (const row of rows) {
        const symbol = row.symbol.toUpperCase();
        if (!symbols.includes(symbol)) symbols.push(symbol);
    }
    return symbols;
};

export const normalizeFuturesAlgoOrder = (order = {}) => {
    const algoId = order.algoId ?? order.orderId;
    const clientAlgoId = order.clientAlgoId ?? order.clientOrderId;
    const triggerPrice = order.triggerPrice ?? order.stopPrice ?? '0';
    return normalizeFuturesExecutionReport({
        ...order,
        orderId: algoId,
        clientOrderId: clientAlgoId,
        type: order.orderType ?? order.algoType ?? order.type,
        status: order.algoStatus ?? order.status ?? 'NEW',
        updateTime: order.updateTime ?? order.createTime,
        price: order.price ?? triggerPrice,
        origQty: order.quantity ?? order.origQty,
    }, {
        orderKind: 'ALGO',
        orderSource: 'ALGO',
        sourceOrderId: algoId,
        algoId,
        clientAlgoId,
        triggerPrice,
        closePosition: order.closePosition === true,
        workingType: order.workingType,
        priceProtect: order.priceProtect,
        algoType: order.algoType,
    });
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
        if (entry.asset === 'USDT'
            || parseFloat(entry.balance) > 0
            || parseFloat(entry.availableBalance) > 0) {
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
            // The funds actually walled off behind an isolated position. It is
            // also what tells the two margin modes apart now that the read no
            // longer reports one: a cross position has no isolated wallet.
            isolatedWallet: entry.isolatedWallet,
            notional: entry.notional,
            // /fapi/v3/positionRisk reports neither leverage nor margin mode, so
            // the margin actually committed is the only basis left for ROE.
            initialMargin: entry.initialMargin ?? entry.positionInitialMargin,
            maintenanceMargin: entry.maintMargin,
        }))
);

// What a fill actually changes that no stream states in full: the wallet and the
// position it moved. The working orders are not among them — the report carries
// the order itself, and re-reading the account for it cost weight 40 twice.
const FUTURES_FILL_REFRESH_RESOURCES = Object.freeze(['balances', 'positions']);

export const normalizeFuturesUserDataStreamEvent = (payload = {}) => {
    if (payload?.e === 'ORDER_TRADE_UPDATE') {
        const executionReport = normalizeFuturesExecutionReport(payload);
        return {
            type: 'executionReport',
            executionReport,
            rendererPayload: { futures_execution_update: executionReport },
            shouldRefreshAccount: executionReport.status === 'FILLED'
                || executionReport.status === 'PARTIALLY_FILLED',
            refreshResources: FUTURES_FILL_REFRESH_RESOURCES,
        };
    }
    if (payload?.e === 'ACCOUNT_UPDATE') {
        return {
            type: 'accountUpdate',
            rendererPayload: null,
            shouldRefreshAccount: true,
            refreshResources: FUTURES_FILL_REFRESH_RESOURCES,
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
    regularOrders: 40,
    algoOrders: 40,
    positions: 5,
};

const FUTURES_ACCOUNT_REFRESH_ERROR_LABELS = {
    balances: 'Futures Balances Fetch Error',
    regularOrders: 'Futures Regular Orders Fetch Error',
    algoOrders: 'Futures ALGO Orders Fetch Error',
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

    getRegularOpenOrdersPayload() {
        return this.getOpenOrders()
            .then(orders => ({
                futures_regular_orders: orders.map(order => normalizeFuturesExecutionReport(order)),
            }));
    }

    getOpenAlgoOrders() {
        return this.#signedRequest('GET', '/fapi/v1/openAlgoOrders');
    }

    getOpenAlgoOrdersPayload() {
        return this.getOpenAlgoOrders()
            .then(orders => ({
                futures_algo_orders: orders.map(normalizeFuturesAlgoOrder),
            }));
    }

    getAccountRefreshOperations() {
        return [
            {
                type: 'balances',
                weight: FUTURES_ACCOUNT_REFRESH_WEIGHTS.balances,
                errorLabel: FUTURES_ACCOUNT_REFRESH_ERROR_LABELS.balances,
                loadPayload: () => this.getBalancesPayload(),
            },
            {
                type: 'regularOrders',
                weight: FUTURES_ACCOUNT_REFRESH_WEIGHTS.regularOrders,
                errorLabel: FUTURES_ACCOUNT_REFRESH_ERROR_LABELS.regularOrders,
                loadPayload: () => this.getRegularOpenOrdersPayload(),
            },
            {
                type: 'algoOrders',
                weight: FUTURES_ACCOUNT_REFRESH_WEIGHTS.algoOrders,
                errorLabel: FUTURES_ACCOUNT_REFRESH_ERROR_LABELS.algoOrders,
                loadPayload: () => this.getOpenAlgoOrdersPayload(),
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

    // Binance USDⓈ-M amendment: reprices/resizes a live LIMIT order in one call.
    // The order survives a rejection, so a failed move never leaves the trader
    // without the order they meant to reprice.
    async modifyOrder(command) {
        const params = {
            symbol: command.symbol,
            side: command.side,
            quantity: String(command.numericQuantity ?? command.quantity),
            price: String(command.numericPrice ?? command.price),
        };
        if (command.orderId) params.orderId = command.orderId;
        else if (command.origClientOrderId) params.origClientOrderId = command.origClientOrderId;
        const data = await this.#signedRequest('PUT', '/fapi/v1/order', params);
        return normalizeFuturesExecutionReport(data, { x: 'AMENDMENT' });
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

    // Conditional orders live in their own book: `/fapi/v1/allOpenOrders` does
    // not touch them, so a cancel-all that called only it left every stop and
    // take-profit live on the exchange while the desk showed an empty list.
    // Route reviewed against the official catalogue on 2026-07-13/14 and
    // recorded in `docs/futures_phase7_guarded_production_design.md`.
    async cancelAllAlgoOrders(symbol) {
        return this.#signedRequest('DELETE', '/fapi/v1/algoOpenOrders', { symbol });
    }

    // Moves margin in or out of one isolated position. No order is placed and
    // the notional does not change — what changes is the distance to
    // liquidation. Binance's `type` is 1 to add and 2 to remove.
    async adjustPositionMargin({ symbol, positionSide, direction, amount }) {
        const params = {
            symbol,
            amount: String(amount),
            type: direction === 'REMOVE' ? 2 : 1,
        };
        // The position side travels as the account read reported it: BOTH for a
        // one-way account, the explicit leg for a hedged one.
        if (positionSide) params.positionSide = positionSide;
        const data = await this.#signedRequest('POST', '/fapi/v1/positionMargin', params);
        return {
            symbol,
            positionSide: positionSide ?? 'BOTH',
            direction: direction === 'REMOVE' ? 'REMOVE' : 'ADD',
            amount: String(data?.amount ?? amount),
        };
    }

    // Asks the exchange what became of one command, by the identity that command
    // carried — the client id it was submitted with, or the exchange id of the
    // order it targeted. This is the only way to answer an ambiguous submission
    // without guessing: `exists: false` is Binance stating the order is not
    // there, which is the sole condition under which the same intent may be
    // sent again.
    async findOrder({ symbol, orderId, origClientOrderId }) {
        const params = { symbol };
        if (orderId) params.orderId = orderId;
        else if (origClientOrderId) params.origClientOrderId = origClientOrderId;
        else throw new FuturesApiError('An order lookup needs an order id or a client order id');
        try {
            const data = await this.#signedRequest('GET', '/fapi/v1/order', params);
            return { exists: true, report: normalizeFuturesExecutionReport(data) };
        } catch (error) {
            if (Number(error?.code) === FUTURES_ORDER_NOT_FOUND_CODE) {
                return { exists: false, report: null };
            }
            throw error;
        }
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

    // History is bounded at the source: a desk reviews the last session, not the
    // last year, and an unbounded reply would have to be trimmed here anyway.
    //
    // It can also be read forward from a row already held. Binance answers
    // `allOrders` with orders at or after `orderId` and `userTrades` with trades
    // at or after `fromId`, oldest first — so a read from an identity is a read
    // of the gap, and the row the caller already had is the first thing it
    // returns. An answer that fills the limit means the gap was deeper than one
    // page, and the caller asks again from the last identity it received.
    async getOrderHistory({ symbol, limit = FUTURES_HISTORY_LIMIT, fromOrderId = null }) {
        const from = pagingIdentity(fromOrderId);
        const data = await this.#signedRequest('GET', '/fapi/v1/allOrders', {
            symbol,
            limit: Math.min(Math.max(Number(limit) || FUTURES_HISTORY_LIMIT, 1), 500),
            ...(from === null ? {} : { orderId: from }),
        });
        return (Array.isArray(data) ? data : [])
            .map(order => normalizeFuturesHistoryOrder(order))
            .sort((left, right) => right.time - left.time);
    }

    async getTradeHistory({ symbol, limit = FUTURES_TRADE_HISTORY_LIMIT, fromTradeId = null }) {
        const from = pagingIdentity(fromTradeId);
        const data = await this.#signedRequest('GET', '/fapi/v1/userTrades', {
            symbol,
            limit: Math.min(Math.max(Number(limit) || FUTURES_TRADE_HISTORY_LIMIT, 1), 1000),
            ...(from === null ? {} : { fromId: from }),
        });
        return (Array.isArray(data) ? data : [])
            .map(trade => normalizeFuturesHistoryTrade(trade))
            .sort((left, right) => right.time - left.time);
    }

    // Reads Binance's own record of what this contract is set to, rather than
    // inferring it: an inferred leverage would be a guess printed beside money.
    async getSymbolConfig(symbol) {
        const data = await this.#signedRequest('GET', '/fapi/v1/symbolConfig', { symbol });
        const entries = Array.isArray(data) ? data : [data];
        const wanted = String(symbol ?? '').toUpperCase();
        const entry = entries.find(candidate => (
            String(candidate?.symbol ?? '').toUpperCase() === wanted
        )) ?? entries[0];
        return entry ? normalizeFuturesSymbolConfig(entry) : null;
    }

    async getMaxLeverage(symbol) {
        const data = await this.#signedRequest('GET', '/fapi/v1/leverageBracket', { symbol });
        return readFuturesMaxLeverage(data);
    }

    // Binance answers with the leverage it actually applied, which can be lower
    // than the one asked for when a position is already too large for the bracket.
    async setLeverage({ symbol, leverage }) {
        const data = await this.#signedRequest('POST', '/fapi/v1/leverage', {
            symbol,
            leverage: String(leverage),
        });
        return normalizeFuturesSymbolConfig({
            symbol: data?.symbol ?? symbol,
            leverage: data?.leverage ?? leverage,
            maxNotionalValue: data?.maxNotionalValue ?? null,
        });
    }

    // Binance answers a mode the contract is already in with -4046 rather than
    // with success, and refuses the change outright while a position or an order
    // is open on the contract. Neither is interpreted here: this returns what the
    // exchange said and the caller decides what it means.
    async setMarginType({ symbol, marginType }) {
        return this.#signedRequest('POST', '/fapi/v1/marginType', {
            symbol,
            marginType: String(marginType).toUpperCase(),
        });
    }

    // Bounded by time rather than by count: what is wanted is the set of contracts
    // traded in the window, and the amounts on these rows are never read.
    //
    // One page of it, not the window. Binance answers a `startTime` with the
    // oldest rows after it, so a week that overruns the page hands back the
    // contracts the account traded seven days ago and never reaches this
    // morning's. The page therefore reports whether it came back full and where
    // it ended, which is what lets the caller walk forward to the recent end.
    async getTradedSymbolPage({ startTime, endTime = null, limit = FUTURES_INCOME_PAGE_LIMIT }) {
        const bounded = Math.min(Math.max(Number(limit) || FUTURES_INCOME_PAGE_LIMIT, 1), 1000);
        const data = await this.#signedRequest('GET', '/fapi/v1/income', {
            incomeType: 'REALIZED_PNL',
            startTime,
            // Bounding the far end is what lets the caller read the recent part of
            // the week on its own: without it every walk starts at the oldest row
            // in the whole window and spends its pages getting back to today.
            ...(Number.isFinite(Number(endTime)) ? { endTime: Number(endTime) } : {}),
            limit: bounded,
        });
        const rows = Array.isArray(data) ? data : [];
        let lastTime = null;
        for (const row of rows) {
            const time = historyNumber(row?.time);
            if (time !== null && (lastTime === null || time > lastTime)) lastTime = time;
        }
        return Object.freeze({
            symbols: readFuturesTradedSymbols(rows),
            full: rows.length >= bounded,
            lastTime,
        });
    }

    async createUserDataStreamListenKey() {
        const data = await this.#request('POST', '/fapi/v1/listenKey');
        return data?.listenKey;
    }

    renewUserDataStreamListenKey() {
        return this.#request('PUT', '/fapi/v1/listenKey');
    }
}
