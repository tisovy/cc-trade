import { describe, expect, it } from 'vitest';
import { formatVolumeShort } from './operations';
import {
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
