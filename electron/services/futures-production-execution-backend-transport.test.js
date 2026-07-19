import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
    createFuturesProductionExecutionBackendTransport,
    FuturesProductionExecutionBackendTransportError,
    isFuturesProductionExecutionBackendTransport,
} from './futures-production-execution-backend-transport.js';
import {
    FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN,
    FUTURES_PRODUCTION_EXECUTION_WS_ORIGIN,
} from './futures-production-execution-config.js';

const createRequestHarness = ({ statusCode = 200, body = '{}' } = {}) => {
    const request = new EventEmitter();
    request.write = vi.fn();
    request.end = vi.fn(() => {
        const response = new EventEmitter();
        response.statusCode = statusCode;
        response.statusMessage = statusCode === 200 ? 'OK' : 'Rejected';
        response.headers = { 'content-type': 'application/json' };
        queueMicrotask(() => {
            request.callback(response);
            response.emit('data', Buffer.from(body));
            response.emit('end');
        });
    });
    request.destroy = vi.fn();
    const requestImpl = vi.fn((_url, _options, callback) => {
        request.callback = callback;
        return request;
    });
    return { request, requestImpl };
};

const privateStreamUrl = (listenKey = 'a'.repeat(20)) => (
    `${FUTURES_PRODUCTION_EXECUTION_WS_ORIGIN}/private/ws?listenKey=${listenKey}`
    + '&events=ORDER_TRADE_UPDATE/ALGO_UPDATE/ACCOUNT_UPDATE/ACCOUNT_CONFIG_UPDATE/listenKeyExpired'
);

describe('Futures production execution backend transport', () => {
    it('uses the exact direct fetch and websocket target when no proxy is configured', async () => {
        const directFetch = vi.fn(async () => new Response('{}'));
        const sockets = [];
        class FakeWebSocket {
            constructor(url, options) {
                sockets.push({ url: url.toString(), options });
            }
        }
        const transport = createFuturesProductionExecutionBackendTransport({
            environment: {},
            directFetch,
            WebSocketImpl: FakeWebSocket,
        });
        expect(isFuturesProductionExecutionBackendTransport(transport)).toBe(true);
        await transport.fetchImpl(`${FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN}/fapi/v1/time`, {
            method: 'GET',
            redirect: 'error',
        });
        transport.connectWebSocket(
            privateStreamUrl(),
            { followRedirects: false },
        );
        expect(directFetch).toHaveBeenCalledOnce();
        expect(sockets).toEqual([expect.objectContaining({
            url: privateStreamUrl(),
            options: { followRedirects: false },
        })]);
    });

    it('routes REST and private websocket traffic through one backend-owned proxy agent', async () => {
        const { request, requestImpl } = createRequestHarness();
        const sockets = [];
        class FakeWebSocket {
            constructor(url, options) {
                sockets.push({ url: url.toString(), options });
            }
        }
        const transport = createFuturesProductionExecutionBackendTransport({
            environment: { https_proxy: 'http://127.0.0.1:8080' },
            directFetch: vi.fn(),
            requestImpl,
            WebSocketImpl: FakeWebSocket,
        });
        const response = await transport.fetchImpl(
            `${FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN}/fapi/v1/order`,
            {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: 'symbol=ETHUSDT',
                redirect: 'error',
            },
        );
        transport.connectWebSocket(
            privateStreamUrl(),
            { followRedirects: false },
        );
        expect(await response.text()).toBe('{}');
        expect(requestImpl).toHaveBeenCalledOnce();
        expect(requestImpl.mock.calls[0][1].agent).toBeTruthy();
        expect(request.write).toHaveBeenCalledWith(Buffer.from('symbol=ETHUSDT'));
        expect(sockets[0].options.agent).toBe(requestImpl.mock.calls[0][1].agent);
        transport.close();
    });

    it.each([
        'file:///tmp/proxy.sock',
        'not a proxy URL',
    ])('fails closed for invalid proxy configuration %s', (proxy) => {
        expect(() => createFuturesProductionExecutionBackendTransport({
            environment: { https_proxy: proxy },
            directFetch: vi.fn(),
        })).toThrowError(expect.objectContaining({
            code: 'FUTURES_PRODUCTION_INVALID_PROXY_CONFIGURATION',
        }));
    });

    it('rejects escaped REST and websocket destinations before dispatch', async () => {
        const directFetch = vi.fn();
        const transport = createFuturesProductionExecutionBackendTransport({
            environment: { https_proxy: 'http://127.0.0.1:8080' },
            directFetch,
            requestImpl: vi.fn(),
            WebSocketImpl: vi.fn(),
        });
        expect(() => transport.fetchImpl('https://example.com/fapi/v1/time', {
            method: 'GET',
            redirect: 'error',
        })).toThrowError(FuturesProductionExecutionBackendTransportError);
        expect(() => transport.connectWebSocket('wss://example.com/private/ws', {}))
            .toThrowError(FuturesProductionExecutionBackendTransportError);
        expect(() => transport.connectWebSocket(
            `${FUTURES_PRODUCTION_EXECUTION_WS_ORIGIN}/private/ws?listenKey=${'a'.repeat(20)}`,
            {},
        )).toThrowError(FuturesProductionExecutionBackendTransportError);
        expect(() => transport.connectWebSocket(
            `${FUTURES_PRODUCTION_EXECUTION_WS_ORIGIN}/private/ws?listenKey=${'a'.repeat(20)}`
            + '&events=ACCOUNT_UPDATE',
            {},
        )).toThrowError(FuturesProductionExecutionBackendTransportError);
        expect(directFetch).not.toHaveBeenCalled();
    });
});
