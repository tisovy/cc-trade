import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    createCommandRejection,
    validateLegacyCancelCommand,
    validateLegacyOrderCommand,
} from './trading-command-validation.js';

describe('backend trading command validation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-08T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates structured backend rejection messages', () => {
        expect(createCommandRejection('buyOrder', 'INVALID_ORDER_PRICE', 'bad price', { field: 'price' })).toEqual({
            command_rejected: {
                request: 'buyOrder',
                code: 'INVALID_ORDER_PRICE',
                message: 'bad price',
                details: { field: 'price' },
                timestamp: Date.parse('2026-07-08T12:00:00.000Z'),
            },
        });
    });

    it('accepts valid legacy order aliases without changing resolved spot fields', () => {
        expect(validateLegacyOrderCommand({
            qty: '0.2500',
            p: '61000.50',
        }, {
            requestType: 'buyOrder',
            selectedSymbol: 'BTCUSDT',
        })).toEqual({
            ok: true,
            command: {
                symbol: 'BTCUSDT',
                side: 'BUY',
                quantityValue: '0.2500',
                priceValue: '61000.50',
                numericQuantity: 0.25,
                numericPrice: 61000.5,
            },
        });

        expect(validateLegacyOrderCommand({
            symbol: 'ETHUSDT',
            quantity: '1',
            price: '3000',
        }, {
            requestType: 'sellOrder',
        }).command.side).toBe('SELL');
    });

    it('rejects malformed legacy order payloads before REST submission', () => {
        expect(validateLegacyOrderCommand(null, { requestType: 'buyOrder' })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'buyOrder',
                    code: 'INVALID_ORDER_PAYLOAD',
                    details: { field: 'data' },
                },
            },
        });

        expect(validateLegacyOrderCommand({
            symbol: 'BTCUSDT',
            side: 'hold',
            quantity: '1',
            price: '100',
        }, {
            requestType: 'buyOrder',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'buyOrder',
                    code: 'INVALID_ORDER_SIDE',
                    details: { field: 'side', value: 'hold' },
                },
            },
        });

        expect(validateLegacyOrderCommand({
            symbol: 'BTCUSDT',
            quantity: '0',
            price: '100',
        }, {
            requestType: 'buyOrder',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'buyOrder',
                    code: 'INVALID_ORDER_QUANTITY',
                    details: { field: 'quantity', value: '0' },
                },
            },
        });
    });

    it('accepts valid legacy cancel aliases', () => {
        expect(validateLegacyCancelCommand({
            id: '123456',
            symbol: 'BTCUSDT',
        })).toEqual({
            ok: true,
            command: {
                symbol: 'BTCUSDT',
                orderId: '123456',
                origClientOrderId: null,
                newClientOrderId: null,
            },
        });

        expect(validateLegacyCancelCommand({
            clientOrderId: 'client-123',
        }, {
            selectedSymbol: 'ETHUSDT',
        })).toEqual({
            ok: true,
            command: {
                symbol: 'ETHUSDT',
                orderId: null,
                origClientOrderId: 'client-123',
                newClientOrderId: null,
            },
        });
    });

    it('rejects malformed legacy cancel payloads before REST submission', () => {
        expect(validateLegacyCancelCommand([], { selectedSymbol: 'BTCUSDT' })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'cancelOrder',
                    code: 'INVALID_CANCEL_PAYLOAD',
                },
            },
        });

        expect(validateLegacyCancelCommand({
            symbol: 'BTCUSDT',
            orderId: 'abc',
            clientOrderId: 'client-123',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'cancelOrder',
                    code: 'INVALID_CANCEL_ORDER_ID',
                    details: { field: 'orderId', value: 'abc' },
                },
            },
        });

        expect(validateLegacyCancelCommand({
            symbol: 'BTCUSDT',
        })).toMatchObject({
            ok: false,
            rejection: {
                command_rejected: {
                    request: 'cancelOrder',
                    code: 'INVALID_CANCEL_TARGET',
                },
            },
        });
    });
});
