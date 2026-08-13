import { describe, expect, it } from 'vitest';
import { movingAveragePoint, movingAveragePoints } from './MovingAverage';

const HOUR = 3600;
const START = 1_700_000_000;

const walk = (count, seed = 11) => {
    let value = seed;
    return Array.from({ length: count }, (_unused, index) => {
        value = (value * 1103515245 + 12345) % 2147483648;
        return {
            time: START + index * HOUR,
            close: 100 + ((value % 2000000) / 10000),
        };
    });
};

describe('movingAveragePoints', () => {
    it('averages the window ending on the bar it is drawn against', () => {
        const rows = [10, 20, 30, 40].map((close, index) => ({
            time: START + index * HOUR,
            close,
        }));

        expect(movingAveragePoints(rows, 2)).toEqual([
            { time: rows[1].time, value: 15 },
            { time: rows[2].time, value: 25 },
            { time: rows[3].time, value: 35 },
        ]);
    });

    it('draws nothing until there are enough bars to average', () => {
        expect(movingAveragePoints(walk(79), 80)).toEqual([]);
        expect(movingAveragePoints(walk(80), 80)).toHaveLength(1);
    });

    it('answers nothing for a period that cannot name a window', () => {
        expect(movingAveragePoints(walk(50), 0)).toEqual([]);
        expect(movingAveragePoints(walk(50), -3)).toEqual([]);
        expect(movingAveragePoints(null, 80)).toEqual([]);
    });
});

// This is the whole reason the average is computed here rather than through
// `technicalindicators`: the chart draws the line two ways, and the two have to
// be the same number. That library carries a running sum from the first bar, so
// its answer for a bar depends on how many bars came before it.
describe('movingAveragePoint', () => {
    const period = 80;

    it('is exactly the last point of the whole line', () => {
        const rows = walk(500);

        expect(movingAveragePoint(rows, period)).toEqual(movingAveragePoints(rows, period).at(-1));
    });

    it('is exactly that point wherever the series is cut off', () => {
        const rows = walk(600);
        const line = movingAveragePoints(rows, period);

        for (let end = period; end <= rows.length; end += 1) {
            const alone = movingAveragePoint(rows.slice(0, end), period);
            expect(alone.value).toBe(line[end - period].value);
        }
    });

    it('answers nothing while the line has no points', () => {
        expect(movingAveragePoint(walk(79), period)).toBeNull();
        expect(movingAveragePoint([], period)).toBeNull();
    });
});
