import { describe, expect, it } from 'vitest';
import {
    FUTURES_WORKSTATION_ORDER_BOOK_LIMITS,
    FUTURES_WORKSTATION_ORDER_BOOK_PHASES,
    FuturesWorkstationOrderBook,
    FuturesWorkstationOrderBookError,
} from './futures-workstation-order-book.js';
import {
    FUTURES_WORKSTATION_EVENT_MAX_BYTES,
} from '../../src/utils/futuresWorkstationProtocolShared.js';
import {
    futuresBookGroupKey,
    groupFuturesBookLevels,
} from '../../src/utils/futuresOrderBook.js';
import {
    compareFuturesWorkstationDecimals,
    normalizeFuturesWorkstationDecimal,
} from './futures-workstation-decimal.js';

const snapshot = (overrides = {}) => ({
    lastUpdateId: '100',
    bids: [['10.00', '2.0'], ['9.00', '3.0']],
    asks: [['11.00', '4.0'], ['12.00', '5.0']],
    ...overrides,
});

const delta = (overrides = {}) => ({
    firstUpdateId: '100',
    finalUpdateId: '101',
    previousFinalUpdateId: '99',
    bids: [['10.00', '2.5']],
    asks: [['11.00', '3.5']],
    eventTime: 1_784_000_000_000,
    ...overrides,
});

const liveBook = () => {
    const book = new FuturesWorkstationOrderBook();
    book.push(delta(), 200);
    expect(book.bootstrap(snapshot()).live).toBe(true);
    return book;
};

const bookFromLevels = (bids, asks) => {
    const book = new FuturesWorkstationOrderBook();
    expect(book.bootstrap(snapshot({ bids, asks })).live).toBe(true);
    return book;
};

