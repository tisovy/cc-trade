import {
    FUTURES_PRODUCTION_WORKSTATION_ACTIONS,
    createFuturesProductionWorkstationEvent,
    readFuturesProductionWorkstationRequest,
} from '../../src/utils/futuresProductionWorkstationProtocol.js';
import {
    FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS,
    FUTURES_WORKSTATION_EVENT_MAX_BYTES,
    FUTURES_WORKSTATION_RESOURCES,
    FUTURES_WORKSTATION_STATES,
} from '../../src/utils/futuresWorkstationProtocolShared.js';
import {
    FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES,
} from './futures-production-workstation-transport.js';
import {
    FUTURES_WORKSTATION_MARKET_LIMITS,
    appendFuturesWorkstationTrade,
    createFuturesWorkstationCatalogFrames,
    createFuturesWorkstationHeader,
    normalizeFuturesWorkstationDepthSnapshot,
    normalizeFuturesWorkstationExchangeInfo,
    normalizeFuturesWorkstationKlines,
    normalizeFuturesWorkstationPremiumIndex,
    normalizeFuturesWorkstationStreamFrame,
    normalizeFuturesWorkstationTicker,
    toRendererCandleRows,
    toRendererTradeRows,
    updateFuturesWorkstationCandles,
    updateFuturesWorkstationHeader,
} from './futures-workstation-market-contract.js';
import {
    FuturesWorkstationOrderBook,
} from './futures-workstation-order-book.js';
import {
    parseFuturesWorkstationDecimal,
} from './futures-workstation-decimal.js';

export const FUTURES_PRODUCTION_WORKSTATION_FRESHNESS = Object.freeze({
    HEADER_MS: 5_000,
    CANDLES_MS: 5_000,
    DEPTH_MS: 3_000,
    TRADES_MS: 5_000,
    CHECK_MS: 1_000,
    RECONNECT_BASE_MS: 500,
    RECONNECT_MAX_MS: 30_000,
    RECONNECT_ATTEMPTS: 8,
    PENDING_EVENTS: 128,
});

export class FuturesProductionWorkstationServiceError extends Error {
    constructor(code) {
        super('Futures production workstation service failed');
        this.name = 'FuturesProductionWorkstationServiceError';
        this.code = code;
    }
}

const systemClock = Object.freeze({
    now: () => Date.now(),
    setInterval: (callback, delay) => setInterval(callback, delay),
    clearInterval: handle => clearInterval(handle),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: handle => clearTimeout(handle),
});

// Rebuilding the book while the desk keeps running. Bridging needs fresh diffs
// to arrive after the snapshot is taken, which is why each attempt waits before
// reading; the cooldown keeps a book that cannot bridge from asking on every
// diff that lands on it.
export const FUTURES_PRODUCTION_WORKSTATION_BOOK_RECOVERY = Object.freeze({
    ATTEMPTS: 3,
    BRIDGE_MS: 200,
    COOLDOWN_MS: 5_000,
});

// A ceiling the market trips, it trips repeatedly: the frames that reach it come
// from one burst. The refusal is stated once per window, so the reason line
// carries the fact rather than a count of it.
export const FUTURES_PRODUCTION_WORKSTATION_FRAME_REFUSAL = Object.freeze({
    REPORT_COOLDOWN_MS: 5_000,
});

// Which stream a frame came from, read without parsing it — the frame that
// lands here is the one the parser has already refused.
const DEPTH_STREAM_NAME = /"stream"\s*:\s*"[a-z0-9_]{1,32}@depth/;
const isDepthStreamFrame = raw => (
    typeof raw === 'string' && DEPTH_STREAM_NAME.test(raw.slice(0, 256))
);

// The two ways a bootstrap can fail to bridge are two different faults — the
// snapshot could not be tied to the stream, or the buffered diffs had a hole in
// them — and an operator reading the log can only act on the one that names
// itself.
const DEPTH_BOOTSTRAP_CODES = Object.freeze({
    'snapshot-not-bridged': 'DEPTH_BOOTSTRAP_NOT_BRIDGED',
    'buffer-gap': 'DEPTH_BOOTSTRAP_BUFFER_GAP',
});
const depthBootstrapCode = reason => (
    DEPTH_BOOTSTRAP_CODES[reason] ?? 'DEPTH_BOOTSTRAP_GAP'
);

const safeCode = error => (
    typeof error?.code === 'string' && /^[A-Z0-9_-]{1,96}$/.test(error.code)
        ? error.code.replace(/-/g, '_')
        : 'WORKSTATION_RESOURCE_REJECTED'
);

const freezeTapeSettings = value => Object.freeze({
    throttleEnabled: value.throttleEnabled,
    timeoutMs: value.timeoutMs,
    minNotionalUsdt: value.minNotionalUsdt,
});

const absoluteCoefficient = value => (value < 0n ? -value : value);

const tradeMeetsTapeNotional = (row, minimumNotionalUsdt) => {
    const price = parseFuturesWorkstationDecimal(row.price);
    const quantity = parseFuturesWorkstationDecimal(row.quantity);
    const minimum = parseFuturesWorkstationDecimal(minimumNotionalUsdt);
    const productCoefficient = absoluteCoefficient(price.coefficient)
        * absoluteCoefficient(quantity.coefficient);
    const productScale = price.scale + quantity.scale;
    const scale = Math.max(productScale, minimum.scale);
    const scaledProduct = productCoefficient * (10n ** BigInt(scale - productScale));
    const scaledMinimum = minimum.coefficient * (10n ** BigInt(scale - minimum.scale));
    return scaledProduct >= scaledMinimum;
};

const tapeFingerprint = (state, rows) => (
    `${state}:${rows.map(row => row.aggregateTradeId).join(',')}`
);

export class FuturesProductionWorkstationService {
    constructor({
        transport,
        clock = systemClock,
        onInternalError = () => {},
        onTiming = () => {},
    } = {}) {
        if (!transport
            || typeof transport.loadExchangeInfo !== 'function'
            || typeof transport.bootstrapIndependent !== 'function'
            || typeof transport.readDepthSnapshot !== 'function'
            || typeof transport.bootstrapInterval !== 'function'
            || typeof transport.connect !== 'function'
            || typeof transport.close !== 'function'
            || typeof clock.now !== 'function'
            || typeof clock.setInterval !== 'function'
            || typeof clock.clearInterval !== 'function'
            || typeof clock.setTimeout !== 'function'
            || typeof clock.clearTimeout !== 'function'
            || typeof onInternalError !== 'function'
            || typeof onTiming !== 'function') {
            throw new FuturesProductionWorkstationServiceError('INVALID_SERVICE_COMPOSITION');
        }
        this.transport = transport;
        this.clock = clock;
        this.onInternalError = onInternalError;
        this.onTiming = onTiming;
        this.generation = 0;
        this.current = null;
        this.stopped = false;
        this.tapeSettings = FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS;
        // How far past the best price the rows on screen reach, and which page
        // of the book that took. Both belong to the contract on screen and are
        // dropped when another is opened — the reading arrives again with the
        // request that opens it, and the page is bought against that contract's
        // own band.
        this.depthRange = null;
        this.depthPage = 0;
    }

