// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createFuturesMarkPriceFeed,
    futuresMarkPriceStreamUrl,
    readFuturesLastTradeEvent,
    readFuturesMarkPriceEvent,
    readFuturesPositionSymbols,
} from './futures-mark-price-feed.js';

const STREAM_ORIGIN = 'wss://stream.test';

const markFrame = (symbol, price, eventTime = 1_700_000_000_000) => JSON.stringify({
    stream: `${symbol.toLowerCase()}@markPrice@1s`,
    data: { e: 'markPriceUpdate', E: eventTime, s: symbol, p: price },
});

const tradeFrame = (symbol, price, tradeTime = 1_700_000_000_500) => JSON.stringify({
    stream: `${symbol.toLowerCase()}@aggTrade`,
    data: { e: 'aggTrade', E: tradeTime, s: symbol, p: price, T: tradeTime },
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
    const logger = { info: vi.fn(), warn: vi.fn() };
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
        logger,
        clock,
    });
    return { feed, sockets, broadcasts, logger, timers, runTimers };
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

describe('readFuturesLastTradeEvent', () => {
    it('reads a combined-stream print', () => {
        expect(readFuturesLastTradeEvent(JSON.parse(tradeFrame('BTCUSDT', '60612.40'))))
            .toEqual({ symbol: 'BTCUSDT', lastPrice: '60612.40', tradedAt: 1_700_000_000_500 });
    });

    // The mark and the last price are two different numbers, and only one of
    // them decides a liquidation. Neither reader answers for the other.
    it('refuses anything that is not a usable print', () => {
        expect(readFuturesLastTradeEvent({ e: 'markPriceUpdate', s: 'BTCUSDT', p: '1' })).toBeNull();
        expect(readFuturesLastTradeEvent({ e: 'aggTrade', s: 'BTCUSDT', p: '0' })).toBeNull();
        expect(readFuturesLastTradeEvent({ e: 'aggTrade', s: 'BTCUSDT' })).toBeNull();
        expect(readFuturesLastTradeEvent(null)).toBeNull();
    });
});

