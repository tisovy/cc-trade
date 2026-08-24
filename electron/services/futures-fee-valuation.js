// The BNBUSDT price of a fee's own minute, for valuing a commission charged in
// BNB inside a USDT result. Read from the exchange's minute klines — the same
// public route the desk's charts already pay for, one page per cluster of
// minutes, never a standing stream — and cached per minute: a closed minute's
// close never changes, so a price read once is a price read forever.
//
// Honesty over completeness, in both directions. A minute the exchange served
// a window for but printed no kline in is answered `null` — final, cache it,
// nothing traded — while a minute a read failed for is simply not answered, so
// the renderer can ask again. A minute still forming is never answered at all:
// its close is not a fact yet, and a cached non-fact would stay wrong forever.

export const FUTURES_FEE_VALUATION_ROUTE = '/fapi/v1/klines';
export const FUTURES_FEE_VALUATION_INTERVAL = '1m';
export const FUTURES_FEE_VALUATION_MINUTE_MS = 60_000;
// Binance charges klines by page size: up to 100 rows costs weight 1, which is
// why a read window never spans more than 100 minutes.
export const FUTURES_FEE_VALUATION_PAGE_MINUTES = 100;
export const FUTURES_FEE_VALUATION_KLINES_WEIGHT = 1;
// Bounds per command, so one ask can never spend more than a dozen weight-1
// pages. Minutes beyond the bound stay unanswered and are asked for again.
export const MAX_FUTURES_FEE_VALUATION_MINUTES = 360;
export const MAX_FUTURES_FEE_VALUATION_REQUESTS = 12;
// The cache is per-minute text; a week of trading minutes is thousands, not
// millions, but a bound keeps a runaway caller from growing it without end.
const MAX_CACHED_MINUTES_PER_PAIR = 100_000;

const FEE_VALUATION_PAIR_PATTERN = /^[A-Z0-9]{5,20}$/;

export const normalizeFuturesFeeValuationPair = (value) => {
    const pair = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return FEE_VALUATION_PAIR_PATTERN.test(pair) ? pair : null;
};

export const normalizeFuturesFeeValuationMinutes = (values) => {
    if (!Array.isArray(values)) return [];
    const minutes = new Set();
    for (const value of values) {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 0) continue;
        minutes.add(Math.floor(parsed / FUTURES_FEE_VALUATION_MINUTE_MS)
            * FUTURES_FEE_VALUATION_MINUTE_MS);
    }
    // Newest first: the minutes on the operator's screen are the newest ones,
    // and when the per-command bound cuts, it must cut the tail, not the face.
    return [...minutes]
        .sort((left, right) => right - left)
        .slice(0, MAX_FUTURES_FEE_VALUATION_MINUTES);
};

const priceTextOf = (value) => {
    const text = typeof value === 'string' ? value.trim() : String(value ?? '');
    return /^\d+(?:\.\d+)?$/.test(text) && Number(text) > 0 ? text : null;
};

export const createFuturesFeeValuationPriceSource = ({ readKlines, now = Date.now } = {}) => {
    const cacheByPair = new Map();

    const cacheFor = (pair) => {
        if (!cacheByPair.has(pair)) cacheByPair.set(pair, new Map());
        return cacheByPair.get(pair);
    };

    const minuteIsComplete = minute => minute + FUTURES_FEE_VALUATION_MINUTE_MS <= now();

    /**
     * Answers `{ prices, requested, served, readRequests, chargedWeight,
     * failed }` for one ask. `prices` carries only the minutes it can answer
     * finally — a price, or `null` for a served window with no kline — and a
     * read failure leaves its minutes out entirely rather than answering them
     * wrong.
     */
    const read = async ({ pair: rawPair, minutes: rawMinutes } = {}) => {
        const pair = normalizeFuturesFeeValuationPair(rawPair);
        const minutes = normalizeFuturesFeeValuationMinutes(rawMinutes)
            .filter(minuteIsComplete);
        const prices = {};
        if (pair === null || minutes.length === 0) {
            return {
                pair, prices, requested: 0, served: 0, readRequests: 0, chargedWeight: 0, failed: false,
            };
        }
        const cache = cacheFor(pair);
        const misses = [];
        for (const minute of minutes) {
            if (cache.has(minute)) prices[minute] = cache.get(minute);
            else misses.push(minute);
        }
        // Cluster the misses into weight-1 pages: ascending, each window
        // holding every miss within its first minute plus 99.
        const ascending = [...misses].sort((left, right) => left - right);
        const windows = [];
        for (const minute of ascending) {
            const open = windows.length === 0 ? null : windows[windows.length - 1];
            if (open !== null && minute - open[0]
                < FUTURES_FEE_VALUATION_PAGE_MINUTES * FUTURES_FEE_VALUATION_MINUTE_MS) {
                open.push(minute);
                continue;
            }
            windows.push([minute]);
        }
        // The newest windows first, under the same reasoning as the minute
        // bound above.
        const readWindows = windows.slice(-MAX_FUTURES_FEE_VALUATION_REQUESTS);
        let failed = false;
        let readRequests = 0;
        for (const window of readWindows) {
            const startTime = window[0];
            const endTime = window[window.length - 1] + FUTURES_FEE_VALUATION_MINUTE_MS - 1;
            const limit = Math.floor((window[window.length - 1] - startTime)
                / FUTURES_FEE_VALUATION_MINUTE_MS) + 1;
            let rows;
            try {
                readRequests += 1;
                rows = await readKlines({
                    symbol: pair,
                    interval: FUTURES_FEE_VALUATION_INTERVAL,
                    startTime,
                    endTime,
                    limit,
                }, FUTURES_FEE_VALUATION_KLINES_WEIGHT);
            } catch {
                // These minutes stay unanswered; the renderer may ask again.
                failed = true;
                continue;
            }
            for (const row of Array.isArray(rows) ? rows : []) {
                const openTime = Number(row?.[0]);
                const close = priceTextOf(row?.[4]);
                if (!Number.isSafeInteger(openTime)
                    || openTime % FUTURES_FEE_VALUATION_MINUTE_MS !== 0
                    || !minuteIsComplete(openTime)
                    || close === null) continue;
                cache.set(openTime, close);
            }
            for (const minute of window) {
                // The window was served: a minute with no kline in it is a
                // final absence, not a retryable failure.
                if (!cache.has(minute)) cache.set(minute, null);
                prices[minute] = cache.get(minute);
            }
            if (cache.size > MAX_CACHED_MINUTES_PER_PAIR) {
                const oldest = [...cache.keys()].sort((left, right) => left - right);
                for (const stale of oldest.slice(0, Math.floor(oldest.length / 2))) {
                    cache.delete(stale);
                }
            }
        }
        return {
            pair,
            prices,
            requested: minutes.length,
            served: Object.keys(prices).length,
            readRequests,
            chargedWeight: readRequests * FUTURES_FEE_VALUATION_KLINES_WEIGHT,
            failed,
        };
    };

    return {
        read,
        cachedMinutes: pair => cacheByPair.get(normalizeFuturesFeeValuationPair(pair))?.size ?? 0,
    };
};
