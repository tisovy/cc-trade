// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
    FuturesSettledOrderMemory,
    FuturesStreamedOrderMemory,
    createFuturesAccountStateEnvelope,
    createInitialFuturesAccountResources,
    foldFuturesWorkingOrder,
    markFuturesOrderResourcesStale,
    markFuturesResourceFailed,
    markFuturesResourceLoading,
    markFuturesResourceReady,
    reconcileFuturesWorkingOrderRead,
    sanitizeFuturesAccountError,
} from './futures-account-state.js';

describe('Futures account resource state', () => {
    it('transitions independently through loading and ready with timestamps', () => {
        const initial = createInitialFuturesAccountResources();
        const loading = markFuturesResourceLoading(initial, 'balances', 100);
        const ready = markFuturesResourceReady(
            loading,
            'balances',
            { USDT: { available: '0', total: '0' } },
            120,
        );

        expect(loading.balances).toMatchObject({
            status: 'loading',
            data: null,
            lastAttemptAt: 100,
        });
        expect(ready.balances).toMatchObject({
            status: 'ready',
            data: { USDT: { available: '0', total: '0' } },
            updatedAt: 120,
            lastSuccessfulAt: 120,
            error: null,
        });
        expect(ready.positions).toBe(initial.positions);
    });

    it('distinguishes initial error from stale last-known data', () => {
        const initial = createInitialFuturesAccountResources();
        const initialFailure = markFuturesResourceFailed(
            markFuturesResourceLoading(initial, 'regularOrders', 10),
            'regularOrders',
            { code: 'ETIMEDOUT' },
            20,
        );
        const confirmed = markFuturesResourceReady(
            initialFailure,
            'regularOrders',
            [{ orderKind: 'REGULAR', orderId: 7 }],
            30,
        );
        const stale = markFuturesResourceFailed(
            markFuturesResourceLoading(confirmed, 'regularOrders', 40),
            'regularOrders',
            { status: 503 },
            50,
        );

        expect(initialFailure.regularOrders).toMatchObject({
            status: 'error',
            data: [],
            lastSuccessfulAt: null,
        });
        expect(stale.regularOrders).toMatchObject({
            status: 'stale',
            data: [{ orderKind: 'REGULAR', orderId: 7 }],
            lastSuccessfulAt: 30,
            lastAttemptAt: 50,
        });
    });

    it('marks confirmed regular and ALGO orders stale after a user-stream failure', () => {
        let resources = createInitialFuturesAccountResources();
        resources = markFuturesResourceReady(
            resources,
            'regularOrders',
            [{ orderKind: 'REGULAR', orderId: 7 }],
            30,
        );
        resources = markFuturesResourceReady(
            resources,
            'algoOrders',
            [{ orderKind: 'ALGO', algoId: 9 }],
            31,
        );

        const stale = markFuturesOrderResourcesStale(
            resources,
            { code: 'ECONNRESET' },
            50,
        );

        expect(stale.regularOrders).toMatchObject({
            status: 'stale',
            data: [{ orderKind: 'REGULAR', orderId: 7 }],
            lastSuccessfulAt: 30,
            lastAttemptAt: 50,
            error: { code: 'FUTURES_NETWORK_ERROR' },
        });
        expect(stale.algoOrders).toMatchObject({
            status: 'stale',
            data: [{ orderKind: 'ALGO', algoId: 9 }],
            lastSuccessfulAt: 31,
            lastAttemptAt: 50,
            error: { code: 'FUTURES_NETWORK_ERROR' },
        });
    });

    it('does not manufacture stale order data before either REST resource succeeds', () => {
        const resources = createInitialFuturesAccountResources();
        const failed = markFuturesOrderResourcesStale(
            resources,
            { code: 'ECONNRESET' },
            50,
        );

        expect(failed).toBe(resources);
        expect(failed.regularOrders.status).toBe('idle');
        expect(failed.algoOrders.status).toBe('idle');
    });

    it.each([
        [{ code: -2015 }, 'FUTURES_PERMISSION_DENIED', 'permission', false],
        [{ code: -1021 }, 'FUTURES_CLOCK_SKEW', 'clock', true],
        [{ status: 429 }, 'FUTURES_RATE_LIMITED', 'rate_limit', true],
        [{ code: 'ECONNREFUSED' }, 'FUTURES_NETWORK_ERROR', 'network', true],
        [{ status: 503 }, 'FUTURES_EXCHANGE_UNAVAILABLE', 'exchange', true],
        // A 4xx describes the request, not a passing condition: Retry cannot fix it.
        [{ status: 404 }, 'FUTURES_REQUEST_REJECTED', 'exchange', false],
        [{ status: 400 }, 'FUTURES_REQUEST_REJECTED', 'exchange', false],
        [{ status: 418 }, 'FUTURES_REQUEST_REJECTED', 'exchange', false],
        // An unclassified failure with no status keeps its retryable default:
        // a transport that never answered may well answer next time.
        [{}, 'FUTURES_ACCOUNT_REQUEST_FAILED', 'exchange', true],
        [{ status: 599 }, 'FUTURES_EXCHANGE_UNAVAILABLE', 'exchange', true],
    ])('maps %# to a bounded diagnostic', (error, code, category, retryable) => {
        expect(sanitizeFuturesAccountError(error)).toEqual({
            code,
            category,
            message: expect.any(String),
            retryable,
        });
    });

    it('keeps a permission 403 non-retryable rather than folding it into the 4xx rule', () => {
        expect(sanitizeFuturesAccountError({ status: 403 })).toMatchObject({
            code: 'FUTURES_PERMISSION_DENIED',
            retryable: false,
        });
        expect(sanitizeFuturesAccountError({ status: 429 })).toMatchObject({
            code: 'FUTURES_RATE_LIMITED',
            retryable: true,
        });
    });

    it('never copies raw signed request text into the renderer envelope', () => {
        const error = new Error('https://fapi.binance.com?signature=secret&BK=secret');
        error.body = { signature: 'secret' };
        const resources = markFuturesResourceFailed(
            createInitialFuturesAccountResources(),
            'balances',
            error,
            100,
        );
        const envelope = createFuturesAccountStateEnvelope(resources, 101);

        expect(envelope).toMatchObject({
            version: 1,
            type: 'futures_account_state',
            marketType: 'futures',
            updatedAt: 101,
        });
        expect(JSON.stringify(envelope)).not.toContain('signature')
        expect(JSON.stringify(envelope)).not.toContain('secret')
    });
});

