import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createFuturesProductionWorkstationRuntime,
    createFuturesProductionWorkstationRuntimeForTest,
} from './futures-production-workstation-composition.js';
import {
    createFuturesProductionWorkstationFakeTransport,
} from './futures-production-workstation-fake-transport.js';
import {
    createFuturesWorkstationFakeTransport,
} from './futures-workstation-fake-transport.js';
import {
    FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
} from './futures-production-workstation-fixtures.js';
import {
    FUTURES_PRODUCTION_WORKSTATION_FRESHNESS,
    FUTURES_PRODUCTION_WORKSTATION_HELD_CONTRACTS,
    FUTURES_PRODUCTION_WORKSTATION_WARMER,
    readFuturesProductionWorkstationHeldContracts,
} from './futures-production-workstation-service.js';
import { FUTURES_WORKSTATION_EVENT_MAX_BYTES } from '../../src/utils/futuresWorkstationProtocolShared.js';
import {
    createFuturesProductionWorkstationConfigureDepthRequest,
    createFuturesProductionWorkstationConfigureTapeRequest,
    createFuturesProductionWorkstationLoadCandleHistoryRequest,
    createFuturesProductionWorkstationSelectIntervalRequest,
    createFuturesProductionWorkstationSelectSymbolRequest,
    createFuturesProductionWorkstationSubscribeRequest,
    createFuturesProductionWorkstationUnsubscribeRequest,
} from '../../src/utils/futuresProductionWorkstationProtocol.js';

const runtimes = [];

afterEach(() => {
    while (runtimes.length) runtimes.pop().close();
    vi.restoreAllMocks();
});

