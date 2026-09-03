/**
 * The score a trade-history read keeps against the private stream.
 *
 * The desk re-reads `/userTrades` after every fill burst to confirm what the
 * stream already reported, and the point of the counters here is to find out
 * whether that read ever brings anything the stream did not. Until 2026-09-03
 * it kept no score: 88 reads that day, and nothing in the record could say
 * whether one of them had found a fill the socket missed. A month of zeros is
 * the evidence for ending the read; one non-zero is the evidence for keeping
 * it, and this is where both are counted.
 *
 * Counts only. No price, size or identity leaves this module, so what it
 * answers can go straight into the desk's record.
 */
import { FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT } from '../../src/utils/futuresHeldHistory.js';

// The fields the renderer's fold projects from an execution report into the
// held review, and therefore the fields a REST row can disagree with. The
// identity is the key, the symbol is the map, and the rest of the REST row —
// side, order, margin asset — the stream states once per order, not per fill.
export const FUTURES_HISTORY_SCORED_FIELDS = Object.freeze([
    'price',
    'quantity',
    'commission',
    'commissionAsset',
    'realizedPnl',
    'time',
]);

const EMPTY_FILLS = Object.freeze(new Map());

// How long a report takes to cross the socket after its fill. A read issued
// while a burst is still filling can be answered with fills whose reports
// have not landed: on 2026-09-03 a read after a burst on BULLAUSDT returned
// 86 rows, 37 of them from that instant, and the pass 0.35 s later held every
// one. Rows newer than the pass began, less this, are not judged. Two seconds
// is above every private-stream lag the desk has measured through the proxy
// (345 ms) with room for a main process busy folding another answer.
export const FUTURES_HISTORY_REPORT_FLIGHT_MS = 2_000;

const normalizeIdentity = (value) => {
    const identity = typeof value === 'string'
        ? value.trim()
        : Number.isSafeInteger(value) && value >= 0 ? String(value) : '';
    return /^\d{1,20}$/.test(identity) ? identity : null;
};

// The same expressions as `tradeRowFromReport` in the renderer's fold, for the
// six fields it and this module both read. A test holds the two equal on the
// same report, so a field the fold starts reading differently is a failing test
// rather than a score that quietly stops meaning what it says.
export const futuresHistoryStreamFillOf = report => Object.freeze({
    price: report?.lastFilledPrice ?? report?.price ?? '0',
    quantity: report?.lastFilledQty ?? report?.l ?? '0',
    commission: report?.commission ?? '0',
    commissionAsset: report?.commissionAsset ?? null,
    realizedPnl: report?.realizedPnl ?? '0',
    time: Number(report?.time ?? report?.T) || 0,
});

// Two exact decimals are the same number when they differ only in trailing
// zeros; the stream and the REST endpoint do not promise the same scale, and
// `0.00123000` against `0.00123` is not the exchange restating a fee. Anything
// that is not a plain decimal is compared as the text it is.
const canonicalDecimal = (value) => {
    const text = value === null || value === undefined ? '' : String(value).trim();
    const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(text);
    if (match === null) return text;
    const fraction = (match[3] ?? '').replace(/0+$/, '');
    const whole = match[2].replace(/^0+(?=\d)/, '');
    const sign = match[1] === '-' && !(whole === '0' && fraction === '') ? '-' : '';
    return `${sign}${whole}${fraction === '' ? '' : `.${fraction}`}`;
};

const differs = (reported, row, field) => (
    field === 'commissionAsset'
        ? String(reported?.[field] ?? '') !== String(row?.[field] ?? '')
        : field === 'time'
            ? Number(reported?.[field]) !== Number(row?.[field])
            : canonicalDecimal(reported?.[field]) !== canonicalDecimal(row?.[field])
);

/**
 * What the private stream reported, per contract, bounded like the review is.
 *
 * Kept in the main process rather than read back from the renderer: the fold
 * that holds these rows on screen runs in whichever renderer is mounted, and a
 * mounted renderer doubles under StrictMode. The score has to be one score.
 */
