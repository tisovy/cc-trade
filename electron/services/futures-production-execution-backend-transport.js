import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import WebSocket from 'ws';
import {
    FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
    FUTURES_PRODUCTION_EXECUTION_WS_ORIGIN,
} from './futures-production-execution-config.js';
import {
    FUTURES_PRODUCTION_EXECUTION_INVENTORY_RESPONSE_LIMITS,
    FUTURES_PRODUCTION_EXECUTION_RESPONSE_LIMITS,
} from './futures-production-execution-json.js';

const PROXY_PROTOCOLS = new Set([
    'http:',
    'https:',
    'socks:',
    'socks4:',
    'socks4a:',
    'socks5:',
    'socks5h:',
]);
const REST_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const MAX_RESPONSE_BYTES = FUTURES_PRODUCTION_EXECUTION_INVENTORY_RESPONSE_LIMITS.BODY_BYTES;
const trustedTransports = new WeakSet();

export class FuturesProductionExecutionBackendTransportError extends Error {
    constructor(code) {
        super('Futures production backend transport is unavailable');
        this.name = 'FuturesProductionExecutionBackendTransportError';
        this.code = code;
    }
}

const fail = code => {
    throw new FuturesProductionExecutionBackendTransportError(code);
};

const readProxyUrl = (environment) => (
    environment?.https_proxy
    || environment?.HTTPS_PROXY
    || environment?.http_proxy
    || environment?.HTTP_PROXY
    || null
);

const createProxyAgent = (environment) => {
    const proxyUrl = readProxyUrl(environment);
    if (proxyUrl === null) return null;
    try {
        const parsed = new URL(proxyUrl);
        if (!PROXY_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) {
            fail('FUTURES_PRODUCTION_INVALID_PROXY_CONFIGURATION');
        }
        const options = {
            keepAlive: true,
            maxSockets: 2,
            maxFreeSockets: 1,
        };
        return parsed.protocol.startsWith('socks')
            ? new SocksProxyAgent(proxyUrl, options)
            : new HttpsProxyAgent(proxyUrl, options);
    } catch (error) {
        if (error instanceof FuturesProductionExecutionBackendTransportError) throw error;
        fail('FUTURES_PRODUCTION_INVALID_PROXY_CONFIGURATION');
    }
};

const assertRestUrl = (value) => {
    let url;
    try {
        url = value instanceof URL ? new URL(value.href) : new URL(value);
    } catch {
        fail('FUTURES_PRODUCTION_UNREVIEWED_NETWORK_TARGET');
    }
    if (url.origin !== FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN
        || url.protocol !== 'https:'
        || url.username
        || url.password
        || url.hash) {
        fail('FUTURES_PRODUCTION_UNREVIEWED_NETWORK_TARGET');
    }
    return url;
};

const assertWebSocketUrl = (value) => {
    let url;
    try {
        url = value instanceof URL ? new URL(value.href) : new URL(value);
    } catch {
        fail('FUTURES_PRODUCTION_UNREVIEWED_NETWORK_TARGET');
    }
    if (url.origin !== FUTURES_PRODUCTION_EXECUTION_WS_ORIGIN
        || url.protocol !== 'wss:'
        || url.pathname !== '/private/ws'
        || url.username
        || url.password
        || url.hash) {
        fail('FUTURES_PRODUCTION_UNREVIEWED_NETWORK_TARGET');
    }
    return url;
};

const readProxyResponse = (response, request) => new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
    };
    response.on('data', (chunk) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
            request.destroy();
            finish(reject, new FuturesProductionExecutionBackendTransportError(
                'FUTURES_PRODUCTION_PROXY_RESPONSE_TOO_LARGE',
            ));
            return;
        }
        chunks.push(bytes);
    });
    response.once('aborted', () => finish(
        reject,
        new FuturesProductionExecutionBackendTransportError(
            'FUTURES_PRODUCTION_PROXY_RESPONSE_ABORTED',
        ),
    ));
    response.once('error', error => finish(reject, error));
    response.once('end', () => {
        if (settled) return;
        const body = Buffer.concat(chunks, total);
        let headers;
        try {
            headers = new Headers(response.headers);
        } catch {
            finish(reject, new FuturesProductionExecutionBackendTransportError(
                'FUTURES_PRODUCTION_PROXY_HEADERS_REJECTED',
            ));
            return;
        }
        finish(resolve, new Response(body.byteLength === 0 ? null : body, {
            status: response.statusCode,
            statusText: response.statusMessage,
            headers,
        }));
    });
});

const requestThroughProxy = ({ url, options, proxyAgent, requestImpl }) => {
    const method = typeof options?.method === 'string' ? options.method.toUpperCase() : 'GET';
    if (!REST_METHODS.has(method)
        || options?.redirect !== 'error'
        || (options?.body !== undefined && typeof options.body !== 'string')) {
        fail('FUTURES_PRODUCTION_UNREVIEWED_NETWORK_REQUEST');
    }
    const body = options.body === undefined ? null : Buffer.from(options.body, 'utf8');
    const headers = new Headers(options.headers);
    if (body !== null) headers.set('content-length', String(body.byteLength));
    return new Promise((resolve, reject) => {
        let request;
        try {
            request = requestImpl(url, {
                method,
                headers: Object.fromEntries(headers.entries()),
                agent: proxyAgent,
                signal: options.signal,
                maxHeaderSize: FUTURES_PRODUCTION_EXECUTION_RESPONSE_LIMITS
                    .HEADER_AGGREGATE_BYTES,
            }, response => {
                readProxyResponse(response, request).then(resolve, reject);
            });
            request.once('error', reject);
            if (body !== null) request.write(body);
            request.end();
        } catch (error) {
            reject(error);
        }
    });
};

export const createFuturesProductionExecutionBackendTransport = ({
    environment = process.env,
    directFetch = globalThis.fetch,
    requestImpl = https.request,
    WebSocketImpl = WebSocket,
} = {}) => {
    if (typeof directFetch !== 'function'
        || typeof requestImpl !== 'function'
        || typeof WebSocketImpl !== 'function') {
        throw new TypeError('Production backend transport dependencies are unavailable');
    }
    const proxyAgent = createProxyAgent(environment);
    const fetchImpl = proxyAgent === null
        ? (input, options) => directFetch(assertRestUrl(input), options)
        : (input, options) => requestThroughProxy({
            url: assertRestUrl(input),
            options,
            proxyAgent,
            requestImpl,
        });
    const connectWebSocket = (input, options) => {
        const url = assertWebSocketUrl(input);
        if (options === null || typeof options !== 'object' || Array.isArray(options)) {
            fail('FUTURES_PRODUCTION_UNREVIEWED_NETWORK_REQUEST');
        }
        return new WebSocketImpl(url, {
            ...options,
            ...(proxyAgent === null ? {} : { agent: proxyAgent }),
        });
    };
    let closed = false;
    const transport = Object.freeze({
        fetchImpl,
        connectWebSocket,
        proxied: proxyAgent !== null,
        close: () => {
            if (closed) return;
            closed = true;
            proxyAgent?.destroy?.();
        },
    });
    trustedTransports.add(transport);
    return transport;
};

export const isFuturesProductionExecutionBackendTransport = value => (
    value !== null
    && typeof value === 'object'
    && trustedTransports.has(value)
);
