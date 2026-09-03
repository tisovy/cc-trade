import {
    FUTURES_PRODUCTION_WORKSTATION_ACTIONS,
    createFuturesProductionWorkstationEvent,
    createFuturesProductionWorkstationHistoryOutcome,
    readFuturesProductionWorkstationRequest,
} from '../../src/utils/futuresProductionWorkstationProtocol.js';
import {
    FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS,
    FUTURES_WORKSTATION_EVENT_MAX_BYTES,
    FUTURES_WORKSTATION_RESOURCES,
    FUTURES_WORKSTATION_STATES,
} from '../../src/utils/futuresWorkstationProtocolShared.js';
import {
    FUTURES_CANDLE_STORE_INTERVAL_MS,
    futuresCandleStoreWindow,
    isFuturesCandleStoreBucketAligned,
} from './futures-workstation-candle-store.js';
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
    FuturesWorkstationOrderBookError,
} from './futures-workstation-order-book.js';
import {
    parseFuturesWorkstationDecimal,
} from './futures-workstation-decimal.js';
import { futuresBookDepthRange } from '../../src/utils/futuresOrderBook.js';

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
    DEPTH_DELIVERY_MS: 200,
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
    // The cooldown doubles from the floor to this while rounds keep failing. A
    // book that cannot be bridged is one the exchange cannot serve a usable
    // snapshot for, and a flat five seconds had the desk asking hardest —
    // three reads a round, seven to eight rounds a minute — through a window
    // in which the exchange was refusing work (2026-08-22).
    COOLDOWN_CEILING_MS: 60_000,
});

// A ceiling the market trips, it trips repeatedly: the frames that reach it come
// from one burst. The refusal is stated once per window, so the reason line
// carries the fact rather than a count of it.
export const FUTURES_PRODUCTION_WORKSTATION_FRAME_REFUSAL = Object.freeze({
    REPORT_COOLDOWN_MS: 5_000,
});

// Which stream a frame came from, read without parsing it — the frame that
// lands here is one the parser has already refused. The name is read in the
// exchange's own spelling: a listing's stream carries its ticker as the
// exchange lists it (龙虾usdt@depth@100ms), raw or as JSON unicode escapes, so
// the class admits anything up to the quote that ends the name. Read narrower
// than the exchange, this turned a unicode listing's every book fault into a
// full session resynchronization (2026-08-28).
const DEPTH_STREAM_NAME = /"stream"\s*:\s*"(?:[^"\\]|\\u[0-9a-fA-F]{4}){1,96}@depth/;
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

// Three things ask for a rebuild through the same `resync` flag, and they are
// three different faults: the live chain broke, a diff landed on a book that is
// already down, or the buffer overflowed before a snapshot bridged. Written
// under one code, a book that stayed down through a thirteen-minute exchange
// degradation read as a hundred fresh stream breaks (2026-08-22).
const DEPTH_RESYNC_CODES = Object.freeze({
    gap: 'DEPTH_SEQUENCE_GAP',
    'resync-required': 'DEPTH_BOOK_DOWN',
    overflow: 'DEPTH_BUFFER_OVERFLOW',
});
const depthResyncCode = reason => (
    DEPTH_RESYNC_CODES[reason] ?? 'DEPTH_SEQUENCE_GAP'
);

// What a crossed book left for the record: the identities of the diff that
// crossed it and how many levels stand across the market. Identities and
// counts only — the record refuses a price — and nothing for an error that
// carries none.
const bookEvidenceOf = (error) => {
    const evidence = error?.evidence;
    if (evidence === null || typeof evidence !== 'object') return {};
    const identity = value => (typeof value === 'string' && /^\d{1,64}$/.test(value) ? value : null);
    return {
        lastUpdateId: identity(evidence.lastUpdateId),
        firstUpdateId: identity(evidence.firstUpdateId),
        finalUpdateId: identity(evidence.finalUpdateId),
        previousFinalUpdateId: identity(evidence.previousFinalUpdateId),
        crossedLevels: Number.isSafeInteger(evidence.crossedLevels) && evidence.crossedLevels >= 0
            ? evidence.crossedLevels
            : null,
    };
};

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
 * Take the panel's reading of the book onto the session.
 *
 * Three facts, one of them derived. The step and the row count are stated: the
 * book is grouped by the first and the delivery is bounded by the second. How
 * far past the best price those rows reach is *computed* from them, here, rather
 * than stated alongside — the panel used to send the distance and keep the step
 * to itself, which was enough while the backend only bought pages against it and
 * is not enough now that it groups the book too. Two statements of one reading
 * can disagree; a statement and a derivation cannot.
 *
 * The ungrouped reading states no distance at all. A row is one raw level there,
 * and the price the rows span is wherever the market happens to rest, so a
 * distance in ticks would name something the rows have no relation to — and a
 * page bought against it would be bought for nothing. The cheapest page holds
 * fifty levels a side against a panel's dozen or so rows.
 *
 * A request that states no reading leaves the one the session has. That is what
 * opening a contract does before any book has been drawn.
 */
