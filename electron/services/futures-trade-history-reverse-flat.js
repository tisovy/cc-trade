// Exact reverse terminal reconciliation for a contiguous `/userTrades` suffix.
//
// The acquisition reader knows that every row in `[coveredFrom, coveredTo]`
// was enumerated, but it does not know what happened before `coveredFrom`.
// Starting from a current complete position snapshot and undoing that suffix
// answers the only safe early-stop question: was every key exactly flat at the
// same left boundary?

import { normalizeFuturesTradeHistorySymbol } from '../../src/utils/futuresTradeHistoryEvidence.js';

const POSITION_LEGS = new Set(['BOTH', 'LONG', 'SHORT'])
const MAX_QUANTITY_TEXT_LENGTH = 64
const QUANTITY_ATOM_DIGITS = 8
const QUANTITY_SCALE = 10n ** BigInt(QUANTITY_ATOM_DIGITS)

// One spelling rule with the evidence this proof reconciles — the exchange's
// identity alphabet, not ASCII. A private alphabet here disqualified 龙虾USDT
// before its rows were even looked at, so the pair's flat boundary was
// unprovable and its history could never stop early.
const canonicalSymbol = normalizeFuturesTradeHistorySymbol;

const canonicalLeg = value => {
    if (typeof value !== 'string') return null;
    const leg = value.trim().toUpperCase();
    return POSITION_LEGS.has(leg) ? leg : null;
};

const exactQuantityAtoms = (value) => {
    if (typeof value !== 'string'
        || value.length === 0
        || value.length > MAX_QUANTITY_TEXT_LENGTH) return null;
    const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
    if (match === null) return null;
    const fraction = match[3] ?? '';
    if (fraction.length > QUANTITY_ATOM_DIGITS) return null;
    const atoms = (BigInt(match[2]) * QUANTITY_SCALE)
        + BigInt((fraction + '0'.repeat(QUANTITY_ATOM_DIGITS))
            .slice(0, QUANTITY_ATOM_DIGITS));
    return match[1] === '-' ? -atoms : atoms;
};

const canonicalKey = (symbol, leg) => `${symbol}:${leg}`;

const failed = reason => Object.freeze({
    proven: false,
    boundary: null,
    positionKeys: Object.freeze([]),
    reason,
});

export const proveFuturesTradeHistoryReverseFlat = ({
    symbol,
    positions,
    rows,
    coverage,
} = {}) => {
    const expectedSymbol = canonicalSymbol(symbol);
    const coveredFrom = Number.isSafeInteger(coverage?.coveredFrom)
        && coverage.coveredFrom >= 0
        ? coverage.coveredFrom
        : null;
    const coveredTo = Number.isSafeInteger(coverage?.coveredTo)
        && coverage.coveredTo >= 0
        ? coverage.coveredTo
        : null;
    if (expectedSymbol === null
        || !Array.isArray(positions)
        || !Array.isArray(rows)
        || coverage?.continuityComplete !== true
        || coverage?.aborted === true
        || coveredFrom === null
        || coveredTo === null
        || coveredFrom > coveredTo) return failed('INCOMPLETE_SUFFIX');

    const terminal = new Map();
    const topology = new Set();
    for (const position of positions) {
        const positionSymbol = canonicalSymbol(position?.symbol);
        if (positionSymbol !== expectedSymbol) continue;
        const leg = canonicalLeg(position?.positionSide ?? 'BOTH');
        const quantity = exactQuantityAtoms(position?.quantity ?? position?.positionAmt);
        if (leg === null || quantity === null) return failed('INVALID_SNAPSHOT');
        if ((leg === 'LONG' && quantity < 0n)
            || (leg === 'SHORT' && quantity > 0n)) return failed('INVALID_SNAPSHOT');
        const key = canonicalKey(expectedSymbol, leg);
        if (terminal.has(key)) return failed('DUPLICATE_SNAPSHOT_KEY');
        terminal.set(key, quantity);
        topology.add(leg);
    }

    const effects = [];
    for (const row of rows) {
        const rowSymbol = canonicalSymbol(row?.symbol);
        const leg = canonicalLeg(row?.positionSide ?? 'BOTH');
        const side = typeof row?.side === 'string' ? row.side.trim().toUpperCase() : null;
        const quantity = exactQuantityAtoms(row?.quantity);
        const time = Number.isSafeInteger(row?.time) && row.time >= 0 ? row.time : null;
        if (rowSymbol !== expectedSymbol
            || leg === null
            || (side !== 'BUY' && side !== 'SELL')
            || quantity === null
            || quantity <= 0n
            || time === null
            || time < coveredFrom
            || time > coveredTo) return failed('INVALID_TRADE_SUFFIX');
        const key = canonicalKey(expectedSymbol, leg);
        topology.add(leg);
        effects.push(Object.freeze({
            key,
            amount: side === 'BUY' ? quantity : -quantity,
        }));
        if (!terminal.has(key)) terminal.set(key, 0n);
    }

    if (terminal.size === 0 || effects.length === 0) return failed('NO_POSITION_KEYS');
    if (topology.has('BOTH') && (topology.has('LONG') || topology.has('SHORT'))) {
        return failed('MIXED_POSITION_TOPOLOGY');
    }

    for (const effect of effects) {
        terminal.set(effect.key, terminal.get(effect.key) - effect.amount);
    }
    const positionKeys = Object.freeze([...terminal.keys()].sort());
    if (positionKeys.some(key => terminal.get(key) !== 0n)) {
        return Object.freeze({
            proven: false,
            boundary: null,
            positionKeys,
            reason: 'NON_FLAT_BOUNDARY',
        });
    }
    return Object.freeze({
        proven: true,
        boundary: coveredFrom,
        positionKeys,
        reason: null,
    });
};

export default proveFuturesTradeHistoryReverseFlat;
