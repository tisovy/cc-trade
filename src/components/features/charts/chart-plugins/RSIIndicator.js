/**
 * RSI (Relative Strength Index) Indicator
 * 
 * The RSI is a momentum oscillator that measures the speed and change of price movements.
 * It oscillates between 0 and 100, with readings above 70 indicating overbought conditions
 * and readings below 30 indicating oversold conditions.
 */

// Wilder's smoothing, and the reading it produces. Both incremental and
// full readings go through these two, so a point produced one bar at a time is
// the arithmetic a full pass would have done in the same order — not merely
// close to it.
const smooth = (average, value, period) => (average * (period - 1) + value) / period;
const rsiFrom = (avgGain, avgLoss) => {
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};
const gainOf = (change) => (change > 0 ? change : 0);
const lossOf = (change) => (change < 0 ? Math.abs(change) : 0);

/**
 * Calculate RSI values from OHLC data, and the state the line ends on.
 *
 * The tail is the pair of smoothed averages standing *behind* the last point,
 * with the close they were smoothed up to. Wilder's smoothing is recursive from
 * the first bar, so it is the only thing that lets the last point be recomputed
 * when its bar moves, or the next one produced when a bar opens, without walking
 * the series again — see `advanceRSI`. It is null for a series short enough that
 * the last point is the first one, since a first point is a plain mean over a
 * window rather than a step from anywhere.
 *
 * @param {Array} data - Array of candle data with { time, open, high, low, close, volume }
 * @param {number} period - RSI period (default: 14)
 * @returns {{ points: Array, tail: ?Object }} the line, and what it ends on
 */
export function calculateRSISeries(data, period = 14) {
    if (!Array.isArray(data) || data.length < period + 1) {
        return { points: [], tail: null };
    }

    const points = [];
    const gains = [];
    const losses = [];

    // Calculate price changes
    for (let i = 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        gains.push(gainOf(change));
        losses.push(lossOf(change));
    }

    // Calculate first average gain and loss
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    points.push({
        time: data[period].time,
        value: rsiFrom(avgGain, avgLoss),
    });

    // Calculate subsequent RSI values using smoothed averages (Wilder's smoothing)
    let tail = null;
    for (let i = period; i < gains.length; i++) {
        // Taken before the fold, not after: this is the state the last point is
        // a step away from, which is what recomputing that point needs.
        tail = { avgGain, avgLoss, close: data[i].close };
        avgGain = smooth(avgGain, gains[i], period);
        avgLoss = smooth(avgLoss, losses[i], period);

        points.push({
            time: data[i + 1].time,
            value: rsiFrom(avgGain, avgLoss),
        });
    }

    return { points, tail };
}

/**
 * Calculate RSI values from OHLC data
 * @param {Array} data - Array of candle data with { time, open, high, low, close, volume }
 * @param {number} period - RSI period (default: 14)
 * @returns {Array} Array of { time, value } for RSI line
 */
export function calculateRSI(data, period = 14) {
    return calculateRSISeries(data, period).points;
}

/**
 * The line's last point, for a series whose last bar moved or whose next bar
 * opened, from the tail rather than from the whole series.
 *
 * `appended` says which of the two happened: a bar opening first folds the bar
 * that just settled into the averages, and a bar merely moving does not, because
 * the point being replaced is a step from the same place it always was.
 *
 * @returns {?{ point: Object, tail: Object }} the point to draw and the tail
 * behind it, or null when the tail cannot answer and the series must be walked
 */
export function advanceRSI(tail, rows, period = 14, { appended = false } = {}) {
    if (!tail || !Array.isArray(rows) || rows.length < 2) return null;

    const bar = rows[rows.length - 1];
    let base = tail;
    if (appended) {
        const settled = rows[rows.length - 2];
        const change = settled.close - tail.close;
        base = {
            avgGain: smooth(tail.avgGain, gainOf(change), period),
            avgLoss: smooth(tail.avgLoss, lossOf(change), period),
            close: settled.close,
        };
    }

    const change = bar.close - base.close;
    return {
        point: {
            time: bar.time,
            value: rsiFrom(
                smooth(base.avgGain, gainOf(change), period),
                smooth(base.avgLoss, lossOf(change), period),
            ),
        },
        tail: base,
    };
}

/**
 * RSI Configuration
 */
export const RSI_CONFIG = {
    // Default RSI period
    defaultPeriod: 14,
    
    // Standard RSI levels
    levels: {
        overbought: 70,
        middle: 50,
        oversold: 30
    },
    
    // Extended levels (shown as dashed lines)
    extendedLevels: {
        extremeOverbought: 80,
        extremeOversold: 20
    },
    
    // Colors
    colors: {
        line: '#a855f7',           // Purple RSI line
        overbought: '#ef4444',     // Red for overbought zone
        oversold: '#22c55e',       // Green for oversold zone
        middleLine: '#64748b',     // Slate for middle line (50)
        levelLine: 'rgba(100, 116, 139, 0.4)',  // Faded slate for level lines
        background: 'transparent',
        gridLine: '#1e293b'
    },
    
    // Size constraints
    minHeightPercent: 1,   // Minimum 1% of container height
    maxHeightPercent: 50,  // Maximum 50% of container height
    defaultHeightPercent: 20, // Default 20% of container height
    
    // Axis settings
    priceScale: {
        scaleMargins: {
            top: 0.1,
            bottom: 0.1
        },
        autoScale: true
    }
};

export default { calculateRSI, RSI_CONFIG };
