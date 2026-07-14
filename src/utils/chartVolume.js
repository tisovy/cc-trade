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
