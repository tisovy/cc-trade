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

export const SPOT_CHART_INTERVAL_MS = Object.freeze({
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
    '1M': 2_592_000_000,
});

// Candles carry open time in seconds throughout the renderer; the exchange is
// asked in milliseconds. Keeping the conversion in one place is what stops a
// gap check from comparing one unit against the other.
export const spotChartIntervalSeconds = (interval) => {
    const intervalMs = SPOT_CHART_INTERVAL_MS[interval];
    return intervalMs === undefined ? null : intervalMs / 1000;
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
    intervalSeconds,
    maxRows = SPOT_CHART_MAX_ROWS,
} = {}) => {
    const held = ascendingRows(existing);
    const incoming = ascendingRows(arriving);
    if (incoming.length === 0) return held.slice(-maxRows);
    if (held.length === 0) return incoming.slice(-maxRows);

    // Two runs that do not touch cannot be joined without inventing the candles
    // between them. The run reaching furthest into the present wins outright: a
    // chart may be short, but it may never present a hole as continuous data.
    if (Number.isFinite(intervalSeconds) && intervalSeconds > 0) {
        const older = held[0].time <= incoming[0].time ? held : incoming;
        const newer = older === held ? incoming : held;
        if (older.at(-1).time + intervalSeconds < newer[0].time) {
            const survivor = held.at(-1).time >= incoming.at(-1).time ? held : incoming;
            return survivor.slice(-maxRows);
        }
    }

    const byTime = new Map(held.map(row => [row.time, row]));
    for (const row of incoming) byTime.set(row.time, row);
    return [...byTime.values()]
        .sort((left, right) => left.time - right.time)
        .slice(-maxRows);
};

// Older candles arriving in front shift every bar's index, so the chart has to
// know how many before it can hold the viewport still.
export const countPrependedRows = (previousFirstTime, next) => {
    if (!Number.isFinite(previousFirstTime)) return 0;
    const rows = Array.isArray(next) ? next : [];
    let count = 0;
    while (count < rows.length && Number(rows[count]?.time) < previousFirstTime) count += 1;
    return count;
};

const sharesEveryRowBefore = (drawn, next, count) => {
    for (let index = 0; index < count; index += 1) {
        if (drawn[index] !== next[index]) return false;
    }
    return true;
};

/**
 * What the chart has to redraw to show `next`, given the rows it is drawing now.
 *
 * A live trade moves the last candle and leaves every other one exactly as it
 * was — every writer copies the array and keeps the untouched rows themselves —
 * so the question is answered by identity rather than by comparing values, and
 * a row settled behind the last one is not mistaken for a tick. It is asked at
 * all because the alternative is redrawing three series, a moving average over
 * every bar and the whole volume histogram for one bar's news, on a chart that
 * accumulates up to `SPOT_CHART_MAX_ROWS` of them.
 */
export const planSpotSeriesDraw = (drawn, next) => {
    const rows = Array.isArray(next) ? next : [];
    if (rows.length === 0) return 'none';
    const previous = Array.isArray(drawn) ? drawn : [];
    if (previous.length === 0) return 'full';

    // The last bar moved and no other did.
    if (rows.length === previous.length) {
        if (rows.at(-1).time !== previous.at(-1).time) return 'full';
        return sharesEveryRowBefore(previous, rows, rows.length - 1) ? 'tick' : 'full';
    }

    // A bar opened after the last one drawn. Anything else that changes the
    // length is a merge — a history page in front, a window rejoined — and a
    // merge is redrawn whole.
    if (rows.length === previous.length + 1 && rows.at(-1).time > previous.at(-1).time) {
        return sharesEveryRowBefore(previous, rows, previous.length) ? 'append' : 'full';
    }

    return 'full';
};

// Scrolling into the left edge is the request for more history: the operator is
// asking to see what came before, and the chart answers by loading it rather
// than by ending.
export const reachedSpotHistoryEdge = (range, prefetchBars = SPOT_CHART_HISTORY_PREFETCH_BARS) => {
    const from = Number(range?.from);
    return Number.isFinite(from) && from <= prefetchBars;
};
