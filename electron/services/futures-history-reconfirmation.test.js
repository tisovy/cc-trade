import { describe, expect, it } from 'vitest';
import {
    createHeldFuturesHistory,
    foldExecutionIntoFuturesHistory,
} from '../../src/utils/futuresHeldHistory.js';
import {
    FUTURES_HISTORY_SCORED_FIELDS,
    addFuturesHistoryScore,
    createFuturesHistoryStreamShadow,
    emptyFuturesHistoryScore,
    futuresHistoryStreamFillOf,
    scoreFuturesHistoryReading,
} from './futures-history-reconfirmation.js';

// The adapter's normalized execution report, as it reaches the main process
// and the renderer alike.
const report = (overrides = {}) => ({
    e: 'executionReport',
    symbol: 'BTCUSDT',
    s: 'BTCUSDT',
    side: 'SELL',
    status: 'FILLED',
    X: 'FILLED',
    x: 'TRADE',
    orderId: 77,
    i: 77,
    tradeId: 4101,
    lastFilledPrice: '100.50',
    lastFilledQty: '0.400',
    l: '0.400',
    z: '0.400',
    realizedPnl: '12.5',
    commission: '0.00402000',
    commissionAsset: 'USDT',
    T: 1_700_000_500,
    time: 1_700_000_500,
    ...overrides,
});

// A `/userTrades` row after the adapter's evidence projection.
const restRow = (overrides = {}) => ({
    id: '4101',
    orderId: '77',
    symbol: 'BTCUSDT',
    side: 'SELL',
    positionSide: 'BOTH',
    price: '100.50',
    quantity: '0.400',
    quoteQty: '40.2',
    realizedPnl: '12.5',
    commission: '0.00402000',
    commissionAsset: 'USDT',
    marginAsset: 'USDT',
    maker: false,
    time: 1_700_000_500,
    ...overrides,
});

describe('the shadow projects a report as the renderer folds it', () => {
    // The fold is what puts the fill on screen; the shadow is what the read is
    // scored against. If they read a field differently, `differing` stops
    // meaning "the exchange disagrees with what the operator saw".
    it('reads the six scored fields exactly as tradeRowFromReport does', () => {
        const held = Object.freeze({
            ...createHeldFuturesHistory(),
            readAt: 1_700_000_000,
            symbol: 'BTCUSDT',
            symbols: Object.freeze(['BTCUSDT']),
        });
        for (const variant of [
            report(),
            report({ lastFilledPrice: undefined, price: '99', commissionAsset: undefined }),
            report({ commission: undefined, realizedPnl: undefined, time: undefined, T: '1700000600' }),
            report({ lastFilledQty: undefined, l: '2' }),
        ]) {
            const folded = foldExecutionIntoFuturesHistory(held, variant).trades[0];
            const shadowed = futuresHistoryStreamFillOf(variant);
            for (const field of FUTURES_HISTORY_SCORED_FIELDS) {
                expect(shadowed[field]).toEqual(folded[field]);
            }
        }
    });
});

