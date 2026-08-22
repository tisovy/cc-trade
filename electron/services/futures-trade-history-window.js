// A bounded, order-independent reader for Binance Futures account trades.
//
// `/fapi/v1/userTrades` returns at most 1,000 rows and does not document a
// response order that is safe to use as a cursor.  A single latest page can
// therefore start in the middle of a position and silently drop its opening
// commission.  This reader freezes one inclusive time window and subdivides
// only full windows.  Short windows prove coverage; full terminal windows stay
// explicitly partial.  Canonical trade identities absorb the overlap caused by
// subdivision, and local sorting is the only ordering consumers observe.

import {
    futuresTradeHistoryEvidenceError,
    normalizeFuturesTradeHistorySymbol,
} from '../../src/utils/futuresTradeHistoryEvidence.js';

export {
    futuresTradeHistoryEvidenceError,
    normalizeFuturesTradeHistoryEvidence,
    normalizeFuturesTradeHistorySymbol,
    normalizeFuturesTradeHistoryTime,
} from '../../src/utils/futuresTradeHistoryEvidence.js';

export const FUTURES_TRADE_HISTORY_WINDOW = Object.freeze({
    PAGE_SIZE: 1_000,
    MAX_REQUESTS: 8,
});

const finiteTime = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const boundedInjectedLimit = (value, maximum) => {
    if (value === null || value === undefined || value === '') return maximum;
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return maximum;
    return Math.max(1, Math.min(maximum, parsed));
};

const tradeIdentity = (trade) => {
    const symbol = String(trade?.symbol ?? '').toUpperCase();
    const id = trade?.id;
    const exactId = typeof id === 'string' && /^\d{1,20}$/.test(id)
        ? id
        : (Number.isSafeInteger(id) && id >= 0 ? String(id) : null);
    if (symbol === '' || exactId === null) return null;
    return `${symbol}:${exactId}`;
};

const tradeEvidenceSignature = trade => JSON.stringify([
    trade?.id ?? null,
    trade?.orderId ?? null,
    String(trade?.symbol ?? '').toUpperCase(),
    String(trade?.side ?? '').toUpperCase(),
    String(trade?.positionSide ?? 'BOTH').toUpperCase(),
    trade?.price ?? null,
    trade?.quantity ?? null,
    trade?.realizedPnl ?? null,
    trade?.commission ?? null,
    String(trade?.commissionAsset ?? '').toUpperCase(),
    String(trade?.marginAsset ?? '').toUpperCase(),
    trade?.time ?? null,
]);

const invalidTradePage = (code, message) => Object.assign(new TypeError(message), { code });

const compareIntegerText = (left, right) => {
    const leftText = String(left ?? '');
    const rightText = String(right ?? '');
    if (/^\d+$/.test(leftText) && /^\d+$/.test(rightText)) {
        if (leftText === rightText) return 0;
        return BigInt(leftText) > BigInt(rightText) ? -1 : 1;
    }
    return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
};

const newestFirst = (left, right) => {
    const byTime = (finiteTime(right?.time) ?? 0) - (finiteTime(left?.time) ?? 0);
    return byTime === 0 ? compareIntegerText(left?.id, right?.id) : byTime;
};

const mergeIntervals = (intervals) => [...intervals]
    .sort((left, right) => left.from - right.from)
    .reduce((merged, interval) => {
        const last = merged[merged.length - 1];
        if (last === undefined || interval.from > last.to + 1) {
            merged.push({ ...interval });
            return merged;
        }
        last.to = Math.max(last.to, interval.to);
        return merged;
    }, []);

const newestCoveredInterval = (intervals, targetTo) => {
    const merged = mergeIntervals(intervals);
    return merged.find(interval => interval.from <= targetTo && interval.to >= targetTo) ?? null;
};

/**
 * Read a frozen inclusive account-trade window without trusting response order.
 *
 * `readWindow` receives `{startTime, endTime, limit}` and must return an array.
 * The result deliberately separates rows from coverage: rows returned by a full
 * unresolved slice remain useful evidence, but no exact round may infer that
 * the slice was completely enumerated.
 */
