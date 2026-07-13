import { randomBytes, timingSafeEqual } from 'crypto';
import { RENDERER_ORIGIN } from '../renderer-protocol.js';

export const LOCAL_WEBSOCKET_HOST = '127.0.0.1';
export const LOCAL_WEBSOCKET_PORT = 14477;
export const LOCAL_WEBSOCKET_TOKEN_PARAM = 'token';

const LOCAL_ORIGIN_PROTOCOLS = new Set(['http:', 'https:']);
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const TOKEN_ARG = 'local-ws-token';
const HOST_ARG = 'local-ws-host';
const PORT_ARG = 'local-ws-port';
const TOKEN_PARAM_ARG = 'local-ws-token-param';

const normalizeValue = (value) => typeof value === 'string' ? value.trim() : '';

const normalizeLoopbackOrigin = (value, { requireOriginForm = false } = {}) => {
    const normalized = normalizeValue(value);
    if (!normalized) return null;

    try {
        const originUrl = new URL(normalized);
        if (!LOCAL_ORIGIN_PROTOCOLS.has(originUrl.protocol) || !isLoopbackHostname(originUrl.hostname)) {
            return null;
        }
        if (requireOriginForm && normalized !== originUrl.origin) {
            return null;
        }
        return originUrl.origin;
    } catch {
        return null;
    }
};

const normalizeConfiguredOrigin = (origin) => {
    const normalized = normalizeValue(origin);
    if (normalized === RENDERER_ORIGIN) return RENDERER_ORIGIN;
    return normalizeLoopbackOrigin(normalized);
};

const normalizeRequestOrigin = (origin) => {
    const normalized = normalizeValue(origin);
    if (normalized === RENDERER_ORIGIN) return RENDERER_ORIGIN;
    return normalizeLoopbackOrigin(normalized, { requireOriginForm: true });
};

export const isLoopbackHostname = (hostname) => {
    const normalized = normalizeValue(hostname).toLowerCase();
    return LOOPBACK_HOSTNAMES.has(normalized);
};

export const resolveLocalWebSocketPort = (
    value = process.env.WS_PORT || process.env.WEBSOCKET_PORT || process.env.VITE_WS_PORT,
) => {
    const numericPort = typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : value;
    return Number.isSafeInteger(numericPort) && numericPort >= 1 && numericPort <= 65535
        ? numericPort
        : LOCAL_WEBSOCKET_PORT;
};

export const createLocalWebSocketAccess = ({
    host = LOCAL_WEBSOCKET_HOST,
    port = resolveLocalWebSocketPort(),
    token = randomBytes(32).toString('base64url'),
    tokenParam = LOCAL_WEBSOCKET_TOKEN_PARAM,
} = {}) => ({
    host,
    port: resolveLocalWebSocketPort(port),
    token,
    tokenParam,
});

export const createRendererWebSocketArguments = ({
    host = LOCAL_WEBSOCKET_HOST,
    port = LOCAL_WEBSOCKET_PORT,
    token,
    tokenParam = LOCAL_WEBSOCKET_TOKEN_PARAM,
} = {}) => {
    const args = [
        `--${HOST_ARG}=${host}`,
        `--${PORT_ARG}=${resolveLocalWebSocketPort(port)}`,
        `--${TOKEN_PARAM_ARG}=${tokenParam}`,
    ];
    if (token) {
        args.push(`--${TOKEN_ARG}=${token}`);
    }
    return args;
};

export const isAllowedWebSocketOrigin = (origin, allowedOrigins = [RENDERER_ORIGIN]) => {
    const requestOrigin = normalizeRequestOrigin(origin);
    if (!requestOrigin) {
        return { allowed: false, reason: 'invalid-or-missing-origin' };
    }

    const trustedOrigins = new Set(
        (Array.isArray(allowedOrigins) ? allowedOrigins : [])
            .map(normalizeConfiguredOrigin)
            .filter(Boolean),
    );
    if (!trustedOrigins.has(requestOrigin)) {
        return { allowed: false, reason: 'untrusted-origin' };
    }

    return {
        allowed: true,
        reason: requestOrigin === RENDERER_ORIGIN ? 'local-renderer-origin' : 'loopback-dev-origin',
    };
};

export const getRequestToken = (request, tokenParam = LOCAL_WEBSOCKET_TOKEN_PARAM) => {
    const queryValue = request?.resourceURL?.query?.[tokenParam];
    if (Array.isArray(queryValue)) {
        return queryValue[0] || '';
    }
    if (typeof queryValue === 'string') {
        return queryValue;
    }

    const rawUrl = request?.httpRequest?.url;
    if (!rawUrl) {
        return '';
    }

    try {
        const parsedUrl = new URL(rawUrl, `ws://${LOCAL_WEBSOCKET_HOST}`);
        return parsedUrl.searchParams.get(tokenParam) || '';
    } catch {
        return '';
    }
};

export const isExpectedToken = (candidate, expected) => {
    const candidateToken = normalizeValue(candidate);
    const expectedToken = normalizeValue(expected);
    if (!candidateToken || !expectedToken) {
        return false;
    }

    const candidateBuffer = Buffer.from(candidateToken);
    const expectedBuffer = Buffer.from(expectedToken);
    if (candidateBuffer.length !== expectedBuffer.length) {
        return false;
    }

    return timingSafeEqual(candidateBuffer, expectedBuffer);
};

export const validateLocalWebSocketRequest = (request, access = {}) => {
    const originCheck = isAllowedWebSocketOrigin(request?.origin, access.allowedOrigins);
    if (!originCheck.allowed) {
        return {
            allowed: false,
            status: 403,
            reason: originCheck.reason,
        };
    }

    if (access.token) {
        const requestToken = getRequestToken(request, access.tokenParam);
        if (!isExpectedToken(requestToken, access.token)) {
            return {
                allowed: false,
                status: 401,
                reason: 'invalid-token',
            };
        }
    }

    return {
        allowed: true,
        status: 101,
        reason: originCheck.reason,
    };
};
