import { describe, expect, it, vi } from 'vitest';
import {
    attachMockWebSocketHandlers,
    createMockMarketState,
} from '../tests/helpers/mockWebSocketMessages.js';

const createSocket = () => {
    const listeners = new Map();
    return {
        on: (event, listener) => listeners.set(event, listener),
        send: vi.fn(),
        receive: payload => listeners.get('message')?.(Buffer.from(JSON.stringify(payload))),
    };
};

describe('E2E mock WebSocket routing', () => {
    it('does not implement removed action aliases while retaining validated legacy cancel', () => {
        const socket = createSocket();
        const handlers = {
            onChannelOrder: vi.fn(),
            onChannelCancel: vi.fn(),
            onLegacyCancel: vi.fn(),
        };
        const api = attachMockWebSocketHandlers(socket, createMockMarketState(), handlers);

        socket.receive({ action: 'order', data: { symbol: 'BTCUSDT' } });
        socket.receive({ action: 'cancelOrder', data: { symbol: 'BTCUSDT' } });

        expect(handlers.onChannelOrder).not.toHaveBeenCalled();
        expect(handlers.onChannelCancel).not.toHaveBeenCalled();
        expect(api.getLastOrder()).toBeNull();

        socket.receive({ request: 'cancelOrder', data: { symbol: 'BTCUSDT' } });
        expect(handlers.onLegacyCancel).toHaveBeenCalledOnce();
    });
});
