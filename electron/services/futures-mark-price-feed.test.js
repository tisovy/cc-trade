// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createFuturesMarkPriceFeed,
    futuresMarkPriceStreamUrl,
    readFuturesMarkPriceEvent,
    readFuturesPositionSymbols,
} from './futures-mark-price-feed.js';

const STREAM_ORIGIN = 'wss://stream.test';

const markFrame = (symbol, price, eventTime = 1_700_000_000_000) => JSON.stringify({
    stream: `${symbol.toLowerCase()}@markPrice@1s`,
    data: { e: 'markPriceUpdate', E: eventTime, s: symbol, p: price },
});

const createHarness = () => {
    const sockets = [];
    const broadcasts = [];
    const timers = [];
    const clock = {
        setTimeout: (callback, delay) => {
            timers.push({ callback, delay });
            return timers.length;
        },
        clearTimeout: (handle) => {
            if (typeof handle === 'number') timers[handle - 1] = null;
        },
    };
    const runTimers = () => {
        const pending = timers.filter(Boolean);
        timers.length = 0;
        for (const timer of pending) timer.callback();
    };
    const feed = createFuturesMarkPriceFeed({
        streamOrigin: STREAM_ORIGIN,
        createSocket: (url) => {
            const handlers = {};
            const socket = {
                url,
                closed: false,
                on: (event, handler) => {
                    handlers[event] = handler;
                },
                close: () => {
                    socket.closed = true;
                },
                emit: (event, payload) => handlers[event]?.(payload),
            };
            sockets.push(socket);
            return socket;
        },
        broadcast: payload => broadcasts.push(payload),
        logger: { warn: vi.fn() },
        clock,
    });
    return { feed, sockets, broadcasts, timers, runTimers };
};

describe('readFuturesPositionSymbols', () => {
    it('keeps only symbols that actually carry a position, sorted and deduplicated', () => {
        expect(readFuturesPositionSymbols([
            { symbol: 'ethusdt', quantity: '1.5' },
            { symbol: 'BTCUSDT', quantity: '-0.5' },
            { symbol: 'FLATUSDT', quantity: '0' },
            { symbol: 'BROKENUSDT', quantity: 'abc' },
            { symbol: 'ETHUSDT', quantity: '2' },
            { quantity: '3' },
        ])).toEqual(['BTCUSDT', 'ETHUSDT']);
    });

    it('treats a missing position list as no positions', () => {
        expect(readFuturesPositionSymbols(undefined)).toEqual([]);
    });
});

describe('readFuturesMarkPriceEvent', () => {
    it('reads a combined-stream mark update', () => {
        expect(readFuturesMarkPriceEvent(JSON.parse(markFrame('BTCUSDT', '60600.10'))))
            .toEqual({ symbol: 'BTCUSDT', markPrice: '60600.10', updatedAt: 1_700_000_000_000 });
    });

    it('refuses anything that is not a usable mark update', () => {
        expect(readFuturesMarkPriceEvent({ e: 'aggTrade', s: 'BTCUSDT', p: '1' })).toBeNull();
        expect(readFuturesMarkPriceEvent({ e: 'markPriceUpdate', s: 'BTCUSDT', p: '0' })).toBeNull();
        expect(readFuturesMarkPriceEvent({ e: 'markPriceUpdate', s: 'BTCUSDT' })).toBeNull();
        expect(readFuturesMarkPriceEvent(null)).toBeNull();
    });
});

describe('futuresMarkPriceStreamUrl', () => {
    it('subscribes one second stream per symbol', () => {
        expect(futuresMarkPriceStreamUrl(STREAM_ORIGIN, ['BTCUSDT', 'ETHUSDT']))
            .toBe(`${STREAM_ORIGIN}/stream?streams=btcusdt@markPrice@1s/ethusdt@markPrice@1s`);
    });
});

describe('createFuturesMarkPriceFeed', () => {
    let harness;

    beforeEach(() => {
        harness = createHarness();
    });

    it('subscribes to the symbols that carry an open position', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        expect(harness.sockets).toHaveLength(1);
        expect(harness.sockets[0].url).toContain('bmtusdt@markPrice@1s');
        expect(harness.feed.trackedSymbols).toEqual(['BMTUSDT']);
    });

    it('broadcasts marks in one batch per interval', () => {
        harness.feed.track([
            { symbol: 'BMTUSDT', quantity: '-446082' },
            { symbol: 'BEATUSDT', quantity: '-1800' },
        ]);
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.sockets[0].emit('message', markFrame('BEATUSDT', '3.523'));
        expect(harness.broadcasts).toHaveLength(0);

        harness.runTimers();
        expect(harness.broadcasts).toEqual([{
            type: 'futures_position_marks',
            version: 1,
            marks: {
                BMTUSDT: { markPrice: '0.03523', updatedAt: 1_700_000_000_000 },
                BEATUSDT: { markPrice: '3.523', updatedAt: 1_700_000_000_000 },
            },
        }]);
    });

    it('ignores frames that are not mark updates and marks for untracked symbols', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('message', 'not json');
        harness.sockets[0].emit('message', JSON.stringify({ e: 'aggTrade', s: 'BMTUSDT', p: '1' }));
        harness.sockets[0].emit('message', markFrame('ETHUSDT', '2500'));
        harness.runTimers();
        expect(harness.broadcasts).toHaveLength(0);
    });

    it('keeps the socket when a later snapshot reports the same symbols', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-2' }]);
        expect(harness.sockets).toHaveLength(1);
        expect(harness.sockets[0].closed).toBe(false);
    });

    it('resubscribes when the open-position symbol set changes', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.feed.track([
            { symbol: 'BMTUSDT', quantity: '-1' },
            { symbol: 'ETHUSDT', quantity: '3' },
        ]);
        expect(harness.sockets).toHaveLength(2);
        expect(harness.sockets[0].closed).toBe(true);
        expect(harness.sockets[1].url).toContain('ethusdt@markPrice@1s');
    });

    it('clears published marks when the last position is closed', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.runTimers();
        harness.broadcasts.length = 0;

        harness.feed.track([]);
        expect(harness.sockets[0].closed).toBe(true);
        expect(harness.broadcasts).toEqual([{
            type: 'futures_position_marks',
            version: 1,
            marks: {},
        }]);
    });

    it('drops its marks and reconnects when the stream disconnects', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.runTimers();
        harness.broadcasts.length = 0;

        harness.sockets[0].emit('close');
        expect(harness.broadcasts).toEqual([{
            type: 'futures_position_marks',
            version: 1,
            marks: {},
        }]);

        harness.runTimers();
        expect(harness.sockets).toHaveLength(2);
        expect(harness.sockets[1].url).toContain('bmtusdt@markPrice@1s');
    });

    it('stops for good and does not reconnect', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.feed.stop();
        expect(harness.sockets[0].closed).toBe(true);

        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.runTimers();
        expect(harness.sockets).toHaveLength(1);
    });
});
