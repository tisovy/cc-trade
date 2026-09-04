import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import {
    FUTURES_CANDLE_STORE_DEFAULT_URL,
    FUTURES_CANDLE_STORE_WEEK_EPOCH_OFFSET_MS,
    createFuturesWorkstationCandleStore,
    floorFuturesCandleStoreBucket,
    futuresCandleStoreWindow,
    isFuturesCandleStoreBucketAligned,
    resolveFuturesCandleStoreUrl,
} from './futures-workstation-candle-store.js';

// Five-minute aligned, so every interval the tests use starts on a bucket.
const START = 1_783_999_800_000;
const MINUTE = 60_000;

const servers = [];
afterEach(async () => {
    while (servers.length) {
        const server = servers.pop();
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
    }
});

// The test's own loopback backend: what `hunter` answers, without `hunter`.
const serve = async (handler) => {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
};
const jsonServer = (respond, requests = []) => serve((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push(url);
    const body = respond(request);
    response.writeHead(body.status ?? 200, { 'content-type': body.contentType ?? 'application/json' });
    response.end(typeof body.text === 'string' ? body.text : JSON.stringify({
        requested_from: url.searchParams.get('from'), requested_to: url.searchParams.get('to'),
        actual_from: url.searchParams.get('from'), actual_to: url.searchParams.get('to'),
        ...body,
    }));
});

const bars = (count, { from = START, intervalMs = MINUTE, high = 101, low = 99 } = {}) => (
    Array.from({ length: count }, (_, index) => ({
        time: (from + (index * intervalMs)) / 1_000,
        open: 100,
        high,
        low,
        close: 100.5,
        volume: 12.5,
    }))
);
const answer = overrides => ({
    symbol: 'BTCUSDT',
    tf: '1m',
    market: 'usdm',
    bars: [],
    coverage_complete: true,
    gap_count: 0,
    ...overrides,
});
const storeOn = (url, options = {}) => {
    const timings = [];
    const store = createFuturesWorkstationCandleStore({
        env: { FUTURES_CANDLE_STORE_URL: url },
        onTiming: timing => timings.push(timing),
        ...options,
    });
    return { store, timings };
};

