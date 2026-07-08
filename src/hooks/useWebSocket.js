import { useState, useEffect, useRef, useCallback } from 'react';
import { createSubscribeRequest, createUnsubscribeRequest, normalizeMessage, CHANNEL_TYPES } from '../utils/channels';
import { redactLocalWebSocketAccess } from '../utils/localWebSocketAccess';

/**
 * WebSocket hook with channel subscription support
 * 
 * Supports both:
 * - New channel protocol (action: subscribe/unsubscribe)
 * - Legacy protocol (request: chart) for backward compatibility
 * 
 * @param {string} url - WebSocket URL
 * @param {Object} detailSubscription - Legacy detail subscription config (for backward compat)
 * @param {Function} handleMessage - Message handler callback
 * @returns {Object} { connection, subscribe, unsubscribe, sendMessage }
 */
const useWebSocket = (url, detailSubscription, handleMessage) => {
    const [connection, setConnection] = useState(null);
    const reconnectTimeoutRef = useRef(null);
    const connectionRef = useRef(null);
    const messageHandlerRef = useRef(handleMessage);
    const detailRef = useRef(detailSubscription);

    // Track active channel subscriptions
    const channelSubscriptionsRef = useRef(new Map());

    useEffect(() => {
        messageHandlerRef.current = handleMessage;
    }, [handleMessage]);

    useEffect(() => {
        detailRef.current = detailSubscription;
    }, [detailSubscription]);

    /**
     * Send a message over the WebSocket connection
     */
    const sendMessage = useCallback((message) => {
        const ws = connectionRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket not connected, cannot send message');
            return false;
        }

        try {
            ws.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('Failed to send WebSocket message:', error);
            return false;
        }
    }, []);

    /**
     * Unsubscribe from a channel
     * @param {string} channelId 
     */
    const unsubscribe = useCallback((channelId) => {
        if (!channelId || !channelSubscriptionsRef.current.has(channelId)) return;

        const { channelType, symbol, interval } = channelSubscriptionsRef.current.get(channelId);
        const request = createUnsubscribeRequest(channelId, channelType, symbol, interval);
        sendMessage(request);

        channelSubscriptionsRef.current.delete(channelId);
    }, [sendMessage]);

    const subscribe = useCallback((config) => {
        const { channelId, channelType = CHANNEL_TYPES.DETAIL, symbol, interval } = config;

        if (!channelId || !symbol || !interval) {
            console.error('Invalid subscribe config:', config);
            return false;
        }

        // Check if we already have this subscription
        if (channelSubscriptionsRef.current.has(channelId)) {
            console.log('[useWebSocket] Reusing existing subscription:', channelId);
            // Update lastUsed timestamp
            const sub = channelSubscriptionsRef.current.get(channelId);
            sub.lastUsed = Date.now();
            channelSubscriptionsRef.current.set(channelId, sub);
            return true;
        }

        // Enforce max connections (LRU)
        const MAX_CONNECTIONS = 50;
        if (channelSubscriptionsRef.current.size >= MAX_CONNECTIONS) {
            // Find oldest subscription
            let oldestId = null;
            let oldestTime = Infinity;

            for (const [id, sub] of channelSubscriptionsRef.current.entries()) {
                if (sub.lastUsed < oldestTime) {
                    oldestTime = sub.lastUsed;
                    oldestId = id;
                }
            }

            if (oldestId) {
                console.log('[useWebSocket] LRU Eviction:', oldestId);
                unsubscribe(oldestId);
            }
        }

        // Track this subscription
        channelSubscriptionsRef.current.set(channelId, {
            channelType,
            symbol,
            interval,
            lastUsed: Date.now()
        });

        const request = createSubscribeRequest(channelId, channelType, symbol, interval);
        return sendMessage(request);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sendMessage]);

    /**
     * Legacy: Send detail request (for backward compatibility)
     */
    const sendDetailRequest = useCallback((ws, detail) => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !detail) return;
        console.log('Sending chart update request', detail.panelState);
        ws.send(
            JSON.stringify({
                request: 'chart',
                data: {
                    ...detail.panelState,
                    selected: detail.symbol,
                    interval: detail.interval,
                    detailSymbol: detail.symbol,
                    detailInterval: detail.interval,
                    requestId: detail.requestId,
                },
            })
        );
    }, []);

    /**
     * Resubscribe all active channels (after reconnect)
     */
    const resubscribeChannels = useCallback((ws) => {
        for (const [channelId, config] of channelSubscriptionsRef.current) {
            const request = createSubscribeRequest(channelId, config.channelType, config.symbol, config.interval);
            try {
                ws.send(JSON.stringify(request));
                console.log('Resubscribed to channel:', channelId);
            } catch (error) {
                console.error('Failed to resubscribe channel:', channelId, error);
            }
        }
    }, []);

    useEffect(() => {
        const connect = () => {
            console.log('Connecting to WebSocket:', redactLocalWebSocketAccess(url));
            const ws = new WebSocket(url);
            connectionRef.current = ws;

            ws.onopen = () => {
                console.log('WebSocket Connected');

                // Resubscribe any active channels
                if (channelSubscriptionsRef.current.size > 0) {
                    resubscribeChannels(ws);
                }

                // Also send legacy detail request if provided
                sendDetailRequest(ws, detailRef.current);
                setConnection(ws);
            };

            ws.onmessage = (event) => {
                if (messageHandlerRef.current) {
                    // Parse message to detect format
                    try {
                        const rawMessage = JSON.parse(event.data);
                        const normalized = normalizeMessage(rawMessage);

                        // Pass both raw event and normalized message to handler
                        messageHandlerRef.current(event, ws, normalized);
                    } catch {
                        // If parsing fails, pass raw event
                        messageHandlerRef.current(event, ws, null);
                    }
                }
            };

            ws.onclose = (event) => {
                console.log('WebSocket Closed:', event.code);
                setConnection(null);
                connectionRef.current = null;
                reconnectTimeoutRef.current = setTimeout(connect, 500);
            };

            ws.onerror = (error) => {
                console.error('WebSocket Error:', error);
                ws.close();
            };
        };

        connect();

        return () => {
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            if (connectionRef.current) {
                connectionRef.current.onclose = null;
                connectionRef.current.close();
            }
        };
    }, [url, sendDetailRequest, resubscribeChannels]);

    // Send legacy detail request when subscription changes
    useEffect(() => {
        if (connection && connection.readyState === WebSocket.OPEN) {
            sendDetailRequest(connection, detailSubscription);
        }
    }, [connection, detailSubscription, sendDetailRequest]);

    // Return enhanced API
    return {
        connection,
        subscribe,
        unsubscribe,
        sendMessage,
        // For backward compatibility, also return connection directly
        // so existing code that does `const wsConnection = useWebSocket(...)` still works
        ...connection && { readyState: connection.readyState }
    };
};

export default useWebSocket;

// Named exports for new channel-based usage
export { useWebSocket };
