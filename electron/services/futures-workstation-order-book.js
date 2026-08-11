import {
    addFuturesWorkstationDecimals,
    compareFuturesWorkstationDecimals,
    isNonNegativeFuturesWorkstationDecimal,
    isPositiveFuturesWorkstationDecimal,
    normalizeFuturesWorkstationDecimal,
    parseFuturesWorkstationDecimal,
    subtractFuturesWorkstationDecimals,
} from './futures-workstation-decimal.js';
import {
    FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE,
    FUTURES_WORKSTATION_DIFF_LEVELS_PER_SIDE,
    FUTURES_WORKSTATION_UINT64_MAX,
} from '../../src/utils/futuresWorkstationProtocolShared.js';

export const FUTURES_WORKSTATION_ORDER_BOOK_LIMITS = Object.freeze({
    // Binance serves at most a thousand levels per side, so this is the deepest
    // *complete* book that exists: past it the exchange publishes no snapshot to
    // bridge against, and a book stitched from diff traffic alone would show
    // less liquidity than the market holds — the same lie, further out.
    SNAPSHOT_LEVELS_PER_SIDE: 1_000,
    // Everything the snapshot gives is kept. Retaining less discarded half of a
    // read the desk already paid weight 20 for.
    RETAINED_LEVELS_PER_SIDE: 1_000,
    // Shared with the renderer's own bound so the two can never drift apart:
    // a delivered book larger than the protocol accepts is dropped whole.
    RENDERER_LEVELS_PER_SIDE: FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE,
    // What one *diff* may carry, which is not what a snapshot holds: a diff
    // restates every level that changed, and a sweep with the makers re-posting
    // behind it changes more levels than the book is deep. Bounding a diff by
    // the snapshot's thousand refused the frame — and refusing one frame
    // resynchronizes the whole workspace.
    DIFF_LEVELS_PER_SIDE: FUTURES_WORKSTATION_DIFF_LEVELS_PER_SIDE,
    BUFFERED_EVENTS: 2_048,
    BUFFERED_BYTES: 8 * 1024 * 1024,
});

export const FUTURES_WORKSTATION_ORDER_BOOK_PHASES = Object.freeze({
    BUFFERING: 'buffering',
    LIVE: 'live',
    RESYNC_REQUIRED: 'resync-required',
    STOPPED: 'stopped',
});

export class FuturesWorkstationOrderBookError extends Error {
    constructor(code) {
        super('Futures workstation order-book update was rejected');
        this.name = 'FuturesWorkstationOrderBookError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesWorkstationOrderBookError(code);
};

const readUpdateId = (value) => {
    if (typeof value !== 'string'
        || !/^(?:0|[1-9][0-9]*)$/.test(value)
        || value.length > FUTURES_WORKSTATION_UINT64_MAX.length
        || (value.length === FUTURES_WORKSTATION_UINT64_MAX.length
            && value > FUTURES_WORKSTATION_UINT64_MAX)) {
        fail('INVALID_UPDATE_ID');
    }
    return BigInt(value);
};

const validateLevels = (levels, maximum) => {
    if (!Array.isArray(levels) || levels.length > maximum) fail('INVALID_DEPTH_LEVELS');
    const prices = new Set();
    return levels.map((level) => {
        if (!Array.isArray(level) || level.length !== 2) fail('INVALID_DEPTH_LEVEL');
        const [rawPrice, rawQuantity] = level;
        if (!isPositiveFuturesWorkstationDecimal(rawPrice)
            || !isNonNegativeFuturesWorkstationDecimal(rawQuantity)) {
            fail('INVALID_DEPTH_LEVEL');
        }
        const price = normalizeFuturesWorkstationDecimal(rawPrice);
        const quantity = normalizeFuturesWorkstationDecimal(rawQuantity);
        if (prices.has(price)) fail('DUPLICATE_DEPTH_PRICE');
        prices.add(price);
        return Object.freeze([price, quantity]);
    });
};

const validateSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        fail('INVALID_DEPTH_SNAPSHOT');
    }
    const keys = Object.keys(snapshot).sort();
    if (keys.join(',') !== ['asks', 'bids', 'lastUpdateId'].sort().join(',')) {
        fail('INVALID_DEPTH_SNAPSHOT');
    }
    return Object.freeze({
        lastUpdateId: readUpdateId(snapshot.lastUpdateId),
        lastUpdateIdString: snapshot.lastUpdateId,
        bids: validateLevels(
            snapshot.bids,
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.SNAPSHOT_LEVELS_PER_SIDE,
        ),
        asks: validateLevels(
            snapshot.asks,
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.SNAPSHOT_LEVELS_PER_SIDE,
        ),
    });
};

