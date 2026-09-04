import { createHmac, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const SPOT_PRIVATE_WS_URL = 'wss://ws-api.binance.com:443/ws-api/v3';
export const SPOT_PRIVATE_MAX_PAYLOAD = 256 * 1024;
const WAIT_MS = 10_000;
const PEER_SILENCE_MS = 60_000;
const RETRY_DELAYS = [3_000, 6_000, 9_000, 12_000, 15_000];
const TERMINAL_CODES = new Set([-2014, -2015, -1022]);

const readPeerFrame = (data, isBinary) => {
    if (isBinary) throw new Error('Binary frame');
    const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
    if (Buffer.byteLength(text) > SPOT_PRIVATE_MAX_PAYLOAD) throw new Error('Oversized frame');
    // Exchange order/trade ids must not be rounded before reaching the desk.
    return JSON.parse(text, (_key, value, context) => {
        if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
            if (!context?.source) throw new Error('Unsafe numeric id');
            return context.source;
        }
        return value;
    });
};

// One controller, one current generation, no SDK-owned reconnect alongside it.
// Admission callbacks run immediately before each physical socket/send, not
// before a queue wait that may outlive the last consumer.
export const createSpotUserDataStream = ({
    apiKey, apiSecret, createSocket, agent, admit = async (run) => run(),
    onState = () => {}, onEvent = () => {}, onReady = () => {},
    now = Date.now,
}) => {
    let running = false;
    let current = null;
    let retryTimer = null;
    let failures = 0;
    let status = { state: 'stopped', reason: null, subscriptionId: null, changedAt: now() };

    const publish = (state, reason = null, exchangeCode = null) => {
        status = { state, reason, exchangeCode, subscriptionId: current?.subscriptionId ?? null, changedAt: now() };
        onState({ ...status });
    };
    const owns = (session) => running && current === session;
    const retire = (session) => {
        if (!session) return;
        clearTimeout(session.waitTimer);
        clearInterval(session.heartbeatTimer);
        try { session.socket?.terminate(); } catch { /* already closed */ }
    };
    const fail = (session, reason, { terminal = false, exchangeCode = null } = {}) => {
        if (!owns(session)) return;
        current = null;
        retire(session);
        const delay = RETRY_DELAYS[failures++];
        if (terminal || delay === undefined) {
            publish('failed', reason, exchangeCode);
            return;
        }
        publish('reconnecting', reason, exchangeCode);
        retryTimer = setTimeout(() => {
            retryTimer = null;
            if (running) void connect();
        }, delay);
        retryTimer.unref?.();
    };
    const subscribe = async (session) => {
        try {
            await admit(() => {
                if (!owns(session)) return;
                const params = { apiKey, recvWindow: 60000, timestamp: now() };
                const signingText = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
                params.signature = createHmac('sha256', apiSecret).update(signingText).digest('hex');
                session.requestId = randomUUID();
                session.waitTimer = setTimeout(() => fail(session, 'subscription-timeout'), WAIT_MS);
                session.waitTimer.unref?.();
                // Listener and pending id exist before send: even an immediate
                // acknowledgement belongs to the right request.
                session.socket.send(JSON.stringify({
                    id: session.requestId, method: 'userDataStream.subscribe.signature', params,
                }), (error) => { if (error) fail(session, 'subscription-send-failed'); });
            }, 2);
        } catch {
            fail(session, 'subscription-send-failed');
        }
    };
    const receive = (session, data, isBinary) => {
        if (!owns(session)) return;
        session.lastPeerAt = now();
        let frame;
        try { frame = readPeerFrame(data, isBinary); } catch {
            fail(session, 'invalid-peer-frame');
            return;
        }
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
            fail(session, 'invalid-peer-frame');
            return;
        }
        if (session.requestId && frame.id === session.requestId) {
            if (session.subscriptionId !== null) return;
            if (frame.status !== 200 || !Number.isSafeInteger(frame.result?.subscriptionId)
                || frame.result.subscriptionId < 0) {
                const exchangeCode = Number.isSafeInteger(frame.error?.code) ? frame.error.code : null;
                fail(session, 'subscription-refused', {
                    terminal: [401, 403, 418, 429].includes(frame.status) || TERMINAL_CODES.has(exchangeCode),
                    exchangeCode,
                });
                return;
            }
            clearTimeout(session.waitTimer);
            session.subscriptionId = frame.result.subscriptionId;
            failures = 0;
            publish('ready');
            onReady();
            return;
        }
        if (frame.event?.e === 'serverShutdown') {
            fail(session, 'server-shutdown');
            return;
        }
        if (session.subscriptionId === null || frame.subscriptionId !== session.subscriptionId) return;
        if (frame.event?.e === 'eventStreamTerminated') {
            fail(session, 'subscription-ended');
            return;
        }
        if (frame.event && typeof frame.event === 'object' && !Array.isArray(frame.event)) {
            onEvent(frame.event);
        }
    };
    const connect = async () => {
        if (!running || current) return;
        const session = { socket: null, subscriptionId: null, requestId: null, lastPeerAt: now() };
        current = session;
        publish('connecting');
        try {
            await admit(() => {
                if (!owns(session)) return;
                const socket = createSocket(SPOT_PRIVATE_WS_URL, {
                    agent: agent ?? undefined, handshakeTimeout: WAIT_MS,
                    maxPayload: SPOT_PRIVATE_MAX_PAYLOAD, perMessageDeflate: false,
                    followRedirects: false, autoPong: true,
                });
                session.socket = socket;
                session.waitTimer = setTimeout(() => fail(session, 'connection-timeout'), WAIT_MS);
                session.waitTimer.unref?.();
                socket.on('open', () => {
                    if (!owns(session)) return;
                    clearTimeout(session.waitTimer);
                    session.lastPeerAt = now();
                    publish('subscribing');
                    session.heartbeatTimer = setInterval(() => {
                        if (owns(session) && now() - session.lastPeerAt >= PEER_SILENCE_MS) {
                            fail(session, 'peer-silent');
                        }
                    }, 10_000);
                    session.heartbeatTimer.unref?.();
                    void subscribe(session);
                });
                socket.on('message', (data, isBinary) => receive(session, data, isBinary));
                socket.on('ping', () => { if (owns(session)) session.lastPeerAt = now(); });
                socket.on('pong', () => { if (owns(session)) session.lastPeerAt = now(); });
                socket.on('error', () => fail(session, 'connection-error'));
                socket.on('close', () => fail(session, 'connection-closed'));
            }, 2);
        } catch {
            fail(session, 'connection-error');
        }
    };

    return {
        start() {
            if (running) return;
            running = true;
            failures = 0;
            void connect();
        },
        stop() {
            running = false;
            clearTimeout(retryTimer);
            retryTimer = null;
            const previous = current;
            current = null;
            retire(previous);
            publish('stopped');
        },
        getStatus: () => ({ ...status }),
    };
};
