// The command reserve and the command standing.
//
// Measured 2026-08-30 (desk-2026-08-30-002.jsonl): the desk's own ordinary
// reads pinned the window at 796–800 of 800 for whole minutes; urgent
// weight-1 cancellations waited 23–35 s behind them — urgent standing
// reorders the queue but conferred no capacity — and the renderer's
// fifteen-second answer deadline turned each into a false
// "Cancellation NOT confirmed" while the exchange had refused nothing.
//
// Measured again 2026-09-02 (desk-2026-09-02-000.jsonl): the reserve of 40
// was smaller than the 90-weight pass a margin command waits on (urgent w=40
// deferred 19 314 ms at 766/800), and a weight-1 command was held 2 195 ms
// at 809/800 — by the desk's own ceiling, a third of the exchange's. A
// command is now refused capacity by nothing of the desk's own.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    FUTURES_COMMAND_WEIGHT_RESERVE,
    FUTURES_EXCHANGE_WEIGHT_LIMIT,
    FUTURES_EXCHANGE_WEIGHT_MARGIN,
    FUTURES_REST_ACCOUNT_WEIGHT_CEILING,
    RateLimiter,
} from './binance-connection.js';

const CEILING = FUTURES_REST_ACCOUNT_WEIGHT_CEILING;
const ORDINARY_CEILING = CEILING - FUTURES_COMMAND_WEIGHT_RESERVE;
const EXCHANGE_CEILING = FUTURES_EXCHANGE_WEIGHT_LIMIT - FUTURES_EXCHANGE_WEIGHT_MARGIN;

