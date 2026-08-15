/**
 * ChannelManager - Manages multiple WebSocket subscription channels
 * 
 * Channel Types:
 * - detail: Full trading view (chart, depth, trades, orders, balances, history)
 * - mini: Lightweight chart-only subscription
 * - global: Shared data (ticker, filters) - single instance
 * 
 * Socket Architecture (MINIMAL - only 3 sockets total):
 * - 1 socket for tickers (globalWsConnection - !ticker@arr)
 * - 1 socket for user data (userDataWsConnection - listenKey)
 * - 1 socket for ALL market data (marketWsConnection - klines + trade + depth combined)
 */

const CHANNEL_TYPES = {
    DETAIL: 'detail',
    MINI: 'mini',
    GLOBAL: 'global'
};

// What data each channel type subscribes to
const CHANNEL_STREAMS = {
    [CHANNEL_TYPES.DETAIL]: ['kline', 'trade', 'depth'],
    [CHANNEL_TYPES.MINI]: ['kline'],
    [CHANNEL_TYPES.GLOBAL]: ['ticker']
};

/**
 * MarketStreamManager - Manages a SINGLE consolidated WebSocket for all market data
 * 
 * Combines into ONE socket:
 * - All kline streams (for mini charts + detail chart)
 * - Trade stream (ONLY when depth view is explicitly enabled)
 * - Depth stream (ONLY when depth view is explicitly enabled)
 * 
 * This minimizes WebSocket connections to just 1 for all market data.
 * 
 * IMPORTANT: Trade and Depth streams are NOT auto-subscribed!
 * Frontend must explicitly call enableDepthView() when entering DepthView.
 */
class MarketStreamManager {
    constructor(logger) {
        this.logger = logger || console;
        
        // Single market data socket for everything
        this.marketWsConnection = null;
        this.marketReconnectTimer = null;  // Debounce timer
        this.connectedStreams = [];        // Streams currently connected
        
        // Kline stream tracking
        this.klineStreams = new Map(); // streamName -> Set of channelIds
        
        // Detail symbol tracking (kline only)
        this.detailSymbol = null;
        
        // Depth view tracking (trade + depth streams) - SEPARATE from detail symbol
        this.depthViewEnabled = false;
        this.depthViewSymbol = null;
        
        // Callbacks
        this.onMessage = null;  // Single message handler that routes by event type
        this.connectFn = null;  // Will be set to client.websocketStreams.connect

        // Which lifecycle the in-flight connect belongs to. A connect that
        // resolves after cleanup used to be adopted as the current socket,
        // reviving a connection the operator had already left — and its close
        // handler could then schedule reconnects for a market nobody is on.
        this.connectGeneration = 0;
    }

    /**
     * Set the WebSocket connect function
     * @param {Function} connectFn - Function that takes { stream } and returns a WebSocket connection
     */
    setConnectFunction(connectFn) {
        this.connectFn = connectFn;
    }

    /**
     * Set message handler (single handler for all market data)
     * @param {Function} onMessage - Handler for all messages (kline, trade, depth)
     */
    setMessageHandler(onMessage) {
        this.onMessage = onMessage;
    }

    /**
     * Get the stream name for a kline subscription
     */
    getKlineStreamName(symbol, interval) {
        return `${symbol.toLowerCase()}@kline_${interval}`;
    }

    /**
     * Get all streams that should be subscribed to
     * @returns {string[]}
     */
    getAllStreams() {
        const streams = [];
        
        // Add all kline streams
        for (const streamName of this.klineStreams.keys()) {
            streams.push(streamName);
        }
        
        // Add trade + depth ONLY if depth view is explicitly enabled
        // This prevents unnecessary subscriptions when user is just on MainView
        if (this.depthViewEnabled && this.depthViewSymbol) {
            const symbol = this.depthViewSymbol.toLowerCase();
            streams.push(`${symbol}@trade`);
            streams.push(`${symbol}@depth@100ms`);
        }
        
        return streams;
    }