// The exchange reports every order change on the user-data stream, carrying the
// whole order. Reading the account back to learn the same thing cost weight 40
// twice — `/fapi/v1/openOrders` without a symbol, and the algo list beside it —
// on every fill, against a bucket of 800 a minute.
describe('folding an execution report into the working orders', () => {
    const order = (overrides = {}) => ({
        symbol: 'TUTUSDT',
        orderId: 11,
        orderKind: 'REGULAR',
        status: 'NEW',
        transactTime: 1_000,
        ...overrides,
    });

    const readOrders = (rows, at = 1_000) => markFuturesResourceReady(
        createInitialFuturesAccountResources(),
        'regularOrders',
        rows,
        at,
    );

    it('adds an order the stream has just opened', () => {
        const resources = readOrders([order()]);
        const next = foldFuturesWorkingOrder(
            resources,
            order({ orderId: 12, transactTime: 2_000 }),
            { now: 2_000 },
        );
        expect(next.regularOrders.data.map(row => row.orderId)).toEqual([11, 12]);
    });

    it('replaces an order the stream has just changed', () => {
        const resources = readOrders([order({ price: '1' })]);
        const next = foldFuturesWorkingOrder(
            resources,
            order({ price: '2', status: 'PARTIALLY_FILLED', transactTime: 2_000 }),
            { now: 2_000 },
        );
        expect(next.regularOrders.data).toHaveLength(1);
        expect(next.regularOrders.data[0]).toMatchObject({ price: '2', status: 'PARTIALLY_FILLED' });
    });

    it('removes an order the stream reports settled, whatever settled it', () => {
        for (const status of ['FILLED', 'CANCELED', 'EXPIRED', 'REJECTED', 'NEW_ADL']) {
            const next = foldFuturesWorkingOrder(
                readOrders([order()]),
                order({ status, transactTime: 2_000 }),
                { now: 2_000 },
            );
            expect(next.regularOrders.data).toEqual([]);
        }
    });

    // The stream updated the list; it did not prove it. A set marked stale by a
    // reconnect stays stale until a read says otherwise.
    it('does not report the set as freshly read', () => {
        const resources = readOrders([order()], 1_000);
        const stale = markFuturesOrderResourcesStale(resources, new Error('gone'), 1_500);
        const next = foldFuturesWorkingOrder(
            stale,
            order({ orderId: 12, transactTime: 2_000 }),
            { now: 2_000 },
        );
        expect(next.regularOrders).toMatchObject({
            status: 'stale',
            lastSuccessfulAt: 1_000,
            updatedAt: 2_000,
        });
    });

    // A list built from the one report that happened to arrive would present a
    // one-order account as the whole of it.
    it('folds nothing into a set that has never been read', () => {
        const initial = createInitialFuturesAccountResources();
        expect(foldFuturesWorkingOrder(initial, order(), { now: 2_000 })).toBe(initial);
    });

    it('ignores a report describing a state already replaced', () => {
        const resources = readOrders([order({ price: '2', transactTime: 3_000 })]);
        const next = foldFuturesWorkingOrder(
            resources,
            order({ price: '1', transactTime: 2_000 }),
            { now: 4_000 },
        );
        expect(next).toBe(resources);
    });

    it('ignores an order kind the stream does not speak for', () => {
        const resources = readOrders([order()]);
        expect(foldFuturesWorkingOrder(
            resources,
            order({ orderId: 99, orderKind: 'ALGO', transactTime: 2_000 }),
            { now: 2_000 },
        )).toBe(resources);
    });

    it('does not put back an order the stream already settled', () => {
        const settled = new FuturesSettledOrderMemory();
        const gone = foldFuturesWorkingOrder(
            readOrders([order()]),
            order({ status: 'FILLED', transactTime: 2_000 }),
            { settled, now: 2_000 },
        );
        // A `NEW` that took the long way round, stamped before the fill.
        const late = foldFuturesWorkingOrder(
            gone,
            order({ status: 'NEW', transactTime: 1_500 }),
            { settled, now: 3_000 },
        );
        expect(late.regularOrders.data).toEqual([]);
    });
});

