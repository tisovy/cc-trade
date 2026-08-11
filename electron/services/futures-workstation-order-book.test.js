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

describe('authoritative Futures local order book', () => {
    it('buffers before snapshot and exposes a bounded cumulative live view', () => {
        const book = liveBook();
        const view = book.toRendererView();
        expect(book.phase).toBe(FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE);
        expect(view.lastUpdateId).toBe('101');
        expect(view.bids[0]).toEqual({ price: '10', quantity: '2.5', total: '2.5' });
        expect(view.bids[1].total).toBe('5.5');
        expect(view.asks[0]).toEqual({ price: '11', quantity: '3.5', total: '3.5' });
        expect(view.spread).toBe('1');
    });

    it('ignores buffered deltas entirely behind the snapshot', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ firstUpdateId: '90', finalUpdateId: '99' }), 100);
        book.push(delta(), 100);
        expect(book.bootstrap(snapshot()).live).toBe(true);
        expect(book.toRendererView().lastUpdateId).toBe('101');
    });

    // A contract nobody is trading publishes no diff at all — the stream carries
    // only what changed — so there is nothing to bridge with and never will be.
    // The snapshot is not stale in that case; it is the book.
    it('goes live on a snapshot no diff has contradicted', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.bootstrap(snapshot())).toEqual({ live: true, reason: 'bootstrapped' });
        expect(book.toRendererView().lastUpdateId).toBe('100');
        expect(book.toRendererView().bids[0]).toEqual({ price: '10', quantity: '2', total: '2' });
    });

    it('pays the owed bridge with a first diff that spans the snapshot', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.bootstrap(snapshot()).live).toBe(true);
        // `pu` names a diff this book never saw, and that is expected: it is the
        // one the exchange published before the snapshot was taken.
        expect(book.push(delta({ firstUpdateId: '99', previousFinalUpdateId: '98' }), 100))
            .toEqual({ applied: true, reason: 'live' });
        expect(book.toRendererView().lastUpdateId).toBe('101');
    });

    it('pays the owed bridge with a first diff that continues from the snapshot', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.bootstrap(snapshot()).live).toBe(true);
        expect(book.push(delta({
            firstUpdateId: '101',
            finalUpdateId: '101',
            previousFinalUpdateId: '100',
        }), 100)).toEqual({ applied: true, reason: 'live' });
        expect(book.toRendererView().lastUpdateId).toBe('101');
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
        expect(book.toRendererView()).toBeNull();
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
        expect(book.toRendererView()).toBeNull();
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
        expect(book.toRendererView().lastUpdateId).toBe('102');
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
        expect(book.toRendererView()).toBeNull();
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
        expect(book.toRendererView().bids.map(level => level.price)).toEqual(['9']);
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
        expect(book.toRendererView().lastUpdateId).toBe('9007199254740994');
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
    it('retains only bounded levels and emits the renderer window per side', () => {
        const { RETAINED_LEVELS_PER_SIDE } = FUTURES_WORKSTATION_ORDER_BOOK_LIMITS;
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ bids: [], asks: [] }), 1);
        expect(book.bootstrap(snapshot({
            bids: Array.from({ length: RETAINED_LEVELS_PER_SIDE },
                (_, index) => [`${100000 - index}.01`, '1']),
            asks: Array.from({ length: RETAINED_LEVELS_PER_SIDE },
                (_, index) => [`${100001 + index}.01`, '1']),
        })).live).toBe(true);
        expect(book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '102',
            previousFinalUpdateId: '101',
            bids: Array.from({ length: 100 }, (_, index) => [`${99000 - index}.01`, '1']),
            asks: Array.from({ length: 100 }, (_, index) => [`${101001 + index}.01`, '1']),
        }), 1).applied).toBe(true);
        expect(book.bids.size).toBe(RETAINED_LEVELS_PER_SIDE);
        expect(book.asks.size).toBe(RETAINED_LEVELS_PER_SIDE);
        const view = book.toRendererView();
        expect(view.bids).toHaveLength(
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RENDERER_LEVELS_PER_SIDE,
        );
        expect(view.asks).toHaveLength(
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RENDERER_LEVELS_PER_SIDE,
        );
        expect(view.bids[0].price).toBe('100000.01');
        expect(view.asks[0].price).toBe('100001.01');
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
            bids: side(FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RETAINED_LEVELS_PER_SIDE),
            asks: Array.from({ length: FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RETAINED_LEVELS_PER_SIDE },
                (_, index) => [`${(900001 + index) / 10000}`, '184467440737.09551615']),
        }));
        const bytes = Buffer.byteLength(JSON.stringify(book.toRendererView()), 'utf8');
        expect(bytes).toBeLessThanOrEqual(FUTURES_WORKSTATION_EVENT_MAX_BYTES);
    });

    it('sorts high-precision prices without Number coercion', () => {
        const book = new FuturesWorkstationOrderBook();
        book.push(delta({ bids: [], asks: [] }), 1);
        expect(book.bootstrap(snapshot({
            bids: [['9007199254740993.0001', '1'], ['9007199254740993.0002', '1']],
            asks: [['9007199254740993.0003', '1']],
        })).live).toBe(true);
        expect(book.toRendererView().bids[0].price).toBe('9007199254740993.0002');
    });

    it('tears down idempotently and rejects later mutation', () => {
        const book = liveBook();
        book.stop();
        book.stop();
        expect(book.push(delta(), 100)).toEqual({ applied: false, reason: 'stopped' });
        expect(book.toRendererView()).toBeNull();
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

    it('does not keep a level beyond what the snapshot covered', () => {
        const book = banded();
        book.push(delta({
            firstUpdateId: '102',
            finalUpdateId: '103',
            previousFinalUpdateId: '101',
            bids: [['8.00', '7.0'], ['9.50', '1.5']],
            asks: [['13.00', '9.0'], ['11.50', '2.5']],
        }), 200);
        const view = book.toRendererView();
        expect(view.bids.map(row => row.price)).toEqual(['10', '9.5', '9']);
        expect(view.asks.map(row => row.price)).toEqual(['11', '11.5', '12']);
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
        expect(book.toRendererView().bids.map(row => row.price)).toEqual(['10']);
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
        // Band spans 3; covering ±6 around a spread of 1 needs 13.
        expect(book.rangeShortfall('6')).toBeCloseTo(13 / 3, 6);
    });

    // A snapshot that came back with one side empty proves no band, so the book
    // filters nothing and there is nothing the rows can fall outside of. Reading
    // the same page again would not produce a band either.
    it('is short of nothing when there is no band', () => {
        const book = new FuturesWorkstationOrderBook();
        expect(book.rangeShortfall('6')).toBe(0);
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