const applyReading = (session, request) => {
    if (!Number.isSafeInteger(request.rows) || request.rows <= 0) return;
    const step = typeof request.step === 'string' ? request.step : null;
    session.depthStep = step;
    session.depthRows = request.rows;
    session.depthRange = step === null
        ? null
        : futuresBookDepthRange({ step, rows: request.rows });
};

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
 * across the pool. That is only tolerable because a reconnect is the shown
 * session's alone: a background session that loses its socket parks, and is
 * rebuilt when it is selected or when the desk finds a free minute
 * (`FUTURES_PRODUCTION_WORKSTATION_WARMER`, 2026-09-03).
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

/**
 * How the rest of the pool loads once the shown contract is live.
 *
 * A background session never reconnects on its own — the operator's ruling of
 * 2026-09-03. A storm that closed eight sockets used to be eight ladders and
 * eight bootstraps against the one budget the shown contract needed to come
 * back on. A background session parks instead, and a warmer wakes one parked
 * session per tick, most recently shown first, only while the shown session is
 * bootstrapped and live, the public read budget has `ROOM_WEIGHT` to spare —
 * one bootstrap at 24 plus a recovery round for the shown contract at 60, with
 * margin — and `FLOOR_MS` has passed since the last wake.
 *
 * A wake that fails parks the session again, and the warmer holds it for
 * `FLOOR_MS` doubled per failed wake, up to `HOLD_CEILING_MS`, behind every
 * parked session it has not tried yet. Without the hold a contract whose route
 * alone is down — or whose book will not bridge, the SKRUSDT loop — is woken
 * every floor for the rest of the day and the others never get their minute
 * (audit of 2026-09-03).
 */
export const FUTURES_PRODUCTION_WORKSTATION_WARMER = Object.freeze({
    CHECK_MS: 5_000,
    ROOM_WEIGHT: 120,
    FLOOR_MS: 15_000,
    HOLD_CEILING_MS: 600_000,
});

// How long a parked session is held before the warmer tries it again: nothing
// after a park the warmer had no hand in, then the floor doubled per failed
// wake, to the ceiling.
const wakeHoldMs = lazyWakes => (lazyWakes === 0
    ? 0
    : Math.min(
        FUTURES_PRODUCTION_WORKSTATION_WARMER.FLOOR_MS * (2 ** lazyWakes),
        FUTURES_PRODUCTION_WORKSTATION_WARMER.HOLD_CEILING_MS,
    ));

export class FuturesProductionWorkstationService {
    constructor({
        transport,
        // The machine's own closed minutes, asked before the exchange is
        // (`read-candles-from-the-nearest-source`). Null is a desk without one.
        candleStore = null,
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
            || typeof transport.readBudgetRoom !== 'function'
            || typeof clock.now !== 'function'
            || typeof clock.setInterval !== 'function'
            || typeof clock.clearInterval !== 'function'
            || typeof clock.setTimeout !== 'function'
            || typeof clock.clearTimeout !== 'function'
            || typeof onInternalError !== 'function'
            || typeof onTiming !== 'function'
            || (candleStore !== null
                && (typeof candleStore !== 'object'
                    || typeof candleStore.readCandles !== 'function'
                    || typeof candleStore.enabled !== 'boolean'))) {
            throw new FuturesProductionWorkstationServiceError('INVALID_SERVICE_COMPOSITION');
        }
        this.transport = transport;
        this.candleStore = candleStore;
        // A store that is off, or whose address was refused, is stated once
        // with its code — so a day's record without store lines can say why.
        if (candleStore !== null && !candleStore.enabled) {
            onInternalError({
                phase: 'candle-store',
                code: candleStore.errorCode ?? 'CANDLE_STORE_OFF',
            });
        }
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
        // The warmer's timer, armed while anything is parked, and when it last
        // woke a session — the floor is measured from here.
        this.warmTimer = null;
        this.lastWakeAt = null;
        this.stopped = false;
        this.tapeSettings = FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS;
    }

    // The one page a book is ever read at: the deepest a single read returns.
    // It is read once per bootstrap and once per rebuild the stream forced, and
    // for nothing else (2026-09-03) — the stream carries the book from there.
    depthPageLimit() {
        return FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES.at(-1).limit;
    }

    // Every book that crosses to the renderer is built here. Six paths deliver one
    // — configure, bootstrap, recovery, diff, selection, hand-over — and a reach
    // stated by five of them is a panel whose ladder changes with which path last
    // ran.
    depthView(session) {
        return session.orderBook.toRendererRows({
            step: session.depthStep,
            rows: session.depthRows,
        });
    }

    clearPendingDepthDelivery(session) {
        if (session?.pendingDepthTimer !== null
            && session?.pendingDepthTimer !== undefined) {
            this.clock.clearTimeout(session.pendingDepthTimer);
            session.pendingDepthTimer = null;
        }
        if (session) session.pendingDepthDelivery = null;
    }

    emitDepthNow(session, {
        state = undefined,
        payload = undefined,
    } = {}) {
        if (!this.isHeld(session) || !this.isShown(session)) return false;
        const view = payload === undefined ? this.depthView(session) : payload;
        if (view === null || view === undefined) return false;
        const deliveryState = state ?? this.depthDeliveryState(session);
        const emitted = this.emitResource(
            session,
            FUTURES_WORKSTATION_RESOURCES.DEPTH,
            deliveryState,
            view,
        );
        if (emitted) {
            session.lastDepthView = view;
            session.lastDepthDeliveryAt = session.lastClock;
            // The state the renderer last heard, kept so the next delivery can
            // tell a change of state from a state that merely persists. Recorded
            // only on an emission that happened: a delivery that found nothing
            // to send has told the operator nothing, and the change it carried
            // is still owed.
            session.lastDepthDeliveredState = deliveryState;
        }
        return emitted;
    }

