import { describe, expect, it } from 'vitest';
import { proveFuturesTradeHistoryReverseFlat } from './futures-trade-history-reverse-flat.js';

const coverage = (overrides = {}) => ({
    coveredFrom: 1_000,
    coveredTo: 5_000,
    continuityComplete: true,
    pageLimited: false,
    aborted: false,
    ...overrides,
});

const trade = ({
    id,
    side,
    quantity,
    positionSide = 'BOTH',
    time = 2_000,
}) => ({
    id: String(id),
    symbol: 'BTCUSDT',
    side,
    positionSide,
    quantity,
    time,
});

const position = (quantity, positionSide = 'BOTH') => ({
    symbol: 'BTCUSDT',
    positionSide,
    quantity,
});

describe('proveFuturesTradeHistoryReverseFlat', () => {
    it.each([
        {
            name: 'one-way long',
            positions: [position('2')],
            rows: [trade({ id: 1, side: 'BUY', quantity: '2' })],
            keys: ['BTCUSDT:BOTH'],
        },
        {
            name: 'one-way short',
            positions: [position('-2')],
            rows: [trade({ id: 1, side: 'SELL', quantity: '2' })],
            keys: ['BTCUSDT:BOTH'],
        },
        {
            name: 'hedge long',
            positions: [position('1.25', 'LONG')],
            rows: [trade({
                id: 1,
                side: 'BUY',
                quantity: '1.25',
                positionSide: 'LONG',
            })],
            keys: ['BTCUSDT:LONG'],
        },
        {
            name: 'hedge short',
            positions: [position('-2.5', 'SHORT')],
            rows: [trade({
                id: 1,
                side: 'SELL',
                quantity: '2.5',
                positionSide: 'SHORT',
            })],
            keys: ['BTCUSDT:SHORT'],
        },
        {
            name: 'both hedge legs at one boundary',
            positions: [position('1', 'LONG'), position('-2', 'SHORT')],
            rows: [
                trade({ id: 1, side: 'BUY', quantity: '1', positionSide: 'LONG' }),
                trade({ id: 2, side: 'SELL', quantity: '2', positionSide: 'SHORT' }),
            ],
            keys: ['BTCUSDT:LONG', 'BTCUSDT:SHORT'],
        },
    ])('proves $name by undoing exact signed quantities', ({ positions, rows, keys }) => {
        expect(proveFuturesTradeHistoryReverseFlat({
            symbol: 'BTCUSDT',
            positions,
            rows,
            coverage: coverage({ pageLimited: true }),
        })).toEqual({
            proven: true,
            boundary: 1_000,
            positionKeys: keys,
            reason: null,
        });
    });

    it('does not mistake a forward-only zero for an unknown left flat edge', () => {
        const result = proveFuturesTradeHistoryReverseFlat({
            symbol: 'BTCUSDT',
            positions: [],
            rows: [trade({ id: 1, side: 'SELL', quantity: '1' })],
            coverage: coverage(),
        });

        expect(result).toMatchObject({
            proven: false,
            boundary: null,
            positionKeys: ['BTCUSDT:BOTH'],
            reason: 'NON_FLAT_BOUNDARY',
        });
    });

    it.each([
        ['loading snapshot', null, [trade({ id: 1, side: 'BUY', quantity: '1' })], coverage(), 'INCOMPLETE_SUFFIX'],
        ['stale snapshot quantity', [position('2')], [trade({ id: 1, side: 'BUY', quantity: '1' })], coverage(), 'NON_FLAT_BOUNDARY'],
        ['malformed quantity', [position('1e0')], [trade({ id: 1, side: 'BUY', quantity: '1' })], coverage(), 'INVALID_SNAPSHOT'],
        ['duplicate key', [position('1'), position('1')], [trade({ id: 1, side: 'BUY', quantity: '1' })], coverage(), 'DUPLICATE_SNAPSHOT_KEY'],
        ['mixed topology', [position('1')], [trade({ id: 1, side: 'BUY', quantity: '1', positionSide: 'LONG' })], coverage(), 'MIXED_POSITION_TOPOLOGY'],
        ['aborted suffix', [position('1')], [trade({ id: 1, side: 'BUY', quantity: '1' })], coverage({ aborted: true }), 'INCOMPLETE_SUFFIX'],
        ['discontinuous suffix', [position('1')], [trade({ id: 1, side: 'BUY', quantity: '1' })], coverage({ continuityComplete: false }), 'INCOMPLETE_SUFFIX'],
    ])('rejects %s', (_name, positions, rows, evidence, reason) => {
        expect(proveFuturesTradeHistoryReverseFlat({
            symbol: 'BTCUSDT', positions, rows, coverage: evidence,
        })).toMatchObject({ proven: false, boundary: null, reason });
    });
});
