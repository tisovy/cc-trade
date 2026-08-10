import { getRendererRuntime } from './rendererRuntime';

const DEFAULT_LOCAL_WS_TOKEN_PARAM = 'token';
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// The close code the local backend uses to say "this token is not mine". A
// rejected handshake reaches the renderer as an anonymous 1006, which reads
// exactly like a backend that has not started yet — so the renderer retried it
// forever. This code is delivered to the client and is terminal.
export const LOCAL_WEBSOCKET_AUTH_CLOSE_CODE = 4401;

const isExactLocalWebSocketUrl = (url, access) => {
    const hostname = url.hostname.toLowerCase();
    const expectedHost = typeof access.host === 'string' ? access.host.toLowerCase() : '';
    const expectedPort = Number(access.port);
    const actualPort = url.port ? Number(url.port) : 80;
    return url.protocol === 'ws:'
        && LOOPBACK_HOSTNAMES.has(hostname)
        && hostname === expectedHost
        && Number.isSafeInteger(expectedPort)
        && actualPort === expectedPort;
};

// The renderer's only source of an address is the runtime the main process
// registered for this window, and the answer is `null` when there is none. It
// defaults nothing and parses nothing: an endpoint the renderer invented is how
// a window that could never authenticate kept dialling one that could.
export const getRendererLocalWebSocketAccess = () => (
    getRendererRuntime()?.localWebSocketAccess ?? null
);

export const withLocalWebSocketAccess = (rawUrl, access = getRendererLocalWebSocketAccess()) => {
    if (!access?.token) {
        return rawUrl;
    }

    try {
        const url = new URL(rawUrl);
        if (!isExactLocalWebSocketUrl(url, access)) {
            return rawUrl;
        }
        url.searchParams.set(access.tokenParam || DEFAULT_LOCAL_WS_TOKEN_PARAM, access.token);
        return url.toString();
    } catch {
        return rawUrl;
    }
};

export const redactLocalWebSocketAccess = (rawUrl, tokenParam = DEFAULT_LOCAL_WS_TOKEN_PARAM) => {
    try {
        const url = new URL(rawUrl);
        if (url.searchParams.has(tokenParam)) {
            url.searchParams.set(tokenParam, 'redacted');
        }
        return url.toString();
    } catch {
        return rawUrl;
    }
};
