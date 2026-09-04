import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    RENDERER_OUTBOX,
    RENDERER_OUTBOX_LANES,
    createRendererOutbox,
} from './renderer-outbox.js';

// A renderer socket that states its backpressure the way the WebSocket library
// does: `outputBufferFull` is set from the socket write's own answer, and `drain`
// fires when Node's buffer for it empties.
const createConnection = () => {
    const handlers = {};
    const sent = [];
    const connection = {
        connected: true,
        outputBufferFull: false,
        sent,
        sendUTF: vi.fn((text) => { sent.push(text); }),
        close: vi.fn(() => { connection.connected = false; }),
        on: vi.fn((event, handler) => { handlers[event] = handler; }),
        // The frame that fills the buffer is still written; everything after it
        // is what queues.
        stall: () => { connection.outputBufferFull = true; },
        drain: () => {
            connection.outputBufferFull = false;
            handlers.drain?.();
        },
    };
    return connection;
};

const account = { lane: RENDERER_OUTBOX_LANES.ACCOUNT };
const book = symbol => ({
    lane: RENDERER_OUTBOX_LANES.MARKET,
    resource: 'depth',
    symbol,
    supersede: true,
});

describe('renderer backlog byte and duration bounds', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
    const blockedBox = (options = {}) => {
        const connection = createConnection();
        const onOverflow = vi.fn();
        const outbox = createRendererOutbox(connection, { maxQueueBytes: 12, maxBacklogMs: 100, onOverflow, ...options });
        connection.stall();
        outbox.send('open', account);
        return { connection, outbox, onOverflow };
    };

    it('accepts the exact byte ceiling then closes once and releases all retained data', () => {
        const { connection, outbox, onOverflow } = blockedBox();
        expect(outbox.send('123456', account)).toBe(true);
        expect(outbox.send('abcdef', { resource: 'history' })).toBe(true);
        expect(outbox.pending()).toMatchObject({ bytes: 12, account: 1, market: 1 });
        expect(outbox.send('x', account)).toBe(false);
        expect(onOverflow).toHaveBeenCalledWith(expect.objectContaining({ reason: 'queue-bytes', bytes: 12, accountFrames: 1, marketFrames: 1, frameBytes: 1 }));
        expect(outbox.pending()).toMatchObject({ bytes: 0, account: 0, market: 0, resources: {} });
        expect(vi.getTimerCount()).toBe(0);
        expect(outbox.send('again', account)).toBe(false);
        connection.connected = true; // a stray late drain cannot revive abandonment
        connection.drain();
        expect(connection.sent).toEqual(['open']);
        expect(connection.close).toHaveBeenCalledOnce();
    });

    it('charges UTF-8 rather than string length and guards the direct path', () => {
        const connection = createConnection();
        const outbox = createRendererOutbox(connection, { maxQueueBytes: 4 });
        expect(outbox.send('🙂', account)).toBe(true);
        expect(outbox.send('éé', account)).toBe(true);
        expect(outbox.send('ééé', account)).toBe(false);
        expect(connection.sent).toEqual(['🙂', 'éé']);
        const blocked = blockedBox({ maxQueueBytes: 4 });
        expect(blocked.outbox.send('🙂', account)).toBe(true);
        expect(blocked.outbox.pending().bytes).toBe(4);
        expect(blocked.outbox.send('a', account)).toBe(false);
    });

    it('does not send a too-large ASCII frame even to a writable socket', () => {
        const connection = createConnection();
        const onOverflow = vi.fn();
        const outbox = createRendererOutbox(connection, { maxQueueBytes: 4, onOverflow });
        expect(outbox.send('12345', account)).toBe(false);
        expect(connection.sent).toEqual([]);
        expect(onOverflow).toHaveBeenCalledWith(expect.objectContaining({ reason: 'frame-bytes', frameBytes: 5, bytes: 0 }));
    });

    it('releases replacement bytes and evicts only other replaceable market frames for growth', () => {
        const { connection, outbox } = blockedBox();
        outbox.send('1111', book('ETHUSDT'));
        outbox.send('22', book('BTCUSDT'));
        outbox.send('page', { resource: 'history' });
        expect(outbox.send('33333333', book('BTCUSDT'))).toBe(true);
        expect(outbox.pending()).toMatchObject({ bytes: 12, market: 2 });
        expect(outbox.send('4', book('BTCUSDT'))).toBe(true);
        expect(outbox.pending().bytes).toBe(5);
        connection.drain();
        expect(connection.sent).toEqual(['open', '4', 'page']);
        expect(outbox.pending().bytes).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('makes room for account facts by removing only complete market snapshots', () => {
        const { connection, outbox } = blockedBox();
        outbox.send('123456', book('BTCUSDT'));
        outbox.send('page', { resource: 'catalog' });
        expect(outbox.send('event', account)).toBe(true);
        expect(outbox.pending()).toMatchObject({ account: 1, market: 1, bytes: 9 });
        connection.drain();
        expect(connection.sent).toEqual(['open', 'event', 'page']);
    });

    it('does not discard an account frame even when its delivery metadata says supersede', () => {
        const { outbox, connection } = blockedBox();
        outbox.send('12345678', { ...account, resource: 'account', supersede: true });
        expect(outbox.send('abcde', { resource: 'history' })).toBe(false);
        expect(connection.close).toHaveBeenCalledOnce();
        expect(connection.sent).toEqual(['open']);
    });

    it('does not lose protected pages when a growing replacement cannot fit', () => {
        const { connection, outbox } = blockedBox();
        outbox.send('12345678', { resource: 'history' });
        outbox.send('x', book('BTCUSDT'));
        expect(outbox.send('12345', book('BTCUSDT'))).toBe(false);
        expect(connection.sent).toEqual(['open']);
        expect(connection.close).toHaveBeenCalledOnce();
        expect(outbox.pending().bytes).toBe(0);
    });

    it('expires a silent backlog without more sends or a drain', () => {
        const { connection, outbox, onOverflow } = blockedBox();
        outbox.send('fact', account);
        vi.advanceTimersByTime(99);
        expect(connection.close).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(connection.close).toHaveBeenCalledOnce();
        expect(onOverflow).toHaveBeenCalledWith(expect.objectContaining({ reason: 'backlog-timeout', bytes: 4 }));
        expect(outbox.pending()).toMatchObject({ account: 0, market: 0, bytes: 0 });
    });

    it('does not renew the deadline when the newest snapshot keeps changing', () => {
        const { connection, outbox } = blockedBox();
        outbox.send('first', book('BTCUSDT'));
        vi.advanceTimersByTime(60);
        outbox.send('new', book('BTCUSDT'));
        vi.advanceTimersByTime(40);
        expect(connection.close).toHaveBeenCalledOnce();
        expect(connection.sent).toEqual(['open']);
    });

    it('does not renew the deadline on partial drain', () => {
        const { connection, outbox } = blockedBox();
        outbox.send('first', account);
        outbox.send('second', account);
        vi.advanceTimersByTime(60);
        connection.sendUTF.mockImplementation(text => { connection.sent.push(text); connection.stall(); });
        connection.drain();
        expect(outbox.pending()).toMatchObject({ account: 1, bytes: 6 });
        vi.advanceTimersByTime(40);
        expect(connection.close).toHaveBeenCalledOnce();
        expect(connection.sent).toEqual(['open', 'first']);
    });

    it('gives a later independent backlog a new deadline after a full drain', () => {
        const { connection, outbox } = blockedBox();
        outbox.send('first', account);
        vi.advanceTimersByTime(60);
        connection.drain();
        expect(vi.getTimerCount()).toBe(0);
        connection.stall();
        outbox.send('open2', account);
        outbox.send('second', account);
        vi.advanceTimersByTime(99);
        expect(connection.close).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(connection.close).toHaveBeenCalledOnce();
    });

    it.each(['dispose', 'close', 'discard'])('clears timers and bytes on %s', action => {
        const { connection, outbox } = blockedBox();
        outbox.send('book', book('BTCUSDT'));
        if (action === 'dispose') outbox.dispose();
        if (action === 'close') connection.on.mock.calls.find(([event]) => event === 'close')[1]();
        if (action === 'discard') expect(outbox.discardMarket('depth', 'BTCUSDT')).toBe(1);
        expect(outbox.pending().bytes).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(200);
        expect(connection.close).not.toHaveBeenCalled();
    });

    it('still closes and clears if every diagnostic callback throws', () => {
        const fail = () => { throw new Error('diagnostic failed'); };
        const { connection, outbox } = blockedBox({ onBacklog: fail, onOverflow: fail });
        outbox.send('fact', account);
        expect(() => vi.advanceTimersByTime(100)).not.toThrow();
        expect(connection.close).toHaveBeenCalledOnce();
        expect(outbox.pending()).toMatchObject({ account: 0, market: 0, bytes: 0, resources: {} });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps current byte accounting independent of diagnostic cooldown', () => {
        const { connection, outbox } = blockedBox({ now: () => 1234 });
        outbox.send('first', account);
        connection.drain();
        connection.stall();
        outbox.send('open2', account);
        outbox.send('123456789012', account);
        expect(outbox.pending().bytes).toBe(12);
        expect(outbox.send('x', account)).toBe(false);
        expect(outbox.pending().bytes).toBe(0);
    });

    it.each([{ maxQueueBytes: 0 }, { maxQueueBytes: NaN }, { maxBacklogMs: -1 }, { maxBacklogMs: Infinity }])('rejects invalid developer limits %j', options => {
        expect(() => createRendererOutbox(createConnection(), options)).toThrow(RangeError);
    });

    it('holds a full 128-page maximum-sized workstation catalog and account facts within production bounds', () => {
        const { connection, outbox } = blockedBox({ maxQueueBytes: RENDERER_OUTBOX.QUEUE_BYTES });
        const page = 'p'.repeat(256 * 1024);
        for (let index = 0; index < 128; index += 1) expect(outbox.send(page, { resource: 'catalog' })).toBe(true);
        expect(outbox.send('account-event', account)).toBe(true);
        expect(outbox.pending().bytes).toBe(32 * 1024 * 1024 + 13);
        connection.drain();
        expect(connection.sent[1]).toBe('account-event');
        expect(connection.sent.slice(2)).toHaveLength(128);
        expect(outbox.pending().bytes).toBe(0);
        expect(connection.close).not.toHaveBeenCalled();
    });
});

describe('createRendererOutbox', () => {
    it('writes straight through while the socket is taking bytes', () => {
        const connection = createConnection();
        const outbox = createRendererOutbox(connection);

        outbox.send('one', account);
        outbox.send('two', book('BTCUSDT'));

        expect(connection.sent).toEqual(['one', 'two']);
        expect(outbox.pending()).toMatchObject({ account: 0, market: 0 });
    });

    // The whole point of the change: a fill is a few hundred bytes and it used to
    // wait behind every book the renderer had not drained.
    it('delivers an execution report ahead of the books queued before it', () => {
        const connection = createConnection();
        const outbox = createRendererOutbox(connection);

        connection.stall();
        outbox.send('book-that-filled-the-buffer', book('BTCUSDT'));
        outbox.send('book-1', book('BTCUSDT'));
        outbox.send('book-2', book('ETHUSDT'));
        outbox.send('header', {
            lane: RENDERER_OUTBOX_LANES.MARKET,
            resource: 'header',
            symbol: 'BTCUSDT',
            supersede: true,
        });
        outbox.send('the-order-was-filled', account);

        expect(connection.sent).toEqual(['book-that-filled-the-buffer']);
        connection.drain();

        expect(connection.sent[1]).toBe('the-order-was-filled');
        expect(connection.sent.slice(2)).toEqual(['book-1', 'book-2', 'header']);
    });

    it('delivers the newest book of a burst and counts the rest superseded', () => {
        const connection = createConnection();
        const backlog = vi.fn();
        const outbox = createRendererOutbox(connection, { onBacklog: backlog });

        connection.stall();
        outbox.send('first', book('BTCUSDT'));
        for (let index = 1; index <= 20; index += 1) outbox.send(`book-${index}`, book('BTCUSDT'));

        expect(outbox.pending()).toMatchObject({ market: 1 });
        connection.drain();

        expect(connection.sent).toEqual(['first', 'book-20']);
        // Twenty books arrived and the queue never held more than one of them:
        // the depth reading is what says the desk was replacing rather than
        // stacking, and the superseded count alone could not.
        expect(backlog).toHaveBeenCalledWith({
            resource: 'depth',
            symbol: 'BTCUSDT',
            superseded: 19,
            dropped: 0,
            frames: 1,
            bytes: 'book-20'.length,
        });
    });

    // A book is the whole book. A fill is a thing that happened once, and no
    // later frame says it again.
    it('never supersedes an account frame', () => {
        const connection = createConnection();
        const outbox = createRendererOutbox(connection);

        connection.stall();
        outbox.send('opening', account);
        outbox.send('filled-1', account);
        outbox.send('filled-2', account);
        outbox.send('filled-3', account);
        connection.drain();

        expect(connection.sent).toEqual(['opening', 'filled-1', 'filled-2', 'filled-3']);
    });

    it('keeps the contract series and the index series apart', () => {
        const connection = createConnection();
        const candles = variant => ({
            lane: RENDERER_OUTBOX_LANES.MARKET,
            resource: 'candles',
            symbol: 'BTCUSDT',
            variant,
            supersede: true,
        });
        const outbox = createRendererOutbox(connection);

        connection.stall();
        outbox.send('filled-the-buffer', candles('contract'));
        outbox.send('contract-1', candles('contract'));
        outbox.send('index-1', candles('index'));
        outbox.send('contract-2', candles('contract'));
        connection.drain();

        expect(connection.sent).toEqual(['filled-the-buffer', 'contract-2', 'index-1']);
    });

    // Past the queue's length, a book that a newer book has already replaced is
    // what gives way — never the pages the renderer is assembling beside it.
    it('drops a replaceable frame to make room, and counts it', () => {
        const connection = createConnection();
        const backlog = vi.fn();
        const outbox = createRendererOutbox(connection, { onBacklog: backlog });
        const page = offset => ({
            lane: RENDERER_OUTBOX_LANES.MARKET,
            resource: 'catalog',
            symbol: 'BTCUSDT',
            text: `page-${offset}`,
        });

        connection.stall();
        outbox.send('filled-the-buffer', book('BTCUSDT'));
        for (let offset = 0; offset < RENDERER_OUTBOX.MARKET_QUEUE_FRAMES - 1; offset += 1) {
            outbox.send(`page-${offset}`, page(offset));
        }
        outbox.send('book-1', book('ETHUSDT'));
        outbox.send('page-last', page('last'));
        connection.drain();

        // Every catalog page arrived; the book that had to give way is the one
        // a newer frame could have stood in for.
        const delivered = connection.sent.filter(text => text.startsWith('page-'));
        expect(delivered).toHaveLength(RENDERER_OUTBOX.MARKET_QUEUE_FRAMES);
        expect(connection.sent).not.toContain('book-1');
        expect(backlog).toHaveBeenCalledWith({
            resource: 'depth',
            symbol: 'ETHUSDT',
            superseded: 0,
            dropped: 1,
            frames: 1,
            bytes: 'book-1'.length,
        });
        // The catalog lost nothing and still says how far behind it got — the
        // reading a backlog of pages would otherwise never produce, because
        // nothing about it can be superseded.
        expect(backlog).toHaveBeenCalledWith({
            resource: 'catalog',
            symbol: 'BTCUSDT',
            superseded: 0,
            dropped: 0,
            frames: RENDERER_OUTBOX.MARKET_QUEUE_FRAMES,
            bytes: expect.any(Number),
        });
    });

    // The desk sends a catalog as up to a hundred and twenty-eight pages back to
    // back, and the socket blocks partway through every time. Dropping one of
    // them left the operator with no contract list at all.
    it('holds a whole catalog through a socket that stopped accepting bytes', () => {
        const connection = createConnection();
        const outbox = createRendererOutbox(connection);
        const pages = 128;

        connection.stall();
        outbox.send('filled-the-buffer', book('BTCUSDT'));
        for (let offset = 0; offset < pages; offset += 1) {
            outbox.send(`page-${offset}`, {
                lane: RENDERER_OUTBOX_LANES.MARKET,
                resource: 'catalog',
                symbol: 'BTCUSDT',
            });
        }
        connection.drain();

        expect(connection.sent.filter(text => text.startsWith('page-'))).toHaveLength(pages);
        expect(connection.sent.slice(1)).toEqual(
            Array.from({ length: pages }, (unused, offset) => `page-${offset}`),
        );
    });

    // Two markets name a resource the same way. Spot's book for a contract and
    // the futures workstation's book for that contract are `depth` for the same
    // symbol, and only one of them says it may be replaced — so the newer one
    // must not stand in for the older, which is neither the same market's
    // statement nor even the same shape.
    it('does not let a supersedable book stand in for one that is not', () => {
        const connection = createConnection();
        const outbox = createRendererOutbox(connection);

        connection.stall();
        outbox.send('filled-the-buffer', book('BTCUSDT'));
        outbox.send('spot-book', {
            lane: RENDERER_OUTBOX_LANES.MARKET,
            resource: 'depth',
            symbol: 'BTCUSDT',
        });
        outbox.send('workstation-book', book('BTCUSDT'));
        connection.drain();

        expect(connection.sent.slice(1)).toEqual(['spot-book', 'workstation-book']);
    });

    it('discards only a queued replaceable frame with the exact retired market key', () => {
        const connection = createConnection();
        const backlog = vi.fn();
        const outbox = createRendererOutbox(connection, { onBacklog: backlog });
        const positionMarks = (overrides = {}) => ({
            lane: RENDERER_OUTBOX_LANES.MARKET,
            resource: 'position-marks',
            symbol: null,
            supersede: true,
            ...overrides,
        });

        connection.stall();
        outbox.send('filled-the-buffer', book('BTCUSDT'));
        outbox.send('retired-futures-mark', positionMarks());
        outbox.send('same-resource-other-key', positionMarks({ symbol: 'BTCUSDT' }));
        outbox.send('same-key-not-replaceable', positionMarks({ supersede: false }));
        outbox.send('unrelated-book', book('ETHUSDT'));
        outbox.send('account-fact', account);

        const before = outbox.pending();
        expect(before).toMatchObject({ account: 1, market: 4 });
        expect(before.bytes).toBe(
            'retired-futures-mark'.length
            + 'same-resource-other-key'.length
            + 'same-key-not-replaceable'.length
            + 'unrelated-book'.length
            + 'account-fact'.length,
        );

        expect(outbox.discardMarket('position-marks')).toBe(1);
        const after = outbox.pending();
        expect(after).toMatchObject({ account: 1, market: 3 });
        expect(after.bytes).toBe(before.bytes - 'retired-futures-mark'.length);
        expect(after.resources['position-marks|null']).toMatchObject({
            frames: 1,
            peakFrames: 2,
        });

        connection.drain();
        expect(connection.sent).toEqual([
            'filled-the-buffer',
            'account-fact',
            'same-resource-other-key',
            'same-key-not-replaceable',
            'unrelated-book',
        ]);
        expect(outbox.pending()).toMatchObject({
            account: 0, market: 0, bytes: 0, blocked: false,
        });
        // The backlog line keeps the true peak even though one safe complete
        // frame was retired before drain; current frame/byte accounting ends at
        // zero and the unrelated/nonreplaceable traffic is still delivered.
        expect(backlog).toHaveBeenCalledWith(expect.objectContaining({
            resource: 'position-marks',
            symbol: null,
            frames: 2,
            bytes: 'retired-futures-mark'.length + 'same-key-not-replaceable'.length,
        }));
    });

    // The alternative is a renderer quietly served a hole in its own account
    // state. It reconnects and reads it again.
    it('closes a renderer that stops draining its account traffic', () => {
        const connection = createConnection();
        const overflow = vi.fn();
        const outbox = createRendererOutbox(connection, { onOverflow: overflow });

        connection.stall();
        outbox.send('filled-the-buffer', account);
        for (let index = 0; index < RENDERER_OUTBOX.ACCOUNT_QUEUE_FRAMES; index += 1) {
            expect(outbox.send(`account-${index}`, account)).toBe(true);
        }

        expect(connection.close).not.toHaveBeenCalled();
        expect(outbox.send('one-too-many', account)).toBe(false);
        expect(connection.close).toHaveBeenCalledOnce();
        expect(overflow).toHaveBeenCalledOnce();
    });

    // One line per resource per backlog, not one per frame: the case worth
    // recording is a socket blocked for a minute at ten books a second.
    it('writes nothing to the record for a second backlog inside the cooldown', () => {
        const connection = createConnection();
        const backlog = vi.fn();
        let clock = 1_000;
        const outbox = createRendererOutbox(connection, {
            now: () => clock,
            onBacklog: backlog,
        });

        const burst = () => {
            connection.stall();
            outbox.send('filled-the-buffer', book('BTCUSDT'));
            outbox.send('older', book('BTCUSDT'));
            outbox.send('newer', book('BTCUSDT'));
            connection.drain();
        };

        burst();
        expect(backlog).toHaveBeenCalledTimes(1);

        clock += RENDERER_OUTBOX.REPORT_COOLDOWN_MS - 1;
        burst();
        expect(backlog).toHaveBeenCalledTimes(1);

        clock += 1;
        burst();
        expect(backlog).toHaveBeenCalledTimes(2);
        // What the two quiet bursts lost is carried into the line that is written.
        expect(backlog).toHaveBeenLastCalledWith({
            resource: 'depth',
            symbol: 'BTCUSDT',
            superseded: 2,
            dropped: 0,
            frames: 1,
            bytes: 'newer'.length,
        });
    });

    // Every other change in this batch claims the desk got faster. Without a
    // reading of how far behind the renderer actually fell, a regression in any
    // of them looks exactly like a busy market.
    it('states a rising queue while the socket is stalled, and nothing once it drains', () => {
        const connection = createConnection();
        const backlog = vi.fn();
        const outbox = createRendererOutbox(connection, { onBacklog: backlog });
        const page = offset => ({
            lane: RENDERER_OUTBOX_LANES.MARKET,
            resource: 'catalog',
            symbol: 'BTCUSDT',
            text: `page-${offset}`,
        });

        connection.stall();
        outbox.send('filled-the-buffer', book('BTCUSDT'));
        expect(outbox.pending()).toMatchObject({ market: 0, bytes: 0 });

        outbox.send('page-0', page(0));
        const oneDeep = outbox.pending();
        expect(oneDeep).toMatchObject({ market: 1 });
        expect(oneDeep.bytes).toBe('page-0'.length);

        outbox.send('page-1', page(1));
        outbox.send('book-1', book('BTCUSDT'));
        const threeDeep = outbox.pending();
        expect(threeDeep.market).toBe(3);
        expect(threeDeep.bytes).toBe('page-0'.length + 'page-1'.length + 'book-1'.length);
        expect(threeDeep.resources['catalog|BTCUSDT']).toMatchObject({ frames: 2, peakFrames: 2 });

        // A newer book stands in for the queued one: the queue stops growing and
        // the supersession is what says why.
        outbox.send('book-2', book('BTCUSDT'));
        expect(outbox.pending().market).toBe(3);
        expect(outbox.pending().resources['depth|BTCUSDT']).toMatchObject({
            frames: 1,
            superseded: 1,
        });

        connection.drain();

        // Drained: nothing is waiting, and the line written about it carries the
        // worst it got rather than the nothing that is left.
        expect(outbox.pending()).toMatchObject({ account: 0, market: 0, bytes: 0, blocked: false });
        expect(outbox.pending().resources).toEqual({});
        expect(backlog).toHaveBeenCalledWith({
            resource: 'catalog',
            symbol: 'BTCUSDT',
            superseded: 0,
            dropped: 0,
            frames: 2,
            bytes: 'page-0'.length + 'page-1'.length,
        });
        expect(backlog).toHaveBeenCalledWith({
            resource: 'depth',
            symbol: 'BTCUSDT',
            superseded: 1,
            dropped: 0,
            frames: 1,
            bytes: 'book-2'.length,
        });
    });

    // An account frame is never superseded and never dropped, so under the old
    // rule — a line per resource that lost something — a renderer sitting on a
    // minute of fills produced no line at all. That is the backlog the operator
    // actually feels.
    it('states an account backlog, which loses nothing and so said nothing', () => {
        const connection = createConnection();
        const backlog = vi.fn();
        const outbox = createRendererOutbox(connection, { onBacklog: backlog });

        connection.stall();
        outbox.send('filled-the-buffer', account);
        outbox.send('filled-1', account);
        outbox.send('filled-2', account);
        expect(outbox.pending()).toMatchObject({ account: 2, bytes: 'filled-1'.length * 2 });
        connection.drain();

        expect(backlog).toHaveBeenCalledWith({
            resource: null,
            symbol: null,
            superseded: 0,
            dropped: 0,
            frames: 2,
            bytes: 'filled-1'.length + 'filled-2'.length,
        });
    });

    it('refuses to send on a connection that is gone', () => {
        const connection = createConnection();
        const outbox = createRendererOutbox(connection);

        connection.connected = false;

        expect(outbox.send('anything', account)).toBe(false);
        expect(connection.sendUTF).not.toHaveBeenCalled();
    });
});
