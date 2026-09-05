// @vitest-environment node
import { createHmac } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Spot } from '@binance/spot';
import { protectSpotRestApi, SpotRestError } from './spot-rest-boundary.js';
import { SpotTradingAdapter } from './spot-trading-adapter.js';
import { isIndeterminateTradingFailure } from './trading-command-outcome.js';

const order = {
    symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', status: 'NEW',
    orderId: 42, clientOrderId: 'boundary-intent', price: '50000', origQty: '0.001',
};
const command = {
    symbol: 'BTCUSDT', side: 'BUY', numericQuantity: 0.001,
    numericPrice: 50000, newClientOrderId: 'boundary-intent', orderId: 42,
};
const makeSdk = (handler) => {
    const client = new Spot({ configurationRestAPI: {
        apiKey: 'fixture-key', apiSecret: 'fixture-secret',
        basePath: 'https://fixture.invalid', keepAlive: false,
    } });
    const transport = vi.fn(async (config) => {
        const response = { headers: {}, config, ...await handler(config) };
        // Match Axios HTTP adapter settlement, so a removed validateStatus
        // setting reproduces the SDK's lossy BadRequestError mapping.
        if (!config.validateStatus(response.status)) {
            throw Object.assign(new Error('Request failed'), { response, config });
        }
        return response;
    });
    client.restAPI.configuration.baseOptions.adapter = transport;
    client.restAPI = protectSpotRestApi(client.restAPI);
    return { client, transport, adapter: new SpotTradingAdapter({ client, recvWindow: 60000 }) };
};
const jsonResponse = (status, data) => ({ status, data: JSON.stringify(data) });

