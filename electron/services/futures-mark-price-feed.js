// Positions are only re-read from /fapi/v3/positionRisk when the account
// itself changes — a fill, an ACCOUNT_UPDATE, an explicit refresh. Between
// those the market moves and every position row would sit frozen: a mark, a
// size and an unrealized PnL from an earlier minute, presented as the state of
// now. The public mark price stream carries the exact number the exchange
// values a position at, needs no credentials and costs no REST weight, so the
// desk follows the market because it is fed by it, not because it polls harder.

export const FUTURES_MARK_PRICE_TYPE = 'futures_position_marks';
export const FUTURES_MARK_PRICE_VERSION = 1;
// Coalesce marks that arrive together for several open contracts. The source
// itself is one frame per second; aggregate trades no longer publish position
// valuations.
//
// Measured rather than estimated, 2026-08-26, four contracts on one combined
// stream through the operator's proxy: across 88 seconds in which all four
// were delivered, the spread between the first and last arrival was 2ms at the
// median, 3ms at the 95th percentile and 6ms at its worst. The 200ms this was
// is four times what folding them together ever needed, and every millisecond
// of it is added to the age of the number a position is valued at — a value
// the exchange already publishes only once a second and which reaches the desk
// a further 220ms later (p95 232ms). Four times the worst measured spread.
export const FUTURES_MARK_PRICE_BATCH_MS = 25;
export const FUTURES_MARK_PRICE_RECONNECT_MS = 5000;
// One mark per symbol per second is the contract, so silence this long is not a
// quiet market — it is a feed that stopped delivering without closing.
export const FUTURES_MARK_PRICE_STALL_MS = 15000;

// A feed instance owns one revision namespace. Renderer connections can outlive
// a feed rebuild inside this process, so a revision alone cannot tell revision
// 1 of the replacement from a delayed revision 13 of the retired instance.
let futuresMarkPriceFeedEpoch = 0;
const nextFuturesMarkPriceFeedEpoch = () => {
    futuresMarkPriceFeedEpoch += 1;
    return futuresMarkPriceFeedEpoch;
};

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

