import http from 'node:http';
import https from 'node:https';
import {
    FUTURES_PRODUCTION_FORBIDDEN_NETWORK_HOSTS,
} from './futures-production-network-guard.js';

const FORBIDDEN_HOSTS = new Set(FUTURES_PRODUCTION_FORBIDDEN_NETWORK_HOSTS);
const GUARDED = Symbol.for('cc-trade.futures-workstation-node-network-guard');

export class FuturesWorkstationNodeNetworkEscapeError extends Error {
    constructor(hostname) {
        super('A Futures request escaped the deterministic backend fake');
        this.name = 'FuturesWorkstationNodeNetworkEscapeError';
        this.code = 'FUTURES_WORKSTATION_NETWORK_ESCAPE';
        this.hostname = hostname;
    }
}

const resolveHostname = (input, options) => {
    try {
        if (input instanceof URL) return input.hostname;
        if (typeof input === 'string') return new URL(input).hostname;
        const source = input && typeof input === 'object' ? input : options;
        if (!source || typeof source !== 'object') return null;
        if (typeof source.hostname === 'string') return source.hostname;
        if (typeof source.host === 'string') return source.host.split(':')[0];
        if (typeof source.href === 'string') return new URL(source.href).hostname;
        return null;
    } catch {
        return null;
    }
};

const installModuleGuard = (module, attempts) => {
    if (module[GUARDED]) return () => {};
    const originalRequest = module.request;
    const originalGet = module.get;
    const guard = original => function guardedFuturesWorkstationRequest(input, options, callback) {
        const hostname = resolveHostname(input, options);
        if (hostname && FORBIDDEN_HOSTS.has(hostname)) {
            attempts.push(Object.freeze({ hostname, protocol: module === https ? 'https:' : 'http:' }));
            throw new FuturesWorkstationNodeNetworkEscapeError(hostname);
        }
        return original.call(this, input, options, callback);
    };
    module.request = guard(originalRequest);
    module.get = guard(originalGet);
    Object.defineProperty(module, GUARDED, { value: true, configurable: true });
    return () => {
        if (module.request !== originalRequest) module.request = originalRequest;
        if (module.get !== originalGet) module.get = originalGet;
        delete module[GUARDED];
    };
};

export const installFuturesWorkstationNodeNetworkEscapeGuard = () => {
    const attempts = [];
    const restoreHttps = installModuleGuard(https, attempts);
    const restoreHttp = installModuleGuard(http, attempts);
    return Object.freeze({
        getAttempts: () => Object.freeze([...attempts]),
        restore: () => {
            restoreHttps();
            restoreHttp();
        },
    });
};