// A step with no row count beside it is no reading at all, which is what a
// contract opened before any book has been drawn states. One row of a given step
// names the distance a single `range` used to.
const productionRequest = (requestId, symbol = 'BTCUSDT', interval = '1m', step, rows) => (
    JSON.stringify(createFuturesProductionWorkstationSubscribeRequest({
        requestId,
        symbol,
        interval,
        step,
        rows: step === undefined ? rows : (rows ?? 1),
    }))
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

// The reading, stated as the panel states it: a step and a row count. The
// distance the desk buys pages against is their product, so a single row of a
// given step names the same distance the old single `range` did.
const productionDepthRequest = (requestId, step, rows = 1) => JSON.stringify(
    createFuturesProductionWorkstationConfigureDepthRequest({ requestId, step, rows }),
);

const productionTradeFrame = ({
    symbol = 'BTCUSDT',
    cycle = 1,
    aggregateTradeId,
    price,
    quantity,
} = {}) => {
    const frame = JSON.parse(
        FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols[symbol].streams.makeCycle(cycle)[1],
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

    // The string measured against the byte ceiling used to be thrown away and
    // built again on the way out of the main process. On a real book that is
    // 0.15 ms a frame, ten frames a second, for a number the first serialization
    // already knew.
    it('hands the frame it measured to whatever delivers it', async () => {
        const runtime = track(createFuturesProductionWorkstationRuntime());
        const delivered = [];
        await runtime.service.handleRequest(productionRequest('service-serialized-once'), {
            emit: (event, frame) => delivered.push([event, frame]),
        });

        expect(delivered.length).toBeGreaterThan(0);
        for (const [event, frame] of delivered) {
            expect(typeof frame).toBe('string');
            expect(frame).toBe(JSON.stringify(event));
        }
    });

    // The first two of the five marks, taken where they can only be taken: the
    // exchange's own event time is on the frame, and "the main process received
    // it" is the moment before the desk reads it. A mark taken after the parse
    // would hide the wait the operator is actually asking about.
    it('hands over where a delivered frame came from and when it arrived', async () => {
        const runtime = track(createFuturesProductionWorkstationRuntime());
        const delivered = [];
        await runtime.service.handleRequest(productionRequest('service-marks-1'), {
            emit: (event, frame, timing) => delivered.push([event, frame, timing]),
        });
        const session = runtime.service.shown;

        // What is delivered before any stream frame has been read has no
        // upstream leg to state — the status line that opens the session and the
        // catalog come out of a REST read — and it says null rather than
        // inventing one. Everything after the first stream frame states where it
        // came from.
        expect(delivered.length).toBeGreaterThan(2);
        expect(delivered.slice(0, 2).map(([event, , timing]) => [event.resource, timing.marks]))
            .toEqual([['status', null], ['catalog', null]]);
        expect(delivered.slice(2).every(([, , timing]) => timing.marks !== null)).toBe(true);

        const before = delivered.length;
        const frame = JSON.parse(productionTradeFrame({ aggregateTradeId: 9_100_001 }));
        const exchangeAt = frame.data.E;
        runtime.service.handleStreamFrame(session, JSON.stringify(frame));
        runtime.service.emitTrades(session, 'live', { recordWindow: true });

        const [, text, timing] = delivered.at(-1);
        expect(delivered.length).toBeGreaterThan(before);
        expect(timing.marks.exchangeAt).toBe(exchangeAt);
        // Taken on this machine's clock, so it is comparable with every mark
        // after it; the exchange's is not, which is why only that one leg can
        // come out unknown.
        expect(timing.marks.receivedAt).toBeGreaterThanOrEqual(exchangeAt);
        expect(timing.frameBytes).toBe(Buffer.byteLength(text, 'utf8'));
    });

    // Measuring the string that is sent must not change what happens to a frame
    // too large to send: it is refused, and nothing is delivered.
    // A СТОРОЖ, not a finding, and worth saying so plainly: since the book
    // crosses as rows there is no payload the protocol accepts that can reach the
    // byte ceiling at all. Every resource is bounded well under it — 64 rows a
    // side here, 8 contracts in a catalog, 80 rows in a tape or a history page —
    // and `createFuturesProductionWorkstationEvent` validates before the frame is
    // measured, so an oversized payload is refused as INVALID_EVENT and never
    // reaches the byte check. The guard is kept because it is generic over
    // resources and costs one length comparison; what is asserted is the fact it
    // now rests on, which is that the largest legal frame is a fraction of the
    // ceiling rather than a hundred and eighteen kilobytes of it.
    it('sends the largest legal book far inside the byte ceiling', async () => {
        const runtime = track(createFuturesProductionWorkstationRuntime());
        const delivered = [];
        await runtime.service.handleRequest(productionRequest('service-oversized'), {
            emit: event => delivered.push(event),
        });
        const session = runtime.service.shown;
        const before = delivered.length;

        // The longest decimals the protocol accepts, in every field of every row
        // of a full-width book.
        const decimal = `1${'0'.repeat(30)}.${'1'.repeat(30)}`;
        const side = Array.from({ length: 64 }, () => Object.freeze({
            price: decimal,
            quantity: decimal,
            value: decimal,
            groupKey: '9'.repeat(64),
            whole: false,
        }));
        expect(runtime.service.emitResource(
            session,
            'depth',
            'live',
            Object.freeze({
                lastUpdateId: '1',
                step: null,
                bids: side,
                asks: side,
                spread: '0.01',
                reach: null,
            }),
        )).toBe(true);
        expect(delivered).toHaveLength(before + 1);
        // Measured, not reasoned about: 39 KiB against a ceiling of 256, where
        // the level-based delivery this replaces ran to 118 KiB on a book of
        // ordinary decimals — and this one is the pathological case.
        const bytes = Buffer.byteLength(JSON.stringify(delivered.at(-1)), 'utf8');
        expect(bytes).toBeLessThan(48 * 1024);
        expect(bytes * 5).toBeLessThan(FUTURES_WORKSTATION_EVENT_MAX_BYTES);
    });

    // And the payload rules are what refuse a wider book, ahead of the byte
    // check: a level count past the row bound is not a large frame, it is a frame
    // that does not describe a book this protocol carries.
    it('refuses a book wider than the rows the panel can draw', async () => {
        const runtime = track(createFuturesProductionWorkstationRuntime());
        await runtime.service.handleRequest(productionRequest('service-too-many-rows'), {
            emit: () => {},
        });
        const session = runtime.service.shown;
        const row = Object.freeze({
            price: '1',
            quantity: '1',
            value: '1',
            groupKey: '1',
        });
        const side = Array.from({ length: 65 }, () => row);
        let refusal = null;
        try {
            runtime.service.emitResource(session, 'depth', 'live', Object.freeze({
                lastUpdateId: '1',
                step: null,
                bids: side,
                asks: side,
                spread: '0.01',
                reach: null,
            }));
        } catch (error) {
            refusal = error;
        }
        expect(refusal?.code).toBe('INVALID_EVENT');
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
            // The contract is deliberately named: without it a held session's
            // rebuild cycle reads as the desk's own. It is an identity, not a
            // payload — the leak guard below still holds for everything else.
            symbol: 'BTCUSDT',
        }]);
        expect(JSON.stringify(timings)).not.toMatch(/price|payload|url|credential/i);
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
            symbol: 'BTCUSDT',
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
        expect(runtime.service.shown).not.toBeNull();
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
            tradable: true,
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
        expect(runtime.service.shown.generation).toBe(1);
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
        // The candles and nothing else: the session never leaves live for a
        // switch (2026-09-03).
        expect(switched.map(event => event.resource)).toEqual([
            'candles',
            'candles',
        ]);
        expect(switched.filter(event => event.resource === 'candles')
            .map(event => event.payload.series)).toEqual(['contract', 'index']);
        expect(switched.every(event => event.generation === 1)).toBe(true);
        expect(runtime.service.shown).toMatchObject({ generation: 1, interval: '5m' });
        expect(base.getActiveTimerCount()).toBe(1);
    });

    it('owns weekly live candles and history in the deterministic service', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        const fixture = FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT;
        const readCandleHistory = vi.fn(async () => fixture.contractKlines);
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: { ...base, readCandleHistory },
            clock: clock.clock,
        }));
        const events = [];

        await runtime.service.handleRequest(productionRequest('weekly-service', 'BTCUSDT', '1w'), {
            emit: event => events.push(event),
        });
        clock.advance(750);
        clock.runIntervals();
        await runtime.service.handleRequest(productionCandleHistoryRequest('weekly-service', {
            interval: '1w',
        }), { emit: event => events.push(event) });

        expect(runtime.service.shown).toMatchObject({
            requestId: 'weekly-service',
            symbol: 'BTCUSDT',
            interval: '1w',
        });
        expect(events.filter(event => event.resource === 'candles'))
            .not.toHaveLength(0);
        expect(events.filter(event => event.resource === 'candles')
            .every(event => event.payload.interval === '1w')).toBe(true);
        expect(readCandleHistory).toHaveBeenCalledWith(expect.objectContaining({
            symbol: 'BTCUSDT',
            interval: '1w',
            limit: 1_000,
        }));
        expect(events.filter(event => event.resource === 'candleHistory'))
            .toHaveLength(2);
        expect(events.filter(event => event.resource === 'candleHistory')
            .every(event => event.payload.interval === '1w')).toBe(true);
    });

    // The operator's crash: closing a stream whose socket was still in its
    // handshake threw out of `AbortController.abort()`, which is the first
    // statement of the teardown — so the streams stayed open, the timers stayed
    // armed, and the request that was supposed to start the next contract
    // rejected instead. Two contracts on one desk.
    //
    // Held at a bound of one, because this is a test about a release that goes
    // wrong and a pool only releases when it runs out of room. The same release
    // runs on eviction at any bound.
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
            heldContracts: 1,
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
        expect(runtime.service.shown).toMatchObject({ symbol: 'ETHUSDT' });
        expect(connect).toHaveBeenCalledTimes(2);
        expect(base.getActiveTimerCount()).toBe(1);
    });

    // The operator switching contracts faster than a bootstrap completes. Three
    // bootstraps are in flight at once, all of them finish, and only the last
    // selection may reach the desk. Under the pool this is the harder version of
    // the case: the two contracts left behind are not released, they go on
    // running and go on being right — and they still say nothing.
    it('lets only the last of three rapid selections reach the desk', async () => {
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
        // Each socket delivers a print of its own contract. Sending BTCUSDT's
        // frame down the ETHUSDT socket used to pass, because the session it
        // reached had already been released and ignored everything; now that the
        // pool keeps it, a frame for the wrong contract is a malformed frame and
        // resynchronizes the session — the right answer to a thing the transport
        // never does, and the wrong test.
        subscribers.get('BTCUSDT').onMessage(productionTradeFrame({ aggregateTradeId: 7001 }));
        subscribers.get('ETHUSDT').onMessage(productionTradeFrame({
            symbol: 'ETHUSDT',
            aggregateTradeId: 7002,
        }));

        expect(events.BTCUSDT).toHaveLength(abandoned.BTCUSDT);
        expect(events.ETHUSDT).toHaveLength(abandoned.ETHUSDT);
        expect(events.SOLUSDT.at(-1)).toMatchObject({
            symbol: 'SOLUSDT',
            resource: 'status',
            state: 'live',
        });
        expect(runtime.service.shown).toMatchObject({
            requestId: 'rapid-c',
            symbol: 'SOLUSDT',
            generation: 3,
        });
        // Three open streams and three freshness monitors: the contracts left
        // behind are held, not released, and each is keeping itself current.
        expect(runtime.service.sessions.size).toBe(3);
        expect(base.getActiveTimerCount()).toBe(3);
        expect(clock.intervalCount()).toBe(3);
        // And no timer is left armed to deliver a tape into an emitter that has
        // stopped being read.
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
        // A bound of one, because this test is about the timers of a session
        // that was released. A pool releases when it runs out of room; the
        // callbacks below are the same ones eviction leaves behind at any bound.
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock,
            heldContracts: 1,
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
        expect(runtime.service.shown).toMatchObject({
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

        // An abandoned switch states nothing: a switch never leaves live, so
        // there is no status to state for it (2026-09-03).
        expect(bEvents.map(event => event.resource)).toEqual([]);
        expect(cEvents.map(event => event.resource)).toEqual([
            'candles',
            'candles',
        ]);
        expect(cEvents.filter(event => event.resource === 'candles')
            .every(event => event.payload.interval === '15m')).toBe(true);
        expect(runtime.service.shown).toMatchObject({
            requestId: 'interval-c',
            interval: '15m',
            generation: 1,
        });
        expect(bootstrapInterval).toHaveBeenCalledTimes(2);
    });

    it('keeps weekly ownership when an abandoned interval bootstrap answers late', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const deferred = new Map();
        const bootstrapInterval = vi.fn(options => new Promise((resolve) => {
            deferred.set(options.interval, resolve);
        }));
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: { ...base, bootstrapInterval },
        }));
        await runtime.service.handleRequest(productionRequest('weekly-owner-base'), {
            emit: () => {},
        });

        const abandonedEvents = [];
        const weeklyEvents = [];
        const abandoned = runtime.service.handleRequest(
            productionIntervalRequest('weekly-owner-old', 'BTCUSDT', '5m'),
            { emit: event => abandonedEvents.push(event) },
        );
        await vi.waitFor(() => expect(deferred.has('5m')).toBe(true));
        const weekly = runtime.service.handleRequest(
            productionIntervalRequest('weekly-owner-current', 'BTCUSDT', '1w'),
            { emit: event => weeklyEvents.push(event) },
        );
        await vi.waitFor(() => expect(deferred.has('1w')).toBe(true));

        const fixture = FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT;
        const candleSnapshot = {
            contractKlines: fixture.contractKlines,
            indexKlines: fixture.indexKlines,
        };
        deferred.get('1w')(candleSnapshot);
        await weekly;
        deferred.get('5m')(candleSnapshot);
        await abandoned;

        expect(abandonedEvents.map(event => event.resource)).toEqual([]);
        expect(weeklyEvents.filter(event => event.resource === 'candles'))
            .toHaveLength(2);
        expect(weeklyEvents.filter(event => event.resource === 'candles')
            .every(event => event.payload.interval === '1w')).toBe(true);
        expect(runtime.service.shown).toMatchObject({
            requestId: 'weekly-owner-current',
            interval: '1w',
            generation: 1,
        });
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
        expect(runtime.service.shown).toMatchObject({
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
        expect(runtime.service.shown).toMatchObject({
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
        expect(runtime.service.shown).toMatchObject({ symbol: 'BTCUSDT' });
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

    it('bounds routine depth construction and retains only the newest trailing book', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('depth-bounded'), {
            emit: event => events.push(event),
        });
        const session = runtime.service.shown;
        const renderAt = [];
        const render = session.orderBook.toRendererRows.bind(session.orderBook);
        vi.spyOn(session.orderBook, 'toRendererRows').mockImplementation((options) => {
            renderAt.push(manual.clock.now());
            return render(options);
        });
        const settled = events.length;

        manual.advance(200);
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(1)[0],
        );
        expect(renderAt).toEqual([1_784_000_001_200]);

        manual.advance(50);
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(2)[0],
        );
        const firstPending = session.pendingDepthDelivery;
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(3)[0],
        );
        expect(session.pendingDepthDelivery).not.toBe(firstPending);
        expect(session.pendingDepthDelivery).toMatchObject({
            requestId: 'depth-bounded',
            generation: 1,
        });
        expect(manual.timeoutCount()).toBe(1);
        expect(renderAt).toHaveLength(1);

        manual.advance(149);
        manual.runTimeouts();
        expect(renderAt).toHaveLength(1);
        expect(manual.timeoutCount()).toBe(1);
        manual.advance(1);
        manual.runTimeouts();

        const depth = events.slice(settled).filter(event => event.resource === 'depth');
        expect(depth).toHaveLength(2);
        expect(depth.map(event => event.observedAt)).toEqual([
            1_784_000_001_200,
            1_784_000_001_400,
        ]);
        expect(depth.at(-1).payload.lastUpdateId).toBe('1004');
        expect(renderAt).toEqual([1_784_000_001_200, 1_784_000_001_400]);
        expect(session.pendingDepthDelivery).toBeNull();
        expect(session.pendingDepthTimer).toBeNull();
    });

    it('delivers stale and recovered depth immediately ahead of a pending routine book', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        const snapshot = JSON.parse(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.depthSnapshot,
        );
        const readDepthSnapshot = vi.fn(async (options) => (
            readDepthSnapshot.mock.calls.length === 1
                ? base.readDepthSnapshot(options)
                : JSON.stringify({ ...snapshot, lastUpdateId: 1006 })
        ));
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            transport: {
                ...base,
                readDepthSnapshot,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('depth-recovery-now'), {
            emit: event => events.push(event),
        });
        const session = runtime.service.shown;

        manual.advance(200);
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(1)[0],
        );
        manual.advance(50);
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(2)[0],
        );
        expect(session.pendingDepthDelivery).not.toBeNull();

        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(4)[0],
        );
        expect(events.at(-1)).toMatchObject({
            resource: 'depth',
            state: 'stale',
            observedAt: 1_784_000_001_250,
        });
        expect(session.pendingDepthDelivery).toBeNull();
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(5)[0],
        );
        manual.advance(50);
        manual.runTimeouts();

        await vi.waitFor(() => expect(events.at(-1)).toMatchObject({
            resource: 'depth',
            state: 'live',
            observedAt: 1_784_000_001_300,
        }));
        expect(events.at(-1).payload.lastUpdateId).toBe('1006');
        expect(readDepthSnapshot).toHaveBeenCalledTimes(2);
    });

    // Immediacy belongs to the change of state, not to the state. A book whose
    // shortfall stands — a band bought at the deepest page and short of the rows
    // reports the same shortfall for the rest of the session — is stale on every
    // diff, and keying the bypass on the state's value let that book skip the
    // bound entirely: a full-book sort ten times a second, for as long as the
    // contract stayed open, in exactly the loaded regime the bound was built for.
    it('keeps a book that stays stale on the routine bound after the transition is stated', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('depth-standing-stale'), {
            emit: event => events.push(event),
        });
        const session = runtime.service.shown;
        const renderAt = [];
        const render = session.orderBook.toRendererRows.bind(session.orderBook);
        vi.spyOn(session.orderBook, 'toRendererRows').mockImplementation((options) => {
            renderAt.push(manual.clock.now());
            return render(options);
        });
        const settled = events.length;
        // The standing regime itself: a gap being recovered on its cooldown,
        // so the stale state stands for every diff that follows. Stated at
        // the one seam that decides it, rather than by arranging a gap.
        vi.spyOn(runtime.service, 'depthDeliveryState').mockReturnValue('stale');

        // The diff on which the book BECOMES stale is operational news and is
        // delivered on its own instant, not behind the bound.
        manual.advance(200);
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(1)[0],
        );
        expect(events.at(-1)).toMatchObject({
            resource: 'depth',
            state: 'stale',
            observedAt: 1_784_000_001_200,
        });
        expect(renderAt).toEqual([1_784_000_001_200]);

        // The diffs on which the book merely STAYS stale are routine deliveries:
        // one replaceable pending slot, newest book wins, nothing rendered until
        // the trailing instant.
        manual.advance(50);
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(2)[0],
        );
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(3)[0],
        );
        expect(renderAt).toHaveLength(1);
        expect(session.pendingDepthDelivery).toMatchObject({
            requestId: 'depth-standing-stale',
            generation: 1,
            state: 'stale',
        });
        expect(manual.timeoutCount()).toBe(1);

        manual.advance(150);
        manual.runTimeouts();
        const depth = events.slice(settled).filter(event => event.resource === 'depth');
        expect(depth.map(event => event.observedAt)).toEqual([
            1_784_000_001_200,
            1_784_000_001_400,
        ]);
        expect(depth.map(event => event.state)).toEqual(['stale', 'stale']);
        expect(depth.at(-1).payload.lastUpdateId).toBe('1004');
        expect(renderAt).toEqual([1_784_000_001_200, 1_784_000_001_400]);
        expect(session.pendingDepthDelivery).toBeNull();
        expect(session.pendingDepthTimer).toBeNull();
    });

    // The other half of the same rule, pinned in the direction the test above
    // cannot see: a transition that lands INSIDE the bound window must not
    // wait for it. The test above states its transition at exactly the bound,
    // where the routine path would also have emitted — so the bypass could be
    // deleted outright and every assertion there would still hold.
    it('states a mid-window stale transition on its own instant, not the bound', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('depth-midwindow-stale'), {
            emit: event => events.push(event),
        });
        const session = runtime.service.shown;
        const settled = events.length;

        // A routine live delivery arms the bound.
        manual.advance(200);
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(1)[0],
        );
        expect(events.at(-1)).toMatchObject({
            resource: 'depth',
            state: 'live',
            observedAt: 1_784_000_001_200,
        });

        // Fifty milliseconds later — deep inside the window — a gap recovery
        // sets in and the next diff finds the book stale. That is a change of
        // delivery state: operational news, delivered now.
        manual.advance(50);
        vi.spyOn(runtime.service, 'depthDeliveryState').mockReturnValue('stale');
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(2)[0],
        );
        expect(events.at(-1)).toMatchObject({
            resource: 'depth',
            state: 'stale',
            observedAt: 1_784_000_001_250,
        });
        expect(events.at(-1).payload.lastUpdateId).toBe('1003');
        expect(session.pendingDepthDelivery).toBeNull();
        expect(session.pendingDepthTimer).toBeNull();

        // And nothing rides behind it: the bypass emptied the slot, so the
        // bound instant delivers no second copy.
        manual.advance(150);
        manual.runTimeouts();
        const depth = events.slice(settled).filter(event => event.resource === 'depth');
        expect(depth.map(event => event.observedAt)).toEqual([
            1_784_000_001_200,
            1_784_000_001_250,
        ]);
    });

    it('discards a pending routine depth delivery when its owner is released', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('depth-release-pending'), {
            emit: event => events.push(event),
        });
        const session = runtime.service.shown;
        subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(1)[0],
        );
        expect(session.pendingDepthDelivery).not.toBeNull();
        const delivered = events.length;

        await runtime.service.handleRequest(JSON.stringify(
            createFuturesProductionWorkstationUnsubscribeRequest({
                requestId: 'depth-release-pending',
            }),
        ), { emit: event => events.push(event) });
        expect(session.pendingDepthDelivery).toBeNull();
        expect(session.pendingDepthTimer).toBeNull();
        manual.advance(200);
        manual.runTimeouts();
        expect(events).toHaveLength(delivered);
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

    // 2026-08-28, live: the desk's first unicode listing (龙虾USDT) pumped, its
    // book crossed — a fault the book answers with a quiet rebuild — and the
    // whole workspace left `live` instead, every 20 to 60 seconds. The catch
    // routed by the stream's NAME, read in ASCII, so every book fault on a
    // listing the exchange spells in its own alphabet escalated from the book
    // to the session. These drive the exact wire the desk saw: raw-unicode
    // stream names on a live session, from the fixture renamed to the listing.
    describe('a book fault costs the book, not the session', () => {
        const LISTING_SYMBOL = '龙虾USDT';

        const renameFixtureValue = (value, rename) => {
            if (typeof value === 'string') return rename(value);
            if (typeof value === 'function') {
                return (...args) => renameFixtureValue(value(...args), rename);
            }
            if (Array.isArray(value)) {
                return value.map(item => renameFixtureValue(item, rename));
            }
            if (value && typeof value === 'object') {
                return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
                    key,
                    renameFixtureValue(entry, rename),
                ]));
            }
            return value;
        };

        const listingFixture = () => {
            const rename = text => text
                .replaceAll('BTCUSDT', LISTING_SYMBOL)
                .replaceAll('btcusdt', LISTING_SYMBOL.toLowerCase());
            const { BTCUSDT, ...untouched } = FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols;
            return {
                ...FUTURES_PRODUCTION_WORKSTATION_FIXTURE,
                catalog: rename(FUTURES_PRODUCTION_WORKSTATION_FIXTURE.catalog),
                symbols: { ...untouched, [LISTING_SYMBOL]: renameFixtureValue(BTCUSDT, rename) },
            };
        };

        const listingRuntime = () => {
            const clock = createManualClock();
            const base = createFuturesWorkstationFakeTransport({
                fixture: listingFixture(),
                clock: clock.clock,
            });
            let subscriber;
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
            return { runtime, faults, frame: raw => subscriber.onMessage(raw) };
        };

        // A diff in sequence with the live book whose bid stands above every
        // ask: `applyDelta` applies it, reads the cross, and throws the book's
        // own refusal out of `push`.
        const crossingDepthFrame = (symbol, lastUpdateId) => {
            const next = Number(lastUpdateId) + 1;
            return JSON.stringify({
                stream: `${symbol.toLowerCase()}@depth@100ms`,
                data: {
                    e: 'depthUpdate',
                    E: 1_784_000_060_200,
                    T: 1_784_000_060_200,
                    s: symbol,
                    U: next,
                    u: next,
                    pu: Number(lastUpdateId),
                    b: [['999999.00', '5.00000000']],
                    a: [],
                    ps: symbol,
                    st: 1,
                },
            });
        };

        it('recovers the book when it crosses on a unicode listing, and keeps the session', async () => {
            const { runtime, faults, frame } = listingRuntime();
            const events = [];
            await runtime.service.handleRequest(productionRequest('listing-cross', LISTING_SYMBOL), {
                emit: event => events.push(event),
            });
            expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
            const settled = events.length;
            const session = runtime.service.shown;

            frame(crossingDepthFrame(LISTING_SYMBOL, session.orderBook.lastUpdateId));

            expect(faults).toContainEqual(expect.objectContaining({
                phase: 'stream', code: 'CROSSED_ORDER_BOOK', symbol: LISTING_SYMBOL,
            }));
            expect(faults).toContainEqual(expect.objectContaining({
                phase: 'book-recovery', code: 'CROSSED_ORDER_BOOK', symbol: LISTING_SYMBOL,
            }));
            expect(events.slice(settled).map(event => event.state ?? null))
                .not.toContain('resynchronizing');
            expect(session.reconnectTimer).toBeNull();
        });

        it('recovers the book when a depth frame for a unicode listing cannot be read', async () => {
            const { runtime, faults, frame } = listingRuntime();
            const events = [];
            await runtime.service.handleRequest(productionRequest('listing-refused', LISTING_SYMBOL), {
                emit: event => events.push(event),
            });
            expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
            const settled = events.length;

            frame(JSON.stringify({
                stream: `${LISTING_SYMBOL.toLowerCase()}@depth@100ms`,
                data: {
                    e: 'depthUpdate',
                    E: 1_784_000_060_200,
                    T: 1_784_000_060_200,
                    s: LISTING_SYMBOL,
                    U: 9_000,
                    u: 9_001,
                    pu: 8_999,
                    b: 'not-a-ladder',
                    a: [],
                    ps: LISTING_SYMBOL,
                    st: 1,
                },
            }));

            expect(faults).toContainEqual({
                phase: 'book-recovery', code: 'MALFORMED_DEPTH_FRAME', symbol: LISTING_SYMBOL,
            });
            expect(events.slice(settled).map(event => event.state ?? null))
                .not.toContain('resynchronizing');
            expect(runtime.service.shown.reconnectTimer).toBeNull();
        });

        // The routing is by the error's identity, not the stream's spelling:
        // an ASCII major's crossed book now recovers under the fault's own
        // name rather than the generic malformed-frame one.
        it('names the cross on an ASCII contract instead of a generic refusal', async () => {
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
            await runtime.service.handleRequest(productionRequest('ascii-cross'), {
                emit: event => events.push(event),
            });
            const session = runtime.service.shown;

            subscriber.onMessage(crossingDepthFrame('BTCUSDT', session.orderBook.lastUpdateId));

            expect(faults).toContainEqual(expect.objectContaining({
                phase: 'book-recovery', code: 'CROSSED_ORDER_BOOK', symbol: 'BTCUSDT',
            }));
            expect(events.at(-1)).not.toMatchObject({ state: 'resynchronizing' });
        });
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
            { phase: 'stream-frame', code: 'STREAM_FRAME_REFUSED', symbol: 'BTCUSDT' },
            { phase: 'stream-frame', code: 'STREAM_FRAME_REFUSED', symbol: 'BTCUSDT' },
        ]);

        // The window is the session's own clock, which moves when the session
        // observes the market — five seconds of it is five seconds of frames.
        clock.advance(5_000);
        subscriber.onMessage(productionTradeFrame({ cycle: 3, aggregateTradeId: 5_003 }));
        subscriber.onFrameRefused('STREAM_FRAME_REFUSED');

        const stated = events
            .slice(settled)
            .filter(event => event.payload?.reasonCode === 'STREAM_FRAME_REFUSED');
        expect(stated).toHaveLength(2);
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
        expect(depth).toHaveLength(TICKS / 2);
        expect(burst.every(event => event.state === 'live')).toBe(true);
        expect(burst.every(event => event.generation === 1)).toBe(true);
        expect(faults).toEqual([]);
        expect(runtime.service.shown).toMatchObject({
            symbol: 'BTCUSDT',
            generation: 1,
            bootstrapped: true,
            reconnectTimer: null,
        });
        expect(runtime.service.shown.staleResources.size).toBe(0);
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
    // A hundred ticks of two thousand levels a side with twenty prints on each
    // is the heaviest case in this file by an order of magnitude: it takes six
    // to nine seconds on an idle machine, against vitest's five-second default,
    // and twenty-two seconds measured beside a loaded suite on 2026-08-16. The
    // default was never chosen for it. Nothing this case asserts is relaxed by
    // the number — it only gets to finish counting.
    }, 30_000);

    // The reason line holds what it was last given. A refusal that was stated
    // and then repaired would name a condition that is over for the rest of the
    // session.
    it('takes a refused frame off the reason line once the book is whole', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        const parsedSnapshot = JSON.parse(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.depthSnapshot,
        );
        // The rebuilt book is read at a snapshot ahead of every diff the desk has
        // seen, which is what a rebuild on a quiet book looks like.
        const readDepthSnapshot = vi.fn(async options => (
            readDepthSnapshot.mock.calls.length === 1
                ? base.readDepthSnapshot(options)
                : JSON.stringify({ ...parsedSnapshot, lastUpdateId: 1_005 })
        ));
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            transport: {
                ...base,
                readDepthSnapshot,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('refusal-cleared'), {
            emit: event => events.push(event),
        });
        subscriber.onFrameRefused('STREAM_FRAME_REFUSED');
        expect(events.at(-1)).toMatchObject({
            state: 'live',
            payload: { reasonCode: 'STREAM_FRAME_REFUSED' },
        });

        // The frame the desk dropped left a gap, and the book rebuilds itself
        // around it without touching the session.
        const recovery = runtime.service.recoverBook(
            runtime.service.shown,
            'DEPTH_SEQUENCE_GAP',
        );
        await vi.waitFor(() => expect(clock.timeoutCount()).toBe(1));
        clock.runTimeouts();
        await recovery;

        expect(events.at(-1)).toMatchObject({
            resource: 'status',
            state: 'live',
            payload: { connected: true, reasonCode: null },
        });
        // Said once: a second rebuild has nothing left to take off the line.
        const settled = events.length;
        runtime.service.shown.bookRecoveredAt = null;
        const second = runtime.service.recoverBook(
            runtime.service.shown,
            'DEPTH_SEQUENCE_GAP',
        );
        await vi.waitFor(() => expect(clock.timeoutCount()).toBe(1));
        clock.runTimeouts();
        await second;
        expect(events.slice(settled).some(event => event.resource === 'status')).toBe(false);
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
        expect(runtime.service.shown.pendingEvents).toHaveLength(0);
        expect(runtime.service.shown.trades).toHaveLength(128);
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
        expect(runtime.service.shown.lastTradesAt).toBe(clock.clock.now() - 250);
        expect(runtime.service.shown.staleResources.has('trades')).toBe(false);
    });

    // The minimum notional is a setting about the tape. The last traded price is
    // not a display of anything — it is what the contract traded at — and a desk
    // set to "≥ 25 USDT" watched a frozen number while the market ran under it.
    it('moves the last price on a print the tape filter drops, at a bounded rate', async () => {
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
        await runtime.service.handleRequest(productionRequest('tape-last-price'), {
            emit: event => events.push(event),
        });
        await runtime.service.handleRequest(productionTapeRequest('tape-last-price', {
            minNotionalUsdt: '25',
        }), { emit: event => events.push(event) });
        const tapeFrames = () => events.filter(event => event.resource === 'trades').length;
        const lastHeader = () => events.filter(event => event.resource === 'header').at(-1);
        const tapeFramesBefore = tapeFrames();

        // 24.75 USDT: under the operator's minimum, so the tape never sees it.
        subscriber.onMessage(productionTradeFrame({
            cycle: 1,
            aggregateTradeId: 4001,
            price: '99',
            quantity: '0.25',
        }));
        expect(tapeFrames()).toBe(tapeFramesBefore);
        expect(lastHeader().payload).toMatchObject({ lastPrice: '99', lastQuantity: '0.25' });

        // Bounded: a burst inside one window states one price, not one each.
        const headerFrames = events.filter(event => event.resource === 'header').length;
        clock.advance(50);
        subscriber.onMessage(productionTradeFrame({
            cycle: 2,
            aggregateTradeId: 4002,
            price: '98',
            quantity: '0.25',
        }));
        expect(events.filter(event => event.resource === 'header')).toHaveLength(headerFrames);

        clock.advance(200);
        subscriber.onMessage(productionTradeFrame({
            cycle: 3,
            aggregateTradeId: 4003,
            price: '97',
            quantity: '0.25',
        }));
        expect(lastHeader().payload).toMatchObject({ lastPrice: '97' });
    });

    // A print is the one frame that can arrive before the header exists — the
    // mark and the ticker are what build it. Moving a header that is not there
    // raises, and a raise on a stream frame resynchronizes the whole workspace:
    // an ordinary trade would have taken the desk off the market.
    it('lets a print arrive before there is a header to move', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        const faults = [];
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
            onInternalError: fault => faults.push(fault),
        }));
        const events = [];
        await runtime.service.handleRequest(productionRequest('headerless-print'), {
            emit: event => events.push(event),
        });
        // The state a session is in before its bootstrap has built one.
        runtime.service.shown.header = null;
        const settled = events.length;

        subscriber.onMessage(productionTradeFrame({
            cycle: 1,
            aggregateTradeId: 4101,
            price: '99',
            quantity: '5',
        }));

        expect(faults).toEqual([]);
        expect(runtime.service.shown.header).toBeNull();
        expect(events.slice(settled).every(event => event.resource !== 'header')).toBe(true);
        // The tape took it, which is what proves the frame was handled and not
        // dropped on the floor by a raise.
        expect(events.slice(settled).some(event => event.resource === 'trades')).toBe(true);
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
        expect(runtime.service.shown.staleResources.has('trades')).toBe(false);
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

        expect(runtime.service.shown.pendingTapeTimer).not.toBeNull();
        expect(clock.timeoutCount()).toBe(1);
        subscriber.onDisconnect('SOCKET_CLOSED');

        expect(runtime.service.shown.pendingTapeTimer).toBeNull();
        expect(runtime.service.shown.pendingTapeEmission).toBe(false);
        // The only remaining timeout belongs to the reconnect, not the tape.
        expect(clock.timeoutCount()).toBe(1);
        clock.runTimeouts();
        await vi.waitFor(() => expect(runtime.service.shown.generation).toBe(2));
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
        expect(runtime.service.shown).not.toBeNull();
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
    ])('keeps trying after the %s session exhausts its reconnect attempts', async (
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
        runtime.service.shown.reconnectAttempt
            = FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_ATTEMPTS;
        subscriber.onDisconnect('SOCKET_DISCONNECTED');
        expect(events.at(-1)).toMatchObject({
            resource: 'status',
            state: 'unavailable',
            payload: { reasonCode: 'RECONNECT_EXHAUSTED' },
        });
        expect(close).toHaveBeenCalledOnce();
        // The outage that exhausts the ladder is the ordinary length of a proxy
        // restart. The session stays, and another attempt is already armed.
        expect(runtime.service.shown).not.toBeNull();
        expect(clock.timeoutCount()).toBe(1);

        // The route comes back while the session is asking on the last rung.
        clock.runTimeouts();
        await vi.waitFor(() => {
            expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
        });
        // And the fast ladder is available again for the next interruption.
        expect(runtime.service.shown.reconnectAttempt).toBe(0);
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
        ],
    ])('does not call a %s attempt past the ceiling a loading one', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const clock = createManualClock();
        const base = createBase({ clock: clock.clock });
        let subscriber;
        const transport = {
            ...base,
            connect: (options) => {
                subscriber = options;
                return base.connect(options);
            },
        };
        const runtime = track(createRuntime({ transport, clock: clock.clock }));
        const events = [];
        await runtime.service.handleRequest(createRequest('ceiling-loading'), {
            emit: event => events.push(event),
        });
        runtime.service.shown.reconnectAttempt
            = FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_ATTEMPTS;
        subscriber.onDisconnect('SOCKET_DISCONNECTED');
        const statedExhausted = events.length;

        clock.runTimeouts();
        await vi.waitFor(() => {
            expect(events.at(-1)).toMatchObject({ resource: 'status', state: 'live' });
        });

        // The chart notice and its retry are drawn from `unavailable`, so a
        // `loading` between two attempts on the last rung takes both away and
        // gives them back — for as long as the attempt takes to fail, which is
        // up to a socket handshake timeout when the route hangs rather than
        // refuses.
        const statesAfter = events
            .slice(statedExhausted)
            .filter(event => event.resource === 'status')
            .map(event => event.state);
        expect(statesAfter).not.toContain('loading');
        expect(statesAfter[0]).toBe('unavailable');
        expect(events[statedExhausted - 1]).toMatchObject({
            resource: 'status',
            state: 'unavailable',
            payload: { reasonCode: 'RECONNECT_EXHAUSTED' },
        });
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
        ],
    ])('holds the %s reconnect attempt at its ceiling while the route stays gone', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const clock = createManualClock();
        const base = createBase({ clock: clock.clock });
        let subscriber;
        const transport = {
            ...base,
            connect: (options) => {
                subscriber = options;
                return base.connect(options);
            },
        };
        const runtime = track(createRuntime({ transport, clock: clock.clock }));
        await runtime.service.handleRequest(createRequest('ceiling-reconnect'), {
            emit: () => {},
        });
        const { RECONNECT_ATTEMPTS } = FUTURES_PRODUCTION_WORKSTATION_FRESHNESS;
        const started = [];
        const startGeneration = runtime.service.startGeneration.bind(runtime.service);
        runtime.service.startGeneration = (request, emit, attempt) => {
            started.push(attempt);
            return startGeneration(request, emit, attempt);
        };
        // A session that spends an afternoon without a route must not count its
        // attempts upwards: the number is only ever compared against the ceiling.
        runtime.service.shown.reconnectAttempt = RECONNECT_ATTEMPTS + 5;
        subscriber.onDisconnect('SOCKET_DISCONNECTED');
        clock.runTimeouts();
        await vi.waitFor(() => {
            expect(started).toHaveLength(1);
        });
        expect(started[0]).toBe(RECONNECT_ATTEMPTS);
    });

    it.each([
        [
            'production',
            createFuturesProductionWorkstationFakeTransport,
            createFuturesProductionWorkstationRuntimeForTest,
            productionRequest,
        ],
    ])('stops the %s attempts when the contract is released', async (
        _label,
        createBase,
        createRuntime,
        createRequest,
    ) => {
        const clock = createManualClock();
        const base = createBase({ clock: clock.clock });
        let subscriber;
        const transport = {
            ...base,
            connect: (options) => {
                subscriber = options;
                return base.connect(options);
            },
        };
        const runtime = track(createRuntime({ transport, clock: clock.clock }));
        await runtime.service.handleRequest(createRequest('released-reconnect'), {
            emit: () => {},
        });
        runtime.service.shown.reconnectAttempt
            = FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_ATTEMPTS;
        subscriber.onDisconnect('SOCKET_DISCONNECTED');
        expect(clock.timeoutCount()).toBe(1);

        // The guarantee the old halt provided, which this change must keep: a
        // session nobody wants any more arms nothing.
        runtime.service.stop();
        expect(runtime.service.shown).toBeNull();
        expect(clock.timeoutCount()).toBe(0);
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
        expect(runtime.service.shown.reconnectAttempt).toBe(0);
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

        it('answers history the shown owner cannot serve with one typed unavailable outcome', async () => {
            const { runtime } = await historyRuntime('history-owner', {
                readCandleHistory: async () => historyKlines(10),
            });

            for (const overrides of [
                { requestId: 'history-someone-else' },
                { symbol: 'ETHUSDT' },
                { interval: '15m' },
            ]) {
                const emitted = [];
                await runtime.service.handleRequest(
                    productionCandleHistoryRequest('history-owner', overrides),
                    { emit: (outcome, frame) => emitted.push({ outcome, frame }) },
                );

                expect(emitted).toHaveLength(1);
                expect(emitted[0].outcome).toMatchObject({
                    type: 'futures.production.workstation.history-outcome',
                    action: 'futures.production.workstation.load-candle-history',
                    requestId: overrides.requestId ?? 'history-owner',
                    symbol: overrides.symbol ?? 'BTCUSDT',
                    interval: overrides.interval ?? '1m',
                    endTime: 1_784_000_000_000,
                    outcome: 'unavailable',
                    reasonCode: 'CANDLE_HISTORY_OWNER_UNAVAILABLE',
                });
                expect(emitted[0].outcome).not.toHaveProperty('generation');
                expect(JSON.parse(emitted[0].frame)).toEqual(emitted[0].outcome);
            }
        });

        // Saying nothing left the renderer holding its request forever: one
        // failed read disabled scrolling left for the rest of the session, with
        // nothing on screen to say why. The failure answers the request it
        // belongs to, and is `unavailable` rather than `live` so an empty page
        // of it is never read as the exchange saying there is nothing older.
        it('states a read that failed and leaves the live session alone', async () => {
            const { runtime, events } = await historyRuntime('history-failure', {
                readCandleHistory: async () => {
                    throw new Error('network down');
                },
            });

            await runtime.service.handleRequest(productionCandleHistoryRequest('history-failure'), {
                emit: event => events.push(event),
            });

            expect(events).toMatchObject([{
                resource: 'candleHistory',
                state: 'unavailable',
                payload: { series: 'contract', interval: '1m', complete: true, total: 0, rows: [] },
            }]);
            // The failure carries the read it answers, so a renderer holding one
            // request can tell it from the answer to a request it abandoned.
            expect(events[0].payload.endTime).toBe(1_784_000_000_000);
            // A failed history read is never a reason to resync a healthy
            // session, and it writes nothing to the live window.
            expect(runtime.service.shown.requestId).toBe('history-failure');
            expect(events.some(event => event.resource === 'candles')).toBe(false);
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

// The exchange's protocol reads the book once and maintains it from the diff
// stream; a REST read again is for a proven gap and nothing else. The desk used
// to buy the page again when the rows on screen reached past it or the market
// walked out of it — 34 rebuilds in one evening on AKEUSDT without a single
// sequence gap (2026-09-02). It reads the deepest page once, and never for the
// rows.
describe('the book is one page and then the stream', () => {
    const openContract = async (requestId, range) => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const readDepthSnapshot = vi.fn(options => base.readDepthSnapshot(options));
        const faults = [];
        const events = [];
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: { ...base, readDepthSnapshot },
            onInternalError: fault => faults.push(fault),
        }));
        await runtime.service.handleRequest(
            productionRequest(requestId, 'BTCUSDT', '1m', range),
            { emit: event => events.push(event) },
        );
        return { runtime, readDepthSnapshot, faults, events };
    };
    const depthEvents = events => events.filter(event => event.resource === 'depth');

    it('opens a contract at the deepest page one read returns', async () => {
        const { readDepthSnapshot } = await openContract('one-page-open');
        expect(readDepthSnapshot).toHaveBeenCalledOnce();
        expect(readDepthSnapshot.mock.calls[0][0]).toMatchObject({ limit: 1_000 });
    });

    it('opens at the same page whatever reading is stated', async () => {
        const { readDepthSnapshot } = await openContract('one-page-reading', '10');
        await Promise.resolve();
        expect(readDepthSnapshot).toHaveBeenCalledOnce();
        expect(readDepthSnapshot.mock.calls[0][0]).toMatchObject({ limit: 1_000 });
    });

    // The bite of 2026-09-02: fifty `DEPTH_RANGE_SHORT` reads in one evening,
    // each colliding with the diffs in flight. A coarse step is answered from
    // the book in hand, live, and asks the exchange for nothing.
    it('buys nothing when the rows reach past what the snapshot proved', async () => {
        const { runtime, readDepthSnapshot, faults, events } = await openContract('one-page-coarse');
        await runtime.service.handleRequest(
            productionDepthRequest('one-page-coarse', '5'),
            { emit: event => events.push(event) },
        );
        await Promise.resolve();
        expect(readDepthSnapshot).toHaveBeenCalledOnce();
        expect(faults).toEqual([]);
        expect(depthEvents(events).at(-1)).toMatchObject({ state: 'live' });
        expect(depthEvents(events).at(-1).payload.bids.length).toBeGreaterThan(0);
    });

    it('states the reach on the first delivery', async () => {
        const { runtime, events } = await openContract('one-page-reach');
        const { reach } = runtime.service.depthView(runtime.service.shown);
        expect(reach).toMatchObject({ below: expect.any(String), above: expect.any(String) });
        expect(Number(reach.below)).toBeGreaterThan(0);
        expect(Number(reach.above)).toBeGreaterThan(0);
        expect(depthEvents(events)[0].payload.reach).toEqual(reach);
    });

    // A contract the desk is already running is selected, not opened: the book
    // it holds was correct a moment ago, and the exchange is not asked for
    // anything to show it again.
    it('reads nothing when a contract it already holds is subscribed to again', async () => {
        const { runtime, readDepthSnapshot } = await openContract('depth-page-again');
        await runtime.service.handleRequest(
            productionDepthRequest('depth-page-again', '0.5'),
            { emit: () => {} },
        );
        await Promise.resolve();
        expect(readDepthSnapshot).toHaveBeenCalledOnce();

        await runtime.service.handleRequest(productionRequest('depth-page-again-2'), {
            emit: () => {},
        });
        await Promise.resolve();

        expect(runtime.service.shown).toMatchObject({
            requestId: 'depth-page-again-2',
            depthRange: '0.5',
        });
        expect(readDepthSnapshot).toHaveBeenCalledOnce();
    });

    it('refuses a range stated by anyone but the subscription that owns the book', async () => {
        const { runtime } = await openContract('depth-page-owner');
        await expect(runtime.service.handleRequest(
            productionDepthRequest('someone-else', '5'),
            { emit: () => {} },
        )).rejects.toMatchObject({ code: 'DEPTH_OWNER_UNAVAILABLE' });
    });
});