describe('the candle store on the wire', () => {
    it.each([
        ['another symbol', { symbol: 'ETHUSDT' }],
        ['another interval', { tf: '1h' }],
        ['missing symbol', { symbol: undefined }],
        ['missing interval', { tf: undefined }],
        ['earlier range', { requested_from: new Date(START - MINUTE).toISOString() }],
        ['later end', { requested_to: new Date(START + 4 * MINUTE).toISOString() }],
        ['missing range', { requested_from: undefined }],
        ['null range', { requested_to: null }],
    ])('rejects %s before either mode can hit', async (_label, metadata) => {
        for (const mode of ['page', 'window']) {
            const requests = [];
            const url = await jsonServer(() => answer({ bars: bars(3), ...metadata }), requests);
            const { store, timings } = storeOn(url);
            const selection = { symbol: 'BTCUSDT', interval: '1m', from: START, to: START + 3 * MINUTE, limit: 3, mode };
            expect(await store.readCandles(selection)).toBeNull();
            expect(timings[0]).toMatchObject({ outcome: 'error', code: 'STORE_IDENTITY_MISMATCH' });
            expect(await store.readCandles(selection)).toBeNull();
            expect(timings[1]).toMatchObject({ outcome: 'skipped', code: 'STORE_IDENTITY_MISMATCH' });
            expect(requests).toHaveLength(1);
            expect(JSON.stringify(timings)).not.toContain('ETHUSDT');
        }
    });

    it.each([
        ['previous page', [-3, -2, -1]], ['shifted page', [1, 2, 3]],
        ['duplicate', [0, 0, 2]], ['reversed', [2, 1, 0]],
        ['off-grid', [0, 1.5, 2]], ['skipped', [0, 2, 3]],
    ])('rejects %s buckets before the normalizer sorts them', async (_label, offsets) => {
        for (const mode of ['page', 'window']) {
            const url = await jsonServer(() => answer({ bars: offsets.map(offset => bars(1, { from: START + offset * MINUTE })[0]) }));
            const { store, timings } = storeOn(url);
            expect(await store.readCandles({ symbol: 'BTCUSDT', interval: '1m', from: START, to: START + 3 * MINUTE, limit: 3, mode })).toBeNull();
            expect(timings[0]).toMatchObject({ outcome: 'error', code: 'INVALID_STORE_GEOMETRY' });
        }
    });

    it.each([
        { volume: null }, { volume: false }, { open: '100' }, { close: null },
        { volume: undefined }, { high: Infinity }, { open: 100.000000001, high: 100, close: 100 },
    ])('does not coerce or round malformed bars into evidence: %j', async fields => {
        const url = await jsonServer(() => answer({ bars: [{ ...bars(1)[0], ...fields }] }));
        const { store, timings } = storeOn(url);
        expect(await store.readCandles({ symbol: 'BTCUSDT', interval: '1m', from: START, to: START + MINUTE, limit: 1, mode: 'page' })).toBeNull();
        expect(timings[0].outcome).toBe('error');
    });

    it('does not trust complete coverage with missing window buckets or contradictory page bounds', async () => {
        for (const offsets of [[0, 2, 3], [1, 2, 3], [0, 1, 2]]) {
            const url = await jsonServer(() => answer({ bars: offsets.map(offset => bars(1, { from: START + offset * MINUTE })[0]) }));
            const { store, timings } = storeOn(url);
            expect(await store.readCandles({ symbol: 'BTCUSDT', interval: '1m', from: START, to: START + 4 * MINUTE, limit: 4, mode: 'window' })).toBeNull();
            expect(timings[0]).toMatchObject({ outcome: 'error', code: 'INVALID_STORE_GEOMETRY' });
        }
        const url = await jsonServer(() => answer({ bars: bars(3), actual_to: new Date(START + 2 * MINUTE).toISOString() }));
        const { store, timings } = storeOn(url);
        expect(await store.readCandles({ symbol: 'BTCUSDT', interval: '1m', from: START, to: START + 3 * MINUTE, limit: 3, mode: 'page' })).toBeNull();
        expect(timings[0]).toMatchObject({ outcome: 'error', code: 'INVALID_STORE_GEOMETRY' });
    });

    it('rejects timezone-free range echoes and mismatched request geometry', async () => {
        const url = await jsonServer(() => answer({ bars: bars(1), requested_from: new Date(START).toISOString().replace('Z', '') }));
        const { store, timings } = storeOn(url);
        expect(await store.readCandles({ symbol: 'BTCUSDT', interval: '1m', from: START, to: START + MINUTE, limit: 1, mode: 'page' })).toBeNull();
        expect(timings[0]).toMatchObject({ outcome: 'error', code: 'INVALID_STORE_ANSWER' });
        await expect(store.readCandles({ symbol: 'BTCUSDT', interval: '1m', from: START, to: START + 2 * MINUTE, limit: 1, mode: 'page' }))
            .rejects.toMatchObject({ code: 'INVALID_STORE_SELECTION' });
    });

    it('serves exact Monday weeks and canonicalizes only the requested symbol', async () => {
        const from = Date.UTC(2026, 7, 31);
        const week = 604_800_000;
        const requests = [];
        const url = await jsonServer(() => answer({ tf: '1w', bars: bars(2, { from, intervalMs: week }) }), requests);
        const { store } = storeOn(url);
        const rows = await store.readCandles({ symbol: ' btcusdt ', interval: '1w', from, to: from + 2 * week, limit: 2, mode: 'page' });
        expect(rows.map(row => row.openTime)).toEqual([from, from + week]);
        expect(requests[0].pathname).toBe('/api/candles/BTCUSDT');
    });

    // The address is the integration: one wrong query and `hunter` reads the
    // exchange on the desk's behalf.
    it('asks for the exact span, the USD-M venue and no top-up, and answers the exchange\'s rows', async () => {
        const requests = [];
        const url = await jsonServer(() => answer({
            symbol: '龙虾USDT',
            bars: bars(1_000),
            actual_from: new Date(START).toISOString(),
            actual_to: new Date(START + (1_000 * MINUTE)).toISOString(),
        }), requests);
        const { store, timings } = storeOn(url);

        const rows = await store.readCandles({
            symbol: '龙虾USDT',
            interval: '1m',
            from: START,
            to: START + (1_000 * MINUTE),
            limit: 1_000,
            mode: 'page',
        });

        expect(requests).toHaveLength(1);
        expect(requests[0].pathname).toBe('/api/candles/%E9%BE%99%E8%99%BEUSDT');
        expect(Object.fromEntries(requests[0].searchParams)).toEqual({
            market: 'usdm',
            tf: '1m',
            from: new Date(START).toISOString(),
            to: new Date(START + (1_000 * MINUTE)).toISOString(),
            limit: '1000',
            topup: 'false',
        });
        expect(rows).toHaveLength(1_000);
        expect(rows[0]).toEqual({
            openTime: START,
            closeTime: START + MINUTE - 1,
            open: '100',
            high: '101',
            low: '99',
            close: '100.5',
            volume: '12.5',
            closed: true,
        });
        expect(Object.isFrozen(rows)).toBe(true);
        expect(timings).toEqual([expect.objectContaining({
            phase: 'candle-store-page', outcome: 'ok', cache: 'hit', code: null, symbol: '龙虾USDT',
        })]);
    });

    it('serves a five-minute page with the bucket\'s own close time', async () => {
        const url = await jsonServer(() => answer({
            tf: '5m',
            bars: bars(2, { intervalMs: 5 * MINUTE }),
            actual_from: new Date(START).toISOString(),
        }));
        const { store } = storeOn(url);

        const rows = await store.readCandles({
            symbol: 'BTCUSDT', interval: '5m', from: START, to: START + (10 * MINUTE), limit: 2, mode: 'page',
        });

        expect(rows.map(row => [row.openTime, row.closeTime])).toEqual([
            [START, START + (5 * MINUTE) - 1],
            [START + (5 * MINUTE), START + (10 * MINUTE) - 1],
        ]);
    });

    // A short page means the contract's first candle to the renderer, and that
    // meaning is the exchange's to give.
    it('refuses a page that is not whole', async () => {
        const cases = [
            answer({ bars: bars(999), coverage_complete: false, gap_count: 1 }),
            answer({ bars: bars(1_000), coverage_complete: false, gap_count: 0 }),
            answer({ bars: bars(1_000), coverage_complete: true, gap_count: 2 }),
        ];
        for (const body of cases) {
            const url = await jsonServer(() => body);
            const { store, timings } = storeOn(url);
            const rows = await store.readCandles({
                symbol: 'BTCUSDT', interval: '1m', from: START, to: START + (1_000 * MINUTE), limit: 1_000, mode: 'page',
            });
            expect(rows).toBeNull();
            expect(timings).toEqual([expect.objectContaining({
                phase: 'candle-store-page', outcome: 'ok', cache: 'miss', code: 'NOT_COVERED',
            })]);
        }
    });

    // A young listing, or a database younger than the span: the window is
    // served from the first bucket the store holds whole.
    it('serves a window from the first minute the store holds', async () => {
        const url = await jsonServer(() => answer({
            bars: bars(60, { from: START + (20 * MINUTE) }),
            actual_from: new Date(START + (20 * MINUTE)).toISOString(),
            actual_to: new Date(START + (80 * MINUTE)).toISOString(),
            coverage_complete: false,
            gap_count: 20,
        }));
        const { store, timings } = storeOn(url);

        const rows = await store.readCandles({
            symbol: 'BTCUSDT', interval: '1m', from: START, to: START + (80 * MINUTE), limit: 80, mode: 'window',
        });

        expect(rows).toHaveLength(60);
        expect(rows[0].openTime).toBe(START + (20 * MINUTE));
        expect(timings[0]).toMatchObject({ phase: 'candle-store-window', outcome: 'ok', cache: 'hit' });
    });

    // The store builds a bucket from the minutes it has. One whose first or
    // last minute falls inside is part of a candle, not the exchange's candle,
    // and is left to the exchange: a 5m window whose minutes start seven
    // minutes in and end three minutes short of a bucket loses a bucket at
    // each end and keeps the four whole ones between (audit, 2026-09-04).
    it('serves a window as whole buckets only, trimmed at both ends', async () => {
        const five = 5 * MINUTE;
        const url = await jsonServer(() => answer({
            tf: '5m',
            bars: bars(6, { from: START + five, intervalMs: five }),
            actual_from: new Date(START + (7 * MINUTE)).toISOString(),
            actual_to: new Date(START + (33 * MINUTE)).toISOString(),
            coverage_complete: false,
            gap_count: 7 + 7,
        }));
        const { store, timings } = storeOn(url);

        const rows = await store.readCandles({
            symbol: 'BTCUSDT', interval: '5m', from: START, to: START + (40 * MINUTE), limit: 80, mode: 'window',
        });

        expect(rows.map(row => row.openTime)).toEqual([2, 3, 4, 5].map(index => START + (index * five)));
        expect(Object.isFrozen(rows)).toBe(true);
        expect(timings[0]).toMatchObject({ phase: 'candle-store-window', outcome: 'ok', cache: 'hit', symbol: 'BTCUSDT' });
    });

    it('refuses a window whose answer does not say where its minutes are', async () => {
        const url = await jsonServer(() => answer({ bars: bars(3), actual_from: null, actual_to: null }));
        const { store, timings } = storeOn(url);

        expect(await store.readCandles({
            symbol: 'BTCUSDT', interval: '1m', from: START, to: START + (3 * MINUTE), limit: 3, mode: 'window',
        })).toBeNull();
        expect(timings[0]).toMatchObject({ outcome: 'error', code: 'INVALID_STORE_ANSWER' });
    });

    it('refuses a window with a hole in it, or with nothing in it', async () => {
        for (const body of [
            answer({
                bars: bars(77),
                actual_from: new Date(START).toISOString(),
                actual_to: new Date(START + (80 * MINUTE)).toISOString(),
                coverage_complete: false,
                gap_count: 3,
            }),
            answer({ bars: [], coverage_complete: false, gap_count: 80 }),
        ]) {
            const url = await jsonServer(() => body);
            const { store, timings } = storeOn(url);
            const rows = await store.readCandles({
                symbol: 'BTCUSDT', interval: '1m', from: START, to: START + (80 * MINUTE), limit: 80, mode: 'window',
            });
            expect(rows).toBeNull();
            expect(timings[0]).toMatchObject({ cache: 'miss', code: 'NOT_COVERED' });
        }
    });

    it('refuses a bar the exchange would refuse', async () => {
        const url = await jsonServer(() => answer({ bars: bars(3, { high: 98 }) }));
        const { store, timings } = storeOn(url);

        const rows = await store.readCandles({
            symbol: 'BTCUSDT', interval: '1m', from: START, to: START + (3 * MINUTE), limit: 3, mode: 'page',
        });

        expect(rows).toBeNull();
        expect(timings[0]).toMatchObject({ outcome: 'error', code: 'INVALID_KLINE_PRICE_RANGE' });
    });

    it('refuses an answer that is not the store\'s', async () => {
        for (const body of [
            { status: 500, json: {} },
            { text: 'not json' },
            answer({ market: 'spot', bars: bars(1) }),
            { text: '{}', contentType: 'text/html' },
        ]) {
            const url = await jsonServer(() => body);
            const { store, timings } = storeOn(url);
            const rows = await store.readCandles({
                symbol: 'BTCUSDT', interval: '1m', from: START, to: START + MINUTE, limit: 1, mode: 'page',
            });
            expect(rows).toBeNull();
            expect(timings[0].outcome).toBe('error');
            expect(['HTTP_REJECTED', 'INVALID_STORE_ANSWER', 'INVALID_CONTENT_TYPE']).toContain(timings[0].code);
        }
    });

    // `hunter` down is the desk reading the exchange as before — and not
    // knocking on a closed door for every scroll meanwhile.
    it('answers nothing when the store is unreachable, and cools down', async () => {
        const server = http.createServer(() => {});
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        await new Promise(resolve => server.close(resolve));
        let clock = START;
        const { store, timings } = storeOn(`http://127.0.0.1:${port}`, {
            now: () => clock,
            cooldownMs: 30_000,
        });
        const read = () => store.readCandles({
            symbol: 'BTCUSDT', interval: '1m', from: START, to: START + MINUTE, limit: 1, mode: 'page',
        });

        expect(await read()).toBeNull();
        expect(timings.at(-1)).toMatchObject({ outcome: 'error', code: 'STORE_UNREACHABLE' });
        clock += 10_000;
        expect(await read()).toBeNull();
        expect(timings.at(-1)).toMatchObject({ outcome: 'skipped', code: 'STORE_UNREACHABLE' });
        clock += 30_000;
        expect(await read()).toBeNull();
        expect(timings.at(-1)).toMatchObject({ outcome: 'error', code: 'STORE_UNREACHABLE' });
        expect(timings).toHaveLength(3);
    });

    it('gives the store a deadline, for its headers and for its body alike', async () => {
        for (const handler of [
            () => {},
            (request, response) => {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.write('{"market":"usdm","bars":[');
            },
        ]) {
            const url = await serve(handler);
            const { store, timings } = storeOn(url, { deadlineMs: 40 });

            const rows = await store.readCandles({
                symbol: 'BTCUSDT', interval: '1m', from: START, to: START + MINUTE, limit: 1, mode: 'page',
            });

            expect(rows).toBeNull();
            expect(timings[0]).toMatchObject({ outcome: 'error', code: 'REQUEST_DEADLINE_EXCEEDED' });
        }
    });

    it('lets the session abort a read without cooling the store down', async () => {
        const url = await serve(() => {});
        const { store, timings } = storeOn(url, { deadlineMs: 5_000 });
        const controller = new AbortController();
        const pending = store.readCandles({
            symbol: 'BTCUSDT', interval: '1m', from: START, to: START + MINUTE, limit: 1, mode: 'page', signal: controller.signal,
        });
        controller.abort();

        expect(await pending).toBeNull();
        expect(timings[0]).toMatchObject({ outcome: 'aborted', code: 'REQUEST_ABORTED' });
        const nextUrl = await jsonServer(() => answer({ bars: bars(1) }));
        const next = storeOn(nextUrl);
        expect(await next.store.readCandles({
            symbol: 'BTCUSDT', interval: '1m', from: START, to: START + MINUTE, limit: 1, mode: 'page',
        })).toHaveLength(1);
    });

    it('never connects when the store is off', async () => {
        const onTiming = vi.fn();
        const store = createFuturesWorkstationCandleStore({ env: { FUTURES_CANDLE_STORE_URL: '' }, onTiming });

        expect(store.enabled).toBe(false);
        expect(store.errorCode).toBe('CANDLE_STORE_OFF');
        expect(await store.readCandles({
            symbol: 'BTCUSDT', interval: '1m', from: START, to: START + MINUTE, limit: 1, mode: 'page',
        })).toBeNull();
        expect(onTiming).not.toHaveBeenCalled();
    });

    it('refuses a selection it cannot ask for', async () => {
        const { store } = storeOn('http://127.0.0.1:1');
        for (const selection of [
            { symbol: 'BTCUSDT', interval: '3m', from: START, to: START + MINUTE, limit: 1, mode: 'page' },
            { symbol: '', interval: '1m', from: START, to: START + MINUTE, limit: 1, mode: 'page' },
            { symbol: 'BTCUSDT', interval: '1m', from: START, to: START, limit: 1, mode: 'page' },
            { symbol: 'BTCUSDT', interval: '1m', from: START, to: START + MINUTE, limit: 1_001, mode: 'page' },
            { symbol: 'BTCUSDT', interval: '1m', from: START, to: START + MINUTE, limit: 1, mode: 'tail' },
            // A span off the interval's buckets would be answered with part
            // of a bucket at either end.
            { symbol: 'BTCUSDT', interval: '5m', from: START + MINUTE, to: START + (6 * MINUTE), limit: 1, mode: 'page' },
            { symbol: 'BTCUSDT', interval: '5m', from: START, to: START + (6 * MINUTE), limit: 2, mode: 'window' },
            { symbol: 'BTCUSDT', interval: '1w', from: 604_800_000 * 2_900, to: 604_800_000 * 2_901, limit: 1, mode: 'page' },
        ]) {
            await expect(store.readCandles(selection)).rejects.toMatchObject({ code: 'INVALID_STORE_SELECTION' });
        }
    });
});

