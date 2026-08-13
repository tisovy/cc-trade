import { describe, expect, it } from 'vitest';
import {
    SPOT_CHART_HISTORY_PAGE_ROWS,
    SPOT_CHART_MAX_ROWS,
    countPrependedRows,
    mergeSpotChartSeries,
    planSpotSeriesDraw,
    reachedSpotHistoryEdge,
    spotChartHistoryEndTime,
    spotChartIntervalSeconds,
} from './spotChartHistory.js';

const HOUR = 3600;
const candle = (time, close = 100) => ({
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
});
const run = (startTime, count, step = HOUR) => Array.from(
    { length: count },
    (_unused, index) => candle(startTime + index * step),
);

describe('spotChartIntervalSeconds', () => {
    it('answers in seconds for every interval the panel offers', () => {
        expect(spotChartIntervalSeconds('1m')).toBe(60);
        expect(spotChartIntervalSeconds('1h')).toBe(HOUR);
        expect(spotChartIntervalSeconds('1d')).toBe(86_400);
    });

    it('refuses an interval it does not know rather than guessing a length', () => {
        expect(spotChartIntervalSeconds('7h')).toBeNull();
        expect(spotChartIntervalSeconds(undefined)).toBeNull();
    });
});

describe('spotChartHistoryEndTime', () => {
    // `endTime` is inclusive at Binance, so the millisecond matters: off by one
    // and every page would re-read the candle the chart already has.
    it('reads back from one millisecond before the oldest loaded candle', () => {
        expect(spotChartHistoryEndTime(run(1_700_000_000, 3))).toBe(1_700_000_000_000 - 1);
    });

    it('has nothing to read behind an empty or unusable series', () => {
        expect(spotChartHistoryEndTime([])).toBeNull();
        expect(spotChartHistoryEndTime(undefined)).toBeNull();
        expect(spotChartHistoryEndTime([{ close: 1 }])).toBeNull();
    });
});

describe('mergeSpotChartSeries', () => {
    it('prepends a history page in front of the live window', () => {
        const live = run(1_700_010_000, 3);
        const history = run(1_700_010_000 - 3 * HOUR, 3);
        const merged = mergeSpotChartSeries(history, live, { intervalSeconds: HOUR });
        expect(merged).toHaveLength(6);
        expect(merged.map(row => row.time)).toEqual([
            ...history.map(row => row.time),
            ...live.map(row => row.time),
        ]);
    });

    it('lets the arriving row win the seam, so a live candle is never overwritten by history', () => {
        const live = [candle(1_700_010_000, 555)];
        const history = [candle(1_700_010_000 - HOUR, 1), candle(1_700_010_000, 111)];
        expect(mergeSpotChartSeries(history, live, { intervalSeconds: HOUR }).at(-1).close).toBe(555);
        expect(mergeSpotChartSeries(live, history, { intervalSeconds: HOUR }).at(-1).close).toBe(111);
    });

    // The app being closed for a week is the ordinary case here. Concatenating
    // across that hole would draw last week's candles as if they were adjacent
    // to today's, which is a false chart rather than a short one.
    it('drops a run that no longer touches the one reaching into the present', () => {
        const stale = run(1_700_000_000, 5);
        const live = run(1_700_000_000 + 500 * HOUR, 5);
        expect(mergeSpotChartSeries(stale, live, { intervalSeconds: HOUR })
            .map(row => row.time)).toEqual(live.map(row => row.time));
        expect(mergeSpotChartSeries(live, stale, { intervalSeconds: HOUR })
            .map(row => row.time)).toEqual(live.map(row => row.time));
    });

    it('keeps a gap inside a single delivered page, which the exchange itself reported', () => {
        const halted = [
            candle(1_700_000_000),
            candle(1_700_000_000 + HOUR),
            candle(1_700_000_000 + 9 * HOUR),
        ];
        const live = [candle(1_700_000_000 + 10 * HOUR)];
        expect(mergeSpotChartSeries(halted, live, { intervalSeconds: HOUR })).toHaveLength(4);
    });

    it('joins runs that abut exactly, with no candle invented or lost at the seam', () => {
        const older = run(1_700_000_000, 4);
        const newer = run(1_700_000_000 + 4 * HOUR, 4);
        const merged = mergeSpotChartSeries(older, newer, { intervalSeconds: HOUR });
        expect(merged).toHaveLength(8);
        for (let index = 1; index < merged.length; index += 1) {
            expect(merged[index].time - merged[index - 1].time).toBe(HOUR);
        }
    });

    it('keeps the newest rows when the bound is reached', () => {
        const merged = mergeSpotChartSeries(
            run(1_600_000_000, 4000),
            run(1_600_000_000 + 4000 * HOUR, 2000),
            { intervalSeconds: HOUR },
        );
        expect(merged).toHaveLength(SPOT_CHART_MAX_ROWS);
        expect(merged.at(-1).time).toBe(1_600_000_000 + 5999 * HOUR);
    });

    it('survives an absent side and rows without a usable time', () => {
        expect(mergeSpotChartSeries(undefined, run(1_700_000_000, 2))).toHaveLength(2);
        expect(mergeSpotChartSeries(run(1_700_000_000, 2), null)).toHaveLength(2);
        expect(mergeSpotChartSeries([{ close: 1 }], [{ time: 'x' }])).toEqual([]);
    });

    // Without a known interval there is no way to tell a hole from a seam, so
    // the merge still joins rather than silently discarding one side.
    it('joins without an interval, because it cannot prove a gap', () => {
        expect(mergeSpotChartSeries(
            run(1_700_000_000, 2),
            run(1_700_000_000 + 500 * HOUR, 2),
            { intervalSeconds: null },
        )).toHaveLength(4);
    });
});

