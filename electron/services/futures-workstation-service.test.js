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
    createFuturesProductionWorkstationConfigureDepthRequest,
    createFuturesProductionWorkstationConfigureTapeRequest,
    createFuturesProductionWorkstationLoadCandleHistoryRequest,
    createFuturesProductionWorkstationSelectIntervalRequest,
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

const productionIntervalRequest = (requestId, symbol, interval) => JSON.stringify(
    createFuturesProductionWorkstationSelectIntervalRequest({ requestId, symbol, interval }),
);

const productionCandleHistoryRequest = (requestId, overrides = {}) => JSON.stringify(
    createFuturesProductionWorkstationLoadCandleHistoryRequest({
        requestId,
        symbol: 'BTCUSDT',
        interval: '1m',
        endTime: 1_784_000_000_000,
        limit: 1_000,
        ...overrides,
    }),
);

const productionTapeRequest = (requestId, overrides = {}) => JSON.stringify(
    createFuturesProductionWorkstationConfigureTapeRequest({
        requestId,
        throttleEnabled: true,
        timeoutMs: 250,
        minNotionalUsdt: '0',
        ...overrides,
    }),
);

const productionDepthRequest = (requestId, range) => JSON.stringify(
    createFuturesProductionWorkstationConfigureDepthRequest({ requestId, range }),
);

const productionTradeFrame = ({
    cycle = 1,
    aggregateTradeId,
    price,
    quantity,
} = {}) => {
    const frame = JSON.parse(
        FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(cycle)[1],
    );
    if (aggregateTradeId !== undefined) {
        frame.data.a = aggregateTradeId;
        frame.data.f = aggregateTradeId;
        frame.data.l = aggregateTradeId;
    }
    if (price !== undefined) frame.data.p = price;
    if (quantity !== undefined) {
        frame.data.q = quantity;
        frame.data.nq = quantity;
    }
    return JSON.stringify(frame);
};