// The rows beyond the page say so. A snapshot proves a stretch of price; past
// it the book holds what the stream has restated and is silent about the rest.
// The desk used to buy a deeper page for those rows and badge the book stale
// until it landed. It draws them from the book in hand, live, marked per row.
describe('the rows beyond the page say so', () => {
    // The deterministic fixture returns the same forty-eight levels whatever page
    // is asked for. This one prices its page by the limit it is asked for, which
    // is what the exchange does: a thousand levels five cents apart reach fifty
    // past the best price.
    const pagedTransport = () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const template = JSON.parse(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.depthSnapshot,
        );
        const cents = value => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
        const mid = 5_844_500n;
        let reads = 0;
        const readDepthSnapshot = vi.fn(async ({ limit } = {}) => {
            reads += 1;
            return JSON.stringify({
                ...template,
                lastUpdateId: template.lastUpdateId + ((reads - 1) * 1_000_000),
                bids: Array.from({ length: limit }, (_, index) => [
                    cents(mid - (BigInt(index) + 1n) * 5n),
                    '1.00000000',
                ]),
                asks: Array.from({ length: limit }, (_, index) => [
                    cents(mid + (BigInt(index) + 1n) * 5n),
                    '1.00000000',
                ]),
            });
        });
        return {
            readDepthSnapshot,
            transport: { ...base, readDepthSnapshot },
            pages: () => readDepthSnapshot.mock.calls.map(call => call[0].limit),
        };
    };

    const openContract = async (requestId, range) => {
        const { readDepthSnapshot, transport, pages } = pagedTransport();
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({ transport }));
        const events = [];
        await runtime.service.handleRequest(
            productionRequest(requestId, 'BTCUSDT', '1m', range),
            { emit: event => events.push(event) },
        );
        return { runtime, events, readDepthSnapshot, pages };
    };

    const depthEvents = events => events.filter(event => event.resource === 'depth');

    it('draws a coarse step live from the page in hand, every row it can fill whole', async () => {
        const { runtime, events, pages } = await openContract('beyond-page');
        await runtime.service.handleRequest(
            productionDepthRequest('beyond-page', '5'),
            { emit: event => events.push(event) },
        );
        const delivered = depthEvents(events).at(-1);
        expect(pages()).toEqual([1_000]);
        expect(delivered.state).toBe('live');
        expect(delivered.payload.bids.length).toBeGreaterThan(0);
        expect(delivered.payload.asks.length).toBeGreaterThan(0);
        // A thousand levels five cents apart reach fifty; rows of five inside
        // that are whole, and the panel is not asked to wait for a deeper page.
        expect(delivered.payload.bids.every(row => row.whole === true)).toBe(true);
    });

    it('reads one page for a contract, whatever its reading, and nothing after', async () => {
        const { events, pages } = await openContract('beyond-page-open', '10');
        await Promise.resolve();
        expect(pages()).toEqual([1_000]);
        expect(depthEvents(events).at(-1).state).toBe('live');
    });
});

