import http from 'node:http';
import net from 'node:net';
import { Agent as BaseAgent } from 'agent-base';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SPOT_REST_CONNECT_PHASE,
    SPOT_REST_CONNECTION_POOL,
    observeSpotRestConnections,
} from './spot-rest-pool.js';

// Driven against a real socket rather than a mocked agent. The whole claim of
// this change is "the second request does not open a connection", and an agent
// with a stubbed `createConnection` cannot answer that — only a server that
// counts its own inbound connections can.
const servers = [];

const startServer = async () => {
    let connections = 0;
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
    });
    server.on('connection', () => { connections += 1; });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return { server, port: server.address().port, opened: () => connections };
};

const get = (agent, port) => new Promise((resolve, reject) => {
    const request = http.request(
        { host: '127.0.0.1', port, path: '/', agent },
        (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
        },
    );
    request.on('error', reject);
    request.end();
});

afterEach(async () => {
    while (servers.length) {
        const server = servers.pop();
        await new Promise(resolve => server.close(resolve));
    }
});

describe('spot REST connection pool', () => {
    it('opens one connection for a run of requests instead of one each', async () => {
        const { port, opened } = await startServer();
        const agent = new http.Agent(SPOT_REST_CONNECTION_POOL);

        for (let index = 0; index < 5; index += 1) {
            expect(await get(agent, port)).toBe(200);
        }

        // The point of the change, stated as the server saw it.
        expect(opened()).toBe(1);
        agent.destroy();
    });

    // What it looked like before: the spot leg took an agent built with no
    // options at all, which is one connection per request and a TLS handshake
    // with it — 630 ms against 325 ms through the operator's own proxy.
    it('opens one connection per request without the pool, which is what this replaces', async () => {
        const { port, opened } = await startServer();
        const agent = new http.Agent();

        for (let index = 0; index < 5; index += 1) {
            expect(await get(agent, port)).toBe(200);
        }

        expect(opened()).toBe(5);
        agent.destroy();
    });

    it('counts the connections opened and stays silent about the ones reused', async () => {
        const { port, opened } = await startServer();
        const record = vi.fn();
        const agent = observeSpotRestConnections(
            new http.Agent(SPOT_REST_CONNECTION_POOL),
            record,
        );

        for (let index = 0; index < 4; index += 1) await get(agent, port);

        expect(opened()).toBe(1);
        // One line for the one open, and nothing for the three that reused it.
        // The absence of lines is the evidence the pool is working, so recording
        // the working case would bury it in its own success.
        expect(record).toHaveBeenCalledExactlyOnceWith('timing', {
            phase: SPOT_REST_CONNECT_PHASE,
            durationMs: 0,
            outcome: 'ok',
            cache: 'miss',
        });
        agent.destroy();
    });

    // A diagnostic may never cost a request. If the recorder raises, the
    // request still goes out.
    it('serves the request even when the recorder throws', async () => {
        const { port, opened } = await startServer();
        const agent = observeSpotRestConnections(
            new http.Agent(SPOT_REST_CONNECTION_POOL),
            () => { throw new Error('record is broken'); },
        );

        expect(await get(agent, port)).toBe(200);
        expect(opened()).toBe(1);
        agent.destroy();
    });

    it('does not stack a second counter on an agent it already wrapped', async () => {
        const { port } = await startServer();
        const record = vi.fn();
        const agent = new http.Agent(SPOT_REST_CONNECTION_POOL);
        observeSpotRestConnections(agent, record);
        observeSpotRestConnections(agent, record);

        await get(agent, port);

        expect(record).toHaveBeenCalledTimes(1);
        agent.destroy();
    });

    // The route the operator is actually on is proxied, and a proxy agent does
    // not open sockets the way a plain one does: `agent-base` makes the
    // connection inside `connect()`, stashes it, and `createConnection()` only
    // hands it over. If the count were hooked on the wrong one of those, the
    // operator's own verification step would grep for these lines, find none,
    // and read the silence as "reuse is working" when it means "nothing is
    // being counted". Driven through `agent-base` itself rather than argued
    // from reading it.
    it('counts opens on a proxy-style agent too, not only a direct one', async () => {
        const { port, opened } = await startServer();
        const record = vi.fn();
        let connectCalls = 0;

        class ProxyStyleAgent extends BaseAgent {
            connect() {
                connectCalls += 1;
                return net.connect({ host: '127.0.0.1', port });
            }
        }
        const agent = observeSpotRestConnections(
            new ProxyStyleAgent(SPOT_REST_CONNECTION_POOL),
            record,
        );

        for (let index = 0; index < 3; index += 1) await get(agent, port);

        // One real connection, made through `connect()` — the proxy agent's own
        // path — and the counter saw it.
        expect(connectCalls).toBe(1);
        expect(opened()).toBe(1);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][1]).toMatchObject({ phase: SPOT_REST_CONNECT_PHASE });
        agent.destroy();
    });

    it('hands back an agent it cannot wrap rather than refusing to build one', () => {
        expect(observeSpotRestConnections(null, () => {})).toBeNull();
        const bare = {};
        expect(observeSpotRestConnections(bare, () => {})).toBe(bare);
        const agent = new http.Agent();
        expect(observeSpotRestConnections(agent, null)).toBe(agent);
        agent.destroy();
    });
});
