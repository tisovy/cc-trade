import { formatVolumeShort } from './operations';

// lightweight-charts 5 validates every numeric series item against this exact
// boundary before accepting data. Base-asset volume can exceed it for
// low-priced, high-supply Spot instruments on daily and weekly candles.
export const LIGHTWEIGHT_CHARTS_MAX_SERIES_VALUE = Number.MAX_SAFE_INTEGER / 100;

const VOLUME_SCALE_STEP = 1_000;

const normalizeVolume = (value) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
};

const resolveVolumeScale = (volumes) => {
    const largestVolume = volumes.reduce((largest, volume) => (
        volume > largest ? volume : largest
    ), 0);
    let scale = 1;
    while (largestVolume / scale > LIGHTWEIGHT_CHARTS_MAX_SERIES_VALUE) {
        scale *= VOLUME_SCALE_STEP;
    }
    return scale;
};

export const buildVolumeHistogramPresentation = (
    candles,
    { upColor, downColor },
) => {
    const source = Array.isArray(candles) ? candles : [];
    const volumes = source.map(candle => normalizeVolume(candle?.volume));
    const scale = resolveVolumeScale(volumes);
    const data = source.map((candle, index) => ({
        time: candle.time,
        value: volumes[index] / scale,
        color: candle.close >= candle.open ? upColor : downColor,
    }));
    const priceFormat = scale === 1
        ? { type: 'volume' }
        : {
            type: 'custom',
            minMove: 0.01,
            formatter: scaledVolume => formatVolumeShort(scaledVolume * scale),
        };

    return { data, priceFormat, scale };
};

/**
 * One candle's bar in the presentation an already-drawn histogram is using.
 *
 * The scale is the drawn series' own, not this bar's: choosing a new one for a
 * single bar would leave every other bar on screen drawn to the old one. A bar
 * the held scale cannot express is not drawn at all — it is answered as `null`,
 * which is the caller's signal to redraw the histogram whole and pick a scale
 * that fits it.
 */
export const buildVolumeHistogramBar = (candle, { upColor, downColor, scale = 1 }) => {
    if (!candle || !Number.isFinite(scale) || scale <= 0) return null;
    const value = normalizeVolume(candle.volume) / scale;
    if (value > LIGHTWEIGHT_CHARTS_MAX_SERIES_VALUE) return null;
    return {
        time: candle.time,
        value,
        color: candle.close >= candle.open ? upColor : downColor,
    };
};
