import { describe, expect, it } from 'vitest';
import {
    getRendererLocalWebSocketAccess,
    redactLocalWebSocketAccess,
    withLocalWebSocketAccess,
} from './localWebSocketAccess.js';

describe('renderer local WebSocket access', () => {
    // The address comes from the registered runtime and from nowhere else. The
    // argument-parsing path with its `127.0.0.1:14477` defaults is gone: it was
    // a second way to invent an endpoint this window was never given.
    it('has no address at all without a registered runtime', () => {
        expect(getRendererLocalWebSocketAccess()).toBeNull();
        expect(getRendererLocalWebSocketAccess.length).toBe(0);
    });

    it('adds the session token only to loopback websocket URLs', () => {
        const access = { host: '127.0.0.1', port: 14477, token: 'abc123', tokenParam: 'token' };

        expect(withLocalWebSocketAccess('ws://127.0.0.1:14477', access)).toBe('ws://127.0.0.1:14477/?token=abc123');
        expect(withLocalWebSocketAccess('ws://127.0.0.1:14477/stream?foo=bar', access)).toBe(
            'ws://127.0.0.1:14477/stream?foo=bar&token=abc123'
        );
        expect(withLocalWebSocketAccess('ws://localhost:14477', access)).toBe('ws://localhost:14477');
        expect(withLocalWebSocketAccess('ws://127.0.0.1:14478', access)).toBe('ws://127.0.0.1:14478');
        expect(withLocalWebSocketAccess('wss://127.0.0.1:14477', access)).toBe('wss://127.0.0.1:14477');
        expect(withLocalWebSocketAccess('ws://example.com:14477', access)).toBe('ws://example.com:14477');
        expect(withLocalWebSocketAccess('not a url', access)).toBe('not a url');
    });

    it('leaves URLs unchanged when no token is available', () => {
        expect(withLocalWebSocketAccess('ws://127.0.0.1:14477', {
            host: '127.0.0.1',
            port: 14477,
            token: '',
        })).toBe('ws://127.0.0.1:14477');
    });

    it('redacts the local websocket token in diagnostic URLs', () => {
        expect(redactLocalWebSocketAccess('ws://127.0.0.1:14477/?token=abc123')).toBe(
            'ws://127.0.0.1:14477/?token=redacted'
        );
        expect(redactLocalWebSocketAccess('ws://127.0.0.1:14477/?auth=abc123', 'auth')).toBe(
            'ws://127.0.0.1:14477/?auth=redacted'
        );
        expect(redactLocalWebSocketAccess('not a url')).toBe('not a url');
    });
});