describe('scoring one contract against the stream', () => {
    const shadow = createFuturesHistoryStreamShadow();
    shadow.note('BTCUSDT', 4101, report(), 1_700_000_600);
    shadow.note('BTCUSDT', 4102, report({ tradeId: 4102, T: 1_700_000_550, time: 1_700_000_550 }), 1_700_000_600);
    const fills = shadow.fillsOf('btcusdt');

    it('holds every row the stream reported, with nothing unreported or differing', () => {
        expect(scoreFuturesHistoryReading({
            rows: [restRow(), restRow({ id: '4102', time: 1_700_000_550 })],
            fills,
            connectedAt: 1_700_000_000,
        })).toEqual({ returned: 2, restated: 0, held: 2, unreported: 0, differing: 0 });
    });

    it('counts a fill the stream never reported', () => {
        expect(scoreFuturesHistoryReading({
            rows: [restRow(), restRow({ id: '4103', time: 1_700_000_560 })],
            fills,
            connectedAt: 1_700_000_000,
        })).toEqual({ returned: 2, restated: 0, held: 1, unreported: 1, differing: 0 });
    });

    it('counts a row whose fields the exchange states differently, once', () => {
        expect(scoreFuturesHistoryReading({
            rows: [restRow({ commission: '0.00500000', realizedPnl: '12.4' })],
            fills,
            connectedAt: 1_700_000_000,
        })).toEqual({ returned: 1, restated: 0, held: 1, unreported: 0, differing: 1 });
    });

    // The stream and the endpoint do not promise the same scale.
    it('does not call trailing zeros a difference', () => {
        expect(scoreFuturesHistoryReading({
            rows: [restRow({ commission: '0.00402', price: '100.5', quantity: '0.4' })],
            fills,
            connectedAt: 1_700_000_000,
        })).toEqual({ returned: 1, restated: 0, held: 1, unreported: 0, differing: 0 });
    });

    it('calls a moved time or a changed fee asset a difference', () => {
        expect(scoreFuturesHistoryReading({
            rows: [restRow({ time: 1_700_000_501 })],
            fills,
            connectedAt: 1_700_000_000,
        }).differing).toBe(1);
        expect(scoreFuturesHistoryReading({
            rows: [restRow({ commissionAsset: 'BNB' })],
            fills,
            connectedAt: 1_700_000_000,
        }).differing).toBe(1);
    });

    // A reconnect inside the window: the rows from before the current epoch
    // connected are restated, not unreported — the socket's downtime is not
    // the socket's failure.
    it('restates rows from before the stream connected instead of judging them', () => {
        expect(scoreFuturesHistoryReading({
            rows: [
                restRow({ id: '3999', time: 1_699_999_000 }),
                restRow({ id: '4000', time: 1_700_000_100 }),
                restRow(),
            ],
            fills,
            connectedAt: 1_700_000_200,
        })).toEqual({ returned: 3, restated: 2, held: 1, unreported: 0, differing: 0 });
    });

    // Fills that executed as the request left. The exchange's answer can
    // carry them before their reports have crossed the socket — on
    // 2026-09-03 a read after a burst returned 86 rows, 37 of them fills of
    // that instant, and the pass 0.35 s later held every one.
    it('restates rows newer than the pass began, less a report in flight', () => {
        expect(scoreFuturesHistoryReading({
            rows: [
                restRow(),
                restRow({ id: '4103', time: 1_700_000_900 }),
                restRow({ id: '4104', time: 1_700_000_700 }),
                // The bound itself is judged: a report has had its flight.
                restRow({ id: '4105', time: 1_700_000_800 }),
            ],
            fills,
            connectedAt: 1_700_000_000,
            judgeTo: 1_700_000_800,
        })).toEqual({ returned: 4, restated: 1, held: 1, unreported: 2, differing: 0 });
    });

    it('restates everything when no stream is connected', () => {
        expect(scoreFuturesHistoryReading({
            rows: [restRow(), restRow({ id: '4103' })],
            fills,
            connectedAt: null,
        })).toEqual({ returned: 2, restated: 2, held: 0, unreported: 0, differing: 0 });
    });

    it('scores an empty answer as nothing', () => {
        expect(scoreFuturesHistoryReading({ rows: [], fills, connectedAt: 1 }))
            .toEqual({ returned: 0, restated: 0, held: 0, unreported: 0, differing: 0 });
        expect(scoreFuturesHistoryReading({ rows: [restRow()], connectedAt: 1 }))
            .toEqual({ returned: 1, restated: 0, held: 0, unreported: 1, differing: 0 });
    });
});

describe('the shadow is bounded like the review', () => {
    it('keeps the newest identities per contract and forgets the rest', () => {
        const shadow = createFuturesHistoryStreamShadow({ maxPerContract: 3 });
        for (const id of [1, 2, 3, 4]) shadow.note('ETHUSDT', id, report({ tradeId: id }), 10);
        expect([...shadow.fillsOf('ETHUSDT').keys()]).toEqual(['2', '3', '4']);
        expect(shadow.fillsOf('BTCUSDT').size).toBe(0);
    });

    it('drops fills older than the window', () => {
        const shadow = createFuturesHistoryStreamShadow({ windowMs: 1_000 });
        shadow.note('ETHUSDT', 1, report({ tradeId: 1, T: 100, time: 100 }), 100);
        shadow.note('ETHUSDT', 2, report({ tradeId: 2, T: 900, time: 900 }), 900);
        shadow.note('ETHUSDT', 3, report({ tradeId: 3, T: 1_500, time: 1_500 }), 1_500);
        expect([...shadow.fillsOf('ETHUSDT').keys()]).toEqual(['2', '3']);
    });

    it('refuses a fill without an identity or a contract', () => {
        const shadow = createFuturesHistoryStreamShadow();
        expect(shadow.note('ETHUSDT', null, report())).toBe(false);
        expect(shadow.note('', 5, report())).toBe(false);
        expect(shadow.note('ETHUSDT', 'not-a-number', report())).toBe(false);
        expect(shadow.fillsOf('ETHUSDT').size).toBe(0);
    });

    it('clears with the rest of the per-activation history state', () => {
        const shadow = createFuturesHistoryStreamShadow();
        shadow.note('ETHUSDT', 1, report({ tradeId: 1 }));
        shadow.clear();
        expect(shadow.fillsOf('ETHUSDT').size).toBe(0);
    });
});

describe('a pass sums its contracts', () => {
    it('adds counts and keeps the vouch until a contract withdraws it', () => {
        const total = emptyFuturesHistoryScore();
        addFuturesHistoryScore(total, { returned: 3, restated: 1, held: 2, unreported: 0, differing: 1 });
        addFuturesHistoryScore(total, { returned: 1, restated: 0, held: 0, unreported: 1, differing: 0 });
        expect(total).toEqual({
            contracts: 2,
            reads: 0,
            returned: 4,
            restated: 1,
            held: 2,
            unreported: 1,
            differing: 1,
            vouched: true,
        });
    });
});
