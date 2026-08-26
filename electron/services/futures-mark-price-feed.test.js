// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createFuturesMarkPriceFeed,
    FUTURES_MARK_PRICE_BATCH_MS,
    futuresMarkPriceStreamUrl,
    readFuturesLastTradeEvent,
    readFuturesMarkPriceEvent,
    readFuturesPositionSymbols,
} from './futures-mark-price-feed.js';

const STREAM_ORIGIN = 'wss://stream.test';

const markFrame = (
    symbol,
    price,
    eventTime = 1_700_000_000_000,
    nextSettlementAt = 1_700_014_400_000,
) => JSON.stringify({
    stream: `${symbol.toLowerCase()}@markPrice@1s`,
    data: {
        e: 'markPriceUpdate',
        E: eventTime,
        s: symbol,
        p: price,
        // The next funding time. Carried on every mark frame the exchange
        // sends, so a fixture without it is not the frame the desk reads.
        T: nextSettlementAt,
    },
});

const tradeFrame = (symbol, price, tradeTime = 1_700_000_000_500) => JSON.stringify({
    stream: `${symbol.toLowerCase()}@aggTrade`,
    data: { e: 'aggTrade', E: tradeTime, s: symbol, p: price, T: tradeTime },
});

const createHarness = ({ feedEpoch = 1 } = {}) => {
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
    // Which contracts the feed said had just been charged funding.
    const settlements = [];
    const feed = createFuturesMarkPriceFeed({
        streamOrigin: STREAM_ORIGIN,
        onSettlement: symbol => settlements.push(symbol),
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
        feedEpoch,
    });
    return { feed, sockets, broadcasts, logger, settlements, timers, runTimers };
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
            .toEqual({
                symbol: 'BTCUSDT',
                markPrice: '60600.10',
                updatedAt: 1_700_000_000_000,
                nextSettlementAt: 1_700_014_400_000,
            });
    });

    // The schedule of the only event that moves an open position's settled
    // money, delivered once a second on a socket that costs nothing — and
    // dropped on the floor here until 2026-08-20, while the desk asked a
    // weight-30 endpoint every thirty seconds whether it had happened yet.
    it('carries when the contract is next charged funding', () => {
        expect(readFuturesMarkPriceEvent(JSON.parse(
            markFrame('BEATUSDT', '0.1876', 1_700_000_000_000, 1_700_014_400_000),
        )).nextSettlementAt).toBe(1_700_014_400_000);
    });

    // Contracts whose funding the exchange has not scheduled send zero, and an
    // instant of zero is 1970 — which every countdown would then read as long
    // past.
    it('refuses a settlement time the exchange did not state', () => {
        expect(readFuturesMarkPriceEvent({
            e: 'markPriceUpdate', E: 1, s: 'BTCUSDT', p: '1', T: 0,
        }).nextSettlementAt).toBeNull();
        expect(readFuturesMarkPriceEvent({
            e: 'markPriceUpdate', E: 1, s: 'BTCUSDT', p: '1',
        }).nextSettlementAt).toBeNull();
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
    // Both of a contract's prices, for every open position, on the routed path.
    // The mark is what the exchange settles on and arrives once a second; the
    // tape is what the contract actually traded at and is the only thing that
    // can move a position row in between.
    it('subscribes to each symbol’s mark and its trades on the routed market path', () => {
        const url = futuresMarkPriceStreamUrl(STREAM_ORIGIN, ['BTCUSDT', 'ETHUSDT']);
        expect(url).toBe(`${STREAM_ORIGIN}/market/stream?streams=btcusdt@markPrice@1s`
            + '/btcusdt@aggTrade/ethusdt@markPrice@1s/ethusdt@aggTrade');
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

    // The event the settled read exists to observe, seen on a socket that costs
    // nothing. Funding settles six times a day on this account and the desk was
    // asking a weight-30 endpoint every thirty seconds whether it had happened —
    // 2 880 requests a day to observe six events. The countdown moving on is the
    // event; while it stands still, nothing has happened.
    it('reports a settlement when the contract’s countdown steps forward', () => {
        harness.feed.track([{ symbol: 'BEATUSDT', quantity: '677491' }]);
        const socket = harness.sockets[0];

        socket.emit('message', markFrame('BEATUSDT', '0.1876', 1_700_000_000_000, 1_700_014_400_000));
        // The first frame only says when the next charge is due.
        expect(harness.settlements).toEqual([]);

        socket.emit('message', markFrame('BEATUSDT', '0.1877', 1_700_000_001_000, 1_700_014_400_000));
        expect(harness.settlements).toEqual([]);

        // 16:00 has been charged; the contract now counts down to 20:00.
        socket.emit('message', markFrame('BEATUSDT', '0.1878', 1_700_014_401_000, 1_700_028_800_000));
        expect(harness.settlements).toEqual(['BEATUSDT']);

        // And not again for the same one.
        socket.emit('message', markFrame('BEATUSDT', '0.1879', 1_700_014_402_000, 1_700_028_800_000));
        expect(harness.settlements).toEqual(['BEATUSDT']);
    });

    // A guard on the test above rather than a second finding: against a feed with
    // no countdown at all it passes trivially, because nothing is reported
    // either way. What it holds is the false positive — a contract with no
    // position left is charged no funding, and a countdown kept from the last
    // time it was held reads as a settlement on the first frame after it is
    // opened again.
    it('forgets the countdown of a contract that left the set', () => {
        harness.feed.track([{ symbol: 'BEATUSDT', quantity: '677491' }]);
        harness.sockets[0].emit(
            'message',
            markFrame('BEATUSDT', '0.1876', 1_700_000_000_000, 1_700_014_400_000),
        );
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        harness.feed.track([{ symbol: 'BEATUSDT', quantity: '677491' }]);

        harness.sockets.at(-1).emit(
            'message',
            markFrame('BEATUSDT', '0.19', 1_700_100_000_000, 1_700_100_800_000),
        );
        expect(harness.settlements).toEqual([]);
    });

    // The same shape of guard, at the feed rather than the reader. A contract
    // whose funding the exchange has not scheduled sends zero; read as an
    // instant, that is 1970, and every frame after the first would report a
    // settlement that never happened.
    it('reports nothing for a contract with no settlement scheduled', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.0352', 1_700_000_000_000, 0));
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.0353', 1_700_000_001_000, 0));
        expect(harness.settlements).toEqual([]);
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
            feedEpoch: 1,
            revision: 1,
            marks: {
                BMTUSDT: { markPrice: '0.03523', updatedAt: 1_700_000_000_000 },
                BEATUSDT: { markPrice: '3.523', updatedAt: 1_700_000_000_000 },
            },
        }]);
    });

    // The window exists to fold simultaneous arrivals together, and every
    // millisecond of it is added to the age of the number a position is valued
    // at — a value the exchange publishes only once a second and which reaches
    // the desk a further 220ms later. So it is held to the measurement rather
    // than to a round number.
    it('folds marks that arrive together into one publication, on a measured window', () => {
        harness.feed.track([
            { symbol: 'BMTUSDT', quantity: '-446082' },
            { symbol: 'BEATUSDT', quantity: '-1800' },
        ]);
        const armed = harness.timers.filter(Boolean).length;
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        const scheduled = harness.timers.filter(Boolean).slice(armed);
        expect(scheduled).toHaveLength(1);

        // The second contract's mark arrives inside that window and does not
        // open another one — which is the only thing the window is for.
        harness.sockets[0].emit('message', markFrame('BEATUSDT', '3.523'));
        expect(harness.timers.filter(Boolean).slice(armed)).toHaveLength(1);

        // Measured 2026-08-26, four contracts on one combined stream through
        // the operator's proxy: the spread between the first and last arrival
        // of a second's marks was 2ms at the median and 6ms at its worst. Four
        // times the worst of them, and no more than a twentieth of the one
        // second the exchange takes to publish the next mark at all.
        expect(scheduled[0].delay).toBeGreaterThanOrEqual(4 * 6);
        expect(scheduled[0].delay).toBeLessThanOrEqual(1000 / 20);
        expect(scheduled[0].delay).toBe(FUTURES_MARK_PRICE_BATCH_MS);

        harness.runTimers();
        expect(harness.broadcasts).toHaveLength(1);
        expect(harness.broadcasts[0].marks).toEqual({
            BMTUSDT: { markPrice: '0.03523', updatedAt: 1_700_000_000_000 },
            BEATUSDT: { markPrice: '3.523', updatedAt: 1_700_000_000_000 },
        });
    });

    // What the contract actually traded at, for every open position rather than
    // for the one on screen. The exchange marks once a second; a position row
    // that can only move on a mark is a second behind the chart above it.
    //
    // The flush is run on its own rather than through `runTimers`, which would
    // also fire the stall watchdog armed alongside it and withdraw everything.
    const runNewestFlush = (armed) => {
        const scheduled = harness.timers.filter(Boolean).slice(armed);
        expect(scheduled).toHaveLength(1);
        harness.timers[harness.timers.indexOf(scheduled[0])] = null;
        scheduled[0].callback();
    };

    it('carries each contract’s own last print beside its mark', () => {
        harness.feed.track([
            { symbol: 'BMTUSDT', quantity: '-446082' },
            { symbol: 'BEATUSDT', quantity: '-1800' },
        ]);
        const armed = harness.timers.filter(Boolean).length;
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.sockets[0].emit('message', markFrame('BEATUSDT', '3.523'));
        runNewestFlush(armed);

        // A trade prints on one of them, with no new mark behind it. That alone
        // is a new publication — the second the operator was reading blind.
        harness.sockets[0].emit('message', tradeFrame('BMTUSDT', '0.03530', 1_700_000_000_400));
        runNewestFlush(armed);

        expect(harness.broadcasts).toHaveLength(2);
        expect(harness.broadcasts[1].marks).toEqual({
            BMTUSDT: {
                markPrice: '0.03523',
                updatedAt: 1_700_000_000_000,
                lastPrice: '0.03530',
                lastPriceAt: 1_700_000_000_400,
            },
            // The contract that did not trade says only what it is marked at.
            BEATUSDT: { markPrice: '3.523', updatedAt: 1_700_000_000_000 },
        });

        // A print the exchange timed before one already taken cannot undo it,
        // and schedules nothing.
        harness.sockets[0].emit('message', tradeFrame('BMTUSDT', '0.03400', 1_700_000_000_300));
        expect(harness.timers.filter(Boolean).slice(armed)).toHaveLength(0);
        expect(harness.broadcasts).toHaveLength(2);
    });

    it('publishes no price at all for a contract it cannot mark', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        const armed = harness.timers.filter(Boolean).length;
        // A print arrives before the contract's first mark. It is held rather
        // than published: a price with no mark beside it has no liveness behind
        // it, and the reader drops it anyway.
        harness.sockets[0].emit('message', tradeFrame('BMTUSDT', '0.03530', 1_700_000_000_400));
        expect(harness.timers.filter(Boolean).slice(armed)).toHaveLength(0);
        expect(harness.broadcasts).toHaveLength(0);

        // The first mark brings the print it was already holding, rather than
        // waiting for the next trade — which on a quiet contract is seconds
        // away. DOGEUSDT went 6.6s between prints in the 2026-08-26 session.
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        runNewestFlush(armed);
        expect(harness.broadcasts[0].marks.BMTUSDT).toEqual({
            markPrice: '0.03523',
            updatedAt: 1_700_000_000_000,
            lastPrice: '0.03530',
            lastPriceAt: 1_700_000_000_400,
        });
    });

    // The watchdog measures the one-per-second contract. A busy contract's
    // trades must not vouch for a mark lane that has stopped delivering —
    // that failure is the whole reason the watchdog is there.
    it('does not let a print answer the stall watchdog', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        harness.sockets[0].emit('open');
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.runTimers();
        expect(harness.broadcasts.at(-1).marks.BMTUSDT).toBeDefined();

        // Trades keep arriving; the mark lane says nothing.
        harness.sockets[0].emit('message', tradeFrame('BMTUSDT', '0.03530', 1_700_000_000_400));
        harness.runTimers();
        harness.runTimers();

        expect(harness.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('delivered nothing'),
        );
        // And the price goes with the mark, rather than the last print being
        // left standing as if it were current.
        expect(harness.broadcasts.at(-1).marks).toEqual({});
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

    it('does not publish or mutate valuation when an aggregate trade arrives', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.runTimers();
        expect(harness.broadcasts).toEqual([{
            type: 'futures_position_marks',
            version: 1,
            feedEpoch: 1,
            revision: 1,
            marks: {
                BMTUSDT: {
                    markPrice: '0.03523',
                    updatedAt: 1_700_000_000_000,
                },
            },
        }]);

        harness.sockets[0].emit('message', tradeFrame('BMTUSDT', '0.03531'));
        expect(harness.timers.filter(timer => timer?.delay === 200)).toHaveLength(0);
        expect(harness.feed.snapshot()).toEqual({ BMTUSDT: '0.03523' });
        expect(harness.broadcasts).toHaveLength(1);
    });

    it('ignores older, duplicate, and equal-time conflicting marks', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03528', 2_000, 30_000));
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523', 1_000));
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03528', 2_000, 30_000));
        // Same exchange time is not a correction channel. Neither the price nor
        // the funding schedule from this conflicting replay may take authority.
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.99999', 2_000, 20_000));
        harness.runTimers();

        expect(harness.broadcasts).toEqual([{
            type: 'futures_position_marks',
            version: 1,
            feedEpoch: 1,
            revision: 1,
            marks: { BMTUSDT: { markPrice: '0.03528', updatedAt: 2_000 } },
        }]);
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03528', 2_000));
        expect(harness.timers.filter(timer => timer?.delay === 200)).toHaveLength(0);
        expect(harness.broadcasts).toHaveLength(1);

        // If the equal-time conflict had rewound the baseline to 20_000, this
        // fresh frame would look like a completed settlement. It is only the
        // unchanged 30_000 schedule carried by the next accepted price.
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03529', 25_000, 30_000));
        expect(harness.settlements).toEqual([]);
        harness.runTimers();
        expect(harness.broadcasts.at(-1).marks).toEqual({
            BMTUSDT: { markPrice: '0.03529', updatedAt: 25_000 },
        });
    });

    it('does not let an older mark rewind the funding schedule baseline', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        const socket = harness.sockets[0];

        // The current frame establishes the unchanged next settlement.
        socket.emit('message', markFrame('BMTUSDT', '0.03528', 2_000, 30_000));
        // This delayed frame names the preceding schedule. Applying it would
        // rewind the baseline from 30_000 to 20_000.
        socket.emit('message', markFrame('BMTUSDT', '0.03523', 1_000, 20_000));
        // The next current frame still names 30_000. It must not be mistaken
        // for a settlement merely because the stale frame arrived between them.
        socket.emit('message', markFrame('BMTUSDT', '0.03529', 3_000, 30_000));
        harness.runTimers();

        expect(harness.settlements).toEqual([]);
        expect(harness.broadcasts.at(-1).marks).toEqual({
            BMTUSDT: { markPrice: '0.03529', updatedAt: 3_000 },
        });
    });

    it('keeps funding schedule event time across reconnects', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03528', 2_000, 30_000));

        // Price liveness is deliberately forgotten on a disconnect, but the
        // schedule provenance is not. The delayed first frame on the new socket
        // must not turn the unchanged 30_000 schedule into a fake settlement.
        harness.sockets[0].emit('close');
        harness.runTimers();
        expect(harness.sockets).toHaveLength(2);
        harness.sockets[1].emit('message', markFrame('BMTUSDT', '0.03523', 1_000, 20_000));
        harness.sockets[1].emit('message', markFrame('BMTUSDT', '0.03529', 3_000, 30_000));

        expect(harness.settlements).toEqual([]);
    });

    it('treats fresh earlier and later pre-boundary funding changes as reschedules', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-446082' }]);
        const socket = harness.sockets[0];

        socket.emit('message', markFrame('BMTUSDT', '0.03528', 1_000, 30_000));
        // Binance can reschedule a coming funding charge. A newer frame moving
        // it earlier is a new baseline, not a settlement and not a stale frame.
        socket.emit('message', markFrame('BMTUSDT', '0.03529', 2_000, 20_000));
        expect(harness.settlements).toEqual([]);

        // It can move later again before the newly held boundary. That is still
        // scheduling news, not proof that funding was charged.
        socket.emit('message', markFrame('BMTUSDT', '0.03530', 3_000, 25_000));
        expect(harness.settlements).toEqual([]);

        // Only exchange event time reaching the held boundary turns the next
        // schedule advance into one settlement observation.
        socket.emit('message', markFrame('BMTUSDT', '0.03531', 25_000, 40_000));
        expect(harness.settlements).toEqual(['BMTUSDT']);
    });

    it('ignores an aggregate trade before the first mark', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('message', tradeFrame('BMTUSDT', '0.03531'));
        harness.runTimers();
        expect(harness.broadcasts).toHaveLength(0);
    });

    // Only the contracted one-per-second mark proves this feed is delivering.
    it('does not let ignored trade frames stand in for the mark liveness check', () => {
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

    // Opening or closing one position used to blank the live value of every
    // other one: the rebuild went through the same teardown a dead socket does,
    // which clears every mark. Each surviving row then valued itself off an
    // account snapshot from an earlier read until the new socket delivered.
    it('keeps the marks of the contracts that stayed in the set', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('open');
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.runTimers();
        harness.broadcasts.length = 0;

        harness.feed.track([
            { symbol: 'BMTUSDT', quantity: '-1' },
            { symbol: 'ETHUSDT', quantity: '3' },
        ]);
        expect(harness.feed.snapshot()).toEqual({ BMTUSDT: '0.03523' });
        // Nothing was dropped, so nothing had to be republished.
        expect(harness.broadcasts).toEqual([]);
    });

    it('drops the marks of the contracts that left it', () => {
        harness.feed.track([
            { symbol: 'BMTUSDT', quantity: '-1' },
            { symbol: 'ETHUSDT', quantity: '3' },
        ]);
        harness.sockets[0].emit('open');
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.sockets[0].emit('message', markFrame('ETHUSDT', '2500'));
        harness.runTimers();
        harness.broadcasts.length = 0;

        harness.feed.track([{ symbol: 'ETHUSDT', quantity: '3' }]);
        expect(harness.broadcasts.at(-1).marks).toEqual({
            ETHUSDT: { markPrice: '2500', updatedAt: 1_700_000_000_000 },
        });
    });

    // Retention is not an exemption from the stall window. A rebuild whose
    // socket never opens leaves marks with nothing measuring their age, and a
    // mark nobody is refreshing is exactly what the clearing rule exists for.
    it('clears retained marks when the rebuilt socket never delivers', () => {
        harness.feed.track([{ symbol: 'BMTUSDT', quantity: '-1' }]);
        harness.sockets[0].emit('open');
        harness.sockets[0].emit('message', markFrame('BMTUSDT', '0.03523'));
        harness.runTimers();
        harness.broadcasts.length = 0;

        harness.feed.track([
            { symbol: 'BMTUSDT', quantity: '-1' },
            { symbol: 'ETHUSDT', quantity: '3' },
        ]);
        expect(harness.feed.snapshot()).toEqual({ BMTUSDT: '0.03523' });

        // The rebuilt socket never opens and never delivers.
        harness.runTimers();
        harness.runTimers();
        expect(harness.feed.snapshot()).toEqual({});
        expect(harness.broadcasts.at(-1).marks).toEqual({});
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
            feedEpoch: 1,
            revision: 2,
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
            feedEpoch: 1,
            revision: 2,
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

    it('rebuilds the combined stream when one tracked symbol makes no progress', () => {
        harness.feed.track([
            { symbol: 'BMTUSDT', quantity: '-1' },
            { symbol: 'ETHUSDT', quantity: '2' },
        ]);
        const socket = harness.sockets[0];
        socket.emit('open');
        socket.emit('message', markFrame('BMTUSDT', '0.03523', 1_000));
        socket.emit('message', markFrame('ETHUSDT', '2500', 1_000));
        harness.runTimers();
        harness.logger.warn.mockClear();

        // ETH keeps the combined socket busy, but BMT is silent. Socket-level
        // traffic is therefore not liveness proof for every valued position.
        socket.emit('message', markFrame('ETHUSDT', '2501', 2_000));
        harness.runTimers();

        expect(harness.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('(BMTUSDT)'),
        );
        expect(socket.closed).toBe(true);
        expect(harness.feed.snapshot()).toEqual({});
        harness.runTimers();
        expect(harness.sockets).toHaveLength(2);
    });

    it('does not count an equal-time replay as per-symbol liveness', () => {
        harness.feed.track([
            { symbol: 'BMTUSDT', quantity: '-1' },
            { symbol: 'ETHUSDT', quantity: '2' },
        ]);
        const socket = harness.sockets[0];
        socket.emit('open');
        socket.emit('message', markFrame('BMTUSDT', '0.03523', 1_000));
        socket.emit('message', markFrame('ETHUSDT', '2500', 1_000));
        harness.runTimers();
        harness.logger.warn.mockClear();

        socket.emit('message', markFrame('BMTUSDT', '0.99999', 1_000, 1_700_000_000_000));
        socket.emit('message', markFrame('ETHUSDT', '2501', 2_000));
        harness.runTimers();

        expect(harness.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('(BMTUSDT)'),
        );
        expect(harness.feed.snapshot()).toEqual({});
        expect(socket.closed).toBe(true);
    });

    it('keeps one combined socket while every tracked symbol advances', () => {
        harness.feed.track([
            { symbol: 'BMTUSDT', quantity: '-1' },
            { symbol: 'ETHUSDT', quantity: '2' },
        ]);
        const socket = harness.sockets[0];
        socket.emit('open');
        socket.emit('message', markFrame('BMTUSDT', '0.03523', 1_000));
        socket.emit('message', markFrame('ETHUSDT', '2500', 1_000));
        harness.runTimers();
        harness.logger.warn.mockClear();

        socket.emit('message', markFrame('BMTUSDT', '0.03524', 2_000));
        socket.emit('message', markFrame('ETHUSDT', '2501', 2_000));
        harness.runTimers();

        expect(harness.logger.warn).not.toHaveBeenCalled();
        expect(socket.closed).toBe(false);
        expect(harness.sockets).toHaveLength(1);
        expect(harness.feed.snapshot()).toEqual({
            BMTUSDT: '0.03524',
            ETHUSDT: '2501',
        });
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