describe('futuresMarkPriceStreamUrl', () => {
    // The mark for what the exchange says the position is worth, the prints for
    // what it is worth between two marks.
    it('subscribes to the mark and the prints of every symbol on the routed market path', () => {
        expect(futuresMarkPriceStreamUrl(STREAM_ORIGIN, ['BTCUSDT', 'ETHUSDT']))
            .toBe(`${STREAM_ORIGIN}/market/stream?streams=btcusdt@markPrice@1s/btcusdt@aggTrade`
                + '/ethusdt@markPrice@1s/ethusdt@aggTrade');
    });

    // The decommissioned path is not a connection error: it opens, stays open
    // and delivers nothing, which reads on screen as a still market. Measured
    // against the live exchange on 2026-08-10: `/market/stream` delivered one
    // mark per second, `/stream` and `/ws` delivered zero frames in 6 seconds.
    it('never reaches for a path decommissioned on 2026-04-23', () => {
        const url = futuresMarkPriceStreamUrl(STREAM_ORIGIN, ['BTCUSDT']);
        expect(url).not.toContain(`${STREAM_ORIGIN}/stream?`);
        expect(url).not.toContain(`${STREAM_ORIGIN}/ws/`);
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

    it('exposes only the marks the existing feed still considers live', () => {
        expect(harness.feed.snapshot()).toEqual({});
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));

        // Snapshotting neither waits for nor causes a renderer batch.
        expect(harness.feed.snapshot()).toEqual({ BMTUSDT: '0.03523' });
        expect(harness.broadcasts).toEqual([]);
        expect(Object.isFrozen(harness.feed.snapshot())).toBe(true);

        harness.sockets[0].emit('close');
        expect(harness.feed.snapshot()).toEqual({});
    });

    it('ignores frames it does not read and prices for untracked symbols', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('message', 'not json');
        harness.sockets[0].emit('message', JSON.stringify({ e: 'forceOrder', s: 'BMTUSDT' }));
        harness.sockets[0].emit('message', markFrame('ETHUSDT', '2500'));
        harness.sockets[0].emit('message', tradeFrame('ETHUSDT', '2501'));
        harness.runTimers();
        expect(harness.broadcasts).toHaveLength(0);
    });

    it('carries the prints between two marks beside the mark', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.sockets[0].emit('message', tradeFrame('BMTUSDT', '0.03531'));
        harness.runTimers();
        expect(harness.broadcasts).toEqual([{
            type: 'futures_position_marks',
            version: 1,
            marks: {
                BMTUSDT: {
                    markPrice: '0.03523',
                    updatedAt: 1_700_000_000_000,
                    lastPrice: '0.03531',
                    lastPriceAt: 1_700_000_000_500,
                },
            },
        }]);
    });

    // The mark is what a position is confirmed at, so an entry with no mark is
    // an estimate of nothing.
    it('holds a print until the symbol has a mark to sit beside', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('message', tradeFrame('BMTUSDT', '0.03531'));
        harness.runTimers();
        expect(harness.broadcasts).toHaveLength(0);
    });

    // A contract can go a minute without a print and be perfectly alive. Only
    // the mark, which is contracted at one a second, proves the feed delivers.
    it('does not let prints stand in for the mark the stall check watches', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('open');
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.runTimers();
        harness.broadcasts.length = 0;
        harness.sockets[0].emit('message', tradeFrame('BMTUSDT', '0.03531'));
        // The stall window closes with prints arriving and no mark behind them.
        harness.runTimers();
        harness.runTimers();
        expect(harness.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('delivered nothing'),
        );
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

    // A frozen uPnL and a quiet market look identical on screen. The log is the
    // only place the difference is recorded, so the feed has to say both.
    it('reports connecting and dropping so a dead feed is not read as a still market', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('open');
        expect(harness.logger.info).toHaveBeenCalledWith(
            expect.stringContaining('BMTUSDT'),
        );

        harness.sockets[0].emit('close');
        expect(harness.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('mark price stream closed'),
        );
    });

    // The dangerous state is not a closed socket — that one announces itself.
    // It is a socket that opened, never closed, and stopped delivering: uPnL
    // freezes at the account snapshot and nothing in the process says so.
    it('drops the marks of a silent socket and rebuilds it', () => {
        harness.feed.track([{ symbol: 'BICOUSDT', quantity: '-120' }]);
        harness.sockets[0].emit('open');
        harness.sockets[0].emit('message', markFrame('BICOUSDT', '2.1340'));
        harness.runTimers();
        expect(harness.broadcasts.at(-1).marks).toMatchObject({ BICOUSDT: { markPrice: '2.1340' } });
        harness.logger.warn.mockClear();

        // Nothing arrives for a whole stall window on a one-per-second contract.
        harness.runTimers();
        expect(harness.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('delivered nothing for 15s (BICOUSDT)'),
        );
        // The frozen mark is withdrawn rather than left standing as the market's
        // own price: consumers fall back to the account snapshot.
        expect(harness.broadcasts.at(-1).marks).toEqual({});
        expect(harness.sockets[0].closed).toBe(true);
        // The socket comes back on the reconnect delay, not instantly: a feed
        // that stays dead would otherwise rebuild itself every stall window
        // with no spacing at all.
        expect(harness.sockets).toHaveLength(1);

        harness.runTimers();
        expect(harness.sockets).toHaveLength(2);

        harness.sockets[1].emit('open');
        expect(harness.logger.info).toHaveBeenCalledWith(
            expect.stringContaining('connected: BICOUSDT'),
        );
    });

    it('says nothing about silence while marks keep arriving', () => {
        harness.feed.track([{ symbol: 'BICOUSDT', quantity: '-120' }]);
        harness.sockets[0].emit('open');
        harness.sockets[0].emit('message', markFrame('BICOUSDT', '2.1340'));
        harness.logger.warn.mockClear();

        harness.runTimers();
        expect(harness.logger.warn).not.toHaveBeenCalled();
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