    /**
     * Add a kline stream subscription
     */
    addKlineStream(channelId, symbol, interval) {
        const streamName = this.getKlineStreamName(symbol, interval);
        
        if (!this.klineStreams.has(streamName)) {
            this.klineStreams.set(streamName, new Set());
        }
        this.klineStreams.get(streamName).add(channelId);
        
        this.logger.debug(`[MarketStreamManager] Added kline stream: ${streamName}`);
        
        // Schedule reconnect with debouncing
        this.scheduleReconnect();
    }

    /**
     * Remove a kline stream subscription
     */
    removeKlineStream(channelId, symbol, interval) {
        const streamName = this.getKlineStreamName(symbol, interval);
        
        if (this.klineStreams.has(streamName)) {
            const channels = this.klineStreams.get(streamName);
            channels.delete(channelId);
            
            if (channels.size === 0) {
                this.klineStreams.delete(streamName);
                this.logger.debug(`[MarketStreamManager] Removed kline stream: ${streamName}`);
            }
        }
        
        this.scheduleReconnect();
    }

    /**
     * Remove all kline streams for a channel
     */
    removeChannelStreams(channelId) {
        let changed = false;
        
        for (const [streamName, channels] of this.klineStreams.entries()) {
            if (channels.has(channelId)) {
                channels.delete(channelId);
                changed = true;
                
                if (channels.size === 0) {
                    this.klineStreams.delete(streamName);
                    this.logger.debug(`[MarketStreamManager] Removed kline stream: ${streamName}`);
                }
            }
        }
        
        if (changed) {
            this.scheduleReconnect();
        }
    }

    /**
     * Set the detail symbol (for kline stream management only)
     * NOTE: This does NOT subscribe to trade/depth - use enableDepthView() for that
     */
    setDetailSymbol(symbol) {
        if (this.detailSymbol === symbol) return;
        
        this.detailSymbol = symbol;
        this.logger.debug(`[MarketStreamManager] Set detail symbol: ${symbol}`);
        // No reconnect needed here - kline stream is added separately via addKlineStream
    }

    /**
     * Clear the detail symbol
     */
    clearDetailSymbol() {
        if (!this.detailSymbol) return;
        
        this.logger.debug(`[MarketStreamManager] Cleared detail symbol: ${this.detailSymbol}`);
        this.detailSymbol = null;
        
        // Also disable depth view if it was enabled for this symbol
        if (this.depthViewEnabled) {
            this.disableDepthView();
        }
    }

    /**
     * Enable depth view for a symbol (subscribes to trade + depth streams)
     * Call this ONLY when user is actually viewing the DepthView
     * @param {string} symbol - Symbol to enable depth view for
     */
    enableDepthView(symbol) {
        if (this.depthViewEnabled && this.depthViewSymbol === symbol) return;
        
        this.depthViewEnabled = true;
        this.depthViewSymbol = symbol;
        this.logger.info(`[MarketStreamManager] Enabled depth view for: ${symbol}`);
        
        // Schedule reconnect to add trade + depth streams
        this.scheduleReconnect();
    }

    /**
     * Disable depth view (unsubscribes from trade + depth streams)
     * Call this when user leaves DepthView
     */
    disableDepthView() {
        if (!this.depthViewEnabled) return;
        
        this.logger.info(`[MarketStreamManager] Disabled depth view for: ${this.depthViewSymbol}`);
        this.depthViewEnabled = false;
        this.depthViewSymbol = null;
        
        // Schedule reconnect to remove trade + depth streams
        this.scheduleReconnect();
    }

    /**
     * Check if depth view is enabled
     */
    isDepthViewEnabled() {
        return this.depthViewEnabled;
    }

    /**
     * Get the current depth view symbol
     */
    getDepthViewSymbol() {
        return this.depthViewSymbol;
    }

    /**
     * Get all kline stream names
     */
    getAllKlineStreams() {
        return Array.from(this.klineStreams.keys());
    }

    /**
     * Schedule a market socket reconnection with debouncing
     * Uses 2s debounce to batch multiple subscription changes during startup
     */
    scheduleReconnect() {
        if (this.marketReconnectTimer) {
            clearTimeout(this.marketReconnectTimer);
        }
        
        this.marketReconnectTimer = setTimeout(() => {
            this.marketReconnectTimer = null;
            this.reconnectIfNeeded();
        }, 2000);
    }

