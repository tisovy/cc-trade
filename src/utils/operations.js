import { calculatePrecision, precisionTruncate } from './precision'

// This module once held the renderer's order-entry path: `buysell`, `cancel`,
// `cancelAll`, `serverDialog` and `balanceUpdate`. They lost their callers and
// were deleted, because an unreachable submission path is not harmless — that
// one composed untyped frames, carried no command identity, was not subject to
// the risk ceiling, and refused orders on a local copy of the exchange's price
// band the desk deliberately no longer keeps. Trading frames are built by
// `src/utils/tradingCommands.js` and nowhere else.


/**
 * Format large numbers with k/kk/kkk suffixes
 * k = thousands (10k = 10,000)
 * m = millions (10m = 10,000,000)
 * b = billions (1b = 1,000,000,000)
 */
export function formatVolumeShort(value) {
    if (!value || !Number.isFinite(value)) return '0';

    const absValue = Math.abs(value);
    const sign = value < 0 ? '-' : '';

    if (absValue >= 1_000_000_000) {
        const formatted = (absValue / 1_000_000_000).toFixed(1);
        return sign + formatted.replace(/\.0$/, '') + 'b';
    }
    if (absValue >= 1_000_000) {
        const formatted = (absValue / 1_000_000).toFixed(1);
        return sign + formatted.replace(/\.0$/, '') + 'm';
    }
    if (absValue >= 1_000) {
        const formatted = (absValue / 1_000).toFixed(1);
        return sign + formatted.replace(/\.0$/, '') + 'k';
    }

    return sign + absValue.toFixed(0);
}

export { calculatePrecision, precisionTruncate };
