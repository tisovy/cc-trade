// @vitest-environment node

import net from 'node:net';
import { client as WebSocketClient } from 'websocket';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRendererRuntime } from '../renderer-runtime.js';
import { RENDERER_ORIGIN } from '../renderer-protocol.js';
import {
    createLocalWebSocketAccess,
} from './local-websocket-access.js';
import { setupBinanceConnection } from './binance-connection.js';

const EXPECTED_AUTH_CLOSE_CODE = 4401;

const upstream = vi.hoisted(() => {
    const socket = () => ({
        on: vi.fn(),
        disconnect: vi.fn().mockResolvedValue(undefined),
    });
    const response = (data) => Promise.resolve({
        data: vi.fn().mockResolvedValue(data),
    });
    const activity = {
        connect: vi.fn().mockImplementation(() => Promise.resolve(socket())),
        deleteOrder: vi.fn().mockImplementation(() => response({})),
        exchangeInfo: vi.fn().mockImplementation(() => response({ symbols: [] })),
        getAccount: vi.fn().mockImplementation(() => response({ balances: [] })),
        getOpenOrders: vi.fn().mockImplementation(() => response([])),
        getOrder: vi.fn().mockImplementation(() => response({})),
        myTrades: vi.fn().mockImplementation(() => response([])),
        newOrder: vi.fn().mockImplementation(() => response({})),
        sendRequest: vi.fn().mockImplementation((path, method) => response(
            path === '/api/v3/time' && method === 'GET'
                ? { serverTime: Date.now() }
                : path === '/api/v3/userDataStream' && method === 'POST'
                    ? { listenKey: 'retained-integration-listen-key' }
                    : {},
        )),
        ticker24hr: vi.fn().mockImplementation(() => response([])),
    };
    const Spot = vi.fn(function MockSpot() {
        return {
            restAPI: {
                configuration: { baseOptions: { headers: {} } },
                axiosInstance: {
                    interceptors: {
                        request: { use: vi.fn() },
                    },
                },
                deleteOrder: activity.deleteOrder,
                exchangeInfo: activity.exchangeInfo,
                getAccount: activity.getAccount,
                getOpenOrders: activity.getOpenOrders,
                getOrder: activity.getOrder,
                myTrades: activity.myTrades,
                newOrder: activity.newOrder,
                sendRequest: activity.sendRequest,
                ticker24hr: activity.ticker24hr,
            },
            websocketStreams: { connect: activity.connect },
        };
    });

    return { activity, Spot };
});

vi.mock('@binance/spot', () => ({ Spot: upstream.Spot }));

const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

const reserveLoopbackPort = () => new Promise((resolve, reject) => {
    const reservation = net.createServer();
    reservation.unref();
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', () => {
        const address = reservation.address();
        resolve({
            port: address.port,
            release: () => new Promise((releaseResolve, releaseReject) => {
                reservation.close(error => (error ? releaseReject(error) : releaseResolve()));
            }),
        });
    });
});

const waitForEndpoint = async ({ host, port }) => {
    let lastError;
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            await new Promise((resolve, reject) => {
                const socket = net.createConnection({ host, port });
                socket.once('connect', () => {
                    socket.end();
                    resolve();
                });
                socket.once('error', reject);
            });
            return;
        } catch (error) {
            lastError = error;
            await delay(10);
        }
    }
    throw lastError;
};

const rendererUrl = (access, token) => {
    const url = new URL(`ws://${access.host}:${access.port}`);
    url.searchParams.set(access.tokenParam, token);
    return url.href;
};

const openRenderer = (access, token) => new Promise((resolve, reject) => {
    const client = new WebSocketClient();
    const timeout = setTimeout(() => reject(new Error('renderer connection timed out')), 3_000);
    timeout.unref?.();
    client.once('connectFailed', (error) => {
        clearTimeout(timeout);
        reject(error);
    });
    client.once('connect', (connection) => {
        clearTimeout(timeout);
        resolve(connection);
    });
    client.connect(rendererUrl(access, token), null, RENDERER_ORIGIN);
});

const presentForeignToken = (access, token) => new Promise((resolve, reject) => {
    const client = new WebSocketClient();
    const timeout = setTimeout(() => reject(new Error('foreign-token refusal timed out')), 3_000);
    timeout.unref?.();
    client.once('connectFailed', (error) => {
        clearTimeout(timeout);
        reject(error);
    });
    client.once('connect', (connection) => {
        connection.once('close', (code, reason) => {
            clearTimeout(timeout);
            resolve({ code, reason });
        });
        try {
            connection.sendUTF(JSON.stringify({
                action: 'activate_market',
                marketMode: 'spot',
            }));
        } catch {
            // The authentication close may overtake this deliberately hostile
            // frame. Either ordering must leave the market/account path idle.
        }
    });
    client.connect(rendererUrl(access, token), null, RENDERER_ORIGIN);
});