// The reading decided which page to buy and was then ignored when deciding what
// to send: a thousand levels a side crossed to draw forty rows, ten times a
// second. The book keeps its depth in this process; only the delivery is bounded.
describe('the reading bounds what the desk delivers', () => {
    const openContract = async (requestId) => {
        const runtime = track(createFuturesProductionWorkstationRuntime());
        const events = [];
        await runtime.service.handleRequest(productionRequest(requestId), {
            emit: event => events.push(event),
        });
        const session = runtime.service.shown;
        const readings = [];
        const view = session.orderBook.toRendererRows.bind(session.orderBook);
        session.orderBook.toRendererRows = (options) => {
            readings.push(options.step);
            return view(options);
        };
        return { runtime, events, readings, session };
    };

    const depthEvents = events => events.filter(event => event.resource === 'depth');

    it('states the reading to the book when the reading changes', async () => {
        const { runtime, readings } = await openContract('depth-reading-stated');
        await runtime.service.handleRequest(
            productionDepthRequest('depth-reading-stated', '0.25'),
            { emit: () => {} },
        );
        expect(readings).toEqual(['0.25']);
    });

    // Waiting for the next diff would answer a coarsened step within a diff or
    // two on a busy contract and never on a quiet one — and a quiet contract is
    // the one most likely to be read at a coarse step.
    it('redelivers from the book in hand rather than waiting for the next diff', async () => {
        const { runtime, events } = await openContract('depth-reading-redeliver');
        const before = depthEvents(events).length;
        await runtime.service.handleRequest(
            productionDepthRequest('depth-reading-redeliver', '0.25'),
            { emit: () => {} },
        );
        expect(depthEvents(events)).toHaveLength(before + 1);
        expect(depthEvents(events).at(-1)).toMatchObject({ state: 'live' });
        expect(depthEvents(events).at(-1).payload.bids.length).toBeGreaterThan(0);
    });

    // The trim is on delivery alone. A reading that changes must never cost a
    // read: the levels are already held, proven and bridged.
    it('buys nothing to answer a reading the band already covers', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const readDepthSnapshot = vi.fn(options => base.readDepthSnapshot(options));
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: { ...base, readDepthSnapshot },
        }));
        await runtime.service.handleRequest(productionRequest('depth-reading-free'), {
            emit: () => {},
        });
        await runtime.service.handleRequest(
            productionDepthRequest('depth-reading-free', '0.25'),
            { emit: () => {} },
        );
        await Promise.resolve();
        expect(readDepthSnapshot).toHaveBeenCalledOnce();
        expect(runtime.service.shown.orderBook.bids.size).toBe(48);
    });

    // A level is what it rests at and how much rests there. The running total
    // was computed, serialized, parsed, validated, frozen and then discarded,
    // because a total over raw levels is not a total over grouped rows.
    it('delivers a row as price, quantity, value, key and whether it is whole', async () => {
        const { events } = await openContract('depth-reading-shape');
        const row = depthEvents(events).at(-1).payload.bids[0];
        expect(Object.keys(row))
            .toEqual(['price', 'quantity', 'value', 'groupKey', 'whole']);
    });
});

