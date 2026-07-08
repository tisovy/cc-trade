import { describe, expect, it } from 'vitest';
import {
    getRendererLocalWebSocketAccess,
    redactLocalWebSocketAccess,
    withLocalWebSocketAccess,
} from './localWebSocketAccess.js';

describe('renderer local WebSocket access', () => {
    it('reads Electron renderer arguments with safe defaults', () => {
        expect(getRendererLocalWebSocketAccess([
            '--local-ws-host=127.0.0.1',
            '--local-ws-token-param=token',
            '--local-ws-token=abc123',
        ])).toEqual({
            host: '127.0.0.1',
            token: 'abc123',
            tokenParam: 'token',
        });

        expect(getRendererLocalWebSocketAccess([])).toEqual({
            host: '127.0.0.1',
            token: '',
            tokenParam: 'token',
        });
    });

    it('adds the session token only to loopback websocket URLs', () => {
        const access = { host: '127.0.0.1', token: 'abc123', tokenParam: 'token' };

        expect(withLocalWebSocketAccess('ws://127.0.0.1:14477', access)).toBe('ws://127.0.0.1:14477/?token=abc123');
        expect(withLocalWebSocketAccess('ws://localhost:14477/stream?foo=bar', access)).toBe(
            'ws://localhost:14477/stream?foo=bar&token=abc123'
        );
        expect(withLocalWebSocketAccess('wss://[::1]:14477', access)).toBe('wss://[::1]:14477/?token=abc123');
        expect(withLocalWebSocketAccess('ws://example.com:14477', access)).toBe('ws://example.com:14477');
        expect(withLocalWebSocketAccess('not a url', access)).toBe('not a url');
    });

    it('leaves URLs unchanged when no token is available', () => {
        expect(withLocalWebSocketAccess('ws://127.0.0.1:14477', { token: '' })).toBe('ws://127.0.0.1:14477');
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
