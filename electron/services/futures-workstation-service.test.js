import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createFuturesTestnetWorkstationRuntime,
    createFuturesTestnetWorkstationRuntimeForTest,
} from './futures-testnet-workstation-composition.js';
import {
    createFuturesProductionWorkstationRuntime,
} from './futures-production-workstation-composition.js';
import {
    createFuturesTestnetWorkstationFakeTransport,
} from './futures-testnet-workstation-fake-transport.js';
import {
    FUTURES_TESTNET_WORKSTATION_FIXTURE,
} from './futures-testnet-workstation-fixtures.js';
import {
    createFuturesTestnetWorkstationSubscribeRequest,
    createFuturesTestnetWorkstationUnsubscribeRequest,
} from '../../src/utils/futuresTestnetWorkstationProtocol.js';
import {
    createFuturesProductionWorkstationSubscribeRequest,
} from '../../src/utils/futuresProductionWorkstationProtocol.js';

const runtimes = [];

afterEach(() => {
    while (runtimes.length) runtimes.pop().close();
    vi.restoreAllMocks();
});

const testnetRequest = (requestId, symbol = 'BTCUSDT', interval = '1m') => JSON.stringify(
    createFuturesTestnetWorkstationSubscribeRequest({ requestId, symbol, interval }),
);

const productionRequest = (requestId, symbol = 'BTCUSDT', interval = '1m') => JSON.stringify(
    createFuturesProductionWorkstationSubscribeRequest({ requestId, symbol, interval }),
);

const track = runtime => {
    runtimes.push(runtime);
    return runtime;
};

const createManualClock = (initial = 1_784_000_001_000) => {
    let now = initial;
    let sequence = 0;
    const intervals = new Map();
    const timeouts = new Map();
    return {
        clock: {
            now: () => now,
            setInterval: (callback) => {
                sequence += 1;
                intervals.set(sequence, callback);
                return sequence;
            },
            clearInterval: handle => intervals.delete(handle),
            setTimeout: (callback) => {
                sequence += 1;
                timeouts.set(sequence, callback);
                return sequence;
            },
            clearTimeout: handle => timeouts.delete(handle),
        },
        setNow: value => { now = value; },
        advance: milliseconds => { now += milliseconds; },
        runIntervals: () => [...intervals.values()].forEach(callback => callback()),
        runTimeouts: () => {
            const callbacks = [...timeouts.values()];
            timeouts.clear();
            callbacks.forEach(callback => callback());
        },
        intervalCount: () => intervals.size,
        timeoutCount: () => timeouts.size,
    };
};

