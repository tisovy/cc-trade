import { describe, expect, it } from 'vitest';
import {
    createLocalWebSocketAccess,
    createRendererWebSocketArguments,
    getRequestToken,
    isAllowedWebSocketOrigin,
    isExpectedToken,
    validateLocalWebSocketRequest,
} from './local-websocket-access.js';

const makeRequest = ({ origin = 'http://localhost:5174', token = 'session-token', tokenParam = 'token' } = {}) => ({
    origin,
    resourceURL: {
        query: token ? { [tokenParam]: token } : {},
    },
    httpRequest: {
        url: token ? `/?${tokenParam}=${encodeURIComponent(token)}` : '/',
    },
});

describe('local WebSocket access control', () => {
    it('creates per-session renderer arguments without hard-coded tokens', () => {
        const access = createLocalWebSocketAccess({ token: 'abc123' });

        expect(access.host).toBe('127.0.0.1');
        expect(access.token).toBe('abc123');
        expect(createRendererWebSocketArguments(access)).toEqual([
            '--local-ws-host=127.0.0.1',
            '--local-ws-token-param=token',
            '--local-ws-token=abc123',
        ]);
    });

    it('allows loopback and Electron file origins', () => {
        expect(isAllowedWebSocketOrigin('http://localhost:5174').allowed).toBe(true);
        expect(isAllowedWebSocketOrigin('http://127.0.0.1:5174').allowed).toBe(true);
        expect(isAllowedWebSocketOrigin('http://[::1]:5174').allowed).toBe(true);
        expect(isAllowedWebSocketOrigin('file://').allowed).toBe(true);
        expect(isAllowedWebSocketOrigin('null').allowed).toBe(true);
        expect(isAllowedWebSocketOrigin('').allowed).toBe(true);
    });

    it('rejects non-local origins', () => {
        expect(isAllowedWebSocketOrigin('https://example.com').allowed).toBe(false);
        expect(isAllowedWebSocketOrigin('http://localhost.example.com').allowed).toBe(false);
        expect(isAllowedWebSocketOrigin('not a url').allowed).toBe(false);
    });

    it('extracts tokens from parsed and raw request URLs', () => {
        expect(getRequestToken(makeRequest({ token: 'from-query' }))).toBe('from-query');
        expect(getRequestToken({
            resourceURL: { query: {} },
            httpRequest: { url: '/socket?token=from-url' },
        })).toBe('from-url');
    });

    it('compares tokens without accepting missing or partial values', () => {
        expect(isExpectedToken('session-token', 'session-token')).toBe(true);
        expect(isExpectedToken('session-token', 'SESSION-token')).toBe(false);
        expect(isExpectedToken('session', 'session-token')).toBe(false);
        expect(isExpectedToken('', 'session-token')).toBe(false);
    });

    it('rejects requests with bad origin or token before websocket accept', () => {
        const access = { token: 'session-token', tokenParam: 'token' };

        expect(validateLocalWebSocketRequest(makeRequest(), access)).toMatchObject({
            allowed: true,
            status: 101,
        });
        expect(validateLocalWebSocketRequest(makeRequest({ origin: 'https://example.com' }), access)).toMatchObject({
            allowed: false,
            status: 403,
        });
        expect(validateLocalWebSocketRequest(makeRequest({ token: 'wrong-token' }), access)).toMatchObject({
            allowed: false,
            status: 401,
        });
    });
});
