// Positions are only re-read from /fapi/v3/positionRisk when the account
// itself changes — a fill, an ACCOUNT_UPDATE, an explicit refresh. Between
// those the market moves and every position row would sit frozen: a mark, a
// size and an unrealized PnL from an earlier minute, presented as the state of
// now. The public mark price stream carries the exact number the exchange
// values a position at, needs no credentials and costs no REST weight, so the
// desk follows the market because it is fed by it, not because it polls harder.

export const FUTURES_MARK_PRICE_TYPE = 'futures_position_marks';
export const FUTURES_MARK_PRICE_VERSION = 1;
// One batch per repaint window. The mark arrives once a second, but the prints
// between two marks are what carries a position's value through a fast move, so
// the window is the rate the operator can actually read rather than the mark's.
export const FUTURES_MARK_PRICE_BATCH_MS = 200;
export const FUTURES_MARK_PRICE_RECONNECT_MS = 5000;
// One mark per symbol per second is the contract, so silence this long is not a
// quiet market — it is a feed that stopped delivering without closing.
export const FUTURES_MARK_PRICE_STALL_MS = 15000;

// One mark per symbol per second is what the desk reads; the stream is public,
// so the symbol set is the only thing that ever leaves the process.
export const readFuturesPositionSymbols = (positions) => {
    const symbols = new Set();
    for (const position of Array.isArray(positions) ? positions : []) {
        const symbol = typeof position?.symbol === 'string' ? position.symbol.toUpperCase() : '';
        const quantity = Number(position?.quantity);
        if (!symbol || !Number.isFinite(quantity) || quantity === 0) continue;
        symbols.add(symbol);
    }
    return [...symbols].sort();
};

// The unrouted market paths `/ws` and `/stream` were decommissioned on
// 2026-04-23; `<symbol>@markPrice@1s` is a compiled route on `/market/stream`
// (see docs/futures_phase8_workstation_adr.md, WebSocket registry). A
// decommissioned path is the worst kind of wrong here: the handshake still
// succeeds and the socket stays open, so nothing reports an error — it simply
// never delivers a frame, and every position keeps the value the account
// snapshot gave it while the chart moves on.
export const FUTURES_MARK_PRICE_ROUTED_PREFIX = '/market/stream?streams=';

// Two streams per symbol: the mark the exchange values and liquidates the
// position at, and the prints that happen between two marks. Binance publishes
// no mark faster than one a second, so the second stream is the only way a
// position's value can move with a fast market — and it is the price the
// contract actually traded at, not a display of it, so nothing the operator sets
// on the tape can hold it still.
export const futuresMarkPriceStreamUrl = (streamOrigin, symbols) => {
    const streams = symbols
        .flatMap(symbol => [`${symbol.toLowerCase()}@markPrice@1s`, `${symbol.toLowerCase()}@aggTrade`])
        .join('/');
    return `${streamOrigin}${FUTURES_MARK_PRICE_ROUTED_PREFIX}${streams}`;
};

export const readFuturesMarkPriceEvent = (payload) => {
    const event = payload?.data ?? payload;
    if (!event || typeof event !== 'object' || event.e !== 'markPriceUpdate') return null;
    const symbol = typeof event.s === 'string' ? event.s.toUpperCase() : '';
    const markPrice = typeof event.p === 'string' ? event.p : null;
    if (!symbol || markPrice === null || !(Number(markPrice) > 0)) return null;
    const eventTime = Number.isSafeInteger(event.E) ? event.E : null;
    return { symbol, markPrice, updatedAt: eventTime };
};

// The last price the contract traded at. Separate from the mark on purpose: the
// two are different numbers, and only one of them decides a liquidation.
export const readFuturesLastTradeEvent = (payload) => {
    const event = payload?.data ?? payload;
    if (!event || typeof event !== 'object' || event.e !== 'aggTrade') return null;
    const symbol = typeof event.s === 'string' ? event.s.toUpperCase() : '';
    const lastPrice = typeof event.p === 'string' ? event.p : null;
    if (!symbol || lastPrice === null || !(Number(lastPrice) > 0)) return null;
    const tradeTime = Number.isSafeInteger(event.T) ? event.T : null;
    return { symbol, lastPrice, tradedAt: tradeTime };
};

