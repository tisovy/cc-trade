import { describe, expect, it, vi } from 'vitest';
import {
    createFuturesTestnetExecutionSanitizer,
    installFuturesTestnetExecutionLogSanitizer,
} from './futures-testnet-execution-sanitizer.js';

describe('futures execution sanitizer', () => {
    it('redacts raw, encoded, signature, nested configuration, cause, and stack material', () => {
        const sanitizer = createFuturesTestnetExecutionSanitizer(['key+/=', 'secret']);
        const safe = sanitizer.sanitize({
            text: 'key+/= secret key%2B%2F%3D signature=abc123&symbol=BTCUSDT',
            nested: { config: { url: 'signed' }, harmless: 'retained' },
            cause: new Error('secret'),
            stack: 'secret stack',
        });
        expect(JSON.stringify(safe)).not.toContain('key+/=');
        expect(JSON.stringify(safe)).not.toContain('key%2B%2F%3D');
        expect(JSON.stringify(safe)).not.toContain('secret');
        expect(safe.text).toContain('signature=[redacted]');
        expect(safe.nested.config).toBe('[redacted]');
        expect(safe.cause).toBe('[redacted]');
        expect(safe.stack).toBe('[redacted]');
    });

    it('sanitizes console sinks before forwarding and can restore them', () => {
        const target = {
            debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(),
        };
        const original = target.error;
        const installed = installFuturesTestnetExecutionLogSanitizer({
            consoleObject: target,
            secretValues: ['secret'],
        });
        target.error(new Error('secret'), { headers: { authorization: 'secret' } });
        expect(original).toHaveBeenCalledWith(
            { name: 'Error', code: null, message: '[redacted]' },
            { headers: '[redacted]' },
        );
        installed.restore();
        expect(target.error).toBe(original);
    });
});