export const readFuturesTradeHistoryWindow = async ({
    readWindow,
    startTime,
    endTime,
    expectedSymbol = null,
    isCurrent = () => true,
    limits = FUTURES_TRADE_HISTORY_WINDOW,
} = {}) => {
    if (typeof readWindow !== 'function') throw new TypeError('readWindow must be a function');
    const targetFrom = finiteTime(startTime);
    const targetTo = finiteTime(endTime);
    if (targetFrom === null || targetTo === null || targetFrom > targetTo) {
        throw new RangeError('A valid inclusive trade-history window is required');
    }
    const wantedSymbol = expectedSymbol === null
        ? null
        : normalizeFuturesTradeHistorySymbol(expectedSymbol);
    if (expectedSymbol !== null && wantedSymbol === null) {
        throw new RangeError('A valid expected trade-history symbol is required');
    }
    const pageSize = boundedInjectedLimit(
        limits?.PAGE_SIZE,
        FUTURES_TRADE_HISTORY_WINDOW.PAGE_SIZE,
    );
    const maxRequests = boundedInjectedLimit(
        limits?.MAX_REQUESTS,
        FUTURES_TRADE_HISTORY_WINDOW.MAX_REQUESTS,
    );
    const rows = new Map();
    const completed = [];
    // Newest half first: when a bounded pass cannot finish, Closed Positions
    // still receive the most recent contiguous proof rather than the far edge
    // of the product window.
    const pending = [{ from: targetFrom, to: targetTo }];
    let requests = 0;
    let pageLimited = false;
    let aborted = false;

    while (pending.length > 0 && requests < maxRequests) {
        if (!isCurrent()) {
            aborted = true;
            break;
        }
        const window = pending.shift();
        const page = await readWindow({
            startTime: window.from,
            endTime: window.to,
            limit: pageSize,
        });
        requests += 1;
        if (!isCurrent()) {
            aborted = true;
            break;
        }
        if (!Array.isArray(page)) throw new TypeError('Trade-history page must be an array');
        if (page.length > pageSize) {
            throw invalidTradePage(
                'OVERSIZED_TRADE_PAGE',
                'Trade-history page exceeded its admitted row limit',
            );
        }
        // Validate the whole logical page before mutating held evidence. A bad
        // row followed by good rows must not leave a half-applied page behind,
        // and a repeated immutable trade identity cannot be resolved by input
        // order when the payloads disagree.
        const pageRows = new Map();
        for (const trade of page) {
            const evidenceError = futuresTradeHistoryEvidenceError(trade, {
                expectedSymbol: wantedSymbol,
                startTime: window.from,
                endTime: window.to,
            });
            if (evidenceError !== null) {
                throw invalidTradePage(evidenceError.code, evidenceError.message);
            }
            const identity = tradeIdentity(trade);
            const time = finiteTime(trade?.time);
            if (identity === null) {
                throw invalidTradePage(
                    'INVALID_TRADE_IDENTITY',
                    'Trade-history page contains a row without an exact trade identity',
                );
            }
            if (time === null || time < window.from || time > window.to) {
                throw invalidTradePage(
                    'OUT_OF_WINDOW_TRADE',
                    'Trade-history page contains a row outside its requested window',
                );
            }
            const existing = pageRows.get(identity) ?? rows.get(identity);
            if (existing !== undefined
                && tradeEvidenceSignature(existing) !== tradeEvidenceSignature(trade)) {
                throw invalidTradePage(
                    'CONFLICTING_TRADE_IDENTITY',
                    'Trade-history page reuses one trade identity for conflicting evidence',
                );
            }
            pageRows.set(identity, trade);
        }
        for (const [identity, trade] of pageRows) {
            rows.set(identity, trade);
        }
        if (page.length < pageSize) {
            completed.push(window);
            continue;
        }
        if (window.from >= window.to) {
            // More than a page shares one millisecond. There is no documented
            // page number on this endpoint, so skipping a peer would be worse
            // than admitting this instant is unresolved.
            pageLimited = true;
            continue;
        }
        const middle = window.from + Math.floor((window.to - window.from) / 2);
        pending.unshift(
            { from: middle + 1, to: window.to },
            { from: window.from, to: middle },
        );
    }
    if (pending.length > 0) pageLimited = true;
    const newestCovered = newestCoveredInterval(completed, targetTo);
    const complete = !aborted
        && !pageLimited
        && newestCovered !== null
        && newestCovered.from <= targetFrom;
    const sortedRows = [...rows.values()].sort(newestFirst);
    // Only one contiguous suffix may enter the position fold. Rows returned by
    // a full unresolved ancestor window are real, but mixing them across an
    // unread hole can manufacture a false flat boundary. Keep those separately
    // as acquisition evidence until the hole is enumerated.
    const coveredRows = newestCovered === null
        ? []
        : sortedRows.filter((trade) => {
            const time = finiteTime(trade?.time);
            return time !== null && time >= newestCovered.from && time <= newestCovered.to;
        });
    const coveredIds = new Set(coveredRows.map(tradeIdentity).filter(Boolean));

    return Object.freeze({
        rows: Object.freeze(coveredRows),
        unresolvedRows: Object.freeze(sortedRows.filter((trade) => {
            const identity = tradeIdentity(trade);
            return identity === null || !coveredIds.has(identity);
        })),
        coverage: Object.freeze({
            version: 2,
            targetFrom,
            targetTo,
            coveredFrom: complete ? targetFrom : newestCovered?.from ?? null,
            coveredTo: newestCovered?.to ?? null,
            complete,
            pageLimited,
            retentionLimited: false,
            continuityComplete: newestCovered !== null,
            aborted,
            requests,
        }),
    });
};

export default readFuturesTradeHistoryWindow;
