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

    // Everything the desk reads from Futures shares this queue, and the spacing
    // makes a long read expensive to be behind: a session review is twenty-six
    // admissions. What follows the operator's command may not wait them out.
    it('admits an urgent request ahead of the ordinary work already queued', async () => {
        vi.setSystemTime(1_000);
        const limiter = new RateLimiter(1_000, 60_000, 150);
        const admitted = [];
        const run = (label, options) => limiter.execute(
            async () => { admitted.push(label); },
            1,
            0,
            options,
        );

        const review = ['page', 'first', 'second', 'third'].map(label => run(label));
        // The first is already holding the queue; the rest are waiting behind it
        // when the operator's read arrives.
        const afterCommand = run('after-command', { urgent: true });

        await vi.advanceTimersByTimeAsync(5_000);
        await Promise.all([...review, afterCommand]);
        expect(admitted).toEqual(['page', 'after-command', 'first', 'second', 'third']);
    });

    // The other half of the same rule. An operator working orders produces urgent
    // reads for as long as they keep working them, and the review they opened has
    // to finish while they do.
    it('stops urgent work passing the request that has waited longest', async () => {
        vi.setSystemTime(1_000);
        const limiter = new RateLimiter(1_000, 60_000, 150);
        const admitted = [];
        const run = (label, options) => limiter.execute(
            async () => { admitted.push(label); },
            1,
            0,
            options,
        );

        const review = [run('page'), run('contract')];
        const commands = Array.from({ length: 12 }, (_, index) => (
            run(`after-command-${index}`, { urgent: true })
        ));

        await vi.advanceTimersByTimeAsync(10_000);
        await Promise.all([...review, ...commands]);
        // Passed eight times and not a ninth: `contract` goes before the urgent
        // reads still queued behind it, so the review finishes rather than
        // waiting out a desk that keeps trading.
        expect(admitted.slice(0, 10)).toEqual([
            'page',
            ...Array.from({ length: 8 }, (_, index) => `after-command-${index}`),
            'contract',
        ]);
        expect(admitted).toHaveLength(14);
    });

    // The stall the operator felt on 2026-08-22: a leverage change that answered
    // in 26 368ms against a round of about 2 000ms. A start's own reads had spent
    // the budget, the request at the head was sleeping the rest of the window out
    // while holding the admission slot, and the command behind it needed one
    // weight the window still had room for. Urgency could not reach it — nothing
    // was leaving the queue at all.
    it('lets a request the window still has room for past one waiting the window out', async () => {
        vi.setSystemTime(1_000);
        const limiter = new RateLimiter(100, 60_000, 0);
        const admitted = [];
        const run = (label, weight, options) => limiter.execute(
            async () => { admitted.push(label); },
            weight,
            0,
            options,
        );

        // A start's own reads take the budget to 99 of its 100.
        const bootstrap = run('bootstrap', 99);
        await vi.advanceTimersByTimeAsync(0);
        await expect(bootstrap).resolves.toBeUndefined();
        expect(limiter.getCurrentWeight()).toBe(99);

        // The next account pass does not fit, and settles in to wait the window out.
        const pass = run('account-pass', 90);
        await vi.advanceTimersByTimeAsync(0);
        expect(admitted).toEqual(['bootstrap']);

        // The operator's command needs one weight, and the window has one left.
        const command = run('set-leverage', 1, { urgent: true });
        await vi.advanceTimersByTimeAsync(0);
        await expect(command).resolves.toBeUndefined();
        expect(admitted).toEqual(['bootstrap', 'set-leverage']);

        // The pass that could not fit still waits its turn out, and then goes.
        await vi.advanceTimersByTimeAsync(60_100);
        await expect(pass).resolves.toBeUndefined();
        expect(admitted).toEqual(['bootstrap', 'set-leverage', 'account-pass']);
    });

    // A wait nobody can see is a wait the desk gets to blame on the exchange.
    it('says in the record when its own budget, not the exchange, held a request back', async () => {
        vi.setSystemTime(1_000);
        const deferrals = [];
        const limiter = new RateLimiter(100, 60_000, 0, {
            onDeferred: entry => deferrals.push(entry),
        });

        await limiter.execute(async () => 'bootstrap', 100, 0);
        await vi.advanceTimersByTimeAsync(0);
        // Nothing waited, so nothing is said.
        expect(deferrals).toEqual([]);

        const held = limiter.execute(async () => 'account-pass', 90, 0);
        const command = limiter.execute(async () => 'set-leverage', 1, 0, { urgent: true });
        await vi.advanceTimersByTimeAsync(60_100);
        await expect(held).resolves.toBe('account-pass');
        await expect(command).resolves.toBe('set-leverage');

        expect(deferrals).toEqual([
            {
                standing: 'ordinary',
                waitedMs: 60_100,
                weight: 90,
                spent: 100,
                ceiling: 100,
            },
            {
                standing: 'urgent',
                waitedMs: 60_100,
                weight: 1,
                spent: 100,
                ceiling: 100,
            },
        ]);
    });

    // The bound on urgent overtaking is counted against whoever has waited
    // longest. A request the window turned away and sent round again has waited
    // longer than anything that arrived while it slept, so it may not come back
    // as if it had just arrived — that would give urgent work another eight
    // passes for every window it waits, which is not a bound.
    it('gives a request that waited the passes it had already been given', async () => {
        vi.setSystemTime(1_000);
        const limiter = new RateLimiter(100, 60_000, 0);
        const taken = [];
        const takeAdmission = limiter.takeAdmission.bind(limiter);
        limiter.takeAdmission = async (signal, urgent, passes) => {
            taken.push(passes);
            const entry = await takeAdmission(signal, urgent, passes);
            // Stand in for whatever urgent work passed it while it queued.
            entry.passes += 3;
            return entry;
        };

        await limiter.execute(async () => 'fill', 100, 0);
        const held = limiter.execute(async () => 'held', 90, 0);
        await vi.advanceTimersByTimeAsync(60_100);
        await expect(held).resolves.toBe('held');

        // The fill, then the turn the window refused, then the turn after the
        // wait — which carries what the refused one had been given.
        expect(taken).toEqual([0, 0, 3]);
    });

    // The record opens and rolls a file of its own. A request that has already
    // booked its weight has no business holding the queue while it does that.
    it('writes the line with the queue already moving', async () => {
        vi.setSystemTime(1_000);
        let admittingWhenWritten = null;
        const limiter = new RateLimiter(100, 60_000, 0, {
            onDeferred: () => { admittingWhenWritten = limiter.admitting; },
        });

        await limiter.execute(async () => 'fill', 100, 0);
        const held = limiter.execute(async () => 'held', 90, 0);
        await vi.advanceTimersByTimeAsync(60_100);
        await expect(held).resolves.toBe('held');

        expect(admittingWhenWritten).toBe(false);
    });

    // Zero is a reading this desk's own clock really hands out — every test in
    // this file starts there — so it cannot also stand for "never waited".
    it('records a wait that began at zero on the clock', async () => {
        const deferrals = [];
        const limiter = new RateLimiter(100, 60_000, 0, {
            onDeferred: entry => deferrals.push(entry),
        });

        await limiter.execute(async () => 'fill', 100, 0);
        const held = limiter.execute(async () => 'held', 90, 0);
        await vi.advanceTimersByTimeAsync(60_100);
        await expect(held).resolves.toBe('held');

        expect(deferrals).toEqual([{
            standing: 'ordinary',
            waitedMs: 60_100,
            weight: 90,
            spent: 100,
            ceiling: 100,
        }]);
    });

    // A guard, not a biter: before the reporter existed this passed by having
    // nothing to throw. It is here because the reporter is the desk's
    // diagnostics file, which is allowed to fail — a disk that refuses a line
    // must not also stop the queue that wrote it.
    it('keeps the queue moving when the record refuses the line', async () => {
        vi.setSystemTime(1_000);
        const limiter = new RateLimiter(100, 60_000, 0, {
            onDeferred: () => { throw new Error('journal is closed'); },
        });

        await limiter.execute(async () => 'bootstrap', 100, 0);
        const held = limiter.execute(async () => 'account-pass', 90, 0);
        await vi.advanceTimersByTimeAsync(60_100);
        await expect(held).resolves.toBe('account-pass');
    });
});
