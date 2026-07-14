import { describe, expect, it, vi } from 'vitest';
import {
    FuturesProductionNetworkEscapeError,
    installFuturesProductionNetworkEscapeGuard,
    isForbiddenFuturesNetworkUrl,
} from './futures-production-network-guard.js';

describe('Futures production network escape guard', () => {
    it.each([
        'https://fapi.binance.com/fapi/v1/order',
        'wss://fstream.binance.com/ws',
        'https://demo-fapi.binance.com/fapi/v1/order',
        'wss://demo-fstream.binance.com/ws',
    ])('recognizes forbidden Futures host %s', (url) => {
        expect(isForbiddenFuturesNetworkUrl(url)).toBe(true);
    });

    it('permits loopback and unrelated hosts', () => {
        expect(isForbiddenFuturesNetworkUrl('ws://127.0.0.1:8787')).toBe(false);
        expect(isForbiddenFuturesNetworkUrl('https://example.com/fapi.binance.com')).toBe(false);
    });

    it('rejects an escaped fetch before invoking the underlying implementation', async () => {
        const underlying = vi.fn(async () => new Response('{}'));
        const globalObject = { fetch: underlying };
        const guard = installFuturesProductionNetworkEscapeGuard({ globalObject });

        await expect(globalObject.fetch('https://fapi.binance.com/fapi/v1/time'))
            .rejects.toBeInstanceOf(FuturesProductionNetworkEscapeError);
        expect(underlying).not.toHaveBeenCalled();
        expect(guard.getAttempts()).toEqual([{
            hostname: 'fapi.binance.com',
            pathname: '/fapi/v1/time',
            method: 'GET',
        }]);

        guard.restore();
        await globalObject.fetch('https://fapi.binance.com/fapi/v1/time');
        expect(underlying).toHaveBeenCalledTimes(1);
    });
});