// The desk held exactly one contract, and one object answered for both facts
// about it: that it was running, and that it was on screen. Every guard in the
// service asked the pair as a single question, so "is anyone watching?" quietly
// decided whether a book was rebuilt and a socket reconnected. The two are now
// asked separately, which is what lets a second contract exist at all.
describe('a session stops being the service', () => {
    it('runs two contracts at once, and a failed release of one leaves the other delivering', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport();
        const subscribers = new Map();
        const failingCloses = new Set();
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            heldContracts: 2,
            transport: {
                ...base,
                connect: (options) => {
                    subscribers.set(options.symbol, options);
                    const handle = base.connect(options);
                    return Object.freeze({
                        ready: handle.ready,
                        selectInterval: selection => handle.selectInterval(selection),
                        close: () => {
                            handle.close();
                            if (failingCloses.has(options.symbol)) {
                                throw new Error('SOCKET_CLOSE_FAILED');
                            }
                        },
                    });
                },
            },
        }));
        const events = { BTCUSDT: [], ETHUSDT: [] };
        const select = (requestId, symbol) => runtime.service.handleRequest(
            productionRequest(requestId, symbol),
            { emit: event => events[symbol].push(event) },
        );

        await select('pool-btc', 'BTCUSDT');
        await select('pool-eth', 'ETHUSDT');

        // Both contracts are running: two sockets, two freshness monitors. The
        // single-session desk closed the first the moment the second opened.
        expect(runtime.service.sessions.size).toBe(2);
        expect(base.getActiveTimerCount()).toBe(2);
        expect(clock.intervalCount()).toBe(2);
        expect(runtime.service.shown).toMatchObject({ symbol: 'ETHUSDT' });

        // The contract that is held but not shown keeps its own state current
        // and says nothing to the renderer.
        const held = runtime.service.sessions.get('BTCUSDT');
        const silent = events.BTCUSDT.length;
        subscribers.get('BTCUSDT').onMessage(productionTradeFrame({ cycle: 2, aggregateTradeId: 9001 }));
        expect(held.trades.at(-1).aggregateTradeId).toBe('9001');
        expect(events.BTCUSDT).toHaveLength(silent);

        // A release that fails half-way costs its own contract and nothing
        // else. Teardown and startup used to be one code path, which is how a
        // throw during a handshake left the previous contract delivering into a
        // desk that had moved on; a pool multiplies that fault by its bound
        // unless every step of a release belongs to the session being released.
        failingCloses.add('BTCUSDT');
        runtime.service.releaseSession(held);

        expect(runtime.service.sessions.size).toBe(1);
        expect(base.getActiveTimerCount()).toBe(1);
        // The steps after the one that threw still ran.
        expect(clock.intervalCount()).toBe(1);

        const delivered = events.ETHUSDT.length;
        subscribers.get('ETHUSDT').onMessage(productionTradeFrame({ symbol: 'ETHUSDT', cycle: 2, aggregateTradeId: 9002 }));
        expect(events.ETHUSDT.length).toBeGreaterThan(delivered);
        expect(events.ETHUSDT.at(-1)).toMatchObject({
            symbol: 'ETHUSDT',
            resource: 'trades',
            state: 'live',
        });
    });

    // The reading a contract was read at used to live on the service, where a
    // reconnect kept it by not touching it. On the session it has to be carried
    // across on purpose, and a reconnect is the one generation that must: it is
    // the same contract, still on screen. The page is the same page every time
    // — the deepest one — so nothing about a page is carried at all.
    it('keeps the reading a contract stated across a reconnect, and reads the one page', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        const readDepthSnapshot = vi.fn(options => base.readDepthSnapshot(options));
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            transport: {
                ...base,
                readDepthSnapshot,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
        }));
        await runtime.service.handleRequest(productionRequest('reconnect-page'), {
            emit: () => {},
        });
        const before = runtime.service.shown;
        expect(readDepthSnapshot.mock.calls.at(-1)[0]).toMatchObject({ limit: 1_000 });
        before.depthRange = '5';
        const readsBeforeReconnect = readDepthSnapshot.mock.calls.length;

        subscriber.onDisconnect('SOCKET_DISCONNECTED');
        clock.runTimeouts();
        await vi.waitFor(() => expect(runtime.service.shown).not.toBe(before));
        await vi.waitFor(() => expect(
            readDepthSnapshot.mock.calls.length,
        ).toBeGreaterThan(readsBeforeReconnect));

        expect(runtime.service.shown).toMatchObject({ depthRange: '5' });
        expect(readDepthSnapshot.mock.calls[readsBeforeReconnect][0])
            .toMatchObject({ limit: 1_000 });
    });

    // The other half of the same rule: another contract inherits no reading. A
    // reading is a distance in the contract's own quote currency, so one stated
    // for a contract priced in whole dollars reads as an impossible range on one
    // priced in ten-thousandths.
    it('opens another contract with no reading at all', async () => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        const readDepthSnapshot = vi.fn(options => base.readDepthSnapshot(options));
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            heldContracts: 2,
            transport: { ...base, readDepthSnapshot },
        }));
        await runtime.service.handleRequest(productionRequest('page-btc', 'BTCUSDT'), {
            emit: () => {},
        });
        runtime.service.shown.depthRange = '5';

        await runtime.service.handleRequest(productionRequest('page-eth', 'ETHUSDT'), {
            emit: () => {},
        });

        expect(runtime.service.shown).toMatchObject({
            symbol: 'ETHUSDT',
            depthRange: null,
        });
        expect(readDepthSnapshot.mock.calls.at(-1)[0]).toMatchObject({ limit: 1_000 });
        // And the contract left behind keeps its reading — it is still running,
        // and it will be shown again.
        expect(runtime.service.sessions.get('BTCUSDT')).toMatchObject({ depthRange: '5' });
    });
});

// Selecting is not subscribing. The desk used to answer a contract switch with
// `loading`, six REST reads and three fresh sockets, whatever it already had in
// hand — which is what the operator saw as the chart flickering between
// contracts. A contract the pool holds is answered from what it holds.
describe('selecting is not subscribing', () => {
    const openPool = async ({ heldContracts = 2 } = {}) => {
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
        const subscribers = new Map();
        const reads = {
            loadExchangeInfo: vi.fn(options => base.loadExchangeInfo(options)),
            bootstrapIndependent: vi.fn(options => base.bootstrapIndependent(options)),
            readDepthSnapshot: vi.fn(options => base.readDepthSnapshot(options)),
            connect: vi.fn((options) => {
                subscribers.set(options.symbol, options);
                return base.connect(options);
            }),
        };
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            heldContracts,
            transport: { ...base, ...reads },
        }));
        const events = { BTCUSDT: [], ETHUSDT: [] };
        const open = (requestId, symbol) => runtime.service.handleRequest(
            productionRequest(requestId, symbol),
            { emit: event => events[symbol].push(event) },
        );
        await open('pool-open-btc', 'BTCUSDT');
        await open('pool-open-eth', 'ETHUSDT');
        return { clock, runtime, subscribers, reads, events };
    };

    const selectSymbol = (runtime, requestId, symbol, sink, interval = '1m') => (
        runtime.service.handleRequest(
            JSON.stringify(createFuturesProductionWorkstationSelectSymbolRequest({
                requestId,
                symbol,
                interval,
            })),
            { emit: event => sink.push(event) },
        )
    );

    const counts = reads => Object.fromEntries(
        Object.entries(reads).map(([name, spy]) => [name, spy.mock.calls.length]),
    );

    it('returns to a held contract with no read, no socket and no loading', async () => {
        const { runtime, subscribers, reads } = await openPool();
        const held = runtime.service.sessions.get('BTCUSDT');

        // The book of the contract nobody is looking at moves on. In sequence:
        // a diff the book cannot bridge would empty it instead of advancing it,
        // and "the view changed" would then be satisfied by it becoming null.
        const beforeDiff = held.orderBook.toRendererRows({
            step: held.depthStep,
            rows: held.depthRows,
        });
        subscribers.get('BTCUSDT').onMessage(burstDepthFrame(1, 20));
        const afterDiff = held.orderBook.toRendererRows({
            step: held.depthStep,
            rows: held.depthRows,
        });
        expect(held.bookRecovering).toBe(false);
        expect(afterDiff).not.toBeNull();
        expect(afterDiff).not.toEqual(beforeDiff);

        const before = counts(reads);
        const back = [];
        await selectSymbol(runtime, 'pool-back-btc', 'BTCUSDT', back);
        await Promise.resolve();

        // Nothing was asked of the exchange, and no connection was opened.
        expect(counts(reads)).toEqual(before);
        // The workspace never left `live`.
        expect(back.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['live']);
        // And the book delivered is the one the session had been keeping — the
        // diff that landed while it was in the background is in it.
        expect(back.find(event => event.resource === 'depth').payload).toEqual(afterDiff);
        // Every frame names the subscription that asked for it, so the renderer
        // keeps the ownership check it has always applied.
        expect(back.every(event => (
            event.requestId === 'pool-back-btc' && event.symbol === 'BTCUSDT'
        ))).toBe(true);
        // The chart, the header and the tape come with it.
        expect(new Set(back.map(event => event.resource)))
            .toEqual(new Set(['catalog', 'candles', 'header', 'depth', 'trades', 'status']));
    });

    // A session is only worth holding if it can admit it went stale unwatched.
    // It admits it by not being delivered at all: a background session that
    // lost its stream parks, and selecting it rebuilds it from the exchange,
    // stating why it stopped under `loading` while it does (2026-09-03).
    // Delivered as it stood, it would put the operator in front of a book that
    // stopped moving some minutes ago.
    it('rebuilds a session that failed unwatched when it is selected, naming why it stopped', async () => {
        const { clock, runtime, subscribers, reads, events } = await openPool();
        const quiet = events.BTCUSDT.length;
        const before = runtime.service.sessions.get('BTCUSDT');

        // The background contract loses its stream.
        subscribers.get('BTCUSDT').onDisconnect('SOCKET_DISCONNECTED');

        // The renderer heard nothing about it — it is not watching that contract.
        expect(events.BTCUSDT).toHaveLength(quiet);
        // And the contract on screen carried on.
        expect(events.ETHUSDT.at(-1)).toMatchObject({ symbol: 'ETHUSDT' });
        // Nothing is armed for it: no ladder, no read.
        expect(before.parked).toMatchObject({ code: 'SOCKET_DISCONNECTED' });
        expect(clock.timeoutCount()).toBe(0);
        const idle = counts(reads);

        const back = [];
        await selectSymbol(runtime, 'pool-back-broken', 'BTCUSDT', back);

        // Rebuilt whole, on the screen, from a fresh read of everything.
        const rebuilt = runtime.service.sessions.get('BTCUSDT');
        expect(rebuilt).not.toBe(before);
        expect(rebuilt.parked).toBeNull();
        expect(runtime.service.shown).toBe(rebuilt);
        expect(counts(reads)).toEqual(Object.fromEntries(
            Object.entries(idle).map(([name, count]) => [name, count + 1]),
        ));
        const statuses = back.filter(event => event.resource === 'status');
        expect(statuses[0]).toMatchObject({
            state: 'loading',
            payload: { connected: false, reasonCode: 'SOCKET_DISCONNECTED' },
        });
        expect(statuses.at(-1)).toMatchObject({
            state: 'live',
            payload: { connected: true, reasonCode: null },
        });
        expect(back.every(event => event.requestId === 'pool-back-broken')).toBe(true);
        // The contract that was on screen is still held, untouched.
        expect(runtime.service.sessions.get('ETHUSDT').parked).toBeNull();
        expect(runtime.service.sessions.size).toBe(2);
    });

    // The tape settings and the emitter belong to the panel, not to whichever
    // contract happened to be open when they were last changed.
    it('gives a re-selected contract the panel it is being shown in', async () => {
        const { runtime } = await openPool();
        const heldBefore = runtime.service.sessions.get('BTCUSDT');
        await runtime.service.handleRequest(
            productionTapeRequest('pool-open-eth', { minNotionalUsdt: '1000000' }),
            { emit: () => {} },
        );

        const back = [];
        await selectSymbol(runtime, 'pool-back-tape', 'BTCUSDT', back);

        // The panel is handed to the session that was already running, not to a
        // new one wearing its name.
        const held = runtime.service.sessions.get('BTCUSDT');
        expect(held).toBe(heldBefore);
        expect(held.requestId).toBe('pool-back-tape');
        expect(held.tapeSettings).toMatchObject({ minNotionalUsdt: '1000000' });
        expect(held.emit).not.toBe(runtime.service.sessions.get('ETHUSDT').emit);
        // A tape filtered at a million USDT shows nothing from this fixture, and
        // that is the panel's setting being obeyed rather than the contract's.
        expect(back.find(event => event.resource === 'trades').payload.rows).toEqual([]);
    });
});

