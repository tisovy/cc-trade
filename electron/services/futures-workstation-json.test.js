import { describe, expect, it, vi } from 'vitest';
import {
    FuturesWorkstationIntegerToken,
    FuturesWorkstationJsonError,
    parseFuturesWorkstationJson,
    readFuturesWorkstationIdentity,
    readFuturesWorkstationResponseBody,
    readFuturesWorkstationTimestamp,
    validateFuturesWorkstationResponseHeaders,
} from './futures-workstation-json.js';

describe('bounded Futures workstation JSON and HTTP boundary', () => {
    it('preserves every integer token without Number coercion', () => {
        const parsed = parseFuturesWorkstationJson(
            '{"id":18446744073709551615,"time":1784000000000}',
            { maxBytes: 100 },
        );
        expect(parsed.id).toBeInstanceOf(FuturesWorkstationIntegerToken);
        expect(readFuturesWorkstationIdentity(parsed.id)).toBe('18446744073709551615');
        expect(readFuturesWorkstationTimestamp(parsed.time)).toBe(1_784_000_000_000);
    });

    it('rejects an identity above unsigned int64 while preserving the raw parser boundary', () => {
        const parsed = parseFuturesWorkstationJson(
            '{"id":18446744073709551616}',
            { maxBytes: 100 },
        );
        expect(parsed.id).toBeInstanceOf(FuturesWorkstationIntegerToken);
        expect(() => readFuturesWorkstationIdentity(parsed.id))
            .toThrowError(expect.objectContaining({ code: 'INVALID_INTEGER_IDENTITY' }));
    });

    it.each([
        ['duplicate key', '{"a":1,"a":2}', 'DUPLICATE_JSON_KEY'],
        ['fraction', '{"a":1.2}', 'INVALID_JSON_NUMBER'],
        ['exponent', '{"a":1e2}', 'INVALID_JSON_NUMBER'],
        ['leading zero', '{"a":01}', 'INVALID_JSON'],
        ['trailing input', '{"a":1}x', 'INVALID_JSON'],
    ])('rejects %s', (_label, raw, code) => {
        expect(() => parseFuturesWorkstationJson(raw, { maxBytes: 100 }))
            .toThrowError(expect.objectContaining({ code }));
    });

    it('enforces JSON byte, depth, node and string budgets', () => {
        expect(() => parseFuturesWorkstationJson('"abcdef"', { maxBytes: 4 }))
            .toThrow(FuturesWorkstationJsonError);
        expect(() => parseFuturesWorkstationJson('[[[1]]]', { maxBytes: 20, maxDepth: 1 }))
            .toThrowError(expect.objectContaining({ code: 'JSON_RESOURCE_LIMIT' }));
        expect(() => parseFuturesWorkstationJson('[1,2,3]', { maxBytes: 20, maxNodes: 2 }))
            .toThrowError(expect.objectContaining({ code: 'JSON_RESOURCE_LIMIT' }));
        expect(() => parseFuturesWorkstationJson('"abcdef"', { maxBytes: 20, maxStringBytes: 2 }))
            .toThrowError(expect.objectContaining({ code: 'JSON_RESOURCE_LIMIT' }));
    });

    it('reads a chunked body and cancels immediately on overflow', async () => {
        const cancel = vi.fn(async () => {});
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ value: new Uint8Array([1, 2, 3]), done: false })
                .mockResolvedValueOnce({ value: new Uint8Array([4, 5, 6]), done: false }),
            cancel,
        };
        await expect(readFuturesWorkstationResponseBody({
            body: { getReader: () => reader },
        }, 5)).rejects.toMatchObject({ code: 'RESPONSE_BODY_TOO_LARGE' });
        expect(cancel).toHaveBeenCalled();
    });

    it('rejects invalid UTF-8 response bodies', async () => {
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ value: new Uint8Array([0xff]), done: false })
                .mockResolvedValueOnce({ done: true }),
            cancel: vi.fn(),
        };
        await expect(readFuturesWorkstationResponseBody({
            body: { getReader: () => reader },
        }, 5)).rejects.toMatchObject({ code: 'INVALID_JSON_ENCODING' });
    });

    it('bounds header count, individual values and aggregate bytes', () => {
        const headers = new Headers();
        for (let index = 0; index < 65; index += 1) headers.set(`x-${index}`, 'v');
        expect(() => validateFuturesWorkstationResponseHeaders(headers))
            .toThrowError(expect.objectContaining({ code: 'RESPONSE_HEADERS_TOO_LARGE' }));
        expect(() => validateFuturesWorkstationResponseHeaders(new Headers({
            'x-large': 'x'.repeat(4_097),
        }))).toThrowError(expect.objectContaining({ code: 'RESPONSE_HEADERS_TOO_LARGE' }));
    });
});