    depthPageLimit() {
        const pages = FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES;
        return pages[Math.min(this.depthPage, pages.length - 1)].limit;
    }

    // Up by however much is short, never back down on its own: a market that
    // walks out of a band it has already outgrown would otherwise buy the same
    // page again and again. `factor` is how many times deeper the band has to
    // be, so a step three sizes coarser buys its page in one read.
    deepenDepthPage(factor = 1) {
        const pages = FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES;
        if (this.depthPage >= pages.length - 1) return false;
        const wanted = pages[this.depthPage].limit * Math.max(1, factor);
        const target = pages.findIndex(page => page.limit >= wanted);
        this.depthPage = target < 0
            ? pages.length - 1
            : Math.max(this.depthPage + 1, target);
        return true;
    }

    async handleRequest(raw, { emit } = {}) {
        if (this.stopped) throw new FuturesProductionWorkstationServiceError('SERVICE_STOPPED');
        if (typeof emit !== 'function') {
            throw new FuturesProductionWorkstationServiceError('INVALID_EMITTER');
        }
        const request = readFuturesProductionWorkstationRequest(raw);
        if (request.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_TAPE) {
            this.configureTape(request);
            return;
        }
        if (request.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_DEPTH) {
            this.configureDepth(request);
            return;
        }
        if (request.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY) {
            await this.loadCandleHistory(request);
            return;
        }
        if (request.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.UNSUBSCRIBE) {
            if (this.current?.requestId === request.requestId) {
                this.stopCurrent();
                this.tapeSettings = FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS;
                this.depthRange = null;
                this.depthPage = 0;
            }
            return;
        }
        if (request.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_INTERVAL
            && this.current?.symbol === request.symbol
            && this.current.bootstrapped === true
            && this.current.reconnectTimer === null
            && typeof this.current.stream?.selectInterval === 'function') {
            await this.selectInterval(request, emit);
            return;
        }
        await this.startGeneration(request, emit, 0);
    }

    // History is read on demand and delivered behind the live window. It never
    // touches session.candles: the live series stays the single writer of the
    // tail, so a slow history read can never rewind what the stream just drew.
    async loadCandleHistory(request) {
        const session = this.current;
        if (!session
            || !this.isCurrent(session)
            || session.requestId !== request.requestId
            || session.symbol !== request.symbol
            || session.interval !== request.interval) {
            throw new FuturesProductionWorkstationServiceError('CANDLE_HISTORY_OWNER_UNAVAILABLE');
        }
        if (typeof this.transport.readCandleHistory !== 'function') {
            throw new FuturesProductionWorkstationServiceError('CANDLE_HISTORY_UNSUPPORTED');
        }
        const { endTime, interval } = request;
        let rows;
        try {
            rows = normalizeFuturesWorkstationKlines(await this.transport.readCandleHistory({
                symbol: session.symbol,
                interval,
                endTime,
                limit: request.limit,
                signal: session.abortController.signal,
            }));
        } catch (error) {
            // A failed history read leaves the chart exactly as it was; the
            // operator can scroll again. It is never a reason to resync a live
            // session that is otherwise healthy.
            this.onInternalError({ phase: 'candle-history', code: safeCode(error) });
            return;
        }
        // The session may have moved to another contract or interval while the
        // read was in flight; that history belongs to nothing now.
        if (!this.isCurrent(session)
            || session.requestId !== request.requestId
            || session.symbol !== request.symbol
            || session.interval !== interval) return;
        this.emitCandleHistory(session, { endTime, interval, rows });
    }

    emitCandleHistory(session, { endTime, interval, rows }) {
        const pageSize = FUTURES_WORKSTATION_MARKET_LIMITS.RENDERER_CANDLES;
        const pages = Math.max(1, Math.ceil(rows.length / pageSize));
        for (let page = 0; page < pages; page += 1) {
            const offset = page * pageSize;
            const emitted = this.emitResource(
                session,
                FUTURES_WORKSTATION_RESOURCES.CANDLE_HISTORY,
                FUTURES_WORKSTATION_STATES.LIVE,
                Object.freeze({
                    series: 'contract',
                    interval,
                    endTime,
                    offset,
                    total: rows.length,
                    complete: page === pages - 1,
                    rows: Object.freeze(rows.slice(offset, offset + pageSize)),
                }),
            );
            if (!emitted) return;
        }
    }

    // The rows on screen reach this far past the best price. If the book on hand
    // cannot prove that far, a deeper page is bought and bridged — the operator
    // asked for the range by choosing the step, so the weight is paid for
    // something asked for.
    configureDepth(request) {
        const session = this.current;
        if (!session || !this.isCurrent(session) || session.requestId !== request.requestId) {
            throw new FuturesProductionWorkstationServiceError('DEPTH_OWNER_UNAVAILABLE');
        }
        this.depthRange = request.range;
        session.depthRange = request.range;
        if (!session.bootstrapped) return;
        // The reading bounds the delivery, so a new reading is a new delivery —
        // from the book already in hand, since the trim was never on what is
        // retained. Waiting for the next diff would answer a coarsened step
        // within a diff or two on a busy contract and never on a quiet one,
        // which is the contract most likely to be read at a coarse step.
        const shortfall = session.orderBook.rangeShortfall(session.depthRange);
        const view = session.orderBook.toRendererView(session.depthRange);
        if (view !== null) {
            session.lastDepthView = view;
            this.emitResource(
                session,
                FUTURES_WORKSTATION_RESOURCES.DEPTH,
                this.depthDeliveryState(session, shortfall),
                view,
            );
        }
        this.ensureDepthCovers(session, shortfall);
    }

    /**
     * The state a book is delivered in.
     *
     * A book that cannot prove the rows on screen is not live, whatever the
     * socket is doing. What came back from the desk was a full ask ladder over
     * seven bid rows under a green badge: the book was stating correctly that it
     * could not prove the bid side, and the badge was stating that everything
     * was fine. The rows it can prove are still delivered — they are the market,
     * and they are exact — but they are delivered as what they are.
     *
     * The shortfall is passed in wherever the caller has already measured it:
     * one reading per frame, not one per question asked about the frame.
     */
    depthDeliveryState(session, shortfall = null) {
        if (session.staleResources.has(FUTURES_WORKSTATION_RESOURCES.DEPTH)) {
            return FUTURES_WORKSTATION_STATES.STALE;
        }
        const short = shortfall === null
            ? session.orderBook.rangeShortfall(session.depthRange)
            : shortfall;
        return short === 0
            ? FUTURES_WORKSTATION_STATES.LIVE
            : FUTURES_WORKSTATION_STATES.STALE;
    }