describe('the memory of settled orders', () => {
    it('decides what a read that left earlier is allowed to say', () => {
        const settled = new FuturesSettledOrderMemory();
        settled.settle('TUTUSDT:11', 2_000);
        const rows = [
            { symbol: 'TUTUSDT', orderId: 11, transactTime: 1_000 },
            { symbol: 'TUTUSDT', orderId: 12, transactTime: 1_000 },
        ];
        expect(settled.filterRead(rows).map(row => row.orderId)).toEqual([12]);
    });

    // An order id is reused by nothing, but a read taken after the settle
    // describes the newer world and is believed.
    it('believes a row newer than the settle it remembers', () => {
        const settled = new FuturesSettledOrderMemory();
        settled.settle('TUTUSDT:11', 2_000);
        const rows = [{ symbol: 'TUTUSDT', orderId: 11, transactTime: 3_000 }];
        expect(settled.filterRead(rows)).toEqual(rows);
    });

    it('is a memory of the recent past, not a ledger', () => {
        const settled = new FuturesSettledOrderMemory({ maximum: 2 });
        settled.settle('A:1', 1);
        settled.settle('B:2', 2);
        settled.settle('C:3', 3);
        expect(settled.entries.size).toBe(2);
        expect(settled.allows({ symbol: 'A', orderId: 1, transactTime: 0 })).toBe(true);
        expect(settled.allows({ symbol: 'C', orderId: 3, transactTime: 0 })).toBe(false);
    });
});

