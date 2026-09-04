import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSpotAccountFingerprint, isSpotAccountPayload, spotAccountStorageKey, readSpotAccountStorage, writeSpotAccountStorage } from './spotAccountScope.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
beforeEach(() => localStorage.clear());

describe('Spot persistence ownership', () => {
    it.each([null, undefined, '', 'api-key', 'A'.repeat(64), 'a'.repeat(63), {}])('fails closed for invalid identity %j', fingerprint => {
        expect(readSpotAccountFingerprint(fingerprint)).toBeNull();
        expect(writeSpotAccountStorage('orders_history', fingerprint, [1])).toBe(false);
        expect(readSpotAccountStorage('orders_history', fingerprint, [])).toEqual([]);
        expect(localStorage.length).toBe(0);
    });
    it('isolates kinds and identities without touching legacy keys', () => {
        localStorage.setItem('orders_history', '["legacy"]');
        localStorage.setItem('pnl_snapshots', '{"legacy":true}');
        writeSpotAccountStorage('orders_history', A, ['A']);
        writeSpotAccountStorage('orders_history', B, ['B']);
        writeSpotAccountStorage('pnl_snapshots', A, { snapshots: {} });
        expect(readSpotAccountStorage('orders_history', A)).toEqual(['A']);
        expect(readSpotAccountStorage('orders_history', B)).toEqual(['B']);
        expect(readSpotAccountStorage('pnl_snapshots', A)).toEqual({ snapshots: {} });
        expect(localStorage.getItem('orders_history')).toBe('["legacy"]');
        expect(localStorage.getItem('pnl_snapshots')).toBe('{"legacy":true}');
        expect(spotAccountStorageKey('unknown', A)).toBeNull();
    });
    it.each([{ version: 2 }, { marketType: 'futures' }, { accountFingerprint: B }, { kind: 'pnl_snapshots' }])('rejects mismatched envelope %j', override => {
        localStorage.setItem(spotAccountStorageKey('orders_history', A), JSON.stringify({
            version: 1, marketType: 'spot', accountFingerprint: A, kind: 'orders_history', data: ['wrong'], ...override,
        }));
        expect(readSpotAccountStorage('orders_history', A, [])).toEqual([]);
    });
    it('tolerates malformed JSON and denied storage', () => {
        localStorage.setItem(spotAccountStorageKey('orders_history', A), '{');
        expect(readSpotAccountStorage('orders_history', A, [])).toEqual([]);
        const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        expect(writeSpotAccountStorage('orders_history', A, [])).toBe(false);
        spy.mockRestore();
    });
    it('recognizes only Spot private data', () => {
        for (const type of ['orders', 'balances', 'history', 'execution_update', 'balance_update']) {
            expect(isSpotAccountPayload({ [type]: [] })).toBe(true);
            expect(isSpotAccountPayload({ type, payload: [] })).toBe(true);
            expect(isSpotAccountPayload({ type, marketType: 'futures', payload: [] })).toBe(false);
        }
        for (const payload of [{ futures_orders: [] }, { type: 'futures_account_state' }, { ticker: [] }, { chart: [] }]) {
            expect(isSpotAccountPayload(payload)).toBe(false);
        }
    });
});