    deliverDepth(session, {
        immediate = false,
        state = undefined,
        payload = undefined,
    } = {}) {
        if (!this.isHeld(session) || !this.isShown(session)) return false;
        const deliveryState = state ?? this.depthDeliveryState(session);
        // Immediacy belongs to the change of state, not to the state's value.
        // The book becoming stale — or live again — is operational news the
        // bound must not sit on. But a book that merely stays stale is not
        // news, and it is not rare either: a gap being recovered on its
        // cooldown reports stale for as long as the round takes, and keying
        // this bypass on the value let a stale book skip the bound on every
        // diff. So a state that matches the one last delivered rides the
        // routine bound, stale included, and a state that differs goes out on
        // its own instant.
        if (immediate || deliveryState !== session.lastDepthDeliveredState) {
            this.clearPendingDepthDelivery(session);
            return this.emitDepthNow(session, {
                state: deliveryState,
                payload,
            });
        }

        const now = this.observedNow(session);
        const elapsed = session.lastDepthDeliveryAt === null
            ? FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.DEPTH_DELIVERY_MS
            : Math.max(0, now - session.lastDepthDeliveryAt);
        if (elapsed >= FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.DEPTH_DELIVERY_MS) {
            this.clearPendingDepthDelivery(session);
            return this.emitDepthNow(session, {
                state: deliveryState,
                payload,
            });
        }

        session.pendingDepthDelivery = Object.freeze({
            requestId: session.requestId,
            generation: session.generation,
            state: deliveryState,
        });
        if (session.pendingDepthTimer !== null) return false;
        session.pendingDepthTimer = this.clock.setTimeout(() => {
            session.pendingDepthTimer = null;
            const pending = session.pendingDepthDelivery;
            session.pendingDepthDelivery = null;
            if (!pending
                || !this.isHeld(session)
                || !this.isShown(session)
                || session.requestId !== pending.requestId
                || session.generation !== pending.generation) return;
            this.deliverDepth(session, {
                state: pending.state,
            });
        }, FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.DEPTH_DELIVERY_MS - elapsed);
        session.pendingDepthTimer?.unref?.();
        return false;
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
            try {
                await this.loadCandleHistory(request);
            } catch (error) {
                if (error?.code !== 'CANDLE_HISTORY_OWNER_UNAVAILABLE') throw error;
                const outcome = createFuturesProductionWorkstationHistoryOutcome(request);
                emit(outcome, JSON.stringify(outcome));
            }
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
            const held = this.sessions.get(request.symbol);
            // A parked contract is rebuilt, not selected: there is nothing
            // current in it to deliver. The operator asked for it, so it takes
            // the screen, and states under `loading` the reason it stopped.
            if (held.parked !== null) {
                await this.startGeneration(request, emit, 0, {
                    takesTheScreen: true,
                    reasonCode: held.parked.code,
                });
                return;
            }
            await this.selectHeldContract(held, request, emit);
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
        // The nearest source first. The store answers the page whole or not
        // at all, and a page it served costs the exchange nothing; anything
        // less falls through to the exchange's own read below.
        const storeRows = await this.readStorePage(session, request);
        if (storeRows !== null) {
            if (!this.isHeld(session)
                || session.requestId !== request.requestId
                || session.symbol !== request.symbol
                || session.interval !== interval) return;
            this.emitCandleHistory(session, { endTime, interval, rows: storeRows });
            return;
        }
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
            this.onInternalError({ phase: 'candle-history', code: safeCode(error), symbol: session.symbol });
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

    // The rows on screen reach this far past the best price. The reading bounds
    // what is delivered and nothing else: the book in hand is the whole book
    // the stream has stated, and a step that reaches past the page the
    // snapshot proved draws the levels the stream has restated out there,
    // marked as such.
    configureDepth(request) {
        const session = this.shown;
        if (!session || !this.isHeld(session) || session.requestId !== request.requestId) {
            throw new FuturesProductionWorkstationServiceError('DEPTH_OWNER_UNAVAILABLE');
        }
        applyReading(session, request);
        if (!session.bootstrapped) return;
        // A new reading is a new delivery, from the book already in hand.
        // Waiting for the next diff would answer a coarsened step within a
        // diff or two on a busy contract and never on a quiet one, which is
        // the contract most likely to be read at a coarse step.
        this.deliverDepth(session, { immediate: true });
    }

    /**
     * The state a book is delivered in.
     *
     * A book the stream is carrying is live. It is stale while a gap is being
     * recovered on its cooldown, or while a bootstrap has not bridged — the
     * rows it can prove are still delivered, and they are delivered as what
     * they are. Nothing about the rows on screen makes a book stale any more:
     * a step that reaches past the snapshot's page draws what the stream has
     * restated out there, marked per row as beyond the page.
     */
    depthDeliveryState(session) {
        return session.staleResources.has(FUTURES_WORKSTATION_RESOURCES.DEPTH)
            ? FUTURES_WORKSTATION_STATES.STALE
            : FUTURES_WORKSTATION_STATES.LIVE;
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
        // The new interval's window from the local store, drawn beneath the
        // veil while the socket and the exchange's window take their second.
        void this.emitStoreWindow(session, {
            intervalEpoch,
            signal: intervalAbortController.signal,
        });
        // The session stays live: an interval change touches the candles and
        // nothing else. It used to publish LOADING for the whole session here
        // — forty-five times in one evening on 2026-09-02, each one two
        // seconds of a blank chart, a loading book and an unbound gesture.
        // The renderer knows the interval it asked for and draws the last
        // series it had until the new one lands.

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
            // A switch that recovered from a candle-socket failure clears the
            // reason the failure left on the status line — that line holds
            // its last code until another status replaces it. An ordinary
            // switch states nothing: the session never left live.
            if (reconnectAttempt > 0) {
                this.emitStatus(session, FUTURES_WORKSTATION_STATES.LIVE, true, null);
            }
            session.intervalReconnectAttempt = 0;
        } catch (error) {
            if (!isCurrentInterval()) return;
            session.intervalBootstrapping = false;
            session.pendingCandleEvents = [];
            const reasonCode = safeCode(error);
            this.onInternalError({ phase: 'interval-bootstrap', code: reasonCode, symbol: session.symbol });
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
        const outgoing = this.shown;
        // A tape payload the outgoing contract was holding back is dropped
        // rather than left armed. It has nothing to deliver any more — the
        // emitter would refuse it — and a timer that fires to do nothing is
        // still a timer per held contract, arming and firing forever.
        if (outgoing !== null && outgoing !== session) {
            this.clearPendingTapeTimer(outgoing);
            this.clearPendingDepthDelivery(outgoing);
        }
        this.selection += 1;
        session.shownOrder = this.selection;
        this.shown = session;
        // The ladder, the candle ladder and the recovery round are the shown
        // session's. A contract that leaves the screen with one running would
        // otherwise finish it in the background — the rung's bootstrap and its
        // reads, or the rest of a round's pages, for a contract nobody is
        // looking at (audit of 2026-09-03). It parks instead, under the reason
        // it was already stating, and a selection or the warmer rebuilds it.
        if (outgoing === null || outgoing === session || !this.isHeld(outgoing)) return;
        if (outgoing.reconnectTimer === null
            && outgoing.intervalReconnectTimer === null
            && !outgoing.bookRecovering) return;
        const reason = outgoing.bookRecovering
            ? outgoing.bookRecoveryReason
            : outgoing.status?.reasonCode;
        this.parkSession(outgoing, reason ?? 'LEFT_THE_SCREEN');
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
        const frameBytes = Buffer.byteLength(frame, 'utf8');
        if (frameBytes > FUTURES_WORKSTATION_EVENT_MAX_BYTES) {
            throw new FuturesProductionWorkstationServiceError('OUTBOUND_FRAME_TOO_LARGE');
        }
        // Handed over beside the frame rather than inside it. The event has been
        // built and validated by here, and the protocol validates an exact key
        // set — so anything added to it now is a frame the far side refuses. The
        // sender puts these on the transport envelope and the far side takes them
        // off again before validating; see `frameMarks.js`.
        //
        // `frameBytes` travels with them because the sender needs it to decide
        // whether the stamp fits under the ceiling, and it has just been measured
        // here. Measuring a hundred-and-eighteen-kilobyte book twice is the exact
        // cost §2 of `carry-execution-ahead-of-market-data` was written to remove.
        session.emit(event, frame, {
            marks: session.upstreamMarks,
            frameBytes,
        });
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
        applyReading(session, request);
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
            this.deliverDepth(session, { immediate: true });
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
                // A wake the warmer started is the same bootstrap under its own
                // name, so a day's record can be asked how many contracts loaded
                // in a free minute and how long each took.
                phase: session.lazy ? 'lazy-bootstrap' : 'aggregate-ready',
                durationMs,
                outcome,
                cache: null,
                // The contract this aggregate came up for. Without it, a held
                // session's endless rebuild cycle reads as the desk's own —
                // which is exactly how 2026-08-28 read.
                symbol: session.symbol,
            }));
        } catch {
            // Diagnostics are observational and cannot affect market-data delivery.
        }
    }

    async startGeneration(request, emit, reconnectAttempt, {
        // The warmer's wake of a parked session: a bootstrap under its own
        // timing phase, keeping the reading the session carried.
        lazy = false,
        // Stated by the caller when the entitlement below does not decide it:
        // a parked contract the operator selected is not on the screen yet and
        // takes it.
        takesTheScreen: entitled = null,
        // What the opening `loading` says, when there is a reason to state — a
        // parked contract names why it stopped while it rebuilds.
        reasonCode = null,
    } = {}) {
        // A generation replaces whatever this contract was running — a first
        // open, a resubscribe, a reconnect and a wake all arrive here — and
        // takes a place in the pool, which the contracts held for longest
        // without being shown make room for.
        const previous = this.sessions.get(request.symbol) ?? null;
        // Whether this generation is entitled to the screen, decided before the
        // session it replaces is released. A contract the desk is opening for
        // the first time is: the operator asked for it. A contract rebuilding
        // itself is entitled to exactly what it already had — the shown session
        // reconnects on its own ladder, and a parked one woken in a free minute
        // must not pull the display onto a contract nobody is looking at while
        // silencing the one they are.
        const takesTheScreen = entitled ?? (previous === null || this.shown === previous);
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
        const openingFresh = reconnectAttempt === 0 && !lazy;
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
            lastDepthDeliveryAt: null,
            // Null until the first delivery, so a session's opening book is a
            // transition by definition and goes out immediately.
            lastDepthDeliveredState: null,
            pendingDepthDelivery: null,
            pendingDepthTimer: null,
            bookRecovering: false,
            bookRecoveredAt: null,
            // Consecutive recovery rounds that ran to the end and failed. Sets
            // the cooldown before the next round; a round that bridges resets
            // it, an abandoned one leaves it.
            bookRecoveryFailures: 0,
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
            depthStep: openingFresh ? null : (previous?.depthStep ?? null),
            depthRows: openingFresh ? null : (previous?.depthRows ?? null),
            depthRange: openingFresh ? null : (previous?.depthRange ?? null),
            // A rebuild inherits its place in the pool's order. Left at zero, a
            // background contract woken in a free minute would look like the
            // one the operator had gone longest without and be the first
            // evicted.
            shownOrder: previous?.shownOrder ?? 0,
            // Set when a background session stops on its own account and waits
            // to be rebuilt: when, and why. Null while the session runs.
            parked: null,
            lazy,
            // How many wakes in a row have failed to bring this contract up with
            // a bridged book, cleared when one does. The warmer's order and hold.
            lazyWakes: lazy ? (previous?.lazyWakes ?? 0) + 1 : 0,
            // The reason the recovery round in flight was started for, while one
            // is: what a park names when the contract leaves the screen mid-round.
            bookRecoveryReason: null,
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
            // Where the newest upstream frame came from and when this process
            // took it off the socket. Held on the session rather than threaded
            // through the six paths that build a delivery, because what a
            // delivered frame is *about* is the newest frame that fed it — a
            // book emitted after three diffs is the market as of the third.
            //
            // Null until the first stream frame arrives, which is the honest
            // answer for everything the desk delivers out of a REST read: a
            // bootstrap book has no upstream socket leg to report.
            upstreamMarks: null,
            startedAt: this.clock.now(),
        };
        // A contract opened with a reading already stated takes it here: the
        // panel knows how it draws this book before the first frame of it
        // arrives, and the page that covers those rows is then bought against
        // the first band the snapshot proves rather than after a second message.
        // A rebuild states none and keeps the one it carried over.
        applyReading(session, request);
        this.sessions.set(session.symbol, session);
        if (takesTheScreen) this.showSession(session);
        // The contract's window from the local store, on the chart before the
        // exchange has been asked. Read only for the session on screen: a
        // parked contract waking in a free minute reads nothing anywhere.
        void this.emitStoreWindow(session, {
            intervalEpoch: session.intervalEpoch,
            signal: session.abortController.signal,
        });
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
            pastTheCeiling ? 'RECONNECT_EXHAUSTED' : reasonCode,
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
                onDisconnect: (reason, detail) => this.handleDisconnect(session, reason, detail),
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
                limit: this.depthPageLimit(),
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
                    limit: this.depthPageLimit(),
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
            if (bookResult.live) this.deliverDepth(session, { immediate: true });
            session.reconnectAttempt = 0;
            if (bookResult.live) session.lazyWakes = 0;
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
            this.onInternalError({ phase: 'bootstrap', code: safeCode(error), symbol: session.symbol });
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

    // The store's window of the session's interval, under `loading`, while the
    // exchange's window and socket are on their way — D4 of
    // `read-candles-from-the-nearest-source`. The rows are the renderer's
    // picture and nothing else: `session.candles` stays what it was, so the
    // kline events queued through the bootstrap are folded onto the exchange's
    // rows as before. An answer that lands after the exchange's window is
    // dropped; a session that has left the screen, changed interval or epoch
    // is not written to. Nothing here can throw into the caller.
    async emitStoreWindow(session, { intervalEpoch, signal }) {
        try {
            const store = this.candleStore;
            if (store === null || !store.enabled || !this.isShown(session)) return;
            const { interval, symbol } = session;
            const span = futuresCandleStoreWindow({
                interval,
                now: this.clock.now(),
                rows: FUTURES_WORKSTATION_MARKET_LIMITS.RENDERER_CANDLES,
            });
            if (span === null) return;
            const rows = await store.readCandles({
                symbol,
                interval,
                ...span,
                mode: 'window',
                signal,
            });
            if (!Array.isArray(rows) || rows.length === 0) return;
            if (!this.isHeld(session)
                || !this.isShown(session)
                || session.interval !== interval
                || session.intervalEpoch !== intervalEpoch
                || session.candles.length > 0) return;
            this.emitCandleSeries(session, 'contract', rows, FUTURES_WORKSTATION_STATES.LOADING);
        } catch {
            // The store is a convenience over the exchange's own read; a
            // failure of it is the exchange's read, as before.
        }
    }

    // A history page from the store: exactly the rows the exchange would send
    // for the same span, or null. A short store answer never reaches the
    // renderer, which reads a short page as the contract's first candle. The
    // renderer ends a page at the open of the oldest bar it draws; an end
    // anywhere else would make the store build a bucket from part of itself,
    // and is the exchange's to answer.
    async readStorePage(session, { interval, endTime, limit }) {
        const store = this.candleStore;
        const intervalMs = FUTURES_CANDLE_STORE_INTERVAL_MS[interval];
        if (store === null
            || !store.enabled
            || intervalMs === undefined
            || !isFuturesCandleStoreBucketAligned(endTime, interval)
            || !Number.isSafeInteger(limit)
            || limit <= 0) return null;
        const from = endTime - (limit * intervalMs);
        if (from <= 0) return null;
        try {
            const rows = await store.readCandles({
                symbol: session.symbol,
                interval,
                from,
                to: endTime,
                limit,
                mode: 'page',
                signal: session.abortController.signal,
            });
            return Array.isArray(rows) && rows.length === limit ? rows : null;
        } catch {
            return null;
        }
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
            // Taken before the frame is read, so what it measures is the
            // socket's arrival and not this desk's parsing of it. The parse is
            // the first thing the frame waits for, and a mark taken after it
            // would hide exactly the wait the operator is asking about.
            //
            // Inside the try, and read straight off the clock rather than
            // through `observedNow`: that one throws on a clock that has gone
            // backwards, and a diagnostic must not be able to take a market
            // frame down with it. A reading that is not a sane timestamp is
            // dropped below instead.
            const receivedAt = this.clock.now();
            const event = normalizeFuturesWorkstationStreamFrame(raw, {
                symbol: session.symbol,
                pair: session.pair,
                interval: session.interval,
            });
            // `exchangeAt` is the frame's own `E` — when Binance sent it — which
            // is the only mark an upstream delay can be measured from. It is not
            // `event.eventTime`: that is what each resource means by "when", and
            // for a trade it is the trade's time and for a kline its close.
            // A frame stating none leaves the leg unknown rather than claiming
            // it took no time.
            session.upstreamMarks = Object.freeze({
                exchangeAt: event.exchangeAt,
                receivedAt: Number.isSafeInteger(receivedAt) && receivedAt >= 0
                    ? receivedAt
                    : null,
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
                if (result.resync) void this.recoverBook(session, depthResyncCode(result.reason));
                else if (result.applied && session.bootstrapped) {
                    session.lastDepthAt = this.observedNow(session);
                    const recovered = session.staleResources.delete(
                        FUTURES_WORKSTATION_RESOURCES.DEPTH,
                    );
                    // Crossing the book into rows is the one thing a diff costs
                    // beyond applying it. A session nobody is looking at does
                    // not do it — the rows would be built and dropped at the
                    // emitter, and the book they would be built from is
                    // delivered whole the moment the contract is selected.
                    if (this.isShown(session)) {
                        this.deliverDepth(session, { immediate: recovered });
                    }
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
            this.onInternalError({
                phase: 'stream',
                code: safeCode(error),
                symbol: session.symbol,
                ...bookEvidenceOf(error),
            });
            // The book's own refusal is a book problem wherever the frame came
            // from — the throw already names the resource, and needs no reading
            // of the frame. A depth frame the desk could not read is also only
            // a book problem. Only a frame from the streams the desk actually
            // trades on — price, candles, tape — is worth the whole session.
            if (error instanceof FuturesWorkstationOrderBookError) {
                void this.recoverBook(session, safeCode(error));
                return;
            }
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
        // A book nobody is looking at is not read for. The session parks under
        // the book's reason and is rebuilt whole when it is wanted; see
        // `parkSession`.
        if (!this.isShown(session)) {
            this.parkSession(session, reasonCode);
            return;
        }
        if (session.bookRecovering) return;
        const now = this.observedNow(session);
        // Backed off between rounds, because every diff arriving on a book that
        // is not bridged asks for another one. A recovery that failed still
        // backs off — the stamp below is taken either way.
        //
        // The cooldown widens while rounds keep failing — doubling from the
        // floor to the ceiling — and one bridged snapshot returns it to the
        // floor. Asking at a flat rate for as long as an exchange-side
        // condition lasts spends the read budget against the exchange at
        // exactly the moment it is refusing work.
        const cooldownMs = Math.min(
            FUTURES_PRODUCTION_WORKSTATION_BOOK_RECOVERY.COOLDOWN_MS
                * (2 ** session.bookRecoveryFailures),
            FUTURES_PRODUCTION_WORKSTATION_BOOK_RECOVERY.COOLDOWN_CEILING_MS,
        );
        if (!immediate
            && session.bookRecoveredAt !== null
            && now - session.bookRecoveredAt < cooldownMs) return;
        session.bookRecovering = true;
        session.bookRecoveryReason = reasonCode;
        session.bookRecoveredAt = now;
        // 'abandoned' is the round leaving through a release or a resync:
        // those say nothing about whether the exchange can serve a snapshot,
        // so they neither widen the pause nor reset it.
        let outcome = 'abandoned';
        try {
            // Inside the guard: anything that raises out here would leave
            // `bookRecovering` set and the book unable to ask again for the rest
            // of the session.
            // The evidence a crossing left rides the stream line that raised
            // it, once; this line names the round. A crossing inside the
            // round's own replay carries its evidence on the catch below.
            this.onInternalError({ phase: 'book-recovery', code: reasonCode, symbol: session.symbol });
            this.markResourceStale(
                session,
                FUTURES_WORKSTATION_RESOURCES.DEPTH,
                session.lastDepthView,
            );
            // Every rebuild here is one the stream forced: diffs were missed,
            // and a level nobody has heard about since could have been taken,
            // so the book starts again from the page the snapshot names.
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
                        limit: this.depthPageLimit(),
                    });
                    if (!this.isHeld(session) || session.reconnectTimer !== null) return;
                    const snapshot = normalizeFuturesWorkstationDepthSnapshot(
                        value,
                        session.symbol,
                    );
                    const bridged = session.orderBook.bootstrap(snapshot);
                    if (!bridged.live) {
                        // Why the book stayed down, not only why the round
                        // started: the bridging reason names whether to look at
                        // the exchange's snapshot or the desk's own buffer.
                        this.onInternalError({
                            phase: 'book-recovery',
                            code: depthBootstrapCode(bridged.reason),
                            symbol: session.symbol,
                        });
                        continue;
                    }
                } catch (error) {
                    this.onInternalError({
                        phase: 'book-recovery',
                        code: safeCode(error),
                        symbol: session.symbol,
                        ...bookEvidenceOf(error),
                    });
                    continue;
                }
                outcome = 'recovered';
                session.lastDepthAt = this.observedNow(session);
                session.staleResources.delete(FUTURES_WORKSTATION_RESOURCES.DEPTH);
                this.deliverDepth(session, { immediate: true });
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
            outcome = 'failed';
        } finally {
            if (outcome === 'recovered') session.bookRecoveryFailures = 0;
            if (outcome === 'failed') session.bookRecoveryFailures += 1;
            session.bookRecovering = false;
            session.bookRecoveryReason = null;
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
        } else if (resource === FUTURES_WORKSTATION_RESOURCES.DEPTH) {
            this.deliverDepth(session, {
                immediate: true,
                state: FUTURES_WORKSTATION_STATES.STALE,
                payload,
            });
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
                        this.depthView(session),
                    );
                }
                if (now - session.lastTradesAt > FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.TRADES_MS) {
                    this.markResourceStale(session, FUTURES_WORKSTATION_RESOURCES.TRADES, null);
                }
            } catch (error) {
                this.onInternalError({ phase: 'freshness', code: safeCode(error), symbol: session.symbol });
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
    handleDisconnect(session, reason, detail = null) {
        if (!this.isHeld(session)) return;
        const reasonCode = typeof reason === 'string' && /^[A-Z0-9_]{1,96}$/.test(reason)
            ? reason
            : 'SOCKET_DISCONNECTED';
        // Who closed it, with what code, and how late the last frame before it
        // was. On 2026-09-02 three closes each followed four to eight seconds
        // of upstream lag and the record could not say so: a close that ends a
        // stalled route reads as what it was. Counts and words, never a price.
        const marks = session.upstreamMarks;
        const lastUpstreamMs = marks !== null
            && Number.isSafeInteger(marks.exchangeAt)
            && Number.isSafeInteger(marks.receivedAt)
            && marks.receivedAt >= marks.exchangeAt
            ? marks.receivedAt - marks.exchangeAt
            : null;
        this.onInternalError({
            phase: 'stream-close',
            code: reasonCode,
            symbol: session.symbol,
            closeCode: Number.isSafeInteger(detail?.closeCode) && detail.closeCode >= 0
                ? detail.closeCode
                : null,
            closedBy: ['exchange', 'desk', 'transport'].includes(detail?.closedBy)
                ? detail.closedBy
                : null,
            lastUpstreamMs,
        });
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
            this.onInternalError({ phase: 'stream-frame', code: reasonCode, symbol: session.symbol });
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
        if (!this.isShown(session)) {
            this.parkSession(session, reasonCode);
            return;
        }

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
        // The ladder is the shown session's. A background session that would
        // climb it parks instead — the operator's ruling of 2026-09-03: the
        // shown contract is always current, the rest load in a free minute.
        if (!this.isShown(session)) {
            this.parkSession(session, reasonCode);
            return;
        }
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
        this.clearPendingDepthDelivery(session);
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
    release(step, symbol = null) {
        try {
            step();
        } catch (error) {
            this.onInternalError({ phase: 'release', code: safeCode(error), symbol });
        }
    }

    // A session leaves the pool before anything is torn down, so every callback
    // still in flight for it fails `isHeld` from the first step of the release
    // rather than from whichever step happens to abort it.
    releaseSession(session) {
        if (!session) return;
        if (this.sessions.get(session.symbol) === session) this.sessions.delete(session.symbol);
        if (this.shown === session) this.shown = null;
        this.stopSession(session);
    }

    /**
     * A background session stops, keeps its place, and waits.
     *
     * Everything a resynchronization would tear down is torn down — sockets,
     * book, timers — and nothing is armed in its place: no ladder, no cooldown,
     * no read. The session stays in the pool under its own `shownOrder`, with
     * the reason it stopped on its status, and comes back one of two ways: the
     * operator selects it, or the warmer finds a free minute.
     *
     * The abort is what makes it stop. Every callback still in flight for the
     * session — a bootstrap between awaits, a frame off a socket that is
     * closing — fails `isHeld` from here on, exactly as a released session's
     * do; what distinguishes a parked session from a released one is that it
     * is still in the pool.
     */
    parkSession(session, reasonCode) {
        if (!this.isHeld(session) || this.isShown(session)) return;
        const now = this.clock.now();
        session.parked = Object.freeze({
            at: Number.isSafeInteger(now) && now >= 0 ? now : null,
            code: reasonCode,
        });
        // What whoever selects it next is told, until the rebuild says more.
        session.status = Object.freeze({
            state: FUTURES_WORKSTATION_STATES.RESYNCHRONIZING,
            connected: false,
            reasonCode,
        });
        this.stopSession(session);
        this.onInternalError({ phase: 'park', code: reasonCode, symbol: session.symbol });
        this.ensureWarmer();
    }

    // Armed when a session parks and disarmed by its own tick once nothing is
    // parked, so a desk with every contract live runs no timer for it.
    ensureWarmer() {
        if (this.stopped || this.warmTimer !== null) return;
        this.warmTimer = this.clock.setInterval(
            () => this.warmOne(),
            FUTURES_PRODUCTION_WORKSTATION_WARMER.CHECK_MS,
        );
        this.warmTimer?.unref?.();
    }

    clearWarmer() {
        if (this.warmTimer === null) return;
        this.clock.clearInterval(this.warmTimer);
        this.warmTimer = null;
    }

    /**
     * One parked session, in a free minute.
     *
     * Four questions in order, and a wake only if all four say yes: is anything
     * parked; is the shown session bootstrapped and live — not loading, not on
     * either ladder, not rebuilding its book — because a quiet minute while the
     * shown contract is reconnecting is not free; does the public read budget
     * hold `ROOM_WEIGHT`; has `FLOOR_MS` passed since the last wake. One wake at
     * a time: a session still loading — from the last wake, or from a selection
     * the operator moved off before it came up — holds the tick. A session that
     * stands unavailable is not loading and holds nothing (a wake whose
     * contract was delisted meanwhile held the warmer for good, audit of
     * 2026-09-03).
     *
     * Which one: fewest failed wakes first, then most recently shown — the
     * contract the operator is likeliest to come back to — and never one still
     * inside its hold (`wakeHoldMs`). A wake that fails parks again through the
     * same rule as any other background failure.
     */
    warmOne() {
        if (this.stopped) return;
        const parked = [...this.sessions.values()].filter(session => session.parked !== null);
        if (parked.length === 0) {
            this.clearWarmer();
            return;
        }
        const shown = this.shown;
        if (shown === null
            || !this.isHeld(shown)
            || !shown.bootstrapped
            || shown.reconnectTimer !== null
            || shown.intervalReconnectTimer !== null
            || shown.intervalBootstrapping
            || shown.bookRecovering
            || shown.status?.state !== FUTURES_WORKSTATION_STATES.LIVE) return;
        for (const session of this.sessions.values()) {
            if (session !== shown
                && session.parked === null
                && !session.bootstrapped
                && session.status?.state === FUTURES_WORKSTATION_STATES.LOADING) return;
        }
        let room;
        try {
            room = this.transport.readBudgetRoom();
        } catch (error) {
            this.onInternalError({ phase: 'warmer', code: safeCode(error), symbol: null });
            return;
        }
        if (!Number.isSafeInteger(room?.usedWeight)
            || !Number.isSafeInteger(room?.maximumWeight)
            || room.maximumWeight - room.usedWeight
                < FUTURES_PRODUCTION_WORKSTATION_WARMER.ROOM_WEIGHT) return;
        const now = this.clock.now();
        if (!Number.isSafeInteger(now)) return;
        if (this.lastWakeAt !== null
            && now - this.lastWakeAt < FUTURES_PRODUCTION_WORKSTATION_WARMER.FLOOR_MS) return;
        const ready = parked
            .filter(session => session.parked.at === null
                || now - session.parked.at >= wakeHoldMs(session.lazyWakes))
            .sort((first, second) => first.lazyWakes - second.lazyWakes
                || second.shownOrder - first.shownOrder);
        if (ready.length === 0) return;
        this.lastWakeAt = now;
        const session = ready[0];
        void this.startGeneration(session.request, session.emit, 0, { lazy: true });
    }

    // Every socket, book and timer a session runs, torn down step by step. What
    // a release and a park have in common; what they do not is whether the
    // session keeps its place in the pool.
    stopSession(session) {
        this.release(() => session.abortController.abort(), session.symbol);
        this.release(() => session.intervalAbortController?.abort(), session.symbol);
        this.release(() => session.stream?.close?.(), session.symbol);
        this.release(() => session.orderBook.stop(), session.symbol);
        this.release(() => this.clearPendingTapeTimer(session), session.symbol);
        this.release(() => this.clearPendingDepthDelivery(session), session.symbol);
        this.release(() => {
            if (session.freshnessTimer !== null) this.clock.clearInterval(session.freshnessTimer);
            if (session.reconnectTimer !== null) this.clock.clearTimeout(session.reconnectTimer);
            if (session.intervalReconnectTimer !== null) {
                this.clock.clearTimeout(session.intervalReconnectTimer);
            }
        }, session.symbol);
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
        this.clearWarmer();
        for (const session of [...this.sessions.values()]) this.releaseSession(session);
        this.transport.close();
    }
}
