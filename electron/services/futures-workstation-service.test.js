import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createFuturesProductionWorkstationRuntime,
    createFuturesProductionWorkstationRuntimeForTest,
} from './futures-production-workstation-composition.js';
import {
    createFuturesProductionWorkstationFakeTransport,
} from './futures-production-workstation-fake-transport.js';
import {
    FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
} from './futures-production-workstation-fixtures.js';
import {
    createFuturesProductionWorkstationSubscribeRequest,
    createFuturesProductionWorkstationUnsubscribeRequest,
} from '../../src/utils/futuresProductionWorkstationProtocol.js';

const runtimes = [];

afterEach(() => {
    while (runtimes.length) runtimes.pop().close();
    vi.restoreAllMocks();
});

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

describe('production Futures workstation service', () => {
    it('boots production through catalog, streams, snapshot and widgets before LIVE', async () => {
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

    it('reports a bounded aggregate-ready duration without exposing market payloads', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport();
        const timings = [];
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            onTiming: timing => timings.push(timing),
            transport: {
                ...base,
                loadExchangeInfo: async (options) => {
                    manual.advance(20);
                    return base.loadExchangeInfo(options);
                },
                bootstrap: async (options) => {
                    manual.advance(30);
                    return base.bootstrap(options);
                },
            },
        }));

        await runtime.service.handleRequest(productionRequest('aggregate-timing'), {
            emit: () => {},
        });

        expect(timings).toEqual([{
            phase: 'aggregate-ready',
            durationMs: 50,
            outcome: 'ok',
            cache: null,
        }]);
        expect(JSON.stringify(timings)).not.toMatch(/BTCUSDT|price|payload|url|credential/i);
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
        ],
    ])('waits for both %s stream handshakes before dispatching REST bootstrap', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const base = createBase();
        let resolveReady;
        const ready = new Promise(resolve => { resolveReady = resolve; });
        const bootstrap = vi.fn(options => base.bootstrap(options));
        const transport = {
            ...base,
            bootstrap,
            connect: (options) => {
                const handle = base.connect(options);
                return { ready, close: handle.close };
            },
        };
        const runtime = track(createRuntime({ transport }));
        const events = [];
        const pending = runtime.service.handleRequest(createRequest('stream-ready-barrier'), {
            emit: event => events.push(event),
        });
        await vi.waitFor(() => expect(resolveReady).toBeTypeOf('function'));
        expect(bootstrap).not.toHaveBeenCalled();
        expect(events.at(-1)).toMatchObject({ resource: 'catalog', state: 'live' });
        resolveReady(true);
        await pending;
        expect(bootstrap).toHaveBeenCalledOnce();
        expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
        ],
    ])('does not strand %s in LOADING when an active bootstrap raises AbortError', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const base = createBase();
        const transport = {
            ...base,
            bootstrap: async () => {
                const error = new Error('request deadline');
                error.name = 'AbortError';
                throw error;
            },
        };
        const runtime = track(createRuntime({ transport }));
        const events = [];
        await runtime.service.handleRequest(createRequest('active-abort-error'), {
            emit: event => events.push(event),
        });
        expect(events.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['loading', 'resynchronizing']);
        expect(events.at(-1)).toMatchObject({
            resource: 'status',
            state: 'resynchronizing',
            payload: { reasonCode: 'WORKSTATION_RESOURCE_REJECTED' },
        });
        expect(runtime.service.current).not.toBeNull();
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
        ],
    ])('boots %s with a catalog above the legacy 512-contract limit', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        const seed = source.symbols[0];
        source.symbols = [
            seed,
            ...Array.from({ length: 599 }, (_, index) => {
                const baseAsset = `A${String(index + 1).padStart(4, '0')}`;
                return {
                    ...seed,
                    symbol: `${baseAsset}USDT`,
                    pair: `${baseAsset}USDT`,
                    baseAsset,
                };
            }),
        ];
        const base = createBase();
        const runtime = track(createRuntime({
            transport: {
                ...base,
                loadExchangeInfo: async () => JSON.stringify(source),
            },
        }));
        const events = [];
        await runtime.service.handleRequest(createRequest('large-catalog'), {
            emit: event => events.push(event),
        });
        const catalogFrames = events.filter(event => event.resource === 'catalog');
        expect(catalogFrames).toHaveLength(75);
        expect(catalogFrames.at(-1).payload).toMatchObject({ total: 600, complete: true });
        expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
        ],
    ])('boots %s with the current catalog schema and no per-symbol algo limit', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const source = JSON.parse(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        for (const symbol of source.symbols) {
            symbol.maxMoveOrderLimit = 1_000;
            symbol.filters = symbol.filters.filter(
                filter => filter.filterType !== 'MAX_NUM_ALGO_ORDERS',
            );
            symbol.filters.find(
                filter => filter.filterType === 'PERCENT_PRICE',
            ).multiplierDecimal = '4';
            symbol.filters.push({
                filterType: 'POSITION_RISK_CONTROL',
                positionControlSide: 'NONE',
            });
        }
        source.symbols[0].filters.find(
            filter => filter.filterType === 'MAX_NUM_ORDERS',
        ).limit = 0;
        source.symbols.push({
            ...source.symbols[0],
            symbol: '测试测试USDT',
            pair: '测试测试USDT',
            baseAsset: '测试测试',
        });
        const base = createBase();
        const runtime = track(createRuntime({
            transport: {
                ...base,
                loadExchangeInfo: async () => JSON.stringify(source),
            },
        }));
        const events = [];

        await runtime.service.handleRequest(createRequest('current-catalog'), {
            emit: event => events.push(event),
        });

        const catalog = events.find(event => event.resource === 'catalog');
        expect(catalog.payload).toMatchObject({ total: 3, complete: true });
        expect(catalog.payload.contracts[0].filters.maximumOrders).toBe(0);
        expect(catalog.payload.contracts[0].filters.maximumAlgoOrders).toBeNull();
        expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
        ],
    ])('keeps the %s deterministic stream LIVE across continuous depth cycles', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const clock = createManualClock();
        const base = createBase({ clock: clock.clock });
        const runtime = track(createRuntime({ transport: base, clock: clock.clock }));
        const events = [];
        await runtime.service.handleRequest(createRequest('continuous-depth'), {
            emit: event => events.push(event),
        });

        for (let cycle = 0; cycle < 64; cycle += 1) {
            clock.advance(750);
            clock.runIntervals();
        }

        expect(events.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['loading', 'live']);
        expect(events.filter(event => event.resource === 'depth').at(-1).payload.lastUpdateId)
            .toBe('1065');
        expect(runtime.service.current.generation).toBe(1);
        expect(clock.timeoutCount()).toBe(0);
    });

    it('never invokes global fetch in the deterministic production composition', async () => {
        const originalFetch = globalThis.fetch;
        const escapedFetch = vi.fn(() => Promise.reject(new Error('network escape')));
        globalThis.fetch = escapedFetch;
        try {
            const red = track(createFuturesProductionWorkstationRuntime());
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
        const runtime = track(createFuturesProductionWorkstationRuntime());
        const events = [];
        await runtime.service.handleRequest(productionRequest('switch-first'), {
            emit: event => events.push(event),
        });
        await runtime.service.handleRequest(productionRequest('switch-next', symbol, interval), {
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
        const base = createFuturesProductionWorkstationFakeTransport();
        const deferred = new Map();
        const transport = {
            ...base,
            bootstrap: ({ symbol }) => new Promise(resolve => deferred.set(symbol, resolve)),
        };
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({ transport }));
        const oldEvents = [];
        const newEvents = [];
        const first = runtime.service.handleRequest(productionRequest('late-old', 'BTCUSDT'), {
            emit: event => oldEvents.push(event),
        });
        await vi.waitFor(() => expect(deferred.has('BTCUSDT')).toBe(true));
        const second = runtime.service.handleRequest(productionRequest('late-new', 'ETHUSDT'), {
            emit: event => newEvents.push(event),
        });
        await vi.waitFor(() => expect(deferred.has('ETHUSDT')).toBe(true));
        deferred.get('ETHUSDT')({
            depthSnapshot: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.depthSnapshot,
            contractKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.contractKlines,
            markKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.markKlines,
            indexKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.indexKlines,
            premiumIndex: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.premiumIndex,
            ticker: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.ticker,
        });
        await second;
        deferred.get('BTCUSDT')({
            depthSnapshot: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.depthSnapshot,
            contractKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.contractKlines,
            markKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.markKlines,
            indexKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.indexKlines,
            premiumIndex: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.premiumIndex,
            ticker: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.ticker,
        });
        await first;
        expect(oldEvents.some(event => event.resource === 'status' && event.state === 'live')).toBe(false);
        expect(oldEvents.some(event => ['header', 'depth', 'trades'].includes(event.resource))).toBe(false);
        expect(newEvents.at(-1)).toMatchObject({ symbol: 'ETHUSDT', state: 'live' });
    });

    it('detects a live depth gap and enters resynchronizing before rebuilding', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        let subscriber;
        const transport = {
            ...base,
            connect: (options) => {
                subscriber = options;
                return base.connect(options);
            },
        };
        const clock = createManualClock();
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('depth-gap'), {
            emit: event => events.push(event),
        });
        subscriber.onMessage(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(2)[0]);
        expect(events.at(-1)).toMatchObject({
            resource: 'status',
            state: 'resynchronizing',
            payload: { connected: false, reasonCode: 'DEPTH_SEQUENCE_GAP' },
        });
        expect(clock.timeoutCount()).toBe(1);
    });

    it('ignores a duplicate depth update without revising visible state', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        let subscriber;
        const transport = {
            ...base,
            connect: (options) => {
                subscriber = options;
                return base.connect(options);
            },
        };
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({ transport }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('depth-duplicate'), {
            emit: event => events.push(event),
        });
        const count = events.length;
        subscriber.onMessage(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.bridgeDepth);
        expect(events).toHaveLength(count);
    });

    it('treats malformed stream data as uncertain and schedules resync', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
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
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport,
            clock: clock.clock,
            onInternalError: failure => failures.push(failure),
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('malformed-frame'), {
            emit: event => events.push(event),
        });
        subscriber.onMessage('{"stream":"btcusdt@aggTrade","data":');
        expect(failures.at(-1).phase).toBe('stream');
        expect(events.at(-1)).toMatchObject({ state: 'resynchronizing' });
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
        ],
    ])('bounds a pre-bootstrap %s trade burst by evicting old tape rows without resync', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
        fixture,
    ) => {
        const base = createBase();
        const trade = fixture.symbols.BTCUSDT.streams.makeCycle(1)[1];
        const transport = {
            ...base,
            connect: (options) => {
                options.onMessage(fixture.symbols.BTCUSDT.streams.bridgeDepth);
                for (let index = 0; index < 129; index += 1) {
                    options.onMessage(trade.replace(/"a":\d+/, `"a":${1000 + index}`));
                }
                return { ready: Promise.resolve(true), close: () => {} };
            },
        };
        const clock = createManualClock();
        const runtime = track(createRuntime({
            transport,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(createRequest('bounded-trade-burst'), {
            emit: event => events.push(event),
        });
        expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
        expect(events.some(event => event.state === 'resynchronizing')).toBe(false);
        expect(clock.timeoutCount()).toBe(0);
        expect(runtime.service.current.pendingEvents).toHaveLength(0);
        expect(runtime.service.current.trades).toHaveLength(128);
        const tape = events.filter(event => event.resource === 'trades').at(-1).payload.rows;
        expect(tape).toHaveLength(32);
        expect(tape[0].aggregateTradeId).toBe('1128');
        expect(tape.some(row => row.aggregateTradeId === '1000')).toBe(false);
    });

    it('marks individual resources stale on deterministic freshness deadlines', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const clock = createManualClock();
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: base,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('stale-resources'), {
            emit: event => events.push(event),
        });
        clock.advance(6_001);
        clock.runIntervals();
        const stale = events.filter(event => event.state === 'stale').map(event => event.resource);
        expect(stale).toEqual(expect.arrayContaining(['header', 'candles', 'depth', 'trades']));
    });

    it('detects clock regression and emits a monotonic resynchronizing revision', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const clock = createManualClock();
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: base,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('clock-regression'), {
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
        const base = createFuturesProductionWorkstationFakeTransport();
        const clock = createManualClock();
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: base,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('unsubscribe-owner'), {
            emit: event => events.push(event),
        });
        expect(clock.intervalCount()).toBe(1);
        await runtime.service.handleRequest(JSON.stringify(
            createFuturesProductionWorkstationUnsubscribeRequest({ requestId: 'unsubscribe-owner' }),
        ), { emit: event => events.push(event) });
        const count = events.length;
        expect(clock.intervalCount()).toBe(0);
        clock.advance(60_000);
        clock.runIntervals();
        clock.runTimeouts();
        expect(events).toHaveLength(count);
        expect(base.getActiveTimerCount()).toBe(0);
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
        ],
    ])('closes the failed %s stream and schedules an automatic bootstrap recovery', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const clock = createManualClock();
        const base = createBase({ clock: clock.clock });
        const close = vi.fn();
        const transport = {
            ...base,
            connect: (options) => {
                const handle = base.connect(options);
                return {
                    ready: handle.ready,
                    close: () => {
                        close();
                        handle.close();
                    },
                };
            },
            bootstrap: async (options) => ({
                ...await base.bootstrap(options),
                premiumIndex: '{}',
            }),
        };
        const runtime = track(createRuntime({ transport, clock: clock.clock }));
        const events = [];
        await runtime.service.handleRequest(createRequest('terminal-bootstrap'), {
            emit: event => events.push(event),
        });
        expect(events.at(-1)).toMatchObject({
            resource: 'status',
            state: 'resynchronizing',
            payload: { reasonCode: 'INVALID_PREMIUM_INDEX' },
        });
        expect(close).toHaveBeenCalledOnce();
        expect(runtime.service.current).not.toBeNull();
        expect(clock.intervalCount()).toBe(0);
        expect(clock.timeoutCount()).toBe(1);
        expect(base.getActiveTimerCount()).toBe(0);
    });

    it('recovers automatically after a transient production bootstrap error', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        let bootstrapAttempts = 0;
        const transport = {
            ...base,
            bootstrap: async (options) => {
                bootstrapAttempts += 1;
                if (bootstrapAttempts === 1) throw new Error('temporary bootstrap failure');
                return base.bootstrap(options);
            },
        };
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport,
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('automatic-bootstrap-recovery'), {
            emit: event => events.push(event),
        });
        expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'resynchronizing' });
        expect(clock.timeoutCount()).toBe(1);

        clock.runTimeouts();
        await vi.waitFor(() => {
            expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
        });
        expect(bootstrapAttempts).toBe(2);
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
        ],
    ])('halts the %s session when reconnect attempts are exhausted', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const clock = createManualClock();
        const base = createBase({ clock: clock.clock });
        const close = vi.fn();
        let subscriber;
        const transport = {
            ...base,
            connect: (options) => {
                subscriber = options;
                const handle = base.connect(options);
                return {
                    ready: handle.ready,
                    close: () => {
                        close();
                        handle.close();
                    },
                };
            },
        };
        const runtime = track(createRuntime({ transport, clock: clock.clock }));
        const events = [];
        await runtime.service.handleRequest(createRequest('terminal-reconnect'), {
            emit: event => events.push(event),
        });
        runtime.service.current.reconnectAttempt = Number.MAX_SAFE_INTEGER;
        subscriber.onDisconnect('SOCKET_DISCONNECTED');
        expect(events.at(-1)).toMatchObject({
            resource: 'status',
            state: 'unavailable',
            payload: { reasonCode: 'RECONNECT_EXHAUSTED' },
        });
        expect(close).toHaveBeenCalledOnce();
        expect(runtime.service.current).toBeNull();
        expect(clock.intervalCount()).toBe(0);
        expect(base.getActiveTimerCount()).toBe(0);
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            createFuturesProductionWorkstationSubscribeRequest,
        ],
    ])('resets the %s reconnect counter after an authoritative rebuild', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const base = createBase();
        const runtime = track(createRuntime({ transport: base }));
        await runtime.service.startGeneration(createRequest({
            requestId: 'reconnect-counter-reset',
            symbol: 'BTCUSDT',
            interval: '1m',
        }), () => {}, 7);
        expect(runtime.service.current.reconnectAttempt).toBe(0);
    });

    it('never emits credential, signature, private response or write fields', async () => {
        const red = track(createFuturesProductionWorkstationRuntime());
        const events = [];
        await red.service.handleRequest(productionRequest('secret-scan-red'), {
            emit: event => events.push(event),
        });
        const serialized = JSON.stringify(events);
        expect(serialized).not.toMatch(/apiKey|apiSecret|signature|listenKey|authorization|credential/i);
        expect(serialized).not.toMatch(/placeOrder|cancelOrder|quantityDraft|executionIntent/i);
    });
});