describe('authoritative Futures local order book', () => {
    it('buffers before snapshot and exposes a bounded live view', () => {
        const book = liveBook();
        const view = book.toRendererRows();
        expect(book.phase).toBe(FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE);
        expect(view.lastUpdateId).toBe('101');
        expect(view.bids[0].price).toBe('10');
        expect(view.bids[0].quantity).toBe('2.5');
        expect(view.bids[1].price).toBe('9');
        expect(view.bids[1].quantity).toBe('3');
        expect(view.asks[0].price).toBe('11');
        expect(view.asks[0].quantity).toBe('3.5');
        expect(view.spread).toBe('1');
    });

    it('ignores buffered deltas entirely behind the snapshot', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ firstUpdateId: '90', finalUpdateId: '99' }), 100);
        book.push(delta(), 100);
        expect(book.bootstrap(snapshot()).live).toBe(true);
        expect(book.toRendererRows().lastUpdateId).toBe('101');
    });

    // A contract nobody is trading publishes no diff at all — the stream carries
    // only what changed — so there is nothing to bridge with and never will be.
    // The snapshot is not stale in that case; it is the book.
    it('goes live on a snapshot no diff has contradicted', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.bootstrap(snapshot())).toEqual({ live: true, reason: 'bootstrapped' });
        expect(book.toRendererRows().lastUpdateId).toBe('100');
        expect(book.toRendererRows().bids[0].price).toBe('10');
        expect(book.toRendererRows().bids[0].quantity).toBe('2');
    });

    it('pays the owed bridge with a first diff that spans the snapshot', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.bootstrap(snapshot()).live).toBe(true);
        // `pu` names a diff this book never saw, and that is expected: it is the
        // one the exchange published before the snapshot was taken.
        expect(book.push(delta({ firstUpdateId: '99', previousFinalUpdateId: '98' }), 100))
            .toEqual({ applied: true, reason: 'live' });
        expect(book.toRendererRows().lastUpdateId).toBe('101');
    });

    it('pays the owed bridge with a first diff that continues from the snapshot', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.bootstrap(snapshot()).live).toBe(true);
        expect(book.push(delta({
            firstUpdateId: '101',
            finalUpdateId: '101',
            previousFinalUpdateId: '100',
        }), 100)).toEqual({ applied: true, reason: 'live' });
        expect(book.toRendererRows().lastUpdateId).toBe('101');
    });

    it('owes the bridge only once', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.bootstrap(snapshot()).live).toBe(true);
        expect(book.push(delta({ firstUpdateId: '99', previousFinalUpdateId: '98' }), 100).applied)
            .toBe(true);
        expect(book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '77',
        }), 100)).toEqual({ applied: false, reason: 'gap', resync: true });
    });

    it('asks for a rebuild when the first diff begins beyond the quiet snapshot', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.bootstrap(snapshot()).live).toBe(true);
        expect(book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
        }), 100)).toEqual({ applied: false, reason: 'gap', resync: true });
        expect(book.toRendererRows()).toBeNull();
    });

    // A re-bootstrap empties the buffer while the socket keeps running, so
    // "nothing buffered" would otherwise re-admit a snapshot a diff already read
    // has proven stale.
    it('refuses a quiet snapshot behind a diff it has already seen', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ firstUpdateId: '101', finalUpdateId: '102' }), 100);
        expect(book.bootstrap(snapshot()).live).toBe(false);
        book.beginBootstrap();
        expect(book.bootstrap(snapshot())).toEqual({
            live: false,
            reason: 'snapshot-not-bridged',
            resync: true,
        });
    });

    it('requires the first buffered event to bridge lastUpdateId', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ firstUpdateId: '101', finalUpdateId: '102' }), 100);
        expect(book.bootstrap(snapshot())).toEqual({
            live: false,
            reason: 'snapshot-not-bridged',
            resync: true,
        });
        expect(book.phase).toBe(FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED);
    });

    it('rejects a future buffered event even when a later reordered event bridges the snapshot', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '102',
            previousFinalUpdateId: '101',
        }), 100);
        book.push(delta(), 100);
        expect(book.bootstrap(snapshot())).toEqual({
            live: false,
            reason: 'snapshot-not-bridged',
            resync: true,
        });
        expect(book.toRendererRows()).toBeNull();
    });

    it('ignores a duplicate inside the bootstrap buffer before checking pu continuity', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta(), 100);
        book.push(delta({ previousFinalUpdateId: '77' }), 100);
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '102',
            previousFinalUpdateId: '101',
        }), 100);
        expect(book.bootstrap(snapshot()).live).toBe(true);
        expect(book.toRendererRows().lastUpdateId).toBe('102');
    });

    it('requires pu continuity while replaying the bootstrap buffer', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta(), 100);
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '102',
            previousFinalUpdateId: '77',
        }), 100);
        expect(book.bootstrap(snapshot())).toEqual({
            live: false,
            reason: 'buffer-gap',
            resync: true,
        });
    });

    it('ignores a fully duplicate live update idempotently', () => {
        const book = liveBook();
        expect(book.push(delta(), 100)).toEqual({ applied: false, reason: 'duplicate' });
        expect(book.phase).toBe(FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE);
    });

    it('detects a live update-ID gap and refuses further display', () => {
        const book = liveBook();
        expect(book.push(delta({
            firstUpdateId: '103',
            finalUpdateId: '103',
            previousFinalUpdateId: '102',
        }), 100)).toEqual({ applied: false, reason: 'gap', resync: true });
        expect(book.toRendererRows()).toBeNull();
    });

    it('applies absolute quantities and accepts deletion of an absent level', () => {
        const book = liveBook();
        expect(book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '102',
            previousFinalUpdateId: '101',
            bids: [['10.00', '0'], ['8.00', '0']],
            asks: [],
        }), 100).applied).toBe(true);
        expect(book.toRendererRows().bids.map(level => level.price)).toEqual(['9']);
    });

    it('rejects reordered update ranges', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(() => book.push(delta({ firstUpdateId: '102', finalUpdateId: '101' }), 100))
            .toThrow(FuturesWorkstationOrderBookError);
    });

    it('rejects leading-zero and negative update identities', () => {
        for (const finalUpdateId of ['0101', '-1', '1.0']) {
            const book = new FuturesWorkstationOrderBook();
            expect(() => book.push(delta({ finalUpdateId }), 100))
                .toThrow(FuturesWorkstationOrderBookError);
        }
    });

    it('preserves and compares update IDs beyond 2^53', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({
            firstUpdateId: '9007199254740993',
            finalUpdateId: '9007199254740994',
            previousFinalUpdateId: '9007199254740992',
        }), 100);
        expect(book.bootstrap(snapshot({ lastUpdateId: '9007199254740993' })).live).toBe(true);
        expect(book.toRendererRows().lastUpdateId).toBe('9007199254740994');
    });

    it('rejects update IDs outside unsigned int64', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(() => book.push(delta({ finalUpdateId: '18446744073709551616' }), 100))
            .toThrowError(expect.objectContaining({ code: 'INVALID_UPDATE_ID' }));
    });

    it('fails closed on a crossed book', () => {
        const book = liveBook();
        expect(() => book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '102',
            previousFinalUpdateId: '101',
            bids: [['12', '1']],
            asks: [],
        }), 100)).toThrowError(expect.objectContaining({ code: 'CROSSED_ORDER_BOOK' }));
        expect(book.phase).toBe(FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED);
    });

    it('rejects numerically duplicate price strings', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(() => book.push(delta({ bids: [['10.0', '1'], ['10.00', '2']] }), 100))
            .toThrowError(expect.objectContaining({ code: 'DUPLICATE_DEPTH_PRICE' }));
    });

    it('bounds buffered event count', () => {
        const book = new FuturesWorkstationOrderBook();
        for (let index = 0; index < FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.BUFFERED_EVENTS; index += 1) {
            expect(book.push(delta(), 1).reason).toBe('buffered');
        }
        expect(book.push(delta(), 1)).toEqual({ applied: false, reason: 'overflow', resync: true });
        expect(book.buffer).toHaveLength(0);
    });

    it('bounds buffered bytes independently of event count', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.push(delta(), FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.BUFFERED_BYTES).reason)
            .toBe('buffered');
        expect(book.push(delta(), 1).resync).toBe(true);
    });

    // The snapshot is already the retained size, so the book only outgrows its
    // bound the way it does live: diffs quoting levels beyond the snapshot's
    // window. What is dropped must be the far end, never the tradable top.
    it('emits the renderer window per side and keeps what a diff adds beyond the page', () => {
        const { SNAPSHOT_LEVELS_PER_SIDE } = FUTURES_WORKSTATION_ORDER_BOOK_LIMITS;
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ bids: [], asks: [] }), 1);
        expect(book.bootstrap(snapshot({
            bids: Array.from({ length: SNAPSHOT_LEVELS_PER_SIDE },
                (_, index) => [`${100000 - index}.01`, '1']),
            asks: Array.from({ length: SNAPSHOT_LEVELS_PER_SIDE },
                (_, index) => [`${100001 + index}.01`, '1']),
        })).live).toBe(true);
        expect(book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '102',
            previousFinalUpdateId: '101',
            bids: Array.from({ length: 100 }, (_, index) => [`${99000 - index}.01`, '1']),
            asks: Array.from({ length: 100 }, (_, index) => [`${101001 + index}.01`, '1']),
        }), 1).applied).toBe(true);
        // A hundred levels a side beyond the page the snapshot proved. They are
        // the far book, and they are kept.
        expect(book.bids.size).toBe(SNAPSHOT_LEVELS_PER_SIDE + 100);
        expect(book.asks.size).toBe(SNAPSHOT_LEVELS_PER_SIDE + 100);
        // And the delivery reaches them, which is the whole of the change: read
        // at a step wide enough to hold a hundred of the old page's levels in a
        // row, the far levels the stream added fill rows of their own instead of
        // being dropped for being the thousand-and-first nearest.
        const view = book.toRendererRows({ step: '100', rows: 14 });
        expect(view.bids[0].price).toBe('100000');
        expect(view.asks[0].price).toBe('100100');
        // The page alone spans eleven buckets a side at this step. The far levels
        // the stream added open a twelfth, and it is drawn — the row that used to
        // be blank because those levels were the thousand-and-first nearest.
        expect(view.bids).toHaveLength(12);
        expect(view.asks).toHaveLength(12);
        expect(view.bids.at(-1).price).toBe('98900');
        expect(view.asks.at(-1).price).toBe('101200');
    });

    // The delivered book is the largest frame the desk sends. If it outgrows the
    // protocol's byte ceiling the service throws OUTBOUND_FRAME_TOO_LARGE and the
    // book stops updating entirely, so the two bounds are asserted together.
    it('keeps a full delivered book inside the protocol frame ceiling', () => {
        const side = count => Array.from({ length: count }, (_, index) => [
            `${(900000 - index) / 10000}`,
            '184467440737.09551615',
        ]);
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ bids: [], asks: [] }), 1);
        book.bootstrap(snapshot({
            bids: side(FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.SNAPSHOT_LEVELS_PER_SIDE),
            asks: Array.from({ length: FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.SNAPSHOT_LEVELS_PER_SIDE },
                (_, index) => [`${(900001 + index) / 10000}`, '184467440737.09551615']),
        }));
        const bytes = Buffer.byteLength(JSON.stringify(book.toRendererRows()), 'utf8');
        expect(bytes).toBeLessThanOrEqual(FUTURES_WORKSTATION_EVENT_MAX_BYTES);
    });

    it('sorts high-precision prices without Number coercion', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ bids: [], asks: [] }), 1);
        expect(book.bootstrap(snapshot({
            bids: [['9007199254740993.0001', '1'], ['9007199254740993.0002', '1']],
            asks: [['9007199254740993.0003', '1']],
        })).live).toBe(true);
        expect(book.toRendererRows().bids[0].price).toBe('9007199254740993.0002');
    });

    it('tears down idempotently and rejects later mutation', () => {
        const book = liveBook();
        book.stop();
        book.stop();
        expect(book.push(delta(), 100)).toEqual({ applied: false, reason: 'stopped' });
        expect(book.toRendererRows()).toBeNull();
    });
});

