// Arithmetic the authenticated stream cannot state. Nothing in this module
// reads, writes, broadcasts or records: one immutable reading comes in and an
// estimate comes out. The caller is responsible for keeping that estimate on
// the diagnostic path only.

export const FUTURES_MARGIN_ESTIMATE_VALUES = Object.freeze([
    'notional',
    'initial-margin',
    'maintenance-margin',
    'liquidation-price',
    'free-margin',
]);

// A ratio beyond 10,000% is not useful evidence about arithmetic agreement.
// Refusing it also gives the record a fixed integer domain that cannot be
// mistaken for a price or a balance.
export const FUTURES_MARGIN_ESTIMATE_MAX_BPS = 1_000_000;

const POSITION_VALUE_FIELDS = Object.freeze([
    Object.freeze(['notional', 'notional']),
    Object.freeze(['initial-margin', 'initialMargin']),
    Object.freeze(['maintenance-margin', 'maintenanceMargin']),
    Object.freeze(['liquidation-price', 'liquidationPrice']),
]);

const finite = (value) => {
    if ((typeof value !== 'string' && typeof value !== 'number')
        || (typeof value === 'string' && value.trim() === '')) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const positive = (value) => {
    const parsed = finite(value);
    return parsed !== null && parsed > 0 ? parsed : null;
};

const nonNegative = (value) => {
    const parsed = finite(value);
    return parsed !== null && parsed >= 0 ? parsed : null;
};

const symbolOf = value => (
    typeof value === 'string' && value.trim() !== ''
        ? value.trim().toUpperCase()
        : null
);

const marginModeOf = (value) => {
    const mode = String(value ?? '').toUpperCase();
    if (mode === 'ISOLATED') return 'ISOLATED';
    return mode === 'CROSS' || mode === 'CROSSED' ? 'CROSS' : null;
};

const symbolEntry = (entries, symbol) => {
    if (entries instanceof Map) return entries.get(symbol) ?? null;
    return entries !== null && typeof entries === 'object'
        ? entries[symbol] ?? null
        : null;
};

const markOf = (marks, symbol) => {
    const held = symbolEntry(marks, symbol);
    return positive(held?.markPrice ?? held);
};

const positionSideOf = position => (
    typeof position?.positionSide === 'string' && position.positionSide !== ''
        ? position.positionSide.toUpperCase()
        : 'BOTH'
);

const positionKey = position => {
    const symbol = symbolOf(position?.symbol);
    return symbol === null ? null : `${symbol}:${positionSideOf(position)}`;
};

const bracketRows = (tables, symbol) => {
    const held = symbolEntry(tables, symbol);
    const rows = Array.isArray(held) ? held : held?.brackets;
    return Array.isArray(rows) && rows.length > 0 ? rows : null;
};

const bracketFor = (tables, symbol, notional) => {
    const rows = bracketRows(tables, symbol);
    if (rows === null) return null;
    for (const row of rows) {
        const floor = nonNegative(row?.notionalFloor);
        const cap = positive(row?.notionalCap);
        const rate = nonNegative(row?.maintMarginRatio);
        const cumulative = nonNegative(row?.cum);
        if (floor === null || cap === null || cap < floor
            || rate === null || cumulative === null) continue;
        if (notional >= floor && notional <= cap) {
            return Object.freeze({ floor, cap, rate, cumulative });
        }
    }
    return null;
};

const positionBase = (position, { marks, symbolConfigs, leverageBrackets }) => {
    const symbol = symbolOf(position?.symbol);
    const quantity = finite(position?.quantity);
    if (symbol === null || quantity === null || quantity === 0) return null;

    const mark = markOf(marks, symbol);
    const config = symbolEntry(symbolConfigs, symbol);
    const leverage = positive(config?.leverage);
    const marginMode = marginModeOf(config?.marginType);
    const entryPrice = positive(position?.entryPrice);
    if (mark === null || leverage === null || marginMode === null || entryPrice === null) {
        return null;
    }

    const size = Math.abs(quantity);
    const notional = size * mark;
    if (!Number.isFinite(notional) || notional <= 0) return null;
    const bracket = bracketFor(leverageBrackets, symbol, notional);
    if (bracket === null) return null;

    const maintenanceMargin = notional * bracket.rate - bracket.cumulative;
    const isolatedWallet = marginMode === 'ISOLATED'
        ? nonNegative(position?.isolatedWallet)
        : null;
    const initialMargin = marginMode === 'ISOLATED'
        ? isolatedWallet
        : notional / leverage;
    const unrealizedPnl = quantity * (mark - entryPrice);
    if (initialMargin === null
        || !Number.isFinite(initialMargin)
        || initialMargin < 0
        || !Number.isFinite(maintenanceMargin)
        || maintenanceMargin < 0
        || !Number.isFinite(unrealizedPnl)) return null;

    return Object.freeze({
        symbol,
        positionSide: positionSideOf(position),
        quantity,
        size,
        side: quantity < 0 ? -1 : 1,
        entryPrice,
        notional,
        initialMargin,
        maintenanceMargin,
        unrealizedPnl,
        marginMode,
        isolatedWallet,
        maintenanceRate: bracket.rate,
        cumulativeMaintenance: bracket.cumulative,
    });
};

const liquidationPrice = (position, completeCrossPositions, crossWallet) => {
    let wallet;
    let otherMaintenance = 0;
    let otherUnrealized = 0;
    if (position.marginMode === 'ISOLATED') {
        wallet = position.isolatedWallet;
    } else {
        if (crossWallet === null || completeCrossPositions === null) return null;
        wallet = crossWallet;
        for (const other of completeCrossPositions) {
            if (other === position) continue;
            otherMaintenance += other.maintenanceMargin;
            otherUnrealized += other.unrealizedPnl;
        }
    }
    const numerator = wallet
        - otherMaintenance
        + otherUnrealized
        + position.cumulativeMaintenance
        - position.side * position.size * position.entryPrice;
    const denominator = position.size * position.maintenanceRate
        - position.side * position.size;
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return null;
    }
    const value = numerator / denominator;
    return Number.isFinite(value) && value >= 0 ? value : null;
};

