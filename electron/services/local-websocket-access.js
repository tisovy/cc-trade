import { randomBytes, timingSafeEqual } from 'crypto';

export const LOCAL_WEBSOCKET_HOST = '127.0.0.1';
export const LOCAL_WEBSOCKET_TOKEN_PARAM = 'token';

const LOCAL_ORIGIN_PROTOCOLS = new Set(['http:', 'https:']);
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const TOKEN_ARG = 'local-ws-token';
const HOST_ARG = 'local-ws-host';
const TOKEN_PARAM_ARG = 'local-ws-token-param';

const normalizeValue = (value) => typeof value === 'string' ? value.trim() : '';

export const isLoopbackHostname = (hostname) => {
    const normalized = normalizeValue(hostname).toLowerCase();
    return LOOPBACK_HOSTNAMES.has(normalized);
};

export const createLocalWebSocketAccess = ({
    host = LOCAL_WEBSOCKET_HOST,
    token = randomBytes(32).toString('base64url'),
    tokenParam = LOCAL_WEBSOCKET_TOKEN_PARAM,
} = {}) => ({
    host,
    token,
    tokenParam,
});

export const createRendererWebSocketArguments = ({
    host = LOCAL_WEBSOCKET_HOST,
    token,
    tokenParam = LOCAL_WEBSOCKET_TOKEN_PARAM,
} = {}) => {
    const args = [`--${HOST_ARG}=${host}`, `--${TOKEN_PARAM_ARG}=${tokenParam}`];
    if (token) {
        args.push(`--${TOKEN_ARG}=${token}`);
    }
    return args;
};

export const isAllowedWebSocketOrigin = (origin) => {
    const normalized = normalizeValue(origin);
    if (!normalized) {
        return { allowed: true, reason: 'origin-unavailable' };
    }
    if (normalized === 'null') {
        return { allowed: true, reason: 'opaque-origin' };
    }

    try {
        const originUrl = new URL(normalized);
        if (originUrl.protocol === 'file:') {
            return { allowed: true, reason: 'file-origin' };
        }
        if (LOCAL_ORIGIN_PROTOCOLS.has(originUrl.protocol) && isLoopbackHostname(originUrl.hostname)) {
            return { allowed: true, reason: 'loopback-origin' };
        }
    } catch {
        return { allowed: false, reason: 'invalid-origin' };
    }

    return { allowed: false, reason: 'non-local-origin' };
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
    const originCheck = isAllowedWebSocketOrigin(request?.origin);
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