const productionOptions = (extra = {}) => ({
    commandWeightReserve: FUTURES_COMMAND_WEIGHT_RESERVE,
    exchangeWeightLimit: FUTURES_EXCHANGE_WEIGHT_LIMIT,
    exchangeWeightMargin: FUTURES_EXCHANGE_WEIGHT_MARGIN,
    ...extra,
});

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

    it('states its ceilings against the exchange, not against a fraction chosen once', () => {
        // The operator's floor for ordinary work, and the presentation canon's
        // rule that the account reader and the public reader (600) together
        // stay below the exchange's minute.
        expect(ORDINARY_CEILING).toBeGreaterThanOrEqual(1_200);
        expect(CEILING + 600).toBeLessThan(FUTURES_EXCHANGE_WEIGHT_LIMIT);
        // The reserve admits the read a command waits on: the four-resource
        // pass (40 + 40 + 5 + 5), a proof read (5) and a configuration read
        // (5 + 1), all at once.
        expect(FUTURES_COMMAND_WEIGHT_RESERVE).toBeGreaterThanOrEqual(90 + 5 + 6);
    });

    it('refuses ordinary capacity beyond the ceiling less the reserve while urgent books into it', async () => {
        const limiter = new RateLimiter(CEILING, 60_000, 0, productionOptions());
        const run = runner(limiter);

        // Ordinary reads fill the window to the edge of the reserve.
        const bootstrap = run('bootstrap', ORDINARY_CEILING);
        await vi.advanceTimersByTimeAsync(0);
        await expect(bootstrap).resolves.toBe('bootstrap');
        expect(limiter.getCurrentWeight()).toBe(ORDINARY_CEILING);

        // The next ordinary read would book into the reserve: it waits for the
        // window to roll, exactly as it waits at the ceiling itself.
        let passAnswered = false;
        const pass = run('account-pass', 5).then((value) => {
            passAnswered = true;
            return value;
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(passAnswered).toBe(false);

        // The read a command waits on books into the reserve and goes at once
        // — the whole 90-weight pass, which forty could not admit.
        const consequence = run('command-pass', 90, { urgent: true });
        await vi.advanceTimersByTimeAsync(0);
        await expect(consequence).resolves.toBe('command-pass');

        // The held pass still goes when the window rolls: the reserve refuses
        // it capacity, it does not starve it.
        await vi.advanceTimersByTimeAsync(60_200);
        await expect(pass).resolves.toBe('account-pass');
        expect(passAnswered).toBe(true);
    });

    it('says in the record when the reserve, not the exchange, held an ordinary read', async () => {
        const deferrals = [];
        const limiter = new RateLimiter(CEILING, 60_000, 0, productionOptions({
            onDeferred: entry => deferrals.push(entry),
        }));
        const run = runner(limiter);

        const bootstrap = run('bootstrap', ORDINARY_CEILING);
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
            spent: ORDINARY_CEILING,
            ceiling: CEILING,
        }]);
    });

    // A guard, not a bite: urgent work stopped at the ceiling before the
    // reserve existed too. It pins that the reserve widens nothing for a read
    // — urgent standing ends where the window itself does.
    it('stops urgent work at the ceiling itself', async () => {
        const limiter = new RateLimiter(CEILING, 60_000, 0, productionOptions());
        const run = runner(limiter);

        const bootstrap = run('bootstrap', ORDINARY_CEILING);
        await vi.advanceTimersByTimeAsync(0);
        await expect(bootstrap).resolves.toBe('bootstrap');

        const wholeReserve = run('command-pass', FUTURES_COMMAND_WEIGHT_RESERVE, { urgent: true });
        await vi.advanceTimersByTimeAsync(0);
        await expect(wholeReserve).resolves.toBe('command-pass');
        expect(limiter.getCurrentWeight()).toBe(CEILING);

        let readAnswered = false;
        const read = run('proof-read', 5, { urgent: true }).then((value) => {
            readAnswered = true;
            return value;
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(readAnswered).toBe(false);

        await vi.advanceTimersByTimeAsync(60_200);
        await expect(read).resolves.toBe('proof-read');
    });

    // The bite of 2026-09-02: at the desk's own ceiling, with a read waiting,
    // the operator's cancel went at once. On HEAD it waited the window out.
    it('admits a command at the urgent ceiling while the read it waits on waits', async () => {
        const deferrals = [];
        const limiter = new RateLimiter(CEILING, 60_000, 0, productionOptions({
            onDeferred: entry => deferrals.push(entry),
        }));
        const run = runner(limiter);

        const fill = run('fill', CEILING);
        await vi.advanceTimersByTimeAsync(0);
        await expect(fill).resolves.toBe('fill');

        let passAnswered = false;
        const pass = run('command-pass', 90, { urgent: true }).then((value) => {
            passAnswered = true;
            return value;
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(passAnswered).toBe(false);

        const cancel = run('cancel-order', 1, { standing: 'command' });
        await vi.advanceTimersByTimeAsync(0);
        await expect(cancel).resolves.toBe('cancel-order');
        // Booked, so the desk's accounting matches the exchange's.
        expect(limiter.getCurrentWeight()).toBe(CEILING + 1);
        // No wait line for the command: the desk held it for nothing.
        expect(deferrals.filter(entry => entry.standing === 'command')).toEqual([]);

        await vi.advanceTimersByTimeAsync(60_200);
        await expect(pass).resolves.toBe('command-pass');
    });

    it('holds a command only short of the exchange\'s own limit, and says so', async () => {
        const deferrals = [];
        const limiter = new RateLimiter(CEILING, 60_000, 0, productionOptions({
            onDeferred: entry => deferrals.push(entry),
        }));
        const run = runner(limiter);

        // Everything the desk's own ceilings allow, then commands up to the
        // exchange's margin.
        const fill = run('fill', CEILING);
        await vi.advanceTimersByTimeAsync(0);
        await expect(fill).resolves.toBe('fill');
        const burst = run('burst', EXCHANGE_CEILING - CEILING, { standing: 'command' });
        await vi.advanceTimersByTimeAsync(0);
        await expect(burst).resolves.toBe('burst');
        expect(limiter.getCurrentWeight()).toBe(EXCHANGE_CEILING);

        let cancelAnswered = false;
        const cancel = run('cancel-order', 1, { standing: 'command' }).then((value) => {
            cancelAnswered = true;
            return value;
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(cancelAnswered).toBe(false);

        await vi.advanceTimersByTimeAsync(60_200);
        await expect(cancel).resolves.toBe('cancel-order');
        expect(deferrals).toEqual([{
            standing: 'command',
            waitedMs: 60_100,
            weight: 1,
            spent: EXCHANGE_CEILING,
            ceiling: EXCHANGE_CEILING,
        }]);
    });

    it('lets a command go ahead of the housekeeping queued before it, uncounted', async () => {
        const limiter = new RateLimiter(CEILING, 60_000, 150, productionOptions());
        const order = [];
        const run = (label, options) => limiter.execute(async () => {
            order.push(label);
            return label;
        }, 5, 0, options);

        // Three ordinary reads take the slot in turn at 150 ms spacing; the
        // command arrives last and is next.
        const first = run('read-1');
        const second = run('read-2');
        const third = run('read-3');
        const cancel = run('cancel-order', { standing: 'command' });
        await vi.advanceTimersByTimeAsync(0);
        await first;
        await vi.advanceTimersByTimeAsync(150);
        await cancel;
        expect(order).toEqual(['read-1', 'cancel-order']);
        await vi.advanceTimersByTimeAsync(400);
        await Promise.all([second, third]);
        expect(order).toEqual(['read-1', 'cancel-order', 'read-2', 'read-3']);
    });

    // A guard: a limiter that states no exchange limit — the Spot one, every
    // stand that never says — measures a command like urgent work.
    it('measures a command as urgent where no exchange limit is stated', async () => {
        const limiter = new RateLimiter(100, 60_000, 0);
        const run = runner(limiter);

        const fill = run('fill', 100);
        await vi.advanceTimersByTimeAsync(0);
        await expect(fill).resolves.toBe('fill');

        let commandAnswered = false;
        const command = run('cancel-order', 1, { standing: 'command' }).then((value) => {
            commandAnswered = true;
            return value;
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(commandAnswered).toBe(false);
        await vi.advanceTimersByTimeAsync(60_200);
        await expect(command).resolves.toBe('cancel-order');
    });

    // A guard, not a bite: backpressure never consulted the reserve. It pins
    // the boundary the spec states — what the exchange imposes binds command,
    // urgent and ordinary work alike, and nothing of the desk's shortens it.
    it('does not shorten exchange backpressure by the reserve or by command standing', async () => {
        const limiter = new RateLimiter(CEILING, 60_000, 0, productionOptions());
        limiter.reconcilePhysicalResponse({ status: 429, retryAfterMs: 5_000 });
        const run = runner(limiter);

        let commandAnswered = false;
        const command = run('cancel-order', 1, { standing: 'command' }).then((value) => {
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
        const limiter = new RateLimiter(CEILING, 60_000, 0, productionOptions());
        const run = runner(limiter);

        const oversized = run('bootstrap', CEILING - 10);
        await vi.advanceTimersByTimeAsync(0);
        await expect(oversized).resolves.toBe('bootstrap');
    });
});

// The stand: three hundred requests of mixed standing with random aborts,
// against the invariants the standings promise. Deterministic — the "random"
// is a fixed linear congruential sequence — so a failure is reproducible.
describe('RateLimiter standings under a mixed load', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('never holds a command for the desk\'s own ceilings, and never books ordinary past its own', { timeout: 30_000 }, async () => {
        const deferrals = [];
        const limiter = new RateLimiter(CEILING, 60_000, 0, productionOptions({
            onDeferred: entry => deferrals.push(entry),
        }));
        let seed = 7;
        const next = () => {
            seed = (seed * 48_271) % 2_147_483_647;
            return seed / 2_147_483_647;
        };
        const standings = ['ordinary', 'ordinary', 'ordinary', 'urgent', 'command'];
        const weights = { ordinary: [5, 30, 40], urgent: [5, 40], command: [0, 1] };
        let ordinaryPeak = 0;
        let peak = 0;
        const bookedByStanding = { ordinary: 0, urgent: 0, command: 0 };
        const requests = [];
        for (let index = 0; index < 300; index += 1) {
            const standing = standings[Math.floor(next() * standings.length)];
            const options = weights[standing];
            const weight = options[Math.floor(next() * options.length)];
            const controller = new AbortController();
            const aborts = next() < 0.1;
            const promise = limiter.execute(async () => {
                bookedByStanding[standing] += weight;
                const spent = limiter.getCurrentWeight();
                peak = Math.max(peak, spent);
                if (standing === 'ordinary') ordinaryPeak = Math.max(ordinaryPeak, spent);
                return standing;
            }, weight, 0, { standing, signal: controller.signal }).catch(error => error?.name);
            requests.push(promise);
            if (aborts) setTimeout(() => controller.abort(), Math.floor(next() * 500));
        }
        await vi.advanceTimersByTimeAsync(0);
        // Three hundred requests weigh several windows; roll enough of them.
        for (let window = 0; window < 8; window += 1) {
            await vi.advanceTimersByTimeAsync(61_000);
        }
        const outcomes = await Promise.all(requests);

        // Every request ended: admitted, or aborted before its turn.
        expect(outcomes.every(outcome => ['ordinary', 'urgent', 'command', 'AbortError'].includes(outcome))).toBe(true);
        // Ordinary standing booked to its own ceiling and no further; the
        // window as a whole never passed the exchange margin.
        expect(ordinaryPeak).toBeLessThanOrEqual(ORDINARY_CEILING);
        expect(peak).toBeLessThanOrEqual(EXCHANGE_CEILING);
        // A command was held only by the exchange margin, never by 1 200 or
        // 1 700, and the queue did not stall: every wait line for a command
        // names the exchange ceiling.
        for (const entry of deferrals.filter(entry => entry.standing === 'command')) {
            expect(entry.ceiling).toBe(EXCHANGE_CEILING);
            expect(entry.spent + entry.weight).toBeGreaterThan(EXCHANGE_CEILING);
        }
        // The queue was not left holding the slot by an abort: nothing waits.
        expect(limiter.waiting).toHaveLength(0);
        expect(limiter.admitting).toBe(false);
    });
});
