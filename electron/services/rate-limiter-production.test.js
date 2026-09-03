import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from './binance-connection.js';
import { admitBinancePhysicalAttempt } from './binance-physical-attempt-context.js';

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

    it('charges one successful legacy logical operation exactly once', async () => {
        const limiter = new RateLimiter(100, 60_000, 0);
        const operation = vi.fn().mockResolvedValue('ok');

        await expect(limiter.execute(operation, 30, 2)).resolves.toBe('ok');

        expect(operation).toHaveBeenCalledOnce();
        expect(limiter.getCurrentWeight()).toBe(30);
    });

    it('keeps a retried legacy Spot operation on its one logical reservation', async () => {
        const limiter = new RateLimiter(100, 60_000, 0);
        const networkError = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        const operation = vi.fn()
            .mockRejectedValueOnce(networkError)
            .mockResolvedValueOnce('recovered');

        const pending = limiter.execute(operation, 30, 2);
        await vi.advanceTimersByTimeAsync(1_000);

        await expect(pending).resolves.toBe('recovered');
        expect(operation).toHaveBeenCalledTimes(2);
        expect(limiter.getCurrentWeight()).toBe(30);
    });

    it('cancels while a retry awaits capacity without starting or charging that attempt', async () => {
        vi.setSystemTime(1_000);
        const limiter = new RateLimiter(30, 60_000, 0, { physicalAttempts: true });
        const controller = new AbortController();
        const networkError = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        let physicalSends = 0;
        const operation = vi.fn(async () => {
            await admitBinancePhysicalAttempt();
            physicalSends += 1;
            throw networkError;
        });

        const pending = limiter.execute(operation, 30, 2, {
            signal: controller.signal,
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(operation).toHaveBeenCalledOnce();
        expect(physicalSends).toBe(1);
        expect(limiter.getCurrentWeight()).toBe(30);

        // The one-second network backoff ends, but the first attempt still owns
        // the entire window. The second physical attempt is now waiting inside
        // reserve(), before either its operation or its weight can be admitted.
        await vi.advanceTimersByTimeAsync(1_000);
        expect(operation).toHaveBeenCalledTimes(2);
        expect(physicalSends).toBe(1);
        expect(limiter.getCurrentWeight()).toBe(30);
        controller.abort();

        await expect(pending).rejects.toMatchObject({
            name: 'AbortError',
            code: 'ABORT_ERR',
        });
        expect(operation).toHaveBeenCalledTimes(2);
        expect(physicalSends).toBe(1);
        expect(limiter.getCurrentWeight()).toBe(30);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('admits and charges every physical attempt of a retried operation', async () => {
        const limiter = new RateLimiter(100, 60_000, 100, { physicalAttempts: true });
        const networkError = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        const startedAt = [];
        const operation = vi.fn()
            .mockImplementationOnce(async () => {
                await admitBinancePhysicalAttempt();
                startedAt.push(Date.now());
                throw networkError;
            })
            .mockImplementationOnce(async () => {
                await admitBinancePhysicalAttempt();
                startedAt.push(Date.now());
                return 'recovered';
            });

        const pending = limiter.execute(operation, 30, 2);
        await vi.advanceTimersByTimeAsync(2_000);

        await expect(pending).resolves.toBe('recovered');
        expect(operation).toHaveBeenCalledTimes(2);
        expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(100);
        expect(limiter.getCurrentWeight()).toBe(60);
    });

    it('admits and charges a successful retry after a physical timeout', async () => {
        const limiter = new RateLimiter(100, 60_000, 0, { physicalAttempts: true });
        const timeout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
        const operation = vi.fn()
            .mockImplementationOnce(async () => {
                await admitBinancePhysicalAttempt();
                throw timeout;
            })
            .mockImplementationOnce(async () => {
                await admitBinancePhysicalAttempt();
                return 'recovered';
            });

        const pending = limiter.execute(operation, 30, 2);
        await vi.advanceTimersByTimeAsync(1_000);

        await expect(pending).resolves.toBe('recovered');
        expect(operation).toHaveBeenCalledTimes(2);
        expect(limiter.getCurrentWeight()).toBe(60);
    });

    it('charges all three failed physical attempts before returning the final error', async () => {
        const limiter = new RateLimiter(100, 60_000, 0, { physicalAttempts: true });
        const networkError = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        const operation = vi.fn(async () => {
            await admitBinancePhysicalAttempt();
            throw networkError;
        });

        const pending = limiter.execute(operation, 30, 2);
        const rejection = expect(pending).rejects.toBe(networkError);
        await vi.advanceTimersByTimeAsync(3_000);

        await rejection;
        expect(operation).toHaveBeenCalledTimes(3);
        expect(limiter.getCurrentWeight()).toBe(90);
    });

    it('raises its conservative window floor from authoritative used-weight without refunding', async () => {
        const summaries = [];
        const limiter = new RateLimiter(200, 60_000, 0, {
            physicalAttempts: true,
            onOperation: summary => summaries.push(summary),
        });

        await limiter.execute(async () => {
            const attempt = await admitBinancePhysicalAttempt();
            attempt.observeResponse({ status: 200, usedWeight: 120 });
            return 'first';
        }, 30, 0);
        expect(limiter.getCurrentWeight()).toBe(120);

        await limiter.execute(async () => {
            const attempt = await admitBinancePhysicalAttempt();
            attempt.observeResponse({ status: 200, usedWeight: 5 });
            return 'second';
        }, 10, 0);

        expect(limiter.getCurrentWeight()).toBe(130);
        expect(summaries).toEqual([
            expect.objectContaining({
                attempts: 1,
                chargedWeight: 30,
                observedWeight: 120,
                status: 200,
            }),
            expect.objectContaining({
                attempts: 1,
                chargedWeight: 10,
                observedWeight: 5,
                status: 200,
            }),
        ]);
    });

    it('preserves a newer concurrent reservation above an older observed baseline', async () => {
        const limiter = new RateLimiter(2_000, 60_000, 0, { physicalAttempts: true });
        const [attemptA] = await Promise.all([
            limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0),
            limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0),
        ]);

        expect(limiter.getCurrentWeight()).toBe(60);
        attemptA.observeResponse({ status: 200, usedWeight: 950 });
        expect(limiter.getCurrentWeight()).toBe(980);

        await limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0);
        expect(limiter.getCurrentWeight()).toBe(1_010);
    });

    it('keeps every other unresolved token across reverse response ordering', async () => {
        const limiter = new RateLimiter(2_000, 60_000, 0, { physicalAttempts: true });
        const [attemptA, attemptB] = await Promise.all([
            limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0),
            limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0),
        ]);

        // B answered first, so A may not yet be represented by B's exchange
        // sample even though A received the earlier local sequence number.
        attemptB.observeResponse({ status: 200, usedWeight: 1_200 });
        expect(limiter.getCurrentWeight()).toBe(1_230);

        attemptA.observeResponse({ status: 200, usedWeight: 1_250 });
        expect(limiter.getCurrentWeight()).toBe(1_250);

        await limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0);
        expect(limiter.getCurrentWeight()).toBe(1_280);

        attemptB.observeResponse({ status: 200, usedWeight: 1_000 });
        attemptA.observeResponse({ status: 200, usedWeight: 1_250 });
        expect(limiter.getCurrentWeight()).toBe(1_280);
    });

    it('does not invent an exchange meter when a response omits used-weight', async () => {
        const summaries = [];
        const limiter = new RateLimiter(100, 60_000, 0, {
            physicalAttempts: true,
            onOperation: summary => summaries.push(summary),
        });

        await limiter.execute(async () => {
            const attempt = await admitBinancePhysicalAttempt();
            attempt.observeResponse({ status: 200 });
        }, 30, 0);

        expect(limiter.getCurrentWeight()).toBe(30);
        expect(summaries).toEqual([
            expect.objectContaining({ observedWeight: null, status: 200 }),
        ]);
    });

    it('resolves a physical token even when its answer omits used-weight', async () => {
        const limiter = new RateLimiter(2_000, 60_000, 0, { physicalAttempts: true });
        const [attemptA, attemptB] = await Promise.all([
            limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0),
            limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0),
        ]);

        attemptB.observeResponse({ status: 200 });
        attemptA.observeResponse({ status: 200, usedWeight: 100 });

        // B's local charge is still retained until its normal window expiry,
        // but it is no longer added again as unresolved uncertainty.
        expect(limiter.getCurrentWeight()).toBe(100);
    });

    it('releases an observed baseline when the exchange interval that reported it ends', async () => {
        vi.setSystemTime(55_000);
        const limiter = new RateLimiter(800, 60_000, 0, { physicalAttempts: true });
        const attempt = await limiter.execute(() => admitBinancePhysicalAttempt(), 1, 0);
        attempt.observeResponse({ status: 200, usedWeight: 704 });
        expect(limiter.getCurrentWeight()).toBe(704);

        // The exchange's minute meter fell 704 → 1 across this boundary in the
        // 2026-08-23 journal while the desk went on charging the spend for
        // another 56 seconds. The sample belongs to the interval it was
        // observed in and forgets with it.
        vi.setSystemTime(61_000);
        expect(limiter.getCurrentWeight()).toBe(0);
    });

    it('keeps locally booked unanswered work when the exchange interval rolls', async () => {
        vi.setSystemTime(55_000);
        const limiter = new RateLimiter(800, 60_000, 0, { physicalAttempts: true });
        const [attemptA] = await Promise.all([
            limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0),
            limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0),
        ]);
        attemptA.observeResponse({ status: 200, usedWeight: 700 });
        expect(limiter.getCurrentWeight()).toBe(730);

        // Only the exchange's own sample expires with its interval. The send
        // the desk has not heard back from is still charged at full weight.
        vi.setSystemTime(61_000);
        expect(limiter.getCurrentWeight()).toBe(30);
    });

    it('admits a small read once the boundary passes instead of deferring a full window', async () => {
        vi.setSystemTime(59_000);
        const limiter = new RateLimiter(800, 60_000, 0, { physicalAttempts: true });
        const first = await limiter.execute(() => admitBinancePhysicalAttempt(), 1, 0);
        first.observeResponse({ status: 200, usedWeight: 796 });

        const admitted = vi.fn(() => admitBinancePhysicalAttempt());
        const pending = limiter.execute(admitted, 5, 0);
        // 796 + 5 has no room before the boundary and all of it after. The wait
        // is the second to the boundary, not the 55 093ms the desk recorded on
        // 2026-08-23 for room the exchange had already given back.
        await vi.advanceTimersByTimeAsync(2_500);
        expect(admitted).toHaveBeenCalled();
        await pending;
    });

    it('drops stale lifecycle work after spacing without booking physical weight', async () => {
        vi.setSystemTime(1_000);
        const summaries = [];
        const limiter = new RateLimiter(100, 60_000, 500, {
            physicalAttempts: true,
        });
        await limiter.execute(() => admitBinancePhysicalAttempt(), 30, 0);

        let current = true;
        let physicalSends = 0;
        const pending = limiter.execute(async () => {
            await admitBinancePhysicalAttempt();
            physicalSends += 1;
        }, 30, 0, {
            isCurrent: () => current,
            onAccounting: summary => summaries.push(summary),
        });
        const rejection = expect(pending).rejects.toMatchObject({
            name: 'AbortError',
            code: 'ABORT_ERR',
        });
        await vi.advanceTimersByTimeAsync(100);
        current = false;
        await vi.advanceTimersByTimeAsync(400);

        await rejection;
        expect(physicalSends).toBe(0);
        expect(limiter.getCurrentWeight()).toBe(30);
        expect(summaries).toEqual([
            expect.objectContaining({
                attempts: 0,
                chargedWeight: 0,
                outcome: 'aborted',
            }),
        ]);
    });

    it('holds later physical sends until Retry-After backpressure expires', async () => {
        const limiter = new RateLimiter(100, 60_000, 0, { physicalAttempts: true });
        await limiter.execute(async () => {
            const attempt = await admitBinancePhysicalAttempt();
            attempt.observeResponse({ status: 429, retryAfterMs: 2_500 });
        }, 1, 0);

        const sentAt = [];
        const pending = limiter.execute(async () => {
            await admitBinancePhysicalAttempt();
            sentAt.push(Date.now());
        }, 1, 0);
        await vi.advanceTimersByTimeAsync(2_499);
        expect(sentAt).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toBeUndefined();
        expect(sentAt).toEqual([2_500]);
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

    it('honors a carried pass ceiling on a requeued non-head request', () => {
        const limiter = new RateLimiter(1_000, 60_000, 0);
        limiter.waiting = [
            { urgent: false, passes: 0 },
            // This entry slept for capacity and rejoined behind newer ordinary
            // work while retaining the overtakes it had already absorbed.
            { urgent: false, passes: 8 },
            { urgent: true, passes: 0 },
        ];

        expect(limiter.nextAdmission()).toBe(0);
        expect(limiter.waiting.map(entry => entry.passes)).toEqual([0, 8, 0]);
    });

    it('keeps combined history and income fan-outs fair behind urgent physical work', async () => {
        vi.setSystemTime(1_000);
        const summaries = [];
        const limiter = new RateLimiter(10_000, 60_000, 10, {
            physicalAttempts: true,
            onOperation: summary => summaries.push(summary),
        });
        const admitted = [];
        const send = (label, weight, options) => limiter.execute(async () => {
            await admitBinancePhysicalAttempt();
            admitted.push(label);
        }, weight, 0, options);
        const fanOut = async (prefix, count, weight) => {
            for (let index = 0; index < count; index += 1) {
                await send(`${prefix}:${index}`, weight);
            }
        };

        const history = fanOut('history', 24, 5);
        const income = fanOut('income', 16, 30);
        await vi.advanceTimersByTimeAsync(25);
        const priorityBoundary = admitted.length;
        const listenKey = send('listen-key', 1, { urgent: true });
        const command = send('trading-command', 1, { urgent: true });

        await vi.advanceTimersByTimeAsync(2_000);
        await Promise.all([history, income, listenKey, command]);

        const priorityWindow = admitted.slice(priorityBoundary, priorityBoundary + 3);
        // An ordinary attempt already holding the serialized admission slot is
        // not preempted, but nothing else queued ahead of the urgent work is.
        expect(priorityWindow.filter(label => (
            label === 'listen-key' || label === 'trading-command'
        ))).toEqual(['listen-key', 'trading-command']);
        expect(priorityWindow.filter(label => (
            label.startsWith('history:') || label.startsWith('income:')
        )).length).toBeLessThanOrEqual(1);
        const ordinary = admitted.filter(label => (
            label.startsWith('history:') || label.startsWith('income:')
        ));
        expect(ordinary.filter(label => label.startsWith('history:'))).toHaveLength(24);
        expect(ordinary.filter(label => label.startsWith('income:'))).toHaveLength(16);
        // While both walks still have pages, neither can monopolize admission.
        expect(ordinary.slice(0, 32).filter(label => label.startsWith('history:')).length)
            .toBeGreaterThanOrEqual(15);
        expect(ordinary.slice(0, 32).filter(label => label.startsWith('income:')).length)
            .toBeGreaterThanOrEqual(15);
        expect(summaries).toHaveLength(42);
        expect(summaries.every(summary => summary.attempts === 1)).toBe(true);
        expect(summaries.reduce((total, summary) => total + summary.chargedWeight, 0))
            .toBe((24 * 5) + (16 * 30) + 2);
        expect(summaries.filter(summary => summary.standing === 'urgent')).toHaveLength(2);
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

// The record names a request's route — the desk's own word for where the
// attempt went, never a path — and a command's standing. On 2026-09-02 two
// thousand weight-5 lines could be attributed only by their cadence.
describe('production RateLimiter route and standing on the request line', () => {
    it('carries the route the physical attempt named, preferring the operation over the clock', async () => {
        const summaries = [];
        const limiter = new RateLimiter(800, 60_000, 0, {
            physicalAttempts: true,
            onOperation: summary => summaries.push(summary),
        });
        await limiter.execute(async () => {
            // A signed read syncs the clock first; the clock is not the route.
            await admitBinancePhysicalAttempt(1, 'time');
            await admitBinancePhysicalAttempt(5, 'history-trades');
            return 'ok';
        }, 5, 0, { standing: 'command' });
        await limiter.execute(async () => {
            await admitBinancePhysicalAttempt(30, 'income');
            return 'ok';
        }, 30, 0);
        await limiter.execute(async () => {
            await admitBinancePhysicalAttempt(5);
            return 'ok';
        }, 5, 0, { urgent: true });
        expect(summaries.map(summary => [summary.standing, summary.route, summary.chargedWeight])).toEqual([
            ['command', 'history-trades', 6],
            ['ordinary', 'income', 30],
            ['urgent', null, 5],
        ]);
    });
});