const closeRenderer = (connection) => new Promise((resolve) => {
    if (!connection?.connected) {
        resolve();
        return;
    }
    const timeout = setTimeout(resolve, 500);
    timeout.unref?.();
    connection.once('close', () => {
        clearTimeout(timeout);
        resolve();
    });
    connection.close();
});

describe('local WebSocket runtime isolation integration', () => {
    const controllers = [];
    const rendererConnections = [];
    const credentialKeys = ['BK', 'BS', 'BFK', 'BFS'];
    const retiredEnvironmentPrefixes = [
        'FUTURES_TESTNET_',
        'FUTURES_READ_',
        'FUTURES_PRODUCTION_',
    ];
    let previousEnvironment;
    let originalConsoleLog;

    beforeEach(() => {
        const mutatedEnvironmentKeys = new Set([
            ...credentialKeys,
            ...Object.keys(process.env).filter(key => (
                retiredEnvironmentPrefixes.some(prefix => key.startsWith(prefix))
            )),
        ]);
        previousEnvironment = new Map(
            [...mutatedEnvironmentKeys].map(key => [key, process.env[key]]),
        );
        process.env.BK = 'retained-integration-spot-key';
        process.env.BS = 'retained-integration-spot-secret';
        delete process.env.BFK;
        delete process.env.BFS;
        originalConsoleLog = console.log;
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await Promise.allSettled(rendererConnections.splice(0).map(closeRenderer));
        await Promise.allSettled(controllers.splice(0).map(controller => controller.close()));
        console.log = originalConsoleLog;
        for (const key of Object.keys(process.env)) {
            if (credentialKeys.includes(key)
                || retiredEnvironmentPrefixes.some(prefix => key.startsWith(prefix))) {
                delete process.env[key];
            }
        }
        for (const [key, value] of previousEnvironment) {
            if (value !== undefined) process.env[key] = value;
        }
        vi.restoreAllMocks();
    });

    it('keeps two issued endpoint/token pairs mutually exclusive before market or account work', async () => {
        const reservationA = await reserveLoopbackPort();
        const reservationB = await reserveLoopbackPort();
        const ports = [reservationA.port, reservationB.port];
        await Promise.all([reservationA.release(), reservationB.release()]);

        const accessA = {
            ...createLocalWebSocketAccess({ port: ports[0] }),
            allowedOrigins: [RENDERER_ORIGIN],
        };
        const accessB = {
            ...createLocalWebSocketAccess({ port: ports[1] }),
            allowedOrigins: [RENDERER_ORIGIN],
        };
        const runtimeA = createRendererRuntime({ localWebSocketAccess: accessA });
        const runtimeB = createRendererRuntime({ localWebSocketAccess: accessB });

        expect(runtimeA.localWebSocketAccess.port === runtimeB.localWebSocketAccess.port).toBe(false);
        expect(runtimeA.localWebSocketAccess.token === runtimeB.localWebSocketAccess.token).toBe(false);

        controllers.push(
            setupBinanceConnection({ localWebSocketAccess: accessA }),
            setupBinanceConnection({ localWebSocketAccess: accessB }),
        );
        await Promise.all([waitForEndpoint(accessA), waitForEndpoint(accessB)]);

        const ownA = await openRenderer(accessA, runtimeA.localWebSocketAccess.token);
        const ownB = await openRenderer(accessB, runtimeB.localWebSocketAccess.token);
        rendererConnections.push(ownA, ownB);
        expect(ownA.connected).toBe(true);
        expect(ownB.connected).toBe(true);

        // Runtime construction performs one clock check per configured Spot
        // adapter. Measure refusal only after those startup reads have settled.
        expect(upstream.activity.sendRequest).toHaveBeenCalledTimes(2);
        for (const operation of Object.values(upstream.activity)) operation.mockClear();

        const [aRejectsB, bRejectsA] = await Promise.all([
            presentForeignToken(accessA, runtimeB.localWebSocketAccess.token),
            presentForeignToken(accessB, runtimeA.localWebSocketAccess.token),
        ]);

        expect(aRejectsB).toMatchObject({
            code: EXPECTED_AUTH_CLOSE_CODE,
            reason: 'invalid-token',
        });
        expect(bRejectsA).toMatchObject({
            code: EXPECTED_AUTH_CLOSE_CODE,
            reason: 'invalid-token',
        });
        for (const operation of Object.values(upstream.activity)) {
            expect(operation).not.toHaveBeenCalled();
        }
    });
});
