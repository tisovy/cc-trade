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
    // How often a print may move the header's last price. Trades arrive in
    // bursts of dozens; the operator reads one number, and five updates a second
    // is already faster than the eye resolves.
    LAST_PRICE_MS: 200,
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

/**
 * How many contracts the desk keeps running at once, of which it shows one.
 *
 * This is the setting. It is a number the operator moves, not a rebuild, and
 * the cost of moving it is linear and measured — one BTCUSDT-class contract is
 * 28.4 KiB/s, 3.35 ms of parse per second and three sockets:
 *
 * | held | Mbit/s | share of a 600 Mbit link | ms/s parse | one core | sockets |
 * |------|--------|--------------------------|------------|----------|---------|
 * | 1    | 0.23   | 0.04%                    | 3.35       | 0.3%     | 3       |
 * | 4    | 0.93   | 0.16%                    | 13.4       | 1.3%     | 12      |
 * | 8    | 1.86   | 0.31%                    | 26.8       | 2.7%     | 24      |
 * | 16   | 3.73   | 0.62%                    | 53.6       | 5.4%     | 48      |
 *
 * Eight covers a working day's rotation with room to spare. What stops it being
 * larger is not bandwidth or CPU — both are noise at this scale — but sockets:
 * twenty-four connections against the three the desk used to hold, each on
 * Binance's twenty-four-hour rotation, which is about one reconnect an hour
 * across the pool. That is only tolerable because a reconnect is scoped to the
 * session it happens on and is invisible unless it lands on the shown contract.
 *
 * `CC_TRADE_FUTURES_HELD_CONTRACTS` overrides it for a run. A value outside
 * 1..32 is refused rather than clamped: a bound the operator typed wrong should
 * say so at startup, not quietly run at something else.
 */
export const FUTURES_PRODUCTION_WORKSTATION_HELD_CONTRACTS = 8;
export const FUTURES_PRODUCTION_WORKSTATION_HELD_CONTRACTS_MAX = 32;

export const readFuturesProductionWorkstationHeldContracts = (
    value = process.env?.CC_TRADE_FUTURES_HELD_CONTRACTS,
) => {
    if (value === undefined || value === null || value === '') {
        return FUTURES_PRODUCTION_WORKSTATION_HELD_CONTRACTS;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)
        || parsed < 1
        || parsed > FUTURES_PRODUCTION_WORKSTATION_HELD_CONTRACTS_MAX) {
        throw new FuturesProductionWorkstationServiceError('INVALID_POOL_BOUND');
    }
    return parsed;
};

export class FuturesProductionWorkstationService {
    constructor({
        transport,
        clock = systemClock,
        onInternalError = () => {},
        onTiming = () => {},
        heldContracts = FUTURES_PRODUCTION_WORKSTATION_HELD_CONTRACTS,
    } = {}) {
        if (!Number.isSafeInteger(heldContracts)
            || heldContracts < 1
            || heldContracts > FUTURES_PRODUCTION_WORKSTATION_HELD_CONTRACTS_MAX) {
            throw new FuturesProductionWorkstationServiceError('INVALID_POOL_BOUND');
        }
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
        this.heldContracts = heldContracts;
        // The contracts the desk is running, and the one it is showing. They
        // used to be the same object, and every question the service asked
        // about a session answered both at once. A session is held because the
        // desk is keeping it current; it is shown because the operator is
        // looking at it, and only the second decides what reaches the renderer.
        this.sessions = new Map();
        this.shown = null;
        // Which session was shown last, so the pool releases the one the
        // operator has gone longest without. A counter rather than a clock: it
        // orders selections and nothing else, so it cannot be wrong about the
        // time and cannot regress.
        this.selection = 0;
        this.stopped = false;
        this.tapeSettings = FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS;
    }

    depthPageLimit(session) {
        const pages = FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES;
        return pages[Math.min(session.depthPage, pages.length - 1)].limit;
    }

