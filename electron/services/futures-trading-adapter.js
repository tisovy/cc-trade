import { createHmac } from 'node:crypto';
import https from 'node:https';
import { futuresAccountFingerprint } from './futures-settled-income-store.js';
import { isIndeterminateTradingFailure } from './trading-command-outcome.js';

export const FUTURES_REST_ORIGIN = 'https://fapi.binance.com';
export const FUTURES_STREAM_ORIGIN = 'wss://fstream.binance.com';

// The unrouted paths `/ws` and `/stream` were decommissioned on 2026-04-23,
// when Binance split the service into `/public`, `/market` and `/private`. The
// notice states the consequence outright: connections that were not migrated
// "will ONLY be able to receive data from wss://fstream.binance.com/public.
// Channels under /market and /private will stop pushing data." This desk's
// market feeds were migrated; the user-data stream was not, because the note
// recording the decommissioning scoped it to market paths
// (futures-mark-price-feed.js:33-39) and the ADR's WebSocket registry had no
// row for this socket at all. The failure is silent by construction — the
// handshake succeeds, the socket stays open, and no frame ever arrives — so the
// desk goes on believing a stream speaks for its orders and positions while
// nothing does.
//
// No `events` filter, deliberately. The parameter is optional, and omitting it
// is what asks for everything: the desk folds ORDER_TRADE_UPDATE,
// ACCOUNT_UPDATE and listenKeyExpired today, and a list written here would
// silently exclude whatever it grows to fold next.
export const FUTURES_USER_DATA_ROUTED_PREFIX = '/private/ws?listenKey=';

export const futuresUserDataStreamUrl = (streamOrigin, listenKey) => (
    `${streamOrigin}${FUTURES_USER_DATA_ROUTED_PREFIX}${encodeURIComponent(listenKey)}`
);