    /**
     * Check if reconnection is actually needed (streams changed)
     */
    reconnectIfNeeded() {
        const currentStreams = this.getAllStreams().sort();
        const connectedStreams = [...this.connectedStreams].sort();
        
        const streamsChanged = currentStreams.length !== connectedStreams.length ||
                               currentStreams.some((s, i) => s !== connectedStreams[i]);
        
        if (!streamsChanged && this.marketWsConnection) {
            this.logger.debug('[MarketStreamManager] Streams unchanged, skipping reconnect');
            return;
        }
        
        this.reconnectMarketSocket();
    }

    /**
     * Reconnect the single market WebSocket with all current streams
     * Handles klines + trade + depth all in ONE connection
     */
    async reconnectMarketSocket(retryCount = 0) {
        const MAX_RETRIES = 3;
        const RETRY_DELAY_BASE = 2000;
        // Everything below belongs to this lifecycle. If cleanup happens while
        // any of it is in flight, the work is discarded rather than applied.
        const generation = this.connectGeneration;

        const streams = this.getAllStreams();
        
        // Close existing connection
        if (this.marketWsConnection) {
            try {
                const closer = typeof this.marketWsConnection.disconnect === 'function'
                    ? this.marketWsConnection.disconnect.bind(this.marketWsConnection)
                    : typeof this.marketWsConnection.close === 'function'
                        ? this.marketWsConnection.close.bind(this.marketWsConnection)
                        : null;
                if (closer) await closer();
            } catch (err) {
                this.logger.debug('[MarketStreamManager] Error closing market socket (ignored):', err?.code || err?.message);
            }
            this.marketWsConnection = null;
            this.connectedStreams = [];
        }
        
        // If no streams, we're done
        if (streams.length === 0) {
            this.logger.info('[MarketStreamManager] No streams to subscribe to');
            return;
        }
        
        if (!this.connectFn) {
            this.logger.error('[MarketStreamManager] No connect function set');
            return;
        }
        
        try {
            this.logger.info(`[MarketStreamManager] Connecting market socket with ${streams.length} streams`);
            const connection = await this.connectFn({ stream: streams });
            if (generation !== this.connectGeneration) {
                // Cleanup ran while this connect was open. Adopting the socket
                // here is what revived a torn-down connection.
                this.logger.info('[MarketStreamManager] Discarding a connect that outlived its cleanup');
                await this.closeConnection(connection);
                return;
            }
            this.marketWsConnection = connection;
            this.connectedStreams = [...streams];

            this.marketWsConnection.on('message', (data) => {
                if (this.onMessage) {
                    this.onMessage(data);
                }
            });
            
            this.marketWsConnection.on('error', (err) => {
                const isNetworkError = err?.code === 'ECONNRESET' || 
                                       err?.code === 'ETIMEDOUT' ||
                                       err?.code === 'ENOTFOUND' ||
                                       err?.message?.includes('socket disconnected');
                if (isNetworkError) {
                    this.logger.warn(`[MarketStreamManager] Market socket network error (${err?.code}), will reconnect...`);
                } else {
                    this.logger.error('[MarketStreamManager] Market socket error:', err);
                }
            });
            
            this.marketWsConnection.on('close', (code, reason) => {
                const readableReason = typeof reason === 'string' ? reason : reason?.toString() ?? 'no reason';
                this.logger.warn(`[MarketStreamManager] Market socket closed (${code}): ${readableReason}`);
                this.connectedStreams = [];
                
                // Auto-reconnect on abnormal close, but never for a lifecycle
                // that has since been cleaned up.
                if (code !== 1000
                    && generation === this.connectGeneration
                    && this.getAllStreams().length > 0) {
                    this.logger.info('[MarketStreamManager] Scheduling market socket reconnection...');
                    setTimeout(() => {
                        if (generation !== this.connectGeneration) return;
                        this.reconnectMarketSocket();
                    }, 3000);
                }
            });
        } catch (err) {
            const isNetworkError = err?.code === 'ECONNRESET' || 
                                   err?.code === 'ETIMEDOUT' ||
                                   err?.code === 'ENOTFOUND' ||
                                   err?.code === 'ECONNREFUSED' ||
                                   err?.message?.includes('socket disconnected') ||
                                   err?.message?.includes('TLS') ||
                                   err?.message?.includes('timed out');
            
            if (isNetworkError && retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAY_BASE * (retryCount + 1);
                this.logger.warn(`[MarketStreamManager] Market socket connection failed (${err?.code || err?.message}), retrying in ${delay}ms (${retryCount + 1}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                if (generation !== this.connectGeneration) return;
                return this.reconnectMarketSocket(retryCount + 1);
            }
            
            this.logger.error('[MarketStreamManager] Failed to connect market socket:', err?.code || err?.message);
        }
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            streams: this.getAllStreams(),
            connected: !!this.marketWsConnection,
            detailSymbol: this.detailSymbol,
            depthViewEnabled: this.depthViewEnabled,
            depthViewSymbol: this.depthViewSymbol
        };
    }

    /**
     * Cleanup all connections
     */
    // Closes a socket that must not be kept, whichever shape it came back as.
    async closeConnection(connection) {
        if (!connection) return;
        const closer = typeof connection.disconnect === 'function'
            ? connection.disconnect.bind(connection)
            : typeof connection.close === 'function'
                ? connection.close.bind(connection)
                : null;
        if (!closer) return;
        try {
            await closer();
        } catch (err) {
            this.logger.debug('[MarketStreamManager] Error closing market socket (ignored):', err?.code || err?.message);
        }
    }

    async cleanup(disconnectFn) {
        // Anything already in flight now belongs to a lifecycle that is over.
        this.connectGeneration += 1;
        // Clear state to prevent auto-reconnect
        this.klineStreams.clear();
        this.detailSymbol = null;
        this.depthViewEnabled = false;
        this.depthViewSymbol = null;
        this.connectedStreams = [];
        
        // Clear reconnect timer
        if (this.marketReconnectTimer) {
            clearTimeout(this.marketReconnectTimer);
            this.marketReconnectTimer = null;
        }
        
        // Close the market socket
        if (this.marketWsConnection) {
            if (disconnectFn) {
                try {
                    await disconnectFn(this.marketWsConnection, 'market stream');
                } catch (err) {
                    this.logger.debug('[MarketStreamManager] Error closing market socket (ignored):', err?.code || err?.message);
                }
            }
            this.marketWsConnection = null;
        }
        
        this.logger.info('[MarketStreamManager] Cleaned up market socket');
    }
}

class ChannelManager {
    constructor(logger) {
        this.channels = new Map();
        this.logger = logger || console;
        this.marketStreamManager = new MarketStreamManager(logger);
    }

    /**
     * Get the market stream manager
     * @returns {MarketStreamManager}
     */
    getMarketStreamManager() {
        return this.marketStreamManager;
    }

    /**
     * Create a new channel subscription
     * @param {string} channelId - Unique channel identifier
     * @param {string} type - Channel type (detail, mini, global)
     * @param {string} symbol - Trading symbol (e.g., 'BTCUSDT')
     * @param {string} interval - Candle interval (e.g., '1h')
     * @returns {Object} The created channel
     */
    createChannel(channelId, type, symbol, interval) {
        if (this.channels.has(channelId)) {
            this.logger.warn(`Channel ${channelId} already exists, removing old one`);
            this.removeChannel(channelId);
        }

        const channel = {
            id: channelId,
            type,
            symbol: symbol?.toUpperCase(),
            interval,
            streams: CHANNEL_STREAMS[type] || [],
            wsConnection: null,
            depthCache: null,
            state: {
                initChart: true,
                initTrades: true,
                initDepth: true
            },
            createdAt: Date.now()
        };

        this.channels.set(channelId, channel);
        this.logger.info(`Channel created: ${channelId} (${type}, ${symbol}, ${interval})`);
        return channel;
    }

    /**
     * Get a channel by ID
     * @param {string} channelId
     * @returns {Object|null}
     */
    getChannel(channelId) {
        return this.channels.get(channelId) || null;
    }

    /**
     * Update channel properties
     * @param {string} channelId
     * @param {Object} updates
     * @returns {Object|null}
     */
    updateChannel(channelId, updates) {
        const channel = this.channels.get(channelId);
        if (!channel) {
            this.logger.warn(`Cannot update non-existent channel: ${channelId}`);
            return null;
        }
        
        Object.assign(channel, updates);
        return channel;
    }

    /**
     * Set the WebSocket connection for a channel
     * @param {string} channelId
     * @param {Object} wsConnection
     */
    setChannelConnection(channelId, wsConnection) {
        const channel = this.channels.get(channelId);
        if (channel) {
            channel.wsConnection = wsConnection;
        }
    }

    /**
     * Set the depth cache for a channel
     * @param {string} channelId
     * @param {Object} depthCache
     */
    setChannelDepthCache(channelId, depthCache) {
        const channel = this.channels.get(channelId);
        if (channel) {
            channel.depthCache = depthCache;
        }
    }

    /**
     * Remove a channel and cleanup its resources
     * @param {string} channelId
     * @param {Function} disconnectFn - Async function to disconnect WebSocket
     * @returns {boolean}
     */
    async removeChannel(channelId, disconnectFn) {
        const channel = this.channels.get(channelId);
        if (!channel) {
            return false;
        }

        // Cleanup WebSocket connection
        if (channel.wsConnection && disconnectFn) {
            try {
                await disconnectFn(channel.wsConnection, `channel ${channelId}`);
            } catch (err) {
                this.logger.warn(`Failed to disconnect channel ${channelId}:`, err);
            }
        }

        this.channels.delete(channelId);
        this.logger.info(`Channel removed: ${channelId}`);
        return true;
    }

    /**
     * Get all channels for a specific symbol
     * @param {string} symbol
     * @returns {Array}
     */
    getChannelsBySymbol(symbol) {
        const normalizedSymbol = symbol?.toUpperCase();
        const result = [];
        for (const channel of this.channels.values()) {
            if (channel.symbol === normalizedSymbol) {
                result.push(channel);
            }
        }
        return result;
    }

    /**
     * Get all channels of a specific type
     * @param {string} type
     * @returns {Array}
     */
    getChannelsByType(type) {
        const result = [];
        for (const channel of this.channels.values()) {
            if (channel.type === type) {
                result.push(channel);
            }
        }
        return result;
    }

    /**
     * Get the detail channel (there should only be one)
     * @returns {Object|null}
     */
    getDetailChannel() {
        const details = this.getChannelsByType(CHANNEL_TYPES.DETAIL);
        return details.length > 0 ? details[0] : null;
    }

    /**
     * Check if a channel exists
     * @param {string} channelId
     * @returns {boolean}
     */
    hasChannel(channelId) {
        return this.channels.has(channelId);
    }

    /**
     * Get all channel IDs
     * @returns {Array<string>}
     */
    getChannelIds() {
        return Array.from(this.channels.keys());
    }

    /**
     * Get channel count
     * @returns {number}
     */
    getChannelCount() {
        return this.channels.size;
    }

    /**
     * Cleanup all channels
     * @param {Function} disconnectFn - Async function to disconnect WebSocket
     */
    async cleanup(disconnectFn) {
        const channelIds = this.getChannelIds();
        this.logger.info(`Cleaning up ${channelIds.length} channels`);
        
        for (const channelId of channelIds) {
            await this.removeChannel(channelId, disconnectFn);
        }
        
        // Cleanup consolidated market stream connections
        await this.marketStreamManager.cleanup(disconnectFn);
    }

    /**
     * Get debug info about all channels
     * @returns {Object}
     */
    getDebugInfo() {
        const info = {};
        for (const [id, channel] of this.channels) {
            info[id] = {
                type: channel.type,
                symbol: channel.symbol,
                interval: channel.interval,
                hasConnection: !!channel.wsConnection,
                createdAt: channel.createdAt
            };
        }
        return info;
    }
}

/**
 * Generate a unique channel ID
 * @param {string} type - Channel type
 * @param {string} symbol - Trading symbol
 * @param {string} interval - Candle interval
 * @returns {string}
 */
function createChannelId(type, symbol, interval) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 6);
    return `${type}-${symbol?.toUpperCase()}-${interval}-${timestamp}-${random}`;
}

/**
 * Parse a channel ID to extract components
 * @param {string} channelId
 * @returns {Object}
 */
function parseChannelId(channelId) {
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
}

export { ChannelManager, MarketStreamManager, CHANNEL_TYPES, CHANNEL_STREAMS, createChannelId, parseChannelId };

