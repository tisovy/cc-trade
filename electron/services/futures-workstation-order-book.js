import {
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
    // How much of the book is kept: all of it. Every level the exchange states
    // is held until the exchange states it gone (2026-09-03 — the operator's
    // rule: «хранить ВСЁ, показывать только то, что указано в интерфейсе»).
    // What a page proves is recorded (`band`), what a delivery costs is bounded
    // by the rows it draws, and nothing is evicted. A retention ceiling of ten
    // thousand a side stood here from 2026-08-14 to bound a per-delivery sort of
    // the whole side; the side now keeps its own order and the sort is gone.
    //
    // Measured 2026-08-14, levels a side, still climbing at ten minutes:
    //
    //           1 min   3 min   5 min   10 min
    //   AKEUSDT  1658    2403    4017     6197
    //   BTCUSDT  1580    2689    4157     6270
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
const PARSED_PRICE_CACHE_FLOOR = 8_192;

// A side of the book, which remembers what its own prices parse to. One cache
// per side rather than one for the desk, so a contract nobody is looking at
// cannot push the shown one's prices out of it.
class FuturesWorkstationBookSide extends Map {
    constructor(descending = false) {
        super();
        this.descending = descending === true;
        this.parsed = new Map();
        this.parsedBound = PARSED_PRICE_CACHE_FLOOR;
        // The side in price order, best first, kept as levels come and go:
        // a new price is placed by binary search, a removed one spliced out,
        // a quantity change touches nothing here. Delivery walks it from the
        // best and stops at the rows it draws, so a side of twenty thousand
        // levels costs a delivery what a side of forty does. The whole side
        // used to be sorted for every delivery, which is what a retention
        // ceiling was bounding — and the ceiling is gone (2026-09-03): the
        // book keeps every level the exchange states.
        this.sorted = [];
    }

    set(price, quantity) {
        const held = super.has(price);
        super.set(price, quantity);
        if (!held) this.placeSorted(price);
        return this;
    }

    delete(price) {
        const removed = super.delete(price);
        if (removed) this.removeSorted(price);
        return removed;
    }

    clear() {
        super.clear();
        this.sorted = [];
    }

    // Where a price belongs in the side's order. Best first: the largest bid,
    // the smallest ask.
    placeSorted(price) {
        const decimal = this.decimalOf(price);
        let low = 0;
        let high = this.sorted.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            const comparison = compareParsedDecimals(this.sorted[mid].decimal, decimal);
            const before = this.descending ? comparison > 0 : comparison < 0;
            if (before) low = mid + 1;
            else high = mid;
        }
        this.sorted.splice(low, 0, Object.freeze({ price, decimal }));
    }

    removeSorted(price) {
        const decimal = this.decimalOf(price);
        let low = 0;
        let high = this.sorted.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            const comparison = compareParsedDecimals(this.sorted[mid].decimal, decimal);
            if (comparison === 0) {
                this.sorted.splice(mid, 1);
                return;
            }
            const before = this.descending ? comparison > 0 : comparison < 0;
            if (before) low = mid + 1;
            else high = mid;
        }
    }

    bestPrice() {
        return this.sorted.length === 0 ? null : this.sorted[0].price;
    }

    decimalOf(price) {
        const remembered = this.parsed.get(price);
        if (remembered !== undefined) return remembered;
        const decimal = parseFuturesWorkstationDecimal(price);
        if (this.parsed.size >= this.parsedBound) this.forgetPricesNotHeld();
        this.parsed.set(price, decimal);
        return decimal;
    }

    // Prices leave the book as the market walks, and what they parsed to would
    // otherwise be remembered for the life of the session. Dropping only what
    // the side no longer holds keeps the levels that are about to be walked
    // again, where emptying the whole cache would make the next frame re-parse
    // the entire book.
    forgetPricesNotHeld() {
        for (const price of this.parsed.keys()) {
            if (!this.has(price)) this.parsed.delete(price);
        }
        // Still full of prices the book is actually holding: the side has
        // outgrown the bound, and it is the bound that gives — the book keeps
        // every level the exchange states, so the cache follows the book.
        if (this.parsed.size >= this.parsedBound) {
            this.parsedBound = (this.size * PARSED_PRICE_CACHE_SLACK) + PARSED_PRICE_CACHE_FLOOR;
        }
    }
}

