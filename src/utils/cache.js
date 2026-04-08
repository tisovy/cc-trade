/**
 * IndexedDB Cache Layer for Offline Storage
 * 
 * Stores:
 * - Candle data per symbol:interval
 * - Exchange info (filters, symbols)
 * - Recent trades per symbol
 * - Price alerts
 */

const DB_NAME = 'TradingCache';
const DB_VERSION = 1;

// Store names
const STORES = {
    CANDLES: 'candles',
    EXCHANGE_INFO: 'exchangeInfo',
    TRADES: 'trades',
    ALERTS: 'alerts',
};

// Cache expiry times (in milliseconds)
const EXPIRY = {
    EXCHANGE_INFO: 24 * 60 * 60 * 1000, // 24 hours
    TRADES: 30 * 60 * 1000, // 30 minutes
};

let db = null;

/**
 * Initialize IndexedDB
 */
export async function initCache() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Failed to open IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
            console.log('IndexedDB cache initialized');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Candles store: key = "BTCUSDT:1h"
            if (!database.objectStoreNames.contains(STORES.CANDLES)) {
                const candleStore = database.createObjectStore(STORES.CANDLES, { keyPath: 'key' });
                candleStore.createIndex('symbol', 'symbol', { unique: false });
                candleStore.createIndex('interval', 'interval', { unique: false });
            }

            // Exchange info store
            if (!database.objectStoreNames.contains(STORES.EXCHANGE_INFO)) {
                database.createObjectStore(STORES.EXCHANGE_INFO, { keyPath: 'id' });
            }

            // Trades store: key = symbol
            if (!database.objectStoreNames.contains(STORES.TRADES)) {
                database.createObjectStore(STORES.TRADES, { keyPath: 'symbol' });
            }

            // Alerts store: key = id
            if (!database.objectStoreNames.contains(STORES.ALERTS)) {
                const alertStore = database.createObjectStore(STORES.ALERTS, { keyPath: 'id' });
                alertStore.createIndex('symbol', 'symbol', { unique: false });
                alertStore.createIndex('active', 'active', { unique: false });
            }
        };
    });
}

/**
 * Get database instance
 */
async function getDB() {
    if (!db) {
        await initCache();
    }
    return db;
}

// ============ CANDLE CACHE ============

/**
 * Get cached candles for a symbol:interval
 * @returns {{ candles: Array, lastTime: number } | null}
 */
export async function getCachedCandles(symbol, interval) {
    try {
        const database = await getDB();
        const key = `${symbol}:${interval}`;
        
        return new Promise((resolve) => {
            const tx = database.transaction(STORES.CANDLES, 'readonly');
            const store = tx.objectStore(STORES.CANDLES);
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    resolve({
                        candles: result.candles,
                        lastTime: result.lastTime,
                        cachedAt: result.cachedAt,
                    });
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => {
                console.error('Error reading candle cache:', request.error);
                resolve(null);
            };
        });
    } catch (error) {
        console.error('getCachedCandles error:', error);
        return null;
    }
}

/**
 * Save candles to cache
 */
