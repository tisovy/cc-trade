import {
    addFuturesWorkstationDecimals,
    compareFuturesWorkstationDecimals,
    isNonNegativeFuturesWorkstationDecimal,
    isPositiveFuturesWorkstationDecimal,
    normalizeFuturesWorkstationDecimal,
    subtractFuturesWorkstationDecimals,
} from './futures-workstation-decimal.js';

export const FUTURES_WORKSTATION_ORDER_BOOK_LIMITS = Object.freeze({
    SNAPSHOT_LEVELS_PER_SIDE: 1_000,
    RETAINED_LEVELS_PER_SIDE: 500,
    RENDERER_LEVELS_PER_SIDE: 24,
    BUFFERED_EVENTS: 2_048,
    BUFFERED_BYTES: 8 * 1024 * 1024,
});

export const FUTURES_WORKSTATION_ORDER_BOOK_PHASES = Object.freeze({
    BUFFERING: 'buffering',
    LIVE: 'live',
    RESYNC_REQUIRED: 'resync-required',
    STOPPED: 'stopped',
});

export class FuturesWorkstationOrderBookError extends Error {
    constructor(code) {
        super('Futures workstation order-book update was rejected');
        this.name = 'FuturesWorkstationOrderBookError';
        this.code = code;
    }
}

const fail = (code) => {
    throw new FuturesWorkstationOrderBookError(code);
};

const readUpdateId = (value) => {
    if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
        fail('INVALID_UPDATE_ID');
    }
    return BigInt(value);
};

const validateLevels = (levels, maximum) => {
    if (!Array.isArray(levels) || levels.length > maximum) fail('INVALID_DEPTH_LEVELS');
    const prices = new Set();
    return levels.map((level) => {
        if (!Array.isArray(level) || level.length !== 2) fail('INVALID_DEPTH_LEVEL');
        const [rawPrice, rawQuantity] = level;
        if (!isPositiveFuturesWorkstationDecimal(rawPrice)
            || !isNonNegativeFuturesWorkstationDecimal(rawQuantity)) {
            fail('INVALID_DEPTH_LEVEL');
        }
        const price = normalizeFuturesWorkstationDecimal(rawPrice);
        const quantity = normalizeFuturesWorkstationDecimal(rawQuantity);
        if (prices.has(price)) fail('DUPLICATE_DEPTH_PRICE');
        prices.add(price);
        return Object.freeze([price, quantity]);
    });
};

const validateSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        fail('INVALID_DEPTH_SNAPSHOT');
    }
    const keys = Object.keys(snapshot).sort();
    if (keys.join(',') !== ['asks', 'bids', 'lastUpdateId'].sort().join(',')) {
        fail('INVALID_DEPTH_SNAPSHOT');
    }
    return Object.freeze({
        lastUpdateId: readUpdateId(snapshot.lastUpdateId),
        lastUpdateIdString: snapshot.lastUpdateId,
        bids: validateLevels(
            snapshot.bids,
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.SNAPSHOT_LEVELS_PER_SIDE,
        ),
        asks: validateLevels(
            snapshot.asks,
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.SNAPSHOT_LEVELS_PER_SIDE,
        ),
    });
};

const validateDelta = (delta) => {
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) fail('INVALID_DEPTH_DELTA');
    const keys = Object.keys(delta).sort();
    if (keys.join(',') !== [
        'firstUpdateId',
        'finalUpdateId',
        'previousFinalUpdateId',
        'bids',
        'asks',
        'eventTime',
    ].sort().join(',')) fail('INVALID_DEPTH_DELTA');
    const firstUpdateId = readUpdateId(delta.firstUpdateId);
    const finalUpdateId = readUpdateId(delta.finalUpdateId);
    const previousFinalUpdateId = readUpdateId(delta.previousFinalUpdateId);
    if (firstUpdateId > finalUpdateId
        || !Number.isSafeInteger(delta.eventTime)
        || delta.eventTime < 0) {
        fail('INVALID_DEPTH_DELTA');
    }
    return Object.freeze({
        ...delta,
        firstUpdateIdBigInt: firstUpdateId,
        finalUpdateIdBigInt: finalUpdateId,
        previousFinalUpdateIdBigInt: previousFinalUpdateId,
        bids: validateLevels(delta.bids, FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.SNAPSHOT_LEVELS_PER_SIDE),
        asks: validateLevels(delta.asks, FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.SNAPSHOT_LEVELS_PER_SIDE),
    });
};

const trimSide = (side, descending) => {
    if (side.size <= FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RETAINED_LEVELS_PER_SIDE) return;
    const sorted = [...side.keys()].sort((left, right) => (
        compareFuturesWorkstationDecimals(left, right) * (descending ? -1 : 1)
    ));
    for (const price of sorted.slice(FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RETAINED_LEVELS_PER_SIDE)) {
        side.delete(price);
    }
};

const applyLevels = (side, levels) => {
    for (const [price, quantity] of levels) {
        if (quantity === '0') side.delete(price);
        else side.set(price, quantity);
    }
};

const formatSide = (side, descending, limit) => {
    const entries = [...side.entries()]
        .sort(([left], [right]) => (
            compareFuturesWorkstationDecimals(left, right) * (descending ? -1 : 1)
        ))
        .slice(0, limit);
    let total = '0';
    return Object.freeze(entries.map(([price, quantity]) => {
        total = addFuturesWorkstationDecimals(total, quantity);
        return Object.freeze({ price, quantity, total });
    }));
};

