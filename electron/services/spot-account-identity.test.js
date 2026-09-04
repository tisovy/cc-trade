import { describe, expect, it } from 'vitest';
import { createSpotAccountFingerprint, stampSpotAccountPayload } from './spot-account-identity.js';

describe('main-owned Spot identity', () => {
    it('is stable for a configured key and independent across key rotation', () => {
        const fingerprint = createSpotAccountFingerprint('fixture-key-A');
        expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(createSpotAccountFingerprint('fixture-key-A')).toBe(fingerprint);
        expect(createSpotAccountFingerprint('fixture-key-B')).not.toBe(fingerprint);
        expect(fingerprint).not.toContain('fixture-key');
    });
    it.each([null, undefined, '', '  ', 42])('cannot fabricate identity from %j', key => {
        expect(createSpotAccountFingerprint(key)).toBeNull();
    });
    it('appends main identity without changing the legacy first payload key or mutating input', () => {
        const payload = { history: [], requestId: 'fixture' };
        const fp = createSpotAccountFingerprint('fixture-key');
        expect(stampSpotAccountPayload(payload, fp)).toEqual({ ...payload, spot_account_fingerprint: fp });
        expect(Object.keys(stampSpotAccountPayload(payload, fp))[0]).toBe('history');
        expect(payload).not.toHaveProperty('spot_account_fingerprint');
        expect(stampSpotAccountPayload({ ...payload, spot_account_fingerprint: 'spoof' }, fp).spot_account_fingerprint).toBe(fp);
    });
    it('leaves Futures/public data unchanged even with no Spot configuration', () => {
        for (const payload of [{ futures_balances: {} }, { futures_orders: [] }, { type: 'futures_account_state' }, { ticker: [] }, { chart: [] }]) {
            expect(stampSpotAccountPayload(payload, null)).toBe(payload);
        }
    });
});