// The listen key is a bearer credential: whoever holds it can read the
// account's own event stream for as long as it lives. The route is the part
// worth recording, and it is the part that hid for four months; the key is the
// part that must not reach a log the operator may hand to anyone. Both URL
// shapes are covered so that falling back to the path form cannot start leaking
// it.
export const redactFuturesListenKey = url => String(url)
    .replace(/(listenKey=)[^&#]+/, '$1<redacted>')
    .replace(/(\/ws\/)[^/?#]+/, '$1<redacted>');

const DEFAULT_RECV_WINDOW = 5000;
// How long a futures REST request is given before the desk stops waiting for
// it. Exported because the pool below is sized against it: this timeout and the
// queue's admission spacing together decide the most requests that can be in
// the air at once.
export const FUTURES_REST_REQUEST_TIMEOUT_MS = 10000;

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

// A connection outlives the request that opened it, because opening one costs
// more than using it. Measured 2026-08-16 against the live exchange on this
// desk's own route and proxy: a request that opens its own connection answers
// in 630 ms, the same request on a connection already open answers in 325 ms,
// with 2 ms of spread across four samples. The ~305 ms between the two was paid
// on every account beat, every history page and every command.
//
// `maxFreeSockets` is held to what one account beat needs at once, read off the
// live record on 2026-08-16: the beat asks for four resources, the desk admits
// one read every 150 ms, and a reused connection answers in ~325 ms — so three
// are in the air when the third is admitted. Held at two, the third had no free
// connection and opened one, and the record showed exactly that: one
// `futures-rest-unpooled` line every thirty seconds, once per beat, at the cold
// price. Four is the beat's own width, so the beat costs no openings at all.
//
// `maxSockets` is a runaway bound and nothing else, and it must stay above
// anything this desk can put in flight — a request that finds no free socket
// waits in the agent, invisibly, and what waits may be the operator's command.
// The desk's own ceiling is its admission spacing against its request timeout:
// ceil(10 000 ms / 150 ms) = 67 reads, plus the commands and the listen-key
// renewal that skip admission entirely. Below that the agent becomes a second
// queue behind the first, and the effect compounds — queueing raises the
// observed latency, which raises how many are in flight, which queues more.
// The relationship is held by a test rather than by this paragraph:
// `keeps the bound on the pool above the bound this queue needs`, which reads
// both numbers from where they are defined.
export const FUTURES_REST_CONNECTION_POOL = Object.freeze({
    keepAlive: true,
    maxSockets: 72,
    maxFreeSockets: 4,
});

// Used when no proxy is configured, so that route has the same pool and the
// same fallback as the proxied one instead of falling through to whatever
// Node's global agent happens to be.
const pooledDirectAgent = new https.Agent(FUTURES_REST_CONNECTION_POOL);
const freshDirectAgent = new https.Agent({ keepAlive: false });

const FUTURES_REST_FAULT_PHASE = 'futures-rest';
const FUTURES_REST_UNPOOLED_PHASE = 'futures-rest-unpooled';

// A pooled connection can be closed by the far side while it sits idle and
// handed to a request in the instant before Node notices. The far side's stack
// then refuses the bytes, so the exchange never sees the request — which is what
// makes exactly these two codes, and only before a response has begun, safe to
// send a second time. Nothing wider is: a request that may have been received is
// an indeterminate outcome, and this desk already carries it as one.
const CONNECTION_LOST_BEFORE_ANSWER = new Set(['ECONNRESET', 'EPIPE']);

// Marks the one failure that reuse introduced and reuse may therefore repair.
// Private to this module on purpose: the rule above is the whole safety
// argument, and a property nothing outside can read is a rule nothing outside
// can widen.
const RETRY_ON_A_CONNECTION_OF_ITS_OWN = Symbol('pooled connection lost before the exchange answered');

const httpsJsonRequestOnce = ({ url, method, headers, body, agent, recordEvent }) => (
    new Promise((resolve, reject) => {
        const startedAt = Date.now();
        let answering = false;

        // Only a request that had to open a connection writes a line. Being
        // served from the pool is the working case, and the working case — four
        // resources every thirty seconds, plus every page of a history sweep —
        // would fill the record with its own success. Their absence is the
        // evidence; their return is the alarm.
        const recordUnpooledRequest = (outcome) => {
            if (!recordEvent || request.reusedSocket) return;
            recordEvent('timing', {
                phase: FUTURES_REST_UNPOOLED_PHASE,
                durationMs: Date.now() - startedAt,
                outcome,
                cache: 'miss',
            });
        };

        const request = https.request(url, {
            method,
            headers,
            agent,
            timeout: FUTURES_REST_REQUEST_TIMEOUT_MS,
        }, (response) => {
            answering = true;
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
                    recordUnpooledRequest('ok');
                    resolve(parsed);
                    return;
                }
                recordUnpooledRequest('error');
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
        request.on('error', (error) => {
            recordUnpooledRequest('error');
            const failure = error instanceof FuturesApiError
                ? error
                : new FuturesApiError(error?.message || 'Futures REST transport failed', {
                    code: error?.code,
                    indeterminate: isIndeterminateTradingFailure(error),
                });
            if (request.reusedSocket
                && !answering
                && CONNECTION_LOST_BEFORE_ANSWER.has(error?.code)) {
                failure[RETRY_ON_A_CONNECTION_OF_ITS_OWN] = true;
            }
            reject(failure);
        });
        if (body) request.write(body);
        request.end();
    })
);

// The request as first composed is what goes out again — same body, same
// signature, same command identity — so a duplicate arising any other way is
// refused by the exchange rather than filled.
const httpsJsonRequest = async ({ freshAgent = null, recordEvent = null, ...attempt }) => {
    try {
        return await httpsJsonRequestOnce({ ...attempt, recordEvent });
    } catch (failure) {
        if (freshAgent === null || failure?.[RETRY_ON_A_CONNECTION_OF_ITS_OWN] !== true) throw failure;
        recordEvent?.('fault', {
            phase: FUTURES_REST_FAULT_PHASE,
            code: 'CONNECTION_REUSE_FALLBACK',
        });
        try {
            return await httpsJsonRequestOnce({ ...attempt, agent: freshAgent, recordEvent });
        } catch (fallbackFailure) {
            recordEvent?.('fault', {
                phase: FUTURES_REST_FAULT_PHASE,
                code: 'CONNECTION_REUSE_FALLBACK_FAILED',
            });
            throw fallbackFailure;
        }
    }
};

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

// The settled-money read asks for every kind of flow in one request. Binance's
// own note on the endpoint: "If incomeType is not sent, all kinds of flow will be
// returned" — so one read at weight 30 answers for realized PnL, funding,
// commission, insurance clearance and the rebates together, where naming them
// would have cost one read each. The kinds this desk actually sums are chosen
// after the read, here, so a kind the desk does not recognize is carried rather
// than silently dropped by the query.
export const FUTURES_SETTLED_INCOME_TYPES = Object.freeze([
    'REALIZED_PNL',
    'FUNDING_FEE',
    'COMMISSION',
    'INSURANCE_CLEAR',
    // Rebates offset commission. An account trading on one that counted only
    // what it was charged would overstate what the position cost it.
    'COMMISSION_REBATE',
    'REFERRAL_KICKBACK',
    'API_REBATE',
    'FEE_RETURN',
]);

// Binance keeps income history for the last three months and nothing before it.
// A window asking past this is not answered with older rows; it is answered with
// silence that reads exactly like a position that was never charged anything.
export const FUTURES_INCOME_HISTORY_REACH_MS = 90 * 24 * 60 * 60 * 1000;

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

const historyIdentity = (value) => {
    if (typeof value === 'string') return pagingIdentity(value);
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
};

// History rows are read-only and never re-enter the execution path, so they are
// projected to exactly the fields the review surface renders.
export const normalizeFuturesHistoryOrder = (order = {}) => Object.freeze({
    orderId: historyIdentity(order.orderId),
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
    id: historyIdentity(trade.id),
    orderId: historyIdentity(trade.orderId),
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

const leverageBracketAmount = (value, { allowZero = true } = {}) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) return null;
    return String(value);
};

const normalizeFuturesLeverageBracket = (bracket) => {
    const initialLeverage = historyNumber(bracket?.initialLeverage);
    const notionalFloor = leverageBracketAmount(bracket?.notionalFloor);
    const notionalCap = leverageBracketAmount(bracket?.notionalCap, { allowZero: false });
    const maintMarginRatio = leverageBracketAmount(bracket?.maintMarginRatio);
    const cum = leverageBracketAmount(bracket?.cum);
    if (initialLeverage === null
        || initialLeverage < 1
        || notionalFloor === null
        || notionalCap === null
        || Number(notionalCap) < Number(notionalFloor)
        || maintMarginRatio === null
        || cum === null) return null;
    return Object.freeze({
        initialLeverage: Math.floor(initialLeverage),
        notionalFloor,
        notionalCap,
        maintMarginRatio,
        cum,
    });
};

// The full maintenance table from the same answer the desk already reads for
// its leverage ceiling. Selecting the requested symbol matters when a fixture
// or a future endpoint shape carries more than one contract: a table from a
// different contract is worse than no table at all.
export const readFuturesLeverageBracketTable = (payload, symbol = null) => {
    const entries = Array.isArray(payload) ? payload : [payload];
    const wanted = typeof symbol === 'string' && symbol !== '' ? symbol.toUpperCase() : null;
    const matching = wanted === null
        ? null
        : entries.find(candidate => String(candidate?.symbol ?? '').toUpperCase() === wanted);
    const soleUnlabelled = entries.length === 1
        && (entries[0]?.symbol === null
            || entries[0]?.symbol === undefined
            || entries[0]?.symbol === '')
        ? entries[0]
        : null;
    const entry = matching ?? (wanted === null ? entries[0] : soleUnlabelled) ?? null;
    const resolvedSymbol = typeof entry?.symbol === 'string' && entry.symbol !== ''
        ? entry.symbol.toUpperCase()
        : wanted;
    if (entry === null || resolvedSymbol === null) return null;
    const rawBrackets = Array.isArray(entry.brackets) ? entry.brackets : [];
    const normalizedBrackets = rawBrackets.map(normalizeFuturesLeverageBracket);
    const brackets = normalizedBrackets
        .filter(bracket => bracket !== null)
        .sort((left, right) => Number(left.notionalFloor) - Number(right.notionalFloor));
    if (brackets.length === 0) return null;
    const hasNotionalCoef = entry.notionalCoef !== null
        && entry.notionalCoef !== undefined
        && entry.notionalCoef !== '';
    const notionalCoef = hasNotionalCoef
        ? leverageBracketAmount(entry.notionalCoef, { allowZero: false })
        : null;
    // Binance calls this a multiplier relative to the default brackets, but the
    // endpoint does not say whether its returned floors/caps/cumulative amount
    // have already been adjusted. The ceiling is still exchange-stated; margin
    // arithmetic is unavailable rather than applying or ignoring the multiplier.
    const marginEstimatesAvailable = normalizedBrackets.every(bracket => bracket !== null)
        && (!hasNotionalCoef || (notionalCoef !== null && Number(notionalCoef) === 1));
    const maxLeverage = brackets.reduce(
        (ceiling, bracket) => Math.max(ceiling, bracket.initialLeverage),
        0,
    );
    return Object.freeze({
        symbol: resolvedSymbol,
        maxLeverage,
        brackets: Object.freeze(brackets),
        ...(notionalCoef === null ? {} : { notionalCoef }),
        ...(marginEstimatesAvailable ? {} : { marginEstimatesAvailable: false }),
    });
};

// Which contracts this account traded, newest first. Income history is the only
// USDⓈ-M read that answers that without being told a symbol first — every trade
// and order history endpoint requires one — so it is what a review of the whole
// session has to start from.
// One movement of the account's money, as the exchange records it.
//
// `income` is signed the exchange's way: positive is an inflow, so funding paid,
// commission and insurance clearance all arrive negative and a fold sums them.
// It is the opposite convention to a fill's `commission`, which is an unsigned
// magnitude to be subtracted, and both records reach this desk — so the sign is
// carried exactly as read and never normalized here into "an amount".
//
// `symbol` and `tradeId` are documented "if existing": a transfer names no
// contract, and funding is not a trade. The absence is what decides whether a
// row can be attributed to a position leg at all, so it is preserved as null
// rather than defaulted.
export const normalizeFuturesIncomeRow = (row = {}) => Object.freeze({
    symbol: typeof row.symbol === 'string' && row.symbol.length > 0
        ? row.symbol.toUpperCase()
        : null,
    incomeType: typeof row.incomeType === 'string' && row.incomeType.length > 0
        ? row.incomeType
        : null,
    income: typeof row.income === 'string' ? row.income : String(row.income ?? '0'),
    asset: typeof row.asset === 'string' && row.asset.length > 0 ? row.asset : null,
    time: historyNumber(row.time) ?? 0,
    // `tranId` is unique only within one income type — Binance says so on the
    // endpoint — so neither field identifies a row on its own.
    tranId: historyIdentity(row.tranId),
    tradeId: historyIdentity(row.tradeId),
});

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
        // The regular order this algo spawned when it fired, and the price that
        // order was placed at. Without them the desk cannot connect the two
        // facts it already holds — an execution report for order X, and the
        // algo parent whose X it is — so it goes on drawing a fired stop as
        // resting at a price the market has left.
        //
        // Retained exactly as the exchange states them. Binance reports an algo
        // that has not fired with an empty string; a null or a zero would read
        // as "fired at nothing", which is the opposite of what it means. A
        // response that never mentioned the field says nothing either way, so
        // absent stays absent.
        ...(order.actualOrderId === undefined ? {} : { actualOrderId: order.actualOrderId }),
        ...(order.actualPrice === undefined ? {} : { actualPrice: order.actualPrice }),
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
                ...(entry.crossWalletBalance === undefined
                    ? {}
                    : { crossWallet: entry.crossWalletBalance }),
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
            // Position-only initial margin for like-for-like diagnostics. The
            // broader `initialMargin` above may also include open orders and
            // remains the exchange field the renderer already consumes.
            ...(entry.positionInitialMargin === undefined
                ? {}
                : { positionInitialMargin: entry.positionInitialMargin }),
            maintenanceMargin: entry.maintMargin,
        }))
);

/**
 * What an `ACCOUNT_UPDATE` actually says.
 *
 * The frame carries the account change itself — the wallet balance after it,
 * and each position it touched with its size, entry price, margin mode and
 * isolated wallet. The desk used to treat it as a doorbell and ask Binance over
 * REST for the numbers it had just been handed, which put the position on screen
 * a signed round trip (340–800 ms through the operator's proxy) after the
 * exchange had already stated it.
 *
 * Positions at zero size are kept here rather than filtered out the way a read's
 * are: zero is how the frame says a position closed, and that is exactly the
 * change the fold has to apply.
 */
export const normalizeFuturesAccountUpdate = (payload = {}) => {
    if (payload?.e !== 'ACCOUNT_UPDATE') return null;
    const account = payload.a ?? {};
    const balances = (Array.isArray(account.B) ? account.B : [])
        .filter(entry => typeof entry?.a === 'string' && entry.a.length > 0)
        .map(entry => ({
            asset: entry.a,
            // The wallet after the change. Not the free margin, which the frame
            // does not carry at all — see the read the fold asks for.
            walletBalance: entry.wb,
            crossWallet: entry.cw,
        }));
    const positions = (Array.isArray(account.P) ? account.P : [])
        .filter(entry => typeof entry?.s === 'string' && entry.s.length > 0)
        .map(entry => ({
            symbol: entry.s,
            positionSide: entry.ps ?? 'BOTH',
            quantity: entry.pa,
            entryPrice: entry.ep,
            unrealizedPnl: entry.up,
            marginType: (entry.mt ?? '').toUpperCase() || undefined,
            isolatedWallet: entry.iw,
        }));
    return {
        // Binance's own word for what moved the account — `ORDER`, `FUNDING_FEE`,
        // `DEPOSIT`, and the rest. Carried for the record, not branched on: what
        // the desk does is decided by what actually changed.
        cause: typeof account.m === 'string' ? account.m : null,
        balances,
        positions,
    };
};

/**
 * What a `MARGIN_CALL` actually says.
 *
 * Binance's own framing, quoted from the event's page: risk guidance only, and
 * in a highly volatile market the position may already have been liquidated by
 * the time this arrives. It is carried apart from the liquidation price the desk
 * computes for exactly that reason — one is the desk's reckoning, the other is
 * the exchange raising its hand.
 */
export const normalizeFuturesMarginCall = (payload = {}) => {
    if (payload?.e !== 'MARGIN_CALL') return null;
    const positions = (Array.isArray(payload.p) ? payload.p : [])
        .filter(entry => typeof entry?.s === 'string' && entry.s.length > 0)
        .map(entry => ({
            symbol: entry.s,
            positionSide: entry.ps ?? 'BOTH',
            quantity: entry.pa,
            marginType: (entry.mt ?? '').toUpperCase() || undefined,
            isolatedWallet: entry.iw,
            markPrice: entry.mp,
            unrealizedPnl: entry.up,
            // What the exchange says has to stand behind the position for it to
            // survive.
            maintenanceMargin: entry.mm,
        }));
    if (positions.length === 0) return null;
    return {
        // Sent only with a crossed position's call.
        crossWallet: typeof payload.cw === 'string' ? payload.cw : null,
        positions,
    };
};

/**
 * What an `ACCOUNT_CONFIG_UPDATE` actually says — and what it does not.
 *
 * It carries a trade pair's leverage in `ac`, and the account-wide Multi-Assets
 * switch in `ai.j`. It carries no per-contract margin mode at all: a contract's
 * mode reaches the desk as `mt` on an `ACCOUNT_UPDATE` position, so a mode
 * changed on a contract the operator is flat in is not announced by anything,
 * and only a read will find it. Written down here because the field's absence is
 * otherwise indistinguishable from an oversight.
 */
export const normalizeFuturesAccountConfigUpdate = (payload = {}) => {
    if (payload?.e !== 'ACCOUNT_CONFIG_UPDATE') return null;
    const pair = payload.ac ?? null;
    const account = payload.ai ?? null;
    const symbol = typeof pair?.s === 'string' && pair.s.length > 0 ? pair.s : null;
    // Unlike almost everything else on this stream, the leverage arrives as a
    // number rather than a decimal string.
    const leverage = Number(pair?.l);
    const carried = {
        symbol,
        leverage: symbol !== null && Number.isFinite(leverage) && leverage > 0 ? leverage : null,
        multiAssetsMargin: typeof account?.j === 'boolean' ? account.j : null,
    };
    if (carried.leverage === null && carried.multiAssetsMargin === null) return null;
    return carried;
};

/**
 * What an `ALGO_UPDATE` actually says.
 *
 * The desk lists and cancels algorithmic orders but cannot place them, and it
 * reads them on a thirty-second beat. This frame is the exchange stating the
 * same thing as it happens — including `ai`, the regular order the algo spawned,
 * which is the identity `normalizeFuturesAlgoOrder` goes to REST for as
 * `actualOrderId`, and `rm`, the reason it failed, which no read carries at all.
 */
export const normalizeFuturesAlgoUpdate = (payload = {}) => {
    if (payload?.e !== 'ALGO_UPDATE') return null;
    const order = payload.o ?? {};
    if (typeof order.s !== 'string' || order.s.length === 0) return null;
    return {
        symbol: order.s,
        algoId: order.aid,
        clientAlgoId: order.caid,
        algoType: order.at,
        orderType: order.o,
        side: order.S,
        positionSide: order.ps ?? 'BOTH',
        timeInForce: order.f,
        quantity: order.q,
        // NEW, CANCELED, TRIGGERING, TRIGGERED, FINISHED, REJECTED, EXPIRED.
        status: order.X,
        triggerPrice: order.tp,
        price: order.p,
        workingType: order.wt,
        closePosition: order.cp,
        priceProtect: order.pP,
        reduceOnly: order.R,
        // Empty until the algo is triggered and placed in the matching engine,
        // which is the same contract the read reports.
        actualOrderId: order.ai,
        actualPrice: order.ap,
        executedQuantity: order.aq,
        failureReason: typeof order.rm === 'string' && order.rm.length > 0 ? order.rm : null,
        // Only meaningful for a trailing algo.
        activated: typeof order.ia === 'boolean' ? order.ia : null,
    };
};

/**
 * A stop that met its trigger and was then refused by the matching engine.
 *
 * This is the one ending where the operator's stop does not become a position
 * and no read explains why: the order is simply gone at the next reconciliation.
 * The exchange states the reason in words, and those words are the whole value
 * of the frame.
 */
export const normalizeFuturesConditionalTriggerReject = (payload = {}) => {
    if (payload?.e !== 'CONDITIONAL_ORDER_TRIGGER_REJECT') return null;
    const refused = payload.or ?? {};
    if (typeof refused.s !== 'string' || refused.s.length === 0) return null;
    return {
        symbol: refused.s,
        orderId: refused.i,
        reason: typeof refused.r === 'string' && refused.r.length > 0 ? refused.r : null,
    };
};

// Events this desk is sent and deliberately does not act on. Written down rather
// than left to fall through, so the next reader is not left to infer a decision
// from an absence — which is how four months of a silent stream went unnoticed.
export const FUTURES_USER_DATA_EVENTS_IGNORED = Object.freeze({
    // A thinner copy of `ORDER_TRADE_UPDATE` carrying only TRADE executions. The
    // desk folds the full frame; taking both would fold every fill twice.
    TRADE_LITE: 'duplicate of ORDER_TRADE_UPDATE',
    // Binance's own grid and TWAP strategies, created in their app. This desk
    // neither places them nor lists them.
    STRATEGY_UPDATE: 'strategy this desk does not run',
    GRID_UPDATE: 'deprecated, and a strategy this desk does not run',
});

export const normalizeFuturesUserDataStreamEvent = (payload = {}) => {
    if (payload?.e === 'ORDER_TRADE_UPDATE') {
        const executionReport = normalizeFuturesExecutionReport(payload);
        return {
            type: 'executionReport',
            executionReport,
            rendererPayload: { futures_execution_update: executionReport },
        };
    }
    if (payload?.e === 'ACCOUNT_UPDATE') {
        return {
            type: 'accountUpdate',
            accountUpdate: normalizeFuturesAccountUpdate(payload),
            rendererPayload: null,
        };
    }
    if (payload?.e === 'listenKeyExpired') {
        return {
            type: 'listenKeyExpired',
            rendererPayload: null,
        };
    }
    if (payload?.e === 'MARGIN_CALL') {
        const marginCall = normalizeFuturesMarginCall(payload);
        if (marginCall === null) return null;
        return {
            type: 'marginCall',
            marginCall,
            rendererPayload: { futures_margin_call: marginCall },
        };
    }
    if (payload?.e === 'ACCOUNT_CONFIG_UPDATE') {
        const accountConfigUpdate = normalizeFuturesAccountConfigUpdate(payload);
        if (accountConfigUpdate === null) return null;
        return {
            type: 'accountConfigUpdate',
            accountConfigUpdate,
            // The change is folded into the held account state, which broadcasts
            // itself; a second payload would state it twice.
            rendererPayload: null,
        };
    }
    if (payload?.e === 'ALGO_UPDATE') {
        const algoUpdate = normalizeFuturesAlgoUpdate(payload);
        if (algoUpdate === null) return null;
        return {
            type: 'algoUpdate',
            algoUpdate,
            rendererPayload: null,
        };
    }
    if (payload?.e === 'CONDITIONAL_ORDER_TRIGGER_REJECT') {
        const triggerReject = normalizeFuturesConditionalTriggerReject(payload);
        if (triggerReject === null) return null;
        return {
            type: 'conditionalTriggerReject',
            triggerReject,
            rendererPayload: { futures_conditional_trigger_reject: triggerReject },
        };
    }
    if (FUTURES_USER_DATA_EVENTS_IGNORED[payload?.e] !== undefined) return null;
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
        // The connection a failed reuse falls back to. Given separately rather
        // than derived, because the agent that must not pool cannot be the one
        // that does.
        proxyAgentWithoutReuse = null,
        recordEvent = null,
        restOrigin = FUTURES_REST_ORIGIN,
    }) {
        this.apiKey = apiKey;
        // A digest of the key, so a reading kept on disk can name the account it
        // was read from without the account's credential being anywhere near the
        // file. Computed once; the key itself never leaves this object.
        this.credentialFingerprint = futuresAccountFingerprint(apiKey);
        this.apiSecret = apiSecret;
        this.recvWindow = recvWindow;
        this.proxyAgent = proxyAgent;
        this.proxyAgentWithoutReuse = proxyAgentWithoutReuse;
        this.recordEvent = recordEvent;
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
            agent: this.proxyAgent ?? pooledDirectAgent,
            freshAgent: this.proxyAgentWithoutReuse ?? freshDirectAgent,
            recordEvent: this.recordEvent,
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

    async getLeverageBracketTable(symbol) {
        const data = await this.#signedRequest('GET', '/fapi/v1/leverageBracket', { symbol });
        return readFuturesLeverageBracketTable(data, symbol);
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
    // oldest rows after it, so a week that overruns the first page hands back the
    // contracts the account traded seven days ago and never reaches this
    // morning's. Keep the time window fixed and use the endpoint's page number:
    // moving `startTime` past the last timestamp would skip rows when a page ends
    // in the middle of several income entries recorded in the same millisecond.
    async getTradedSymbolPage({
        startTime,
        endTime = null,
        page = 1,
        limit = FUTURES_INCOME_PAGE_LIMIT,
    }) {
        const bounded = Math.min(Math.max(Number(limit) || FUTURES_INCOME_PAGE_LIMIT, 1), 1000);
        const selectedPage = Math.max(Math.floor(Number(page) || 1), 1);
        const data = await this.#signedRequest('GET', '/fapi/v1/income', {
            incomeType: 'REALIZED_PNL',
            startTime,
            // Bounding the far end is what lets the caller read the recent part of
            // the week on its own: without it every walk starts at the oldest row
            // in the whole window and spends its pages getting back to today.
            ...(Number.isFinite(Number(endTime)) ? { endTime: Number(endTime) } : {}),
            page: selectedPage,
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

    // What the account has actually settled, over a window, for every contract at
    // once.
    //
    // Deliberately not `getTradedSymbolPage`. That read exists to answer which
    // contracts were traded and throws every amount away; it is paged, cached and
    // budgeted for an answer that moves when a trade is made. This one is the
    // amounts, and they move on every fill and every funding boundary.
    //
    // No `symbol`: the endpoint answers without one, so a desk holding five
    // positions pays once.
    //
    // `incomeType` is the caller's, and sending one is the point. The endpoint's
    // own note says what happens without it — *"If incomeType is not sent, all
    // kinds of flow will be returned"* — and until 2026-08-20 this desk sent
    // none. On the operator's account that answered **13 330** rows for a week,
    // of which **45** were funding and the other 13 285 were per-fill realized
    // PnL and commission the desk already holds from `/fapi/v1/userTrades`. It
    // paged through thirteen thousand rows of a record it was duplicating in
    // order to reach forty-five it could get nowhere else, at weight 30 a page.
    //
    // The parameter takes one value, not a list — the enum is single-valued —
    // so a caller wanting two kinds pays for two reads and still pays a fraction
    // of what asking for all of them costs.
    //
    // Paged by the endpoint's own page number against fixed time bounds. Walking
    // `startTime` forward past a page's last row would skip every other row
    // recorded in that same millisecond, which on a market close is several.
    async getIncomePage({
        startTime,
        endTime = null,
        incomeType = null,
        page = 1,
        limit = FUTURES_INCOME_PAGE_LIMIT,
    }) {
        const bounded = Math.min(Math.max(Number(limit) || FUTURES_INCOME_PAGE_LIMIT, 1), 1000);
        const selectedPage = Math.max(Math.floor(Number(page) || 1), 1);
        const kind = typeof incomeType === 'string' && incomeType.length > 0 ? incomeType : null;
        const data = await this.#signedRequest('GET', '/fapi/v1/income', {
            startTime,
            ...(Number.isFinite(Number(endTime)) ? { endTime: Number(endTime) } : {}),
            ...(kind === null ? {} : { incomeType: kind }),
            page: selectedPage,
            limit: bounded,
        });
        const rows = Array.isArray(data) ? data : [];
        return Object.freeze({
            rows: Object.freeze(rows.map(row => normalizeFuturesIncomeRow(row))),
            // A full page means there is another one behind it.
            full: rows.length >= bounded,
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
