import {
    addFuturesWorkstationDecimals,
    compareFuturesWorkstationDecimals,
    isFuturesWorkstationDecimal,
    isNonNegativeFuturesWorkstationDecimal,
    isPositiveFuturesWorkstationDecimal,
    normalizeFuturesWorkstationDecimal,
    parseFuturesWorkstationDecimal,
    subtractFuturesWorkstationDecimals,
} from './futures-workstation-decimal.js';
import {
    FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE,
    FUTURES_WORKSTATION_DEPTH_MIN_LEVELS_PER_SIDE,
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
    // a delivered book larger than the protocol accepts is dropped whole. This
    // is the ceiling on a delivery, not the delivery: what crosses is bounded by
    // the range the panel stated it reads. See `toRendererView`.
    RENDERER_LEVELS_PER_SIDE: FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE,
    // And the floor under it, for the reading a range cannot describe: ungrouped,
    // a row is one raw level and the distance the rows span is wherever the
    // market happens to rest.
    MIN_DELIVERED_LEVELS_PER_SIDE: FUTURES_WORKSTATION_DEPTH_MIN_LEVELS_PER_SIDE,
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
    const extreme = (levels, further) => levels.reduce(
        (found, [price]) => (found === null
            || (further ? compareFuturesWorkstationDecimals(price, found) < 0
                : compareFuturesWorkstationDecimals(price, found) > 0)
            ? price
            : found),
        null,
    );
    const floor = extreme(snapshot.bids, true);
    const bestBid = extreme(snapshot.bids, false);
    const ceiling = extreme(snapshot.asks, false);
    const bestAsk = extreme(snapshot.asks, true);
    if (floor === null || ceiling === null) return null;
    return Object.freeze({
        floor,
        ceiling,
        // How far past the best price this page reached on each side at the
        // moment it was read — which is what reading the same page again would
        // reach. The distance from the *current* best price to the edge is what
        // the band still covers; this is what it was bought to cover. The
        // difference between the two is the difference between a market that has
        // walked out of a wide enough band and a page too shallow to have
        // covered the rows in the first place, and only the second is worth
        // buying a deeper page for.
        provenBelow: subtractFuturesWorkstationDecimals(bestBid, floor),
        provenAbove: subtractFuturesWorkstationDecimals(ceiling, bestAsk),
        contains: price => compareFuturesWorkstationDecimals(price, floor) >= 0
            && compareFuturesWorkstationDecimals(price, ceiling) <= 0,
    });
};

// How little room a side may have left inside the band before the page is read
// again, as a share of what that side's page proved when it was bought.
//
// Not zero. A side re-read once it has run out has already been empty on the
// screen the operator is trading from, for as long as the read takes — and a
// read takes a bridge plus a round trip to the exchange. Re-read with a quarter
// of the room still there and the side has rows to draw throughout.
export const FUTURES_WORKSTATION_BAND_ROOM_SHARE = 0.25;

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

const isNearerPriceEntry = (left, right, descending) => (
    descending ? left.key > right.key : left.key < right.key
);

// Keep only the nearest `count` entries without ordering the candidates. The
// heap is worst-first, so each nearer candidate replaces the one level the
// result can least afford to keep.
const selectNearestPriceEntries = (entries, count, descending) => {
    if (count <= 0) return [];
    if (entries.length <= count) return entries;

    const heap = [];
    const isWorse = (left, right) => isNearerPriceEntry(right, left, descending);
    const swap = (left, right) => {
        [heap[left], heap[right]] = [heap[right], heap[left]];
    };
    const bubbleUp = (start) => {
        let index = start;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (!isWorse(heap[index], heap[parent])) break;
            swap(index, parent);
            index = parent;
        }
    };
    const bubbleDown = () => {
        let index = 0;
        while (true) {
            const left = (index * 2) + 1;
            const right = left + 1;
            let worse = index;
            if (left < heap.length && isWorse(heap[left], heap[worse])) worse = left;
            if (right < heap.length && isWorse(heap[right], heap[worse])) worse = right;
            if (worse === index) break;
            swap(index, worse);
            index = worse;
        }
    };

    for (const entry of entries) {
        if (heap.length < count) {
            heap.push(entry);
            bubbleUp(heap.length - 1);
        } else if (isNearerPriceEntry(entry, heap[0], descending)) {
            heap[0] = entry;
            bubbleDown();
        }
    }
    return heap;
};

