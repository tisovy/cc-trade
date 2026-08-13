// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
    FuturesSettledOrderMemory,
    FuturesStreamedOrderMemory,
    createFuturesAccountStateEnvelope,
    createInitialFuturesAccountResources,
    foldFuturesAccountUpdate,
    reconcileFuturesUnstatedBalanceRead,
    reconcileFuturesUnstatedPositionRead,
    foldFuturesWorkingOrder,
    markFuturesOrderResourcesStale,
    markFuturesResourceFailed,
    markFuturesResourceLoading,
    markFuturesResourceReady,
    FUTURES_WORKING_ORDER_READ_LAG_MS,
    reconcileFuturesWorkingOrderRead,
    sanitizeFuturesAccountError,
    widenFuturesAccountReadReason,
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

    // The exact shape of the blink the operator reported: the exchange accepts
    // the order, the stream says NEW, the desk asks for the account it has just
    // changed — and that read, issued *after* the stream spoke, comes back
    // without the order because Binance's REST view has not caught up with its
    // own matching engine. Believing it took the order off the screen until the
    // next read put it back.
    it('keeps an order a read issued just after the stream has not caught up with', () => {
        const streamed = new FuturesStreamedOrderMemory();
        const held = foldFuturesWorkingOrder(heldOrders([]), order({ orderId: 12 }), {
            streamed,
            now: 2_000,
        });
        const reconciled = reconcileFuturesWorkingOrderRead(held, [], {
            streamed,
            since: 2_400,
        });
        expect(reconciled.map(row => row.orderId)).toEqual([12]);
    });

    // The read is the newer statement here, and an order it omits is gone —
    // cancelled from the Binance app, or filled while the desk was not looking.
    // Past the window the exchange's own lag lives in, the read is believed.
    it('removes an order the stream has said nothing newer about', () => {
        const streamed = new FuturesStreamedOrderMemory();
        const held = foldFuturesWorkingOrder(heldOrders([]), order({ orderId: 12 }), {
            streamed,
            now: 2_000,
        });
        const since = 2_000 + FUTURES_WORKING_ORDER_READ_LAG_MS + 1;
        expect(reconcileFuturesWorkingOrderRead(held, [], { streamed, since }))
            .toEqual([]);
    });

    // The window is what the exchange's lag needs, not what the desk feels like
    // holding: a read past it removes the order on the very next pass.
    it('measures the window from the stream, not from the read', () => {
        const streamed = new FuturesStreamedOrderMemory();
        const held = foldFuturesWorkingOrder(heldOrders([]), order({ orderId: 12 }), {
            streamed,
            now: 2_000,
        });
        const atTheEdge = 2_000 + FUTURES_WORKING_ORDER_READ_LAG_MS;
        expect(reconcileFuturesWorkingOrderRead(held, [], { streamed, since: atTheEdge })
            .map(row => row.orderId)).toEqual([12]);
        expect(reconcileFuturesWorkingOrderRead(held, [], { streamed, since: atTheEdge, lag: 0 }))
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

    // One order leaves by `drop`, all of them by `forget` — the same word the
    // settled memory beside it uses for the same thing. Named apart because a
    // `forget(identity)` here would have read like the sibling's reset and
    // cleared nothing.
    it('drops one order and forgets all of them', () => {
        const streamed = new FuturesStreamedOrderMemory();
        streamed.note('A:1', 1);
        streamed.note('B:2', 2);
        streamed.drop('A:1');
        expect(streamed.notedSince('A:1', 0)).toBe(false);
        expect(streamed.notedSince('B:2', 0)).toBe(true);
        streamed.forget();
        expect(streamed.entries.size).toBe(0);
    });
});

