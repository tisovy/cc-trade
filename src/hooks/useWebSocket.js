import { useState, useEffect, useRef, useCallback } from 'react';
import { createSubscribeRequest, createUnsubscribeRequest, CHANNEL_TYPES } from '../utils/channels';
import { DESK_FRAME_KINDS, ensureDeskFrameRouter } from '../utils/deskFrameRouter';
import {
    LOCAL_WEBSOCKET_AUTH_CLOSE_CODE,
    redactLocalWebSocketAccess,
} from '../utils/localWebSocketAccess';

// Two failures that retrying cannot fix. Everything else keeps reconnecting.
export const TRANSPORT_FAILURES = Object.freeze({
    RUNTIME_UNAVAILABLE: Object.freeze({
        code: 'RUNTIME_UNAVAILABLE',
        message: 'This window was not issued a local backend address.'
            + ' Restart the application; if it recurs, the backend did not start.',
    }),
    AUTHENTICATION_REJECTED: Object.freeze({
        code: 'AUTHENTICATION_REJECTED',
        message: 'The local backend refused this window\'s session token.'
            + ' Restart the application so a matching token is issued.',
    }),
});

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
 * @param {Function} [frameMessage] - Last chance to amend an outgoing frame,
 *   called with the message and the socket it is about to be written to. This is
 *   the one place every frame passes through: the channel helpers below build
 *   and send their own, so anything applied only at a caller misses them.
 * @returns {Object} { connection, subscribe, unsubscribe, sendMessage }
 */
const useWebSocket = (url, detailSubscription, handleMessage, frameMessage = null) => {
    const [connection, setConnection] = useState(null);
    // A failure the retry loop cannot resolve, held so the operator is told
    // rather than left watching a silent reconnect that will never succeed.
    const [failure, setFailure] = useState(null);
    const [retryGeneration, setRetryGeneration] = useState(0);
    const reconnectTimeoutRef = useRef(null);
    const connectionRef = useRef(null);
    const messageHandlerRef = useRef(handleMessage);
    const detailRef = useRef(detailSubscription);
    // Held in a ref so `sendMessage` keeps one identity: it is a dependency of
    // the effects that activate the market, and rebuilding it on every change
    // of what it stamps re-ran them.
    const frameMessageRef = useRef(frameMessage);

    // Track active channel subscriptions
    const channelSubscriptionsRef = useRef(new Map());

    useEffect(() => {
        messageHandlerRef.current = handleMessage;
    }, [handleMessage]);

    useEffect(() => {
        detailRef.current = detailSubscription;
    }, [detailSubscription]);

    useEffect(() => {
        frameMessageRef.current = frameMessage;
    }, [frameMessage]);

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
            const frame = frameMessageRef.current
                ? frameMessageRef.current(message, ws)
                : message;
            ws.send(JSON.stringify(frame));
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
        // No address means no connection. Dialling a default endpoint instead is
        // exactly what produced an endless `invalid token` reconnect.
        if (!url) {
            setConnection(null);
            connectionRef.current = null;
            setFailure(TRANSPORT_FAILURES.RUNTIME_UNAVAILABLE);
            return undefined;
        }
        setFailure(null);

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

            // The frame is read once, here, and every subscriber below is handed
            // the parsed, named frame. Subscribing first is what puts the
            // gateway's own reading ahead of the hooks that mount on this
            // socket afterwards — it writes the activation they send under.
            ensureDeskFrameRouter(ws)?.subscribe(
                Object.values(DESK_FRAME_KINDS),
                (frame, event) => messageHandlerRef.current?.(event, ws, frame),
            );

            ws.onclose = (event) => {
                console.log('WebSocket Closed:', event.code);
                setConnection(null);
                connectionRef.current = null;
                // A refused token is not a transport hiccup: the next attempt
                // carries the same token and is refused the same way. Retrying
                // it 120 times a minute is what filled the log with `invalid
                // token` and hid the real cause. Say it once and stop.
                if (event.code === LOCAL_WEBSOCKET_AUTH_CLOSE_CODE) {
                    setFailure(TRANSPORT_FAILURES.AUTHENTICATION_REJECTED);
                    return;
                }
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
    }, [url, retryGeneration, sendDetailRequest, resubscribeChannels]);

    // The explicit operator action that resumes a stopped transport. A reload
    // resumes it too, by re-running the preload and issuing a fresh runtime.
    const reconnect = useCallback(() => {
        setFailure(null);
        setRetryGeneration(generation => generation + 1);
    }, []);

    // Send legacy detail request when subscription changes
    useEffect(() => {
        if (connection && connection.readyState === WebSocket.OPEN) {
            sendDetailRequest(connection, detailSubscription);
        }
    }, [connection, detailSubscription, sendDetailRequest]);

    // Return enhanced API
    return {
        connection,
        failure,
        reconnect,
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
