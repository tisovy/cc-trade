/**
 * P&L Tracking Utility
 * Uses balance snapshots to track P&L changes over time
 * Takes a snapshot when you reset, then calculates change from current balance
 */

import { readSpotAccountFingerprint, readSpotAccountStorage, writeSpotAccountStorage } from './spotAccountScope.js';
const PERIODS = ['day', 'week', 'month', 'all'];

// Load P&L data from localStorage
export const loadPnLData = (fingerprint) => {
    const data = getDefaultPnLData();
    const stored = readSpotAccountStorage('pnl_snapshots', fingerprint);
    for (const period of PERIODS) {
        const snapshot = stored?.snapshots?.[period];
        if (snapshot && Number.isFinite(snapshot.timestamp) && snapshot.timestamp > 0
            && ['totalUSDT', 'totalBTC', 'btcPrice'].every(key => Number.isFinite(snapshot[key]) && snapshot[key] >= 0)
            && snapshot.btcPrice > 0) data.snapshots[period] = snapshot;
        const count = stored?.tradesSince?.[period];
        if (Number.isSafeInteger(count) && count >= 0) data.tradesSince[period] = count;
    }
    return data;
};

// Get default P&L structure with snapshots
const getDefaultPnLData = () => ({
    // Balance snapshots for each period
    snapshots: {
        day: null,    // { timestamp, totalUSDT, balances: { BTC: x, ETH: y, ... } }
        week: null,
        month: null,
        all: null
    },
    // Track trades count since snapshot
    tradesSince: {
        day: 0,
        week: 0,
        month: 0,
        all: 0
    }
});

// Save P&L data to localStorage
export const savePnLData = (data, fingerprint) =>
    writeSpotAccountStorage('pnl_snapshots', fingerprint, data);

/**
 * Compute the start of the calendar period that the given timestamp falls into.
 * Used to detect stale snapshots (and, via isSnapshotStale, to decide when a
 * time-range label should fall back to the period name). Week starts on Monday
 * (ISO). `now` may be a Date or an epoch number.
 */
const getPeriodStart = (period, now = new Date()) => {
    const ref = now instanceof Date ? now : new Date(now);
    switch (period) {
        case 'day': {
            const d = new Date(ref);
            d.setHours(0, 0, 0, 0);
            return d;
        }
        case 'week': {
            const d = new Date(ref);
            d.setHours(0, 0, 0, 0);
            const dow = d.getDay(); // 0 = Sun, 1 = Mon, ...
            const daysFromMonday = dow === 0 ? 6 : dow - 1;
            d.setDate(d.getDate() - daysFromMonday);
            return d;
        }
        case 'month':
            return new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
        case 'all':
        default:
            return null;
    }
};

/**
 * A snapshot is stale when it was taken before the current period's start.
 * The 'all' period never goes stale — it's only refreshed by a manual reset.
 */
export const isSnapshotStale = (period, snapshot, now = new Date()) => {
    if (!snapshot || !snapshot.timestamp) return true;
    const start = getPeriodStart(period, now);
    if (!start) return false;
    return snapshot.timestamp < start.getTime();
};

/**
 * Whether the live portfolio data is complete enough to anchor a snapshot or
 * compute P&L. We require a loaded BTC price (so the BTC baseline is valid and
 * USDT/alt -> BTC conversions work) and a populated balances map. A transient
 * empty balances refresh ({}) or a tick before BTCUSDT arrives leaves these
 * unmet, so we neither re-anchor at zero nor flash a bogus -100%.
 *
 * Note: an account that genuinely sold everything to zero still keeps its coin
 * keys (with available:0), so it passes this check and its real loss is shown —
 * only a truly empty/not-yet-loaded map is treated as "no data".
 */
const hasLiveData = (balances, btcPrice) =>
    btcPrice > 0 && !!balances && Object.keys(balances).length > 0;

/**
 * Calculate total portfolio value in USDT and BTC
 * BTC value = sum of all coins converted to BTC (not USDT/btcPrice)
 * This way if BTC goes up but your alts don't, you see you're losing BTC
 * 
 * @param {Object} balances - { BTC: { available, onOrder }, ETH: {...}, ... }
 * @param {Array} ticker - Array of ticker data with lastPrice
 * @returns {{ totalUSDT: number, totalBTC: number, btcPrice: number }}
 */