// One stream per symbol: the same mark the exchange uses for unrealized PnL and
// liquidation. The chart already owns trade/tape data; subscribing to aggTrade a
// second time here spent socket and CPU work to manufacture a non-exchange PnL.
export const futuresMarkPriceStreamUrl = (streamOrigin, symbols) => {
    const streams = symbols
        .map(symbol => `${symbol.toLowerCase()}@markPrice@1s`)
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
    // When the exchange will next charge this contract funding. Carried on every
    // mark frame, once a second, and dropped here until 2026-08-20 — while the
    // desk asked the income record every thirty seconds whether funding had
    // happened yet. It is the schedule of the only event that moves the settled
    // figure, delivered free on a public socket, and a contract does not
    // announce it anywhere else.
    //
    // Zero is not a time. Contracts whose funding the exchange has not scheduled
    // send it as 0, and treating that as an instant would put every settlement
    // in 1970.
    const nextSettlementAt = Number.isSafeInteger(event.T) && event.T > 0 ? event.T : null;
    return { symbol, markPrice, updatedAt: eventTime, nextSettlementAt };
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
    // Called with the contract whose funding has just settled, as the mark
    // stream reports it. Optional: a desk that only wants prices passes nothing.
    onSettlement = null,
    logger = console,
    clock = { setTimeout, clearTimeout },
    batchIntervalMs = FUTURES_MARK_PRICE_BATCH_MS,
    reconnectDelayMs = FUTURES_MARK_PRICE_RECONNECT_MS,
    stallTimeoutMs = FUTURES_MARK_PRICE_STALL_MS,
    feedEpoch = null,
}) => {
    let symbols = [];
    let socket = null;
    let generation = 0;
    let stopped = false;
    let flushTimer = null;
    let reconnectTimer = null;
    let stallTimer = null;
    let published = false;
    let publicationRevision = 0;
    const publicationEpoch = Number.isSafeInteger(feedEpoch) && feedEpoch > 0
        ? feedEpoch
        : nextFuturesMarkPriceFeedEpoch();
    const marks = new Map();
    // Exchange event time is the proof that one contract, rather than merely
    // the combined socket, is still moving forward. Keep it across reconnects:
    // marks are withdrawn there because their prices stop being live, but a
    // delayed first frame on the replacement socket is not newer for having
    // crossed a new connection.
    const markEventTimes = new Map();
    const progressedSymbols = new Set();
    // The settlement each tracked contract is counting down to. Kept apart from
    // `marks` on purpose: marks are cleared whenever the feed stops being able
    // to vouch for a price — a close, a stall, a rebuild — and the countdown is
    // not a price. Dropping it there would lose the baseline exactly across the
    // gap where a settlement is most likely to have gone unobserved, which is
    // the one case this exists for.
    const settlements = new Map();

    // A settlement is not a clock reading; it is the countdown moving on.
    //
    // Every mark frame says when this contract is next charged. While that
    // instant stands still, nothing has happened. The moment it steps forward,
    // the settlement it named has been made — and that is the event, observed
    // rather than waited for, on a socket the desk is already paying nothing
    // for. A contract seen for the first time only sets the baseline: it has
    // announced its next charge, not made one.
    const noteSettlementSchedule = (symbol, nextSettlementAt, updatedAt) => {
        const held = settlements.get(symbol);
        // Marks are cleared on disconnect because their prices stop being live,
        // but this schedule survives the gap. Keep its event-time provenance as
        // well, otherwise the first delayed frame after reconnect could rewind
        // the baseline even though the ordinary mark admission guard no longer
        // has a held price with which to reject it.
        if (Number.isSafeInteger(held?.updatedAt)
            && (!Number.isSafeInteger(updatedAt) || updatedAt <= held.updatedAt)) return;
        if (nextSettlementAt === null) {
            if (held !== undefined && Number.isSafeInteger(updatedAt)) {
                settlements.set(symbol, { ...held, updatedAt });
            }
            return;
        }
        if (held === undefined) {
            settlements.set(symbol, { nextSettlementAt, updatedAt });
            return;
        }
        const advanced = nextSettlementAt > held.nextSettlementAt;
        // A fresh exchange frame may legitimately move the next funding time in
        // either direction. Before the held boundary that is a reschedule, not a
        // charge. Adopt it as the new baseline, and report an advance only when
        // exchange event time proves the boundary being observed was reached.
        const boundaryReached = Number.isSafeInteger(updatedAt)
            && updatedAt >= held.nextSettlementAt;
        settlements.set(symbol, { nextSettlementAt, updatedAt });
        if (!advanced || !boundaryReached) return;
        try {
            onSettlement?.(symbol);
        } catch (error) {
            logger.warn?.('Futures settlement observer failed:', error?.message);
        }
    };

    const publish = () => {
        publicationRevision += 1;
        broadcast({
            type: FUTURES_MARK_PRICE_TYPE,
            version: FUTURES_MARK_PRICE_VERSION,
            feedEpoch: publicationEpoch,
            revision: publicationRevision,
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

    // Rebuilding the socket because the tracked set changed is not the feed
    // going quiet. The contracts that stayed in the set are still being marked
    // and their last mark is at most a second old; throwing it away blanked the
    // live value of every open position each time any one of them was opened or
    // closed, and every one of those rows then valued itself off an account
    // snapshot from an earlier read. Only the symbols that left are dropped.
    // Every other path here — a close, an error, a stall, a stop — still clears
    // everything, so a feed that has actually stopped delivering still falls the
    // desk back to the snapshot.
    const retainMarks = (kept) => {
        let dropped = false;
        for (const symbol of [...marks.keys()]) {
            if (kept.includes(symbol)) continue;
            marks.delete(symbol);
            dropped = true;
        }
        if (!dropped) return;
        if (flushTimer !== null) {
            clock.clearTimeout(flushTimer);
            flushTimer = null;
        }
        publish();
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
        progressedSymbols.clear();
    };

    // A socket that opens and then goes quiet is the one failure this feed kept
    // to itself: 'open' was logged, no 'close' ever followed, and the desk went
    // on presenting an unrealized PnL from an earlier account read as the
    // market's own. Silence against a one-per-second contract is reported and
    // the combined stream is rebuilt before any retained mark can stay live.
    const armStallCheck = () => {
        if (stallTimer !== null || stopped || symbols.length === 0) return;
        stallTimer = clock.setTimeout(() => {
            stallTimer = null;
            if (symbols.length === 0) return;
            // A socket that never came back is as silent as one that came back
            // and said nothing. Marks retained across a rebuild do not outlive
            // the window on the strength of the rebuild having failed to open.
            if (socket === null) {
                clearMarks();
                return;
            }
            const stalled = symbols.filter(symbol => !progressedSymbols.has(symbol));
            if (stalled.length > 0) {
                logger.warn?.(
                    `Futures mark price stream delivered nothing for ${Math.round(stallTimeoutMs / 1000)}s `
                    + `(${stalled.join(', ')}); position values are the account snapshot, not the market.`,
                );
                // Saying so was all this did, and the desk went on presenting the
                // last mark as the market's own price. A socket that is open and
                // silent against a one-per-second contract is a dead feed: its
                // marks are dropped, so positions fall back to the account
                // snapshot, and the socket is rebuilt.
                restart();
                return;
            }
            progressedSymbols.clear();
            armStallCheck();
        }, stallTimeoutMs);
    };

    const disconnect = ({ retain = null } = {}) => {
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
        if (retain === null) clearMarks();
        else retainMarks(retain);
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
            if (mark === null || !symbols.includes(mark.symbol)) return;
            const held = marks.get(mark.symbol);
            const acceptedAt = markEventTimes.get(mark.symbol);
            const timed = Number.isSafeInteger(mark.updatedAt);
            // Only strict exchange-time progress may change a timed reading.
            // The separate timestamp memory survives mark withdrawal, so an
            // equal replay or conflict cannot regain authority after reconnect.
            if (Number.isSafeInteger(acceptedAt)
                && (!timed || mark.updatedAt <= acceptedAt)) return;
            // Before the first timed frame, retain the legacy ability to display
            // one valid untimed mark. It is not a liveness proof, and another
            // untimed frame cannot replace it with an unordered conflict.
            if (!timed && held !== undefined) return;
            if (timed) {
                markEventTimes.set(mark.symbol, mark.updatedAt);
                progressedSymbols.add(mark.symbol);
            }
            noteSettlementSchedule(mark.symbol, mark.nextSettlementAt, mark.updatedAt);
            if (held?.markPrice === mark.markPrice && held?.updatedAt === mark.updatedAt) return;
            marks.set(mark.symbol, {
                markPrice: mark.markPrice,
                updatedAt: mark.updatedAt,
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
            const nextSymbols = new Set(next);
            // A contract with no position left is charged no funding, and its
            // countdown would be stale if it is opened again days later — a
            // stale baseline reads as a settlement on the first frame back.
            for (const symbol of [...settlements.keys()]) {
                if (!nextSymbols.has(symbol)) settlements.delete(symbol);
            }
            // Event-time admission belongs to the same tracked lifetime. Once a
            // contract leaves, a later position in it starts from its own first
            // exchange frame rather than a timestamp remembered for the old one.
            for (const symbol of [...markEventTimes.keys()]) {
                if (!nextSymbols.has(symbol)) markEventTimes.delete(symbol);
            }
            disconnect({ retain: next });
            symbols = next;
            connect();
            // The rebuilt socket arms this itself when it opens, but a socket
            // that never opens would leave the retained marks alive with nothing
            // measuring their age. Arming here puts them under the same window
            // as any other mark; a second call once the socket opens is a no-op.
            armStallCheck();
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
            settlements.clear();
            markEventTimes.clear();
            disconnect();
        },
        // Test and diagnostic surface: what the feed believes it is watching.
        get trackedSymbols() {
            return [...symbols];
        },
    };
};
