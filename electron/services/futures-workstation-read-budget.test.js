import { describe, expect, it, vi } from 'vitest';
import {
    FuturesWorkstationReadBudget,
} from './futures-workstation-read-budget.js';

// A clock and a timer queue the test drives by hand, so a wait for the window is
// proved rather than slept through.
const createTestTimers = (startAt = 1_000) => {
    let now = startAt;
    const timers = new Map();
    let nextId = 1;
    return {
        now: () => now,
        setTimer: (callback, delayMs) => {
            const id = nextId;
            nextId += 1;
            timers.set(id, { at: now + delayMs, callback });
            return id;
        },
        clearTimer: id => timers.delete(id),
        pending: () => [...timers.values()].map(timer => timer.at - now),
        // Advance to `at`, firing every timer due by then, in due order.
        async advanceTo(at) {
            for (;;) {
                const due = [...timers.entries()]
                    .filter(([, timer]) => timer.at <= at)
                    .sort(([, a], [, b]) => a.at - b.at)[0];
                if (!due) break;
                const [id, timer] = due;
                timers.delete(id);
                now = timer.at;
                timer.callback();
                await Promise.resolve();
            }
            now = at;
            await Promise.resolve();
        },
    };
};

describe('isolated Futures public-read budget', () => {
    it('tracks exact request weight without touching Spot', async () => {
        const clock = createTestTimers();
        const budget = new FuturesWorkstationReadBudget({
            maximumWeight: 40,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });
        const operation = vi.fn(async () => 'ok');
        await expect(budget.execute(20, operation)).resolves.toBe('ok');
        await expect(budget.execute(20, operation)).resolves.toBe('ok');
        expect(budget.snapshot()).toMatchObject({ usedWeight: 40, maximumWeight: 40 });
        expect(operation).toHaveBeenCalledTimes(2);
    });

    // The window being full means "not yet", and the desk's answer to "not yet"
    // used to be a resync — which asks for the same reads again, from scratch.
    it('waits for the window to free rather than refusing the read', async () => {
        const clock = createTestTimers();
        const budget = new FuturesWorkstationReadBudget({
            maximumWeight: 40,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });
        const operation = vi.fn(async () => 'ok');
        await budget.execute(20, operation);
        await clock.advanceTo(11_000);
        await budget.execute(20, operation);

        const delayed = budget.execute(20, operation);
        let settled = false;
        void delayed.then(() => { settled = true; }, () => { settled = true; });
        await Promise.resolve();
        expect(operation).toHaveBeenCalledTimes(2);
        expect(budget.snapshot()).toMatchObject({ queued: 1, waiting: true });

        // The first 20 ages out 60s after it was spent, and not before: the read
        // is issued the moment the weight it needs is free, not a window later.
        await clock.advanceTo(60_999);
        expect(settled).toBe(false);
        expect(operation).toHaveBeenCalledTimes(2);
        await clock.advanceTo(61_000);
        await expect(delayed).resolves.toBe('ok');
        expect(operation).toHaveBeenCalledTimes(3);
        expect(budget.snapshot()).toMatchObject({ queued: 0, waiting: false });
    });

    // Twenty-four weight is one contract switch; the operator makes several a
    // minute and the window has to carry them.
    it('serves a whole queue of reads as the window frees them', async () => {
        const clock = createTestTimers();
        const budget = new FuturesWorkstationReadBudget({
            maximumWeight: 48,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });
        const served = [];
        const reads = [1, 2, 3, 4].map(index => budget.execute(24, async () => {
            served.push(index);
            return index;
        }));
        await Promise.resolve();
        await Promise.resolve();
        expect(served).toEqual([1, 2]);
        await clock.advanceTo(61_001);
        await expect(Promise.all(reads)).resolves.toEqual([1, 2, 3, 4]);
        expect(served).toEqual([1, 2, 3, 4]);
    });

    // Selecting another contract abandons the reads of the one being left,
    // whether they are in flight or still waiting for room.
    it('drops a read abandoned while it waits, and re-times what is behind it', async () => {
        const clock = createTestTimers();
        const budget = new FuturesWorkstationReadBudget({
            maximumWeight: 40,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });
        const forbidden = vi.fn(async () => 'forbidden');
        await budget.execute(40, async () => 'ok');
        const controller = new AbortController();
        const abandoned = budget.execute(20, forbidden, { signal: controller.signal });
        const behind = budget.execute(20, async () => 'behind');
        await Promise.resolve();
        expect(budget.snapshot()).toMatchObject({ queued: 2, waiting: true });

        controller.abort();
        await expect(abandoned).rejects.toMatchObject({ code: 'READ_OPERATION_ABORTED' });
        expect(budget.snapshot()).toMatchObject({ queued: 1, usedWeight: 40 });

        await clock.advanceTo(61_000);
        await expect(behind).resolves.toBe('behind');
        expect(forbidden).not.toHaveBeenCalled();
    });

    // The bound is one window. Past that the room is not coming from anything
    // this desk spent, and saying so is the honest answer.
    it('refuses a read that no window of waiting would admit', async () => {
        const clock = createTestTimers();
        const budget = new FuturesWorkstationReadBudget({
            maximumWeight: 40,
            maximumWaitMs: 5_000,
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
        });
        const operation = vi.fn(async () => 'ok');
        await budget.execute(40, operation);
        await expect(budget.execute(1, operation)).rejects.toMatchObject({
            code: 'READ_WEIGHT_EXHAUSTED',
        });
        expect(operation).toHaveBeenCalledTimes(1);
        expect(budget.snapshot()).toMatchObject({ queued: 0, waiting: false });
    });

    it('rejects a budget it cannot keep', () => {
        expect(() => new FuturesWorkstationReadBudget({ maximumWaitMs: -1 }))
            .toThrow(expect.objectContaining({ code: 'INVALID_READ_BUDGET' }));
        expect(() => new FuturesWorkstationReadBudget({ setTimer: 'soon' }))
            .toThrow(expect.objectContaining({ code: 'INVALID_READ_BUDGET' }));
        expect(() => new FuturesWorkstationReadBudget({ maximumWeight: 0 }))
            .toThrow(expect.objectContaining({ code: 'INVALID_READ_BUDGET' }));
    });

    it('refuses an operation heavier than the whole window', async () => {
        const budget = new FuturesWorkstationReadBudget({ maximumWeight: 40 });
        await expect(budget.execute(41, async () => 'ok')).rejects.toMatchObject({
            code: 'INVALID_READ_OPERATION',
        });
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
