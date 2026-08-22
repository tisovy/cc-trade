import { describe, expect, it, vi } from 'vitest';
import {
    admitBinancePhysicalAttempt,
    noteBinancePhysicalRetry,
    runWithBinancePhysicalAttemptContext,
} from './binance-physical-attempt-context.js';

describe('Binance physical-attempt context', () => {
    it('keeps direct adapter calls outside physical Futures mode unchanged', async () => {
        const attempt = await admitBinancePhysicalAttempt(30);

        expect(attempt.signal).toBeNull();
        expect(Object.isFrozen(attempt)).toBe(true);
        expect(() => attempt.observeResponse({ status: 200, usedWeight: 30 })).not.toThrow();
        expect(noteBinancePhysicalRetry('network')).toBe(false);
    });

    it('admits once and carries the operation signal to the physical send', async () => {
        const controller = new AbortController();
        const admission = Object.freeze({ sequence: 7 });
        const context = {
            signal: controller.signal,
            admit: vi.fn().mockResolvedValue(admission),
            observeResponse: vi.fn(),
            noteRetry: vi.fn(),
        };

        await runWithBinancePhysicalAttemptContext(context, async () => {
            const attempt = await admitBinancePhysicalAttempt(30);

            expect(attempt.signal).toBe(controller.signal);
            expect(Object.keys(attempt)).toEqual(['signal', 'observeResponse']);
            attempt.observeResponse({
                status: 429,
                usedWeight: 812,
                retryAfterMs: 4 * 24 * 60 * 60 * 1000,
                url: 'https://fapi.binance.com/private?signature=secret',
                headers: { authorization: 'secret' },
                body: { apiKey: 'secret' },
                message: 'private exchange message',
            });
            expect(noteBinancePhysicalRetry('timestamp')).toBe(true);
            expect(noteBinancePhysicalRetry('unbounded-value')).toBe(false);
        });

        expect(context.admit).toHaveBeenCalledOnce();
        expect(context.admit).toHaveBeenCalledWith(30);
        expect(context.observeResponse).toHaveBeenCalledWith(
            {
                status: 429,
                usedWeight: 812,
                retryAfterMs: 3 * 24 * 60 * 60 * 1000,
            },
            admission,
        );
        expect(context.noteRetry).toHaveBeenCalledOnce();
        expect(context.noteRetry).toHaveBeenCalledWith('timestamp');
    });

    it('treats response accounting as observational and sanitizes malformed values', async () => {
        const context = {
            admit: vi.fn().mockResolvedValue(undefined),
            observeResponse: vi.fn(() => {
                throw new Error('diagnostics unavailable');
            }),
        };

        await expect(runWithBinancePhysicalAttemptContext(context, async () => {
            const attempt = await admitBinancePhysicalAttempt();
            attempt.observeResponse({
                status: 999,
                usedWeight: -1,
                retryAfterMs: Number.MAX_SAFE_INTEGER + 1,
                signature: 'secret',
            });
            return 'payload';
        })).resolves.toBe('payload');

        expect(context.observeResponse).toHaveBeenCalledWith({}, undefined);
    });

    it('isolates concurrent logical operations', async () => {
        const first = { admit: vi.fn().mockResolvedValue(undefined), noteRetry: vi.fn() };
        const second = { admit: vi.fn().mockResolvedValue(undefined), noteRetry: vi.fn() };

        await Promise.all([
            runWithBinancePhysicalAttemptContext(first, async () => {
                await Promise.resolve();
                await admitBinancePhysicalAttempt(5);
                noteBinancePhysicalRetry('connection-fallback');
            }),
            runWithBinancePhysicalAttemptContext(second, async () => {
                await Promise.resolve();
                await admitBinancePhysicalAttempt(30);
                noteBinancePhysicalRetry('rate-limit');
            }),
        ]);

        expect(first.admit).toHaveBeenCalledWith(5);
        expect(first.noteRetry).toHaveBeenCalledWith('connection-fallback');
        expect(second.admit).toHaveBeenCalledWith(30);
        expect(second.noteRetry).toHaveBeenCalledWith('rate-limit');
    });

    it('rejects a missing operation before installing async-local state', () => {
        expect(() => runWithBinancePhysicalAttemptContext({}, null)).toThrow(TypeError);
    });
});
