import { describe, expect, it } from 'vitest';
import {
    createLocalWebSocketAccess,
    createRendererWebSocketArguments,
    getRequestToken,
    isAllowedWebSocketOrigin,
    isExpectedToken,
    validateLocalWebSocketRequest,
} from './local-websocket-access.js';
import { RENDERER_ORIGIN } from '../renderer-protocol.js';

const makeRequest = ({ origin = RENDERER_ORIGIN, token = 'session-token', tokenParam = 'token' } = {}) => ({
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

    it('allows only the exact local renderer origin by default', () => {
        expect(isAllowedWebSocketOrigin(RENDERER_ORIGIN)).toMatchObject({
            allowed: true,
            reason: 'local-renderer-origin',
        });
        expect(isAllowedWebSocketOrigin('cc-trade://untrusted').allowed).toBe(false);
        expect(isAllowedWebSocketOrigin('http://localhost:5174').allowed).toBe(false);
        expect(isAllowedWebSocketOrigin('file://').allowed).toBe(false);
        expect(isAllowedWebSocketOrigin('null').allowed).toBe(false);
        expect(isAllowedWebSocketOrigin('').allowed).toBe(false);
    });

    it('allows an exact configured loopback development origin and rejects every other origin', () => {
        const allowedOrigins = [RENDERER_ORIGIN, 'http://localhost:5174/'];

        expect(isAllowedWebSocketOrigin('http://localhost:5174', allowedOrigins)).toMatchObject({
            allowed: true,
            reason: 'loopback-dev-origin',
        });
        expect(isAllowedWebSocketOrigin('http://127.0.0.1:5174', allowedOrigins).allowed).toBe(false);
        expect(isAllowedWebSocketOrigin('http://localhost:5175', allowedOrigins).allowed).toBe(false);
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
        const access = {
            token: 'session-token',
            tokenParam: 'token',
            allowedOrigins: [RENDERER_ORIGIN],
        };

        expect(validateLocalWebSocketRequest(makeRequest(), access)).toMatchObject({
            allowed: true,
            status: 101,
        });
        expect(validateLocalWebSocketRequest(makeRequest({ origin: 'http://localhost:5174' }), {
            ...access,
            allowedOrigins: [RENDERER_ORIGIN, 'http://localhost:5174'],
        })).toMatchObject({
            allowed: true,
            status: 101,
        });
        expect(validateLocalWebSocketRequest(makeRequest({ origin: 'https://example.com' }), access)).toMatchObject({
            allowed: false,
            status: 403,
        });
        expect(validateLocalWebSocketRequest(makeRequest({ origin: 'file://' }), access)).toMatchObject({
            allowed: false,
            status: 403,
        });
        expect(validateLocalWebSocketRequest(makeRequest({ token: 'wrong-token' }), access)).toMatchObject({
            allowed: false,
            status: 401,
        });
    });
});