    ensureDepthCovers(session, shortfall = null) {
        if (!this.isCurrent(session)
            || !session.bootstrapped
            || session.reconnectTimer !== null
            || session.bookRecovering
            || session.depthRange === null) return;
        const short = shortfall === null
            ? session.orderBook.rangeShortfall(session.depthRange)
            : shortfall;
        if (short === 0) return;
        // Two different things end up here, and only one of them is worth a
        // deeper page. A page that falls short of the reading on either side buys
        // a deeper one — and at the deepest page the exchange publishes there is
        // none to buy, so the book keeps showing what it can prove rather than
        // re-reading the same page forever. A page that reached the rows on both
        // sides when it was read needs no deeper one at all: the market has
        // walked out from between its edges, and the same page re-read is a band
        // centred where the market is now. That is the case every page must
        // answer, the deepest one included — a book that stopped covering its
        // rows and could not ask again would stay short for the session.
        //
        // An unmeasurable shortfall is the second case: a side emptied by the
        // walk states no distance to size a page against, so it is re-read as it
        // is and sized on the next reading, which will have both sides.
        const deepened = Number.isFinite(short) && short > 1 && this.deepenDepthPage(short);
        if (Number.isFinite(short) && short > 1 && !deepened) return;
        const now = this.observedNow(session);
        // Only the re-read is backed off, and for the reason a recovery is:
        // every diff landing on a book the market has walked out of would ask
        // for the same page again. A deepening is bounded by the ladder itself —
        // four rungs, ratcheting one way — so making it wait was making the
        // operator wait five seconds a rung for a book they were already trading
        // against.
        if (!deepened
            && session.depthDeepenedAt !== null
            && now - session.depthDeepenedAt
                < FUTURES_PRODUCTION_WORKSTATION_BOOK_RECOVERY.COOLDOWN_MS) return;
        session.depthDeepenedAt = now;
        void this.recoverBook(session, 'DEPTH_RANGE_SHORT', { immediate: deepened });
    }

    configureTape(request) {
        const session = this.current;
        if (!session || !this.isCurrent(session) || session.requestId !== request.requestId) {
            throw new FuturesProductionWorkstationServiceError('TAPE_OWNER_UNAVAILABLE');
        }
        const settings = freezeTapeSettings(request);
        this.tapeSettings = settings;
        session.tapeSettings = settings;
        this.clearPendingTapeTimer(session);
        session.lastTapeEmittedAt = null;
        if (!session.bootstrapped) return;
        const state = session.staleResources.has(FUTURES_WORKSTATION_RESOURCES.TRADES)
            ? FUTURES_WORKSTATION_STATES.STALE
            : FUTURES_WORKSTATION_STATES.LIVE;
        this.emitTrades(session, state, {
            force: true,
            recordWindow: settings.throttleEnabled,
        });
    }