// The pool is bounded, and the bound is a number the operator moves.
describe('the pool is bounded', () => {
    const openPool = (heldContracts) => {
        // The manual clock is the service's alone, so `intervalCount` counts
        // freshness monitors and nothing else; the transport's own cycle timers
        // are counted by `getActiveTimerCount`.
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport();
        const subscribers = new Map();
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            heldContracts,
            transport: {
                ...base,
                connect: (options) => {
                    subscribers.set(options.symbol, options);
                    return base.connect(options);
                },
            },
        }));
        const events = { BTCUSDT: [], ETHUSDT: [], SOLUSDT: [] };
        const open = (requestId, symbol) => runtime.service.handleRequest(
            productionRequest(requestId, symbol),
            { emit: event => events[symbol].push(event) },
        );
        return { clock, base, runtime, subscribers, events, open };
    };

    // Least recently *shown*, not least recently opened. A contract selected
    // again goes to the back of the queue, or the pool would evict whichever
    // contract the operator opened first however often they came back to it.
    it('releases the contract gone longest without being shown, and nothing else', async () => {
        const { clock, base, runtime, open } = openPool(2);

        await open('bound-btc', 'BTCUSDT');
        await open('bound-eth', 'ETHUSDT');
        await open('bound-sol', 'SOLUSDT');

        expect([...runtime.service.sessions.keys()].sort()).toEqual(['ETHUSDT', 'SOLUSDT']);
        expect(base.getActiveTimerCount()).toBe(2);
        expect(clock.intervalCount()).toBe(2);
        expect(clock.timeoutCount()).toBe(0);

        // ETHUSDT is the older of the two by when it was opened, and the newer
        // by when it was last shown.
        await open('bound-eth-again', 'ETHUSDT');
        await open('bound-btc-again', 'BTCUSDT');

        expect([...runtime.service.sessions.keys()].sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
        expect(base.getActiveTimerCount()).toBe(2);
        expect(clock.intervalCount()).toBe(2);
    });

    it('holds the bound over a long rotation and leaves nothing running behind it', async () => {
        const { clock, base, runtime, open } = openPool(2);
        const rotation = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

        for (let round = 0; round < 12; round += 1) {
            const symbol = rotation[round % rotation.length];
            await open(`bound-rotate-${round}`, symbol);
            expect(runtime.service.sessions.size).toBeLessThanOrEqual(2);
        }

        expect(runtime.service.sessions.size).toBe(2);
        expect(base.getActiveTimerCount()).toBe(2);
        expect(clock.intervalCount()).toBe(2);
        expect(clock.timeoutCount()).toBe(0);
    });

    // A held contract that loses its socket does not rebuild itself: it parks,
    // and nothing is armed for it — no ladder, no read — until it is selected
    // or the desk finds a free minute (2026-09-03). What it must not do either
    // way is arrive on the screen: the operator is looking at something else.
    it('parks a background contract that loses its socket, and keeps the screen', async () => {
        const { clock, base, runtime, subscribers, events, open } = openPool(2);
        await open('park-bg-btc', 'BTCUSDT');
        await open('park-bg-eth', 'ETHUSDT');
        const before = runtime.service.sessions.get('BTCUSDT');
        const quiet = events.BTCUSDT.length;
        const sockets = base.getActiveTimerCount();

        subscribers.get('BTCUSDT').onDisconnect('SOCKET_DISCONNECTED');

        // Parked: the same session, in the pool, with its sockets closed and
        // no timer armed for it — the one interval left is the warmer's.
        expect(runtime.service.sessions.get('BTCUSDT')).toBe(before);
        expect(before.parked).toMatchObject({ code: 'SOCKET_DISCONNECTED' });
        expect(before.status).toMatchObject({
            state: 'resynchronizing',
            connected: false,
            reasonCode: 'SOCKET_DISCONNECTED',
        });
        expect(base.getActiveTimerCount()).toBe(sockets - 1);
        expect(before.freshnessTimer).toBeNull();
        expect(before.reconnectTimer).toBeNull();
        expect(clock.timeoutCount()).toBe(0);
        expect(clock.intervalCount()).toBe(2);
        expect(runtime.service.shown).toMatchObject({ symbol: 'ETHUSDT' });
        expect(runtime.service.sessions.size).toBe(2);
        expect(events.BTCUSDT).toHaveLength(quiet);

        const delivered = events.ETHUSDT.length;
        subscribers.get('ETHUSDT').onMessage(productionTradeFrame({
            symbol: 'ETHUSDT',
            cycle: 2,
            aggregateTradeId: 4242,
        }));
        expect(events.ETHUSDT.length).toBeGreaterThan(delivered);
    });

    // A bound the operator typed wrong should say so at startup rather than
    // quietly run at something else.
    it('reads the bound from the environment and refuses a value it cannot mean', () => {
        expect(readFuturesProductionWorkstationHeldContracts(undefined))
            .toBe(FUTURES_PRODUCTION_WORKSTATION_HELD_CONTRACTS);
        expect(readFuturesProductionWorkstationHeldContracts('')).
            toBe(FUTURES_PRODUCTION_WORKSTATION_HELD_CONTRACTS);
        expect(readFuturesProductionWorkstationHeldContracts('4')).toBe(4);
        for (const refused of ['0', '-1', '33', '2.5', 'two']) {
            expect(() => readFuturesProductionWorkstationHeldContracts(refused))
                .toThrow(expect.objectContaining({ code: 'INVALID_POOL_BOUND' }));
        }
    });
});

// The desk's own journal for 2026-08-12 and 2026-08-13 recorded exactly one
// kind of fault: `book-recovery:DEPTH_RANGE_SHORT`, 33 and 155 of them, peaking
// at 34 in an hour — each one a REST snapshot. A held book asks the exchange
// for nothing after its bootstrap now, shown or not: no page is re-read for a
// market that walked or rows that reach (2026-09-03).
describe('a held book asks the exchange for nothing', () => {
    const openTwo = async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const readDepthSnapshot = vi.fn(options => base.readDepthSnapshot(options));
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            heldContracts: 2,
            transport: { ...base, readDepthSnapshot },
        }));
        for (const [requestId, symbol] of [['cost-btc', 'BTCUSDT'], ['cost-eth', 'ETHUSDT']]) {
            await runtime.service.handleRequest(
                productionRequest(requestId, symbol),
                { emit: () => {} },
            );
        }
        return { runtime, readDepthSnapshot };
    };

    it('reads one page per contract and no more, shown or held', async () => {
        const { runtime, readDepthSnapshot } = await openTwo();
        const shown = runtime.service.sessions.get('ETHUSDT');
        expect(runtime.service.shown).toBe(shown);
        expect(readDepthSnapshot).toHaveBeenCalledTimes(2);
        // The coarsest reading the panel can state buys nothing for the shown
        // contract, and the held one was never asked for anything.
        await runtime.service.handleRequest(
            productionDepthRequest('cost-eth', '5'),
            { emit: () => {} },
        );
        await Promise.resolve();
        expect(readDepthSnapshot).toHaveBeenCalledTimes(2);
    });

    it('delivers a held book live when it is selected', async () => {
        const { runtime } = await openTwo();
        const back = [];
        await runtime.service.handleRequest(
            JSON.stringify(createFuturesProductionWorkstationSelectSymbolRequest({
                requestId: 'cost-back-btc',
                symbol: 'BTCUSDT',
                interval: '1m',
            })),
            { emit: event => back.push(event) },
        );

        expect(back.find(event => event.resource === 'depth')).toMatchObject({ state: 'live' });
    });
});

// A thirteen-minute exchange degradation on 2026-08-22 stood in the journal as
// a hundred and twenty-two sequence gaps. The stream broke once per book: every
// later line was a diff landing on a book already down, relabeled as a fresh
// break, and the reason each rebuild failed — the snapshot served behind the
// stream — was never written at all. The journal has to carry the story, not
// the name of the first thing that happened.
const bookDownRig = async (requestId) => {
    const clock = createManualClock();
    const base = createFuturesProductionWorkstationFakeTransport({ clock: clock.clock });
    const parsedSnapshot = JSON.parse(
        FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.depthSnapshot,
    );
    // Behind the stream on every read after the bootstrap's own: the shape of
    // the 2026-08-22 window, where no recovery snapshot could bridge.
    const snapshots = {
        body: JSON.stringify({ ...parsedSnapshot, lastUpdateId: 1 }),
        heal: lastUpdateId => {
            snapshots.body = JSON.stringify({ ...parsedSnapshot, lastUpdateId });
        },
    };
    const readDepthSnapshot = vi.fn(async options => (
        readDepthSnapshot.mock.calls.length === 1
            ? base.readDepthSnapshot(options)
            : snapshots.body
    ));
    let subscriber;
    const faults = [];
    const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
        clock: clock.clock,
        onInternalError: fault => faults.push(fault),
        transport: {
            ...base,
            readDepthSnapshot,
            connect: (options) => {
                subscriber = options;
                return base.connect(options);
            },
        },
    }));
    const events = [];
    await runtime.service.handleRequest(productionRequest(requestId), {
        emit: event => events.push(event),
    });
    const session = runtime.service.shown;
    // Drive the round's bridge delays until it settles. Three attempts is
    // three timeouts, but the count is not asserted here — a round that
    // schedules anything else on the way down is still driven to rest.
    const driveRound = async () => {
        while (session.bookRecovering) {
            await vi.waitFor(() => {
                if (session.bookRecovering && clock.timeoutCount() === 0) {
                    throw new Error('recovery is between steps');
                }
            });
            if (session.bookRecovering) clock.runTimeouts();
        }
    };
    return {
        clock,
        faults,
        session,
        snapshots,
        driveRound,
        diff: cycle => subscriber.onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(cycle)[0],
        ),
        recoveryCodes: () => faults
            .filter(fault => fault.phase === 'book-recovery')
            .map(fault => fault.code),
    };
};

describe('a rebuild names what took the book down', () => {
    it('writes the break once, the downed book after, and why no attempt bridged', async () => {
        const rig = await bookDownRig('book-down-names');

        // Cycle 5 does not continue the bridged book at 1001: the one genuine
        // break in this journal.
        rig.diff(5);
        expect(rig.session.bookRecovering).toBe(true);
        await rig.driveRound();
        expect(rig.recoveryCodes()).toEqual([
            'DEPTH_SEQUENCE_GAP',
            'DEPTH_BOOTSTRAP_NOT_BRIDGED',
            'DEPTH_BOOTSTRAP_NOT_BRIDGED',
            'DEPTH_BOOTSTRAP_NOT_BRIDGED',
        ]);

        // Past the cooldown — widened once by the round that just failed —
        // the next diff lands on a book that is already down. That is not a
        // second break and must not be written as one.
        rig.clock.advance(10_001);
        rig.diff(6);
        expect(rig.session.bookRecovering).toBe(true);
        await rig.driveRound();
        expect(rig.recoveryCodes()).toEqual([
            'DEPTH_SEQUENCE_GAP',
            'DEPTH_BOOTSTRAP_NOT_BRIDGED',
            'DEPTH_BOOTSTRAP_NOT_BRIDGED',
            'DEPTH_BOOTSTRAP_NOT_BRIDGED',
            'DEPTH_BOOK_DOWN',
            'DEPTH_BOOTSTRAP_NOT_BRIDGED',
            'DEPTH_BOOTSTRAP_NOT_BRIDGED',
            'DEPTH_BOOTSTRAP_NOT_BRIDGED',
        ]);
    });
});

