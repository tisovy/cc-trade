const LOCAL_WS_HOST_ARG = 'local-ws-host';
const LOCAL_WS_TOKEN_ARG = 'local-ws-token';
const LOCAL_WS_TOKEN_PARAM_ARG = 'local-ws-token-param';
const DEFAULT_LOCAL_WS_HOST = '127.0.0.1';
const DEFAULT_LOCAL_WS_TOKEN_PARAM = 'token';
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const getArgValue = (args, name) => {
    const prefix = `--${name}=`;
    const match = args.find((arg) => typeof arg === 'string' && arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : '';
};

const getRendererProcessArgs = () => {
    const processLike = globalThis.window?.process ?? globalThis.process;
    return Array.isArray(processLike?.argv) ? processLike.argv : [];
};

const isLoopbackWebSocketUrl = (url) => {
    const hostname = url.hostname.toLowerCase();
    return (url.protocol === 'ws:' || url.protocol === 'wss:') && LOOPBACK_HOSTNAMES.has(hostname);
};

export const getRendererLocalWebSocketAccess = (args = getRendererProcessArgs()) => ({
    host: getArgValue(args, LOCAL_WS_HOST_ARG) || DEFAULT_LOCAL_WS_HOST,
    token: getArgValue(args, LOCAL_WS_TOKEN_ARG),
    tokenParam: getArgValue(args, LOCAL_WS_TOKEN_PARAM_ARG) || DEFAULT_LOCAL_WS_TOKEN_PARAM,
});

export const withLocalWebSocketAccess = (rawUrl, access = getRendererLocalWebSocketAccess()) => {
    if (!access.token) {
        return rawUrl;
    }

    try {
        const url = new URL(rawUrl);
        if (!isLoopbackWebSocketUrl(url)) {
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
