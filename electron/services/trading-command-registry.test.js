import { describe, expect, it, vi } from 'vitest';
import {
    createTradingCommandRegistry,
    isMutatingTradingCommand,
    isTradingCommandOutcomeEnvelope,
    readTradingCommandIdentity,
    readTradingCommandLane,
    readTradingCommandOrderLane,
} from './trading-command-registry.js';

const command = (overrides = {}) => ({
    action: 'trade.placeOrder',
    marketType: 'futures',
    accountId: 'default',
    clientOrderId: 'f-1',
    symbol: 'BTCUSDT',
    ...overrides,
});

// A promise the test decides when to settle, standing in for the round trip to
// Binance that the lane is there to keep one command apart from the next.
const deferred = () => {
    let settle;
    const promise = new Promise((resolve) => { settle = resolve; });
    return { promise, settle };
};

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('which commands the registry is for', () => {
    it.each([
        'trade.placeOrder',
        'trade.cancelOrder',
        'trade.replaceOrder',
        'trade.cancelAll',
        'trade.adjustPositionMargin',
        'trade.setLeverage',
        'trade.setMarginType',
    ])('treats %s as changing something at the exchange', (action) => {
        expect(isMutatingTradingCommand({ action })).toBe(true);
    });

    // Reads are asked for constantly and the history fan-out depends on staying
    // concurrent; the pause flag never leaves this machine.
    it.each([
        'account.refresh',
        'account.history',
        'account.symbolConfig',
        'trade.setTradingPaused',
    ])('leaves %s outside the registry', (action) => {
        expect(isMutatingTradingCommand({ action })).toBe(false);
    });

    it('reads no identity from a command that carries none', () => {
        expect(readTradingCommandIdentity(command({ clientOrderId: null }))).toBeNull();
        expect(readTradingCommandIdentity(command({ clientOrderId: '' }))).toBeNull();
        expect(readTradingCommandIdentity({ action: 'account.refresh', clientOrderId: 'r-1' })).toBeNull();
    });

    it('separates identities by market, account and action', () => {
        const base = readTradingCommandIdentity(command());
        expect(readTradingCommandIdentity(command({ marketType: 'spot' }))).not.toBe(base);
        expect(readTradingCommandIdentity(command({ accountId: 'other' }))).not.toBe(base);
        expect(readTradingCommandIdentity(command({ action: 'trade.cancelOrder' }))).not.toBe(base);
        expect(readTradingCommandIdentity(command({ symbol: 'ETHUSDT' }))).toBe(base);
    });

    it('lanes by contract, and puts a command without one on the market lane', () => {
        expect(readTradingCommandLane(command({ clientOrderId: 'f-2' })))
            .toBe(readTradingCommandLane(command({ action: 'trade.cancelOrder' })));
        expect(readTradingCommandLane(command({ symbol: 'ETHUSDT' })))
            .not.toBe(readTradingCommandLane(command()));
        expect(readTradingCommandLane(command({ symbol: undefined })))
            .toBe(readTradingCommandLane(command({ symbol: '' })));
    });

    it('recognizes the envelopes that say how a command ended', () => {
        expect(isTradingCommandOutcomeEnvelope({ command_rejected: { code: 'X' } })).toBe(true);
        expect(isTradingCommandOutcomeEnvelope({ futures_execution_update: {} })).toBe(true);
        expect(isTradingCommandOutcomeEnvelope({ execution_update: {} })).toBe(true);
        expect(isTradingCommandOutcomeEnvelope({ command_unresolved: {} })).toBe(true);
        expect(isTradingCommandOutcomeEnvelope({ command_resolved: {} })).toBe(true);
        // An account snapshot or a chart page replayed later would be a claim
        // about the present; a rejection stays true.
        expect(isTradingCommandOutcomeEnvelope({ futures_account: {} })).toBe(false);
        expect(isTradingCommandOutcomeEnvelope({ chart: [] })).toBe(false);
        expect(isTradingCommandOutcomeEnvelope(null)).toBe(false);
    });
});