    // Up by however much is short, never back down on its own: a market that
    // walks out of a band it has already outgrown would otherwise buy the same
    // page again and again. `factor` is how many times deeper the band has to
    // be, so a step three sizes coarser buys its page in one read.
    deepenDepthPage(session, factor = 1) {
        const pages = FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES;
        if (session.depthPage >= pages.length - 1) return false;
        const wanted = pages[session.depthPage].limit * Math.max(1, factor);
        const target = pages.findIndex(page => page.limit >= wanted);
        session.depthPage = target < 0
            ? pages.length - 1
            : Math.max(session.depthPage + 1, target);
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
            if (this.shown?.requestId === request.requestId) {
                this.releaseSession(this.shown);
                this.tapeSettings = FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS;
            }
            return;
        }
        // A contract the pool is already holding is selected, not subscribed to.
        // Both actions arrive here: the renderer sends `subscribe` for the first
        // contract of a connection and `select-symbol` afterwards, and a desk
        // whose socket dropped and came back sends `subscribe` again for a
        // contract that never stopped running.
        if ((request.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE
            || request.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_SYMBOL)
            && this.sessions.has(request.symbol)) {
            await this.selectHeldContract(this.sessions.get(request.symbol), request, emit);
            return;
        }
        if (request.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_INTERVAL
            && this.shown?.symbol === request.symbol
            && this.shown.bootstrapped === true
            && this.shown.reconnectTimer === null
            && typeof this.shown.stream?.selectInterval === 'function') {
            await this.selectInterval(request, emit);
            return;
        }
        await this.startGeneration(request, emit, 0);
    }

    // History is read on demand and delivered behind the live window. It never
    // touches session.candles: the live series stays the single writer of the
    // tail, so a slow history read can never rewind what the stream just drew.
    async loadCandleHistory(request) {
        const session = this.shown;
        if (!session
            || !this.isHeld(session)
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
            // Returning here and saying nothing left the renderer holding its
            // request forever: one failed read disabled scrolling left for the
            // rest of the session, with nothing on screen to say why. The
            // failure answers the request it belongs to — same contract, same
            // interval, same `endTime` — so the lock is released and the next
            // scroll asks again.
            if (this.isHeld(session)
                && session.requestId === request.requestId
                && session.symbol === request.symbol
                && session.interval === interval) {
                this.emitCandleHistoryFailure(session, { endTime, interval });
            }
            return;
        }
        // The session may have moved to another contract or interval while the
        // read was in flight; that history belongs to nothing now.
        if (!this.isHeld(session)
            || session.requestId !== request.requestId
            || session.symbol !== request.symbol
            || session.interval !== interval) return;
        this.emitCandleHistory(session, { endTime, interval, rows });
    }

    // A read that could not be served, in the shape of the answer it replaces:
    // the same resource, carrying the request it answers, and `unavailable`
    // rather than `live` so no row of it is mistaken for the exchange saying
    // there is nothing older.
    emitCandleHistoryFailure(session, { endTime, interval }) {
        this.emitResource(
            session,
            FUTURES_WORKSTATION_RESOURCES.CANDLE_HISTORY,
            FUTURES_WORKSTATION_STATES.UNAVAILABLE,
            Object.freeze({
                series: 'contract',
                interval,
                endTime,
                offset: 0,
                total: 0,
                complete: true,
                rows: Object.freeze([]),
            }),
        );
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
        const session = this.shown;
        if (!session || !this.isHeld(session) || session.requestId !== request.requestId) {
            throw new FuturesProductionWorkstationServiceError('DEPTH_OWNER_UNAVAILABLE');
        }
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
        if (!this.isHeld(session)
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
        const deepened = Number.isFinite(short) && short > 1 && this.deepenDepthPage(session, short);
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
        const session = this.shown;
        if (!session || !this.isHeld(session) || session.requestId !== request.requestId) {
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
        const session = this.shown;
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

        const isCurrentInterval = () => this.isHeld(session)
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

    /**
     * Two questions, asked separately, because they are not the same question.
     *
     * `isHeld` asks whether the desk is still running this session — whether the
     * work a callback is about to do still belongs to anything. `isShown` asks
     * whether the operator is looking at it. One session was both at once for as
     * long as the desk held exactly one contract, and every guard in this file
     * asked the pair as a single `isCurrent`, so the answer to "is anyone
     * watching?" silently decided whether a book was rebuilt, a socket was
     * reconnected and a stale resource was noticed.
     *
     * A held session keeps its book, its tape and its candles current whether or
     * not it is shown. So `isHeld` gates the work, and `isShown` gates exactly
     * one thing: delivery to the renderer, at the single point it happens.
     */
    isHeld(session) {
        return !this.stopped
            && this.sessions.get(session.symbol) === session
            && !session.abortController.signal.aborted;
    }

    isShown(session) {
        return this.shown === session;
    }

    // A session becomes the one the renderer is given. The order is recorded
    // here rather than at release time, so the pool can name the contract the
    // operator has gone longest without.
    showSession(session) {
        // A tape payload the outgoing contract was holding back is dropped
        // rather than left armed. It has nothing to deliver any more — the
        // emitter would refuse it — and a timer that fires to do nothing is
        // still a timer per held contract, arming and firing forever.
        if (this.shown !== null && this.shown !== session) {
            this.clearPendingTapeTimer(this.shown);
        }
        this.selection += 1;
        session.shownOrder = this.selection;
        this.shown = session;
    }

    // Room for one more contract. Least recently shown goes first, in full,
    // through the same release a switch uses — a session released half-way is
    // the fault this pool would otherwise multiply by its bound.
    makeRoomForSession(symbol) {
        if (this.sessions.has(symbol)) return;
        const held = [...this.sessions.values()]
            .sort((first, second) => first.shownOrder - second.shownOrder);
        while (this.sessions.size >= this.heldContracts && held.length) {
            this.releaseSession(held.shift());
        }
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

    // The one place a session reaches the renderer, and therefore the one place
    // that asks whether anyone is looking. A held session that is not shown
    // keeps every other line of this file running and stops here: it stays
    // current and it stays silent, and the renderer never learns a contract it
    // did not ask for exists.
    emitResource(session, resource, state, payload) {
        if (!this.isHeld(session) || !this.isShown(session)) return false;
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
        // Serialized once. The string measured against the ceiling is the string
        // that is sent — measuring one and sending another meant serializing a
        // hundred-and-eighteen-kilobyte book twice, ten times a second, for a
        // number the first serialization already knew.
        const frame = JSON.stringify(event);
        if (Buffer.byteLength(frame, 'utf8') > FUTURES_WORKSTATION_EVENT_MAX_BYTES) {
            throw new FuturesProductionWorkstationServiceError('OUTBOUND_FRAME_TOO_LARGE');
        }
        session.emit(event, frame);
        return true;
    }

    emitStatus(session, state, connected, reasonCode = null) {
        // Recorded whether or not anyone is listening. A held session that lost
        // its socket while nobody was watching has to be able to say so when it
        // is selected, and the only record of what it would have said is this.
        session.status = Object.freeze({ state, connected, reasonCode });
        return this.emitResource(
            session,
            FUTURES_WORKSTATION_RESOURCES.STATUS,
            state,
            Object.freeze({ connected, reasonCode }),
        );
    }

    /**
     * A contract the pool is already holding.
     *
     * Nothing opens, nothing closes and nothing is read. What changes is which
     * session is allowed to speak, and who it speaks to: the session takes the
     * identity of the request that selected it, because the renderer discards
     * any frame that does not name the subscription it has just opened. It
     * keeps its generation — it did not bootstrap, and saying it did would tell
     * the renderer to throw away a book that never stopped being correct.
     */
    selectHeldContract(session, request, emit) {
        session.request = request;
        session.requestId = request.requestId;
        session.emit = emit;
        // The tape settings belong to the panel, not to whichever contract
        // happened to be open when they were last changed. The fingerprints and
        // windows beside them are about what this subscription has been sent,
        // and it has been sent nothing.
        session.tapeSettings = this.tapeSettings;
        this.clearPendingTapeTimer(session);
        session.lastTapeFingerprint = null;
        session.lastTapeEmittedAt = null;
        session.lastHeaderEmittedAt = null;
        // The reading travels with the request that selects a contract exactly
        // as it does with the one that opens it. The page already bought stays:
        // that is a property of the book in hand, not of the reading.
        if (typeof request.range === 'string') session.depthRange = request.range;
        this.showSession(session);
        // An interval the session is not on is the one thing a selection cannot
        // serve from what it holds. The candles are left out of the delivery
        // rather than drawn and immediately replaced, and the existing interval
        // path re-reads them over the sockets that stay open.
        const intervalChanged = session.interval !== request.interval;
        this.deliverHeldState(session, { candles: !intervalChanged });
        if (!intervalChanged) return undefined;
        return this.selectInterval(request, emit);
    }

    /**
     * Everything the renderer needs about a contract the desk is already
     * running, taken from what the session is holding.
     *
     * The catalog goes first, because a renderer that has just reconnected has
     * no contract list of its own. The status goes last, and it is the status
     * the session actually stands in rather than `live` on the strength of
     * being held — a session that fell out of sync unwatched says so here, and
     * that is the only place it can.
     */
    deliverHeldState(session, { candles = true } = {}) {
        if (session.contracts.length > 0) {
            for (const frame of createFuturesWorkstationCatalogFrames(session.contracts)) {
                this.emitResource(
                    session,
                    FUTURES_WORKSTATION_RESOURCES.CATALOG,
                    FUTURES_WORKSTATION_STATES.LIVE,
                    frame,
                );
            }
        }
        let shortfall = null;
        if (session.bootstrapped) {
            // An interval bootstrap in flight has already emptied the series and
            // will deliver the new one. Sending what is there now would draw an
            // empty chart badged live over a contract that has candles coming.
            if (candles && !session.intervalBootstrapping) {
                const candleState = session.staleResources.has(
                    FUTURES_WORKSTATION_RESOURCES.CANDLES,
                )
                    ? FUTURES_WORKSTATION_STATES.STALE
                    : FUTURES_WORKSTATION_STATES.LIVE;
                this.emitCandleSeries(session, 'contract', session.candles, candleState);
                this.emitCandleSeries(session, 'index', session.indexCandles, candleState);
            }
            if (session.header !== null) this.emitHeader(session, this.observedNow(session));
            shortfall = session.orderBook.rangeShortfall(session.depthRange);
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
            this.emitTrades(
                session,
                session.staleResources.has(FUTURES_WORKSTATION_RESOURCES.TRADES)
                    ? FUTURES_WORKSTATION_STATES.STALE
                    : FUTURES_WORKSTATION_STATES.LIVE,
                { force: true },
            );
        }
        if (session.status !== null) {
            this.emitStatus(
                session,
                session.status.state,
                session.status.connected,
                session.status.reasonCode,
            );
        }
        if (session.bootstrapped) this.ensureDepthCovers(session, shortfall);
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
        // A generation replaces whatever this contract was running — a first
        // open, a resubscribe and a reconnect all arrive here — and takes a
        // place in the pool, which the contracts held for longest without being
        // shown make room for.
        const previous = this.sessions.get(request.symbol) ?? null;
        // Whether this generation is entitled to the screen, decided before the
        // session it replaces is released. A contract the desk is opening for
        // the first time is: the operator asked for it. A contract rebuilding
        // itself is entitled to exactly what it already had — a held session
        // whose socket dropped reconnects on its own ladder, and it must not
        // pull the display onto a contract nobody is looking at while silencing
        // the one they are.
        const takesTheScreen = previous === null || this.shown === previous;
        this.releaseSession(previous);
        this.makeRoomForSession(request.symbol);
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
        // is the same contract, still on screen. Both live on the session now,
        // so what a reconnect keeps is read from the session it replaces rather
        // than from a field the next contract would have inherited.
        const openingFresh = reconnectAttempt === 0;
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
            depthRange: openingFresh
                ? (typeof request.range === 'string' ? request.range : null)
                : (previous?.depthRange ?? null),
            depthPage: openingFresh ? 0 : (previous?.depthPage ?? 0),
            depthDeepenedAt: null,
            // A rebuild inherits its place in the pool's order. Left at zero, a
            // background contract that reconnected would look like the one the
            // operator had gone longest without and be the first evicted.
            shownOrder: previous?.shownOrder ?? 0,
            // The last status this session stated, kept so it can state it
            // again to whoever selects the contract next.
            status: null,
            pendingTapeTimer: null,
            pendingTapeEmission: false,
            lastTapeEmittedAt: null,
            lastHeaderEmittedAt: null,
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
        this.sessions.set(session.symbol, session);
        if (takesTheScreen) this.showSession(session);
        // An attempt past the ceiling does not get to call itself loading. By
        // then the operator is reading a notice that says the feed stopped and
        // is still being retried, with the retry beside it, and `loading` takes
        // both off the chart for as long as the attempt runs — a blink every
        // thirty seconds where the route refuses immediately, and half a minute
        // with nothing to read where it hangs instead. Nothing has improved
        // between two attempts on the last rung, so nothing new is claimed.
        const pastTheCeiling = reconnectAttempt
            >= FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_ATTEMPTS;
        this.emitStatus(
            session,
            pastTheCeiling
                ? FUTURES_WORKSTATION_STATES.UNAVAILABLE
                : FUTURES_WORKSTATION_STATES.LOADING,
            false,
            pastTheCeiling ? 'RECONNECT_EXHAUSTED' : null,
        );

        let bootstrapAbort = null;
        let releaseBootstrapAbort = null;
        try {
            const exchangeInfo = await this.transport.loadExchangeInfo({
                signal: session.abortController.signal,
            });
            if (!this.isHeld(session)) return;
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
                if (!this.isHeld(session) || session.reconnectTimer !== null) return;
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
            if (!this.isHeld(session) || session.reconnectTimer !== null) return;
            if (streamReady !== true) {
                this.scheduleResync(session, 'SOCKET_NOT_READY');
                return;
            }
            // The depth snapshot must be taken only after the depth socket is
            // open so buffered diffs can bridge it.
            const depthValue = await this.transport.readDepthSnapshot({
                symbol: session.symbol,
                signal: bootstrapAbort.signal,
                limit: this.depthPageLimit(session),
            });
            if (!this.isHeld(session) || session.reconnectTimer !== null) return;
            session.bootstrapDepthSnapshot = normalizeFuturesWorkstationDepthSnapshot(
                depthValue,
                session.symbol,
            );
            const bootstrap = await independentReads;
            if (!this.isHeld(session) || session.reconnectTimer !== null) return;
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
                if (!this.isHeld(session) || session.reconnectTimer !== null) return;
                const retryValue = await this.transport.readDepthSnapshot({
                    symbol: session.symbol,
                    signal: bootstrapAbort.signal,
                    retryAttempt: depthRetryAttempt,
                    limit: this.depthPageLimit(session),
                });
                if (!this.isHeld(session) || session.reconnectTimer !== null) return;
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
            if (!this.isHeld(session)) return;
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
            if (!this.isHeld(session)) return;
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

    // The header carries the last traded price, and a print moves it. Sent on
    // the leading edge of a window rather than debounced behind a timer: prints
    // arrive continuously, so the next one carries whatever this one is holding
    // back, and the ticker states the same number twice a second regardless.
    // That leaves nothing for a timer to flush, and no timer to leak.
    //
    // Sent at whatever state the header is already in, because a print proves
    // this contract's stream is alive, not that the mark and the funding beside
    // it are current.
    noteHeaderPrint(session, now) {
        const window = FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.LAST_PRICE_MS;
        if (session.lastHeaderEmittedAt !== null
            && now - session.lastHeaderEmittedAt < window) return;
        this.emitHeader(session, now);
    }

    emitHeader(session, now) {
        session.lastHeaderEmittedAt = now;
        this.emitResource(
            session,
            FUTURES_WORKSTATION_RESOURCES.HEADER,
            session.staleResources.has(FUTURES_WORKSTATION_RESOURCES.HEADER)
                ? FUTURES_WORKSTATION_STATES.STALE
                : FUTURES_WORKSTATION_STATES.LIVE,
            session.header,
        );
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
        // Filtering the buffer by notional and fingerprinting the result is
        // done per print, over up to five hundred rows. A session nobody is
        // looking at keeps the prints — the buffer is what makes it whole — and
        // does not build a tape out of them; the tape is built once, from the
        // same buffer, when the contract is selected.
        if (!this.isShown(session)) return;
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
            if (!this.isHeld(session)
                || session.generation !== generation
                || !session.pendingTapeEmission) return;
            session.pendingTapeEmission = false;
            this.emitTrades(session, FUTURES_WORKSTATION_STATES.LIVE, { recordWindow: true });
        }, session.tapeSettings.timeoutMs - elapsed);
        session.pendingTapeTimer?.unref?.();
    }

    handleStreamFrame(session, raw) {
        if (!this.isHeld(session)) return;
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
                    // it was short. Asked whether or not anyone is watching,
                    // because it is what decides the page the book is kept on,
                    // and a held book is kept deep enough for its own reading.
                    const shortfall = session.orderBook.rangeShortfall(session.depthRange);
                    // Crossing the book into rows is the one expensive thing a
                    // diff causes, ten times a second on up to a thousand levels
                    // a side. A session nobody is looking at does not do it —
                    // the rows would be built and dropped at the emitter, and
                    // the book they would be built from is delivered whole the
                    // moment the contract is selected.
                    if (this.isShown(session)) {
                        session.lastDepthView = session.orderBook.toRendererView(
                            session.depthRange,
                        );
                        this.emitResource(
                            session,
                            FUTURES_WORKSTATION_RESOURCES.DEPTH,
                            this.depthDeliveryState(session, shortfall),
                            session.lastDepthView,
                        );
                    }
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
            if (!this.isHeld(session)) return;
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
        if (!this.isHeld(session) || session.reconnectTimer !== null) return;
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
                if (!this.isHeld(session) || session.reconnectTimer !== null) return;
                session.orderBook.beginBootstrap();
                await this.delay(
                    FUTURES_PRODUCTION_WORKSTATION_BOOK_RECOVERY.BRIDGE_MS * (2 ** (attempt - 1)),
                );
                if (!this.isHeld(session) || session.reconnectTimer !== null) return;
                try {
                    const value = await this.transport.readDepthSnapshot({
                        symbol: session.symbol,
                        signal: session.abortController.signal,
                        retryAttempt: attempt,
                        limit: this.depthPageLimit(session),
                    });
                    if (!this.isHeld(session) || session.reconnectTimer !== null) return;
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
        if (!this.isHeld(session)) return;
        const now = this.observedNow(session);
        if (event.kind === 'trade') {
            // Freshness is proven by the stream, not by eligibility: an ineligible
            // print still means the tape is live.
            session.lastTradesAt = now;
            session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.TRADES);
            // The last traded price, before the tape decides whether the print
            // is one it displays. A desk set to "≥ 400 USDT" watched a frozen
            // number while the market ran; the filter is about the tape.
            //
            // Only once the bootstrap has built a header for the print to move.
            // There is nothing to update before that, and raising over it would
            // resynchronize the whole workspace on an ordinary trade — the one
            // frame type that arrives before the mark and the ticker do.
            if (session.header !== null) {
                session.header = updateFuturesWorkstationHeader(session.header, event);
                this.noteHeaderPrint(session, now);
            }
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
            // The series is kept whole either way; what is skipped for a
            // contract nobody is watching is cutting the tail of it into rows
            // for a renderer that would drop them.
            if (this.isShown(session)) {
                this.emitCandleSeries(session, 'contract', session.candles);
            }
        } else if (event.kind === 'mark' || event.kind === 'ticker') {
            session.header = updateFuturesWorkstationHeader(session.header, event);
            session.lastHeaderAt = now;
            session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.HEADER);
            this.emitHeader(session, now);
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
            if (!this.isHeld(session)) return;
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
        if (!this.isHeld(session)) return;
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
        if (!this.isHeld(session)) return;
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
        if (!this.isHeld(session)) return;
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
        if (!this.isHeld(session)
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
            if (this.isHeld(session)
                && session.reconnectTimer === null
                && session.requestId === request.requestId
                && session.interval === request.interval) {
                void this.selectInterval(request, emit, attempt);
            }
        }, delay);
        session.intervalReconnectTimer?.unref?.();
    }

    scheduleResync(session, reasonCode) {
        if (!this.isHeld(session) || session.reconnectTimer !== null) return;
        // Running out of fast attempts ends the hurry, not the recovery. The
        // ladder spends 91.5 s — shorter than a proxy restart, a VPN
        // renegotiation or a laptop waking up. Halting here left the desk
        // holding a live position, a live wallet and a live uPnL against a
        // chart, a book and a tape that had stopped, recoverable only by
        // reloading the window; the account leg, which reconnects with no
        // ceiling at all, came back on its own and made the desk look healthy
        // while it was blind. Past the ladder the session keeps asking on the
        // ladder's last rung, and says so under a state of its own.
        const exhausted = session.reconnectAttempt
            >= FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_ATTEMPTS;
        this.emitStatus(
            session,
            exhausted
                ? FUTURES_WORKSTATION_STATES.UNAVAILABLE
                : FUTURES_WORKSTATION_STATES.RESYNCHRONIZING,
            false,
            exhausted ? 'RECONNECT_EXHAUSTED' : reasonCode,
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
        // Held at the ceiling rather than counted upwards: the number is only
        // ever compared against it, and a session that spends an afternoon
        // without a route must not grow one.
        const attempt = Math.min(
            session.reconnectAttempt + 1,
            FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.RECONNECT_ATTEMPTS,
        );
        session.reconnectTimer = this.clock.setTimeout(() => {
            session.reconnectTimer = null;
            if (this.isHeld(session)) void this.startGeneration(request, emit, attempt);
        }, delay);
        session.reconnectTimer?.unref?.();
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

    // A session leaves the pool before anything is torn down, so every callback
    // still in flight for it fails `isHeld` from the first step of the release
    // rather than from whichever step happens to abort it.
    releaseSession(session) {
        if (!session) return;
        if (this.sessions.get(session.symbol) === session) this.sessions.delete(session.symbol);
        if (this.shown === session) this.shown = null;
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
        for (const session of [...this.sessions.values()]) this.releaseSession(session);
        this.transport.close();
    }
}