describe('folding an account update into the wallet and the positions', () => {
    const held = ({ balances = null, positions = null } = {}) => {
        let resources = createInitialFuturesAccountResources();
        if (balances !== null) {
            resources = markFuturesResourceReady(resources, 'balances', balances, 1_000);
        }
        if (positions !== null) {
            resources = markFuturesResourceReady(resources, 'positions', positions, 1_000);
        }
        return resources;
    };

    const wallet = (overrides = {}) => ({
        USDT: { available: '900', total: '1000', crossUnPnl: '0', ...overrides },
    });

    const position = (overrides = {}) => ({
        symbol: 'TUTUSDT',
        positionSide: 'BOTH',
        quantity: '10',
        entryPrice: '2',
        unrealizedPnl: '0',
        marginType: 'CROSS',
        isolatedWallet: '0',
        liquidationPrice: '1.5',
        leverage: '5',
        ...overrides,
    });

    const framed = (overrides = {}) => ({
        symbol: 'TUTUSDT',
        positionSide: 'BOTH',
        quantity: '10',
        entryPrice: '2',
        unrealizedPnl: '0',
        marginType: 'CROSS',
        isolatedWallet: '0',
        ...overrides,
    });

    it('carries the size and entry the frame states without waiting for a read', () => {
        const resources = held({ balances: wallet(), positions: [position()] });
        const { resources: next, unstated } = foldFuturesAccountUpdate(resources, {
            balances: [{ asset: 'USDT', walletBalance: '1010.5' }],
            positions: [framed({ quantity: '25', entryPrice: '2.1' })],
        }, { now: 2_000 });
        expect(next.positions.data).toEqual([position({ quantity: '25', entryPrice: '2.1' })]);
        expect(next.balances.data.USDT.total).toBe('1010.5');
        // The read that answered before is still what the free margin and the
        // liquidation price came from — the frame carries neither.
        expect(next.balances.data.USDT.available).toBe('900');
        expect(next.positions.data[0].liquidationPrice).toBe('1.5');
        expect(unstated).toEqual(['positions', 'balances']);
    });

    // The stream updated the reading; it did not prove it. A resource marked
    // stale by a reconnect must stay stale until a read says otherwise.
    it('leaves the resource status and its last successful read alone', () => {
        const resources = held({ positions: [position()] });
        const { resources: next } = foldFuturesAccountUpdate(resources, {
            positions: [framed({ quantity: '25' })],
        }, { now: 2_000 });
        expect(next.positions.status).toBe(resources.positions.status);
        expect(next.positions.lastSuccessfulAt).toBe(1_000);
        expect(next.positions.updatedAt).toBe(2_000);
    });

    it('drops a position the frame reports at zero and keeps the others', () => {
        const resources = held({
            positions: [position(), position({ symbol: 'BMTUSDT' })],
        });
        const { resources: next, unstated } = foldFuturesAccountUpdate(resources, {
            positions: [framed({ quantity: '0', entryPrice: '0.0' })],
        }, { now: 2_000 });
        expect(next.positions.data.map(row => row.symbol)).toEqual(['BMTUSDT']);
        expect(unstated).toEqual(['positions', 'balances']);
    });

    it('folds a hedged contract onto the side the frame names', () => {
        const resources = held({
            positions: [
                position({ positionSide: 'LONG' }),
                position({ positionSide: 'SHORT', quantity: '4' }),
            ],
        });
        const { resources: next } = foldFuturesAccountUpdate(resources, {
            positions: [framed({ positionSide: 'SHORT', quantity: '7' })],
        }, { now: 2_000 });
        expect(next.positions.data.map(row => [row.positionSide, row.quantity]))
            .toEqual([['LONG', '10'], ['SHORT', '7']]);
    });

    it('leaves the positions alone for a frame that only moves the wallet', () => {
        const resources = held({ balances: wallet(), positions: [position()] });
        const { resources: next, unstated } = foldFuturesAccountUpdate(resources, {
            balances: [{ asset: 'USDT', walletBalance: '1010.5' }],
            positions: [],
        }, { now: 2_000 });
        expect(next.positions).toBe(resources.positions);
        expect(unstated).toEqual(['balances']);
    });

    it('asks for no read when the frame states nothing the account did not say', () => {
        const resources = held({ balances: wallet(), positions: [position()] });
        const { resources: next, unstated } = foldFuturesAccountUpdate(resources, {
            balances: [{ asset: 'USDT', walletBalance: '1000' }],
            positions: [framed()],
        }, { now: 2_000 });
        expect(next).toBe(resources);
        expect(unstated).toEqual([]);
    });

    // A wallet built from the one asset a frame happened to move, or a position
    // list built from the one contract it touched, would be presented as the
    // whole account.
    it('folds nothing into a resource that has never been read', () => {
        const resources = createInitialFuturesAccountResources();
        const { resources: next, unstated } = foldFuturesAccountUpdate(resources, {
            balances: [{ asset: 'USDT', walletBalance: '1010.5' }],
            positions: [framed()],
        }, { now: 2_000 });
        expect(next).toBe(resources);
        expect(unstated).toEqual([]);
    });

    it('opens a position on a contract the desk holds nothing for', () => {
        const resources = held({ positions: [] });
        const { resources: next } = foldFuturesAccountUpdate(resources, {
            positions: [framed({ symbol: 'BMTUSDT', quantity: '3' })],
        }, { now: 2_000 });
        // Shown with what the frame states and without a liquidation price, which
        // the read that follows fills in. A computed one would be there at once
        // and wrong exactly where it matters.
        expect(next.positions.data).toEqual([{
            symbol: 'BMTUSDT',
            positionSide: 'BOTH',
            quantity: '3',
            entryPrice: '2',
            unrealizedPnl: '0',
            marginType: 'CROSS',
            isolatedWallet: '0',
        }]);
        expect(next.positions.data[0].liquidationPrice).toBeUndefined();
    });
});

