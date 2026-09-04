import { useEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider, useDataContext } from './DataContext.jsx';
import { readDeskFrame } from '../utils/deskFrameRouter.js';
import { readSpotAccountStorage, writeSpotAccountStorage } from '../utils/spotAccountScope.js';

const gateway = vi.hoisted(() => ({
    addMessageListener: vi.fn(), setSpotDetailSubscription: vi.fn(), sendMessage: vi.fn(),
    subscribe: vi.fn(), unsubscribe: vi.fn(), notifications: { notifyWarning: vi.fn(), notifySuccess: vi.fn() },
    startupStatus: { ready: true }, wsConnection: { readyState: 1 }, marketGeneration: 1,
}));
vi.mock('./GatewayContext.jsx', () => ({ useGatewayContext: () => gateway }));
vi.mock('../utils/cache', () => ({
    initCache: vi.fn(async () => {}), getCacheStats: vi.fn(async () => ({})),
    getCachedCandles: vi.fn(async () => null), setCachedCandles: vi.fn(async () => {}),
}));
vi.mock('../utils/analytics', () => ({
    requestAnalyticsCombined: vi.fn(async () => null), requestActivityMetrics: vi.fn(async () => null),
}));
const A = 'a'.repeat(64), B = 'b'.repeat(64);
let desk, listener;
const Consumer = () => {
    const context = useDataContext();
    useEffect(() => { desk = context; });
    return null;
};
const tree = () => <DataProvider><Consumer /></DataProvider>;
const deliver = (payload, fp = A, connection = gateway.wsConnection) => act(async () => {
    const data = JSON.stringify({ ...payload, spot_account_fingerprint: fp });
    listener({ data }, connection, readDeskFrame(data));
});
const fullBalances = value => ({ balances: { USDT: { available: String(value), onOrder: '0' } } });
const channelHistory = rows => ({ channelId: 'account-history', type: 'history', payload: rows });
beforeEach(() => {
    localStorage.clear();
    gateway.wsConnection = { readyState: 1 };
    gateway.addMessageListener.mockImplementation(next => {
        listener = next;
        return () => { if (listener === next) listener = null; };
    });
});
afterEach(cleanup);

describe('Spot current-account private state', () => {
    it('does not load or overwrite legacy history and swaps scoped history before writing', async () => {
        localStorage.setItem('orders_history', '[{"orderId":"legacy"}]');
        writeSpotAccountStorage('orders_history', A, { PAXUSDT: [{ orderId: 'A-old', symbol: 'PAXUSDT' }] });
        writeSpotAccountStorage('orders_history', B, { PAXUSDT: [{ orderId: 'B-old', symbol: 'PAXUSDT' }] });
        render(tree());
        expect(desk.history).toEqual([]);
        expect(desk.getAllHistory()).toEqual([]);
        await deliver(fullBalances(10000));
        expect(desk.history[0].orderId).toBe('A-old');
        await deliver(channelHistory([{ orderId: 'A-new', symbol: 'PAXUSDT' }]));
        await deliver(fullBalances(1000), B);
        expect(desk.history[0].orderId).toBe('B-old');
        expect(desk.getAllHistory()).toEqual(desk.history);
        await deliver(channelHistory([{ orderId: 'B-new', symbol: 'PAXUSDT' }]), B);
        expect(readSpotAccountStorage('orders_history', A).PAXUSDT[0].orderId).toBe('A-new');
        await deliver(fullBalances(11000), A);
        expect(desk.history[0].orderId).toBe('A-new');
        expect(readSpotAccountStorage('orders_history', B).PAXUSDT[0].orderId).toBe('B-new');
        expect(localStorage.getItem('orders_history')).toBe('[{"orderId":"legacy"}]');
    });
    it('masks old live state on socket replacement and rejects late old-socket data', async () => {
        const view = render(tree());
        await deliver(fullBalances(10000));
        await deliver({ orders: [{ orderId: 1, symbol: 'PAXUSDT', status: 'NEW' }] });
        const old = gateway.wsConnection;
        gateway.wsConnection = { readyState: 1 };
        view.rerender(tree());
        expect(desk.spotAccountFingerprint).toBeNull();
        expect(desk.balances).toEqual({});
        expect(desk.orders).toEqual([]);
        expect(desk.history).toEqual([]);
        await deliver(fullBalances(1000), B);
        const stored = localStorage.length;
        await deliver(channelHistory([{ orderId: 'late-A' }]), A, old);
        await deliver(fullBalances(99999), A, old);
        expect(desk.spotAccountFingerprint).toBe(B);
        expect(desk.balances.USDT.available).toBe('1000');
        expect(localStorage.length).toBe(stored);
        expect(desk.history).toEqual([]);
    });
    it('requires valid identity and full balances rather than an initial delta', async () => {
        render(tree());
        const existingKeys = localStorage.length;
        await deliver(fullBalances(10000), null);
        await deliver(channelHistory([{ orderId: 'unowned' }]), 'invalid');
        expect(desk.spotAccountFingerprint).toBeNull();
        expect(localStorage.length).toBe(existingKeys);
        await deliver({ channelId: 'account', type: 'balance_update', payload: [{ a: 'USDT', f: '1000', l: '0' }] }, B);
        expect(desk.spotAccountFingerprint).toBe(B);
        expect(desk.balances).toEqual({});
        await deliver(fullBalances(1000), B);
        expect(desk.balances.USDT.available).toBe('1000');
    });
    it('preserves unresolved warnings across same-key reconnect, clearing on known account change', async () => {
        const view = render(tree());
        await deliver(fullBalances(10000));
        await deliver({ command_unresolved: { request: 'trade.placeOrder', code: 'PENDING', details: { marketType: 'spot', clientOrderId: 'held' } } });
        gateway.wsConnection = { readyState: 1 };
        view.rerender(tree());
        await deliver(fullBalances(10000));
        expect(desk.unresolvedOutcome.code).toBe('PENDING');
        await deliver(fullBalances(1000), B);
        expect(desk.unresolvedOutcome).toBeNull();
    });
    it('switches history refs synchronously for same-tick account events', async () => {
        render(tree());
        await act(async () => {
            for (const [fp, id] of [[A, 'A'], [B, 'B']]) {
                const data = JSON.stringify({ ...channelHistory([{ orderId: id, symbol: 'PAXUSDT' }]), spot_account_fingerprint: fp });
                listener({ data }, gateway.wsConnection, readDeskFrame(data));
            }
        });
        expect(desk.history[0].orderId).toBe('B');
        expect(readSpotAccountStorage('orders_history', A).PAXUSDT[0].orderId).toBe('A');
        expect(readSpotAccountStorage('orders_history', B).PAXUSDT[0].orderId).toBe('B');
    });
});