describe('a command that arrives twice', () => {
    it('runs once and answers the second copy from the record', async () => {
        const registry = createTradingCommandRegistry();
        const emitFirst = vi.fn();
        const emitSecond = vi.fn();
        const execute = vi.fn(async () => {
            registry.recordOutcome({ futures_execution_update: { orderId: 7 } });
        });

        const ran = await registry.submit(command(), { emit: emitFirst, execute });
        const replayed = await registry.submit(command(), { emit: emitSecond, execute });

        expect(ran).toBe(true);
        expect(replayed).toBe(false);
        expect(execute).toHaveBeenCalledOnce();
        expect(emitSecond.mock.calls).toEqual([[{ futures_execution_update: { orderId: 7 } }]]);
    });

    it('makes the second copy wait for the first rather than submit its own', async () => {
        const registry = createTradingCommandRegistry();
        const inFlight = deferred();
        const emit = vi.fn();
        const execute = vi.fn(async () => {
            await inFlight.promise;
            registry.recordOutcome({ command_rejected: { code: 'FUTURES_API_ERROR' } });
        });

        const first = registry.submit(command(), { emit, execute });
        const second = registry.submit(command(), { emit, execute });
        await flush();

        expect(execute).toHaveBeenCalledOnce();
        expect(emit).not.toHaveBeenCalled();

        inFlight.settle();
        await Promise.all([first, second]);

        expect(execute).toHaveBeenCalledOnce();
        expect(emit.mock.calls).toEqual([[{ command_rejected: { code: 'FUTURES_API_ERROR' } }]]);
    });

    // The renderer resends what it believes never left, and a reconnected one
    // resends it on a socket that was never told the answer.
    it('answers a socket that never saw the first answer', async () => {
        const registry = createTradingCommandRegistry();
        const oldSocket = vi.fn();
        const newSocket = vi.fn();
        // The connection's own emit, which is what records: one call both tells
        // the renderer and keeps the envelope against the running command.
        const emitTo = sink => (payload) => {
            registry.recordOutcome(payload);
            sink(payload);
        };

        await registry.submit(command(), {
            emit: emitTo(oldSocket),
            execute: async () => { emitTo(oldSocket)({ futures_execution_update: { orderId: 11 } }); },
        });
        await registry.submit(command(), {
            emit: emitTo(newSocket),
            execute: () => { throw new Error('the command must not run a second time'); },
        });

        expect(oldSocket.mock.calls).toEqual([[{ futures_execution_update: { orderId: 11 } }]]);
        expect(newSocket.mock.calls).toEqual(oldSocket.mock.calls);
    });

    it('runs a command that carries no identity every time it arrives', async () => {
        const registry = createTradingCommandRegistry();
        const execute = vi.fn(async () => {});
        const anonymous = command({ clientOrderId: null });

        await registry.submit(anonymous, { emit: vi.fn(), execute });
        await registry.submit(anonymous, { emit: vi.fn(), execute });

        expect(execute).toHaveBeenCalledTimes(2);
        expect(registry.size()).toBe(0);
    });
});

