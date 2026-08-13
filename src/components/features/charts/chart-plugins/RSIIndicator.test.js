import { describe, expect, it } from 'vitest';
import { advanceRSI, calculateRSI, calculateRSISeries } from './RSIIndicator';

const HOUR = 3600;
const START = 1_700_000_000;

// A repeatable walk, because a drift that only shows on some prices is a drift
// that would reach the operator and not the test.
const walk = (count, seed = 7) => {
    let value = seed;
    return Array.from({ length: count }, (_unused, index) => {
        value = (value * 1103515245 + 12345) % 2147483648;
        const close = 100 + ((value % 2000) / 100);
        return {
            time: START + index * HOUR,
            open: close,
            high: close,
            low: close,
            close,
            volume: 1,
        };
    });
};

const movedLast = (rows, close) => [
    ...rows.slice(0, -1),
    { ...rows.at(-1), close },
];

describe('calculateRSISeries', () => {
    it('reads the same line the plain calculation does', () => {
        const rows = walk(200);
        expect(calculateRSISeries(rows).points).toEqual(calculateRSI(rows));
    });

    it('has no tail while the last point is the first one', () => {
        // A first point is a plain mean over a window, not a step from anywhere,
        // so there is nothing behind it to step from.
        expect(calculateRSISeries(walk(15), 14).tail).toBeNull();
        expect(calculateRSISeries(walk(16), 14).tail).not.toBeNull();
    });

    it('has no line at all for a series shorter than the period', () => {
        const short = calculateRSISeries(walk(10), 14);
        expect(short.points).toEqual([]);
        expect(short.tail).toBeNull();
    });
});

// Wilder's smoothing is recursive from the first bar, so an incremental reading
// carries state forward — and a carry that is wrong does not fail, it drifts an
// indicator the operator reads. These compare it against the whole calculation
// rather than against a recorded number.
describe('advanceRSI', () => {
    const period = 14;

    it('reads a moved last bar exactly as recomputing the series does', () => {
        const rows = walk(200);
        const moved = movedLast(rows, 137.5);

        const advanced = advanceRSI(calculateRSISeries(rows, period).tail, moved, period);

        expect(advanced.point).toEqual(calculateRSISeries(moved, period).points.at(-1));
    });

    it('reads an opened bar exactly as recomputing the series does', () => {
        const rows = walk(200);
        const opened = [...rows, { ...rows.at(-1), time: rows.at(-1).time + HOUR, close: 91.25 }];

        const advanced = advanceRSI(
            calculateRSISeries(rows, period).tail,
            opened,
            period,
            { appended: true },
        );

        expect(advanced.point).toEqual(calculateRSISeries(opened, period).points.at(-1));
    });

    // The one failure that matters: a carry that is very slightly wrong reads
    // right for one bar and wrong an hour later. Three hundred bars of ticking
    // and opening, each checked against the whole calculation, is what says it
    // does not accumulate.
    it('does not drift over a session of ticks and opening bars', () => {
        let rows = walk(120);
        let tail = calculateRSISeries(rows, period).tail;

        for (let step = 0; step < 300; step += 1) {
            const ticked = movedLast(rows, 100 + ((step * 37) % 2000) / 100);
            const onTick = advanceRSI(tail, ticked, period);
            expect(onTick.point.value).toBe(calculateRSISeries(ticked, period).points.at(-1).value);

            const opened = [...ticked, {
                ...ticked.at(-1),
                time: ticked.at(-1).time + HOUR,
                close: 100 + ((step * 91) % 2000) / 100,
            }];
            const onOpen = advanceRSI(tail, opened, period, { appended: true });
            expect(onOpen.point.value).toBe(calculateRSISeries(opened, period).points.at(-1).value);

            rows = opened;
            tail = onOpen.tail;
        }
    });

    // A flat run drives the divisor to zero, which the full calculation answers
    // by reading 100 rather than by dividing.
    it('reads a run with no losses the way the whole calculation reads it', () => {
        const rising = Array.from({ length: 60 }, (_unused, index) => ({
            time: START + index * HOUR,
            open: 100 + index,
            high: 100 + index,
            low: 100 + index,
            close: 100 + index,
            volume: 1,
        }));
        const moved = movedLast(rising, 500);

        expect(advanceRSI(calculateRSISeries(rising, period).tail, moved, period).point)
            .toEqual(calculateRSISeries(moved, period).points.at(-1));
    });

    it('answers nothing when there is no tail to step from', () => {
        expect(advanceRSI(null, walk(200), period)).toBeNull();
        expect(advanceRSI(calculateRSISeries(walk(200), period).tail, [], period)).toBeNull();
    });
});