// A recovery that cannot succeed — the exchange serving snapshots behind its
// own stream — used to ask again on a flat five seconds for as long as the
// condition lasted: three reads a round, seven to eight rounds a minute, for
// the thirteen minutes of the 2026-08-22 window, at an exchange that was
// answering trading commands "server overloaded". The pause has to learn.
describe('a recovery that keeps failing backs off further', () => {
    it('widens the pause after every failed round, to a ceiling', async () => {
        const rig = await bookDownRig('backoff-ladder');

        // The genuine break is answered immediately; the round fails.
        rig.diff(5);
        expect(rig.session.bookRecovering).toBe(true);
        await rig.driveRound();

        let cycle = 5;
        for (const pause of [10_000, 20_000, 40_000, 60_000, 60_000]) {
            const restedAt = rig.session.bookRecoveredAt;
            // One millisecond before the widened pause a diff starts nothing —
            // against a flat cooldown this round starts at five seconds.
            rig.clock.setNow(restedAt + (pause - 1));
            rig.diff(cycle += 1);
            expect(rig.session.bookRecovering).toBe(false);
            // At the pause it starts, and fails, and the pause widens again.
            rig.clock.setNow(restedAt + pause);
            rig.diff(cycle += 1);
            expect(rig.session.bookRecovering).toBe(true);
            await rig.driveRound();
        }
    });

    // A guard, not a biter: the flat cooldown passes it too. It holds the
    // ceiling down — a desk that kept the widened pause after the exchange
    // recovered would answer the next real break a minute late.
    it('returns the pause to the floor once a snapshot bridges', async () => {
        const rig = await bookDownRig('backoff-reset');

        rig.diff(5);
        expect(rig.session.bookRecovering).toBe(true);
        await rig.driveRound();

        // The exchange recovers: the next round bridges its snapshot level
        // with the furthest diff the desk has seen, the way a rebuild on a
        // quiet book does — leaving the stream's own ids able to continue it.
        rig.snapshots.heal(1_007);
        const failedAt = rig.session.bookRecoveredAt;
        rig.clock.setNow(failedAt + 10_000);
        rig.diff(6);
        expect(rig.session.bookRecovering).toBe(true);
        await rig.driveRound();

        // A diff continues the healed book, and a later one breaks its chain:
        // the break is answered on the floor again, not on the pause the
        // failed round had earned.
        rig.diff(7);
        expect(rig.session.bookRecovering).toBe(false);
        const recoveredAt = rig.session.bookRecoveredAt;
        rig.clock.setNow(recoveredAt + 5_000);
        rig.diff(25);
        expect(rig.session.bookRecovering).toBe(true);
    });
});

// On 2026-09-02 three `SOCKET_CLOSED` resynchronizations each followed four to
// eight seconds of upstream lag, and the record could not say so: a close that
// ends a stalled route reads as what it was only if the close says who ended
// it and how late the last frame before it was.
describe('what a stream close leaves behind', () => {
    it('states who closed the socket, the code, and the lag of the last frame', async () => {
        const manual = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport({ clock: manual.clock });
        const faults = [];
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: manual.clock,
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
            onInternalError: fault => faults.push(fault),
        }));
        await runtime.service.handleRequest(productionRequest('close-evidence'), {
            emit: () => {},
        });
        // A frame the exchange sent four seconds before the desk received it.
        const frame = FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(1)[0];
        const exchangeAt = JSON.parse(frame).data.E;
        manual.setNow(exchangeAt + 4_000);
        subscriber.onMessage(frame);

        subscriber.onDisconnect('SOCKET_CLOSED', { closeCode: 1006, closedBy: 'transport' });

        expect(faults).toContainEqual({
            phase: 'stream-close',
            code: 'SOCKET_CLOSED',
            symbol: 'BTCUSDT',
            closeCode: 1006,
            closedBy: 'transport',
            lastUpstreamMs: 4_000,
        });
    });

    it('states a close with nothing behind it as exactly that', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const faults = [];
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
            onInternalError: fault => faults.push(fault),
        }));
        await runtime.service.handleRequest(productionRequest('close-bare'), { emit: () => {} });
        subscriber.onDisconnect('SOCKET_CLOSED');
        expect(faults).toContainEqual({
            phase: 'stream-close',
            code: 'SOCKET_CLOSED',
            symbol: 'BTCUSDT',
            closeCode: null,
            closedBy: null,
            lastUpstreamMs: expect.any(Number),
        });
    });
});

// One crossing, one evidence line. The stream line that raised the crossing
// carries the identities; the recovery round's own line names only the
// round — the summary counted a crossing twice while both carried them.
describe('a crossing leaves its evidence once', () => {
    it('puts the identities on the stream line and not again on the round', async () => {
        const base = createFuturesProductionWorkstationFakeTransport();
        const faults = [];
        let subscriber;
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            transport: {
                ...base,
                connect: (options) => {
                    subscriber = options;
                    return base.connect(options);
                },
            },
            onInternalError: fault => faults.push(fault),
        }));
        await runtime.service.handleRequest(productionRequest('crossing-once'), { emit: () => {} });
        const session = runtime.service.shown;
        // A bid posted above every resting ask crosses the book on the stream.
        const frame = JSON.parse(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(1)[0],
        );
        frame.data.b = [['99999.00', '1.0']];
        frame.data.a = [];
        subscriber.onMessage(JSON.stringify(frame));

        const crossings = faults.filter(fault => fault.code === 'CROSSED_ORDER_BOOK');
        expect(crossings.map(fault => fault.phase)).toEqual(['stream', 'book-recovery']);
        expect(crossings.filter(fault => fault.crossedLevels !== undefined)).toHaveLength(1);
        expect(crossings[0]).toMatchObject({
            phase: 'stream',
            symbol: 'BTCUSDT',
            crossedLevels: expect.any(Number),
            lastUpdateId: expect.any(String),
        });
        expect(session.bookRecovering).toBe(true);
    });
});