// A snapshot proves a stretch of price. Inside it the book is exact; outside it
// the book knows only the levels a diff happened to touch, and a grouped row
// drawn across those holes understates the market. That is why the desk can buy
// fifty levels for weight 2 instead of a thousand for 20 — as long as it keeps
// to what it proved.
describe('the band a snapshot proves', () => {
    const banded = () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta(), 200);
        book.bootstrap(snapshot());
        return book;
    };

    // The exchange named the price and the quantity; that is exact wherever it
    // rests. Refusing it does not avoid understating the market — an absent row
    // understates by all of it — and refusing it cost between 82% and 93% of the
    // resting value of a real book, measured 2026-08-13.
    it('keeps a level beyond what the snapshot covered', () => {
        const book = banded();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [['8.00', '7.0'], ['9.50', '1.5']],
            asks: [['13.00', '9.0'], ['11.50', '2.5']],
        }), 200);
        const view = book.toRendererRows();
        expect(view.bids.map(row => row.price)).toEqual(['10', '9.5', '9', '8']);
        expect(view.asks.map(row => row.price)).toEqual(['11', '11.5', '12', '13']);
    });

    // What the band still marks: inside it every level is accounted for, outside
    // it the book holds what the stream has said and is silent about the rest.
    // The band itself is unchanged by a level landing beyond it.
    it('does not widen the band it can account for by drawing past it', () => {
        const book = banded();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [['8.00', '7.0']],
            asks: [['13.00', '9.0']],
        }), 200);
        expect(book.band.floor).toBe('9');
        expect(book.band.ceiling).toBe('12');
    });

    // Forgetting a level is never a lie: a removal is applied wherever it lands.
    it('applies a removal outside the band', () => {
        const book = banded();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [['9.00', '0']],
            asks: [],
        }), 200);
        expect(book.toRendererRows().bids.map(row => row.price)).toEqual(['10']);
    });

    it('says whether it still reaches as far as the rows on screen', () => {
        const book = banded();
        // Best bid 10, best ask 11; the band runs 9 to 12.
        expect(book.coversRange('1')).toBe(true);
        expect(book.coversRange('1.5')).toBe(false);
        // No range asked for is nothing to fall short of.
        expect(book.coversRange('0')).toBe(true);
    });

    // A ratio rather than a verdict, so a step three sizes coarser buys the page
    // it needs in one read instead of climbing to it one read at a time.
    it('states how many times deeper it would have to be', () => {
        const book = banded();
        expect(book.rangeShortfall('1')).toBe(0);
        // Each side proved one unit of price past its best; rows reaching six
        // need six times the page that proved it.
        expect(book.rangeShortfall('6')).toBeCloseTo(6, 6);
    });

    // The book the operator brought back: a full ask ladder over seven bid rows,
    // badged live. Measured on the total span the two sides pay for each other —
    // a span of 2.1 against a need of 2.1 is sufficient, exactly — and the desk
    // re-reads the same page, gets the same asymmetry, and the bid side stays
    // short for the session.
    it('measures the side that falls short, not the span the two sides make', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ bids: [], asks: [] }), 200);
        expect(book.bootstrap(snapshot({
            bids: [['10.00', '2.0'], ['9.90', '3.0']],
            asks: [['10.10', '4.0'], ['12.00', '5.0']],
        })).live).toBe(true);
        expect(book.coversRange('1')).toBe(false);
        // The ask side proved 1.9 and reaches; the bid side proved 0.1 and is
        // ten times short of the reading. Ten is what has to be bought.
        expect(book.rangeShortfall('1')).toBeCloseTo(10, 6);
    });

    // A page that did reach the rows on both sides when it was read is not a
    // page too shallow — the market has walked out from between its edges, and
    // the same page read again is a band centred where the market is now. A
    // shortfall of exactly 1 is what says so: short, but not by depth.
    it('asks for the same page when the market walked out of a wide enough band', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ bids: [], asks: [] }), 200);
        expect(book.bootstrap(snapshot({
            bids: [['10.00', '2.0'], ['9.00', '3.0']],
            asks: [['10.10', '4.0'], ['11.10', '5.0']],
        })).live).toBe(true);
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [['10.80', '1.0']],
            asks: [['10.10', '0'], ['10.90', '1.0']],
        }), 200);
        // The ask side now reaches 0.2 where the rows need 1 — but the page it
        // was bought at proved 1, so there is nothing deeper worth buying.
        expect(book.coversRange('1')).toBe(false);
        expect(book.rangeShortfall('1')).toBe(1);
    });

    // A side the walk emptied states no distance to size a page against. It is
    // still a book that cannot prove its rows, so it still asks for a reading —
    // one that will have two sides to measure.
    it('asks for a fresh reading when a side states no distance at all', () => {
        const book = banded();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [['10.00', '0'], ['9.00', '0']],
            asks: [],
        }), 200);
        expect(book.rangeShortfall('1')).toBe(Number.POSITIVE_INFINITY);
    });

    // A snapshot that came back with one side empty proves no band, so the book
    // filters nothing and there is nothing the rows can fall outside of. Reading
    // the same page again would not produce a band either.
    it('is short of nothing when there is no band', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.rangeShortfall('6')).toBe(0);
    });

    // Whether the band reaches the rows and whether it still holds the market
    // are two questions. The band this book was bought with proved one unit of
    // price on each side and the market is resting in the middle of it: short of
    // rows that reach six, and in no danger of walking out of it.
    it('holds the market while the market rests inside it', () => {
        const book = banded();
        expect(book.holdsMarket()).toBe(true);
        expect(book.rangeShortfall('6')).toBeCloseTo(6, 6);
    });

    // The ask side proved one unit of price and has two tenths of it left: every
    // ask above the ceiling is being dropped, and the side is on its way to empty
    // while the bid side stays full. That is the one-sided book.
    it('does not hold a market that has taken most of one side away', () => {
        const book = banded();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [],
            asks: [['11.00', '0'], ['11.80', '1.0']],
        }), 200);
        expect(book.holdsMarket()).toBe(false);
    });

    // Not judged at the moment the room runs out: a side re-read then has already
    // been empty on screen for as long as the read takes. Three tenths of the
    // proven room left still holds; two tenths does not.
    it('turns on the share of the room the page proved, not on the room running out', () => {
        const walkedTo = (price) => {
            const book = banded();
            book.push(delta({
                firstUpdateId: '102',
                finalUpdateId: '103',
                previousFinalUpdateId: '101',
                bids: [],
                asks: [['11.00', '0'], [price, '1.0']],
            }), 200);
            return book.holdsMarket();
        };
        expect(walkedTo('11.70')).toBe(true);
        expect(walkedTo('11.80')).toBe(false);
    });

    // A snapshot that came back with a side empty proves no band, so there is no
    // room to measure and nothing a re-read on this account would produce.
    it('has no room to answer for when there is no band', () => {
        expect(new FuturesWorkstationOrderBook().holdsMarket()).toBe(true);
    });

    // Where the exchange's book ends, which the panel cannot work out from the
    // levels it was sent: the delivery is trimmed to the range the panel stated,
    // so measuring it would measure the panel's own step back.
    it('states how far its page proved, once no deeper page can be bought', () => {
        const book = banded();
        expect(book.toRendererRows().reach).toBeNull();
        expect(book.toRendererRows({ atDeepestPage: true }).reach)
            .toEqual({ below: '1', above: '1' });
    });

    // A fact about the book on hand, so it follows the book. The market walking
    // up to 11.80 leaves two tenths of ask book above it, and two tenths is what
    // the panel can draw — the ladder is kept from jumping by clamping the step
    // it draws at, not by freezing a number that has stopped being true.
    it('states the reach the book has left after the market walks toward an edge', () => {
        const book = banded();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [],
            asks: [['11.00', '0'], ['11.80', '1.0']],
        }), 200);
        expect(book.toRendererRows({ atDeepestPage: true }).reach)
            .toEqual({ below: '1', above: '0.2' });
    });

    // And it grows with the far book, which is the point: the ladder lengthens
    // as the stream names levels further out, with no rung added or moved.
    it('reaches as far as the levels the stream has restated', () => {
        const book = banded();
        expect(book.toRendererRows({ atDeepestPage: true }).reach)
            .toEqual({ below: '1', above: '1' });
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [['4.00', '7.0']],
            asks: [['30.00', '9.0']],
        }), 200);
        expect(book.toRendererRows({ atDeepestPage: true }).reach)
            .toEqual({ below: '6', above: '19' });
    });

    // A rebuild the desk asks for while the stream is still carrying is a
    // snapshot centred where the market is now. It is the whole truth inside its
    // own band and says nothing outside it, so the far book survives it — and
    // has to, or on the contracts that re-centre most, which are the ones being
    // traded, it never accumulates at all.
    it('keeps the far book across a re-centre and drops what the new band no longer names', () => {
        const book = banded();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [['4.00', '7.0']],
            asks: [['30.00', '9.0']],
        }), 200);
        book.beginBootstrap({ keepFarBook: true });
        expect(book.bootstrap({
            lastUpdateId: '200',
            bids: [['10.50', '2.0'], ['9.50', '3.0']],
            asks: [['11.50', '4.0'], ['12.50', '5.0']],
        }).live).toBe(true);
        const view = book.toRendererRows();
        // 4 and 30 are outside the new band and are still drawn. So is 9, which
        // the new page does not reach either. 10 was inside the new band and the
        // snapshot did not name it, so it has been taken.
        expect(view.bids.map(row => row.price)).toEqual(['10.5', '9.5', '9', '4']);
        expect(view.asks.map(row => row.price)).toEqual(['11.5', '12.5', '30']);
    });

    // Not for a rebuild the stream forced. A gap means diffs were missed, and a
    // level nobody has heard about since could have been taken — showing
    // liquidity that is not there is the error worth clearing a book to avoid.
    it('clears the far book for a rebuild the stream forced', () => {
        const book = banded();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [['4.00', '7.0']],
            asks: [['30.00', '9.0']],
        }), 200);
        book.beginBootstrap();
        expect(book.bids.size).toBe(0);
        expect(book.asks.size).toBe(0);
    });

    // The best price can rest outside the band now that the book keeps what the
    // stream restates. When it does, the band describes somewhere the market has
    // left, and nothing around the market is proven by it — so neither question
    // may be answered from its edges.
    it('answers neither question from a band the market has traded out of', () => {
        const book = banded();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            // Every level the page proved is taken, and the market re-forms above
            // the ceiling the page reached.
            bids: [['10.00', '0'], ['9.00', '0'], ['13.00', '1.0']],
            asks: [['11.00', '0'], ['12.00', '0'], ['14.00', '1.0']],
        }), 200);
        expect(book.coversRange('0.1')).toBe(false);
        expect(book.holdsMarket()).toBe(false);
    });

    it('forgets the band when the book is rebuilt or stopped', () => {
        const book = banded();
        expect(book.coversRange('1')).toBe(true);
        book.beginBootstrap();
        expect(book.coversRange('1')).toBe(false);
        book.stop();
        expect(book.coversRange('1')).toBe(false);
    });
});