describe('installed Spot SDK REST outcome boundary', () => {
    afterEach(() => vi.restoreAllMocks());

    it('keeps SDK signing, stable order identity, agent options and response metadata', async () => {
        const { client, adapter, transport } = makeSdk(() => ({
            ...jsonResponse(200, order), headers: { 'x-mbx-used-weight-1m': '17' },
        }));
        const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });
        client.restAPI.configuration.baseOptions.httpsAgent = agent;
        const result = await adapter.placeOrder(command);
        expect(result).toMatchObject({ symbol: 'BTCUSDT', orderId: 42, status: 'NEW' });
        const request = transport.mock.calls[0][0];
        const url = new URL(request.url);
        expect(url.pathname).toBe('/api/v3/order');
        expect(url.searchParams.get('newClientOrderId')).toBe('boundary-intent');
        expect(url.searchParams.get('recvWindow')).toBe('60000');
        const signature = url.searchParams.get('signature');
        url.searchParams.delete('signature');
        expect(signature).toBe(createHmac('sha256', 'fixture-secret').update(url.searchParams.toString()).digest('hex'));
        expect(request.headers.get('X-MBX-APIKEY')).toBe('fixture-key');
        expect(request.httpsAgent).toBe(agent);
        expect(request.maxRedirects).toBe(0);
        expect(client.restAPI.configuration.retries).toBe(0);
        const response = await client.restAPI.getOrder({ symbol: 'BTCUSDT', orderId: 42 });
        expect(response.status).toBe(200);
        expect(response.headers['x-mbx-used-weight-1m']).toBe('17');
        expect(response.rateLimits).toHaveLength(1);
        expect(await response.data()).toBe(await response.data());
    });

    it('retains a large exchange order id without JSON number rounding', async () => {
        const { client } = makeSdk(() => ({ status: 200, data: '{"orderId":9007199254740993}' }));
        const response = await client.restAPI.getOrder({ symbol: 'BTCUSDT', orderId: 42 });
        expect((await response.data()).orderId).toBe('9007199254740993');
        expect(JSON.stringify(await response.data())).toBe('{"orderId":"9007199254740993"}');
    });

    it('keeps a real-SDK large order and nested history IDs exact through adapter and renderer JSON', async () => {
        const { client, adapter, transport } = makeSdk(() => ({ status: 200,
            data: '{"symbol":"BTCUSDT","orderId":9007199254740993,"clientOrderId":"boundary-intent","status":"NEW","fills":[{"tradeId":9007199254740995}]}' }));
        const report = await adapter.placeOrder(command);
        expect(JSON.parse(JSON.stringify({ execution_update: report })).execution_update.orderId).toBe('9007199254740993');
        const body = await (await client.restAPI.getOrder({ symbol: 'BTCUSDT', orderId: '9007199254740993' })).data();
        expect(JSON.parse(JSON.stringify(body)).fills[0].tradeId).toBe('9007199254740995');
        expect(transport).toHaveBeenCalledTimes(2);
    });

    it('refuses excessive response nesting as unreadable without exposing its body', async () => {
        let body = { value: 'fixture-private-body' };
        for (let depth = 0; depth < 70; depth += 1) body = { nested: body };
        const { adapter } = makeSdk(() => jsonResponse(200, body));
        const error = await adapter.placeOrder(command).catch(value => value);
        expect(error).toMatchObject({ indeterminate: true });
        expect(error.message).not.toContain('fixture-private-body');
    });

    it.each([{}, { ...order, status: undefined }, { ...order, symbol: 'ETHUSDT' }])(
        'does not call insufficient real-SDK success a placement: %j', async body => {
            const { adapter, transport } = makeSdk(() => jsonResponse(200, body));
            await expect(adapter.placeOrder(command)).rejects.toMatchObject({ indeterminate: true });
            expect(transport).toHaveBeenCalledOnce();
        },
    );

    it.each(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'ECONNREFUSED'])(
        'does not invent a refusal when the SDK discards %s', async (code) => {
            const { adapter, transport } = makeSdk(() => {
                throw Object.assign(new Error('fixture transport detail'), { code });
            });
            const error = await adapter.placeOrder(command).catch(value => value);
            expect(error).toBeInstanceOf(SpotRestError);
            expect(error).toMatchObject({ status: null, code: null, exchangeCode: null,
                transport: 'sdk-network-details-unavailable', outcomeCertainty: 'unknown' });
            expect(isIndeterminateTradingFailure(error)).toBe(true);
            expect(transport).toHaveBeenCalledOnce();
            expect(error).not.toHaveProperty('cause');
            expect(error).not.toHaveProperty('config');
            expect(error).not.toHaveProperty('response');
        },
    );

    it.each(['placeOrder', 'cancelOrder', 'findOrder'])('%s makes one attempt after a reset', async (method) => {
        const { adapter, transport } = makeSdk(() => {
            throw Object.assign(new Error('accepted then disconnected'), { code: 'ECONNRESET' });
        });
        await expect(adapter[method](command)).rejects.toMatchObject({ indeterminate: true });
        expect(transport).toHaveBeenCalledOnce();
    });

    it.each([400, 401, 403, 418, 429])('preserves a determinate HTTP %s business refusal', async (status) => {
        const { adapter, transport } = makeSdk(() => jsonResponse(status, { code: -2010, msg: 'Insufficient balance.' }));
        const error = await adapter.placeOrder(command).catch(value => value);
        expect(error).toMatchObject({ status, exchangeCode: -2010, code: -2010,
            message: 'Insufficient balance.', outcomeCertainty: 'rejected', indeterminate: false });
        expect(isIndeterminateTradingFailure(error)).toBe(false);
        expect(transport).toHaveBeenCalledOnce();
    });

    it('preserves numeric -2013 through real SDK lookup as explicit absence', async () => {
        const { adapter, transport } = makeSdk(() => jsonResponse(400, { code: -2013, msg: 'Any language.' }));
        await expect(adapter.findOrder({ symbol: 'BTCUSDT', origClientOrderId: 'boundary-intent' }))
            .resolves.toEqual({ exists: false, report: null });
        expect(transport).toHaveBeenCalledOnce();
    });

    it.each([
        { status: 400, data: { msg: 'Order does not exist.' } },
        { status: 400, data: { code: '-2013', msg: 'Order does not exist.' } },
        { status: 503, data: { code: -2013, msg: 'Order does not exist.' } },
        { status: 200, data: { code: -2013, msg: 'Order does not exist.' } },
        { status: 302, data: { code: -2013, msg: 'Order does not exist.' } },
    ])('never infers absence from insufficient or ambiguous evidence: $status / $data', async ({ status, data }) => {
        const { adapter } = makeSdk(() => jsonResponse(status, data));
        await expect(adapter.findOrder(command)).rejects.toMatchObject({ indeterminate: true });
    });

    it.each([500, 502, 503, 504])('does not retry or call HTTP %s a refusal', async (status) => {
        const { adapter, transport } = makeSdk(() => jsonResponse(status, { code: -1000, msg: 'Unknown.' }));
        await expect(adapter.cancelOrder(command)).rejects.toMatchObject({ status, indeterminate: true });
        expect(transport).toHaveBeenCalledOnce();
    });

    it.each([-1000, -1006, -1007])('unknown execution code %s overrides HTTP 400', async (code) => {
        const { adapter } = makeSdk(() => jsonResponse(400, { code, msg: 'Unknown execution.' }));
        await expect(adapter.placeOrder(command)).rejects.toMatchObject({ status: 400, exchangeCode: code, indeterminate: true });
    });

    it.each(['not-json fixture-secret', 'null', 'true', '42', '"fixture-secret"', '']) (
        'an unusable response cannot turn into acceptance: %s', async (data) => {
            const { adapter } = makeSdk(() => ({ status: 200, data }));
            const error = await adapter.placeOrder(command).catch(value => value);
            expect(error).toMatchObject({ indeterminate: true });
            expect(error.message).not.toContain('fixture-secret');
        },
    );

    it('rejects public error responses and partial-success HTTP 409 too', async () => {
        const { client } = makeSdk(() => jsonResponse(409, { code: -2021, msg: 'Partial execution.' }));
        await expect(client.restAPI.ticker24hr()).rejects.toMatchObject({ status: 409, indeterminate: true });
    });

    it('fails before transport for a missing required argument', async () => {
        const { client, transport } = makeSdk(() => jsonResponse(200, order));
        await expect(client.restAPI.newOrder({ side: 'BUY', type: 'LIMIT' }))
            .rejects.toMatchObject({ name: 'RequiredError' });
        expect(transport).not.toHaveBeenCalled();
    });

    it('fails closed if the SDK configuration seam is missing', () => {
        expect(() => protectSpotRestApi({})).toThrow('configuration is unavailable');
    });

    it('uses actual HTTP reset-after-acceptance and reads back without replaying the order', async () => {
        const requests = [];
        const server = http.createServer((request, response) => {
            requests.push(request.method);
            if (request.method === 'POST') {
                request.socket.destroy();
            } else {
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify(order));
            }
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        try {
            const client = new Spot({ configurationRestAPI: {
                apiKey: 'fixture-key', apiSecret: 'fixture-secret', keepAlive: false,
                basePath: `http://127.0.0.1:${server.address().port}`, timeout: 1000,
            } });
            client.restAPI.configuration.baseOptions.proxy = false;
            client.restAPI = protectSpotRestApi(client.restAPI);
            const adapter = new SpotTradingAdapter({ client, recvWindow: 60000 });
            await expect(adapter.placeOrder(command)).rejects.toMatchObject({ indeterminate: true });
            await expect(adapter.findOrder(command)).resolves.toMatchObject({ exists: true, report: { orderId: 42 } });
            expect(requests).toEqual(['POST', 'GET']);
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    });
});