describe('what the record keeps', () => {
    it('keeps only what a command said about itself', async () => {
        const registry = createTradingCommandRegistry();
        const emit = vi.fn();
        await registry.submit(command(), {
            emit: vi.fn(),
            execute: async () => {
                registry.recordOutcome({ futures_account: { balances: [] } });
                registry.recordOutcome({ command_resolved: { code: 'FUTURES_OUTCOME_ABSENT' } });
            },
        });
        await registry.submit(command(), { emit, execute: async () => {} });

        expect(emit.mock.calls).toEqual([[{ command_resolved: { code: 'FUTURES_OUTCOME_ABSENT' } }]]);
    });

    it('records nothing outside a command', () => {
        const registry = createTradingCommandRegistry();
        expect(registry.recordOutcome({ futures_execution_update: { orderId: 3 } })).toBe(false);
    });

    // A handler that leaves work running behind it keeps the command's own
    // execution context, so its late emit is still attributed to that command.
    // The answer was already given, and must not gain a line afterwards.
    it('records nothing a command emits after it has ended', async () => {
        const registry = createTradingCommandRegistry();
        const trailing = deferred();
        let recordedLate = null;

        await registry.submit(command(), {
            emit: vi.fn(),
            execute: async () => {
                registry.recordOutcome({ futures_execution_update: { orderId: 5 } });
                // Started by the handler and deliberately not awaited, the way a
                // background resync is.
                void (async () => {
                    await trailing.promise;
                    recordedLate = registry.recordOutcome({ command_rejected: { code: 'LATE' } });
                })();
            },
        });

        trailing.settle();
        await flush();
        expect(recordedLate).toBe(false);

        const emit = vi.fn();
        await registry.submit(command(), { emit, execute: async () => {} });
        expect(emit.mock.calls).toEqual([[{ futures_execution_update: { orderId: 5 } }]]);
    });

    it('caps what one command may record', async () => {
        const registry = createTradingCommandRegistry({ maxOutcomes: 2 });
        const emit = vi.fn();
        await registry.submit(command(), {
            emit: vi.fn(),
            execute: async () => {
                for (let index = 0; index < 5; index += 1) {
                    registry.recordOutcome({ command_rejected: { code: `E${index}` } });
                }
            },
        });
        await registry.submit(command(), { emit, execute: async () => {} });

        expect(emit).toHaveBeenCalledTimes(2);
    });

    it('forgets a record older than the window and stays under the ceiling', async () => {
        let clock = 1_000;
        const registry = createTradingCommandRegistry({
            now: () => clock,
            maxAgeMs: 10_000,
            maxEntries: 3,
        });
        const run = id => registry.submit(command({ clientOrderId: id }), {
            emit: vi.fn(),
            execute: async () => {},
        });

        await run('f-1');
        await run('f-2');
        expect(registry.size()).toBe(2);

        clock += 20_000;
        await run('f-3');
        expect(registry.size()).toBe(1);

        for (const id of ['f-4', 'f-5', 'f-6', 'f-7', 'f-8']) await run(id);
        expect(registry.size()).toBeLessThanOrEqual(3);
        // And the lane each of them took is released once it is empty.
        await flush();
        expect(registry.laneCount()).toBe(0);
    });
});

describe('commands on one order', () => {
    it('runs them in the order they were accepted', async () => {
        const registry = createTradingCommandRegistry();
        const amendment = deferred();
        const order = [];

        const amend = registry.submit(command({
            action: 'trade.replaceOrder',
            clientOrderId: 'f-amend',
            orderId: 4110,
        }), {
            emit: vi.fn(),
            execute: async () => {
                order.push('amend:start');
                await amendment.promise;
                order.push('amend:end');
            },
        });
        const cancel = registry.submit(command({
            action: 'trade.cancelOrder',
            clientOrderId: 'f-cancel',
            orderId: 4110,
        }), {
            emit: vi.fn(),
            execute: async () => { order.push('cancel'); },
        });
        await flush();

        // The cancellation is accepted, and has not reached the exchange: the
        // amendment of the same order it followed is still in flight.
        expect(order).toEqual(['amend:start']);

        amendment.settle();
        await Promise.all([amend, cancel]);

        expect(order).toEqual(['amend:start', 'amend:end', 'cancel']);
    });

    // Before an order has an exchange id there is only the id the desk minted,
    // and both the placement and anything about it afterwards spell it that way.
    it('orders a command that names the order by the client id the desk minted', async () => {
        const registry = createTradingCommandRegistry();
        const placement = deferred();
        const order = [];

        const place = registry.submit(command({ clientOrderId: 'f-new' }), {
            emit: vi.fn(),
            execute: async () => {
                order.push('place:start');
                await placement.promise;
                order.push('place:end');
            },
        });
        const cancel = registry.submit(command({
            action: 'trade.cancelOrder',
            clientOrderId: 'f-cancel',
            origClientOrderId: 'f-new',
        }), {
            emit: vi.fn(),
            execute: async () => { order.push('cancel'); },
        });
        await flush();

        expect(order).toEqual(['place:start']);

        placement.settle();
        await Promise.all([place, cancel]);

        expect(order).toEqual(['place:start', 'place:end', 'cancel']);
    });

    // A cancellation that names no order at all cannot be ordered against
    // anything narrower than the contract, so it takes the contract.
    it('falls back to the contract when a command names no order', async () => {
        const registry = createTradingCommandRegistry();
        const placement = deferred();
        const order = [];

        const place = registry.submit(command({ clientOrderId: 'f-new' }), {
            emit: vi.fn(),
            execute: async () => {
                order.push('place:start');
                await placement.promise;
                order.push('place:end');
            },
        });
        const cancel = registry.submit(command({ action: 'trade.cancelOrder', clientOrderId: 'f-blind' }), {
            emit: vi.fn(),
            execute: async () => { order.push('cancel'); },
        });
        await flush();

        expect(order).toEqual(['place:start']);

        placement.settle();
        await Promise.all([place, cancel]);

        expect(order).toEqual(['place:start', 'place:end', 'cancel']);
    });
});

