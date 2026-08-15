import { describe, expect, it } from 'vitest';
import {
    createCommandUnresolved,
    isIndeterminateTradingFailure,
} from './trading-command-outcome.js';

describe('trading command outcome classification', () => {
    it('treats a 5xx as unknown, because the order may already be on the book', () => {
        expect(isIndeterminateTradingFailure({ status: 503 })).toBe(true);
        expect(isIndeterminateTradingFailure({ status: 500 })).toBe(true);
        expect(isIndeterminateTradingFailure({ response: { status: 502 } })).toBe(true);
    });

    it('treats a business rejection as a determinate refusal', () => {
        // -2019 insufficient margin, answered with 400: Binance decided.
        expect(isIndeterminateTradingFailure({ status: 400, code: -2019 })).toBe(false);
        expect(isIndeterminateTradingFailure({ status: 401, code: -2015 })).toBe(false);
        expect(isIndeterminateTradingFailure({ status: 429, code: -1003 })).toBe(false);
    });

    it('treats a failure after the request was sent as unknown', () => {
        expect(isIndeterminateTradingFailure({ code: 'ETIMEDOUT' })).toBe(true);
        expect(isIndeterminateTradingFailure({ code: 'ECONNRESET' })).toBe(true);
        expect(isIndeterminateTradingFailure({ indeterminate: true })).toBe(true);
    });

    it('treats a connection that never opened as a determinate failure', () => {
        // Nothing could have executed, so sending the operator to hunt for an
        // order on Binance would be a lie.
        expect(isIndeterminateTradingFailure({ code: 'ECONNREFUSED' })).toBe(false);
        expect(isIndeterminateTradingFailure({ code: 'ENOTFOUND' })).toBe(false);
        expect(isIndeterminateTradingFailure({ code: 'EAI_AGAIN' })).toBe(false);
    });

    it('does not guess for an unrecognised failure', () => {
        expect(isIndeterminateTradingFailure({})).toBe(false);
        expect(isIndeterminateTradingFailure(null)).toBe(false);
        expect(isIndeterminateTradingFailure({ code: 'SOMETHING_NEW' })).toBe(false);
    });

    it('produces an unresolved envelope that is not a rejection', () => {
        const envelope = createCommandUnresolved('trade.placeOrder', 'CODE', 'message', { a: 1 });

        expect(envelope.command_rejected).toBeUndefined();
        expect(envelope.command_unresolved).toMatchObject({
            request: 'trade.placeOrder',
            code: 'CODE',
            message: 'message',
            details: { a: 1 },
        });
        expect(typeof envelope.command_unresolved.timestamp).toBe('number');
    });
});
