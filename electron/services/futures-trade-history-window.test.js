// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { readFuturesTradeHistoryWindow } from './futures-trade-history-window.js';

const trade = (id, time, symbol = 'BTCUSDT', overrides = {}) => ({
    id: String(id),
    orderId: String(id),
    symbol,
    side: 'BUY',
    positionSide: 'BOTH',
    price: '100',
    quantity: '1',
    quoteQty: '100',
    realizedPnl: '0',
    commission: '0',
    commissionAsset: null,
    marginAsset: 'USDT',
    maker: false,
    time,
    ...overrides,
});

describe('readFuturesTradeHistoryWindow', () => {
    it('subdivides a full unordered page newest-first, deduplicates, and sorts locally', async () => {
        const readWindow = vi.fn(async ({ startTime, endTime }) => {
            if (startTime === 0 && endTime === 9) {
                return [trade(2, 3), trade(3, 7)];
            }
            if (startTime === 5 && endTime === 9) return [trade(3, 7)];
            return [trade(2, 3)];
        });

        const result = await readFuturesTradeHistoryWindow({
            readWindow,
            startTime: 0,
            endTime: 9,
            limits: { PAGE_SIZE: 2, MAX_REQUESTS: 8 },
        });

        expect(readWindow.mock.calls.map(([window]) => [window.startTime, window.endTime]))
            .toEqual([[0, 9], [5, 9], [0, 4]]);
        expect(result.rows.map(row => row.id)).toEqual(['3', '2']);
        expect(result.unresolvedRows).toEqual([]);
        expect(result.coverage).toMatchObject({
            coveredFrom: 0,
            coveredTo: 9,
            complete: true,
            pageLimited: false,
            continuityComplete: true,
            aborted: false,
            requests: 3,
        });
    });

    it('treats exactly 1000 rows as a subdivision signal until both halves are short', async () => {
        const rows = Array.from({ length: 1_000 }, (_, index) => trade(
            index + 1,
            index < 500 ? 10_000 : 10_001,
        ));
        const readWindow = vi.fn(async ({ startTime, endTime }) => {
            if (startTime === 10_000 && endTime === 10_001) return [...rows].reverse();
            return rows.filter(row => row.time >= startTime && row.time <= endTime);
        });

        const result = await readFuturesTradeHistoryWindow({
            readWindow,
            startTime: 10_000,
            endTime: 10_001,
        });

        expect(readWindow).toHaveBeenCalledTimes(3);
        expect(result.rows).toHaveLength(1_000);
        expect(result.unresolvedRows).toEqual([]);
        expect(result.rows[0].id).toBe('1000');
        expect(result.rows.at(-1).id).toBe('1');
        expect(result.coverage).toMatchObject({
            complete: true,
            pageLimited: false,
            coveredFrom: 10_000,
            coveredTo: 10_001,
            continuityComplete: true,
        });
    });

    it('stops at the request bound and leaves the remaining window explicitly partial', async () => {
        const readWindow = vi.fn(async ({ startTime }) => [
            trade(`${startTime}1`, startTime),
            trade(`${startTime}2`, startTime),
        ]);

        const result = await readFuturesTradeHistoryWindow({
            readWindow,
            startTime: 0,
            endTime: 15,
            // Test-only overrides are normalized exactly like production
            // constants; fractional request/page bounds cannot leak to REST.
            limits: { PAGE_SIZE: 2.9, MAX_REQUESTS: 2.9 },
        });

        expect(readWindow).toHaveBeenCalledTimes(2);
        expect(readWindow.mock.calls.every(([window]) => window.limit === 2)).toBe(true);
        expect(result.rows).toEqual([]);
        expect(result.unresolvedRows).not.toHaveLength(0);
        expect(result.coverage).toMatchObject({
            complete: false,
            pageLimited: true,
            coveredFrom: null,
            coveredTo: null,
            continuityComplete: false,
            requests: 2,
        });
    });

    it('rejects an oversized answer before inspecting or retaining any row', async () => {
        let rowReads = 0;
        const page = new Proxy([
            trade(1, 10_000),
            trade(2, 10_001),
        ], {
            get(target, property, receiver) {
                if (property === '0' || property === '1') rowReads += 1;
                return Reflect.get(target, property, receiver);
            },
        });

        await expect(readFuturesTradeHistoryWindow({
            readWindow: async () => page,
            startTime: 10_000,
            endTime: 11_000,
            limits: { PAGE_SIZE: 1, MAX_REQUESTS: 1 },
        })).rejects.toMatchObject({ code: 'OVERSIZED_TRADE_PAGE' });

        expect(rowReads).toBe(0);
    });

    it('lets injected limits narrow but never widen production ceilings', async () => {
        let identity = 1;
        const readWindow = vi.fn(async ({ startTime }) => Array.from(
            { length: 1_000 },
            () => trade(identity++, startTime),
        ));

        const result = await readFuturesTradeHistoryWindow({
            readWindow,
            startTime: 0,
            endTime: 255,
            limits: { PAGE_SIZE: 10_000, MAX_REQUESTS: 10_000 },
        });

        expect(readWindow).toHaveBeenCalledTimes(8);
        expect(readWindow.mock.calls.every(([window]) => window.limit === 1_000)).toBe(true);
        expect(result.coverage).toMatchObject({
            complete: false,
            pageLimited: true,
            requests: 8,
        });

        const narrowed = vi.fn(async () => [trade(9_999, 10_000)]);
        const one = await readFuturesTradeHistoryWindow({
            readWindow: narrowed,
            startTime: 10_000,
            endTime: 11_000,
            limits: { PAGE_SIZE: 0, MAX_REQUESTS: -2 },
        });
        expect(narrowed).toHaveBeenCalledTimes(1);
        expect(narrowed.mock.calls[0][0].limit).toBe(1);
        expect(one.coverage.requests).toBe(1);
    });

    it('does not skip an overflowing same-millisecond page and orders unsafe ids exactly', async () => {
        const readWindow = vi.fn(async () => [
            trade('9007199254740992', 20_000),
            trade('9007199254740993', 20_000),
        ]);

        const result = await readFuturesTradeHistoryWindow({
            readWindow,
            startTime: 20_000,
            endTime: 20_000,
            limits: { PAGE_SIZE: 2, MAX_REQUESTS: 8 },
        });

        expect(readWindow).toHaveBeenCalledTimes(1);
        expect(result.rows).toEqual([]);
        expect(result.unresolvedRows.map(row => row.id)).toEqual([
            '9007199254740993',
            '9007199254740992',
        ]);
        expect(result.coverage).toMatchObject({
            complete: false,
            pageLimited: true,
            coveredFrom: null,
            coveredTo: null,
            continuityComplete: false,
        });
    });

    it.each([
        [
            'an unnamed trade',
            () => [{ ...trade(1, 10_000), id: null }],
            'INVALID_TRADE_IDENTITY',
        ],
        [
            'an out-of-window trade',
            () => [trade(1, 9_999)],
            'OUT_OF_WINDOW_TRADE',
        ],
    ])('rejects %s without committing partial coverage', async (
        _case,
        answer,
        code,
    ) => {
        await expect(readFuturesTradeHistoryWindow({
            readWindow: answer,
            startTime: 10_000,
            endTime: 11_000,
        })).rejects.toMatchObject({ code });
    });

    it('accepts identical overlap copies and rejects conflicting reuse of one trade id', async () => {
        const identical = trade(2, 7);
        const accepted = await readFuturesTradeHistoryWindow({
            readWindow: async ({ startTime, endTime }) => {
                if (startTime === 0 && endTime === 9) return [trade(1, 3), identical];
                if (startTime === 5) return [{ ...identical }];
                return [trade(1, 3)];
            },
            startTime: 0,
            endTime: 9,
            limits: { PAGE_SIZE: 2, MAX_REQUESTS: 8 },
        });
        expect(accepted.coverage.complete).toBe(true);
        expect(accepted.rows.map(row => row.id)).toEqual(['2', '1']);

        await expect(readFuturesTradeHistoryWindow({
            readWindow: async ({ startTime, endTime }) => {
                if (startTime === 0 && endTime === 9) {
                    return [trade(1, 3), { ...identical, price: '100' }];
                }
                if (startTime === 5) return [{ ...identical, price: '101' }];
                return [trade(1, 3)];
            },
            startTime: 0,
            endTime: 9,
            limits: { PAGE_SIZE: 2, MAX_REQUESTS: 8 },
        })).rejects.toMatchObject({ code: 'CONFLICTING_TRADE_IDENTITY' });
    });

    it('rejects a foreign contract before a logical page can contribute rows or coverage', async () => {
        const readWindow = vi.fn(async () => [
            trade(1, 10_000),
            trade(2, 10_001, 'ETHUSDT'),
        ]);

        await expect(readFuturesTradeHistoryWindow({
            readWindow,
            startTime: 10_000,
            endTime: 11_000,
            expectedSymbol: 'BTCUSDT',
        })).rejects.toMatchObject({ code: 'FOREIGN_TRADE_SYMBOL' });
        expect(readWindow).toHaveBeenCalledTimes(1);
    });

    // 2026-08-28: the operator's account holds real trades on the exchange's
    // own unicode listing (龙虾USDT — traded from the Binance app; the desk's
    // execution path deliberately will not place them). The read side refused
    // the symbol outright — «A valid expected trade-history symbol is
    // required» on every request, retried forever — so the history could not
    // read a contract the account demonstrably traded. Reading is not
    // executing: evidence reads the exchange's identity alphabet.
    it('reads a unicode listing the account actually traded', async () => {
        const result = await readFuturesTradeHistoryWindow({
            readWindow: async () => [trade(1, 10_000, '龙虾USDT')],
            startTime: 10_000,
            endTime: 11_000,
            expectedSymbol: '龙虾USDT',
        });

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].symbol).toBe('龙虾USDT');
        expect(result.coverage.complete).toBe(true);
    });

    it('still rejects a foreign contract against a unicode expectation', async () => {
        await expect(readFuturesTradeHistoryWindow({
            readWindow: async () => [trade(1, 10_000, 'VELVETUSDT')],
            startTime: 10_000,
            endTime: 11_000,
            expectedSymbol: '龙虾USDT',
        })).rejects.toMatchObject({ code: 'FOREIGN_TRADE_SYMBOL' });
    });

    it.each([
        ['numeric trade identity', { id: 2 }, 'INVALID_TRADE_IDENTITY'],
        ['missing order identity', { orderId: null }, 'INVALID_TRADE_IDENTITY'],
        ['invalid side', { side: 'HOLD' }, 'INVALID_TRADE_EVIDENCE'],
        ['missing position side', { positionSide: null }, 'INVALID_TRADE_EVIDENCE'],
        ['missing price', { price: null }, 'INVALID_TRADE_EVIDENCE'],
        ['zero quantity', { quantity: '0.0' }, 'INVALID_TRADE_EVIDENCE'],
        ['scientific realized PnL', { realizedPnl: '1e2' }, 'INVALID_TRADE_EVIDENCE'],
        ['negative commission', { commission: '-0.1' }, 'INVALID_TRADE_EVIDENCE'],
        ['missing settlement asset', { marginAsset: null }, 'INVALID_TRADE_EVIDENCE'],
        [
            'nonzero commission without its asset',
            { commission: '0.1', commissionAsset: null },
            'INVALID_TRADE_EVIDENCE',
        ],
        ['malformed present zero-commission asset', { commissionAsset: '' }, 'INVALID_TRADE_EVIDENCE'],
        ['missing time', { time: null }, 'INVALID_TRADE_TIME'],
    ])('rejects %s transactionally', async (_case, overrides, code) => {
        await expect(readFuturesTradeHistoryWindow({
            readWindow: async () => [
                trade(1, 10_000),
                trade(2, 10_001, 'BTCUSDT', overrides),
            ],
            startTime: 10_000,
            endTime: 11_000,
            expectedSymbol: 'BTCUSDT',
        })).rejects.toMatchObject({ code });
    });

    it('accepts an exact zero commission without a commission asset', async () => {
        const result = await readFuturesTradeHistoryWindow({
            readWindow: async () => [trade(1, 10_000, 'BTCUSDT', {
                commission: '0.00000000',
                commissionAsset: null,
            })],
            startTime: 10_000,
            endTime: 11_000,
            expectedSymbol: 'BTCUSDT',
        });

        expect(result.coverage.complete).toBe(true);
        expect(result.rows).toHaveLength(1);
    });

    it('rejects a huge single money field before duplicate signatures can scan it', async () => {
        const huge = '9'.repeat(1_000_000);
        const startedAt = performance.now();
        await expect(readFuturesTradeHistoryWindow({
            readWindow: async () => [trade(1, 10_000, 'BTCUSDT', { price: huge })],
            startTime: 10_000,
            endTime: 11_000,
            expectedSymbol: 'BTCUSDT',
        })).rejects.toMatchObject({ code: 'INVALID_TRADE_EVIDENCE' });
        expect(performance.now() - startedAt).toBeLessThan(250);
    });

    it('stops after an in-flight read when its generation is cancelled', async () => {
        let current = true;
        const readWindow = vi.fn(async () => {
            current = false;
            return [trade(1, 30_000)];
        });

        const result = await readFuturesTradeHistoryWindow({
            readWindow,
            startTime: 30_000,
            endTime: 31_000,
            isCurrent: () => current,
        });

        expect(readWindow).toHaveBeenCalledTimes(1);
        expect(result.rows).toEqual([]);
        expect(result.coverage).toMatchObject({
            complete: false,
            pageLimited: false,
            aborted: true,
            requests: 1,
        });
    });

    it('rejects absent, blank, unsafe, negative, or inverted bounds before requesting', async () => {
        const readWindow = vi.fn(async () => []);

        for (const [startTime, endTime] of [
            [null, 10],
            [' ', 10],
            [0, null],
            [0, ' '],
            [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 2],
            [-1, 10],
            [11, 10],
        ]) {
            await expect(readFuturesTradeHistoryWindow({
                readWindow,
                startTime,
                endTime,
            })).rejects.toThrow(RangeError);
        }
        expect(readWindow).not.toHaveBeenCalled();
    });
});