const validateDelta = (delta) => {
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) fail('INVALID_DEPTH_DELTA');
    const keys = Object.keys(delta).sort();
    if (keys.join(',') !== [
        'firstUpdateId',
        'finalUpdateId',
        'previousFinalUpdateId',
        'bids',
        'asks',
        'eventTime',
    ].sort().join(',')) fail('INVALID_DEPTH_DELTA');
    const firstUpdateId = readUpdateId(delta.firstUpdateId);
    const finalUpdateId = readUpdateId(delta.finalUpdateId);
    const previousFinalUpdateId = readUpdateId(delta.previousFinalUpdateId);
    if (firstUpdateId > finalUpdateId
        || !Number.isSafeInteger(delta.eventTime)
        || delta.eventTime < 0) {
        fail('INVALID_DEPTH_DELTA');
    }
    return Object.freeze({
        ...delta,
        firstUpdateIdBigInt: firstUpdateId,
        finalUpdateIdBigInt: finalUpdateId,
        previousFinalUpdateIdBigInt: previousFinalUpdateId,
        bids: validateLevels(delta.bids, FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.DIFF_LEVELS_PER_SIDE),
        asks: validateLevels(delta.asks, FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.DIFF_LEVELS_PER_SIDE),
    });
};

// A thousand-level side is sorted several times a second, and comparing two
// decimals re-parses both strings. Sorting through the comparator would parse
// every price twenty-odd times per pass; parsing each price once and ordering
// on the parsed value is the same order, exactly, for a fraction of the work.
const sortedByPrice = (side, descending) => {
    const entries = [];
    let scale = 0;
    for (const [price, quantity] of side) {
        const decimal = parseFuturesWorkstationDecimal(price);
        if (decimal.scale > scale) scale = decimal.scale;
        entries.push({ price, quantity, decimal, key: 0n });
    }
    for (const entry of entries) {
        entry.key = entry.decimal.coefficient * (10n ** BigInt(scale - entry.decimal.scale));
    }
    const direction = descending ? -1n : 1n;
    entries.sort((left, right) => {
        if (left.key === right.key) return 0;
        return Number((left.key < right.key ? -1n : 1n) * direction);
    });
    return entries;
};

const trimSide = (side, descending) => {
    if (side.size <= FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RETAINED_LEVELS_PER_SIDE) return;
    const sorted = sortedByPrice(side, descending);
    for (const entry of sorted.slice(FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RETAINED_LEVELS_PER_SIDE)) {
        side.delete(entry.price);
    }
};

const applyLevels = (side, levels, band = null) => {
    for (const [price, quantity] of levels) {
        // Outside the band the snapshot proved, a level is one the desk cannot
        // account for: its neighbours were never read, so keeping it would build
        // a row out of one known level and an unknown gap. A removal is always
        // applied — forgetting a level is never a lie.
        if (band !== null && quantity !== '0' && !band.contains(price)) continue;
        if (quantity === '0') side.delete(price);
        else side.set(price, quantity);
    }
};

// The stretch of price a snapshot actually covered. Within it every level is
// either from the snapshot or from a diff applied since, so the book is exact.
// Beyond it the book knows only the levels a diff happened to touch, which is
// not a book — it is a book with holes in it, and a grouped row drawn across
// those holes understates the market.
const bandOfSnapshot = (snapshot) => {
    const floor = snapshot.bids.reduce(
        (lowest, [price]) => (lowest === null || compareFuturesWorkstationDecimals(price, lowest) < 0
            ? price
            : lowest),
        null,
    );
    const ceiling = snapshot.asks.reduce(
        (highest, [price]) => (highest === null || compareFuturesWorkstationDecimals(price, highest) > 0
            ? price
            : highest),
        null,
    );
    if (floor === null || ceiling === null) return null;
    return Object.freeze({
        floor,
        ceiling,
        contains: price => compareFuturesWorkstationDecimals(price, floor) >= 0
            && compareFuturesWorkstationDecimals(price, ceiling) <= 0,
    });
};