// The panel already states how much of the book it reads — the rows on screen
// times the step they are grouped by — and the desk used that to decide which
// page to buy and then ignored it when deciding what to send. A thousand levels
// a side crossed to draw forty rows, ten times a second, and everything
// downstream of the socket is priced per level.
describe('the reading is the rows the panel draws', () => {
    const DEEP_LEVELS_PER_SIDE = 400;
    // Whole numbers a tick apart: the grouping arithmetic below is then readable
    // as prices rather than as decimal-string bookkeeping.
    const deepBook = () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ bids: [], asks: [] }), 1);
        expect(book.bootstrap(snapshot({
            bids: Array.from({ length: DEEP_LEVELS_PER_SIDE },
                (_, index) => [`${1_000_000 - index}`, '1']),
            asks: Array.from({ length: DEEP_LEVELS_PER_SIDE },
                (_, index) => [`${1_000_001 + index}`, '1']),
        })).live).toBe(true);
        return book;
    };

    it('delivers the rows asked for, grouped by the step asked for', () => {
        const view = deepBook().toRendererRows({ step: '5', rows: 14 });
        expect(view.bids).toHaveLength(14);
        expect(view.asks).toHaveLength(14);
        // Bids round their bucket down and asks round theirs up, so a row prints
        // a price its side would actually fill through.
        expect(view.bids[0].price).toBe('1000000');
        expect(view.bids.at(-1).price).toBe('999935');
        expect(view.asks[0].price).toBe('1000005');
        expect(view.asks.at(-1).price).toBe('1000070');
    });

    // Ungrouped is the book as the exchange sent it, level by level, with no
    // alignment pass at all — a contract whose quoted prices disagree with its
    // own tick filter must still draw the levels it actually has.
    it('delivers level by level when no step is stated', () => {
        const book = deepBook();
        for (const step of [undefined, null, '0', 'wide', 5]) {
            const view = book.toRendererRows({ step, rows: 14 });
            expect(view.bids).toHaveLength(14);
            expect(view.bids.map(row => row.price).slice(0, 3))
                .toEqual(['1000000', '999999', '999998']);
        }
    });

    it('delivers what the book holds when the rows reach past it', () => {
        const view = deepBook().toRendererRows({ step: '1000', rows: 14 });
        expect(view.bids.length).toBeLessThan(14);
        expect(view.bids.length).toBeGreaterThan(0);
    });

    // The bound is on a hostile request, not on an honest one. A panel states a
    // couple of dozen rows; nothing states a couple of thousand.
    it('bounds the rows at the ceiling, whatever is asked for', () => {
        const book = deepBook();
        const { RENDERER_ROWS_PER_SIDE } = FUTURES_WORKSTATION_ORDER_BOOK_LIMITS;
        for (const rows of [undefined, null, 0, -1, 1e9, RENDERER_ROWS_PER_SIDE + 1]) {
            expect(book.toRendererRows({ step: null, rows }).bids.length)
                .toBeLessThanOrEqual(RENDERER_ROWS_PER_SIDE);
        }
    });

    // The grouping is on delivery and never on what is retained, proven or
    // bridged. A coarser step is answered out of the book already in hand —
    // buying the page again would put the operator behind the market for a read.
    it('answers a wider reading from the book already held', () => {
        const book = deepBook();
        expect(book.toRendererRows({ step: '5', rows: 14 }).bids).toHaveLength(14);
        expect(book.bids.size).toBe(DEEP_LEVELS_PER_SIDE);
        expect(book.toRendererRows({ step: '20', rows: 14 }).bids).toHaveLength(14);
        expect(book.phase).toBe(FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE);
    });

    // Every row is priced by summing price × quantity over the levels inside it.
    // Multiplying the printed boundary by the summed quantity is a different and
    // wrong number: every level in the bucket rests somewhere other than its edge.
    it('prices a row over its levels rather than over its boundary', () => {
        const view = deepBook().toRendererRows({ step: '5', rows: 3 });
        // The best bid sits on a bucket boundary and is a bucket of one. The row
        // under it holds 999999 down to 999995, five levels of one unit each,
        // and prints its boundary — 999995.
        const [, second] = view.bids;
        expect(second.price).toBe('999995');
        expect(second.quantity).toBe('5');
        expect(second.value).toBe('4999985');
        // What multiplying the printed boundary by the summed quantity would
        // have said, which is ten USDT short over five levels.
        expect(second.value).not.toBe('4999975');
    });

    // A row prints its bucket, so an order resting anywhere inside the bucket
    // would never match the printed price. The key is what it matches on, and
    // the panel must compute the same one for the order that the book computed
    // for the row.
    it('carries the key the panel matches a working order by', () => {
        const step = '5';
        const view = deepBook().toRendererRows({ step, rows: 3 });
        for (const row of view.bids) {
            expect(row.groupKey).toBe(futuresBookGroupKey({ price: row.price, side: 'bid', step }));
        }
        // An order resting inside the first bucket, not on its boundary.
        // 999998 rests inside the second bucket — the best bid sits on a
        // boundary and is a bucket of one — and the printed price of that bucket
        // is 999995, which the operator's order does not equal.
        expect(futuresBookGroupKey({ price: '999998', side: 'bid', step }))
            .toBe(view.bids[1].groupKey);
    });

    it('delivers a row as price, quantity, value and key, with no running total', () => {
        const view = deepBook().toRendererRows({ step: '5', rows: 14 });
        for (const side of [view.bids, view.asks]) {
            expect(Object.keys(side[0])).toEqual(['price', 'quantity', 'value', 'groupKey']);
        }
    });

    // The spread is the one number on the panel that must not move when the step
    // does. Taken between the first two rows it would widen by up to two steps,
    // and widen further the more the operator zooms out.
    it('states the market spread rather than the distance between two buckets', () => {
        const book = deepBook();
        for (const step of [null, '5', '100']) {
            expect(book.toRendererRows({ step, rows: 14 }).spread).toBe('1');
        }
    });

    // The saving, stated as the thing that was actually wrong: the frame.
    it('is a fraction of the frame the levels were', () => {
        const { SNAPSHOT_LEVELS_PER_SIDE } = FUTURES_WORKSTATION_ORDER_BOOK_LIMITS;
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ bids: [], asks: [] }), 1);
        expect(book.bootstrap(snapshot({
            bids: Array.from({ length: SNAPSHOT_LEVELS_PER_SIDE },
                (_, index) => [`${1_000_000 - index}`, '1.123456789012345678']),
            asks: Array.from({ length: SNAPSHOT_LEVELS_PER_SIDE },
                (_, index) => [`${1_000_001 + index}`, '1.123456789012345678']),
        })).live).toBe(true);
        const bytes = view => Buffer.byteLength(JSON.stringify(view), 'utf8');
        const rows = bytes(book.toRendererRows({ step: '5', rows: 14 }));
        expect(rows * 20).toBeLessThan(bytes({
            bids: [...book.bids].map(([price, quantity]) => ({ price, quantity })),
            asks: [...book.asks].map(([price, quantity]) => ({ price, quantity })),
        }));
        expect(rows).toBeLessThan(FUTURES_WORKSTATION_EVENT_MAX_BYTES);
    });
});