// The frame a spike actually sends: the cycle's own depth diff, in sequence,
// restating a full ladder on both sides instead of a level each. A sweep that
// lifts the book with the makers re-posting behind it is exactly this shape.
const burstDepthFrame = (cycle, levelsPerSide) => {
    const frame = JSON.parse(
        FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(cycle)[0],
    );
    const price = cents => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
    const topBid = Math.round(Number(frame.data.b[0][0]) * 100);
    const topAsk = Math.round(Number(frame.data.a[0][0]) * 100);
    frame.data.b = Array.from({ length: levelsPerSide }, (_, index) => [
        price(topBid - (index * 10)),
        `${1 + ((cycle + index) % 9)}.00000000`,
    ]);
    frame.data.a = Array.from({ length: levelsPerSide }, (_, index) => [
        price(topAsk + (index * 10)),
        `${1 + ((cycle + index) % 7)}.00000000`,
    ]);
    return JSON.stringify(frame);
};

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
                bootstrapIndependent: async (options) => {
                    manual.advance(30);
                    return base.bootstrapIndependent(options);
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
    ])('starts %s independent reads before the handshake but holds depth until ready', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const base = createBase();
        let resolveReady;
        const ready = new Promise(resolve => { resolveReady = resolve; });
        const bootstrapIndependent = vi.fn(options => base.bootstrapIndependent(options));
        const readDepthSnapshot = vi.fn(options => base.readDepthSnapshot(options));
        const transport = {
            ...base,
            bootstrapIndependent,
            readDepthSnapshot,
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
        await vi.waitFor(() => expect(bootstrapIndependent).toHaveBeenCalledOnce());
        expect(readDepthSnapshot).not.toHaveBeenCalled();
        resolveReady(true);
        await pending;
        expect(readDepthSnapshot).toHaveBeenCalledOnce();
        expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
    });

    it('publishes ready bootstrap groups without crossing header, depth or aggregate barriers', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const fixture = FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT;
        let bootstrapOptions;
        let resolveBootstrap;
        const transport = {
            ...base,
            bootstrapIndependent: options => new Promise((resolve) => {
                bootstrapOptions = options;
                resolveBootstrap = resolve;
            }),
        };
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({ transport }));
        const events = [];
        const pending = runtime.service.handleRequest(productionRequest('progressive-bootstrap'), {
            emit: event => events.push(event),
        });
        await vi.waitFor(() => expect(bootstrapOptions).toBeTruthy());
        const deliver = resource => bootstrapOptions.onBootstrapResource(Object.freeze({
            resource,
            value: fixture[resource],
        }));

        deliver('contractKlines');
        expect(events.filter(event => event.resource === 'candles')).toHaveLength(1);
        expect(events.at(-1)).toMatchObject({
            resource: 'candles',
            state: 'live',
            payload: { series: 'contract' },
        });
        expect(events.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['loading']);

        deliver('premiumIndex');
        expect(events.some(event => event.resource === 'header')).toBe(false);
        deliver('ticker');
        expect(events.filter(event => event.resource === 'header')).toHaveLength(1);

        expect(events.some(event => event.resource === 'depth')).toBe(false);
        deliver('indexKlines');
        expect(events.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['loading']);

        resolveBootstrap(Object.freeze({
            contractKlines: fixture.contractKlines,
            indexKlines: fixture.indexKlines,
            premiumIndex: fixture.premiumIndex,
            ticker: fixture.ticker,
        }));
        await pending;

        expect(events.filter(event => event.resource === 'candles')
            .map(event => event.payload.series).sort()).toEqual(['contract', 'index']);
        expect(events.filter(event => event.resource === 'header')).toHaveLength(1);
        expect(events.filter(event => event.resource === 'depth')).toHaveLength(1);
        expect(events.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['loading', 'live']);
    });

    // `<symbol>@depth@100ms` publishes only when a level changes, so a contract
    // nobody is trading delivers nothing to bridge the snapshot with, and never
    // will. Requiring one read the same snapshot four times a cycle, showed an
    // empty book, and resynchronized the workspace until it gave up.
    it('opens the book of a contract too quiet to publish a diff', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const readDepthSnapshot = vi.fn(options => base.readDepthSnapshot(options));
        const close = vi.fn();
        const transport = {
            ...base,
            readDepthSnapshot,
            connect: () => ({ ready: Promise.resolve(true), close }),
        };
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({ transport }));
        const events = [];

        await runtime.service.handleRequest(productionRequest('depth-quiet-market'), {
            emit: event => events.push(event),
        });

        expect(readDepthSnapshot).toHaveBeenCalledOnce();
        const depth = events.filter(event => event.resource === 'depth');
        expect(depth).toHaveLength(1);
        expect(depth[0].state).toBe('live');
        expect(depth[0].payload.bids.length).toBeGreaterThan(0);
        expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
        expect(close).not.toHaveBeenCalled();
    });

    // A book that genuinely cannot be bridged is a stale book, not a dead desk:
    // the chart, the candles, the header and the tape are all here and none of
    // them comes from the book.
    it('comes live without the book when no snapshot can be bridged', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        const parsedSnapshot = JSON.parse(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.depthSnapshot,
        );
        // Older than every buffered diff, on every attempt: the bridge is never
        // made and the retries cannot heal it.
        const staleSnapshot = JSON.stringify({ ...parsedSnapshot, lastUpdateId: 1 });
        // Level with the furthest diff the stream has been seen to reach, so the
        // recovery's snapshot is one nothing contradicts.
        const healedSnapshot = JSON.stringify({ ...parsedSnapshot, lastUpdateId: 1002 });
        let snapshotBody = staleSnapshot;
        const readDepthSnapshot = vi.fn(async () => snapshotBody);
        const faults = [];
        const timings = [];
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            onInternalError: fault => faults.push(fault),
            onTiming: timing => timings.push(timing),
            transport: { ...base, readDepthSnapshot },
        }));
        const events = [];
        const pending = runtime.service.handleRequest(productionRequest('depth-unbridgeable'), {
            emit: event => events.push(event),
        });
        for (let retry = 0; retry < 3; retry += 1) {
            await vi.waitFor(() => expect(manual.timeoutCount()).toBeGreaterThan(0));
            manual.advance(1_000);
            manual.runTimeouts();
        }
        await pending;

        expect(readDepthSnapshot).toHaveBeenCalledTimes(4);
        expect(events.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['loading', 'live']);
        expect(events.some(event => event.resource === 'candles' && event.state === 'live'))
            .toBe(true);
        expect(events.some(event => event.resource === 'depth')).toBe(false);
        expect(faults).toContainEqual({
            phase: 'book-recovery',
            code: 'DEPTH_BOOTSTRAP_NOT_BRIDGED',
        });
        expect(timings).toContainEqual(expect.objectContaining({
            phase: 'aggregate-ready',
            outcome: 'no-book',
        }));

        // And the book is not lost for the session: the recovery that was left
        // running delivers it as soon as one snapshot bridges.
        snapshotBody = healedSnapshot;
        await vi.waitFor(() => expect(manual.timeoutCount()).toBeGreaterThan(0));
        manual.advance(1_000);
        manual.runTimeouts();
        await vi.waitFor(() => expect(events.at(-1)).toMatchObject({
            resource: 'depth',
            state: 'live',
        }));
        expect(events.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['loading', 'live']);
    });

    // The reporter defaults to a no-op, so a composition that drops it silences
    // every fault the desk absorbs.
    it('carries the fault reporter from the composition to the service', () => {
        const onInternalError = vi.fn();
        const runtime = track(createFuturesProductionWorkstationRuntime({
            onTiming: () => {},
            onInternalError,
        }));
        expect(runtime.service.onInternalError).toBe(onInternalError);
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
            bootstrapIndependent: async () => {
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
        expect(catalog.payload).toMatchObject({ total: 4, complete: true });
        expect(catalog.payload.contracts[0].filters.maximumOrders).toBe(0);
        expect(catalog.payload.contracts[0].filters.maximumAlgoOrders).toBeNull();
        expect(events.flatMap(event => event.resource === 'catalog'
            ? event.payload.contracts
            : []).find(contract => contract.symbol === '测试测试USDT')).toMatchObject({
            tradable: false,
        });
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
            .toHaveLength(2);
    });

    it('switches only the candle interval without rebuilding invariant market data', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const loadExchangeInfo = vi.fn(options => base.loadExchangeInfo(options));
        const bootstrapIndependent = vi.fn(options => base.bootstrapIndependent(options));
        const readDepthSnapshot = vi.fn(options => base.readDepthSnapshot(options));
        const bootstrapInterval = vi.fn(options => base.bootstrapInterval(options));
        let streamClose;
        let streamSelectInterval;
        const connect = vi.fn((options) => {
            const handle = base.connect(options);
            streamClose = vi.fn(handle.close);
            streamSelectInterval = vi.fn(selection => handle.selectInterval(selection));
            return Object.freeze({
                ready: handle.ready,
                close: streamClose,
                selectInterval: streamSelectInterval,
            });
        });
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: {
                ...base,
                loadExchangeInfo,
                bootstrapIndependent,
                readDepthSnapshot,
                bootstrapInterval,
                connect,
            },
        }));
        const events = [];

        await runtime.service.handleRequest(productionRequest('interval-base'), {
            emit: event => events.push(event),
        });
        await runtime.service.handleRequest(
            productionIntervalRequest('interval-only', 'BTCUSDT', '5m'),
            { emit: event => events.push(event) },
        );

        const switched = events.filter(event => event.requestId === 'interval-only');
        expect(loadExchangeInfo).toHaveBeenCalledOnce();
        expect(bootstrapIndependent).toHaveBeenCalledOnce();
        expect(readDepthSnapshot).toHaveBeenCalledOnce();
        expect(connect).toHaveBeenCalledOnce();
        expect(streamClose).not.toHaveBeenCalled();
        expect(bootstrapInterval).toHaveBeenCalledOnce();
        expect(streamSelectInterval).toHaveBeenCalledOnce();
        expect(streamSelectInterval).toHaveBeenCalledWith(expect.objectContaining({
            interval: '5m',
        }));
        expect(switched.map(event => event.resource)).toEqual([
            'status',
            'candles',
            'candles',
            'status',
        ]);
        expect(switched.filter(event => event.resource === 'candles')
            .map(event => event.payload.series)).toEqual(['contract', 'index']);
        expect(switched.every(event => event.generation === 1)).toBe(true);
        expect(runtime.service.current).toMatchObject({ generation: 1, interval: '5m' });
        expect(base.getActiveTimerCount()).toBe(1);
    });

    // The operator's crash: closing a stream whose socket was still in its
    // handshake threw out of `AbortController.abort()`, which is the first
    // statement of the teardown — so the streams stayed open, the timers stayed
    // armed, and the request that was supposed to start the next contract
    // rejected instead. Two contracts on one desk.
    it('starts the next contract even when releasing the previous one throws', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const connect = vi.fn((options) => {
            const handle = base.connect(options);
            return Object.freeze({
                ready: handle.ready,
                close: () => {
                    handle.close();
                    throw new Error('WebSocket was closed before the connection was established');
                },
                selectInterval: selection => handle.selectInterval(selection),
            });
        });
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: { ...base, connect },
        }));
        const events = [];
        const emit = event => events.push(event);

        await runtime.service.handleRequest(productionRequest('first', 'BTCUSDT'), { emit });
        await expect(runtime.service.handleRequest(
            productionRequest('second', 'ETHUSDT'),
            { emit },
        )).resolves.toBeUndefined();

        // The new contract owns the desk, and the previous session left nothing
        // of itself running.
        expect(runtime.service.current).toMatchObject({ symbol: 'ETHUSDT' });
        expect(connect).toHaveBeenCalledTimes(2);
        expect(base.getActiveTimerCount()).toBe(1);
    });

    // The operator switching contracts faster than a bootstrap completes: each
    // selection releases the one before it while that one is still reading, and
    // only the last one may reach the desk when they all settle.
    it('leaves one live session when contracts are selected in quick succession', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport();
        const heldDepthReads = new Map();
        const subscribers = new Map();
        // The held read answers late and answers well: what must stop a released
        // generation is the release, not an abort its read happened to observe.
        const readDepthSnapshot = vi.fn(options => new Promise((resolve) => {
            heldDepthReads.set(options.symbol, () => resolve(
                FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols[options.symbol].depthSnapshot,
            ));
        }));
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            transport: {
                ...base,
                readDepthSnapshot,
                connect: (options) => {
                    subscribers.set(options.symbol, options);
                    return base.connect(options);
                },
            },
        }));
        const events = { BTCUSDT: [], ETHUSDT: [], SOLUSDT: [] };
        const select = (requestId, symbol) => runtime.service.handleRequest(
            productionRequest(requestId, symbol),
            { emit: event => events[symbol].push(event) },
        );

        const pendingA = select('rapid-a', 'BTCUSDT');
        await vi.waitFor(() => expect(heldDepthReads.has('BTCUSDT')).toBe(true));
        const pendingB = select('rapid-b', 'ETHUSDT');
        await vi.waitFor(() => expect(heldDepthReads.has('ETHUSDT')).toBe(true));
        const pendingC = select('rapid-c', 'SOLUSDT');
        await vi.waitFor(() => expect(heldDepthReads.has('SOLUSDT')).toBe(true));
        const abandoned = { BTCUSDT: events.BTCUSDT.length, ETHUSDT: events.ETHUSDT.length };

        heldDepthReads.get('SOLUSDT')();
        await pendingC;
        // The reads the released generations were waiting on answer late, and
        // the sockets they opened deliver after the last selection is live.
        // Neither reaches the desk.
        heldDepthReads.get('BTCUSDT')();
        heldDepthReads.get('ETHUSDT')();
        await pendingA;
        await pendingB;
        subscribers.get('BTCUSDT').onMessage(productionTradeFrame({ aggregateTradeId: 7001 }));
        subscribers.get('ETHUSDT').onMessage(productionTradeFrame({ aggregateTradeId: 7002 }));

        expect(events.BTCUSDT).toHaveLength(abandoned.BTCUSDT);
        expect(events.ETHUSDT).toHaveLength(abandoned.ETHUSDT);
        expect(events.SOLUSDT.at(-1)).toMatchObject({
            symbol: 'SOLUSDT',
            resource: 'status',
            state: 'live',
        });
        expect(runtime.service.current).toMatchObject({
            requestId: 'rapid-c',
            symbol: 'SOLUSDT',
            generation: 3,
        });
        // One open stream and one freshness monitor: the two released contracts
        // left nothing of themselves running.
        expect(base.getActiveTimerCount()).toBe(1);
        expect(clock.intervalCount()).toBe(1);
        expect(clock.timeoutCount()).toBe(0);
    });

    // A timer can outlive the session that armed it — a clear that fails, or a
    // callback already off the queue when the release runs. What it must not do
    // is read or emit for a contract the desk has left.
    it('performs no read and emits nothing when a released session\'s timers fire', async () => {
        const manual = createManualClock();
        const armed = [];
        const clock = {
            ...manual.clock,
            setInterval: (callback, delay) => {
                armed.push({ kind: 'interval', callback });
                return manual.clock.setInterval(callback, delay);
            },
            setTimeout: (callback, delay) => {
                armed.push({ kind: 'timeout', callback });
                return manual.clock.setTimeout(callback, delay);
            },
        };
        const base = createFuturesProductionWorkstationFakeTransport();
        const reads = {
            loadExchangeInfo: vi.fn(options => base.loadExchangeInfo(options)),
            bootstrapIndependent: vi.fn(options => base.bootstrapIndependent(options)),
            readDepthSnapshot: vi.fn(options => base.readDepthSnapshot(options)),
            bootstrapInterval: vi.fn(options => base.bootstrapInterval(options)),
        };
        const readCounts = () => Object.fromEntries(
            Object.entries(reads).map(([name, read]) => [name, read.mock.calls.length]),
        );
        let subscriber;
        const connect = vi.fn((options) => {
            if (options.symbol === 'BTCUSDT') subscriber = options;
            return base.connect(options);
        });
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock,
            transport: { ...base, ...reads, connect },
        }));
        const releasedEvents = [];
        await runtime.service.handleRequest(productionRequest('released-timers'), {
            emit: event => releasedEvents.push(event),
        });
        const freshness = armed.filter(timer => timer.kind === 'interval');
        expect(freshness).toHaveLength(1);

        const beforeCandleDisconnect = armed.length;
        subscriber.onCandleDisconnect('CLOSED');
        const intervalReconnect = armed.slice(beforeCandleDisconnect);
        expect(intervalReconnect).toHaveLength(1);

        const beforeDisconnect = armed.length;
        subscriber.onDisconnect('SOCKET_CLOSED');
        const reconnect = armed.slice(beforeDisconnect);
        expect(reconnect).toHaveLength(1);

        const nextEvents = [];
        await runtime.service.handleRequest(
            productionRequest('released-timers-next', 'ETHUSDT'),
            { emit: event => nextEvents.push(event) },
        );
        const emitted = releasedEvents.length;
        const readsBefore = readCounts();
        const connectsBefore = connect.mock.calls.length;

        for (const timer of [...freshness, ...intervalReconnect, ...reconnect]) timer.callback();
        await Promise.resolve();

        expect(releasedEvents).toHaveLength(emitted);
        expect(readCounts()).toEqual(readsBefore);
        expect(connect).toHaveBeenCalledTimes(connectsBefore);
        expect(nextEvents.at(-1)).toMatchObject({ symbol: 'ETHUSDT', state: 'live' });
        expect(runtime.service.current).toMatchObject({
            requestId: 'released-timers-next',
            symbol: 'ETHUSDT',
        });
        expect(base.getActiveTimerCount()).toBe(1);
    });

    it('drops stale interval bootstraps during a rapid A → B → C switch', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const deferred = new Map();
        const bootstrapInterval = vi.fn(options => new Promise((resolve) => {
            deferred.set(options.interval, resolve);
        }));
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: { ...base, bootstrapInterval },
        }));
        const initialEvents = [];
        await runtime.service.handleRequest(productionRequest('interval-a'), {
            emit: event => initialEvents.push(event),
        });

        const bEvents = [];
        const cEvents = [];
        const pendingB = runtime.service.handleRequest(
            productionIntervalRequest('interval-b', 'BTCUSDT', '5m'),
            { emit: event => bEvents.push(event) },
        );
        await vi.waitFor(() => expect(deferred.has('5m')).toBe(true));
        const pendingC = runtime.service.handleRequest(
            productionIntervalRequest('interval-c', 'BTCUSDT', '15m'),
            { emit: event => cEvents.push(event) },
        );
        await vi.waitFor(() => expect(deferred.has('15m')).toBe(true));

        const fixture = FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT;
        const candleSnapshot = {
            contractKlines: fixture.contractKlines,
            indexKlines: fixture.indexKlines,
        };
        deferred.get('15m')(candleSnapshot);
        await pendingC;
        deferred.get('5m')(candleSnapshot);
        await pendingB;

        expect(bEvents.map(event => event.resource)).toEqual(['status']);
        expect(cEvents.map(event => event.resource)).toEqual([
            'status',
            'candles',
            'candles',
            'status',
        ]);
        expect(cEvents.filter(event => event.resource === 'candles')
            .every(event => event.payload.interval === '15m')).toBe(true);
        expect(runtime.service.current).toMatchObject({
            requestId: 'interval-c',
            interval: '15m',
            generation: 1,
        });
        expect(bootstrapInterval).toHaveBeenCalledTimes(2);
    });

    it('starts a clean generation when interval selection races initial exchange info', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        let resolveFirstExchangeInfo;
        const loadExchangeInfo = vi.fn((options) => {
            if (loadExchangeInfo.mock.calls.length === 1) {
                return new Promise((resolve) => { resolveFirstExchangeInfo = resolve; });
            }
            return base.loadExchangeInfo(options);
        });
        const bootstrapIndependent = vi.fn(options => base.bootstrapIndependent(options));
        const connect = vi.fn(options => base.connect(options));
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: { ...base, loadExchangeInfo, bootstrapIndependent, connect },
        }));
        const firstEvents = [];
        const selectedEvents = [];

        const first = runtime.service.handleRequest(productionRequest('interval-early-base'), {
            emit: event => firstEvents.push(event),
        });
        await vi.waitFor(() => expect(resolveFirstExchangeInfo).toBeTypeOf('function'));
        await runtime.service.handleRequest(
            productionIntervalRequest('interval-early-selected', 'BTCUSDT', '5m'),
            { emit: event => selectedEvents.push(event) },
        );
        resolveFirstExchangeInfo(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog);
        await first;

        expect(loadExchangeInfo).toHaveBeenCalledTimes(2);
        expect(bootstrapIndependent).toHaveBeenCalledOnce();
        expect(connect).toHaveBeenCalledOnce();
        expect(firstEvents.some(event => event.state === 'live')).toBe(false);
        expect(selectedEvents.at(-1)).toMatchObject({
            requestId: 'interval-early-selected',
            generation: 2,
            state: 'live',
        });
        expect(runtime.service.current).toMatchObject({
            requestId: 'interval-early-selected',
            interval: '5m',
            generation: 2,
        });
    });

    it('starts a clean generation when interval selection races a full bootstrap', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        let resolveFirstBootstrap;
        let firstBootstrapOptions;
        const bootstrapIndependent = vi.fn((options) => {
            if (bootstrapIndependent.mock.calls.length === 1) {
                firstBootstrapOptions = options;
                return new Promise((resolve) => { resolveFirstBootstrap = resolve; });
            }
            return base.bootstrapIndependent(options);
        });
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: { ...base, bootstrapIndependent },
        }));
        const firstEvents = [];
        const selectedEvents = [];
        const first = runtime.service.handleRequest(productionRequest('interval-bootstrap-base'), {
            emit: event => firstEvents.push(event),
        });
        await vi.waitFor(() => expect(resolveFirstBootstrap).toBeTypeOf('function'));

        await runtime.service.handleRequest(
            productionIntervalRequest('interval-bootstrap-selected', 'BTCUSDT', '15m'),
            { emit: event => selectedEvents.push(event) },
        );
        firstBootstrapOptions.onBootstrapResource({
            resource: 'contractKlines',
            value: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.contractKlines,
        });
        resolveFirstBootstrap(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT);
        await first;

        expect(bootstrapIndependent).toHaveBeenCalledTimes(2);
        expect(firstEvents.some(event => event.resource === 'candles')).toBe(false);
        expect(selectedEvents.filter(event => event.resource === 'candles')
            .every(event => event.payload.interval === '15m')).toBe(true);
        expect(selectedEvents.at(-1)).toMatchObject({
            requestId: 'interval-bootstrap-selected',
            generation: 2,
            state: 'live',
        });
    });

    it('cancels a pending full reconnect when a new interval owns recovery', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        let disconnect;
        const connect = vi.fn((options) => {
            disconnect = options.onDisconnect;
            return base.connect(options);
        });
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            transport: { ...base, connect },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('interval-reconnect-base'), {
            emit: event => events.push(event),
        });
        disconnect('SOCKET_CLOSED');
        expect(manual.timeoutCount()).toBe(1);

        await runtime.service.handleRequest(
            productionIntervalRequest('interval-reconnect-selected', 'BTCUSDT', '4h'),
            { emit: event => events.push(event) },
        );

        expect(manual.timeoutCount()).toBe(0);
        expect(connect).toHaveBeenCalledTimes(2);
        expect(runtime.service.current).toMatchObject({
            requestId: 'interval-reconnect-selected',
            interval: '4h',
            generation: 2,
        });
        expect(events.at(-1)).toMatchObject({
            requestId: 'interval-reconnect-selected',
            state: 'live',
        });
    });

    it('recovers a post-ready candle disconnect without touching book or trade streams', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        const bootstrapIndependent = vi.fn(options => base.bootstrapIndependent(options));
        const bootstrapInterval = vi.fn(options => base.bootstrapInterval(options));
        let candleDisconnect;
        let streamClose;
        let streamSelectInterval;
        const connect = vi.fn((options) => {
            candleDisconnect = options.onCandleDisconnect;
            const handle = base.connect(options);
            streamClose = vi.fn(handle.close);
            streamSelectInterval = vi.fn(selection => handle.selectInterval(selection));
            return Object.freeze({
                ready: handle.ready,
                close: streamClose,
                selectInterval: streamSelectInterval,
            });
        });
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            transport: { ...base, bootstrapIndependent, bootstrapInterval, connect },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('candle-recovery'), {
            emit: event => events.push(event),
        });

        candleDisconnect('SOCKET_CLOSED');
        expect(events.at(-1)).toMatchObject({
            resource: 'status',
            state: 'live',
            payload: { connected: true, reasonCode: 'CANDLE_SOCKET_CLOSED' },
        });
        expect(manual.timeoutCount()).toBe(1);
        expect(streamClose).not.toHaveBeenCalled();
        expect(connect).toHaveBeenCalledOnce();
        expect(bootstrapIndependent).toHaveBeenCalledOnce();
        expect(bootstrapInterval).not.toHaveBeenCalled();

        manual.runTimeouts();
        await vi.waitFor(() => expect(bootstrapInterval).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(events.at(-1)).toMatchObject({
            resource: 'status',
            state: 'live',
            payload: { connected: true, reasonCode: null },
        }));

        expect(streamSelectInterval).toHaveBeenCalledOnce();
        expect(streamClose).not.toHaveBeenCalled();
        expect(connect).toHaveBeenCalledOnce();
        expect(bootstrapIndependent).toHaveBeenCalledOnce();
        expect(manual.timeoutCount()).toBe(0);
    });

    it('bounds candle-only handshake retries without falling back to a full resync', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        const bootstrapIndependent = vi.fn(options => base.bootstrapIndependent(options));
        const bootstrapInterval = vi.fn(options => base.bootstrapInterval(options));
        let streamClose;
        const streamSelectInterval = vi.fn(async () => false);
        const connect = vi.fn((options) => {
            const handle = base.connect(options);
            streamClose = vi.fn(handle.close);
            return Object.freeze({
                ready: handle.ready,
                close: streamClose,
                selectInterval: streamSelectInterval,
            });
        });
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            transport: { ...base, bootstrapIndependent, bootstrapInterval, connect },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('candle-retry-base'), {
            emit: event => events.push(event),
        });
        await runtime.service.handleRequest(
            productionIntervalRequest('candle-retry-selected', 'BTCUSDT', '5m'),
            { emit: event => events.push(event) },
        );

        for (let attempt = 1; attempt <= 8; attempt += 1) {
            expect(manual.timeoutCount()).toBe(1);
            manual.runTimeouts();
            await vi.waitFor(() => expect(streamSelectInterval).toHaveBeenCalledTimes(attempt + 1));
        }

        await vi.waitFor(() => expect(manual.timeoutCount()).toBe(0));
        expect(events.at(-1)).toMatchObject({
            resource: 'status',
            state: 'live',
            payload: { connected: true, reasonCode: 'INTERVAL_RECONNECT_EXHAUSTED' },
        });
        expect(streamSelectInterval).toHaveBeenCalledTimes(9);
        expect(bootstrapInterval).not.toHaveBeenCalled();
        expect(connect).toHaveBeenCalledOnce();
        expect(bootstrapIndependent).toHaveBeenCalledOnce();
        expect(streamClose).not.toHaveBeenCalled();
    });

    it('drops a late bootstrap from the prior symbol generation', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const deferred = new Map();
        const transport = {
            ...base,
            bootstrapIndependent: options => new Promise(resolve => deferred.set(options.symbol, {
                resolve,
                onBootstrapResource: options.onBootstrapResource,
            })),
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
        deferred.get('BTCUSDT').onBootstrapResource({
            resource: 'contractKlines',
            value: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.contractKlines,
        });
        deferred.get('BTCUSDT').onBootstrapResource({
            resource: 'premiumIndex',
            value: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.premiumIndex,
        });
        expect(oldEvents.some(event => ['candles', 'header'].includes(event.resource))).toBe(false);
        deferred.get('ETHUSDT').resolve({
            contractKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.contractKlines,
            markKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.markKlines,
            indexKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.indexKlines,
            premiumIndex: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.premiumIndex,
            ticker: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.ETHUSDT.ticker,
        });
        await second;
        deferred.get('BTCUSDT').resolve({
            contractKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.contractKlines,
            markKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.markKlines,
            indexKlines: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.indexKlines,
            premiumIndex: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.premiumIndex,
            ticker: FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.ticker,
        });
        await first;
        expect(oldEvents.some(event => event.resource === 'status' && event.state === 'live')).toBe(false);
        expect(oldEvents.some(event => ['header', 'candles', 'depth', 'trades'].includes(event.resource)))
            .toBe(false);
        expect(newEvents.at(-1)).toMatchObject({ symbol: 'ETHUSDT', state: 'live' });
    });

    it('heals a depth bootstrap gap by refetching only the snapshot', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        const parsedSnapshot = JSON.parse(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.depthSnapshot,
        );
        // Attempt 1 returns a snapshot older than every buffered diff; the
        // healed retry matches the diff emitted by fake cycle 1 (U=u=1002).
        const staleSnapshot = JSON.stringify({ ...parsedSnapshot, lastUpdateId: 1 });
        const healedSnapshot = JSON.stringify({ ...parsedSnapshot, lastUpdateId: 1002 });
        const readDepthSnapshot = vi.fn(async () => (
            readDepthSnapshot.mock.calls.length === 1 ? staleSnapshot : healedSnapshot
        ));
        const close = vi.fn();
        const connect = vi.fn((options) => {
            const handle = base.connect(options);
            return Object.freeze({
                ready: handle.ready,
                selectInterval: handle.selectInterval,
                close: () => {
                    close();
                    handle.close();
                },
            });
        });
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            transport: { ...base, readDepthSnapshot, connect },
        }));
        const events = [];
        const pending = runtime.service.handleRequest(productionRequest('depth-heal'), {
            emit: event => events.push(event),
        });
        await vi.waitFor(() => expect(readDepthSnapshot).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(manual.timeoutCount()).toBe(1));
        manual.advance(750);
        manual.runIntervals();
        manual.runTimeouts();
        await pending;

        expect(readDepthSnapshot).toHaveBeenCalledTimes(2);
        expect(readDepthSnapshot.mock.calls[1][0]).toMatchObject({ retryAttempt: 1 });
        expect(close).not.toHaveBeenCalled();
        expect(connect).toHaveBeenCalledOnce();
        expect(events.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['loading', 'live']);
        expect(events.some(event => event.state === 'resynchronizing')).toBe(false);
    });

    // A broken depth sequence is a book problem, and the book is the one thing
    // the desk can lose without losing the desk: the price, the candles, the
    // tape and the account's own PnL do not come from it, and in a violent move
    // the operator is not reading it. It used to resynchronize the whole
    // workspace — which is how a burst took the desk off the market.
    it('rebuilds the book on a depth gap and leaves the desk live', async () => {
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
        const book = events.findLast(event => event.resource === 'depth')?.payload;
        expect(book).not.toBeNull();

        subscriber.onMessage(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(2)[0]);

        // The book says it is stale and keeps the levels last delivered; the
        // session says nothing, because nothing happened to it.
        expect(events.at(-1)).toMatchObject({ resource: 'depth', state: 'stale' });
        expect(events.at(-1).payload).toEqual(book);
        expect(events.some(event => event.resource === 'status'
            && event.state === 'resynchronizing')).toBe(false);
        expect(runtime.service.current).toMatchObject({ symbol: 'BTCUSDT' });
    });

    // The operator, on a violent move: the book is the last thing they are
    // reading — the price and the PnL are what must not stop. So a book that
    // cannot be rebuilt at all stays stale for as long as it must, and the desk
    // keeps delivering around it.
    it('keeps the desk delivering when the book cannot be rebuilt at all', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
                readDepthSnapshot: vi.fn(async (options) => {
                    if (options?.retryAttempt) throw new Error('depth unavailable');
                    return base.readDepthSnapshot(options);
                }),
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('depth-unavailable'), {
            emit: event => events.push(event),
        });
        const delivered = events.length;
        const cycle = FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(2);

        subscriber.onMessage(cycle[0]);
        await vi.waitFor(() => expect(events.at(-1)).toMatchObject({
            resource: 'depth',
            state: 'stale',
        }));

        // The price keeps arriving while the book is out.
        subscriber.onMessage(cycle[2]);
        expect(events.at(-1)).toMatchObject({ resource: 'candles', state: 'live' });
        expect(events.some(event => event.resource === 'status'
            && event.state === 'resynchronizing')).toBe(false);
        expect(events.length).toBeGreaterThan(delivered);
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

    // A frame the desk refused on its own ceiling is not the market going quiet
    // and not a frame the desk could not read. It says so under its own name,
    // once per burst, and the desk keeps trading around it.
    it('names a refused frame on the reason line without leaving live', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        let subscriber;
        const clock = createManualClock();
        const faults = [];
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
            clock: clock.clock,
            onInternalError: fault => faults.push(fault),
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('refused-frame'), {
            emit: event => events.push(event),
        });
        const settled = events.length;

        subscriber.onFrameRefused('STREAM_FRAME_REFUSED');
        subscriber.onFrameRefused('STREAM_FRAME_REFUSED');

        expect(events.slice(settled)).toEqual([expect.objectContaining({
            resource: 'status',
            state: 'live',
            payload: { connected: true, reasonCode: 'STREAM_FRAME_REFUSED' },
        })]);
        // Every refusal reaches the fault log; only the first reaches the desk.
        expect(faults).toEqual([
            { phase: 'stream-frame', code: 'STREAM_FRAME_REFUSED' },
            { phase: 'stream-frame', code: 'STREAM_FRAME_REFUSED' },
        ]);

        clock.advance(5_000);
        subscriber.onFrameRefused('STREAM_FRAME_REFUSED');
        expect(events.slice(settled)).toHaveLength(2);
        expect(events.at(-1)).toMatchObject({
            state: 'live',
            payload: { reasonCode: 'STREAM_FRAME_REFUSED' },
        });
    });

    // The moment the desk exists for, driven end to end: ten seconds of diffs at
    // the exchange's own hundred-millisecond cadence, each restating two thousand
    // levels a side, with twenty prints a tick on the tape beside them. The
    // session must not notice.
    it('holds a live session through a burst of full-width diffs and a heavy tape', async () => {
        const TICKS = 100;
        const LEVELS_PER_SIDE = 2_000;
        const PRINTS_PER_TICK = 20;
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        let subscriber;
        const faults = [];
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            onInternalError: fault => faults.push(fault),
            transport: {
                ...base,
                // The desk's own frames only: the fixture's background cycle would
                // interleave its own sequence into the burst.
                connect: (options) => {
                    subscriber = options;
                    options.onMessage(
                        FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.bridgeDepth,
                    );
                    return Object.freeze({ ready: Promise.resolve(true), close: () => {} });
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('spike-burst'), {
            emit: event => events.push(event),
        });
        expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
        const settled = events.length;

        for (let tick = 1; tick <= TICKS; tick += 1) {
            const [, trade, kline, mark, ticker] = FUTURES_PRODUCTION_WORKSTATION_FIXTURE
                .symbols.BTCUSDT.streams.makeCycle(tick);
            subscriber.onMessage(burstDepthFrame(tick, LEVELS_PER_SIDE));
            subscriber.onMessage(trade);
            for (let print = 0; print < PRINTS_PER_TICK; print += 1) {
                subscriber.onMessage(productionTradeFrame({
                    cycle: tick,
                    aggregateTradeId: 9_100_000 + (tick * PRINTS_PER_TICK) + print,
                }));
            }
            subscriber.onMessage(kline);
            subscriber.onMessage(mark);
            subscriber.onMessage(ticker);
            clock.advance(100);
            clock.runTimeouts();
        }
        // The freshness monitor reads the session it was left with.
        clock.runIntervals();

        const burst = events.slice(settled);
        const depth = burst.filter(event => event.resource === 'depth');
        expect(depth).toHaveLength(TICKS);
        expect(burst.every(event => event.state === 'live')).toBe(true);
        expect(burst.every(event => event.generation === 1)).toBe(true);
        expect(faults).toEqual([]);
        expect(runtime.service.current).toMatchObject({
            symbol: 'BTCUSDT',
            generation: 1,
            bootstrapped: true,
            reconnectTimer: null,
        });
        expect(runtime.service.current.staleResources.size).toBe(0);
        // The book states the last diff, not the last one it managed to keep up
        // with: the levels the final frame posted carry the quantities it posted.
        const lastFrame = JSON.parse(burstDepthFrame(TICKS, LEVELS_PER_SIDE));
        const view = depth.at(-1).payload;
        for (const [price, quantity] of [lastFrame.data.b[0], lastFrame.data.b[1]]) {
            expect(Number(view.bids.find(row => row.price === price)?.quantity))
                .toBe(Number(quantity));
        }
        for (const [price, quantity] of [lastFrame.data.a[0], lastFrame.data.a[1]]) {
            expect(Number(view.asks.find(row => row.price === price)?.quantity))
                .toBe(Number(quantity));
        }
        expect(view.lastUpdateId).toBe(String(lastFrame.data.u));
    });

    it('resynchronizes under the name of the ending it was given', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        let subscriber;
        const clock = createManualClock();
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
            clock: clock.clock,
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('named-resync'), {
            emit: event => events.push(event),
        });
        const settled = events.length;

        // The desk closed this one itself. Reported as a plain socket
        // disconnect, the operator had nothing to act on.
        subscriber.onDisconnect('BINARY_FRAME_REJECTED');

        expect(events.slice(settled).map(event => [event.state, event.payload.reasonCode])).toEqual([
            ['disconnected', 'BINARY_FRAME_REJECTED'],
            ['resynchronizing', 'BINARY_FRAME_REJECTED'],
        ]);
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
        expect(clock.timeoutCount()).toBe(1);
        expect(runtime.service.current.pendingEvents).toHaveLength(0);
        expect(runtime.service.current.trades).toHaveLength(128);
        clock.advance(250);
        clock.runTimeouts();
        const tape = events.filter(event => event.resource === 'trades').at(-1).payload.rows;
        expect(tape).toHaveLength(32);
        expect(tape[0].aggregateTradeId).toBe('1128');
        expect(tape.some(row => row.aggregateTradeId === '1000')).toBe(false);
    });

    it('coalesces a trade burst into leading and newest trailing tape payloads', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('tape-burst'), {
            emit: event => events.push(event),
        });
        const initialCount = events.filter(event => event.resource === 'trades').length;

        subscriber.onMessage(productionTradeFrame({ cycle: 1, aggregateTradeId: 2001 }));
        subscriber.onMessage(productionTradeFrame({ cycle: 2, aggregateTradeId: 2002 }));
        subscriber.onMessage(productionTradeFrame({ cycle: 3, aggregateTradeId: 2003 }));

        expect(events.filter(event => event.resource === 'trades')).toHaveLength(initialCount + 1);
        expect(clock.timeoutCount()).toBe(1);
        clock.advance(250);
        clock.runTimeouts();
        const tapeEvents = events.filter(event => event.resource === 'trades');
        expect(tapeEvents).toHaveLength(initialCount + 2);
        expect(tapeEvents.at(-1).payload.rows[0].aggregateTradeId).toBe('2003');
        expect(clock.timeoutCount()).toBe(0);
    });

    it('filters tape by exact USDT notional while raw trade freshness stays live', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('tape-notional'), {
            emit: event => events.push(event),
        });
        await runtime.service.handleRequest(productionTapeRequest('tape-notional', {
            minNotionalUsdt: '25',
        }), { emit: event => events.push(event) });
        const configuredCount = events.filter(event => event.resource === 'trades').length;

        subscriber.onMessage(productionTradeFrame({
            cycle: 1,
            aggregateTradeId: 3001,
            price: '99',
            quantity: '0.25',
        }));
        expect(events.filter(event => event.resource === 'trades')).toHaveLength(configuredCount);
        expect(clock.timeoutCount()).toBe(0);

        subscriber.onMessage(productionTradeFrame({
            cycle: 2,
            aggregateTradeId: 3002,
            price: '100',
            quantity: '0.25',
        }));
        expect(clock.timeoutCount()).toBe(1);
        clock.advance(250);
        clock.runTimeouts();
        expect(events.filter(event => event.resource === 'trades').at(-1).payload.rows)
            .toEqual([expect.objectContaining({ aggregateTradeId: '3002' })]);
        expect(runtime.service.current.lastTradesAt).toBe(clock.clock.now() - 250);
        expect(runtime.service.current.staleResources.has('trades')).toBe(false);
    });

    it('keeps eligible trades in the tape while small prints churn past the bound', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('tape-retention'), {
            emit: event => events.push(event),
        });
        await runtime.service.handleRequest(productionTapeRequest('tape-retention', {
            minNotionalUsdt: '500',
        }), { emit: event => events.push(event) });

        subscriber.onMessage(productionTradeFrame({
            cycle: 1,
            aggregateTradeId: 4001,
            price: '1000',
            quantity: '1',
        }));
        // A long run of ineligible prints must not evict the large one.
        for (let index = 0; index < 600; index += 1) {
            subscriber.onMessage(productionTradeFrame({
                cycle: 2 + index,
                aggregateTradeId: 5000 + index,
                price: '1',
                quantity: '1',
            }));
        }
        clock.advance(250);
        clock.runTimeouts();

        expect(events.filter(event => event.resource === 'trades').at(-1).payload.rows)
            .toEqual([expect.objectContaining({ aggregateTradeId: '4001' })]);
        expect(runtime.service.current.staleResources.has('trades')).toBe(false);
    });

    it('treats an explicit zero-USDT threshold as no tape filter', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('tape-zero-filter'), {
            emit: event => events.push(event),
        });
        await runtime.service.handleRequest(productionTapeRequest('tape-zero-filter', {
            minNotionalUsdt: '0',
        }), { emit: event => events.push(event) });

        subscriber.onMessage(productionTradeFrame({
            cycle: 1,
            aggregateTradeId: 3501,
            price: '0.0000001',
            quantity: '0.0000001',
        }));
        clock.advance(250);
        clock.runTimeouts();

        expect(events.filter(event => event.resource === 'trades').at(-1).payload.rows)
            .toEqual([expect.objectContaining({ aggregateTradeId: '3501' })]);
    });

    it('disables throttling without disabling the notional filter or row bound', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('tape-unthrottled'), {
            emit: event => events.push(event),
        });
        await runtime.service.handleRequest(productionTapeRequest('tape-unthrottled', {
            throttleEnabled: false,
            minNotionalUsdt: '10',
        }), { emit: event => events.push(event) });
        const configuredCount = events.filter(event => event.resource === 'trades').length;

        subscriber.onMessage(productionTradeFrame({
            cycle: 1,
            aggregateTradeId: 4001,
            price: '100',
            quantity: '0.2',
        }));
        subscriber.onMessage(productionTradeFrame({
            cycle: 2,
            aggregateTradeId: 4002,
            price: '100',
            quantity: '0.2',
        }));

        expect(events.filter(event => event.resource === 'trades')).toHaveLength(configuredCount + 2);
        expect(clock.timeoutCount()).toBe(0);
        expect(events.filter(event => event.resource === 'trades').at(-1).payload.rows.length)
            .toBeLessThanOrEqual(32);
    });

    it('cancels a pending tape payload when a new symbol generation takes ownership', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            transport: {
                ...base,
                connect: (options) => {
                    if (options.symbol === 'BTCUSDT') subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const oldEvents = [];
        await runtime.service.handleRequest(productionRequest('tape-old-owner'), {
            emit: event => oldEvents.push(event),
        });
        subscriber.onMessage(productionTradeFrame({ cycle: 1, aggregateTradeId: 5001 }));
        subscriber.onMessage(productionTradeFrame({ cycle: 2, aggregateTradeId: 5002 }));
        expect(clock.timeoutCount()).toBe(1);

        const newEvents = [];
        await runtime.service.handleRequest(productionRequest('tape-new-owner', 'ETHUSDT'), {
            emit: event => newEvents.push(event),
        });
        const oldCount = oldEvents.length;
        expect(clock.timeoutCount()).toBe(0);
        clock.advance(250);
        clock.runTimeouts();
        expect(oldEvents).toHaveLength(oldCount);
        expect(newEvents.at(-1)).toMatchObject({ symbol: 'ETHUSDT', state: 'live' });
    });

    it('cancels a pending tape payload before a full reconnect rebuilds the generation', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('tape-reconnect'), {
            emit: event => events.push(event),
        });
        subscriber.onMessage(productionTradeFrame({ cycle: 1, aggregateTradeId: 6001 }));
        subscriber.onMessage(productionTradeFrame({ cycle: 2, aggregateTradeId: 6002 }));

        expect(runtime.service.current.pendingTapeTimer).not.toBeNull();
        expect(clock.timeoutCount()).toBe(1);
        subscriber.onDisconnect('SOCKET_CLOSED');

        expect(runtime.service.current.pendingTapeTimer).toBeNull();
        expect(runtime.service.current.pendingTapeEmission).toBe(false);
        // The only remaining timeout belongs to the reconnect, not the tape.
        expect(clock.timeoutCount()).toBe(1);
        clock.runTimeouts();
        await vi.waitFor(() => expect(runtime.service.current.generation).toBe(2));
        await vi.waitFor(() => expect(events.at(-1)).toMatchObject({
            generation: 2,
            state: 'live',
        }));

        expect(events
            .filter(event => event.resource === 'trades')
            .some(event => event.payload.rows.some(row => row.aggregateTradeId === '6002')))
            .toBe(false);
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
            bootstrapIndependent: async (options) => ({
                ...await base.bootstrapIndependent(options),
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
            bootstrapIndependent: async (options) => {
                bootstrapAttempts += 1;
                if (bootstrapAttempts === 1) throw new Error('temporary bootstrap failure');
                return base.bootstrapIndependent(options);
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

    describe('candle history', () => {
        const historyKlines = (count, { endTime = 1_784_000_000_000, intervalMs = 60_000 } = {}) => (
            JSON.stringify(Array.from({ length: count }, (_, index) => {
                const openTime = endTime - ((count - index) * intervalMs);
                return [
                    openTime,
                    '58400.00',
                    '58500.00',
                    '58300.00',
                    '58420.00',
                    '100.12500000',
                    openTime + intervalMs - 1,
                    '100000.00000000',
                    50 + index,
                    '40.00000000',
                    '40000.00000000',
                    '0',
                ];
            }))
        );

        const historyRuntime = async (requestId, { readCandleHistory } = {}) => {
            const base = createFuturesProductionWorkstationFakeTransport();
            const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
                transport: { ...base, readCandleHistory },
            }));
            const events = [];
            await runtime.service.handleRequest(productionRequest(requestId), {
                emit: event => events.push(event),
            });
            events.length = 0;
            return { runtime, events };
        };

        it('delivers history behind the live window as bounded pages', async () => {
            const reads = [];
            const { runtime, events } = await historyRuntime('history-pages', {
                readCandleHistory: async (options) => {
                    reads.push(options);
                    return historyKlines(100);
                },
            });

            await runtime.service.handleRequest(productionCandleHistoryRequest('history-pages'), {
                emit: event => events.push(event),
            });

            expect(reads).toMatchObject([{ symbol: 'BTCUSDT', interval: '1m', limit: 1_000 }]);
            const pages = events.filter(event => event.resource === 'candleHistory');
            expect(pages.map(page => [
                page.payload.offset,
                page.payload.rows.length,
                page.payload.complete,
            ])).toEqual([[0, 80, false], [80, 20, true]]);
            // The live window keeps its own tail: history never writes it.
            expect(events.some(event => event.resource === 'candles')).toBe(false);
        });

        it('states an exhausted history instead of staying silent', async () => {
            const { runtime, events } = await historyRuntime('history-empty', {
                readCandleHistory: async () => '[]',
            });

            await runtime.service.handleRequest(productionCandleHistoryRequest('history-empty'), {
                emit: event => events.push(event),
            });

            expect(events.filter(event => event.resource === 'candleHistory')).toMatchObject([{
                payload: { offset: 0, total: 0, complete: true, rows: [] },
            }]);
        });

        it('refuses history for a subscription, contract or interval it does not own', async () => {
            const { runtime } = await historyRuntime('history-owner', {
                readCandleHistory: async () => historyKlines(10),
            });

            for (const overrides of [
                { requestId: 'history-someone-else' },
                { symbol: 'ETHUSDT' },
                { interval: '15m' },
            ]) {
                await expect(runtime.service.handleRequest(
                    productionCandleHistoryRequest('history-owner', overrides),
                    { emit: () => {} },
                )).rejects.toMatchObject({ code: 'CANDLE_HISTORY_OWNER_UNAVAILABLE' });
            }
        });

        it('drops a read that fails and leaves the live session alone', async () => {
            const { runtime, events } = await historyRuntime('history-failure', {
                readCandleHistory: async () => {
                    throw new Error('network down');
                },
            });

            await runtime.service.handleRequest(productionCandleHistoryRequest('history-failure'), {
                emit: event => events.push(event),
            });

            expect(events).toEqual([]);
            expect(runtime.service.current.requestId).toBe('history-failure');
        });
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

// Binance charges depth by page: 50 levels cost 2, a thousand cost 20. The desk
// draws fourteen rows a side, which at the finest step spans fourteen ticks —
// so it bought the deepest page the coarsest possible step could ever want,
// on every contract switch, before knowing whether the operator wanted it.
describe('the book is bought as deep as it is read', () => {
    const openContract = async (requestId) => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const readDepthSnapshot = vi.fn(options => base.readDepthSnapshot(options));
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: { ...base, readDepthSnapshot },
        }));
        await runtime.service.handleRequest(productionRequest(requestId), { emit: () => {} });
        return { runtime, readDepthSnapshot };
    };

    it('opens a contract on the cheapest page', async () => {
        const { readDepthSnapshot } = await openContract('depth-page-cheap');
        expect(readDepthSnapshot).toHaveBeenCalledOnce();
        expect(readDepthSnapshot.mock.calls[0][0]).toMatchObject({ limit: 50 });
    });

    it('buys a deeper page when the rows reach past what the snapshot proved', async () => {
        const { runtime, readDepthSnapshot } = await openContract('depth-page-deepen');
        // The fixture book spans about ±2.40 around the mid; fourteen rows at a
        // step this coarse reach five past the best price on each side.
        await runtime.service.handleRequest(
            productionDepthRequest('depth-page-deepen', '5'),
            { emit: () => {} },
        );
        await vi.waitFor(() => expect(readDepthSnapshot.mock.calls.length).toBeGreaterThan(1));
        expect(readDepthSnapshot.mock.calls.at(-1)[0].limit).toBeGreaterThan(50);
    });

    it('asks for nothing when the reading already fits the page it holds', async () => {
        const { runtime, readDepthSnapshot } = await openContract('depth-page-fits');
        await runtime.service.handleRequest(
            productionDepthRequest('depth-page-fits', '0.5'),
            { emit: () => {} },
        );
        await Promise.resolve();
        expect(readDepthSnapshot).toHaveBeenCalledOnce();
    });

    // A band big enough for the rows that the market has walked out of needs the
    // same page again, centred where the market is now — not a deeper one. Left
    // to deepen on every walk, a busy contract would climb to the thousand
    // levels this change exists to stop buying.
    it('re-reads the page it holds when the market walks out of a band that fits', async () => {
        const { runtime, readDepthSnapshot } = await openContract('depth-page-walk');
        const session = runtime.service.current;
        session.depthRange = '0.5';
        session.orderBook.rangeShortfall = () => 1;
        runtime.service.ensureDepthCovers(session);
        await vi.waitFor(() => expect(readDepthSnapshot.mock.calls.length).toBe(2));
        expect(readDepthSnapshot.mock.calls.at(-1)[0]).toMatchObject({ limit: 50 });
        expect(runtime.service.depthPage).toBe(0);
    });

    // The deepest page has nothing above it to buy. A book that answered a walk
    // only by buying deeper would, at the top of the ladder, stop answering at
    // all — and keep dropping every level outside a band it had left for good.
    it('re-reads at the deepest page too, where there is nothing deeper to buy', async () => {
        const { runtime, readDepthSnapshot } = await openContract('depth-page-deepest');
        const session = runtime.service.current;
        runtime.service.depthPage = 3;
        session.depthRange = '0.5';
        session.orderBook.rangeShortfall = () => 1;
        runtime.service.ensureDepthCovers(session);
        await vi.waitFor(() => expect(readDepthSnapshot.mock.calls.length).toBe(2));
        expect(readDepthSnapshot.mock.calls.at(-1)[0]).toMatchObject({ limit: 1_000 });
    });

    // The range is a distance in the contract's own quote currency. Carried into
    // the next contract, a step of one on a contract priced in dollars reads as
    // an impossible range on one priced in ten-thousandths.
    it('opens a contract on its own reading, not the one stated for the last', async () => {
        const { runtime, readDepthSnapshot } = await openContract('depth-page-switch');
        await runtime.service.handleRequest(
            productionDepthRequest('depth-page-switch', '5'),
            { emit: () => {} },
        );
        await vi.waitFor(() => expect(readDepthSnapshot.mock.calls.length).toBeGreaterThan(1));
        await runtime.service.handleRequest(productionRequest('depth-page-next'), {
            emit: () => {},
        });
        expect(runtime.service.current.depthRange).toBeNull();
        expect(readDepthSnapshot.mock.calls.at(-1)[0]).toMatchObject({ limit: 50 });
    });

    it('refuses a range stated by anyone but the subscription that owns the book', async () => {
        const { runtime } = await openContract('depth-page-owner');
        await expect(runtime.service.handleRequest(
            productionDepthRequest('someone-else', '5'),
            { emit: () => {} },
        )).rejects.toMatchObject({ code: 'DEPTH_OWNER_UNAVAILABLE' });
    });
});
