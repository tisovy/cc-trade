import { describe, expect, it } from 'vitest';
import { formatVolumeShort } from './operations';
import {
    buildVolumeHistogramBar,
    buildVolumeHistogramPresentation,
    LIGHTWEIGHT_CHARTS_MAX_SERIES_VALUE,
} from './chartVolume';

const COLORS = Object.freeze({ upColor: 'green', downColor: 'red' });

const candle = (time, volume, close = 2, open = 1) => ({
    time,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume,
});

describe('buildVolumeHistogramPresentation', () => {
    it('preserves ordinary Spot volume data and the built-in volume formatter', () => {
        const input = [candle(1, 1_200), candle(2, 900, 1, 2)];

        const result = buildVolumeHistogramPresentation(input, COLORS);

        expect(result.scale).toBe(1);
        expect(result.priceFormat).toEqual({ type: 'volume' });
        expect(result.data).toEqual([
            { time: 1, value: 1_200, color: 'green' },
            { time: 2, value: 900, color: 'red' },
        ]);
    });

    it('uniformly scales PEPE-sized weekly volume below the chart boundary', () => {
        const weeklyVolume = 123_456_789_012_345;
        const input = [candle(1, weeklyVolume), candle(2, weeklyVolume / 2)];

        const result = buildVolumeHistogramPresentation(input, COLORS);

        expect(result.scale).toBe(1_000);
        expect(result.data.every(row => (
            row.value <= LIGHTWEIGHT_CHARTS_MAX_SERIES_VALUE
        ))).toBe(true);
        expect(result.data[0].value / result.data[1].value).toBe(2);
        expect(result.priceFormat.type).toBe('custom');
        expect(result.priceFormat.formatter(result.data[0].value)).toBe(
            formatVolumeShort(weeklyVolume),
        );
    });

    it('turns malformed or negative presentation volume into safe zeroes', () => {
        const result = buildVolumeHistogramPresentation([
            candle(1, Number.POSITIVE_INFINITY),
            candle(2, Number.NaN),
            candle(3, -1),
            candle(4, '2500'),
        ], COLORS);

        expect(result.scale).toBe(1);
        expect(result.data.map(row => row.value)).toEqual([0, 0, 0, 2_500]);
    });
});

// A live trade moves one bar of the histogram. It is written on its own, to the
// scale the bars already on screen are drawn to.
describe('buildVolumeHistogramBar', () => {
    it('draws one bar exactly as the whole series would have drawn it', () => {
        const candles = [candle(1, 100), candle(2, 250, 1, 2)];
        const whole = buildVolumeHistogramPresentation(candles, COLORS);
        const one = buildVolumeHistogramBar(candles[1], { ...COLORS, scale: whole.scale });

        expect(one).toEqual(whole.data[1]);
    });

    it('holds the drawn scale rather than choosing its own', () => {
        const scale = 1_000;
        const one = buildVolumeHistogramBar(candle(1, 5_000), { ...COLORS, scale });

        expect(one.value).toBe(5);
    });

    // Rescaling for one bar would leave every other bar on screen drawn to the
    // old scale, so a bar the held scale cannot express is refused instead — and
    // the caller redraws the histogram whole.
    it('refuses a bar the held scale cannot express', () => {
        const tooLarge = LIGHTWEIGHT_CHARTS_MAX_SERIES_VALUE * 2;

        expect(buildVolumeHistogramBar(candle(1, tooLarge), { ...COLORS, scale: 1 })).toBeNull();
        expect(buildVolumeHistogramBar(candle(1, tooLarge), {
            ...COLORS,
            scale: 1_000,
        })).not.toBeNull();
    });

    it('turns malformed or negative volume into a safe zero', () => {
        expect(buildVolumeHistogramBar(candle(1, Number.NaN), COLORS).value).toBe(0);
        expect(buildVolumeHistogramBar(candle(1, -5), COLORS).value).toBe(0);
    });

    it('answers nothing without a candle or a usable scale', () => {
        expect(buildVolumeHistogramBar(null, COLORS)).toBeNull();
        expect(buildVolumeHistogramBar(candle(1, 10), { ...COLORS, scale: 0 })).toBeNull();
    });
});