describe('the far rows are filled from the levels a level count would have dropped', () => {
    // The operator's own desk, 2026-08-14, AKEUSDT on the coarsest step. Tick
    // 0.0000001, step 0.0001 — a thousand ticks, 1.34% of price — and fourteen
    // rows a side. The book on hand reached 54.96%; the delivery reached 2.6%,
    // because it was the nearest thousand levels. Three rows drew and eleven
    // were blank over a book that held levels for every one of them.
    const TICK_ATOMS = 1n;
    const STEP = '0.0001';
    const ROWS = 14;
    const price = atoms => {
        const text = String(atoms).padStart(8, '0');
        return `${text.slice(0, -7) || '0'}.${text.slice(-7)}`;
    };
    // A dense clump at the mid — a thousand levels inside the first two rows —
    // and then a sparse book reaching far past them, which is what a real
    // contract looks like and what made the panel go blank.
    // Built the way the real one is: the page buys the near thousand, and the
    // far levels arrive on the diff stream afterwards. That is exactly the split
    // the old delivery could not carry — the page fitted inside the level count
    // and everything the stream added past it was dropped on the way out.
    const BEST_ATOMS = 74_600n;
    const clumpedBook = () => {
        const bids = [];
        const asks = [];
        for (let index = 0; index < 1_000; index += 1) {
            bids.push([price(BEST_ATOMS - (BigInt(index) * TICK_ATOMS)), '1']);
            asks.push([price(BEST_ATOMS + 1n + (BigInt(index) * TICK_ATOMS)), '1']);
        }
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ bids: [], asks: [] }), 1);
        expect(book.bootstrap(snapshot({ bids, asks })).live).toBe(true);
        const farBids = [];
        const farAsks = [];
        for (let row = 1; row <= 40; row += 1) {
            const offset = BigInt(row) * 1_000n;
            farBids.push([price(BEST_ATOMS - offset), '3']);
            farAsks.push([price(BEST_ATOMS + 1n + offset), '3']);
        }
        expect(book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '102',
            previousFinalUpdateId: '101',
            bids: farBids,
            asks: farAsks,
        }), 1).applied).toBe(true);
        return book;
    };

    it('fills every row the panel draws', () => {
        const view = clumpedBook().toRendererRows({ step: STEP, rows: ROWS });
        expect(view.bids).toHaveLength(ROWS);
        expect(view.asks).toHaveLength(ROWS);
        for (const row of [...view.bids, ...view.asks]) {
            expect(Number(row.quantity)).toBeGreaterThan(0);
        }
    });

    // The defect, stated as the arithmetic that caused it. The nearest thousand
    // levels a side span ten buckets at this step — every level of the clump
    // falls inside the first row and a half — so a delivery bounded by a level
    // count carried nothing for the rows past them.
    it('reaches past the levels a nearest-first thousand would have selected', () => {
        const book = clumpedBook();
        const nearestThousand = [...book.bids]
            .map(([bidPrice, quantity]) => ({ price: bidPrice, quantity }))
            .sort((left, right) => Number(right.price) - Number(left.price))
            .slice(0, 1_000);
        const fromNearest = groupFuturesBookLevels({
            levels: nearestThousand,
            side: 'bid',
            step: STEP,
            limit: ROWS,
        });
        expect(fromNearest.length).toBeLessThan(4);
        expect(book.toRendererRows({ step: STEP, rows: ROWS }).bids).toHaveLength(ROWS);
    });

    // The rows the book builds and the rows the panel would have built from the
    // same levels are the same rows, because they are the same pass. Asserted on
    // the key as well as the price: the key is what a working order is matched
    // by, and the two sides computing it differently is a mark on the wrong row.
    it('matches what the panel grouped for itself, key for key', () => {
        const book = clumpedBook();
        const view = book.toRendererRows({ step: STEP, rows: ROWS });
        for (const [side, sideName, descending] of [
            [view.bids, 'bid', true],
            [view.asks, 'ask', false],
        ]) {
            const levels = [...(sideName === 'bid' ? book.bids : book.asks)]
                .map(([levelPrice, quantity]) => ({ price: levelPrice, quantity }))
                .sort((left, right) => (descending
                    ? Number(right.price) - Number(left.price)
                    : Number(left.price) - Number(right.price)));
            const panel = groupFuturesBookLevels({
                levels,
                side: sideName,
                step: STEP,
                limit: ROWS,
            });
            expect(side.map(row => [row.price, row.quantity, row.value, row.groupKey]))
                .toEqual(panel.map(row => [row.price, row.quantity, row.value, row.groupKey]));
        }
    });
});