// The same levels, yielded rather than materialized: the grouping stops one
// row past the panel's count, so a delivery walks a few dozen levels of a side
// that may hold twenty thousand.
function* levelsBestFirst(side) {
    for (const entry of side.sorted) {
        yield { price: entry.price, quantity: side.get(entry.price) };
    }
}

// How many levels rest at or beyond the opposite side's best — the evidence
// a crossed book leaves for the record. Walked from the best inward and
// stopped at the first level that does not cross, so it costs what it counts.
const countCrossedLevels = (side, opposite) => {
    const against = opposite.sorted[0]?.decimal;
    if (against === undefined) return 0;
    let crossed = 0;
    for (const entry of side.sorted) {
        const comparison = compareParsedDecimals(entry.decimal, against);
        const crosses = side.descending ? comparison >= 0 : comparison <= 0;
        if (!crosses) break;
        crossed += 1;
    }
    return crossed;
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
        // Where the snapshot says the market is. A level carried over from before
        // that rests on the wrong side of this has been taken: a bid at or above
        // the best ask would have matched rather than rested.
        bestBid,
        bestAsk,
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
const bestPrice = side => side.bestPrice();

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
 *
 * Each row also states whether it is whole: whether every price it could be
 * holding was named by the page the band was read from. Inside the band the
 * exchange named every resting level, so a row there is the market. Outside it
 * the row holds what the stream has restated since — exact for each level it
 * names, and silent about levels nobody has touched — so it can only understate.
 * The operator sizes a breakout against the far rows, and a row that may
 * understate is a different thing to size against than one that cannot.
 *
 * A bucket is judged by its far edge, which is the price it prints: bids round
 * down and asks round up, so the printed price is the end of the bucket furthest
 * from the market in both cases. A bucket straddling the edge of the band is
 * counted as not whole, because part of it is not.
 */
// How far out the book still has substance, as a share of the levels a side
// holds. The reading it produces is what the grouping ladder is cut against, so
// it decides how far the operator can zoom out and still see rows with something
// in them.
//
// Not the furthest level. Measured on 2026-08-14 over five minutes of stream,
// the furthest level is an outlier on every contract looked at, and not by a
// little: AKEUSDT's furthest ask stood at 1 357 378% of price while the
// hundredth of the side behind it stood at 145%, and BTCUSDT's furthest bid at
// 99% against 10%. Cutting the ladder against one absurd resting order offers a
// step whose rows span most of a market that has nothing in it — which is the
// blank far rows this whole change exists to remove, arriving through the other
// door.
//
// A hundredth of a side is a few dozen levels on a real book. What is given up
// is the ability to zoom out far enough to see them; what is bought is that
// every row of every step the ladder offers has book behind it.
//
// Expressed as levels dropped rather than as an index into the side, so a short
// book keeps its whole span: a hundredth of two levels is none of them, and a
// side with nothing to trim is measured to its edge exactly as before.
const FUTURES_WORKSTATION_BOOK_OUTLIER_SHARE = 0.01;

const reachOfEntries = (entries, descending) => {
    if (entries.length === 0) return null;
    const best = entries[0].price;
    const dropped = Math.floor(entries.length * FUTURES_WORKSTATION_BOOK_OUTLIER_SHARE);
    const far = entries[entries.length - 1 - dropped].price;
    return descending
        ? subtractFuturesWorkstationDecimals(best, far)
        : subtractFuturesWorkstationDecimals(far, best);
};

const groupSide = (side, step, rows, band) => {
    const { descending } = side;
    return {
        best: side.bestPrice(),
        reach: reachOfEntries(side.sorted, descending),
        rows: Object.freeze(groupFuturesBookLevels({
            levels: levelsBestFirst(side),
            side: descending ? 'bid' : 'ask',
            step,
            limit: rows,
        }).map(row => Object.freeze({
            price: row.price,
            quantity: row.quantity,
            value: row.value,
            groupKey: row.groupKey,
            whole: band !== null && band.contains(row.price),
        }))),
    };
};

export class FuturesWorkstationOrderBook {
    constructor() {
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING;
        this.lastUpdateId = null;
        this.bids = new FuturesWorkstationBookSide(true);
        this.asks = new FuturesWorkstationBookSide(false);
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
     * Every rebuild is one the stream forced — a sequence gap, a crossed book,
     * a reconnect — since the desk stopped re-reading pages of its own accord
     * (2026-09-03). Diffs were missed, and a level nobody has heard about since
     * could have been taken: showing liquidity that is no longer there is the
     * one error worth clearing a book to avoid, so the book starts again from
     * the page the snapshot names and the stream fills it back in.
     */
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
     * How far the book on hand reaches past the best price on each side.
     *
     * Not the band: the band is the stretch every level of which is accounted
     * for, and the book reaches past it by whatever the stream has restated.
     * That difference is the whole book, near enough — measured 2026-08-13, the
     * levels inside one page hold 7% to 18% of the resting value of a contract.
     *
     * Built from the sides already sorted for the rows, so it costs nothing.
     */
    reachOfBook() {
        const below = reachOfEntries(this.bids.sorted, true);
        const above = reachOfEntries(this.asks.sorted, false);
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

        // What the page proves — the stretch every level of which the snapshot
        // named — is recorded for the rows to say whether they are whole. It
        // drives no read: the book is built from this one page and then from
        // the stream (2026-09-03).
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
        // The identity the book stood at before this diff, kept for the
        // evidence a crossing leaves: `lastUpdateId` is the book's, the other
        // three are the diff's, and written from the diff's final id they
        // were one number stated twice (2026-09-03).
        const before = this.lastUpdateId;
        applyLevels(this.bids, delta.bids);
        applyLevels(this.asks, delta.asks);
        this.lastUpdateId = delta.finalUpdateIdBigInt;
        const bestBid = bestPrice(this.bids);
        const bestAsk = bestPrice(this.asks);
        if (bestBid && bestAsk && compareFuturesWorkstationDecimals(bestBid, bestAsk) >= 0) {
            this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
            // A correctly chained diff cannot cross the exchange's own book, so
            // a crossing is evidence of something else — a level the book should
            // have dropped, or a diff the exchange should not have sent. The
            // refusal carries what the record needs to read it: the identities
            // and how many levels stand across the market. Identities and
            // counts only, never a price. On 2026-09-02 a hundred crossings were
            // recorded with nothing to read them by.
            const error = new FuturesWorkstationOrderBookError('CROSSED_ORDER_BOOK');
            error.evidence = Object.freeze({
                lastUpdateId: before === null || before === undefined ? null : before.toString(),
                firstUpdateId: delta.firstUpdateId,
                finalUpdateId: delta.finalUpdateId,
                previousFinalUpdateId: delta.previousFinalUpdateId,
                crossedLevels: countCrossedLevels(this.bids, this.asks)
                    + countCrossedLevels(this.asks, this.bids),
            });
            throw error;
        }
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
    toRendererRows({ step = null, rows = null } = {}) {
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
        const bids = groupSide(this.bids, grouped, drawn, this.band);
        const asks = groupSide(this.asks, grouped, drawn, this.band);
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
            // How far the book on hand still has levels past the best price on
            // each side — where the book runs out, not where the rows do. The
            // panel cannot work it out from what it was sent: it would only
            // measure its own step back.
            //
            // Measured over the levels held rather than over the band: the band
            // is the stretch that is *complete*, and past it the book holds
            // everything the stream has restated since — most of it, by value,
            // on every contract measured. And measured past the furthest
            // hundredth of each side, because the very furthest level is one
            // resting order nobody trades against. See `reachOfEntries`.
            //
            // Stated on every delivery: there is no deeper page to wait for,
            // and the book the desk holds is the book the ladder is cut against.
            reach: bids.reach !== null && asks.reach !== null
                ? Object.freeze({ below: bids.reach, above: asks.reach })
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
