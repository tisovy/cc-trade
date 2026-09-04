import { StrictMode, useEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider, useDataContext } from './DataContext.jsx';
import { getCachedCandles, setCachedCandles } from '../utils/cache';
import { readDeskFrame } from '../utils/deskFrameRouter';

const gateway = vi.hoisted(() => ({
    addMessageListener: vi.fn(),
    setSpotDetailSubscription: vi.fn(),
    sendMessage: vi.fn(() => true),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    notifications: { notifyWarning: vi.fn(), notifySuccess: vi.fn() },
    startupStatus: { ready: true },
    wsConnection: { readyState: 1 },
    marketGeneration: 1,
}));
vi.mock('./GatewayContext.jsx', () => ({ useGatewayContext: () => gateway }));
vi.mock('../utils/cache', () => ({
    initCache: vi.fn(async () => {}),
    getCacheStats: vi.fn(async () => ({})),
    getCachedCandles: vi.fn(async () => null),
    setCachedCandles: vi.fn(async () => {}),
}));
vi.mock('../utils/analytics', () => ({
    requestAnalyticsCombined: vi.fn(async () => null),
    requestActivityMetrics: vi.fn(async () => null),
}));

const captured = { current: null, listener: null };
const Consumer = () => {
    const context = useDataContext();
    useEffect(() => { captured.current = context; });
    return null;
};
const tree = (spotEnabled = true) => <StrictMode>
    <DataProvider spotEnabled={spotEnabled}><Consumer /></DataProvider>
</StrictMode>;
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const rows = price => [{ time: 1_700_000_000, open: price, high: price, low: price, close: price, volume: 1 }];
const cached = price => ({ candles: rows(price) });
const liveRows = price => Array.from({ length: 12 }, (_, index) => ({ ...rows(price)[0], time: 1_700_000_000 + index * 3600 }));
const desk = () => captured.current;
const subscription = () => gateway.setSpotDetailSubscription.mock.lastCall?.[0];
const select = (selected, interval = '1h') => act(async () => {
    desk().handlePanelUpdate({ selected, interval }, true);
});
const deliver = async (symbol, interval, type, payload, extra) => act(async () => {
    const data = JSON.stringify({
        channelId: `detail-${symbol}-${interval}-test`, symbol, interval, type, payload, extra,
    });
    captured.listener({ data }, gateway.wsConnection, readDeskFrame(data));
});