export const createFuturesHistoryStreamShadow = ({
    maxPerContract = FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT,
    windowMs = null,
} = {}) => {
    const byContract = new Map();

    const note = (symbol, tradeId, report, now = Date.now()) => {
        const contract = String(symbol ?? '').trim().toUpperCase();
        const identity = normalizeIdentity(tradeId);
        if (contract === '' || identity === null) return false;
        let fills = byContract.get(contract);
        if (fills === undefined) {
            fills = new Map();
            byContract.set(contract, fills);
        }
        // A second report of the same fill replaces the first and takes its
        // place as newest, as the fold's own upsert does.
        fills.delete(identity);
        fills.set(identity, futuresHistoryStreamFillOf(report));
        if (Number.isSafeInteger(windowMs) && windowMs >= 0) {
            const oldest = now - windowMs;
            for (const [key, fill] of fills) {
                if (fill.time >= oldest) break;
                fills.delete(key);
            }
        }
        while (fills.size > maxPerContract) {
            fills.delete(fills.keys().next().value);
        }
        return true;
    };

    const fillsOf = symbol => (
        byContract.get(String(symbol ?? '').trim().toUpperCase()) ?? EMPTY_FILLS
    );

    const clear = () => byContract.clear();

    return Object.freeze({ note, fillsOf, clear });
};

/**
 * The exchange's answer for one contract against what the stream reported.
 *
 * `returned` is every row the exchange answered with. A row from before the
 * moment the current stream connected is `restated`: the stream was not there
 * to report it, and calling it unreported would report the socket's downtime
 * as the socket's failure. So is a row newer than `judgeTo` — the moment the
 * pass began, less a report's flight: its report may still be crossing the
 * socket, and the read's own flight is not the socket's failure either. Of
 * the rows the stream could have reported, `held` is the ones it did,
 * `unreported` the ones it did not, and `differing` the held ones whose
 * fields the exchange states differently — once per row, however many fields
 * moved. `returned` is `restated + held + unreported`.
 */
export const scoreFuturesHistoryReading = ({
    rows,
    fills = EMPTY_FILLS,
    connectedAt = null,
    judgeTo = null,
}) => {
    let returned = 0;
    let restated = 0;
    let held = 0;
    let unreported = 0;
    let differing = 0;
    const judgeFrom = Number.isSafeInteger(connectedAt) && connectedAt >= 0 ? connectedAt : null;
    const judgeUntil = Number.isSafeInteger(judgeTo) ? judgeTo : null;
    for (const row of Array.isArray(rows) ? rows : []) {
        returned += 1;
        const time = Number(row?.time);
        if (judgeFrom === null
            || !Number.isFinite(time)
            || time < judgeFrom
            || (judgeUntil !== null && time > judgeUntil)) {
            restated += 1;
            continue;
        }
        const identity = normalizeIdentity(row?.id);
        const reported = identity === null ? undefined : fills.get(identity);
        if (reported === undefined) {
            unreported += 1;
            continue;
        }
        held += 1;
        if (FUTURES_HISTORY_SCORED_FIELDS.some(field => differs(reported, row, field))) {
            differing += 1;
        }
    }
    return Object.freeze({ returned, restated, held, unreported, differing });
};

export const emptyFuturesHistoryScore = () => ({
    contracts: 0,
    reads: 0,
    returned: 0,
    restated: 0,
    held: 0,
    unreported: 0,
    differing: 0,
    // Set to false the moment one covered contract's stream proof does not
    // hold from the start of the pass to its acceptance. A zero `unreported`
    // beside `vouched: 0` is not evidence.
    vouched: true,
});

export const addFuturesHistoryScore = (total, scored) => {
    total.contracts += 1;
    total.returned += scored.returned;
    total.restated += scored.restated;
    total.held += scored.held;
    total.unreported += scored.unreported;
    total.differing += scored.differing;
    return total;
};
