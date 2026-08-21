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
//
// Which makes `supersede` the one gate on a queued frame leaving this queue any
// way but through the socket. Being replaced and being dropped are the same
// removal seen from two sides, so they ask the same question of the frame that
// would go — and a frame that answers no is passed over by both.

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

// How big a frame is, asked once and only of a frame that is actually waiting.
// Measured at 5.4µs for a 60 KB book — nothing at ten frames a second, but it is
// asked on the path that is already behind, so it is not asked on the path that
// is not: a frame written straight through never carries a size.
const sizeOf = (frame) => {
    if (frame.bytes === null) frame.bytes = Buffer.byteLength(frame.text);
    return frame.bytes;
};

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
    // What this connection lost and how far behind it fell, per resource, since
    // the last line written about it. Held here rather than reported per frame
    // for the reason above.
    const tallies = new Map();
    let blocked = false;
    let reportedAt = null;
    let abandoned = false;

    const tallyOf = (frame) => {
        const existing = tallies.get(frame.tallyKey);
        if (existing) return existing;
        const created = {
            resource: frame.resource,
            symbol: frame.symbol,
            superseded: 0,
            dropped: 0,
            // What is waiting now, and the worst it got. The line is written when
            // the backlog ends, and by then what is waiting is nothing — so the
            // reading worth keeping is the peak, not the remainder.
            frames: 0,
            bytes: 0,
            peakFrames: 0,
            peakBytes: 0,
        };
        tallies.set(frame.tallyKey, created);
        return created;
    };

    const tally = (frame, field) => { tallyOf(frame)[field] += 1; };

    const entered = (frame) => {
        const entry = tallyOf(frame);
        entry.frames += 1;
        entry.bytes += sizeOf(frame);
        if (entry.frames > entry.peakFrames) entry.peakFrames = entry.frames;
        if (entry.bytes > entry.peakBytes) entry.peakBytes = entry.bytes;
    };

    const left = (frame) => {
        const entry = tallies.get(frame.tallyKey);
        if (!entry) return;
        entry.frames -= 1;
        entry.bytes -= frame.bytes ?? 0;
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
        for (const entry of tallies.values()) {
            onBacklog(Object.freeze({
                resource: entry.resource,
                symbol: entry.symbol,
                superseded: entry.superseded,
                dropped: entry.dropped,
                frames: entry.peakFrames,
                bytes: entry.peakBytes,
            }));
        }
        tallies.clear();
    };

    const write = (frame) => {
        if (frame.queued) left(frame);
        connection.sendUTF(frame.text);
        // Set by the library from the socket write's own answer: true means Node
        // is now buffering for us, and anything sent next queues behind whatever
        // filled it.
        blocked = connection.outputBufferFull === true;
    };

    const queue = (lane, frame) => {
        frame.queued = true;
        entered(frame);
        lane.push(frame);
    };

    const flush = () => {
        if (connection.connected !== true) return;
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
                // Asked for only if this frame ends up waiting; see `sizeOf`.
                bytes: null,
                queued: false,
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
                queue(account, frame);
                return true;
            }
            if (frame.replaceable) {
                // Both halves of the test matter. `replaceable` is the one gate
                // on removing a queued frame at all — superseding a frame is
                // removing it — and the key alone does not name the market a
                // frame belongs to: Spot sends a `depth` for a contract under
                // the same resource and symbol the futures workstation does. A
                // queued frame that may not be replaced is passed over here for
                // the same reason it is passed over when the queue is full.
                const index = market.findIndex(queued => (
                    queued.replaceable && queued.key === frame.key
                ));
                if (index !== -1) {
                    tally(market[index], 'superseded');
                    left(market[index]);
                    // Replaced where it stands, so the order the desk stated
                    // between different resources is the order they arrive in.
                    frame.queued = true;
                    entered(frame);
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
                    left(market[droppable]);
                    market.splice(droppable, 1);
                } else if (market.length >= RENDERER_OUTBOX.MARKET_QUEUE_LIMIT) {
                    abandoned = true;
                    report(true);
                    onOverflow();
                    connection.close();
                    return false;
                }
            }
            queue(market, frame);
            return true;
        },
        // A market activation can retire one resource while the renderer keeps
        // using this same transport for another market. Frames already handed
        // to the kernel preserve socket order and necessarily precede the
        // activation answer; only frames still held here can cross that answer,
        // and only complete/replaceable frames are safe to withdraw.
        discardMarket: (resource, symbol = null, variant = null) => {
            const key = keyOf(resource, symbol, variant);
            let removed = 0;
            for (let index = market.length - 1; index >= 0; index -= 1) {
                const queued = market[index];
                if (!queued.replaceable || queued.key !== key) continue;
                left(queued);
                market.splice(index, 1);
                removed += 1;
            }
            if (!blocked && account.length === 0 && market.length === 0) report(false);
            return removed;
        },
        // What is being held right now, for the tests and for anything that wants
        // to know whether this renderer is behind.
        pending: () => Object.freeze({
            account: account.length,
            market: market.length,
            blocked,
            // Depth in bytes as well as in frames: sixty-four frames is a
            // different backlog when they are status lines than when they are
            // books, and only one of the two readings says which.
            bytes: [...tallies.values()].reduce((total, entry) => total + entry.bytes, 0),
            resources: Object.freeze(Object.fromEntries(
                [...tallies].map(([key, entry]) => [key, Object.freeze({
                    frames: entry.frames,
                    bytes: entry.bytes,
                    peakFrames: entry.peakFrames,
                    peakBytes: entry.peakBytes,
                    superseded: entry.superseded,
                    dropped: entry.dropped,
                })]),
            )),
        }),
        dispose: () => {
            abandoned = true;
            account.length = 0;
            market.length = 0;
            report(true);
        },
    };
};