describe('countPrependedRows', () => {
    it('counts only the rows that arrived in front of what was drawn', () => {
        const next = run(1_700_000_000, 6);
        expect(countPrependedRows(next[2].time, next)).toBe(2);
        expect(countPrependedRows(next[0].time, next)).toBe(0);
    });

    it('counts nothing when there was no previous series to hold in place', () => {
        expect(countPrependedRows(null, run(1_700_000_000, 3))).toBe(0);
        expect(countPrependedRows(1_700_000_000, undefined)).toBe(0);
    });
});

describe('reachedSpotHistoryEdge', () => {
    it('asks before the very edge, so older bars are there when the operator arrives', () => {
        expect(reachedSpotHistoryEdge({ from: 5, to: 120 })).toBe(true);
        expect(reachedSpotHistoryEdge({ from: -3, to: 50 })).toBe(true);
        expect(reachedSpotHistoryEdge({ from: 400, to: 500 })).toBe(false);
    });

    it('treats a missing range as no request', () => {
        expect(reachedSpotHistoryEdge(null)).toBe(false);
        expect(reachedSpotHistoryEdge({})).toBe(false);
    });
});

describe('planSpotSeriesDraw', () => {
    const START = 1_700_000_000;
    const drawn = run(START, 5);
    const moved = (rows, index, close) => {
        const next = [...rows];
        next[index] = candle(next[index].time, close);
        return next;
    };

    it('answers a moved last candle with the last candle alone', () => {
        expect(planSpotSeriesDraw(drawn, moved(drawn, drawn.length - 1, 42))).toBe('tick');
    });

    it('answers a candle opening after the last one with that candle alone', () => {
        expect(planSpotSeriesDraw(drawn, [...drawn, candle(START + 5 * HOUR, 42)])).toBe('append');
    });

    // The close of the candle just past — its true high, low and volume — is a
    // row settling behind the last one, and it arrives through the same series a
    // tick does. Answering it as a tick would leave it undrawn.
    it('answers a candle settling behind the last one with the whole series', () => {
        expect(planSpotSeriesDraw(drawn, moved(drawn, drawn.length - 2, 99))).toBe('full');
    });

    it('answers older candles arriving in front with the whole series', () => {
        expect(planSpotSeriesDraw(drawn, [...run(START - 2 * HOUR, 2), ...drawn])).toBe('full');
    });

    it('answers a series it has never drawn with the whole series', () => {
        expect(planSpotSeriesDraw(null, drawn)).toBe('full');
        expect(planSpotSeriesDraw([], drawn)).toBe('full');
    });

    it('answers nothing at all when there are no rows to draw', () => {
        expect(planSpotSeriesDraw(drawn, [])).toBe('none');
        expect(planSpotSeriesDraw(drawn, undefined)).toBe('none');
    });

    // Two rows arriving at the end is a merge, not a bar opening: the row before
    // the new last one was never drawn.
    it('answers more than one new candle with the whole series', () => {
        expect(planSpotSeriesDraw(drawn, [
            ...drawn,
            candle(START + 5 * HOUR, 42),
            candle(START + 6 * HOUR, 43),
        ])).toBe('full');
    });

    it('answers a shorter series with the whole series', () => {
        expect(planSpotSeriesDraw(drawn, drawn.slice(0, -1))).toBe('full');
    });
});

describe('page size', () => {
    it('asks for the largest page the spot klines route serves', () => {
        expect(SPOT_CHART_HISTORY_PAGE_ROWS).toBe(1000);
    });
});