export const calculatePortfolioValue = (balances, ticker) => {
    if (!balances || !ticker) return { totalUSDT: 0, totalBTC: 0, btcPrice: 0 };

    // Build ticker map for quick lookup
    const tickerMap = new Map();
    ticker.forEach(t => {
        if (t && t.symbol) {
            tickerMap.set(t.symbol, parseFloat(t.lastPrice) || 0);
        }
    });

    const btcPrice = tickerMap.get('BTCUSDT') || 0;
    let totalUSDT = 0;
    let totalBTC = 0;

    Object.entries(balances).forEach(([coin, balance]) => {
        const available = parseFloat(balance.available) || 0;
        const onOrder = parseFloat(balance.onOrder) || 0;
        const total = available + onOrder;

        if (total <= 0) return;

        if (coin === 'USDT') {
            totalUSDT += total;
            // Convert USDT to BTC
            if (btcPrice > 0) {
                totalBTC += total / btcPrice;
            }
        } else if (coin === 'BTC') {
            totalUSDT += total * btcPrice;
            totalBTC += total;
        } else {
            // Try COINUSDT first for USDT value
            const usdtPrice = tickerMap.get(`${coin}USDT`);
            const btcPairPrice = tickerMap.get(`${coin}BTC`);

            if (usdtPrice) {
                totalUSDT += total * usdtPrice;
            } else if (btcPairPrice && btcPrice) {
                totalUSDT += total * btcPairPrice * btcPrice;
            }

            // For BTC value, prefer direct BTC pair (more accurate)
            if (btcPairPrice) {
                totalBTC += total * btcPairPrice;
            } else if (usdtPrice && btcPrice > 0) {
                totalBTC += (total * usdtPrice) / btcPrice;
            }
        }
    });

    return { totalUSDT, totalBTC, btcPrice };
};

// Backwards compatibility wrapper
export const calculateTotalUSDT = (balances, ticker) => {
    return calculatePortfolioValue(balances, ticker).totalUSDT;
};

/**
 * Take a balance snapshot for a period
 */
export const takeSnapshot = (period, balances, ticker, portfolio = null, fingerprint = null) => {
    const data = loadPnLData(fingerprint);
    if (!readSpotAccountFingerprint(fingerprint) || !PERIODS.includes(period)) return data;
    // Reuse the caller's already-computed totals when provided, to avoid
    // recomputing the whole portfolio over the same balances/ticker.
    const { totalUSDT, totalBTC, btcPrice } = portfolio || calculatePortfolioValue(balances, ticker);

    // Never anchor a baseline on incomplete data (prices not loaded yet, or an
    // empty balances refresh). This is the single chokepoint for ALL snapshot
    // writes, so it also protects the manual Reset / Start-Tracking button: a
    // click before BTCUSDT loads can't persist a totalBTC=0 / btcPrice=0 anchor
    // that would later display a fake BTC gain. Returns the data unchanged so
    // callers stay consistent; the next ready tick anchors correctly.
    if (!hasLiveData(balances, btcPrice)) {
        return data;
    }

    data.snapshots[period] = {
        timestamp: Date.now(),
        totalUSDT,
        totalBTC,
        btcPrice,
        balances: JSON.parse(JSON.stringify(balances)) // Deep copy
    };
    data.tradesSince[period] = 0;

    savePnLData(data, fingerprint);
    return data;
};

/**
 * Build the "no active baseline" result — either we have no usable portfolio
 * data yet, or the account holds nothing to track. The panel renders its
 * "Start Tracking" state from this.
 */
const emptyPnL = (period, currentUSDT, currentBTC, btcPrice, tradeCount) => ({
    hasSnapshot: false,
    pnl: 0,
    pnlPercent: 0,
    pnlBTC: 0,
    pnlBTCPercent: 0,
    startValue: 0,
    currentValue: currentUSDT,
    startValueBTC: 0,
    currentValueBTC: currentBTC,
    btcPrice,
    tradeCount: tradeCount || 0,
    snapshotTime: null,
    period
});

/**
 * Build a flat (0) P&L result against an existing snapshot. Used when we hold a
 * valid baseline but the current read is incomplete (prices not loaded yet, or
 * an empty balances refresh) — showing "unchanged" for one tick is correct,
 * whereas computing against a zero current value would flash a spurious -100%.
 */
const flatPnL = (period, snapshot, tradeCount, btcPrice) => {
    const startBTC = snapshot.totalBTC || 0;
    return {
        hasSnapshot: true,
        pnl: 0,
        pnlPercent: 0,
        pnlBTC: 0,
        pnlBTCPercent: 0,
        startValue: snapshot.totalUSDT,
        currentValue: snapshot.totalUSDT,
        startValueBTC: startBTC,
        currentValueBTC: startBTC,
        btcPrice: snapshot.btcPrice || btcPrice,
        snapshotBtcPrice: snapshot.btcPrice || btcPrice,
        tradeCount: tradeCount || 0,
        snapshotTime: snapshot.timestamp,
        period
    };
};

