// The chart's zoom and pan, as the operator left them.
//
// Two numbers describe where a chart stands: the pixels it spends on a bar,
// and the distance of the newest bar from the right edge, in bars. The library
// keeps both through a replacement of the series; what discarded them was the
// chart's own fit on every new contract or interval — the series held through
// a switch fitted whole into the screen, and the new window drawn at whatever
// that fit left (2026-09-04). Here they are read off the chart, placed back on
// the first series of the next selection, and remembered for a chart created
// later — after a workspace change, or a restart.

export const CHART_VIEWPORT_STORAGE_KEY = 'futuresChartViewport';

const finite = value => typeof value === 'number' && Number.isFinite(value);

const countOf = rows => (Array.isArray(rows) ? rows.length : 0);

/**
 * The zoom and pan the chart shows now: `barSpacing` in pixels per bar, and
 * `offset`, the newest drawn bar's distance from the right edge in bars —
 * negative once the operator has scrolled it off the right. `null` while the
 * chart shows no series: there is nothing to carry.
 *
 * The pan is the library's own reading. The zoom is not offered as one — the
 * scale's options hold only the bar spacing the chart was created with — and
 * is read off the visible logical range, which spans `width / barSpacing`
 * bars.
 */
export const readChartViewport = (timeScale, drawnRows) => {
    if (countOf(drawnRows) === 0) return null;
    const range = timeScale?.getVisibleLogicalRange?.() ?? null;
    const width = timeScale?.width?.();
    const offset = timeScale?.scrollPosition?.();
    if (!range || !finite(range.from) || !finite(range.to)) return null;
    if (!finite(width) || width <= 0 || !finite(offset)) return null;
    const bars = range.to - range.from + 1;
    if (!(bars > 0)) return null;
    return Object.freeze({ barSpacing: width / bars, offset });
};

const isViewport = viewport => finite(viewport?.barSpacing)
    && viewport.barSpacing > 0
    && finite(viewport.offset);

/**
 * Shows the chart's series at `viewport`: the same pixels per bar, the newest
 * bar the same distance from the right edge. Both are the scale's options —
 * the library applies the bar spacing first, as the offset depends on it —
 * and the library clamps what the series cannot honour: a pan deeper into
 * history than the series reaches leaves its oldest bars at the right edge
 * until history lands behind them. Answers `false` when there is nothing to
 * place, for the caller to fit instead.
 */
export const placeChartViewport = (timeScale, viewport) => {
    if (!isViewport(viewport) || typeof timeScale?.applyOptions !== 'function') return false;
    timeScale.applyOptions({ barSpacing: viewport.barSpacing, rightOffset: viewport.offset });
    return true;
};

const readRemembered = (storage, key) => {
    let raw = null;
    try {
        raw = storage?.getItem?.(key) ?? null;
    } catch {
        return null;
    }
    if (typeof raw !== 'string') return null;
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!finite(parsed?.barSpacing) || parsed.barSpacing <= 0) return null;
    if (!finite(parsed?.margin) || parsed.margin < 0) return null;
    return Object.freeze({ barSpacing: parsed.barSpacing, margin: parsed.margin });
};

/**
 * What outlives the chart: the zoom, and the margin the operator last kept at
 * the live edge. A pan into history is not carried into a chart created later
 * — that chart opens on the live edge, where the newest bar is, at the zoom
 * and margin the operator used there.
 *
 * `opening()` answers the viewport a new chart opens at, or `null` when nothing
 * is remembered and the chart is to be fitted. `note(viewport)` records what
 * the chart shows now; it writes only when the record changes, since it is
 * called on every move of the visible range.
 */
export const createChartViewportMemory = (storage, key = CHART_VIEWPORT_STORAGE_KEY) => {
    let remembered = readRemembered(storage, key);
    return Object.freeze({
        opening: () => (remembered === null
            ? null
            : Object.freeze({ barSpacing: remembered.barSpacing, offset: remembered.margin })),
        note: (viewport) => {
            if (!isViewport(viewport)) return;
            const margin = viewport.offset >= 0 ? viewport.offset : (remembered?.margin ?? 0);
            if (remembered !== null
                && remembered.barSpacing === viewport.barSpacing
                && remembered.margin === margin) return;
            remembered = Object.freeze({ barSpacing: viewport.barSpacing, margin });
            try {
                storage?.setItem?.(key, JSON.stringify(remembered));
            } catch {
                // Storage may be full, or refused. The chart keeps its own copy
                // for this session; only the next one opens fitted.
            }
        },
    });
};

/** The browser's storage, or `null` where reading it is refused. */
export const browserStorage = () => {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
};
