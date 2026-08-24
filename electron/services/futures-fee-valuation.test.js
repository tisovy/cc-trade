import { describe, expect, it, vi } from 'vitest';
import {
    FUTURES_FEE_VALUATION_INTERVAL,
    FUTURES_FEE_VALUATION_KLINES_WEIGHT,
    FUTURES_FEE_VALUATION_ROUTE,
    MAX_FUTURES_FEE_VALUATION_REQUESTS,
    createFuturesFeeValuationPriceSource,
    normalizeFuturesFeeValuationMinutes,
    normalizeFuturesFeeValuationPair,
} from './futures-fee-valuation.js';

const MINUTE = 60_000;
const minuteA = 1_756_000_020_000;
const NOW = minuteA + (600 * MINUTE);

const kline = (openTime, close) => [
    openTime, '611.00', '613.00', '610.00', close, '1000',
    openTime + MINUTE - 1, '0', 10, '0', '0', '0',
];

describe('normalization', () => {
    it('canonicalizes the pair and refuses anything else', () => {
        expect(normalizeFuturesFeeValuationPair(' bnbusdt ')).toBe('BNBUSDT');
        expect(normalizeFuturesFeeValuationPair('BNB/USDT')).toBeNull();
        expect(normalizeFuturesFeeValuationPair('')).toBeNull();
        expect(normalizeFuturesFeeValuationPair(42)).toBeNull();
    });

    it('floors, deduplicates and bounds the minutes, newest first', () => {
        expect(normalizeFuturesFeeValuationMinutes([
            minuteA + 30_000, minuteA + 10_000, minuteA + MINUTE, 'junk', -5,
        ])).toEqual([minuteA + MINUTE, minuteA]);
    });
});

describe('createFuturesFeeValuationPriceSource', () => {
    it('asks the klines route for exactly the missing minutes and answers their closes', async () => {
        const readKlines = vi.fn(async () => [
            kline(minuteA, '612.34'),
            kline(minuteA + MINUTE, '613.10'),
        ]);
        const source = createFuturesFeeValuationPriceSource({ readKlines, now: () => NOW });
        const outcome = await source.read({
            pair: 'BNBUSDT',
            minutes: [minuteA, minuteA + MINUTE],
        });

        expect(readKlines).toHaveBeenCalledTimes(1);
        const [params, weight] = readKlines.mock.calls[0];
        // The address is stated by the module and asserted against the adapter
        // on the wire in its own test; here the shape of the ask is the fact.
        expect(FUTURES_FEE_VALUATION_ROUTE).toBe('/fapi/v1/klines');
        expect(params).toEqual({
            symbol: 'BNBUSDT',
            interval: FUTURES_FEE_VALUATION_INTERVAL,
            startTime: minuteA,
            endTime: minuteA + (2 * MINUTE) - 1,
            limit: 2,
        });
        expect(weight).toBe(FUTURES_FEE_VALUATION_KLINES_WEIGHT);
        expect(outcome).toMatchObject({
            pair: 'BNBUSDT',
            prices: { [minuteA]: '612.34', [minuteA + MINUTE]: '613.10' },
            requested: 2,
            served: 2,
            readRequests: 1,
            chargedWeight: 1,
            failed: false,
        });
    });

    it('serves a repeated ask from the cache without touching the wire again', async () => {
        const readKlines = vi.fn(async () => [kline(minuteA, '612.34')]);
        const source = createFuturesFeeValuationPriceSource({ readKlines, now: () => NOW });
        await source.read({ pair: 'BNBUSDT', minutes: [minuteA] });
        const again = await source.read({ pair: 'BNBUSDT', minutes: [minuteA] });
        expect(readKlines).toHaveBeenCalledTimes(1);
        expect(again).toMatchObject({
            prices: { [minuteA]: '612.34' },
            readRequests: 0,
            chargedWeight: 0,
        });
    });

    it('answers null for a served minute with no kline and nothing for a failed read', async () => {
        // First window: served, but the exchange printed no kline for the
        // second minute — that absence is final. Second window: the read
        // failed — those minutes stay unanswered so a later ask can retry.
        const farMinute = minuteA + (200 * MINUTE);
        const readKlines = vi.fn()
            .mockResolvedValueOnce([kline(minuteA, '612.34')])
            .mockRejectedValueOnce(new Error('proxy down'));
        const source = createFuturesFeeValuationPriceSource({ readKlines, now: () => NOW });
        const outcome = await source.read({
            pair: 'BNBUSDT',
            minutes: [minuteA, minuteA + MINUTE, farMinute],
        });
        expect(readKlines).toHaveBeenCalledTimes(2);
        expect(outcome.prices).toEqual({ [minuteA]: '612.34', [minuteA + MINUTE]: null });
        expect(Object.hasOwn(outcome.prices, farMinute)).toBe(false);
        expect(outcome.failed).toBe(true);
    });

    it('never answers a minute that is still forming', async () => {
        const readKlines = vi.fn(async () => [kline(NOW, '612.34')]);
        const source = createFuturesFeeValuationPriceSource({ readKlines, now: () => NOW + 1_000 });
        const outcome = await source.read({ pair: 'BNBUSDT', minutes: [NOW] });
        // The current minute's close is not a fact yet: not asked, not cached.
        expect(readKlines).not.toHaveBeenCalled();
        expect(outcome.prices).toEqual({});
    });

    it('bounds one ask to its request budget and leaves the oldest windows unanswered', async () => {
        const readKlines = vi.fn(async ({ startTime }) => [kline(startTime, '600')]);
        const source = createFuturesFeeValuationPriceSource({ readKlines, now: () => NOW });
        // Every minute 200 minutes apart: one window each, far more windows
        // than the budget.
        const minutes = Array.from(
            { length: MAX_FUTURES_FEE_VALUATION_REQUESTS + 4 },
            (_, index) => minuteA + (index * 200 * MINUTE) - (400 * MINUTE),
        ).filter(minute => minute + MINUTE <= NOW);
        const outcome = await source.read({ pair: 'BNBUSDT', minutes });
        expect(outcome.readRequests).toBeLessThanOrEqual(MAX_FUTURES_FEE_VALUATION_REQUESTS);
        expect(outcome.served).toBe(outcome.readRequests);
    });
});