// Select the exact prefix a fully ordered side would deliver, then order only
// that prefix. Prices and the range are aligned as integers at one decimal
// scale, preserving arbitrary precision and mixed-scale ordering without a
// binary-number price conversion.
const boundedByPrice = (side, descending, limit, range) => {
    const rangeDecimal = parseFuturesWorkstationDecimal(range);
    const entries = [];
    let scale = rangeDecimal.scale;
    for (const [price, quantity] of side) {
        const decimal = parseFuturesWorkstationDecimal(price);
        if (decimal.scale > scale) scale = decimal.scale;
        entries.push({ price, quantity, decimal, key: 0n });
    }
    if (entries.length === 0) return entries;

    for (const entry of entries) {
        entry.key = entry.decimal.coefficient * (10n ** BigInt(scale - entry.decimal.scale));
    }
    const rangeKey = rangeDecimal.coefficient * (10n ** BigInt(scale - rangeDecimal.scale));
    let bestKey = entries[0].key;
    for (let index = 1; index < entries.length; index += 1) {
        const key = entries[index].key;
        if (descending ? key > bestKey : key < bestKey) bestKey = key;
    }
    const edgeKey = descending ? bestKey - rangeKey : bestKey + rangeKey;
    const isWithinEdge = entry => (descending ? entry.key >= edgeKey : entry.key <= edgeKey);
    const withinEdge = entries.filter(isWithinEdge);
    const floor = Math.min(
        FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.MIN_DELIVERED_LEVELS_PER_SIDE,
        limit,
        entries.length,
    );

    let selected;
    if (withinEdge.length > limit) {
        selected = selectNearestPriceEntries(withinEdge, limit, descending);
    } else if (withinEdge.length >= floor) {
        selected = withinEdge;
    } else {
        const outsideEdge = entries.filter(entry => !isWithinEdge(entry));
        selected = [
            ...withinEdge,
            ...selectNearestPriceEntries(outsideEdge, floor - withinEdge.length, descending),
        ];
    }
    selected.sort((left, right) => {
        if (left.key === right.key) return 0;
        return isNearerPriceEntry(left, right, descending) ? -1 : 1;
    });
    return selected;
};