export class FuturesWorkstationOrderBook {
    constructor() {
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING;
        this.lastUpdateId = null;
        this.bids = new Map();
        this.asks = new Map();
        this.buffer = [];
        this.bufferedBytes = 0;
    }

    beginBootstrap() {
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING;
        this.lastUpdateId = null;
        this.bids.clear();
        this.asks.clear();
        this.buffer = [];
        this.bufferedBytes = 0;
    }

    push(rawDelta, frameBytes = 0) {
        if (this.phase === FUTURES_WORKSTATION_ORDER_BOOK_PHASES.STOPPED) {
            return Object.freeze({ applied: false, reason: 'stopped' });
        }
        const delta = validateDelta(rawDelta);
        if (!Number.isSafeInteger(frameBytes) || frameBytes < 0) fail('INVALID_DEPTH_FRAME_SIZE');
        if (this.phase === FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING) {
            if (this.buffer.length >= FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.BUFFERED_EVENTS
                || this.bufferedBytes + frameBytes
                    > FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.BUFFERED_BYTES) {
                this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
                this.buffer = [];
                this.bufferedBytes = 0;
                return Object.freeze({ applied: false, reason: 'overflow', resync: true });
            }
            this.buffer.push(delta);
            this.bufferedBytes += frameBytes;
            return Object.freeze({ applied: false, reason: 'buffered' });
        }
        if (this.phase !== FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE) {
            return Object.freeze({ applied: false, reason: 'resync-required', resync: true });
        }
        if (delta.finalUpdateIdBigInt <= this.lastUpdateId) {
            return Object.freeze({ applied: false, reason: 'duplicate' });
        }
        if (delta.previousFinalUpdateIdBigInt !== this.lastUpdateId) {
            this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
            return Object.freeze({ applied: false, reason: 'gap', resync: true });
        }
        this.applyDelta(delta);
        return Object.freeze({ applied: true, reason: 'live' });
    }

    bootstrap(rawSnapshot) {
        if (this.phase !== FUTURES_WORKSTATION_ORDER_BOOK_PHASES.BUFFERING) {
            fail('INVALID_BOOTSTRAP_PHASE');
        }
        const snapshot = validateSnapshot(rawSnapshot);
        const retained = this.buffer.filter(delta => delta.finalUpdateIdBigInt >= snapshot.lastUpdateId);
        const firstIndex = retained.findIndex(delta => (
            delta.firstUpdateIdBigInt <= snapshot.lastUpdateId
            && delta.finalUpdateIdBigInt >= snapshot.lastUpdateId
        ));
        if (firstIndex < 0) {
            this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
            this.buffer = [];
            this.bufferedBytes = 0;
            return Object.freeze({ live: false, reason: 'snapshot-not-bridged', resync: true });
        }

        applyLevels(this.bids, snapshot.bids);
        applyLevels(this.asks, snapshot.asks);
        this.lastUpdateId = snapshot.lastUpdateId;
        const applicable = retained.slice(firstIndex);
        for (let index = 0; index < applicable.length; index += 1) {
            const delta = applicable[index];
            if (index > 0 && delta.previousFinalUpdateIdBigInt !== this.lastUpdateId) {
                this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
                this.bids.clear();
                this.asks.clear();
                this.buffer = [];
                this.bufferedBytes = 0;
                return Object.freeze({ live: false, reason: 'buffer-gap', resync: true });
            }
            if (delta.finalUpdateIdBigInt <= this.lastUpdateId) continue;
            this.applyDelta(delta);
        }
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE;
        this.buffer = [];
        this.bufferedBytes = 0;
        return Object.freeze({ live: true, reason: 'bootstrapped' });
    }

    applyDelta(delta) {
        applyLevels(this.bids, delta.bids);
        applyLevels(this.asks, delta.asks);
        trimSide(this.bids, true);
        trimSide(this.asks, false);
        this.lastUpdateId = delta.finalUpdateIdBigInt;
        const bestBid = formatSide(this.bids, true, 1)[0]?.price;
        const bestAsk = formatSide(this.asks, false, 1)[0]?.price;
        if (bestBid && bestAsk && compareFuturesWorkstationDecimals(bestBid, bestAsk) >= 0) {
            this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.RESYNC_REQUIRED;
            fail('CROSSED_ORDER_BOOK');
        }
    }

    toRendererView() {
        if (this.phase !== FUTURES_WORKSTATION_ORDER_BOOK_PHASES.LIVE
            || this.lastUpdateId === null) return null;
        const bids = formatSide(
            this.bids,
            true,
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RENDERER_LEVELS_PER_SIDE,
        );
        const asks = formatSide(
            this.asks,
            false,
            FUTURES_WORKSTATION_ORDER_BOOK_LIMITS.RENDERER_LEVELS_PER_SIDE,
        );
        const spread = bids[0] && asks[0]
            ? subtractFuturesWorkstationDecimals(asks[0].price, bids[0].price)
            : '0';
        return Object.freeze({
            lastUpdateId: this.lastUpdateId.toString(),
            bids,
            asks,
            spread,
        });
    }

    stop() {
        this.phase = FUTURES_WORKSTATION_ORDER_BOOK_PHASES.STOPPED;
        this.lastUpdateId = null;
        this.bids.clear();
        this.asks.clear();
        this.buffer = [];
        this.bufferedBytes = 0;
    }
}