describe('separately composed Futures workstation services', () => {
    it('boots Testnet through catalog, snapshot, overlays, depth and tape before LIVE', async () => {
        const runtime = track(createFuturesTestnetWorkstationRuntime());
        const events = [];
        await runtime.service.handleRequest(testnetRequest('service-testnet-1'), {
            emit: event => events.push(event),
        });

        expect(runtime.mode).toBe('deterministic-fake');
        expect(events.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['loading', 'live']);
        expect([...new Set(events.map(event => event.resource))]).toEqual([
            'status', 'catalog', 'header', 'candles', 'depth', 'trades',
        ]);
        expect(events.filter(event => event.resource === 'candles').map(event => event.payload.series))
            .toEqual(['contract', 'mark', 'index']);
        expect(events.find(event => event.resource === 'depth').payload.lastUpdateId).toBe('1001');
        expect(events.every((event, index) => event.revision === index + 1)).toBe(true);
    });

    it('boots production on a distinct channel, environment and deterministic fixture', async () => {
        const runtime = track(createFuturesProductionWorkstationRuntime());
        const events = [];
        await runtime.service.handleRequest(productionRequest('service-production-1'), {
            emit: event => events.push(event),
        });
        const header = events.find(event => event.resource === 'header');
        expect(runtime.mode).toBe('deterministic-fake');
        expect(header.environment).toBe('PRODUCTION');
        expect(header.channelId).toBe('futures-production-workstation');
        expect(header.payload.lastPrice).toBe('58445.00');
        expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
    });

    it('never invokes global fetch in either default composition', async () => {
        const originalFetch = globalThis.fetch;
        const escapedFetch = vi.fn(() => Promise.reject(new Error('network escape')));
        globalThis.fetch = escapedFetch;
        try {
            const blue = track(createFuturesTestnetWorkstationRuntime());
            const red = track(createFuturesProductionWorkstationRuntime());
            await blue.service.handleRequest(testnetRequest('no-network-blue'), { emit: () => {} });
            await red.service.handleRequest(productionRequest('no-network-red'), { emit: () => {} });
            expect(escapedFetch).not.toHaveBeenCalled();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it.each([
        ['ETHUSDT', '5m'],
        ['SOLUSDT', '4h'],
    ])('switches to %s/%s with a new backend generation', async (symbol, interval) => {
        const runtime = track(createFuturesTestnetWorkstationRuntime());
        const events = [];
        await runtime.service.handleRequest(testnetRequest('switch-first'), {
            emit: event => events.push(event),
        });
        await runtime.service.handleRequest(testnetRequest('switch-next', symbol, interval), {
            emit: event => events.push(event),
        });
        const switched = events.filter(event => event.requestId === 'switch-next');
        expect(switched[0].generation).toBe(2);
        expect(switched.every(event => event.symbol === symbol)).toBe(true);
        expect(switched.at(-1).state).toBe('live');
        expect(switched.filter(event => event.resource === 'candles'))
            .toHaveLength(3);
    });

    it('drops a late bootstrap from the prior symbol generation', async () => {
        const base = createFuturesTestnetWorkstationFakeTransport();
        const deferred = new Map();
        const transport = {
            ...base,
            bootstrap: ({ symbol }) => new Promise(resolve => deferred.set(symbol, resolve)),
        };
        const runtime = track(createFuturesTestnetWorkstationRuntimeForTest({ transport }));
        const oldEvents = [];
        const newEvents = [];
        const first = runtime.service.handleRequest(testnetRequest('late-old', 'BTCUSDT'), {
            emit: event => oldEvents.push(event),
        });
        await vi.waitFor(() => expect(deferred.has('BTCUSDT')).toBe(true));
        const second = runtime.service.handleRequest(testnetRequest('late-new', 'ETHUSDT'), {
            emit: event => newEvents.push(event),
        });
        await vi.waitFor(() => expect(deferred.has('ETHUSDT')).toBe(true));
        deferred.get('ETHUSDT')({
            depthSnapshot: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.ETHUSDT.depthSnapshot,
            contractKlines: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.ETHUSDT.contractKlines,
            markKlines: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.ETHUSDT.markKlines,
            indexKlines: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.ETHUSDT.indexKlines,
            premiumIndex: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.ETHUSDT.premiumIndex,
            ticker: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.ETHUSDT.ticker,
        });
        await second;
        deferred.get('BTCUSDT')({
            depthSnapshot: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.BTCUSDT.depthSnapshot,
            contractKlines: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.BTCUSDT.contractKlines,
            markKlines: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.BTCUSDT.markKlines,
            indexKlines: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.BTCUSDT.indexKlines,
            premiumIndex: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.BTCUSDT.premiumIndex,
            ticker: FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.BTCUSDT.ticker,
        });
        await first;
        expect(oldEvents.some(event => event.resource === 'status' && event.state === 'live')).toBe(false);
        expect(oldEvents.some(event => ['header', 'depth', 'trades'].includes(event.resource))).toBe(false);
        expect(newEvents.at(-1)).toMatchObject({ symbol: 'ETHUSDT', state: 'live' });
    });

    it('detects a live depth gap and enters resynchronizing before rebuilding', async () => {
        const base = createFuturesTestnetWorkstationFakeTransport();
        let subscriber;
        const transport = {
            ...base,
            connect: (options) => {
                subscriber = options;
                return base.connect(options);
            },
        };
        const clock = createManualClock();
        const runtime = track(createFuturesTestnetWorkstationRuntimeForTest({
            transport,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(testnetRequest('depth-gap'), {
            emit: event => events.push(event),
        });
        subscriber.onMessage(FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(2)[0]);
        expect(events.at(-1)).toMatchObject({
            resource: 'status',
            state: 'resynchronizing',
            payload: { connected: false, reasonCode: 'DEPTH_SEQUENCE_GAP' },
        });
        expect(clock.timeoutCount()).toBe(1);
    });

    it('ignores a duplicate depth update without revising visible state', async () => {
        const base = createFuturesTestnetWorkstationFakeTransport();
        let subscriber;
        const transport = {
            ...base,
            connect: (options) => {
                subscriber = options;
                return base.connect(options);
            },
        };
        const runtime = track(createFuturesTestnetWorkstationRuntimeForTest({ transport }));
        const events = [];
        await runtime.service.handleRequest(testnetRequest('depth-duplicate'), {
            emit: event => events.push(event),
        });
        const count = events.length;
        subscriber.onMessage(FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.bridgeDepth);
        expect(events).toHaveLength(count);
    });

    it('treats malformed stream data as uncertain and schedules resync', async () => {
        const base = createFuturesTestnetWorkstationFakeTransport();
        let subscriber;
        const transport = {
            ...base,
            connect: (options) => {
                subscriber = options;
                return base.connect(options);
            },
        };
        const clock = createManualClock();
        const failures = [];
        const runtime = track(createFuturesTestnetWorkstationRuntimeForTest({
            transport,
            clock: clock.clock,
            onInternalError: failure => failures.push(failure),
        }));
        const events = [];
        await runtime.service.handleRequest(testnetRequest('malformed-frame'), {
            emit: event => events.push(event),
        });
        subscriber.onMessage('{"stream":"btcusdt@aggTrade","data":');
        expect(failures.at(-1).phase).toBe('stream');
        expect(events.at(-1)).toMatchObject({ state: 'resynchronizing' });
    });

    it('bounds non-depth events during bootstrap and resynchronizes on overflow', async () => {
        const base = createFuturesTestnetWorkstationFakeTransport();
        const trade = FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(1)[1];
        const transport = {
            ...base,
            connect: (options) => {
                options.onMessage(FUTURES_TESTNET_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.bridgeDepth);
                for (let index = 0; index < 129; index += 1) {
                    options.onMessage(trade.replace(/"a":\d+/, `"a":${1000 + index}`));
                }
                return { close: () => {} };
            },
        };
        const clock = createManualClock();
        const runtime = track(createFuturesTestnetWorkstationRuntimeForTest({
            transport,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(testnetRequest('queue-overflow'), {
            emit: event => events.push(event),
        });
        expect(events.at(-1)).toMatchObject({
            state: 'resynchronizing',
            payload: { reasonCode: 'STREAM_QUEUE_OVERFLOW' },
        });
        expect(clock.timeoutCount()).toBe(1);
    });

    it('marks individual resources stale on deterministic freshness deadlines', async () => {
        const base = createFuturesTestnetWorkstationFakeTransport();
        const clock = createManualClock();
        const runtime = track(createFuturesTestnetWorkstationRuntimeForTest({
            transport: base,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(testnetRequest('stale-resources'), {
            emit: event => events.push(event),
        });
        clock.advance(6_001);
        clock.runIntervals();
        const stale = events.filter(event => event.state === 'stale').map(event => event.resource);
        expect(stale).toEqual(expect.arrayContaining(['header', 'candles', 'depth', 'trades']));
    });

    it('detects clock regression and emits a monotonic resynchronizing revision', async () => {
        const base = createFuturesTestnetWorkstationFakeTransport();
        const clock = createManualClock();
        const runtime = track(createFuturesTestnetWorkstationRuntimeForTest({
            transport: base,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(testnetRequest('clock-regression'), {
            emit: event => events.push(event),
        });
        const lastObserved = events.at(-1).observedAt;
        clock.setNow(lastObserved - 1);
        clock.runIntervals();
        expect(events.at(-1)).toMatchObject({
            state: 'resynchronizing',
            payload: { reasonCode: 'CLOCK_REGRESSION' },
            observedAt: lastObserved,
        });
    });

    it('tears down timers and rejects late events after unsubscribe', async () => {
        const base = createFuturesTestnetWorkstationFakeTransport();
        const clock = createManualClock();
        const runtime = track(createFuturesTestnetWorkstationRuntimeForTest({
            transport: base,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(testnetRequest('unsubscribe-owner'), {
            emit: event => events.push(event),
        });
        expect(clock.intervalCount()).toBe(1);
        await runtime.service.handleRequest(JSON.stringify(
            createFuturesTestnetWorkstationUnsubscribeRequest({ requestId: 'unsubscribe-owner' }),
        ), { emit: event => events.push(event) });
        const count = events.length;
        expect(clock.intervalCount()).toBe(0);
        clock.advance(60_000);
        clock.runIntervals();
        clock.runTimeouts();
        expect(events).toHaveLength(count);
        expect(base.getActiveTimerCount()).toBe(0);
    });

    it('never emits credential, signature, private response or write fields', async () => {
        const blue = track(createFuturesTestnetWorkstationRuntime());
        const red = track(createFuturesProductionWorkstationRuntime());
        const events = [];
        await blue.service.handleRequest(testnetRequest('secret-scan-blue'), {
            emit: event => events.push(event),
        });
        await red.service.handleRequest(productionRequest('secret-scan-red'), {
            emit: event => events.push(event),
        });
        const serialized = JSON.stringify(events);
        expect(serialized).not.toMatch(/apiKey|apiSecret|signature|listenKey|authorization|credential/i);
        expect(serialized).not.toMatch(/placeOrder|cancelOrder|quantityDraft|executionIntent/i);
    });
});
