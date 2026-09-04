// @vitest-environment node
import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpotUserDataStream, SPOT_PRIVATE_MAX_PAYLOAD, SPOT_PRIVATE_WS_URL } from './spot-user-data-stream.js';

const controllers = [];
const fixture = (options = {}) => {
    const sockets = [];
    const createSocket = vi.fn(() => {
        const socket = new EventEmitter();
        socket.send = vi.fn((_frame, callback) => callback?.());
        socket.terminate = vi.fn();
        sockets.push(socket);
        return socket;
    });
    const onState = vi.fn(), onEvent = vi.fn(), onReady = vi.fn();
    const admit = vi.fn(async run => run());
    const controller = createSpotUserDataStream({
        apiKey: 'fixture-key', apiSecret: 'fixture-secret',
        createSocket, onState, onEvent, onReady, admit, ...options,
    });
    controllers.push(controller);
    return { controller, sockets, createSocket, onState, onEvent, onReady, admit };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const message = (socket, frame) => socket.emit('message', Buffer.from(JSON.stringify(frame)), false);
const open = async socket => { socket.emit('open'); await flush(); };
const acknowledge = (socket, subscriptionId = 0) => message(socket, {
    id: JSON.parse(socket.send.mock.lastCall[0]).id, status: 200, result: { subscriptionId },
});

describe('generation-owned Spot signed private subscription', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_700_000_000_000); });
    afterEach(() => { controllers.splice(0).forEach(controller => controller.stop()); vi.useRealTimers(); });

    it('signs once at admission, waits for acknowledgement and accepts subscription zero', async () => {
        const f = fixture({ agent: { label: 'stream-agent' } });
        f.controller.start(); f.controller.start();
        expect(f.sockets).toHaveLength(1);
        expect(f.controller.getStatus().state).toBe('connecting');
        await open(f.sockets[0]);
        expect(f.controller.getStatus().state).toBe('subscribing');
        const frame = JSON.parse(f.sockets[0].send.mock.lastCall[0]);
        const { signature, ...params } = frame.params;
        expect(frame.method).toBe('userDataStream.subscribe.signature');
        expect(signature).toBe(createHmac('sha256', 'fixture-secret')
            .update(Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&')).digest('hex'));
        expect(params).toEqual({ apiKey: 'fixture-key', recvWindow: 60000, timestamp: Date.now() });
        expect(f.admit.mock.calls.map(([, weight]) => weight)).toEqual([2, 2]);
        expect(f.createSocket).toHaveBeenCalledWith(SPOT_PRIVATE_WS_URL, expect.objectContaining({
            maxPayload: SPOT_PRIVATE_MAX_PAYLOAD, followRedirects: false, autoPong: true,
            agent: { label: 'stream-agent' }, handshakeTimeout: 10_000,
        }));
        acknowledge(f.sockets[0]);
        expect(f.controller.getStatus()).toMatchObject({ state: 'ready', subscriptionId: 0 });
        expect(f.onReady).toHaveBeenCalledOnce();
        expect(JSON.stringify(f.onState.mock.calls)).not.toMatch(/fixture-key|fixture-secret|signature/);
    });

    it('ignores pre-ack events, unrelated acknowledgements and another subscription', async () => {
        const f = fixture(); f.controller.start(); await open(f.sockets[0]);
        const socket = f.sockets[0];
        const event = { e: 'balanceUpdate', a: 'USDT', d: '1' };
        message(socket, { subscriptionId: 0, event });
        message(socket, { id: 'wrong', status: 200, result: { subscriptionId: 0 } });
        expect(f.controller.getStatus().state).toBe('subscribing');
        acknowledge(socket, 0);
        message(socket, { subscriptionId: 1, event });
        message(socket, { event });
        expect(f.onEvent).not.toHaveBeenCalled();
        message(socket, { subscriptionId: 0, event });
        expect(f.onEvent).toHaveBeenCalledExactlyOnceWith(event);
        acknowledge(socket, 9);
        expect(f.controller.getStatus().subscriptionId).toBe(0);
    });

    it.each(['open', 'ack'])('bounds the %s wait to ten seconds', async phase => {
        const f = fixture(); f.controller.start();
        if (phase === 'ack') await open(f.sockets[0]);
        await vi.advanceTimersByTimeAsync(9_999);
        expect(f.sockets[0].terminate).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(f.sockets[0].terminate).toHaveBeenCalledOnce();
        expect(f.controller.getStatus().state).toBe('reconnecting');
        await vi.advanceTimersByTimeAsync(2_999);
        expect(f.sockets).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(f.sockets).toHaveLength(2);
    });

    it.each([null, -1, '0', 0.5, 9007199254740992])('does not accept invalid subscription id %s', async id => {
        const f = fixture(); f.controller.start(); await open(f.sockets[0]);
        acknowledge(f.sockets[0], id);
        expect(f.controller.getStatus().state).toBe('reconnecting');
        expect(f.onReady).not.toHaveBeenCalled();
    });

    it.each([
        { status: 400, code: -2015 }, { status: 400, code: -1022 },
        { status: 401, code: -1 }, { status: 403, code: -1 },
        { status: 418, code: -1003 }, { status: 429, code: -1003 },
    ])('stops automatic retry for terminal refusal $status/$code', async ({ status, code }) => {
        const f = fixture(); f.controller.start(); await open(f.sockets[0]);
        message(f.sockets[0], { id: JSON.parse(f.sockets[0].send.mock.lastCall[0]).id,
            status, error: { code, msg: 'secret-bearing untrusted reason' } });
        expect(f.controller.getStatus()).toMatchObject({ state: 'failed', exchangeCode: code });
        await vi.advanceTimersByTimeAsync(120_000);
        expect(f.sockets).toHaveLength(1);
        expect(JSON.stringify(f.onState.mock.calls)).not.toContain('secret-bearing');
        f.controller.stop(); f.controller.start();
        expect(f.sockets).toHaveLength(2);
    });

    it('bounds retries, and socket close plus error cannot schedule two', async () => {
        const f = fixture(); f.controller.start();
        for (let i = 0; i < 6; i++) {
            const socket = f.sockets[i];
            socket.emit('error', new Error('transport'));
            socket.emit('close', 1006);
            if (i < 5) {
                await vi.advanceTimersByTimeAsync((i + 1) * 3_000);
                expect(f.sockets).toHaveLength(i + 2);
            }
        }
        expect(f.controller.getStatus().state).toBe('failed');
        await vi.advanceTimersByTimeAsync(120_000);
        expect(f.sockets).toHaveLength(6);
    });

    it('a quiet account stays ready on peer heartbeat, then reconnects on silence', async () => {
        const f = fixture(); f.controller.start(); await open(f.sockets[0]); acknowledge(f.sockets[0]);
        for (let i = 0; i < 6; i++) {
            await vi.advanceTimersByTimeAsync(20_000);
            f.sockets[0].emit('ping', Buffer.from('ping'));
            expect(f.controller.getStatus().state).toBe('ready');
        }
        await vi.advanceTimersByTimeAsync(60_000);
        expect(f.controller.getStatus()).toMatchObject({ state: 'reconnecting', reason: 'peer-silent' });
    });

    it.each(['close', 'serverShutdown', 'eventStreamTerminated'])('re-subscribes after %s and ignores old socket traffic', async reason => {
        const f = fixture(); f.controller.start(); await open(f.sockets[0]); acknowledge(f.sockets[0], 4);
        const old = f.sockets[0];
        if (reason === 'close') old.emit('close');
        else message(old, { subscriptionId: 4, event: { e: reason } });
        await vi.advanceTimersByTimeAsync(3_000);
        await open(f.sockets[1]); acknowledge(f.sockets[1], 0);
        message(old, { subscriptionId: 4, event: { e: 'balanceUpdate' } });
        old.emit('close'); old.emit('error', new Error('late'));
        expect(f.controller.getStatus()).toMatchObject({ state: 'ready', subscriptionId: 0 });
        expect(f.onEvent).not.toHaveBeenCalled();
        expect(f.onReady).toHaveBeenCalledTimes(2);
    });

    it.each(['connect', 'subscribe'])('stop invalidates queued %s admission across a fresh start', async stage => {
        const pending = [];
        const admit = vi.fn(run => new Promise(resolve => pending.push(() => resolve(run()))));
        const f = fixture({ admit }); f.controller.start();
        if (stage === 'subscribe') { pending.shift()(); await flush(); f.sockets[0].emit('open'); }
        f.controller.stop(); f.controller.start();
        pending.shift()(); await flush();
        if (stage === 'connect') expect(f.sockets).toHaveLength(0);
        else expect(f.sockets[0].send).not.toHaveBeenCalled();
        pending.shift()(); await flush();
        expect(f.sockets).toHaveLength(stage === 'connect' ? 1 : 2);
    });

    it('stop cancels retry and late acknowledgement cannot restore readiness', async () => {
        const f = fixture(); f.controller.start(); await open(f.sockets[0]);
        f.sockets[0].emit('close'); f.controller.stop(); acknowledge(f.sockets[0]);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(f.sockets).toHaveLength(1);
        expect(f.controller.getStatus().state).toBe('stopped');
    });

    it.each(['{invalid', 'null', '[]', 'x'.repeat(SPOT_PRIVATE_MAX_PAYLOAD + 1)])('fails closed on unusable wire data', async data => {
        const f = fixture(); f.controller.start(); await open(f.sockets[0]); acknowledge(f.sockets[0]);
        f.sockets[0].emit('message', data, false);
        expect(f.controller.getStatus()).toMatchObject({ state: 'reconnecting', reason: 'invalid-peer-frame' });
        expect(f.onEvent).not.toHaveBeenCalled();
    });

    it('preserves an unsafe numeric exchange id as decimal text', async () => {
        const f = fixture(); f.controller.start(); await open(f.sockets[0]); acknowledge(f.sockets[0]);
        f.sockets[0].emit('message', '{"subscriptionId":0,"event":{"e":"executionReport","i":9007199254740993}}', false);
        expect(f.onEvent).toHaveBeenCalledWith({ e: 'executionReport', i: '9007199254740993' });
    });

    it('subscribes over a real local WebSocket and replies to server ping', async () => {
        vi.useRealTimers();
        const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
        await new Promise(resolve => server.once('listening', resolve));
        const frames = [];
        let gotPong;
        const pong = new Promise(resolve => { gotPong = resolve; });
        server.on('connection', socket => {
            socket.on('pong', data => gotPong(data.toString()));
            socket.on('message', data => {
                const frame = JSON.parse(data); frames.push(frame);
                socket.send(JSON.stringify({ id: frame.id, status: 200, result: { subscriptionId: 0 } }));
                socket.send(JSON.stringify({ subscriptionId: 0, event: { e: 'balanceUpdate', a: 'USDT', d: '1' } }));
                socket.ping('proof');
            });
        });
        let resolveEvent;
        const event = new Promise(resolve => { resolveEvent = resolve; });
        const f = fixture({
            createSocket: (_url, options) => new WebSocket(`ws://127.0.0.1:${server.address().port}`, options),
            onEvent: resolveEvent,
        });
        try {
            f.controller.start();
            await expect(event).resolves.toMatchObject({ e: 'balanceUpdate', d: '1' });
            await expect(pong).resolves.toBe('proof');
            expect(frames).toHaveLength(1);
            expect(frames[0].method).toBe('userDataStream.subscribe.signature');
        } finally {
            f.controller.stop(); server.clients.forEach(socket => socket.terminate());
            await new Promise(resolve => server.close(resolve));
        }
    });
});