// The best price on a side is a minimum, not an ordering — taking it by sorting
// the whole book was two full sorts per delta for two values.
const bestPrice = (side, descending) => {
    let best = null;
    for (const price of side.keys()) {
        if (best === null) {
            best = price;
            continue;
        }
        const comparison = compareFuturesWorkstationDecimals(price, best);
        if (descending ? comparison > 0 : comparison < 0) best = price;
    }
    return best;
};

const formatSide = (side, descending, limit) => {
    const entries = sortedByPrice(side, descending).slice(0, limit);
    let total = '0';
    return Object.freeze(entries.map(({ price, quantity }) => {
        total = addFuturesWorkstationDecimals(total, quantity);
        return Object.freeze({ price, quantity, total });
    }));
};

export class FuturesWorkstationOrderBook {
    constructor() {
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING;
        this.lastUpdateId = null;
        this.bids = new Map();
        this.asks = new Map();
        this.buffer = [];
        this.bufferedBytes = 0;
        this.band = null;
    }

    beginBootstrap() {
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING;
        this.lastUpdateId = null;
        this.bids.clear();
        this.asks.clear();
        this.buffer = [];
        this.bufferedBytes = 0;
        this.band = null;
    }

    /**
     * Whether the band still reaches `range` past the best price on both sides.
     *
     * The rows on screen — how many, times the step they are grouped by — are
     * what has to be covered. When the market walks far enough that it is not,
     * the answer is a fresh snapshot, not a book extended past what it proves.
     */
    coversRange(range) {
        if (this.band === null) return false;
        if (typeof range !== 'string' || !isPositiveFuturesWorkstationDecimal(range)) return true;
        const bid = bestPrice(this.bids, true);
        const ask = bestPrice(this.asks, false);
        if (bid === null || ask === null) return false;
        return compareFuturesWorkstationDecimals(
            subtractFuturesWorkstationDecimals(bid, range),
            this.band.floor,
        ) >= 0 && compareFuturesWorkstationDecimals(
            addFuturesWorkstationDecimals(ask, range),
            this.band.ceiling,
        ) <= 0;
    }

    /**
     * How many times deeper the band would have to be to cover `range`; 0 when
     * it already does.
     *
     * A ratio rather than a verdict, so a step three sizes coarser buys the page
     * it needs in one read instead of climbing to it one read at a time. Read as
     * ordinary numbers on purpose: it decides how much to ask for, never what
     * anything is worth.
     */
    rangeShortfall(range) {
        if (this.coversRange(range)) return 0;
        if (this.band === null) return Number.POSITIVE_INFINITY;
        const span = Number(subtractFuturesWorkstationDecimals(this.band.ceiling, this.band.floor));
        const bid = bestPrice(this.bids, true);
        const ask = bestPrice(this.asks, false);
        if (bid === null || ask === null) return Number.POSITIVE_INFINITY;
        const needed = Number(addFuturesWorkstationDecimals(
            subtractFuturesWorkstationDecimals(ask, bid),
            addFuturesWorkstationDecimals(range, range),
        ));
        if (!Number.isFinite(span) || !Number.isFinite(needed) || span <= 0) {
            return Number.POSITIVE_INFINITY;
        }
        return Math.max(1, needed / span);
    }