describe('what the book retains', () => {
    // Past the ceiling the furthest levels go first. Evicting from the near edge
    // would drop exactly what a coarse step is read for, and the ceiling is a
    // guard against a pathological stream rather than a reading of any market —
    // measured, a whole contract's book is a few thousand levels a side.
    it('evicts from the far edge when the retained side passes its ceiling', () => {
        const { RETAINED_LEVELS_PER_SIDE, DIFF_LEVELS_PER_SIDE } = FUTURES_WORKSTATION_ORDER_BOOK_LIMITS;
        const book = bookFromLevels([['100000.0', '1']], [['100001.0', '1']]);
        let updateId = 100n;
        // Enough diffs to carry the side past the ceiling, and no more: trimming
        // holds it there, so a loop waiting for it to grow would never end.
        const rounds = Math.ceil(RETAINED_LEVELS_PER_SIDE / DIFF_LEVELS_PER_SIDE) + 1;
        for (let pushed = 0; pushed < rounds; pushed += 1) {
            const first = updateId + 1n;
            const final = updateId + 1n;
            expect(book.push(delta({
                firstUpdateId: String(first),
                finalUpdateId: String(final),
                previousFinalUpdateId: String(updateId),
                bids: Array.from({ length: DIFF_LEVELS_PER_SIDE }, (_, index) => [
                    `${99999 - (pushed * DIFF_LEVELS_PER_SIDE) - index}.0`,
                    '1',
                ]),
                asks: [],
            }), 1).applied).toBe(true);
            updateId = final;
        }
        expect(book.bids.size).toBe(RETAINED_LEVELS_PER_SIDE);
        // The best bid — the level the market is at — survived; the deepest one
        // pushed did not.
        expect(book.bids.has('100000')).toBe(true);
        expect(book.bids.has(`${99999 - (rounds * DIFF_LEVELS_PER_SIDE) + 1}`)).toBe(false);
    });

    it('keeps every level a diff adds while the retained side is under its ceiling', () => {
        const limit = FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.SNAPSHOT_LEVELS_PER_SIDE;
        const originalBids = Array.from({ length: limit }, (_, index) => [
            `${100_000 - index}.0`,
            '1',
        ]);
        const originalAsks = Array.from({ length: limit }, (_, index) => [
            `${100_001 + index}.0`,
            '1',
        ]);
        const addedBids = Array.from({ length: 100 }, (_, index) => [
            `${99_999 - index}.5`,
            '2',
        ]);
        const addedAsks = Array.from({ length: 100 }, (_, index) => [
            `${100_001 + index}.5`,
            '2',
        ]);
        const book = bookFromLevels(originalBids, originalAsks);
        expect(book.push(delta({
            firstUpdateId: '101',
            finalUpdateId: '101',
            previousFinalUpdateId: '100',
            bids: addedBids,
            asks: addedAsks,
        }), 1).applied).toBe(true);

        const ordered = (levels, descending) => levels
            .map(([price]) => normalizeFuturesWorkstationDecimal(price))
            .sort((left, right) => {
                const comparison = compareFuturesWorkstationDecimals(left, right);
                return descending ? -comparison : comparison;
            });
        const actualBids = Array.from(book.bids.keys()).sort(
            (left, right) => -compareFuturesWorkstationDecimals(left, right),
        );
        const actualAsks = Array.from(book.asks.keys()).sort(compareFuturesWorkstationDecimals);
        expect(actualBids).toEqual(ordered([...originalBids, ...addedBids], true));
        expect(actualAsks).toEqual(ordered([...originalAsks, ...addedAsks], false));
        expect(actualBids.length).toBe(limit + addedBids.length);
    });
});