const identityOf = order => {
    for (const value of [
        order?.orderId,
        order?.sourceOrderId,
        order?.algoId,
        order?.clientOrderId,
        order?.clientAlgoId,
    ]) {
        if (typeof value === 'string' && value !== '') return value;
        if (Number.isSafeInteger(value) && value >= 0) return String(value);
    }
    return null;
};

const actualOrderIdentityOf = order => {
    const value = order?.actualOrderId;
    if (typeof value === 'string' && value !== '') return value;
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
};

const workingOrders = (regularOrders, algoOrders) => {
    if (!Array.isArray(regularOrders) || !Array.isArray(algoOrders)) return null;
    const regular = regularOrders;
    const algo = algoOrders;
    const regularIds = new Set(regular.map(identityOf).filter(value => value !== null));
    const rows = [
        ...regular,
        ...algo.filter(order => {
            const actual = actualOrderIdentityOf(order);
            return actual === null || !regularIds.has(actual);
        }),
    ];
    const seen = new Set();
    const unique = [];
    for (const order of rows) {
        const symbol = symbolOf(order?.symbol ?? order?.s);
        const identity = identityOf(order);
        if (symbol === null || identity === null) return null;
        const kind = String(order?.orderKind ?? order?.orderSource ?? 'REGULAR').toUpperCase();
        const key = `${symbol}:${kind}:${identity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(order);
    }
    return unique;
};

const restingOrderInitialMargin = ({
    regularOrders,
    algoOrders,
    marks,
    symbolConfigs,
    leverageBrackets,
}) => {
    const orders = workingOrders(regularOrders, algoOrders);
    if (orders === null) return null;
    const committed = new Map();
    for (const order of orders) {
        if (order?.reduceOnly === true) continue;
        const symbol = symbolOf(order?.symbol ?? order?.s);
        const side = String(order?.side ?? order?.S ?? '').toUpperCase();
        const quantity = nonNegative(order?.origQty ?? order?.q);
        const executed = nonNegative(order?.executedQty ?? order?.z);
        if (symbol === null || !['BUY', 'SELL'].includes(side)
            || quantity === null || executed === null) return null;
        const remaining = Math.max(quantity - executed, 0);
        if (remaining === 0) continue;

        const mark = markOf(marks, symbol);
        const config = symbolEntry(symbolConfigs, symbol);
        const leverage = positive(config?.leverage);
        const marginMode = marginModeOf(config?.marginType);
        // What the order is valued at is the price it names — its own, or the
        // trigger a market-stop rests at. The mark is the fallback for an order
        // that names neither, and it was also demanded outright, which is a
        // different and much stronger thing: it made the sum refuse for want of
        // an input the order did not need.
        //
        // That cost the whole answer, because this sum is all-or-nothing across
        // the account. Marks are followed per *position*, so a contract the
        // account only has an order on has none — and an entry order is by
        // definition an order on a contract holding no position. Measured on the
        // operator's desk on 2026-08-15, on a build that had already been taught
        // to read leverage and brackets for those contracts: free margin
        // unavailable on sixty-eight account passes out of sixty-eight.
        //
        // So the mark is required exactly where it is used, which `price` states
        // on its own. Nothing is loosened: an order naming no price still has
        // nothing to be valued at without one, and still refuses.
        const price = positive(order?.price ?? order?.p)
            ?? positive(order?.triggerPrice)
            ?? mark;
        if (leverage === null || marginMode === null || price === null) {
            return null;
        }
        const notional = remaining * price;
        if (!Number.isFinite(notional)
            || notional <= 0
            || bracketFor(leverageBrackets, symbol, notional) === null) return null;
        const initial = notional / leverage;
        if (!Number.isFinite(initial) || initial < 0) return null;
        const sides = committed.get(symbol) ?? { BUY: 0, SELL: 0 };
        sides[side] += initial;
        committed.set(symbol, sides);
    }
    let total = 0;
    for (const sides of committed.values()) total += Math.max(sides.BUY, sides.SELL);
    return Number.isFinite(total) ? total : null;
};

const crossWalletOf = (balances, asset) => {
    const wallet = balances !== null && typeof balances === 'object'
        ? balances[asset]
        : null;
    return finite(wallet?.crossWallet);
};

/**
 * Computes all diagnostic-only estimates from one held reading.
 *
 * A position whose four mandatory market/config inputs are incomplete has no
 * estimate entry. Free margin is absent if any held position or resting order
 * is incomplete, because a partial sum would overstate spendable margin.
 */
export const computeFuturesAccountMarginEstimates = ({
    positions = [],
    balances = null,
    regularOrders = [],
    algoOrders = [],
    marks = null,
    symbolConfigs = null,
    leverageBrackets = null,
    asset = 'USDT',
} = {}) => {
    const positionsKnown = Array.isArray(positions);
    const heldPositions = positionsKnown ? positions : [];
    const bases = [];
    let incomplete = !positionsKnown;
    for (const position of heldPositions) {
        const quantity = finite(position?.quantity);
        if (quantity === 0) continue;
        if (quantity === null) {
            incomplete = true;
            continue;
        }
        const base = positionBase(position, { marks, symbolConfigs, leverageBrackets });
        if (base === null) incomplete = true;
        else bases.push(base);
    }

    const allCrossComplete = !incomplete
        ? bases.filter(position => position.marginMode === 'CROSS')
        : null;
    const crossWallet = crossWalletOf(balances, asset);
    const estimates = {};
    for (const base of bases) {
        estimates[`${base.symbol}:${base.positionSide}`] = Object.freeze({
            symbol: base.symbol,
            positionSide: base.positionSide,
            notional: base.notional,
            initialMargin: base.initialMargin,
            maintenanceMargin: base.maintenanceMargin,
            liquidationPrice: liquidationPrice(base, allCrossComplete, crossWallet),
        });
    }

    const orderMargin = restingOrderInitialMargin({
        regularOrders,
        algoOrders,
        marks,
        symbolConfigs,
        leverageBrackets,
    });
    let freeMargin = null;
    if (!incomplete && crossWallet !== null && orderMargin !== null) {
        const crossInitial = bases
            .filter(position => position.marginMode === 'CROSS')
            .reduce((sum, position) => sum + position.initialMargin, 0);
        const crossUnrealized = bases
            .filter(position => position.marginMode === 'CROSS')
            .reduce((sum, position) => sum + position.unrealizedPnl, 0);
        const computed = crossWallet + crossUnrealized - crossInitial - orderMargin;
        if (Number.isFinite(computed)) freeMargin = computed;
    }

    return Object.freeze({ positions: Object.freeze(estimates), freeMargin });
};

const basisPoints = (computed, exchange) => {
    const own = finite(computed);
    const stated = finite(exchange);
    if (own === null || stated === null || stated === 0) return null;
    const rounded = Math.round(Math.abs(own - stated) / Math.abs(stated) * 10_000);
    return Number.isSafeInteger(rounded)
        && rounded >= 0
        && rounded <= FUTURES_MARGIN_ESTIMATE_MAX_BPS
        ? rounded
        : undefined;
};

const positionComparison = (value, exchangeField, positions, estimates) => {
    let compared = 0;
    let unavailable = 0;
    let worst = null;
    const rows = [...(Array.isArray(positions) ? positions : [])]
        .sort((left, right) => String(positionKey(left)).localeCompare(String(positionKey(right))));
    for (const row of rows) {
        const key = positionKey(row);
        const estimate = key === null ? null : estimates?.[key] ?? null;
        const deviation = basisPoints(estimate?.[exchangeField], row?.[exchangeField]);
        // `undefined` means the ratio itself was outside the record's bounded
        // domain. The whole aggregate loses its line instead of smuggling a raw
        // amount in as a substitute.
        if (deviation === undefined) return null;
        if (deviation === null) {
            unavailable += 1;
            continue;
        }
        compared += 1;
        const symbol = symbolOf(row?.symbol);
        if (worst === null || deviation > worst.deviationBps) {
            worst = { deviationBps: deviation, symbol };
        }
    }
    return Object.freeze({
        value,
        compared,
        unavailable,
        deviationBps: worst?.deviationBps ?? null,
        symbol: worst?.symbol ?? null,
    });
};

const freeMarginComparison = (balances, estimates, asset) => {
    const wallet = balances !== null && typeof balances === 'object'
        ? balances[asset]
        : null;
    const deviation = basisPoints(estimates?.freeMargin, wallet?.available);
    if (deviation === undefined) return null;
    return Object.freeze({
        value: 'free-margin',
        compared: deviation === null ? 0 : 1,
        unavailable: deviation === null ? 1 : 0,
        deviationBps: deviation,
        symbol: null,
    });
};

/**
 * Projects computed amounts and exchange amounts into the only shape the
 * diagnostic record may see: counters and bounded whole basis points.
 */
export const createFuturesMarginEstimateEvents = ({
    resource,
    positions = [],
    balances = null,
    estimates,
    asset = 'USDT',
} = {}) => {
    if (resource === 'positions') {
        return Object.freeze(POSITION_VALUE_FIELDS
            .map(([value, field]) => positionComparison(
                value,
                field,
                positions,
                estimates?.positions,
            ))
            .filter(event => event !== null));
    }
    if (resource === 'balances') {
        const event = freeMarginComparison(balances, estimates, asset);
        return Object.freeze(event === null ? [] : [event]);
    }
    return Object.freeze([]);
};
