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
    FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE,
    FUTURES_WORKSTATION_DIFF_LEVELS_PER_SIDE,
    FUTURES_WORKSTATION_UINT64_MAX,
} from '../../src/utils/futuresWorkstationProtocolShared.js';
// The panel's own grouping, called where the book is. See `groupSide`.
import { groupFuturesBookLevels } from '../../src/utils/futuresOrderBook.js';

export const FUTURES_WORKSTATION_ORDER_BOOK_LIMITS = Object.freeze({
    // The deepest page a single REST read returns, and so the deepest stretch of
    // price the desk can prove *complete* in one go: past it there is no snapshot
    // to bridge against. It is not how far the exchange's book goes — the diff
    // stream restates levels far outside it, and those are what the desk draws
    // beyond the band.
    SNAPSHOT_LEVELS_PER_SIDE: 1_000,
    // How much of the book is kept, which is not the same question as how much a
    // page proves. Measured on 2026-08-13 by applying `@depth@100ms` for three
    // minutes without the band filter: the whole book is 2431 to 3425 levels a
    // side on AKEUSDT and BTCUSDT, reaching past 80% of price on both, and the
    // nearest thousand of it hold between 7% and 18% of the resting value. So a
    // thousand was not a bound on cost — it was most of the book, thrown away.
    //
    // Four thousand holds the whole of both books measured, with margin.
    //
    // It stayed at four thousand once rows crossed instead of levels, and for a
    // different reason than it was set for. Delivery no longer walks the book to
    // fill the wire, but it still sorts the side it groups, and eviction sorts it
    // again — so the ceiling is still what a stream can make the desk pay per
    // frame. Measured 2026-08-14 on a book sitting at the bound, at ten frames
    // and ten diffs a second on the shown contract:
    //
    //   bound   frame    diff    per second
    //    4000   7.9 ms   0.8 ms     87 ms
    //   10000  20.4 ms   1.8 ms    222 ms
    //   20000  30.8 ms   4.0 ms    348 ms
    //
    // A third of a core for one contract's book is not a trade worth making for
    // headroom nobody has needed: the deepest book measured on a real contract is
    // 3425 levels a side. Raising it wants grouping that does not sort the whole
    // side — buckets can be filled in one pass and only the rows drawn need
    // ordering — and that is a change to how the rows are built, not to a number.
    RETAINED_LEVELS_PER_SIDE: 4_000,
    // Shared with the renderer's own bound so the two can never drift apart: a
    // delivered book larger than the protocol accepts is dropped whole. This is
    // the ceiling on a delivery, not the delivery — what crosses is the rows the
    // panel said it draws, which is a couple of dozen. See `toRendererRows`.
    RENDERER_ROWS_PER_SIDE: FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE,
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

// What a price string parses to never changes, so it is worth remembering.
//
// A side is walked several times a second and almost all of it is the same
// levels as last time: a diff restates a few dozen prices out of thousands. The
// parse is a regex, a split and two BigInt constructions, and it was being paid
// again for every level on every frame. Remembering it is safe in the way only a
// pure function of its key is safe — a stale entry is impossible, because the
// same string cannot parse to anything else — so the cache needs no invalidation
// at all, only a bound.
//
// The bound is per book and generous: prices leave the book as the market walks,
// and their entries would otherwise accumulate for the life of the session.
// Rebuilding from the keys actually held costs one pass and happens rarely.
const PARSED_PRICE_CACHE_SLACK = 2;

// A side of the book, which remembers what its own prices parse to. One cache
// per side rather than one for the desk, so a contract nobody is looking at
// cannot push the shown one's prices out of it.
class FuturesWorkstationBookSide extends Map {
    constructor() {
        super();
        this.parsed = new Map();
        this.parsedBound = FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RETAINED_LEVELS_PER_SIDE
            * PARSED_PRICE_CACHE_SLACK;
    }

    decimalOf(price) {
        const remembered = this.parsed.get(price);
        if (remembered !== undefined) return remembered;
        const decimal = parseFuturesWorkstationDecimal(price);
        if (this.parsed.size >= this.parsedBound) this.forgetPricesNotHeld();
        this.parsed.set(price, decimal);
        return decimal;
    }

    // Prices leave the book as the market walks and as the far edge is evicted,
    // and what they parsed to would otherwise be remembered for the life of the
    // session. Dropping only what the side no longer holds keeps the levels that
    // are about to be walked again, where emptying the whole cache would make
    // the next frame re-parse the entire book.
    forgetPricesNotHeld() {
        for (const price of this.parsed.keys()) {
            if (!this.has(price)) this.parsed.delete(price);
        }
        // Still full of prices the book is actually holding: the bound is below
        // what this side legitimately needs, so it is the bound that gives.
        if (this.parsed.size >= this.parsedBound) this.parsed.clear();
    }
}

// A thousand-level side is sorted several times a second, and comparing two
// decimals re-parses both strings. Sorting through the comparator would parse
// every price twenty-odd times per pass; parsing each price once and ordering
// on the parsed value is the same order, exactly, for a fraction of the work.
const sortedByPrice = (side, descending) => {
    const entries = [];
    let scale = 0;
    for (const [price, quantity] of side) {
        const decimal = side.decimalOf(price);
        if (decimal.scale > scale) scale = decimal.scale;
        entries.push({ price, quantity, decimal, key: 0n });
    }
    // A contract quotes every price at one precision, so the common side needs
    // no rescaling at all and the coefficients are already comparable.
    for (const entry of entries) {
        entry.key = entry.decimal.scale === scale
            ? entry.decimal.coefficient
            : entry.decimal.coefficient * (10n ** BigInt(scale - entry.decimal.scale));
    }
    const direction = descending ? -1n : 1n;
    entries.sort((left, right) => {
        if (left.key === right.key) return 0;
        return Number((left.key < right.key ? -1n : 1n) * direction);
    });
    return entries;
};

// Past the ceiling, the levels furthest from the market go first. Nearest-first
// retention is what the operator zooms out *against*, so evicting from the near
// edge would drop exactly what a coarse step is read for; and a level far from
// the market is the one whose absence a row can best survive, because rows out
// there are wide.
const trimSide = (side, descending) => {
    if (side.size <= FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RETAINED_LEVELS_PER_SIDE) return;
    const sorted = sortedByPrice(side, descending);
    for (const entry of sorted.slice(FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RETAINED_LEVELS_PER_SIDE)) {
        side.delete(entry.price);
    }
};

// A level the exchange restates is applied wherever it rests. The exchange named
// its price and its quantity, and that is exact whether or not the snapshot page
// happened to reach it.
//
// This refused every level outside the band, on the reasoning that its
// neighbours were never read and a row built across the gap would understate the
// market. The first half is true and is why the band is still recorded and still
// marked on the delivery. The second half does not follow: a row that is absent
// understates by all of it, which is the same error taken to the limit. Measured
// on 2026-08-13, refusing them cost between 82% and 93% of the resting value of
// the book — and it is the reason the desk could not be zoomed out past a couple
// of per cent while the exchange's own app showed the book past 100%.
const applyLevels = (side, levels) => {
    for (const [price, quantity] of levels) {
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

// Two parsed decimals in the order their prices are in, without going back to
// the strings. Equal scales are the whole of the live case — a contract quotes
// every price at its own precision — so the exponentiation is only paid on a
// book that mixes them.
const compareParsedDecimals = (left, right) => {
    if (left.scale === right.scale) {
        if (left.coefficient === right.coefficient) return 0;
        return left.coefficient < right.coefficient ? -1 : 1;
    }
    const scale = left.scale > right.scale ? left.scale : right.scale;
    const leftKey = left.coefficient * (10n ** BigInt(scale - left.scale));
    const rightKey = right.coefficient * (10n ** BigInt(scale - right.scale));
    if (leftKey === rightKey) return 0;
    return leftKey < rightKey ? -1 : 1;
};

// The best price on a side is a minimum, not an ordering — taking it by sorting
// the whole book was two full sorts per delta for two values.
//
// Each price is parsed once. Comparing two decimal *strings* parses both, so
// walking a side through the string comparator parsed every price twice and the
// running best once more for every level behind it. That is the hottest loop the
// desk has: the crossed-book check runs it twice per applied diff, ten diffs a
// second, over a side that is now thousands of levels deep rather than the
// nearest thousand. Measured on a 4000-level side, parsing once took a diff from
// 2.9 ms to 0.6 ms.
const bestPrice = (side, descending) => {
    let best = null;
    let bestDecimal = null;
    for (const price of side.keys()) {
        const decimal = side.decimalOf(price);
        if (best === null) {
            best = price;
            bestDecimal = decimal;
            continue;
        }
        const comparison = compareParsedDecimals(decimal, bestDecimal);
        if (descending ? comparison > 0 : comparison < 0) {
            best = price;
            bestDecimal = decimal;
        }
    }
    return best;
};

/**
 * The rows the panel draws, grouped where the book is.
 *
 * Grouping used to happen on arrival, which meant the levels had to arrive —
 * and a level count is the one bound that means nothing to a grouped book. What
 * crossed was the nearest thousand levels a side, selected by a heap: at a
 * coarse step those thousand are a dense clump inside the first two or three
 * rows, and every row past them was drawn empty over a book that held levels
 * for all of them. Measured on the operator's own desk, 2026-08-14: AKEUSDT at
 * a step of 1.34% of price drew three rows of fourteen, while the delivery
 * reached 2.6% past the best price and the book on hand reached 54.96%.
 *
 * So the whole side is grouped instead, best price outward, and the walk stops
 * one row past the panel's count. Prices are monotonic, so opening that row
 * proves every earlier one closed: a coarse step walks far to fill its rows, a
 * fine step stops almost at once, and neither pays for the other's reading.
 *
 * The grouping is the panel's own — the same function, imported, rather than a
 * second implementation held to agree with it. A row the book computes and a
 * row the panel would have computed are then the same row by construction,
 * including the bucket key a working order is matched by.
 */
const groupSide = (side, descending, step, rows) => {
    const entries = sortedByPrice(side, descending);
    return {
        best: entries.length > 0 ? entries[0].price : null,
        rows: Object.freeze(groupFuturesBookLevels({
            levels: entries,
            side: descending ? 'bid' : 'ask',
            step,
            limit: rows,
        }).map(row => Object.freeze({
            price: row.price,
            quantity: row.quantity,
            value: row.value,
            groupKey: row.groupKey,
        }))),
    };
};

export class FuturesWorkstationOrderBook {
    constructor() {
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING;
        this.lastUpdateId = null;
        this.bids = new FuturesWorkstationBookSide();
        this.asks = new FuturesWorkstationBookSide();
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

    /**
     * Start a rebuild.
     *
     * `keepFarBook` is for the rebuild the desk asks for while the stream is
     * still carrying: a snapshot centred where the market is now. The snapshot
     * is authoritative for the stretch of price it covers and says nothing about
     * anything else, so the levels beyond it are neither refreshed nor
     * contradicted by it — and clearing them on every re-centre means the book
     * beyond the page never accumulates at all on the contracts that re-centre
     * most, which are exactly the ones the operator is trading.
     *
     * It is not for a rebuild the stream forced. A sequence gap or a reconnect
     * means diffs were missed, and a level nobody has heard about since could
     * have been taken. Showing liquidity that is no longer there is the one
     * error worth clearing a book to avoid.
     */
    beginBootstrap({ keepFarBook = false } = {}) {
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING;
        this.lastUpdateId = null;
        if (!keepFarBook) {
            this.bids.clear();
            this.asks.clear();
        }
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
        // The best price can now rest outside the band: the book keeps every
        // level the stream restates, and the market can trade its way out of the
        // page that was read. When it has, the band describes somewhere the
        // market no longer is, and the rows around the market are proven by
        // nothing — whatever arithmetic its edges would satisfy.
        if (!this.band.contains(bid) || !this.band.contains(ask)) return false;
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
        // Traded clean out of the page: no room left to measure, only a band the
        // market has left behind.
        if (!this.band.contains(bid) || !this.band.contains(ask)) return false;
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

    /**
     * How far the book on hand reaches past the best price on each side.
     *
     * Not the band: the band is the stretch every level of which is accounted
     * for, and the book reaches past it by whatever the stream has restated.
     * That difference is the whole book, near enough — measured 2026-08-13, the
     * levels inside one page hold 7% to 18% of the resting value of a contract.
     */
    reachOfBook() {
        const edge = (side, descending) => {
            const best = bestPrice(side, descending);
            const furthest = bestPrice(side, !descending);
            if (best === null || furthest === null) return null;
            return descending
                ? subtractFuturesWorkstationDecimals(best, furthest)
                : subtractFuturesWorkstationDecimals(furthest, best);
        };
        const below = edge(this.bids, true);
        const above = edge(this.asks, false);
        if (below === null || above === null) return null;
        return Object.freeze({ below, above });
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
        // The snapshot is the whole truth inside its own band, so a level carried
        // over from before that the snapshot does not name has been taken, and
        // goes. Outside the band it says nothing, and what is there stays.
        if (this.band !== null) {
            const named = new Set([
                ...snapshot.bids.map(([price]) => price),
                ...snapshot.asks.map(([price]) => price),
            ]);
            for (const side of [this.bids, this.asks]) {
                for (const price of side.keys()) {
                    if (this.band.contains(price) && !named.has(price)) side.delete(price);
                }
            }
        }
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
        applyLevels(this.bids, delta.bids);
        applyLevels(this.asks, delta.asks);
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
     * How far past the best price the book is *accounted for* on each side —
     * the stretch inside which every resting level is named, rather than only
     * the ones the stream has restated since the page was read.
     *
     * Measured from where the market is now, not from where it was when the
     * page was bought: the band is a pair of fixed prices and the market moves
     * inside it, so the room left below the floor is what the operator can still
     * read as complete. A market that has traded clean out of its band accounts
     * for nothing, and says so.
     *
     * Distinct from `reachOfBook` in exactly the way the two facts are distinct:
     * that one is how far the book reaches, this one is how far it can be
     * trusted to be whole, and the rows between them may understate.
     */
    provenReach() {
        if (this.band === null) return null;
        const bid = bestPrice(this.bids, true);
        const ask = bestPrice(this.asks, false);
        if (bid === null || ask === null) return null;
        if (!this.band.contains(bid) || !this.band.contains(ask)) return null;
        return Object.freeze({
            below: subtractFuturesWorkstationDecimals(bid, this.band.floor),
            above: subtractFuturesWorkstationDecimals(this.band.ceiling, ask),
        });
    }

    /**
     * The book as the renderer draws it: the rows the panel said it draws,
     * grouped by the step the panel said it groups by.
     *
     * The grouping is the whole of the delivery. Everything the snapshot bought
     * and everything the stream has restated since is still held, so a coarser
     * step or a taller panel is answered from the book in hand rather than by
     * another read — and answered over the *whole* book, which is the point:
     * the far rows are filled from levels a nearest-first level count used to
     * drop before they ever reached the wire.
     *
     * A step that has not been stated yet, or one that cannot be read as a
     * distance, is the ungrouped reading — the book as the exchange sent it,
     * level by level, with no alignment pass at all. That matters on a contract
     * whose quoted prices disagree with its own tick filter: aligning there
     * would merge two real levels into a price neither of them rests at.
     */
    toRendererRows({ step = null, rows = null, atDeepestPage = false } = {}) {
        if (this.phase !== FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE
            || this.lastUpdateId === null) return null;
        const ceiling = FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RENDERER_ROWS_PER_SIDE;
        const drawn = Number.isSafeInteger(rows) && rows > 0
            ? Math.min(rows, ceiling)
            : ceiling;
        const grouped = isFuturesWorkstationDecimal(step)
            && isPositiveFuturesWorkstationDecimal(step)
            ? step
            : null;
        const bids = groupSide(this.bids, true, grouped, drawn);
        const asks = groupSide(this.asks, false, grouped, drawn);
        return Object.freeze({
            lastUpdateId: this.lastUpdateId.toString(),
            // The step these rows were actually grouped by, which is not always
            // the step the panel last chose: a reading is stated and answered a
            // frame later, and in between the rows on screen belong to the
            // previous one. The panel matches a working order to its row by
            // computing the order's bucket key, and computing it at a step the
            // rows were not built with puts every mark on the wrong row — or on
            // none. So the delivery names the step it used, and the panel keys
            // off that rather than off what it has asked for.
            step: grouped,
            bids: bids.rows,
            asks: asks.rows,
            // The real distance between the two best prices, taken from the
            // levels rather than from the rows above them. A row prints the
            // boundary of its bucket — bids rounded down, asks rounded up — so a
            // spread measured between the first two rows is wider than the
            // market's by up to two steps, and widens further the more the
            // operator zooms out. The one number on the panel that must not move
            // when the step does.
            spread: bids.best && asks.best
                ? subtractFuturesWorkstationDecimals(asks.best, bids.best)
                : '0',
            // How far the book on hand reaches past the best price on each side —
            // where the book ends, not where the rows do. The panel cannot work
            // it out from what it was sent: it would only measure its own step
            // back.
            //
            // Measured over the levels actually held rather than over the band:
            // the band is the stretch that is *complete*, and past it the book
            // holds everything the stream has restated since — most of it, by
            // value, on every contract measured.
            //
            // Stated only once no deeper page can be bought. Before then a wider
            // near book is one read away, and a ladder cut here would stop the
            // operator selecting the step that buys it.
            reach: atDeepestPage ? this.reachOfBook() : null,
            // And where inside that reach the book stops being whole, so the
            // panel can mark the rows that may understate instead of the
            // operator having to know which they are.
            proven: this.provenReach(),
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
