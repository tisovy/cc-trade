import { describe, expect, it, vi } from 'vitest';
import {
    createFuturesProductionExecutionSanitizer,
    installFuturesProductionExecutionLogSanitizer,
} from './futures-production-execution-sanitizer.js';

describe('Futures production execution sanitizer', () => {
    it('redacts raw, URL-encoded, base64, hex, signed URL, and nested sink material', () => {
        const secret = 'prod-key+/=';
        const sanitizer = createFuturesProductionExecutionSanitizer([secret]);
        const accessor = {};
        Object.defineProperty(accessor, 'value', {
            enumerable: true,
            get: () => { throw new Error('must not execute'); },
        });
        const safe = sanitizer.sanitize({
            text: [
                secret,
                encodeURIComponent(secret),
                Buffer.from(secret).toString('base64'),
                Buffer.from(secret).toString('hex'),
                'https://fapi.binance.com/fapi/v1/order?signature=abc&timestamp=1',
            ].join(' '),
            nested: { headers: { authorization: secret }, harmless: 'retained' },
            cause: new Error(secret),
            accessor,
        });
        const serialized = JSON.stringify(safe);
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain(encodeURIComponent(secret));
        expect(serialized).not.toContain(Buffer.from(secret).toString('base64'));
        expect(serialized).not.toContain(Buffer.from(secret).toString('hex'));
        expect(serialized).not.toContain('abc&timestamp');
        expect(safe.nested.headers).toBe('[redacted]');
        expect(safe.cause).toBe('[redacted]');
        expect(safe.accessor.value).toBe('[redacted]');
    });

    it('retains old and rotated values in its bounded redaction set', () => {
        const sanitizer = createFuturesProductionExecutionSanitizer(['old-secret']);
        sanitizer.addSecretValues(['new-secret']);
        expect(sanitizer.sanitizeText('old-secret new-secret')).toBe('[redacted] [redacted]');
    });

    it('bounds UTF-8 text without splitting disclosure controls', () => {
        const sanitizer = createFuturesProductionExecutionSanitizer(['secret']);
        const safe = sanitizer.sanitizeText(`${'🙂'.repeat(2_000)}secret`);
        expect(Buffer.byteLength(safe, 'utf8')).toBeLessThanOrEqual(4_096);
        expect(safe).not.toContain('secret');
        expect(safe).toContain('[truncated]');
    });

    it('sanitizes every console sink and restores each original exactly once', () => {
        const target = {
            debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(),
        };
        const originalError = target.error;
        const installed = installFuturesProductionExecutionLogSanitizer({
            consoleObject: target,
            secretValues: ['secret'],
        });
        target.error(new Error('secret'), { request: { url: 'secret' } });
        expect(originalError).toHaveBeenCalledWith(
            { name: 'Error', code: null, message: '[redacted]' },
            { request: '[redacted]' },
        );
        expect(installed.restore()).toBe(true);
        expect(installed.restore()).toBe(false);
        expect(target.error).toBe(originalError);
    });
});