// The operator's ruling of 2026-09-03: the shown contract is always current;
// the rest load in a free minute; a background contract never reconnects on
// its own. On the storms of 2026-09-02 every held contract laddered and
// bootstrapped at once, against the one budget the shown contract needed.
describe('a background contract loads in a free minute', () => {
    const openPool = async ({
        heldContracts = 3,
        symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    } = {}) => {
        // The fake's own cycle timers run on the system clock, so the manual
        // clock's intervals are the freshness monitors and the warmer alone.
        const clock = createManualClock();
        const base = createFuturesProductionWorkstationFakeTransport();
        const subscribers = new Map();
        const room = { usedWeight: 0, maximumWeight: 600 };
        const failing = new Set();
        // Contracts the exchange no longer lists: a wake finds no contract.
        const delisted = new Set();
        const reads = {
            loadExchangeInfo: vi.fn(async (options) => {
                const catalog = JSON.parse(await base.loadExchangeInfo(options));
                return JSON.stringify({
                    ...catalog,
                    symbols: catalog.symbols.filter(entry => !delisted.has(entry.symbol)),
                });
            }),
            bootstrapIndependent: vi.fn(options => base.bootstrapIndependent(options)),
            bootstrapInterval: vi.fn(options => base.bootstrapInterval(options)),
            readDepthSnapshot: vi.fn((options) => {
                if (failing.has(options.symbol)) {
                    const error = new Error('route down');
                    error.code = 'ROUTE_DOWN';
                    return Promise.reject(error);
                }
                return base.readDepthSnapshot(options);
            }),
            connect: vi.fn((options) => {
                subscribers.set(options.symbol, options);
                return base.connect(options);
            }),
        };
        const faults = [];
        const timings = [];
        const runtime = track(createFuturesProductionWorkstationRuntimeForTest({
            clock: clock.clock,
            heldContracts,
            onInternalError: fault => faults.push(fault),
            onTiming: timing => timings.push(timing),
            transport: {
                ...base,
                ...reads,
                readBudgetRoom: () => Object.freeze({ ...room }),
            },
        }));
        const events = Object.fromEntries(symbols.map(symbol => [symbol, []]));
        const open = (requestId, symbol) => runtime.service.handleRequest(
            productionRequest(requestId, symbol),
            { emit: event => events[symbol].push(event) },
        );
        for (const symbol of symbols) await open(`free-open-${symbol}`, symbol);
        const counts = () => Object.fromEntries(
            Object.entries(reads).map(([name, spy]) => [name, spy.mock.calls.length]),
        );
        const session = symbol => runtime.service.sessions.get(symbol);
        const parkedCode = symbol => session(symbol)?.parked?.code ?? null;
        const lostStream = (symbol, reason = 'SOCKET_CLOSED') => (
            subscribers.get(symbol).onDisconnect(reason)
        );
        const lostCandles = (symbol, reason = 'CLOSED') => (
            subscribers.get(symbol).onCandleDisconnect(reason)
        );
        // A diff that does not continue the book the bootstrap bridged.
        const gap = symbol => subscribers.get(symbol).onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols[symbol].streams.makeCycle(2)[0],
        );
        const live = (symbol, previous) => vi.waitFor(() => {
            expect(session(symbol)).not.toBe(previous);
            expect(session(symbol).status).toMatchObject({ state: 'live' });
        });
        const parkFaults = () => faults.filter(fault => fault.phase === 'park');
        const wakes = () => timings.filter(timing => timing.phase === 'lazy-bootstrap');
        return {
            clock, base, runtime, subscribers, room, failing, delisted, faults, events,
            open, counts, session, parkedCode, lostStream, lostCandles, gap, live,
            parkFaults, wakes,
        };
    };

    it('parks a background book that gaps, and reads no page for it', async () => {
        const rig = await openPool();
        const btc = rig.session('BTCUSDT');
        const idle = rig.counts();

        // A diff that does not continue the book the bootstrap bridged.
        rig.subscribers.get('BTCUSDT').onMessage(
            FUTURES_PRODUCTION_WORKSTATION_FIXTURE.symbols.BTCUSDT.streams.makeCycle(2)[0],
        );

        // No round: parked under the gap's name, at once.
        expect(btc.bookRecovering).toBe(false);
        expect(rig.parkedCode('BTCUSDT')).toBe('DEPTH_SEQUENCE_GAP');
        expect(rig.parkFaults()).toEqual([
            { phase: 'park', code: 'DEPTH_SEQUENCE_GAP', symbol: 'BTCUSDT' },
        ]);
        rig.clock.runTimeouts();
        await Promise.resolve();
        expect(rig.counts()).toEqual(idle);
        expect(rig.runtime.service.shown).toMatchObject({ symbol: 'SOLUSDT' });
    });

    it('delivers a resubscribed live contract from what it holds, and leaves the parked ones parked', async () => {
        const rig = await openPool();
        rig.lostStream('BTCUSDT');
        rig.lostStream('ETHUSDT');
        const btc = rig.session('BTCUSDT');
        const eth = rig.session('ETHUSDT');
        const sol = rig.session('SOLUSDT');
        const idle = rig.counts();
        rig.room.usedWeight = 600;

        // The renderer's socket came back and it subscribes again to the
        // contract it was showing.
        const back = [];
        await rig.runtime.service.handleRequest(productionRequest('free-reload', 'SOLUSDT'), {
            emit: event => back.push(event),
        });

        expect(rig.counts()).toEqual(idle);
        expect(rig.session('SOLUSDT')).toBe(sol);
        expect(back.filter(event => event.resource === 'status').map(event => event.state))
            .toEqual(['live']);
        expect(rig.session('BTCUSDT')).toBe(btc);
        expect(rig.session('ETHUSDT')).toBe(eth);
        expect(rig.parkedCode('BTCUSDT')).toBe('SOCKET_CLOSED');
        expect(rig.parkedCode('ETHUSDT')).toBe('SOCKET_CLOSED');
        expect(rig.clock.timeoutCount()).toBe(0);
    });

    it('wakes one parked contract per tick, most recently shown first, only in a free minute', async () => {
        const rig = await openPool();
        rig.lostStream('BTCUSDT');
        rig.lostStream('ETHUSDT');
        const btc = rig.session('BTCUSDT');
        const eth = rig.session('ETHUSDT');
        const idle = rig.counts();
        // The shown contract keeps delivering while two are parked.
        expect(rig.runtime.service.shown).toMatchObject({ symbol: 'SOLUSDT' });

        // A busy minute is not a free one.
        rig.room.usedWeight = 500;
        rig.clock.runIntervals();
        await Promise.resolve();
        expect(rig.counts()).toEqual(idle);
        expect(rig.wakes()).toEqual([]);

        // A free one wakes exactly one: the contract shown most recently.
        rig.room.usedWeight = 0;
        rig.clock.runIntervals();
        await rig.live('ETHUSDT', eth);
        expect(rig.session('BTCUSDT')).toBe(btc);
        expect(rig.parkedCode('BTCUSDT')).toBe('SOCKET_CLOSED');
        expect(rig.session('ETHUSDT').parked).toBeNull();
        expect(rig.session('ETHUSDT').shownOrder).toBe(eth.shownOrder);
        expect(rig.wakes()).toEqual([
            expect.objectContaining({ phase: 'lazy-bootstrap', outcome: 'ok', symbol: 'ETHUSDT' }),
        ]);
        // Woken, held, and not on the screen.
        expect(rig.runtime.service.shown).toMatchObject({ symbol: 'SOLUSDT' });
        expect(rig.events.ETHUSDT.filter(event => event.resource === 'status').at(-1))
            .toMatchObject({ state: 'live' });

        // The floor holds the next wake, whatever the budget says.
        rig.clock.runIntervals();
        await Promise.resolve();
        expect(rig.session('BTCUSDT')).toBe(btc);

        rig.clock.advance(FUTURES_PRODUCTION_WORKSTATION_WARMER.FLOOR_MS);
        rig.clock.runIntervals();
        await rig.live('BTCUSDT', btc);
        expect(rig.wakes().map(timing => timing.symbol)).toEqual(['ETHUSDT', 'BTCUSDT']);
        expect(rig.runtime.service.shown).toMatchObject({ symbol: 'SOLUSDT' });
        expect(rig.runtime.service.sessions.size).toBe(3);

        // Nothing parked: the warmer's own tick takes it down, leaving the
        // three freshness monitors.
        rig.clock.runIntervals();
        expect(rig.runtime.service.warmTimer).toBeNull();
        expect(rig.clock.intervalCount()).toBe(3);
    });

    it('holds the tick while the shown contract is reconnecting, whatever room the budget has', async () => {
        const rig = await openPool({ heldContracts: 2, symbols: ['BTCUSDT', 'ETHUSDT'] });
        rig.lostStream('BTCUSDT');
        const btc = rig.session('BTCUSDT');
        const eth = rig.session('ETHUSDT');

        // The shown contract loses its route too, and climbs its own ladder.
        rig.lostStream('ETHUSDT');
        expect(eth.reconnectTimer).not.toBeNull();
        expect(rig.parkedCode('ETHUSDT')).toBeNull();

        rig.clock.runIntervals();
        await Promise.resolve();
        expect(rig.session('BTCUSDT')).toBe(btc);
        expect(rig.wakes()).toEqual([]);

        // The shown contract comes back first; only then is a minute free.
        rig.clock.runTimeouts();
        await rig.live('ETHUSDT', eth);
        expect(rig.runtime.service.shown).toBe(rig.session('ETHUSDT'));
        rig.clock.runIntervals();
        await rig.live('BTCUSDT', btc);
        expect(rig.wakes().map(timing => timing.symbol)).toEqual(['BTCUSDT']);
    });

    it('parks a wake that fails, and tries again after the floor', async () => {
        const rig = await openPool({ heldContracts: 2, symbols: ['BTCUSDT', 'ETHUSDT'] });
        rig.lostStream('BTCUSDT');
        const btc = rig.session('BTCUSDT');
        rig.failing.add('BTCUSDT');

        rig.clock.runIntervals();
        await vi.waitFor(() => expect(rig.parkedCode('BTCUSDT')).toBe('ROUTE_DOWN'));

        const again = rig.session('BTCUSDT');
        expect(again).not.toBe(btc);
        expect(again.reconnectTimer).toBeNull();
        expect(rig.clock.timeoutCount()).toBe(0);
        expect(rig.wakes()).toEqual([
            expect.objectContaining({ phase: 'lazy-bootstrap', outcome: 'error', symbol: 'BTCUSDT' }),
        ]);
        expect(rig.parkFaults().map(fault => fault.code)).toEqual(['SOCKET_CLOSED', 'ROUTE_DOWN']);
        expect(rig.runtime.service.shown).toMatchObject({ symbol: 'ETHUSDT' });

        // Not before the floor, nor inside the hold a failed wake earns — twice
        // the floor from the park — and then once more.
        rig.failing.delete('BTCUSDT');
        rig.clock.runIntervals();
        await Promise.resolve();
        expect(rig.session('BTCUSDT')).toBe(again);
        rig.clock.advance(FUTURES_PRODUCTION_WORKSTATION_WARMER.FLOOR_MS);
        rig.clock.runIntervals();
        await Promise.resolve();
        expect(rig.session('BTCUSDT')).toBe(again);
        rig.clock.advance(FUTURES_PRODUCTION_WORKSTATION_WARMER.FLOOR_MS);
        rig.clock.runIntervals();
        await rig.live('BTCUSDT', again);
        expect(rig.wakes().map(timing => timing.outcome)).toEqual(['error', 'ok']);
    });

    // The three ways a shown session is mid-recovery when the operator moves
    // off it. Each used to finish in the background — the rung's bootstrap and
    // its reads, the rest of the round's pages, the candle socket's bootstrap
    // — for a contract nobody was looking at (audit of 2026-09-03).
    it('parks the contract that leaves the screen on its ladder, and the ladder with it', async () => {
        const rig = await openPool({ heldContracts: 2, symbols: ['BTCUSDT', 'ETHUSDT'] });
        const eth = rig.session('ETHUSDT');
        rig.lostStream('ETHUSDT');
        expect(eth.reconnectTimer).not.toBeNull();
        const idle = rig.counts();

        await rig.open('free-leave-ladder', 'BTCUSDT');

        expect(rig.runtime.service.shown).toBe(rig.session('BTCUSDT'));
        expect(rig.session('ETHUSDT')).toBe(eth);
        expect(eth.reconnectTimer).toBeNull();
        expect(rig.parkedCode('ETHUSDT')).toBe('SOCKET_CLOSED');
        expect(rig.parkFaults()).toEqual([
            { phase: 'park', code: 'SOCKET_CLOSED', symbol: 'ETHUSDT' },
        ]);
        // The rung never fires: no bootstrap and no read for it.
        expect(rig.clock.timeoutCount()).toBe(0);
        rig.clock.runTimeouts();
        await Promise.resolve();
        expect(rig.counts()).toEqual(idle);
        expect(rig.session('ETHUSDT')).toBe(eth);
    });

    it('parks the contract that leaves the screen mid-round, and reads no page for it', async () => {
        const rig = await openPool({ heldContracts: 2, symbols: ['BTCUSDT', 'ETHUSDT'] });
        const eth = rig.session('ETHUSDT');
        rig.gap('ETHUSDT');
        expect(eth.bookRecovering).toBe(true);
        const idle = rig.counts();

        await rig.open('free-leave-round', 'BTCUSDT');

        expect(rig.parkedCode('ETHUSDT')).toBe('DEPTH_SEQUENCE_GAP');
        expect(rig.parkFaults()).toEqual([
            { phase: 'park', code: 'DEPTH_SEQUENCE_GAP', symbol: 'ETHUSDT' },
        ]);
        // The round's bridge timer fires into a session that is no longer
        // held: the round ends without its page.
        rig.clock.runTimeouts();
        await vi.waitFor(() => expect(eth.bookRecovering).toBe(false));
        expect(rig.counts()).toEqual(idle);
        expect(rig.session('ETHUSDT')).toBe(eth);
        expect(rig.runtime.service.shown).toBe(rig.session('BTCUSDT'));
    });

    it('parks the contract that leaves the screen on its candle ladder', async () => {
        const rig = await openPool({ heldContracts: 2, symbols: ['BTCUSDT', 'ETHUSDT'] });
        const eth = rig.session('ETHUSDT');
        rig.lostCandles('ETHUSDT', 'CLOSED');
        expect(eth.intervalReconnectTimer).not.toBeNull();
        const idle = rig.counts();

        await rig.open('free-leave-candles', 'BTCUSDT');

        expect(rig.parkedCode('ETHUSDT')).toBe('CANDLE_CLOSED');
        expect(eth.intervalReconnectTimer).toBeNull();
        expect(rig.clock.timeoutCount()).toBe(0);
        rig.clock.runTimeouts();
        await Promise.resolve();
        expect(rig.counts()).toEqual(idle);
        expect(rig.session('ETHUSDT')).toBe(eth);
    });

    it('holds the tick while the shown contract is on its candle ladder', async () => {
        const rig = await openPool({ heldContracts: 2, symbols: ['BTCUSDT', 'ETHUSDT'] });
        rig.lostStream('BTCUSDT');
        const btc = rig.session('BTCUSDT');
        const eth = rig.session('ETHUSDT');
        rig.lostCandles('ETHUSDT', 'CLOSED');
        expect(eth.intervalReconnectTimer).not.toBeNull();

        rig.clock.runIntervals();
        await Promise.resolve();
        expect(rig.session('BTCUSDT')).toBe(btc);
        expect(rig.wakes()).toEqual([]);

        // The candle socket comes back on its own rung; only then is a minute free.
        rig.clock.runTimeouts();
        await vi.waitFor(() => {
            expect(eth.intervalReconnectTimer).toBeNull();
            expect(eth.intervalBootstrapping).toBe(false);
            expect(eth.intervalReconnectAttempt).toBe(0);
        });
        rig.clock.runIntervals();
        await rig.live('BTCUSDT', btc);
        expect(rig.wakes().map(timing => timing.symbol)).toEqual(['BTCUSDT']);
    });

    it('does not hold the warmer on a contract that stands unavailable', async () => {
        const rig = await openPool();
        rig.lostStream('ETHUSDT');
        const eth = rig.session('ETHUSDT');
        // Delisted while it was parked: the wake finds no contract and the
        // session stands unavailable — neither parked nor loading.
        rig.delisted.add('ETHUSDT');
        rig.clock.runIntervals();
        await vi.waitFor(() => {
            expect(rig.session('ETHUSDT')).not.toBe(eth);
            expect(rig.session('ETHUSDT').status).toMatchObject({
                state: 'unavailable',
                reasonCode: 'SYMBOL_UNAVAILABLE',
            });
        });
        expect(rig.session('ETHUSDT').parked).toBeNull();
        expect(rig.session('ETHUSDT').bootstrapped).toBe(false);

        // The next contract to park still gets its minute.
        rig.lostStream('BTCUSDT');
        const btc = rig.session('BTCUSDT');
        rig.clock.advance(FUTURES_PRODUCTION_WORKSTATION_WARMER.FLOOR_MS);
        rig.clock.runIntervals();
        await rig.live('BTCUSDT', btc);
        expect(rig.wakes().map(timing => timing.symbol)).toEqual(['BTCUSDT']);
    });

    it('holds a contract whose wake failed, longer each time, behind the ones not tried', async () => {
        const rig = await openPool();
        rig.lostStream('BTCUSDT');
        rig.lostStream('ETHUSDT');
        rig.failing.add('ETHUSDT');
        const btc = rig.session('BTCUSDT');
        const { FLOOR_MS } = FUTURES_PRODUCTION_WORKSTATION_WARMER;

        // Most recently shown first: ETH, whose wake fails and parks it again.
        rig.clock.runIntervals();
        await vi.waitFor(() => expect(rig.parkedCode('ETHUSDT')).toBe('ROUTE_DOWN'));
        const ethAgain = rig.session('ETHUSDT');
        expect(ethAgain.lazyWakes).toBe(1);
        expect(rig.session('BTCUSDT')).toBe(btc);

        // After the floor the one not yet tried goes, not the one that failed.
        rig.clock.advance(FLOOR_MS);
        rig.clock.runIntervals();
        await rig.live('BTCUSDT', btc);
        expect(rig.session('ETHUSDT')).toBe(ethAgain);

        // The failed one is held twice the floor from its park. Tried again,
        // it fails again, and is held four floors.
        rig.clock.advance(FLOOR_MS);
        rig.clock.runIntervals();
        await vi.waitFor(() => expect(rig.session('ETHUSDT')).not.toBe(ethAgain));
        const ethThird = rig.session('ETHUSDT');
        await vi.waitFor(() => expect(rig.parkedCode('ETHUSDT')).toBe('ROUTE_DOWN'));
        expect(ethThird.lazyWakes).toBe(2);
        expect(rig.wakes().map(timing => [timing.symbol, timing.outcome])).toEqual([
            ['ETHUSDT', 'error'], ['BTCUSDT', 'ok'], ['ETHUSDT', 'error'],
        ]);

        rig.failing.delete('ETHUSDT');
        for (const floor of [1, 2, 3]) {
            rig.clock.advance(FLOOR_MS);
            rig.clock.runIntervals();
            await Promise.resolve();
            expect(rig.session('ETHUSDT'), `floor ${floor} of the hold`).toBe(ethThird);
        }
        rig.clock.advance(FLOOR_MS);
        rig.clock.runIntervals();
        await rig.live('ETHUSDT', ethThird);
        expect(rig.session('ETHUSDT').lazyWakes).toBe(0);

        // Up with a bridged book, the count is cleared: its next park is not held.
        const ethLive = rig.session('ETHUSDT');
        rig.lostStream('ETHUSDT');
        expect(rig.parkedCode('ETHUSDT')).toBe('SOCKET_CLOSED');
        rig.clock.advance(FLOOR_MS);
        rig.clock.runIntervals();
        await rig.live('ETHUSDT', ethLive);
        expect(rig.parkFaults().map(fault => fault.symbol)).toEqual([
            'BTCUSDT', 'ETHUSDT', 'ETHUSDT', 'ETHUSDT', 'ETHUSDT',
        ]);
    });

    it('states the room the public budget has, from the reviewed transport', async () => {
        const { createFuturesProductionWorkstationReviewedTransport } = await import(
            './futures-production-workstation-transport.js'
        );
        const room = createFuturesProductionWorkstationReviewedTransport().readBudgetRoom();
        expect(room).toEqual({ usedWeight: 0, maximumWeight: 600 });
        expect(Object.isFrozen(room)).toBe(true);
    });
});
