import { describe, expect, it, vi } from 'vitest';
import {
    CHART_VIEWPORT_STORAGE_KEY,
    createChartViewportMemory,
    placeChartViewport,
    readChartViewport,
} from './chartViewport.js';

const rows = count => Array.from({ length: count }, (_, index) => ({ openTime: 1_784_000_000_000 + (index * 60_000) }));

const scale = ({ range = null, width = 1200, offset = 0 } = {}) => ({
    width: vi.fn(() => width),
    scrollPosition: vi.fn(() => offset),
    getVisibleLogicalRange: vi.fn(() => range),
    applyOptions: vi.fn(),
});

const fakeStorage = (initial = {}) => {
    const items = new Map(Object.entries(initial));
    return {
        items,
        getItem: vi.fn(key => items.get(key) ?? null),
        setItem: vi.fn((key, value) => { items.set(key, value); }),
    };
};

describe('readChartViewport', () => {
    it('reads pixels per bar off the visible range, and the pan off the scale', () => {
        // 55 bars across 1200 px, the newest bar five bars in from the right edge.
        const viewport = readChartViewport(scale({ range: { from: 30, to: 84 }, offset: 5 }), rows(80));
        expect(viewport).toEqual({ barSpacing: 1200 / 55, offset: 5 });
        expect(Object.isFrozen(viewport)).toBe(true);
    });

    it('reads a pan into history as the negative distance the scale reports', () => {
        expect(readChartViewport(scale({ range: { from: -20, to: 34 }, offset: -45 }), rows(80)))
            .toEqual({ barSpacing: 1200 / 55, offset: -45 });
    });

    it('reads nothing off a chart that shows no series, or one it cannot measure', () => {
        const drawn = rows(80);
        expect(readChartViewport(scale({ range: { from: 0, to: 79 } }), [])).toBeNull();
        expect(readChartViewport(scale({ range: { from: 0, to: 79 } }), null)).toBeNull();
        expect(readChartViewport(scale(), drawn)).toBeNull();
        expect(readChartViewport(scale({ range: { from: 0, to: 79 }, width: 0 }), drawn)).toBeNull();
        expect(readChartViewport(scale({ range: { from: 0, to: Number.NaN } }), drawn)).toBeNull();
        expect(readChartViewport(scale({ range: { from: 0, to: 79 }, offset: Number.NaN }), drawn)).toBeNull();
        expect(readChartViewport({ getVisibleLogicalRange: () => ({ from: 0, to: 79 }) }, drawn)).toBeNull();
        expect(readChartViewport(null, drawn)).toBeNull();
    });
});

describe('placeChartViewport', () => {
    it('sets the zoom and the pan as the scale\'s options', () => {
        const timeScale = scale();
        expect(placeChartViewport(timeScale, { barSpacing: 1200 / 55, offset: 5 })).toBe(true);
        expect(timeScale.applyOptions).toHaveBeenCalledExactlyOnceWith({ barSpacing: 1200 / 55, rightOffset: 5 });
    });

    it('places what it read', () => {
        const viewport = readChartViewport(scale({ range: { from: 12.5, to: 91.25 }, offset: 12.25 }), rows(80));
        const timeScale = scale();
        placeChartViewport(timeScale, viewport);
        expect(timeScale.applyOptions).toHaveBeenCalledExactlyOnceWith({
            barSpacing: 1200 / 79.75,
            rightOffset: 12.25,
        });
    });

    it('places nothing it cannot, and says so', () => {
        const timeScale = scale();
        expect(placeChartViewport(timeScale, null)).toBe(false);
        expect(placeChartViewport(timeScale, { barSpacing: 0, offset: 0 })).toBe(false);
        expect(placeChartViewport(timeScale, { barSpacing: 20, offset: Number.NaN })).toBe(false);
        expect(timeScale.applyOptions).not.toHaveBeenCalled();
        expect(placeChartViewport({ width: () => 1200 }, { barSpacing: 20, offset: 0 })).toBe(false);
        expect(placeChartViewport(null, { barSpacing: 20, offset: 0 })).toBe(false);
    });
});

describe('createChartViewportMemory', () => {
    it('opens fitted when nothing is remembered', () => {
        expect(createChartViewportMemory(fakeStorage()).opening()).toBeNull();
        expect(createChartViewportMemory(null).opening()).toBeNull();
    });

    it('opens where the last chart was left', () => {
        const storage = fakeStorage({
            [CHART_VIEWPORT_STORAGE_KEY]: JSON.stringify({ barSpacing: 20, margin: 5 }),
        });
        expect(createChartViewportMemory(storage).opening()).toEqual({ barSpacing: 20, offset: 5 });
    });

    it('opens fitted on a record it cannot read', () => {
        for (const raw of [
            'not json',
            JSON.stringify({ barSpacing: 0, margin: 5 }),
            JSON.stringify({ barSpacing: 20, margin: -1 }),
            JSON.stringify({ barSpacing: '20', margin: 5 }),
            JSON.stringify(null),
        ]) {
            expect(createChartViewportMemory(fakeStorage({ [CHART_VIEWPORT_STORAGE_KEY]: raw })).opening()).toBeNull();
        }
        const refusing = { getItem: () => { throw new Error('refused'); } };
        expect(createChartViewportMemory(refusing).opening()).toBeNull();
    });

    it('remembers the zoom and the margin at the live edge, and writes only what changed', () => {
        const storage = fakeStorage();
        const memory = createChartViewportMemory(storage);
        memory.note({ barSpacing: 20, offset: 5 });
        memory.note({ barSpacing: 20, offset: 5 });
        expect(storage.setItem).toHaveBeenCalledTimes(1);
        expect(JSON.parse(storage.items.get(CHART_VIEWPORT_STORAGE_KEY))).toEqual({ barSpacing: 20, margin: 5 });
        expect(memory.opening()).toEqual({ barSpacing: 20, offset: 5 });

        // A pan into history keeps the margin last kept at the live edge.
        memory.note({ barSpacing: 12, offset: -45 });
        expect(JSON.parse(storage.items.get(CHART_VIEWPORT_STORAGE_KEY))).toEqual({ barSpacing: 12, margin: 5 });
        memory.note({ barSpacing: 12, offset: -60 });
        expect(storage.setItem).toHaveBeenCalledTimes(2);

        // Back at the live edge, the margin is the new one.
        memory.note({ barSpacing: 12, offset: 8 });
        expect(JSON.parse(storage.items.get(CHART_VIEWPORT_STORAGE_KEY))).toEqual({ barSpacing: 12, margin: 8 });
    });

    it('starts a pan into history off from the live edge when nothing is remembered', () => {
        const storage = fakeStorage();
        const memory = createChartViewportMemory(storage);
        memory.note({ barSpacing: 20, offset: -45 });
        expect(memory.opening()).toEqual({ barSpacing: 20, offset: 0 });
    });

    it('keeps its own copy when the storage refuses the write', () => {
        const storage = { getItem: () => null, setItem: () => { throw new Error('full'); } };
        const memory = createChartViewportMemory(storage);
        expect(() => memory.note({ barSpacing: 20, offset: 5 })).not.toThrow();
        expect(memory.opening()).toEqual({ barSpacing: 20, offset: 5 });
        expect(() => createChartViewportMemory(null).note({ barSpacing: 20, offset: 5 })).not.toThrow();
    });

    it('notes nothing it cannot read as a viewport', () => {
        const storage = fakeStorage();
        const memory = createChartViewportMemory(storage);
        memory.note(null);
        memory.note({ barSpacing: Number.NaN, offset: 0 });
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(memory.opening()).toBeNull();
    });
});