describe('the store\'s address', () => {
    it('is the loopback backend by default, off when empty, and off with a code otherwise', () => {
        expect(resolveFuturesCandleStoreUrl({})).toMatchObject({ errorCode: null });
        expect(resolveFuturesCandleStoreUrl({}).url.href).toBe(`${FUTURES_CANDLE_STORE_DEFAULT_URL}/`);
        expect(resolveFuturesCandleStoreUrl({ FUTURES_CANDLE_STORE_URL: '' })).toEqual({ url: null, errorCode: 'CANDLE_STORE_OFF' });
        expect(resolveFuturesCandleStoreUrl({ FUTURES_CANDLE_STORE_URL: '   ' })).toEqual({ url: null, errorCode: 'CANDLE_STORE_OFF' });
        for (const address of [
            'http://10.0.0.5:8765',
            'https://127.0.0.1:8765',
            'http://user:pw@127.0.0.1:8765',
            'http://127.0.0.1:8765/?x=1',
            'http://hunter.local:8765',
        ]) {
            expect(resolveFuturesCandleStoreUrl({ FUTURES_CANDLE_STORE_URL: address }))
                .toEqual({ url: null, errorCode: 'CANDLE_STORE_NOT_LOOPBACK' });
        }
        expect(resolveFuturesCandleStoreUrl({ FUTURES_CANDLE_STORE_URL: 'not a url' }))
            .toEqual({ url: null, errorCode: 'INVALID_CANDLE_STORE_URL' });
        expect(resolveFuturesCandleStoreUrl({ FUTURES_CANDLE_STORE_URL: 'http://localhost:9000' }).url.port).toBe('9000');
    });
});