// The levels the panel stated it reads, and no more.
//
// `range` is a distance in the contract's own quote currency: the rows on screen
// times the step they are grouped by. A grouped row's boundary sits at most one
// step the wrong side of the best price, so the deepest row a panel of `rows`
// rows can draw ends strictly inside `rows × step` of it — the stated range
// fills every row it was computed from, with nothing to spare and nothing owed.
//
// Below the floor the range is ignored: ungrouped it describes the wrong thing
// entirely, naming a distance in ticks for rows that are levels.
const formatSide = (side, descending, limit, range) => {
    const entries = range === null
        ? sortedByPrice(side, descending)
        : boundedByPrice(side, descending, limit, range);
    const levels = [];
    for (const { price, quantity } of entries) {
        if (levels.length >= limit) break;
        levels.push(Object.freeze({ price, quantity }));
    }
    return Object.freeze(levels);
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
        // Set when a snapshot went live without a diff to bridge it, so the
        // first diff that arrives is held to the bootstrap rule rather than the
        // live one. See `bootstrap`.
        this.awaitingBridge = false;
        // The furthest the stream has ever been seen to reach, kept across a
        // re-bootstrap because the socket is the same one. A snapshot behind it
        // is stale however empty the buffer happens to be.
        this.observedUpdateId = null;
    }

    beginBootstrap() {
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING;
        this.lastUpdateId = null;
        this.bids.clear();
        this.asks.clear();
        this.buffer = [];
        this.bufferedBytes = 0;
        this.band = null;
        this.awaitingBridge = false;
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
     *
     * Measured on each side against its own edge and reported as the worse of
     * the two. Exactly 1 means no side's page is short and the market has walked
     * out from between them, which the same page re-read answers.
     */
    rangeShortfall(range) {
        // No band at all — a snapshot that came back with a side empty. Nothing
        // is being dropped, so there is nothing the rows can fall outside of,
        // and reading the same page again would not produce a band either.
        if (this.band === null) return 0;
        if (this.coversRange(range)) return 0;
        const bid = bestPrice(this.bids, true);
        const ask = bestPrice(this.asks, false);
        if (bid === null || ask === null) return Number.POSITIVE_INFINITY;
        const needed = Number(range);
        if (!Number.isFinite(needed) || needed <= 0) return 0;
        // Each side is sized against its own edge, never against the total span.
        // Measured on the span, a side reaching far past the rows pays for one
        // that falls short of them: bids from 10 down to 9.9 and asks from 10.1
        // up to 12, read at a range of 1, state a span of 2.1 against a need of
        // 2.1 — sufficient, exactly — and buy nothing, while the bid side stays
        // short by nine tenths of the reading. For the whole session, because
        // every re-read of that page returns the same asymmetry.
        let deepest = 0;
        for (const proven of [this.band.provenBelow, this.band.provenAbove]) {
            const reach = Number(proven);
            // This side's page did reach the rows when it was read, so the
            // market has walked rather than the page being short: a deeper one
            // buys nothing this side needs.
            if (Number.isFinite(reach) && reach >= needed) continue;
            // A side that proved no distance at all cannot be sized — one
            // distinct price is not a spacing to multiply. Re-read as it is and
            // sized on the next reading, which will have a side to measure.
            if (!Number.isFinite(reach) || reach <= 0) return Number.POSITIVE_INFINITY;
            deepest = Math.max(deepest, needed / reach);
        }
        // Both pages reach far enough and the market has simply walked out from
        // between them: the same page, read again, is a band centred where the
        // market is now.
        return Math.max(1, deepest);
    }

    /**
     * Whether the band still has room for the market to move in on both sides.
     *
     * A different question from `rangeShortfall`, and deliberately not asked in
     * the same terms. That one asks whether the band reaches the rows on screen,
     * which is about the step the operator chose and is answered by a deeper
     * page. This one asks whether the page is still centred on the market, which
     * no page depth answers: every level past the edge of the band is dropped,
     * so the side the market walks toward stops receiving levels and empties
     * while its twin stays full. The only answer is the same page, read again,
     * where the market is now.
     *
     * Judged against what each side's page proved when it was read, never
     * against the stated range. What a page proved is fixed at the moment of
     * reading, so a band that fell short of the rows would go on falling short
     * of them for the session — and a band judged by that measure would never be
     * found to have moved at all.
     */
    holdsMarket(share = FUTURES_WORKSTATION_BAND_ROOM_SHARE) {
        if (this.band === null) return true;
        const bid = bestPrice(this.bids, true);
        const ask = bestPrice(this.asks, false);
        // A side emptied outright states no best price to measure room from. It
        // is the shortfall's case — unmeasurable, and re-read on its own account
        // — not this one.
        if (bid === null || ask === null) return true;
        const sides = [
            [subtractFuturesWorkstationDecimals(bid, this.band.floor), this.band.provenBelow],
            [subtractFuturesWorkstationDecimals(this.band.ceiling, ask), this.band.provenAbove],
        ];
        for (const [room, proven] of sides) {
            const reach = Number(proven);
            // A side whose page proved no distance at all — one distinct price —
            // is not a spacing to take a share of. Left to the shortfall.
            if (!Number.isFinite(reach) || reach <= 0) continue;
            const left = Number(room);
            if (!Number.isFinite(left)) continue;
            // Ordinary numbers on purpose, as the shortfall is: this decides
            // whether to read a page, never what anything is worth.
            if (left < reach * share) return false;
        }
        return true;
    }

    push(rawDelta, frameBytes = 0) {
        if (this.phase === FUTURES_WORKSTATION_ORDER_BOOK_PHASES.STOPPED) {
            return Object.freeze({ applied: false, reason: 'stopped' });
        }
        const delta = validateDelta(rawDelta);
        if (!Number.isSafeInteger(frameBytes) || frameBytes < 0) fail('INVALID_DEPTH_FRAME_SIZE');
        if (this.observedUpdateId === null || delta.finalUpdateIdBigInt > this.observedUpdateId) {
            this.observedUpdateId = delta.finalUpdateIdBigInt;
        }
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
        // A book that went live on an unbridged snapshot still owes its bridge,
        // and this is the diff that pays it: the exchange's own rule for the
        // first diff after a snapshot, which spans the snapshot's update id
        // rather than starting from it. Everything else — and every diff
        // afterwards — chains on `pu` as before. A diff that begins beyond the
        // snapshot proves updates were published while nothing was listening,
        // and that is the gap it has always been.
        const bridges = this.awaitingBridge
            && delta.firstUpdateIdBigInt <= this.lastUpdateId;
        if (!bridges && delta.previousFinalUpdateIdBigInt !== this.lastUpdateId) {
            this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
            return Object.freeze({ applied: false, reason: 'gap', resync: true });
        }
        this.awaitingBridge = false;
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
        // A diff that *begins* beyond the snapshot is proof that updates were
        // published between the two and nothing was holding them: the snapshot
        // cannot be bridged and has to be read again.
        //
        // No diff at all is not that proof. `<symbol>@depth@100ms` publishes
        // only when a level changes, so a contract nobody is trading delivers
        // nothing to bridge with, and never will — the exchange returned the
        // same `lastUpdateId` on four consecutive snapshots of PYPLUSDT while
        // this was measured. Refusing it left the operator with an empty book on
        // every quiet contract. That snapshot is not stale; it is the book, and
        // the bridge is owed to whichever diff arrives first.
        //
        // "No diff" means none the desk has ever seen on this stream, not none
        // still buffered: a re-bootstrap empties the buffer, and a snapshot
        // behind a diff already read is stale whether or not that diff is still
        // in hand.
        const quiet = first === undefined
            && (this.observedUpdateId === null || this.observedUpdateId <= snapshot.lastUpdateId);
        if (first ? first.firstUpdateIdBigInt > snapshot.lastUpdateId : !quiet) {
            this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
            this.buffer = [];
            this.bufferedBytes = 0;
            return Object.freeze({ live: false, reason: 'snapshot-not-bridged', resync: true });
        }

        this.band = bandOfSnapshot(snapshot);
        applyLevels(this.bids, snapshot.bids);
        applyLevels(this.asks, snapshot.asks);
        this.lastUpdateId = snapshot.lastUpdateId;
        this.awaitingBridge = first === undefined;
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

    /**
     * The book as the renderer reads it, bounded by the range the panel stated.
     *
     * The trim is on delivery alone: everything the snapshot bought is still
     * held, still bridged and still proven, so widening the reading is answered
     * from the book in hand rather than by another read. A range that has not
     * been stated yet, or one that cannot be read as a distance, delivers at the
     * ceiling — a first book must not arrive short of the rows the panel is
     * about to ask for.
     */
    toRendererView(range = null, { atDeepestPage = false } = {}) {
        if (this.phase !== FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE
            || this.lastUpdateId === null) return null;
        const bound = isFuturesWorkstationDecimal(range)
            && isPositiveFuturesWorkstationDecimal(range)
            ? range
            : null;
        const bids = formatSide(
            this.bids,
            true,
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RENDERER_LEVELS_PER_SIDE,
            bound,
        );
        const asks = formatSide(
            this.asks,
            false,
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RENDERER_LEVELS_PER_SIDE,
            bound,
        );
        const spread = bids[0] && asks[0]
            ? subtractFuturesWorkstationDecimals(asks[0].price, bids[0].price)
            : '0';
        return Object.freeze({
            lastUpdateId: this.lastUpdateId.toString(),
            bids,
            asks,
            spread,
            // How far the page this book was bought at proved past the best price
            // on each side — where the exchange's book ends, not where the rows
            // do. Stated only once no deeper page can be bought: before then it
            // would describe what the desk has spent rather than what the market
            // publishes, and a panel that ended its grouping ladder on it would
            // stop the operator asking for the deeper page.
            //
            // What the page proved when it was read, not what is left of it: the
            // second shrinks as the market walks inside the band, and a ladder
            // cut against a shrinking number would move under the operator's
            // hand while the market did nothing but trade.
            reach: atDeepestPage && this.band !== null
                ? Object.freeze({
                    below: this.band.provenBelow,
                    above: this.band.provenAbove,
                })
                : null,
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
        this.awaitingBridge = false;
        // The stream this was observed on is going away with the session.
        this.observedUpdateId = null;
    }
}
