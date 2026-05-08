/**
 * P&L Tracking Utility
 * Uses balance snapshots to track P&L changes over time
 * Takes a snapshot when you reset, then calculates change from current balance
 */

const STORAGE_KEY = 'pnl_snapshots';

// Load P&L data from localStorage
export const loadPnLData = () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            return getDefaultPnLData();
        }
        return JSON.parse(stored);
    } catch (err) {
        console.error('Error loading P&L data:', err);
        return getDefaultPnLData();
    }
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
export const savePnLData = (data) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
        console.error('Error saving P&L data:', err);
    }
};

/**
 * Compute the start of the calendar period that the given timestamp falls into.
 * Used both to detect stale snapshots and to label time ranges consistently.
 * Week starts on Monday (ISO).
 */
const getPeriodStart = (period, now = new Date()) => {
    switch (period) {
        case 'day': {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            return d;
        }
        case 'week': {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            const dow = d.getDay(); // 0 = Sun, 1 = Mon, ...
            const daysFromMonday = dow === 0 ? 6 : dow - 1;
            d.setDate(d.getDate() - daysFromMonday);
            return d;
        }
        case 'month':
            return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
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
export const takeSnapshot = (period, balances, ticker) => {
    const data = loadPnLData();
    const { totalUSDT, totalBTC, btcPrice } = calculatePortfolioValue(balances, ticker);

    data.snapshots[period] = {
        timestamp: Date.now(),
        totalUSDT,
        totalBTC,
        btcPrice,
        balances: JSON.parse(JSON.stringify(balances)) // Deep copy
    };
    data.tradesSince[period] = 0;

    savePnLData(data);
    return data;
};

/**
 * Calculate P&L by comparing current balance to snapshot
 */
export const calculatePnL = (period, balances, ticker) => {
    let data = loadPnLData();
    let snapshot = data.snapshots[period];

    const { totalUSDT: currentUSDT, totalBTC: currentBTC, btcPrice } = calculatePortfolioValue(balances, ticker);

    // Auto-anchor when the snapshot is missing OR has rolled past its calendar boundary
    // (e.g. a 'day' snapshot taken yesterday is no longer the anchor for "today").
    // Skip when we don't yet have valid portfolio data, so we don't anchor at zero.
    const needsRefresh = !snapshot || isSnapshotStale(period, snapshot);
    if (needsRefresh) {
        if (currentUSDT > 0) {
            data = takeSnapshot(period, balances, ticker);
            snapshot = data.snapshots[period];
        } else {
            return {
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
                tradeCount: data.tradesSince[period] || 0,
                snapshotTime: null,
                period
            };
        }
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
export const incrementTradeCount = () => {
    const data = loadPnLData();
    ['day', 'week', 'month', 'all'].forEach(period => {
        data.tradesSince[period] = (data.tradesSince[period] || 0) + 1;
    });
    savePnLData(data);
};

/**
 * Reset P&L for a period by taking a new snapshot
 */
export const resetPnL = (period, balances, ticker) => {
    return takeSnapshot(period, balances, ticker);
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
export const getTimeRangeLabel = (period, data) => {
    const pnlData = data || loadPnLData();
    const snapshot = pnlData.snapshots?.[period];

    if (snapshot && snapshot.timestamp) {
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

