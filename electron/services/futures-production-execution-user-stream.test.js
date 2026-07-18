import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sockets = [];

class FakeWebSocket extends EventEmitter {
    constructor(url, options) {
        super();
        this.url = url;
        this.options = options;
        this.close = vi.fn((code, reason) => {
            this.closeCode = code;
            this.closeReason = reason;
        });
        sockets.push(this);
    }
}

vi.mock('ws', () => ({ default: FakeWebSocket }));

const {
    FuturesProductionExecutionFacadeError,
    createFuturesProductionExecutionFacade,
} = await import('./futures-production-execution-facade.js');

const listenKey = 'futures-listen-key-0123456789abcdef';
const createFacade = () => createFuturesProductionExecutionFacade({
    apiKey: 'production-api-key-fixture',
    apiSecret: 'production-api-secret-fixture',
    allowedSymbols: ['BTCUSDT'],
}, { fetchImpl: vi.fn() });

describe('Futures production user-data stream transport', () => {
    beforeEach(() => sockets.splice(0));

    it('pins one bounded text-only socket to the exact Futures production origin', async () => {
        const onMessage = vi.fn();
        const onDisconnect = vi.fn();
        const stream = createFacade().connectUserDataStream({
            listenKey,
            onMessage,
            onDisconnect,
        });
        const socket = sockets[0];
        const socketUrl = new URL(socket.url);
        expect(socketUrl.origin).toBe('wss://fstream.binance.com');
        expect(socketUrl.pathname).toBe('/private/ws');
        expect([...socketUrl.searchParams.entries()]).toEqual([
            ['listenKey', listenKey],
            [
                'events',
                'ORDER_TRADE_UPDATE/ALGO_UPDATE/ACCOUNT_UPDATE/ACCOUNT_CONFIG_UPDATE/listenKeyExpired',
            ],
        ]);
        expect(socket.options).toEqual({
            followRedirects: false,
            handshakeTimeout: 10_000,
            maxPayload: 64 * 1024,
            perMessageDeflate: false,
        });

        socket.emit('open');
        await expect(stream.ready).resolves.toBe(true);
        socket.emit('message', Buffer.from('{"e":"ORDER_TRADE_UPDATE"}'), false);
        expect(onMessage).toHaveBeenCalledWith('{"e":"ORDER_TRADE_UPDATE"}');
        socket.emit('close');
        expect(onDisconnect).toHaveBeenCalledWith(
            'FUTURES_PRODUCTION_ACCOUNT_STREAM_DISCONNECTED',
        );
    });

    it('rejects binary frames and sanitizes pre-open failures', async () => {
        const onMessage = vi.fn();
        const onDisconnect = vi.fn();
        const stream = createFacade().connectUserDataStream({
            listenKey,
            onMessage,
            onDisconnect,
        });
        const socket = sockets[0];
        socket.emit('message', Buffer.from([1, 2, 3]), true);
        expect(socket.close).toHaveBeenCalledWith(1009, 'unsupported frame');
        expect(onMessage).not.toHaveBeenCalled();

        socket.emit('error', new Error(`secret ${listenKey}`));
        await expect(stream.ready).rejects.toBeInstanceOf(
            FuturesProductionExecutionFacadeError,
        );
        await expect(stream.ready).rejects.not.toThrow(listenKey);
    });

    it('settles a pre-open socket when shutdown closes the stream', async () => {
        const stream = createFacade().connectUserDataStream({
            listenKey,
            onMessage: vi.fn(),
            onDisconnect: vi.fn(),
        });
        const socket = sockets[0];

        stream.close();

        await expect(stream.ready).rejects.toBeInstanceOf(
            FuturesProductionExecutionFacadeError,
        );
        expect(socket.close).toHaveBeenCalledWith(1000, 'service shutdown');
    });

    it('rejects caller URL or callback expansion before creating a socket', () => {
        const facade = createFacade();
        expect(() => facade.connectUserDataStream({
            listenKey,
            onMessage: () => {},
            onDisconnect: () => {},
            url: 'wss://example.invalid',
        })).toThrow(FuturesProductionExecutionFacadeError);
        expect(sockets).toHaveLength(0);
    });
});