describe('what a read of the working orders is allowed to say', () => {
    const order = (overrides = {}) => ({
        symbol: 'TUTUSDT',
        orderId: 11,
        orderKind: 'REGULAR',
        status: 'NEW',
        transactTime: 1_000,
        ...overrides,
    });

    const heldOrders = rows => markFuturesResourceReady(
        createInitialFuturesAccountResources(),
        'regularOrders',
        rows,
        1_000,
    );

    // The blink: a placement, the stream reporting it within milliseconds, and
    // an `/fapi/v1/openOrders` read that left before any of it and answers
    // without the order. Left alone it removes the order; the next read puts it
    // back. That is what the operator sees flashing on the chart.
    it('keeps an order the stream reported after the read left', () => {
        const streamed = new FuturesStreamedOrderMemory();
        const held = foldFuturesWorkingOrder(heldOrders([]), order({ orderId: 12 }), {
            streamed,
            now: 2_000,
        });
        const reconciled = reconcileFuturesWorkingOrderRead(held, [], {
            streamed,
            since: 1_500,
        });
        expect(reconciled.map(row => row.orderId)).toEqual([12]);
    });

    // The read is the newer statement here, and an order it omits is gone —
    // cancelled from the Binance app, or filled while the desk was not looking.
    it('removes an order the stream has said nothing newer about', () => {
        const streamed = new FuturesStreamedOrderMemory();
        const held = foldFuturesWorkingOrder(heldOrders([]), order({ orderId: 12 }), {
            streamed,
            now: 2_000,
        });
        expect(reconcileFuturesWorkingOrderRead(held, [], { streamed, since: 3_000 }))
            .toEqual([]);
    });

    it('leaves the read alone when it already lists what the stream reported', () => {
        const streamed = new FuturesStreamedOrderMemory();
        const held = foldFuturesWorkingOrder(heldOrders([]), order({ orderId: 12 }), {
            streamed,
            now: 2_000,
        });
        const rows = [order({ orderId: 12, price: '3' })];
        expect(reconcileFuturesWorkingOrderRead(held, rows, { streamed, since: 1_500 }))
            .toBe(rows);
    });

    // Both guards at once, in the two directions they run in.
    it('refuses a settled order the read lists and restores one it omits', () => {
        const settled = new FuturesSettledOrderMemory();
        const streamed = new FuturesStreamedOrderMemory();
        let held = foldFuturesWorkingOrder(heldOrders([]), order({ orderId: 12 }), {
            settled,
            streamed,
            now: 2_000,
        });
        held = foldFuturesWorkingOrder(held, order({ orderId: 13, status: 'FILLED' }), {
            settled,
            streamed,
            now: 2_100,
        });
        const reconciled = reconcileFuturesWorkingOrderRead(
            held,
            [order({ orderId: 13 })],
            { settled, streamed, since: 1_500 },
        );
        expect(reconciled.map(row => row.orderId)).toEqual([12]);
    });

    it('forgets an order the stream reports settled, so a later read may remove it', () => {
        const streamed = new FuturesStreamedOrderMemory();
        let held = foldFuturesWorkingOrder(heldOrders([]), order({ orderId: 12 }), {
            streamed,
            now: 2_000,
        });
        // The desk holds it again from a read, then the stream settles it.
        held = markFuturesResourceReady(held, 'regularOrders', [order({ orderId: 12 })], 2_500);
        const settledOff = foldFuturesWorkingOrder(
            held,
            order({ orderId: 12, status: 'CANCELED' }),
            { streamed, now: 2_600 },
        );
        expect(settledOff.regularOrders.data).toEqual([]);
        expect(streamed.notedSince('TUTUSDT:12', 1_500)).toBe(false);
    });

    it('is a memory of the recent past, not a ledger', () => {
        const streamed = new FuturesStreamedOrderMemory({ maximum: 2 });
        streamed.note('A:1', 1);
        streamed.note('B:2', 2);
        streamed.note('C:3', 3);
        expect(streamed.entries.size).toBe(2);
        expect(streamed.notedSince('A:1', 0)).toBe(false);
        expect(streamed.notedSince('C:3', 0)).toBe(true);
    });
});
