// The command reserve: a slice of the minute window that ordinary work may
// not book, held back for the operator's commands and the reads they wait on.
//
// Measured 2026-08-30 (desk-2026-08-30-002.jsonl): the desk's own ordinary
// reads pinned the window at 796–800 of 800 for whole minutes; urgent
// weight-1 cancellations waited 23–35 s behind them — urgent standing
// reorders the queue but conferred no capacity — and the renderer's
// fifteen-second answer deadline turned each into a false
// "Cancellation NOT confirmed" while the exchange had refused nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FUTURES_COMMAND_WEIGHT_RESERVE, RateLimiter } from './binance-connection.js';

const runner = limiter => (label, weight, options) => limiter.execute(
    async () => label,
    weight,
    0,
    options,
);

describe('RateLimiter command weight reserve', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('refuses ordinary capacity beyond the ceiling less the reserve while urgent books into it', async () => {
        const limiter = new RateLimiter(800, 60_000, 0, {
            commandWeightReserve: FUTURES_COMMAND_WEIGHT_RESERVE,
        });
        const run = runner(limiter);

        // Ordinary reads fill the window to the edge of the reserve.
        const bootstrap = run('bootstrap', 800 - FUTURES_COMMAND_WEIGHT_RESERVE);
        await vi.advanceTimersByTimeAsync(0);
        await expect(bootstrap).resolves.toBe('bootstrap');
        expect(limiter.getCurrentWeight()).toBe(760);

        // The next ordinary read would book into the reserve: it waits for the
        // window to roll, exactly as it waits at the ceiling itself.
        let passAnswered = false;
        const pass = run('account-pass', 5).then((value) => {
            passAnswered = true;
            return value;
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(passAnswered).toBe(false);

        // The operator's command books into the reserve and goes at once.
        const command = run('cancel-order', 1, { urgent: true });
        await vi.advanceTimersByTimeAsync(0);
        await expect(command).resolves.toBe('cancel-order');

        // The held pass still goes when the window rolls: the reserve refuses
        // it capacity, it does not starve it.
        await vi.advanceTimersByTimeAsync(60_200);
        await expect(pass).resolves.toBe('account-pass');
        expect(passAnswered).toBe(true);
    });

    it('says in the record when the reserve, not the exchange, held an ordinary read', async () => {
        const deferrals = [];
        const limiter = new RateLimiter(800, 60_000, 0, {
            commandWeightReserve: FUTURES_COMMAND_WEIGHT_RESERVE,
            onDeferred: entry => deferrals.push(entry),
        });
        const run = runner(limiter);

        const bootstrap = run('bootstrap', 760);
        await vi.advanceTimersByTimeAsync(0);
        await expect(bootstrap).resolves.toBe('bootstrap');

        const pass = run('account-pass', 5);
        await vi.advanceTimersByTimeAsync(60_200);
        await expect(pass).resolves.toBe('account-pass');

        // The line keeps its shape, and the ceiling stays the window's own —
        // the reserve is arithmetic inside it, not a second smaller window.
        expect(deferrals).toEqual([{
            standing: 'ordinary',
            waitedMs: 60_100,
            weight: 5,
            spent: 760,
            ceiling: 800,
        }]);
    });

    // A guard, not a bite: urgent work stopped at the ceiling before the
    // reserve existed too. It pins that the reserve widens nothing — urgent
    // standing ends where the window itself does.
    it('stops urgent work at the ceiling itself', async () => {
        const limiter = new RateLimiter(800, 60_000, 0, {
            commandWeightReserve: FUTURES_COMMAND_WEIGHT_RESERVE,
        });
        const run = runner(limiter);

        const bootstrap = run('bootstrap', 760);
        await vi.advanceTimersByTimeAsync(0);
        await expect(bootstrap).resolves.toBe('bootstrap');

        const wholeReserve = run('leverage-warm', FUTURES_COMMAND_WEIGHT_RESERVE, { urgent: true });
        await vi.advanceTimersByTimeAsync(0);
        await expect(wholeReserve).resolves.toBe('leverage-warm');
        expect(limiter.getCurrentWeight()).toBe(800);

        let commandAnswered = false;
        const command = run('cancel-order', 1, { urgent: true }).then((value) => {
            commandAnswered = true;
            return value;
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(commandAnswered).toBe(false);

        await vi.advanceTimersByTimeAsync(60_200);
        await expect(command).resolves.toBe('cancel-order');
    });

    // A guard, not a bite: backpressure never consulted the reserve. It pins
    // the boundary the spec states — what the exchange imposes binds urgent
    // and ordinary work alike, and the reserve does not shorten it.
    it('does not shorten exchange backpressure by the reserve', async () => {
        const limiter = new RateLimiter(800, 60_000, 0, {
            commandWeightReserve: FUTURES_COMMAND_WEIGHT_RESERVE,
        });
        limiter.reconcilePhysicalResponse({ status: 429, retryAfterMs: 5_000 });
        const run = runner(limiter);

        let commandAnswered = false;
        const command = run('cancel-order', 1, { urgent: true }).then((value) => {
            commandAnswered = true;
            return value;
        });
        await vi.advanceTimersByTimeAsync(4_000);
        expect(commandAnswered).toBe(false);

        await vi.advanceTimersByTimeAsync(1_200);
        await expect(command).resolves.toBe('cancel-order');
    });

    // A guard for the Spot limiter, which passes no reserve: its ordinary
    // work still books the window to the ceiling itself.
    it('leaves a limiter with no reserve exactly at its ceiling', async () => {
        const limiter = new RateLimiter(100, 60_000, 0);
        const run = runner(limiter);

        const fill = run('fill', 100);
        await vi.advanceTimersByTimeAsync(0);
        await expect(fill).resolves.toBe('fill');
        expect(limiter.getCurrentWeight()).toBe(100);
    });

    // The scenario the window already answers: a request larger than the
    // whole window is admitted when nothing is booked, rather than waiting
    // for room that will not appear. The reserve must not break that.
    it('admits an ordinary request larger than ceiling less reserve into an empty window', async () => {
        const limiter = new RateLimiter(800, 60_000, 0, {
            commandWeightReserve: FUTURES_COMMAND_WEIGHT_RESERVE,
        });
        const run = runner(limiter);

        const oversized = run('bootstrap', 790);
        await vi.advanceTimersByTimeAsync(0);
        await expect(oversized).resolves.toBe('bootstrap');
    });
});
