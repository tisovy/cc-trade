/**
 * Channel utilities for WebSocket subscription management
 * 
 * Channels are abstractions over WebSocket subscriptions that allow
 * multiple concurrent data streams (e.g., multiple charts).
 */

export const CHANNEL_TYPES = {
    DETAIL: 'detail',  // Full trading view (chart, depth, trades, orders, balances, history)
    MINI: 'mini',      // Lightweight chart-only subscription
    GLOBAL: 'global'   // Shared data (ticker, filters)
};

// What data each channel type receives
export const CHANNEL_DATA_TYPES = {
    [CHANNEL_TYPES.DETAIL]: ['chart', 'depth', 'trades', 'orders', 'balances', 'history', 'execution_update'],
    [CHANNEL_TYPES.MINI]: ['chart'],
    [CHANNEL_TYPES.GLOBAL]: ['ticker', 'ticker_update', 'filters']
};

/**
 * Generate a unique channel ID
 * @param {string} type - Channel type (detail, mini, global)
 * @param {string} symbol - Trading symbol (e.g., 'BTCUSDT')
 * @param {string} interval - Candle interval (e.g., '1h')
 * @returns {string} Unique channel ID
 */
export const createChannelId = (type, symbol, interval) => {
    // Deterministic ID for reuse
    return `${type}-${symbol?.toUpperCase()}-${interval}`;
};

/**
 * Parse a channel ID to extract its components
 * @param {string} channelId 
 * @returns {Object} { type, symbol, interval }
 */
export const parseChannelId = (channelId) => {
    if (!channelId || channelId === 'global') {
        return { type: 'global', symbol: null, interval: null };
    }

    const parts = channelId.split('-');
    if (parts.length < 3) {
        return { type: 'unknown', symbol: null, interval: null };
    }

    return {
        type: parts[0],
        symbol: parts[1],
        interval: parts[2]
    };
};

/**
 * Check if a message type is valid for a channel type
 * @param {string} channelType 
 * @param {string} messageType 
 * @returns {boolean}
 */
export const isValidMessageForChannel = (channelType, messageType) => {
    const validTypes = CHANNEL_DATA_TYPES[channelType];
    if (!validTypes) return true; // Unknown channel type, allow all
    return validTypes.includes(messageType);
};

/**
 * Create initial channel data state
 * @param {string} channelType 
 * @returns {Object}
 */
export const createChannelData = (channelType) => {
    const base = {
        chart: [],
        lastTick: null,
        isLoading: true,
        lastUpdate: null
    };

    if (channelType === CHANNEL_TYPES.DETAIL) {
        return {
            ...base,
            depth: { bids: {}, asks: {} },
            trades: [],
            orders: [],
            balances: {},
            history: []
        };
    }

    return base;
};

/**
 * Create a subscription request payload
 * @param {string} channelId 
 * @param {string} channelType 
 * @param {string} symbol 
 * @param {string} interval 
 * @returns {Object}
 */
export const createSubscribeRequest = (channelId, channelType, symbol, interval) => ({
    action: 'subscribe',
    channelId,
    channelType,
    symbol: symbol?.toUpperCase(),
    interval
});

/**
 * Create an unsubscribe request payload
 * @param {string} channelId 
 * @returns {Object}
 */
export const createUnsubscribeRequest = (channelId) => ({
    action: 'unsubscribe',
    channelId
});

/**
 * Check if a message is in the new channel format
 * @param {Object} message 
 * @returns {boolean}
 */
export const isChannelMessage = (message) => {
    return !!message?.channelId;
};

/**
 * Check if a message is a global message
 * @param {Object} message 
 * @returns {boolean}
 */
export const isGlobalMessage = (message) => {
    return message?.channelId === 'global';
};

/**
 * Normalize a message to extract key fields consistently
 * Works with both new channel format and legacy format
 * @param {Object} message 
 * @returns {Object} { channelId, type, symbol, interval, payload, extra }
 */
export const normalizeMessage = (message) => {
    // New channel format
    if (message.channelId) {
        return {
            channelId: message.channelId,
            type: message.type,
            symbol: message.symbol,
            interval: message.interval,
            payload: message.payload,
            extra: message.extra,
            requestId: message.requestId
        };
    }

    // Legacy format - try to detect message type
    const type = detectLegacyMessageType(message);
    const symbol = message.symbol || message.detailSymbol;
    const interval = message.interval || message.detailInterval;

    return {
        channelId: null,
        type,
        symbol,
        interval,
        payload: message[type] || message.payload,
        extra: message.last_tick || message.extra,
        requestId: message.requestId
    };
};

/**
 * Detect the message type from a legacy format message
 * @param {Object} message 
 * @returns {string|null}
 */
const detectLegacyMessageType = (message) => {
    const knownTypes = [
        'chart', 'depth', 'trades', 'orders', 'balances',
        'filters', 'history', 'ticker', 'ticker_update', 'ticker_batch',
        'execution_update', 'balance_update'
    ];

    for (const type of knownTypes) {
        if (Object.hasOwn(message, type)) {
            return type;
        }
    }

    return null;
};

