// Positions are only re-read from /fapi/v3/positionRisk when the account
// itself changes — a fill, an ACCOUNT_UPDATE, an explicit refresh. Between
// those the market moves and every position row would sit frozen: a mark, a
// size and an unrealized PnL from an earlier minute, presented as the state of
// now. The public mark price stream carries the exact number the exchange
// values a position at, needs no credentials and costs no REST weight, so the
// desk follows the market because it is fed by it, not because it polls harder.

export const FUTURES_MARK_PRICE_TYPE = 'futures_position_marks';
export const FUTURES_MARK_PRICE_VERSION = 1;
export const FUTURES_MARK_PRICE_BATCH_MS = 500;
export const FUTURES_MARK_PRICE_RECONNECT_MS = 5000;

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

export const futuresMarkPriceStreamUrl = (streamOrigin, symbols) => {
    const streams = symbols.map(symbol => `${symbol.toLowerCase()}@markPrice@1s`).join('/');
    return `${streamOrigin}/stream?streams=${streams}`;
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
}) => {
    let symbols = [];
    let socket = null;
    let generation = 0;
    let stopped = false;
    let flushTimer = null;
    let reconnectTimer = null;
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

    const disconnect = () => {
        generation += 1;
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

        opened.on('message', (raw) => {
            if (socket !== opened) return;
            const event = readFuturesMarkPriceEvent(parseFrame(raw));
            if (!event || !symbols.includes(event.symbol)) return;
            marks.set(event.symbol, { markPrice: event.markPrice, updatedAt: event.updatedAt });
            scheduleFlush();
        });
        opened.on('error', (error) => {
            if (socket !== opened) return;
            logger.warn?.('Futures mark price stream error:', error?.code || error?.message);
        });
        opened.on('close', () => {
            if (socket !== opened) return;
            socket = null;
            clearMarks();
            scheduleReconnect(socketGeneration);
        });
    };

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