    async selectInterval(request, emit, reconnectAttempt = 0) {
        const session = this.current;
        if (!session
            || session.symbol !== request.symbol
            || session.bootstrapped !== true
            || session.reconnectTimer !== null
            || typeof session.stream?.selectInterval !== 'function') {
            await this.startGeneration(request, emit, 0);
            return;
        }

        if (session.intervalReconnectTimer !== null) {
            this.clock.clearTimeout(session.intervalReconnectTimer);
            session.intervalReconnectTimer = null;
        }

        session.intervalEpoch += 1;
        const intervalEpoch = session.intervalEpoch;
        session.intervalAbortController?.abort();
        const intervalAbortController = new AbortController();
        session.intervalAbortController = intervalAbortController;
        const abortFromSession = () => intervalAbortController.abort();
        if (session.abortController.signal.aborted) abortFromSession();
        else session.abortController.signal.addEventListener('abort', abortFromSession, { once: true });

        session.request = request;
        session.requestId = request.requestId;
        session.interval = request.interval;
        session.emit = emit;
        session.intervalReconnectAttempt = reconnectAttempt;
        session.candles = Object.freeze([]);
        session.indexCandles = Object.freeze([]);
        session.pendingCandleEvents = [];
        session.intervalBootstrapping = true;
        this.emitStatus(session, FUTURES_WORKSTATION_STATES.LOADING, true, null);

        const isCurrentInterval = () => this.isCurrent(session)
            && session.reconnectTimer === null
            && session.intervalReconnectTimer === null
            && session.intervalEpoch === intervalEpoch
            && session.interval === request.interval
            && session.requestId === request.requestId
            && !intervalAbortController.signal.aborted;

        try {
            const streamReady = await session.stream.selectInterval({
                interval: request.interval,
                signal: intervalAbortController.signal,
            });
            if (!isCurrentInterval()) return;
            if (streamReady !== true) {
                throw new FuturesProductionWorkstationServiceError('INTERVAL_SOCKET_NOT_READY');
            }
            const bootstrap = await this.transport.bootstrapInterval({
                symbol: session.symbol,
                pair: session.pair,
                interval: request.interval,
                signal: intervalAbortController.signal,
            });
            if (!isCurrentInterval()) return;
            session.candles = normalizeFuturesWorkstationKlines(bootstrap?.contractKlines);
            session.indexCandles = normalizeFuturesWorkstationKlines(bootstrap?.indexKlines);
            session.lastCandlesAt = this.observedNow(session);
            session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.CANDLES);
            this.emitCandleSeries(session, 'contract', session.candles);
            this.emitCandleSeries(session, 'index', session.indexCandles);
            session.intervalBootstrapping = false;
            for (const event of session.pendingCandleEvents) this.applyStreamEvent(session, event);
            session.pendingCandleEvents = [];
            if (!isCurrentInterval()) return;
            session.intervalReconnectAttempt = 0;
            this.emitStatus(session, FUTURES_WORKSTATION_STATES.LIVE, true, null);
        } catch (error) {
            if (!isCurrentInterval()) return;
            session.intervalBootstrapping = false;
            session.pendingCandleEvents = [];
            const reasonCode = safeCode(error);
            this.onInternalError({ phase: 'interval-bootstrap', code: reasonCode });
            this.scheduleIntervalResync(session, reasonCode);
        } finally {
            session.abortController.signal.removeEventListener?.('abort', abortFromSession);
            if (session.intervalAbortController === intervalAbortController) {
                session.intervalAbortController = null;
            }
        }
    }

    isCurrent(session) {
        return !this.stopped
            && this.current === session
            && !session.abortController.signal.aborted;
    }

    observedNow(session) {
        const now = this.clock.now();
        if (!Number.isSafeInteger(now) || now < 0) {
            throw new FuturesProductionWorkstationServiceError('INVALID_CLOCK');
        }
        if (now < session.lastClock) {
            if (session.clockRegressed) return session.lastClock;
            session.clockRegressed = true;
            throw new FuturesProductionWorkstationServiceError('CLOCK_REGRESSION');
        }
        session.lastClock = now;
        return now;
    }

    emitResource(session, resource, state, payload) {
        if (!this.isCurrent(session)) return false;
        session.revision += 1;
        const event = createFuturesProductionWorkstationEvent({
            requestId: session.requestId,
            symbol: session.symbol,
            generation: session.generation,
            revision: session.revision,
            resource,
            state,
            observedAt: this.observedNow(session),
            payload,
        });
        if (Buffer.byteLength(JSON.stringify(event), 'utf8') > FUTURES_WORKSTATION_EVENT_MAX_BYTES) {
            throw new FuturesProductionWorkstationServiceError('OUTBOUND_FRAME_TOO_LARGE');
        }
        session.emit(event);
        return true;
    }

    emitStatus(session, state, connected, reasonCode = null) {
        return this.emitResource(
            session,
            FUTURES_WORKSTATION_RESOURCES.STATUS,
            state,
            Object.freeze({ connected, reasonCode }),
        );
    }

    delay(durationMs) {
        return new Promise((resolve) => {
            const timer = this.clock.setTimeout(resolve, durationMs);
            timer?.unref?.();
        });
    }

    emitAggregateTiming(session, outcome) {
        try {
            const finishedAt = this.clock.now();
            const durationMs = Number.isSafeInteger(finishedAt)
                && Number.isSafeInteger(session.startedAt)
                ? Math.max(0, finishedAt - session.startedAt)
                : 0;
            this.onTiming(Object.freeze({
                phase: 'aggregate-ready',
                durationMs,
                outcome,
                cache: null,
            }));
        } catch {
            // Diagnostics are observational and cannot affect market-data delivery.
        }
    }

    async startGeneration(request, emit, reconnectAttempt) {
        this.stopCurrent();
        this.generation += 1;
        // A contract is opened on the cheapest page, whatever the last one
        // needed: one cheap read is a smaller price than every contract paying
        // for the deepest reading of the session.
        //
        // The reading is not carried across either. It is a distance in the
        // contract's own quote currency, so the one stated for the contract
        // being left says nothing about the one being opened — carried across, a
        // step of 1 on a contract priced in whole dollars would read as an
        // impossible range on one priced in ten-thousandths and buy the deepest
        // page to cover it. It comes instead from the request that opens the
        // contract, which carries it when the panel already has one for that
        // contract; the page that covers it is then bought against the first
        // band the snapshot proves, rather than after the operator has read a
        // short book for a while. A reconnect keeps what the session had: that
        // is the same contract, still on screen.
        if (reconnectAttempt === 0) {
            this.depthPage = 0;
            this.depthRange = typeof request.range === 'string' ? request.range : null;
        }
        const session = {
            request,
            requestId: request.requestId,
            symbol: request.symbol,
            interval: request.interval,
            pair: request.symbol,
            generation: this.generation,
            revision: 0,
            intervalEpoch: 0,
            intervalAbortController: null,
            intervalBootstrapping: false,
            pendingCandleEvents: [],
            intervalReconnectAttempt: 0,
            intervalReconnectTimer: null,
            reconnectAttempt,
            emit,
            abortController: new AbortController(),
            stream: null,
            reconnectTimer: null,
            freshnessTimer: null,
            // The last book the renderer was given, kept so a recovery can leave
            // it on screen rather than blanking the panel.
            lastDepthView: null,
            bookRecovering: false,
            bookRecoveredAt: null,
            frameRefusedAt: null,
            frameRefusalStated: false,
            orderBook: new FuturesWorkstationOrderBook(),
            bootstrapped: false,
            pendingEvents: [],
            contracts: Object.freeze([]),
            contract: null,
            header: null,
            bootstrapDepthSnapshot: null,
            bootstrapPremium: null,
            bootstrapTicker: null,
            candles: Object.freeze([]),
            indexCandles: Object.freeze([]),
            trades: Object.freeze([]),
            tapeSettings: this.tapeSettings,
            depthRange: this.depthRange,
            depthDeepenedAt: null,
            pendingTapeTimer: null,
            pendingTapeEmission: false,
            lastTapeEmittedAt: null,
            lastTapeFingerprint: null,
            lastHeaderAt: 0,
            lastCandlesAt: 0,
            lastDepthAt: 0,
            lastTradesAt: 0,
            staleResources: new Set(),
            lastClock: 0,
            clockRegressed: false,
            startedAt: this.clock.now(),
        };
        this.current = session;
        this.emitStatus(session, FUTURES_WORKSTATION_STATES.LOADING, false, null);

        let bootstrapAbort = null;
        let releaseBootstrapAbort = null;
        try {
            const exchangeInfo = await this.transport.loadExchangeInfo({
                signal: session.abortController.signal,
            });
            if (!this.isCurrent(session)) return;
            session.contracts = normalizeFuturesWorkstationExchangeInfo(exchangeInfo);
            for (const frame of createFuturesWorkstationCatalogFrames(session.contracts)) {
                this.emitResource(
                    session,
                    FUTURES_WORKSTATION_RESOURCES.CATALOG,
                    FUTURES_WORKSTATION_STATES.LIVE,
                    frame,
                );
            }
            session.contract = session.contracts.find(contract => contract.symbol === session.symbol);
            if (!session.contract) {
                this.emitStatus(
                    session,
                    FUTURES_WORKSTATION_STATES.UNAVAILABLE,
                    false,
                    'SYMBOL_UNAVAILABLE',
                );
                return;
            }
            session.pair = session.contract.pair;
            session.orderBook.beginBootstrap();
            session.stream = this.transport.connect({
                symbol: session.symbol,
                pair: session.pair,
                interval: session.interval,
                signal: session.abortController.signal,
                onMessage: raw => this.handleStreamFrame(session, raw),
                onDisconnect: reason => this.handleDisconnect(session, reason),
                onCandleDisconnect: reason => this.handleCandleDisconnect(session, reason),
                onFrameRefused: reason => this.handleFrameRefused(session, reason),
            });
            if (!session.stream
                || typeof session.stream.close !== 'function'
                || typeof session.stream.ready?.then !== 'function') {
                throw new FuturesProductionWorkstationServiceError('INVALID_STREAM_HANDLE');
            }
            // Bootstrap reads are scoped to their own controller so an early
            // return or resync aborts them without tearing down the session.
            bootstrapAbort = new AbortController();
            const abortBootstrapFromSession = () => bootstrapAbort.abort();
            if (session.abortController.signal.aborted) abortBootstrapFromSession();
            else {
                session.abortController.signal.addEventListener(
                    'abort',
                    abortBootstrapFromSession,
                    { once: true },
                );
                releaseBootstrapAbort = () => session.abortController.signal.removeEventListener(
                    'abort',
                    abortBootstrapFromSession,
                );
            }
            const deliveredBootstrapResources = new Set();
            const deliverBootstrapResource = ({ resource, value } = {}) => {
                if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
                if (deliveredBootstrapResources.has(resource)) return;
                if (resource === 'contractKlines') {
                    session.candles = normalizeFuturesWorkstationKlines(value);
                    session.lastCandlesAt = this.observedNow(session);
                    this.emitCandleSeries(session, 'contract', session.candles);
                } else if (resource === 'indexKlines') {
                    session.indexCandles = normalizeFuturesWorkstationKlines(value);
                    session.lastCandlesAt = this.observedNow(session);
                    this.emitCandleSeries(session, 'index', session.indexCandles);
                } else if (resource === 'premiumIndex') {
                    session.bootstrapPremium = normalizeFuturesWorkstationPremiumIndex(
                        value,
                        session.symbol,
                    );
                } else if (resource === 'ticker') {
                    session.bootstrapTicker = normalizeFuturesWorkstationTicker(
                        value,
                        session.symbol,
                    );
                } else {
                    throw new FuturesProductionWorkstationServiceError(
                        'UNKNOWN_BOOTSTRAP_RESOURCE',
                    );
                }
                deliveredBootstrapResources.add(resource);
                if (session.header === null
                    && session.bootstrapPremium !== null
                    && session.bootstrapTicker !== null) {
                    session.header = createFuturesWorkstationHeader({
                        premium: session.bootstrapPremium,
                        ticker: session.bootstrapTicker,
                        contractStatus: session.contract.status,
                    });
                    session.lastHeaderAt = this.observedNow(session);
                    this.emitResource(
                        session,
                        FUTURES_WORKSTATION_RESOURCES.HEADER,
                        FUTURES_WORKSTATION_STATES.LIVE,
                        session.header,
                    );
                }
            };
            // The four socket-independent reads start immediately, concurrent
            // with the WebSocket handshakes. The rejection is observed here so
            // an early return below cannot surface an unhandled rejection; the
            // await further down still rethrows.
            const independentReads = this.transport.bootstrapIndependent({
                symbol: session.symbol,
                pair: session.pair,
                interval: session.interval,
                signal: bootstrapAbort.signal,
                onBootstrapResource: deliverBootstrapResource,
            });
            independentReads.catch(() => {});
            if (session.reconnectTimer !== null) {
                session.stream.close();
                session.stream = null;
                return;
            }
            const streamReady = await session.stream.ready;
            if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
            if (streamReady !== true) {
                this.scheduleResync(session, 'SOCKET_NOT_READY');
                return;
            }
            // The depth snapshot must be taken only after the depth socket is
            // open so buffered diffs can bridge it.
            const depthValue = await this.transport.readDepthSnapshot({
                symbol: session.symbol,
                signal: bootstrapAbort.signal,
                limit: this.depthPageLimit(),
            });
            if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
            session.bootstrapDepthSnapshot = normalizeFuturesWorkstationDepthSnapshot(
                depthValue,
                session.symbol,
            );
            const bootstrap = await independentReads;
            if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
            for (const resource of [
                'contractKlines',
                'indexKlines',
                'premiumIndex',
                'ticker',
            ]) {
                deliverBootstrapResource({ resource, value: bootstrap?.[resource] });
            }
            let bookResult = session.orderBook.bootstrap(session.bootstrapDepthSnapshot);
            let depthRetryAttempt = 0;
            while (!bookResult.live && depthRetryAttempt < 3) {
                // A missed bridge follows Binance's documented depth-sync
                // algorithm: keep the sockets and re-arm the diff buffer in the
                // same tick, wait for fresh diffs, then take a newer snapshot.
                session.orderBook.beginBootstrap();
                depthRetryAttempt += 1;
                await this.delay(200 * (2 ** (depthRetryAttempt - 1)));
                if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
                const retryValue = await this.transport.readDepthSnapshot({
                    symbol: session.symbol,
                    signal: bootstrapAbort.signal,
                    retryAttempt: depthRetryAttempt,
                    limit: this.depthPageLimit(),
                });
                if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
                session.bootstrapDepthSnapshot = normalizeFuturesWorkstationDepthSnapshot(
                    retryValue,
                    session.symbol,
                );
                bookResult = session.orderBook.bootstrap(session.bootstrapDepthSnapshot);
            }
            session.bootstrapped = true;
            const now = this.observedNow(session);
            session.lastHeaderAt = now;
            session.lastCandlesAt = now;
            session.lastDepthAt = now;
            session.lastTradesAt = now;
            this.emitTrades(session, FUTURES_WORKSTATION_STATES.LIVE, { force: true });
            for (const event of session.pendingEvents) this.applyStreamEvent(session, event);
            session.pendingEvents = [];
            if (!this.isCurrent(session)) return;
            if (bookResult.live) {
                const shortfall = session.orderBook.rangeShortfall(session.depthRange);
                session.lastDepthView = session.orderBook.toRendererView(session.depthRange);
                this.emitResource(
                    session,
                    FUTURES_WORKSTATION_RESOURCES.DEPTH,
                    this.depthDeliveryState(session, shortfall),
                    session.lastDepthView,
                );
                // The reading travelled with the request that opened the
                // contract, so the page that covers it is bought as soon as the
                // first band is measured rather than on whichever diff happens
                // to land first. On a contract quiet enough that none does, the
                // difference is between half a second and never.
                this.ensureDepthCovers(session, shortfall);
            }
            session.reconnectAttempt = 0;
            this.emitStatus(session, FUTURES_WORKSTATION_STATES.LIVE, true, null);
            this.emitAggregateTiming(session, bookResult.live ? 'ok' : 'no-book');
            this.startFreshnessMonitor(session);
            // A book that could not be bridged is a stale book, not a dead desk.
            // The chart, the candles, the header and the tape are all here and
            // none of them comes from the book — throwing here instead closed
            // every stream and rebuilt the generation, so a contract too quiet
            // to bridge took the whole workspace down with it, eight times, and
            // then gave up. The recovery keeps asking on its own cooldown, which
            // is what a live book already does with a sequence gap.
            if (!bookResult.live) {
                void this.recoverBook(session, depthBootstrapCode(bookResult.reason));
            }
        } catch (error) {
            if (!this.isCurrent(session)) return;
            this.emitAggregateTiming(session, 'error');
            this.onInternalError({ phase: 'bootstrap', code: safeCode(error) });
            this.scheduleResync(session, safeCode(error));
        } finally {
            // Any bootstrap read still in flight after this generation settles
            // (success, resync, or teardown) is abandoned.
            bootstrapAbort?.abort();
            releaseBootstrapAbort?.();
        }
    }

    emitCandleSeries(session, series, rows, state = FUTURES_WORKSTATION_STATES.LIVE) {
        this.emitResource(
            session,
            FUTURES_WORKSTATION_RESOURCES.CANDLES,
            state,
            Object.freeze({
                series,
                interval: session.interval,
                rows: toRendererCandleRows(rows),
            }),
        );
    }

    rendererTapeRows(session) {
        return toRendererTradeRows(session.trades.filter(row => (
            tradeMeetsTapeNotional(row, session.tapeSettings.minNotionalUsdt)
        )));
    }

    clearPendingTapeTimer(session) {
        if (session?.pendingTapeTimer !== null && session?.pendingTapeTimer !== undefined) {
            this.clock.clearTimeout(session.pendingTapeTimer);
            session.pendingTapeTimer = null;
        }
        if (session) session.pendingTapeEmission = false;
    }

    emitTrades(
        session,
        state = FUTURES_WORKSTATION_STATES.LIVE,
        { force = false, recordWindow = false } = {},
    ) {
        if (state !== FUTURES_WORKSTATION_STATES.LIVE) this.clearPendingTapeTimer(session);
        const rows = this.rendererTapeRows(session);
        const fingerprint = tapeFingerprint(state, rows);
        if (!force && fingerprint === session.lastTapeFingerprint) return false;
        const emitted = this.emitResource(
            session,
            FUTURES_WORKSTATION_RESOURCES.TRADES,
            state,
            Object.freeze({ rows }),
        );
        if (emitted) {
            session.lastTapeFingerprint = fingerprint;
            if (recordWindow) session.lastTapeEmittedAt = session.lastClock;
        }
        return emitted;
    }

    queueTapeEmission(session) {
        const rows = this.rendererTapeRows(session);
        const fingerprint = tapeFingerprint(FUTURES_WORKSTATION_STATES.LIVE, rows);
        if (fingerprint === session.lastTapeFingerprint) {
            this.clearPendingTapeTimer(session);
            return;
        }
        if (!session.tapeSettings.throttleEnabled) {
            this.clearPendingTapeTimer(session);
            session.lastTapeEmittedAt = null;
            this.emitTrades(session);
            return;
        }

        const now = session.lastClock;
        const elapsed = session.lastTapeEmittedAt === null
            ? session.tapeSettings.timeoutMs
            : Math.max(0, now - session.lastTapeEmittedAt);
        if (elapsed >= session.tapeSettings.timeoutMs) {
            this.clearPendingTapeTimer(session);
            this.emitTrades(session, FUTURES_WORKSTATION_STATES.LIVE, { recordWindow: true });
            return;
        }

        session.pendingTapeEmission = true;
        if (session.pendingTapeTimer !== null) return;
        const generation = session.generation;
        session.pendingTapeTimer = this.clock.setTimeout(() => {
            session.pendingTapeTimer = null;
            if (!this.isCurrent(session)
                || session.generation !== generation
                || !session.pendingTapeEmission) return;
            session.pendingTapeEmission = false;
            this.emitTrades(session, FUTURES_WORKSTATION_STATES.LIVE, { recordWindow: true });
        }, session.tapeSettings.timeoutMs - elapsed);
        session.pendingTapeTimer?.unref?.();
    }

    handleStreamFrame(session, raw) {
        if (!this.isCurrent(session)) return;
        try {
            const event = normalizeFuturesWorkstationStreamFrame(raw, {
                symbol: session.symbol,
                pair: session.pair,
                interval: session.interval,
            });
            if (event.kind === 'kline' && session.intervalBootstrapping) {
                if (session.pendingCandleEvents.length
                    >= FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.PENDING_EVENTS) {
                    session.pendingCandleEvents.shift();
                }
                session.pendingCandleEvents.push(event);
                return;
            }
            if (event.kind === 'depth') {
                const result = session.orderBook.push({
                    firstUpdateId: event.firstUpdateId,
                    finalUpdateId: event.finalUpdateId,
                    previousFinalUpdateId: event.previousFinalUpdateId,
                    bids: event.bids,
                    asks: event.asks,
                    eventTime: event.eventTime,
                }, event.frameBytes);
                // The book is the one resource the desk can lose without losing
                // the desk: the price, the candles, the tape and the account's
                // own PnL do not come from it, and in a violent move the
                // operator is not reading it. So a broken sequence rebuilds the
                // book and nothing else — it used to resynchronize the whole
                // workspace, which is how a burst took the desk off the market.
                if (result.resync) void this.recoverBook(session, 'DEPTH_SEQUENCE_GAP');
                else if (result.applied && session.bootstrapped) {
                    session.lastDepthAt = this.observedNow(session);
                    session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.DEPTH);
                    // Asked before the frame is delivered, not after it: the
                    // state a frame carries is decided by the book that frame
                    // contains. Asked afterwards, the operator had already read
                    // a short book badged live by the time the desk worked out
                    // it was short.
                    const shortfall = session.orderBook.rangeShortfall(session.depthRange);
                    session.lastDepthView = session.orderBook.toRendererView(session.depthRange);
                    this.emitResource(
                        session,
                        FUTURES_WORKSTATION_RESOURCES.DEPTH,
                        this.depthDeliveryState(session, shortfall),
                        session.lastDepthView,
                    );
                    // The market moves; the band the snapshot proved does not.
                    // When it stops reaching as far as the rows on screen, the
                    // answer is a fresh snapshot — not a book extended past what
                    // it can account for.
                    this.ensureDepthCovers(session, shortfall);
                }
                return;
            }
            if (!session.bootstrapped) {
                if (session.pendingEvents.length >= FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.PENDING_EVENTS) {
                    session.pendingEvents.shift();
                }
                session.pendingEvents.push(event);
                return;
            }
            this.applyStreamEvent(session, event);
        } catch (error) {
            if (!this.isCurrent(session)) return;
            this.onInternalError({ phase: 'stream', code: safeCode(error) });
            // A depth frame the desk could not read is a book problem. Only a
            // frame from the streams the desk actually trades on — price,
            // candles, tape — is worth the whole session.
            if (isDepthStreamFrame(raw)) {
                void this.recoverBook(session, 'MALFORMED_DEPTH_FRAME');
                return;
            }
            this.scheduleResync(session, 'MALFORMED_STREAM_FRAME');
        }
    }

    /**
     * Rebuild the book without touching the session.
     *
     * The streams stay open, so diffs keep buffering while a fresh snapshot is
     * read and bridged — Binance's own depth-sync algorithm, which the initial
     * bootstrap already performs. Until it succeeds the book is stale and says
     * so; the desk stays live around it. A recovery that fails leaves the book
     * stale rather than escalating: nothing else on the desk depends on it.
     */
    async recoverBook(session, reasonCode, { immediate = false } = {}) {
        if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
        if (session.bookRecovering) return;
        const now = this.observedNow(session);
        // Backed off between rounds, because every diff arriving on a book that
        // is not bridged asks for another one.
        //
        // A read that buys a rung of the ladder is exempt: the ladder is four
        // rungs and ratchets one way, so it cannot loop, and the backoff was
        // costing five seconds a rung on the one book the operator opened the
        // contract to read. A recovery that failed still backs off — the stamp
        // below is taken either way, so the next read that is not a rung waits
        // for it.
        if (!immediate
            && session.bookRecoveredAt !== null
            && now - session.bookRecoveredAt < FUTURES_PRODUCTION_WORKSTATION_BOOK_RECOVERY.COOLDOWN_MS) return;
        session.bookRecovering = true;
        session.bookRecoveredAt = now;
        try {
            // Inside the guard: anything that raises out here would leave
            // `bookRecovering` set and the book unable to ask again for the rest
            // of the session.
            this.onInternalError({ phase: 'book-recovery', code: reasonCode });
            this.markResourceStale(
                session,
                FUTURES_WORKSTATION_RESOURCES.DEPTH,
                session.lastDepthView,
            );
            for (let attempt = 1;
                attempt <= FUTURES_PRODUCTION_WORKSTATION_BOOK_RECOVERY.ATTEMPTS;
                attempt += 1) {
                if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
                session.orderBook.beginBootstrap();
                await this.delay(
                    FUTURES_PRODUCTION_WORKSTATION_BOOK_RECOVERY.BRIDGE_MS * (2 ** (attempt - 1)),
                );
                if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
                try {
                    const value = await this.transport.readDepthSnapshot({
                        symbol: session.symbol,
                        signal: session.abortController.signal,
                        retryAttempt: attempt,
                        limit: this.depthPageLimit(),
                    });
                    if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
                    const snapshot = normalizeFuturesWorkstationDepthSnapshot(
                        value,
                        session.symbol,
                    );
                    if (!session.orderBook.bootstrap(snapshot).live) continue;
                } catch (error) {
                    this.onInternalError({ phase: 'book-recovery', code: safeCode(error) });
                    continue;
                }
                session.lastDepthAt = this.observedNow(session);
                session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.DEPTH);
                session.lastDepthView = session.orderBook.toRendererView(session.depthRange);
                this.emitResource(
                    session,
                    FUTURES_WORKSTATION_RESOURCES.DEPTH,
                    this.depthDeliveryState(session),
                    session.lastDepthView,
                );
                // The reason line holds the last code it was given until another
                // status replaces it. A refusal the desk stated and then repaired
                // would otherwise sit there for the rest of the session, naming a
                // condition that is over — so the repair says so once.
                if (session.frameRefusalStated) {
                    session.frameRefusalStated = false;
                    this.emitStatus(session, FUTURES_WORKSTATION_STATES.LIVE, true, null);
                }
                return;
            }
        } finally {
            session.bookRecovering = false;
            session.bookRecoveredAt = this.observedNow(session);
        }
    }

    applyStreamEvent(session, event) {
        if (!this.isCurrent(session)) return;
        const now = this.observedNow(session);
        if (event.kind === 'trade') {
            // Freshness is proven by the stream, not by eligibility: an ineligible
            // print still means the tape is live.
            session.lastTradesAt = now;
            session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.TRADES);
            // Filter on ingestion so the bounded buffer accumulates trades the
            // operator asked for. Filtering only on delivery let small prints
            // evict the large ones and left the tape almost empty.
            if (tradeMeetsTapeNotional(event.row, session.tapeSettings.minNotionalUsdt)) {
                session.trades = appendFuturesWorkstationTrade(session.trades, event.row);
                this.queueTapeEmission(session);
            }
        } else if (event.kind === 'kline') {
            session.candles = updateFuturesWorkstationCandles(session.candles, event.row);
            session.lastCandlesAt = now;
            session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.CANDLES);
            this.emitCandleSeries(session, 'contract', session.candles);
        } else if (event.kind === 'mark' || event.kind === 'ticker') {
            session.header = updateFuturesWorkstationHeader(session.header, event);
            session.lastHeaderAt = now;
            session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.HEADER);
            this.emitResource(
                session,
                FUTURES_WORKSTATION_RESOURCES.HEADER,
                FUTURES_WORKSTATION_STATES.LIVE,
                session.header,
            );
        }
    }

    markResourceStale(session, resource, payload) {
        if (session.staleResources.has(resource)) return;
        session.staleResources.add(resource);
        // A book that never bridged has no view to deliver. The staleness is
        // still recorded — what cannot be sent is the payload, and sending an
        // empty one is refused by the protocol, which used to raise inside the
        // freshness monitor and resynchronize the session over it.
        if (resource === FUTURES_WORKSTATION_RESOURCES.CANDLES) {
            this.emitCandleSeries(session, 'contract', session.candles, FUTURES_WORKSTATION_STATES.STALE);
        } else if (resource === FUTURES_WORKSTATION_RESOURCES.TRADES) {
            this.emitTrades(session, FUTURES_WORKSTATION_STATES.STALE);
        } else if (payload !== null && payload !== undefined) {
            this.emitResource(session, resource, FUTURES_WORKSTATION_STATES.STALE, payload);
        }
    }

    startFreshnessMonitor(session) {
        session.freshnessTimer = this.clock.setInterval(() => {
            if (!this.isCurrent(session)) return;
            try {
                const now = this.observedNow(session);
                if (now - session.lastHeaderAt > FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.HEADER_MS) {
                    this.markResourceStale(session, FUTURES_WORKSTATION_RESOURCES.HEADER, session.header);
                }
                if (now - session.lastCandlesAt > FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.CANDLES_MS) {
                    this.markResourceStale(session, FUTURES_WORKSTATION_RESOURCES.CANDLES, null);
                }
                if (now - session.lastDepthAt > FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.DEPTH_MS) {
                    this.markResourceStale(
                        session,
                        FUTURES_WORKSTATION_RESOURCES.DEPTH,
                        session.orderBook.toRendererView(session.depthRange),
                    );
                }
                if (now - session.lastTradesAt > FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.TRADES_MS) {
                    this.markResourceStale(session, FUTURES_WORKSTATION_RESOURCES.TRADES, null);
                }
            } catch (error) {
                this.onInternalError({ phase: 'freshness', code: safeCode(error) });
                this.scheduleResync(session, safeCode(error));
            }
        }, FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.CHECK_MS);
        session.freshnessTimer?.unref?.();
    }

    // A connection the exchange dropped, one this desk closed on a rule of its
    // own, and one that failed outright are three different facts, and only the
    // one that names itself can be acted on. The resync carries the reason the
    // socket gave rather than flattening every ending into one code — that flat
    // `SOCKET_DISCONNECTED` is the line the operator was left staring at.
    handleDisconnect(session, reason) {
        if (!this.isCurrent(session)) return;
        const reasonCode = typeof reason === 'string' && /^[A-Z0-9_]{1,96}$/.test(reason)
            ? reason
            : 'SOCKET_DISCONNECTED';
        this.emitStatus(session, FUTURES_WORKSTATION_STATES.DISCONNECTED, false, reasonCode);
        this.scheduleResync(session, reasonCode);
    }

    // A frame this desk refused on its own ceiling is neither a market that went
    // quiet nor a frame the desk could not read, and it costs the book rather
    // than the session — the sequence gap it leaves is recovered by the book's
    // own path. What it owes the operator is its name, on the reason line, while
    // the desk keeps trading around it.
    handleFrameRefused(session, reason) {
        if (!this.isCurrent(session)) return;
        const reasonCode = typeof reason === 'string' && /^[A-Z0-9_]{1,96}$/.test(reason)
            ? reason
            : 'STREAM_FRAME_REFUSED';
        try {
            this.onInternalError({ phase: 'stream-frame', code: reasonCode });
            // Only a desk that is actually live may say so. Before the bootstrap
            // settles, and while a reconnect owns the session, the fault log is
            // the whole report.
            if (!session.bootstrapped || session.reconnectTimer !== null) return;
            // The window is measured against the clock the session has already
            // observed, the way the tape's is. Reading the clock here instead
            // would let a regression discovered on a refused frame set the
            // session's regression flag inside a `catch` that swallows it — and
            // a regression the freshness monitor can no longer raise is a desk
            // that never resynchronizes over it.
            const now = session.lastClock;
            if (session.frameRefusedAt !== null
                && now - session.frameRefusedAt
                    < FUTURES_PRODUCTION_WORKSTATION_FRAME_REFUSAL.REPORT_COOLDOWN_MS) return;
            session.frameRefusedAt = now;
            session.frameRefusalStated = true;
            this.emitStatus(session, FUTURES_WORKSTATION_STATES.LIVE, true, reasonCode);
        } catch {
            // Stating a refused frame must not cost more than the frame did:
            // this runs on the socket's own callback.
        }
    }

    handleCandleDisconnect(session, reason) {
        if (!this.isCurrent(session)) return;
        if (!session.bootstrapped) {
            this.scheduleResync(session, 'CANDLE_SOCKET_DISCONNECTED');
            return;
        }
        const prefixedReason = typeof reason === 'string' ? `CANDLE_${reason}` : '';
        const reasonCode = /^[A-Z0-9_]{1,96}$/.test(prefixedReason)
            ? prefixedReason
            : 'CANDLE_SOCKET_DISCONNECTED';
        this.scheduleIntervalResync(session, reasonCode);
    }

    scheduleIntervalResync(session, reasonCode) {
        if (!this.isCurrent(session)
            || session.reconnectTimer !== null
            || session.intervalReconnectTimer !== null) return;

        session.intervalEpoch += 1;
        session.intervalAbortController?.abort();
        session.intervalBootstrapping = false;
        session.pendingCandleEvents = [];
        this.emitCandleSeries(
            session,
            'contract',
            session.candles,
            FUTURES_WORKSTATION_STATES.UNAVAILABLE,
        );

        if (session.intervalReconnectAttempt
            >= FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_ATTEMPTS) {
            this.emitStatus(
                session,
                FUTURES_WORKSTATION_STATES.LIVE,
                true,
                'INTERVAL_RECONNECT_EXHAUSTED',
            );
            return;
        }

        this.emitStatus(session, FUTURES_WORKSTATION_STATES.LIVE, true, reasonCode);
        const delay = Math.min(
            FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_MAX_MS,
            FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_BASE_MS
                * (2 ** session.intervalReconnectAttempt),
        );
        const request = session.request;
        const emit = session.emit;
        const attempt = session.intervalReconnectAttempt + 1;
        session.intervalReconnectTimer = this.clock.setTimeout(() => {
            session.intervalReconnectTimer = null;
            if (this.isCurrent(session)
                && session.reconnectTimer === null
                && session.requestId === request.requestId
                && session.interval === request.interval) {
                void this.selectInterval(request, emit, attempt);
            }
        }, delay);
        session.intervalReconnectTimer?.unref?.();
    }

    scheduleResync(session, reasonCode) {
        if (!this.isCurrent(session) || session.reconnectTimer !== null) return;
        if (session.reconnectAttempt >= FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_ATTEMPTS) {
            this.emitStatus(
                session,
                FUTURES_WORKSTATION_STATES.UNAVAILABLE,
                false,
                'RECONNECT_EXHAUSTED',
            );
            this.haltSession(session);
            return;
        }
        this.emitStatus(
            session,
            FUTURES_WORKSTATION_STATES.RESYNCHRONIZING,
            false,
            reasonCode,
        );
        session.intervalEpoch += 1;
        session.intervalAbortController?.abort();
        session.intervalAbortController = null;
        session.intervalBootstrapping = false;
        session.pendingCandleEvents = [];
        this.clearPendingTapeTimer(session);
        if (session.intervalReconnectTimer !== null) {
            this.clock.clearTimeout(session.intervalReconnectTimer);
            session.intervalReconnectTimer = null;
        }
        session.stream?.close?.();
        session.stream = null;
        session.orderBook.stop();
        if (session.freshnessTimer !== null) {
            this.clock.clearInterval(session.freshnessTimer);
            session.freshnessTimer = null;
        }
        const delay = Math.min(
            FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_MAX_MS,
            FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_BASE_MS
                * (2 ** session.reconnectAttempt),
        );
        const request = session.request;
        const emit = session.emit;
        const attempt = session.reconnectAttempt + 1;
        session.reconnectTimer = this.clock.setTimeout(() => {
            session.reconnectTimer = null;
            if (this.isCurrent(session)) void this.startGeneration(request, emit, attempt);
        }, delay);
        session.reconnectTimer?.unref?.();
    }

    haltSession(session) {
        if (this.current !== session) return;
        this.current = null;
        this.release(() => session.stream?.close?.());
        session.stream = null;
        this.release(() => session.abortController.abort());
        this.release(() => session.intervalAbortController?.abort());
        this.release(() => session.orderBook.stop());
        this.release(() => this.clearPendingTapeTimer(session));
        if (session.freshnessTimer !== null) {
            this.clock.clearInterval(session.freshnessTimer);
            session.freshnessTimer = null;
        }
        if (session.reconnectTimer !== null) {
            this.clock.clearTimeout(session.reconnectTimer);
            session.reconnectTimer = null;
        }
        if (session.intervalReconnectTimer !== null) {
            this.clock.clearTimeout(session.intervalReconnectTimer);
            session.intervalReconnectTimer = null;
        }
        session.pendingEvents = [];
        session.pendingCandleEvents = [];
    }

    // Every step, independently. A release that gave up half-way left the
    // previous contract's sockets delivering and its timers armed while the desk
    // had already moved on — which is what the operator saw as two contracts
    // flickering against each other.
    release(step) {
        try {
            step();
        } catch (error) {
            this.onInternalError({ phase: 'release', code: safeCode(error) });
        }
    }

    stopCurrent() {
        const session = this.current;
        this.current = null;
        if (!session) return;
        this.release(() => session.abortController.abort());
        this.release(() => session.intervalAbortController?.abort());
        this.release(() => session.stream?.close?.());
        this.release(() => session.orderBook.stop());
        this.release(() => this.clearPendingTapeTimer(session));
        this.release(() => {
            if (session.freshnessTimer !== null) this.clock.clearInterval(session.freshnessTimer);
            if (session.reconnectTimer !== null) this.clock.clearTimeout(session.reconnectTimer);
            if (session.intervalReconnectTimer !== null) {
                this.clock.clearTimeout(session.intervalReconnectTimer);
            }
        });
        session.freshnessTimer = null;
        session.reconnectTimer = null;
        session.intervalReconnectTimer = null;
        session.stream = null;
        session.pendingEvents = [];
        session.pendingCandleEvents = [];
    }

    stop() {
        if (this.stopped) return;
        this.stopped = true;
        this.stopCurrent();
        this.transport.close();
    }
}
