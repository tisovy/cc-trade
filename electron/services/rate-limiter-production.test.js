import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from './binance-connection.js';

const deferred = () => {
    let resolve;
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

describe('production RateLimiter cancellation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('cancels a queued spacing delay without invoking or accounting the request', async () => {
        const limiter = new RateLimiter(100, 60_000, 500);
        const controller = new AbortController();
        const operation = vi.fn();

        const pending = limiter.execute(operation, 5, 0, {
            signal: controller.signal,
        });
        await vi.advanceTimersByTimeAsync(100);
        controller.abort();

        await expect(pending).rejects.toMatchObject({
            name: 'AbortError',
            code: 'ABORT_ERR',
        });
        expect(operation).not.toHaveBeenCalled();
        expect(limiter.requests).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels a pending network retry while retaining the original request weight', async () => {
        const limiter = new RateLimiter(100, 60_000, 0);
        const controller = new AbortController();
        const networkError = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        const operation = vi.fn().mockRejectedValue(networkError);

        const pending = limiter.execute(operation, 7, 2, {
            signal: controller.signal,
        });
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();

        await expect(pending).rejects.toMatchObject({
            name: 'AbortError',
            code: 'ABORT_ERR',
        });
        expect(operation).toHaveBeenCalledOnce();
        expect(limiter.getCurrentWeight()).toBe(7);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves the existing non-cancellable execution signature and spacing', async () => {
        const limiter = new RateLimiter(100, 60_000, 100);
        const operation = vi.fn().mockResolvedValue('ok');

        const pending = limiter.execute(operation, 3, 0);
        await vi.advanceTimersByTimeAsync(100);

        await expect(pending).resolves.toBe('ok');
        expect(operation).toHaveBeenCalledOnce();
        expect(limiter.getCurrentWeight()).toBe(3);
    });

    it('atomically reserves capacity for concurrent callers without exceeding the window cap', async () => {
        vi.setSystemTime(1_000);
        const limiter = new RateLimiter(5, 1_000, 0);
        const firstResult = deferred();
        const starts = [];

        const first = limiter.execute(() => {
            starts.push(Date.now());
            return firstResult.promise;
        }, 5, 0);
        const second = limiter.execute(() => {
            starts.push(Date.now());
            return 'second';
        }, 5, 0);

        await vi.advanceTimersByTimeAsync(0);
        expect(starts).toEqual([1_000]);
        expect(limiter.getCurrentWeight()).toBe(5);

        firstResult.resolve('first');
        await expect(first).resolves.toBe('first');
        await vi.advanceTimersByTimeAsync(1_099);
        expect(starts).toEqual([1_000]);
        expect(limiter.getCurrentWeight()).toBe(0);

        await vi.advanceTimersByTimeAsync(1);
        await expect(second).resolves.toBe('second');
        expect(starts).toEqual([1_000, 2_100]);
        expect(limiter.getCurrentWeight()).toBe(5);
    });

    it('serializes concurrent spacing admission while allowing admitted work to overlap', async () => {
        vi.setSystemTime(1_000);
        const limiter = new RateLimiter(100, 60_000, 500);
        const firstResult = deferred();
        const starts = [];

        const first = limiter.execute(() => {
            starts.push(Date.now());
            return firstResult.promise;
        }, 1, 0);
        const second = limiter.execute(() => {
            starts.push(Date.now());
            return 'second';
        }, 1, 0);

        await vi.advanceTimersByTimeAsync(0);
        expect(starts).toEqual([1_000]);
        await vi.advanceTimersByTimeAsync(499);
        expect(starts).toEqual([1_000]);
        await vi.advanceTimersByTimeAsync(1);
        await expect(second).resolves.toBe('second');
        expect(starts).toEqual([1_000, 1_500]);

        firstResult.resolve('first');
        await expect(first).resolves.toBe('first');
    });
});