const sameSymbols = (left, right) => left.length === right.length
    && left.every((symbol, index) => symbol === right[index]);

const parseFrame = (raw) => {
    try {
        return JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
        return null;
    }
};

/**
 * Tracks the open-position symbol set and keeps a public mark price stream
 * subscribed to exactly that set.
 *
 * The feed owns liveness: when the socket is not connected it clears the marks
 * it has published, so a consumer falls back to the account snapshot instead of
 * reading a mark that stopped updating as if it were current.
 */
export const createFuturesMarkPriceFeed = ({
    streamOrigin,
    createSocket,
    broadcast,
    logger = console,
    clock = { setTimeout, clearTimeout },
    batchIntervalMs = FUTURES_MARK_PRICE_BATCH_MS,
    reconnectDelayMs = FUTURES_MARK_PRICE_RECONNECT_MS,
    stallTimeoutMs = FUTURES_MARK_PRICE_STALL_MS,
}) => {
    let symbols = [];
    let socket = null;
    let generation = 0;
    let stopped = false;
    let flushTimer = null;
    let reconnectTimer = null;
    let stallTimer = null;
    let markSeenSinceCheck = false;
    let stallReported = false;
    let published = false;
    const marks = new Map();

    const publish = () => {
        broadcast({
            type: FUTURES_MARK_PRICE_TYPE,
            version: FUTURES_MARK_PRICE_VERSION,
            marks: Object.fromEntries(marks),
        });
        published = marks.size > 0;
    };

    const clearMarks = () => {
        if (flushTimer !== null) {
            clock.clearTimeout(flushTimer);
            flushTimer = null;
        }
        const hadMarks = marks.size > 0 || published;
        marks.clear();
        if (hadMarks) publish();
    };

    const scheduleFlush = () => {
        if (flushTimer !== null) return;
        flushTimer = clock.setTimeout(() => {
            flushTimer = null;
            publish();
        }, batchIntervalMs);
    };

    const clearStallCheck = () => {
        if (stallTimer !== null) {
            clock.clearTimeout(stallTimer);
            stallTimer = null;
        }
        markSeenSinceCheck = false;
        stallReported = false;
    };

    // A socket that opens and then goes quiet is the one failure this feed kept
    // to itself: 'open' was logged, no 'close' ever followed, and the desk went
    // on presenting an unrealized PnL from an earlier account read as the
    // market's own. Silence against a one-per-second contract is reported as
    // what it is, and so is its end.
    const armStallCheck = () => {
        if (stallTimer !== null || stopped || symbols.length === 0) return;
        stallTimer = clock.setTimeout(() => {
            stallTimer = null;
            if (socket === null || symbols.length === 0) return;
            if (markSeenSinceCheck) {
                if (stallReported) {
                    logger.info?.(
                        `Futures mark price stream is delivering again: ${symbols.join(', ')}.`,
                    );
                }
                stallReported = false;
            } else {
                logger.warn?.(
                    `Futures mark price stream delivered nothing for ${Math.round(stallTimeoutMs / 1000)}s `
                    + `(${symbols.join(', ')}); position values are the account snapshot, not the market.`,
                );
                // Saying so was all this did, and the desk went on presenting the
                // last mark as the market's own price. A socket that is open and
                // silent against a one-per-second contract is a dead feed: its
                // marks are dropped, so positions fall back to the account
                // snapshot, and the socket is rebuilt.
                restart();
                return;
            }
            markSeenSinceCheck = false;
            armStallCheck();
        }, stallTimeoutMs);
    };

    const disconnect = () => {
        generation += 1;
        clearStallCheck();
        if (reconnectTimer !== null) {
            clock.clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        const stale = socket;
        socket = null;
        if (stale) {
            try {
                stale.close();
            } catch (error) {
                logger.warn?.('Failed to close futures mark price stream:', error?.message);
            }
        }
        clearMarks();
    };

    const connect = () => {
        if (stopped || symbols.length === 0) return;
        const socketGeneration = generation;
        let opened;
        try {
            opened = createSocket(futuresMarkPriceStreamUrl(streamOrigin, symbols));
        } catch (error) {
            logger.warn?.('Failed to open futures mark price stream:', error?.code || error?.message);
            scheduleReconnect(socketGeneration);
            return;
        }
        socket = opened;

        // Every other Binance socket in this process says when it connects and
        // when it drops. Without the same line here, a desk showing a mark that
        // has not moved for a minute gives the operator no way to tell a quiet
        // market from a dead feed.
        opened.on('open', () => {
            if (socket !== opened) return;
            logger.info?.(`Futures mark price stream connected: ${symbols.join(', ')}.`);
            armStallCheck();
        });

        opened.on('message', (raw) => {
            if (socket !== opened) return;
            const frame = parseFrame(raw);
            const mark = readFuturesMarkPriceEvent(frame);
            if (mark !== null) {
                if (!symbols.includes(mark.symbol)) return;
                // Liveness is the mark's alone: a contract can go minutes
                // without a print and the feed is not stalled for it.
                markSeenSinceCheck = true;
                marks.set(mark.symbol, {
                    ...marks.get(mark.symbol),
                    markPrice: mark.markPrice,
                    updatedAt: mark.updatedAt,
                });
                scheduleFlush();
                return;
            }
            const trade = readFuturesLastTradeEvent(frame);
            if (trade === null || !symbols.includes(trade.symbol)) return;
            const held = marks.get(trade.symbol);
            // Nothing to attach it to yet. The first mark is a second away, and
            // a price with no mark beside it has no confirmed reading to be an
            // estimate of.
            if (held === undefined) return;
            marks.set(trade.symbol, {
                ...held,
                lastPrice: trade.lastPrice,
                lastPriceAt: trade.tradedAt,
            });
            scheduleFlush();
        });
        opened.on('error', (error) => {
            if (socket !== opened) return;
            logger.warn?.('Futures mark price stream error:', error?.code || error?.message);
        });
        opened.on('close', () => {
            if (socket !== opened) return;
            socket = null;
            clearStallCheck();
            logger.warn?.(
                'Futures mark price stream closed; positions fall back to the account snapshot.',
            );
            clearMarks();
            scheduleReconnect(socketGeneration);
        });
    };

    // A stall is a socket that will not deliver, and rebuilding it immediately —
    // every stall window, for as long as the feed stays dead — is a reconnect
    // loop with no spacing. The marks go the moment the stall is seen; the
    // socket comes back on the same delay a close would have used.
    function restart() {
        if (stopped || symbols.length === 0) return;
        disconnect();
        scheduleReconnect(generation);
    }

    function scheduleReconnect(socketGeneration) {
        if (stopped || symbols.length === 0 || socketGeneration !== generation) return;
        if (reconnectTimer !== null) return;
        reconnectTimer = clock.setTimeout(() => {
            reconnectTimer = null;
            if (socketGeneration !== generation) return;
            connect();
        }, reconnectDelayMs);
    }

    return {
        // Reconnecting on every account snapshot would drop the feed exactly
        // when a fill makes it most interesting, so only a changed symbol set
        // rebuilds the socket.
        track(positions) {
            if (stopped) return;
            const next = readFuturesPositionSymbols(positions);
            if (sameSymbols(next, symbols)) return;
            disconnect();
            symbols = next;
            connect();
        },
        // A diagnostic reader sees only marks the feed still considers live.
        // Disconnect and stall handling already clear this map, so the snapshot
        // cannot accidentally extend a stale mark's lifetime.
        snapshot() {
            return Object.freeze(Object.fromEntries(
                [...marks.entries()]
                    .filter(([, reading]) => typeof reading?.markPrice === 'string')
                    .map(([symbol, reading]) => [symbol, reading.markPrice]),
            ));
        },
        stop() {
            stopped = true;
            symbols = [];
            disconnect();
        },
        // Test and diagnostic surface: what the feed believes it is watching.
        get trackedSymbols() {
            return [...symbols];
        },
    };
};
