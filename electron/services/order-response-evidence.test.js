import { describe, expect, it } from 'vitest';
import { requireOrderResponseEvidence as requireEvidence } from './order-response-evidence.js';
import { matchesOrderReportIdentity, readExchangeOrderId } from '../../src/utils/orderReportIdentity.js';

const command = { symbol: 'BTCUSDT', orderId: '11', origClientOrderId: 'original', numericPrice: 40000, numericQuantity: 0.004 };
const report = { symbol: 'BTCUSDT', orderId: 11, clientOrderId: 'original', status: 'NEW', price: '40000.000', origQty: '0.004000' };

describe('successful order response evidence', () => {
    it.each([null, undefined, [], {}, 'ok', 1, { ...report, orderId: undefined },
        { ...report, symbol: undefined }, { ...report, symbol: 'ETHUSDT' },
        { ...report, orderId: 12 }, { ...report, orderId: 9007199254740992 },
    ])('rejects malformed or mismatching lookup evidence: %j', body => {
        expect(() => requireEvidence(body, command)).toThrow(expect.objectContaining({
            code: 'ORDER_RESPONSE_UNCONFIRMED', indeterminate: true, outcomeCertainty: 'unknown',
        }));
    });
    it.each(['NEW', 'PARTIALLY_FILLED', 'FILLED', 'EXPIRED', 'REJECTED', undefined])('cannot manufacture cancellation from %s', status => {
        expect(() => requireEvidence({ ...report, status }, command, 'trade.cancelOrder')).toThrow();
    });
    it('accepts an actual cancellation and original client identity without rewriting evidence', () => {
        const cancelled = { ...report, status: 'CANCELED', clientOrderId: 'cancel-id', origClientOrderId: 'original' };
        expect(requireEvidence(cancelled, command, 'trade.cancelOrder')).toBe(cancelled);
        expect(requireEvidence(cancelled, { symbol: 'BTCUSDT', origClientOrderId: 'original' }, 'trade.cancelOrder')).toBe(cancelled);
    });
    it('requires exact amended terms on a successful response', () => {
        expect(requireEvidence(report, command, 'trade.replaceOrder')).toBe(report);
        for (const patch of [{ price: '39999' }, { origQty: '0.003' }, { origQty: undefined }]) {
            expect(() => requireEvidence({ ...report, ...patch }, command, 'trade.replaceOrder')).toThrow();
        }
    });
    it('requires the minted client identity on a placement', () => {
        const placement = { symbol: 'BTCUSDT', newClientOrderId: 'original' };
        expect(requireEvidence(report, placement, 'trade.placeOrder')).toBe(report);
        expect(() => requireEvidence({ ...report, clientOrderId: 'different' }, placement, 'trade.placeOrder')).toThrow();
        expect(() => requireEvidence({ ...report, status: undefined }, placement, 'trade.placeOrder')).toThrow();
    });
    it('preserves large decimal order IDs and does not equate a contradictory ID via a client name', () => {
        const large = { ...report, orderId: '9007199254740993' };
        expect(requireEvidence(large, { ...command, orderId: large.orderId })).toBe(large);
        expect(readExchangeOrderId(9007199254740992)).toBeNull();
        expect(matchesOrderReportIdentity(large, { ...command, clientOrderId: 'original' })).toBe(false);
    });
    it('does not retain response contents on the indeterminate error', () => {
        let error;
        try { requireEvidence({ body: 'fixture-secret', status: 'NEW' }, command); } catch (caught) { error = caught; }
        expect(JSON.stringify(error)).not.toContain('fixture-secret');
        expect(error).not.toHaveProperty('cause');
        expect(error).not.toHaveProperty('response');
    });
});
