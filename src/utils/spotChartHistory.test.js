import { describe, expect, it } from 'vitest';
import {
    SPOT_CHART_HISTORY_PAGE_ROWS,
    SPOT_CHART_MAX_ROWS,
    mergeSpotChartSeries,
    reachedSpotHistoryEdge,
    spotChartHistoryEndTime,
    spotChartNextOpenTime,
    spotChartOpenTimeAt,
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

const utc = (year, month, day = 1) => Date.UTC(year, month - 1, day) / 1000;

describe('spotChartNextOpenTime', () => {
    it('answers a fixed interval with its own length', () => {
        expect(spotChartNextOpenTime(1_700_000_000, '1m')).toBe(1_700_000_060);
        expect(spotChartNextOpenTime(1_700_000_000, '1h')).toBe(1_700_000_000 + HOUR);
        expect(spotChartNextOpenTime(1_700_000_000, '1d')).toBe(1_700_000_000 + 86_400);
    });

    // 28, 29, 30 and 31 days, in that order, all one step.
    it('answers a month with the next month, whatever its length', () => {
        expect(spotChartNextOpenTime(utc(2023, 2), '1M')).toBe(utc(2023, 3));
        expect(spotChartNextOpenTime(utc(2024, 2), '1M')).toBe(utc(2024, 3));
        expect(spotChartNextOpenTime(utc(2024, 4), '1M')).toBe(utc(2024, 5));
        expect(spotChartNextOpenTime(utc(2024, 3), '1M')).toBe(utc(2024, 4));
        expect(spotChartNextOpenTime(utc(2024, 12), '1M')).toBe(utc(2025, 1));
    });

    it('refuses an interval it does not know rather than guessing a length', () => {
        expect(spotChartNextOpenTime(1_700_000_000, '7h')).toBeNull();
        expect(spotChartNextOpenTime(1_700_000_000, undefined)).toBeNull();
        expect(spotChartNextOpenTime(null, '1h')).toBeNull();
    });
});

describe('spotChartOpenTimeAt', () => {
    it('counts fixed intervals from the candle it was given', () => {
        const start = 1_700_000_000;
        expect(spotChartOpenTimeAt(start, start + 3 * HOUR + 61, '1h')).toBe(start + 3 * HOUR);
        expect(spotChartOpenTimeAt(start, start, '1h')).toBe(start);
    });

    // Counted in thirty-day blocks from the first of March, a print on the
    // first of April opens a candle on the thirty-first of March.
    it('reads a month off the calendar instead of counting thirty days', () => {
        expect(spotChartOpenTimeAt(utc(2024, 3), utc(2024, 4) + 60, '1M')).toBe(utc(2024, 4));
        expect(spotChartOpenTimeAt(utc(2024, 1), utc(2024, 3, 15), '1M')).toBe(utc(2024, 3));
    });

    it('refuses a moment before the candle it was given, and an unknown interval', () => {
        expect(spotChartOpenTimeAt(1_700_000_000, 1_600_000_000, '1h')).toBeNull();
        expect(spotChartOpenTimeAt(1_700_000_000, 1_700_000_060, '7h')).toBeNull();
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
        const merged = mergeSpotChartSeries(history, live, { interval: '1h' });
        expect(merged).toHaveLength(6);
        expect(merged.map(row => row.time)).toEqual([
            ...history.map(row => row.time),
            ...live.map(row => row.time),
        ]);
    });

    it('lets the arriving row win the seam, so a live candle is never overwritten by history', () => {
        const live = [candle(1_700_010_000, 555)];
        const history = [candle(1_700_010_000 - HOUR, 1), candle(1_700_010_000, 111)];
        expect(mergeSpotChartSeries(history, live, { interval: '1h' }).at(-1).close).toBe(555);
        expect(mergeSpotChartSeries(live, history, { interval: '1h' }).at(-1).close).toBe(111);
    });

    // The app being closed for a week is the ordinary case here. Concatenating
    // across that hole would draw last week's candles as if they were adjacent
    // to today's, which is a false chart rather than a short one.
    it('drops a run that no longer touches the one reaching into the present', () => {
        const stale = run(1_700_000_000, 5);
        const live = run(1_700_000_000 + 500 * HOUR, 5);
        expect(mergeSpotChartSeries(stale, live, { interval: '1h' })
            .map(row => row.time)).toEqual(live.map(row => row.time));
        expect(mergeSpotChartSeries(live, stale, { interval: '1h' })
            .map(row => row.time)).toEqual(live.map(row => row.time));
    });

    it('keeps a gap inside a single delivered page, which the exchange itself reported', () => {
        const halted = [
            candle(1_700_000_000),
            candle(1_700_000_000 + HOUR),
            candle(1_700_000_000 + 9 * HOUR),
        ];
        const live = [candle(1_700_000_000 + 10 * HOUR)];
        expect(mergeSpotChartSeries(halted, live, { interval: '1h' })).toHaveLength(4);
    });

    // Thirty days is longer than February and shorter than January, so a
    // constant standing in for a month reads every 31-day seam as a hole and
    // throws away everything behind it: a monthly chart lost its history to the
    // calendar seven times a year.
    describe('a month against the calendar', () => {
        const month = (year, monthNumber, close = 100) => candle(
            Date.UTC(year, monthNumber - 1, 1) / 1000,
            close,
        );
        const times = series => series.map(row => row.time);

        it('joins a 31-day month to the one after it', () => {
            const older = [month(2023, 12), month(2024, 1)];
            const newer = [month(2024, 2), month(2024, 3)];
            expect(times(mergeSpotChartSeries(older, newer, { interval: '1M' })))
                .toEqual(times([...older, ...newer]));
        });

        it('joins every seam of a year, whatever each month is worth', () => {
            const year = Array.from({ length: 12 }, (_unused, index) => month(2023, index + 1));
            for (let split = 1; split < year.length; split += 1) {
                expect(mergeSpotChartSeries(
                    year.slice(0, split),
                    year.slice(split),
                    { interval: '1M' },
                )).toHaveLength(year.length);
            }
        });

        it('joins December to January across the turn of the year', () => {
            const older = [month(2023, 11), month(2023, 12)];
            const newer = [month(2024, 1)];
            expect(mergeSpotChartSeries(older, newer, { interval: '1M' })).toHaveLength(3);
        });

        it('still drops a run with a month missing between it and the present', () => {
            const stale = [month(2024, 1), month(2024, 2)];
            const live = [month(2024, 4), month(2024, 5)];
            expect(times(mergeSpotChartSeries(stale, live, { interval: '1M' })))
                .toEqual(times(live));
        });
    });

    it('joins runs that abut exactly, with no candle invented or lost at the seam', () => {
        const older = run(1_700_000_000, 4);
        const newer = run(1_700_000_000 + 4 * HOUR, 4);
        const merged = mergeSpotChartSeries(older, newer, { interval: '1h' });
        expect(merged).toHaveLength(8);
        for (let index = 1; index < merged.length; index += 1) {
            expect(merged[index].time - merged[index - 1].time).toBe(HOUR);
        }
    });

    it('keeps the newest rows when the bound is reached', () => {
        const merged = mergeSpotChartSeries(
            run(1_600_000_000, 4000),
            run(1_600_000_000 + 4000 * HOUR, 2000),
            { interval: '1h' },
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
            { interval: undefined },
        )).toHaveLength(4);
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

describe('page size', () => {
    it('asks for the largest page the spot klines route serves', () => {
        expect(SPOT_CHART_HISTORY_PAGE_ROWS).toBe(1000);
    });
});