    push(rawDelta, frameBytes = 0) {
        if (this.phase === FUTURES_WORKSTATION_ORDER_BOOK_PHASES.STOPPED) {
            return Object.freeze({ applied: false, reason: 'stopped' });
        }
        const delta = validateDelta(rawDelta);
        if (!Number.isSafeInteger(frameBytes) || frameBytes < 0) fail('INVALID_DEPTH_FRAME_SIZE');
        if (this.phase === FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING) {
            if (this.buffer.length >= FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.BUFFERED_EVENTS
                || this.bufferedBytes + frameBytes
                    > FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.BUFFERED_BYTES) {
                this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
                this.buffer = [];
                this.bufferedBytes = 0;
                return Object.freeze({ applied: false, reason: 'overflow', resync: true });
            }
            this.buffer.push(delta);
            this.bufferedBytes += frameBytes;
            return Object.freeze({ applied: false, reason: 'buffered' });
        }
        if (this.phase !== FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE) {
            return Object.freeze({ applied: false, reason: 'resync-required', resync: true });
        }
        if (delta.finalUpdateIdBigInt <= this.lastUpdateId) {
            return Object.freeze({ applied: false, reason: 'duplicate' });
        }
        if (delta.previousFinalUpdateIdBigInt !== this.lastUpdateId) {
            this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
            return Object.freeze({ applied: false, reason: 'gap', resync: true });
        }
        this.applyDelta(delta);
        return Object.freeze({ applied: true, reason: 'live' });
    }

    bootstrap(rawSnapshot) {
        if (this.phase !== FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING) {
            fail('INVALID_BOOTSTRAP_PHASE');
        }
        const snapshot = validateSnapshot(rawSnapshot);
        const retained = this.buffer.filter(delta => delta.finalUpdateIdBigInt >= snapshot.lastUpdateId);
        const first = retained[0];
        if (!first
            || first.firstUpdateIdBigInt > snapshot.lastUpdateId
            || first.finalUpdateIdBigInt < snapshot.lastUpdateId) {
            this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
            this.buffer = [];
            this.bufferedBytes = 0;
            return Object.freeze({ live: false, reason: 'snapshot-not-bridged', resync: true });
        }

        this.band = bandOfSnapshot(snapshot);
        applyLevels(this.bids, snapshot.bids);
        applyLevels(this.asks, snapshot.asks);
        this.lastUpdateId = snapshot.lastUpdateId;
        for (const delta of retained) {
            if (delta.finalUpdateIdBigInt <= this.lastUpdateId) continue;
            if (delta !== first && delta.previousFinalUpdateIdBigInt !== this.lastUpdateId) {
                this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
                this.bids.clear();
                this.asks.clear();
                this.buffer = [];
                this.bufferedBytes = 0;
                return Object.freeze({ live: false, reason: 'buffer-gap', resync: true });
            }
            this.applyDelta(delta);
        }
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE;
        this.buffer = [];
        this.bufferedBytes = 0;
        return Object.freeze({ live: true, reason: 'bootstrapped' });
    }

    applyDelta(delta) {
        applyLevels(this.bids, delta.bids, this.band);
        applyLevels(this.asks, delta.asks, this.band);
        trimSide(this.bids, true);
        trimSide(this.asks, false);
        this.lastUpdateId = delta.finalUpdateIdBigInt;
        const bestBid = bestPrice(this.bids, true);
        const bestAsk = bestPrice(this.asks, false);
        if (bestBid && bestAsk && compareFuturesWorkstationDecimals(bestBid, bestAsk) >= 0) {
            this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
            fail('CROSSED_ORDER_BOOK');
        }
    }

    toRendererView() {
        if (this.phase !== FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE
            || this.lastUpdateId === null) return null;
        const bids = formatSide(
            this.bids,
            true,
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RENDERER_LEVELS_PER_SIDE,
        );
        const asks = formatSide(
            this.asks,
            false,
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RENDERER_LEVELS_PER_SIDE,
        );
        const spread = bids[0] && asks[0]
            ? subtractFuturesWorkstationDecimals(asks[0].price, bids[0].price)
            : '0';
        return Object.freeze({
            lastUpdateId: this.lastUpdateId.toString(),
            bids,
            asks,
            spread,
        });
    }

    stop() {
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.STOPPED;
        this.lastUpdateId = null;
        this.bids.clear();
        this.asks.clear();
        this.buffer = [];
        this.bufferedBytes = 0;
        this.band = null;
    }
}
