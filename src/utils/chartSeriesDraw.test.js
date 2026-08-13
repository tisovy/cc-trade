import { describe, expect, it } from 'vitest';
import { countPrependedRows, planSeriesDraw } from './chartSeriesDraw.js';

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

    it('reads open time where the caller keeps it', () => {
        const rows = [{ openTime: 10 }, { openTime: 20 }, { openTime: 30 }];
        expect(countPrependedRows(30, rows, { timeOf: row => row?.openTime })).toBe(2);
    });
});

describe('planSeriesDraw', () => {
    const START = 1_700_000_000;
    const drawn = run(START, 5);
    const moved = (rows, index, close) => {
        const next = [...rows];
        next[index] = candle(next[index].time, close);
        return next;
    };

    it('answers a moved last candle with the last candle alone', () => {
        expect(planSeriesDraw(drawn, moved(drawn, drawn.length - 1, 42))).toBe('tick');
    });

    it('answers a candle opening after the last one with that candle alone', () => {
        expect(planSeriesDraw(drawn, [...drawn, candle(START + 5 * HOUR, 42)])).toBe('append');
    });

    // The close of the candle just past — its true high, low and volume — is a
    // row settling behind the last one, and it arrives through the same series a
    // tick does. Answering it as a tick would leave it undrawn.
    it('answers a candle settling behind the last one with the whole series', () => {
        expect(planSeriesDraw(drawn, moved(drawn, drawn.length - 2, 99))).toBe('full');
    });

    it('answers older candles arriving in front with the whole series', () => {
        expect(planSeriesDraw(drawn, [...run(START - 2 * HOUR, 2), ...drawn])).toBe('full');
    });

    it('answers a series it has never drawn with the whole series', () => {
        expect(planSeriesDraw(null, drawn)).toBe('full');
        expect(planSeriesDraw([], drawn)).toBe('full');
    });

    it('answers nothing at all when there are no rows to draw', () => {
        expect(planSeriesDraw(drawn, [])).toBe('none');
        expect(planSeriesDraw(drawn, undefined)).toBe('none');
    });

    // Two rows arriving at the end is a merge, not a bar opening: the row before
    // the new last one was never drawn.
    it('answers more than one new candle with the whole series', () => {
        expect(planSeriesDraw(drawn, [
            ...drawn,
            candle(START + 5 * HOUR, 42),
            candle(START + 6 * HOUR, 43),
        ])).toBe('full');
    });

    it('answers a shorter series with the whole series', () => {
        expect(planSeriesDraw(drawn, drawn.slice(0, -1))).toBe('full');
    });

    // Everything below is what the Futures chart needs and the Spot chart does
    // not: open time under another name and in another unit, and rows that are
    // new objects every frame because they were parsed off the wire.
    describe('a caller whose rows do not survive the frame', () => {
        const MINUTE = 60_000;
        const bar = (openTime, close = '100') => ({
            openTime, open: '100', high: '101', low: '99', close, volume: '5',
        });
        const wire = rows => rows.map(row => ({ ...row }));
        const options = {
            timeOf: row => row?.openTime,
            sameRow: (left, right) => left === right || (
                left?.openTime === right?.openTime
                && left?.open === right?.open
                && left?.high === right?.high
                && left?.low === right?.low
                && left?.close === right?.close
                && left?.volume === right?.volume
            ),
        };
        const held = Array.from({ length: 5 }, (_unused, index) => bar(index * MINUTE));

        it('reads a re-sent series that did not change as the tick it is', () => {
            const next = wire(held);
            next[next.length - 1] = bar(4 * MINUTE, '108');
            expect(planSeriesDraw(held, next, options)).toBe('tick');
        });

        it('reads a corrected interior candle as a full redraw', () => {
            const next = wire(held);
            next[2] = bar(2 * MINUTE, '55');
            expect(planSeriesDraw(held, next, options)).toBe('full');
        });

        it('reads a bar opening after a re-sent series as an append', () => {
            expect(planSeriesDraw(held, [...wire(held), bar(5 * MINUTE)], options)).toBe('append');
        });

        // Milliseconds compared as though they were the seconds the Spot chart
        // carries would still order correctly; the name they are kept under
        // would not resolve at all, and every row would read as undefined.
        it('finds open time nowhere without being told where it is kept', () => {
            const next = wire(held);
            next[next.length - 1] = bar(4 * MINUTE, '108');
            expect(planSeriesDraw(held, next)).toBe('full');
        });
    });
});