export async function setCachedCandles(symbol, interval, candles) {
    if (!candles || candles.length === 0) return;

    try {
        const database = await getDB();
        const key = `${symbol}:${interval}`;
        const lastCandle = candles[candles.length - 1];
        const lastTime = lastCandle?.time || Date.now();

        return new Promise((resolve, reject) => {
            const tx = database.transaction(STORES.CANDLES, 'readwrite');
            const store = tx.objectStore(STORES.CANDLES);

            const data = {
                key,
                symbol,
                interval,
                candles,
                lastTime,
                cachedAt: Date.now(),
            };

            const request = store.put(data);

            request.onsuccess = () => resolve(true);
            request.onerror = () => {
                console.error('Error writing candle cache:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('setCachedCandles error:', error);
    }
}

/**
 * Merge new candles with cached candles
 * Returns merged array sorted by time
 */
export function mergeCandles(cached, newCandles) {
    if (!cached || cached.length === 0) return newCandles;
    if (!newCandles || newCandles.length === 0) return cached;

    // Create a map for efficient merging
    const candleMap = new Map();
    
    // Add cached candles
    cached.forEach(c => {
        const time = c.time;
        candleMap.set(time, c);
    });

    // Add/update with new candles
    newCandles.forEach(c => {
        const time = c.time;
        candleMap.set(time, c);
    });

    // Convert back to array and sort by time
    return Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
}

// ============ EXCHANGE INFO CACHE ============

/**
 * Get cached exchange info
 */
export async function getCachedExchangeInfo() {
    try {
        const database = await getDB();
        
        return new Promise((resolve) => {
            const tx = database.transaction(STORES.EXCHANGE_INFO, 'readonly');
            const store = tx.objectStore(STORES.EXCHANGE_INFO);
            const request = store.get('exchangeInfo');

            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    // Check if expired
                    const age = Date.now() - result.cachedAt;
                    if (age < EXPIRY.EXCHANGE_INFO) {
                        resolve(result.data);
                    } else {
                        resolve(null); // Expired
                    }
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => resolve(null);
        });
    } catch (error) {
        console.error('getCachedExchangeInfo error:', error);
        return null;
    }
}

/**
 * Save exchange info to cache
 */
export async function setCachedExchangeInfo(data) {
    try {
        const database = await getDB();
        
        return new Promise((resolve) => {
            const tx = database.transaction(STORES.EXCHANGE_INFO, 'readwrite');
            const store = tx.objectStore(STORES.EXCHANGE_INFO);

            const request = store.put({
                id: 'exchangeInfo',
                data,
                cachedAt: Date.now(),
            });

            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
        });
    } catch (error) {
        console.error('setCachedExchangeInfo error:', error);
    }
}

// ============ TRADES CACHE ============

/**
 * Get cached trades for a symbol
 */
export async function getCachedTrades(symbol) {
    try {
        const database = await getDB();
        
        return new Promise((resolve) => {
            const tx = database.transaction(STORES.TRADES, 'readonly');
            const store = tx.objectStore(STORES.TRADES);
            const request = store.get(symbol);

            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    const age = Date.now() - result.cachedAt;
                    if (age < EXPIRY.TRADES) {
                        resolve(result.trades);
                    } else {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => resolve(null);
        });
    } catch (error) {
        console.error('getCachedTrades error:', error);
        return null;
    }
}

/**
 * Save trades to cache
 */
export async function setCachedTrades(symbol, trades) {
    try {
        const database = await getDB();
        
        return new Promise((resolve) => {
            const tx = database.transaction(STORES.TRADES, 'readwrite');
            const store = tx.objectStore(STORES.TRADES);

            const request = store.put({
                symbol,
                trades,
                cachedAt: Date.now(),
            });

            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
        });
    } catch (error) {
        console.error('setCachedTrades error:', error);
    }
}

// ============ ALERTS ============

/**
 * Get all alerts
 */
export async function getAlerts() {
    try {
        const database = await getDB();
        
        return new Promise((resolve) => {
            const tx = database.transaction(STORES.ALERTS, 'readonly');
            const store = tx.objectStore(STORES.ALERTS);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        });
    } catch (error) {
        console.error('getAlerts error:', error);
        return [];
    }
}

/**
 * Get alerts for a specific symbol
 */
export async function getAlertsForSymbol(symbol) {
    try {
        const database = await getDB();
        
        return new Promise((resolve) => {
            const tx = database.transaction(STORES.ALERTS, 'readonly');
            const store = tx.objectStore(STORES.ALERTS);
            const index = store.index('symbol');
            const request = index.getAll(symbol);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        });
    } catch (error) {
        console.error('getAlertsForSymbol error:', error);
        return [];
    }
}

/**
 * Save an alert
 */
export async function saveAlert(alert) {
    try {
        const database = await getDB();
        
        return new Promise((resolve, reject) => {
            const tx = database.transaction(STORES.ALERTS, 'readwrite');
            const store = tx.objectStore(STORES.ALERTS);

            const alertData = {
                ...alert,
                id: alert.id || `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                createdAt: alert.createdAt || Date.now(),
            };

            const request = store.put(alertData);

            request.onsuccess = () => resolve(alertData);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('saveAlert error:', error);
        throw error;
    }
}

/**
 * Delete an alert
 */
export async function deleteAlert(id) {
    try {
        const database = await getDB();
        
        return new Promise((resolve) => {
            const tx = database.transaction(STORES.ALERTS, 'readwrite');
            const store = tx.objectStore(STORES.ALERTS);
            const request = store.delete(id);

            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
        });
    } catch (error) {
        console.error('deleteAlert error:', error);
        return false;
    }
}

/**
 * Clear all caches (for debugging/reset)
 */
export async function clearAllCaches() {
    try {
        const database = await getDB();
        
        const tx = database.transaction(
            [STORES.CANDLES, STORES.EXCHANGE_INFO, STORES.TRADES],
            'readwrite'
        );

        tx.objectStore(STORES.CANDLES).clear();
        tx.objectStore(STORES.EXCHANGE_INFO).clear();
        tx.objectStore(STORES.TRADES).clear();

        return new Promise((resolve) => {
            tx.oncomplete = () => {
                console.log('All caches cleared');
                resolve(true);
            };
            tx.onerror = () => resolve(false);
        });
    } catch (error) {
        console.error('clearAllCaches error:', error);
        return false;
    }
}

/**
 * Get cache statistics
 */
export async function getCacheStats() {
    try {
        const database = await getDB();
        
        const stats = {
            candles: 0,
            trades: 0,
            alerts: 0,
            exchangeInfo: false,
        };

        const tx = database.transaction(
            [STORES.CANDLES, STORES.TRADES, STORES.ALERTS, STORES.EXCHANGE_INFO],
            'readonly'
        );

        return new Promise((resolve) => {
            tx.objectStore(STORES.CANDLES).count().onsuccess = (e) => {
                stats.candles = e.target.result;
            };
            tx.objectStore(STORES.TRADES).count().onsuccess = (e) => {
                stats.trades = e.target.result;
            };
            tx.objectStore(STORES.ALERTS).count().onsuccess = (e) => {
                stats.alerts = e.target.result;
            };
            tx.objectStore(STORES.EXCHANGE_INFO).get('exchangeInfo').onsuccess = (e) => {
                stats.exchangeInfo = !!e.target.result;
            };

            tx.oncomplete = () => resolve(stats);
            tx.onerror = () => resolve(stats);
        });
    } catch (error) {
        console.error('getCacheStats error:', error);
        return { candles: 0, trades: 0, alerts: 0, exchangeInfo: false };
    }
}