describe('what a read issued only for the unstated values may change', () => {
    const held = positions => markFuturesResourceReady(
        createInitialFuturesAccountResources(),
        'positions',
        positions,
        1_000,
    );

    it('takes the liquidation price from the read and the size from the stream', () => {
        const resources = held([{
            symbol: 'TUTUSDT', positionSide: 'BOTH', quantity: '25', entryPrice: '2.1',
        }]);
        expect(reconcileFuturesUnstatedPositionRead(resources, [{
            // The replica answered a fill behind, which is what it is allowed to
            // do and what this refuses to believe.
            symbol: 'TUTUSDT', positionSide: 'BOTH', quantity: '10', entryPrice: '2',
            liquidationPrice: '1.5', leverage: '5',
        }])).toEqual([{
            symbol: 'TUTUSDT', positionSide: 'BOTH', quantity: '25', entryPrice: '2.1',
            liquidationPrice: '1.5', leverage: '5',
        }]);
    });

    // The frame says a position closed by reporting it at zero, and the fold has
    // already dropped it. A read that has not caught up must not put it back.
    it('does not restore a position the stream has already closed', () => {
        const resources = held([]);
        expect(reconcileFuturesUnstatedPositionRead(resources, [
            { symbol: 'TUTUSDT', positionSide: 'BOTH', quantity: '10' },
        ])).toEqual([{ symbol: 'TUTUSDT', positionSide: 'BOTH', quantity: '10' }]);

        const withOther = held([{ symbol: 'BMTUSDT', positionSide: 'BOTH', quantity: '4' }]);
        expect(reconcileFuturesUnstatedPositionRead(withOther, [
            { symbol: 'BMTUSDT', positionSide: 'BOTH', quantity: '4' },
            { symbol: 'TUTUSDT', positionSide: 'BOTH', quantity: '10' },
        ]).map(row => row.symbol)).toEqual(['BMTUSDT', 'TUTUSDT']);
    });

    it('keeps a position the read leaves out', () => {
        const resources = held([
            { symbol: 'TUTUSDT', positionSide: 'BOTH', quantity: '25' },
            { symbol: 'BMTUSDT', positionSide: 'BOTH', quantity: '4' },
        ]);
        expect(reconcileFuturesUnstatedPositionRead(resources, [
            { symbol: 'BMTUSDT', positionSide: 'BOTH', quantity: '4', liquidationPrice: '9' },
        ]).map(row => [row.symbol, row.quantity])).toEqual([['TUTUSDT', '25'], ['BMTUSDT', '4']]);
    });

    it('takes the free margin from the read and the balance from the stream', () => {
        const resources = markFuturesResourceReady(
            createInitialFuturesAccountResources(),
            'balances',
            { USDT: { available: '900', total: '1200' } },
            1_000,
        );
        expect(reconcileFuturesUnstatedBalanceRead(resources, {
            USDT: { available: '640', total: '1000', crossUnPnl: '5' },
        })).toEqual({ USDT: { available: '640', total: '1200', crossUnPnl: '5' } });
    });

    it('takes an asset the desk holds nothing for exactly as the read states it', () => {
        const resources = markFuturesResourceReady(
            createInitialFuturesAccountResources(),
            'balances',
            { USDT: { available: '900', total: '1200' } },
            1_000,
        );
        expect(reconcileFuturesUnstatedBalanceRead(resources, {
            USDT: { available: '640', total: '1000' },
            BNB: { available: '2', total: '2' },
        }).BNB).toEqual({ available: '2', total: '2' });
    });
});

// Two requests can queue behind one running read, and the pass that follows
// answers both of them. Its resources are already the union of what they asked
// for; without the same rule on the reason, whichever asked last decided what
// the pass was allowed to say — and a frame arriving a moment after the
// operator pressed refresh turned that refresh into a read that may not correct
// a single position row.
describe('which reason a pass answering two requests carries', () => {
    it('takes the reason when nothing is queued yet', () => {
        expect(widenFuturesAccountReadReason(null, 'unstated')).toBe('unstated');
    });

    it('keeps one reason when both requests state it', () => {
        expect(widenFuturesAccountReadReason('unstated', 'unstated')).toBe('unstated');
    });

    it('does not let a frame narrow the read the operator asked for', () => {
        expect(widenFuturesAccountReadReason('refresh', 'unstated')).toBe('refresh');
    });

    it('widens a read asked for by a frame when a reconnect queues behind it', () => {
        expect(widenFuturesAccountReadReason('unstated', 'stream')).toBe('stream');
    });

    // Two full-power reasons say the same thing about what the pass may state,
    // so the first one stands rather than the record gaining a reason nobody
    // asked for.
    it('keeps the first of two reasons that narrow nothing', () => {
        expect(widenFuturesAccountReadReason('command', 'setting')).toBe('command');
    });

    // A site that stated no reason loses its record line by design. It must not
    // gain the narrowing of a frame's read on the way.
    it('does not carry a narrowing reason onto a read that stated none', () => {
        expect(widenFuturesAccountReadReason('unstated', null)).toBeNull();
    });
});
