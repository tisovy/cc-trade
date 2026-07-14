import { describe, expect, it, vi } from 'vitest';
import {
    FuturesWorkstationReadBudget,
} from './futures-workstation-read-budget.js';

describe('isolated Futures public-read budget', () => {
    it('tracks exact request weight and rejects exhaustion without touching Spot', async () => {
        let now = 1_000;
        const budget = new FuturesWorkstationReadBudget({
            maximumWeight: 40,
            now: () => now,
        });
        const operation = vi.fn(async () => 'ok');
        await expect(budget.execute(20, operation)).resolves.toBe('ok');
        await expect(budget.execute(20, operation)).resolves.toBe('ok');
        await expect(budget.execute(1, operation)).rejects.toMatchObject({
            code: 'READ_WEIGHT_EXHAUSTED',
        });
        expect(operation).toHaveBeenCalledTimes(2);
        now += 60_000;
        await expect(budget.execute(1, operation)).resolves.toBe('ok');
    });

    it('bounds concurrency and queue length', async () => {
        const releases = [];
        const budget = new FuturesWorkstationReadBudget({
            maximumConcurrent: 1,
            maximumQueue: 2,
        });
        const operation = () => new Promise(resolve => releases.push(resolve));
        const first = budget.execute(1, operation);
        await Promise.resolve();
        const second = budget.execute(1, operation);
        const third = budget.execute(1, operation);
        await expect(budget.execute(1, operation)).rejects.toMatchObject({
            code: 'READ_QUEUE_OVERFLOW',
        });
        releases.shift()('first');
        await first;
        await vi.waitFor(() => expect(releases).toHaveLength(1));
        releases.shift()('second');
        await second;
        await vi.waitFor(() => expect(releases).toHaveLength(1));
        releases.shift()('third');
        await third;
        await vi.waitFor(() => expect(budget.snapshot()).toMatchObject({ active: 0, queued: 0 }));
    });

    it('removes an aborted queued operation', async () => {
        let release;
        const budget = new FuturesWorkstationReadBudget({ maximumConcurrent: 1 });
        const first = budget.execute(1, () => new Promise(resolve => { release = resolve; }));
        await Promise.resolve();
        const controller = new AbortController();
        const queued = budget.execute(1, async () => 'forbidden', { signal: controller.signal });
        controller.abort();
        await expect(queued).rejects.toMatchObject({ code: 'READ_OPERATION_ABORTED' });
        release('done');
        await first;
        expect(budget.snapshot().queued).toBe(0);
    });
});