beforeEach(() => {
    vi.clearAllMocks();
    getCachedCandles.mockReset().mockResolvedValue(null);
    gateway.addMessageListener.mockImplementation(listener => {
        captured.listener = listener;
        return () => { if (captured.listener === listener) captured.listener = null; };
    });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Spot selection opening ownership', () => {
    it.each(['hit', 'miss', 'error'])('ignores an abandoned cache %s after the latest opening completes', async outcome => {
        const old = deferred();
        getCachedCandles.mockImplementation(symbol => symbol === 'ETHUSDT' ? old.promise : Promise.resolve(cached(20)));
        render(tree());
        await select('ETHUSDT');
        await select('SOLUSDT');
        const latestSubscription = subscription();
        expect(desk().chart).toEqual(rows(20));
        await act(async () => {
            if (outcome === 'error') old.reject(new Error('cache failed'));
            else old.resolve(outcome === 'hit' ? cached(10) : null);
        });
        expect(desk().panel.selected).toBe('SOLUSDT');
        expect(desk().chart).toEqual(rows(20));
        expect(desk().isLoading).toBe(false);
        expect(subscription()).toBe(latestSubscription);
        expect(subscription()).toMatchObject({ symbol: 'SOLUSDT', interval: '1h' });
    });

    it('does not let an older hit dismiss the latest cache-miss loader', async () => {
        const old = deferred();
        getCachedCandles.mockImplementation(symbol => symbol === 'ETHUSDT' ? old.promise : Promise.resolve(null));
        render(tree());
        await select('ETHUSDT');
        await select('SOLUSDT');
        expect(desk().isLoading).toBe(true);
        await act(async () => old.resolve(cached(10)));
        expect(desk().chart).toEqual([]);
        expect(desk().isLoading).toBe(true);
        expect(desk().loadingMessage).toBe('Loading SOLUSDT...');
    });

    it('keeps the latest interval when its cache finishes first', async () => {
        const old = deferred();
        getCachedCandles.mockImplementation((_symbol, interval) => interval === '1m' ? old.promise : Promise.resolve(cached(30)));
        render(tree());
        await select('ETHUSDT', '1m');
        await select('ETHUSDT', '4h');
        await act(async () => old.resolve(cached(10)));
        expect(desk().chart).toEqual(rows(30));
        expect(desk().isChartLoading).toBe(false);
        expect(subscription()).toMatchObject({ symbol: 'ETHUSDT', interval: '4h' });
    });

    it('does not revive the first A in A -> B -> A, even at one clock timestamp', async () => {
        const first = deferred();
        getCachedCandles.mockImplementationOnce(() => first.promise).mockResolvedValue(cached(30));
        vi.spyOn(Date, 'now').mockReturnValue(123456789);
        render(tree());
        await select('ETHUSDT');
        await select('SOLUSDT');
        const middleId = subscription().requestId;
        await select('ETHUSDT');
        const lastId = subscription().requestId;
        await act(async () => first.resolve(cached(10)));
        expect(desk().chart).toEqual(rows(30));
        expect(subscription().requestId).toBe(lastId);
        expect(lastId).not.toBe(middleId);
        vi.restoreAllMocks();
    });

    it.each(['miss', 'error'])('subscribes to live data after the current cache %s', async outcome => {
        if (outcome === 'error') getCachedCandles.mockRejectedValue(new Error('IndexedDB unavailable'));
        render(tree());
        await select('SOLUSDT');
        expect(desk().chart).toEqual([]);
        expect(subscription()).toMatchObject({ symbol: 'SOLUSDT' });
        await deliver('SOLUSDT', '1h', 'chart', liveRows(40), liveRows(40).at(-1));
        expect(desk().chart).toEqual(liveRows(40));
        expect(desk().isLoading).toBe(false);
    });

    it('drops old detail and queued candles while a new cache is pending', async () => {
        render(tree());
        await select('ETHUSDT');
        await deliver('ETHUSDT', '1h', 'chart', liveRows(10), liveRows(10).at(-1));
        expect(desk().chart).toEqual(liveRows(10));
        act(() => desk().handleThrottleSwitch());
        await deliver('ETHUSDT', '1h', 'chart', [], rows(99)[0]);
        const pending = deferred();
        getCachedCandles.mockReturnValue(pending.promise);
        await select('SOLUSDT');
        expect(desk().chart).toEqual([]);
        expect(subscription()).toBe(null);
        setCachedCandles.mockClear();
        await deliver('ETHUSDT', '1h', 'chart', liveRows(99), liveRows(99).at(-1));
        await deliver('ETHUSDT', '1h', 'trades', [{ p: '99' }]);
        await deliver('ETHUSDT', '1h', 'depth', { bids: { 99: 9 }, asks: {} });
        expect(desk().chart).toEqual([]);
        expect(desk().trades).toEqual([]);
        expect(desk().depth).toEqual({ bids: {}, asks: {} });
        expect(setCachedCandles).not.toHaveBeenCalled();
        await act(async () => pending.resolve(cached(20)));
        // Disabling throttle flushes anything still held: no ETH candle survives.
        act(() => desk().handleThrottleSwitch());
        expect(desk().chart).toEqual(rows(20));
    });

    it('preserves settings changed while the cache was pending', async () => {
        const pending = deferred();
        getCachedCandles.mockReturnValue(pending.promise);
        render(tree());
        await select('SOLUSDT');
        act(() => desk().handlePanelUpdate({ showVolume: false }));
        await act(async () => pending.resolve(cached(20)));
        expect(subscription().panelState).toMatchObject({ selected: 'SOLUSDT', showVolume: false });
    });

    it('rejects legacy chart frames during opening without dropping global account facts', async () => {
        render(tree());
        await select('ETHUSDT');
        const pending = deferred();
        getCachedCandles.mockReturnValue(pending.promise);
        await select('SOLUSDT');
        const account = { USDT: { available: '123', onOrder: '0' } };
        await act(async () => {
            for (const message of [
                { chart: liveRows(99), symbol: 'ETHUSDT', interval: '1h' },
                { channelId: 'global', type: 'balances', payload: account },
            ]) {
                const data = JSON.stringify(message);
                captured.listener({ data }, gateway.wsConnection, readDeskFrame(data));
            }
        });
        expect(desk().chart).toEqual([]);
        expect(desk().balances).toEqual(account);
        await act(async () => pending.resolve(cached(20)));
        expect(desk().chart).toEqual(rows(20));
    });

    it('uses the newest panel for partial selections made before a render', async () => {
        render(tree());
        await act(async () => {
            desk().handlePanelUpdate({ selected: 'ETHUSDT', interval: '1m' }, true);
            desk().handlePanelUpdate({ selected: 'SOLUSDT' }, true);
        });
        expect(subscription()).toMatchObject({ symbol: 'SOLUSDT', interval: '1m' });
        expect(getCachedCandles).toHaveBeenCalledTimes(1);
    });

    it('invalidates disabled work and reopens only the latest target on enable', async () => {
        const pending = deferred();
        getCachedCandles.mockReturnValueOnce(pending.promise).mockResolvedValue(cached(30));
        const view = render(tree());
        await select('SOLUSDT');
        view.rerender(tree(false));
        await act(async () => pending.resolve(cached(10)));
        expect(desk().chart).toEqual([]);
        expect(subscription()).toBe(null);
        await act(async () => view.rerender(tree(true)));
        expect(desk().chart).toEqual(rows(30));
        expect(subscription()).toMatchObject({ symbol: 'SOLUSDT' });
    });

    it('does not publish a cache completion after unmount', async () => {
        const pending = deferred();
        getCachedCandles.mockReturnValue(pending.promise);
        const view = render(tree());
        await select('SOLUSDT');
        view.unmount();
        gateway.setSpotDetailSubscription.mockClear();
        await act(async () => pending.resolve(cached(10)));
        expect(gateway.setSpotDetailSubscription).not.toHaveBeenCalled();
        expect(captured.listener).toBe(null);
    });
});
