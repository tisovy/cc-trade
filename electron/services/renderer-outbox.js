// One renderer, two lanes.
//
// "The order was filled" is a few hundred bytes and it leaves the desk down the
// same pipe as a hundred-and-eighteen-kilobyte order book, behind it. Nothing
// here makes the pipe faster. What it does is stop account traffic queueing
// behind market data that a newer frame has already replaced, and stop the desk
// stacking books nobody will ever read.
//
// The socket states its own backpressure and the desk reads it rather than
// guessing: `WebSocketConnection.sendFrame` writes to the net socket and records
// whether Node had to buffer the bytes (`outputBufferFull`), and the connection
// emits `drain` when that buffer empties. Between those two facts the desk holds
// market data back and lets account traffic past.
//
// Two rules decide everything below. An account frame is never dropped and never
// superseded — a fill, a rejection, a balance is a fact that happened once, and
// a renderer that will not take one is closed rather than quietly served a hole
// in its own account state. A market frame may be replaced by a newer frame for
// the same thing, because a book, a header, a tape and a candle series each
// state the whole of what they are: the newer one says everything the older one
// said. Only a resource that carries its complete current picture may state
// `supersede`; a paged catalog, a history page and a status line may not.

export const RENDERER_OUTBOX_LANES = Object.freeze({
    ACCOUNT: 'account',
    MARKET: 'market',
});

export const RENDERER_OUTBOX = Object.freeze({
    // A renderer that has not taken one of this many account frames is not
    // reading at all. Sized well above any real burst — a busy contract produces
    // a few account frames a second, so this is minutes of traffic, not seconds.
    ACCOUNT_QUEUE_FRAMES: 4096,
    // When this many market frames are waiting, a frame a newer one has already
    // replaced is worth dropping. Nothing else is: the desk sends a catalog as
    // up to a hundred and twenty-eight pages back to back, and a renderer that
    // loses one of them discards the whole contract list.
    MARKET_QUEUE_FRAMES: 64,
    // And the end of "queued rather than dropped", for the same reason the
    // account lane has one: a renderer holding this many frames it cannot be
    // relieved of is not reading.
    MARKET_QUEUE_LIMIT: 1_024,
    // What was superseded is worth one line in the record, not one line per
    // frame: the pathological case is a socket blocked for a minute at ten books
    // a second, and that is exactly when the record must not become the problem.
    REPORT_COOLDOWN_MS: 30_000,
});

// What counts as "the same thing" for superseding, and what counts as the same
// thing for the record. They differ by one dimension: the two candle series of a
// contract replace themselves independently, and are worth one line between them.
const keyOf = (resource, symbol, variant) => `${resource}|${symbol}|${variant}`;
const tallyKeyOf = (resource, symbol) => `${resource}|${symbol}`;

/**
 * Carries one renderer connection's outbound frames.
 *
 * `send` answers whether the frame was accepted for delivery — false only when
 * the connection is gone or has been closed for refusing to drain.
 */
export const createRendererOutbox = (connection, {
    now = () => Date.now(),
    onBacklog = () => {},
    onOverflow = () => {},
} = {}) => {
    const account = [];
    const market = [];
    // What this connection lost, per resource, since the last line written about
    // it. Held here rather than reported per frame for the reason above.
    const tallies = new Map();
    let blocked = false;
    let reportedAt = null;
    let abandoned = false;

    const tally = (frame, field) => {
        const existing = tallies.get(frame.tallyKey) ?? {
            resource: frame.resource,
            symbol: frame.symbol,
            superseded: 0,
            dropped: 0,
        };
        existing[field] += 1;
        tallies.set(frame.tallyKey, existing);
    };

    const report = (force) => {
        if (tallies.size === 0) return;
        const at = now();
        if (!force
            && reportedAt !== null
            && Number.isFinite(at)
            && Number.isFinite(reportedAt)
            && at - reportedAt < RENDERER_OUTBOX.REPORT_COOLDOWN_MS) return;
        reportedAt = at;
        for (const entry of tallies.values()) onBacklog(Object.freeze({ ...entry }));
        tallies.clear();
    };

    const write = (frame) => {
        connection.sendUTF(frame.text);
        // Set by the library from the socket write's own answer: true means Node
        // is now buffering for us, and anything sent next queues behind whatever
        // filled it.
        blocked = connection.outputBufferFull === true;
    };

    const flush = () => {
        while (!blocked && account.length > 0) write(account.shift());
        while (!blocked && market.length > 0) write(market.shift());
        // The backlog is what is being reported, so the line is written when it
        // ends rather than while it is still growing.
        if (!blocked && account.length === 0 && market.length === 0) report(false);
    };

    connection.on('drain', () => {
        blocked = false;
        flush();
    });

    return {
        send: (text, {
            lane = RENDERER_OUTBOX_LANES.MARKET,
            resource = null,
            symbol = null,
            variant = null,
            supersede = false,
        } = {}) => {
            if (abandoned || connection.connected !== true) return false;
            const frame = {
                text,
                resource,
                symbol,
                // Whether a newer frame may stand in for this one — which is
                // also the only thing that makes it droppable.
                replaceable: supersede === true && resource !== null,
                key: keyOf(resource, symbol, variant),
                tallyKey: tallyKeyOf(resource, symbol),
            };
            const isAccount = lane === RENDERER_OUTBOX_LANES.ACCOUNT;
            if (!blocked && account.length === 0 && (isAccount || market.length === 0)) {
                write(frame);
                return true;
            }
            if (isAccount) {
                if (account.length >= RENDERER_OUTBOX.ACCOUNT_QUEUE_FRAMES) {
                    abandoned = true;
                    report(true);
                    onOverflow();
                    connection.close();
                    return false;
                }
                account.push(frame);
                return true;
            }
            if (frame.replaceable) {
                const index = market.findIndex(queued => queued.key === frame.key);
                if (index !== -1) {
                    tally(market[index], 'superseded');
                    // Replaced where it stands, so the order the desk stated
                    // between different resources is the order they arrive in.
                    market[index] = frame;
                    return true;
                }
            }
            if (market.length >= RENDERER_OUTBOX.MARKET_QUEUE_FRAMES) {
                // Only a frame a newer one could have replaced is dropped. A
                // catalog page, a history page and a status line each state part
                // of something the renderer assembles, and losing one loses the
                // whole of it — the contract list, the history, the cause.
                const droppable = market.findIndex(queued => queued.replaceable);
                if (droppable !== -1) {
                    tally(market[droppable], 'dropped');
                    market.splice(droppable, 1);
                } else if (market.length >= RENDERER_OUTBOX.MARKET_QUEUE_LIMIT) {
                    abandoned = true;
                    report(true);
                    onOverflow();
                    connection.close();
                    return false;
                }
            }
            market.push(frame);
            return true;
        },
        // What is being held right now, for the tests and for anything that wants
        // to know whether this renderer is behind.
        pending: () => Object.freeze({
            account: account.length,
            market: market.length,
            blocked,
        }),
        dispose: () => {
            abandoned = true;
            account.length = 0;
            market.length = 0;
            report(true);
        },
    };
};