describe('the window the store is asked for', () => {
    // It starts where the exchange's 80-row window will, so the exchange's
    // rows land as an append and never move the bars; it ends at the newest
    // bucket that has had three minutes to settle.
    it('starts with the exchange\'s window and ends at the settled bucket', () => {
        const now = START + (10 * MINUTE) + 5_000;
        expect(futuresCandleStoreWindow({ interval: '1m', now, rows: 80 })).toEqual({
            from: START + (10 * MINUTE) - (79 * MINUTE),
            to: START + (7 * MINUTE),
            limit: 80,
        });
        expect(futuresCandleStoreWindow({ interval: '5m', now, rows: 80 })).toEqual({
            from: START + (10 * MINUTE) - (79 * 5 * MINUTE),
            to: START + (5 * MINUTE),
            limit: 80,
        });
    });

    // The exchange's weeks open on Monday; the epoch was a Thursday.
    it('asks for weeks that open on Monday', () => {
        const monday = Date.UTC(2026, 7, 31);
        const wednesday = Date.UTC(2026, 8, 2, 12);
        expect(new Date(monday).getUTCDay()).toBe(1);
        expect(futuresCandleStoreWindow({ interval: '1w', now: wednesday, rows: 80 })).toEqual({
            from: monday - (79 * 604_800_000),
            to: monday,
            limit: 80,
        });
        expect(floorFuturesCandleStoreBucket(wednesday, '1w')).toBe(monday);
        expect(floorFuturesCandleStoreBucket(monday, '1w')).toBe(monday);
        expect(floorFuturesCandleStoreBucket(monday - 1, '1w')).toBe(monday - 604_800_000);
        expect(isFuturesCandleStoreBucketAligned(monday, '1w')).toBe(true);
        expect(isFuturesCandleStoreBucketAligned(FUTURES_CANDLE_STORE_WEEK_EPOCH_OFFSET_MS, '1w')).toBe(true);
        expect(isFuturesCandleStoreBucketAligned(0, '1w')).toBe(false);
        expect(isFuturesCandleStoreBucketAligned(START, '5m')).toBe(true);
        expect(isFuturesCandleStoreBucketAligned(START + MINUTE, '5m')).toBe(false);
        expect(isFuturesCandleStoreBucketAligned(START, '3m')).toBe(false);
    });

    it('is nothing when the span cannot be asked for', () => {
        expect(futuresCandleStoreWindow({ interval: '1w', now: 604_800_000 * 3, rows: 80 })).toBeNull();
        expect(futuresCandleStoreWindow({ interval: '3m', now: START, rows: 80 })).toBeNull();
        expect(futuresCandleStoreWindow({ interval: '1m', now: START, rows: 0 })).toBeNull();
    });
});
