const FORBIDDEN_FUTURES_NETWORK_HOSTS = new Set([
    'fapi.binance.com',
    'fstream.binance.com',
    'demo-fapi.binance.com',
    'demo-fstream.binance.com',
]);

const toUrl = (input) => {
    if (input instanceof URL) return input;
    if (typeof input === 'string') return new URL(input);
    if (typeof input?.url === 'string') return new URL(input.url);
    return null;
};

export class FuturesProductionNetworkEscapeError extends Error {
    constructor(hostname) {
        super('A Futures network request escaped the deterministic fake layer');
        this.name = 'FuturesProductionNetworkEscapeError';
        this.code = 'FUTURES_PRODUCTION_NETWORK_ESCAPE';
        this.hostname = hostname;
    }
}

export const isForbiddenFuturesNetworkUrl = (input) => {
    try {
        const url = toUrl(input);
        return url !== null && FORBIDDEN_FUTURES_NETWORK_HOSTS.has(url.hostname);
    } catch {
        return false;
    }
};

export const installFuturesProductionNetworkEscapeGuard = ({
    globalObject = globalThis,
    onAttempt = () => {},
} = {}) => {
    if (typeof globalObject?.fetch !== 'function') {
        throw new TypeError('A fetch implementation is required for the network guard');
    }
    if (globalObject.fetch?.__ccFuturesProductionNetworkGuard === true) {
        return Object.freeze({ restore: () => {}, getAttempts: () => [] });
    }

    const originalFetch = globalObject.fetch;
    const attempts = [];
    const guardedFetch = function guardedFuturesProductionFetch(input, init) {
        if (isForbiddenFuturesNetworkUrl(input)) {
            const url = toUrl(input);
            const attempt = Object.freeze({
                hostname: url.hostname,
                pathname: url.pathname,
                method: typeof init?.method === 'string' ? init.method.toUpperCase() : 'GET',
            });
            attempts.push(attempt);
            onAttempt(attempt);
            return Promise.reject(new FuturesProductionNetworkEscapeError(url.hostname));
        }
        return originalFetch.call(this, input, init);
    };
    Object.defineProperty(guardedFetch, '__ccFuturesProductionNetworkGuard', {
        value: true,
        enumerable: false,
    });
    globalObject.fetch = guardedFetch;

    return Object.freeze({
        getAttempts: () => Object.freeze(attempts.map(attempt => Object.freeze({ ...attempt }))),
        restore: () => {
            if (globalObject.fetch === guardedFetch) globalObject.fetch = originalFetch;
        },
    });
};

export const FUTURES_PRODUCTION_FORBIDDEN_NETWORK_HOSTS = Object.freeze(
    [...FORBIDDEN_FUTURES_NETWORK_HOSTS],
);
