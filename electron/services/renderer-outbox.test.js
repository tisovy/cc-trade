import { describe, expect, it, vi } from 'vitest';
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
        expect(backlog).toHaveBeenCalledWith({
            resource: 'depth',
            symbol: 'BTCUSDT',
            superseded: 19,
            dropped: 0,
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

    // A frame that states no resource cannot be replaced by a newer one, so the
    // queue length is the only thing bounding it.
    it('bounds market frames that nothing can supersede, and counts what it drops', () => {
        const connection = createConnection();
        const backlog = vi.fn();
        const outbox = createRendererOutbox(connection, { onBacklog: backlog });
        const tick = { lane: RENDERER_OUTBOX_LANES.MARKET, resource: 'ticker' };

        connection.stall();
        outbox.send('filled-the-buffer', tick);
        for (let index = 0; index < RENDERER_OUTBOX.MARKET_QUEUE_FRAMES + 5; index += 1) {
            outbox.send(`batch-${index}`, tick);
        }

        expect(outbox.pending().market).toBe(RENDERER_OUTBOX.MARKET_QUEUE_FRAMES);
        connection.drain();

        expect(connection.sent[1]).toBe('batch-5');
        expect(backlog).toHaveBeenCalledWith({
            resource: 'ticker',
            symbol: null,
            superseded: 0,
            dropped: 5,
        });
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