describe('commands on one contract', () => {
    // The operator had three orders resting side by side and moved them one
    // after another. Moving one is a cancellation and then a placement, and the
    // cancellation that begins the *next* move used to wait behind that
    // placement — a round trip through the proxy, 340-800 ms measured, for two
    // orders that have nothing to say to each other. Three moves cost two such
    // waits, and on screen the next order simply would not budge.
    it('lifts one order while a placement for another is still travelling', async () => {
        const registry = createTradingCommandRegistry();
        registry.observeEnvelope({ futures_regular_orders: [{ symbol: 'BTCUSDT', orderId: 907, clientOrderId: 'existing-907' }] });
        const placement = deferred();
        const order = [];

        const place = registry.submit(command({ clientOrderId: 'f-replacement' }), {
            emit: vi.fn(),
            execute: async () => {
                order.push('place:start');
                await placement.promise;
                order.push('place:end');
            },
        });
        const cancel = registry.submit(command({
            action: 'trade.cancelOrder',
            clientOrderId: 'f-lift-the-next',
            orderId: 907,
        }), {
            emit: vi.fn(),
            execute: async () => { order.push('lift:another-order'); },
        });
        await flush();

        expect(order).toEqual(['place:start', 'lift:another-order']);

        placement.settle();
        await Promise.all([place, cancel]);
    });

    // The three below do not bite the code that ordered every command on a
    // contract — that was stricter than this. They bite the obvious wrong
    // version of narrowing it: order lanes and nothing else, under which a
    // cancel-all runs beside the placement it is supposed to sweep away.
    it('sweeps a contract with nothing else on it in flight', async () => {
        const registry = createTradingCommandRegistry();
        const placement = deferred();
        const order = [];

        const place = registry.submit(command({ clientOrderId: 'f-resting' }), {
            emit: vi.fn(),
            execute: async () => {
                order.push('place:start');
                await placement.promise;
                order.push('place:end');
            },
        });
        const sweep = registry.submit(command({ action: 'trade.cancelAll', clientOrderId: 'f-sweep' }), {
            emit: vi.fn(),
            execute: async () => { order.push('cancel-all'); },
        });
        await flush();

        // An order placed before the sweep was accepted must be on the book for
        // the sweep to take it: running beside it is how one survives.
        expect(order).toEqual(['place:start']);

        placement.settle();
        await Promise.all([place, sweep]);

        expect(order).toEqual(['place:start', 'place:end', 'cancel-all']);
    });

    it('holds every order on the contract behind a sweep that is still running', async () => {
        const registry = createTradingCommandRegistry();
        const sweeping = deferred();
        const order = [];

        const sweep = registry.submit(command({ action: 'trade.cancelAll', clientOrderId: 'f-sweep' }), {
            emit: vi.fn(),
            execute: async () => {
                order.push('cancel-all:start');
                await sweeping.promise;
                order.push('cancel-all:end');
            },
        });
        const place = registry.submit(command({ clientOrderId: 'f-after' }), {
            emit: vi.fn(),
            execute: async () => { order.push('place'); },
        });
        await flush();

        expect(order).toEqual(['cancel-all:start']);

        sweeping.settle();
        await Promise.all([sweep, place]);

        expect(order).toEqual(['cancel-all:start', 'cancel-all:end', 'place']);
    });

    // Leverage decides what an order costs in margin, so a placement must not
    // be in flight while it changes. Margin type and position margin are the
    // same kind of statement about the contract as a whole.
    it.each([
        ['trade.setLeverage'],
        ['trade.setMarginType'],
        ['trade.adjustPositionMargin'],
    ])('runs %s alone on its contract', async (action) => {
        const registry = createTradingCommandRegistry();
        const placement = deferred();
        const order = [];

        const place = registry.submit(command({ clientOrderId: 'f-order' }), {
            emit: vi.fn(),
            execute: async () => {
                order.push('place:start');
                await placement.promise;
                order.push('place:end');
            },
        });
        const wide = registry.submit(command({ action, clientOrderId: 'f-wide' }), {
            emit: vi.fn(),
            execute: async () => { order.push('contract-wide'); },
        });
        await flush();

        expect(order).toEqual(['place:start']);

        placement.settle();
        await Promise.all([place, wide]);

        expect(order).toEqual(['place:start', 'place:end', 'contract-wide']);
    });

    it('lets a failed command out of the way of the next one', async () => {
        const registry = createTradingCommandRegistry();
        const order = [];
        const failing = registry.submit(command({ clientOrderId: 'f-boom' }), {
            emit: vi.fn(),
            execute: async () => {
                order.push('boom');
                throw new Error('handler broke');
            },
        });

        await expect(failing).rejects.toThrow('handler broke');
        await registry.submit(command({ action: 'trade.cancelOrder', clientOrderId: 'f-next' }), {
            emit: vi.fn(),
            execute: async () => { order.push('next'); },
        });

        expect(order).toEqual(['boom', 'next']);
    });

    it("keeps two contracts out of each other's way", async () => {
        const registry = createTradingCommandRegistry();
        const held = deferred();
        const order = [];

        const btc = registry.submit(command({ clientOrderId: 'f-btc' }), {
            emit: vi.fn(),
            execute: async () => {
                order.push('btc:start');
                await held.promise;
                order.push('btc:end');
            },
        });
        const eth = registry.submit(command({ clientOrderId: 'f-eth', symbol: 'ETHUSDT' }), {
            emit: vi.fn(),
            execute: async () => { order.push('eth'); },
        });
        await flush();

        expect(order).toEqual(['btc:start', 'eth']);

        held.settle();
        await Promise.all([btc, eth]);
    });

    // Two contracts run at once, and each records only what it emitted: the
    // recording follows a command's own execution rather than the clock.
    it("keeps each contract's outcomes to itself", async () => {
        const registry = createTradingCommandRegistry();
        const btcHeld = deferred();
        const replayBtc = vi.fn();
        const replayEth = vi.fn();

        const btc = registry.submit(command({ clientOrderId: 'f-btc' }), {
            emit: vi.fn(),
            execute: async () => {
                await btcHeld.promise;
                registry.recordOutcome({ futures_execution_update: { symbol: 'BTCUSDT' } });
            },
        });
        const eth = registry.submit(command({ clientOrderId: 'f-eth', symbol: 'ETHUSDT' }), {
            emit: vi.fn(),
            execute: async () => {
                registry.recordOutcome({ futures_execution_update: { symbol: 'ETHUSDT' } });
            },
        });
        await flush();
        btcHeld.settle();
        await Promise.all([btc, eth]);

        await registry.submit(command({ clientOrderId: 'f-btc' }), { emit: replayBtc, execute: async () => {} });
        await registry.submit(command({ clientOrderId: 'f-eth', symbol: 'ETHUSDT' }), { emit: replayEth, execute: async () => {} });

        expect(replayBtc.mock.calls).toEqual([[{ futures_execution_update: { symbol: 'BTCUSDT' } }]]);
        expect(replayEth.mock.calls).toEqual([[{ futures_execution_update: { symbol: 'ETHUSDT' } }]]);
    });
});

