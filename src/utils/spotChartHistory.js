// The Spot chart opened on the 500 candles the bootstrap delivers and ended
// there: scrolling left ran off the data instead of loading what came before,
// and at 1h that is three weeks of a market whose range the trader is trying to
// read. Depth behind the live window is not a stream to follow but a fixed run
// to accumulate — a closed candle never changes, so it is read once, kept
// locally, and joined to the live window only where the two actually touch.

// One `/api/v3/klines` page. The route is already the reviewed public read the
// bootstrap uses and its weight does not grow with the limit, so a page is the
// cheapest depth available: one request, no credentials, no new route.
export const SPOT_CHART_HISTORY_PAGE_ROWS = 1000;
// What the chart will hold for one pair and interval. Enough for years at the
// intervals a trader scrolls, and a ceiling so a long session cannot grow the
// series, the cache write or the render cost without bound.
export const SPOT_CHART_MAX_ROWS = 5000;
// How close to the oldest loaded candle the viewport gets before the next page
// is asked for. Loading on arrival at the very edge would show the operator the
// end of the data first and the older bars afterwards.
export const SPOT_CHART_HISTORY_PREFETCH_BARS = 40;

// Every interval the panel offers except one is a fixed number of
// milliseconds. A month is not: it is 28, 29, 30 or 31 days, and it is absent
// here on purpose — a constant standing in for it read a 31-day month as a gap
// and threw away the run behind it. Ask `spotChartNextOpenTime` or
// `spotChartOpenTimeAt` for a step instead of reading one from this table.
const SPOT_CHART_INTERVAL_MS = Object.freeze({
    '1m': 60_000,
    '3m': 180_000,
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '2h': 7_200_000,
    '4h': 14_400_000,
    '6h': 21_600_000,
    '8h': 28_800_000,
    '12h': 43_200_000,
    '1d': 86_400_000,
    '3d': 259_200_000,
    '1w': 604_800_000,
});

const SPOT_CHART_CALENDAR_MONTH = '1M';

// Candles carry open time in seconds throughout the renderer; the exchange is
// asked in milliseconds. Keeping the conversion in one place is what stops a
// gap check from comparing one unit against the other.
const intervalSeconds = (interval) => {
    const intervalMs = SPOT_CHART_INTERVAL_MS[interval];
    return intervalMs === undefined ? null : intervalMs / 1000;
};

// Monthly candles open at midnight UTC on the first, which is the one thing
// about a month that does not vary.
const monthOpenTime = (time, monthsAhead) => {
    const date = new Date(time * 1000);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthsAhead, 1) / 1000;
};

// The candle that opens directly after the one that opened at `openTime`.
export const spotChartNextOpenTime = (openTime, interval) => {
    if (!Number.isFinite(openTime)) return null;
    if (interval === SPOT_CHART_CALENDAR_MONTH) return monthOpenTime(openTime, 1);
    const step = intervalSeconds(interval);
    return step === null ? null : openTime + step;
};

// The candle that holds `at`, counted from a candle known to open at or before
// it. A month is read off the calendar rather than counted, because the step
// from one month to the next is not the step from that one to the one after —
// and counted in thirty-day blocks a chart opens a March candle on the second.
export const spotChartOpenTimeAt = (openTime, at, interval) => {
    if (!Number.isFinite(openTime) || !Number.isFinite(at) || at < openTime) return null;
    if (interval === SPOT_CHART_CALENDAR_MONTH) return monthOpenTime(at, 0);
    const step = intervalSeconds(interval);
    if (step === null) return null;
    return openTime + Math.floor((at - openTime) / step) * step;
};

// Binance reads `endTime` inclusively, so one millisecond before the oldest
// loaded open time is the newest candle strictly behind the loaded window.
export const spotChartHistoryEndTime = (series) => {
    const oldest = Array.isArray(series) ? series[0]?.time : null;
    if (!Number.isFinite(oldest) || oldest <= 0) return null;
    return Math.floor(oldest * 1000) - 1;
};

const ascendingRows = (rows) => (Array.isArray(rows) ? rows : [])
    .filter(row => Number.isFinite(row?.time))
    .slice()
    .sort((left, right) => left.time - right.time);

/**
 * Joins two runs of candles into one ascending series.
 *
 * `arriving` wins a collision, so the caller states freshness by argument
 * order: a live window arrives over the history already held, and a history
 * page arrives under the live window that is still ticking.
 */
export const mergeSpotChartSeries = (existing, arriving, {
    interval,
    maxRows = SPOT_CHART_MAX_ROWS,
} = {}) => {
    const held = ascendingRows(existing);
    const incoming = ascendingRows(arriving);
    if (incoming.length === 0) return held.slice(-maxRows);
    if (held.length === 0) return incoming.slice(-maxRows);

    // Two runs that do not touch cannot be joined without inventing the candles
    // between them. The run reaching furthest into the present wins outright: a
    // chart may be short, but it may never present a hole as continuous data.
    const older = held[0].time <= incoming[0].time ? held : incoming;
    const newer = older === held ? incoming : held;
    const nextOpen = spotChartNextOpenTime(older.at(-1).time, interval);
    if (nextOpen !== null && nextOpen < newer[0].time) {
        const survivor = held.at(-1).time >= incoming.at(-1).time ? held : incoming;
        return survivor.slice(-maxRows);
    }

    const byTime = new Map(held.map(row => [row.time, row]));
    for (const row of incoming) byTime.set(row.time, row);
    return [...byTime.values()]
        .sort((left, right) => left.time - right.time)
        .slice(-maxRows);
};

// Scrolling into the left edge is the request for more history: the operator is
// asking to see what came before, and the chart answers by loading it rather
// than by ending.
export const reachedSpotHistoryEdge = (range, prefetchBars = SPOT_CHART_HISTORY_PREFETCH_BARS) => {
    const from = Number(range?.from);
    return Number.isFinite(from) && from <= prefetchBars;
};