/**
 * Calculate P&L by comparing current balance to snapshot
 */
export const calculatePnL = (period, balances, ticker, fingerprint) => {
    let data = loadPnLData(fingerprint);
    let snapshot = data.snapshots[period];

    const portfolio = calculatePortfolioValue(balances, ticker);
    const { totalUSDT: currentUSDT, totalBTC: currentBTC, btcPrice } = portfolio;
    if (!readSpotAccountFingerprint(fingerprint) || !PERIODS.includes(period)) {
        return emptyPnL(period, currentUSDT, currentBTC, btcPrice, 0);
    }

    // Only trust these totals once prices have loaded and balances are populated.
    // Acting on a half-loaded tick is what produced the zero-baseline and
    // -100%-flash bugs, so it gates both the anchor and the comparison below.
    const dataReady = hasLiveData(balances, btcPrice);

    // Auto-anchor when the snapshot is missing OR has rolled past its calendar
    // boundary (e.g. a 'day' snapshot taken yesterday is no longer the anchor
    // for "today").
    const needsRefresh = !snapshot || isSnapshotStale(period, snapshot);
    if (needsRefresh) {
        // Anchor only on complete data with real value, so we never persist a
        // zero/partial baseline (which would later show a fake gain or loss).
        if (dataReady && currentUSDT > 0) {
            data = takeSnapshot(period, balances, ticker, portfolio, fingerprint);
            snapshot = data.snapshots[period];
        } else {
            return emptyPnL(period, currentUSDT, currentBTC, btcPrice, data.tradesSince[period]);
        }
    } else if (!dataReady) {
        // We have a valid baseline but the current read is incomplete — show
        // flat rather than a spurious total-loss flash.
        return flatPnL(period, snapshot, data.tradesSince[period], btcPrice);
    }

    // USDT P&L
    const pnl = currentUSDT - snapshot.totalUSDT;
    const pnlPercent = snapshot.totalUSDT > 0
        ? ((currentUSDT - snapshot.totalUSDT) / snapshot.totalUSDT) * 100
        : 0;

    // BTC P&L - comparing actual BTC holdings
    // This shows if you're gaining or losing BTC overall
    // e.g., if BTC goes up but your alts don't, you're losing BTC value
    const startBTC = snapshot.totalBTC || 0;
    const pnlBTC = currentBTC - startBTC;
    const pnlBTCPercent = startBTC > 0
        ? ((currentBTC - startBTC) / startBTC) * 100
        : 0;

    return {
        hasSnapshot: true,
        pnl,
        pnlPercent,
        pnlBTC,
        pnlBTCPercent,
        startValue: snapshot.totalUSDT,
        currentValue: currentUSDT,
        startValueBTC: startBTC,
        currentValueBTC: currentBTC,
        btcPrice,
        snapshotBtcPrice: snapshot.btcPrice || btcPrice,
        tradeCount: data.tradesSince[period] || 0,
        snapshotTime: snapshot.timestamp,
        period
    };
};

/**
 * Increment trade count for all periods (called when new trade happens)
 */
export const incrementTradeCount = (fingerprint) => {
    const data = loadPnLData(fingerprint);
    ['day', 'week', 'month', 'all'].forEach(period => {
        data.tradesSince[period] = (data.tradesSince[period] || 0) + 1;
    });
    savePnLData(data, fingerprint);
};

/**
 * Reset P&L for a period by taking a new snapshot
 */
export const resetPnL = (period, balances, ticker, fingerprint) => {
    return takeSnapshot(period, balances, ticker, null, fingerprint);
};

/**
 * Sync with history - just count trades for display
 * (We don't use trade history for P&L anymore, just balance snapshots)
 */
export const syncWithHistory = (_orderHistory) => {
    // No-op now, keeping for compatibility
    return 0;
};

/**
 * Get formatted time range label
 */
export const getTimeRangeLabel = (period, data, fingerprint) => {
    const pnlData = data || loadPnLData(fingerprint);
    const snapshot = pnlData.snapshots?.[period];

    // A snapshot that has rolled past its period boundary is no longer the active
    // baseline (calculatePnL will re-anchor it), so fall back to the period name
    // instead of advertising a stale "Since <old date>" that contradicts the body.
    if (snapshot && snapshot.timestamp && !isSnapshotStale(period, snapshot)) {
        const date = new Date(snapshot.timestamp);
        return `Since ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    switch (period) {
        case 'day':
            return 'Today (no snapshot)';
        case 'week':
            return 'This Week (no snapshot)';
        case 'month':
            return 'This Month (no snapshot)';
        case 'all':
            return 'All Time (no snapshot)';
        default:
            return 'No snapshot';
    }
};