describe('exchange-observed order aliases', () => {
    const observe = (registry, orderId = 42, clientOrderId = 'original-42', scope = {}) => registry.observeOrder({
        marketType: 'futures', accountId: 'default', symbol: 'BTCUSDT', orderId, clientOrderId, ...scope,
    });
    const target = (identity, clientOrderId) => command({ action: 'trade.cancelOrder', clientOrderId, ...identity });

    it('keeps exchange and client namespaces distinct, with number/string exchange equivalence', () => {
        expect(readTradingCommandOrderLane(target({ orderId: 42 }, 'a'))).toBe(readTradingCommandOrderLane(target({ orderId: '42' }, 'b')));
        expect(readTradingCommandOrderLane(target({ orderId: 42 }, 'a'))).not.toBe(readTradingCommandOrderLane(target({ origClientOrderId: '42' }, 'b')));
        expect(readTradingCommandOrderLane(target({ orderId: 9007199254740992 }, 'a'))).toBeNull();
    });

    it.each([false, true])('serializes both alias directions with prior exchange proof=%s', async known => {
        for (const reverse of [false, true]) {
            const registry = createTradingCommandRegistry();
            if (known) observe(registry);
            const held = deferred();
            const events = [];
            const identities = [{ orderId: 42 }, { origClientOrderId: 'original-42' }];
            if (reverse) identities.reverse();
            const first = registry.submit({ ...target(identities[0], 'modify'), action: 'trade.replaceOrder' }, {
                emit: vi.fn(), execute: async () => { events.push('modify'); await held.promise; },
            });
            const second = registry.submit(target(identities[1], 'cancel'), { emit: vi.fn(), execute: async () => { events.push('cancel'); } });
            await flush();
            expect(events).toEqual(['modify']);
            held.settle();
            await Promise.all([first, second]);
            expect(events).toEqual(['modify', 'cancel']);
            await flush();
            expect(registry.laneCount()).toBe(0);
        }
    });

    it.each(['unobserved', 'private', 'command'])('holds exchange-ID cancellation behind a pending placement (%s identity)', async source => {
        const registry = createTradingCommandRegistry();
        const held = deferred();
        const events = [];
        const first = registry.submit(command({ clientOrderId: 'new-order' }), {
            emit: vi.fn(), execute: async () => {
                events.push('place');
                if (source === 'command') registry.recordOutcome({ futures_execution_update: { symbol: 'BTCUSDT', orderId: 51, status: 'NEW' } });
                await held.promise;
            },
        });
        await flush();
        if (source === 'private') registry.observeEnvelope({ futures_execution_update: { symbol: 'BTCUSDT', orderId: 51, clientOrderId: 'new-order' } });
        const second = registry.submit(target({ orderId: 51 }, 'cancel-new'), { emit: vi.fn(), execute: async () => { events.push('cancel'); } });
        await flush();
        expect(events).toEqual(['place']);
        held.settle();
        await Promise.all([first, second]);
        expect(events).toEqual(['place', 'cancel']);
    });

    it('does not learn a pair merely asserted by a command', async () => {
        const registry = createTradingCommandRegistry();
        await registry.submit(target({ orderId: 42, origClientOrderId: 'claimed' }, 'claim'), { emit: vi.fn(), execute: async () => {} });
        expect(registry.aliasCount()).toBe(0);
    });

    it('runs proven different groups concurrently, even when both commands use client IDs', async () => {
        const registry = createTradingCommandRegistry();
        observe(registry, 41, 'one');
        observe(registry, 42, 'two');
        const held = deferred();
        const events = [];
        const first = registry.submit(target({ origClientOrderId: 'one' }, 'first'), { emit: vi.fn(), execute: async () => { events.push('one'); await held.promise; } });
        const second = registry.submit(target({ origClientOrderId: 'two' }, 'second'), { emit: vi.fn(), execute: async () => { events.push('two'); } });
        await flush();
        expect(events).toEqual(['one', 'two']);
        held.settle();
        await Promise.all([first, second]);
    });

    it('falls back to the contract after conflicting/reused client identity', async () => {
        const registry = createTradingCommandRegistry();
        observe(registry, 41, 'reused');
        observe(registry, 42, 'reused');
        observe(registry, 99, 'unrelated');
        const held = deferred();
        const events = [];
        const first = registry.submit(target({ orderId: 99 }, 'first'), { emit: vi.fn(), execute: async () => { events.push('first'); await held.promise; } });
        const second = registry.submit(target({ orderId: 41 }, 'unsafe'), { emit: vi.fn(), execute: async () => { events.push('unsafe'); } });
        await flush();
        expect(events).toEqual(['first']);
        held.settle();
        await Promise.all([first, second]);
        expect(events).toEqual(['first', 'unsafe']);
    });

    it.each([{ marketType: 'spot' }, { accountId: 'other' }, { symbol: 'ETHUSDT' }])('isolates alias scopes: %j', async scope => {
        const registry = createTradingCommandRegistry();
        observe(registry);
        observe(registry, 42, 'original-42', scope);
        const held = deferred();
        const events = [];
        const first = registry.submit(target({ orderId: 42 }, 'first'), { emit: vi.fn(), execute: async () => { events.push('first'); await held.promise; } });
        const second = registry.submit({ ...target({ origClientOrderId: 'original-42' }, 'second'), ...scope }, { emit: vi.fn(), execute: async () => { events.push('second'); } });
        await flush();
        expect(events).toEqual(['first', 'second']);
        held.settle();
        await Promise.all([first, second]);
    });

    it('retains active aliases across expiry and capacity pressure, then releases memory safely', async () => {
        let clock = 100;
        const registry = createTradingCommandRegistry({ now: () => clock, aliasMaxAgeMs: 10, maxAliasEntries: 4 });
        observe(registry);
        const held = deferred();
        const events = [];
        const first = registry.submit(target({ orderId: 42 }, 'first'), { emit: vi.fn(), execute: async () => { events.push('first'); await held.promise; } });
        await flush();
        clock += 100;
        for (let id = 100; id < 120; id++) observe(registry, id, `other-${id}`);
        expect(registry.aliasCount()).toBeLessThanOrEqual(4);
        const second = registry.submit(target({ origClientOrderId: 'original-42' }, 'second'), { emit: vi.fn(), execute: async () => { events.push('second'); } });
        await flush();
        expect(events).toEqual(['first']);
        held.settle();
        await Promise.all([first, second]);
        await flush();
        clock += 100;
        await registry.submit(target({ orderId: 999 }, 'third'), { emit: vi.fn(), execute: async () => {} });
        expect(registry.aliasCount()).toBe(0);
        expect(registry.laneCount()).toBe(0);
    });

    it('keeps unknown aliases conservative when all retained capacity is active', async () => {
        const registry = createTradingCommandRegistry({ maxAliasEntries: 2 });
        observe(registry);
        const held = deferred();
        const first = registry.submit(target({ orderId: 42 }, 'first'), { emit: vi.fn(), execute: async () => held.promise });
        await flush();
        expect(observe(registry, 99, 'new')).toBe(false);
        expect(registry.aliasCount()).toBe(2);
        const run = vi.fn(async () => {});
        const second = registry.submit(target({ origClientOrderId: 'new' }, 'second'), { emit: vi.fn(), execute: run });
        await flush();
        expect(run).not.toHaveBeenCalled();
        held.settle();
        await Promise.all([first, second]);
        expect(run).toHaveBeenCalledOnce();
    });

    it('learns snapshots/private identity without recording it as another command outcome', async () => {
        const registry = createTradingCommandRegistry();
        await registry.submit(command(), { emit: vi.fn(), execute: async () => {
            registry.observeEnvelope({ type: 'futures_account_state', resources: { regularOrders: { data: [{ symbol: 'BTCUSDT', orderId: 42, clientOrderId: 'existing' }] } } });
            registry.observeEnvelope({ execution_update: { s: 'BTCUSDT', i: 43, C: 'spot-existing', c: 'cancel-client' } });
            registry.observeEnvelope({ futures_execution_update: { symbol: 'BTCUSDT', orderId: 44, clientOrderId: 'algo', orderKind: 'ALGO' } });
            registry.recordOutcome({ command_rejected: { code: 'OWN' } });
        } });
        const replay = vi.fn();
        await registry.submit(command(), { emit: replay, execute: async () => { throw new Error('duplicate'); } });
        expect(replay.mock.calls).toEqual([[{ command_rejected: { code: 'OWN' } }]]);
        expect(registry.aliasCount()).toBe(4);
    });
});
